-- AMAIA-SYNC Phase 9.3C v6.3 — 08 core trigger guards
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- 6. TRIGGERS (new + updated)
-- ============================================================

-- #10: Cycles lineage
create or replace function public.amaia_sync_cycles_lineage_guard() returns trigger as $f$
begin
  if TG_OP='DELETE' then raise exception 'cycles: delete forbidden'; end if;
  if NEW.scheduler_owner_identity is distinct from OLD.scheduler_owner_identity then raise exception 'immutable: scheduler_owner_identity'; end if;
  if NEW.scheduler_lease_token is distinct from OLD.scheduler_lease_token then raise exception 'immutable: scheduler_lease_token'; end if;
  if NEW.started_at is distinct from OLD.started_at then raise exception 'immutable: started_at'; end if;
  if NEW.trigger_type is distinct from OLD.trigger_type then raise exception 'immutable: trigger_type'; end if;
  if NEW.owner_identity is distinct from OLD.owner_identity then raise exception 'immutable: owner_identity'; end if;
  return NEW;
end; $f$ language plpgsql;
drop trigger if exists trg_amaia_sync_cycles_lineage_guard on public.amaia_sync_cycles;
create trigger trg_amaia_sync_cycles_lineage_guard before update or delete on public.amaia_sync_cycles for each row execute function public.amaia_sync_cycles_lineage_guard();

-- #11: Identity items guard
create or replace function public.amaia_sync_identity_items_guard() returns trigger as $f$
declare v_phase text; v_basis text;
begin
  if TG_OP in ('UPDATE','DELETE') then raise exception 'identity_items: % forbidden', TG_OP; end if;
  select phase, identity_basis into v_phase, v_basis from public.amaia_sync_run_manifests where id=NEW.manifest_id for share;
  if not found then raise exception 'manifest not found'; end if;
  if NEW.identity_basis is distinct from v_basis then raise exception 'basis mismatch'; end if;
  if v_phase='created' and NEW.item_role='source' then return NEW; end if;
  if v_phase='source_fetched' and NEW.item_role in ('persisted','missing','extra','excluded') then
    if current_user is distinct from 'amaia_sync_manifest_owner' then raise exception 'derived items require manifest_owner (got %)', current_user; end if;
    return NEW;
  end if;
  raise exception 'role % not allowed at phase %', NEW.item_role, v_phase;
end; $f$ language plpgsql;
drop trigger if exists trg_amaia_sync_identity_items_guard on public.amaia_sync_manifest_identity_items;
create trigger trg_amaia_sync_identity_items_guard before insert or update or delete on public.amaia_sync_manifest_identity_items for each row execute function public.amaia_sync_identity_items_guard();

-- #12: Domain policies immutable
create or replace function public.amaia_sync_domain_policies_immutable() returns trigger as $f$
begin raise exception 'domain_identity_policies: immutable'; end; $f$ language plpgsql;
drop trigger if exists trg_amaia_sync_domain_policies_immutable on public.amaia_sync_domain_identity_policies;
create trigger trg_amaia_sync_domain_policies_immutable before update or delete on public.amaia_sync_domain_identity_policies for each row execute function public.amaia_sync_domain_policies_immutable();

-- #13: Manifest INSERT guard
-- SECURITY DEFINER (Blocker v5-1): runtime needs no direct SELECT on amaia_sync_runs.
-- The guard reads runs + policies as manifest_owner (which has those grants/RLS).
-- It does NOT check current_user, so SECURITY DEFINER does not weaken any role check.
create or replace function public.amaia_sync_manifest_insert_guard() returns trigger
language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_pol record; v_rd text;
begin
  if NEW.phase is distinct from 'created' then raise exception 'must INSERT at phase=created'; end if;
  select domain_name into v_rd from public.amaia_sync_runs where id=NEW.run_id;
  if not found then raise exception 'run not found'; end if;
  if v_rd is distinct from NEW.domain_name then raise exception 'run.domain (%) != manifest.domain (%)', v_rd, NEW.domain_name; end if;
  select * into v_pol from public.amaia_sync_domain_identity_policies where domain_name=NEW.domain_name;
  if not found then raise exception 'no policy for domain %', NEW.domain_name; end if;
  if NEW.identity_basis is distinct from v_pol.required_identity_basis then raise exception 'identity_basis mismatch'; end if;
  if NEW.identity_version is distinct from v_pol.required_identity_version then raise exception 'identity_version mismatch'; end if;
  if NEW.canonicalization_version is distinct from v_pol.required_canonicalization_version then raise exception 'canonicalization_version mismatch'; end if;
  if NEW.hash_algorithm is distinct from v_pol.required_hash_algorithm then raise exception 'hash_algorithm mismatch'; end if;
  if NEW.serialization_version is distinct from v_pol.required_serialization_version then raise exception 'serialization_version mismatch'; end if;
  return NEW;
end; $f$;
alter function public.amaia_sync_manifest_insert_guard() owner to amaia_sync_manifest_owner;
drop trigger if exists trg_amaia_sync_manifest_insert_guard on public.amaia_sync_run_manifests;
create trigger trg_amaia_sync_manifest_insert_guard before insert on public.amaia_sync_run_manifests for each row execute function public.amaia_sync_manifest_insert_guard();

-- #14: Membership guard
create or replace function public.amaia_sync_membership_guard() returns trigger as $f$
declare v_ms integer;
begin
  if TG_OP='DELETE' then raise exception 'memberships: delete forbidden'; end if;
  if TG_OP='INSERT' then
    perform 1 from public.amaia_sync_domain_identity_policies where domain_name=NEW.domain_name and required_identity_basis='canonical_dedup_key';
    if not found then raise exception 'memberships only for dedup domains'; end if;
    select coalesce(max(episode_seq),0) into v_ms from public.amaia_sync_dedup_identity_memberships where domain_name=NEW.domain_name and source_amaia_id=NEW.source_amaia_id;
    if NEW.episode_seq is distinct from v_ms+1 then raise exception 'episode_seq must be %', v_ms+1; end if;
    if NEW.status!='active' then raise exception 'new memberships must be active'; end if;
    if NEW.active_until_watermark is not null then raise exception 'active: null active_until'; end if;
    return NEW;
  end if;
  if TG_OP='UPDATE' then
    if NEW.id is distinct from OLD.id or NEW.domain_name is distinct from OLD.domain_name or NEW.source_amaia_id is distinct from OLD.source_amaia_id or NEW.canonical_key is distinct from OLD.canonical_key or NEW.episode_seq is distinct from OLD.episode_seq or NEW.first_seen_run_id is distinct from OLD.first_seen_run_id or NEW.active_from_watermark is distinct from OLD.active_from_watermark or NEW.created_at is distinct from OLD.created_at then raise exception 'immutable column'; end if;
    if OLD.status='active' and NEW.status not in ('closed','source_deleted') then raise exception 'invalid: active->%', NEW.status; end if;
    if OLD.status='source_deleted' and NEW.status!='tombstoned' then raise exception 'invalid: source_deleted->%', NEW.status; end if;
    if OLD.status in ('closed','tombstoned') then raise exception '% terminal', OLD.status; end if;
    if NEW.status in ('closed','source_deleted','tombstoned') and NEW.active_until_watermark is null then raise exception '% requires active_until', NEW.status; end if;
    NEW.updated_at:=now(); return NEW;
  end if;
  return null;
end; $f$ language plpgsql;
drop trigger if exists trg_amaia_sync_membership_guard on public.amaia_sync_dedup_identity_memberships;
create trigger trg_amaia_sync_membership_guard before insert or update or delete on public.amaia_sync_dedup_identity_memberships for each row execute function public.amaia_sync_membership_guard();

-- #15: Tombstone append-only
create or replace function public.amaia_sync_tombstone_ao() returns trigger as $f$
begin raise exception 'tombstone_events: append-only'; end; $f$ language plpgsql;
drop trigger if exists trg_amaia_sync_tombstone_append_only on public.amaia_sync_tombstone_events;
create trigger trg_amaia_sync_tombstone_append_only before update or delete on public.amaia_sync_tombstone_events for each row execute function public.amaia_sync_tombstone_ao();

-- #16: Recon identity guard
create or replace function public.amaia_sync_recon_id_guard() returns trigger as $f$
begin return NEW; end; $f$ language plpgsql;
drop trigger if exists trg_amaia_sync_recon_identity_guard on public.amaia_sync_reconciliation_results;
create trigger trg_amaia_sync_recon_identity_guard before insert on public.amaia_sync_reconciliation_results for each row execute function public.amaia_sync_recon_id_guard();
