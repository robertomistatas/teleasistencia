-- AMAIA-SYNC
-- Migration 017
-- Extend amaia_support_network with sync_status (internal engine state).
-- The existing 'estado' column is documented explicitly as the business
-- status field mirroring AMAIA red.estado — no structural change to it,
-- only clarification of its role alongside the new internal field.

alter table public.amaia_support_network
  add column if not exists sync_status text not null default 'active';

alter table public.amaia_support_network
  add constraint amaia_support_network_sync_status_check
  check (sync_status in ('active', 'missing_pending_confirmation', 'inactive_confirmed'));

create index if not exists idx_amaia_support_network_sync_status
  on public.amaia_support_network (sync_status);

comment on column public.amaia_support_network.estado
  is 'Business status mirrored verbatim from AMAIA red.estado. 9.1D (V-008) found a weak correlation between estado=0 and lower recent activity, but this is not confirmed as a deliberate deactivation signal — never used by the engine to derive sync_status.';

comment on column public.amaia_support_network.sync_status
  is 'Internal engine state, written exclusively by the full-reconciliation tombstone process (see amaia_sync_tombstone_events). Independent from estado.';
