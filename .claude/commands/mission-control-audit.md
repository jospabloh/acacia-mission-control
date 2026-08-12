---
description: Actionable regression, security, data-integrity, and release-readiness audit of Mission Control — auto-fixes safe/mechanical issues, commits, pushes a branch, and opens a draft PR (real Vercel preview deploy on push); production deploy still needs a human merge. Never touches auth/RLS/payments/migrations code or fires real crons/webhooks/payments.
---

# Claude Code Routine — Mission Control Regression, Data-Integrity, Security & Release Readiness Audit (actionable)

> This routine **diagnoses and fixes**. For issues in the *safe/mechanical* tier (§0 below) it edits the code, verifies with build/lint/test, commits, pushes a dedicated branch, and opens a draft PR — that push is a real, live Vercel preview deploy. Production still ships only when a human merges the PR (see §0). Issues in the *escalate* tier (auth, RLS, payments, migrations, Write Control / Danger Zone code) are **never** auto-fixed — they're reported for a human to fix by hand, no matter how confident the diagnosis is. This routine still never fires a real cron, webhook, or Mercado Pago payment, and never performs a destructive action from Write Control or the Settings danger zone directly against production.

---

## Target

- **App (production):** https://control.acaciaco.com.mx/ — an **internal, auth-gated operator panel** (not a public marketing site). Everything behind `LoginGate` requires a Supabase Auth session mapped to a `members` row (`owner | admin | viewer`).
- **Repository:** `jospabloh/acacia-mission-control` (assume checked out in the current working directory; if not present, clone it read-only or ask before proceeding).
- **Backend:** Supabase project `acacia-mission-control` (`xrvjnadirzsjvzknfyjf`, region `us-east-2`) — the "bodega". **Source of truth** for licenses/users/support is each portfolio app's own backend; the bodega is a synced, read-optimized copy.
- **Hosting:** Vercel project `acacia-mission-control`, production branch `main`, crons defined in `vercel.json`.

Stay in scope: this repo, its Vercel deployment, and its Supabase project. Do not wander into the portfolio apps' own repos/backends (puntos, rumbo, liuma, flowfin, stockflow, bari-sales-ai, …) — cross-app RLS and schema conventions are covered by *their own* `CLAUDE.md`, not this routine.

---

## §0 — Auto-fix scope, and the fix → commit → push → PR workflow

### Two tiers. Every finding gets sorted into exactly one.

**Tier A — safe/mechanical, auto-fix it:** lint errors (`npm run lint`) · build errors · a client route that 404s/crashes because of a stale import or renamed file · a broken internal link/href to a route that moved · dead/unused imports · obviously-wrong copy or config values (a stale app name, a wrong label) that don't touch business logic · a failing unit test under `api/_lib/**/*.test.js` with an unambiguous one-line fix (e.g. an assertion that drifted from a harmless rename) · missing `alt` text or a clear a11y label gap · an obviously dead/duplicate script or style include. Every Tier A fix must be **re-verified** (`npm run build && npm run lint && npm test`, and the specific check that found it) before it is committed — never commit a fix you haven't re-run the failing check against.

**Tier B — escalate, never auto-fix:** anything in `api/_lib/control/*.js`, `api/_lib/adapters/*`, `requireMember.js`, `supabase/migrations/*.sql`, `api/_lib/mercadopago.js`, `api/webhooks/*`, `api/cron/*`, `api/ingest/*`, `api/_lib/ingestSign.js`, `api/_lib/sync/*`, `src/lib/auth/*`, or `src/pages/WriteControl.jsx` / `src/pages/Settings.jsx` — i.e. **anything touching auth, role gates, RLS, payments, migrations, crons, webhooks, HMAC verification, or Write Control / the Settings danger zone** — no matter how confident or "obviously correct" the fix looks. These get a full write-up (§12) in the report and in the PR description under "Flagged — needs a human," never a code change. This includes the case where an auto-fix from a previous run touched adjacent code — if you're not certain a change stays entirely inside Tier A territory, treat it as Tier B.

### Workflow for Tier A fixes

1. Make sure the working tree is clean and you're up to date with the default branch (`git fetch origin main && git status`).
2. Create a fresh, dated branch off `main`: `chore/audit-mc-<YYYY-MM-DD>`. Never commit straight to `main`, never force-push over a human's commits, and if that branch name already has unmerged work from an earlier run today, add commits on top of it instead of creating a duplicate.
3. Apply every Tier A fix. Re-run `npm run build`, `npm run lint`, and `npm test` after all Tier A fixes are applied — all three must be clean before you commit.
4. Commit with a clear message per logical fix (prefix `audit:`), e.g. `audit: fix broken /apps/:appId import after Products.jsx rename`.
5. `git push -u origin chore/audit-mc-<YYYY-MM-DD>` (retry with backoff on network errors, per the repo's normal push convention). This push **is** a real deploy — Vercel builds a live preview URL for the branch automatically. Report that preview URL once it's available.
6. Open a **draft PR** into `main` (check for `.github/pull_request_template.md` first and follow it). The PR body must contain: a summary of every Tier A fix shipped, the full Tier B "flagged — needs a human" list with rationale and file:line, and the verification output (build/lint/test). **Production only ships when a human merges this PR** — do not merge it yourself, do not enable auto-merge.
7. If Tier A found nothing to fix, skip the branch/PR entirely and just report the Tier B findings (if any) — never open an empty PR.

### Production-safety hard rules (apply regardless of tier)

1. **Never trigger a real cron.** Do not call `/api/cron/sync`, `/api/cron/renewal-reminders`, `/api/cron/license-lifecycle`, or `/api/cron/usage-reminders` against production — they write to the bodega, send real emails/WhatsApp messages, and (for renewals) can move licenses through lifecycle states. Audit these by **reading the code** in `api/cron/*.js` and `api/_lib/sync/*.js`, not by invoking them. Local dev with a scratch Supabase project is the only safe way to exercise them live.
2. **Never trigger the Mercado Pago webhook or a real payment.** `api/webhooks/mercadopago.js` is signature-verified and idempotent by design — verify that statically, never by POSTing to it.
3. **Never call `/api/control/[action]` with a real session against production** for any mutating action (`license-action`, `send-message`, `members`, `session-revoke`, `license-delete-premium-data`, `payment-confirm`, `run-sync`, …). Read `api/_lib/control/*.js` to reason about validation and auth instead. `list-contacts`, `usage-by-tenant`, `email-status`, `tickets`, `sessions` (read paths) are lower-risk but still prefer code review over live calls unless a disposable **viewer**-role test account exists.
4. **Never exercise Write Control (`/write-control`) or the Settings danger zone against production data.** These are exactly the flows this routine must not fire, and exactly the code this routine must not auto-fix (Tier B).
5. **Do not create, promote, or delete rows in `members`,** and do not use the owner account (`h.josepablo@gmail.com`) for anything beyond an unauthenticated/role-gate check.
6. If a check requires an authenticated session to verify UI behavior (e.g. does `/settings` actually 403 a viewer), and no disposable test account exists, **do not create one** — mark the check `NOT VERIFIED — no safe test account`, reason about `requireMember`/RLS from code instead, and say so in the report.
7. Never place tokens, HMAC secrets, or the `SUPABASE_SERVICE_ROLE_KEY` in a URL, log line, or committed file during this audit.
8. Never merge the PR this routine opens, never disable branch protection, never bypass CI to force a merge.

---

## Phase 0 — Recon (do this FIRST)

1. **Read the repo structure.** `package.json` (scripts: `dev`, `build`, `lint`, `test`, `onboard:base44`), `vercel.json` (rewrites + cron schedules), `vite.config.js`, `eslint.config.js`, `tailwind.config.js`.
2. **Enumerate every client route from `src/App.jsx`**, cross-checked against the role gates in `src/lib/nav.js` (`PILLARS`, each with a `minRole`). Routes as of this writing: `/` (Dashboard), `/licenses`, `/tenants`, `/sessions`, `/products`, `/revenue`, `/crm`, `/analytics`, `/support`, `/announcements`, `/health`, `/write-control`, `/settings`, plus the dynamic `/apps/:appId` (one per row in the `apps` registry — enumerate the actual rows via `src/lib/appRegistry.js` / a read-only `select * from apps`, don't assume a fixed list). Re-derive this list from the live files — don't trust the snapshot above if the repo has moved on.
3. **Enumerate every serverless endpoint under `api/`:**
   - Crons (machine-gated by `CRON_SECRET` or the `x-vercel-cron` header): `api/cron/sync.js`, `api/cron/renewal-reminders.js`, `api/cron/license-lifecycle.js`, `api/cron/usage-reminders.js`.
   - Webhook: `api/webhooks/mercadopago.js`.
   - HMAC ingest: `api/ingest/lead.js`, `api/ingest/ticket.js`, `api/ingest/ticket-pull.js`.
   - Human control router (member-gated via `requireMember`): `api/control/[action].js`, dispatching to every handler under `api/_lib/control/*.js`. Enumerate the `ROUTES` map in that file — don't hardcode a stale action list.
   - Misc: `api/track.js`, `api/web-kpis.js`.
   - Confirm the endpoint count stays within Vercel's serverless-function budget (the `[action]` router exists specifically to collapse many control actions into one function — check nothing has since split back out and blown the budget).
4. **Enumerate the bodega schema** from `supabase/migrations/*.sql` in order — note the highest-numbered migration and confirm the sequence has no gaps or duplicate numbers. Identify the operational tables (`apps`, `members`, `tenants`, `licenses`, `tickets`, `usage`, `health`, `revenue`/`revenue_events`, `leads`, `alerts`, `announcements`, `app_sessions`, `payment_reports`, the audit log, …) and locate `current_member_role()` / `is_member_at_least()`.
5. **Inventory the adapters** in `api/_lib/adapters/` (`base44.js`, `supabaseApp.js`, `external.js`, `static.js`, `index.js` factory) and confirm every row in the `apps` registry maps to a `backend` value one of them handles.
6. **Determine how to run it locally.** `npm install`, then `npm run build` and `npm run lint`. Try `npm run dev` only if a scratch/local Supabase project (or at minimum a valid anon key with RLS intact) is available — otherwise rely on static analysis + the production build output for anything that would otherwise need a live session.
7. **Checkpoint:** print the detected stack, the full route list (client + API) with role/auth gates, the migration count/range, the adapter→backend map, and whether you're testing against local, a static build preview, or code-only. State explicitly which checks require a live authenticated session and whether one was safely available.

**Fail-loud rule for the whole routine:** every check is marked `VERIFIED (code)`, `VERIFIED (build)`, `VERIFIED (local, unauthenticated)`, `VERIFIED (local, authenticated as <role>)`, or `NOT VERIFIED — reason`. A check you could not run is never reported as passed.

---

## Primary Objective

Audit Mission Control for regressions, broken flows, broken links/routes, role/RLS gaps, data-integrity drift between the bodega and the portfolio apps' own backends, security issues (secret leakage, auth bypass, webhook/HMAC verification), build/lint/test health, and major performance issues. Produce a findings report organized by severity: Critical / High / Medium / Low.

If all checks genuinely pass (and were actually run), confirm the app is in good standing. If any check could not be run, the app is **not** confirmed — state exactly which check and why.

---

## 1. Auth & Role-Gate Check

- `LoginGate` (`src/components/LoginGate.jsx`): confirm unauthenticated visitors get a login screen, not a flash of protected content or a broken blank page. Confirm the "Continue with Google" path fails gracefully (per `DEPLOY.md`) when OAuth isn't configured, rather than hanging or erroring uncaught.
- Confirm every pillar in `src/lib/nav.js` enforces its `minRole` **both** in the nav (hidden/disabled for under-ranked roles) **and** on the page itself — a hidden nav link is not a security boundary; verify the underlying route/component also gates.
- Cross-check `RANK` in `api/_lib/requireMember.js` (`viewer:1, admin:2, owner:3`) against the RLS rank model described in `CLAUDE.md` — they must agree.
- For every `api/control/[action]` handler, confirm it calls `requireMember(req, res, minRole)` with a `minRole` appropriate to the action's blast radius (e.g. `members`, `license-delete-premium-data`, `payment-confirm` should require `admin` or `owner`, not `viewer`). Flag any handler missing the call entirely — that's a Critical auth-bypass finding.
- Confirm `api/cron/*` and `api/webhooks/*` do **not** accept a member JWT as their only gate (they should be machine-gated: `CRON_SECRET`/`x-vercel-cron`, or webhook signature) — a cron endpoint reachable by any authenticated browser session is a Critical finding.

## 2. Route / Page Load & Runtime Error Check

Per client route from Phase 0 (code review + local build preview; live-authenticated only if a safe account exists): loads without a blank screen · no broken import/route · no unhandled runtime error · no hydration mismatch · no console error that breaks user-facing behavior · `/apps/:appId` handles an unknown/deleted app id gracefully instead of crashing · the catch-all (`path="*"`) actually redirects to `/` and doesn't loop. A page that fails to load and blocks access → **Critical**.

## 3. Data Integrity — Bodega vs. Source of Truth

Per `CLAUDE.md`, the bodega is a **synced copy**, not the source of truth. Reason about (code-level, not by firing the cron):
- `api/_lib/sync/syncLicenses.js`, `syncUsage.js`, `syncTickets.js`, `syncSessions.js`, `syncHealth.js`: idempotency (safe to re-run), what happens on a partial failure for one app (does it abort the whole sync or isolate per-app — `api/cron/sync.js` wraps each app's steps in its own `try/catch`, confirm that pattern held), and whether field maps (`apps.config.field_map`, migration `0004`) still match each portfolio app's actual entity schema (spot-check one or two against the referenced app's `base44/entities/*.jsonc` if those repos are reachable; otherwise note as unverifiable here).
- `api/_lib/sweepResolvedTickets.js` / `api/_lib/sync/autoCloseResolved.js`: confirm the grace-window auto-close logic can't prematurely close a ticket with recent requester activity.
- Confirm every table written by `api/cron/sync.js` has an `audit()` call recording the run (for traceability), matching the `audit` helper in `api/_lib/supabaseAdmin.js`.

## 4. Security & Secrets Audit

- **`VITE_` prefix discipline**: grep `src/` for any `import.meta.env.*` that is NOT prefixed `VITE_`, and grep for any accidental import of `api/_lib/*` from `src/` (forbidden per `CLAUDE.md` — would bundle service-role logic into the client). Either is a **Critical** finding.
- Confirm `SUPABASE_SERVICE_ROLE_KEY`, `BASE44_*`, `MERCADOPAGO_*`, `INGEST_HMAC_SECRET` never appear in `.env.production` or any other committed file — only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are expected to be committed (per `DEPLOY.md`, this is intentional since RLS is the real boundary; anything server-only appearing there is Critical).
- `api/_lib/ingestSign.js`: confirm the ingest endpoints (`api/ingest/*.js`) actually verify the HMAC signature before trusting payload contents, and that the canonical stringify is symmetric (key-sorted on both sign and verify paths).
- `api/webhooks/mercadopago.js`: confirm `verifyWebhookSignature` is applied whenever `MERCADOPAGO_WEBHOOK_SECRET` is set, and that an unset secret is a deliberate (documented) fallback, not a silent bypass in production.
- Confirm no `console.log` of tokens/secrets/full JWTs anywhere reachable in `api/` or `src/`.

## 5. RLS & Migrations Sanity (code review, no live mutating queries)

- Walk `supabase/migrations/*.sql` in order; confirm no numbering gaps/dupes and that later migrations don't silently re-open a `viewer`-writable hole on a table intended admin-and-up.
- Confirm `current_member_role()` / `is_member_at_least()` are used consistently across policies for every operational table listed in `CLAUDE.md`'s RLS model, and that `members` and `apps` deletion are restricted to `owner`.
- Confirm nothing in `src/` performs a write that assumes `service_role` semantics (i.e., the client should never rely on being able to bypass RLS — writes it needs should go through `api/control/*` instead).

## 6. Portfolio App Registry & Adapter Conformance

- For every row the `apps` registry actually contains, confirm `backend` resolves to a real case in `api/_lib/adapters/index.js`'s factory; an app with an unmapped `backend` value is a **High** finding (breaks `AppDetail`, sync, and health probes for that app).
- `scripts/onboard-base44.js --dry`: run it against a sample path if a portfolio repo is available locally, to confirm the script still produces a valid registry row shape without writing (no `--dry` flag omission).
- Confirm `api/_lib/appBridge.js`'s `bridgeConfigured()` gate is actually checked before any Base44-only sync step (`api/cron/sync.js` already does this — confirm it still does after any recent changes).

## 7. Payments (Mercado Pago) Integrity

- Confirm there is no leftover Stripe reference anywhere (`grep -ri stripe`) — per `CLAUDE.md`, Stripe is not used.
- Confirm `mapPaymentToEvent`/upsert logic in `api/_lib/mercadopago.js` is idempotent on `provider + external_id` (re-delivery of the same webhook must not double-count revenue).
- Confirm `payment-confirm` / `payment-report` control actions (`api/_lib/control/payment-confirm.js`, `payment-report.js`) validate role before allowing a manual revenue adjustment.

## 8. Build, Lint & Test Verification

- `npm run build` — must pass clean (Vite production build).
- `npm run lint` — 0 errors (ESLint).
- `npm test` (`node --test`) — run the existing `*.test.js` suite under `api/_lib/**` (ingest signing, mercadopago mapping, license control, ticket control, sla, sync mapping, portfolio lifecycle, renewal reminders, usage reminders, etc.) and report pass/fail counts, not just "tests exist."
- Report the production bundle output size from `dist/` after `npm run build` (flag any unexpectedly large chunk vs. the last known-good baseline if one is available).

## 9. Mobile & Desktop Layout Review (internal panel)

Even as an internal tool, check the authenticated shell where safely possible (local build + a disposable/local test session, or static review of `Layout.jsx`/`Nav.jsx`/table-heavy pages like `Licenses`, `Tenants`, `CRM`): mobile nav open/close, tables that overflow without a scroll container (horizontal scroll leaking into the page), dense data tables usable at ~390px and ~1280px+, no dialogs/modals (Write Control, Settings danger zone) clipped on mobile. Layout issues that block reading or operating a pillar → **High**.

## 10. Performance

Note: Vite bundle size and any obviously heavy dependency added to `package.json`, render-blocking patterns in `src/lib/usePortfolioData.js` / `insights.js` (N+1-style fetch fan-out against Supabase), and whether `Dashboard`/`Analytics` do redundant re-fetches on every render. Where possible, pull real numbers from the `npm run build` output; do not fabricate Lighthouse numbers for an auth-gated app you can't reach unauthenticated.

## 11. Cron Schedule Sanity

Cross-check `vercel.json`'s `crons` block against what each `api/cron/*.js` file actually expects (schedule, `?mode=` query params like `renewal-reminders?mode=upcoming`) and against the Hobby/Pro plan's cron limits. Flag any schedule that looks likely to double-fire, overlap in a way that could race on the same rows, or reference a `mode` the handler doesn't recognize.

## 12. Findings Format

For every finding include: **Severity · Confidence tag (`[Certain]`/`[Likely]`/`[Guessing]`) · How verified (code/build/local-unauth/local-auth-as-<role>/NOT VERIFIED) · Area (route, API action, migration, adapter, …) · Issue · Expected behavior · Actual behavior · Operator/business impact · Recommended fix · Tier (A/B) · Outcome (`Fixed — commit <sha>` / `Flagged — needs a human` / `Reported only, not shippable this run`) · Blocks release? (yes/no).**

## 13. Severity Rules

- **Critical:** an auth/role gate is missing or bypassable · a server-only secret or `api/_lib` code is reachable from `src/`/the client bundle · a cron or webhook lacks its machine gate · a portfolio-app write goes to the wrong tenant/app · the bodega double-counts revenue on webhook retry · a Danger Zone/Write Control action lacks role enforcement.
- **High:** a pillar page crashes or shows stale/wrong data · an adapter is missing for a registered app · sync silently drops an app on partial failure · lint/build/test suite fails · a migration reopens an RLS hole.
- **Medium:** noticeably slow dashboard/analytics load · non-blocking layout issues in a data-heavy pillar · a control action's error path is unclear · minor inconsistency between the field map and an app's real schema.
- **Low:** minor copy/layout polish · non-blocking visual inconsistencies in low-traffic pillars · cosmetic console warnings.

---

## 14. Final Report

Output in this structure:

```
# Mission Control Audit Report

## Final Status
Passed — nothing to fix or flag | Shipped fixes — PR open for merge | Flagged issues need a human | Failed — Critical issues found | Blocked

## Coverage & Verification
Stack detected · tested against (code/build/local-unauth/local-auth) · any checks NOT VERIFIED and why (e.g. no safe test account for role-gate live checks).

## Executive Summary
Brief condition of Mission Control, and whether a PR was opened this run.

## Shipped This Run (Tier A)
Branch name · PR URL (draft) · Vercel preview URL · commit list · what each commit fixed · build/lint/test results after the fixes. `None` if nothing was auto-fixable.

## Flagged For A Human (Tier B)
Every finding that was NOT auto-fixed, with severity, file:line, why it's Tier B, and the recommended fix — written so a human can act on it directly. `None` if there weren't any.

## Critical Findings
(list or `None`)

## High Findings
(list or `None`)

## Medium Findings
(list or `None`)

## Low Findings
(list or `None`)

## Routes & API Surface Reviewed
(every client route + every api/ endpoint from Phase 0, with verification method per item)

## Data Integrity & Sync Review
(summary of §3)

## Security & Secrets Review
(summary of §4)

## RLS & Migrations Review
(summary of §5)

## Build / Lint / Test Results
(exact npm run build / npm run lint / npm test output summary, before and after any Tier A fixes)

## Blockers
(list or `None`)

## Recommended Next Actions
(what the human reviewer should do: merge the PR, decide on each flagged Tier B item, or nothing)
```

## Final Confirmation

If every check ran clean and nothing needed fixing or flagging:
`Mission Control audit complete. No Critical, High, Medium, or Low issues were found in the reviewed scope.`

If Tier A fixes were shipped: state the PR URL plainly and that it's waiting on a human merge to reach production — never claim the fix is live in production until it's merged.

If Tier B issues were flagged or any check was NOT VERIFIED: do not say Mission Control is in good standing. State the exact severity, what remains unverified or unfixed, and the recommended next action for a human.

---

**Checkpoint discipline:** after each phase, print a one-line summary (done / verified / remaining). If you lose the thread or run past a sensible token budget, stop, summarize, and replan rather than pushing through.
