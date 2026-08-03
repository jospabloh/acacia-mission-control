-- ============================================================================
-- Un único reporte de pago PENDIENTE por tenant (app_id, external_id).
--
-- payment-report.js insertaba un payment_reports sin ninguna restricción: un
-- admin podía registrar 2+ reportes pendientes para el mismo tenant. El fix
-- atómico de payment-confirm.js (claim con `confirmed_at IS NULL`) solo evita
-- confirmar la MISMA fila dos veces — no evita confirmar 3 filas duplicadas
-- para un mismo tenant, cada una disparando su propio confirm_payment real
-- (renovación de licencia apilada por error de captura, no por un ataque).
--
-- Postgres no soporta `unique (...) where ...` como constraint directo; el
-- equivalente soportado es un índice único parcial (sí soportado).
create unique index payment_reports_one_pending
  on public.payment_reports (app_id, external_id)
  where confirmed_at is null;

-- El índice no-único `payment_reports_pending` (0030) cubría la misma
-- condición solo para acelerar lecturas; el índice único de arriba ya lo hace
-- (todo índice único también sirve como índice de lectura), así que mantener
-- ambos sería redundante — se elimina el viejo.
drop index if exists public.payment_reports_pending;
-- ============================================================================
