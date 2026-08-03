// Cron diario: ciclo de vida de licencia unificado (portafolio: flowfin/
// stockflow/liuma/puntos/rumbo/radar/cateqhub) — acumulado desde
// current_period_end/premium_period_end_at, ver portfolioLifecycle.js.
// Nunca borra nada — deletion_eligible solo se refleja para revisión humana
// en Licencias (fuera de este plan).
//
// CateqHub tenía su propio modelo por-etapa (15/15/30 días, since-fields
// independientes) hasta 2026-08-03, cuando el owner de la plataforma pidió
// "no exceptions": ahora usa el mismo ciclo acumulado 8/15/30/45 que los
// otros 6 apps. Su lógica realmente distinta (freeDowngrade, mirror a User,
// freno de exportConfirmed, copy de correo propio) se preserva como hooks
// genéricos abajo, gateados en cfg — no hardcodeados a 'cateqhub' — para que
// cualquier app futura con las mismas necesidades los reutilice sin
// reintroducir una rama separada.
//
// Ver docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { licenseControlFor, deriveMirror } from '../_lib/licenseControl.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { computePortfolioLifecycleStage, emailKindForStage, filterPaidLicenses, shouldDowngradeToFree, weekBucketKey } from '../_lib/portfolioLifecycle.js'

async function runLifecycleForApp(app, cfg, byId, msgCfg, week, now, contactsError) {
  const row = { app: app.id, transitioned: 0, downgradedToFree: 0, reminded: 0, transitionFailed: 0, emailFailed: 0, enforcementGap: 0 }
  if (contactsError) row.contactsError = contactsError

  // `raw` se selecciona siempre (barata, ya viene del sync) porque
  // cfg.lifecycle.exportConfirmedField (hoy solo CateqHub) no tiene columna
  // normalizada propia — solo vive en el JSON completo guardado por el sync.
  const { data: lics, error: lErr } = await supabaseAdmin
    .from('licenses').select('external_id, plan, status, current_period_end, raw').eq('app_id', app.id)
  if (lErr) { row.error = lErr.message; return row }

  const paid = filterPaidLicenses(lics, cfg)

  let didTransition = false
  for (const lic of paid) {
    const exportField = cfg.lifecycle.exportConfirmedField
    const licState = exportField ? { ...lic, [exportField]: lic.raw?.[exportField] ?? null } : lic
    const result = computePortfolioLifecycleStage(licState, cfg.lifecycle, now)
    if (!result) continue
    const { stage, targetStatus } = result

    if (targetStatus === null && (stage === 'read_only' || stage === 'blocked')) {
      // El app no tiene este estado en su schema — se sigue mandando el
      // correo abajo, pero no hay escritura que aplicar.
      row.enforcementGap++
    } else if (targetStatus && lic.status !== targetStatus) {
      // Solo entra acá en el filo de la transición (lic.status todavía no es
      // targetStatus) — no se re-evalúa freeDowngrade en corridas
      // posteriores mientras el tenant sigue en la misma etapa, igual que el
      // modelo por-etapa que reemplaza ("no se reconsidera en cada
      // corrida"). Antes de aplicar la transición a read_only, si el app
      // tiene freeDowngrade configurado (hoy solo CateqHub), consulta el
      // consumo real del tenant (p.ej. niños activos) y decide si en vez de
      // restringir hay que bajarlo directo a un plan gratuito permanente —
      // ver shouldDowngradeToFree. Fail-safe: cualquier falla en la consulta
      // deja usageCount en null, y con null NUNCA se arriesga el downgrade
      // (sigue el ciclo normal, más conservador).
      let usageCount = null
      if (cfg.freeDowngrade && stage === 'read_only') {
        try {
          const u = cfg.freeDowngrade.usage
          const out = await callBridge(app, 'usage.tenantCount', {
            entity: u.entity, tenantField: u.tenantField, tenantValue: lic.external_id,
            filterField: u.filterField, filterValue: u.filterValue,
          })
          const body = out?.data ?? out
          usageCount = typeof body?.count === 'number' ? body.count : null
        } catch (e) {
          console.error(`license-lifecycle: consulta de uso falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
        }
      }
      const downgradeToFree = shouldDowngradeToFree(cfg.freeDowngrade, stage, usageCount)

      const patch = downgradeToFree
        ? { [cfg.planField]: cfg.freeDowngrade.freePlanValue, [cfg.statusField]: cfg.statuses.active }
        : { [cfg.statusField]: targetStatus }
      const mirror = deriveMirror(cfg, patch)

      try {
        // callBridge lanza ante cualquier respuesta no-2xx del puente. Además
        // de fallas de red/firma, `license.set` responde 502
        // { ok:false, error:'mirror_failed' } cuando NO pudo espejar los
        // campos en los User del tenant (hoy solo CateqHub tiene mirror) — y
        // en ese caso tampoco aplica el patch principal. Ese throw se trata
        // igual que cualquier otro fallo por tenant: se cuenta, se registra
        // y se sigue con el siguiente. La transición se recalcula igual
        // mañana (reintento natural, idempotente, ya que no se escribió
        // nada).
        await callBridge(app, 'license.set', { entity: cfg.entity, id: lic.external_id, patch, mirror })
        didTransition = true
        if (downgradeToFree) {
          row.downgradedToFree++
          lic.plan = cfg.freeDowngrade.freePlanValue
          lic.status = cfg.statuses.active
          const recipient = byId[lic.external_id]
          if (msgCfg && recipient?.email) {
            const r = await sendFollowup(app, msgCfg, 'trial_ended_downgraded_free', recipient, {})
            if (!r.sent) row.emailFailed++
          }
          continue // el downgrade a gratis no manda el correo de etapa de abajo
        }
        row.transitioned++
        lic.status = targetStatus // para que el correo de abajo, en la misma corrida, use el estado ya actualizado
      } catch (e) {
        row.transitionFailed++
        console.error(`license-lifecycle: transición falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
        continue
      }
    }

    const kind = emailKindForStage(stage, cfg.lifecycle.emailKinds)
    if (!kind) continue // deletion_eligible: sin correo al tenant, ver spec
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
  return row
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

    // Resuelve contactos una vez aquí. Si falla, NO se salta el app — eso
    // dejaría de aplicar view_only/suspended para todos sus tenants esta
    // corrida (una falla del lado de correo nunca debe suprimir la
    // transición de control de acceso). En vez de eso, sigue con byId={}
    // (los envíos de correo quedan como no-op, igual que hoy para un tenant
    // individual sin recipient) y le pasa el error a runLifecycleForApp para
    // que lo adjunte al row.
    let byId = {}
    let contactsError
    const msgCfg = messagingFor(app.id)
    if (msgCfg) {
      try {
        const recipients = await resolveRecipients(app, msgCfg)
        byId = Object.fromEntries(recipients.map((r) => [r.id, r]))
      } catch (e) { contactsError = e.message }
    }

    summary.push(await runLifecycleForApp(app, cfg, byId, msgCfg, week, now, contactsError))
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
