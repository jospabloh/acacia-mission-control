// Adapter for apps reached through an arbitrary external REST API.
// Config: { base_url, auth_header, auth_env } — auth_env names the env var with
// the bearer/token value injected into header `auth_header` (default Authorization).
function makeAdapter(app) {
  const base = app.config?.base_url
  const headerName = app.config?.auth_header || 'Authorization'
  const token = process.env[app.config?.auth_env || ''] || ''

  async function call(path, { method = 'GET', body } = {}) {
    if (!base) throw new Error(`external adapter for ${app.id} has no config.base_url`)
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', [headerName]: token },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`external ${app.id} ${method} ${path} → ${res.status}`)
    return res.status === 204 ? null : res.json()
  }

  return {
    app,
    kind: 'external',
    hasToken: Boolean(token),
    list: (path) => call(path),
    call,
    // No standard license shape; callers must implement per-app mapping.
    licenses: () => { throw new Error(`external adapter ${app.id}: implement licenses() per app`) },
  }
}

export default makeAdapter
