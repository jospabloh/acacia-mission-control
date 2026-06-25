import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapLicenseRecord, isMappable } from './licenseMapping.js'

// Registry rows mirror supabase/migrations/0002 + 0004 field_map.
const PUNTOS = { id: 'puntos', config: { license_entity: 'Business', field_map: {
  tenant_external_id: 'id', name: 'name', plan: 'license_plan', status: 'billing_status',
  seats: 'licensed_user_limit', trial_ends_at: 'trial_end_at', current_period_end: 'license_expires_at' } } }

const RUMBO = { id: 'rumbo', config: { license_entity: 'TenantLicense', field_map: {
  tenant_external_id: 'id', name: 'tenant_name', plan: 'plan', status: 'status',
  seats: 'max_drivers', trial_ends_at: 'trial_ends_at', current_period_end: 'current_period_end' } } }

const LIUMA = { id: 'liuma', config: { license_entity: 'SchoolSubscription', field_map: {
  tenant_external_id: 'school_id', name: 'school_id', plan: 'subscription_plan', status: 'subscription_status',
  seats: 'licensed_student_limit', trial_ends_at: 'trial_end_date', current_period_end: 'subscription_end_date' } } }

test('maps a Puntos+ Business record', () => {
  const { tenant, license } = mapLicenseRecord({
    id: 'b1', name: 'Cafe Luna', billing_status: 'active', license_plan: 'growth',
    licensed_user_limit: 5, trial_end_at: '2026-01-01T00:00:00Z',
    license_expires_at: '2026-12-31T00:00:00Z',
  }, PUNTOS)
  assert.equal(tenant.external_id, 'b1')
  assert.equal(tenant.name, 'Cafe Luna')
  assert.equal(license.app_id, 'puntos')
  assert.equal(license.plan, 'growth')
  assert.equal(license.status, 'active')
  assert.equal(license.seats, 5)
  assert.equal(license.current_period_end, '2026-12-31T00:00:00.000Z')
})

test('maps a Rumbo TenantLicense (record id is the tenant id)', () => {
  const { tenant, license } = mapLicenseRecord({
    id: 't9', tenant_name: 'Flotilla Sur', plan: 'pro', status: 'trial',
    max_drivers: 12, current_period_end: '2026-06-30T00:00:00Z',
  }, RUMBO)
  assert.equal(tenant.external_id, 't9')
  assert.equal(tenant.name, 'Flotilla Sur')
  assert.equal(license.seats, 12)
  assert.equal(license.status, 'trial')
})

test('maps a LIUMA SchoolSubscription (tenant id = school_id, distinct from license id)', () => {
  const { tenant, license } = mapLicenseRecord({
    id: 'sub1', school_id: 'sch7', subscription_status: 'active', subscription_plan: 'standard',
    licensed_student_limit: 300, subscription_end_date: '2027-01-15T00:00:00Z',
  }, LIUMA)
  assert.equal(tenant.external_id, 'sch7')      // tenant keyed by school
  assert.equal(license.external_id, 'sub1')     // license keyed by its own id
  assert.equal(license.seats, 300)
})

test('falls back to candidate field names without a field_map', () => {
  const app = { id: 'x', config: {} }
  const { license } = mapLicenseRecord({ id: '1', status: 'active', plan: 'basic', seats: 3 }, app)
  assert.equal(license.status, 'active')
  assert.equal(license.plan, 'basic')
  assert.equal(license.seats, 3)
})

test('invalid dates and missing numbers become null, not NaN/Invalid', () => {
  const { license } = mapLicenseRecord({ id: '1', trial_end_at: 'not-a-date', licensed_user_limit: '' }, PUNTOS)
  assert.equal(license.trial_ends_at, null)
  assert.equal(license.seats, null)
})

test('isMappable rejects records without an id', () => {
  assert.equal(isMappable({ id: 'a' }, PUNTOS), true)
  assert.equal(isMappable({}, PUNTOS), false)
  assert.equal(isMappable({ id: '' }, PUNTOS), false)
})
