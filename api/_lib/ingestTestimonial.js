// Shared core for testimonial ingest, used by BOTH paths (same split as
// ingestTicket.js): the real-time ping (ingest/testimonial-pull.js) and the
// daily-sync backstop (sync/syncTestimonials.js). The rules themselves live in
// testimonials.js (pure, tested); this file only talks to Supabase and the bridge.
import { supabaseAdmin, audit } from './supabaseAdmin.js'
import { callBridge, bridgeConfigured } from './appBridge.js'
import { alertRecipients } from './ingestTicket.js'
import { fetchAllPages, normalizeRecord, decideUpsert, decideGone, notifyCutoff, withdrawnPatch } from './testimonials.js'
import { renderTestimonialAlert } from './testimonialAlert.js'

// Best-effort, like the new-ticket alert: never throws.
async function notifyReviewers(app, row) {
  const email = { sent: [], failed: [] }
  const link = process.env.MC_PUBLIC_URL ? `${process.env.MC_PUBLIC_URL.replace(/\/$/, '')}/testimonials` : null
  const alert = renderTestimonialAlert({
    appName: app.name || app.id, rating: row.rating, link,
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
      // NON-PERSONAL: withdrawal scrubs `testimonials` only, so nothing that names
      // or quotes the person may be copied into `alerts`.
      title: `Testimonio por revisar ${app.name || app.id} (${row.rating}/5)`.slice(0, 200),
      detail: { testimonial_external_id: row.external_id, rating: row.rating, email_sent: email.sent.length, email_failed: email.failed.length },
    })
  } catch { /* alerts insert best-effort */ }
  return email
}

// At most ONE alert per testimonial per hour, and a ping racing the sync can't
// double it: the claim is a single conditional UPDATE, so only one caller sees a
// row come back. It also requires the row to be STILL the pending version this
// caller wrote (`updated_at` as returned by that write): a withdrawal or newer
// write in between makes the claim fail and nothing is sent. Returns true when
// this caller owns the notification.
async function claimNotification(id, writtenUpdatedAt) {
  if (!writtenUpdatedAt) return false
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('testimonials').update({ notified_at: now })
    .eq('id', id).eq('status', 'pending').eq('updated_at', writtenUpdatedAt)
    .or(`notified_at.is.null,notified_at.lt.${notifyCutoff()}`).select('id')
  return !error && (data?.length ?? 0) > 0
}

// Writes are compare-and-swap on the row version (`updated_at`, bumped by a
// trigger on every update): a withdrawal or another ingest that lands between
// our SELECT and our UPDATE makes the UPDATE match 0 rows, and we re-read and
// re-decide (once) instead of overwriting it with a stale snapshot. A unique
// violation on insert is the same "lost the race".
const ATTEMPTS = 2
const lostRace = (id, reason = 'conflicto de escritura, se reintenta en el próximo sync') =>
  ({ ok: true, testimonial: String(id), stored: false, notified: false, reason })

// record: the app's Testimonial entity; tenantName: from the bridge answer.
// Returns { ok, testimonial, stored, status?, notified, reason }. Throws only on
// a hard DB error.
export async function processIncomingTestimonial({ app, record, tenantName = null, observedAt = new Date().toISOString() }) {
  const incoming = normalizeRecord(record, tenantName)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('testimonials').select('*').eq('app_id', app.id).eq('external_id', incoming.external_id).maybeSingle()
    if (selErr) throw new Error(`testimonials select: ${selErr.message}`)

    const d = decideUpsert(existing ?? null, incoming, observedAt)
    const skipped = { ok: true, testimonial: incoming.external_id, stored: false, notified: false, reason: d.reason }
    if (d.action === 'skip') return skipped

    let rowId = existing?.id
    let writtenAt = null // updated_at of the row as WE wrote it (the notification claim needs it)
    let error
    let lost = false
    if (d.erase || d.touch) {
      // Erase, or a touch (observed_at only; a withdrawn row keeps its erase patch).
      const patch = d.erase ? withdrawnPatch(d.sourceUpdatedAt, observedAt) : { observed_at: observedAt }
      const r = await supabaseAdmin.from('testimonials').update(patch)
        .eq('id', existing.id).eq('updated_at', existing.updated_at).select('id, updated_at')
      error = r.error
      lost = !error && (r.data?.length ?? 0) === 0
    } else {
      const fields = {
        tenant_external_id: incoming.tenant_external_id, tenant_name: incoming.tenant_name,
        rating: incoming.rating, body: incoming.body, author_name: incoming.author_name, author_role: incoming.author_role,
        consent_publish: true, consent_at: incoming.consent_at, submitted_at: incoming.submitted_at,
        source_updated_at: incoming.source_updated_at, observed_at: observedAt,
        status: 'pending', reviewed_by: null, reviewed_at: null,
      }
      if (d.action === 'insert') {
        const r = await supabaseAdmin.from('testimonials').insert({ app_id: app.id, external_id: incoming.external_id, ...fields }).select('id, updated_at').maybeSingle()
        error = r.error
        rowId = r.data?.id
        writtenAt = r.data?.updated_at
        if (error?.code === '23505') { error = null; lost = true } // the other writer got there first
      } else {
        const r = await supabaseAdmin.from('testimonials').update(fields)
          .eq('id', existing.id).eq('updated_at', existing.updated_at).select('id, updated_at')
        error = r.error
        lost = !error && (r.data?.length ?? 0) === 0
        writtenAt = r.data?.[0]?.updated_at
      }
    }
    if (error) throw new Error(`testimonials ${d.action}: ${error.message}`)
    if (lost) continue // re-read and re-decide against what the winner wrote
    if (d.touch) return skipped // only observed_at moved; nothing to audit or report

    let email = null
    let notified = false
    if (d.notify && rowId && await claimNotification(rowId, writtenAt)) {
      notified = true
      email = await notifyReviewers(app, { ...incoming, status: d.status })
    }
    await audit('ingest:testimonial', {
      target_app: app.id, target_type: 'testimonial', target_id: incoming.external_id,
      payload: { status: d.status, reason: d.reason, notified, email_sent: email?.sent.length ?? 0, email_failed: email?.failed.length ?? 0 },
    })
    return { ok: true, testimonial: incoming.external_id, stored: true, status: d.status, notified, reason: d.reason }
  }
  return lostRace(incoming.external_id)
}

// The id no longer exists in the app (get → record:null, or absent from a list
// that answered fine): same treatment as a withdrawal, applied only if this
// observation (`observedAt`: when that get/list call STARTED) is strictly later
// than the row's, and recorded as the row's new observed_at.
export async function processMissingTestimonial({ app, externalId, observedAt = new Date().toISOString() }) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('testimonials').select('id, status, observed_at, updated_at').eq('app_id', app.id).eq('external_id', String(externalId)).maybeSingle()
    if (selErr) throw new Error(`testimonials select: ${selErr.message}`)
    const d = decideGone(existing ?? null, undefined, { observedAt })
    if (d.action === 'skip') return { ok: true, testimonial: String(externalId), stored: false, notified: false, reason: d.reason }
    const { data, error } = await supabaseAdmin.from('testimonials').update(withdrawnPatch(null, observedAt))
      .eq('id', existing.id).eq('updated_at', existing.updated_at).select('id')
    if (error) throw new Error(`testimonials withdraw: ${error.message}`)
    if ((data?.length ?? 0) === 0) continue
    if (d.touch) return { ok: true, testimonial: String(externalId), stored: false, notified: false, reason: d.reason }
    await audit('ingest:testimonial', {
      target_app: app.id, target_type: 'testimonial', target_id: String(externalId),
      payload: { status: 'withdrawn', reason: d.reason },
    })
    return { ok: true, testimonial: String(externalId), stored: true, status: 'withdrawn', notified: false, reason: d.reason }
  }
  return lostRace(externalId)
}

// EVERY stored row of the app (PostgREST caps one response at 1000): absence
// detection over a subset would leave deleted rows outside it public forever.
export async function listStoredTestimonials(appId) {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabaseAdmin.from('testimonials').select('external_id, status')
      .eq('app_id', appId).order('id', { ascending: true }).range(from, to)
    if (error) throw new Error(`testimonials list: ${error.message}`)
    return data ?? []
  })
}
