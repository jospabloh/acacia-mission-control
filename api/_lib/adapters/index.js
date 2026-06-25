// Adapter factory: given an app registry row, return the right backend adapter.
// All adapters share a common surface: { app, kind, hasToken, list(), licenses() }.
import base44 from './base44.js'
import supabaseApp from './supabaseApp.js'
import external from './external.js'
import static_ from './static.js'

const FACTORIES = {
  base44,
  supabase: supabaseApp,
  external,
  static: static_,
}

export function adapterFor(app) {
  const factory = FACTORIES[app?.backend]
  if (!factory) throw new Error(`no adapter for backend "${app?.backend}" (app ${app?.id})`)
  return factory(app)
}

export { base44, supabaseApp, external }
