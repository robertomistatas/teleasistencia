-- AMAIA-SYNC Phase 9.3C v6.3 — 12 finalize comparison
-- Ultra-granular split from approved v6/v6.2. Semantics unchanged.
-- Protocol: AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)

-- finalize_comparison
create or replace function public.amaia_sync_finalize_comparison(p_mid uuid, p_rid uuid) returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $f$
declare v_dom text; v_basis text; v_l record; v_r record; v_m record; v_lb bigint; v_ub bigint;
  v_sh record; v_ph record; v_mc int; v_ec int; v_xc int; v_sm boolean; v_mj jsonb; v_ej jsonb; rec record;
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
  if v_m.phase is distinct from 'source_fetched' then raise exception 'expected source_fetched'; end if;
  if v_m.run_id is distinct from p_rid then raise exception 'run_id mismatch'; end if;
  v_lb:=coalesce(v_r.lower_bound::bigint,0); v_ub:=coalesce(v_r.upper_bound::bigint,0);

  if v_basis='source_amaia_id' then
    -- Persisted from real destination
    if v_dom='beneficiario' then insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) select p_mid,'persisted',amaia_id,'source_amaia_id' from public.amaia_beneficiaries where amaia_id>v_lb and amaia_id<=v_ub;
    elsif v_dom='red' then insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) select p_mid,'persisted',amaia_id,'source_amaia_id' from public.amaia_support_network where amaia_id>v_lb and amaia_id<=v_ub;
    elsif v_dom='control_llamadas' then insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) select p_mid,'persisted',amaia_id,'source_amaia_id' from public.amaia_call_logs where amaia_id>v_lb and amaia_id<=v_ub;
    elsif v_dom='logestado' then insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) select p_mid,'persisted',amaia_id,'source_amaia_id' from public.amaia_alert_logs where amaia_id>v_lb and amaia_id<=v_ub;
    elsif v_dom='alerta' then insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) select p_mid,'persisted',amaia_id,'source_amaia_id' from public.amaia_alerts where amaia_id>v_lb and amaia_id<=v_ub;
    else raise exception 'unknown source_amaia_id domain: %', v_dom; end if;
    -- Missing
    insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis)
      select p_mid,'missing',s.source_amaia_id,'source_amaia_id' from public.amaia_sync_manifest_identity_items s
      where s.manifest_id=p_mid and s.item_role='source' and not exists(select 1 from public.amaia_sync_manifest_identity_items p where p.manifest_id=p_mid and p.item_role='persisted' and p.source_amaia_id=s.source_amaia_id);
    -- Extra (append-only separate rows)
    insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis)
      select p_mid,'extra',p.source_amaia_id,'source_amaia_id' from public.amaia_sync_manifest_identity_items p
      where p.manifest_id=p_mid and p.item_role='persisted' and not exists(select 1 from public.amaia_sync_manifest_identity_items s where s.manifest_id=p_mid and s.item_role='source' and s.source_amaia_id=p.source_amaia_id);
    -- Exclusions: lock subjects in total order ORDER BY identity_basis, canonical_identity.
    -- canonical_identity: for source_amaia_id basis = zero-padded amaia_id; for dedup = canonical_key.
    for rec in (
      select source_amaia_id as eid, canonical_key as eck, identity_basis as ebasis
      from public.amaia_sync_manifest_identity_items
      where manifest_id=p_mid and item_role='extra'
      order by identity_basis asc, coalesce(canonical_key, lpad(source_amaia_id::text,20,'0')) asc
    ) loop
      declare v_s record; v_i record; v_d record;
      begin
        if rec.ebasis='source_amaia_id' then
          select * into v_s from public.amaia_sync_manifest_exclusion_subjects where domain_name=v_dom and excluded_amaia_id=rec.eid for update;
        else
          select * into v_s from public.amaia_sync_manifest_exclusion_subjects where domain_name=v_dom and excluded_canonical_key=rec.eck for update;
        end if;
        if found and v_s.current_investigation_id is not null then
          select * into v_i from public.amaia_sync_manifest_exclusion_investigations where id=v_s.current_investigation_id;
          if found then select * into v_d from public.amaia_sync_manifest_exclusion_decisions where investigation_id=v_i.id order by decision_seq desc limit 1;
            if found and v_d.decision='approved' then
              if rec.ebasis='source_amaia_id' then
                insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(p_mid,'excluded',rec.eid,'source_amaia_id');
              else
                insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,identity_basis,canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version)
                  select p_mid,'excluded','canonical_dedup_key',src.canonical_key,src.beneficiary_amaia_id,src.canonical_hash,src.canonical_hash_version
                  from public.amaia_sync_manifest_identity_items src where src.manifest_id=p_mid and src.item_role='extra' and src.canonical_key=rec.eck limit 1;
              end if;
            end if;
          end if;
        end if;
      end;
    end loop;
  elsif v_basis='canonical_dedup_key' then
    -- Dedup: P_check = dest keys IN S_raw.
    if v_dom='enfermedades' then
      insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,identity_basis,canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version)
        select distinct p_mid,'persisted','canonical_dedup_key',s.canonical_key,s.beneficiary_amaia_id,s.canonical_hash,s.canonical_hash_version
        from (select distinct canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='source') s
        where exists(select 1 from public.amaia_health_conditions h where h.beneficiary_amaia_id=s.beneficiary_amaia_id and h.hash=s.canonical_hash and h.hash_version=s.canonical_hash_version);
    elsif v_dom='medicamentos' then
      insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,identity_basis,canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version)
        select distinct p_mid,'persisted','canonical_dedup_key',s.canonical_key,s.beneficiary_amaia_id,s.canonical_hash,s.canonical_hash_version
        from (select distinct canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='source') s
        where exists(select 1 from public.amaia_medications m where m.beneficiary_amaia_id=s.beneficiary_amaia_id and m.hash=s.canonical_hash and m.hash_version=s.canonical_hash_version);
    else raise exception 'unknown dedup domain: %', v_dom; end if;
    -- Missing canonical
    insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,identity_basis,canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version)
      select distinct p_mid,'missing','canonical_dedup_key',s.canonical_key,s.beneficiary_amaia_id,s.canonical_hash,s.canonical_hash_version
      from public.amaia_sync_manifest_identity_items s where s.manifest_id=p_mid and s.item_role='source'
      and not exists(select 1 from public.amaia_sync_manifest_identity_items p where p.manifest_id=p_mid and p.item_role='persisted' and p.canonical_key=s.canonical_key);
    -- V1 FAIL-CLOSED: Dedup incremental does NOT compute extras (reconciliation handles them).
    -- If extras were somehow inserted (e.g., by a bug), reject rather than silently ignore.
    -- extras are not inserted in the dedup branch above, but verify defensively:
    perform 1 from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='extra' and identity_basis='canonical_dedup_key';
    if found then raise exception 'canonical extras detected in dedup incremental — not supported in V1. Use reconciliation.'; end if;
  else raise exception 'unknown basis: %', v_basis; end if;

  select * into v_sh from public.amaia_sync_compute_set_hash(p_mid,'source',v_basis);
  select * into v_ph from public.amaia_sync_compute_set_hash(p_mid,'persisted',v_basis);
  select count(*) into v_mc from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='missing';
  select count(*) into v_ec from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='extra';
  select count(*) into v_xc from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='excluded';
  v_sm:=(v_mc=0 and (v_ec-v_xc)=0);

  -- extra_ids preserves ALL raw extras (the full P\S discrepancy set), INCLUDING those
  -- later approved/excluded. Excluded rows are tracked separately via item_role='excluded';
  -- sets_match nets them out as (extra_count - excluded_count). extra_ids is raw evidence.
  if v_basis='source_amaia_id' then
    select coalesce(jsonb_agg(source_amaia_id order by source_amaia_id),'[]'::jsonb) into v_mj from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='missing';
    select coalesce(jsonb_agg(source_amaia_id order by source_amaia_id),'[]'::jsonb) into v_ej from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='extra';
  else
    select coalesce(jsonb_agg(canonical_key order by canonical_key),'[]'::jsonb) into v_mj from public.amaia_sync_manifest_identity_items where manifest_id=p_mid and item_role='missing';
    v_ej:='[]'::jsonb;
  end if;

  update public.amaia_sync_run_manifests set persisted_id_count=v_ph.item_count,persisted_id_hash=v_ph.item_hash,sets_match=v_sm,missing_ids=v_mj,extra_ids=v_ej,verified_at=now(),phase='confirmed_compared' where id=p_mid;

  -- Exclusion consumptions AFTER sets_match written (trigger #8 requires true).
  -- Same total order ORDER BY identity_basis, canonical_identity as the marking loop.
  if v_sm and v_xc>0 then
    for rec in (
      select source_amaia_id as eid, canonical_key as eck, identity_basis as ebasis
      from public.amaia_sync_manifest_identity_items
      where manifest_id=p_mid and item_role='excluded'
      order by identity_basis asc, coalesce(canonical_key, lpad(source_amaia_id::text,20,'0')) asc
    ) loop
      declare v_s2 record; v_i2 record; v_d2 record;
      begin
        if rec.ebasis='source_amaia_id' then
          select * into v_s2 from public.amaia_sync_manifest_exclusion_subjects where domain_name=v_dom and excluded_amaia_id=rec.eid for update;
        else
          select * into v_s2 from public.amaia_sync_manifest_exclusion_subjects where domain_name=v_dom and excluded_canonical_key=rec.eck for update;
        end if;
        if found and v_s2.current_investigation_id is not null then
          select * into v_i2 from public.amaia_sync_manifest_exclusion_investigations where id=v_s2.current_investigation_id;
          select * into v_d2 from public.amaia_sync_manifest_exclusion_decisions where investigation_id=v_i2.id order by decision_seq desc limit 1;
          if found and v_d2.decision='approved' then
            insert into public.amaia_sync_manifest_exclusion_consumptions(investigation_id,decision_id,consumed_by_run_id,consumed_by_manifest_id,investigation_hash_at_consumption) values(v_i2.id,v_d2.id,p_rid,p_mid,v_i2.investigation_hash);
          end if;
        end if;
      end;
    end loop;
  end if;
  return v_sm;
end; $f$;
alter function public.amaia_sync_finalize_comparison(uuid,uuid) owner to amaia_sync_manifest_owner;
revoke execute on function public.amaia_sync_finalize_comparison(uuid,uuid) from public;
grant execute on function public.amaia_sync_finalize_comparison(uuid,uuid) to amaia_sync_runtime;
