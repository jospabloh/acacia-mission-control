// First-party tracking pixel. The acaciaco.com.mx site loads this as an <img>
// on each pageview. We record { path, host, ref } + a daily-salted, one-way
// visitor hash (no raw IP/UA stored, not reversible, not linkable across days),
// then return a 1x1 GIF. Public endpoint — always returns the pixel, never errors.
import crypto from 'node:crypto'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
// Salt for hashing visitor IPs — NOT an auth secret, and deliberately no
// longer falling back to INGEST_HMAC_SECRET. That fallback coupled two
// unrelated things: rotating the bridge secret would silently change every IP
// hash and break unique-visitor counting, and an auth secret has no business
// being a hashing salt. Set TRACK_SALT; without it this degrades to a fixed
// literal, which still de-duplicates within a deployment.
const SALT = process.env.TRACK_SALT || 'acacia-track'

function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  return (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim() || req.socket?.remoteAddress || ''
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x')
    const q = url.searchParams
    let path = (q.get('p') || '').slice(0, 512)
    if (path && !path.startsWith('/')) { try { path = new URL(path).pathname } catch { path = '' } }
    const host = (q.get('h') || req.headers.host || '').slice(0, 255)
    const ref = (q.get('r') || req.headers.referer || '').slice(0, 512) || null
    const ua = String(req.headers['user-agent'] || '')

    // Skip obvious bots and empty/invalid paths — no row written.
    const isBot = /bot|crawl|spider|preview|monitor|curl|wget|headless/i.test(ua)
    if (path && path.startsWith('/') && !isBot && supabaseAdmin) {
      const day = new Date().toISOString().slice(0, 10)
      const visitor = crypto.createHash('sha256').update(`${SALT}|${day}|${clientIp(req)}|${ua}`).digest('hex').slice(0, 16)
      // Await the insert. A fire-and-forget promise is unreliable here: Vercel
      // freezes the serverless function the instant we send the pixel below, so
      // the insert was routinely killed before it reached Supabase and pageviews
      // vanished (the endpoint returned 200 but no row was written). Bound the
      // wait so a slow/unreachable DB can never hang the pixel — we return the
      // GIF regardless, and log the reason if the write didn't land.
      let timer
      const timeout = new Promise((resolve) => { timer = setTimeout(resolve, 2500) })
      const write = supabaseAdmin.from('web_events').insert({ path, host, ref, visitor })
        .then(({ error }) => { if (error) console.error('track: insert error', error.message) },
              (e) => console.error('track: insert threw', e?.message))
      await Promise.race([write, timeout])
      clearTimeout(timer)
    }
  } catch { /* never fail the pixel */ }

  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Access-Control-Allow-Origin', '*')
  return res.status(200).send(GIF)
}
