// Health probe for one app → one app_health row. Base44 apps are probed through
// their acaciaControl bridge (`ping`); apps that expose a public URL (sites,
// external) are probed with a plain HTTP request. Latency is measured here.
// Classification: ok (responds fast) | degraded (responds slow / unexpected) |
// down (error or timeout). Shared by the daily cron and the on-demand control.
import { supabaseAdmin } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'

const DEGRADED_MS = 2000   // slower than this but still responding → degraded
const HTTP_TIMEOUT_MS = 8000

async function probeHttp(url) {
  const start = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS)
  try {
    // Some hosts reject HEAD; GET is the safe default. We only need the status.
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal })
    const latency = Date.now() - start
    if (res.ok || (res.status >= 300 && res.status < 400)) {
      return { status: latency > DEGRADED_MS ? 'degraded' : 'ok', latency, detail: { http: res.status } }
    }
    return { status: res.status >= 500 ? 'down' : 'degraded', latency, detail: { http: res.status } }
  } catch (e) {
    return { status: 'down', latency: Date.now() - start, detail: { error: e.name === 'AbortError' ? 'timeout' : e.message } }
  } finally {
    clearTimeout(timer)
  }
}

async function probeBridge(app) {
  const start = Date.now()
  try {
    const out = await callBridge(app, 'ping')
    const latency = Date.now() - start
    const ok = out?.ok ?? out?.pong ?? out?.data?.ok
    if (ok) return { status: latency > DEGRADED_MS ? 'degraded' : 'ok', latency, detail: { via: 'bridge' } }
    return { status: 'degraded', latency, detail: { via: 'bridge', note: 'ping sin ok' } }
  } catch (e) {
    return { status: 'down', latency: Date.now() - start, detail: { via: 'bridge', error: e.message } }
  }
}

// Probe one app and persist the result. Returns { app, status, latency_ms }.
export async function probeAppHealth(app) {
  let result
  if (app.backend === 'base44') {
    if (!bridgeConfigured()) result = { status: 'down', latency: null, detail: { error: 'INGEST_HMAC_SECRET no configurado' } }
    else result = await probeBridge(app)
  } else if (app.url) {
    result = await probeHttp(app.url)
  } else {
    return { app: app.id, skipped: 'sin puente ni url' }
  }

  const row = { app_id: app.id, status: result.status, latency_ms: result.latency ?? null, detail: result.detail ?? {} }
  const { error } = await supabaseAdmin.from('app_health').insert(row)
  if (error) throw new Error(`app_health insert: ${error.message}`)
  return { app: app.id, status: result.status, latency_ms: result.latency ?? null }
}
