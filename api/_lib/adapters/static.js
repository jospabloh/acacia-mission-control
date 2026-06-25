// Adapter for static / brochure apps (no live backend, e.g. acaciaco-site).
// Everything resolves to empty; present so the registry can list every app
// uniformly without special-casing the ones that have nothing to sync.
function makeAdapter(app) {
  return {
    app,
    kind: 'static',
    hasToken: true,
    list: async () => [],
    licenses: async () => [],
  }
}

export default makeAdapter
