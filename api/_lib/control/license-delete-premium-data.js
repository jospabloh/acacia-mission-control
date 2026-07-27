// Borrado manual y definitivo de datos Premium (Guardian/ChildGuardian de
// CateqHub) de un tenant delincuente. Deliberadamente SEPARADO de
// license-action.js: es la única acción destructiva de todo api/control/*, así
// que sube el piso de autorización a `owner` y exige, del lado del servidor,
// que la exportación ya haya sido confirmada — nunca confía en el estado que
// mande el cliente.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { licenseControlFor } from '../licenseControl.js'
import { syncLicensesForApp } from '../sync/syncLicenses.js'
import { messagingFor } from '../messaging.js'
import { resolveRecipients, sendFollowup } from '../emailFollowup.js'

// Exportado para test unitario — la licencia trae `raw` (registro completo del
// app, ver syncLicenses.js) donde vive export_confirmed_at (sin columna propia
// en la bodega).
export function assertExportConfirmed(license) {
  if (!license?.raw?.export_confirmed_at) return { ok: false, error: 'export_not_confirmed' }
  return { ok: true }
}

// Exportado para test unitario — confirmación por nombre exacto, sin
// normalizar (mayúsculas/espacios deben coincidir tal cual), patrón típico de
// acciones irreversibles: reduce el riesgo de "confirmar" el tenant equivocado
// por un match relajado.
export function assertParishNameMatches(actualName, typedName) {
  return { ok: actualName === typedName }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'owner')
  if (!member) return

  const { appId, licenseExternalId, confirmParishName } = req.body ?? {}
  if (!appId || !licenseExternalId || !confirmParishName) {
    return res.status(400).json({ error: 'falta appId/licenseExternalId/confirmParishName' })
  }
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const cfg = licenseControlFor(appId)
  if (!cfg?.lifecycle) return res.status(400).json({ error: `app ${appId} no soporta borrado de datos Premium` })

  const { data: lic, error: lErr } = await supabaseAdmin
    .from('licenses').select('raw').eq('app_id', appId).eq('external_id', licenseExternalId).maybeSingle()
  if (lErr) return res.status(500).json({ error: lErr.message })
  if (!lic) return res.status(404).json({ error: 'licencia no encontrada' })

  const exportCheck = assertExportConfirmed(lic)
  if (!exportCheck.ok) return res.status(409).json({ error: exportCheck.error })

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('name').eq('app_id', appId).eq('external_id', licenseExternalId).maybeSingle()
  const nameCheck = assertParishNameMatches(tenant?.name ?? '', confirmParishName)
  if (!nameCheck.ok) return res.status(400).json({ error: 'el nombre no coincide con el de la parroquia' })

  const { data: app, error: aErr } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (aErr) return res.status(500).json({ error: aErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Se marca en cuanto el borrado quedó confirmado completo, para que el catch
  // de abajo pueda distinguir "falló antes de borrar nada" de "ya se borraron
  // datos de menores y falló el reset" — el segundo caso NUNCA puede quedar sin
  // rastro en la bitácora.
  let deleted = null

  try {
    // Paso 1: borrado, orden hijo→padre para no dejar referencias huérfanas.
    const delOut = await callBridge(app, 'license.deletePremiumData', {
      deleteEntities: [
        { entity: 'ChildGuardian', field: 'parish_id', value: licenseExternalId },
        { entity: 'Guardian', field: 'parish_id', value: licenseExternalId },
      ],
    })
    // El SDK de Base44 crea el cliente de functions con interceptResponses:false,
    // así que callBridge devuelve el objeto de respuesta axios crudo, no el body
    // ya desempaquetado — hay que leer .data (mismo patrón que syncHealth.js,
    // syncLicenses.js, emailFollowup.js en este repo).
    const delBody = delOut?.data ?? delOut
    const deletedCounts = delBody?.deletedCounts ?? {}

    // El puente NO devuelve un simple { ok:true }: repite el borrado por entidad
    // hasta que no queden filas y reporta { ok, deletedCounts, incomplete[] },
    // donde `incomplete` lista las entidades que no pudo vaciar (permisos, o el
    // tope de 1000 vueltas). Un borrado LFPDPPP jamás debe reportarse como
    // terminado "de más": si quedó algo, se corta aquí — NO se resetea la
    // licencia a free/active (eso borraría la evidencia de por qué el tenant
    // estaba en deletion_eligible y dejaría datos de menores vivos en un tenant
    // aparentemente limpio), NO se manda el correo de confirmación al párroco, y
    // NO se registra como borrado exitoso en la bitácora. El operador ve qué
    // entidades faltan y reintenta (la acción del puente es idempotente: borra
    // por filtro, así que un reintento sólo alcanza lo que quedó vivo).
    const incomplete = Array.isArray(delBody?.incomplete) ? delBody.incomplete : []
    if (incomplete.length > 0 || delBody?.ok !== true) {
      // Se audita el intento fallido con una acción DISTINTA — así ninguna
      // consulta de la bitácora puede confundirlo con un borrado completado.
      await audit('control:license-delete-premium-data-incomplete', {
        actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
        payload: { deletedCounts, incomplete, bridgeOk: delBody?.ok ?? null },
      })
      const detail = incomplete.length > 0
        ? `borrado incompleto: ${incomplete.join(', ')}`
        : 'el puente no confirmó el borrado (respuesta sin ok:true)'
      return res.status(502).json({ error: `${detail}. La licencia NO se reinició; revisa y reintenta.`, deletedCounts, incomplete })
    }

    deleted = deletedCounts

    // Paso 2: reset del estado de licencia, vía la acción genérica ya existente
    // (así el mirror hacia User se aplica igual que en cualquier otro license.set).
    // El plan "gratis" se deriva de cfg (cualquier plan de cfg.plans que NO esté
    // en lifecycle.paidPlanValues) en vez de escribir 'free' fijo — para que
    // esto siga siendo correcto si algún día otra app se suma a `lifecycle` con
    // un nombre de plan gratuito distinto. Si cfg no define ninguno, fallar
    // fuerte: los datos de menores YA se borraron, así que reiniciar la
    // licencia a un plan de pago por defecto silencioso sería peor que dejarla
    // varada en deletion_eligible para que un humano revise cfg.
    const freePlan = cfg.plans.find((p) => !cfg.lifecycle.paidPlanValues.includes(p))
    if (!freePlan) {
      await audit('control:license-delete-premium-data-reset-failed', {
        actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
        payload: { deletedCounts, error: `config de ${appId} no define un plan gratuito en cfg.plans` },
      })
      return res.status(500).json({
        error: `datos borrados, pero config de ${appId} no define un plan gratuito; la licencia NO se reinició. Revisa licenseControl.js.`,
        deletedCounts,
      })
    }
    const activeStatus = cfg.statuses.active
    const resetPatch = {
      [cfg.planField]: freePlan, [cfg.statusField]: activeStatus,
      [cfg.lifecycle.sinceFields.read_only]: null,
      [cfg.lifecycle.sinceFields.access_denied]: null,
      [cfg.lifecycle.sinceFields.deletion_eligible]: null,
      [cfg.lifecycle.exportConfirmedField]: null,
    }
    const mirror = cfg.mirror
      ? [{ entity: cfg.mirror.entity, matchField: cfg.mirror.matchField, fields: { [cfg.mirror.fields.plan]: freePlan, [cfg.mirror.fields.license_status]: activeStatus } }]
      : undefined
    await callBridge(app, 'license.set', { entity: cfg.entity, id: licenseExternalId, patch: resetPatch, mirror })

    let resync = null
    try { resync = await syncLicensesForApp(app) } catch (e) { resync = { error: e.message } }

    // Correo de confirmación, best-effort.
    let emailed = false
    try {
      const msgCfg = messagingFor(appId)
      if (msgCfg) {
        const recipients = await resolveRecipients(app, msgCfg)
        const recipient = recipients.find((r) => r.id === licenseExternalId)
        if (recipient) {
          const r = await sendFollowup(app, msgCfg, 'premium_data_deleted_confirmation', recipient, {})
          emailed = !!r.sent
        }
      }
    } catch (e) { console.warn('[license-delete-premium-data] correo falló:', e.message) }

    await audit('control:license-delete-premium-data', {
      actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
      payload: { deletedCounts, emailed },
    })
    return res.status(200).json({ ok: true, deletedCounts, emailed, resync })
  } catch (e) {
    // Si el borrado YA se había completado, lo que falló es el paso 2 (reset de
    // licencia; `license.set` responde 502 { ok:false, error:'mirror_failed' } y
    // callBridge lo relanza). Los datos de menores ya no existen: se registra
    // con una acción propia — ni "exitosa" (el tenant sigue en
    // deletion_eligible) ni invisible. Reintentar es seguro e idempotente: el
    // borrado por filtro no encuentra nada y el reset se vuelve a aplicar.
    if (deleted) {
      await audit('control:license-delete-premium-data-reset-failed', {
        actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
        payload: { deletedCounts: deleted, error: e.message },
      })
      return res.status(502).json({ error: `datos borrados, pero el reinicio de la licencia falló: ${e.message}. Reintenta.`, deletedCounts: deleted })
    }
    return res.status(502).json({ error: e.message })
  }
}
