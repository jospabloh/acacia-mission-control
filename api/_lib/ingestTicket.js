// Shared core for real-time ticket ingest, used by BOTH ingest paths:
//   - api/ingest/ticket.js      — push: the app POSTs the signed record. Four
//     apps host a signer: puntos, liuma and radar in a notifyTicketCreated
//     function, rumbo inline in submitTicket (which creates the ticket anyway).
//   - api/ingest/ticket-pull.js — pull: the app's frontend just pings MC with a
//     ticket id and MC reads the authoritative record via the acaciaControl
//     bridge. Five apps: cateqhub, flowfin, stockflow, ctrlhq and kitchops.
//     flowfin and stockflow sit at Base44's function cap and could not host a
//     signer; ctrlhq and kitchops simply have no reason to, since this path
//     needs no secret in the browser and MC re-reads the real record anyway.
// All nine notify in real time. Before 2026-08-23 ctrlhq and kitchops did
// neither, so their tickets waited for the 08:00 UTC sync — up to 23 hours
// before support saw a customer's message.
// Either way the record lands here and gets the identical treatment: upsert into
// the bodega (source='push'), SLA anchored to the customer's creation instant,
// and ONE notification fan-out guarded by notified_at.
import { supabaseAdmin, audit } from './supabaseAdmin.js'
import { callBridge, bridgeConfigured } from './appBridge.js'
import { mapTicketRecord } from './sync/ticketMapping.js'
import { normalizePriority } from './sla.js'
import { renderTicketAlert } from './ticketAlert.js'

// Who gets the internal new-ticket alert. Overridable via env; defaults to the
// support desk + (temporarily) the owner's personal inbox.
export function alertRecipients() {
  const raw = process.env.SUPPORT_ALERT_EMAILS
  const list = (raw ? raw.split(',') : ['soporte@acaciaco.com.mx', 'h.josepablo@gmail.com'])
    .map((s) => s.trim()).filter(Boolean)
  return [...new Set(list)]
}

// Severity for the optional dashboard alert row, from the SLA tier.
const SEVERITY_BY_TIER = { urgent: 'critical', high: 'warning', normal: 'info', low: 'info' }

// Process one raw ticket record into the bodega + notification. `app` is the
// registry row (must already be resolved by the caller). Returns a plain result
// object: { ok, ticket, notified, email?, reason? }. Never throws on the email
// path (best-effort); throws only on a hard DB upsert error.
export async function processIncomingTicket({ app, record }) {
  const appId = app.id
  const { ticket, tenantExternalId } = mapTicketRecord(record, app)

  // Resolve the bodega tenant FK from the already-synced tenants, when present.
  let tenantId = null
  if (tenantExternalId) {
    const { data: t } = await supabaseAdmin
      .from('tenants').select('id').eq('app_id', appId).eq('external_id', tenantExternalId).maybeSingle()
    tenantId = t?.id ?? null
  }

  // Has this ticket already been notified? (idempotency across retries / repeat pings.)
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
  if (upErr) throw new Error(`tickets upsert: ${upErr.message}`)

  // Already notified → reflect-only (a retry, or an update). Done.
  if (alreadyNotified) {
    return { ok: true, ticket: ticket.external_id, notified: false, reason: 'ya notificado' }
  }

  // ── Notification fan-out (once) ──────────────────────────────────────────────
  const tier = normalizePriority(ticket.priority)
  const link = process.env.MC_PUBLIC_URL ? `${process.env.MC_PUBLIC_URL.replace(/\/$/, '')}/support` : null
  const alert = renderTicketAlert({
    appName: app.name || appId,
    // Lead with the human folio (RUM-000001); keep the technical id as a subline.
    ticketId: ticket.ticket_number || ticket.external_id,
    externalId: ticket.external_id,
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

  return { ok: true, ticket: ticket.external_id, notified: true, email }
}
