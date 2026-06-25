-- ============================================================================
-- Field maps for sync-licenses: how each app's license-entity fields map to the
-- normalized bodega columns. Names verified against each repo's
-- base44/entities/*.jsonc. Merged into the existing apps.config (jsonb || jsonb).
-- ============================================================================
update public.apps set config = config || '{"field_map":{
  "tenant_external_id":"id","name":"name","plan":"license_plan","status":"billing_status",
  "seats":"licensed_user_limit","trial_ends_at":"trial_end_at","current_period_end":"license_expires_at"
}}'::jsonb where id = 'puntos';

update public.apps set config = config || '{"field_map":{
  "tenant_external_id":"id","name":"tenant_name","plan":"plan","status":"status",
  "seats":"max_drivers","trial_ends_at":"trial_ends_at","current_period_end":"current_period_end"
}}'::jsonb where id = 'rumbo';

update public.apps set config = config || '{"field_map":{
  "tenant_external_id":"school_id","name":"school_id","plan":"subscription_plan","status":"subscription_status",
  "seats":"licensed_student_limit","trial_ends_at":"trial_end_date","current_period_end":"subscription_end_date"
}}'::jsonb where id = 'liuma';

update public.apps set config = config || '{"field_map":{
  "tenant_external_id":"id","name":"name","plan":"license_plan","status":"billing_status",
  "seats":"licensed_member_limit","trial_ends_at":"trial_end_at","current_period_end":"license_expires_at"
}}'::jsonb where id = 'flowfin';

update public.apps set config = config || '{"field_map":{
  "tenant_external_id":"id","name":"name","plan":"license_plan","status":"billing_status",
  "seats":"licensed_user_limit","trial_ends_at":"trial_end_at","current_period_end":"license_expires_at"
}}'::jsonb where id = 'stockflow';
