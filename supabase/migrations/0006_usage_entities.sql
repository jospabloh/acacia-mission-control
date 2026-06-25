-- ============================================================================
-- Per-app "usage entities": which Base44 entities the sync-usage cron counts as
-- product-usage signals (via acaciaControl → usage.summary). Names verified
-- against each repo's base44/entities/*.jsonc.
-- ============================================================================
update public.apps set config = config || '{"usage_entities":["LoyaltyAccount","Redemption","Store"]}'::jsonb where id = 'puntos';
update public.apps set config = config || '{"usage_entities":["Driver","Vehicle","Trip"]}'::jsonb            where id = 'rumbo';
update public.apps set config = config || '{"usage_entities":["Student","Attendance","PaymentRecord"]}'::jsonb where id = 'liuma';
update public.apps set config = config || '{"usage_entities":["Transaction","Person","Goal"]}'::jsonb         where id = 'flowfin';
update public.apps set config = config || '{"usage_entities":["Product","Movement","Client"]}'::jsonb         where id = 'stockflow';
