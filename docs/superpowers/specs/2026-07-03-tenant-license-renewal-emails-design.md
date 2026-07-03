# Diseño — Correos de renovación de licencia por tenant

**Fecha:** 2026-07-03
**Rama:** `claude/tenant-license-renewal-emails-d86wy3`
**Pillar afectado:** Licencias / Comunicados

## Problema

Al renovar la licencia de un tenant (operación **Confirmar pago** en la página de
Licencias) no se envía ningún correo al admin de la tienda. Se necesitan dos
disparadores de correo que hoy no existen:

1. **Al confirmar el pago** → enviar al admin un correo de **agradecimiento** que
   confirme la vigencia por el período pagado.
2. **El día 1 de cada mes** → enviar un **recordatorio amable de pago** a los
   tenants cuya licencia está vencida o vence dentro del mes en curso. Para los
   tenants con **cobro automático** en Mercado Pago, el correo del día 1 es un
   **aviso** de que se hará el cargo a su método de pago registrado (no un
   recordatorio de "págame").

## Contexto: qué ya existe

- **Envío de correos**: funciona vía el puente `acaciaControl` →
  `emails.sendFollowup` (`api/_lib/appBridge.js`).
- **Plantillas** (`api/_lib/messaging.js`): `renewal` (recordatorio manual de
  pago), `renewal_fyi` (aviso de cobro automático el día 1), `trial_offer`,
  `maintenance`, `campaign`. **`renewal` y `renewal_fyi` cubren exactamente los
  dos correos del día 1.**
- **Confirmación de pago** (`api/_lib/control/license-action.js` → op
  `confirm_payment`): escribe la licencia (avanza expiry, marca `active`) pero
  **no envía correo**. Esta es la brecha #1.
- **Resolución de destinatarios** (`api/_lib/control/list-contacts.js` → puente
  `tenants.contacts` con `messagingFor(appId).recipient`): devuelve
  `[{ id, name, email }]` de owners/admins por app.
- **Crons**: uno solo, `sync` diario a las `08:00 UTC`, declarado en `vercel.json`.
- **Sync de licencias** (`api/_lib/sync/syncLicenses.js`): hace `upsert` en
  `licenses` con `onConflict: app_id,external_id`, enviando solo las columnas
  mapeadas (`plan`, `status`, `seats`, `trial_ends_at`, `current_period_end`,
  `raw`, `synced_at`). PostgREST solo actualiza las columnas presentes en el
  payload, así que **columnas nuevas fuera del payload no se pisan** en el update.

## Decisiones tomadas

1. **Recordatorio del día 1 → automático** desde un cron (con dedupe una vez por
   tenant por mes).
2. **Destinatarios del recordatorio**: licencias **vencidas o por vencer dentro
   del mes en curso** (`current_period_end` ya pasó o cae antes del fin del mes
   actual).
3. **Cobro automático → no se excluye, se le manda otro correo**: `renewal_fyi`
   (aviso de cargo automático) en lugar de `renewal`.
4. **Señal de cobro automático**: un flag `auto_renew` por licencia que el
   operador marca desde la UI (opción honesta; MC no tiene señal confiable del
   estado de suscripción recurrente de Mercado Pago).
5. **Agradecimiento al confirmar pago**: con **casilla opcional** en el modal
   ("Enviar correo de confirmación", marcada por defecto). El envío es
   best-effort: si falla, el pago igual quedó aplicado.
6. **Horario del cron mensual**: `0 15 1 * *` (~9am hora de Ciudad de México).

## Arquitectura

### 1. Base de datos — `supabase/migrations/0017_renewal_reminders.sql`

- `alter table public.licenses add column auto_renew boolean not null default false;`
  Metadata que **posee Mission Control**. El upsert del sync no la incluye, así
  que los valores puestos por el operador se conservan (los renglones nuevos
  toman el default `false`).
- Nueva tabla de idempotencia:

  ```sql
  create table public.renewal_reminders (
    id          uuid primary key default gen_random_uuid(),
    app_id      text not null references public.apps(id) on delete cascade,
    external_id text not null,                 -- id de la licencia en el app
    period      text not null,                 -- 'YYYY-MM' del envío
    kind        text not null,                 -- 'renewal' | 'renewal_fyi'
    recipient   text,                          -- correo al que se envió
    sent_at     timestamptz not null default now(),
    unique (app_id, external_id, period)
  );
  ```

  RLS: SELECT para miembros (viewer+); INSERT/UPDATE/DELETE solo `service_role`
  (el cron escribe con service key; nadie edita a mano). Mismo patrón que las
  demás tablas operativas de la bodega.

  El `unique (app_id, external_id, period)` garantiza **un correo por tenant por
  mes**: el cron se puede reejecutar el mismo día 1 sin duplicar.

### 2. Plantilla nueva — `api/_lib/messaging.js`

Agregar el tipo `payment_confirmed` a `renderMessage`:

- **subject**: `"{tenant}, tu licencia de {app} quedó activa ✅"`
- **cuerpo**: agradecimiento + "válida hasta **{fecha de expiry}**" + período
  pagado (1 o 12 meses) + referencia de pago si vino. Mismo `wrap()` de marca
  ACACIA, sin datos sensibles del cliente más allá del nombre/fecha.
- `ctx` esperado: `{ app, tenantName, date (newExpiry), periodMonths, reference }`.

Es la **única** plantilla nueva.

### 3. Helper compartido — `api/_lib/emailFollowup.js` (nuevo)

Extrae la lógica hoy embebida en `send-message.js`/`list-contacts.js` para que el
cron y `license-action` no la dupliquen. Funciones puras/pequeñas:

- `resolveRecipients(app, cfg)` → `[{ id, name, email }]` (puente
  `tenants.contacts` + enriquecimiento de nombre desde `tenants`).
- `sendFollowup(app, cfg, type, recipient, ctx)` → renderiza con
  `renderMessage`, llama `emails.sendFollowup`, arma el `log` del app si
  `cfg.log`. Devuelve `{ sent, error }`.

`send-message.js` y `list-contacts.js` se refactorizan para usarlo (sin cambiar
su comportamiento observable).

### 4. Agradecimiento al confirmar pago — `api/_lib/control/license-action.js`

Tras el `license.set` + resync exitoso, si `op === 'confirm_payment'` **y**
`req.body.sendEmail !== false`:

- Resolver el correo del admin de esa tienda: `resolveRecipients(app, cfg)` y
  filtrar por `id === licenseExternalId` (cfg de `messagingFor(appId)`).
- `sendFollowup(app, cfg, 'payment_confirmed', recipient, { tenantName, date: change.newExpiry, periodMonths, reference: paymentReference })`.
- **Best-effort**: envolver en try/catch; nunca revierte el pago. La respuesta
  incluye `emailed: true | false | null` (null = sin destinatario resoluble).

`license-action` acepta el nuevo campo opcional `sendEmail` (default `true`).

### 5. Cron mensual — `api/cron/renewal-reminders.js` (nuevo) + `vercel.json`

- Entrada en `vercel.json`: `{ "path": "/api/cron/renewal-reminders", "schedule": "0 15 1 * *" }`.
- Gate idéntico a `sync`: `CRON_SECRET` (Bearer) o header `x-vercel-cron`.
- Flujo por cada app Base44 con `messagingFor(app.id)`:
  1. Leer de la bodega las licencias del app con
     `qualifiesForReminder(license, now)` = `current_period_end` no nulo y
     `<= fin del mes en curso` (incluye vencidas). Traer también `auto_renew`.
  2. `resolveRecipients(app, cfg)` y cruzar por `id` (`external_id`).
  3. Para cada tenant con correo **no registrado** en `renewal_reminders` para
     el `period` (`YYYY-MM`) actual:
     - `kind = reminderKindFor(license)` = `auto_renew ? 'renewal_fyi' : 'renewal'`.
     - `sendFollowup(...)` con `date = current_period_end`, `days` calculado.
     - Insertar en `renewal_reminders` (unique lo hace idempotente; capturar el
       error de conflicto como "ya enviado"). Registrar log del app si aplica.
  4. `audit('cron:renewal-reminders', { period, summary })`.

Funciones puras extraíbles y testeables: `qualifiesForReminder(license, now)`,
`reminderKindFor(license)`, `currentPeriodKey(now)` → `'YYYY-MM'`.

**Presupuesto de funciones Vercel**: hoy se usan ~6 de 12 (Hobby). Este cron es
la 2ª entrada de cron (Hobby permite ≥1/día; mensual cumple). OK.

### 6. UI — `src/pages/Licenses.jsx`

- Toggle **"Cobro automático"** por licencia (columna Control o junto al estado).
  `auto_renew` es metadata de la bodega; el cliente lo escribe directo por
  Supabase: `supabase.from('licenses').update({ auto_renew }).eq('id', row.id)`
  (RLS ya permite a `admin` escribir `licenses`). Sin endpoint nuevo.
- Modal "Confirmar pago": casilla **"Enviar correo de confirmación al admin"**
  (marcada por defecto). Su valor se pasa como `sendEmail` a `licenseAction`.
- `src/lib/control.js`: `licenseAction` acepta y reenvía `sendEmail` dentro del
  objeto de opciones existente.

## Flujo de datos

```
Confirmar pago (UI, sendEmail=true)
  → POST /api/control/license-action {op:'confirm_payment', ..., sendEmail}
    → license.set (puente)  → resync licencias (bodega)
    → [best-effort] resolveRecipients → sendFollowup('payment_confirmed')
    → audit

Día 1, 15:00 UTC (Vercel cron)
  → GET /api/cron/renewal-reminders
    → por app: licencias vencidas/por-vencer (bodega, con auto_renew)
      → resolveRecipients
      → por tenant no avisado este mes:
          auto_renew ? renewal_fyi : renewal
          → sendFollowup → insert renewal_reminders (dedupe) → log app
    → audit
```

## Manejo de errores

- **Correo al confirmar pago**: best-effort. Falla del correo ⇒ pago aplicado
  igual; `emailed:false` en la respuesta y un `console.warn`. No 5xx por esto.
- **Cron**: por-app y por-tenant en try/catch; un fallo de un tenant no detiene
  al resto. Resumen en `audit`. Reejecución segura por el `unique` de
  `renewal_reminders`.
- **Puente no configurado** (`INGEST_HMAC_SECRET` ausente): el cron sale con
  resumen `skipped: 'bridge not configured'`, igual que `sync`.

## Pruebas (`node --test`)

- `messaging.test` (nuevo o existente): `renderMessage('payment_confirmed', …)`
  produce subject + html con fecha y período.
- `renewalReminders.test` (nuevo): `qualifiesForReminder` (vencida sí, futura no,
  null no), `reminderKindFor` (auto→fyi, manual→renewal), `currentPeriodKey`.
- Verificar `npm run build` y `npm run lint` en verde.

## Fuera de alcance (YAGNI)

- Inferir `auto_renew` automáticamente desde Mercado Pago (preapproval/webhook de
  suscripción). Se puede agregar después sin romper el modelo.
- Editar historial de `renewal_reminders` desde la UI.
- Recordatorios para tickets/otros pilares.
