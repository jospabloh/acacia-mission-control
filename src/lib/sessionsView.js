// Client-side session helpers. Mirrors the thresholds in api/_lib/sessions.js
// (kept in sync by hand — server code must never be imported into the bundle).
// Used by the dashboard to aggregate the bodega's app_sessions rows and by the
// detail panel to format idle durations.

export const IDLE_MS = 30 * 60_000            // ≥30min → idle (cerrable)
export const OPEN_WINDOW_MS = 24 * 60 * 60_000 // sin actividad >24h → terminada

function idleOf(row, now) {
  const t = Date.parse(row?.last_active_at ?? '')
  return Number.isFinite(t) ? Math.max(0, now - t) : Infinity
}

export function isRowOpen(row, now) {
  return !row?.revoked_at && idleOf(row, now) <= OPEN_WINDOW_MS
}
export function isRowOnline(row, now) {
  return idleOf(row, now) < IDLE_MS
}

// { app_id -> { open, online } } from raw app_sessions rows.
export function aggregateByApp(rows, now) {
  const m = {}
  for (const r of rows ?? []) {
    if (!isRowOpen(r, now)) continue
    const a = (m[r.app_id] ??= { open: 0, online: 0 })
    a.open++
    if (isRowOnline(r, now)) a.online++
  }
  return m
}

// Human idle label in Spanish: "40 s", "52 min", "3 h 12 min".
export function fmtIdle(ms) {
  if (!Number.isFinite(ms)) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem ? `${h} h ${rem} min` : `${h} h`
}
