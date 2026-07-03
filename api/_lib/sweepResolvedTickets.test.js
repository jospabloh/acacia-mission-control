import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  autoCloseDecision,
  resolvedStatusFor,
  closedStatusFor,
  autoCloseDays,
  DEFAULT_AUTOCLOSE_DAYS,
} from './sweepResolvedTickets.js'
import { ticketControlFor } from './ticketControl.js'

const NOW = new Date('2026-07-03T12:00:00Z')
const CUTOFF_MS = NOW.getTime() - DEFAULT_AUTOCLOSE_DAYS * 24 * 60 * 60 * 1000 // 2 days ago
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
const ONE_DAY_AGO = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()

// ── status label resolution (case-insensitive across variants) ───────────────
test('resolved/closed status labels per app (lowercase + liuma uppercase)', () => {
  assert.equal(resolvedStatusFor(ticketControlFor('rumbo')), 'resolved')
  assert.equal(closedStatusFor(ticketControlFor('rumbo')), 'closed')
  assert.equal(resolvedStatusFor(ticketControlFor('puntos')), 'resolved')
  assert.equal(closedStatusFor(ticketControlFor('puntos')), 'closed')
  assert.equal(resolvedStatusFor(ticketControlFor('liuma')), 'RESOLVED')
  assert.equal(closedStatusFor(ticketControlFor('liuma')), 'CLOSED')
})

// ── rumbo (inline): anchor is last_activity_at, no resolved_at field ──────────
test('rumbo: resolved & idle past window → close', () => {
  const cfg = ticketControlFor('rumbo')
  const row = { status: 'resolved', last_activity_at: THREE_DAYS_AGO, raw: { id: 't1', status: 'resolved' } }
  const d = autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS })
  assert.equal(d.close, true)
  assert.equal(d.status, 'closed')
})

test('rumbo: resolved but still within window → keep', () => {
  const cfg = ticketControlFor('rumbo')
  const row = { status: 'resolved', last_activity_at: ONE_DAY_AGO, raw: { id: 't2', status: 'resolved' } }
  assert.equal(autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS }).close, false)
})

test('rumbo: not resolved → keep', () => {
  const cfg = ticketControlFor('rumbo')
  const row = { status: 'in_progress', last_activity_at: THREE_DAYS_AGO, raw: { id: 't3', status: 'in_progress' } }
  assert.equal(autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS }).close, false)
})

// ── message-thread apps: anchor is raw.resolved_at ───────────────────────────
test('puntos: resolved_at past window → close (even if last_activity newer)', () => {
  const cfg = ticketControlFor('puntos')
  const row = {
    status: 'resolved',
    last_activity_at: ONE_DAY_AGO, // e.g. an internal note bumped activity
    raw: { id: 'p1', status: 'resolved', resolved_at: THREE_DAYS_AGO, last_message_by_role: 'owner' },
  }
  const d = autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS })
  assert.equal(d.close, true)
  assert.equal(d.status, 'closed')
})

test('puntos: requester replied last → keep (do not auto-close)', () => {
  const cfg = ticketControlFor('puntos')
  const row = {
    status: 'resolved',
    last_activity_at: THREE_DAYS_AGO,
    raw: { id: 'p2', status: 'resolved', resolved_at: THREE_DAYS_AGO, last_message_by_role: 'tenant' },
  }
  const d = autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS })
  assert.equal(d.close, false)
  assert.match(d.reason, /solicitante/)
})

test('puntos: resolved_at within window → keep', () => {
  const cfg = ticketControlFor('puntos')
  const row = {
    status: 'resolved',
    last_activity_at: ONE_DAY_AGO,
    raw: { id: 'p3', status: 'resolved', resolved_at: ONE_DAY_AGO, last_message_by_role: 'owner' },
  }
  assert.equal(autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS }).close, false)
})

// ── liuma: uppercase statuses, REQUESTER customer role ───────────────────────
test('liuma: RESOLVED past window with staff last word → close to CLOSED', () => {
  const cfg = ticketControlFor('liuma')
  const row = {
    status: 'RESOLVED',
    last_activity_at: THREE_DAYS_AGO,
    raw: { id: 'l1', status: 'RESOLVED', resolved_at: THREE_DAYS_AGO, last_message_by_role: 'OWNER' },
  }
  const d = autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS })
  assert.equal(d.close, true)
  assert.equal(d.status, 'CLOSED')
})

test('liuma: requester (REQUESTER) replied last → keep', () => {
  const cfg = ticketControlFor('liuma')
  const row = {
    status: 'RESOLVED',
    last_activity_at: THREE_DAYS_AGO,
    raw: { id: 'l2', status: 'RESOLVED', resolved_at: THREE_DAYS_AGO, last_message_by_role: 'REQUESTER' },
  }
  assert.equal(autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS }).close, false)
})

// ── guards ───────────────────────────────────────────────────────────────────
test('no anchor timestamp → keep (never close blindly)', () => {
  const cfg = ticketControlFor('puntos')
  const row = { status: 'resolved', last_activity_at: null, raw: { id: 'x', status: 'resolved' } }
  assert.equal(autoCloseDecision(cfg, row, { cutoffMs: CUTOFF_MS }).close, false)
})

test('autoCloseDays defaults to 2 and honors a valid override', () => {
  delete process.env.TICKET_AUTOCLOSE_DAYS
  assert.equal(autoCloseDays(), 2)
  process.env.TICKET_AUTOCLOSE_DAYS = '5'
  assert.equal(autoCloseDays(), 5)
  process.env.TICKET_AUTOCLOSE_DAYS = 'nonsense'
  assert.equal(autoCloseDays(), 2)
  delete process.env.TICKET_AUTOCLOSE_DAYS
})
