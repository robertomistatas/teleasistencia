-- AMAIA-SYNC Phase 9.3C v6.3 — 03 identity policy and manifest item tables
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- ============================================================
-- 3. NEW TABLES
-- ============================================================
create table if not exists public.amaia_sync_domain_identity_policies (
  domain_name text primary key,
  required_identity_basis text not null check (required_identity_basis in ('source_amaia_id','canonical_dedup_key')),
  required_identity_version text not null, required_canonicalization_version text,
  required_hash_algorithm text not null, required_serialization_version text not null,
  created_at timestamptz not null default now(),
  check ((required_identity_basis='source_amaia_id' and required_canonicalization_version is null) or (required_identity_basis='canonical_dedup_key' and required_canonicalization_version is not null))
);

create table if not exists public.amaia_sync_manifest_identity_items (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.amaia_sync_run_manifests(id) on delete restrict,
  item_role text not null check (item_role in ('source','persisted','missing','extra','excluded')),
  source_amaia_id integer, identity_basis text not null check (identity_basis in ('source_amaia_id','canonical_dedup_key')),
  canonical_key text, beneficiary_amaia_id integer, canonical_hash text, canonical_hash_version text,
  created_at timestamptz not null default now(),
  check ((identity_basis='source_amaia_id' and source_amaia_id is not null and canonical_key is null) or (identity_basis='canonical_dedup_key' and canonical_key is not null and beneficiary_amaia_id is not null and canonical_hash is not null and canonical_hash_version is not null)),
  check (canonical_key is null or canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$')
);
create index if not exists idx_mitems_mfk on public.amaia_sync_manifest_identity_items (manifest_id);
create index if not exists idx_mitems_mrole on public.amaia_sync_manifest_identity_items (manifest_id,item_role);
create unique index if not exists idx_mitems_src_u on public.amaia_sync_manifest_identity_items (manifest_id,source_amaia_id) where source_amaia_id is not null and item_role='source';
create unique index if not exists idx_mitems_role_ck on public.amaia_sync_manifest_identity_items (manifest_id,item_role,canonical_key) where canonical_key is not null and item_role in ('persisted','missing','extra','excluded');
