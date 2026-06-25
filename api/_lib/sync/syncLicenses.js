// Per-app license sync: read an app's license entity through its HMAC-signed
// acaciaControl bridge and upsert normalized tenant + license rows into the
// bodega. Idempotent (upsert on natural keys). Shared by the daily cron and the
// on-demand control endpoint so both behave identically.
import { supabaseAdmin } from '../supabaseAdmin.js'
import { callBridge } from '../appBridge.js'
import { mapLicenseRecord, isMappable } from './licenseMapping.js'

function dedupeBy(arr, keyFn) {
  const seen = new Map()
  for (const item of arr) if (!seen.has(keyFn(item))) seen.set(keyFn(item), item)
  return [...seen.values()]
}

export async function syncLicensesForApp(app) {
  const entity = app.config?.license_entity
  if (!entity) return { app: app.id, skipped: 'no license_entity in config' }

  let result
  try {
    result = await callBridge(app, 'licenses.list', { entity })
  } catch (e) {
    return { app: app.id, skipped: `bridge unreachable: ${e.message}` }
  }
  const records = result?.records ?? result?.data?.records ?? []
  if (!Array.isArray(records)) return { app: app.id, error: 'bridge returned no records array' }

  const mapped = records.filter((r) => isMappable(r, app)).map((r) => mapLicenseRecord(r, app))

  const tenants = dedupeBy(mapped.map((m) => m.tenant), (t) => t.external_id)
  const { data: tRows, error: tErr } = await supabaseAdmin
    .from('tenants').upsert(tenants, { onConflict: 'app_id,external_id' }).select('id, external_id')
  if (tErr) throw new Error(`tenants upsert: ${tErr.message}`)

  const idByExt = Object.fromEntries(tRows.map((r) => [r.external_id, r.id]))
  const now = new Date().toISOString()
  const licenses = mapped.map((m) => ({
    ...m.license,
    tenant_id: idByExt[m.tenant.external_id] ?? null,
    synced_at: now,
  }))
  const { error: lErr } = await supabaseAdmin
    .from('licenses').upsert(licenses, { onConflict: 'app_id,external_id' })
  if (lErr) throw new Error(`licenses upsert: ${lErr.message}`)

  return { app: app.id, records: records.length, tenants: tenants.length, licenses: licenses.length }
}
