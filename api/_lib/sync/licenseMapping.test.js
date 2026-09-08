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

// Mirrors migration 0010: LIUMA's authoritative plan/expiry are license_tier /
// license_expires_at (licenseModel.js), not the vestigial subscription_plan /
// subscription_end_date.
const LIUMA = { id: 'liuma', config: { license_entity: 'SchoolSubscription', field_map: {
  tenant_external_id: 'school_id', name: 'school_id', plan: 'license_tier', status: 'subscription_status',
  seats: 'licensed_student_limit', trial_ends_at: 'trial_end_date', current_period_end: 'license_expires_at' } } }

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
    id: 'sub1', school_id: 'sch7', subscription_status: 'active', license_tier: 'growth',
    subscription_plan: 'trial', // vestigial — must be ignored in favor of license_tier
    licensed_student_limit: 300, license_expires_at: '2027-01-15T00:00:00Z',
    subscription_end_date: null, // never written by the app
  }, LIUMA)
  assert.equal(tenant.external_id, 'sch7')      // tenant keyed by school
  assert.equal(license.external_id, 'sub1')     // license keyed by its own id
  assert.equal(license.seats, 300)
  assert.equal(license.plan, 'growth')          // license_tier, not subscription_plan ('trial')
  assert.equal(license.current_period_end, '2027-01-15T00:00:00.000Z') // license_expires_at
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

// ── config.field_defaults (migration 0043) ────────────────────────────────
//
// The case these cover, verbatim from production: cateqhub's only parish was
// created 2026-07-22, before `plan`/`license_status`/`premium_period_end_at`
// existed on the Parish schema. A `.jsonc` default applies at creation, not
// retroactively, so the bridge ships a record with those keys ABSENT. The app
// resolves that to its permanent free tier; the bodega used to store null and
// the panel painted "—", which reads as a broken sync rather than "Gratis".
const CATEQHUB = { id: 'cateqhub', config: {
  license_entity: 'Parish',
  field_map: { tenant_external_id: 'id', name: 'name', plan: 'plan', status: 'license_status', current_period_end: 'premium_period_end_at' },
  field_defaults: { plan: 'free', status: 'active' },
} }

// The exact record shape observed in licenses.raw for that parish.
const PRE_SCHEMA_PARISH = {
  id: '6a602ae41f0618892e38611b', name: 'Parroquia San Testing', active: true,
  is_sample: false, created_date: '2026-07-22T02:28:52.171000',
  admin_contact: 'Jose Pablo Herrera', created_by_id: '6a5e79098ec761efd47be801',
}

test('field_defaults fill a licence field the record does not carry at all', () => {
  const { tenant, license } = mapLicenseRecord(PRE_SCHEMA_PARISH, CATEQHUB)
  assert.equal(tenant.name, 'Parroquia San Testing')
  assert.equal(license.plan, 'free')
  assert.equal(license.status, 'active')
  // No default declared for the period end, so it stays null — which is what
  // keeps renewal-reminders.js from selecting this row.
  assert.equal(license.current_period_end, null)
})

test('a real value always beats the default', () => {
  const { license } = mapLicenseRecord(
    { ...PRE_SCHEMA_PARISH, plan: 'premium', license_status: 'read_only' },
    CATEQHUB,
  )
  assert.equal(license.plan, 'premium')
  assert.equal(license.status, 'read_only')
})

// Base44 returns a cleared field as '', not as a missing key. Both must reach
// the default, or a parish that was explicitly emptied would still show "—".
test('an empty string counts as absent and takes the default', () => {
  const { license } = mapLicenseRecord({ ...PRE_SCHEMA_PARISH, plan: '', license_status: '' }, CATEQHUB)
  assert.equal(license.plan, 'free')
  assert.equal(license.status, 'active')
})

// The load-bearing half: portfolioLifecycle.js selects rows whose plan is in
// cfg.lifecycle.paidPlanValues, and those rows get status transitions and
// customer-facing renewal email. cateqhub's paid list is ['premium'], so the
// defaulted plan must stay OUT of it. If someone ever changes the default to a
// paid plan, this fails instead of quietly mailing a demo tenant.
test('the defaulted plan is not a paid plan, so the lifecycle cron skips it', () => {
  const { license } = mapLicenseRecord(PRE_SCHEMA_PARISH, CATEQHUB)
  assert.equal(['premium'].includes(license.plan), false)
})

test('an app with no field_defaults is unchanged', () => {
  const { license } = mapLicenseRecord({ id: 'b1', name: 'Cafe Luna' }, PUNTOS)
  assert.equal(license.plan, null)
  assert.equal(license.status, null)
})
