# Diseño — Sesiones activas por usuario (ver y forzar desconexión)

**Fecha:** 2026-07-05
**Rama:** `claude/mission-control-active-sessions-kfarp6`
**Pillar afectado:** Portafolio (Dashboard) + AppDetail + Control
**Repos tocados:** `acacia-mission-control` (este) + cada app Base44 con auth
(`puntos`, `rumbo`, `liuma`, `flowfin`, `stockflow`, `bari-sales-ai`; `plink_fx` /
`radar` según tengan usuarios)

## Problema

Mission Control no tiene forma de ver **cuántas sesiones activas por usuario**
tiene cada app del portafolio, ni de **forzar la desconexión** de un usuario
(obligarlo a volver a iniciar sesión). Se necesita:

1. En el **vistazo inicial** (tarjeta de cada app): ver el número de sesiones
   activas.
2. En el **detalle** de la app: ver las sesiones **agrupadas por usuario** y
   poder **cerrarlas** (force-logout).
3. Un **warning** si el usuario está moviendo la app activamente. Una sesión
   **tiene que estar idle > 30 min** para poder cerrarse.
4. Poder **cerrar todas las sesiones de un usuario menos las que no están idle**
   (las activas se saltan).

## Decisiones tomadas (brainstorming)

1. **Fuente de datos:** se construye desde cero en las apps (hoy no existe
   rastreo por sesión). El modelo actual `User.last_active_at` no se actualiza y
   es por-usuario, no por-sesión/dispositivo.
2. **Regla idle:** **bloqueo con override del owner.** Una sesión activa
   (idle < 30 min) no se puede cerrar; solo el rol `owner` puede forzarla con
   confirmación explícita. La acción masiva "cerrar todas" **siempre** salta las
   activas.
3. **Métrica de la tarjeta:** **todas las sesiones abiertas** (en línea + idle).
   El detalle separa "en línea" vs "idle".
4. **Lectura de datos:** **híbrido.** El vistazo lee la copia sincronizada en la
   bodega (barato, una consulta para todo el portafolio). El detalle lee **en
   vivo** vía el puente. Revocar es en vivo + re-sync inmediato. Es el mismo
   patrón que `licenses`/`usage`.

## Contexto: qué ya existe

- **Puente `acaciaControl`** (`api/_lib/appBridge.js` → `callBridge(app, action,
  params)`): canal único HMAC-firmado, service-role. En cada app Base44 es un
  `switch` de acciones (`base44/functions/acaciaControl/entry.ts`). Agregar
  acciones nuevas es sumar `case`s.
- **Patrón sync → bodega** (`api/_lib/sync/syncLicenses.js`): `callBridge(...list)`
  → mapear → `upsert onConflict app_id,external_id` → `synced_at`. Idempotente.
- **Router de control** (`api/control/[action].js`): una sola función Vercel que
  despacha acciones a handlers en `api/_lib/control/`. **Importante:** el plan
  Hobby de Vercel cap­ea en 12 funciones; **no** creamos archivos-función nuevos,
  agregamos acciones al router existente.
- **Enforcement de rol** (`api/_lib/requireMember.js`): valida la sesión Supabase
  del operador y su rol (`viewer|admin|owner`).
- **Auditoría** (`audit()` en `api/_lib/supabaseAdmin.js`).
- **Dashboard** (`src/pages/Dashboard.jsx`): `AppCard` muestra tenants/licencias;
  hay `StatCard`s de portafolio. **AppDetail** (`src/pages/AppDetail.jsx`) ya
  tiene secciones de control + analíticas + un patrón de fila expandible.
- **Cliente de control** (`src/lib/control.js`): helpers que llaman
  `/api/control/<action>` con el `access_token` del operador.
- **Lado app (cliente):** `src/lib/NavigationTracker.jsx` ya corre en cada
  navegación (buen lugar para colgar el latido); `AuthContext.jsx` /
  `ProtectedRoute.jsx` / `base44Client.js` gobiernan el arranque autenticado.

## Arquitectura de la solución

### A. Lado app Base44 (se replica idéntico a cada app)

#### A.1 Entidad `AppSession`
Una fila = **un login en un dispositivo/navegador**.

| Campo | Tipo | Notas |
|---|---|---|
| `user_email` | string | usuario final |
| `user_name` | string | display |
| `device` | string | user-agent corto (p.ej. "Chrome · macOS") |
| `started_at` | date-time | login |
| `last_active_at` | date-time | lo mueve el latido |
| `revoked_at` | date-time \| null | null = viva; set por MC = force-logout |
| `revoked_by` | string \| null | email del operador (auditoría) |

RLS (según CLAUDE.md de cada app): mantener la rama
`{"user_condition":{"role":"admin"}}` en las 4 ops; el usuario solo puede crear
y actualizar (`last_active_at`) **su propia** sesión; el service-role (bridge)
hace el resto. `npm run validate:rls` debe pasar.

#### A.2 Cliente: latido + enforcement (`useSessionHeartbeat`)
- **Al autenticarse:** si `sessionStorage` no tiene un id de `AppSession` para
  esta pestaña, crea la fila y guarda su id (reusar evita duplicados al
  recargar).
- **Latido:** cada ~60 s mientras la pestaña está **visible**, y en navegación
  (se cuelga del `NavigationTracker` existente), hace `update(id, {
  last_active_at: now })` con throttle de 60 s.
- **Enforcement (force-logout real):** en cada latido **y** al cargar, lee su
  propia fila; si `revoked_at != null` (o la fila ya no existe) → `logout()` de
  Base44 + limpia `sessionStorage` + redirige a login. Latencia máxima = 1
  intervalo de latido (~1 min). Este es el mecanismo que hace que "forzar
  desconexión" funcione sin poder invalidar el JWT de Base44 directamente.

#### A.3 Bridge `acaciaControl` — 2 acciones nuevas (mismo archivo a todas)
- `sessions.list` → `{ entity }` → `{ ok, records }` (service-role, cap 5000).
- `sessions.revoke` → `{ entity, ids: string[], actorEmail }` → pone
  `revoked_at=now`, `revoked_by=actorEmail` en cada id. Bulk. Devuelve
  `{ ok, revoked: n }`.

### B. Lado Mission Control (este repo)

#### B.1 Bodega — migración `0019_app_sessions.sql` (siguiente número libre)
Tabla `public.app_sessions` (copia read-optimizada, como `licenses`):
`app_id` (fk apps), `external_id` (id de sesión), `user_email`, `user_name`,
`device`, `started_at`, `last_active_at`, `revoked_at`, `synced_at`,
`raw jsonb`. Único `(app_id, external_id)`. RLS con el loop-helper existente
(viewer lee; el service-role escribe). Índice por `(app_id, last_active_at)`.

Seed: agregar `config.session_entity = "AppSession"` (y flag de soporte) a las
apps Base44 con auth, vía migración de seed — igual que `license_entity`.

#### B.2 Sync — `api/_lib/sync/syncSessions.js`
Espejo de `syncLicenses`: `callBridge(app, 'sessions.list', { entity })` →
mapear → `upsert onConflict app_id,external_id` con `synced_at`. **Poda:** las
sesiones sin actividad > **ventana de 24 h** se consideran terminadas y se
**borran** de la bodega (delete por `app_id` + `last_active_at < now-24h`). Se
agrega al cron `sync` y a los `kinds` de `run-sync` (`'sessions'`).

#### B.3 Control (acciones en el router `[action].js`, sin nuevos archivos-función)
- **`sessions`** (`api/_lib/control/sessions.js`): admin+. Lee **en vivo** vía
  `callBridge(app, 'sessions.list')`, normaliza y **calcula idle en el servidor**
  (reloj único). Devuelve sesiones agrupadas por usuario:
  `{ users: [{ user_email, user_name, sessions: [{ id, device, started_at,
  last_active_at, idle_ms, state: 'online'|'idle', revoked }], online, idle }],
  totals: { open, online, idle } }`.
- **`session-revoke`** (`api/_lib/control/session-revoke.js`): **aquí vive la
  regla de negocio, server-side (nunca confiar en el cliente).** Entrada:
  `{ appId, scope: 'session'|'user-idle', ids?, userEmail?, override? }`.
  - Lee las sesiones en vivo, calcula idle con `IDLE_MS = 30*60*1000`.
  - `scope: 'session'`: para cada id, si `idle_ms < IDLE_MS` →
    **bloquear** salvo `override === true` **y** `member.role === 'owner'`
    (si no, `409` con `{ blocked: [...], reason }`). Un `admin` nunca fuerza.
  - `scope: 'user-idle'`: revoca **solo** las sesiones de `userEmail` con
    `idle_ms >= IDLE_MS`; **salta** las activas y las reporta en
    `{ skipped_active: n }`.
  - Llama `callBridge(app, 'sessions.revoke', { entity, ids, actorEmail })`,
    `audit('control:session-revoke', {...})` (incluye `override`), y re-sincroniza
    la bodega. Devuelve `{ ok, revoked, skipped_active, blocked }`.

Ambas se registran en el `ROUTES` de `api/control/[action].js`.

#### B.4 Cliente de control (`src/lib/control.js`)
- `appSessions(appId)` → GET vivo normalizado.
- `revokeSessions(appId, { scope, ids, userEmail, override })`.

#### B.5 UI — Dashboard (`src/pages/Dashboard.jsx`)
- En `useEffect`, además de tenants/licencias, leer `app_sessions` de la bodega
  (una consulta) y agregar por `app_id` → `{ open, online }` (idle calculado en
  cliente desde `last_active_at`).
- `AppCard`: añadir una línea "**N sesiones**" (total abiertas) junto a
  tenants/licencias, con un indicador tenue "● N en línea".
- `StatCard` de portafolio nuevo: "**Sesiones activas**" (suma de abiertas).
- Solo apps con `config.session_entity`; el resto no muestra el dato.

#### B.6 UI — AppDetail (`src/pages/AppDetail.jsx`) — sección "Sesiones activas"
- Se carga **en vivo** vía `appSessions(appId)` (independiente del resto).
- Encabezado: total abiertas · "**X en línea · Y idle**" · botón **Refrescar** ·
  hora de última lectura.
- **Agrupado por usuario** (patrón de fila expandible ya presente en el archivo):
  fila por usuario (nombre/email · # sesiones · última actividad · badge del
  estado más activo) que expande a sus sesiones individuales:
  - Cada sesión: `device` · `inicio` · "**idle Xmin**" o "**en línea**" ·
    badge 🟢/🟡.
  - Botón **Cerrar** por sesión. Si idle < 30 min → **deshabilitado** con warning
    ("Activo hace X min"). Si el operador es **owner**, aparece **"Forzar
    cierre"** con diálogo de confirmación (`override:true`).
  - Botón por usuario **"Cerrar sesiones idle"** (`scope:'user-idle'`): cierra
    las idle ≥ 30 min, deja las activas, y avisa "N activas no se cerraron".
- Tras cerrar: toast + refresco + nota "el usuario saldrá en su próximo latido
  (~1 min)".
- Apps sin `session_entity`: la sección no se muestra (o "no soportado").

### C. Constantes (un solo lugar, p.ej. `api/_lib/sessions.js` compartido)
- `HEARTBEAT_MS = 60_000`
- `IDLE_MS = 30 * 60_000` (umbral cerrable / "en línea" vs "idle")
- `OPEN_WINDOW_MS = 24 * 60 * 60_000` (más viejo = sesión terminada, se poda)
- Override de sesión activa = **solo `owner`**.

## Modelo de aislamiento (unidades)

- `api/_lib/sessions.js` — cálculo puro de idle/estado y normalización
  (testeable sin red).
- `api/_lib/sync/syncSessions.js` — solo sync bodega.
- `api/_lib/control/sessions.js` / `session-revoke.js` — I/O + enforcement.
- `useSessionHeartbeat` (lado app) — latido + enforcement, aislado del resto.
- Cada unidad: entrada/salida claras, sin fugas de responsabilidad.

## Manejo de errores

- Bridge inalcanzable en `sessions` (vivo): la sección muestra "no se pudo leer"
  sin tumbar el resto de AppDetail (igual que licencias/uso).
- `session-revoke` con sesión activa sin override → `409` + lista `blocked`; la
  UI muestra el warning, no un error rojo.
- Sync best-effort: si una app falla, las demás siguen (patrón actual).
- Revoke es idempotente (revocar una ya revocada no hace daño).

## Pruebas

- **MC unit** (estilo `licenseControl.test.js`): cálculo de idle/estado; regla de
  enforcement (bloqueo <30min, override solo owner, `user-idle` salta activas);
  mapping de `syncSessions`.
- **App:** `npm run validate:rls` por app; desplegar schema + función al backend
  Base44 (el `.jsonc`/`.ts` en el repo no cambia nada en runtime por sí solo).
- **Build/lint:** `npm run build` y `npm run lint` en 0 errores.

## Rollout

1. MC genérico (bodega + sync + control + UI) — funciona aunque ninguna app
   reporte todavía (muestra 0 sesiones).
2. **puntos end-to-end primero:** entidad + hook + bridge, desplegar, verificar
   el ciclo completo (ver → idle → cerrar → el usuario sale).
3. Replicar bridge/entidad/hook idénticos a las 5 apps restantes.

## Fuera de alcance (YAGNI)

- Geolocalización / mapa de sesiones.
- Notificar al usuario final que fue desconectado (solo sale en el próximo
  latido).
- Historial/analítica de sesiones a lo largo del tiempo (solo estado actual).
- Sesiones de apps no-Base44 (estáticas/sitios/externas).
