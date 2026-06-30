import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSla, normalizePriority, isBreached, SLA_TARGETS } from './sla.js'

test('normalizePriority collapses vocabularies to the four ITIL tiers', () => {
  assert.equal(normalizePriority('URGENT'), 'urgent')
  assert.equal(normalizePriority('critical'), 'urgent')
  assert.equal(normalizePriority('High'), 'high')
  assert.equal(normalizePriority('medium'), 'normal')
  assert.equal(normalizePriority(''), 'normal')
  assert.equal(normalizePriority(undefined), 'normal')
  assert.equal(normalizePriority('low'), 'low')
  assert.equal(normalizePriority('weird-value'), 'normal')
})

test('computeSla anchors the clock to the customer creation instant', () => {
  const created = '2026-06-30T12:00:00.000Z'
  const sla = computeSla(created, 'high')
  assert.equal(sla.priority, 'high')
  // high → response 4h, resolve 8h
  assert.equal(sla.firstResponseDueAt, '2026-06-30T16:00:00.000Z')
  assert.equal(sla.resolveDueAt, '2026-06-30T20:00:00.000Z')
})

test('computeSla uses the urgent tier targets', () => {
  const sla = computeSla('2026-06-30T00:00:00.000Z', 'urgent')
  assert.equal(sla.firstResponseDueAt, '2026-06-30T01:00:00.000Z') // +60m
  assert.equal(sla.resolveDueAt, '2026-06-30T04:00:00.000Z') // +240m
})

test('computeSla returns nulls for an unparseable creation time', () => {
  const sla = computeSla(null, 'normal')
  assert.equal(sla.firstResponseDueAt, null)
  assert.equal(sla.resolveDueAt, null)
  assert.equal(sla.priority, 'normal')
})

test('isBreached only fires when the deadline passed and the milestone is unmet', () => {
  const now = Date.parse('2026-06-30T12:00:00Z')
  assert.equal(isBreached('2026-06-30T10:00:00Z', null, now), true) // 2h overdue
  assert.equal(isBreached('2026-06-30T14:00:00Z', null, now), false) // still time
  assert.equal(isBreached('2026-06-30T10:00:00Z', '2026-06-30T09:00:00Z', now), false) // met before due
  assert.equal(isBreached(null, null, now), false)
})

test('every tier has response <= resolve targets', () => {
  for (const tier of Object.keys(SLA_TARGETS)) {
    assert.ok(SLA_TARGETS[tier].responseMin <= SLA_TARGETS[tier].resolveMin, tier)
  }
})
