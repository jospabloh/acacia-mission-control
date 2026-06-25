#!/usr/bin/env node
// ============================================================================
// onboard-base44 — auto-discover a Base44 app repo and produce (or upsert) its
// Mission Control registry row.
//
//   node scripts/onboard-base44.js <repoPath> [--app-id <id>] [--slug <slug>]
//                                  [--url <url>] [--dry]
//
// Discovers, from the repo on disk:
//   • app name           ← base44/config.jsonc
//   • app id             ← --app-id | $BASE44_APP_ID | grep of repo
//   • entities           ← base44/entities/*.jsonc
//   • backend functions  ← base44/functions/* (dir or file per function)
//   • license entity     ← heuristic over entity names
//   • ticket entities    ← SupportTicket / SupportTicketMessage if present
//
// With --dry (default when no Supabase env): prints the proposed registry row.
// Otherwise upserts into public.apps using SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

// ── tiny arg parser ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flags = {}
const positionals = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    if (key === 'dry') flags.dry = true
    else flags[key] = argv[++i]
  } else positionals.push(a)
}
const repoPath = positionals[0]
if (!repoPath) {
  console.error('usage: node scripts/onboard-base44.js <repoPath> [--app-id id] [--slug s] [--url u] [--dry]')
  process.exit(1)
}

// ── helpers ─────────────────────────────────────────────────────────────────
// Strip // and /* */ comments so JSONC parses as JSON.
function readJsonc(path) {
  const raw = readFileSync(path, 'utf8')
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return JSON.parse(stripped)
}

function listDir(path) {
  try { return readdirSync(path) } catch { return [] }
}

function discoverAppId(repo) {
  if (flags['app-id']) return flags['app-id']
  if (process.env.BASE44_APP_ID) return process.env.BASE44_APP_ID
  // Grep likely files for a 24-hex Base44 app id.
  const candidates = [
    'base44/config.jsonc',
    'flowfin/docs/baseline/base44-schemas-2026-05-20.json',
  ].map((p) => join(repo, p)).filter(existsSync)
  for (const name of listDir(repo)) {
    if (/^\.env/.test(name)) candidates.push(join(repo, name))
  }
  for (const file of candidates) {
    try {
      const txt = readFileSync(file, 'utf8')
      const m = txt.match(/(?:app_?id["':=\s]+)([a-f0-9]{24})/i)
      if (m) return m[1]
    } catch { /* ignore */ }
  }
  return null
}

const LICENSE_HINTS = ['Business', 'TenantLicense', 'SchoolSubscription', 'Family', 'Subscription', 'License', 'Account']
function pickLicenseEntity(entities) {
  for (const hint of LICENSE_HINTS) if (entities.includes(hint)) return hint
  return null
}

// ── discovery ───────────────────────────────────────────────────────────────
const b44 = join(repoPath, 'base44')
if (!existsSync(b44)) {
  console.error(`✗ ${repoPath} has no base44/ dir — is this a Base44 app repo?`)
  process.exit(1)
}

let name = basename(repoPath)
try { name = readJsonc(join(b44, 'config.jsonc')).name || name } catch { /* keep default */ }

const entities = listDir(join(b44, 'entities'))
  .filter((f) => f.endsWith('.jsonc'))
  .map((f) => f.replace(/\.jsonc$/, ''))
  .sort()

const functions = listDir(join(b44, 'functions'))
  .filter((f) => !f.startsWith('_') && !/\.test\.[tj]s$/.test(f))
  .map((f) => f.replace(/\.[tj]s$/, ''))
  .filter((f, i, arr) => arr.indexOf(f) === i) // dedupe dir+file pairs
  .sort()

const appId = discoverAppId(repoPath)
const slug = flags.slug || basename(repoPath).replace(/[^a-z0-9_]/gi, '_').toLowerCase()
const licenseEntity = pickLicenseEntity(entities)
const hasTickets = entities.includes('SupportTicket')
const hasTicketMessages = entities.includes('SupportTicketMessage')

const config = {}
if (licenseEntity) config.license_entity = licenseEntity
if (hasTickets) config.ticket_entity = 'SupportTicket'
if (hasTicketMessages) config.ticket_message_entity = 'SupportTicketMessage'

const row = {
  id: slug,
  name,
  backend: 'base44',
  external_id: appId,
  url: flags.url || null,
  config,
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n▸ ${name}  (${repoPath})`)
console.log(`  app id     : ${appId ?? '⚠ not found — pass --app-id'}`)
console.log(`  slug       : ${slug}`)
console.log(`  entities   : ${entities.length} (${entities.slice(0, 8).join(', ')}${entities.length > 8 ? '…' : ''})`)
console.log(`  functions  : ${functions.length}${functions.length ? ` (${functions.slice(0, 6).join(', ')}${functions.length > 6 ? '…' : ''})` : ''}`)
console.log(`  license    : ${licenseEntity ?? '⚠ none detected'}`)
console.log(`  tickets    : ${hasTickets ? 'yes' : 'no'}`)
console.log(`  registry row:\n${JSON.stringify(row, null, 2)}`)

const hasSupabaseEnv = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
if (flags.dry || !hasSupabaseEnv) {
  if (!flags.dry && !hasSupabaseEnv) {
    console.log('\n(no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → dry run, nothing written)')
  }
  process.exit(0)
}

// ── upsert ──────────────────────────────────────────────────────────────────
const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const { error } = await supabase.from('apps').upsert(row, { onConflict: 'id' })
if (error) { console.error('✗ upsert failed:', error.message); process.exit(1) }
console.log(`\n✓ upserted apps/${slug}`)
