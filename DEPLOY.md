# Deploying ACACIA Mission Control

## Hosting

- **Frontend** → Vercel project `acacia-mission-control`
  (`prj_5qw7rnPlumGRIc6MENii0GvmXsJU`, team `jose-pablo-herreras-projects`),
  connected to GitHub `jospabloh/acacia-mission-control`, production branch
  `main`. Every push to `main` triggers a production build; other branches get
  preview deployments.
- **Backend** → Supabase project `acacia-mission-control`
  (`xrvjnadirzsjvzknfyjf`, region `us-east-2`).

## Build

Vercel auto-detects Vite. `npm run build` → `dist/`. SPA routing is handled by
the rewrite in `vercel.json` (everything except `/api` falls back to
`index.html`).

## Environment

Client vars (`VITE_*`) are **public** and committed in `.env.production`
(Supabase URL + anon key) so the build is self-contained. RLS is the security
boundary — the anon key can do nothing without an authenticated `members` row.

Server-only secrets (added later for Fase 1+) go in **Vercel Project →
Settings → Environment Variables**, WITHOUT the `VITE_` prefix:
`SUPABASE_SERVICE_ROLE_KEY`, `BASE44_SERVICE_TOKEN` / `BASE44_TOKEN_<APPID>`,
`MERCADOPAGO_ACCESS_TOKEN`, `INGEST_HMAC_SECRET`.

## Fase 1 — license sync (`/api/cron/sync-licenses`)

Runs daily (see `vercel.json` cron) and on demand. For each Base44 app it reads
the license entity and upserts normalized `tenants` + `licenses` into the bodega.
It needs these **server-only** env vars in Vercel (no `VITE_` prefix):

- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — service-role writes to the bodega.
- A Base44 token per app **or** one shared token:
  - `BASE44_TOKEN_<APPID_UPPER>` (e.g. `BASE44_TOKEN_696E7FDD7889892FE40868B7` for Puntos+), or
  - `BASE44_SERVICE_TOKEN` as a fallback for all apps.
  Apps without a token are skipped (the response lists them).
- `CRON_SECRET` (optional) — if set, the endpoint requires `Authorization: Bearer <CRON_SECRET>`; Vercel cron sends it automatically.

Field maps (which app field → which bodega column) live in `apps.config.field_map`
(migration `0004`), verified against each repo's `base44/entities/*.jsonc`.

Run on demand: `curl -H "Authorization: Bearer $CRON_SECRET" https://control.acaciaco.com.mx/api/cron/sync-licenses`

## Custom domain

In Vercel → Project → Settings → Domains, add `control.acaciaco.com.mx`
(a CNAME on the `acaciaco.com.mx` zone pointing to Vercel). Keep the panel on a
subdomain — it is an internal operator tool, not a public marketing page.

## First login

The owner (`h.josepablo@gmail.com`) is already seeded in `members`. Sign in with
the temporary password and change it immediately, or use **Continue with Google**
(see below).

## Google sign-in (OAuth)

The app already calls `signInWithOAuth({ provider: 'google' })` and the owner is
auto-provisioned on first login (migration `0003`). Two one-time setup steps,
both outside this repo:

1. **Google Cloud** → APIs & Services → Credentials → Create **OAuth client ID**
   (type *Web application*). Authorized redirect URI:
   `https://xrvjnadirzsjvzknfyjf.supabase.co/auth/v1/callback`. Copy the client
   ID + secret.
2. **Supabase** → Authentication → Providers → **Google** → enable, paste the
   client ID + secret. Then Authentication → URL Configuration → set **Site URL**
   to `https://control.acaciaco.com.mx` and add it (plus the `*.vercel.app` URL)
   to **Redirect URLs**.

Until both are done, leave `VITE_GOOGLE_OAUTH` unset — the "Continue with
Google" button stays hidden entirely (it's off by default so production never
shows a button that can't complete) and email + password keeps working
meanwhile. Set `VITE_GOOGLE_OAUTH=on` (then redeploy) once both steps are done
to reveal the button; if it's ever shown before Supabase's Google provider is
actually enabled, clicking it surfaces a clear "Google isn't enabled yet"
message instead of hanging or erroring uncaught.
