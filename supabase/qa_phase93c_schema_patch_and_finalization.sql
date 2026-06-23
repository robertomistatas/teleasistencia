-- QA Phase 9.3C v6. Transactional (ROLLBACK). Isolated fixtures. 18 sequential tests.
begin;

-- Grant role membership so SET LOCAL ROLE works within this transaction.
do $$ begin
  begin execute format('grant amaia_sync_runtime to %I', current_user); exception when others then null; end;
  begin execute format('grant amaia_sync_manifest_owner to %I', current_user); exception when others then null; end;
  begin execute format('grant amaia_sync_recovery_runtime to %I', current_user); exception when others then null; end;
end $$;

-- ============================================================
-- T01: Structure + seeds + roles
-- ============================================================
do $$ begin
  perform 1 from information_schema.tables where table_schema='public' and table_name='amaia_sync_domain_identity_policies'; if not found then raise exception 'T01'; end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='amaia_sync_manifest_identity_items'; if not found then raise exception 'T01'; end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='amaia_sync_dedup_identity_memberships'; if not found then raise exception 'T01'; end if;
  if (select count(*) from public.amaia_sync_domain_identity_policies)!=7 then raise exception 'T01: policies'; end if;
  perform 1 from public.amaia_sync_watermarks where entity_name='enfermedades'; if not found then raise exception 'T01'; end if;
  perform 1 from public.amaia_sync_watermarks where entity_name='medicamentos'; if not found then raise exception 'T01'; end if;
  perform 1 from public.amaia_sync_leases where entity_name='scheduler'; if not found then raise exception 'T01'; end if;
  perform 1 from pg_roles where rolname='amaia_sync_manifest_owner'; if not found then raise exception 'T01'; end if;
  perform 1 from pg_roles where rolname='amaia_sync_runtime'; if not found then raise exception 'T01'; end if;
  perform 1 from pg_roles where rolname='amaia_sync_recovery_runtime'; if not found then raise exception 'T01'; end if;
  raise notice 'T01 PASS: structure + seeds + roles';
end $$;

-- ============================================================
-- T02: Exact signatures + owner + secdef + search_path + no overloads
-- ============================================================
do $$
declare v_fn text; v_cnt int; v_sd boolean; v_ow text; v_cf text[]; v_args text;
  v_fns text[] := array['amaia_sync_finalize_source','amaia_sync_finalize_comparison','amaia_sync_finalize_provisional','amaia_sync_complete_manifest','amaia_sync_abandon_manifest','amaia_sync_advance_watermark_cas'];
begin
  foreach v_fn in array v_fns loop
    select count(*) into v_cnt from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname=v_fn;
    if v_cnt!=1 then raise exception 'T02: % has % sigs', v_fn, v_cnt; end if;
    select p.prosecdef,r.rolname,p.proconfig into v_sd,v_ow,v_cf from pg_proc p join pg_namespace n on p.pronamespace=n.oid join pg_roles r on p.proowner=r.oid where n.nspname='public' and p.proname=v_fn;
    if not v_sd then raise exception 'T02: % not secdef', v_fn; end if;
    if v_ow!='amaia_sync_manifest_owner' then raise exception 'T02: % owner=%', v_fn, v_ow; end if;
    if v_cf is null or not(v_cf::text like '%search_path%') then raise exception 'T02: % no search_path', v_fn; end if;
  end loop;
  select oidvectortypes(p.proargtypes) into v_args from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='amaia_sync_finalize_provisional';
  if v_args is distinct from 'uuid, uuid, bigint' then raise exception 'T02: prov sig=[%]', v_args; end if;
  select oidvectortypes(p.proargtypes) into v_args from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='amaia_sync_advance_watermark_cas';
  if v_args is distinct from 'text, text, bigint, bigint, uuid' then raise exception 'T02: cas sig=[%]', v_args; end if;
  perform 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='amaia_sync_finalize_provisional' and p.pronargs<>3;
  if found then raise exception 'T02: old overload'; end if;
  raise notice 'T02 PASS: signatures + owner + secdef';
end $$;

-- ============================================================
-- T03: PUBLIC has no EXECUTE (aclexplode with COALESCE for default ACL)
-- ============================================================
do $$
declare v_fn text; v_pub boolean;
  v_fns text[] := array['amaia_sync_finalize_source','amaia_sync_finalize_comparison','amaia_sync_finalize_provisional','amaia_sync_complete_manifest','amaia_sync_abandon_manifest','amaia_sync_advance_watermark_cas','amaia_sync_compute_set_hash'];
begin
  foreach v_fn in array v_fns loop
    select exists(
      select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where n.nspname='public' and p.proname=v_fn and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) into v_pub;
    if v_pub then raise exception 'T03: PUBLIC EXECUTE on %', v_fn; end if;
  end loop;
  if not has_table_privilege('amaia_sync_runtime','public.amaia_sync_run_manifests','INSERT') then raise exception 'T03: rt no ins'; end if;
  if has_table_privilege('amaia_sync_runtime','public.amaia_sync_run_manifests','UPDATE') then raise exception 'T03: rt has upd'; end if;
  if has_function_privilege('amaia_sync_runtime','public.amaia_sync_abandon_manifest(uuid,text,text)','EXECUTE') then raise exception 'T03: rt has abandon'; end if;
  if not has_function_privilege('amaia_sync_recovery_runtime','public.amaia_sync_abandon_manifest(uuid,text,text)','EXECUTE') then raise exception 'T03: recov no abandon'; end if;
  raise notice 'T03 PASS: ACL';
end $$;

-- ============================================================
-- T04: Runtime real RLS (SET LOCAL ROLE): create manifest, source OK, derived denied, UPDATE denied
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_f boolean;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t04','t04',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name) values('t04','running',v_cid,'logestado') returning id into v_rid;
  set local role amaia_sync_runtime;
  -- Runtime creates manifest (trigger #13 is SECURITY DEFINER, validates run/domain as manifest_owner)
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version)
    values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  -- Source item allowed
  insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(v_mid,'source',1,'source_amaia_id');
  -- Derived item denied by RLS (with check item_role='source') or trigger
  v_f:=false;
  begin insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(v_mid,'persisted',2,'source_amaia_id');
  exception when others then v_f:=true; end;
  if not v_f then reset role; raise exception 'T04: persisted accepted'; end if;
  -- UPDATE manifest denied
  v_f:=false;
  begin update public.amaia_sync_run_manifests set source_id_count=0 where id=v_mid;
  exception when others then v_f:=true; end;
  if not v_f then reset role; raise exception 'T04: update accepted'; end if;
  reset role;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T04 PASS: runtime RLS real';
end $$;

-- ============================================================
-- T05: Manifest INSERT rejects run/domain mismatch
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_f boolean:=false;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t05','t05',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name) values('t05','running',v_cid,'beneficiario') returning id into v_rid;
  begin insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1');
  exception when others then if sqlerrm like '%domain%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T05 FAIL'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T05 PASS: run/domain mismatch';
end $$;

-- ============================================================
-- T06: Empty incremental lifecycle
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_m boolean;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t06','t06',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t06','running',v_cid,'logestado',99,'t06','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t06',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t06',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  select public.amaia_sync_finalize_comparison(v_mid,v_rid) into v_m;
  if v_m is distinct from true then raise exception 'T06: match'; end if;
  perform public.amaia_sync_complete_manifest(v_mid,v_rid);
  perform 1 from public.amaia_sync_run_manifests where id=v_mid and phase='comparison_complete';
  if not found then raise exception 'T06'; end if;
  update public.amaia_sync_runs set status='success' where id=v_rid;
  raise notice 'T06 PASS: empty incremental';
end $$;

-- ============================================================
-- T07: Late source rejected
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_f boolean:=false;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t07','t07',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t07','running',v_cid,'logestado',99,'t07','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t07',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t07',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(v_mid,'source',100,'source_amaia_id');
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  begin insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(v_mid,'source',200,'source_amaia_id');
  exception when others then v_f:=true; end;
  if not v_f then raise exception 'T07 FAIL'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T07 PASS: late source';
end $$;

-- ============================================================
-- T08: Hash: numeric order (1|2|10) + canonical colon delimiter
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_hash text; v_ok text; v_bad text; v_ck1 text; v_ck2 text;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t08','t08',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t08','running',v_cid,'logestado',99,'t08','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t08',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t08',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(v_mid,'source',1,'source_amaia_id'),(v_mid,'source',2,'source_amaia_id'),(v_mid,'source',10,'source_amaia_id');
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  select source_id_hash into v_hash from public.amaia_sync_run_manifests where id=v_mid;
  v_ok:=encode(digest('1|2|10','sha256'),'hex');
  v_bad:=encode(digest('1|10|2','sha256'),'hex');
  if v_hash is distinct from v_ok then raise exception 'T08: numeric hash wrong'; end if;
  if v_hash=v_bad then raise exception 'T08: text-sorted!'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  -- Canonical colon test
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t08b','t08b',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t08b','running',v_cid,'enfermedades',99,'t08b','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('enfermedades','t08b',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t08b',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,canonicalization_version,hash_algorithm,serialization_version) values(v_rid,'enfermedades','canonical_dedup_key','dedup_key_v1','canonicalization_v1','sha256_colon_delimited_sorted','canonical_key_colon_v1') returning id into v_mid;
  v_ck1:='1:'||repeat('a',64)||':v1'; v_ck2:='2:'||repeat('b',64)||':v1';
  insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,identity_basis,canonical_key,beneficiary_amaia_id,canonical_hash,canonical_hash_version)
    values(v_mid,'source','canonical_dedup_key',v_ck1,1,repeat('a',64),'v1'),(v_mid,'source','canonical_dedup_key',v_ck2,2,repeat('b',64),'v1');
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  select source_id_hash into v_hash from public.amaia_sync_run_manifests where id=v_mid;
  v_ok:=encode(digest(v_ck1||':'||v_ck2,'sha256'),'hex');
  v_bad:=encode(digest(v_ck1||'|'||v_ck2,'sha256'),'hex');
  if v_hash is distinct from v_ok then raise exception 'T08: canonical hash wrong'; end if;
  if v_hash=v_bad then raise exception 'T08: canonical uses pipe!'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T08 PASS: hash numeric order + colon delimiter';
end $$;

-- ============================================================
-- T09: Exclusion full path (extra+excluded append-only + consumption + triggers #6/#7)
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_sid uuid; v_iid uuid; v_did uuid; v_m boolean;
  v_ext int; v_exc int; v_con int; v_f boolean;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t09','t09',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t09','running',v_cid,'logestado',99,'t09','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t09',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t09',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_alert_logs(amaia_id,action_date) values(50,now());
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  -- Exclusion subject + investigation + approved decision
  insert into public.amaia_sync_manifest_exclusion_subjects(domain_name,excluded_amaia_id) values('logestado',50) returning id into v_sid;
  insert into public.amaia_sync_manifest_exclusion_investigations(subject_id,investigation_seq,investigation_hash,domain_name,excluded_amaia_id,amaia_lookup_evidence,amaia_lookup_at)
    values(v_sid,1,'invhash50','logestado',50,'evidence',now()) returning id into v_iid;
  update public.amaia_sync_manifest_exclusion_subjects set current_investigation_id=v_iid,current_investigation_seq=1 where id=v_sid;
  insert into public.amaia_sync_manifest_exclusion_decisions(investigation_id,decision,decided_by,reason) values(v_iid,'approved','qa','ok') returning id into v_did;
  select public.amaia_sync_finalize_comparison(v_mid,v_rid) into v_m;
  if v_m is distinct from true then raise exception 'T09: sets_match'; end if;
  select count(*) into v_ext from public.amaia_sync_manifest_identity_items where manifest_id=v_mid and item_role='extra' and source_amaia_id=50;
  select count(*) into v_exc from public.amaia_sync_manifest_identity_items where manifest_id=v_mid and item_role='excluded' and source_amaia_id=50;
  if v_ext<>1 then raise exception 'T09: extra row'; end if;
  if v_exc<>1 then raise exception 'T09: excluded row'; end if;
  select count(*) into v_con from public.amaia_sync_manifest_exclusion_consumptions where consumed_by_manifest_id=v_mid;
  if v_con<>1 then raise exception 'T09: consumption'; end if;
  perform 1 from public.amaia_sync_run_manifests where id=v_mid and extra_ids @> '[50]'::jsonb;
  if not found then raise exception 'T09: extra_ids raw'; end if;
  -- Trigger #6 append-only
  v_f:=false; begin update public.amaia_sync_manifest_exclusion_investigations set investigation_hash='x' where id=v_iid; exception when others then v_f:=true; end;
  if not v_f then raise exception 'T09: inv mutated'; end if;
  -- Trigger #7 append-only
  v_f:=false; begin update public.amaia_sync_manifest_exclusion_decisions set decision='rejected' where id=v_did; exception when others then v_f:=true; end;
  if not v_f then raise exception 'T09: dec mutated'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T09 PASS: exclusion full path';
end $$;

-- ============================================================
-- T10: Canonical subject triggers (#9 fail-closed, domain policy, canonical immutability)
-- ============================================================
do $$
declare v_f boolean:=false; v_sid uuid;
begin
  -- Unknown domain => no policy => rejected
  begin insert into public.amaia_sync_manifest_exclusion_subjects(domain_name,excluded_amaia_id) values('nonexistent',1);
  exception when others then if sqlerrm like '%no policy%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T10: unknown domain'; end if;
  -- Dedup domain requires canonical key
  v_f:=false; begin insert into public.amaia_sync_manifest_exclusion_subjects(domain_name,excluded_amaia_id) values('enfermedades',1);
  exception when others then if sqlerrm like '%dedup domain requires%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T10: dedup+amaia_id'; end if;
  -- Valid canonical subject
  insert into public.amaia_sync_manifest_exclusion_subjects(domain_name,excluded_canonical_key) values('enfermedades','1:'||repeat('a',64)||':v1') returning id into v_sid;
  -- Canonical key immutable
  v_f:=false; begin update public.amaia_sync_manifest_exclusion_subjects set excluded_canonical_key='2:'||repeat('b',64)||':v1' where id=v_sid;
  exception when others then if sqlerrm like '%immutable%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T10: canonical mutated'; end if;
  raise notice 'T10 PASS: canonical triggers';
end $$;

-- ============================================================
-- T11: CAS hardening (success + all rejection modes)
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_f boolean;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t11','t11',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,upper_bound) values('t11','running',v_cid,'logestado',99,'t11','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t11',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t11',lease_token=99,lease_expires_at=now()+interval '5m';
  -- Success
  perform public.amaia_sync_advance_watermark_cas('logestado','id',0,100,v_rid);
  perform 1 from public.amaia_sync_watermarks where entity_name='logestado' and last_id=100;
  if not found then raise exception 'T11: no advance'; end if;
  -- Wrong cursor
  v_f:=false; begin perform public.amaia_sync_advance_watermark_cas('logestado','id',0,100,v_rid); exception when others then v_f:=true; end;
  if not v_f then raise exception 'T11: wrong cursor'; end if;
  update public.amaia_sync_watermarks set last_id=0 where entity_name='logestado';
  -- new != run.upper_bound
  v_f:=false; begin perform public.amaia_sync_advance_watermark_cas('logestado','id',0,50,v_rid); exception when others then if sqlerrm like '%upper_bound%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T11: new!=upper'; end if;
  -- timestamp type
  v_f:=false; begin perform public.amaia_sync_advance_watermark_cas('logestado','timestamp',0,100,v_rid); exception when others then if sqlerrm like '%only id%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T11: timestamp'; end if;
  -- null
  v_f:=false; begin perform public.amaia_sync_advance_watermark_cas(null,'id',0,100,v_rid); exception when others then if sqlerrm like '%null%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T11: null'; end if;
  -- expired lease
  update public.amaia_sync_leases set lease_expires_at=now()-interval '1m' where entity_name='logestado';
  v_f:=false; begin perform public.amaia_sync_advance_watermark_cas('logestado','id',0,100,v_rid); exception when others then if sqlerrm like '%lease%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T11: expired'; end if;
  update public.amaia_sync_leases set lease_expires_at=now()+interval '5m' where entity_name='logestado';
  -- wrong owner
  update public.amaia_sync_leases set owner_identity='other' where entity_name='logestado';
  v_f:=false; begin perform public.amaia_sync_advance_watermark_cas('logestado','id',0,100,v_rid); exception when others then if sqlerrm like '%cred%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T11: wrong owner'; end if;
  update public.amaia_sync_leases set owner_identity='t11' where entity_name='logestado';
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T11 PASS: CAS hardening';
end $$;

-- ============================================================
-- T12: Atomicity — comparison + failed CAS rollback
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_ph text; v_d int; v_c int; v_wm bigint;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t12','t12',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t12','running',v_cid,'logestado',99,'t12','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t12',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t12',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  -- Subtransaction: comparison succeeds then CAS fails -> all rolled back
  begin
    perform public.amaia_sync_finalize_comparison(v_mid,v_rid);
    perform public.amaia_sync_advance_watermark_cas('logestado','id',999,100,v_rid); -- wrong cursor
  exception when others then null; end;
  select phase into v_ph from public.amaia_sync_run_manifests where id=v_mid;
  if v_ph is distinct from 'source_fetched' then raise exception 'T12: phase=% not source_fetched', v_ph; end if;
  select count(*) into v_d from public.amaia_sync_manifest_identity_items where manifest_id=v_mid and item_role in ('persisted','missing','extra','excluded');
  if v_d<>0 then raise exception 'T12: % derived survived', v_d; end if;
  select count(*) into v_c from public.amaia_sync_manifest_exclusion_consumptions where consumed_by_manifest_id=v_mid;
  if v_c<>0 then raise exception 'T12: consumptions survived'; end if;
  select last_id into v_wm from public.amaia_sync_watermarks where entity_name='logestado';
  if v_wm is distinct from 0 then raise exception 'T12: watermark=%', v_wm; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T12 PASS: atomic rollback';
end $$;

-- ============================================================
-- T13: Provisional from real destination + verified=true
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_pc int; v_pv boolean; v_got text; v_exp text;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t13','t13',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t13','running',v_cid,'logestado',99,'t13','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t13',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t13',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_alert_logs(amaia_id,action_date) values(150,now()),(160,now());
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  perform public.amaia_sync_finalize_comparison(v_mid,v_rid);
  perform public.amaia_sync_finalize_provisional(v_mid,v_rid,200);
  select provisional_id_count,provisional_verified,provisional_id_hash into v_pc,v_pv,v_got from public.amaia_sync_run_manifests where id=v_mid;
  if v_pc<>2 then raise exception 'T13: count=%', v_pc; end if;
  if v_pv is distinct from true then raise exception 'T13: not verified'; end if;
  v_exp:=encode(digest('150|160','sha256'),'hex');
  if v_got is distinct from v_exp then raise exception 'T13: hash'; end if;
  perform public.amaia_sync_complete_manifest(v_mid,v_rid);
  perform 1 from public.amaia_sync_run_manifests where id=v_mid and phase='comparison_complete';
  if not found then raise exception 'T13: not complete'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T13 PASS: provisional from destination';
end $$;

-- ============================================================
-- T14: Gate rejects provisional_verified=false (via direct phase advance)
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_f boolean:=false;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t14','t14',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t14','running',v_cid,'logestado',99,'t14','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t14',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t14',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  perform public.amaia_sync_finalize_comparison(v_mid,v_rid);
  -- Direct phase advance as manifest_owner: confirmed_compared -> provisional_persisted with verified=false
  -- Trigger #4 allows this transition (returns NEW without checking provisional_verified)
  set local role amaia_sync_manifest_owner;
  update public.amaia_sync_run_manifests set phase='provisional_persisted', provisional_verified=false, provisional_upper_bound=200 where id=v_mid;
  reset role;
  -- Now complete_manifest should reject because provisional_verified != true
  begin perform public.amaia_sync_complete_manifest(v_mid,v_rid);
  exception when others then if sqlerrm like '%provisional_verified%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T14: gate did not reject'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T14 PASS: provisional_verified gate';
end $$;

-- ============================================================
-- T15: complete_manifest rejects expired lease
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_f boolean:=false;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t15','t15',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t15','running',v_cid,'logestado',99,'t15','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t15',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t15',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  perform public.amaia_sync_finalize_comparison(v_mid,v_rid);
  update public.amaia_sync_leases set lease_expires_at=now()-interval '1m' where entity_name='logestado';
  begin perform public.amaia_sync_complete_manifest(v_mid,v_rid); exception when others then if sqlerrm like '%lease%' then v_f:=true; end if; end;
  if not v_f then raise exception 'T15 FAIL'; end if;
  update public.amaia_sync_leases set lease_expires_at=now()+interval '5m' where entity_name='logestado';
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T15 PASS: expired lease';
end $$;

-- ============================================================
-- T16: Recovery abandon under SET LOCAL ROLE
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_ph text;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t16','t16',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity) values('t16','failed',v_cid,'logestado',99,'t16') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t16',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t16',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  set local role amaia_sync_recovery_runtime;
  perform public.amaia_sync_abandon_manifest(v_mid,'recovery:qa','run failed');
  reset role;
  select phase into v_ph from public.amaia_sync_run_manifests where id=v_mid;
  if v_ph<>'abandoned' then raise exception 'T16: %', v_ph; end if;
  raise notice 'T16 PASS: recovery abandon';
end $$;

-- ============================================================
-- T17: Late derived after confirmed_compared rejected (even as manifest_owner)
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_f boolean:=false;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t17','t17',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t17','running',v_cid,'logestado',99,'t17','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t17',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t17',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  perform public.amaia_sync_finalize_comparison(v_mid,v_rid);
  set local role amaia_sync_manifest_owner;
  begin insert into public.amaia_sync_manifest_identity_items(manifest_id,item_role,source_amaia_id,identity_basis) values(v_mid,'persisted',77,'source_amaia_id');
  exception when others then v_f:=true; end;
  reset role;
  if not v_f then raise exception 'T17 FAIL'; end if;
  update public.amaia_sync_runs set status='failed' where id=v_rid;
  raise notice 'T17 PASS: late derived';
end $$;

-- ============================================================
-- T18: Terminal rejects further completion + runtime contract note
-- ============================================================
do $$
declare v_cid uuid; v_rid uuid; v_mid uuid; v_f boolean:=false;
begin
  insert into public.amaia_sync_cycles(trigger_type,owner_identity,scheduler_owner_identity,scheduler_lease_token) values('manual','t18','t18',0) returning id into v_cid;
  insert into public.amaia_sync_runs(job_name,status,cycle_id,domain_name,lease_token,owner_identity,lower_bound,upper_bound) values('t18','running',v_cid,'logestado',99,'t18','0','100') returning id into v_rid;
  insert into public.amaia_sync_leases(entity_name,owner_identity,lease_token,lease_expires_at,heartbeat_at,acquired_at) values('logestado','t18',99,now()+interval '5m',now(),now()) on conflict(entity_name) do update set owner_identity='t18',lease_token=99,lease_expires_at=now()+interval '5m';
  insert into public.amaia_sync_run_manifests(run_id,domain_name,identity_basis,identity_version,hash_algorithm,serialization_version) values(v_rid,'logestado','source_amaia_id','source_id_v1','sha256_pipe_delimited_sorted','integer_decimal_v1') returning id into v_mid;
  perform public.amaia_sync_finalize_source(v_mid,v_rid);
  perform public.amaia_sync_finalize_comparison(v_mid,v_rid);
  -- Runtime contract: CAS before complete. Here we call CAS successfully first.
  perform public.amaia_sync_advance_watermark_cas('logestado','id',0,100,v_rid);
  perform public.amaia_sync_complete_manifest(v_mid,v_rid);
  -- Terminal: second complete rejected
  begin perform public.amaia_sync_complete_manifest(v_mid,v_rid); exception when others then v_f:=true; end;
  if not v_f then raise exception 'T18 FAIL'; end if;
  -- Restore watermark for next tests
  update public.amaia_sync_watermarks set last_id=0 where entity_name='logestado';
  update public.amaia_sync_runs set status='success' where id=v_rid;
  raise notice 'T18 PASS: terminal + runtime CAS contract';
end $$;

rollback;
