import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAutocloseStatuses, isStaleResolved } from './autoCloseResolved.js'
import { ticketControlFor } from '../ticketControl.js'

test('resolveAutocloseStatuses picks the resolved/closed status per app model', () => {
  // rumbo: lowercase vocabulary
  assert.deepEqual(resolveAutocloseStatuses(ticketControlFor('rumbo')), {
    resolvedStatus: 'resolved', closedStatus: 'closed',
  })
  // liuma: uppercase vocabulary
  assert.deepEqual(resolveAutocloseStatuses(ticketControlFor('liuma')), {
    resolvedStatus: 'RESOLVED', closedStatus: 'CLOSED',
  })
})

test('resolveAutocloseStatuses returns nulls when a status is missing', () => {
  assert.deepEqual(resolveAutocloseStatuses({ statuses: ['open', 'closed'] }), {
    resolvedStatus: null, closedStatus: 'closed',
  })
  assert.deepEqual(resolveAutocloseStatuses({}), { resolvedStatus: null, closedStatus: null })
})

test('isStaleResolved closes only after the grace window with no newer activity', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')
  // Resolved 3 days ago, nothing since → stale (default 2-day window).
  assert.equal(isStaleResolved({ last_activity_at: '2026-07-07T12:00:00.000Z' }, { now }), true)
  // Resolved but the customer wrote back 1 day ago → NOT stale.
  assert.equal(isStaleResolved({ last_activity_at: '2026-07-09T12:00:00.000Z' }, { now }), false)
  // Exactly at the window boundary counts as stale.
  assert.equal(isStaleResolved({ last_activity_at: '2026-07-08T12:00:00.000Z' }, { now }), true)
})

test('isStaleResolved falls back to creation time when activity is absent', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')
  assert.equal(isStaleResolved({ last_activity_at: null, customer_created_at: '2026-07-01T00:00:00.000Z' }, { now }), true)
  assert.equal(isStaleResolved({ created_at: '2026-07-09T20:00:00.000Z' }, { now }), false)
  // No timestamp at all → never auto-close (can't prove idleness).
  assert.equal(isStaleResolved({}, { now }), false)
})

test('isStaleResolved honours a custom window', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')
  const row = { last_activity_at: '2026-07-05T12:00:00.000Z' } // 5 days idle
  assert.equal(isStaleResolved(row, { now, days: 7 }), false)
  assert.equal(isStaleResolved(row, { now, days: 3 }), true)
})
