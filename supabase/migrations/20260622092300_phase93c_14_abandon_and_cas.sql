-- AMAIA-SYNC Phase 9.3C v6.3 — 14 abandon manifest and watermark CAS
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- abandon_manifest
create or replace function public.amaia_sync_abandon_manifest(p_mid uuid, p_by text, p_reason text) returns void language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_dom text; v_rid uuid; v_l record; v_r record; v_m record;
begin
  if p_by is null or length(p_by)=0 then raise exception 'abandoned_by required'; end if;
  if p_reason is null or length(p_reason)=0 then raise exception 'reason required'; end if;
  select domain_name,run_id into v_dom,v_rid from public.amaia_sync_run_manifests where id=p_mid;
  if not found then raise exception 'manifest not found'; end if;
  select * into v_l from public.amaia_sync_leases where entity_name=v_dom for update;
  select * into v_r from public.amaia_sync_runs where id=v_rid for update;
  select * into v_m from public.amaia_sync_run_manifests where id=p_mid for update;
  if v_m.phase in ('comparison_complete','abandoned') then raise exception 'already terminal'; end if;
  if v_m.run_id is distinct from v_r.id then raise exception 'run mismatch'; end if;
  if v_r.status='success' then raise exception 'cannot abandon successful'; end if;
  if v_r.status='skipped_lock_held' then raise exception 'cannot abandon skipped'; end if;
  if v_r.status='running' and v_r.owner_identity is not distinct from v_l.owner_identity and v_r.lease_token is not distinct from v_l.lease_token and v_l.lease_expires_at>now() then raise exception 'run is healthy'; end if;
  update public.amaia_sync_run_manifests set phase='abandoned',abandoned_by=p_by,abandoned_at=now(),abandoned_reason=p_reason where id=p_mid;
end; $f$;
alter function public.amaia_sync_abandon_manifest(uuid,text,text) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_abandon_manifest(uuid,text,text) from public;
grant execute on function public.amaia_sync_abandon_manifest(uuid,text,text) to amaia_sync_recovery_runtime;

-- advance_watermark_cas
create or replace function public.amaia_sync_advance_watermark_cas(p_dom text, p_type text, p_exp bigint, p_new bigint, p_rid uuid) returns void language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_l record; v_r record; v_aff int;
begin
  if p_dom is null or p_type is null or p_exp is null or p_new is null or p_rid is null then raise exception 'CAS: null params'; end if;
  if p_type!='id' then raise exception 'CAS: only id type supported in V1'; end if;
  if p_new<=p_exp then raise exception 'CAS: new (%) must be > expected (%)', p_new, p_exp; end if;
  select * into v_l from public.amaia_sync_leases where entity_name=p_dom for update;
  if v_l.owner_identity is null or v_l.lease_expires_at<=now() then raise exception 'CAS: lease invalid'; end if;
  select * into v_r from public.amaia_sync_runs where id=p_rid for update;
  if v_r.status is distinct from 'running' then raise exception 'CAS: run not running'; end if;
  if v_r.owner_identity is distinct from v_l.owner_identity or v_r.lease_token is distinct from v_l.lease_token then raise exception 'CAS: cred mismatch'; end if;
  if v_r.domain_name is distinct from p_dom then raise exception 'CAS: domain mismatch'; end if;
  -- Validate new_cursor = run.upper_bound for confirmed sync
  if p_new is distinct from coalesce(v_r.upper_bound::bigint,0) then raise exception 'CAS: new_cursor (%) != run.upper_bound (%)', p_new, v_r.upper_bound; end if;
  update public.amaia_sync_watermarks set last_id=p_new, updated_at=now() where entity_name=p_dom and watermark_type=p_type and last_id is not distinct from p_exp;
  get diagnostics v_aff = row_count;
  if v_aff!=1 then raise exception 'CAS: expected 1 row, got %', v_aff; end if;
end; $f$;
alter function public.amaia_sync_advance_watermark_cas(text,text,bigint,bigint,uuid) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_advance_watermark_cas(text,text,bigint,bigint,uuid) from public;
grant execute on function public.amaia_sync_advance_watermark_cas(text,text,bigint,bigint,uuid) to amaia_sync_runtime;
