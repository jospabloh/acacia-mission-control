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
