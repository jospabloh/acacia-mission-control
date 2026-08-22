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
