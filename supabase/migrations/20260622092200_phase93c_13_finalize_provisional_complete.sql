-- AMAIA-SYNC Phase 9.3C v6.3 — 13 finalize provisional and complete
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- finalize_provisional (3 params ONLY)
create or replace function public.amaia_sync_finalize_provisional(p_mid uuid, p_rid uuid, p_pub bigint) returns void language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_dom text; v_basis text; v_l record; v_r record; v_m record; v_cub bigint; v_els text[]; v_cnt int; v_hash text; v_delim text;
begin
  if p_pub is null then raise exception 'provisional_upper_bound cannot be null'; end if;
  select domain_name,identity_basis into v_dom,v_basis from public.amaia_sync_run_manifests where id=p_mid;
  if not found then raise exception 'manifest not found'; end if;
  select * into v_l from public.amaia_sync_leases where entity_name=v_dom for update;
  if v_l.owner_identity is null or v_l.lease_expires_at<=now() then raise exception 'lease invalid'; end if;
  select * into v_r from public.amaia_sync_runs where id=p_rid for update;
  if v_r.status is distinct from 'running' then raise exception 'run not running'; end if;
  if v_r.owner_identity is distinct from v_l.owner_identity or v_r.lease_token is distinct from v_l.lease_token then raise exception 'cred mismatch'; end if;
  if v_r.domain_name is distinct from v_dom then raise exception 'domain mismatch'; end if;
  select * into v_m from public.amaia_sync_run_manifests where id=p_mid for update;
  if v_m.phase is distinct from 'confirmed_compared' then raise exception 'expected confirmed_compared'; end if;
  if v_m.run_id is distinct from p_rid then raise exception 'run_id mismatch'; end if;
  v_cub:=coalesce(v_r.upper_bound::bigint,0);
  if p_pub<v_cub then raise exception 'provisional_upper_bound (%) < confirmed (%) ', p_pub, v_cub; end if;

  if v_basis='source_amaia_id' then
    v_delim := '|';  -- integer_decimal_v1 / sha256_pipe_delimited_sorted
    if v_dom='logestado' then select array_agg(amaia_id::text order by amaia_id) into v_els from public.amaia_alert_logs where amaia_id>v_cub and amaia_id<=p_pub;
    elsif v_dom='control_llamadas' then select array_agg(amaia_id::text order by amaia_id) into v_els from public.amaia_call_logs where amaia_id>v_cub and amaia_id<=p_pub;
    elsif v_dom='beneficiario' then select array_agg(amaia_id::text order by amaia_id) into v_els from public.amaia_beneficiaries where amaia_id>v_cub and amaia_id<=p_pub;
    elsif v_dom='red' then select array_agg(amaia_id::text order by amaia_id) into v_els from public.amaia_support_network where amaia_id>v_cub and amaia_id<=p_pub;
    elsif v_dom='alerta' then select array_agg(amaia_id::text order by amaia_id) into v_els from public.amaia_alerts where amaia_id>v_cub and amaia_id<=p_pub;
    else raise exception 'unknown domain: %', v_dom; end if;
  elsif v_basis='canonical_dedup_key' then
    v_delim := ':';  -- canonical_key_colon_v1 / sha256_colon_delimited_sorted
    if v_dom='enfermedades' then
      select array_agg(distinct (hc.beneficiary_amaia_id::text||':'||hc.hash||':'||hc.hash_version) order by (hc.beneficiary_amaia_id::text||':'||hc.hash||':'||hc.hash_version)) into v_els
        from public.amaia_health_conditions hc join public.amaia_sync_dedup_identity_memberships m on m.domain_name='enfermedades' and m.status='active' and m.beneficiary_amaia_id=hc.beneficiary_amaia_id and m.canonical_hash=hc.hash
        where m.active_from_watermark>v_cub and m.active_from_watermark<=p_pub;
    elsif v_dom='medicamentos' then
      select array_agg(distinct (md.beneficiary_amaia_id::text||':'||md.hash||':'||md.hash_version) order by (md.beneficiary_amaia_id::text||':'||md.hash||':'||md.hash_version)) into v_els
        from public.amaia_medications md join public.amaia_sync_dedup_identity_memberships m on m.domain_name='medicamentos' and m.status='active' and m.beneficiary_amaia_id=md.beneficiary_amaia_id and m.canonical_hash=md.hash
        where m.active_from_watermark>v_cub and m.active_from_watermark<=p_pub;
    else raise exception 'unknown dedup domain: %', v_dom; end if;
  else raise exception 'unknown basis'; end if;
  v_els:=coalesce(v_els,'{}'); v_cnt:=coalesce(array_length(v_els,1),0);
  v_hash:=encode(digest(array_to_string(v_els,v_delim),'sha256'),'hex');
  update public.amaia_sync_run_manifests set provisional_upper_bound=p_pub,provisional_id_count=v_cnt,provisional_id_hash=v_hash,provisional_verified=true,phase='provisional_persisted' where id=p_mid;
end; $f$;
alter function public.amaia_sync_finalize_provisional(uuid,uuid,bigint) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_finalize_provisional(uuid,uuid,bigint) from public;
grant execute on function public.amaia_sync_finalize_provisional(uuid,uuid,bigint) to amaia_sync_runtime;

-- complete_manifest
-- RUNTIME CONTRACT: When sets_match=true, the runtime MUST call amaia_sync_advance_watermark_cas
-- in the SAME transaction BEFORE calling complete_manifest. This function does not enforce the
-- watermark advance because the approved protocol (v1.6.4) explicitly states complete_manifest
-- does NOT validate sets_match. The CAS atomicity guarantee (Invariant 91) is the enforcement:
-- a CAS failure rolls back the entire transaction, preventing completion.
create or replace function public.amaia_sync_complete_manifest(p_mid uuid, p_rid uuid) returns void language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_dom text; v_l record; v_r record; v_m record; v_sk boolean:=false;
begin
  select domain_name into v_dom from public.amaia_sync_run_manifests where id=p_mid; if not found then raise exception 'manifest not found'; end if;
  select * into v_l from public.amaia_sync_leases where entity_name=v_dom for update;
  if v_l.owner_identity is null or v_l.lease_expires_at<=now() then raise exception 'lease invalid'; end if;
  select * into v_r from public.amaia_sync_runs where id=p_rid for update;
  if v_r.status is distinct from 'running' then raise exception 'run not running: %', v_r.status; end if;
  if v_r.owner_identity is distinct from v_l.owner_identity or v_r.lease_token is distinct from v_l.lease_token then raise exception 'cred mismatch'; end if;
  if v_r.domain_name is distinct from v_dom then raise exception 'domain mismatch'; end if;
  select * into v_m from public.amaia_sync_run_manifests where id=p_mid for update;
  if v_m.phase not in ('confirmed_compared','provisional_persisted') then raise exception 'wrong phase: %', v_m.phase; end if;
  if v_m.run_id is distinct from p_rid then raise exception 'run_id mismatch'; end if;
  if v_m.phase='provisional_persisted' and v_m.provisional_verified is distinct from true then raise exception 'provisional_verified must be true'; end if;
  if v_m.raw_max_id is not null and v_m.phase='confirmed_compared' and v_m.raw_max_id>coalesce(v_r.upper_bound::bigint,0) then v_sk:=true; end if;
  update public.amaia_sync_run_manifests set provisional_skipped=case when v_sk then true else null end,phase='comparison_complete' where id=p_mid;
end; $f$;
alter function public.amaia_sync_complete_manifest(uuid,uuid) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_complete_manifest(uuid,uuid) from public;
grant execute on function public.amaia_sync_complete_manifest(uuid,uuid) to amaia_sync_runtime;
