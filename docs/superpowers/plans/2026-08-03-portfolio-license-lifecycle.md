# Ciclo de vida de licencia unificado (portafolio) — Fase 1 (solo Mission Control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que Mission Control aplique automáticamente el ciclo de vida de
licencia unificado (activo → read-only día 8 → bloqueado día 15 → inactivo
día 30 → elegible-para-borrado día 45, acumulado desde el vencimiento) para
flowfin, stockflow, liuma, puntos, rumbo y radar — usando únicamente datos y
capacidades que Mission Control ya tiene desplegados (sin tocar ningún schema
ni función de Base44).

**Architecture:** Extiende el mecanismo `cfg.lifecycle` de
`api/_lib/licenseControl.js` (hoy solo `cateqhub`) con una segunda forma —
"unificada", acumulada desde `current_period_end` en vez de por-etapa con
"since fields" — y un branch nuevo en el cron existente
`api/cron/license-lifecycle.js` que la reconoce y despacha. Reutiliza
`license_lifecycle_reminders` (ya existe, migración 0026) para deduplicar los
correos semanales — mismo patrón ya probado con CateqHub. Agrega una tabla
nueva, `payment_reports`, para el flujo de "reporte de pago pendiente de
confirmación del owner".

**Tech Stack:** Node.js (`node --test`, sin framework), Supabase/Postgres,
Vercel serverless functions, React 18 + Vite (no se toca en este plan).

## Global Constraints

- Ver supuestos confirmados/pendientes en
  `docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md`
  antes de ejecutar — este plan asume cómputo de días **acumulado desde el
  vencimiento** y CateqHub como excepción explícita.
- **Nunca borra tenants ni datos.** `deletion_eligible` es bookkeeping puro,
  visible solo como dato derivado — ninguna tarea de este plan escribe una
  acción de borrado.
- Ningún paso de este plan requiere el Base44 MCP ni un deploy de función/
  schema Base44 — todo usa la acción genérica `license.set` ya desplegada y
  columnas ya sincronizadas (`current_period_end`, `status`) en
  `public.licenses`.
- `npm run build` y `npm run lint` en verde, y `node --test` (150+ existentes
  + los nuevos) en verde, antes de cada commit.
- Comentarios y copy de correos en español, mismo tono que el resto del
  archivo (ver `api/_lib/messaging.js` existente).

---

### Task 1: `api/_lib/portfolioLifecycle.js` — lógica pura del ciclo unificado

**Files:**
- Create: `api/_lib/portfolioLifecycle.js`
- Test: `api/_lib/portfolioLifecycle.test.js`

**Interfaces:**
- Produces: `computePortfolioLifecycleStage(license, cfg, now = new Date())`
  → `null | { stage: 'read_only'|'blocked'|'inactive'|'deletion_eligible', targetStatus: string|null }`.
  `license` es `{ status, current_period_end }`. `cfg` es el bloque
  `lifecycle` unificado (ver Task 2 para su forma exacta).
  `emailKindForStage(stage)` → `'license_read_only' | 'license_blocked' | 'license_inactive_warning' | null`
  (`null` para `deletion_eligible` — nunca se manda correo al tenant en esa
  etapa, ver spec §Decisiones).

- [ ] **Step 1: Write the failing test**

```js
// api/_lib/portfolioLifecycle.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePortfolioLifecycleStage, emailKindForStage } from './portfolioLifecycle.js'

const CFG = {
  graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45,
  readOnlyStatus: 'view_only', blockedStatus: 'suspended',
}
const NOW = new Date('2026-08-03T00:00:00Z')

test('sin current_period_end no hay etapa', () => {
  assert.equal(computePortfolioLifecycleStage({ plan: 'pro', status: 'active', current_period_end: null }, CFG, NOW), null)
})

test("plan 'founder' nunca entra al ciclo, incluso con current_period_end vencido", () => {
  const lic = { plan: 'founder', status: 'active', current_period_end: '2026-06-01T00:00:00Z' } // muy vencido
  assert.equal(computePortfolioLifecycleStage(lic, CFG, NOW), null)
})

test('dentro de los 8 días de gracia no hay etapa', () => {
  // Venció hace 7 días.
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-27T00:00:00Z' }
  assert.equal(computePortfolioLifecycleStage(lic, CFG, NOW), null)
})

test('día 8 (acumulado): read_only, con el status del app si lo soporta', () => {
  // Venció hace exactamente 8 días.
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-26T00:00:00Z' }
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'read_only', targetStatus: 'view_only' })
})

test('día 8, app sin read-only en su schema (rumbo/radar): stage sigue siendo read_only, targetStatus null', () => {
  const cfgSinReadOnly = { ...CFG, readOnlyStatus: null }
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-26T00:00:00Z' }
  assert.deepEqual(computePortfolioLifecycleStage(lic, cfgSinReadOnly, NOW), { stage: 'read_only', targetStatus: null })
})

test('día 15 (acumulado): blocked', () => {
  const lic = { plan: 'pro', status: 'view_only', current_period_end: '2026-07-19T00:00:00Z' } // 15 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'blocked', targetStatus: 'suspended' })
})

test('día 30 (acumulado): inactive, sin targetStatus (bookkeeping interno, no se escribe al app)', () => {
  const lic = { plan: 'pro', status: 'suspended', current_period_end: '2026-07-04T00:00:00Z' } // 30 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'inactive', targetStatus: null })
})

test('día 45 (acumulado): deletion_eligible, sin targetStatus', () => {
  const lic = { plan: 'pro', status: 'suspended', current_period_end: '2026-06-19T00:00:00Z' } // 45 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'deletion_eligible', targetStatus: null })
})

test('emailKindForStage: mapea read_only/blocked/inactive, deletion_eligible no manda correo al tenant', () => {
  assert.equal(emailKindForStage('read_only'), 'license_read_only')
  assert.equal(emailKindForStage('blocked'), 'license_blocked')
  assert.equal(emailKindForStage('inactive'), 'license_inactive_warning')
  assert.equal(emailKindForStage('deletion_eligible'), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/_lib/portfolioLifecycle.test.js`
Expected: FAIL — `Cannot find module './portfolioLifecycle.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// api/_lib/portfolioLifecycle.js
// Lógica pura del ciclo de vida de licencia UNIFICADO (portafolio completo,
// distinto del ciclo por-etapa de CateqHub en licenseLifecycle.js). Sin
// imports ni efectos, para que sea trivialmente testeable
// (portfolioLifecycle.test.js). El orquestador vive en api/cron/license-lifecycle.js.
//
// Reglas de negocio (ver docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md):
//   - Acumulado desde current_period_end (NO por-etapa, a diferencia de CateqHub):
//     día 8 → read_only, día 15 → blocked, día 30 → inactive, día 45 → deletion_eligible.
//   - read_only y blocked solo escriben al app si cfg.readOnlyStatus/blockedStatus
//     existen (rumbo/radar no tienen read-only en su schema hoy — targetStatus
//     queda null, pero la etapa se sigue reportando para mandar el correo).
//   - inactive y deletion_eligible son bookkeeping interno de Mission Control:
//     nunca escriben nada al app (targetStatus siempre null).
//   - deletion_eligible nunca manda correo al tenant — solo alerta interna
//     (ver Licenses.jsx, fuera de este plan). El borrado real nunca es automático.
//   - plan === 'founder' NUNCA entra al ciclo (plan oculto, vitalicio por
//     diseño — ver spec §Decisiones #5) — se excluye aquí explícitamente, no
//     confiando en que current_period_end quede en null en algún otro punto
//     del sistema (si algún día un tenant Founder SÍ trae una fecha vieja de
//     un plan anterior, este chequeo evita que el ciclo lo alcance igual).

const DAY = 86_400_000

function daysSince(iso, now) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / DAY
}

export function computePortfolioLifecycleStage(license, cfg, now = new Date()) {
  if (license.plan === 'founder') return null
  const days = daysSince(license.current_period_end, now)
  if (days === null || days < cfg.graceDaysToReadOnly) return null

  if (days < cfg.graceDaysToBlocked) {
    return { stage: 'read_only', targetStatus: cfg.readOnlyStatus ?? null }
  }
  if (days < cfg.graceDaysToInactive) {
    return { stage: 'blocked', targetStatus: cfg.blockedStatus ?? null }
  }
  if (days < cfg.graceDaysToDeletionEligible) {
    return { stage: 'inactive', targetStatus: null }
  }
  return { stage: 'deletion_eligible', targetStatus: null }
}

export function emailKindForStage(stage) {
  if (stage === 'read_only') return 'license_read_only'
  if (stage === 'blocked') return 'license_blocked'
  if (stage === 'inactive') return 'license_inactive_warning'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/_lib/portfolioLifecycle.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add api/_lib/portfolioLifecycle.js api/_lib/portfolioLifecycle.test.js
git commit -m "Ciclo de vida unificado: lógica pura de etapas (día 8/15/30/45)"
```

---

### Task 2: `api/_lib/licenseControl.js` — bloque `lifecycle` unificado + plan `founder`

**Files:**
- Modify: `api/_lib/licenseControl.js:28-156` (bloque `APPS`)
- Test: `api/_lib/licenseControl.test.js`

**Interfaces:**
- Consumes: nada nuevo (extiende el objeto `APPS` ya exportado vía
  `licenseControlFor`, `plansFor`).
- Produces: cada entrada de `flowfin/stockflow/liuma/puntos/rumbo/radar` gana
  `lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15,
  graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus,
  blockedStatus }` (forma que Task 1/4 consumen) y `'founder'` al final de
  `plans`.

- [ ] **Step 1: Write the failing test**

```js
// añadir a api/_lib/licenseControl.test.js (archivo ya existe — agregar estos casos)
import { licenseControlFor, plansFor } from './licenseControl.js'

test('lifecycle unificado: flowfin/stockflow/liuma/puntos tienen read-only y bloqueo', () => {
  for (const id of ['flowfin', 'stockflow', 'liuma', 'puntos']) {
    const cfg = licenseControlFor(id)
    assert.equal(cfg.lifecycle.graceDaysToReadOnly, 8)
    assert.equal(cfg.lifecycle.graceDaysToBlocked, 15)
    assert.equal(cfg.lifecycle.graceDaysToInactive, 30)
    assert.equal(cfg.lifecycle.graceDaysToDeletionEligible, 45)
    assert.equal(cfg.lifecycle.readOnlyStatus, cfg.statuses.view_only)
    assert.equal(cfg.lifecycle.blockedStatus, cfg.statuses.suspended)
  }
})

test('lifecycle unificado: rumbo y radar NO tienen read-only en su schema (readOnlyStatus null)', () => {
  for (const id of ['rumbo', 'radar']) {
    const cfg = licenseControlFor(id)
    assert.equal(cfg.lifecycle.readOnlyStatus, null)
    assert.equal(cfg.lifecycle.blockedStatus, cfg.statuses.suspended)
  }
})

test('cateqhub conserva su propio lifecycle por-etapa (NO se toca en este plan)', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.equal(cfg.lifecycle.graceDaysToReadOnly, 15) // sigue siendo el suyo, no 8
  assert.ok(cfg.lifecycle.sinceFields) // forma CateqHub, distinta de la unificada
})

test("plan oculto 'founder' disponible en los 6 apps de licencia de asiento", () => {
  for (const id of ['flowfin', 'stockflow', 'liuma', 'puntos', 'rumbo', 'radar']) {
    assert.ok(plansFor(id).includes('founder'), `${id} debería listar founder`)
  }
  assert.ok(!plansFor('cateqhub').includes('founder')) // CateqHub no tiene licencia de asiento
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/_lib/licenseControl.test.js`
Expected: FAIL — `cfg.lifecycle` es `undefined` para flowfin/stockflow/liuma/puntos/rumbo/radar, y `plansFor('flowfin')` no incluye `'founder'`.

- [ ] **Step 3: Write minimal implementation**

Editar `api/_lib/licenseControl.js` — agregar `lifecycle` y `'founder'` a cada
entrada (mostrando el archivo completo de `APPS` con los cambios; el resto de
cada objeto queda igual a como está hoy):

```js
const APPS = {
  flowfin: {
    entity: 'Family', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['home', 'family_plus', 'circle', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'full', dayConvention: 'first_of_month' },
    // Ciclo de vida unificado (portafolio) — ver
    // docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md.
    // Acumulado desde current_period_end, NO por-etapa (a diferencia de
    // cateqhub abajo) — computePortfolioLifecycleStage (portfolioLifecycle.js)
    // no necesita "since fields" porque cada umbral se mide desde una sola fecha.
    lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  stockflow: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'pro', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref', dayConvention: 'preserve_day' },
    lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  radar: {
    entity: 'Company', statusField: 'status', planField: 'tier',
    statuses: { active: 'active', suspended: 'suspended' },
    plans: ['starter', 'pro', 'enterprise', 'founder'],
    billing: { expiryField: 'license_expiry', trialField: null, dateFormat: 'date', payment: null, dayConvention: 'preserve_day' },
    // Radar no tiene un valor de solo-lectura en su schema (Company.jsonc:
    // enum ["active","suspended"]) — readOnlyStatus null hasta agregarlo vía
    // Base44 MCP. El cron sigue mandando el correo del día 8, solo no puede
    // aplicar el estado (ver enforcementGap en license-lifecycle.js).
    lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: null, blockedStatus: 'suspended' },
  },
  rumbo: {
    entity: 'TenantLicense', statusField: 'status', planField: 'plan',
    statuses: { active: 'active', suspended: 'suspended' },
    plans: ['trial', 'starter', 'pro', 'enterprise', 'founder'],
    billing: { expiryField: 'current_period_end', trialField: 'trial_ends_at', dateFormat: 'date', payment: 'rumbo', dayConvention: 'preserve_day' },
    // Mismo caso que Radar: TenantLicense.jsonc no tiene un valor de
    // solo-lectura (enum ["active","expired","suspended","cancelled"]).
    lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: null, blockedStatus: 'suspended' },
  },
  liuma: {
    entity: 'SchoolSubscription', statusField: 'subscription_status', planField: 'license_tier',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'plus', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_date', dateFormat: 'datetime', payment: 'full', dayConvention: 'first_of_month' },
    lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  puntos: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['starter', 'growth', 'pro', 'enterprise', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref', dayConvention: 'preserve_day', activeExtra: { status: 'active' } },
    audit: { entity: 'LicenseEvent', idField: 'business_id', eventType: {
      reactivate: 'reactivated', suspend: 'suspended', view_only: 'view_only', set_plan: 'plan_changed',
      confirm_payment: 'license_renewed',
    } },
    lifecycle: { graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  cateqhub: {
    // ... SIN CAMBIOS — todo el bloque cateqhub existente (entity, statuses,
    // plans, billing, mirror, addons, freeDowngrade, lifecycle por-etapa con
    // sinceFields) se queda exactamente igual. Ver spec §Decisiones #1:
    // CateqHub es la excepción explícita, no se toca en este plan.
  },
}
```

(El `// ...` de `cateqhub` es una nota para quien ejecute el paso — el bloque
real no cambia una sola línea; NO copiarlo literal, dejar el objeto `cateqhub`
existente intacto tal cual está en el archivo hoy.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/_lib/licenseControl.test.js`
Expected: PASS (todos los casos, incluidos los preexistentes — no se rompió nada)

- [ ] **Step 5: Commit**

```bash
git add api/_lib/licenseControl.js api/_lib/licenseControl.test.js
git commit -m "licenseControl: ciclo de vida unificado (8/15/30/45) + plan oculto founder"
```

---

### Task 3: `api/_lib/messaging.js` — 3 correos nuevos del ciclo unificado

**Files:**
- Modify: `api/_lib/messaging.js` (agregar 3 bloques `if (type === ...)` antes del `// campaign` final, línea ~244)
- Test: `api/_lib/messaging.test.js`

**Interfaces:**
- Consumes: `renderMessage(type, ctx)` ya existente — `ctx: { app, tenantName }`.
- Produces: tres tipos nuevos manejados por `renderMessage`:
  `'license_read_only'`, `'license_blocked'`, `'license_inactive_warning'`.

- [ ] **Step 1: Write the failing test**

```js
// añadir a api/_lib/messaging.test.js
test('license_read_only: explica que la app quedó en solo lectura, sin mencionar borrado', () => {
  const out = renderMessage('license_read_only', { app: messagingFor('stockflow'), tenantName: 'Baristop' })
  assert.match(out.subject, /solo lectura/i)
  assert.match(out.html, /Baristop/)
  assert.doesNotMatch(out.html, /borra|elimina/i)
})

test('license_blocked: explica que el acceso quedó bloqueado y cómo pedir sus datos', () => {
  const out = renderMessage('license_blocked', { app: messagingFor('stockflow'), tenantName: 'Baristop' })
  assert.match(out.subject, /bloque/i)
  assert.match(out.html, /soporte/i) // canal para pedir exportación (no hay autoservicio en estos apps)
})

test('license_inactive_warning: tono de última oportunidad antes de perder los datos', () => {
  const out = renderMessage('license_inactive_warning', { app: messagingFor('stockflow'), tenantName: 'Baristop' })
  assert.match(out.subject, /última oportunidad|antes de perder/i)
  assert.match(out.html, /Baristop/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/_lib/messaging.test.js`
Expected: FAIL — los tres tipos caen al bloque `// campaign` genérico, el
subject no matchea `/solo lectura/i` etc.

- [ ] **Step 3: Write minimal implementation**

Insertar en `api/_lib/messaging.js`, justo antes del comentario
`// campaign — operator writes subject + body` (línea ~244):

```js
  if (type === 'license_read_only') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}${app.name} está en modo solo lectura`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu licencia de <span class="hi">${esc(app.name)}</span> venció y no se ha renovado. Por ahora, <strong>agregar o editar quedó pausado</strong> — lo que ya registraste sigue visible sin cambios.</p>
<p>Confirma tu pago cuando puedas para reactivar la app por completo. Cualquier duda, escríbenos a soporte.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'license_blocked') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}acceso bloqueado en ${app.name} — falta de pago prolongada`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Por falta de pago prolongada, el acceso a <span class="hi">${esc(app.name)}</span> quedó bloqueado por completo. Tus datos <strong>no se eliminan</strong> — quedan pausados hasta reactivar tu licencia.</p>
<p>Si necesitas exportar tu información antes de reactivar, escríbenos a soporte y te la enviamos.</p>
<p>Si confirmas tu pago, tu acceso se reactiva de inmediato.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'license_inactive_warning') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}última oportunidad antes de perder tus datos en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu licencia de <span class="hi">${esc(app.name)}</span> sigue sin renovarse desde hace tiempo. Tu cuenta está a punto de pasar a inactiva — si esto continúa, tus datos serán elegibles para eliminación.</p>
<p>Confirma tu pago o escríbenos a soporte para evitarlo — todavía estás a tiempo de recuperar el acceso sin perder nada.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/_lib/messaging.test.js`
Expected: PASS (todos los casos, incluidos los preexistentes)

- [ ] **Step 5: Commit**

```bash
git add api/_lib/messaging.js api/_lib/messaging.test.js
git commit -m "messaging: correos del ciclo unificado (solo lectura, bloqueo, aviso de inactividad)"
```

---

### Task 4: `api/cron/license-lifecycle.js` — despachar también el ciclo unificado

**Files:**
- Modify: `api/cron/license-lifecycle.js`

**Interfaces:**
- Consumes: `computePortfolioLifecycleStage`, `emailKindForStage` (Task 1);
  `licenseControlFor` (Task 2, ya importado); `weekBucketKey` (ya importado
  de `licenseLifecycle.js`); `resolveRecipients`/`sendFollowup` (ya
  importados); `callBridge` (ya importado); `syncLicensesForApp` (ya
  importado).
- Produces: el cron sigue exportando el mismo `handler` — sin cambios de
  contrato HTTP. El resumen de auditoría gana un campo `enforcementGap` por
  app (contador de licencias que necesitaban un estado que el app no soporta).

- [ ] **Step 1: Write the failing test**

No existe un test a nivel handler para este cron (ni para el existente de
CateqHub — confirmado: `api/cron/*.test.js` no existe hoy, ver Task Right-
Sizing del plan hermano de CateqHub). Se prueba manualmente contra staging
tras el deploy — igual que el resto de `api/cron/*`. La lógica pura ya está
100% cubierta por `portfolioLifecycle.test.js` (Task 1).

- [ ] **Step 2: (n/a — no hay test que falle primero en este task; ver Step 1)**

- [ ] **Step 3: Write the implementation**

Reemplazar el archivo completo `api/cron/license-lifecycle.js` por:

```js
// Cron diario: ciclo de vida de licencia. Dos formas conviven:
//   - Por-etapa (hoy solo cateqhub, cfg.lifecycle.sinceFields presente):
//     lógica sin cambios, ver licenseLifecycle.js.
//   - Unificada (portafolio: flowfin/stockflow/liuma/puntos/rumbo/radar,
//     cfg.lifecycle SIN sinceFields): acumulada desde current_period_end,
//     ver portfolioLifecycle.js. Nunca borra nada — deletion_eligible solo
//     se refleja para revisión humana en Licencias (fuera de este plan).
//   Ver docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { licenseControlFor } from '../_lib/licenseControl.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { computeLifecycleTransition, reminderKindFor, weekBucketKey, shouldDowngradeToFree } from '../_lib/licenseLifecycle.js'
import { computePortfolioLifecycleStage, emailKindForStage } from '../_lib/portfolioLifecycle.js'

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

// Rama CateqHub — SIN CAMBIOS de comportamiento respecto al archivo original,
// solo extraída a su propia función para convivir con runUnifiedLifecycleForApp.
async function runStagedLifecycleForApp(app, cfg, byId, msgCfg, week, now) {
  const row = { app: app.id, transitioned: 0, downgradedToFree: 0, reminded: 0, transitionFailed: 0, emailFailed: 0 }

  const { data: lics, error: lErr } = await supabaseAdmin
    .from('licenses').select('external_id, plan, status, raw').eq('app_id', app.id)
  if (lErr) { row.error = lErr.message; return row }

  const premium = (lics ?? []).filter((l) => cfg.lifecycle.paidPlanValues.includes(l.plan))
  if (premium.length === 0) return row

  let didTransition = false
  for (const lic of premium) {
    const licState = licenseFromRaw(lic, cfg.lifecycle)
    const transition = computeLifecycleTransition(licState, cfg.lifecycle, now)

    if (transition) {
      let usageCount = null
      if (cfg.freeDowngrade && transition.toStatus === 'read_only') {
        try {
          const u = cfg.freeDowngrade.usage
          const out = await callBridge(app, 'usage.tenantCount', {
            entity: u.entity, tenantField: u.tenantField, tenantValue: lic.external_id,
            filterField: u.filterField, filterValue: u.filterValue,
          })
          const body = out?.data ?? out
          usageCount = typeof body?.count === 'number' ? body.count : null
        } catch (e) {
          console.error(`license-lifecycle: consulta de uso falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
        }
      }
      const downgradeToFree = shouldDowngradeToFree(cfg.freeDowngrade, transition, usageCount)

      const patch = downgradeToFree
        ? {
            [cfg.planField]: cfg.freeDowngrade.freePlanValue,
            [cfg.statusField]: cfg.statuses.active,
            [cfg.lifecycle.sinceFields.read_only]: null,
            [cfg.lifecycle.sinceFields.access_denied]: null,
            [cfg.lifecycle.sinceFields.deletion_eligible]: null,
          }
        : { [cfg.statusField]: transition.toStatus, [transition.sinceField]: now.toISOString() }
      const mirror = cfg.mirror
        ? [{
            entity: cfg.mirror.entity,
            matchField: cfg.mirror.matchField,
            fields: Object.fromEntries(
              Object.entries(cfg.mirror.fields)
                .filter(([sourceField]) => sourceField in patch)
                .map(([sourceField, mirrorField]) => [mirrorField, patch[sourceField]]),
            ),
          }]
        : undefined
      try {
        await callBridge(app, 'license.set', { entity: cfg.entity, id: lic.external_id, patch, mirror })
        didTransition = true
        if (downgradeToFree) {
          row.downgradedToFree++
          licState.plan = cfg.freeDowngrade.freePlanValue
          licState.status = cfg.statuses.active
          const recipient = byId[lic.external_id]
          if (msgCfg && recipient?.email) {
            const r = await sendFollowup(app, msgCfg, 'trial_ended_downgraded_free', recipient, {})
            if (!r.sent) row.emailFailed++
          }
        } else {
          row.transitioned++
          licState.status = transition.toStatus
        }
      } catch (e) {
        row.transitionFailed++
        console.error(`license-lifecycle: transición falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
        continue
      }
    }

    const kind = reminderKindFor(licState.status)
    if (!kind || licState[cfg.lifecycle.exportConfirmedField]) continue
    const recipient = byId[lic.external_id]
    if (!recipient?.email) continue

    const { error: claimErr } = await supabaseAdmin.from('license_lifecycle_reminders')
      .insert({ app_id: app.id, external_id: lic.external_id, period: week, kind, recipient: recipient.email })
    if (claimErr) continue

    const r = await sendFollowup(app, msgCfg, kind, recipient, {})
    if (r.sent) row.reminded++
    else row.emailFailed++
  }

  if (didTransition) { try { await syncLicensesForApp(app) } catch { /* best-effort */ } }
  return row
}

// Rama unificada (portafolio) — flowfin/stockflow/liuma/puntos/rumbo/radar.
// Acumulado desde current_period_end (ya sincronizado, sin leer `raw`).
async function runUnifiedLifecycleForApp(app, cfg, byId, msgCfg, week, now) {
  const row = { app: app.id, transitioned: 0, reminded: 0, transitionFailed: 0, emailFailed: 0, enforcementGap: 0 }

  const { data: lics, error: lErr } = await supabaseAdmin
    .from('licenses').select('external_id, plan, status, current_period_end').eq('app_id', app.id)
  if (lErr) { row.error = lErr.message; return row }

  let didTransition = false
  for (const lic of (lics ?? [])) {
    const result = computePortfolioLifecycleStage(lic, cfg.lifecycle, now)
    if (!result) continue
    const { stage, targetStatus } = result

    if (targetStatus === null && (stage === 'read_only' || stage === 'blocked')) {
      // El app no tiene este estado en su schema (rumbo/radar hoy) — se
      // sigue mandando el correo abajo, pero no hay escritura que aplicar.
      row.enforcementGap++
    } else if (targetStatus && lic.status !== targetStatus) {
      try {
        await callBridge(app, 'license.set', { entity: cfg.entity, id: lic.external_id, patch: { [cfg.statusField]: targetStatus } })
        didTransition = true
        row.transitioned++
        lic.status = targetStatus // para que el correo de abajo, en la misma corrida, use el estado ya actualizado
      } catch (e) {
        row.transitionFailed++
        console.error(`license-lifecycle: transición unificada falló app=${app.id} tenant=${lic.external_id}: ${e.message}`)
        continue
      }
    }

    const kind = emailKindForStage(stage)
    if (!kind) continue // deletion_eligible: sin correo al tenant, ver spec
    const recipient = byId[lic.external_id]
    if (!recipient?.email) continue

    const { error: claimErr } = await supabaseAdmin.from('license_lifecycle_reminders')
      .insert({ app_id: app.id, external_id: lic.external_id, period: week, kind, recipient: recipient.email })
    if (claimErr) continue // ya se mandó esta semana

    const r = await sendFollowup(app, msgCfg, kind, recipient, {})
    if (r.sent) row.reminded++
    else row.emailFailed++
  }

  if (didTransition) { try { await syncLicensesForApp(app) } catch { /* best-effort */ } }
  return row
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

    let byId = {}
    const msgCfg = messagingFor(app.id)
    if (msgCfg) {
      try {
        const recipients = await resolveRecipients(app, msgCfg)
        byId = Object.fromEntries(recipients.map((r) => [r.id, r]))
      } catch (e) { summary.push({ app: app.id, contactsError: e.message }); continue }
    }

    const row = cfg.lifecycle.sinceFields
      ? await runStagedLifecycleForApp(app, cfg, byId, msgCfg, week, now)
      : await runUnifiedLifecycleForApp(app, cfg, byId, msgCfg, week, now)
    summary.push(row)
  }

  return { week, apps: summary }
}

export default async function handler(req, res) {
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

- [ ] **Step 4: Verify nothing broke**

Run: `node --test && npm run build && npm run lint`
Expected: 150+ tests PASS (ningún test de CateqHub cambia de comportamiento —
`runStagedLifecycleForApp` es una extracción literal, sin lógica nueva),
build y lint limpios.

- [ ] **Step 5: Commit**

```bash
git add api/cron/license-lifecycle.js
git commit -m "cron license-lifecycle: despachar también el ciclo unificado (portafolio)"
```

---

### Task 5: `supabase/migrations/0030_payment_reports.sql`

**Files:**
- Create: `supabase/migrations/0030_payment_reports.sql`

**Interfaces:**
- Produces: tabla `public.payment_reports` que Task 6 usa.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Reporte de pago pendiente de confirmación del owner (ver spec
-- docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md,
-- decisión #4). Un admin registra que un tenant avisó que pagó (por WhatsApp/
-- correo/ticket — los tenants no tienen acceso a Mission Control); solo
-- owner puede confirmarlo, lo cual dispara confirm_payment de verdad
-- (api/_lib/control/payment-confirm.js). Sin reporte previo, confirm_payment
-- sigue disponible directo para admin — este reporte es trazabilidad
-- adicional, no un gate nuevo sobre la acción que ya existe.
-- ============================================================================
create table public.payment_reports (
  id            uuid primary key default gen_random_uuid(),
  app_id        text not null references public.apps(id) on delete cascade,
  external_id   text not null,
  amount        numeric,
  reference     text,
  note          text,
  reported_by   text not null,
  reported_at   timestamptz not null default now(),
  confirmed_by  text,
  confirmed_at  timestamptz
);

create index payment_reports_pending
  on public.payment_reports (app_id, external_id)
  where confirmed_at is null;

alter table public.payment_reports enable row level security;

-- Mismo patrón que usage_reminders (0027)/renewal_reminders (0017): viewer+
-- lee, solo el service_role (los endpoints de control, con su propio gate de
-- rol vía requireMember) escribe.
create policy payment_reports_read on public.payment_reports
  for select using (public.is_member_at_least('viewer'));
```

- [ ] **Step 2: Apply and verify**

Run (vía Supabase MCP, `apply_migration` con `project_id` de
`acacia-mission-control` y este SQL como `query`, `name: '0030_payment_reports'`),
luego `get_advisors(type: 'security')` — esperar sin alertas nuevas.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0030_payment_reports.sql
git commit -m "Migración: tabla payment_reports (reporte de pago pendiente de confirmación)"
```

---

### Task 6: Endpoints de control — reportar y confirmar pago

**Files:**
- Create: `api/_lib/control/payment-report.js`
- Create: `api/_lib/control/payment-report.test.js`
- Create: `api/_lib/control/payment-confirm.js`
- Create: `api/_lib/control/payment-confirm.test.js`
- Modify: `api/control/[action].js` (registrar las dos rutas nuevas)

**Interfaces:**
- Consumes: `requireMember` (ya existe), `supabaseAdmin`/`audit` (ya existen),
  `licenseControlFor`/`buildLicenseChange`/`deriveMirror`/`OP_LABEL` (ya
  existen, Task 2), `callBridge`/`bridgeConfigured` (ya existen),
  `syncLicensesForApp` (ya existe).
- Produces: `POST /api/control/payment-report` (rol `admin`+, crea un
  `payment_reports` pendiente) y `POST /api/control/payment-confirm` (rol
  `owner`, confirma un reporte y dispara `confirm_payment` vía el mismo
  camino que `license-action.js` ya usa). Exporta también dos funciones puras
  testeables: `assertReportPayload(body)` y `assertConfirmable(report)`.

- [ ] **Step 1: Write the failing tests**

```js
// api/_lib/control/payment-report.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertReportPayload } from './payment-report.js'

test('assertReportPayload: exige appId, licenseExternalId y amount positivo', () => {
  assert.equal(assertReportPayload({}).ok, false)
  assert.equal(assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x' }).ok, false) // sin amount
  assert.equal(assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x', amount: 0 }).ok, false) // amount debe ser > 0
  assert.equal(assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x', amount: -5 }).ok, false)
})

test('assertReportPayload: acepta con amount positivo, reference/note opcionales', () => {
  const r = assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x', amount: 590 })
  assert.equal(r.ok, true)
})
```

```js
// api/_lib/control/payment-confirm.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertConfirmable } from './payment-confirm.js'

test('assertConfirmable: rechaza un reporte ya confirmado', () => {
  const r = assertConfirmable({ confirmed_at: '2026-08-01T00:00:00Z' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'already_confirmed')
})

test('assertConfirmable: rechaza null (reporte no encontrado)', () => {
  assert.equal(assertConfirmable(null).ok, false)
  assert.equal(assertConfirmable(null).error, 'not_found')
})

test('assertConfirmable: acepta un reporte pendiente', () => {
  assert.equal(assertConfirmable({ confirmed_at: null }).ok, true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test api/_lib/control/payment-report.test.js api/_lib/control/payment-confirm.test.js`
Expected: FAIL — módulos no existen todavía.

- [ ] **Step 3: Write the implementation**

```js
// api/_lib/control/payment-report.js
// Control action (WRITE): registra que un tenant avisó que pagó — trazabilidad
// previa a la confirmación real (ver payment-confirm.js). No toca la licencia
// del app todavía. Gate: admin+ (cualquier operador puede registrar el aviso;
// solo owner confirma, ver payment-confirm.js).
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { requireMember } from '../requireMember.js'
import { licenseControlFor } from '../licenseControl.js'

export function assertReportPayload(body) {
  if (!body?.appId || !body?.licenseExternalId) return { ok: false, error: 'falta appId/licenseExternalId' }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'amount debe ser un número mayor a 0' }
  return { ok: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const check = assertReportPayload(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  const { appId, licenseExternalId, amount, reference, note } = req.body
  if (!licenseControlFor(appId)) return res.status(400).json({ error: `app ${appId} no soporta control de licencia` })

  const { data, error } = await supabaseAdmin.from('payment_reports')
    .insert({ app_id: appId, external_id: licenseExternalId, amount: Number(amount), reference: reference || null, note: note || null, reported_by: member.email })
    .select('id').single()
  if (error) return res.status(500).json({ error: error.message })

  await audit('control:payment-report', { actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId, payload: { amount, reference: reference || null } })
  return res.status(200).json({ ok: true, id: data.id })
}
```

```js
// api/_lib/control/payment-confirm.js
// Control action (WRITE): confirma un payment_reports pendiente — solo rol
// owner. Al confirmar, dispara el mismo camino que license-action.js usa
// para 'confirm_payment' (buildLicenseChange + license.set + resync +
// correo de agradecimiento), y estampa confirmed_by/confirmed_at en el reporte.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { licenseControlFor, buildLicenseChange, deriveMirror } from '../licenseControl.js'
import { syncLicensesForApp } from '../sync/syncLicenses.js'
import { messagingFor } from '../messaging.js'
import { resolveRecipients, sendFollowup } from '../emailFollowup.js'

export function assertConfirmable(report) {
  if (!report) return { ok: false, error: 'not_found' }
  if (report.confirmed_at) return { ok: false, error: 'already_confirmed' }
  return { ok: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'owner')
  if (!member) return

  const { reportId, periodMonths } = req.body ?? {}
  if (!reportId) return res.status(400).json({ error: 'falta reportId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { data: report, error: rErr } = await supabaseAdmin.from('payment_reports').select('*').eq('id', reportId).maybeSingle()
  if (rErr) return res.status(500).json({ error: rErr.message })
  const check = assertConfirmable(report)
  if (!check.ok) return res.status(check.error === 'not_found' ? 404 : 409).json({ error: check.error })

  const cfg = licenseControlFor(report.app_id)
  if (!cfg) return res.status(400).json({ error: `app ${report.app_id} no soporta control de licencia` })

  const { data: lic } = await supabaseAdmin
    .from('licenses').select('current_period_end')
    .eq('app_id', report.app_id).eq('external_id', report.external_id).maybeSingle()

  const change = buildLicenseChange(report.app_id, 'confirm_payment', {
    actorEmail: member.email, currentExpiry: lic?.current_period_end ?? null,
    periodMonths: periodMonths || 1, paymentReference: report.reference,
  })
  if (change.error) return res.status(400).json({ error: change.error })

  const { data: app, error: aErr } = await supabaseAdmin.from('apps').select('*').eq('id', report.app_id).maybeSingle()
  if (aErr) return res.status(500).json({ error: aErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  try {
    await callBridge(app, 'license.set', {
      entity: cfg.entity, id: report.external_id, patch: change.patch,
      mirror: deriveMirror(cfg, change.patch),
    })
    let resync = null
    try { resync = await syncLicensesForApp(app) } catch (e) { resync = { error: e.message } }

    let emailed = null
    try {
      const msgCfg = messagingFor(report.app_id)
      if (msgCfg) {
        const recipients = await resolveRecipients(app, msgCfg)
        const recipient = recipients.find((r) => r.id === report.external_id)
        if (recipient) {
          const r = await sendFollowup(app, msgCfg, 'payment_confirmed', recipient, {
            date: change.newExpiry, periodMonths: periodMonths || 1, reference: report.reference,
          })
          emailed = !!r.sent
        }
      }
    } catch (e) { console.warn('[payment-confirm] correo de confirmación falló:', e.message) }

    await supabaseAdmin.from('payment_reports')
      .update({ confirmed_by: member.email, confirmed_at: new Date().toISOString() })
      .eq('id', reportId)

    await audit('control:payment-confirm', {
      actor: member.user_id, actor_email: member.email, target_app: report.app_id, target_id: report.external_id,
      payload: { reportId, amount: report.amount, newExpiry: change.newExpiry ?? null, emailed },
    })
    return res.status(200).json({ ok: true, newExpiry: change.newExpiry ?? null, emailed, resync })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
```

Editar `api/control/[action].js` — agregar las dos rutas:

```js
import paymentReport from '../_lib/control/payment-report.js'
import paymentConfirm from '../_lib/control/payment-confirm.js'
```

y en `ROUTES`:

```js
  'payment-report': paymentReport,
  'payment-confirm': paymentConfirm,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test api/_lib/control/payment-report.test.js api/_lib/control/payment-confirm.test.js`
Expected: PASS (6 tests)

Run: `node --test && npm run build && npm run lint`
Expected: todo en verde, ningún test existente roto.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/control/payment-report.js api/_lib/control/payment-report.test.js \
        api/_lib/control/payment-confirm.js api/_lib/control/payment-confirm.test.js \
        api/control/[action].js
git commit -m "Endpoints: reportar y confirmar pago (payment_reports, gate owner en confirmación)"
```

---

## Fuera de alcance de este plan (ver spec §Fuera de alcance)

- UI en `src/pages/Licenses.jsx` para ver/crear/confirmar reportes de pago —
  los endpoints del Task 6 son funcionales y auditables vía API/`payment_reports`
  desde ahora; la vista queda como fast-follow inmediato, no bloquea este plan.
- Retirar `checkAccountLifecycle`/`processMonthlyRenewal` de StockFlow (u
  automatizaciones equivalentes en los otros 5 apps, sin auditar todavía) —
  bloqueado por el Base44 MCP. **Mientras no se resuelva, StockFlow seguirá
  bloqueando tenants con su propio timeline (0 días de gracia) en paralelo a
  lo que este plan construye** — comunicado explícitamente en la spec.
- Agregar `view_only` al schema de Rumbo/Radar — bloqueado por el Base44 MCP.
- Borrado real de tenants en `deletion_eligible` (día 45) — sin acción de
  borrado segura definida todavía para estos 6 apps.
- Monto prorrateado del cobro — sin tabla de precios por plan.
