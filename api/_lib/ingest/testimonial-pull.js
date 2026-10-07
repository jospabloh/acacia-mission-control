// Real-time testimonial PULL (contract §2). Same trust model as ticket-pull.js:
// the app's browser pings with {app, testimonialId} and NOTHING else in the
// body is trusted — Mission Control reads the authoritative record over the
// signed acaciaControl bridge (`testimonials.get`), so a forged ping can't
// publish anything. CORS-open, no secret, because it's a browser target.
//
// The response discloses nothing: `{ ok: true }` / 200 for every well-formed
// request, whatever happened (unknown app, unknown id, app without the module,
// bridge down). 400 only for a malformed body. The outcome goes to the log.
import { supabaseAdmin } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { processIncomingTestimonial, processMissingTestimonial } from '../ingestTestimonial.js'
import { isUnknownAction } from '../testimonials.js'

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/

const defaults = {
  getApp: async (id) => {
    const { data, error } = await supabaseAdmin.from('apps').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data
  },
  bridgeConfigured,
  callBridge,
  processIncoming: processIncomingTestimonial,
  processMissing: processMissingTestimonial,
  log: (msg) => console.log(`[testimonial-pull] ${msg}`),
}

// Pure-ish core: returns { status, json, outcome }. `deps` is injectable for tests.
export async function runPing(body, deps = {}) {
  const d = { ...defaults, ...deps }
  const { app: appId, testimonialId } = body ?? {}
  if (typeof appId !== 'string' || !appId || !ID_RE.test(String(testimonialId ?? ''))) {
    return { status: 400, json: { error: 'falta app/testimonialId' }, outcome: 'malformed' }
  }
  const done = (outcome) => { d.log(`app=${appId} id=${testimonialId} ${outcome}`); return { status: 200, json: { ok: true }, outcome } }
  try {
    if (!d.bridgeConfigured()) return done('bridge no configurado')
    const app = await d.getApp(appId)
    if (!app || app.backend !== 'base44') return done('app desconocida')

    let out
    try {
      out = await d.callBridge(app, 'testimonials.get', { id: String(testimonialId) })
    } catch (e) {
      return done(isUnknownAction(e) ? 'app sin módulo' : `bridge: ${e.message}`)
    }
    const res = out?.data ?? out
    if (res?.ok !== true || res.record === undefined) return done('respuesta del puente inválida')
    if (res.record === null) return done(`ausente en la app: ${(await d.processMissing({ app, externalId: testimonialId })).reason}`)

    const r = await d.processIncoming({ app, record: res.record, tenantName: res.tenant_name ?? null })
    return done(`${r.reason}${r.notified ? ' (avisado)' : ''}`)
  } catch (e) {
    return done(`error: ${e.message}`)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const { status, json } = await runPing(req.body)
  return res.status(status).json(json)
}
