// Generic Base44 REST adapter.
//
// Mission Control reads/writes each Base44 app directly over its REST API as
// role:admin (service token), per the architecture: the app's own backend is
// the source of truth — no parallel copy of permissions, only a synced read
// model in the bodega.
//
// Base44 entity REST shape (v1):
//   GET    {BASE}/api/apps/{appId}/entities/{Entity}            → list
//   GET    {BASE}/api/apps/{appId}/entities/{Entity}/{id}       → one
//   POST   {BASE}/api/apps/{appId}/entities/{Entity}            → create
//   PUT    {BASE}/api/apps/{appId}/entities/{Entity}/{id}       → update
// Auth: `api_key: <service token>` header.

const BASE44_API = process.env.BASE44_API_BASE || 'https://app.base44.com'

// Resolve the service token for a given app id. Prefer a per-app token
// (BASE44_TOKEN_<APPID_UPPER>), else fall back to a single shared token.
function tokenFor(appId) {
  const perApp = process.env[`BASE44_TOKEN_${String(appId).toUpperCase()}`]
  return perApp || process.env.BASE44_SERVICE_TOKEN || ''
}

function makeAdapter(app) {
  const appId = app.external_id
  const token = tokenFor(appId)

  async function call(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${BASE44_API}/api/apps/${appId}/entities${path}`)
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        api_key: token,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`base44 ${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
    }
    if (res.status === 204) return null
    return res.json()
  }

  return {
    app,
    kind: 'base44',
    hasToken: Boolean(token),

    // List records of an entity. `params` → Base44 query (limit, sort, filters).
    list: (entity, params = {}) => call(`/${entity}`, { query: params }),
    get: (entity, id) => call(`/${entity}/${id}`),
    create: (entity, data) => call(`/${entity}`, { method: 'POST', body: data }),
    update: (entity, id, data) => call(`/${entity}/${id}`, { method: 'PUT', body: data }),

    // Convenience: licenses for this app, using the configured license entity.
    licenses: (params = {}) => {
      const entity = app.config?.license_entity
      if (!entity) throw new Error(`app ${app.id} has no config.license_entity`)
      return call(`/${entity}`, { query: params })
    },
  }
}

export default makeAdapter
