// Shared core for testimonial ingest, used by BOTH paths (same split as
// ingestTicket.js): the real-time ping (ingest/testimonial-pull.js) and the
// daily-sync backstop (sync/syncTestimonials.js). The rules themselves live in
// testimonials.js (pure, tested); this file only talks to Supabase and the bridge.
import { supabaseAdmin, audit } from './supabaseAdmin.js'
import { callBridge, bridgeConfigured } from './appBridge.js'
import { alertRecipients } from './ingestTicket.js'
import { normalizeRecord, decideUpsert, decideGone, notifyCutoff, withdrawnPatch } from './testimonials.js'
import { renderTestimonialAlert } from './testimonialAlert.js'

// Best-effort, like the new-ticket alert: never throws.
async function notifyReviewers(app, row) {
  const email = { sent: [], failed: [] }
  const link = process.env.MC_PUBLIC_URL ? `${process.env.MC_PUBLIC_URL.replace(/\/$/, '')}/testimonials` : null
  const alert = renderTestimonialAlert({
    appName: app.name || app.id, tenantName: row.tenant_name, rating: row.rating, body: row.body,
    authorName: row.author_name, authorRole: row.author_role, link,
  })
  if (bridgeConfigured()) {
    for (const to of alertRecipients()) {
      try {
        await callBridge(app, 'emails.sendFollowup', { to, subject: alert.subject, html: alert.html, internal: true })
        email.sent.push(to)
      } catch (e) {
        email.failed.push({ to, error: e.message })
      }
    }
  } else {
    email.failed.push({ error: 'INGEST_HMAC_SECRET/bridge no configurado' })
  }
  try {
    await supabaseAdmin.from('alerts').insert({
      app_id: app.id, severity: 'info', kind: 'testimonial',
      title: `Testimonio por revisar ${app.name || app.id} (${row.rating}/5): ${row.author_name}`.slice(0, 200),
      detail: { testimonial_external_id: row.external_id, rating: row.rating, email_sent: email.sent.length, email_failed: email.failed.length },
    })
  } catch { /* alerts insert best-effort */ }
  return email
}

// At most ONE alert per testimonial per hour, and a ping racing the sync can't
// double it: the claim is a single conditional UPDATE, so only one caller sees a
// row come back. Returns true when this caller owns the notification.
async function claimNotification(id) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('testimonials').update({ notified_at: now })
    .eq('id', id).or(`notified_at.is.null,notified_at.lt.${notifyCutoff()}`).select('id')
  return !error && (data?.length ?? 0) > 0
}

// record: the app's Testimonial entity; tenantName: from the bridge answer.
// Returns { ok, testimonial, stored, status?, notified, reason }. Throws only on
// a hard DB error.
export async function processIncomingTestimonial({ app, record, tenantName = null }) {
  const incoming = normalizeRecord(record, tenantName)
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('testimonials').select('*').eq('app_id', app.id).eq('external_id', incoming.external_id).maybeSingle()
  if (selErr) throw new Error(`testimonials select: ${selErr.message}`)

  const d = decideUpsert(existing ?? null, incoming)
  const skipped = { ok: true, testimonial: incoming.external_id, stored: false, notified: false, reason: d.reason }
  if (d.action === 'skip') return skipped

  let rowId = existing?.id
  let error
  if (d.erase) {
    ;({ error } = await supabaseAdmin.from('testimonials').update(withdrawnPatch()).eq('id', existing.id))
  } else {
    const fields = {
      tenant_external_id: incoming.tenant_external_id, tenant_name: incoming.tenant_name,
      rating: incoming.rating, body: incoming.body, author_name: incoming.author_name, author_role: incoming.author_role,
      consent_publish: true, consent_at: incoming.consent_at, submitted_at: incoming.submitted_at,
      status: 'pending', reviewed_by: null, reviewed_at: null,
    }
    if (d.action === 'insert') {
      const r = await supabaseAdmin.from('testimonials').insert({ app_id: app.id, external_id: incoming.external_id, ...fields }).select('id').maybeSingle()
      error = r.error
      rowId = r.data?.id
      // The ping and the sync can race on a brand-new row: the loser is a no-op.
      if (error?.code === '23505') return { ...skipped, reason: 'ya registrado' }
    } else {
      ;({ error } = await supabaseAdmin.from('testimonials').update(fields).eq('id', existing.id))
    }
  }
  if (error) throw new Error(`testimonials ${d.action}: ${error.message}`)

  let email = null
  let notified = false
  if (d.notify && rowId && await claimNotification(rowId)) {
    notified = true
    email = await notifyReviewers(app, { ...incoming, status: d.status })
  }
  await audit('ingest:testimonial', {
    target_app: app.id, target_type: 'testimonial', target_id: incoming.external_id,
    payload: { status: d.status, reason: d.reason, notified, email_sent: email?.sent.length ?? 0, email_failed: email?.failed.length ?? 0 },
  })
  return { ok: true, testimonial: incoming.external_id, stored: true, status: d.status, notified, reason: d.reason }
}

// The id no longer exists in the app (get → record:null, or absent from a list
// that answered fine): same treatment as a withdrawal.
export async function processMissingTestimonial({ app, externalId }) {
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('testimonials').select('id, status').eq('app_id', app.id).eq('external_id', String(externalId)).maybeSingle()
  if (selErr) throw new Error(`testimonials select: ${selErr.message}`)
  const d = decideGone(existing ?? null)
  if (d.action === 'skip') return { ok: true, testimonial: String(externalId), stored: false, notified: false, reason: d.reason }
  const { error } = await supabaseAdmin.from('testimonials').update(withdrawnPatch()).eq('id', existing.id)
  if (error) throw new Error(`testimonials withdraw: ${error.message}`)
  await audit('ingest:testimonial', {
    target_app: app.id, target_type: 'testimonial', target_id: String(externalId),
    payload: { status: 'withdrawn', reason: d.reason },
  })
  return { ok: true, testimonial: String(externalId), stored: true, status: 'withdrawn', notified: false, reason: d.reason }
}

export async function listStoredTestimonials(appId) {
  const { data, error } = await supabaseAdmin.from('testimonials').select('external_id, status').eq('app_id', appId)
  if (error) throw new Error(`testimonials list: ${error.message}`)
  return data ?? []
}
