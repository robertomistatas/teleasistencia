-- AMAIA-SYNC Phase 9.3C v6.3 — 11 finalize source
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- 8. DROP OLD OVERLOADS
-- ============================================================
drop function if exists public.amaia_sync_finalize_provisional(uuid,uuid,bigint,integer,text);
drop function if exists public.amaia_sync_finalize_provisional(uuid,uuid,text,bigint,integer,text);
drop function if exists public.amaia_sync_finalize_provisional(uuid,uuid,bigint,bigint,integer,text);
drop function if exists public.amaia_sync_finalize_provisional(uuid,uuid,bigint,bigint);

-- ============================================================
-- 9. SECURITY DEFINER FUNCTIONS
-- ============================================================

-- finalize_source
create or replace function public.amaia_sync_finalize_source(p_mid uuid, p_rid uuid) returns void language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_dom text; v_basis text; v_l record; v_r record; v_m record; v_h record;
begin
  select domain_name,identity_basis into v_dom,v_basis from public.amaia_sync_run_manifests where id=p_mid;
  if not found then raise exception 'manifest not found'; end if;
  select * into v_l from public.amaia_sync_leases where entity_name=v_dom for update;
  if v_l.owner_identity is null or v_l.lease_expires_at<=now() then raise exception 'lease invalid'; end if;
  select * into v_r from public.amaia_sync_runs where id=p_rid for update;
  if v_r.status is distinct from 'running' then raise exception 'run not running'; end if;
  if v_r.owner_identity is distinct from v_l.owner_identity or v_r.lease_token is distinct from v_l.lease_token then raise exception 'cred mismatch'; end if;
  if v_r.domain_name is distinct from v_dom then raise exception 'domain mismatch'; end if;
  select * into v_m from public.amaia_sync_run_manifests where id=p_mid for update;
  if v_m.phase is distinct from 'created' then raise exception 'expected created'; end if;
  if v_m.run_id is distinct from p_rid then raise exception 'run_id mismatch'; end if;
  select * into v_h from public.amaia_sync_compute_set_hash(p_mid,'source',v_basis);
  update public.amaia_sync_run_manifests set source_id_count=v_h.item_count,source_id_hash=v_h.item_hash,phase='source_fetched' where id=p_mid;
end; $f$;
alter function public.amaia_sync_finalize_source(uuid,uuid) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_finalize_source(uuid,uuid) from public;
grant execute on function public.amaia_sync_finalize_source(uuid,uuid) to amaia_sync_runtime;
