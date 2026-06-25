// Pure, testable mapping from a Base44 license-entity record → bodega rows.
//
// Each app names its license fields differently, so the registry row carries a
// `config.field_map` (see supabase/migrations/0004). We still fall back to a
// list of known candidate names so a missing/partial map degrades gracefully
// instead of producing nulls.

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
  const licenseExternalId = String(record?.[fm.external_id ?? 'id'] ?? record?.id ?? '')
  const tenantExternalId = String(record?.[fm.tenant_external_id ?? 'id'] ?? record?.id ?? '')

  const tenant = {
    app_id: app.id,
    external_id: tenantExternalId,
    name: pick(record, fm, 'name') ?? null,
  }

  const license = {
    app_id: app.id,
    external_id: licenseExternalId,
    plan: pick(record, fm, 'plan') ?? null,
    status: pick(record, fm, 'status') ?? null,
    seats: numOrNull(pick(record, fm, 'seats')),
    trial_ends_at: isoOrNull(pick(record, fm, 'trial_ends_at')),
    current_period_end: isoOrNull(pick(record, fm, 'current_period_end')),
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
