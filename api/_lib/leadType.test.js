import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLeadType, LEAD_TYPES } from './leadType.js'

test('normalizeLeadType accepts each known type', () => {
  for (const t of LEAD_TYPES) assert.equal(normalizeLeadType(t), t)
})

test('normalizeLeadType is case-insensitive and trims', () => {
  assert.equal(normalizeLeadType(' Soporte '), 'soporte')
})

test('normalizeLeadType rejects unknown values to null', () => {
  assert.equal(normalizeLeadType('urgente'), null)
  assert.equal(normalizeLeadType(''), null)
})

test('normalizeLeadType passes through null/undefined as null', () => {
  assert.equal(normalizeLeadType(null), null)
  assert.equal(normalizeLeadType(undefined), null)
})
