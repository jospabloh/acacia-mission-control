// Gate for `api/cron/*`. Machine-only: no Supabase session, no member role —
// the caller is Vercel's scheduler or an operator running a job on demand.
//
// This FAILS CLOSED, and that is the whole point of the file. The four crons
// used to carry an inline `if (secret && ...)` copy, which skipped the check
// entirely when CRON_SECRET was unset. On 2026-08-23 that was measured against
// production, not guessed: a plain unauthenticated GET to
// /api/cron/sync answered 200 and returned the whole portfolio's operational
// state — every app, tenant counts, licence counts, ticket counts, session
// counts. The same missing gate sat in front of license-lifecycle and
// renewal-reminders, which transition billing status and mail real customers.
//
// A conditional guard is worth exactly what the env var is worth, and nothing
// asserted the env var existed. So: no secret configured -> 503, never 200.
//
// `x-vercel-cron` is deliberately NOT accepted on its own. Request headers are
// caller-controlled, and Vercel's own guidance is to protect cron routes with
// CRON_SECRET; when the variable is set, Vercel attaches
// `Authorization: Bearer <CRON_SECRET>` to scheduled invocations by itself, so
// the scheduler keeps working through the same door everyone else uses.
//
// DEPLOY ORDER: set CRON_SECRET in Vercel BEFORE shipping this. If it ships
// first, every cron answers 503 and stops silently — which is the safe
// direction to fail, but it is still an outage. jospabloh/flowfin has the
// cautionary version of this exact mistake in its CLAUDE.md, made in the
// opposite direction.
export function requireCron(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    res.status(503).json({ error: 'CRON_SECRET no configurado' })
    return false
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }
  return true
}
