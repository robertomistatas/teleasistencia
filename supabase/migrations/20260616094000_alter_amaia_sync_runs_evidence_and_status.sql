-- AMAIA-SYNC
-- Migration 013
-- Extend amaia_sync_runs with rich evidence fields and finalize the
-- status/reason_code contract.
--
-- Codex corrections incorporated:
--   - status no longer includes 'partial' (9.1C: watermark is all-or-
--     nothing, there is no persisted intermediate state to represent).
--   - reason_code uses a CHECK constraint (closed catalog), not a
--     Postgres enum, so the catalog can be extended with a plain
--     additive migration in the future.
--   - lease_token / owner_identity are audit snapshots only — no
--     physical FK to amaia_sync_leases, because the lease is ephemeral
--     and may have advanced or been released by the time this run is
--     inspected.
--   - previous_attempt_run_id chains retries of the same logical run
--     (same lower_bound/upper_bound, same backoff sequence).
--   - supersedes_run_id links a brand-new logical run (new lease_token,
--     new watermark_before read) that started specifically to recover
--     an orphaned run. The two relationships are kept distinct.

alter table public.amaia_sync_runs
  add column if not exists domain_name text,
  add column if not exists lower_bound text,
  add column if not exists upper_bound text,
  add column if not exists overlap_applied text,
  add column if not exists watermark_before_id bigint,
  add column if not exists watermark_before_timestamp timestamptz,
  add column if not exists watermark_after_id bigint,
  add column if not exists watermark_after_timestamp timestamptz,
  add column if not exists lease_token bigint,
  add column if not exists owner_identity text,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists previous_attempt_run_id uuid references public.amaia_sync_runs(id),
  add column if not exists supersedes_run_id uuid references public.amaia_sync_runs(id),
  add column if not exists started_by_recovery boolean not null default false,
  add column if not exists reconciliation_status text,
  add column if not exists reason_code text;

alter table public.amaia_sync_runs
  add constraint amaia_sync_runs_attempt_number_check
  check (attempt_number > 0);

alter table public.amaia_sync_runs
  add constraint amaia_sync_runs_reconciliation_status_check
  check (
    reconciliation_status is null
    or reconciliation_status in ('ok', 'drift_detected', 'quality_issues_found')
  );

alter table public.amaia_sync_runs
  add constraint amaia_sync_runs_reason_code_check
  check (
    reason_code is null
    or reason_code in (
      'SUCCESS',
      'SUCCESS_WITH_QUALITY_ISSUES',
      'LEASE_HELD',
      'LEASE_LOST_RACE',
      'LEASE_EXPIRED_ORPHAN',
      'CONNECTION_TIMEOUT',
      'MYSQL_ERROR',
      'SUPABASE_ERROR',
      'SCHEMA_MISMATCH',
      'RECONCILIATION_DRIFT',
      'QUALITY_ISSUES',
      'ABANDONED_BY_OPERATOR',
      'UNKNOWN_ERROR'
    )
  );

-- Finalize the status contract: drop 'partial' from the allowed set and
-- add the orphan/lock-related terminal states. The constraint name below
-- was confirmed empirically (not assumed) by inspecting pg_constraint /
-- pg_get_constraintdef on the live schema before writing this migration:
--   conname    = amaia_sync_runs_status_check
--   definition = CHECK ((status = ANY (ARRAY['running','success',
--                'failed','partial']::text[])))
-- amaia_sync_runs has 0 rows at the time of this migration (no AMAIA-SYNC
-- engine has run yet), so dropping and replacing this constraint is safe.
alter table public.amaia_sync_runs
  drop constraint if exists amaia_sync_runs_status_check;

alter table public.amaia_sync_runs
  add constraint amaia_sync_runs_status_check
  check (
    status in (
      'running',
      'success',
      'failed',
      'abandoned',
      'orphan_recovered',
      'skipped_lock_held'
    )
  );

create index if not exists idx_amaia_sync_runs_domain_name
  on public.amaia_sync_runs (domain_name);

create index if not exists idx_amaia_sync_runs_previous_attempt_run_id
  on public.amaia_sync_runs (previous_attempt_run_id);

create index if not exists idx_amaia_sync_runs_supersedes_run_id
  on public.amaia_sync_runs (supersedes_run_id);

comment on column public.amaia_sync_runs.lease_token
  is 'Snapshot of the fencing token held during this run. Deliberately not a foreign key to amaia_sync_leases: the lease is ephemeral and may have advanced or been released by the time this row is audited. This column is evidence, not a live reference.';

comment on column public.amaia_sync_runs.owner_identity
  is 'Snapshot of the structured identity ({hostname}:{process_id}:{worker_id}:{run_id}) that held the lease during this run.';

comment on column public.amaia_sync_runs.previous_attempt_run_id
  is 'Links this row to the immediately preceding attempt of the same logical run (same lower_bound/upper_bound, same backoff sequence). Distinct from supersedes_run_id.';

comment on column public.amaia_sync_runs.supersedes_run_id
  is 'Links this row to an orphaned run (status=orphan_recovered) that this brand-new logical run (new lease_token, new watermark_before read) was started to recover from. Distinct from previous_attempt_run_id, which chains retries within the same logical run.';

comment on column public.amaia_sync_runs.reason_code
  is 'Closed catalog (CHECK constraint, not enum, to allow simple additive extension later) detailing the precise outcome of the run beyond the coarse status bucket.';

comment on column public.amaia_sync_runs.watermark_before_id
  is 'Snapshot of amaia_sync_watermarks.last_id at run start, when watermark_type=id for this domain.';

comment on column public.amaia_sync_runs.watermark_before_timestamp
  is 'Snapshot of amaia_sync_watermarks.last_timestamp at run start, when watermark_type=timestamp for this domain.';

comment on column public.amaia_sync_runs.watermark_after_id
  is 'Only populated when status=success. Mirrors watermark_before_id but reflecting the value persisted to amaia_sync_watermarks at run close.';

comment on column public.amaia_sync_runs.watermark_after_timestamp
  is 'Only populated when status=success. Mirrors watermark_before_timestamp but reflecting the value persisted to amaia_sync_watermarks at run close.';
