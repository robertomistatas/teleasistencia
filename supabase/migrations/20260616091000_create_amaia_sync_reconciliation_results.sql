-- AMAIA-SYNC
-- Migration 010
-- Create amaia_sync_reconciliation_results
-- Scope: structured metrics produced by each reconciliation execution
-- (daily / weekly / full), one row per domain per execution.

create table if not exists public.amaia_sync_reconciliation_results (
  id uuid primary key default gen_random_uuid(),

  run_id uuid references public.amaia_sync_runs(id) on delete cascade,

  domain_name text not null,

  reconciliation_level text not null
    check (reconciliation_level in ('daily', 'weekly', 'full')),

  source_count bigint not null default 0
    check (source_count >= 0),
  destination_count bigint not null default 0
    check (destination_count >= 0),

  drift bigint not null default 0,

  duplicate_count integer not null default 0
    check (duplicate_count >= 0),
  orphan_row_count integer not null default 0
    check (orphan_row_count >= 0),
  out_of_bounds_count integer not null default 0
    check (out_of_bounds_count >= 0),

  late_update_count integer
    check (late_update_count is null or late_update_count >= 0),
  tombstone_candidate_count integer
    check (tombstone_candidate_count is null or tombstone_candidate_count >= 0),

  unresolved_dependency_count integer not null default 0
    check (unresolved_dependency_count >= 0),

  executed_at timestamptz not null default now()
);

create index if not exists idx_amaia_sync_reconciliation_results_run_id
  on public.amaia_sync_reconciliation_results (run_id);

create index if not exists idx_amaia_sync_reconciliation_results_domain_level_executed
  on public.amaia_sync_reconciliation_results (domain_name, reconciliation_level, executed_at);

alter table public.amaia_sync_reconciliation_results enable row level security;

create policy "amaia_sync_reconciliation_results_select_admin_super_admin"
  on public.amaia_sync_reconciliation_results
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
  );

comment on table public.amaia_sync_reconciliation_results
  is 'Structured metrics produced by a reconciliation run (daily/weekly/full) for a given AMAIA-SYNC domain: count comparison, drift, duplicates, orphan FKs, out-of-bounds rows, late updates and tombstone candidates. One row per domain per reconciliation execution.';

comment on column public.amaia_sync_reconciliation_results.drift
  is 'source_count - destination_count for the evaluated range. A sustained non-zero drift across consecutive executions signals a miscalibrated watermark or overlap, not an immediate data-quality issue.';

comment on column public.amaia_sync_reconciliation_results.tombstone_candidate_count
  is 'Only populated on reconciliation_level=full. amaia_id values present in Supabase but absent from the full source universe for the operational window — candidates for the tombstone grace-period process in amaia_sync_tombstone_events.';

comment on column public.amaia_sync_reconciliation_results.late_update_count
  is 'Only populated on reconciliation_level in (weekly, full). Rows whose content hash differs between source and destination despite existing on both sides — detects updates the incremental watermark could not see.';
