// Pure, import-free so it's independently unit-testable (same reasoning as
// acaciaco-site's api/roseta/_adminAuth.ts: keep validation logic free of
// imports that would need a bundler). `null` keeps meaning "ordinary sales
// lead" — only acaciaco-site's api/soporte-apps.ts ever sends a `type`.
export const LEAD_TYPES = ['soporte', 'mejora', 'idea']

export function normalizeLeadType(v) {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  return LEAD_TYPES.includes(s) ? s : null
}
