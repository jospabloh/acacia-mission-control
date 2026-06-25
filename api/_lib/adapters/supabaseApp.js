// Adapter for apps whose own backend is a separate Supabase project.
// Config: { supabase_url, supabase_service_env } where supabase_service_env
// names the env var holding that app's service_role key.
import { createClient } from '@supabase/supabase-js'

function makeAdapter(app) {
  const url = app.config?.supabase_url
  const key = process.env[app.config?.supabase_service_env || '']
  const client = url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null

  return {
    app,
    kind: 'supabase',
    hasToken: Boolean(client),
    list: async (table, { limit = 1000 } = {}) => {
      if (!client) throw new Error(`supabaseApp adapter for ${app.id} not configured`)
      const { data, error } = await client.from(table).select('*').limit(limit)
      if (error) throw new Error(`supabaseApp ${app.id}.${table}: ${error.message}`)
      return data
    },
    licenses: function (params) { return this.list(app.config?.license_entity || 'licenses', params) },
  }
}

export default makeAdapter
