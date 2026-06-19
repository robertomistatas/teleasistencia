-- AMAIA-SYNC Phase 9.3B — Runtime DDL Migration
-- Source: DDL Blueprint v1.0.4, Schema Blueprint v1.0.4, Runtime Architecture v1.2.9
-- All approved by Codex. Tag: amaia-sync-design-freeze (4b010ad)
--
-- Constraint ordering per blueprint:
--   Step 1: Tables without circular FKs
--   Step 2: Simple FKs (inline)
--   Step 3: Composite UK prerequisites (inline)
--   Step 4: Circular composite FK via ALTER
--   Step 5: Trigger functions + triggers
--   Step 6: Deployed table modifications
--   Step 7: Seeds + data corrections
--   Step 8: RLS + policies

-- ============================================================
-- PREFLIGHT: Verify deployed tables are empty before adding NOT NULL columns
-- ============================================================
do $$
declare
  v_runs_count bigint;
  v_recon_count bigint;
begin
  select count(*) into v_runs_count from public.amaia_sync_runs;
  if v_runs_count > 0 then
    raise exception 'PREFLIGHT ABORT: amaia_sync_runs has % rows. Cannot add NOT NULL columns without backfill.', v_runs_count;
  end if;
  select count(*) into v_recon_count from public.amaia_sync_reconciliation_results;
  if v_recon_count > 0 then
    raise exception 'PREFLIGHT ABORT: amaia_sync_reconciliation_results has % rows. Cannot add NOT NULL columns without backfill.', v_recon_count;
  end if;
end $$;

-- ============================================================
-- STEP 1: Tables (dependency order, no circular FKs yet)
-- ============================================================

-- Table 1: amaia_sync_cycles
create table if not exists public.amaia_sync_cycles (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'completed_with_failures')),
  trigger_type text not null
    check (trigger_type in ('scheduled', 'manual', 'recovery')),
  owner_identity text not null,
  reconciliation_snapshot jsonb
);

create index if not exists idx_amaia_sync_cycles_started_at
  on public.amaia_sync_cycles (started_at);
create index if not exists idx_amaia_sync_cycles_status
  on public.amaia_sync_cycles (status);

-- Table 2: amaia_sync_reconciliation_segments
create table if not exists public.amaia_sync_reconciliation_segments (
  id uuid primary key default gen_random_uuid(),
  domain_name text not null,
  tier text not null
    check (tier in ('tier4')),
  segment_id integer not null
    check (segment_id >= 0 and segment_id < 12),
  partition_expr text not null,
  last_successful_coverage_at timestamptz,
  last_attempt_at timestamptz,
  consecutive_failure_count integer not null default 0
    check (consecutive_failure_count >= 0),
  slo_deadline_at timestamptz,
  slo_status text not null default 'compliant'
    check (slo_status in ('compliant', 'at_risk', 'breached')),
  is_irrecoverable boolean not null default false,
  is_starving boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_name, tier, segment_id)
);

create index if not exists idx_amaia_sync_recon_segments_slo_deadline
  on public.amaia_sync_reconciliation_segments (slo_deadline_at);
create index if not exists idx_amaia_sync_recon_segments_domain_tier_coverage
  on public.amaia_sync_reconciliation_segments (domain_name, tier, last_successful_coverage_at);

-- Table 3: amaia_sync_manifest_exclusion_subjects (WITHOUT circular FK — added in Step 4)
create table if not exists public.amaia_sync_manifest_exclusion_subjects (
  id uuid primary key default gen_random_uuid(),
  domain_name text not null,
  excluded_amaia_id integer not null,
  current_investigation_id uuid,
  current_investigation_seq integer not null default 0
    check (current_investigation_seq >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_name, excluded_amaia_id)
);

-- Table 4: amaia_sync_run_manifests
create table if not exists public.amaia_sync_run_manifests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.amaia_sync_runs(id) on delete cascade,
  domain_name text not null,
  source_id_count integer not null
    check (source_id_count >= 0),
  source_id_hash text not null,
  persisted_id_count integer
    check (persisted_id_count is null or persisted_id_count >= 0),
  persisted_id_hash text,
  sets_match boolean,
  missing_ids jsonb,
  extra_ids jsonb,
  phase text not null default 'source_fetched'
    check (phase in ('source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned')),
  verified_at timestamptz,
  raw_max_id bigint,
  provisional_upper_bound bigint,
  provisional_id_count integer,
  provisional_id_hash text,
  created_at timestamptz not null default now(),
  unique (run_id),
  unique (id, run_id)
);

create index if not exists idx_amaia_sync_run_manifests_domain_phase
  on public.amaia_sync_run_manifests (domain_name, phase);

-- Table 5: amaia_sync_workset_exceptions
create table if not exists public.amaia_sync_workset_exceptions (
  id uuid primary key default gen_random_uuid(),
  domain_name text not null,
  source_amaia_id integer not null,
  referenced_amaia_id integer,
  source_row_hash text not null,
  hash_version text not null,
  invalidity_type text not null
    check (invalidity_type in ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other')),
  amaia_lookup_evidence text not null,
  amaia_lookup_at timestamptz not null,
  detection_run_id uuid references public.amaia_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (domain_name, source_amaia_id, source_row_hash, hash_version)
);

-- Table 6: amaia_sync_manifest_exclusion_investigations
create table if not exists public.amaia_sync_manifest_exclusion_investigations (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.amaia_sync_manifest_exclusion_subjects(id) on delete cascade,
  investigation_seq integer not null
    check (investigation_seq > 0),
  investigation_hash text not null,
  domain_name text not null,
  excluded_amaia_id integer not null,
  detection_run_id uuid references public.amaia_sync_runs(id) on delete set null,
  detection_manifest_id uuid references public.amaia_sync_run_manifests(id) on delete set null,
  amaia_lookup_evidence text not null,
  amaia_lookup_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (subject_id, investigation_seq),
  unique (subject_id, investigation_hash),
  unique (id, subject_id)
);

-- Table 7: amaia_sync_workset_exception_decisions
create table if not exists public.amaia_sync_workset_exception_decisions (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.amaia_sync_workset_exceptions(id) on delete cascade,
  decision_seq integer not null default 0
    check (decision_seq > 0),
  decision text not null
    check (decision in ('approved', 'rejected')),
  decided_by text not null,
  decided_at timestamptz not null default now(),
  comment text not null
    check (length(comment) > 0),
  created_at timestamptz not null default now(),
  unique (exception_id, decision_seq),
  unique (id, exception_id)
);

-- Table 8: amaia_sync_manifest_exclusion_decisions
create table if not exists public.amaia_sync_manifest_exclusion_decisions (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.amaia_sync_manifest_exclusion_investigations(id) on delete cascade,
  decision_seq integer not null default 0
    check (decision_seq > 0),
  decision text not null
    check (decision in ('approved', 'rejected')),
  decided_by text not null,
  decided_at timestamptz not null default now(),
  reason text not null
    check (length(reason) > 0),
  evidence jsonb,
  created_at timestamptz not null default now(),
  unique (investigation_id, decision_seq),
  unique (id, investigation_id)
);

-- Table 9: amaia_sync_workset_exception_consumptions
create table if not exists public.amaia_sync_workset_exception_consumptions (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.amaia_sync_workset_exceptions(id) on delete cascade,
  decision_id uuid not null,
  consumed_by_run_id uuid not null references public.amaia_sync_runs(id) on delete restrict,
  source_row_hash_at_consumption text not null,
  consumed_at timestamptz not null default now(),
  unique (exception_id, consumed_by_run_id),
  foreign key (decision_id, exception_id)
    references public.amaia_sync_workset_exception_decisions(id, exception_id)
    on delete cascade
);

-- Table 10: amaia_sync_manifest_exclusion_consumptions
create table if not exists public.amaia_sync_manifest_exclusion_consumptions (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.amaia_sync_manifest_exclusion_investigations(id) on delete cascade,
  decision_id uuid not null,
  consumed_by_run_id uuid not null references public.amaia_sync_runs(id) on delete restrict,
  consumed_by_manifest_id uuid not null,
  investigation_hash_at_consumption text not null,
  consumed_at timestamptz not null default now(),
  unique (investigation_id, consumed_by_run_id),
  foreign key (decision_id, investigation_id)
    references public.amaia_sync_manifest_exclusion_decisions(id, investigation_id)
    on delete cascade,
  foreign key (consumed_by_manifest_id, consumed_by_run_id)
    references public.amaia_sync_run_manifests(id, run_id)
    on delete restrict
);

-- Table 11: amaia_sync_alert_remediation_queue
create table if not exists public.amaia_sync_alert_remediation_queue (
  id uuid primary key default gen_random_uuid(),
  source_type text not null
    check (source_type in ('logestado_backfill', 'provisional_logestado', 'exception_resolution', 'reconciliation_drift', 'manual')),
  logestado_amaia_id integer,
  alert_amaia_id integer not null,
  origin_run_id uuid references public.amaia_sync_runs(id) on delete set null,
  origin_reconciliation_result_id uuid references public.amaia_sync_reconciliation_results(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'success', 'failed_retryable', 'failed_terminal', 'ignored_approved')),
  claimed_by_run_id uuid references public.amaia_sync_runs(id) on delete set null,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  retry_count integer not null default 0
    check (retry_count >= 0),
  max_retries integer not null default 3
    check (max_retries > 0),
  failure_reason text,
  next_attempt_at timestamptz,
  consumed_by_run_id uuid references public.amaia_sync_runs(id) on delete set null,
  evidence jsonb,
  ignored_by text,
  ignored_at timestamptz,
  ignore_reason text
    check (ignore_reason is null or length(ignore_reason) > 0),
  ignore_evidence jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists idx_amaia_sync_remediation_source_unique
  on public.amaia_sync_alert_remediation_queue (source_type, logestado_amaia_id, alert_amaia_id)
  where logestado_amaia_id is not null;

create index if not exists idx_amaia_sync_remediation_claimable
  on public.amaia_sync_alert_remediation_queue (status, claim_expires_at)
  where status in ('pending', 'claimed', 'failed_retryable');
create index if not exists idx_amaia_sync_remediation_failed_terminal
  on public.amaia_sync_alert_remediation_queue (status)
  where status = 'failed_terminal';
create index if not exists idx_amaia_sync_remediation_alert
  on public.amaia_sync_alert_remediation_queue (alert_amaia_id);
create index if not exists idx_amaia_sync_remediation_origin_run
  on public.amaia_sync_alert_remediation_queue (origin_run_id);
create index if not exists idx_amaia_sync_remediation_consumed_by
  on public.amaia_sync_alert_remediation_queue (consumed_by_run_id);

-- ============================================================
-- STEP 4: Circular composite FK (subjects → investigations)
-- ============================================================
alter table public.amaia_sync_manifest_exclusion_subjects
  add constraint fk_current_investigation
  foreign key (current_investigation_id, id)
  references public.amaia_sync_manifest_exclusion_investigations(id, subject_id)
  on delete restrict on update no action;

-- ============================================================
-- STEP 5: Trigger functions + triggers
-- ============================================================

-- Trigger #1: workset_exceptions append_only
create or replace function public.amaia_sync_wse_append_only() returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'amaia_sync_workset_exceptions is append-only: UPDATE not permitted';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'amaia_sync_workset_exceptions is append-only: DELETE not permitted';
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_wse_append_only
  before update or delete on public.amaia_sync_workset_exceptions
  for each row execute function public.amaia_sync_wse_append_only();

-- Trigger #2: workset_exception_decisions append_only + serialize + assign_seq
create or replace function public.amaia_sync_wse_decisions_guard() returns trigger as $$
declare
  v_computed_seq integer;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'amaia_sync_workset_exception_decisions is append-only: UPDATE not permitted';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'amaia_sync_workset_exception_decisions is append-only: DELETE not permitted';
  end if;
  if TG_OP = 'INSERT' then
    perform 1 from public.amaia_sync_workset_exceptions
      where id = NEW.exception_id for update;
    select coalesce(max(decision_seq), 0) + 1 into v_computed_seq
      from public.amaia_sync_workset_exception_decisions
      where exception_id = NEW.exception_id;
    NEW.decision_seq := v_computed_seq;
    return NEW;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_wse_decisions_guard
  before insert or update or delete on public.amaia_sync_workset_exception_decisions
  for each row execute function public.amaia_sync_wse_decisions_guard();

-- Trigger #3: workset_exception_consumptions validate + append_only
create or replace function public.amaia_sync_wse_consumptions_guard() returns trigger as $$
declare
  v_exception_hash text;
  v_latest_id uuid;
  v_latest_decision text;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'amaia_sync_workset_exception_consumptions is append-only: UPDATE not permitted';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'amaia_sync_workset_exception_consumptions is append-only: DELETE not permitted';
  end if;
  if TG_OP = 'INSERT' then
    select source_row_hash into v_exception_hash
      from public.amaia_sync_workset_exceptions
      where id = NEW.exception_id for update;
    select id, decision into v_latest_id, v_latest_decision
      from public.amaia_sync_workset_exception_decisions
      where exception_id = NEW.exception_id
      order by decision_seq desc limit 1;
    if v_latest_id is distinct from NEW.decision_id then
      raise exception 'decision_id is not the latest decision for this exception';
    end if;
    if v_latest_decision is distinct from 'approved' then
      raise exception 'latest decision is not approved';
    end if;
    if NEW.source_row_hash_at_consumption is distinct from v_exception_hash then
      raise exception 'source_row_hash mismatch at consumption time';
    end if;
    return NEW;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_wse_consumptions_guard
  before insert or update or delete on public.amaia_sync_workset_exception_consumptions
  for each row execute function public.amaia_sync_wse_consumptions_guard();

-- Trigger #4: run_manifests phase_column_guard
create or replace function public.amaia_sync_manifest_phase_guard() returns trigger as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'manifests cannot be deleted';
  end if;
  if OLD.phase in ('comparison_complete', 'abandoned') then
    raise exception 'manifest in terminal phase: no updates permitted';
  end if;
  if NEW.id is distinct from OLD.id then raise exception 'id is immutable'; end if;
  if NEW.run_id is distinct from OLD.run_id then raise exception 'run_id is immutable'; end if;
  if NEW.domain_name is distinct from OLD.domain_name then raise exception 'domain_name is immutable'; end if;
  if NEW.source_id_count is distinct from OLD.source_id_count then raise exception 'source_id_count is immutable'; end if;
  if NEW.source_id_hash is distinct from OLD.source_id_hash then raise exception 'source_id_hash is immutable'; end if;
  if NEW.raw_max_id is distinct from OLD.raw_max_id then raise exception 'raw_max_id is immutable'; end if;
  if NEW.created_at is distinct from OLD.created_at then raise exception 'created_at is immutable'; end if;
  if NEW.phase is not distinct from OLD.phase then
    raise exception 'UPDATE must advance phase';
  end if;

  -- source_fetched → confirmed_compared
  if OLD.phase = 'source_fetched' and NEW.phase = 'confirmed_compared' then
    if NEW.provisional_upper_bound is distinct from OLD.provisional_upper_bound then raise exception 'provisional_upper_bound not writable in this transition'; end if;
    if NEW.provisional_id_count is distinct from OLD.provisional_id_count then raise exception 'provisional_id_count not writable in this transition'; end if;
    if NEW.provisional_id_hash is distinct from OLD.provisional_id_hash then raise exception 'provisional_id_hash not writable in this transition'; end if;
    return NEW;
  end if;

  -- confirmed_compared → provisional_persisted
  if OLD.phase = 'confirmed_compared' and NEW.phase = 'provisional_persisted' then
    if NEW.persisted_id_count is distinct from OLD.persisted_id_count then raise exception 'persisted_id_count frozen'; end if;
    if NEW.persisted_id_hash is distinct from OLD.persisted_id_hash then raise exception 'persisted_id_hash frozen'; end if;
    if NEW.sets_match is distinct from OLD.sets_match then raise exception 'sets_match frozen'; end if;
    if NEW.missing_ids is distinct from OLD.missing_ids then raise exception 'missing_ids frozen'; end if;
    if NEW.extra_ids is distinct from OLD.extra_ids then raise exception 'extra_ids frozen'; end if;
    if NEW.verified_at is distinct from OLD.verified_at then raise exception 'verified_at frozen'; end if;
    return NEW;
  end if;

  -- confirmed_compared → comparison_complete
  if OLD.phase = 'confirmed_compared' and NEW.phase = 'comparison_complete' then
    if NEW.persisted_id_count is distinct from OLD.persisted_id_count then raise exception 'frozen'; end if;
    if NEW.persisted_id_hash is distinct from OLD.persisted_id_hash then raise exception 'frozen'; end if;
    if NEW.sets_match is distinct from OLD.sets_match then raise exception 'frozen'; end if;
    if NEW.missing_ids is distinct from OLD.missing_ids then raise exception 'frozen'; end if;
    if NEW.extra_ids is distinct from OLD.extra_ids then raise exception 'frozen'; end if;
    if NEW.verified_at is distinct from OLD.verified_at then raise exception 'frozen'; end if;
    if NEW.provisional_upper_bound is distinct from OLD.provisional_upper_bound then raise exception 'frozen'; end if;
    if NEW.provisional_id_count is distinct from OLD.provisional_id_count then raise exception 'frozen'; end if;
    if NEW.provisional_id_hash is distinct from OLD.provisional_id_hash then raise exception 'frozen'; end if;
    return NEW;
  end if;

  -- provisional_persisted → comparison_complete
  if OLD.phase = 'provisional_persisted' and NEW.phase = 'comparison_complete' then
    if NEW.persisted_id_count is distinct from OLD.persisted_id_count then raise exception 'frozen'; end if;
    if NEW.persisted_id_hash is distinct from OLD.persisted_id_hash then raise exception 'frozen'; end if;
    if NEW.sets_match is distinct from OLD.sets_match then raise exception 'frozen'; end if;
    if NEW.missing_ids is distinct from OLD.missing_ids then raise exception 'frozen'; end if;
    if NEW.extra_ids is distinct from OLD.extra_ids then raise exception 'frozen'; end if;
    if NEW.verified_at is distinct from OLD.verified_at then raise exception 'frozen'; end if;
    if NEW.provisional_upper_bound is distinct from OLD.provisional_upper_bound then raise exception 'frozen'; end if;
    if NEW.provisional_id_count is distinct from OLD.provisional_id_count then raise exception 'frozen'; end if;
    if NEW.provisional_id_hash is distinct from OLD.provisional_id_hash then raise exception 'frozen'; end if;
    return NEW;
  end if;

  -- any non-terminal → abandoned
  if NEW.phase = 'abandoned' and OLD.phase in ('source_fetched', 'confirmed_compared', 'provisional_persisted') then
    if NEW.persisted_id_count is distinct from OLD.persisted_id_count then raise exception 'frozen on abandon'; end if;
    if NEW.persisted_id_hash is distinct from OLD.persisted_id_hash then raise exception 'frozen on abandon'; end if;
    if NEW.sets_match is distinct from OLD.sets_match then raise exception 'frozen on abandon'; end if;
    if NEW.missing_ids is distinct from OLD.missing_ids then raise exception 'frozen on abandon'; end if;
    if NEW.extra_ids is distinct from OLD.extra_ids then raise exception 'frozen on abandon'; end if;
    if NEW.verified_at is distinct from OLD.verified_at then raise exception 'frozen on abandon'; end if;
    if NEW.provisional_upper_bound is distinct from OLD.provisional_upper_bound then raise exception 'frozen on abandon'; end if;
    if NEW.provisional_id_count is distinct from OLD.provisional_id_count then raise exception 'frozen on abandon'; end if;
    if NEW.provisional_id_hash is distinct from OLD.provisional_id_hash then raise exception 'frozen on abandon'; end if;
    return NEW;
  end if;

  raise exception 'invalid phase transition: % → %', OLD.phase, NEW.phase;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_manifest_phase_guard
  before update or delete on public.amaia_sync_run_manifests
  for each row execute function public.amaia_sync_manifest_phase_guard();

-- Trigger #5: remediation_queue state_machine_guard
create or replace function public.amaia_sync_remediation_state_guard() returns trigger as $$
begin
  -- ALWAYS_IMMUTABLE
  if NEW.id is distinct from OLD.id then raise exception 'id immutable'; end if;
  if NEW.source_type is distinct from OLD.source_type then raise exception 'source_type immutable'; end if;
  if NEW.logestado_amaia_id is distinct from OLD.logestado_amaia_id then raise exception 'logestado_amaia_id immutable'; end if;
  if NEW.alert_amaia_id is distinct from OLD.alert_amaia_id then raise exception 'alert_amaia_id immutable'; end if;
  if NEW.origin_run_id is distinct from OLD.origin_run_id then raise exception 'origin_run_id immutable'; end if;
  if NEW.origin_reconciliation_result_id is distinct from OLD.origin_reconciliation_result_id then raise exception 'origin_reconciliation_result_id immutable'; end if;
  if NEW.created_at is distinct from OLD.created_at then raise exception 'created_at immutable'; end if;
  if NEW.max_retries is distinct from OLD.max_retries then raise exception 'max_retries immutable'; end if;

  -- A) pending → claimed
  if OLD.status = 'pending' and NEW.status = 'claimed' then
    if NEW.claimed_by_run_id is null then raise exception 'claimed requires claimed_by_run_id'; end if;
    if NEW.claimed_at is null then raise exception 'claimed requires claimed_at'; end if;
    if NEW.claim_expires_at is null then raise exception 'claimed requires claim_expires_at'; end if;
    if NEW.claim_expires_at <= now() then raise exception 'claim_expires_at must be in the future'; end if;
    if NEW.retry_count is distinct from OLD.retry_count then raise exception 'retry_count frozen on claim'; end if;
    if NEW.failure_reason is distinct from OLD.failure_reason then raise exception 'failure_reason frozen on claim'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be NULL when claimed'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen on claim'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen on claim'; end if;
    if NEW.ignored_by is distinct from OLD.ignored_by then raise exception 'ignored_by frozen on claim'; end if;
    if NEW.ignored_at is distinct from OLD.ignored_at then raise exception 'ignored_at frozen on claim'; end if;
    if NEW.ignore_reason is distinct from OLD.ignore_reason then raise exception 'ignore_reason frozen on claim'; end if;
    if NEW.ignore_evidence is distinct from OLD.ignore_evidence then raise exception 'ignore_evidence frozen on claim'; end if;
    return NEW;
  end if;

  -- B) claimed → success
  if OLD.status = 'claimed' and NEW.status = 'success' then
    if NEW.consumed_by_run_id is null then raise exception 'success requires consumed_by_run_id'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.claimed_by_run_id then raise exception 'consumed_by_run_id must equal claimed_by_run_id'; end if;
    if NEW.processed_at is null then raise exception 'success requires processed_at'; end if;
    if NEW.claim_expires_at is not null then raise exception 'claim_expires_at must be cleared on success'; end if;
    if NEW.retry_count is distinct from OLD.retry_count then raise exception 'retry_count frozen on success'; end if;
    if NEW.failure_reason is distinct from OLD.failure_reason then raise exception 'failure_reason frozen on success'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be NULL on success'; end if;
    if NEW.claimed_by_run_id is distinct from OLD.claimed_by_run_id then raise exception 'claimed_by_run_id frozen on success'; end if;
    if NEW.claimed_at is distinct from OLD.claimed_at then raise exception 'claimed_at frozen on success'; end if;
    if NEW.ignored_by is distinct from OLD.ignored_by then raise exception 'ignored_by frozen on success'; end if;
    if NEW.ignored_at is distinct from OLD.ignored_at then raise exception 'ignored_at frozen on success'; end if;
    if NEW.ignore_reason is distinct from OLD.ignore_reason then raise exception 'ignore_reason frozen on success'; end if;
    if NEW.ignore_evidence is distinct from OLD.ignore_evidence then raise exception 'ignore_evidence frozen on success'; end if;
    return NEW;
  end if;

  -- C) claimed → failed_retryable
  if OLD.status = 'claimed' and NEW.status = 'failed_retryable' then
    if NEW.retry_count is distinct from OLD.retry_count + 1 then raise exception 'failed_retryable must increment retry_count by exactly 1'; end if;
    if NEW.retry_count >= NEW.max_retries then raise exception 'retry_count >= max_retries: use failed_terminal'; end if;
    if NEW.failure_reason is null then raise exception 'failed_retryable requires failure_reason'; end if;
    if NEW.next_attempt_at is null then raise exception 'failed_retryable requires next_attempt_at'; end if;
    if NEW.next_attempt_at <= now() then raise exception 'next_attempt_at must be in the future'; end if;
    if NEW.claimed_by_run_id is not null then raise exception 'claimed_by_run_id must be cleared on failure'; end if;
    if NEW.claimed_at is not null then raise exception 'claimed_at must be cleared on failure'; end if;
    if NEW.claim_expires_at is not null then raise exception 'claim_expires_at must be cleared on failure'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen on failure'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen on failure'; end if;
    if NEW.ignored_by is distinct from OLD.ignored_by then raise exception 'ignored_by frozen on failure'; end if;
    if NEW.ignored_at is distinct from OLD.ignored_at then raise exception 'ignored_at frozen on failure'; end if;
    if NEW.ignore_reason is distinct from OLD.ignore_reason then raise exception 'ignore_reason frozen on failure'; end if;
    if NEW.ignore_evidence is distinct from OLD.ignore_evidence then raise exception 'ignore_evidence frozen on failure'; end if;
    return NEW;
  end if;

  -- D) claimed → failed_terminal
  if OLD.status = 'claimed' and NEW.status = 'failed_terminal' then
    if NEW.retry_count is distinct from OLD.retry_count + 1 then raise exception 'failed_terminal must increment retry_count by exactly 1'; end if;
    if NEW.retry_count < NEW.max_retries then raise exception 'retry_count < max_retries: use failed_retryable'; end if;
    if NEW.failure_reason is null then raise exception 'failed_terminal requires failure_reason'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be NULL on failed_terminal'; end if;
    if NEW.claimed_by_run_id is not null then raise exception 'claimed_by_run_id must be cleared'; end if;
    if NEW.claimed_at is not null then raise exception 'claimed_at must be cleared'; end if;
    if NEW.claim_expires_at is not null then raise exception 'claim_expires_at must be cleared'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen'; end if;
    if NEW.ignored_by is distinct from OLD.ignored_by then raise exception 'ignored_by frozen'; end if;
    if NEW.ignored_at is distinct from OLD.ignored_at then raise exception 'ignored_at frozen'; end if;
    if NEW.ignore_reason is distinct from OLD.ignore_reason then raise exception 'ignore_reason frozen'; end if;
    if NEW.ignore_evidence is distinct from OLD.ignore_evidence then raise exception 'ignore_evidence frozen'; end if;
    return NEW;
  end if;

  -- E) claimed → pending (claim expiry)
  if OLD.status = 'claimed' and NEW.status = 'pending' then
    if OLD.claim_expires_at > now() then raise exception 'cannot revert to pending: claim has not expired'; end if;
    if NEW.claimed_by_run_id is not null then raise exception 'claimed_by_run_id must be cleared on expiry'; end if;
    if NEW.claimed_at is not null then raise exception 'claimed_at must be cleared on expiry'; end if;
    if NEW.claim_expires_at is not null then raise exception 'claim_expires_at must be cleared on expiry'; end if;
    if NEW.retry_count is distinct from OLD.retry_count then raise exception 'retry_count frozen on expiry'; end if;
    if NEW.failure_reason is distinct from OLD.failure_reason then raise exception 'failure_reason frozen on expiry'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be NULL on pending'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen on expiry'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen on expiry'; end if;
    if NEW.ignored_by is distinct from OLD.ignored_by then raise exception 'ignored_by frozen on expiry'; end if;
    if NEW.ignored_at is distinct from OLD.ignored_at then raise exception 'ignored_at frozen on expiry'; end if;
    if NEW.ignore_reason is distinct from OLD.ignore_reason then raise exception 'ignore_reason frozen on expiry'; end if;
    if NEW.ignore_evidence is distinct from OLD.ignore_evidence then raise exception 'ignore_evidence frozen on expiry'; end if;
    if NEW.evidence is distinct from OLD.evidence then raise exception 'evidence frozen on expiry'; end if;
    return NEW;
  end if;

  -- F) failed_retryable → claimed
  if OLD.status = 'failed_retryable' and NEW.status = 'claimed' then
    if OLD.next_attempt_at > now() then raise exception 'cannot re-claim: next_attempt_at not reached'; end if;
    if NEW.claimed_by_run_id is null then raise exception 'claimed requires claimed_by_run_id'; end if;
    if NEW.claimed_at is null then raise exception 'claimed requires claimed_at'; end if;
    if NEW.claim_expires_at is null then raise exception 'claimed requires claim_expires_at'; end if;
    if NEW.claim_expires_at <= now() then raise exception 'claim_expires_at must be in the future'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be cleared when claimed'; end if;
    if NEW.retry_count is distinct from OLD.retry_count then raise exception 'retry_count frozen on re-claim'; end if;
    if NEW.failure_reason is distinct from OLD.failure_reason then raise exception 'failure_reason frozen on re-claim'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen on re-claim'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen on re-claim'; end if;
    if NEW.ignored_by is distinct from OLD.ignored_by then raise exception 'ignored_by frozen on re-claim'; end if;
    if NEW.ignored_at is distinct from OLD.ignored_at then raise exception 'ignored_at frozen on re-claim'; end if;
    if NEW.ignore_reason is distinct from OLD.ignore_reason then raise exception 'ignore_reason frozen on re-claim'; end if;
    if NEW.ignore_evidence is distinct from OLD.ignore_evidence then raise exception 'ignore_evidence frozen on re-claim'; end if;
    if NEW.evidence is distinct from OLD.evidence then raise exception 'evidence frozen on re-claim'; end if;
    return NEW;
  end if;

  -- G) failed_retryable → ignored_approved
  if OLD.status = 'failed_retryable' and NEW.status = 'ignored_approved' then
    if NEW.ignored_by is null then raise exception 'ignored_approved requires ignored_by'; end if;
    if NEW.ignored_at is null then raise exception 'ignored_approved requires ignored_at'; end if;
    if NEW.ignore_reason is null or length(NEW.ignore_reason) = 0 then raise exception 'ignored_approved requires non-empty ignore_reason'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be cleared on ignore'; end if;
    if NEW.retry_count is distinct from OLD.retry_count then raise exception 'retry_count frozen on ignore'; end if;
    if NEW.failure_reason is distinct from OLD.failure_reason then raise exception 'failure_reason frozen on ignore'; end if;
    if NEW.claimed_by_run_id is distinct from OLD.claimed_by_run_id then raise exception 'claimed_by_run_id frozen on ignore'; end if;
    if NEW.claimed_at is distinct from OLD.claimed_at then raise exception 'claimed_at frozen on ignore'; end if;
    if NEW.claim_expires_at is distinct from OLD.claim_expires_at then raise exception 'claim_expires_at frozen on ignore'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen on ignore'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen on ignore'; end if;
    return NEW;
  end if;

  -- H) failed_terminal → ignored_approved
  if OLD.status = 'failed_terminal' and NEW.status = 'ignored_approved' then
    if NEW.ignored_by is null then raise exception 'ignored_approved requires ignored_by'; end if;
    if NEW.ignored_at is null then raise exception 'ignored_approved requires ignored_at'; end if;
    if NEW.ignore_reason is null or length(NEW.ignore_reason) = 0 then raise exception 'ignored_approved requires non-empty ignore_reason'; end if;
    if NEW.retry_count is distinct from OLD.retry_count then raise exception 'retry_count frozen on ignore'; end if;
    if NEW.failure_reason is distinct from OLD.failure_reason then raise exception 'failure_reason frozen on ignore'; end if;
    if NEW.next_attempt_at is not null then raise exception 'next_attempt_at must be NULL on ignore'; end if;
    if NEW.claimed_by_run_id is distinct from OLD.claimed_by_run_id then raise exception 'claimed_by_run_id frozen on ignore'; end if;
    if NEW.claimed_at is distinct from OLD.claimed_at then raise exception 'claimed_at frozen on ignore'; end if;
    if NEW.claim_expires_at is distinct from OLD.claim_expires_at then raise exception 'claim_expires_at frozen on ignore'; end if;
    if NEW.consumed_by_run_id is distinct from OLD.consumed_by_run_id then raise exception 'consumed_by_run_id frozen on ignore'; end if;
    if NEW.processed_at is distinct from OLD.processed_at then raise exception 'processed_at frozen on ignore'; end if;
    return NEW;
  end if;

  raise exception 'invalid status transition: % → %', OLD.status, NEW.status;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_remediation_state_guard
  before update on public.amaia_sync_alert_remediation_queue
  for each row execute function public.amaia_sync_remediation_state_guard();

-- Trigger #6: exclusion_investigations validate_denorm + append_only
create or replace function public.amaia_sync_excl_inv_guard() returns trigger as $$
declare
  v_domain text;
  v_amaia_id integer;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'amaia_sync_manifest_exclusion_investigations is append-only: UPDATE not permitted';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'amaia_sync_manifest_exclusion_investigations is append-only: DELETE not permitted';
  end if;
  if TG_OP = 'INSERT' then
    select domain_name, excluded_amaia_id into v_domain, v_amaia_id
      from public.amaia_sync_manifest_exclusion_subjects
      where id = NEW.subject_id;
    if v_domain is distinct from NEW.domain_name then
      raise exception 'investigation.domain_name (%) does not match subject (%)', NEW.domain_name, v_domain;
    end if;
    if v_amaia_id is distinct from NEW.excluded_amaia_id then
      raise exception 'investigation.excluded_amaia_id (%) does not match subject (%)', NEW.excluded_amaia_id, v_amaia_id;
    end if;
    return NEW;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_excl_inv_guard
  before insert or update or delete on public.amaia_sync_manifest_exclusion_investigations
  for each row execute function public.amaia_sync_excl_inv_guard();

-- Trigger #7: exclusion_decisions append_only + serialize via subject + assign_seq
create or replace function public.amaia_sync_excl_decisions_guard() returns trigger as $$
declare
  v_subject_id uuid;
  v_current_inv uuid;
  v_computed_seq integer;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'amaia_sync_manifest_exclusion_decisions is append-only: UPDATE not permitted';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'amaia_sync_manifest_exclusion_decisions is append-only: DELETE not permitted';
  end if;
  if TG_OP = 'INSERT' then
    select subject_id into v_subject_id
      from public.amaia_sync_manifest_exclusion_investigations
      where id = NEW.investigation_id;
    select current_investigation_id into v_current_inv
      from public.amaia_sync_manifest_exclusion_subjects
      where id = v_subject_id for update;
    if v_current_inv is distinct from NEW.investigation_id then
      raise exception 'cannot add decision to non-current investigation (current: %, attempted: %)', v_current_inv, NEW.investigation_id;
    end if;
    select coalesce(max(decision_seq), 0) + 1 into v_computed_seq
      from public.amaia_sync_manifest_exclusion_decisions
      where investigation_id = NEW.investigation_id;
    NEW.decision_seq := v_computed_seq;
    return NEW;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_excl_decisions_guard
  before insert or update or delete on public.amaia_sync_manifest_exclusion_decisions
  for each row execute function public.amaia_sync_excl_decisions_guard();

-- Trigger #8: exclusion_consumptions validate + append_only
create or replace function public.amaia_sync_excl_consumptions_guard() returns trigger as $$
declare
  v_subject_id uuid;
  v_current_inv uuid;
  v_inv_hash text;
  v_latest_dec_id uuid;
  v_latest_decision text;
  v_sets_match boolean;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'amaia_sync_manifest_exclusion_consumptions is append-only: UPDATE not permitted';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'amaia_sync_manifest_exclusion_consumptions is append-only: DELETE not permitted';
  end if;
  if TG_OP = 'INSERT' then
    -- 1. Read investigation
    select subject_id, investigation_hash into v_subject_id, v_inv_hash
      from public.amaia_sync_manifest_exclusion_investigations
      where id = NEW.investigation_id;
    -- 2. Lock subject
    select current_investigation_id into v_current_inv
      from public.amaia_sync_manifest_exclusion_subjects
      where id = v_subject_id for update;
    -- 3. Vigency check
    if v_current_inv is distinct from NEW.investigation_id then
      raise exception 'investigation is not current for this subject';
    end if;
    -- 5. Latest decision
    select id, decision into v_latest_dec_id, v_latest_decision
      from public.amaia_sync_manifest_exclusion_decisions
      where investigation_id = NEW.investigation_id
      order by decision_seq desc limit 1;
    if v_latest_dec_id is distinct from NEW.decision_id then
      raise exception 'decision_id is not the latest decision for this investigation';
    end if;
    -- 6. Approval
    if v_latest_decision is distinct from 'approved' then
      raise exception 'latest decision is not approved';
    end if;
    -- 7. Hash
    if NEW.investigation_hash_at_consumption is distinct from v_inv_hash then
      raise exception 'investigation hash mismatch at consumption time';
    end if;
    -- 9. Manifest sets_match
    select sets_match into v_sets_match
      from public.amaia_sync_run_manifests
      where id = NEW.consumed_by_manifest_id;
    if v_sets_match is distinct from true then
      raise exception 'manifest sets_match is not true';
    end if;
    return NEW;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_excl_consumptions_guard
  before insert or update or delete on public.amaia_sync_manifest_exclusion_consumptions
  for each row execute function public.amaia_sync_excl_consumptions_guard();

-- Trigger #9: exclusion_subjects subject_progression_guard
create or replace function public.amaia_sync_excl_subject_progression_guard() returns trigger as $$
declare
  v_inv_seq integer;
begin
  if TG_OP = 'INSERT' then
    if NEW.current_investigation_id is not null then
      raise exception 'subject must be created without current investigation';
    end if;
    if NEW.current_investigation_seq is distinct from 0 then
      raise exception 'subject must be created with investigation_seq = 0';
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- Rule 1: Identity immutability
    if NEW.domain_name is distinct from OLD.domain_name then raise exception 'domain_name is immutable'; end if;
    if NEW.excluded_amaia_id is distinct from OLD.excluded_amaia_id then raise exception 'excluded_amaia_id is immutable'; end if;
    if NEW.created_at is distinct from OLD.created_at then raise exception 'created_at is immutable'; end if;
    -- Rule 2: Cannot clear once set
    if OLD.current_investigation_id is not null and NEW.current_investigation_id is null then
      raise exception 'current_investigation_id cannot be cleared once set';
    end if;
    -- Rule 3: Seq cannot decrease
    if NEW.current_investigation_seq < OLD.current_investigation_seq then
      raise exception 'current_investigation_seq cannot decrease';
    end if;
    -- Rule 4: If investigation changes, strict +1
    if NEW.current_investigation_id is distinct from OLD.current_investigation_id then
      if NEW.current_investigation_seq is distinct from OLD.current_investigation_seq + 1 then
        raise exception 'investigation_seq must increment by exactly 1';
      end if;
      select investigation_seq into v_inv_seq
        from public.amaia_sync_manifest_exclusion_investigations
        where id = NEW.current_investigation_id and subject_id = NEW.id;
      if v_inv_seq is null then
        raise exception 'investigation not found for this subject';
      end if;
      if v_inv_seq is distinct from NEW.current_investigation_seq then
        raise exception 'investigation.investigation_seq (%) does not match subject seq (%)', v_inv_seq, NEW.current_investigation_seq;
      end if;
    end if;
    -- Rule 5: If investigation unchanged, seq unchanged
    if not (NEW.current_investigation_id is distinct from OLD.current_investigation_id) then
      if NEW.current_investigation_seq is distinct from OLD.current_investigation_seq then
        raise exception 'cannot change seq without changing investigation';
      end if;
    end if;
    -- Rule 6: updated_at
    NEW.updated_at := now();
    return NEW;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger trg_amaia_sync_excl_subject_progression_guard
  before insert or update on public.amaia_sync_manifest_exclusion_subjects
  for each row execute function public.amaia_sync_excl_subject_progression_guard();

-- ============================================================
-- STEP 6: Deployed table modifications
-- ============================================================

-- amaia_sync_runs: add columns
alter table public.amaia_sync_runs
  add column if not exists cycle_id uuid not null references public.amaia_sync_cycles(id) on delete restrict,
  add column if not exists upstream_run_id uuid references public.amaia_sync_runs(id) on delete set null,
  add column if not exists blocked_entity_name text;

-- amaia_sync_runs: extend reason_code CHECK
alter table public.amaia_sync_runs
  drop constraint if exists amaia_sync_runs_reason_code_check;
alter table public.amaia_sync_runs
  add constraint amaia_sync_runs_reason_code_check check (
    reason_code is null or reason_code in (
      'SUCCESS', 'SUCCESS_WITH_QUALITY_ISSUES', 'LEASE_HELD', 'LEASE_LOST_RACE',
      'LEASE_EXPIRED_ORPHAN', 'CONNECTION_TIMEOUT', 'MYSQL_ERROR', 'SUPABASE_ERROR',
      'SCHEMA_MISMATCH', 'RECONCILIATION_DRIFT', 'QUALITY_ISSUES',
      'ABANDONED_BY_OPERATOR', 'UNKNOWN_ERROR', 'WORKSET_INTEGRITY_FAILURE'
    )
  );

create index if not exists idx_amaia_sync_runs_cycle_id
  on public.amaia_sync_runs (cycle_id);
create index if not exists idx_amaia_sync_runs_upstream_run_id
  on public.amaia_sync_runs (upstream_run_id);

-- amaia_sync_reconciliation_results: add columns
alter table public.amaia_sync_reconciliation_results
  add column if not exists cycle_id uuid not null references public.amaia_sync_cycles(id) on delete restrict,
  add column if not exists scope_descriptor text not null,
  add column if not exists result_status text not null
    check (result_status in ('success', 'failed', 'skipped'));

create index if not exists idx_amaia_sync_recon_results_cycle_id
  on public.amaia_sync_reconciliation_results (cycle_id);

-- Destination tables: extend sync_status CHECK
alter table public.amaia_beneficiaries
  drop constraint if exists amaia_beneficiaries_sync_status_check;
alter table public.amaia_beneficiaries
  add constraint amaia_beneficiaries_sync_status_check
  check (sync_status in ('active', 'missing_pending_confirmation', 'inactive_confirmed', 'reactivation_pending'));

alter table public.amaia_support_network
  drop constraint if exists amaia_support_network_sync_status_check;
alter table public.amaia_support_network
  add constraint amaia_support_network_sync_status_check
  check (sync_status in ('active', 'missing_pending_confirmation', 'inactive_confirmed', 'reactivation_pending'));

alter table public.amaia_alerts
  drop constraint if exists amaia_alerts_sync_status_check;
alter table public.amaia_alerts
  add constraint amaia_alerts_sync_status_check
  check (sync_status in ('active', 'missing_pending_confirmation', 'inactive_confirmed', 'reactivation_pending'));

-- ============================================================
-- STEP 7: Seeds + Watermark correction
-- ============================================================

-- Seed 12 reconciliation segments
insert into public.amaia_sync_reconciliation_segments
  (domain_name, tier, segment_id, partition_expr, slo_deadline_at, created_at, updated_at)
select
  'alerta', 'tier4', s.id, 'amaia_id % 12 = ' || s.id,
  now() + interval '84 days', now(), now()
from generate_series(0, 11) as s(id)
on conflict (domain_name, tier, segment_id) do nothing;

-- Watermark correction: locked conditional update
do $$
declare
  v_type text;
  v_last_id bigint;
  v_last_ts timestamptz;
  v_expr text;
  v_affected integer;
begin
  -- Lock the row
  select watermark_type, last_id, last_timestamp, watermark_expr
    into v_type, v_last_id, v_last_ts, v_expr
    from public.amaia_sync_watermarks
    where entity_name = 'alerta'
    for update;

  if not found then
    raise exception 'PREFLIGHT ABORT: amaia_sync_watermarks row for entity_name=alerta not found';
  end if;

  -- Validate exact legacy state
  if v_type is distinct from 'timestamp' then
    raise exception 'PREFLIGHT ABORT: watermark_type is %, expected timestamp', v_type;
  end if;
  if v_last_id is not null then
    raise exception 'PREFLIGHT ABORT: last_id is %, expected NULL. Cursor may have been advanced — never overwrite.', v_last_id;
  end if;
  if v_last_ts is distinct from timestamptz '2025-01-01 00:00:00+00' then
    raise exception 'PREFLIGHT ABORT: last_timestamp is %, expected 2025-01-01 00:00:00+00', v_last_ts;
  end if;
  if v_expr is not null then
    raise exception 'PREFLIGHT ABORT: watermark_expr is %, expected NULL', v_expr;
  end if;

  -- Conditional update with exact predicates
  update public.amaia_sync_watermarks
    set watermark_type = 'id',
        last_id = 0,
        last_timestamp = null,
        watermark_expr = 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id'
    where entity_name = 'alerta'
      and watermark_type = 'timestamp'
      and last_id is null
      and last_timestamp = timestamptz '2025-01-01 00:00:00+00'
      and watermark_expr is null;

  get diagnostics v_affected = row_count;
  if v_affected != 1 then
    raise exception 'PREFLIGHT ABORT: watermark correction affected % rows, expected exactly 1', v_affected;
  end if;
end $$;

-- ============================================================
-- STEP 8: RLS + Policies
-- ============================================================

alter table public.amaia_sync_cycles enable row level security;
alter table public.amaia_sync_run_manifests enable row level security;
alter table public.amaia_sync_workset_exceptions enable row level security;
alter table public.amaia_sync_workset_exception_decisions enable row level security;
alter table public.amaia_sync_workset_exception_consumptions enable row level security;
alter table public.amaia_sync_reconciliation_segments enable row level security;
alter table public.amaia_sync_alert_remediation_queue enable row level security;
alter table public.amaia_sync_manifest_exclusion_subjects enable row level security;
alter table public.amaia_sync_manifest_exclusion_investigations enable row level security;
alter table public.amaia_sync_manifest_exclusion_decisions enable row level security;
alter table public.amaia_sync_manifest_exclusion_consumptions enable row level security;

create policy "amaia_sync_cycles_select_admin"
  on public.amaia_sync_cycles for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_run_manifests_select_admin"
  on public.amaia_sync_run_manifests for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_wse_select_admin"
  on public.amaia_sync_workset_exceptions for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_wse_decisions_select_admin"
  on public.amaia_sync_workset_exception_decisions for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_wse_consumptions_select_admin"
  on public.amaia_sync_workset_exception_consumptions for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_recon_segments_select_admin"
  on public.amaia_sync_reconciliation_segments for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_remediation_select_admin"
  on public.amaia_sync_alert_remediation_queue for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_excl_subjects_select_admin"
  on public.amaia_sync_manifest_exclusion_subjects for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_excl_investigations_select_admin"
  on public.amaia_sync_manifest_exclusion_investigations for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_excl_decisions_select_admin"
  on public.amaia_sync_manifest_exclusion_decisions for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));

create policy "amaia_sync_excl_consumptions_select_admin"
  on public.amaia_sync_manifest_exclusion_consumptions for select to authenticated
  using (public.get_user_role((select auth.uid())) in ('admin', 'super_admin'));
