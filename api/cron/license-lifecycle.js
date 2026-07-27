// Cron diario: ciclo de vida de licencia Premium (solo-lectura → acceso
// denegado → elegible para borrado). Aplica SOLO a apps con `lifecycle` en su
// entrada de api/_lib/licenseControl.js (hoy solo cateqhub). Nunca borra nada
// — deletion_eligible solo se refleja para revisión humana en Licencias
// (ver api/control/license-delete-premium-data.js para el borrado real).
// Lógica pura (computeLifecycleTransition/reminderKindFor/weekBucketKey) vive
// en api/_lib/licenseLifecycle.js.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { licenseControlFor } from '../_lib/licenseControl.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { computeLifecycleTransition, reminderKindFor, weekBucketKey } from '../_lib/licenseLifecycle.js'

// Extrae del `raw` (registro completo de Base44, guardado por el sync) los
// campos del ciclo de vida que no tienen columna dedicada en la bodega.
function licenseFromRaw(row, lifecycleCfg) {
  const raw = row.raw || {}
  return {
    plan: row.plan,
    status: row.status,
    premium_period_end_at: raw[lifecycleCfg.periodEndField] ?? null,
    read_only_since: raw[lifecycleCfg.sinceFields.read_only] ?? null,
    access_denied_since: raw[lifecycleCfg.sinceFields.access_denied] ?? null,
    deletion_eligible_since: raw[lifecycleCfg.sinceFields.deletion_eligible] ?? null,
    [lifecycleCfg.exportConfirmedField]: raw[lifecycleCfg.exportConfirmedField] ?? null,
  }
}

async function runLicenseLifecycle(now) {
  if (!bridgeConfigured()) return { skipped: 'bridge not configured', apps: [] }

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) throw new Error(error.message)

  const week = weekBucketKey(now)
  const summary = []

  for (const app of (apps ?? [])) {
    const cfg = licenseControlFor(app.id)
    if (!cfg?.lifecycle) continue
    // transitionFailed y emailFailed van por separado (no un solo `failed`
    // compartido) para que el resumen de auditoría (abajo, audit()) distinga
    // "se cayeron N correos" de "N tenants se quedaron sin aplicar su
    // restricción de acceso" — lo segundo es una falla silenciosa de control
    // de acceso que se repite cada día hasta que alguien la note; con un solo
    // contador compartido, un operador no puede saber cuál de las dos pasó.
    const row = { app: app.id, transitioned: 0, reminded: 0, transitionFailed: 0, emailFailed: 0 }

    const { data: lics, error: lErr } = await supabaseAdmin
      .from('licenses').select('external_id, plan, status, raw').eq('app_id', app.id)
    if (lErr) { row.error = lErr.message; summary.push(row); continue }

    const premium = (lics ?? []).filter((l) => cfg.lifecycle.paidPlanValues.includes(l.plan))
    if (premium.length === 0) { summary.push(row); continue }

    let byId = {}
    const msgCfg = messagingFor(app.id)
    if (msgCfg) {
      try {
        const recipients = await resolveRecipients(app, msgCfg)
        byId = Object.fromEntries(recipients.map((r) => [r.id, r]))
      } catch (e) { row.contactsError = e.message }
    }

    let didTransition = false
    for (const lic of premium) {
      const licState = licenseFromRaw(lic, cfg.lifecycle)
      const transition = computeLifecycleTransition(licState, cfg.lifecycle, now)

      if (transition) {
        const patch = { [cfg.statusField]: transition.toStatus, [transition.sinceField]: now.toISOString() }
        // Deriva `mirror` de cualquier clave de `patch` que tenga un mapeo en
        // cfg.mirror.fields — hoy una transición solo toca statusField, pero
        // esto se mantiene correcto si una transición futura llega a tocar
        // más de un campo (p.ej. planField también).
        const mirror = cfg.mirror
          ? [{
              entity: cfg.mirror.entity,
              matchField: cfg.mirror.matchField,
              fields: Object.fromEntries(
                Object.entries(cfg.mirror.fields)
                  .filter(([sourceField]) => sourceField in patch)
                  .map(([sourceField, mirrorField]) => [mirrorField, patch[sourceField]]),
              ),
            }]
          : undefined
        try {
          // callBridge lanza ante cualquier respuesta no-2xx del puente. Además
          // de fallas de red/firma, `license.set` responde 502
          // { ok:false, error:'mirror_failed' } cuando NO pudo espejar los
          // campos en los User de la parroquia — y en ese caso tampoco aplica
          // el patch principal. Ese throw se trata igual que cualquier otro
          // fallo por tenant: se cuenta, se registra y se sigue con el
          // siguiente tenant. Como no se escribe el `since`, la transición se
          // recalcula igual mañana (reintento natural, idempotente).
          await callBridge(app, 'license.set', { entity: cfg.entity, id: lic.external_id, patch, mirror })
          row.transitioned++
          didTransition = true
          licState.status = transition.toStatus // para que el recordatorio de abajo, en la misma corrida, use el estado ya actualizado
        } catch (e) {
          row.transitionFailed++
          console.error(`license-lifecycle: transición falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
          continue
        }
      }

      // Recordatorio semanal, independiente de si hubo transición esta corrida.
      const kind = reminderKindFor(licState.status)
      if (!kind || licState[cfg.lifecycle.exportConfirmedField]) continue
      const recipient = byId[lic.external_id]
      if (!recipient?.email) continue

      const { error: claimErr } = await supabaseAdmin.from('license_lifecycle_reminders')
        .insert({ app_id: app.id, external_id: lic.external_id, period: week, kind, recipient: recipient.email })
      if (claimErr) continue // ya se mandó esta semana

      const r = await sendFollowup(app, msgCfg, kind, recipient, {})
      if (r.sent) row.reminded++
      else row.emailFailed++
    }

    if (didTransition) { try { await syncLicensesForApp(app) } catch { /* best-effort */ } }
    summary.push(row)
  }

  return { week, apps: summary }
}

export default async function handler(req, res) {
  // Mismo gate que los demás crons: CRON_SECRET (Bearer) o header de Vercel cron.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  try {
    const result = await runLicenseLifecycle(new Date())
    await audit('cron:license-lifecycle', { payload: result })
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
