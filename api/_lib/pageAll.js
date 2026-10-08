// Keyset pagination loop, import-free so `node --test` loads it.
//
// `fetchPage(afterId)` returns the next rows with id > afterId, ordered by id
// ascending (rows must carry `id`). The loop ends ONLY on an empty page: a page
// shorter than the size we asked for does not mean "last page", because the
// server may cap rows per request (PostgREST `max-rows`) below our page size.
// At `maxPages` it stops and reports `truncated: true` instead of silently
// under-counting. Errors from fetchPage propagate.
export async function pageAll(fetchPage, { maxPages = 60 } = {}) {
  const rows = []
  let afterId = 0
  for (let page = 0; ; page++) {
    if (page === maxPages) return { rows, truncated: true }
    const data = await fetchPage(afterId)
    if (!data?.length) return { rows, truncated: false }
    for (const r of data) rows.push(r)
    afterId = data[data.length - 1].id
  }
}
