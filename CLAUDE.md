# ACACIA Mission Control — Project Notes

Central panel (React + Vite + Supabase + Vercel) that aggregates and operates the
whole ACACIA SaaS portfolio. **Not** a Base44 app — it sits *above* the portfolio.

## Architecture (decided)

- **Frontend**: React + Vite, deployed on Vercel. Auth + central "bodega"
  (warehouse) live in **Supabase**.
- **Serverless** functions in `api/` (Vercel): crons, webhooks, HMAC ingest,
  write-control. Server-only code (service keys) lives under `api/_lib/` and
  **must never** be imported from `src/`.
- **App registry** `apps` (Supabase) = source of truth for *what apps exist*.
  Per-backend **adapters** in `api/_lib/adapters/` (`base44` | `supabase` |
  `external` | `static`) give every app a common surface.
- **Payments**: Mercado Pago. **Stripe is NOT used** anywhere.
- **Auth/roles**: Supabase Auth users mapped to a Mission Control role in
  `members` — `owner | admin | viewer`. RLS enforces it on the client; `api/`
  uses the service_role key (bypasses RLS).
- **Source of truth** for licenses/users/support is **each app's own backend**.
  Mission Control reads/writes directly via REST as `role:admin` and keeps only a
  synced, read-optimized copy in the bodega — no parallel permission model.

## Layout

```
src/                 client app (Vite). Only ever uses the Supabase ANON key.
  lib/supabase.js      anon client (RLS applies)
  lib/auth/*           AuthContext / AuthProvider / useAuth (split to keep
                       react-refresh happy — never export a hook + component
                       from one file)
  lib/appRegistry.js   reads public.apps
  lib/nav.js           pillar nav (role-gated)
  components/          LoginGate (auth + member gate), Layout, Nav, PageHeader
  pages/               Dashboard (live) + one stub per pillar + AppDetail
api/_lib/             SERVER ONLY — service_role key, adapters. Never import from src/.
  supabaseAdmin.js     service-role client + audit() helper
  adapters/            base44 | supabaseApp | external | static + index (factory)
supabase/migrations/ 0001_init.sql (bodega + members + apps + audit + RLS)
                     0002_seed_apps.sql (5 Base44 apps + plink_fx)
scripts/onboard-base44.js  auto-discover a Base44 repo → registry row
```

## RLS model (bodega)

`current_member_role()` + `is_member_at_least(min_role)` derive the operator's
role from `members`. Ranks: `owner(3) > admin(2) > viewer(1)`.

- **viewer** → read-only across operational tables.
- **admin**  → read all + write operational tables (tenants, licenses, revenue,
  tickets, usage, health, leads, alerts, announcements). Cannot manage `members`
  or delete `apps`.
- **owner**  → full control incl. `members` and the danger zone.
- The **service_role** key (used by `api/`) bypasses RLS — that is how crons and
  webhooks write. Keep that key server-side only.

## Working with the portfolio's Base44 apps

When a task changes a Base44 app (puntos, rumbo, liuma, flowfin, stockflow,
bari-sales-ai), respect **that app's** CLAUDE.md RLS rules: keep the
`{"user_condition":{"role":"admin"}}` branch on **all four** ops, use `data.*`
entity paths and `{{user.data.*}}` user templates, run `npm run validate:rls`,
and **deploy the schema to the Base44 backend** (repo `.jsonc` alone changes
nothing at runtime).

## Build / verify

- `npm run build` — Vite production build (must pass).
- `npm run lint`  — ESLint, 0 errors.
- `npm run onboard:base44 -- <repoPath> --dry` — preview a Base44 app's registry row.

## Env

See `.env.example`. Client vars are `VITE_*` (anon). Server-only secrets
(`SUPABASE_SERVICE_ROLE_KEY`, `BASE44_*`, `MERCADOPAGO_*`, `INGEST_HMAC_SECRET`)
must **not** carry the `VITE_` prefix — that would leak them into the bundle.
