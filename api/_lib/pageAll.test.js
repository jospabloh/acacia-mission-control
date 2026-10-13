import test from 'node:test'
import assert from 'node:assert/strict'
import { pageAll } from './pageAll.js'

// Fake table of ids 1..n served `size` rows at a time, keyset by id.
const table = (n, size) => {
  const calls = []
  const fetchPage = async (after) => {
    calls.push(after)
    const out = []
    for (let id = after + 1; id <= n && out.length < size; id++) out.push({ id })
    return out
  }
  return { fetchPage, calls }
}

test('stops on an empty page and passes rows through in order', async () => {
  const { fetchPage, calls } = table(7, 3)
  const r = await pageAll(fetchPage)
  assert.deepEqual(r.rows.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(r.truncated, false)
  assert.deepEqual(calls, [0, 3, 6, 7]) // keyset: each call starts after the last id; last call is the empty one
})

test('short pages (server max-rows below the requested size) do not end the loop early', async () => {
  const { fetchPage } = table(10, 2) // we "ask" for 1000, server only gives 2
  const r = await pageAll(fetchPage)
  assert.equal(r.rows.length, 10)
  assert.equal(r.truncated, false)
})

test('empty table: one call, no rows', async () => {
  const { fetchPage, calls } = table(0, 5)
  const r = await pageAll(fetchPage)
  assert.deepEqual(r, { rows: [], truncated: false })
  assert.equal(calls.length, 1)
})

test('cap reached: reports truncated and stops fetching', async () => {
  const { fetchPage, calls } = table(100, 2)
  const r = await pageAll(fetchPage, { maxPages: 3 })
  assert.equal(r.truncated, true)
  assert.equal(r.rows.length, 6)
  assert.equal(calls.length, 3)
})

test('data ending exactly at the cap is not reported as truncated only if an empty page was reached', async () => {
  const { fetchPage } = table(6, 2)
  assert.equal((await pageAll(fetchPage, { maxPages: 3 })).truncated, true) // 3 full pages, no empty page seen: cannot prove completeness
  assert.equal((await pageAll(fetchPage, { maxPages: 4 })).truncated, false)
})

test('errors from fetchPage propagate', async () => {
  const fetchPage = async (after) => { if (after > 0) throw new Error('boom'); return [{ id: 1 }] }
  await assert.rejects(pageAll(fetchPage), /boom/)
})
