// Per-app config for the per-tenant consumption insight (Analytics F2.2). Each
// app's "primary usage entity" + its tenant FK field. The bridge counts that
// entity grouped by the field; Mission Control enriches tenant names locally.
export const USAGE_BY_TENANT = {
  flowfin:   { entity: 'Transaction',    tenantField: 'family_id',   label: 'transacciones' },
  stockflow: { entity: 'Movement',       tenantField: 'business_id', label: 'movimientos' },
  puntos:    { entity: 'LoyaltyAccount', tenantField: 'business_id', label: 'clientes de lealtad' },
  rumbo:     { entity: 'Trip',           tenantField: 'tenant_id',   label: 'viajes' },
  liuma:     { entity: 'Student',        tenantField: 'school_id',   label: 'alumnos' },
}

export function usageByTenantFor(appId) {
  return USAGE_BY_TENANT[appId] ?? null
}
