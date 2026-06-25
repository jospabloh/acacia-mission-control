// Server-side Base44 client, one per app, authenticated with that app's service
// token. Mission Control reads each app's data directly as an admin (per the
// architecture: the app's backend is the source of truth).
//
// Token resolution: a per-app token BASE44_TOKEN_<APPID_UPPER> wins, else a
// single shared BASE44_SERVICE_TOKEN. Generate these in each Base44 app and set
// them in Vercel env (see DEPLOY.md). Without a token the app is skipped.
import { createClient } from '@base44/sdk'

export function tokenFor(appExternalId) {
  const perApp = process.env[`BASE44_TOKEN_${String(appExternalId).toUpperCase()}`]
  return perApp || process.env.BASE44_SERVICE_TOKEN || ''
}

export function clientFor(app) {
  const token = tokenFor(app.external_id)
  const client = createClient({ appId: app.external_id })
  if (token) client.setToken(token, false) // false → don't persist to storage
  return { client, hasToken: Boolean(token) }
}

// Page through an entity (Base44 caps list/filter at 5,000 per request).
export async function listAll(entityApi, { pageSize = 500, max = 50000 } = {}) {
  const out = []
  for (let skip = 0; out.length < max; skip += pageSize) {
    const batch = await entityApi.list('-created_date', pageSize, skip)
    if (!batch?.length) break
    out.push(...batch)
    if (batch.length < pageSize) break
  }
  return out
}
