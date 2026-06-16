-- AMAIA-SYNC
-- Migration 016
-- Extend amaia_beneficiaries with business_status_id (mirrors
-- beneficiario.id_estado from AMAIA) and sync_status (internal engine
-- state). These two fields are deliberately independent: 9.1D (V-008)
-- found beneficiaries with id_estado=0 still receiving real
-- modifications up to the day before validation — id_estado is a
-- business attribute, never a signal the sync engine derives sync_status
-- from.

alter table public.amaia_beneficiaries
  add column if not exists business_status_id integer,
  add column if not exists sync_status text not null default 'active';

alter table public.amaia_beneficiaries
  add constraint amaia_beneficiaries_business_status_id_check
  check (business_status_id is null or business_status_id in (0, 1));

alter table public.amaia_beneficiaries
  add constraint amaia_beneficiaries_sync_status_check
  check (sync_status in ('active', 'missing_pending_confirmation', 'inactive_confirmed'));

create index if not exists idx_amaia_beneficiaries_sync_status
  on public.amaia_beneficiaries (sync_status);

comment on column public.amaia_beneficiaries.business_status_id
  is 'Mirrors AMAIA beneficiario.id_estado verbatim (0 or 1, confirmed exhaustive in 9.1D V-008: 897 + 1340 = 2237 = total). A business attribute synced as-is — never interpreted by the engine as an activity/deactivation signal.';

comment on column public.amaia_beneficiaries.sync_status
  is 'Internal engine state, written exclusively by the full-reconciliation tombstone process (see amaia_sync_tombstone_events). Never derived from business_status_id or any other AMAIA business field — the two are intentionally orthogonal (9.1D V-008).';
