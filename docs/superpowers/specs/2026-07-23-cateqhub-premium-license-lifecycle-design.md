# Diseño — Ciclo de vida de licencia Premium con exportación y borrado (CateqHub)

> **⚠️ Actualización 2026-08-03:** los umbrales de días (15/15/30) y el modelo
> por-etapa con since-fields independientes descritos en este documento fueron
> **retirados** — el owner de la plataforma pidió explícitamente "no
> exceptions" en `docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md`.
> CateqHub ahora usa el mismo ciclo acumulado 8/15/30/45 que el resto del
> portafolio (`api/_lib/licenseControl.js#cateqhub` en `acacia-mission-control`).
> Lo que SÍ sigue vigente de este documento: el modelo de negocio (freemium +
> Tutores como add-on Premium), el freno de exportación antes del borrado, el
> mirror hacia `User`, y el flujo de borrado manual — solo cambió CUÁNDO se
> dispara cada etapa, no QUÉ hace cada una. Ver el nuevo doc para el detalle.

**Fecha:** 2026-07-23
**Rama:** `claude/asistencia-licencias-datos-sensibles-52jhi2`
**Pillar afectado:** Licencias / Cumplimiento de datos sensibles
**Repo hermano:** `jospabloh/asistencia-catecismo` (ver
`docs/superpowers/specs/2026-07-23-premium-license-lifecycle-design.md` en ese
repo para el lado de la app)

## Problema

CateqHub (app `cateqhub`, entidad de licencia `Parish`) no tiene ningún manejo
de impago. Hoy, si una parroquia con plan Premium deja de pagar, no pasa nada:
sigue con acceso completo indefinidamente. No existe:

- Un campo de estado de licencia en `Parish` (solo `plan: free|premium`, sin
  vencimiento ni estado de mora).
- Enforcement real de la restricción Premium — hoy es **solo de UI** (un botón
  deshabilitado en `ChildDetail.jsx`); la RLS de `Guardian`/`ChildGuardian` no
  valida el plan en absoluto, así que una llamada directa a la API puede crear
  o editar Tutores en una parroquia gratuita.
- Un mecanismo de solo-lectura → acceso denegado → exportación → borrado para
  cuando el impago persiste. `Guardian`/`ChildGuardian` contienen CURPs de
  menores — datos sensibles bajo la LFPDPPP mexicana — por lo que el borrado
  final debe estar condicionado a que la parroquia haya podido exportar sus
  datos, nunca ser un timer ciego.

`cateqhub` ya está registrado como app (migraciones 0022–0025) y el puente
`acaciaControl` ya está desplegado (0024), pero **no tiene entrada en
`api/_lib/licenseControl.js`** — hoy no hay ningún botón de control de licencia
para CateqHub en `Licenses.jsx`.

## Contexto: qué ya existe

- **`api/_lib/licenseControl.js`**: registro `APPS` por app, con comentario de
  diseño explícito: *"Operations are intentionally minimal and additive
  (status / plan), never destructive (no delete/archive here)"*. Los estados
  genéricos son `active | suspended | view_only` (3 llaves fijas en
  `statuses`), operados manualmente desde `Licenses.jsx` (Reactivar / Pausar /
  Solo lectura) o vía `confirm_payment`.
- **`api/_lib/control/license-action.js`**: único endpoint de escritura de
  licencia, gate `requireMember(req, res, 'admin')`, llama
  `callBridge(app, 'license.set', {...})`, resincroniza la bodega, audita.
- **Puente `acaciaControl`** (`base44/functions/acaciaControl/entry.ts`, ya
  desplegado en asistencia-catecismo): acción `license.set` hace
  `sr.entities[entity].update(id, patch)` + log opcional. Genérico, sin lógica
  específica de ninguna app.
- **Ningún cron transiciona estados hoy.** El único cron existente
  (`api/cron/sync`, diario) solo sincroniza la bodega desde cada app; el cron
  mensual `renewal-reminders` solo manda correos, nunca cambia `billing_status`.
  Todas las transiciones de estado en el portafolio hoy son **manuales**
  (botón de operador) o **internas a cada app** (p. ej. StockFlow tiene su
  propio cron `checkAccountLifecycle` que decide solo-lectura/archivado sin
  que Mission Control participe — antipatrón que este diseño evita
  deliberadamente).
- **Base44 RLS no soporta lookups entre entidades** (confirmado: ver
  `rls-examples.md` del skill `base44-cli`, tabla "Limitations Summary" →
  "Cross-entity relationships" → alternativa "Backend functions"). El propio
  repo de asistencia-catecismo ya usa el workaround estándar: `parish_id`
  denormalizado en `SupportTicketMessage` "para RLS". Este diseño reutiliza el
  mismo patrón (ver doc hermano, sección de espejo en `User`).

## Decisiones tomadas

1. **Alcance: solo el plan Premium.** El núcleo gratis de CateqHub (asistencia
   QR, niños, grupos, reportes) nunca entra a este ciclo — sigue "gratis para
   siempre" sin importar el estado de pago. El ciclo de vida solo aplica a
   parroquias con `plan === "premium"`.
2. **Plazos** (parroquia Premium sin pago confirmado):
   `active` →(15 días)→ `read_only` →(15 días)→ `access_denied` →(30 días con
   recordatorios + evidencia de auditoría)→ `deletion_eligible`.
3. **El borrado NUNCA es automático.** Llegar a `deletion_eligible` solo marca
   el tenant como candidato en `Licenses.jsx`; un operador humano debe
   confirmar el borrado, y solo puede hacerlo si la parroquia ya confirmó su
   exportación (`export_confirmed_at` no nulo) — gate duro en el backend, no
   solo una advertencia de UI.
4. **Exportación: autoservicio dentro de CateqHub.** El admin de parroquia
   descarga sus propios datos (Tutores + relaciones) y confirma con un
   checkbox explícito; ese evento escribe `export_confirmed_at`. Mission
   Control nunca extrae ni envía datos manualmente.
5. **La lógica de temporización vive centralizada en Mission Control** (cron
   nuevo), no duplicada dentro de cada app Base44 — a diferencia del patrón
   actual de StockFlow. Esto es lo que hace la arquitectura replicable: para
   sumar otra app al ciclo de vida basta con (a) los 4 campos de estado en su
   entidad de licencia, (b) una entrada de config aquí, (c) las 2-3 reglas RLS
   del lado de la app. Sin crons nuevos por app.
6. **Reutilizar `licenseControl.js` para overrides manuales.** `read_only` y
   `access_denied` se mapean a las llaves genéricas existentes `view_only` y
   `suspended` — un operador puede forzar cualquiera de los dos estados a mano
   desde los botones que ya existen en `Licenses.jsx`, sin UI nueva para eso.
7. **Borrado como acción separada y explícita**, no una llave más de
   `buildLicenseChange` — preserva el principio "nunca destructivo" ya
   documentado en ese archivo.

## Arquitectura

### 1. `api/_lib/licenseControl.js` — nueva entrada `cateqhub`

```js
cateqhub: {
  entity: 'Parish', statusField: 'license_status', planField: 'plan',
  statuses: { active: 'active', suspended: 'access_denied', view_only: 'read_only' },
  plans: ['free', 'premium'],
  billing: null, // sin confirm_payment automático (Premium se activa a mano, ver Premium.jsx)
  // Mapeo de espejo: cuando se escribe Parish.{statusField|planField}, el puente
  // también actualiza estos campos en cada User de esa parroquia (RLS de
  // Guardian/ChildGuardian los necesita — no hay lookup entre entidades en Base44).
  mirror: {
    entity: 'User', matchField: 'parish_id',
    fields: { [planField]: 'parish_plan', [statusField]: 'parish_license_status' },
  },
  lifecycle: {
    graceDaysToReadOnly: 15, graceDaysToAccessDenied: 15, graceDaysToDeletionEligible: 30,
    sinceFields: { read_only: 'read_only_since', access_denied: 'access_denied_since', deletion_eligible: 'deletion_eligible_since' },
    exportConfirmedField: 'export_confirmed_at',
    periodEndField: 'premium_period_end_at', // fecha del último pago Premium confirmado
  },
}
```

`billing: null` porque CateqHub Premium no tiene `confirm_payment`
automatizado hoy — se activa manualmente (ver `Premium.jsx`: "activa el plan
Premium desde el panel de administración de Base44"). Cuando exista cobro real
vía Mercado Pago, se agrega `billing` igual que los demás apps y
`premium_period_end_at` empieza a alimentarse desde ahí; hasta entonces, un
operador escribe `premium_period_end_at` a mano al activar Premium (ver
`set_plan` extendido abajo).

`set_plan` a `premium` ahora también debe estampar `premium_period_end_at` (30
días desde hoy, o el valor que el operador indique) — pequeño cambio en
`buildLicenseChange` para este app: si `op === 'set_plan' && plan === 'premium'`
y `cfg.lifecycle` existe, agregar `patch[cfg.lifecycle.periodEndField]` cuando
no venga ya seteado.

### 2. Puente `acaciaControl` — capacidad genérica `mirror` en `license.set`

Extensión pequeña y genérica de la acción existente (no específica de
CateqHub — cualquier app puede usarla si su RLS lo necesita):

```ts
case 'license.set': {
  const { entity, id, patch, log, mirror } = params;
  const updated = await sr.entities[entity].update(id, patch);
  if (Array.isArray(mirror)) {
    for (const m of mirror) {
      const rows = await sr.entities[m.entity].filter({ [m.matchField]: id });
      for (const row of rows) {
        try { await sr.entities[m.entity].update(row.id, m.fields); } catch { /* best-effort */ }
      }
    }
  }
  if (log?.entity && log?.row) { try { await sr.entities[log.entity].create(log.row); } catch {} }
  return Response.json({ ok: true, updated, mirrored: Array.isArray(mirror) ? mirror.length : 0 });
}
```

`license-action.js` y el cron nuevo (§3) arman `params.mirror` a partir de
`cfg.mirror` cuando existe, sustituyendo el `id` de la parroquia como
`matchValue` y los valores ya calculados del `patch` como `fields`.

### 3. Cron nuevo — `api/cron/license-lifecycle.js` (diario)

Mismo gate que `sync` (`CRON_SECRET` Bearer o header `x-vercel-cron`). Por
cada app con `cfg.lifecycle` definido (hoy solo `cateqhub`):

1. Leer de la bodega (`public.licenses`, columna `raw`) las licencias con
   `plan === planField-premium-value`.
2. Para cada una, función pura `computeLifecycleTransition(license, cfg.lifecycle, now)`:
   - `active` y `now - premium_period_end_at > graceDaysToReadOnly` días →
     `{ to: 'read_only', stampField: sinceFields.read_only }`.
   - `read_only` y `now - read_only_since > graceDaysToAccessDenied` días →
     `{ to: 'access_denied', stampField: sinceFields.access_denied }`.
   - `access_denied`, sin `export_confirmed_at`, y
     `now - access_denied_since > graceDaysToDeletionEligible` días, y
     `deletion_eligible_since` aún no seteado → `{ to: 'deletion_eligible', stampField: sinceFields.deletion_eligible }`
     (una sola vez; no reintenta cada día).
   - Cualquier otro caso → `null` (nada que hacer).
3. Si hay transición: `buildLicenseChange`-style patch mínimo
   (`{ [statusField]: to, [stampField]: now }`) + `mirror` desde `cfg.mirror` +
   `callBridge(app, 'license.set', {...})` + resync + `audit('cron:license-lifecycle', {...})`.
4. **Recordatorios** (independiente de las transiciones, mientras
   `status === 'read_only' || 'access_denied'` y sin `export_confirmed_at`):
   cada 7 días manda `premium_read_only_reminder` o
   `premium_access_denied_reminder` vía `resolveRecipients` +
   `sendFollowup` — reutiliza el mismo patrón/plantillas de
   `emailFollowup.js` que `renewal-reminders`. Idempotencia: tabla nueva
   `license_lifecycle_reminders (app_id, external_id, period, kind, unique(app_id, external_id, period))`
   donde `period` es `YYYY-MM-DD` del bucket semanal (no mensual, a diferencia
   de `renewal_reminders`).
5. Nunca borra nada. `deletion_eligible` solo se refleja como badge en
   `Licenses.jsx` para revisión humana.

Funciones puras extraíbles y testeables:
`computeLifecycleTransition(license, lifecycleCfg, now)`,
`reminderKindFor(status)`, `weekBucketKey(now)`.

### 4. Borrado manual — nuevo endpoint `api/control/license-delete-premium-data`

Separado de `license-action.js` a propósito (acción destructiva, gate propio):

- `requireMember(req, res, 'owner')` — **rol `owner`, no `admin`**: el borrado
  de datos de menores es la única acción de este archivo que sube el piso de
  autorización.
- Body: `{ appId, licenseExternalId, confirmParishName }`.
- Lee la licencia fresca de la bodega; si `export_confirmed_at` es nulo →
  `409 { error: 'export_not_confirmed' }`. Gate duro, no solo de UI.
- Si `confirmParishName` no coincide exactamente con el nombre del tenant en
  la bodega → `400` (patrón de confirmación por nombre, típico de acciones
  irreversibles).
- Paso 1 — borrado: `callBridge(app, 'license.deletePremiumData', { deleteEntities: [
  { entity: 'ChildGuardian', field: 'parish_id', value: licenseExternalId },
  { entity: 'Guardian', field: 'parish_id', value: licenseExternalId },
] })` → nueva acción del puente (§5), orden hijo→padre para no dejar
  referencias huérfanas. Devuelve `{ ok: true, deletedCounts }`.
- Paso 2 — reset: `callBridge(app, 'license.set', { entity: cfg.entity, id: licenseExternalId, patch: { [cfg.planField]: 'free', [cfg.statusField]: 'active', [lifecycle.sinceFields.read_only]: null, [lifecycle.sinceFields.access_denied]: null, [lifecycle.sinceFields.deletion_eligible]: null, [lifecycle.exportConfirmedField]: null }, mirror: [...] })`
  — reutiliza la acción genérica existente para que el reset también
  propague el espejo a `User` (§2), en vez de duplicar esa lógica en el paso
  destructivo.
- Resync de la bodega tras ambos pasos.
- `audit('control:license-delete-premium-data', { actor, target_app, target_id, payload: { deletedCounts } })`
  con el conteo de filas borradas devuelto por el puente — es la evidencia de
  auditoría LFPDPPP de que el borrado ocurrió, cuándo, quién lo autorizó y bajo
  qué condiciones (export ya confirmado).
- Best-effort: correo `premium_data_deleted_confirmation` al admin de la
  parroquia tras el borrado.
- Reintentos seguros: si el paso 1 tiene éxito pero el paso 2 falla (o
  viceversa), reejecutar el endpoint completo es seguro — el paso 1 es
  idempotente (borrar filas ya borradas no falla, ver spec hermano) y el
  paso 2 es una escritura de estado normal, no destructiva.

### 5. Puente `acaciaControl` — nueva acción `license.deletePremiumData`

Ver spec del repo asistencia-catecismo (§ "Puente acaciaControl — nueva
acción license.deletePremiumData") para el detalle exacto: acción genérica,
recibe `deleteEntities: [{entity, field, value}]`, borra por `filter` +
`delete` (sin tocar `Parish`), devuelve `{ ok: true, deletedCounts }`. El
reset de `Parish` va aparte, por el paso 2 arriba.

### 6. Base de datos — `supabase/migrations/0026_cateqhub_license_lifecycle.sql`

```sql
create table public.license_lifecycle_reminders (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.apps(id) on delete cascade,
  external_id text not null,
  period text not null,      -- 'YYYY-MM-DD', inicio del bucket semanal
  kind text not null,        -- 'premium_read_only_reminder' | 'premium_access_denied_reminder'
  recipient text,
  sent_at timestamptz not null default now(),
  unique (app_id, external_id, period, kind)
);
-- RLS: SELECT para miembros (viewer+); INSERT/UPDATE/DELETE solo service_role.
-- Mismo patrón que renewal_reminders (0017).

update public.apps
  set config = config || '{
    "license_entity": "Parish",
    "field_map": {
      "tenant_external_id": "id", "name": "name", "plan": "plan",
      "status": "license_status", "current_period_end": "premium_period_end_at"
    }
  }'::jsonb
  where id = 'cateqhub';
```

No se agregan columnas nuevas a `licenses`/`tenants` para
`read_only_since`/`access_denied_since`/`export_confirmed_at`/
`deletion_eligible_since` — el cron y `Licenses.jsx` los leen de la columna
`raw` (jsonb) que el sync ya trae completa. Evita tocar el sync genérico
compartido por todas las apps.

### 7. Correos nuevos (`api/_lib/messaging.js`)

`premium_read_only` (transición), `premium_access_denied` (transición, incluye
instrucciones de exportar dentro de CateqHub), `premium_read_only_reminder`,
`premium_access_denied_reminder` (semanales), `premium_data_deleted_confirmation`
(tras el borrado). Mismo `wrap()` de marca, mismo patrón que las plantillas
`renewal*`/`trial_*` existentes.

### 8. UI — `src/pages/Licenses.jsx`

- `STATUS_STYLE`: agregar `read_only` (ámbar, ya existe como `view_only` en
  otros apps — reusar color), `access_denied` (rojo), `deletion_eligible`
  (rojo oscuro / destacado).
- Badge adicional "Exportación confirmada ✓ {fecha}" cuando
  `export_confirmed_at` está presente en `raw`.
- Nuevo botón **"Borrar datos Premium"**, visible solo si
  `status === 'deletion_eligible'`, deshabilitado con tooltip si
  `!export_confirmed_at`. Modal de confirmación: explica qué se borra
  (Tutores y relaciones — nunca niños/asistencia), pide escribir el nombre de
  la parroquia, requiere rol `owner`.

## Flujo de datos

```
Diario, cron license-lifecycle
  → por app con lifecycle: licencias premium en la bodega
    → computeLifecycleTransition por tenant
      → si hay transición: license.set (patch + mirror) → resync → audit
    → si sigue en read_only/access_denied sin export: recordatorio semanal
      (dedupe por license_lifecycle_reminders) → sendFollowup

Parroquia exporta sus datos (dentro de CateqHub, ver spec hermano)
  → Parish.export_confirmed_at se escribe vía función de servicio de la app
  → siguiente sync diario lo refleja en la bodega (raw)
  → deja de mandarse el recordatorio; Licenses.jsx muestra "Exportación confirmada"

Operador confirma borrado (Licenses.jsx, rol owner)
  → POST /api/control/license-delete-premium-data {appId, licenseExternalId, confirmParishName}
    → 409 si no hay export_confirmed_at
    → license.deletePremiumData (puente) → borra ChildGuardian+Guardian
    → license.set (puente) → resetea Parish a free + mirror a User
    → audit con deletedCounts
    → [best-effort] correo de confirmación de borrado
```

## Manejo de errores

- **Cron**: por-app y por-tenant en try/catch; un fallo de un tenant no
  detiene al resto. Resumen en `audit`. Reejecución segura — las transiciones
  solo se disparan desde el estado `from` esperado (idempotentes por
  construcción), y los recordatorios están deduplicados por
  `license_lifecycle_reminders`.
- **Borrado**: si `callBridge` falla a mitad de camino (borró `ChildGuardian`
  pero no `Guardian`, o viceversa), el puente debe ser tolerante a
  reintentos — ver spec hermano (`deleteMany` por filtro, no por lista fija de
  ids, así una segunda llamada simplemente no encuentra nada que borrar).
  `license-delete-premium-data` es seguro de reintentar.
- **Puente no configurado**: igual que `sync`/`renewal-reminders`, el cron
  sale con `skipped: 'bridge not configured'`.

## Pruebas (`node --test`)

- `licenseControl.test.js`: extender con casos de `cateqhub` (mirror, plan
  premium con `premium_period_end_at`).
- `licenseLifecycle.test.js` (nuevo): `computeLifecycleTransition` — los 4
  saltos de estado, los "no-op" (plan free, ya en el estado destino, dentro
  del plazo de gracia), y que `deletion_eligible` no se re-dispara.
- `licenseDeletePremiumData.test.js` (nuevo, a nivel handler con bridge
  mockeado): rechaza sin `export_confirmed_at` (409), rechaza nombre de
  parroquia incorrecto (400), rol `admin` (no `owner`) rechazado (403).
- `npm run build` / `npm run lint` en verde.

## Fuera de alcance (YAGNI)

- Borrado automático sin confirmación humana — decisión explícita del
  usuario, no se reconsidera en este alcance.
- Cobro automático (Mercado Pago) para Premium de CateqHub — Premium se activa
  y factura manualmente hoy; cuando exista cobro real, se agrega `billing` a
  la config de `licenseControl.js` sin tocar el resto del diseño.
- Activar `lifecycle` para otras apps del portafolio en esta tarea — la
  arquitectura queda lista y genérica (`cfg.lifecycle`, capacidad `mirror` del
  puente), pero solo se enciende para `cateqhub`.
- Tabla de auditoría dedicada para la exportación — el propio
  `export_confirmed_at` + `export_confirmed_by` en `Parish` (spec hermano) más
  `audit_actions` del lado de borrado son evidencia suficiente para este
  alcance.
