-- ============================================================================
-- Fix LIUMA license field map.
--
-- LIUMA's authoritative license fields are `license_tier` (plan) and
-- `license_expires_at` (expiry) — verified against
-- liuma/src/lib/license/licenseModel.js (normalizeSubscription reads
-- license_tier + license_expires_at; buildPaymentConfirmationUpdate writes them).
--
-- The original 0004 map pointed `plan` at `subscription_plan` (which stays
-- 'trial' after activation) and `current_period_end` at `subscription_end_date`
-- (never written by the app). So Mission Control showed a blank/stale plan and
-- expiry for LIUMA, and a payment confirmation / plan change written to the real
-- fields did not show up after the next license resync. Correct both keys; the
-- rest of the map is unchanged.
-- ============================================================================
update public.apps set config = config || '{"field_map":{
  "tenant_external_id":"school_id","name":"school_id","plan":"license_tier","status":"subscription_status",
  "seats":"licensed_student_limit","trial_ends_at":"trial_end_date","current_period_end":"license_expires_at"
}}'::jsonb where id = 'liuma';
