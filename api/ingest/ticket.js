// Real-time support-ticket push. A Base44 app's `notifyTicketCreated` function
// calls this the instant a customer raises a ticket — server-side, HMAC-signed
// with the same INGEST_HMAC_SECRET as the admin bridge. This is what removes the
// "tengo que darle a sincronizar": the ticket lands in the bodega within seconds
// of creation instead of waiting for the daily pull (api/cron/sync).
//
// On receipt we:
//   1. verify the signature (action 'ticket.ingest', params { app, record }),
//   2. upsert the normalized ticket into `tickets` (source='push') with its SLA
//      clock anchored to the customer's own created_date,
//   3. fire ONE notification fan-out — email to the ACACIA support desk via the
//      originating app's SendEmail bridge — guarded by notified_at so a retried
//      push never double-notifies.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { verify } from '../_lib/ingestSign.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { mapTicketRecord, isTicketMappable } from '../_lib/sync/ticketMapping.js'
import { ticketControlFor } from '../_lib/ticketControl.js'
import { normalizePriority } from '../_lib/sla.js'
import { renderTicketAlert } from '../_lib/ticketAlert.js'

const ACTION = 'ticket.ingest'

// Who gets the internal new-ticket alert. Overridable via env; defaults to the
// support desk + (temporarily) the owner's personal inbox.
function alertRecipients() {
  const raw = process.env.SUPPORT_ALERT_EMAILS
  const list = (raw ? raw.split(',') : ['soporte@acaciaco.com.mx', 'h.josepablo@gmail.com'])
    .map((s) => s.trim()).filter(Boolean)
  return [...new Set(list)]
}

// Severity for the optional dashboard alert row, from the SLA tier.
const SEVERITY_BY_TIER = { urgent: 'critical', high: 'warning', normal: 'info', low: 'info' }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const secret = process.env.INGEST_HMAC_SECRET
  if (!secret) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { app: appId, record, ts, sig } = req.body ?? {}
  if (!appId || !record || !ts || !sig) return res.status(400).json({ error: 'falta app/record/ts/sig' })
  if (!verify({ secret, ts, action: ACTION, params: { app: appId, record }, sig })) {
    return res.status(401).json({ error: 'firma inválida' })
  }
  if (!isTicketMappable(record)) return res.status(400).json({ error: 'record sin id' })

  const cfg = ticketControlFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta tickets` })

  const { data: app, error: appErr } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (appErr) return res.status(500).json({ error: appErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  const { ticket, tenantExternalId } = mapTicketRecord(record, app)

  // Resolve the bodega tenant FK from the already-synced tenants, when present.
  let tenantId = null
  if (tenantExternalId) {
    const { data: t } = await supabaseAdmin
      .from('tenants').select('id').eq('app_id', appId).eq('external_id', tenantExternalId).maybeSingle()
    tenantId = t?.id ?? null
  }

  // Has this ticket already been notified? (idempotency across retries.)
  const { data: existing } = await supabaseAdmin
    .from('tickets').select('id, notified_at').eq('app_id', appId).eq('external_id', ticket.external_id).maybeSingle()
  const alreadyNotified = Boolean(existing?.notified_at)
  const nowISO = new Date().toISOString()

  const row = {
    ...ticket,
    tenant_id: tenantId,
    source: 'push',
    notified_at: alreadyNotified ? existing.notified_at : nowISO,
  }
  const { error: upErr } = await supabaseAdmin.from('tickets').upsert(row, { onConflict: 'app_id,external_id' })
  if (upErr) return res.status(500).json({ error: `tickets upsert: ${upErr.message}` })

  // Already notified → reflect-only (a retry, or an update push). Done.
  if (alreadyNotified) {
    return res.status(200).json({ ok: true, ticket: ticket.external_id, notified: false, reason: 'ya notificado' })
  }

  // ── Notification fan-out (once) ──────────────────────────────────────────────
  const tier = normalizePriority(ticket.priority)
  const link = process.env.MC_PUBLIC_URL ? `${process.env.MC_PUBLIC_URL.replace(/\/$/, '')}/support` : null
  const alert = renderTicketAlert({
    appName: app.name || appId,
    ticketId: ticket.external_id,
    subject: ticket.subject,
    issue: record.description ?? record.body ?? record.message ?? null,
    category: record.category ?? null,
    requesterName: ticket.requester?.name ?? null,
    requesterEmail: ticket.requester?.email ?? null,
    priority: tier,
    createdAt: ticket.customer_created_at,
    firstResponseDueAt: ticket.sla_first_response_due_at,
    resolveDueAt: ticket.sla_resolve_due_at,
    link,
  })

  const email = { sent: [], failed: [] }
  if (bridgeConfigured()) {
    for (const to of alertRecipients()) {
      try {
        await callBridge(app, 'emails.sendFollowup', { to, subject: alert.subject, html: alert.html })
        email.sent.push(to)
      } catch (e) {
        email.failed.push({ to, error: e.message })
      }
    }
  } else {
    email.failed.push({ error: 'INGEST_HMAC_SECRET/bridge no configurado' })
  }

  // Surface it on the ops dashboard too (best-effort).
  try {
    await supabaseAdmin.from('alerts').insert({
      app_id: appId,
      severity: SEVERITY_BY_TIER[tier] ?? 'info',
      kind: 'support_ticket',
      title: `Nuevo ticket ${app.name || appId} #${ticket.external_id}: ${ticket.subject ?? ''}`.slice(0, 200),
      detail: { ticket_external_id: ticket.external_id, priority: tier, requester: ticket.requester, sla_resolve_due_at: ticket.sla_resolve_due_at },
    })
  } catch { /* alerts insert best-effort */ }

  await audit('ingest:ticket', {
    target_app: appId, target_type: 'ticket', target_id: ticket.external_id,
    payload: { priority: tier, email_sent: email.sent.length, email_failed: email.failed.length },
  })

  return res.status(201).json({ ok: true, ticket: ticket.external_id, notified: true, email })
}
