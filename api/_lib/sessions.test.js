import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_MS, OPEN_WINDOW_MS,
  idleMs, isOpen, sessionState, normalizeSession, normalizeOpenSessions,
  groupByUser, summarize, canRevoke, partitionForBulk, idsForUserAll,
} from './sessions.js'

// Fixed clock so every assertion is deterministic.
const NOW = Date.parse('2026-07-05T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()

// ── idle / state ─────────────────────────────────────────────────────────────

test('idleMs is the gap since last_active_at; bad timestamps → Infinity', () => {
  assert.equal(idleMs({ last_active_at: ago(5 * 60_000) }, NOW), 5 * 60_000)
  assert.equal(idleMs({ last_active_at: null }, NOW), Infinity)
  assert.equal(idleMs({}, NOW), Infinity)
})

test('sessionState: <30min = online, ≥30min = idle', () => {
  assert.equal(sessionState({ last_active_at: ago(29 * 60_000) }, NOW), 'online')
  assert.equal(sessionState({ last_active_at: ago(30 * 60_000) }, NOW), 'idle')
  assert.equal(sessionState({ last_active_at: ago(IDLE_MS - 1) }, NOW), 'online')
})

test('isOpen: revoked or older than the 24h window is not open', () => {
  assert.equal(isOpen({ last_active_at: ago(60_000) }, NOW), true)
  assert.equal(isOpen({ last_active_at: ago(60_000), revoked_at: ago(1000) }, NOW), false)
  assert.equal(isOpen({ last_active_at: ago(OPEN_WINDOW_MS + 60_000) }, NOW), false)
})

// ── normalize ────────────────────────────────────────────────────────────────

test('normalizeSession maps the bridge record id and derives idle/state', () => {
  const s = normalizeSession({ id: 'sess_1', user_email: 'a@x.mx', last_active_at: ago(40 * 60_000) }, NOW)
  assert.equal(s.external_id, 'sess_1')
  assert.equal(s.state, 'idle')
  assert.equal(s.idle_ms, 40 * 60_000)
  assert.equal(s.revoked, false)
})

test('normalizeOpenSessions drops revoked + stale and sorts most-active first', () => {
  const rows = [
    { id: 'a', last_active_at: ago(3 * 60 * 60_000) },        // idle 3h, open
    { id: 'b', last_active_at: ago(60_000) },                 // online, open
    { id: 'c', last_active_at: ago(60_000), revoked_at: ago(1) }, // revoked → out
    { id: 'd', last_active_at: ago(OPEN_WINDOW_MS + 1) },     // stale → out
  ]
  const out = normalizeOpenSessions(rows, NOW)
  assert.deepEqual(out.map((s) => s.external_id), ['b', 'a'])
})

// ── grouping / summary ───────────────────────────────────────────────────────

test('groupByUser buckets per user with online/idle counts, online users first', () => {
  const sessions = normalizeOpenSessions([
    { id: '1', user_email: 'maria@x.mx', user_name: 'María', last_active_at: ago(40 * 60_000) },
    { id: '2', user_email: 'maria@x.mx', user_name: 'María', last_active_at: ago(30_000) },
    { id: '3', user_email: 'ana@x.mx', user_name: 'Ana', last_active_at: ago(2 * 60 * 60_000) },
  ], NOW)
  const groups = groupByUser(sessions)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].user_email, 'maria@x.mx') // has one online → first
  assert.equal(groups[0].online, 1)
  assert.equal(groups[0].idle, 1)
  assert.equal(groups[1].user_email, 'ana@x.mx')
  assert.equal(groups[1].online, 0)
})

test('summarize counts open/online/idle', () => {
  const sessions = normalizeOpenSessions([
    { id: '1', last_active_at: ago(60_000) },
    { id: '2', last_active_at: ago(45 * 60_000) },
    { id: '3', last_active_at: ago(90 * 60_000) },
  ], NOW)
  assert.deepEqual(summarize(sessions), { open: 3, online: 1, idle: 2 })
})

// ── revoke enforcement (the core rule) ───────────────────────────────────────

test('canRevoke allows idle sessions for anyone', () => {
  const s = normalizeSession({ id: 'x', last_active_at: ago(40 * 60_000) }, NOW)
  assert.equal(canRevoke(s, { role: 'admin' }, NOW).ok, true)
  assert.equal(canRevoke(s, { role: 'viewer' }, NOW).ok, true)
})

test('canRevoke blocks an active session for admin, even with override', () => {
  const s = normalizeSession({ id: 'x', last_active_at: ago(60_000) }, NOW)
  assert.equal(canRevoke(s, { role: 'admin', override: true }, NOW).ok, false)
})

test('canRevoke lets the owner force an active session only with override', () => {
  const s = normalizeSession({ id: 'x', last_active_at: ago(60_000) }, NOW)
  assert.equal(canRevoke(s, { role: 'owner' }, NOW).ok, false)          // no override → blocked
  const forced = canRevoke(s, { role: 'owner', override: true }, NOW)
  assert.equal(forced.ok, true)
  assert.equal(forced.forced, true)
})

test('partitionForBulk closes idle, skips (and counts) active', () => {
  const sessions = normalizeOpenSessions([
    { id: 'idle1', last_active_at: ago(40 * 60_000) },
    { id: 'idle2', last_active_at: ago(3 * 60 * 60_000) },
    { id: 'live1', last_active_at: ago(30_000) },
  ], NOW)
  const { closableIds, skippedActive } = partitionForBulk(sessions, NOW)
  assert.deepEqual(closableIds.sort(), ['idle1', 'idle2'])
  assert.equal(skippedActive, 1)
})

test('idsForUserAll returns every session of a user, idle AND active, and none of another user\'s', () => {
  const sessions = normalizeOpenSessions([
    { id: 'idle1', user_email: 'a@x.mx', last_active_at: ago(40 * 60_000) },
    { id: 'live1', user_email: 'a@x.mx', last_active_at: ago(30_000) },
    { id: 'other', user_email: 'b@x.mx', last_active_at: ago(30_000) },
  ], NOW)
  assert.deepEqual(idsForUserAll(sessions, 'a@x.mx').sort(), ['idle1', 'live1'])
  assert.deepEqual(idsForUserAll(sessions, 'b@x.mx'), ['other'])
  assert.deepEqual(idsForUserAll(sessions, 'nobody@x.mx'), [])
})
