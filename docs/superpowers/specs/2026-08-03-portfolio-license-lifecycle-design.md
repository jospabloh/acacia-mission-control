# Diseño — Mission Control como única autoridad del ciclo de vida de licencias (portafolio completo)

**Fecha:** 2026-08-03
**Rama:** `claude/audit-email-reminders-csp5u4`
**Pillar afectado:** Licencias / Ingresos
**Dispara:** incidente real — StockFlow bloqueó el tenant `baristop` el 2026-08-01
(vencimiento 2026-07-31) sin ningún aviso graduado de Mission Control.

## ⚠️ Supuestos que necesitan confirmación

El usuario dio la especificación completa pero dejó 4 preguntas de clarificación
sin responder (las descartó explícitamente — "dismissed", esperando retomarlas
después) antes de instruir "haz que esto pase, Mission Control debe ser la
única autoridad". Este documento avanza con la interpretación más razonable de
cada punto ambiguo, **marcada explícitamente abajo**, para no bloquear el
trabajo — pero cada una debe confirmarse antes o durante la implementación:

1. **CateqHub como excepción.** Este diseño trata a CateqHub como la excepción
   explícita que el propio mensaje del usuario permite ("a menos que se indique
   lo contrario") — mantiene su ciclo actual (freemium + Tutores como add-on,
   15/15/30 días, sin cobro automático), documentado en
   `docs/superpowers/specs/2026-07-23-cateqhub-premium-license-lifecycle-design.md`.
   El esquema nuevo unificado (7/15/30/45) aplica a FlowFin, StockFlow, LIUMA,
   Puntos+, Rumbo y Radar.
2. **Cómputo de días: acumulado desde el vencimiento original**, no desde la
   etapa anterior. Día 8 = read-only. Día 15 = bloqueo + exportación. Día 30 =
   inactivo. Día 45 = elegible para borrado (nunca automático).
3. **Monto prorrateado: fuera de alcance de este plan.** No existen precios de
   plan estructurados para FlowFin/StockFlow/LIUMA/Puntos+/Rumbo/Radar en
   Mission Control (solo CateqHub los documenta, y solo en comentarios). Este
   diseño implementa fechas/estados/correos/confirmación de pago **sin mostrar
   un monto calculado** — el operador ve días vencidos, no un $ prorrateado.
   Cuando el usuario provea la tabla de precios por app/plan, se agrega como
   una fase separada.
4. **Aviso de pago: registrado por un operador, no autoservicio del tenant.**
   Los tenants no tienen acceso a Mission Control. Un admin de Mission Control
   registra "pago reportado" (monto, referencia, fuente) cuando el tenant avisa
   por su canal habitual (WhatsApp/correo/ticket) — eso crea el pendiente. Solo
   rol `owner` puede confirmarlo, lo cual dispara `confirm_payment` de verdad.

## Problema (hallazgos concretos de esta sesión)

### 1. Cada app del portafolio hace cumplimiento de licencia por su cuenta, cada una distinto

**StockFlow** (`base44/functions/checkAccountLifecycle/entry.ts`, cron Base44 a
las 08:00 UTC diario — confirmado en `base44/NIGHTLY_AUTOMATIONS_SETUP.md`):

- `active` con `license_expires_at` vencido → **inmediatamente** `view_only`
  (cero días de gracia) + correo `license_expired`/`account_view_only`.
- `view_only` por 15 días → `archived` (+ agenda `scheduled_delete_at` a 30
  días más) + correo `account_archived`.
- `archived` con `scheduled_delete_at` alcanzado → **borra el Business y todos
  sus Users**, sin intervención humana.
- Además manda recordatorios propios de trial (día 15/25/28/30) y de cobro
  automático (`renewal_charge_reminder_3/2/1`) — hay también un cron hermano
  `processMonthlyRenewal` (09:00 UTC) para el cobro en sí.

Esto es exactamente el antipatrón que el propio diseño de CateqHub
(2026-07-23) ya identificó y evitó deliberadamente: *"StockFlow tiene su
propio cron `checkAccountLifecycle` que decide solo-lectura/archivado sin que
Mission Control participe"*. Es la causa raíz de que `baristop` se bloqueara
sin ningún aviso graduado de Mission Control — el tenant vivió el timeline de
StockFlow (0 días de gracia, borrado a los 45 días totales), no uno que
Mission Control controle.

**Precedente idéntico ya resuelto:** Puntos+ tenía el mismo patrón
(`cleanupInactiveUsers`, ver PR #59 de esta sesión) — reactivado sin querer
por un fix de bug, con público mayormente distinto al de Mission Control. Se
resolvió hoy hay solo desde el lado de Mission Control (excluir Puntos+ del
cron de uso), **no** desapareciendo la automatización nativa — porque
apagar/editar una automatización o función de Base44 requiere el Base44 MCP,
no autorizado en esta sesión. El mismo blocker aplica aquí.

**Es altamente probable que FlowFin/LIUMA/Puntos+/Rumbo/Radar tengan cada uno
su propia variante** de esto — no se auditaron los seis a fondo en esta
sesión por tiempo, pero el patrón (antes de que existiera `licenseControl.js`
con su `lifecycle`, cada app resolvía esto sola) hace que sea la apuesta más
segura. Auditar los otros cinco queda como tarea explícita del plan.

### 2. `licenseControl.js` ya tiene casi todo lo necesario — pero solo lo enciende para CateqHub

`api/_lib/licenseControl.js` ya define, **para cada app**, `statusField`,
`statuses` (`active`/`suspended`/`view_only`) y `billing` (expiry field,
`dayConvention`, tipo de pago) — usados hoy solo para acciones **manuales**
(botones Reactivar/Pausar/Solo lectura/Confirmar pago en `Licenses.jsx`). El
mecanismo `cfg.lifecycle` (transición automática por días) existe y está
probado (`licenseLifecycle.js` + `license-lifecycle.js`), pero **solo tiene
entrada `cateqhub`** — el resto del portafolio no tiene ninguna transición
automática.

Estados ya disponibles por app (confirmado leyendo cada `base44/entities/*.jsonc`
del repo — puede haber drift contra lo desplegado, ver advertencia de cada
CLAUDE.md):

| App       | `active` | `view_only`/solo-lectura | `suspended`/bloqueo | Campo de vencimiento ya sincronizado |
|-----------|:--------:|:------------------------:|:--------------------:|----------------------------------------|
| flowfin   | ✅ | ✅ (`view_only`) | ✅ (`suspended`) | `license_expires_at` |
| stockflow | ✅ | ✅ (`view_only`) | ✅ (`suspended`) | `license_expires_at` |
| liuma     | ✅ | ✅ (`view_only`) | ✅ (`suspended`) | `license_expires_at` |
| puntos    | ✅ | ✅ (`view_only`) | ✅ (`suspended`) | `license_expires_at` |
| rumbo     | ✅ | ❌ **no existe en el schema** | ✅ (`suspended`) | `current_period_end` |
| radar     | ✅ | ❌ **no existe en el schema** | ✅ (`suspended`) | `license_expiry` |

Esto importa muchísimo para el alcance: **el read-only del día 8 y el bloqueo
del día 15 son alcanzables HOY, sin ningún cambio de schema de Base44, para
flowfin/stockflow/liuma/puntos** — porque ya tienen los tres estados y Mission
Control ya sabe escribirlos vía la acción genérica `license.set` (ya
desplegada). Rumbo y Radar **no tienen un estado de solo-lectura en su
schema** — confirmado en `TenantLicense.jsonc` (`enum: [active, expired,
suspended, cancelled]`) y `Company.jsonc` (`enum: [active, suspended]`).
Agregarlo requiere el Base44 MCP (bloqueado). Mientras tanto, para esos dos
apps el día 8 solo puede mandar el correo, no aplicar el estado.

### 3. Las etapas "inactivo" (día 30) y "elegible para borrado" (día 45) no necesitan tocar Base44 en absoluto

Ningún app tiene (ni necesita) un cuarto valor de estado para "inactivo" —
la app se queda en el estado que ya tiene (`view_only` o `suspended`) desde el
día 8/15; "inactivo" y "elegible para borrado" son **bookkeeping interno de
Mission Control** (en qué punto del ciclo está, para decidir qué correo mandar
y cuándo mostrar el badge de revisión al owner), no un estado que la app deba
conocer. Esto reduce drásticamente el trabajo bloqueado por Base44: de las 4
etapas, solo la 1 (read-only) le falta a 2 de 6 apps, y el borrado real (etapa
4) **nunca es automático** — coincide con la decisión ya tomada para CateqHub
("el borrado nunca es automático").

### 4. "App Founder": plan oculto — evidencia parcial, no confirmada en todos los apps

Se encontró **una sola referencia** en los 8 repos de apps: StockFlow
(`base44/functions/sendLifecycleEmails/entry.ts`, `PLAN_LABELS.founder =
'Founder'`) — y **ni siquiera ahí** está declarado en el enum del schema
committeado (`Business.jsonc` solo lista `start/growth/pro`). Ningún otro app
(flowfin, liuma, puntos, rumbo, radar, cateqhub) tiene ninguna referencia a
"founder" en su código o schema. Esto es consistente con el patrón de drift
"repo vs. desplegado" ya documentado en varios CLAUDE.md de este portafolio —
es plausible que el valor exista en el schema desplegado de cada app sin estar
en el `.jsonc` del repo, pero **no puedo confirmarlo sin el Base44 MCP**
(`list_entity_schemas`). Se agrega como plan seleccionable en
`licenseControl.js` bajo el supuesto de que el valor ya es válido en cada
backend desplegado (los enums de Base44 no bloquean escrituras directas de
servicio, evidenciado por que StockFlow ya lo usa sin tenerlo en su enum
committeado) — **si una escritura de plan `founder` falla en algún app,
significa que ese app específico sí necesita el valor agregado a su schema
desplegado (Base44 MCP)**.

## Decisiones

1. **Alcance de esta fase:** solo Mission Control. Nada que requiera un
   deploy de schema o de función Base44 se implementa aquí — se documenta como
   bloqueado y se deja listo para activarse en cuanto el Base44 MCP se
   autorice.
2. **Modelo de 4 etapas, acumulado desde el vencimiento** (`current_period_end`
   /`license_expires_at`, ya sincronizado en `public.licenses`):
   - Día 0–7: activo, con recordatorios (igual que hoy: T-7 antes de vencer +
     aviso el día que vence).
   - Día 8: `read_only` — si el app lo soporta (flowfin/stockflow/liuma/puntos:
     aplica `view_only`; rumbo/radar: **solo correo**, sin poder aplicar el
     estado — gap documentado, no silencioso).
   - Día 15: `blocked` — aplica `suspended` en los 6 apps (todos lo tienen).
     Correo explica que puede pedir sus datos por soporte (no hay
     autoexportación en ninguno de estos 6 apps hoy, a diferencia de CateqHub).
   - Día 30: `inactive` — la ETAPA es bookkeeping interno de Mission Control
     (elige el correo, distinto tono de "última oportunidad antes de perder
     tus datos"; no es un estado nuevo distinto en el app, que sigue viendo
     `suspended`). Pero la ESCRITURA sí se aplica: `targetStatus` es el mismo
     `cfg.blockedStatus` que `blocked` usa, para garantizar que un tenant
     observado por primera vez ya en día 30+ (cron recién desplegado, bridge
     caído semanas, onboarding a mitad de ciclo) también quede bloqueado, en
     vez de quedarse en su status previo para siempre por nunca haber pasado
     por el escalón `blocked`. Para quien ya llegó a `suspended` en el día 15,
     esto es un no-op (el cron ya solo escribe si `status` difiere del
     target).
   - Día 45: `deletion_eligible` — misma lógica que día 30: la etapa es
     bookkeeping interno + alerta al owner en Mission Control (badge en
     `Licenses.jsx`, igual que CateqHub), y la escritura reutiliza
     `cfg.blockedStatus` con el mismo criterio idempotente de arriba. **Nunca
     borra nada solo.** El borrado real queda fuera de alcance de esta fase
     (requiere una acción de borrado por app, hoy no existe de forma genérica
     y segura para estos 6 apps — se diseña cuando se ataque esa fase).
   - En cualquier momento, si se confirma un pago, la licencia vuelve a
     `active` con vencimiento nuevo y se resetea todo el bookkeeping — igual
     que hoy hace `confirm_payment`.
3. **Retirar las automatizaciones nativas de cada app queda fuera de esta
   fase** (bloqueado por Base44 MCP) — se documenta cuál se encontró
   (StockFlow) y se agrega auditar el resto como tarea explícita. Mientras no
   se retiren, **StockFlow seguirá bloqueando tenants con su propio timeline
   más agresivo en paralelo** a lo que Mission Control haga — este plan no
   resuelve el síntoma original hasta que ese bloqueador se levante. Se
   comunica así, sin prometer que el incidente de `baristop` no se repita
   hasta entonces.
4. **Confirmación de pago con reporte previo.** Tabla nueva
   `payment_reports` (app_id, external_id, reported_by, amount, reference,
   note, reported_at, confirmed_by, confirmed_at). Cualquier `admin` puede
   crear un reporte; solo `owner` puede confirmarlo — al confirmar, dispara el
   `confirm_payment` existente. Sin reporte previo confirmado, `confirm_payment`
   sigue disponible directo para `admin` (comportamiento actual, no se retira)
   — el reporte es un paso *adicional* para trazabilidad, no un gate nuevo
   sobre la acción ya existente.
5. **`App Founder`**: se agrega a `plans[]` de flowfin, stockflow, liuma,
   puntos, rumbo, radar (valor `founder`, plan oculto — Mission Control no lo
   pone en ningún flujo de alta automática, solo lo deja seleccionable a mano
   en el picker de `Licenses.jsx`, igual que cualquier otro plan). No se marca
   como plan "premium" para efectos del ciclo de vida (un tenant Founder no
   debería expirar nunca por diseño de negocio — se documenta como suposición
   a confirmar: ¿Founder tiene vencimiento o es vitalicio?). **Asunción tomada
   para esta fase: Founder no tiene fecha de vencimiento — se le pone
   `current_period_end = null` y el cron lo excluye del ciclo de vida
   completamente (igual que hoy excluye licencias sin `current_period_end`).**

## Arquitectura

### `api/_lib/licenseControl.js` — extender `APPS`

Cada app de `{flowfin, stockflow, liuma, puntos}` gana un bloque `lifecycle`
nuevo (unificado, no el de CateqHub):

```js
lifecycle: {
  graceDaysToReadOnly: 8,      // acumulado desde el vencimiento
  graceDaysToBlocked: 15,
  graceDaysToInactive: 30,
  graceDaysToDeletionEligible: 45,
  readOnlyStatus: 'view_only', // null si el app no lo soporta (rumbo/radar)
  blockedStatus: 'suspended',
}
```

`rumbo` y `radar` ganan el mismo bloque con `readOnlyStatus: null` — el cron
manda el correo de día 8 pero no llama a `license.set` para ese salto
(registra `enforcementGap: true` en el resumen de auditoría para que sea
visible, no silencioso).

`plans` de los 6 apps gana `'founder'` al final del arreglo.

### `api/_lib/portfolioLifecycle.js` (nuevo, lógica pura)

Reemplaza el uso de `cfg.lifecycle` de CateqHub-shape por el modelo unificado
de 4 etapas, acumulado desde una sola fecha (`current_period_end`) — sin
"since fields" por etapa (a diferencia de CateqHub, que si los necesita
porque su modelo es por-etapa, no acumulado). Ver Tarea 1 del plan de
implementación para las funciones exactas.

### `api/cron/license-lifecycle.js` — extender para leer también `lifecycle` unificado

El cron ya itera `apps` con `cfg.lifecycle` — se generaliza para reconocer dos
formas de `lifecycle` (la de CateqHub, por-etapa con `sinceFields`, y la nueva
unificada, acumulada desde `current_period_end`) y despachar a la función pura
correcta. Ningún app tiene ambas a la vez, así que no hay ambigüedad real.

### `supabase/migrations/0030_payment_reports.sql` (nuevo)

```sql
create table public.payment_reports (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.apps(id) on delete cascade,
  external_id text not null,
  amount numeric,
  reference text,
  note text,
  reported_by text not null,
  reported_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz
);
-- RLS: viewer+ lee, admin crea (reporta), solo escribe confirmed_by/confirmed_at
-- vía el endpoint de confirmación (service_role) — no hay UPDATE directo por RLS.
```

### Correos nuevos (`api/_lib/messaging.js`)

`license_read_only`, `license_blocked`, `license_inactive_warning` (día 30,
tono "última oportunidad"), `payment_reported_pending` (interno, al owner —
no al tenant). Reutilizan `wrap()`/`esc()` igual que las plantillas
existentes; nombres genéricos (no "Tutores"/CateqHub-específicos) porque
aplican a cualquiera de los 6 apps de licencia de asiento.

## Fuera de alcance de esta fase (YAGNI explícito)

- Retirar/editar cualquier automatización nativa de un app (StockFlow u
  otros) — bloqueado por Base44 MCP.
- Agregar `view_only` al schema de Rumbo/Radar — bloqueado por Base44 MCP.
- Borrado real de tenants en el día 45 — necesita una acción de borrado por
  app, ninguna existe hoy para estos 6 apps de forma segura; se diseña cuando
  se ataque esa fase, siguiendo el patrón ya validado de CateqHub (borrado
  nunca automático, gate por confirmación de exportación + rol `owner`).
- Cálculo de monto prorrateado — no hay datos de precio por plan; se agrega
  cuando el usuario los provea.
- Auditar las automatizaciones nativas de FlowFin/LIUMA/Puntos+/Rumbo/Radar —
  se deja como tarea de investigación separada (no bloquea este plan, pero
  bloquea que el problema quede resuelto de verdad en esos apps).
