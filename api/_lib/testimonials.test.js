import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  siteSlug, appIdForSlug, isUnknownAction, normalizeRecord, decideUpsert, decideGone, missingFromList,
  canNotify, notifyCutoff, reviewTransition, reviewDecision, mexicoMonth, publicItem, buildPublicPayload,
  WITHDRAWN_FIELDS, withdrawnPatch,
} from './testimonials.js'
import { syncTestimonialsForApp } from './sync/syncTestimonials.js'
import { runPing } from './ingest/testimonial-pull.js'

const rec = (o = {}) => ({
  id: 'tm123456', tenant_id: 't9', rating: 5, body: 'Excelente herramienta para mi negocio.',
  author_name: 'Ana', author_role: 'Dueña', consent_publish: true, consent_at: '2026-10-01T10:00:00Z',
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
    const d = decideUpsert(stored('approved'), inc(o))
    assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true], JSON.stringify(o))
  }
})
test('upsert: rejected unchanged stays; rejected + changed → pending + notify', () => {
  assert.equal(decideUpsert(stored('rejected'), inc()).action, 'skip')
  const d = decideUpsert(stored('rejected'), inc({ rating: 3 }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
test('upsert: pending + changed stays pending without notice; unchanged → skip', () => {
  const d = decideUpsert(stored('pending'), inc({ rating: 3 }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', false])
  assert.equal(decideUpsert(stored('pending'), inc()).action, 'skip')
})
test('upsert: withdrawn + valid resubmission → pending + notify (content restored by the update)', () => {
  const d = decideUpsert(stored('withdrawn', { body: '', author_name: '', consent_publish: false }), inc())
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
test('upsert: stale record (consent_at before the withdrawal) after withdrawal → skip, row stays erased', () => {
  const w = stored('withdrawn', { body: '', author_name: '', consent_publish: false, withdrawn_at: '2026-10-02T09:00:00Z' })
  const d = decideUpsert(w, inc({ consent_at: '2026-10-01T10:00:00Z' }))
  assert.deepEqual([d.action, d.notify], ['skip', false])
  assert.equal(decideUpsert(w, inc({ consent_at: '2026-10-02T09:00:00Z' })).action, 'skip') // equal is not newer
})
test('upsert: genuinely new submission after the withdrawal → pending with the new content', () => {
  const w = stored('withdrawn', { body: '', author_name: '', consent_publish: false, withdrawn_at: '2026-10-02T09:00:00Z' })
  const d = decideUpsert(w, inc({ consent_at: '2026-10-03T08:00:00Z' }))
  assert.deepEqual([d.action, d.status, d.notify], ['update', 'pending', true])
})
test('upsert: legacy withdrawn row without withdrawn_at falls back to updated_at', () => {
  const w = stored('withdrawn', { withdrawn_at: null, updated_at: '2026-10-02T09:00:00Z' })
  assert.equal(decideUpsert(w, inc({ consent_at: '2026-10-01T10:00:00Z' })).action, 'skip')
  assert.equal(decideUpsert(w, inc({ consent_at: '2026-10-03T10:00:00Z' })).action, 'update')
})
test('withdrawnPatch = erase fields + withdrawn_at', () => {
  assert.deepEqual(withdrawnPatch(new Date('2026-10-02T09:00:00Z')), { ...WITHDRAWN_FIELDS, withdrawn_at: '2026-10-02T09:00:00.000Z' })
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
  assert.deepEqual({ ...WITHDRAWN_FIELDS }, { status: 'withdrawn', body: '', author_name: '', author_role: null, consent_publish: false })
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
test('review race: stale updated_at → 409, fresh → decision, missing → 400, no row → 404', () => {
  const row = { status: 'pending', updated_at: '2026-10-07T10:00:00.123456+00:00' }
  assert.deepEqual(reviewDecision(row, { op: 'approve', updatedAt: '2026-10-07T10:00:00.123Z' }), { status: 'approved' })
  assert.equal(reviewDecision(row, { op: 'approve', updatedAt: '2026-10-07T09:59:00Z' }).code, 409)
  assert.equal(reviewDecision(row, { op: 'approve' }).code, 400)
  assert.equal(reviewDecision(row, { op: 'approve', updatedAt: 'x' }).code, 400)
  assert.equal(reviewDecision(null, { op: 'approve', updatedAt: 'x' }).code, 404)
  // a withdrawal that landed after the reviewer loaded the page changes updated_at → 409, never approved
  const withdrawn = { status: 'withdrawn', updated_at: '2026-10-07T10:05:00Z' }
  assert.equal(reviewDecision(withdrawn, { op: 'approve', updatedAt: '2026-10-07T10:05:00Z' }).code, 409)
  assert.equal(reviewDecision(withdrawn, { op: 'approve', updatedAt: '2026-10-07T10:00:00Z' }).code, 409)
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
