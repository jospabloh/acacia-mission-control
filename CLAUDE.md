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

## Licencias (F2) — control completo por app (2026-08-21)

`src/pages/Licenses.jsx` filtra por app y por situación, y opera la licencia
entera: pago, estado, plan, **fechas a mano** y **baja**. Lo que hay que saber
antes de tocarlo:

- **El catálogo de capacidades vive en un solo lugar.** `licenseCapabilities()`
  (`api/_lib/licenseControl.js`) es el original; `src/lib/licenseCatalog.js` es
  su copia para el cliente (que no puede importar `api/_lib`), y
  `src/lib/licenseCatalog.test.js` falla si se separan. Antes eran tres mirrors
  sueltos dentro de la página y ya habían derivado: **rumbo llevaba `view_only`
  desplegado desde 2026-08-03 sin que el panel lo ofreciera, y radar no estaba
  en ninguno de los tres, así que sus licencias salían sin un solo botón.**
  Agregar una app o un estado en `licenseControl.js` obliga a actualizar el
  catálogo; no hay forma silenciosa de olvidarlo.
- **`set_dates` escribe la fecha tal cual.** A diferencia de `confirm_payment`,
  no aplica el `dayConvention` del app ni acumula sobre el vencimiento anterior:
  es para prórrogas, cortesías y correcciones de captura. Un campo `date` recibe
  el día; uno `datetime`, el fin de ese día (una licencia "hasta el 30" vale
  durante el 30). El vencimiento se resuelve de `billing.expiryField` **o** de
  `lifecycle.periodEndField`, así que cateqhub —sin bloque `billing`— también se
  edita.
- **"Dar de baja" son dos cosas y las dos importan.** (1) `op:'cancel'` escribe
  la app: estado terminal (`statuses.canceled` si su enum lo tiene — hoy solo
  rumbo con `cancelled` — si no, `suspended`) y vencimiento hoy: **eso** es lo
  que corta el acceso. (2) `licenses.archived_at` (migración 0041, aplicada a
  producción el 2026-08-21) saca el renglón del panel. El (2) hace falta porque
  el registro sigue vivo en la app y el sync lo vuelve a traer; el upsert de
  `syncLicenses` no toca esas columnas, igual que `auto_renew`. Es reversible
  desde "Dadas de baja".
- **No hay borrado real al otro lado del puente, a propósito.** `license.set`
  solo hace patch. `api/_lib/control/license-record.js` (`archive` / `restore` /
  `purge`) toca **solo la bodega**; `purge` pide rol owner y su modal dice que el
  sync puede traer el renglón de vuelta — la app es la fuente de verdad, no el
  panel.

Piezas de UI compartidas en `src/components/ui.jsx` (`Button`, `Badge`, `Modal`,
`ActionMenu`, `FilterChips`, `ToastStack`…) + `src/lib/useToasts.js`. Úsalas al
tocar otras páginas en vez de reinventar el botón: la idea es que el mismo gesto
se vea igual en toda la consola. Un acierto se va solo, un error se queda hasta
que alguien lo cierra.

## Build / verify

- `npm run build` — Vite production build (must pass).
- `npm run lint`  — ESLint, 0 errors.
- `npm run onboard:base44 -- <repoPath> --dry` — preview a Base44 app's registry row.

## Env

See `.env.example`. Client vars are `VITE_*` (anon). Server-only secrets
(`SUPABASE_SERVICE_ROLE_KEY`, `BASE44_*`, `MERCADOPAGO_*`, `INGEST_HMAC_SECRET`)
must **not** carry the `VITE_` prefix — that would leak them into the bundle.

## Selector de tema: claro / oscuro / dispositivo (módulo 12, 2026-08-21)

El tema se elige desde **un solo control**: un círculo pequeño anclado a una
esquina de la pantalla que muestra el modo vigente y, al pulsarlo, crece de lado
en una pista de tres ranuras (Claro · Oscuro · Sistema) con un indicador que se
desliza a la elegida. Tres estados, tres posiciones físicas — que es justo lo
que un botón sol/luna de dos estados no puede expresar en cuanto "seguir al
dispositivo" entra en la lista.

Lo que se guarda es la **preferencia** (`light` | `dark` | `system`), nunca el
color resuelto: con `system` la app sigue a `prefers-color-scheme` en vivo, sin
recargar. `index.html` trae un script pre-montaje que resuelve y aplica el tema
antes de que monte React, así que el primer frame ya sale del color correcto;
ese script y el proveedor comparten clave y valores, y cada uno lleva un
comentario apuntando al otro.

`src/components/ThemeSwitcher.jsx` es **idéntico byte a byte en todas las apps
del portafolio**. La fuente canónica vive en `jospabloh/acacia-app-standard` →
`shared/theme/`: cámbialo allí y cópialo, no lo edites aquí. Lo único propio de
esta app es `src/lib/useThemeMode.js` (de dónde sale el estado) y las variables
`--theme-switcher-bottom/right` en `src/index.css` (dónde se coloca).

**Mission Control no tenía tema oscuro en absoluto.** En vez de escribir una
variante `dark:` en ~625 usos de clase repartidos por 24 archivos, los colores
de `tailwind.config.js` dejaron de ser hexadecimales y pasan por variables CSS
declaradas en `src/index.css`; `.dark` las reapunta y todos los
`bg-paper-card` / `text-ink-mute` / `border-hair` que ya existían siguen el
tema sin tocar un solo JSX. Los tripletes son RGB para que los modificadores de
opacidad (`bg-brand/10`, `text-ink/60`) sigan compilando.

Un color nuevo en hexadecimal dentro de `tailwind.config.js` es un color que no
seguirá el tema: decláralo como variable.

Lo que sí necesitó variante explícita son los chips de estado (rojo / ámbar /
esmeralda / azul), porque llevan significado y no superficie: un fondo `-50`
pasa a un tinte profundo y el texto `6xx/7xx/8xx` sube a `3xx/4xx`. Los acentos
saturados (puntos y barras `-400/-500`) se dejaron como estaban: ya se leen
sobre los dos fondos.

`--brand` es deliberadamente **el mismo** en claro y en oscuro. Es fondo bajo
texto blanco más veces de las que es texto, y aclararlo para el fondo oscuro
cambiaría botones legibles por enlaces legibles.

El estado del tema vive en `src/lib/theme/` partido en tres archivos
(contexto / proveedor / hook), igual que `src/lib/auth/`, porque exportar un
hook y un componente del mismo archivo rompe react-refresh y el lint de este
repo lo marca. `vite.config.js` ganó el alias `@` → `src` para que el
`ThemeSwitcher` compartido pueda quedarse idéntico al del resto del portafolio.

**No verificado:** las pantallas autenticadas (Dashboard, Licencias, Soporte…)
en oscuro — no son alcanzables sin una sesión de Supabase en este entorno. El
riesgo está acotado: todas dibujan con los mismos tokens que sí se revisaron en
`/` (login) y ninguna quedó con un color claro hardcodeado tras el barrido.

## `npm run test:smoke` — comprueba el sitio DESPLEGADO (2026-08-22)

`tests/smoke/smoke.spec.js` es la suite compartida del portafolio, idéntica byte
a byte en todos los repos; la fuente canónica está en
`jospabloh/acacia-app-standard` → `shared/smoke/`. Lo propio de esta app vive en
`tests/smoke/smoke.config.js` (URL, `<title>`, cómo representa el tema).

**No comprueba el build local: comprueba lo que se sirve.** Es la automatización
de la regla que cada CLAUDE.md repite — mergear no deploya nada, y hay que
verificar por contenido y no por hash. Afirma cuatro cosas, todas derivadas de
lo que el propio repo produce (nunca de copy adivinado, que se rompe al cambiar
una palabra y enseña a ignorar la suite):

1. responde 200 y el `<title>` es el de esta app — no un deploy viejo ni otro;
2. no lanza excepciones al pintar;
3. el tema llega resuelto desde el primer frame (el script pre-montaje viajó);
4. el selector de esquina está montado, cambia el tema y la preferencia
   sobrevive a un reload.

**No corre en el pipeline normal ni desde un sandbox de desarrollo**: la salida
HTTPS ahí va por un proxy con allowlist que no incluye estos dominios. Corre en
GitHub Actions (`.github/workflows/smoke.yml`): `workflow_dispatch` para
dispararla a mano justo después de un deploy, y un cron diario como red.

    npm run test:smoke                      # contra producción
    SMOKE_URL=https://… npm run test:smoke  # contra un preview

Desde el 2026-08-22 la suite añade una quinta afirmación, del **módulo 12**: el
selector no tapa nada y nada lo tapa, en móvil (390), tablet (834) y escritorio
(1440), plegado y desplegado. Un control anclado por encima de todo en una
esquina es justo lo que acaba sentado sobre una barra inferior o un botón
flotante, y entonces la app pierde una función al ancho que nadie abrió. La
comprobación distingue las dos direcciones — algo pintado encima del selector, y
el selector respondiendo por un control que hay debajo — y nombra el control
afectado. Se coloca con `--theme-switcher-bottom/right`; si otra cosa ya es dueña
de esa esquina, se mueve el selector, no el control.

## Módulo 14 — auditoría de aislamiento multi-tenant (2026-08-22)

Nuevo en `jospabloh/acacia-app-standard`. **No es releer las reglas de RLS** (eso
es el módulo 4): es recorrer, con fecha y por escrito, todo lo que puede cruzar
un inquilino con otro — cada entidad, cada función de backend (el inquilino se
re-deriva en el servidor, nunca del cuerpo de la petición, y en update/delete se
comprueba contra el registro **almacenado**), cada campo bloqueado, cada
exportación/reporte/búsqueda, cada destinatario de correo o webhook, y el cambio
de inquilino. Contra el **esquema desplegado**, no contra el archivo del repo.

Se repite cuando se añade una entidad, una función o un rol. El resultado se
anota aquí, incluyendo **lo que no se pudo verificar** desde el entorno de
trabajo — normalmente una sesión autenticada como usuario restringido de un
segundo inquilino. Decirlo vale más que insinuar una cobertura que no se logró.

Lo que motiva el módulo es que todos los fallos de aislamiento que este
portafolio llegó a desplegar eran **sintácticamente válidos**: la rama de rol sin
`$and` al inquilino en `Parish` de cateqhub, las 84 instancias de liuma donde el
motor descartaba la cláusula hermana de `user_condition`, los campos de licencia
escribibles por el propio inquilino en puntos y rumbo, y el `PermissionProfile`
que ningún RLS puede consultar porque vive en otra fila.

### Resultado — 2026-08-23, contra la base de datos desplegada

Aquí el módulo 14 pregunta otra cosa, y conviene decirlo antes de responderlo.
Mission Control **no** es multi-inquilino en el sentido del resto del
portafolio: todo operador ve todas las apps, y eso es el producto, no un fallo.
Las dos preguntas que sí aplican son (a) si el modelo de roles de operador
aguanta, y (b) si **las apps siguen separadas entre sí** al otro lado del
puente — porque la bodega guarda los datos de 20 inquilinos de 10 apps, y quien
confunda una con otra los mezcla aquí.

Todo lo de abajo se leyó de la **base viva** (`pg_policies`, `pg_proc`), no de
los `.sql` de `supabase/migrations/`.

#### La bodega está bien

Las **19 tablas** tienen RLS activo y al menos una política. La forma es
uniforme y coincide con el modelo que este archivo documenta: lectura
`is_member_at_least('viewer')`, escritura `admin`, y `owner` para `members`,
para borrar `apps` y para borrar `audit_actions`. `audit_actions` además exige
`admin` para **leer**, no `viewer`.

`current_member_role()` e `is_member_at_least()` son `SECURITY DEFINER` **con
`search_path` fijado a `public`**. Eso importa: un `SECURITY DEFINER` con
search_path mutable es la vía clásica de escalada en Postgres, y aquí está
cerrada.

Las **17 handlers de `api/_lib/control/`** pasan por `requireMember` con el
nivel correcto: `owner` para `members`, `payment-confirm`,
`license-delete-premium-data` y el `purge` de `license-record`; `admin` para el
resto de escrituras; `viewer` para `usage-by-tenant`, `email-status` y el hilo
de un ticket. No hay una sola sin puerta (las tres que salen sin ella en un
grep son sus `.test.js`).

#### Hallazgo 1 — un solo secreto para N apps, y la atribución viaja en el cuerpo

`INGEST_HMAC_SECRET` es **un único valor compartido** por todo el portafolio;
`appBridge.js` lo dice en su cabecera y lo repite al registrar un error
(«INGEST_HMAC_SECRET is one shared value signed against N per-app functions»).

En `api/ingest/ticket.js:25‑27` la firma cubre `{app, record}`, así que nadie
puede manipular el cuerpo **en tránsito**. Pero la llave que firma es la misma
en las diez apps. Entonces la firma demuestra «alguien que tiene el secreto
compartido», nunca «esto viene de la app X»: **cualquier app puede firmar un
`record` diciendo `app: 'otra'`**, y Mission Control ejecuta
`processIncomingTicket({ app, record })` y escribe un ticket falso atribuido a
esa otra app.

No es un agujero para un extraño —quien tiene el secreto son las propias apps de
ACACIA—; es un problema de **radio de daño**: el día que se filtre el secreto de
*una* app, se filtró el de las diez, y ese mismo valor es además el bearer que
aceptan varios `health` y el que autoriza `license.set` en `acaciaControl`.

**El arreglo ya está escrito, un archivo más allá.** `api/ingest/ticket-pull.js`
resuelve el mismo problema mejor y explica por qué: no lleva firma ninguna,
recibe sólo `{app, ticketId}` y va a **leer el registro auténtico de la app**
por el puente — «a forged body can't inject a ticket». O se deriva una llave por
app (`HMAC(maestro, slug)`), de modo que una firma sólo valga para la app que
dice ser, o `ticket.js` re-lee el registro como hace su vecino.

#### Hallazgo 2 — los cuatro crons estaban ABIERTOS en producción (medido, y arreglado aquí)

Los cuatro llevaban esta puerta, copiada en línea:

```js
if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
```

Con `CRON_SECRET` sin poner, el `secret &&` de delante salta la comprobación
entera. **Y no estaba puesto.** La primera versión de esta sección decía «no
pude comprobar si la variable está puesta» porque el proxy del sandbox no
alcanza el dominio; después probé por el MCP de Vercel, que sí llega. Un GET
anónimo, sin cabecera ninguna, a
`https://acacia-mission-control.vercel.app/api/cron/sync`:

```
200 OK
{"ok":true,"apps":34,"day":"2026-08-23","summary":[{"app":"puntos", … }]}
```

Corrió el sync completo **y devolvió en el cuerpo el estado operativo de todo
el portafolio**: las 34 apps, cuántos inquilinos y licencias tiene cada una,
cuántos tickets, cuántas sesiones, la latencia de cada health. Eso no es sólo un
disparador expuesto: es una fuga de datos a cualquiera que sepa la URL.

Y la misma puerta ausente estaba delante de `license-lifecycle`,
`renewal-reminders` y `usage-reminders` — los que transicionan `billing_status`
y **mandan correo a clientes reales**. Esos no los probé, por razones obvias; no
hace falta, el gate es el mismo y ya está demostrado que no cierra.

**Arreglado en este commit.** `api/_lib/requireCron.js` reemplaza las cuatro
copias en línea y **falla cerrado**: sin `CRON_SECRET` responde 503, nunca 200.
No acepta `x-vercel-cron` por sí solo —las cabeceras las controla quien llama—;
con la variable puesta, Vercel adjunta `Authorization: Bearer <CRON_SECRET>` a
sus invocaciones programadas por su cuenta, así que el planificador entra por la
misma puerta que todos.

**Hay que poner `CRON_SECRET` en Vercel ANTES de desplegar esto**, o los cuatro
crons responden 503 y dejan de correr en silencio. Es la dirección segura del
fallo, pero sigue siendo una caída — y es exactamente el error que flowfin
documenta en su CLAUDE.md, cometido en el sentido contrario.

La lección general, y es la misma que la de radar unas horas antes: **un
guardia condicional vale lo que valga su variable de entorno, y nadie estaba
verificando la variable.** `radar`, `rumbo` y `stockflow` ya fallaban cerrado en
la misma situación; esto los alcanza.

#### Una cosa anotada

`audit_delete_owner` permite a un `owner` borrar filas de `audit_actions`. Con
un solo operador es una decisión de diseño, no una fuga; pero una bitácora que
el rol más alto puede borrar conviene nombrarla, porque el día que haya un
segundo `admin` es justo la bitácora que lo audita.

#### Estado vivo y lo que no pude verificar

**1 `members`** (rol `owner`), 34 filas en `apps`, **20 `tenants`** y 5
`tickets`. Con un solo operador no hay forma de ejercer el modelo de roles: no
existe un `viewer` ni un `admin` contra el que comprobar que la RLS los frena de
verdad. Eso es lo único que queda fuera de esta pasada.

El hallazgo 2 **sí** se verificó contra producción, y merece la pena decir cómo,
porque el método sirve para la próxima: el proxy de este sandbox no alcanza el
dominio, así que el primer intento devolvió `000` y lo di por no verificable.
El MCP de Vercel sí llega. **Que una vía esté bloqueada no significa que la
pregunta no tenga respuesta** — vale la pena buscar la segunda vía antes de
escribir "no verificado", que es justo lo que este módulo existe para no
hacer a la ligera.

## Módulo 15 — el puente: una llave derivada por app (2026-08-23)

Cierra el hallazgo 1 del módulo 14 de arriba. `INGEST_HMAC_SECRET` es un solo
valor compartido por las diez apps, así que una firma hecha con él demuestra
«alguien tiene el secreto compartido» y nunca «esto es la app X» — y como el
`app` viaja en el cuerpo, cualquier app podía firmar un ticket atribuido a otra.

`api/_lib/ingestSign.js` gana la derivación, y es la mitad Node de
`shared/bridge/acaciaSign.ts` en `jospabloh/acacia-app-standard` (la mitad Deno
que llevan las nueve apps):

    appKey = HMAC-SHA256(maestro, "acacia.app.v1." + slug)

`deriveAppKey` / `signFor` / `verifyFrom` / `bearerFor`, más
`ACCEPT_LEGACY_MASTER`. `api/ingest/ticket.js` ya verifica con la llave de la
app que dice ser, así que un cuerpo firmado por otra no entra.
`api/_lib/ingestSign.test.js` fija el mismo vector que la prueba Deno
(`acaciaSign.test.ts`): dos implementaciones de HMAC en dos runtimes sólo siguen
siendo iguales si algo lo afirma, y una divergencia se ve como `bad signature`
en cada llamada, que parece un secreto mal puesto y no lo es.

**`appBridge.js` sigue firmando de salida con el maestro, a propósito, y este es
el único punto donde el orden está forzado.** Mission Control despliega al
mergear; las nueve apps se despliegan a mano. Así que MC siempre llega primero:
si firmara derivada hoy, cada `acaciaControl` que todavía no se ha desplegado
respondería `bad signature` — licencias, tickets, uso y salud de todo el
portafolio caídos hasta el último deploy. Por eso verifica derivada ya y firma
derivada después.

**El paso 2 es el que cierra el agujero, y está hecho** (2026-08-24):

1. `ACACIA_APP_SLUG` puesto en flowfin, stockflow, cateqhub, ctrlhq y kitchops —
   y **corregido** en radar, rumbo, puntos y liuma, que lo traían de antes con
   un valor que no era el id de la app;
2. `appBridge.js` firma con `signFor({ master: secret, slug: app.id, … })`;
3. `ACCEPT_LEGACY_MASTER = false` en los 11 sitios, y el respaldo de
   `appBridge.js` borrado en el mismo commit.

El paso 3 se hizo dos veces: la primera sin leer el log, y costó dos horas de
puente caído en cuatro apps. La segunda contra una sincronización de las nueve
con cero advertencias. El detalle está abajo, porque la forma se repite.

### El paso 2, el 2026-08-24: salió mal, se revirtió, y se rehízo midiendo

Se hizo en dos mitades. La **2a** —`appBridge.js` firma derivada y, sólo si la
app rechaza la firma, reintenta con el maestro y **registra qué app fue**— es
correcta y fue la que salvó el día. La **2b** —apagar el flag y borrar ese
respaldo— se hizo primero sobre una afirmación falsa, hubo que revertirla, y se
rehízo unas horas después con la medición delante.

La afirmación era «las nueve verificaron derivada al primer intento; el respaldo
no se disparó ni una vez». El log de la sincronización que supuestamente la
respaldaba decía esto:

```
13:38 UTC, dpl_EbLRHFmiUGCG92exxgBEQDqL4HWR
callBridge: app=radar  rejected the derived key and accepted the master…
callBridge: app=rumbo  rejected the derived key and accepted the master…
callBridge: app=puntos rejected the derived key and accepted the master…
callBridge: app=liuma  rejected the derived key and accepted the master…
```

Cuatro de nueve. **El corte es informativo**: las cinco que verificaron derivada
son las cinco a las que se les puso `ACACIA_APP_SLUG` ese día (cateqhub, ctrlhq,
flowfin, kitchops, stockflow); las cuatro que fallan son las que ya lo traían de
cuando se cableó el push de tickets. Con el respaldo borrado y desplegado a las
13:55, esas cuatro se quedaron sin puente veinte minutos.

**La condición para volver a intentarlo era una medición, no una fecha, y se
cumplió el mismo día.** A las 16:29 UTC, con `ACACIA_APP_SLUG` corregido en las
cuatro y las nueve apps redesplegadas, una sincronización completa dejó nueve
filas en `audit_actions` y **cero** advertencias `rejected the derived key` en
el log de esa ventana. Con eso el 2b se rehizo: `ACCEPT_LEGACY_MASTER = false`
y el respaldo de `appBridge.js` borrado, en el mismo commit.

**De las dos causas posibles, era el secreto.** La CLI reportó `acaciaControl
unchanged` en las cuatro, o sea que el código desplegado ya traía
`_acaciaSign.ts` desde el deploy de la mañana — antes de la sincronización que
falló. No era un `acaciaControl` viejo: era el valor, que cuatro `CLAUDE.md`
afirmaban correcto y nadie había abierto el panel a leer. De ahí el módulo 16
del estándar.

Lo que hay que quedarse, porque la forma se repite: **un respaldo que nombra
culpables no vale nada si nadie lee lo que nombró.** El paso 2a existe
justamente para convertir una caída en una línea de log; saltarse la línea la
vuelve a convertir en caída. Y ojo con el razonamiento al revés: unas horas
antes, tres apps con la latencia del puente doblada parecían el respaldo
disparándose y resultaron ser arranques en frío. Descartar una falsa alarma
correctamente no es evidencia sobre una señal distinta — y aun así se usó como
si lo fuera.

**Y una consecuencia que casi se cuela:** `api/track.js` usaba
`INGEST_HMAC_SECRET` como sal de respaldo para hashear IPs de visitantes, así
que rotar el secreto del puente habría recontado en silencio cada visitante
único. Ahora usa `TRACK_SALT`. Un secreto de autenticación autentica; cualquier
otra cosa que necesite una cadena aleatoria estable se trae la suya.

## Licencias: de quién es y correo de seguimiento por renglón; el aviso de alta guarda su resultado (2026-09-30)

- **Dueño visible.** El renglón de `Licenses.jsx` muestra `ownerOf(r)` junto a la app
  (`raw.owner_email` → `contact_email` → `admin_email` → `created_by`, el primero que
  exista) y la búsqueda lo incluye. Cada app guarda al dueño en un campo distinto; si una
  app nueva usa otro, se añade ahí. StockFlow sólo trae `created_by`.
- **"Enviar correo de seguimiento…"** (menú del renglón): renovación, aviso informativo o
  invitación a activar el plan. Lee los administradores **de esa licencia** con
  `listContacts` (contactos cuyo `id` es el `external_id` de la licencia) y envía con el
  `send-message` de siempre. La acción se muestra para todas las apps: una sin
  `messagingFor` responde 400 y el toast lo explica (no hay copia cliente del catálogo de
  mensajería, a propósito, para no crear otro espejo que se desincronice).
- **`alerts.detail.email` registra qué pasó con el correo del aviso de alta**
  (`{sent, failed, bridge}`). Antes la fila sólo probaba que MC *intentó* avisar.

**Lo que ese registro sacó a la luz de inmediato:**
- **ArtisKids no implementaba `emails.sendFollowup`**, y MC lo llama para el aviso de alta
  de *cualquier* app: tres altas (2026-10-02/03) fallaron con `unknown action` y nunca
  llegaron al dueño. Se implementó en su `acaciaControl` (jospabloh/artiskids). Una app
  nueva debe tener esa acción antes de registrarse (Módulo 17).
- **Límite por hora de `Core.SendEmail` por destinatario:** una alta de StockFlow
  (2026-09-30) mandó a `h.josepablo@gmail.com` pero a `soporte@acaciaco.com.mx` respondió
  "hit their hourly limit". Con varias altas seguidas, el segundo destinatario se pierde.
  Sin arreglar: el registro lo hace visible, no lo evita.

**Cómo se supo que el aviso de alta ya funcionaba:** en `alerts`, las altas de StockFlow
del 30-sep y 1-oct aparecen con `via: ping` y el correo enviado; la de Cesar (29-sep)
llegó con `via: sync` y sin registro de correo — el ping se había perdido.

## Testimonios: la app los guarda, MC los revisa, la web publica los aprobados (2026-10-07)

Contrato: **Módulo 29 de `jospabloh/acacia-app-standard`** (v1.3). Si el código y el módulo difieren, se
corrigen los dos en el mismo cambio.

- **Tabla `testimonials`** (migración `0048`): `status` propio de MC (`pending | approved | rejected |
  withdrawn`), único `(app_id, external_id)`, `notified_at`, CHECKs de longitud (solo se relajan en una fila
  `withdrawn`, cuyo texto está borrado), RLS viewer lee / admin escribe.
- **Formas EXACTAS del puente** (cada app): `testimonials.get {id}` → `{ok:true, record, tenant_name}` o
  `{ok:true, record:null}`; `testimonials.list {}` → `{ok:true, records:[{…, tenant_name}]}`, SIEMPRE la lista
  completa (incluye `withdrawn`). El id de tenant llega solo como `tenant_id`. Acción no implementada:
  `unknown action: <acción>`. Una respuesta sin `ok:true` o sin `records` array es un error y NO borra nada.
- **Ping** `POST /api/ingest/testimonial-pull {app, testimonialId}` (sin secreto): responde `{ok:true}` 200
  a toda petición bien formada, pase lo que pase (el resultado solo va al log); 400 solo por forma inválida.
  **Respaldo**: el sync diario llama `testimonials.list` (`sync/syncTestimonials.js`). `unknown action` se
  omite en silencio; cualquier otro fallo es un `error` de esa sección (no aborta el resto del sync).
- **Validación fail-closed** (`normalizeRecord`, `api/_lib/testimonials.js`): publicable solo con
  `status === 'submitted'`, `consent_publish === true`, `updated_date` (versión de origen, ISO estricto) y `consent_at` ISO-8601 estricto con día de calendario real (`2026-02-30` se rechaza), `rating` number entero
  1–5, `body` 20–600, `author_name` 1–80, `author_role` ≤ 80. Todo lo demás cuenta como retirado.
- **Retirar BORRA el dato personal.** Retirado, inválido, sin consentimiento, `record:null` en el ping, o
  fila ausente de una `list` que respondió bien → `withdrawn` con `body = ''`, `author_name = ''`,
  `author_role = null`, `consent_publish = false` y, si el registro la trae, `source_updated_at` (`withdrawnPatch()`). Las apps
  también vacían esos campos al retirar, así que un registro `withdrawn` con texto vacío es normal. **Versión de origen:** cada registro del
  puente trae `updated_date`, que MC guarda como `source_updated_at`; todo registro (publicable o retirado) con
  versión anterior o igual a la guardada se ignora, así que una lista vieja o un ping retrasado no pisan una
  escritura más nueva (esto subsume la regla `withdrawn_at`). Un `submitted` sin versión válida no es
  publicable. La ausencia (`record:null` / falta en la lista) solo borra filas cuyo `source_updated_at` no es
  posterior al inicio de esa lectura. Todos los UPDATE son compare-and-swap sobre `updated_at` (trigger) y
  reintentan una vez; un 23505 en el insert es la misma carrera. Se conservan `rating`, tenant y fechas.
- **Upsert**: nuevo → `pending` (avisa); `pending` + cambio → `pending` (sin aviso); `approved`/`rejected`
  + cambio → `pending` (avisa); `withdrawn` + reenvío con versión posterior → `pending` (avisa); sin cambios → nada.
- **Aviso** (`alerts.kind = 'testimonial'` + correo a `SUPPORT_ALERT_EMAILS`, enviado por el puente de la
  propia app como los tickets): máximo uno por hora por testimonio. `notified_at` se reclama con un solo
  UPDATE condicional, así que un ping y el sync a la vez no lo duplican.
- **Revisión**: `POST /api/control/testimonial-review {id, op, updatedAt}` (`approve | reject | unpublish`,
  admin+, por `audit()`). `updatedAt` es el de la fila que el revisor vio; si cambió → 409 y la página
  recarga. El UPDATE además va guardado por `status` y `updated_at`. `withdrawn` no se revisa.
- **Público**: `GET /api/testimonials[?app=<slug del sitio>]`. Solo `approved` con consentimiento, por la
  lista blanca `publicItem()`; `puntos` sale como `puntos-plus`. `month` = mes de la aprobación en
  America/Mexico_City. Consulta paginada (todas las aprobadas, filtro `app` y orden en BD). `Cache-Control: public, max-age=0, s-maxage=60`, sin `stale-while-revalidate`: es el plazo en que un retiro deja de servirse.
- **Funciones en `api/`: 11 de 12** (`functionBudget.test.js` lo vigila).

**No verificado** (sin Supabase ni puente en el sandbox): la migración contra la base viva; los
`insert/update/select` reales y el reclamo atómico de `notified_at` (solo la lógica pura está probada); la
comparación `updated_at` entre lo que devuelve PostgREST y lo que reenvía el navegador (se compara por
instante, pero el `.eq('updated_at', …)` del UPDATE usa el texto tal cual lo leyó el servidor); el envío del
correo; que ninguna app implementa aún `testimonials.get/list`; el endpoint público con datos reales; la
página en navegador (solo `build` y `lint`).

**Pasos manuales del dueño**: aplicar `0048_testimonials.sql`. No hay variable de entorno nueva
(`SUPPORT_ALERT_EMAILS`, `MC_PUBLIC_URL` e `INGEST_HMAC_SECRET` ya existen). Hasta que una app implemente
el módulo, el sync responde `skipped` y la página queda vacía. Cada app sin el módulo deja una línea
`callBridge failed … unknown action` en el log del sync diario; es esperada.
