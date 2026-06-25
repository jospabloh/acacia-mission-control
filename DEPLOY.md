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

Until both are done, the "Continue with Google" button returns a clear message
telling you Google isn't enabled yet; email + password keeps working meanwhile.
