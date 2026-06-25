-- ============================================================================
-- Fix the 5 SaaS app URLs. They were seeded against a wrong domain
-- (*.acacia.co). The real portfolio lives under acaciaco.com.mx, and each SaaS
-- app is its own subdomain (puntos.acaciaco.com.mx, …). Freeware + sites already
-- point at acaciaco.com.mx (migration 0005) and are left untouched.
-- These URLs are only a secondary "abrir ↗" affordance now — the cards lead to
-- the in-panel control + analytics view, not the live app.
-- ============================================================================
update public.apps set url = 'https://puntosplus.acaciaco.com.mx' where id = 'puntos';
update public.apps set url = 'https://rumbo.acaciaco.com.mx'      where id = 'rumbo';
update public.apps set url = 'https://liuma.acaciaco.com.mx'      where id = 'liuma';
update public.apps set url = 'https://flowfin.acaciaco.com.mx'    where id = 'flowfin';
update public.apps set url = 'https://stockflow.acaciaco.com.mx'  where id = 'stockflow';
