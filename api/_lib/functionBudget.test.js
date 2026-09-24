import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Vercel counts every non-underscore file under api/ as a serverless function
// and the Hobby plan caps the project at 12. Going over doesn't fail the build —
// it fails the deploy after it, which is how PR #110 went red. Catch it here.
const LIMIT = 12

function functionsUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('_')) return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return functionsUnder(p)
    return /\.(js|ts)$/.test(name) && !/\.test\.(js|ts)$/.test(name) ? [p] : []
  })
}

test(`api/ stays within Vercel's ${LIMIT}-function budget`, () => {
  const fns = functionsUnder('api')
  assert.ok(fns.length <= LIMIT,
    `${fns.length} functions (limit ${LIMIT}); route new endpoints through a dynamic [..].js dispatcher:\n  ${fns.join('\n  ')}`)
})
