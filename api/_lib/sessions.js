// Pure session logic shared by the sync, the live read and the revoke enforcement.
// No I/O here — everything takes an explicit `now` (ms) so it is deterministic
// and testable. The three endpoints (sync bodega, `sessions` live read,
// `session-revoke`) all derive idle/state from these helpers so the 30-min rule
// is defined in exactly one place.

// Constants. Mirror `HEARTBEAT_MS` in each app's client heartbeat.
export const HEARTBEAT_MS = 60_000            // client updates last_active_at every ~60s
export const IDLE_MS = 30 * 60_000            // ≥30min idle → "idle" (cerrable); <30min → "en línea"
export const OPEN_WINDOW_MS = 24 * 60 * 60_000 // sin actividad > 24h → sesión terminada (no cuenta)

// Milliseconds since a session's last heartbeat. Non-finite timestamps → Infinity
// (treated as maximally idle / long gone).
export function idleMs(session, now) {
  const t = Date.parse(session?.last_active_at ?? '')
  return Number.isFinite(t) ? Math.max(0, now - t) : Infinity
}

// Is this session revoked? (bridge sets revoked_at when MC forces a logout)
export function isRevoked(session) {
  return Boolean(session?.revoked_at)
}

// A session is "open" (counts toward the portfolio number) when it is not revoked
// and has heartbeated within the open window. Older → considered ended.
export function isOpen(session, now) {
  return !isRevoked(session) && idleMs(session, now) <= OPEN_WINDOW_MS
}

// 'online' = moving the app right now (idle < 30min). 'idle' = open but quiet ≥30min.
export function sessionState(session, now) {
  return idleMs(session, now) < IDLE_MS ? 'online' : 'idle'
}

// Normalize one raw bridge record into MC's session shape (+ derived idle/state).
// `raw` fields come from the app's AppSession entity; `id` is the Base44 record id.
export function normalizeSession(rec, now) {
  const s = {
    external_id: String(rec.id ?? rec.external_id ?? ''),
    user_email: rec.user_email ?? null,
    user_name: rec.user_name ?? null,
    device: rec.device ?? null,
    started_at: rec.started_at ?? null,
    last_active_at: rec.last_active_at ?? null,
    revoked_at: rec.revoked_at ?? null,
  }
  return { ...s, idle_ms: idleMs(s, now), state: sessionState(s, now), revoked: isRevoked(s) }
}

// Normalize + keep only open sessions, sorted most-recently-active first.
export function normalizeOpenSessions(records, now) {
  return (records ?? [])
    .map((r) => normalizeSession(r, now))
    .filter((s) => isOpen(s, now))
    .sort((a, b) => a.idle_ms - b.idle_ms)
}

// Group open sessions by user for the detail view. Each group carries counts so
// the UI can show "1 en línea · 2 idle" and pick a per-user badge.
export function groupByUser(sessions) {
  const byUser = new Map()
  for (const s of sessions) {
    const key = s.user_email || '(sin usuario)'
    if (!byUser.has(key)) {
      byUser.set(key, { user_email: s.user_email, user_name: s.user_name, sessions: [], online: 0, idle: 0 })
    }
    const g = byUser.get(key)
    g.sessions.push(s)
    if (s.state === 'online') g.online++; else g.idle++
    if (!g.user_name && s.user_name) g.user_name = s.user_name
  }
  // Users with someone online first, then by most-recently-active session.
  return [...byUser.values()].sort((a, b) =>
    (b.online - a.online) || (a.sessions[0].idle_ms - b.sessions[0].idle_ms))
}

// Totals for the header / dashboard.
export function summarize(sessions) {
  let online = 0, idle = 0
  for (const s of sessions) { if (s.state === 'online') online++; else idle++ }
  return { open: sessions.length, online, idle }
}

// ── Revoke enforcement (the 30-min rule, server-side) ────────────────────────

// Can the operator close ONE session right now? Active sessions (<30min idle) are
// blocked unless the operator is `owner` AND explicitly overrides. Acts on the
// already-derived `session.state`, so no clock is needed.
export function canRevoke(session, { role, override } = {}) {
  if (session.state === 'idle') return { ok: true }
  // online → protected
  if (override && role === 'owner') return { ok: true, forced: true }
  return {
    ok: false,
    reason: role === 'owner'
      ? 'sesión activa: confirma el forzado (override) para cerrarla'
      : 'sesión activa: solo el owner puede forzar el cierre',
  }
}

// Split a user's sessions for the bulk "close all idle" action: revoke the idle
// ones, skip (and count) the active ones. Uses the derived `state`.
export function partitionForBulk(sessions) {
  const closable = []
  let skippedActive = 0
  for (const s of sessions) {
    if (s.state === 'idle') closable.push(s)
    else skippedActive++
  }
  return { closableIds: closable.map((s) => s.external_id), closable, skippedActive }
}

// "Log off user" — every one of a user's sessions, idle AND active. Unlike
// partitionForBulk, nothing is skipped: this is a deliberate full bypass of the
// active-session protection, reachable only via scope:'user-all' (owner-only,
// override required — enforced in session-revoke.js, not here).
export function idsForUserAll(sessions, userEmail) {
  return sessions.filter((s) => s.user_email === userEmail).map((s) => s.external_id)
}
