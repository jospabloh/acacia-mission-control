import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertExportConfirmed, assertParishNameMatches } from './license-delete-premium-data.js'

test('assertExportConfirmed: rechaza sin export_confirmed_at', () => {
  const result = assertExportConfirmed({ raw: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'export_not_confirmed')
})

test('assertExportConfirmed: acepta con export_confirmed_at presente', () => {
  const result = assertExportConfirmed({ raw: { export_confirmed_at: '2026-07-01T00:00:00Z' } })
  assert.equal(result.ok, true)
})

test('assertParishNameMatches: exige coincidencia exacta (no case-insensitive, no trim silencioso)', () => {
  assert.equal(assertParishNameMatches('Parroquia San Juan', 'Parroquia San Juan').ok, true)
  assert.equal(assertParishNameMatches('Parroquia San Juan', 'parroquia san juan').ok, false)
  assert.equal(assertParishNameMatches('Parroquia San Juan', 'Parroquia San Juan ').ok, false)
})
