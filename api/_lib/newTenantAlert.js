// New-tenant notice for the platform owner (STANDARD Module 1: "the platform
// owner has to find out the same way a new support ticket does"). Two callers,
// one code path, so both behave identically:
//   - api/ingest/tenant-pull.js — real-time ping from the app right after signup;
//   - syncLicensesForApp — the daily sync, as the net for any app without the ping.
// Idempotent: one `alerts` row per (app, tenant) is the record that the owner
// was told, so a ping followed by the sync never emails twice.
import { supabaseAdmin } from './supabaseAdmin.js'
import { callBridge, bridgeConfigured } from './appBridge.js'
import { alertRecipients } from './ingestTicket.js'

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
  })
}

// Pure: tenants present after a sync that weren't there before.
export function newExternalIds(beforeIds, afterIds) {
  const before = new Set(beforeIds.map(String))
  return [...new Set(afterIds.map(String))].filter((id) => !before.has(id))
}

// Pure: the email. ctx: { appName, tenantName, externalId, plan, status,
// trialEndsAt, createdBy, createdAt, via }
export function renderNewTenantAlert(ctx) {
  const name = ctx.tenantName || ctx.externalId
  const subject = `🎉 [${ctx.appName}] Nuevo cliente: ${name}`
  const row = (label, value) => (value == null || value === '' ? '' :
    `<tr><td style="padding:6px 0;color:#8a8780;font-size:13px;width:140px;vertical-align:top">${esc(label)}</td>
<td style="padding:6px 0;color:#2a2a33;font-size:14px;font-weight:500">${esc(value)}</td></tr>`)
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2;margin:0;padding:20px;color:#2a2a33;line-height:1.6">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ece9e1;border-radius:16px;overflow:hidden">
  <div style="padding:18px 24px;border-bottom:1px solid #f0eee7">
    <b style="font-size:15px;color:#0e0d14">Nuevo cliente en ${esc(ctx.appName)}</b><br>
    <span style="color:#8a8780;font-size:12px">ACACIA Mission Control</span>
  </div>
  <div style="padding:20px 24px">
    <div style="font-size:20px;font-weight:700;color:#0e0d14;margin-bottom:12px">${esc(name)}</div>
    <table style="width:100%;border-collapse:collapse">
      ${row('App', ctx.appName)}
      ${row('Alta por', ctx.createdBy)}
      ${row('Fecha de alta', fmtWhen(ctx.createdAt))}
      ${row('Plan', ctx.plan)}
      ${row('Estado', ctx.status)}
      ${row('Fin de prueba', ctx.trialEndsAt ? fmtWhen(ctx.trialEndsAt) : null)}
      ${row('ID', ctx.externalId)}
    </table>
    <p style="color:#8a8780;font-size:12px;margin-top:16px">Detectado por ${ctx.via === 'sync' ? 'la sincronización diaria' : 'aviso en tiempo real de la app'}.</p>
  </div>
</div></body></html>`
  return { subject, html }
}

// Tell the owner about one tenant, once. `mapped` is { tenant, license } from
// mapLicenseRecord. Never throws: a failed notice must not fail the sync.
export async function notifyNewTenant({ app, mapped, via }) {
  const externalId = mapped.tenant.external_id
  try {
    const { data: prior } = await supabaseAdmin
      .from('alerts').select('id').eq('app_id', app.id).eq('kind', 'new_tenant')
      .eq('detail->>external_id', externalId).limit(1)
    if (prior?.length) return { externalId, notified: false, reason: 'ya notificado' }

    const raw = mapped.license.raw ?? {}
    const ctx = {
      appName: app.name || app.id,
      tenantName: mapped.tenant.name,
      externalId,
      plan: mapped.license.plan,
      status: mapped.license.status,
      trialEndsAt: mapped.license.trial_ends_at,
      createdBy: raw.created_by ?? null,
      createdAt: raw.created_date ?? null,
      via,
    }
    // The alert row goes first: it is the idempotency record, so a crash between
    // row and email can under-notify once but never spam.
    await supabaseAdmin.from('alerts').insert({
      app_id: app.id, severity: 'info', kind: 'new_tenant',
      title: `Nuevo cliente en ${ctx.appName}: ${ctx.tenantName || externalId}`.slice(0, 200),
      detail: { external_id: externalId, tenant_name: ctx.tenantName, created_by: ctx.createdBy, plan: ctx.plan, via },
    })

    const { subject, html } = renderNewTenantAlert(ctx)
    const email = { sent: [], failed: [] }
    if (bridgeConfigured()) {
      for (const to of alertRecipients()) {
        try {
          // internal: an ops notice already addressed to the owner — the app
          // must not add its own "[Copia →]" to the owner on top.
          await callBridge(app, 'emails.sendFollowup', { to, subject, html, internal: true })
          email.sent.push(to)
        } catch (e) {
          email.failed.push({ to, error: e.message })
        }
      }
    }
    return { externalId, notified: true, email }
  } catch (e) {
    return { externalId, notified: false, error: e.message }
  }
}
