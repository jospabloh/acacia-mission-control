// Pure aggregation behind api/apps-visits.js. Import-free on purpose so
// `node --test` loads it (see visitsAggregate.test.js).
//
// "Previous calendar month" is computed from today's date in the
// America/Mexico_City calendar (the owner's calendar), but rows are matched on
// the `web_events.day` column AS IS. That column is a UTC date
// (`(now() at time zone 'utc')::date`), so a pageview at 8pm Mexico time on the
// last day of a month is stored under the NEXT day. Exact Mexico-City month
// edges are not recoverable from `day` alone; at most the last ~6 hours of a
// month leak into the following one. Accepted: it only moves a handful of
// views between adjacent months and never changes who is on top in practice.

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' for `now` in America/Mexico_City.
export function mexicoCityDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

// Previous calendar month relative to a 'YYYY-MM-DD' date.
// Returns { month: 'YYYY-MM', start: 'YYYY-MM-01', endExclusive: first day of the given date's month }.
export function previousMonth(ymd) {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7))
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return {
    month: `${py}-${pad(pm)}`,
    start: `${py}-${pad(pm)}-01`,
    endExclusive: `${y}-${pad(m)}-01`,
  }
}

// Highest visitsMonth; ties go to the earliest slug in `order`; null when all 0.
function top(order, buckets) {
  let best = null
  let bestN = 0
  for (const slug of order) {
    const n = buckets[slug]?.visitsMonth ?? 0
    if (n > bestN) { best = slug; bestN = n }
  }
  return best
}

// rows: [{ path, day }] with day 'YYYY-MM-DD'. `now` is a Date.
// visits30 / visits7 keep the original semantics exactly: UTC-based windows
// (today-29d / today-6d), every row with day >= since counted.
export function aggregateVisits({ rows, appSlugs, freewareSlugs, now = new Date() }) {
  const since30 = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)
  const since7 = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)
  const prev = previousMonth(mexicoCityDate(now))

  const fresh = () => ({ visits30: 0, visits7: 0, visitsMonth: 0 })
  const visits = {}
  for (const slug of appSlugs) visits[slug] = fresh()
  const freeware = {}
  for (const slug of freewareSlugs) freeware[slug] = fresh()

  for (const row of rows ?? []) {
    let bucket
    if (row.path.startsWith('/apps/')) bucket = visits[row.path.slice('/apps/'.length)]
    else if (row.path.startsWith('/freeware/')) bucket = freeware[row.path.slice('/freeware/'.length)]
    if (!bucket) continue // unknown path
    if (row.day >= since30) {
      bucket.visits30++
      if (row.day >= since7) bucket.visits7++
    }
    if (row.day >= prev.start && row.day < prev.endExclusive) bucket.visitsMonth++
  }

  return {
    since30,
    // Earliest `day` the query must fetch to cover every counter.
    windowStart: prev.start < since30 ? prev.start : since30,
    month: prev.month,
    visits,
    freeware,
    topApp: top(appSlugs, visits),
    topFreeware: top(freewareSlugs, freeware),
  }
}
