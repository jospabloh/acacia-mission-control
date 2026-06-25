# ACACIA Mission Control

Central panel that aggregates and operates the entire ACACIA SaaS portfolio
(Puntos+, Rumbo, LIUMA, FlowFin, StockFlow, plink_fx, …).

- **Stack**: React + Vite (Vercel) · Supabase (Auth + central warehouse) ·
  serverless `api/` for crons / webhooks / write-control.
- **Payments**: Mercado Pago (no Stripe).
- **Roles**: `owner | admin | viewer` via Supabase Auth + the `members` table.

## Quick start

```bash
npm install
cp .env.example .env        # fill in Supabase + secrets
npm run dev                 # http://localhost:5173
npm run build && npm run lint
```

## Supabase setup

1. Create a Supabase project.
2. Apply migrations in order: `supabase/migrations/0001_init.sql`, then
   `0002_seed_apps.sql`.
3. Insert yourself as `owner`:

   ```sql
   insert into public.members (user_id, email, role)
   values ('<your-auth-user-uuid>', 'you@acacia.co', 'owner');
   ```

## Onboarding a Base44 app

```bash
npm run onboard:base44 -- ../puntos --app-id 696e7fdd7889892fe40868b7 \
  --slug puntos --url https://puntos.acacia.co --dry
```

Drop `--dry` (with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set) to upsert
the registry row.

## Layout

See [`CLAUDE.md`](./CLAUDE.md) for architecture, the RLS model, and conventions.
Phase roadmap: Fase 0 (this scaffold) → Licencias/Ingresos/CRM → Analítica →
Soporte → Comunicados → Salud/Costos/Alertas → Control de escritura → Cutover →
Zona de Peligro & Delegación.
