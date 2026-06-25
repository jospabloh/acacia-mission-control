// Cron: for every Base44 app in the registry, read its license entity and upsert
// the normalized tenant + license rows into the bodega. Idempotent (upsert on
// the natural keys). Scheduled in vercel.json; also runnable on demand.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { mapLicenseRecord, isMappable } from '../_lib/sync/licenseMapping.js'

function dedupeBy(arr, keyFn) {
  const seen = new Map()
  for (const item of arr) if (!seen.has(keyFn(item))) seen.set(keyFn(item), item)
  return [...seen.values()]
}

async function syncApp(app) {
  const entity = app.config?.license_entity
  if (!entity) return { app: app.id, skipped: 'no license_entity in config' }

  // Read the app's licenses through its HMAC-signed acaciaControl bridge.
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

export default async function handler(req, res) {
  // Gate: when CRON_SECRET is set, require it (Vercel sends it as a Bearer);
  // Vercel cron requests also carry the x-vercel-cron header.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) return res.status(500).json({ error: error.message })

  if (!bridgeConfigured()) {
    return res.status(200).json({
      ok: true, apps: apps.length, synced: 0,
      note: 'INGEST_HMAC_SECRET no está configurado — ponlo en Vercel y en cada app Base44.',
      summary: apps.map((a) => ({ app: a.id, skipped: 'INGEST_HMAC_SECRET not set' })),
    })
  }

  const summary = []
  for (const app of apps) {
    try { summary.push(await syncApp(app)) }
    catch (e) { summary.push({ app: app.id, error: e.message }) }
  }

  await audit('sync-licenses', { payload: { summary } })
  const synced = summary.filter((s) => s.licenses != null)
  return res.status(200).json({ ok: true, apps: summary.length, synced: synced.length, summary })
}
