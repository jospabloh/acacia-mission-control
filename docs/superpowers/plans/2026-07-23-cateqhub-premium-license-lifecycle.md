# Ciclo de vida de licencia Premium — Implementation Plan (Mission Control / CateqHub)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CateqHub to the license-control registry, run a daily cron that walks Premium tenants through `active → read_only → access_denied → deletion_eligible` on grace-period timers, and give an operator a gated, owner-only way to delete a delinquent tenant's Premium data — but only after that tenant has confirmed its own export.

**Architecture:** Reuses the existing `licenseControl.js` per-app registry and `acaciaControl` bridge pattern (no new sync/RLS model). A new pure module (`licenseLifecycle.js`) computes state transitions from bodega data (`licenses.raw`, already populated by the existing sync — no schema change needed there); a new cron applies them via the existing `license.set` bridge action (extended with a generic `mirror` param, implemented in the sibling repo) and a new, narrowly-scoped `license.deletePremiumData` bridge action for the one destructive step, which stays behind a hard `export_confirmed_at` gate and an `owner`-role endpoint.

**Tech Stack:** Vercel serverless functions (`api/`), Supabase (Postgres + RLS), Node's built-in test runner (`node --test`), React 18 + Vite (`src/`).

**Spec:** `docs/superpowers/specs/2026-07-23-cateqhub-premium-license-lifecycle-design.md` (this repo). Sibling spec/plan live in `jospabloh/asistencia-catecismo` — that repo's plan implements the `acaciaControl` bridge changes this plan's cron and delete endpoint depend on (mirror capability, `license.deletePremiumData` action, `Parish`/`User` schema).

## Global Constraints

- Scope is **Premium only**. No task here touches any other portfolio app's config, cron behavior, or UI beyond the additions listed.
- Deletion is **never automatic**. `deletion_eligible` only surfaces a badge for human review; the delete endpoint requires `owner` role (not `admin`) and a hard `export_confirmed_at` check read fresh from the bodega, not trusted from the client.
- Every pure-logic module gets `node --test` coverage before its consumer (cron/endpoint) is wired up — this repo already has real unit tests (`api/_lib/*.test.js`, run via `npm run test` → `node --test`), unlike the sibling repo.
- Follow existing code style exactly: this repo's `api/_lib/*.js` files use `//` comments explaining *why*, Spanish prose in comments and audit/error strings, English identifiers.
- The sibling repo's `acaciaControl` bridge changes (generic `mirror` on `license.set`, new `license.deletePremiumData` action) are a **dependency**, not something this plan implements. Tasks that call those actions (Task 5, Task 6) will work correctly once that sibling PR deploys — they do not fail differently before then (the bridge call just 502s with the bridge's real error, same as any other unconfigured/undeployed app today).
- No task in this plan needs Base44 or Supabase MCP access — migrations are written as `.sql` files under `supabase/migrations/` per this repo's existing convention (applied by whoever runs the deploy, same as every other migration here); nothing is auto-applied from this session.

---

### Task 1: `licenseControl.js` — register CateqHub

**Files:**
- Modify: `api/_lib/licenseControl.js`
- Modify: `api/_lib/licenseControl.test.js`

**Interfaces:**
- Produces: `licenseControlFor('cateqhub')` → `{ entity: 'Parish', statusField: 'license_status', planField: 'plan', statuses: {active:'active', suspended:'access_denied', view_only:'read_only'}, plans: ['free','premium'], billing: null, mirror: {...}, lifecycle: {...} }`. `buildLicenseChange('cateqhub', 'set_plan', { plan: 'premium' })` now also stamps `premium_period_end_at` (30 days out) in the returned `patch` when the target plan is in `lifecycle.paidPlanValues`. Consumed by Task 3 (cron), Task 8 (UI).

- [ ] **Step 1: Write the failing tests**

Add to the end of `api/_lib/licenseControl.test.js`:

```js
// ── cateqhub: no billing, mirror config, set_plan stamps premium_period_end_at ──

test('cateqhub has no billing (Premium se activa manualmente, sin Mercado Pago hoy)', () => {
  assert.equal(billingFor('cateqhub'), null)
})

test('cateqhub set_plan a premium estampa premium_period_end_at a +30 días', () => {
  const NOW2 = new Date('2026-07-23T00:00:00Z')
  const change = buildLicenseChange('cateqhub', 'set_plan', { plan: 'premium', now: NOW2 })
  assert.equal(change.error, undefined)
  assert.equal(change.patch.plan, 'premium')
  assert.equal(change.patch.premium_period_end_at, '2026-08-22T00:00:00.000Z')
})

test('cateqhub set_plan a free NO estampa premium_period_end_at', () => {
  const change = buildLicenseChange('cateqhub', 'set_plan', { plan: 'free' })
  assert.equal(change.error, undefined)
  assert.equal(change.patch.plan, 'free')
  assert.equal(change.patch.premium_period_end_at, undefined)
})

test('cateqhub statuses mapean read_only/access_denied a las llaves genéricas view_only/suspended', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.equal(cfg.statuses.view_only, 'read_only')
  assert.equal(cfg.statuses.suspended, 'access_denied')
  assert.equal(cfg.statuses.active, 'active')
})

test('cateqhub declara mirror hacia User (Base44 RLS no puede hacer lookup a Parish)', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.deepEqual(cfg.mirror, {
    entity: 'User', matchField: 'parish_id',
    fields: { plan: 'parish_plan', license_status: 'parish_license_status' },
  })
})
```

Also add `licenseControlFor` to the existing import line at the top of the file (find the current import and extend it):

```js
import { buildLicenseChange, computeRenewalExpiry, billingFor, licenseControlFor } from './licenseControl.js'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- api/_lib/licenseControl.test.js`
Expected: FAIL — `licenseControlFor('cateqhub')` returns `null` (no `cateqhub` entry yet), so `cfg.statuses`/`cfg.mirror` throw or the `assert.deepEqual` fails; `billingFor('cateqhub')` already returns `null` today (that one assertion passes, the rest don't).

- [ ] **Step 3: Add the `cateqhub` entry and extend `buildLicenseChange`**

In `api/_lib/licenseControl.js`, add to the `APPS` object (after the `puntos` entry, before the closing `}` of `APPS`):

```js
  cateqhub: {
    entity: 'Parish', statusField: 'license_status', planField: 'plan',
    statuses: { active: 'active', suspended: 'access_denied', view_only: 'read_only' },
    plans: ['free', 'premium'],
    // Premium se activa/factura manualmente hoy (ver Premium.jsx del app) — sin
    // Mercado Pago todavía, así que no hay confirm_payment para este app.
    billing: null,
    // Base44 RLS no puede hacer lookup de Guardian/ChildGuardian → Parish
    // directamente, así que el app espeja plan/license_status en cada User de
    // la parroquia. license.set (puente) aplica este mirror después del patch
    // principal — ver spec hermana en asistencia-catecismo.
    mirror: {
      entity: 'User', matchField: 'parish_id',
      fields: { plan: 'parish_plan', license_status: 'parish_license_status' },
    },
    // Ciclo de vida automático (cron license-lifecycle), solo mientras
    // plan=premium: active → read_only → access_denied → deletion_eligible.
    // El núcleo gratis de CateqHub nunca entra a este ciclo.
    lifecycle: {
      paidPlanValues: ['premium'],
      graceDaysToReadOnly: 15,
      graceDaysToAccessDenied: 15,
      graceDaysToDeletionEligible: 30,
      sinceFields: { read_only: 'read_only_since', access_denied: 'access_denied_since', deletion_eligible: 'deletion_eligible_since' },
      exportConfirmedField: 'export_confirmed_at',
      periodEndField: 'premium_period_end_at',
    },
  },
```

Then extend the `set_plan` branch of `buildLicenseChange` (find this exact block):

```js
  } else if (op === 'set_plan') {
    if (!plan || !cfg.plans.includes(plan)) return { error: `plan inválido para ${appId}: ${plan}` }
    patch[cfg.planField] = plan
  } else if (op === 'confirm_payment') {
```

Replace with:

```js
  } else if (op === 'set_plan') {
    if (!plan || !cfg.plans.includes(plan)) return { error: `plan inválido para ${appId}: ${plan}` }
    patch[cfg.planField] = plan
    // Activar un plan de pago sin billing automatizado (hoy solo cateqhub) arranca
    // el reloj del ciclo de vida manualmente: sella cuándo vence este período
    // Premium para que el cron license-lifecycle sepa cuándo empezar a contar.
    if (cfg.lifecycle?.paidPlanValues?.includes(plan)) {
      const when = now ? new Date(now) : new Date()
      const periodEnd = new Date(when.getTime())
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 30)
      patch[cfg.lifecycle.periodEndField] = periodEnd.toISOString()
    }
  } else if (op === 'confirm_payment') {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- api/_lib/licenseControl.test.js`
Expected: PASS, all tests including the pre-existing ones (this change is additive — no existing `APPS` entry or branch behavior changed).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/licenseControl.js api/_lib/licenseControl.test.js
git commit -m "licenseControl: registrar cateqhub (sin billing, con mirror y lifecycle)"
```

---

### Task 2: `licenseLifecycle.js` — pure state-transition logic

**Files:**
- Create: `api/_lib/licenseLifecycle.js`
- Create: `api/_lib/licenseLifecycle.test.js`

**Interfaces:**
- Produces: `computeLifecycleTransition(license, lifecycleCfg, now)` → `{ toStatus: string, sinceField: string } | null`. `license` shape: `{ plan, status, premium_period_end_at, read_only_since, access_denied_since, deletion_eligible_since, export_confirmed_at }` (the bodega-mapped fields read from `licenses.raw`, see Task 3). `reminderKindFor(status)` → `'premium_read_only_reminder' | 'premium_access_denied_reminder' | null`. `weekBucketKey(now)` → `'YYYY-MM-DD'` (Monday of the current UTC week). Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `api/_lib/licenseLifecycle.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLifecycleTransition, reminderKindFor, weekBucketKey } from './licenseLifecycle.js'

const CFG = {
  paidPlanValues: ['premium'],
  graceDaysToReadOnly: 15,
  graceDaysToAccessDenied: 15,
  graceDaysToDeletionEligible: 30,
  sinceFields: { read_only: 'read_only_since', access_denied: 'access_denied_since', deletion_eligible: 'deletion_eligible_since' },
  exportConfirmedField: 'export_confirmed_at',
  periodEndField: 'premium_period_end_at',
}
const NOW = new Date('2026-08-01T00:00:00Z')

test('plan free nunca transiciona, sin importar el estado', () => {
  const lic = { plan: 'free', status: 'active', premium_period_end_at: '2026-01-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('active sin premium_period_end_at no transiciona (nunca se activó Premium con fecha)', () => {
  const lic = { plan: 'premium', status: 'active', premium_period_end_at: null }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('active dentro del período de gracia no transiciona', () => {
  // Venció hace 10 días, gracia es 15 → aún no.
  const lic = { plan: 'premium', status: 'active', premium_period_end_at: '2026-07-22T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('active → read_only tras 15 días vencido', () => {
  // Venció hace 16 días.
  const lic = { plan: 'premium', status: 'active', premium_period_end_at: '2026-07-16T00:00:00Z' }
  assert.deepEqual(computeLifecycleTransition(lic, CFG, NOW), { toStatus: 'read_only', sinceField: 'read_only_since' })
})

test('read_only dentro de su propio plazo no transiciona', () => {
  const lic = { plan: 'premium', status: 'read_only', read_only_since: '2026-07-25T00:00:00Z' } // 7 días
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('read_only → access_denied tras 15 días en ese estado', () => {
  const lic = { plan: 'premium', status: 'read_only', read_only_since: '2026-07-10T00:00:00Z' } // 22 días
  assert.deepEqual(computeLifecycleTransition(lic, CFG, NOW), { toStatus: 'access_denied', sinceField: 'access_denied_since' })
})

test('access_denied con exportación ya confirmada nunca avanza a deletion_eligible', () => {
  const lic = { plan: 'premium', status: 'access_denied', access_denied_since: '2026-05-01T00:00:00Z', export_confirmed_at: '2026-06-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('access_denied sin exportación → deletion_eligible tras 30 días', () => {
  const lic = { plan: 'premium', status: 'access_denied', access_denied_since: '2026-06-01T00:00:00Z', export_confirmed_at: null } // 61 días
  assert.deepEqual(computeLifecycleTransition(lic, CFG, NOW), { toStatus: 'deletion_eligible', sinceField: 'deletion_eligible_since' })
})

test('deletion_eligible ya seteado no se re-dispara (una sola vez)', () => {
  const lic = { plan: 'premium', status: 'access_denied', access_denied_since: '2026-01-01T00:00:00Z', export_confirmed_at: null, deletion_eligible_since: '2026-07-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('deletion_eligible no transiciona más (estado terminal hasta acción humana)', () => {
  const lic = { plan: 'premium', status: 'deletion_eligible', deletion_eligible_since: '2026-01-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('reminderKindFor: read_only y access_denied mandan tipos distintos, el resto ninguno', () => {
  assert.equal(reminderKindFor('read_only'), 'premium_read_only_reminder')
  assert.equal(reminderKindFor('access_denied'), 'premium_access_denied_reminder')
  assert.equal(reminderKindFor('active'), null)
  assert.equal(reminderKindFor('deletion_eligible'), null) // ya está en revisión humana, sin más recordatorios automáticos
})

test('weekBucketKey: mismo lunes UTC para toda la semana', () => {
  // 2026-08-01 es sábado; el lunes de esa semana es 2026-07-27.
  assert.equal(weekBucketKey(new Date('2026-08-01T23:00:00Z')), '2026-07-27')
  assert.equal(weekBucketKey(new Date('2026-07-27T00:00:00Z')), '2026-07-27')
  assert.equal(weekBucketKey(new Date('2026-08-02T00:00:00Z')), '2026-07-27') // domingo, misma semana
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- api/_lib/licenseLifecycle.test.js`
Expected: FAIL with `Cannot find module './licenseLifecycle.js'` (file doesn't exist yet).

- [ ] **Step 3: Write `api/_lib/licenseLifecycle.js`**

```js
// Lógica pura del ciclo de vida de licencia Premium (solo-lectura → acceso
// denegado → elegible para borrado). Sin imports ni efectos, para que sea
// trivialmente testeable (licenseLifecycle.test.js). El orquestador que toca
// bodega + puente vive en api/cron/license-lifecycle.js.
//
// Reglas de negocio (ver docs/superpowers/specs/2026-07-23-cateqhub-premium-license-lifecycle-design.md):
//   - Solo aplica a licencias con plan en lifecycleCfg.paidPlanValues.
//   - active → read_only: tras graceDaysToReadOnly días vencido el período pagado.
//   - read_only → access_denied: tras graceDaysToAccessDenied días en read_only.
//   - access_denied → deletion_eligible: tras graceDaysToDeletionEligible días en
//     access_denied Y sin exportación confirmada. Una sola vez (nunca se
//     re-dispara si deletion_eligible_since ya está seteado).
//   - deletion_eligible es terminal: solo una acción humana (borrado manual,
//     ver license-delete-premium-data) sale de ahí.

const DAY = 86_400_000

function daysSince(iso, now) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / DAY
}

// Calcula la siguiente transición de estado para una licencia, o null si no
// corresponde ninguna todavía. `now` inyectable para tests deterministas.
export function computeLifecycleTransition(license, lifecycleCfg, now = new Date()) {
  if (!lifecycleCfg.paidPlanValues.includes(license.plan)) return null

  const status = license.status || 'active'
  const sf = lifecycleCfg.sinceFields

  if (status === 'active') {
    const days = daysSince(license.premium_period_end_at, now)
    if (days === null || days < lifecycleCfg.graceDaysToReadOnly) return null
    return { toStatus: 'read_only', sinceField: sf.read_only }
  }

  if (status === 'read_only') {
    const days = daysSince(license.read_only_since, now)
    if (days === null || days < lifecycleCfg.graceDaysToAccessDenied) return null
    return { toStatus: 'access_denied', sinceField: sf.access_denied }
  }

  if (status === 'access_denied') {
    if (license[lifecycleCfg.exportConfirmedField]) return null // ya exportó, no avanza sola
    if (license.deletion_eligible_since) return null // ya se marcó, no se re-dispara
    const days = daysSince(license.access_denied_since, now)
    if (days === null || days < lifecycleCfg.graceDaysToDeletionEligible) return null
    return { toStatus: 'deletion_eligible', sinceField: sf.deletion_eligible }
  }

  return null // deletion_eligible es terminal — solo sale por acción humana
}

// Qué tipo de recordatorio semanal corresponde a un estado (o ninguno).
export function reminderKindFor(status) {
  if (status === 'read_only') return 'premium_read_only_reminder'
  if (status === 'access_denied') return 'premium_access_denied_reminder'
  return null
}

// Clave de bucket semanal (lunes UTC de la semana de `now`), para deduplicar
// recordatorios — como máximo uno por tenant por semana.
export function weekBucketKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() // 0=domingo..6=sábado
  const diffToMonday = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + diffToMonday)
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- api/_lib/licenseLifecycle.test.js`
Expected: PASS, all 13 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/licenseLifecycle.js api/_lib/licenseLifecycle.test.js
git commit -m "Agregar licenseLifecycle.js (lógica pura del ciclo de vida Premium)"
```

---

### Task 3: `messaging.js` — CateqHub recipient config + 5 new templates

**Files:**
- Modify: `api/_lib/messaging.js`
- Modify: `api/_lib/messaging.test.js`

**Interfaces:**
- Produces: `messagingFor('cateqhub')` → recipient config resolving the parish admin's email via the `User` entity. `renderMessage('premium_read_only'|'premium_access_denied'|'premium_read_only_reminder'|'premium_access_denied_reminder'|'premium_data_deleted_confirmation', ctx)` → `{ subject, html }`. Consumed by Task 5 (cron) and Task 6 (delete endpoint).

- [ ] **Step 1: Write the failing tests**

Add to the end of `api/_lib/messaging.test.js`:

```js
test('cateqhub: messagingFor resuelve destinatario vía User (parish_id/parish_role)', () => {
  const cfg = messagingFor('cateqhub')
  assert.ok(cfg)
  assert.equal(cfg.entity, 'Parish')
  assert.deepEqual(cfg.recipient.related.roles, ['admin'])
  assert.equal(cfg.recipient.related.roleField, 'parish_role')
})

test('premium_read_only: menciona Tutores pausado, no menciona el núcleo gratis', () => {
  const app = messagingFor('cateqhub')
  const out = renderMessage('premium_read_only', { app, tenantName: 'Parroquia San Juan' })
  assert.match(out.subject, /San Juan/)
  assert.match(out.html, /Tutores/)
  assert.doesNotMatch(out.html, /niñas.*eliminad|asistencia.*eliminad/i)
})

test('premium_access_denied: incluye instrucciones de exportar dentro de CateqHub', () => {
  const app = messagingFor('cateqhub')
  const out = renderMessage('premium_access_denied', { app, tenantName: 'Parroquia San Juan' })
  assert.match(out.html, /exportar/i)
})

test('premium_read_only_reminder y premium_access_denied_reminder son correos distintos', () => {
  const app = messagingFor('cateqhub')
  const a = renderMessage('premium_read_only_reminder', { app, tenantName: 'T' })
  const b = renderMessage('premium_access_denied_reminder', { app, tenantName: 'T' })
  assert.notEqual(a.subject, b.subject)
})

test('premium_data_deleted_confirmation confirma el borrado de Tutores, no de niños', () => {
  const app = messagingFor('cateqhub')
  const out = renderMessage('premium_data_deleted_confirmation', { app, tenantName: 'T' })
  assert.match(out.html, /Tutores/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- api/_lib/messaging.test.js`
Expected: FAIL — `messagingFor('cateqhub')` is `null` (no entry), and the four new `type` values fall through to the generic `campaign` branch of `renderMessage`, so subjects/bodies don't match the expected patterns.

- [ ] **Step 3: Add the `cateqhub` entry to `APP_MSG`**

In `api/_lib/messaging.js`, add to `APP_MSG` (after the `puntos` entry):

```js
  cateqhub: {
    name: 'CateqHub', entity: 'Parish', value: 'la asistencia y el catecismo de tu parroquia al día',
    recipient: { related: { entity: 'User', keyField: 'parish_id', keyFromRecord: 'id', emailField: 'email', roleField: 'parish_role', roles: ['admin'] }, nameField: 'name' },
  },
```

- [ ] **Step 4: Add the 5 new message types to `renderMessage`**

Insert these new `if (type === ...)` branches right before the final `// campaign — operator writes subject + body` comment (so they take precedence over the generic fallback):

```js
  if (type === 'premium_read_only') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}Tutores en ${app.name} está en modo solo lectura`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu plan Premium de <span class="hi">${esc(app.name)}</span> está pendiente de pago. Por ahora, <strong>agregar o editar Tutores</strong> quedó pausado — lo que ya registraste sigue visible sin cambios.</p>
<p>El resto de ${esc(app.name)} (niños, grupos, asistencia) sigue funcionando normalmente, sin ninguna restricción.</p>
<p>Confirma tu pago cuando puedas para reactivar Tutores. Cualquier duda, respóndenos este correo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_access_denied') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}acceso a Tutores denegado en ${app.name} — exporta tus datos`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Por falta de pago prolongada, el acceso a <strong>Tutores</strong> en <span class="hi">${esc(app.name)}</span> quedó denegado. El resto de la app (niños, grupos, asistencia) sigue funcionando normalmente.</p>
<p>Puedes <strong>descargar tus datos de Tutores</strong> directamente desde la pantalla de Premium dentro de ${esc(app.name)}, antes de que se eliminen. Solo tú, como administrador de tu parroquia, puedes hacerlo.</p>
<p>Si confirmas tu pago, tu acceso se reactiva de inmediato.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_read_only_reminder') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}recordatorio: Tutores sigue en solo lectura en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Solo un recordatorio: tu plan Premium de <span class="hi">${esc(app.name)}</span> sigue pendiente de pago, así que Tutores continúa en modo solo lectura.</p>
<p>Confirma tu pago cuando puedas para reactivarlo sin perder nada de lo ya registrado.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_access_denied_reminder') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}recordatorio: exporta tus datos de Tutores en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>El acceso a Tutores en <span class="hi">${esc(app.name)}</span> sigue denegado por falta de pago. Te recordamos que puedes <strong>descargar tus datos</strong> desde la pantalla de Premium antes de que se eliminen.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_data_deleted_confirmation') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}tus datos de Tutores en ${app.name} fueron eliminados`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Confirmamos que los datos de <strong>Tutores</strong> de tu parroquia en <span class="hi">${esc(app.name)}</span> fueron eliminados de la plataforma, tras haber confirmado tu exportación. El resto de tu información (niños, grupos, asistencia) no fue afectado.</p>
<p>Puedes volver a usar Tutores en cualquier momento activando el plan Premium de nuevo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- api/_lib/messaging.test.js`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/messaging.js api/_lib/messaging.test.js
git commit -m "messaging: agregar cateqhub y 5 plantillas del ciclo de vida Premium"
```

---

### Task 4: Migration — `license_lifecycle_reminders` table + CateqHub field map

**Files:**
- Create: `supabase/migrations/0026_cateqhub_license_lifecycle.sql`

**Interfaces:**
- Produces: table `public.license_lifecycle_reminders` (read by Task 5's cron via `supabaseAdmin`), and updates `apps.config` for `cateqhub` so `syncLicensesForApp` (existing, unmodified) maps `license_status`/`premium_period_end_at` into the bodega's `status`/`current_period_end` columns.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Ciclo de vida de licencia Premium para CateqHub (solo-lectura → acceso
-- denegado → elegible para borrado). Ver docs/superpowers/specs/2026-07-23-
-- cateqhub-premium-license-lifecycle-design.md.
--
--   1) license_lifecycle_reminders — bitácora de idempotencia de los
--      recordatorios semanales del cron license-lifecycle. unique(app_id,
--      external_id, period, kind) permite como máximo un correo de cada tipo
--      por tenant por semana, y el cron se puede reejecutar el mismo día sin
--      duplicar envíos.
--   2) apps.config.field_map de cateqhub — reemplaza el field_map parcial de
--      la migración 0025 (que todavía mapeaba trial_ends_at, campo que ya NO
--      existe en Parish desde que CateqHub eliminó el concepto de prueba
--      temporal) por el mapeo completo: status → license_status,
--      current_period_end → premium_period_end_at.
-- ============================================================================

create table if not exists public.license_lifecycle_reminders (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references public.apps(id) on delete cascade,
  external_id text not null,                     -- id de la Parish en el app
  period      text not null,                     -- 'YYYY-MM-DD', lunes UTC de la semana del envío
  kind        text not null,                     -- 'premium_read_only_reminder' | 'premium_access_denied_reminder'
  recipient   text,
  sent_at     timestamptz not null default now(),
  unique (app_id, external_id, period, kind)
);

create index if not exists license_lifecycle_reminders_app_period
  on public.license_lifecycle_reminders (app_id, period);

-- RLS: mismo patrón que renewal_reminders (0017) — miembros (viewer+) leen,
-- solo el service_role (el cron) escribe.
alter table public.license_lifecycle_reminders enable row level security;

create policy license_lifecycle_reminders_read on public.license_lifecycle_reminders
  for select using (public.is_member_at_least('viewer'));

update public.apps
  set config = config || '{
    "field_map": {
      "tenant_external_id": "id",
      "name": "name",
      "plan": "plan",
      "status": "license_status",
      "current_period_end": "premium_period_end_at"
    }
  }'::jsonb
  where id = 'cateqhub';
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "require('fs').readFileSync('supabase/migrations/0026_cateqhub_license_lifecycle.sql','utf8')"`
Expected: no error (file exists and is readable — this repo has no local Postgres to actually apply migrations against in this session; the real check is a human with Supabase MCP/CLI access running `supabase db push` or the equivalent, noted in Task 8's final PR checklist).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0026_cateqhub_license_lifecycle.sql
git commit -m "Migración: tabla license_lifecycle_reminders + field_map de cateqhub"
```

---

### Task 5: `api/cron/license-lifecycle.js` — the daily orchestrator

**Files:**
- Create: `api/cron/license-lifecycle.js`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `public.license_lifecycle_reminders` (Task 4).
- Produces: `GET/POST /api/cron/license-lifecycle` — same `CRON_SECRET`/`x-vercel-cron` gate as `api/cron/sync.js`. For every app with `licenseControlFor(app.id)?.lifecycle`, reads that app's premium licenses from the bodega, applies `computeLifecycleTransition`, writes transitions via `license.set` (with `mirror`), sends weekly reminder emails (deduped via `license_lifecycle_reminders`), and audits. Returns `{ ok: true, summary }`.

- [ ] **Step 1: Write `api/cron/license-lifecycle.js`**

```js
// Cron diario: ciclo de vida de licencia Premium (solo-lectura → acceso
// denegado → elegible para borrado). Aplica SOLO a apps con `lifecycle` en su
// entrada de api/_lib/licenseControl.js (hoy solo cateqhub). Nunca borra nada
// — deletion_eligible solo se refleja para revisión humana en Licencias
// (ver api/control/license-delete-premium-data.js para el borrado real).
// Lógica pura (computeLifecycleTransition/reminderKindFor/weekBucketKey) vive
// en api/_lib/licenseLifecycle.js.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { licenseControlFor } from '../_lib/licenseControl.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { computeLifecycleTransition, reminderKindFor, weekBucketKey } from '../_lib/licenseLifecycle.js'

// Extrae del `raw` (registro completo de Base44, guardado por el sync) los
// campos del ciclo de vida que no tienen columna dedicada en la bodega.
function licenseFromRaw(row, lifecycleCfg) {
  const raw = row.raw || {}
  return {
    plan: row.plan,
    status: row.status,
    premium_period_end_at: raw[lifecycleCfg.periodEndField] ?? null,
    read_only_since: raw[lifecycleCfg.sinceFields.read_only] ?? null,
    access_denied_since: raw[lifecycleCfg.sinceFields.access_denied] ?? null,
    deletion_eligible_since: raw[lifecycleCfg.sinceFields.deletion_eligible] ?? null,
    [lifecycleCfg.exportConfirmedField]: raw[lifecycleCfg.exportConfirmedField] ?? null,
  }
}

async function runLicenseLifecycle(now) {
  if (!bridgeConfigured()) return { skipped: 'bridge not configured', apps: [] }

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) throw new Error(error.message)

  const week = weekBucketKey(now)
  const summary = []

  for (const app of (apps ?? [])) {
    const cfg = licenseControlFor(app.id)
    if (!cfg?.lifecycle) continue
    const row = { app: app.id, transitioned: 0, reminded: 0, failed: 0 }

    const { data: lics, error: lErr } = await supabaseAdmin
      .from('licenses').select('external_id, plan, status, raw').eq('app_id', app.id)
    if (lErr) { row.error = lErr.message; summary.push(row); continue }

    const premium = (lics ?? []).filter((l) => cfg.lifecycle.paidPlanValues.includes(l.plan))
    if (premium.length === 0) { summary.push(row); continue }

    let byId = {}
    const msgCfg = messagingFor(app.id)
    if (msgCfg) {
      try {
        const recipients = await resolveRecipients(app, msgCfg)
        byId = Object.fromEntries(recipients.map((r) => [r.id, r]))
      } catch (e) { row.contactsError = e.message }
    }

    let didTransition = false
    for (const lic of premium) {
      const licState = licenseFromRaw(lic, cfg.lifecycle)
      const transition = computeLifecycleTransition(licState, cfg.lifecycle, now)

      if (transition) {
        const patch = { [cfg.statusField]: transition.toStatus, [transition.sinceField]: now.toISOString() }
        // Deriva `mirror` de cualquier clave de `patch` que tenga un mapeo en
        // cfg.mirror.fields — hoy una transición solo toca statusField, pero
        // esto se mantiene correcto si una transición futura llega a tocar
        // más de un campo (p.ej. planField también).
        const mirror = cfg.mirror
          ? [{ entity: cfg.mirror.entity, matchField: cfg.mirror.matchField, fields: Object.fromEntries(Object.entries(cfg.mirror.fields).filter(([sourceField]) => sourceField in patch).map(([sourceField, mirrorField]) => [mirrorField, patch[sourceField]])) }]
          : undefined
        try {
          await callBridge(app, 'license.set', { entity: cfg.entity, id: lic.external_id, patch, mirror })
          row.transitioned++
          didTransition = true
          licState.status = transition.toStatus // para que el recordatorio de abajo, en la misma corrida, use el estado ya actualizado
        } catch (e) {
          row.failed++
          console.error(`license-lifecycle: transición falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
          continue
        }
      }

      // Recordatorio semanal, independiente de si hubo transición esta corrida.
      const kind = reminderKindFor(licState.status)
      if (!kind || licState[cfg.lifecycle.exportConfirmedField]) continue
      const recipient = byId[lic.external_id]
      if (!recipient?.email) continue

      const { error: claimErr } = await supabaseAdmin.from('license_lifecycle_reminders')
        .insert({ app_id: app.id, external_id: lic.external_id, period: week, kind, recipient: recipient.email })
      if (claimErr) continue // ya se mandó esta semana

      const r = await sendFollowup(app, msgCfg, kind, recipient, {})
      if (r.sent) row.reminded++
      else row.failed++
    }

    if (didTransition) { try { await syncLicensesForApp(app) } catch { /* best-effort */ } }
    summary.push(row)
  }

  return { week, apps: summary }
}

export default async function handler(req, res) {
  // Mismo gate que los demás crons: CRON_SECRET (Bearer) o header de Vercel cron.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  try {
    const result = await runLicenseLifecycle(new Date())
    await audit('cron:license-lifecycle', { payload: result })
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
```

- [ ] **Step 2: Register the cron in `vercel.json`**

Change:

```json
  "crons": [
    { "path": "/api/cron/sync", "schedule": "0 8 * * *" },
    { "path": "/api/cron/renewal-reminders", "schedule": "0 15 1 * *" }
  ]
```

to:

```json
  "crons": [
    { "path": "/api/cron/sync", "schedule": "0 8 * * *" },
    { "path": "/api/cron/renewal-reminders", "schedule": "0 15 1 * *" },
    { "path": "/api/cron/license-lifecycle", "schedule": "0 9 * * *" }
  ]
```

- [ ] **Step 3: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed. (This file has no dedicated unit test — it's an orchestrator over already-tested pure logic, `callBridge`, and Supabase, matching this repo's existing convention where `api/cron/renewal-reminders.js` itself also has no direct test file; its pure helpers do.)

- [ ] **Step 4: Commit**

```bash
git add api/cron/license-lifecycle.js vercel.json
git commit -m "Agregar cron diario license-lifecycle (ciclo de vida Premium de CateqHub)"
```

---

### Task 6: `api/control/license-delete-premium-data.js` — owner-gated deletion endpoint

**Files:**
- Create: `api/control/license-delete-premium-data.js`
- Create: `api/control/license-delete-premium-data.test.js`
- Modify: `src/lib/control.js`

**Interfaces:**
- Produces: `POST /api/control/license-delete-premium-data` `{ appId, licenseExternalId, confirmParishName }` → `{ ok: true, deletedCounts }` on success; `401/403/404/400/409/502` otherwise. Requires `owner` role. `deletePremiumData(appId, licenseExternalId, confirmParishName)` client helper in `src/lib/control.js`, consumed by Task 8 (`Licenses.jsx`).

- [ ] **Step 1: Write the failing tests**

Create `api/control/license-delete-premium-data.test.js`. This repo's existing `.test.js` files for `api/_lib/*` mock nothing (pure functions) — this endpoint has real dependencies (Supabase, bridge), so extract its two pure guard checks into testable functions first:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertExportConfirmed, assertParishNameMatches } from './license-delete-premium-data.js'

test('assertExportConfirmed: rechaza sin export_confirmed_at', () => {
  const result = assertExportConfirmed({ raw: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'export_not_confirmed')
})

test('assertExportConfirmed: acepta con export_confirmed_at presente', () => {
  const result = assertExportConfirmed({ raw: { export_confirmed_at: '2026-07-01T00:00:00Z' } })
  assert.equal(result.ok, true)
})

test('assertParishNameMatches: exige coincidencia exacta (no case-insensitive, no trim silencioso)', () => {
  assert.equal(assertParishNameMatches('Parroquia San Juan', 'Parroquia San Juan').ok, true)
  assert.equal(assertParishNameMatches('Parroquia San Juan', 'parroquia san juan').ok, false)
  assert.equal(assertParishNameMatches('Parroquia San Juan', 'Parroquia San Juan ').ok, false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- api/control/license-delete-premium-data.test.js`
Expected: FAIL with `Cannot find module './license-delete-premium-data.js'`.

- [ ] **Step 3: Write `api/control/license-delete-premium-data.js`**

```js
// Borrado manual y definitivo de datos Premium (Guardian/ChildGuardian de
// CateqHub) de un tenant delincuente. Deliberadamente SEPARADO de
// license-action.js: es la única acción destructiva de todo api/control/*, así
// que sube el piso de autorización a `owner` y exige, del lado del servidor,
// que la exportación ya haya sido confirmada — nunca confía en el estado que
// mande el cliente.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { licenseControlFor } from '../_lib/licenseControl.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'

// Exportado para test unitario — la licencia trae `raw` (registro completo del
// app, ver syncLicenses.js) donde vive export_confirmed_at (sin columna propia
// en la bodega).
export function assertExportConfirmed(license) {
  if (!license?.raw?.export_confirmed_at) return { ok: false, error: 'export_not_confirmed' }
  return { ok: true }
}

// Exportado para test unitario — confirmación por nombre exacto, sin
// normalizar (mayúsculas/espacios deben coincidir tal cual), patrón típico de
// acciones irreversibles: reduce el riesgo de "confirmar" el tenant equivocado
// por un match relajado.
export function assertParishNameMatches(actualName, typedName) {
  return { ok: actualName === typedName }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'owner')
  if (!member) return

  const { appId, licenseExternalId, confirmParishName } = req.body ?? {}
  if (!appId || !licenseExternalId || !confirmParishName) {
    return res.status(400).json({ error: 'falta appId/licenseExternalId/confirmParishName' })
  }
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const cfg = licenseControlFor(appId)
  if (!cfg?.lifecycle) return res.status(400).json({ error: `app ${appId} no soporta borrado de datos Premium` })

  const { data: lic, error: lErr } = await supabaseAdmin
    .from('licenses').select('raw').eq('app_id', appId).eq('external_id', licenseExternalId).maybeSingle()
  if (lErr) return res.status(500).json({ error: lErr.message })
  if (!lic) return res.status(404).json({ error: 'licencia no encontrada' })

  const exportCheck = assertExportConfirmed(lic)
  if (!exportCheck.ok) return res.status(409).json({ error: exportCheck.error })

  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('name').eq('app_id', appId).eq('external_id', licenseExternalId).maybeSingle()
  const nameCheck = assertParishNameMatches(tenant?.name ?? '', confirmParishName)
  if (!nameCheck.ok) return res.status(400).json({ error: 'el nombre no coincide con el de la parroquia' })

  const { data: app, error: aErr } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (aErr) return res.status(500).json({ error: aErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  try {
    // Paso 1: borrado, orden hijo→padre para no dejar referencias huérfanas.
    const delOut = await callBridge(app, 'license.deletePremiumData', {
      deleteEntities: [
        { entity: 'ChildGuardian', field: 'parish_id', value: licenseExternalId },
        { entity: 'Guardian', field: 'parish_id', value: licenseExternalId },
      ],
    })
    const deletedCounts = delOut?.deletedCounts ?? {}

    // Paso 2: reset del estado de licencia, vía la acción genérica ya existente
    // (así el mirror hacia User se aplica igual que en cualquier otro license.set).
    const resetPatch = {
      [cfg.planField]: 'free', [cfg.statusField]: 'active',
      [cfg.lifecycle.sinceFields.read_only]: null,
      [cfg.lifecycle.sinceFields.access_denied]: null,
      [cfg.lifecycle.sinceFields.deletion_eligible]: null,
      [cfg.lifecycle.exportConfirmedField]: null,
    }
    const mirror = cfg.mirror
      ? [{ entity: cfg.mirror.entity, matchField: cfg.mirror.matchField, fields: { [cfg.mirror.fields.plan]: 'free', [cfg.mirror.fields.license_status]: 'active' } }]
      : undefined
    await callBridge(app, 'license.set', { entity: cfg.entity, id: licenseExternalId, patch: resetPatch, mirror })

    let resync = null
    try { resync = await syncLicensesForApp(app) } catch (e) { resync = { error: e.message } }

    // Correo de confirmación, best-effort.
    let emailed = false
    try {
      const msgCfg = messagingFor(appId)
      if (msgCfg) {
        const recipients = await resolveRecipients(app, msgCfg)
        const recipient = recipients.find((r) => r.id === licenseExternalId)
        if (recipient) {
          const r = await sendFollowup(app, msgCfg, 'premium_data_deleted_confirmation', recipient, {})
          emailed = !!r.sent
        }
      }
    } catch (e) { console.warn('[license-delete-premium-data] correo falló:', e.message) }

    await audit('control:license-delete-premium-data', {
      actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
      payload: { deletedCounts, emailed },
    })
    return res.status(200).json({ ok: true, deletedCounts, emailed, resync })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- api/control/license-delete-premium-data.test.js`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Add the client helper to `src/lib/control.js`**

Add after the existing `licenseAction` export:

```js
// WRITE, destructiva: borra los datos Premium (Tutores) de un tenant, solo si
// ya confirmó su propia exportación (el servidor lo revalida, no confía en el
// cliente). Requiere rol owner y escribir el nombre exacto de la parroquia.
export function deletePremiumData(appId, licenseExternalId, confirmParishName) {
  return postControl('/api/control/license-delete-premium-data', { appId, licenseExternalId, confirmParishName })
}
```

- [ ] **Step 6: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add api/control/license-delete-premium-data.js api/control/license-delete-premium-data.test.js src/lib/control.js
git commit -m "Agregar endpoint owner-gated de borrado de datos Premium (gateado por exportación confirmada)"
```

---

### Task 7: `Licenses.jsx` — per-app status labels, export badge, delete flow

**Files:**
- Modify: `src/pages/Licenses.jsx`

**Interfaces:**
- Consumes: `deletePremiumData` (Task 6).
- Produces: correct button visibility/labels for CateqHub (whose stored status values are `read_only`/`access_denied`, not the generic `view_only`/`suspended` every other app uses), an "Exportación confirmada" badge, and a "Borrar datos Premium" button + name-confirmation modal visible only when `status === 'deletion_eligible'`.

- [ ] **Step 1: Add per-app status-value awareness**

The existing button-visibility checks (`r.status !== 'active'`, `r.status !== 'suspended'`, `r.status !== 'view_only'`) implicitly assume every app stores the literal strings `'active'/'suspended'/'view_only'` — true for every app registered today, but CateqHub stores `'read_only'`/`'access_denied'` instead (see Task 1's `statuses` map). Add a small client-side mirror of that mapping (same pattern as the existing `PLANS`/`HAS_VIEW_ONLY` comment) right after `FIRST_OF_MONTH`:

```js
// Mirror of api/_lib/licenseControl.js APPS[app].statuses (client can't import
// server-only code). Only apps whose stored status strings differ from the
// generic op names (active/suspended/view_only) need an entry — CateqHub uses
// read_only/access_denied for clearer in-app copy (see the Premium license
// lifecycle design doc).
const STATUS_VALUES = {
  cateqhub: { active: 'active', suspended: 'access_denied', view_only: 'read_only' },
}
function statusValue(appId, op) {
  return STATUS_VALUES[appId]?.[op] ?? op
}
```

- [ ] **Step 2: Add the new status styles**

Change:

```js
const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  trial: 'bg-blue-50 text-blue-700',
  view_only: 'bg-amber-50 text-amber-700',
  past_due: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-700',
  canceled: 'bg-red-50 text-red-700',
  cancelled: 'bg-red-50 text-red-700',
  expired: 'bg-red-50 text-red-700',
}
```

to:

```js
const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  trial: 'bg-blue-50 text-blue-700',
  view_only: 'bg-amber-50 text-amber-700',
  read_only: 'bg-amber-50 text-amber-700',
  past_due: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-700',
  access_denied: 'bg-red-50 text-red-700',
  canceled: 'bg-red-50 text-red-700',
  cancelled: 'bg-red-50 text-red-700',
  expired: 'bg-red-50 text-red-700',
  deletion_eligible: 'bg-red-100 text-red-800 font-semibold',
}
```

- [ ] **Step 3: Add CateqHub to `PLANS` and `HAS_VIEW_ONLY`**

Change:

```js
const PLANS = {
  flowfin: ['home', 'family_plus', 'circle'],
  stockflow: ['start', 'growth', 'pro'],
  rumbo: ['trial', 'starter', 'pro', 'enterprise'],
  liuma: ['start', 'growth', 'plus'],
  puntos: ['starter', 'growth', 'pro', 'enterprise'],
}
const HAS_VIEW_ONLY = new Set(['flowfin', 'stockflow', 'liuma', 'puntos']) // rumbo has no view_only
```

to:

```js
const PLANS = {
  flowfin: ['home', 'family_plus', 'circle'],
  stockflow: ['start', 'growth', 'pro'],
  rumbo: ['trial', 'starter', 'pro', 'enterprise'],
  liuma: ['start', 'growth', 'plus'],
  puntos: ['starter', 'growth', 'pro', 'enterprise'],
  cateqhub: ['free', 'premium'],
}
const HAS_VIEW_ONLY = new Set(['flowfin', 'stockflow', 'liuma', 'puntos', 'cateqhub']) // rumbo has no view_only
```

Note `cateqhub` is intentionally **absent** from `HAS_BILLING` (a few lines below) — it has no `confirm_payment` flow (see Task 1's `billing: null`), so the existing `{HAS_BILLING.has(r.app_id) && ...}` guards already correctly hide "Confirmar pago" and "Cobro auto" for it without any change.

- [ ] **Step 4: Select `raw` and use `statusValue()` in the button conditionals**

Change the `load()` query's `select`:

```js
      supabase.from('licenses')
        .select('id, external_id, app_id, plan, status, seats, current_period_end, trial_ends_at, auto_renew, apps(name), tenants(name)')
        .order('synced_at', { ascending: false }),
```

to:

```js
      supabase.from('licenses')
        .select('id, external_id, app_id, plan, status, seats, current_period_end, trial_ends_at, auto_renew, raw, apps(name), tenants(name)')
        .order('synced_at', { ascending: false }),
```

Change the three status-dependent buttons:

```jsx
                          {r.status !== 'active' && (
                            <button onClick={() => ask(r, 'reactivate')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.reactivate.cls}`}>Reactivar</button>
                          )}
                          {r.status !== 'suspended' && (
                            <button onClick={() => ask(r, 'suspend')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.suspend.cls}`}>Pausar</button>
                          )}
                          {HAS_VIEW_ONLY.has(r.app_id) && r.status !== 'view_only' && (
                            <button onClick={() => ask(r, 'view_only')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.view_only.cls}`}>Solo lectura</button>
                          )}
```

to:

```jsx
                          {r.status !== statusValue(r.app_id, 'active') && (
                            <button onClick={() => ask(r, 'reactivate')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.reactivate.cls}`}>Reactivar</button>
                          )}
                          {r.status !== statusValue(r.app_id, 'suspend') && (
                            <button onClick={() => ask(r, 'suspend')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.suspend.cls}`}>Pausar</button>
                          )}
                          {HAS_VIEW_ONLY.has(r.app_id) && r.status !== statusValue(r.app_id, 'view_only') && (
                            <button onClick={() => ask(r, 'view_only')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.view_only.cls}`}>Solo lectura</button>
                          )}
```

(Note: `STATUS_VALUES.cateqhub` keys are `active`/`suspended`/`view_only` — matching the `op` names, not `'reactivate'` — so `statusValue(r.app_id, 'suspend')` needs the map keyed by `suspend`, not `suspended`. Fix the map from Step 1 to use the op names consistently:)

```js
const STATUS_VALUES = {
  cateqhub: { active: 'active', suspend: 'access_denied', view_only: 'read_only' },
}
```

- [ ] **Step 5: Add the export-confirmed badge and delete button**

Add state for the delete-confirmation modal, alongside the existing `useState` calls:

```jsx
  const [del, setDel] = useState(null) // { row } — delete-premium-data modal
  const [delTyped, setDelTyped] = useState('')
```

Add the badge inside the "Estado" `<td>`, right after the existing status `<span>`:

```jsx
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{r.status ?? '—'}</span>
                      {r.raw?.export_confirmed_at && (
                        <div className="mt-1 text-[11px] text-emerald-600">✓ Exportación confirmada {fmtDate(r.raw.export_confirmed_at)}</div>
                      )}
                    </td>
```

Add the delete button inside the "Control" `<td>`'s button row, after the `HAS_VIEW_ONLY` button block:

```jsx
                          {r.status === 'deletion_eligible' && (
                            <button
                              onClick={() => { setDel({ row: r }); setDelTyped('') }}
                              disabled={!r.raw?.export_confirmed_at}
                              title={r.raw?.export_confirmed_at ? undefined : 'El tenant aún no confirmó su exportación'}
                              className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Borrar datos Premium
                            </button>
                          )}
```

- [ ] **Step 6: Add the delete-confirmation modal and its handler**

Add the handler function after the existing `runPayment` function:

```jsx
  async function runDelete() {
    if (!del) return
    setBusy(true); setFlash(null)
    const { row } = del
    try {
      const out = await deletePremiumData(row.app_id, row.external_id, delTyped)
      await load()
      setFlash({ ok: true, msg: `Datos Premium borrados para ${row.tenants?.name ?? row.external_id}: ${JSON.stringify(out.deletedCounts)}.` })
      setDel(null); setDelTyped('')
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(false) }
  }
```

Add the `deletePremiumData` import at the top:

```jsx
import { licenseAction, deletePremiumData } from '../lib/control.js'
```

Add the modal JSX right after the closing `</div>` of the existing "Payment-confirmation modal" block, before the component's final closing `</div>`:

```jsx
      {/* Delete-premium-data modal — the only destructive action here */}
      {del && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={() => !busy && setDel(null)}>
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-paper-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-red-800">Borrar datos Premium</h3>
            <p className="mt-1 text-sm text-ink-soft">
              {del.row.apps?.name ?? del.row.app_id} · <span className="font-medium text-ink">{del.row.tenants?.name ?? del.row.external_id}</span>
            </p>
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Esto borra permanentemente los Tutores y las relaciones tutor-niño de esta parroquia. Los niños, grupos y asistencia NO se ven afectados. Esta acción no se puede deshacer.
            </p>
            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-ink-mute">
              Escribe el nombre exacto de la parroquia para confirmar: <span className="normal-case text-ink">{del.row.tenants?.name}</span>
            </label>
            <input value={delTyped} onChange={(e) => setDelTyped(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-hair bg-white px-3 py-1.5 text-sm text-ink" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDel(null)} disabled={busy} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">Cancelar</button>
              <button onClick={runDelete} disabled={busy || delTyped !== del.row.tenants?.name} className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-40">{busy ? 'Borrando…' : 'Borrar datos Premium'}</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Licenses.jsx
git commit -m "Licenses: soportar estados read_only/access_denied de cateqhub y borrado de datos Premium"
```

---

### Task 8: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite, build, and lint**

Run: `npm run test && npm run build && npm run lint`
Expected: all succeed — every new `*.test.js` file plus the full pre-existing suite passes, build is clean, zero lint errors.

- [ ] **Step 2: Manual review checklist (add to the PR description)**

- [ ] Este PR depende del PR hermano en `jospabloh/asistencia-catecismo` (capacidad `mirror` en `license.set` + acción `license.deletePremiumData` del puente `acaciaControl`, más el esquema de `Parish`/`User`) — no fusionar esta rama antes que esa, o el cron y el endpoint de borrado fallarán al llamar al puente (502, mensaje de error real del puente).
- [ ] La migración `0026_cateqhub_license_lifecycle.sql` debe aplicarse a Supabase (`supabase db push` o el flujo de deploy habitual) — no se aplicó desde esta sesión.
- [ ] Una vez ambos PRs desplegados: activar `plan=premium` en una parroquia de prueba desde Licencias, verificar que `Confirmar pago`/`Pausar`/`Solo lectura` operan y los badges se ven correctos; simular el paso del tiempo (mover `premium_period_end_at`/`read_only_since`/`access_denied_since` manualmente en el panel de Base44) para ver `read_only` → `access_denied` → `deletion_eligible` reflejarse tras correr el cron manualmente (`GET /api/cron/license-lifecycle` con el `CRON_SECRET`).
- [ ] Confirmar que el botón "Borrar datos Premium" permanece deshabilitado hasta que `export_confirmed_at` aparece en la bodega, y que el borrado real solo funciona con rol `owner`.

- [ ] **Step 3: Note deployment status in the PR**

State explicitly in the PR description that the Supabase migration has not been applied and the sibling repo's bridge changes are a hard dependency for the cron/delete endpoint to function end-to-end.
