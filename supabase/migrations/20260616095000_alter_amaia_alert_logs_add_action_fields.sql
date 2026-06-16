-- AMAIA-SYNC
-- Migration 014
-- Extend amaia_alert_logs with raw_action (canonical source), a derived
-- action_type, and a derived actor_name. Empirically confirmed (9.1D
-- V-003): logestado.accion only ever takes the form "Atendido por <actor>"
-- or "Modificado por <actor>", covering 100% of the observed volume
-- (25455 + 21690 = 47145). action_type='unknown' exists to absorb any
-- future value outside that pattern without losing the row.

alter table public.amaia_alert_logs
  add column if not exists raw_action text,
  add column if not exists action_type text not null default 'unknown',
  add column if not exists actor_name text;

alter table public.amaia_alert_logs
  add constraint amaia_alert_logs_action_type_check
  check (action_type in ('attended', 'modified', 'unknown'));

create index if not exists idx_amaia_alert_logs_action_type
  on public.amaia_alert_logs (action_type);

comment on column public.amaia_alert_logs.raw_action
  is 'Canonical source value: logestado.accion as received from AMAIA, unmodified. action_type/actor_name are derived from this field and can always be re-derived from it if the parsing rule changes.';

comment on column public.amaia_alert_logs.action_type
  is 'Derived from raw_action by pattern match. attended = "Atendido por <actor>". modified = "Modificado por <actor>". unknown = any value not matching either pattern (covers future values not seen during 9.1D validation).';

comment on column public.amaia_alert_logs.actor_name
  is 'Extracted from raw_action when action_type is attended or modified. Null when action_type=unknown (no reliable pattern to extract from).';
