-- AMAIA-SYNC Phase 9.3C v6.3 — 04 dedup memberships table
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

create table if not exists public.amaia_sync_dedup_identity_memberships (
  id uuid primary key default gen_random_uuid(), domain_name text not null, source_amaia_id integer not null,
  beneficiary_amaia_id integer not null,
  canonical_key text not null check (canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$'),
  canonical_hash text not null, canonical_hash_version text not null,
  episode_seq integer not null check (episode_seq>0),
  first_seen_run_id uuid not null references public.amaia_sync_runs(id) on delete restrict,
  last_seen_run_id uuid not null references public.amaia_sync_runs(id) on delete restrict,
  active_from_watermark bigint not null, active_until_watermark bigint,
  status text not null check (status in ('active','closed','source_deleted','tombstoned')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (domain_name,source_amaia_id,episode_seq)
);
create unique index if not exists idx_membr_active on public.amaia_sync_dedup_identity_memberships (domain_name,source_amaia_id) where status='active';
create index if not exists idx_membr_ck_st on public.amaia_sync_dedup_identity_memberships (domain_name,canonical_key,status);
create index if not exists idx_membr_lsrun on public.amaia_sync_dedup_identity_memberships (last_seen_run_id);
