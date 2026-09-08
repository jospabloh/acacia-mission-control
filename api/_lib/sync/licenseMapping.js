// Pure, testable mapping from a Base44 license-entity record → bodega rows.
//
// Each app names its license fields differently, so the registry row carries a
// `config.field_map` (see supabase/migrations/0004). We still fall back to a
// list of known candidate names so a missing/partial map degrades gracefully
// instead of producing nulls.
//
// `config.field_defaults` (migration 0043) is the third step, and it exists for
// a real case: a tenant row created BEFORE a licence field was added to the
// app's schema does not carry that field at all — a `.jsonc` `default` applies
// at creation, not retroactively. The app itself resolves the absence (cateqhub
// reads a missing `plan` as its permanent free tier, `getLicenseStatus` in
// src/lib/premium.js), but the bridge ships the raw record, so the bodega used
// to store `null` and the Licences panel painted "—" — indistinguishable from a
// broken sync. A default declared here teaches the reading side the same
// resolution the app already performs, for every such tenant rather than one
// row, and without writing to the app's production data.
//
// A default must mirror what the app actually does with the absent field, and
// it is load-bearing beyond display: `portfolioLifecycle.js` selects rows whose
// plan is in `cfg.lifecycle.paidPlanValues`. Defaulting a plan INTO that list
// would sweep tenants into the licence cron and its customer emails. cateqhub's
// paid list is ['premium'] and its default is 'free', deliberately outside it.

const CANDIDATES = {
  name:               ['name', 'tenant_name', 'business_name', 'school_name', 'family_name'],
  plan:               ['license_plan', 'plan', 'subscription_plan', 'license_tier', 'tier'],
  status:             ['billing_status', 'status', 'subscription_status', 'license_status'],
  seats:              ['licensed_user_limit', 'licensed_member_limit', 'licensed_student_limit', 'max_drivers', 'seats'],
  trial_ends_at:      ['trial_end_at', 'trial_ends_at', 'trial_end_date'],
  current_period_end: ['license_expires_at', 'current_period_end', 'subscription_end_date', 'renews_at'],
}

function firstDefined(record, keys) {
  for (const k of keys) {
    const v = record?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

// Resolve a logical field: explicit field_map wins, else known candidates.
function pick(record, fieldMap, field) {
  const mapped = fieldMap?.[field]
  if (mapped && record?.[mapped] !== undefined) return record[mapped]
  return firstDefined(record, CANDIDATES[field] ?? [])
}

// pick(), then the registry's declared default when the record carries nothing
// usable for this field. Same emptiness test as firstDefined() so '' counts as
// absent, matching how Base44 returns a cleared field.
function pickOr(record, fieldMap, fieldDefaults, field) {
  const v = pick(record, fieldMap, field)
  if (v !== undefined && v !== null && v !== '') return v
  const fallback = fieldDefaults?.[field]
  return fallback === undefined ? v : fallback
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Base44 returns ISO date-time strings; pass valid ones through, else null.
function isoOrNull(v) {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// Map one record to { tenant, license }. `app` is the registry row.
export function mapLicenseRecord(record, app) {
  const fm = app?.config?.field_map ?? {}
  const fd = app?.config?.field_defaults ?? {}
  const licenseExternalId = String(record?.[fm.external_id ?? 'id'] ?? record?.id ?? '')
  const tenantExternalId = String(record?.[fm.tenant_external_id ?? 'id'] ?? record?.id ?? '')

  const tenant = {
    app_id: app.id,
    external_id: tenantExternalId,
    name: pick(record, fm, 'name') ?? null,
  }

  // Tenant name deliberately keeps plain pick(): a defaulted name would put a
  // placeholder where an operator expects the tenant's real one.
  const license = {
    app_id: app.id,
    external_id: licenseExternalId,
    plan: pickOr(record, fm, fd, 'plan') ?? null,
    status: pickOr(record, fm, fd, 'status') ?? null,
    seats: numOrNull(pickOr(record, fm, fd, 'seats')),
    trial_ends_at: isoOrNull(pickOr(record, fm, fd, 'trial_ends_at')),
    current_period_end: isoOrNull(pickOr(record, fm, fd, 'current_period_end')),
    raw: record ?? {},
  }

  return { tenant, license }
}

// Guard: a record with no usable id can't be upserted (unique key is external_id).
export function isMappable(record, app) {
  const fm = app?.config?.field_map ?? {}
  const id = record?.[fm.external_id ?? 'id'] ?? record?.id
  return id !== undefined && id !== null && String(id) !== ''
}
