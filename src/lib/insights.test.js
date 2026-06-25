import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizePortfolio } from './insights.js'

const APPS = [
  { id: 'puntos', name: 'Puntos+' },
  { id: 'flowfin', name: 'FlowFin' },
]

const LICENSES = [
  { app_id: 'puntos', status: 'trial', plan: 'starter' },
  { app_id: 'flowfin', status: 'active', plan: 'growth' },
  { app_id: 'flowfin', status: 'active', plan: 'growth' },
  { app_id: 'flowfin', status: 'view_only', plan: 'starter' },
]
const TENANTS = [
  { app_id: 'puntos' }, { app_id: 'flowfin' }, { app_id: 'flowfin' }, { app_id: 'flowfin' },
]

test('totals bucket statuses and compute active rate', () => {
  const s = summarizePortfolio({ licenses: LICENSES, tenants: TENANTS, apps: APPS })
  assert.equal(s.totals.licenses, 4)
  assert.equal(s.totals.tenants, 4)
  assert.equal(s.totals.active, 2)
  assert.equal(s.totals.trial, 1)
  assert.equal(s.totals.view_only, 1)
  assert.equal(s.totals.activeRate, 50) // 2/4
})

test('byStatus / byPlan are counted and sorted desc', () => {
  const s = summarizePortfolio({ licenses: LICENSES, tenants: TENANTS, apps: APPS })
  assert.deepEqual(s.byStatus[0], { key: 'active', count: 2 })
  assert.equal(s.byPlan.find((p) => p.key === 'growth').count, 2)
  assert.equal(s.byPlan.find((p) => p.key === 'starter').count, 2)
})

test('byApp rolls up tenants + licenses + active and resolves names', () => {
  const s = summarizePortfolio({ licenses: LICENSES, tenants: TENANTS, apps: APPS })
  const ff = s.byApp.find((a) => a.app_id === 'flowfin')
  assert.equal(ff.name, 'FlowFin')
  assert.equal(ff.tenants, 3)
  assert.equal(ff.licenses, 3)
  assert.equal(ff.active, 2)
  assert.equal(s.byApp[0].app_id, 'flowfin') // most tenants first
})

test('empty input is safe', () => {
  const s = summarizePortfolio({})
  assert.equal(s.totals.licenses, 0)
  assert.equal(s.totals.activeRate, 0)
  assert.deepEqual(s.byApp, [])
})

test('missing status/plan fall back to labels', () => {
  const s = summarizePortfolio({ licenses: [{ app_id: 'x' }], tenants: [], apps: [] })
  assert.equal(s.byStatus[0].key, 'desconocido')
  assert.equal(s.byPlan[0].key, 'sin plan')
  assert.equal(s.totals.other, 1)
})
