-- AMAIA-SYNC Phase 9.3C v6.3 — 02 existing schema patch
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- ============================================================
-- 2. COLUMN ADDITIONS
-- ============================================================
alter table public.amaia_sync_cycles add column if not exists scheduler_owner_identity text not null default '__init__', add column if not exists scheduler_lease_token bigint not null default 0;
alter table public.amaia_sync_cycles alter column scheduler_owner_identity drop default;

alter table public.amaia_sync_run_manifests
  add column if not exists identity_basis text not null default 'source_amaia_id',
  add column if not exists identity_version text not null default 'source_id_v1',
  add column if not exists canonicalization_version text,
  add column if not exists hash_algorithm text not null default 'sha256_pipe_delimited_sorted',
  add column if not exists serialization_version text not null default 'integer_decimal_v1',
  add column if not exists abandoned_by text, add column if not exists abandoned_at timestamptz,
  add column if not exists abandoned_reason text,
  add column if not exists provisional_verified boolean, add column if not exists provisional_skipped boolean;
alter table public.amaia_sync_run_manifests alter column identity_basis drop default;
alter table public.amaia_sync_run_manifests alter column identity_version drop default;
alter table public.amaia_sync_run_manifests alter column hash_algorithm drop default;
alter table public.amaia_sync_run_manifests alter column serialization_version drop default;
alter table public.amaia_sync_run_manifests alter column source_id_count drop not null;
alter table public.amaia_sync_run_manifests alter column source_id_hash drop not null;
alter table public.amaia_sync_run_manifests drop constraint if exists amaia_sync_run_manifests_source_id_count_check;
alter table public.amaia_sync_run_manifests drop constraint if exists manifest_source_id_count_ck;
alter table public.amaia_sync_run_manifests add constraint manifest_source_id_count_ck check (source_id_count is null or source_id_count>=0);
alter table public.amaia_sync_run_manifests drop constraint if exists manifest_identity_basis_ck;
alter table public.amaia_sync_run_manifests add constraint manifest_identity_basis_ck check (identity_basis in ('source_amaia_id','canonical_dedup_key'));
alter table public.amaia_sync_run_manifests drop constraint if exists manifest_abandoned_reason_ck;
alter table public.amaia_sync_run_manifests add constraint manifest_abandoned_reason_ck check (abandoned_reason is null or length(abandoned_reason)>0);
alter table public.amaia_sync_run_manifests drop constraint if exists manifest_prov_mutex_ck;
alter table public.amaia_sync_run_manifests add constraint manifest_prov_mutex_ck check (not(provisional_verified is not null and provisional_skipped is not null and provisional_skipped=true));
alter table public.amaia_sync_run_manifests drop constraint if exists amaia_sync_run_manifests_phase_check;
alter table public.amaia_sync_run_manifests add constraint amaia_sync_run_manifests_phase_check check (phase in ('created','source_fetched','confirmed_compared','provisional_persisted','comparison_complete','abandoned'));
alter table public.amaia_sync_run_manifests alter column phase set default 'created';

alter table public.amaia_sync_manifest_exclusion_subjects add column if not exists excluded_canonical_key text;
alter table public.amaia_sync_manifest_exclusion_subjects alter column excluded_amaia_id drop not null;
alter table public.amaia_sync_manifest_exclusion_subjects drop constraint if exists subj_one_id_ck;
alter table public.amaia_sync_manifest_exclusion_subjects add constraint subj_one_id_ck check ((excluded_amaia_id is not null and excluded_canonical_key is null) or (excluded_amaia_id is null and excluded_canonical_key is not null));
alter table public.amaia_sync_manifest_exclusion_subjects drop constraint if exists subj_ckey_rx;
alter table public.amaia_sync_manifest_exclusion_subjects add constraint subj_ckey_rx check (excluded_canonical_key is null or excluded_canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$');

alter table public.amaia_sync_manifest_exclusion_investigations add column if not exists excluded_canonical_key text;
alter table public.amaia_sync_manifest_exclusion_investigations alter column excluded_amaia_id drop not null;
alter table public.amaia_sync_manifest_exclusion_investigations drop constraint if exists inv_ckey_rx;
alter table public.amaia_sync_manifest_exclusion_investigations add constraint inv_ckey_rx check (excluded_canonical_key is null or excluded_canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$');

alter table public.amaia_sync_tombstone_events add column if not exists canonical_key text;
alter table public.amaia_sync_tombstone_events alter column source_amaia_id drop not null;
alter table public.amaia_sync_tombstone_events drop constraint if exists tomb_one_id_ck;
alter table public.amaia_sync_tombstone_events add constraint tomb_one_id_ck check ((source_amaia_id is not null and canonical_key is null) or (source_amaia_id is null and canonical_key is not null));
alter table public.amaia_sync_tombstone_events drop constraint if exists tomb_ckey_rx;
alter table public.amaia_sync_tombstone_events add constraint tomb_ckey_rx check (canonical_key is null or canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$');

alter table public.amaia_sync_reconciliation_results add column if not exists identity_basis text not null default 'source_amaia_id' check (identity_basis in ('source_amaia_id','canonical_dedup_key'));
alter table public.amaia_sync_reconciliation_results alter column identity_basis drop default;

create unique index if not exists idx_excl_subj_ckey on public.amaia_sync_manifest_exclusion_subjects (domain_name,excluded_canonical_key) where excluded_canonical_key is not null;
create index if not exists idx_tomb_ckey on public.amaia_sync_tombstone_events (domain_name,canonical_key) where canonical_key is not null;
create unique index if not exists idx_runs_domain_running on public.amaia_sync_runs (domain_name) where status='running';
