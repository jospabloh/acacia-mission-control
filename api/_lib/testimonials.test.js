import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  siteSlug, appIdForSlug, isUnknownAction, normalizeRecord, decideUpsert, decideGone, missingFromList,
  canNotify, notifyCutoff, reviewTransition, reviewDecision, mexicoMonth, publicItem, buildPublicPayload,
  WITHDRAWN_FIELDS, withdrawnPatch, fetchAllPages,
} from './testimonials.js'
import { syncTestimonialsForApp } from './sync/syncTestimonials.js'
import { runPing } from './ingest/testimonial-pull.js'

const rec = (o = {}) => ({
  id: 'tm123456', tenant_id: 't9', rating: 5, body: 'Excelente herramienta para mi negocio.',
  author_name: 'Ana', author_role: 'Dueña', consent_publish: true, consent_at: '2026-10-01T10:00:00Z', updated_date: '2026-10-01T10:00:00Z',
  status: 'submitted', ...o,
})
const inc = (o) => normalizeRecord(rec(o), 'Café Ana')
const stored = (status, o = {}) => ({ id: 'u1', status, ...inc(), ...o })

// ── normalizeRecord: fail-closed ────────────────────────────────────────────
test('normalizeRecord: valid record is publishable and trimmed', () => {
  const n = normalizeRecord(rec({ body: '  Excelente herramienta para mi negocio.  ' }), 'Café Ana')
  assert.equal(n.publishable, true)
  assert.equal(n.external_id, 'tm123456')
  assert.equal(n.tenant_external_id, 't9')
  assert.equal(n.tenant_name, 'Café Ana')
  assert.equal(n.body, 'Excelente herramienta para mi negocio.')
  assert.equal(n.consent_at, '2026-10-01T10:00:00.000Z')
})
test('normalizeRecord: tenant id only from tenant_id (no business_id fallback)', () => {
  assert.equal(normalizeRecord(rec({ tenant_id: undefined, business_id: 'b1' })).tenant_external_id, null)
})
test('normalizeRecord: every fail-closed rule', () => {
  const bad = [
    { rating: true }, { rating: '5' }, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: null },
    { status: 'published' }, { status: 'approved' }, { status: undefined }, { status: 'withdrawn' },
    { consent_publish: 'true' }, { consent_publish: 1 }, { consent_publish: false }, { consent_publish: undefined },
    { consent_at: undefined }, { consent_at: 'ayer' }, { consent_at: '2026-13-45' }, { consent_at: 12345 },
    { body: 'corto' }, { body: ' '.repeat(30) }, { body: 'x'.repeat(601) }, { body: 123 },
    { author_name: '' }, { author_name: '  ' }, { author_name: 'x'.repeat(81) }, { author_name: 5 },
    { author_role: 'x'.repeat(81) }, { author_role: 7 },
    { id: '' }, { id: null },
  ]
  for (const o of bad) assert.equal(normalizeRecord(rec(o)).publishable, false, JSON.stringify(o))
  // boundaries that ARE valid
  for (const o of [{ body: 'x'.repeat(20) }, { body: 'x'.repeat(600) }, { author_name: 'x'.repeat(80) }, { author_role: null }, { author_role: '' }, { author_role: 'x'.repeat(80) }, { rating: 1 }]) {
    assert.equal(normalizeRecord(rec(o)).publishable, true, JSON.stringify(o))
  }
})
test('normalizeRecord: an unparseable date never survives (null), so it cannot reach Postgres', () => {
  const n = normalizeRecord(rec({ consent_at: 'no es fecha' }))
  assert.equal(n.consent_at, null)
  assert.equal(n.submitted_at, null)
  assert.equal(n.publishable, false)
})
test('normalizeRecord: a non-publishable record carries no personal text', () => {
  const n = normalizeRecord(rec({ status: 'withdrawn' }))
  assert.deepEqual([n.body, n.author_name, n.author_role, n.consent_publish], ['', '', null, false])
})

// ── upsert decision table ───────────────────────────────────────────────────
test('upsert: publishable without row → insert pending + notify', () => {
  assert.deepEqual(decideUpsert(null, inc()), { action: 'insert', status: 'pending', notify: true, reason: 'nuevo' })
})
test('upsert: not publishable without row → nothing stored', () => {
  for (const o of [{ consent_publish: false }, { rating: true }, { status: 'weird' }, { consent_at: 'x' }, { status: 'withdrawn' }]) {
    assert.equal(decideUpsert(null, inc(o)).action, 'skip', JSON.stringify(o))
  }
  assert.equal(decideUpsert(null, inc({ id: '' })).action, 'skip')
})
test('upsert: approved unchanged → skip; changed (any content field) → pending + notify', () => {
  assert.equal(decideUpsert(stored('approved'), inc()).action, 'skip')
  for (const o of [{ body: 'Otro texto distinto y largo.' }, { rating: 4 }, { author_name: 'Ana B' }, { author_role: null }]) {
    const d = decideUpsert(stored('approved'), inc({ ...o, updated_date: '2026-10-09T00:00:00Z' }))
    assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true], JSON.stringify(o))
  }
})
test('upsert: rejected unchanged stays; rejected + changed → pending + notify', () => {
  assert.equal(decideUpsert(stored('rejected'), inc()).action, 'skip')
  const d = decideUpsert(stored('rejected'), inc({ updated_date: '2026-10-09T00:00:00Z', rating: 3 }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
test('upsert: pending + changed stays pending without notice; unchanged → skip', () => {
  const d = decideUpsert(stored('pending'), inc({ updated_date: '2026-10-09T00:00:00Z', rating: 3 }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', false])
  assert.equal(decideUpsert(stored('pending'), inc()).action, 'skip')
})
test('upsert: withdrawn + valid resubmission → pending + notify (content restored by the update)', () => {
  const d = decideUpsert(stored('withdrawn', { body: '', author_name: '', consent_publish: false }), inc({ updated_date: '2026-10-09T00:00:00Z', }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
const V1 = '2026-10-01T10:00:00Z', V2 = '2026-10-02T09:00:00Z', V3 = '2026-10-03T08:00:00Z'
const erased = { body: '', author_name: '', consent_publish: false }
test('upsert: stale submitted snapshot (older version) after a newer ping → skip', () => {
  const row = stored('pending', { source_updated_at: V2, rating: 3 })
  const d = decideUpsert(row, inc({ updated_date: V1, rating: 5 }))
  assert.deepEqual([d.action, d.notify], ['skip', false])
  assert.equal(decideUpsert(row, inc({ updated_date: V2, rating: 5 })).action, 'skip') // equal is not newer
  assert.equal(decideUpsert(stored('approved', { source_updated_at: V2 }), inc({ updated_date: V1, rating: 1 })).action, 'skip')
})
test('upsert: newer version with changed content updates as before', () => {
  const d = decideUpsert(stored('approved', { source_updated_at: V1 }), inc({ updated_date: V2, rating: 3 }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
test('upsert: stale WITHDRAWN snapshot after a newer resubmission → skip (no erase)', () => {
  for (const status of ['pending', 'approved']) {
    const row = stored(status, { source_updated_at: V3 })
    assert.equal(decideUpsert(row, inc({ status: 'withdrawn', updated_date: V2, body: '', author_name: '' })).action, 'skip', status)
  }
  // a newer (or unversioned) withdrawal still erases, carrying its version
  const d = decideUpsert(stored('approved', { source_updated_at: V1 }), inc({ status: 'withdrawn', updated_date: V2, body: '' }))
  assert.deepEqual([d.action, d.erase, d.sourceUpdatedAt], ['update', true, '2026-10-02T09:00:00.000Z'])
  assert.equal(decideUpsert(stored('approved', { source_updated_at: V1 }), inc({ status: 'withdrawn', updated_date: undefined, body: '' })).erase, true)
})
test('upsert: stale pre-withdrawal record after withdrawal → skip, row stays erased', () => {
  const w = stored('withdrawn', { ...erased, source_updated_at: V2 })
  assert.equal(decideUpsert(w, inc({ updated_date: V1 })).action, 'skip')
  // equal version: only an MC-side erase (record:null/absence) keeps the version, so it is a newer sighting, not a stale read
  assert.equal(decideUpsert(w, inc({ updated_date: V2 })).action, 'update')
})
test('upsert: genuinely new submission after the withdrawal → pending with the new content', () => {
  const w = stored('withdrawn', { ...erased, source_updated_at: V2 })
  const d = decideUpsert(w, inc({ updated_date: V3, consent_at: V3 }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
test('submitted record without a valid updated_date fails closed', () => {
  for (const v of [undefined, null, '', 'ayer', '2026-02-30T10:00:00Z', 5]) assert.equal(normalizeRecord(rec({ updated_date: v })).publishable, false, String(v))
  assert.equal(normalizeRecord(rec()).source_updated_at, '2026-10-01T10:00:00.000Z')
})
test('withdrawnPatch = erase fields (+ source version when known)', () => {
  assert.deepEqual(withdrawnPatch(), { ...WITHDRAWN_FIELDS })
  assert.deepEqual(withdrawnPatch(V2), { ...WITHDRAWN_FIELDS, source_updated_at: V2 })
})
const T1 = '2026-10-05T10:00:00Z', T2 = '2026-10-05T10:05:00Z', T3 = '2026-10-05T10:10:00Z'
test('observed_at: an observation not strictly later than the stored one is skipped (upsert, gone, withdrawn record)', () => {
  const row = stored('approved', { observed_at: T2 })
  for (const t of [T1, T2]) {
    assert.equal(decideUpsert(row, inc({ updated_date: V3, rating: 2 }), t).reason, 'observación anterior a la guardada')
    assert.equal(decideGone(row, undefined, { observedAt: t }).action, 'skip')
    assert.equal(decideUpsert(row, inc({ status: 'withdrawn', updated_date: V3 }), t).action, 'skip')
  }
  const d = decideUpsert(row, inc({ updated_date: V3, rating: 2 }), T3)
  assert.deepEqual([d.action, d.status], ['update', 'pending'])
  assert.equal(decideGone(row, undefined, { observedAt: T3 }).erase, true)
})
test('MC1: after a record:null erase, a delayed older snapshot with a NEWER updated_date cannot restore the text', () => {
  // erase at T2 kept source_updated_at V1 and stamped observed_at T2
  const erasedRow = stored('withdrawn', { ...erased, source_updated_at: V1, observed_at: T2 })
  assert.equal(decideUpsert(erasedRow, inc({ updated_date: V3 }), T1).action, 'skip')
  // a genuinely newer observation of a newer resubmission is NOT blocked by the old version
  const d = decideUpsert(erasedRow, inc({ updated_date: V3 }), T3)
  assert.deepEqual([d.action, d.status], ['update', 'pending'])
})
test('an already-withdrawn row is only touched by a newer observation (observed_at moves, nothing else)', () => {
  const w = stored('withdrawn', { ...erased, observed_at: T1 })
  const d = decideGone(w, undefined, { observedAt: T2 })
  assert.deepEqual([d.action, d.touch, d.erase], ['update', true, true])
  assert.equal(decideGone(w).action, 'skip')
  assert.equal(decideGone(w, undefined, { observedAt: T1 }).action, 'skip')
})
test('withdrawnPatch stamps observed_at', () => {
  assert.deepEqual(withdrawnPatch(null, T2), { ...WITHDRAWN_FIELDS, observed_at: T2 })
})
test('alert e-mail is non-personal: no name, role, text or business name', async () => {
  const { renderTestimonialAlert } = await import('./testimonialAlert.js')
  const a = renderTestimonialAlert({ appName: 'Rumbo', tenantName: 'Café Ana', rating: 5, body: 'TEXTO-SECRETO', authorName: 'NOMBRE-SECRETO', authorRole: 'ROL-SECRETO', link: 'https://x.mx/testimonials' })
  for (const t of ['TEXTO-SECRETO', 'NOMBRE-SECRETO', 'ROL-SECRETO']) assert.ok(!a.html.includes(t) && !a.subject.includes(t), t)
  assert.ok(!a.html.includes('Café Ana') && !a.subject.includes('Café Ana'), 'no business name either')
})
test('fetchAllPages reads past the 1000-row cap and stops on a short page', async () => {
  const calls = []
  const rows = Array.from({ length: 2300 }, (_, i) => ({ id: i }))
  const all = await fetchAllPages(async (from, to) => { calls.push([from, to]); return rows.slice(from, to + 1) })
  assert.equal(all.length, 2300)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
  assert.equal((await fetchAllPages(async () => [])).length, 0)
})
test('public payload: equal reviewed_at falls back to a deterministic id order', () => {
  const t = '2026-10-05T00:00:00Z'
  const a = buildPublicPayload([row({ id: 'a', body: 'A', reviewed_at: t }), row({ id: 'b', body: 'B', reviewed_at: t })])
  const b = buildPublicPayload([row({ id: 'b', body: 'B', reviewed_at: t }), row({ id: 'a', body: 'A', reviewed_at: t })])
  assert.deepEqual(a.items.map((x) => x.body), ['B', 'A'])
  assert.deepEqual(b.items, a.items)
})
test('upsert: a withdrawn record with EMPTY body/name/role is accepted as a withdrawal (erases a live row, skips a withdrawn one)', () => {
  const o = { status: 'withdrawn', body: '', author_name: '', author_role: '', consent_publish: false }
  const n = inc(o)
  assert.equal(n.publishable, false)
  assert.deepEqual([n.body, n.author_name, n.author_role], ['', '', null])
  for (const status of ['pending', 'approved', 'rejected']) {
    const d = decideUpsert(stored(status), n)
    assert.deepEqual([d.action, d.status, d.erase], ['update', 'withdrawn', true], status)
  }
  assert.equal(decideUpsert(stored('withdrawn'), n).action, 'skip')
  assert.equal(decideUpsert(null, n).action, 'skip')
})
test('normalizeRecord: consent_at is strict ISO-8601 with real calendar dates', () => {
  for (const v of ['2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', '2026-02-30', '2026-04-31T00:00:00Z', 'garbage', '2026-10-01T10:00:00', '2026-10-01T25:00:00Z', '1 Oct 2026', '']) {
    assert.equal(normalizeRecord(rec({ consent_at: v })).publishable, false, v)
  }
  for (const v of ['2026-10-01T10:00:00Z', '2026-10-01T10:00:00.123Z', '2026-10-01T04:00:00-06:00', '2026-10-01', '2028-02-29T00:00:00Z']) {
    assert.equal(normalizeRecord(rec({ consent_at: v })).publishable, true, v)
  }
  assert.equal(normalizeRecord(rec({ consent_at: '2026-10-01T04:00:00-06:00' })).consent_at, '2026-10-01T10:00:00.000Z')
})
test('upsert: not publishable with a live row → withdrawn AND erase; with withdrawn row → skip', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    for (const o of [{ status: 'withdrawn' }, { consent_publish: false }, { rating: true }, { status: 'otro' }]) {
      const d = decideUpsert(stored(status), inc(o))
      assert.deepEqual([d.action, d.status, d.erase], ['update', 'withdrawn', true], `${status} ${JSON.stringify(o)}`)
    }
  }
  assert.equal(decideUpsert(stored('withdrawn'), inc({ status: 'withdrawn' })).action, 'skip')
})
test('erase fields wipe the personal text and consent, nothing else', () => {
  assert.deepEqual({ ...WITHDRAWN_FIELDS }, { status: 'withdrawn', body: '', author_name: '', author_role: null, tenant_name: null, consent_publish: false })
  assert.ok(Object.isFrozen(WITHDRAWN_FIELDS))
})

// ── deleted in the app ──────────────────────────────────────────────────────
test('decideGone (record:null / absent from list): erase a live row, ignore the rest', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    const d = decideGone({ id: 'u', status })
    assert.deepEqual([d.action, d.status, d.erase], ['update', 'withdrawn', true])
  }
  assert.equal(decideGone({ id: 'u', status: 'withdrawn' }).action, 'skip')
  assert.equal(decideGone(null).action, 'skip')
})
test('missingFromList: only live rows absent from the list', () => {
  const rows = [
    { external_id: 'a', status: 'approved' }, { external_id: 'b', status: 'pending' }, { external_id: 'c', status: 'rejected' },
    { external_id: 'd', status: 'withdrawn' }, { external_id: 'e', status: 'approved' },
  ]
  assert.deepEqual(missingFromList(rows, [{ id: 'a' }, { id: 'e' }]).map((r) => r.external_id), ['b', 'c'])
  assert.deepEqual(missingFromList(rows, []).map((r) => r.external_id), ['a', 'b', 'c', 'e'])
})

// ── throttle ────────────────────────────────────────────────────────────────
test('notification throttle: one per hour per testimonial', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  assert.equal(canNotify(null, now), true)
  assert.equal(canNotify('basura', now), true)
  assert.equal(canNotify('2026-10-07T11:30:00Z', now), false)
  assert.equal(canNotify('2026-10-07T11:00:00Z', now), true)
  assert.equal(notifyCutoff(now), '2026-10-07T11:00:00.000Z')
})

// ── review ──────────────────────────────────────────────────────────────────
test('review transitions', () => {
  assert.equal(reviewTransition('pending', 'approve').status, 'approved')
  assert.equal(reviewTransition('rejected', 'approve').status, 'approved')
  assert.equal(reviewTransition('pending', 'reject').status, 'rejected')
  assert.equal(reviewTransition('approved', 'unpublish').status, 'rejected')
  assert.ok(reviewTransition('approved', 'approve').error)
  assert.ok(reviewTransition('approved', 'reject').error)
  assert.ok(reviewTransition('pending', 'unpublish').error)
  assert.ok(reviewTransition('pending', 'delete').error)
  for (const op of ['approve', 'reject', 'unpublish']) assert.ok(reviewTransition('withdrawn', op).error)
})
test('review race: stale updated_at → 409, identical raw string → decision, missing → 400, no row → 404', () => {
  const row = { status: 'pending', updated_at: '2026-10-07T10:00:00.123456+00:00' }
  assert.deepEqual(reviewDecision(row, { op: 'approve', updatedAt: '2026-10-07T10:00:00.123456+00:00' }), { status: 'approved' })
  assert.equal(reviewDecision(row, { op: 'approve', updatedAt: '2026-10-07T09:59:00Z' }).code, 409)
  // two distinct microsecond versions that parse to the same millisecond are NOT the same version
  assert.equal(reviewDecision(row, { op: 'approve', updatedAt: '2026-10-07T10:00:00.123999+00:00' }).code, 409)
  assert.equal(reviewDecision(row, { op: 'approve' }).code, 400)
  assert.equal(reviewDecision(row, { op: 'approve', updatedAt: '' }).code, 400)
  assert.equal(reviewDecision(null, { op: 'approve', updatedAt: 'x' }).code, 404)
})
test('MC1 (round 6): a newer version with only metadata changed touches AND refreshes the version', () => {
  const live = stored('approved', { source_updated_at: V1, observed_at: T1 })
  const d = decideUpsert(live, inc({ updated_date: V2, consent_at: V2 }), T2)
  assert.deepEqual([d.action, d.touch, d.refresh], ['update', true, true])
  // an equal/older version, or a withdrawn-row stale touch, does not refresh
  assert.equal(decideUpsert(live, inc({ updated_date: V1 }), T2).refresh, false)
  assert.equal(decideUpsert(stored('withdrawn', { ...erased, source_updated_at: V2 }), inc({ updated_date: V1 }), T2).refresh, false)
})

// ── slugs, month, public payload ────────────────────────────────────────────
test('slug mapping: puntos ↔ puntos-plus, the rest identity', () => {
  assert.equal(siteSlug('puntos'), 'puntos-plus')
  assert.equal(appIdForSlug('puntos-plus'), 'puntos')
  for (const id of ['rumbo', 'liuma', 'flowfin', 'stockflow', 'radar', 'cateqhub', 'ctrlhq', 'kitchops', 'artiskids', 'sommel']) {
    assert.equal(siteSlug(id), id)
    assert.equal(appIdForSlug(id), id)
  }
})
test('month is computed in America/Mexico_City, at a month boundary', () => {
  assert.equal(mexicoMonth('2026-11-01T05:59:59Z'), '2026-10') // 23:59 Oct 31 in Mexico
  assert.equal(mexicoMonth('2026-11-01T06:00:00Z'), '2026-11') // 00:00 Nov 1 in Mexico
  assert.equal(mexicoMonth('2026-01-01T03:00:00Z'), '2025-12')
  assert.equal(mexicoMonth('nope'), null)
})

const row = (o = {}) => ({
  app_id: 'rumbo', rating: 5, body: 'Muy bueno', author_name: 'Ana', author_role: 'Dueña',
  status: 'approved', consent_publish: true, reviewed_at: '2026-10-05T12:00:00Z', submitted_at: '2026-10-01T00:00:00Z', ...o,
})
test('public payload: only approved+consented, newest first, month from approval', () => {
  const p = buildPublicPayload([
    row({ reviewed_at: '2026-09-01T00:00:00Z', body: 'viejo' }),
    row({ status: 'pending', body: 'pendiente' }), row({ status: 'rejected', body: 'rechazado' }),
    row({ status: 'withdrawn', body: 'retirado' }), row({ consent_publish: false, body: 'sin consentimiento' }),
    row({ body: 'nuevo' }),
  ])
  assert.deepEqual(p.items.map((i) => i.body), ['nuevo', 'viejo'])
  assert.equal(p.items[0].month, '2026-10')
})
test('public payload: cap 100 items, summary counts all', () => {
  const rows = Array.from({ length: 130 }, (_, i) => row({ reviewed_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }))
  const p = buildPublicPayload(rows)
  assert.equal(p.items.length, 100)
  assert.equal(p.summary.rumbo.count, 130)
})
test('summary maths per site slug, 1 decimal', () => {
  const p = buildPublicPayload([
    row({ app_id: 'puntos', rating: 5 }), row({ app_id: 'puntos', rating: 4 }), row({ app_id: 'puntos', rating: 4 }),
    row({ app_id: 'rumbo', rating: 3 }),
  ])
  assert.deepEqual(p.summary, { 'puntos-plus': { count: 3, average: 4.3 }, rumbo: { count: 1, average: 3 } })
})
test('?app= filters by SITE slug', () => {
  const rows = [row({ app_id: 'puntos' }), row({ app_id: 'rumbo' })]
  const p = buildPublicPayload(rows, { app: 'puntos-plus' })
  assert.deepEqual(p.items.map((i) => i.app), ['puntos-plus'])
  assert.deepEqual(buildPublicPayload(rows, { app: 'nope' }).items, [])
})
test('public allowlist: nothing but the contract fields can leak', () => {
  const leaky = row({
    id: 'u1', external_id: 'x', tenant_external_id: 'T-SECRET', tenant_name: 'Negocio Secreto', created_by: 'ana@x.mx',
    email: 'ana@x.mx', user_id: 'U-1', reviewed_by: 'jp@acacia.mx', consent_at: '2026-10-01',
  })
  const p = buildPublicPayload([leaky])
  const keys = ['app', 'author_name', 'author_role', 'body', 'month', 'rating']
  assert.deepEqual(Object.keys(p.items[0]).sort(), keys)
  assert.deepEqual(Object.keys(publicItem(leaky)).sort(), keys)
  const json = JSON.stringify(p)
  for (const s of ['T-SECRET', 'Negocio Secreto', 'ana@x.mx', 'U-1', 'jp@acacia.mx']) assert.ok(!json.includes(s), s)
  assert.deepEqual(Object.keys(p).sort(), ['items', 'ok', 'summary'])
})

// ── bridge: unknown action + sync ───────────────────────────────────────────
test('isUnknownAction: the exact bridge message, and not other errors', () => {
  assert.ok(isUnknownAction(new Error('unknown action: testimonials.list')))
  assert.ok(isUnknownAction({ message: 'unknown action: testimonials.get' }))
  assert.ok(!isUnknownAction(new Error('bad signature')))
  assert.ok(!isUnknownAction(new Error('network down')))
})

const app = { id: 'rumbo' }
const noop = { process: async () => ({ stored: false }), processMissing: async () => ({ stored: false }), listStored: async () => [] }

test('sync: "unknown action: testimonials.list" → silent skip, nothing processed, no error key', async () => {
  let touched = 0
  const r = await syncTestimonialsForApp(app, {
    call: async () => { throw new Error('unknown action: testimonials.list') },
    process: async () => { touched++ }, processMissing: async () => { touched++ }, listStored: async () => { touched++; return [] },
  })
  assert.deepEqual(r, { app: 'rumbo', skipped: 'sin módulo de testimonios' })
  assert.equal(touched, 0)
})
test('sync: any other bridge failure is an ERROR for the section, not a skip, and does not throw', async () => {
  const r = await syncTestimonialsForApp(app, { ...noop, call: async () => { throw new Error('bad signature') } })
  assert.equal(r.skipped, undefined)
  assert.match(r.error, /bad signature/)
})
test('sync: malformed answers (no ok / no records array) are errors and delete nothing', async () => {
  let withdrawn = 0
  const deps = { ...noop, processMissing: async () => { withdrawn++ }, listStored: async () => [{ external_id: 'a', status: 'approved' }] }
  for (const out of [{}, { ok: true }, { ok: true, records: 'x' }, { ok: false, records: [] }, null]) {
    const r = await syncTestimonialsForApp(app, { ...deps, call: async () => out })
    assert.ok(r.error, JSON.stringify(out))
  }
  assert.equal(withdrawn, 0)
})
test('sync feeds every record to the shared upsert and withdraws rows missing from the list', async () => {
  const seen = []
  const gone = []
  const r = await syncTestimonialsForApp(app, {
    call: async () => ({ ok: true, records: [{ id: 'a', tenant_name: 'N1' }, { id: 'b' }] }),
    process: async ({ record, tenantName }) => { seen.push([record.id, tenantName]); return { stored: record.id === 'a' } },
    listStored: async () => [{ external_id: 'a', status: 'approved' }, { external_id: 'z', status: 'pending' }, { external_id: 'w', status: 'withdrawn' }],
    processMissing: async ({ externalId }) => { gone.push(externalId); return { stored: true } },
  })
  assert.deepEqual(seen, [['a', 'N1'], ['b', null]])
  assert.deepEqual(gone, ['z'])
  assert.deepEqual(r, { app: 'rumbo', testimonials: 2, stored: 2 })
})
test('sync: a failure on one record is reported but the rest still run', async () => {
  const seen = []
  const r = await syncTestimonialsForApp(app, {
    ...noop,
    call: async () => ({ ok: true, records: [{ id: 'a' }, { id: 'b' }] }),
    process: async ({ record }) => { seen.push(record.id); if (record.id === 'a') throw new Error('db down'); return { stored: true } },
  })
  assert.deepEqual(seen, ['a', 'b'])
  assert.equal(r.error, 'db down')
  assert.equal(r.stored, 1)
})

// ── ping ────────────────────────────────────────────────────────────────────
const pingDeps = (over = {}) => ({
  bridgeConfigured: () => true, getApp: async () => ({ id: 'rumbo', backend: 'base44' }), log: () => {},
  callBridge: async () => ({ ok: true, record: rec(), tenant_name: 'Café Ana' }),
  processIncoming: async () => ({ reason: 'nuevo', notified: true }),
  processMissing: async () => ({ reason: 'x' }),
  ...over,
})
test('ping: malformed input → 400 only', async () => {
  for (const b of [undefined, {}, { app: 'rumbo' }, { testimonialId: 'abcdef' }, { app: 'rumbo', testimonialId: 'a b' }, { app: 'rumbo', testimonialId: 'abc' }, { app: 5, testimonialId: 'abcdef' }]) {
    assert.equal((await runPing(b, pingDeps())).status, 400, JSON.stringify(b))
  }
})
test('ping: every outcome of a well-formed request answers 200 {ok:true} and nothing else', async () => {
  const body = { app: 'rumbo', testimonialId: 'tm123456' }
  const cases = {
    stored: pingDeps(),
    'unknown app': pingDeps({ getApp: async () => null }),
    'non-base44 app': pingDeps({ getApp: async () => ({ id: 'site', backend: 'static' }) }),
    'app without module': pingDeps({ callBridge: async () => { throw new Error('unknown action: testimonials.get') } }),
    'bridge down': pingDeps({ callBridge: async () => { throw new Error('boom') } }),
    'record null': pingDeps({ callBridge: async () => ({ ok: true, record: null }) }),
    'bad bridge answer': pingDeps({ callBridge: async () => ({ ok: true }) }),
    'db error': pingDeps({ processIncoming: async () => { throw new Error('db secret detail') } }),
    'bridge not configured': pingDeps({ bridgeConfigured: () => false }),
  }
  for (const [name, deps] of Object.entries(cases)) {
    const r = await runPing(body, deps)
    assert.equal(r.status, 200, name)
    assert.deepEqual(r.json, { ok: true }, name)
  }
})
test('ping: record:null withdraws the stored row; a record goes to the upsert with the tenant name', async () => {
  const calls = []
  await runPing({ app: 'rumbo', testimonialId: 'tm123456' }, pingDeps({
    callBridge: async () => ({ ok: true, record: null }),
    processMissing: async (a) => { calls.push(['missing', a.externalId]); return { reason: 'ok' } },
  }))
  await runPing({ app: 'rumbo', testimonialId: 'tm123456' }, pingDeps({
    processIncoming: async (a) => { calls.push(['incoming', a.tenantName]); return { reason: 'ok' } },
  }))
  assert.deepEqual(calls, [['missing', 'tm123456'], ['incoming', 'Café Ana']])
})

test('sync stamps every upsert and every absence with the SAME observed_at (the list call start)', async () => {
  const seen = []
  await syncTestimonialsForApp(app, {
    call: async () => ({ ok: true, records: [{ id: 'a' }] }),
    process: async ({ observedAt }) => { seen.push(observedAt); return { stored: false } },
    processMissing: async ({ observedAt }) => { seen.push(observedAt); return { stored: false } },
    listStored: async () => [{ external_id: 'z', status: 'pending' }],
  })
  assert.equal(seen.length, 2)
  assert.ok(seen[0] && seen[0] === seen[1])
})

test('MC2 race: a later no-op observation touches observed_at, so an earlier-started record:null cannot erase the live row', () => {
  const live = stored('approved', { source_updated_at: V1, observed_at: T1 })
  // list started at T3 returns the same record (equal version, unchanged content)
  const noop = decideUpsert(live, inc({ updated_date: V1 }), T3)
  assert.deepEqual([noop.action, noop.touch, noop.erase], ['update', true, undefined])
  // newer version, unchanged content: also a touch
  assert.equal(decideUpsert(live, inc({ updated_date: V2 }), T3).touch, true)
  // the touch is applied; now the record:null that STARTED at T2 (< T3) arrives late
  const after = { ...live, observed_at: T3 }
  assert.equal(decideGone(after, undefined, { observedAt: T2 }).action, 'skip')
  // without observation info the pure rule still skips (nothing to advance)
  assert.equal(decideUpsert(live, inc({ updated_date: V1 })).action, 'skip')
})
test('MC2: an erased row is restored by a LATER observation with an EQUAL version (record still exists)', () => {
  const erasedRow = stored('withdrawn', { ...erased, source_updated_at: V1, observed_at: T2 })
  const d = decideUpsert(erasedRow, inc({ updated_date: V1 }), T3)
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
  // an OLDER observation or an older VERSION still cannot
  assert.equal(decideUpsert(erasedRow, inc({ updated_date: V1 }), T1).action, 'skip')
  const stale = decideUpsert({ ...erasedRow, source_updated_at: V2 }, inc({ updated_date: V1 }), T3)
  assert.deepEqual([stale.action, stale.touch, stale.status], ['update', true, 'withdrawn'])
})
test('withdrawal clears tenant_name too (a business name can identify a person)', () => {
  assert.equal(WITHDRAWN_FIELDS.tenant_name, null)
  assert.equal(withdrawnPatch(V1, T1).tenant_name, null)
})
