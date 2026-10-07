// Pure rules for the testimonials feature (contract v1.1, Module 29 of
// acacia-app-standard). No imports, so `node --test` loads it without
// Supabase or the bridge.

// Only known difference between a Mission Control app id and the marketing
// site's page slug (acaciaco-site/apps/puntos-plus.html). Every other app uses
// the same string on both sides.
const SITE_SLUG_BY_APP = { puntos: 'puntos-plus' }
const APP_BY_SITE_SLUG = Object.fromEntries(Object.entries(SITE_SLUG_BY_APP).map(([a, s]) => [s, a]))

export const siteSlug = (appId) => SITE_SLUG_BY_APP[appId] ?? appId
export const appIdForSlug = (slug) => APP_BY_SITE_SLUG[slug] ?? slug

// An app that has not adopted the module answers its bridge with exactly
// `unknown action: <action>` (callBridge rethrows the bridge's own message).
// Matching stays a little tolerant on case/wording; it is harmless.
export function isUnknownAction(err) {
  return /unknown action|acci[oó]n desconocida/i.test(String(err?.message ?? err ?? ''))
}

// ── Validation (fail-closed, contract §4) ────────────────────────────────────
const len = (s) => [...s].length
const validDate = (v) => {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// App record (entity `Testimonial`) → bodega fields + `publishable`. Anything
// that is not clearly a valid, consented, submitted testimonial is NOT
// publishable; that includes unknown `status` values. Dates are normalised to
// ISO or null, so nothing unparseable can reach Postgres.
export function normalizeRecord(record, tenantName = null) {
  const r = record ?? {}
  const body = typeof r.body === 'string' ? r.body.trim() : ''
  const authorName = typeof r.author_name === 'string' ? r.author_name.trim() : ''
  const roleOk = r.author_role == null || typeof r.author_role === 'string'
  const authorRole = typeof r.author_role === 'string' ? r.author_role.trim() : ''
  const consentAt = validDate(r.consent_at)
  const idOk = (typeof r.id === 'string' || typeof r.id === 'number') && String(r.id).trim() !== ''
  const tenantId = typeof r.tenant_id === 'string' || typeof r.tenant_id === 'number' ? String(r.tenant_id).trim() : ''
  const name = tenantName ?? r.tenant_name
  const publishable =
    idOk && r.status === 'submitted' && r.consent_publish === true && consentAt !== null &&
    typeof r.rating === 'number' && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 &&
    len(body) >= 20 && len(body) <= 600 &&
    len(authorName) >= 1 && len(authorName) <= 80 &&
    roleOk && len(authorRole) <= 80
  return {
    external_id: idOk ? String(r.id).trim() : '',
    tenant_external_id: tenantId || null,
    tenant_name: typeof name === 'string' && name.trim() ? name.trim() : null,
    rating: publishable ? r.rating : null,
    body: publishable ? body : '',
    author_name: publishable ? authorName : '',
    author_role: publishable ? (authorRole || null) : null,
    consent_publish: publishable,
    consent_at: consentAt,
    submitted_at: consentAt, // consent_at is renewed on every re-send
    publishable,
  }
}

const CONTENT = ['rating', 'body', 'author_name', 'author_role']
export const contentChanged = (a, b) => CONTENT.some((k) => (a[k] ?? null) !== (b[k] ?? null))

// What "withdrawn" does to a bodega row: personal data is erased (Module 28),
// rating and tenant stay. Used for withdrawn, invalid, no-consent AND deleted.
export const WITHDRAWN_FIELDS = Object.freeze({
  status: 'withdrawn', body: '', author_name: '', author_role: null, consent_publish: false,
})

// Upsert decision table (contract §4). `existing` = bodega row or null.
// Returns { action: 'skip'|'insert'|'update', status?, notify, reason }.
// `notify` = a reviewer has something NEW to look at.
export function decideUpsert(existing, incoming) {
  if (!incoming.external_id) return { action: 'skip', notify: false, reason: 'sin id' }
  if (!incoming.publishable) return decideGone(existing, 'retirado o no publicable')

  if (!existing) return { action: 'insert', status: 'pending', notify: true, reason: 'nuevo' }
  if (existing.status === 'withdrawn') return { action: 'update', status: 'pending', notify: true, reason: 'reenviado tras retirar' }
  if (!contentChanged(existing, incoming)) return { action: 'skip', notify: false, reason: 'sin cambios' }
  if (existing.status === 'approved' || existing.status === 'rejected') {
    return { action: 'update', status: 'pending', notify: true, reason: 'contenido cambiado' }
  }
  return { action: 'update', status: 'pending', notify: false, reason: 'pendiente actualizado' }
}

// Withdrawn / invalid / deleted-in-the-app: erase if there is a live row.
export function decideGone(existing, reason = 'ya no existe en la app') {
  if (!existing) return { action: 'skip', notify: false, reason: 'sin fila' }
  if (existing.status === 'withdrawn') return { action: 'skip', notify: false, reason: 'ya retirado' }
  return { action: 'update', status: 'withdrawn', erase: true, notify: false, reason }
}

// Stored rows that a SUCCESSFUL full list no longer contains → deleted in the app.
export function missingFromList(stored, records) {
  const present = new Set((records ?? []).map((r) => String(r?.id)))
  return stored.filter((s) => ['pending', 'approved', 'rejected'].includes(s.status) && !present.has(String(s.external_id)))
}

// Alert throttle: at most one per testimonial per hour.
export const NOTIFY_WINDOW_MS = 60 * 60 * 1000
export function notifyCutoff(now = Date.now()) {
  return new Date(now - NOTIFY_WINDOW_MS).toISOString()
}
export function canNotify(notifiedAt, now = Date.now()) {
  const t = notifiedAt ? Date.parse(notifiedAt) : NaN
  return Number.isNaN(t) || now - t >= NOTIFY_WINDOW_MS
}

// ── Review (contract §5) ─────────────────────────────────────────────────────
const TRANSITIONS = {
  approve: { from: ['pending', 'rejected'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  unpublish: { from: ['approved'], to: 'rejected' },
}
export function reviewTransition(current, op) {
  const t = TRANSITIONS[op]
  if (!t) return { error: `op desconocida: ${op}` }
  if (current === 'withdrawn') return { error: 'el usuario lo retiró; no se puede revisar' }
  if (!t.from.includes(current)) return { error: `no se puede ${op} un testimonio ${current}` }
  return { status: t.to }
}

// Row as stored + what the reviewer saw → { status } or { code, error }.
// A stale `updatedAt` is a 409: nobody approves text they did not read.
export function reviewDecision(row, { op, updatedAt }) {
  if (!row) return { code: 404, error: 'testimonio no encontrado' }
  const seen = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN
  if (Number.isNaN(seen)) return { code: 400, error: 'falta updatedAt' }
  if (seen !== Date.parse(row.updated_at)) return { code: 409, error: 'el testimonio cambió mientras lo revisabas; recarga' }
  const t = reviewTransition(row.status, op)
  if (t.error) return { code: 409, error: t.error }
  return { status: t.status }
}

// ── Public (contract §6) ─────────────────────────────────────────────────────
// "YYYY-MM" in America/Mexico_City (a calendar month in UTC would label a
// Nov 1st 00:30 Mexico approval as October, or the reverse).
export function mexicoMonth(iso) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).formatToParts(new Date(t))
  const get = (type) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}`
}

// Public allowlist. Whatever else the row holds — tenant id and name, ids,
// e-mails, reviewer — has no path into this object.
export function publicItem(row) {
  return {
    app: siteSlug(row.app_id),
    rating: row.rating,
    body: row.body,
    author_name: row.author_name,
    author_role: row.author_role ?? null,
    month: mexicoMonth(row.reviewed_at ?? row.submitted_at),
  }
}

// rows: approved + consented, any order. Items newest first (cap 100); summary
// counts ALL of them, per site slug.
export function buildPublicPayload(rows, { app = null, cap = 100 } = {}) {
  const wanted = app ? appIdForSlug(app) : null
  const when = (r) => Date.parse(r.reviewed_at ?? '') || 0
  const ok = rows
    .filter((r) => r.status === 'approved' && r.consent_publish === true && (!wanted || r.app_id === wanted))
    .sort((a, b) => when(b) - when(a))
  const sums = {}
  for (const r of ok) {
    const s = (sums[siteSlug(r.app_id)] ??= { count: 0, total: 0 })
    s.count += 1
    s.total += r.rating
  }
  const summary = Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, { count: s.count, average: Math.round((s.total / s.count) * 10) / 10 }]))
  return { ok: true, items: ok.slice(0, cap).map(publicItem), summary }
}
