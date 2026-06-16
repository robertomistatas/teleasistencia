-- AMAIA-SYNC
-- Migration 009
-- Create amaia_sync_leases
-- Scope: ephemeral mutual-exclusion lease per sync domain, with fencing token.
-- Deliberately separate from amaia_sync_watermarks:
--   watermark = durable confirmed progress (changes only on successful run close)
--   lease     = ephemeral mutual exclusion (changes on every heartbeat)
-- They must not share write surface.

create table if not exists public.amaia_sync_leases (
  entity_name text primary key,

  owner_identity text,

  lease_token bigint not null default 0,

  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  acquired_at timestamptz,

  updated_at timestamptz not null default now()
);

create trigger amaia_sync_leases_set_updated_at
  before update on public.amaia_sync_leases
  for each row execute function public.set_updated_at();

create index if not exists idx_amaia_sync_leases_owner_identity
  on public.amaia_sync_leases (owner_identity);

alter table public.amaia_sync_leases enable row level security;

create policy "amaia_sync_leases_select_admin_super_admin"
  on public.amaia_sync_leases
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
  );

comment on table public.amaia_sync_leases
  is 'Ephemeral mutual-exclusion lease per AMAIA-SYNC domain (entity_name), with monotonic fencing token. Separate from amaia_sync_watermarks by design: lease state changes on every heartbeat, watermark state changes only on successful run completion.';

comment on column public.amaia_sync_leases.entity_name
  is 'Logical key shared by convention with amaia_sync_watermarks.entity_name and amaia_sync_runs.domain_name, validated at the application layer against the configured domain list. Deliberately NOT a foreign key to amaia_sync_watermarks: a lease is an ephemeral exclusion mechanism and a watermark is durable confirmed progress — they must not share write/DDL surface, and amaia_correlation_issues/amaia_sync_reconciliation_results/amaia_sync_tombstone_events already reference domains by plain text (domain_name) without a physical FK for the same reason. Keeping this table consistent with that pattern avoids coupling lease lifecycle operations (e.g. a future watermark table migration) to this table''s DDL.';

comment on column public.amaia_sync_leases.lease_token
  is 'Monotonic fencing token. Incremented only on lease acquisition (free or expired -> held), never on renewal. Any worker must verify this token is still current before writing domain data or advancing a watermark; if it no longer matches, the worker has been superseded and must stop immediately.';

comment on column public.amaia_sync_leases.owner_identity
  is 'Structured identity of the process holding the lease: {hostname}:{process_id}:{worker_id}:{run_id}. Null when the lease is free.';

comment on column public.amaia_sync_leases.lease_expires_at
  is 'TTL expiration of the current lease. A lease past this timestamp with no renewed heartbeat is considered abandoned and eligible for orphan recovery.';

comment on column public.amaia_sync_leases.heartbeat_at
  is 'Last confirmed renewal. Absence of renewal before lease_expires_at is the signal used to detect orphaned runs.';
