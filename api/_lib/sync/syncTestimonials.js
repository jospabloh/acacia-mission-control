// Daily-sync backstop for testimonials (contract §4): lists each app's
// Testimonial records over the bridge (`testimonials.list`, always the full
// list) and feeds the same upsert as the ping. A successful list is also what
// reveals deletions: a stored row the app no longer lists is treated as
// withdrawn. Apps that haven't adopted the module answer `unknown action:
// testimonials.list` — a silent skip. Any other failure is reported as an
// error for this section (the caller keeps syncing the rest). `deps` is
// injectable so the tests need neither the bridge nor Supabase.
import { callBridge } from '../appBridge.js'
import { processIncomingTestimonial, processMissingTestimonial, listStoredTestimonials } from '../ingestTestimonial.js'
import { isUnknownAction, missingFromList } from '../testimonials.js'

export async function syncTestimonialsForApp(app, deps = {}) {
  const call = deps.call ?? callBridge
  const process = deps.process ?? processIncomingTestimonial
  const processMissing = deps.processMissing ?? processMissingTestimonial
  const listStored = deps.listStored ?? listStoredTestimonials

  // MC's own clock when the list call STARTS: every observation this sync makes
  // (upserts and absences) is stamped with it, and applied only if strictly
  // later than the row's observed_at.
  const observedAt = new Date().toISOString()
  let out
  try {
    out = await call(app, 'testimonials.list', {})
  } catch (e) {
    if (isUnknownAction(e)) return { app: app.id, skipped: 'sin módulo de testimonios' }
    return { app: app.id, error: `bridge: ${e.message}` }
  }
  const body = out?.data ?? out
  // Only a well-formed answer may delete anything: a malformed one must never
  // look like "the app has no testimonials".
  if (body?.ok !== true || !Array.isArray(body.records)) return { app: app.id, error: 'bridge returned no records array' }

  let stored = 0
  let firstError = null
  const attempt = async (fn) => {
    try { return await fn() } catch (e) { firstError ??= e.message; return null }
  }
  for (const record of body.records) {
    const r = await attempt(() => process({ app, record, observedAt }))
    if (r?.stored) stored += 1
  }
  const rows = await attempt(() => listStored(app.id))
  for (const row of missingFromList(rows ?? [], body.records)) {
    const r = await attempt(() => processMissing({ app, externalId: row.external_id, observedAt }))
    if (r?.stored) stored += 1
  }
  return { app: app.id, testimonials: body.records.length, stored, ...(firstError ? { error: firstError } : {}) }
}
