import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateVisits, previousMonth, mexicoCityDate } from './visitsAggregate.js'

const APPS = ['stockflow', 'flowfin', 'sommel']
const FREE = ['plink-fx', 'gastos-viaje']
// Noon UTC = 06:00 Mexico City: same calendar day in both zones.
const at = (iso) => new Date(`${iso}T12:00:00Z`)
const run = (rows, iso, o = {}) =>
  aggregateVisits({ rows, appSlugs: APPS, freewareSlugs: FREE, now: at(iso), ...o })
const pv = (path, day, n = 1) => Array.from({ length: n }, () => ({ path, day }))

test('previousMonth: January 1 rolls back to December of the previous year', () => {
  assert.deepEqual(previousMonth('2027-01-01'), { month: '2026-12', start: '2026-12-01', endExclusive: '2027-01-01' })
})
test('previousMonth: March 1 gives February (non-leap and leap)', () => {
  assert.equal(previousMonth('2027-03-01').month, '2027-02')
  assert.equal(previousMonth('2028-03-01').month, '2028-02')
})
test('previousMonth: the 31st does not overflow into a short month', () => {
  assert.equal(previousMonth('2026-10-31').month, '2026-09')
  assert.equal(previousMonth('2026-12-31').month, '2026-11')
})

test('mexicoCityDate uses the Mexico calendar, not UTC', () => {
  // 03:00 UTC on Nov 1 is still Oct 31 in Mexico City (UTC-6).
  assert.equal(mexicoCityDate(new Date('2026-11-01T03:00:00Z')), '2026-10-31')
  assert.equal(run([], '2026-10-07').month, '2026-09')
  const early = aggregateVisits({ rows: [], appSlugs: APPS, freewareSlugs: FREE, now: new Date('2026-11-01T03:00:00Z') })
  assert.equal(early.month, '2026-09') // still October there, so previous = September
})

test('visitsMonth counts only the previous calendar month, boundaries inclusive/exclusive', () => {
  const rows = [
    ...pv('/apps/stockflow', '2026-08-31'), // before
    ...pv('/apps/stockflow', '2026-09-01', 2), // first day
    ...pv('/apps/stockflow', '2026-09-30', 3), // last day
    ...pv('/apps/stockflow', '2026-10-01', 4), // current month
  ]
  const r = run(rows, '2026-10-07')
  assert.equal(r.month, '2026-09')
  assert.equal(r.visits.stockflow.visitsMonth, 5)
})

test('January 1: month is December of previous year', () => {
  const rows = [...pv('/apps/flowfin', '2026-12-15', 2), ...pv('/apps/flowfin', '2026-11-30')]
  const r = run(rows, '2027-01-01')
  assert.equal(r.month, '2026-12')
  assert.equal(r.visits.flowfin.visitsMonth, 2)
  assert.equal(r.windowStart, '2026-12-01')
})

test('March 1 and the 31st', () => {
  assert.equal(run(pv('/apps/sommel', '2027-02-28', 2), '2027-03-01').visits.sommel.visitsMonth, 2)
  assert.equal(run(pv('/apps/sommel', '2026-09-30'), '2026-10-31').visits.sommel.visitsMonth, 1)
})

test('topApp: highest wins; ties go to the first in APP_SLUGS order', () => {
  const rows = [...pv('/apps/flowfin', '2026-09-10', 3), ...pv('/apps/sommel', '2026-09-10', 3), ...pv('/apps/stockflow', '2026-09-10', 1)]
  assert.equal(run(rows, '2026-10-07').topApp, 'flowfin')
  assert.equal(run([...rows, ...pv('/apps/sommel', '2026-09-11')], '2026-10-07').topApp, 'sommel')
})

test('topFreeware likewise, independent of apps', () => {
  const rows = [...pv('/freeware/gastos-viaje', '2026-09-10', 2), ...pv('/freeware/plink-fx', '2026-09-10', 2)]
  const r = run(rows, '2026-10-07')
  assert.equal(r.topFreeware, 'plink-fx')
  assert.equal(r.topApp, null)
})

test('all zero -> null, even with current-month traffic only', () => {
  const r = run(pv('/apps/stockflow', '2026-10-05', 9), '2026-10-07')
  assert.equal(r.topApp, null)
  assert.equal(r.topFreeware, null)
  assert.equal(r.visits.stockflow.visitsMonth, 0)
})

test('unknown paths and slugs are ignored', () => {
  const r = run([...pv('/apps/nope', '2026-09-10', 5), ...pv('/freeware/nope', '2026-09-10'), ...pv('/blog', '2026-09-10')], '2026-10-07')
  assert.deepEqual(Object.keys(r.visits), APPS)
  assert.deepEqual(Object.keys(r.freeware), FREE)
  assert.equal(r.topApp, null)
})

test('visits30 / visits7 match the previous behaviour (UTC windows, day >= since)', () => {
  // now = 2026-10-07 -> since30 = 2026-09-08, since7 = 2026-10-01
  const rows = [
    ...pv('/apps/stockflow', '2026-09-07'), // outside 30 (but in prev month)
    ...pv('/apps/stockflow', '2026-09-08', 2),
    ...pv('/apps/stockflow', '2026-09-30'),
    ...pv('/apps/stockflow', '2026-10-01', 4),
    ...pv('/apps/stockflow', '2026-10-07', 8),
  ]
  const r = run(rows, '2026-10-07')
  assert.equal(r.since30, '2026-09-08')
  assert.equal(r.visits.stockflow.visits30, 15)
  assert.equal(r.visits.stockflow.visits7, 12)
  assert.equal(r.visits.stockflow.visitsMonth, 4)
})

test('windowStart covers both the previous month and the 30-day window', () => {
  for (const d of ['2026-10-01', '2026-10-31', '2027-01-01', '2027-03-01']) {
    const r = run([], d)
    assert.ok(r.windowStart <= r.since30)
    assert.ok(r.windowStart <= previousMonth(mexicoCityDate(at(d))).start)
  }
})
