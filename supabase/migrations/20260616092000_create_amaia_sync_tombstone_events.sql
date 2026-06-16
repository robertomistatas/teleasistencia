-- AMAIA-SYNC
-- Migration 011
-- Create amaia_sync_tombstone_events
-- Scope: immutable audit trail of sync_status transitions inferred by
-- full-universe reconciliation. Tombstones are an exceptional recovery
-- mechanism, never the primary operational path (no frequent physical
-- deletes were found in AMAIA during empirical validation).

create table if not exists public.amaia_sync_tombstone_events (
  id uuid primary key default gen_random_uuid(),

  domain_name text not null,
  source_amaia_id integer not null,

  transition text not null
    check (transition in ('detected', 'confirmed', 'reverted', 'ignored')),

  reconciliation_run_id uuid references public.amaia_sync_runs(id) on delete set null,

  detected_at timestamptz not null default now()
);

create index if not exists idx_amaia_sync_tombstone_events_domain_source
  on public.amaia_sync_tombstone_events (domain_name, source_amaia_id);

create index if not exists idx_amaia_sync_tombstone_events_reconciliation_run_id
  on public.amaia_sync_tombstone_events (reconciliation_run_id);

alter table public.amaia_sync_tombstone_events enable row level security;

create policy "amaia_sync_tombstone_events_select_admin_super_admin"
  on public.amaia_sync_tombstone_events
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
  );

comment on table public.amaia_sync_tombstone_events
  is 'Immutable audit trail of sync_status transitions for rows whose absence from the AMAIA source universe was detected by full reconciliation. Never written from incremental syncs — only from reconciliation_level=full. History is append-only: a reactivation never overwrites prior events.';

comment on column public.amaia_sync_tombstone_events.transition
  is 'detected: first full-reconciliation cycle that did not find this amaia_id in source. confirmed: second consecutive cycle confirming absence -> sync_status becomes inactive_confirmed. reverted: amaia_id reappeared in source after being confirmed inactive -> sync_status returns to active. ignored: amaia_id reappeared before reaching confirmed -> discarded as a transient false positive, but still recorded for audit.';
