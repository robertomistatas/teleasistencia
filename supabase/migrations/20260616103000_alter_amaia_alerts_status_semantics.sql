-- AMAIA-SYNC
-- Migration 018
-- Resolve the Codex pendiente on amaia_alerts status semantics.
--
-- Inspection of the original migration (20260615123000) found
-- alert_status_id/alert_status with no comment, no constraint, and no
-- empirical confirmation that they were ever wired to AMAIA alerta.estado.
-- 9.1D (V-003) validated alerta.estado directly (integer 0-5, exhaustive
-- distribution: 23599+14519+14374+4325+1004+210 = 58031 = total) but
-- never validated the Supabase destination columns specifically.
--
-- Resolution: alert_status_id is reused as the official business_status
-- field for alerts — no new business_status_id column is created. A
-- range check locks the semantics to the empirically confirmed domain.
-- alert_status (text label) remains optional/nullable: no confirmed
-- label catalog exists in AMAIA, so it may stay unpopulated in V1
-- without that being treated as an error.

alter table public.amaia_alerts
  add constraint amaia_alerts_alert_status_id_check
  check (alert_status_id is null or alert_status_id between 0 and 5);

alter table public.amaia_alerts
  add column if not exists sync_status text not null default 'active';

alter table public.amaia_alerts
  add constraint amaia_alerts_sync_status_check
  check (sync_status in ('active', 'missing_pending_confirmation', 'inactive_confirmed'));

create index if not exists idx_amaia_alerts_sync_status
  on public.amaia_alerts (sync_status);

comment on column public.amaia_alerts.alert_status_id
  is 'Official business_status field for alerts, mirroring AMAIA alerta.estado verbatim (integer 0-5, confirmed exhaustive in 9.1D V-003). This is the field the engine reads to know AMAIA''s own alert state — never used to derive sync_status.';

comment on column public.amaia_alerts.alert_status
  is 'Optional human-readable label. No confirmed label catalog exists in AMAIA for alerta.estado — this column may remain null in V1 without that being treated as a data-quality error.';

comment on column public.amaia_alerts.sync_status
  is 'Internal engine state, written exclusively by the full-reconciliation tombstone process (see amaia_sync_tombstone_events). Independent from alert_status_id.';
