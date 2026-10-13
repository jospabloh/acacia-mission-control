// Pure rules for the testimonials feature (contract v1.7, Module 29 of
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
// Strict ISO-8601: a date, or a date-time that carries Z/offset. Date.parse alone
// would roll 2026-02-30 over to March 2nd, so the calendar parts are round-tripped.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/
const validDate = (v) => {
  if (typeof v !== 'string') return null
  const m = ISO_RE.exec(v.trim())
  if (!m) return null
  const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1, 7).map((x) => (x === undefined ? 0 : Number(x)))
  if (h > 23 || mi > 59 || sec > 59) return null
  const cal = new Date(Date.UTC(y, mo - 1, d))
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return null
  const t = Date.parse(v.trim())
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// App record (entity `Testimonial`) → bodega fields + `publishable`. Anything
// that is not clearly a valid, consented, submitted testimonial is NOT
// publishable; that includes unknown `status` values. Dates are normalised to
// ISO or null, so nothing unparseable can reach Postgres.
export function normalizeRecord(record) {
  const r = record ?? {}
  const body = typeof r.body === 'string' ? r.body.trim() : ''
  const authorName = typeof r.author_name === 'string' ? r.author_name.trim() : ''
  const roleOk = r.author_role == null || typeof r.author_role === 'string'
  const authorRole = typeof r.author_role === 'string' ? r.author_role.trim() : ''
  const consentAt = validDate(r.consent_at)
  // The source's own last-write time (Base44 `updated_date`), the version every upsert compares.
  const sourceUpdatedAt = validDate(r.updated_date)
  const idOk = (typeof r.id === 'string' || typeof r.id === 'number') && String(r.id).trim() !== ''
  const tenantId = typeof r.tenant_id === 'string' || typeof r.tenant_id === 'number' ? String(r.tenant_id).trim() : ''
  const publishable =
    idOk && r.status === 'submitted' && r.consent_publish === true && consentAt !== null && sourceUpdatedAt !== null &&
    typeof r.rating === 'number' && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 &&
    len(body) >= 20 && len(body) <= 600 &&
    len(authorName) >= 1 && len(authorName) <= 80 &&
    roleOk && len(authorRole) <= 80
  return {
    external_id: idOk ? String(r.id).trim() : '',
    tenant_external_id: tenantId || null,
    rating: publishable ? r.rating : null,
    body: publishable ? body : '',
    author_name: publishable ? authorName : '',
    author_role: publishable ? (authorRole || null) : null,
    consent_publish: publishable,
    consent_at: consentAt,
    source_updated_at: sourceUpdatedAt,
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
// The write for a withdrawal: the erase, plus `observed_at` (when the observation
// that caused it started) and the source version if the record carried one (a
// record deleted in the app has none, and the stored version stays).
export const withdrawnPatch = (sourceUpdatedAt = null, observedAt = null) =>
  ({ ...WITHDRAWN_FIELDS, ...(sourceUpdatedAt ? { source_updated_at: sourceUpdatedAt } : {}), ...(observedAt ? { observed_at: observedAt } : {}) })

// Ordering. PRIMARY rule: every row records `observed_at`, the MC-local instant
// at which the bridge call that produced the observation STARTED (list call for
// the sync, get call for a ping), and an observation is applied only if its
// observed_at is strictly later than the row's. Both sides are MC's clock, so
// nothing compares the app's clock with ours. SECONDARY guard: the app's own
// `updated_date`, stored as `source_updated_at`, rejects only a record that is
// provably not newer than what MC last stored (two calls can overlap, so a
// later-starting call may still have read older data). Neither ever rejects a
// record newer on both counts.
const ms = (v) => { const t = Date.parse(v ?? ''); return Number.isNaN(t) ? null : t }
const staleObservation = (existing, observedAt) => {
  const have = ms(existing?.observed_at)
  const at = ms(observedAt)
  return have !== null && at !== null && at <= have
}

// Upsert decision table (contract §4). `existing` = bodega row or null.
// Returns { action: 'skip'|'insert'|'update', status?, notify, reason }.
// `notify` = a reviewer has something NEW to look at.
export function decideUpsert(existing, incoming, observedAt = null) {
  if (!incoming.external_id) return { action: 'skip', notify: false, reason: 'sin id' }
  if (staleObservation(existing, observedAt)) return { action: 'skip', notify: false, reason: 'observación anterior a la guardada' }
  const have = ms(existing?.source_updated_at)
  const seen = ms(incoming.source_updated_at)

  if (!incoming.publishable) {
    // A withdrawn record with no readable version still erases: removing
    // personal data is the safe side.
    if (have !== null && seen !== null && seen < have) return { action: 'skip', notify: false, reason: 'versión anterior a la guardada' }
    return { ...decideGone(existing, 'retirado o no publicable', { observedAt }), sourceUpdatedAt: incoming.source_updated_at }
  }

  if (!existing) return { action: 'insert', status: 'pending', notify: true, reason: 'nuevo' }
  // A successful observation that changes nothing still ADVANCES observed_at
  // (`touch`): otherwise an earlier-started record:null / absence that completes
  // afterwards would still see the old marker and erase a row we just saw alive.
  // When the record's version is NEWER but nothing the reviewer sees changed (only
  // metadata), the touch also carries that version and metadata (`refresh`), so a
  // later-starting read of an intermediate version cannot pass the version guard.
  const touch = (reason) => (observedAt
    ? { action: 'update', status: existing.status, touch: true, refresh: seen !== null && (have === null || seen > have), notify: false, reason }
    : { action: 'skip', notify: false, reason })
  if (existing.status === 'withdrawn') {
    // Secondary guard: only a provably OLDER version is a stale read. An EQUAL
    // version after an MC-side erase (record:null / absence keep the version) is
    // a newer observation showing the record still exists, so it is restored.
    if (have !== null && seen < have) return touch('versión anterior a la guardada')
    return { action: 'update', status: 'pending', notify: true, reason: 'reenviado tras retirar' }
  }
  if (have !== null && seen <= have) return touch('versión anterior o igual a la guardada')
  if (!contentChanged(existing, incoming)) return touch('sin cambios')
  if (existing.status === 'approved' || existing.status === 'rejected') {
    return { action: 'update', status: 'pending', notify: true, reason: 'contenido cambiado' }
  }
  return { action: 'update', status: 'pending', notify: false, reason: 'pendiente actualizado' }
}

// Withdrawn / invalid / deleted-in-the-app: erase if there is a live row. A row
// that is already withdrawn is only "touched" (`touch: true`: observed_at moves
// forward, nothing else changes), so a delayed older snapshot cannot restore it.
export function decideGone(existing, reason = 'ya no existe en la app', { observedAt = null } = {}) {
  if (!existing) return { action: 'skip', notify: false, reason: 'sin fila' }
  if (staleObservation(existing, observedAt)) return { action: 'skip', notify: false, reason: 'observación anterior a la guardada' }
  if (existing.status === 'withdrawn') {
    return observedAt ? { action: 'update', status: 'withdrawn', erase: true, touch: true, notify: false, reason: 'ya retirado' }
      : { action: 'skip', notify: false, reason: 'ya retirado' }
  }
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
  if (typeof updatedAt !== 'string' || !updatedAt) return { code: 400, error: 'falta updatedAt' }
  // RAW string equality, never parsed milliseconds: Postgres keeps microseconds
  // and Date.parse drops them, so two distinct versions could compare equal.
  // `updatedAt` is the string the page read from the same API as `row.updated_at`.
  if (updatedAt !== row.updated_at) return { code: 409, error: 'el testimonio cambió mientras lo revisabas; recarga' }
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
    .sort((a, b) => when(b) - when(a) || String(b.id ?? '').localeCompare(String(a.id ?? '')))
  const sums = {}
  for (const r of ok) {
    const s = (sums[siteSlug(r.app_id)] ??= { count: 0, total: 0 })
    s.count += 1
    s.total += r.rating
  }
  const summary = Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, { count: s.count, average: Math.round((s.total / s.count) * 10) / 10 }]))
  return { ok: true, items: ok.slice(0, cap).map(publicItem), summary }
}

// Reads EVERY row through a capped API (PostgREST returns at most 1000 per
// request): fetchPage(from, to) → rows, in a stable order. Stops on a short page.
export async function fetchAllPages(fetchPage, pageSize = 1000, maxPages = 50) {
  const all = []
  for (let i = 0; i < maxPages; i++) {
    const rows = await fetchPage(i * pageSize, (i + 1) * pageSize - 1)
    all.push(...rows)
    if (rows.length < pageSize) return all
  }
  throw new Error('testimonials: demasiadas páginas')
}
