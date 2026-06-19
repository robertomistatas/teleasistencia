-- QA: Phase 9.3B AMAIA-SYNC Runtime DDL — v2
-- Transactional, non-destructive. All tests inside ROLLBACK.
-- Blocker 2: safe negative test pattern (v_failed_as_expected)
-- Blocker 3: real run IDs for FK isolation
-- Blocker 4: full fencing CAS tests
-- Blocker 5: exclusion consumption, subject lifecycle, manifest guards, RLS policies, rollback chain

begin;

-- ============================================================
-- SHARED FIXTURES
-- ============================================================
do $$
declare
  v_cycle_id uuid;
  v_run_a_id uuid;
  v_run_b_id uuid;
begin
  insert into public.amaia_sync_cycles (trigger_type, owner_identity)
  values ('manual', 'qa_fixture') returning id into v_cycle_id;
  insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
  values ('qa_run_a', 'running', v_cycle_id, 'logestado') returning id into v_run_a_id;
  insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
  values ('qa_run_b', 'running', v_cycle_id, 'alerta') returning id into v_run_b_id;
  -- Store IDs in temp table for other tests
  create temp table if not exists qa_ids (key text primary key, val uuid);
  insert into qa_ids values ('cycle', v_cycle_id), ('run_a', v_run_a_id), ('run_b', v_run_b_id)
    on conflict (key) do update set val = excluded.val;
end $$;

-- ============================================================
-- T01: All 11 tables exist
-- ============================================================
do $$
declare
  v_tables text[] := array[
    'amaia_sync_cycles', 'amaia_sync_run_manifests',
    'amaia_sync_workset_exceptions', 'amaia_sync_workset_exception_decisions',
    'amaia_sync_workset_exception_consumptions', 'amaia_sync_reconciliation_segments',
    'amaia_sync_alert_remediation_queue', 'amaia_sync_manifest_exclusion_subjects',
    'amaia_sync_manifest_exclusion_investigations', 'amaia_sync_manifest_exclusion_decisions',
    'amaia_sync_manifest_exclusion_consumptions'
  ];
  v_t text; v_count integer := 0;
begin
  foreach v_t in array v_tables loop
    perform 1 from information_schema.tables where table_schema='public' and table_name=v_t;
    if not found then raise exception 'T01 FAIL: table % not found', v_t; end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'T01 PASS: all 11 tables exist (% verified)', v_count;
end $$;

-- ============================================================
-- T02: 9 triggers exist
-- ============================================================
do $$
declare
  v_triggers text[] := array[
    'trg_amaia_sync_wse_append_only', 'trg_amaia_sync_wse_decisions_guard',
    'trg_amaia_sync_wse_consumptions_guard', 'trg_amaia_sync_manifest_phase_guard',
    'trg_amaia_sync_remediation_state_guard', 'trg_amaia_sync_excl_inv_guard',
    'trg_amaia_sync_excl_decisions_guard', 'trg_amaia_sync_excl_consumptions_guard',
    'trg_amaia_sync_excl_subject_progression_guard'
  ];
  v_t text; v_count integer := 0;
begin
  foreach v_t in array v_triggers loop
    perform 1 from information_schema.triggers where trigger_schema='public' and trigger_name=v_t;
    if not found then raise exception 'T02 FAIL: trigger % not found', v_t; end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'T02 PASS: all 9 triggers exist (% verified)', v_count;
end $$;

-- ============================================================
-- T03: Circular FK exists
-- ============================================================
do $$
begin
  perform 1 from information_schema.table_constraints
    where constraint_name='fk_current_investigation' and table_name='amaia_sync_manifest_exclusion_subjects';
  if not found then raise exception 'T03 FAIL: circular FK not found'; end if;
  raise notice 'T03 PASS: circular FK fk_current_investigation exists';
end $$;

-- ============================================================
-- T04: 6 deployed table columns exist
-- ============================================================
do $$
declare
  v_checks text[] := array[
    'amaia_sync_runs:cycle_id', 'amaia_sync_runs:upstream_run_id', 'amaia_sync_runs:blocked_entity_name',
    'amaia_sync_reconciliation_results:cycle_id', 'amaia_sync_reconciliation_results:scope_descriptor',
    'amaia_sync_reconciliation_results:result_status'
  ];
  v_c text; v_parts text[];
begin
  foreach v_c in array v_checks loop
    v_parts := string_to_array(v_c, ':');
    perform 1 from information_schema.columns where table_name=v_parts[1] and column_name=v_parts[2];
    if not found then raise exception 'T04 FAIL: %.% missing', v_parts[1], v_parts[2]; end if;
  end loop;
  raise notice 'T04 PASS: all 6 deployed table columns exist';
end $$;

-- ============================================================
-- T05: 12 reconciliation segments seeded
-- ============================================================
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.amaia_sync_reconciliation_segments
    where domain_name='alerta' and tier='tier4';
  if v_count != 12 then raise exception 'T05 FAIL: expected 12, found %', v_count; end if;
  raise notice 'T05 PASS: 12 reconciliation segments seeded';
end $$;

-- ============================================================
-- T06: Watermark corrected to exact values
-- ============================================================
do $$
declare v_type text; v_last_id bigint; v_last_ts timestamptz; v_expr text;
begin
  select watermark_type, last_id, last_timestamp, watermark_expr
    into v_type, v_last_id, v_last_ts, v_expr
    from public.amaia_sync_watermarks where entity_name='alerta';
  if v_type != 'id' then raise exception 'T06 FAIL: type=%', v_type; end if;
  if v_last_id != 0 then raise exception 'T06 FAIL: last_id=%', v_last_id; end if;
  if v_last_ts is not null then raise exception 'T06 FAIL: last_timestamp not NULL'; end if;
  if v_expr is null then raise exception 'T06 FAIL: watermark_expr is NULL'; end if;
  raise notice 'T06 PASS: watermark corrected';
end $$;

-- ============================================================
-- T07: Subject INSERT with seq=5 rejected (safe negative pattern)
-- ============================================================
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.amaia_sync_manifest_exclusion_subjects
      (domain_name, excluded_amaia_id, current_investigation_seq) values ('t07', 1, 5);
  exception when others then
    if sqlerrm like '%investigation_seq%' then v_failed := true;
    else raise exception 'T07 FAIL: unexpected error: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T07 FAIL: INSERT with seq=5 was NOT rejected'; end if;
  raise notice 'T07 PASS: INSERT with seq=5 rejected by trigger';
end $$;

-- ============================================================
-- T08: Subject full lifecycle (valid)
-- ============================================================
do $$
declare v_subj_id uuid; v_inv_id uuid;
begin
  insert into public.amaia_sync_manifest_exclusion_subjects (domain_name, excluded_amaia_id)
  values ('t08', 888) returning id into v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at)
  values (v_subj_id, 1, 'h1', 't08', 888, 'test', now()) returning id into v_inv_id;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv_id, current_investigation_seq=1 where id=v_subj_id;
  raise notice 'T08 PASS: subject lifecycle NULL/0 → I1/1';
end $$;

-- ============================================================
-- T08b: Subject seq regression rejected
-- ============================================================
do $$
declare v_subj_id uuid; v_inv1 uuid; v_inv2 uuid; v_failed boolean := false;
begin
  insert into public.amaia_sync_manifest_exclusion_subjects (domain_name, excluded_amaia_id)
  values ('t08b', 887) returning id into v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at)
  values (v_subj_id, 1, 'h1b', 't08b', 887, 'test', now()) returning id into v_inv1;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv1, current_investigation_seq=1 where id=v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at)
  values (v_subj_id, 2, 'h2b', 't08b', 887, 'test2', now()) returning id into v_inv2;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv2, current_investigation_seq=2 where id=v_subj_id;
  -- Try regression back to seq=1
  begin
    update public.amaia_sync_manifest_exclusion_subjects
      set current_investigation_id=v_inv1, current_investigation_seq=1 where id=v_subj_id;
  exception when others then
    if sqlerrm like '%cannot decrease%' or sqlerrm like '%increment by exactly 1%' then v_failed := true;
    else raise exception 'T08b FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T08b FAIL: seq regression was NOT rejected'; end if;
  raise notice 'T08b PASS: seq regression rejected';
end $$;

-- ============================================================
-- T08c: Subject clearing current_investigation_id rejected
-- ============================================================
do $$
declare v_subj_id uuid; v_inv_id uuid; v_failed boolean := false;
begin
  insert into public.amaia_sync_manifest_exclusion_subjects (domain_name, excluded_amaia_id)
  values ('t08c', 886) returning id into v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at)
  values (v_subj_id, 1, 'h1c', 't08c', 886, 'test', now()) returning id into v_inv_id;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv_id, current_investigation_seq=1 where id=v_subj_id;
  begin
    update public.amaia_sync_manifest_exclusion_subjects
      set current_investigation_id=null, current_investigation_seq=1 where id=v_subj_id;
  exception when others then
    if sqlerrm like '%cannot be cleared%' then v_failed := true;
    else raise exception 'T08c FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T08c FAIL: clearing investigation was NOT rejected'; end if;
  raise notice 'T08c PASS: clearing current_investigation_id rejected';
end $$;

-- ============================================================
-- T08d: Subject seq change without investigation change rejected
-- ============================================================
do $$
declare v_subj_id uuid; v_inv_id uuid; v_failed boolean := false;
begin
  insert into public.amaia_sync_manifest_exclusion_subjects (domain_name, excluded_amaia_id)
  values ('t08d', 885) returning id into v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at)
  values (v_subj_id, 1, 'h1d', 't08d', 885, 'test', now()) returning id into v_inv_id;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv_id, current_investigation_seq=1 where id=v_subj_id;
  begin
    update public.amaia_sync_manifest_exclusion_subjects
      set current_investigation_seq=2 where id=v_subj_id;
  exception when others then
    if sqlerrm like '%cannot change seq without%' then v_failed := true;
    else raise exception 'T08d FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T08d FAIL: seq change without inv change was NOT rejected'; end if;
  raise notice 'T08d PASS: seq change without investigation change rejected';
end $$;

-- ============================================================
-- T09: Manifest backward transition rejected
-- ============================================================
do $$
declare v_run_a uuid; v_manifest_id uuid; v_failed boolean := false;
begin
  select val into v_run_a from qa_ids where key='run_a';
  insert into public.amaia_sync_run_manifests (run_id, domain_name, source_id_count, source_id_hash)
  values (v_run_a, 'logestado', 5, 'abc') returning id into v_manifest_id;
  update public.amaia_sync_run_manifests
    set phase='confirmed_compared', persisted_id_count=5, persisted_id_hash='abc',
        sets_match=true, verified_at=now()
    where id=v_manifest_id;
  begin
    update public.amaia_sync_run_manifests set phase='source_fetched' where id=v_manifest_id;
  exception when others then
    if sqlerrm like '%invalid phase transition%' then v_failed := true;
    else raise exception 'T09 FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T09 FAIL: backward transition was NOT rejected'; end if;
  raise notice 'T09 PASS: backward phase transition rejected';
end $$;

-- ============================================================
-- T09b: Manifest modify column outside allowlist during valid transition
-- ============================================================
do $$
declare v_cycle2 uuid; v_run2 uuid; v_m_id uuid; v_failed boolean := false;
begin
  insert into public.amaia_sync_cycles (trigger_type, owner_identity)
  values ('manual', 'qa_t09b') returning id into v_cycle2;
  insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
  values ('qa_t09b', 'running', v_cycle2, 'logestado') returning id into v_run2;
  insert into public.amaia_sync_run_manifests (run_id, domain_name, source_id_count, source_id_hash)
  values (v_run2, 'logestado', 3, 'def') returning id into v_m_id;
  -- Try to write provisional columns during source_fetched → confirmed_compared
  begin
    update public.amaia_sync_run_manifests
      set phase='confirmed_compared', persisted_id_count=3, persisted_id_hash='def',
          sets_match=true, verified_at=now(),
          provisional_upper_bound=999
      where id=v_m_id;
  exception when others then
    if sqlerrm like '%provisional_upper_bound not writable%' then v_failed := true;
    else raise exception 'T09b FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T09b FAIL: out-of-allowlist column write was NOT rejected'; end if;
  raise notice 'T09b PASS: column outside allowlist rejected during transition';
end $$;

-- ============================================================
-- T09c: Manifest update after terminal rejected
-- ============================================================
do $$
declare v_cycle3 uuid; v_run3 uuid; v_m_id uuid; v_failed boolean := false;
begin
  insert into public.amaia_sync_cycles (trigger_type, owner_identity)
  values ('manual', 'qa_t09c') returning id into v_cycle3;
  insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
  values ('qa_t09c', 'running', v_cycle3, 'logestado') returning id into v_run3;
  insert into public.amaia_sync_run_manifests (run_id, domain_name, source_id_count, source_id_hash)
  values (v_run3, 'logestado', 2, 'ghi') returning id into v_m_id;
  update public.amaia_sync_run_manifests
    set phase='confirmed_compared', persisted_id_count=2, persisted_id_hash='ghi',
        sets_match=true, verified_at=now()
    where id=v_m_id;
  update public.amaia_sync_run_manifests set phase='comparison_complete' where id=v_m_id;
  begin
    update public.amaia_sync_run_manifests set phase='abandoned' where id=v_m_id;
  exception when others then
    if sqlerrm like '%terminal phase%' then v_failed := true;
    else raise exception 'T09c FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T09c FAIL: update after terminal was NOT rejected'; end if;
  raise notice 'T09c PASS: update after terminal phase rejected';
end $$;

-- ============================================================
-- T10a: Remediation success with different run (FK-valid but trigger-rejected)
-- ============================================================
do $$
declare v_run_a uuid; v_run_b uuid; v_rem_id uuid; v_failed boolean := false;
begin
  select val into v_run_a from qa_ids where key='run_a';
  select val into v_run_b from qa_ids where key='run_b';
  insert into public.amaia_sync_alert_remediation_queue
    (source_type, alert_amaia_id, origin_run_id)
  values ('manual', 100, v_run_a) returning id into v_rem_id;
  update public.amaia_sync_alert_remediation_queue
    set status='claimed', claimed_by_run_id=v_run_a, claimed_at=now(),
        claim_expires_at=now()+interval '5 minutes'
    where id=v_rem_id;
  -- Use run_b (real existing run, different from claimed_by=run_a)
  begin
    update public.amaia_sync_alert_remediation_queue
      set status='success', consumed_by_run_id=v_run_b, processed_at=now(), claim_expires_at=null
      where id=v_rem_id;
  exception when others then
    if sqlerrm like '%consumed_by_run_id must equal claimed_by_run_id%' then v_failed := true;
    else raise exception 'T10a FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T10a FAIL: success with wrong run was NOT rejected by trigger'; end if;
  raise notice 'T10a PASS: success with different consumed_by_run_id rejected by trigger #5 (not FK)';
end $$;

-- ============================================================
-- T10b: Remediation success without clearing claim_expires_at
-- ============================================================
do $$
declare v_run_a uuid; v_rem_id uuid; v_failed boolean := false;
begin
  select val into v_run_a from qa_ids where key='run_a';
  insert into public.amaia_sync_alert_remediation_queue
    (source_type, alert_amaia_id, origin_run_id)
  values ('manual', 101, v_run_a) returning id into v_rem_id;
  update public.amaia_sync_alert_remediation_queue
    set status='claimed', claimed_by_run_id=v_run_a, claimed_at=now(),
        claim_expires_at=now()+interval '5 minutes'
    where id=v_rem_id;
  begin
    update public.amaia_sync_alert_remediation_queue
      set status='success', consumed_by_run_id=v_run_a, processed_at=now()
      where id=v_rem_id;
  exception when others then
    if sqlerrm like '%claim_expires_at must be cleared%' then v_failed := true;
    else raise exception 'T10b FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T10b FAIL: success without clearing claim_expires_at was NOT rejected'; end if;
  raise notice 'T10b PASS: success without clearing claim_expires_at rejected';
end $$;

-- ============================================================
-- T11: Watermark CAS — stale runtime type → 0 rows
-- ============================================================
do $$
declare v_affected integer;
begin
  update public.amaia_sync_watermarks set last_timestamp=now()
    where entity_name='alerta' and watermark_type='timestamp' and last_id is null;
  get diagnostics v_affected = row_count;
  if v_affected != 0 then raise exception 'T11 FAIL: stale type affected % rows', v_affected; end if;
  raise notice 'T11 PASS: stale watermark_type=timestamp → 0 rows';
end $$;

-- ============================================================
-- T12: Watermark CAS — wrong cursor → 0 rows
-- ============================================================
do $$
declare v_affected integer;
begin
  update public.amaia_sync_watermarks set last_id=100
    where entity_name='alerta' and watermark_type='id' and last_id=999;
  get diagnostics v_affected = row_count;
  if v_affected != 0 then raise exception 'T12 FAIL: wrong cursor affected % rows', v_affected; end if;
  raise notice 'T12 PASS: wrong cursor → 0 rows';
end $$;

-- ============================================================
-- T13: Watermark CAS — valid monotonic → 1 row
-- ============================================================
do $$
declare v_affected integer;
begin
  update public.amaia_sync_watermarks set last_id=100
    where entity_name='alerta' and watermark_type='id' and last_id=0;
  get diagnostics v_affected = row_count;
  if v_affected != 1 then raise exception 'T13 FAIL: valid advance affected % rows', v_affected; end if;
  raise notice 'T13 PASS: valid monotonic advance → 1 row';
end $$;

-- ============================================================
-- T14: Append-only — UPDATE on exception rejected
-- ============================================================
do $$
declare v_exc_id uuid; v_failed boolean := false;
begin
  insert into public.amaia_sync_workset_exceptions
    (domain_name, source_amaia_id, source_row_hash, hash_version,
     invalidity_type, amaia_lookup_evidence, amaia_lookup_at)
  values ('alerta', 1, 'h1', 'logestado_exception_v2', 'phantom_not_in_amaia', 'not found', now())
  returning id into v_exc_id;
  begin
    update public.amaia_sync_workset_exceptions set amaia_lookup_evidence='tampered' where id=v_exc_id;
  exception when others then
    if sqlerrm like '%append-only%' then v_failed := true;
    else raise exception 'T14 FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T14 FAIL: UPDATE on append-only table was NOT rejected'; end if;
  raise notice 'T14 PASS: UPDATE on workset_exceptions rejected';
end $$;

-- ============================================================
-- T15: RLS + policies: strict structural validation per table
-- Validates the exact approved policy pattern on all 11 tables.
-- ============================================================
do $$
declare
  v_tables text[] := array[
    'amaia_sync_cycles', 'amaia_sync_run_manifests',
    'amaia_sync_workset_exceptions', 'amaia_sync_workset_exception_decisions',
    'amaia_sync_workset_exception_consumptions', 'amaia_sync_reconciliation_segments',
    'amaia_sync_alert_remediation_queue', 'amaia_sync_manifest_exclusion_subjects',
    'amaia_sync_manifest_exclusion_investigations', 'amaia_sync_manifest_exclusion_decisions',
    'amaia_sync_manifest_exclusion_consumptions'
  ];
  v_t text;
  v_count integer := 0;
  v_policy_total integer;
  v_cmd text;
  v_roles name[];
  v_qual text;
begin
  foreach v_t in array v_tables loop
    -- 1. RLS enabled
    perform 1 from pg_tables where schemaname='public' and tablename=v_t and rowsecurity=true;
    if not found then raise exception 'T15 FAIL: RLS not enabled on %', v_t; end if;

    -- 2. Exactly 1 policy
    select count(*) into v_policy_total from pg_policies where schemaname='public' and tablename=v_t;
    if v_policy_total != 1 then
      raise exception 'T15 FAIL: % has % policies, expected exactly 1', v_t, v_policy_total;
    end if;

    -- 3. Read the single policy (roles as name[] for exact comparison)
    select p.cmd, p.roles, p.qual::text
      into v_cmd, v_roles, v_qual
      from pg_policies p where p.schemaname='public' and p.tablename=v_t
      limit 1;

    -- 4. cmd = SELECT
    if v_cmd is distinct from 'SELECT' then
      raise exception 'T15 FAIL: % policy cmd=%, expected SELECT', v_t, v_cmd;
    end if;

    -- 5. roles exactly {authenticated} — direct array comparison
    if v_roles is distinct from array['authenticated']::name[] then
      raise exception 'T15 FAIL: % policy roles=%, expected exactly {authenticated}', v_t, v_roles::text;
    end if;

    -- 6. qual contains get_user_role
    if v_qual not like '%get_user_role%' then
      raise exception 'T15 FAIL: % qual missing get_user_role. qual=%', v_t, v_qual;
    end if;

    -- 7. qual contains literal 'admin' (with surrounding quotes to distinguish from super_admin)
    --    PostgreSQL stores string literals in qual with doubled single quotes: ''admin''
    --    Also accept the variant where PG normalizes to different quoting.
    if v_qual not like '%''admin''%' and v_qual not like '%''admin''%' then
      raise exception 'T15 FAIL: % qual missing literal admin (quoted). qual=%', v_t, v_qual;
    end if;

    -- 8. qual contains literal 'super_admin' (quoted)
    if v_qual not like '%''super_admin''%' then
      raise exception 'T15 FAIL: % qual missing literal super_admin (quoted). qual=%', v_t, v_qual;
    end if;

    -- 9. Normalize qual for bypass detection: lowercase + collapse whitespace
    declare
      v_norm text;
    begin
      v_norm := regexp_replace(lower(v_qual), '\s+', ' ', 'g');

      -- Reject bare true
      if v_norm in ('true', '(true)') then
        raise exception 'T15 FAIL: % qual is bare true', v_t;
      end if;

      -- Reject OR true / OR (true) bypass
      if v_norm like '%or true%' or v_norm like '%or (true)%' then
        raise exception 'T15 FAIL: % qual contains OR true bypass. qual=%', v_t, v_qual;
      end if;

      -- Reject auth.uid() IS NOT NULL unconditionally — even alongside get_user_role
      -- because "get_user_role(...) IN (...) OR auth.uid() IS NOT NULL" authorizes everyone
      if v_norm like '%auth.uid()%is not null%' then
        raise exception 'T15 FAIL: % qual contains auth.uid() IS NOT NULL (bypass risk). qual=%', v_t, v_qual;
      end if;

      -- Reject OR auth.uid() in any form
      if v_norm like '%or auth.uid()%' then
        raise exception 'T15 FAIL: % qual contains OR auth.uid() (bypass risk). qual=%', v_t, v_qual;
      end if;
    end;

    -- 10. qual does NOT authorize teleoperadora
    if v_qual like '%teleoperadora%' then
      raise exception 'T15 FAIL: % qual references teleoperadora', v_t;
    end if;

    v_count := v_count + 1;
  end loop;
  raise notice 'T15 PASS: all 11 tables — exactly 1 policy, cmd=SELECT, roles={authenticated}, qual has get_user_role + literal admin + literal super_admin, no broad/OR-true/teleoperadora (% verified)', v_count;
end $$;

-- ============================================================
-- T16–T20: Full fencing CAS using SAME entity_name for watermark and lease
-- Setup: create a QA watermark + lease pair under entity_name 'qa_fencing'
-- ============================================================
do $$
begin
  -- Create QA watermark entry (will be cleaned up by global ROLLBACK)
  insert into public.amaia_sync_watermarks (entity_name, source_table, watermark_type, last_id, last_timestamp)
  values ('qa_fencing', 'qa_source', 'id', 100, null)
  on conflict (entity_name) do update set watermark_type='id', last_id=100, last_timestamp=null;

  -- Create QA lease entry
  insert into public.amaia_sync_leases (entity_name, owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at)
  values ('qa_fencing', 'host:1:worker:run1', 5, now()+interval '5 minutes', now(), now())
  on conflict (entity_name) do update set owner_identity='host:1:worker:run1', lease_token=5,
    lease_expires_at=now()+interval '5 minutes', heartbeat_at=now(), acquired_at=now();

  raise notice 'T16-T20 SETUP: qa_fencing watermark (id, last_id=100) + lease (token=5, owner=host:1:worker:run1, valid)';
end $$;

-- T16: invalid token → 0 rows
do $$
declare v_affected integer;
begin
  update public.amaia_sync_watermarks set last_id=200
    where entity_name='qa_fencing' and watermark_type='id' and last_id=100
      and exists (select 1 from public.amaia_sync_leases
        where entity_name='qa_fencing' and lease_token=4
          and owner_identity='host:1:worker:run1'
          and owner_identity is not null
          and lease_expires_at > now());
  get diagnostics v_affected = row_count;
  if v_affected != 0 then raise exception 'T16 FAIL: wrong token affected % rows', v_affected; end if;
  raise notice 'T16 PASS: invalid fencing token → 0 rows (same entity_name for watermark and lease)';
end $$;

-- T17: wrong owner_identity → 0 rows
do $$
declare v_affected integer;
begin
  update public.amaia_sync_watermarks set last_id=200
    where entity_name='qa_fencing' and watermark_type='id' and last_id=100
      and exists (select 1 from public.amaia_sync_leases
        where entity_name='qa_fencing' and lease_token=5
          and owner_identity='host:2:worker:WRONG'
          and owner_identity is not null
          and lease_expires_at > now());
  get diagnostics v_affected = row_count;
  if v_affected != 0 then raise exception 'T17 FAIL: wrong owner affected % rows', v_affected; end if;
  raise notice 'T17 PASS: wrong owner_identity → 0 rows';
end $$;

-- T18: NULL owner (released lease) → 0 rows
do $$
declare v_affected integer;
begin
  update public.amaia_sync_leases set owner_identity=null, lease_expires_at=null
    where entity_name='qa_fencing';
  update public.amaia_sync_watermarks set last_id=200
    where entity_name='qa_fencing' and watermark_type='id' and last_id=100
      and exists (select 1 from public.amaia_sync_leases
        where entity_name='qa_fencing' and lease_token=5
          and owner_identity='host:1:worker:run1'
          and owner_identity is not null
          and lease_expires_at > now());
  get diagnostics v_affected = row_count;
  if v_affected != 0 then raise exception 'T18 FAIL: null owner affected % rows', v_affected; end if;
  raise notice 'T18 PASS: NULL owner_identity (released) → 0 rows';
end $$;

-- T19: expired lease → 0 rows
do $$
declare v_affected integer;
begin
  update public.amaia_sync_leases
    set owner_identity='host:1:worker:run1', lease_expires_at=now()-interval '1 minute'
    where entity_name='qa_fencing';
  update public.amaia_sync_watermarks set last_id=200
    where entity_name='qa_fencing' and watermark_type='id' and last_id=100
      and exists (select 1 from public.amaia_sync_leases
        where entity_name='qa_fencing' and lease_token=5
          and owner_identity='host:1:worker:run1'
          and owner_identity is not null
          and lease_expires_at > now());
  get diagnostics v_affected = row_count;
  if v_affected != 0 then raise exception 'T19 FAIL: expired lease affected % rows', v_affected; end if;
  raise notice 'T19 PASS: expired lease → 0 rows';
end $$;

-- T20: valid lease → 1 row
do $$
declare v_affected integer;
begin
  update public.amaia_sync_leases
    set owner_identity='host:1:worker:run1', lease_expires_at=now()+interval '5 minutes', lease_token=5
    where entity_name='qa_fencing';
  update public.amaia_sync_watermarks set last_id=200
    where entity_name='qa_fencing' and watermark_type='id' and last_id=100
      and exists (select 1 from public.amaia_sync_leases
        where entity_name='qa_fencing' and lease_token=5
          and owner_identity='host:1:worker:run1'
          and owner_identity is not null
          and lease_expires_at > now());
  get diagnostics v_affected = row_count;
  if v_affected != 1 then raise exception 'T20 FAIL: valid fenced advance affected % rows', v_affected; end if;
  raise notice 'T20 PASS: valid fenced advance → 1 row (same entity_name, full 4-part predicate)';
end $$;

-- ============================================================
-- T21: Exclusion consumption — full valid flow then invalid cases
-- ============================================================
do $$
declare
  v_run_a uuid; v_cycle_id uuid;
  v_subj_id uuid; v_inv_id uuid; v_dec_id uuid;
  v_manifest_id uuid; v_run_exc uuid;
  v_failed boolean;
  v_inv2_id uuid;
begin
  select val into v_cycle_id from qa_ids where key='cycle';
  -- Create dedicated run for consumption
  insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
  values ('qa_excl', 'running', v_cycle_id, 'logestado') returning id into v_run_exc;

  -- Create manifest with sets_match=true
  insert into public.amaia_sync_run_manifests (run_id, domain_name, source_id_count, source_id_hash)
  values (v_run_exc, 'logestado', 1, 'excl_hash') returning id into v_manifest_id;
  update public.amaia_sync_run_manifests
    set phase='confirmed_compared', persisted_id_count=1, persisted_id_hash='excl_hash',
        sets_match=true, verified_at=now()
    where id=v_manifest_id;

  -- Create subject + investigation + approved decision
  insert into public.amaia_sync_manifest_exclusion_subjects (domain_name, excluded_amaia_id)
  values ('logestado', 777) returning id into v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at, detection_run_id, detection_manifest_id)
  values (v_subj_id, 1, 'inv_hash_777', 'logestado', 777, 'not found', now(), v_run_exc, v_manifest_id)
  returning id into v_inv_id;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv_id, current_investigation_seq=1 where id=v_subj_id;
  -- Decision: approved
  insert into public.amaia_sync_manifest_exclusion_decisions
    (investigation_id, decision, decided_by, reason)
  values (v_inv_id, 'approved', 'operator_qa', 'QA test')
  returning id into v_dec_id;

  -- T21a: decision rejected (not latest) → rejected
  -- Insert a second decision (rejected) making v_dec_id no longer latest
  declare v_dec2_id uuid;
  begin
    insert into public.amaia_sync_manifest_exclusion_decisions
      (investigation_id, decision, decided_by, reason)
    values (v_inv_id, 'rejected', 'operator_qa', 'changed mind') returning id into v_dec2_id;
    v_failed := false;
    begin
      insert into public.amaia_sync_manifest_exclusion_consumptions
        (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
         investigation_hash_at_consumption)
      values (v_inv_id, v_dec_id, v_run_exc, v_manifest_id, 'inv_hash_777');
    exception when others then
      if sqlerrm like '%not the latest%' then v_failed := true;
      else raise exception 'T21a FAIL: unexpected: %', sqlerrm; end if;
    end;
    if not v_failed then raise exception 'T21a FAIL: consumption with non-latest decision was NOT rejected'; end if;
    raise notice 'T21a PASS: non-latest decision → consumption rejected';

    -- T21b: latest decision = rejected → rejected
    v_failed := false;
    begin
      insert into public.amaia_sync_manifest_exclusion_consumptions
        (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
         investigation_hash_at_consumption)
      values (v_inv_id, v_dec2_id, v_run_exc, v_manifest_id, 'inv_hash_777');
    exception when others then
      if sqlerrm like '%not approved%' then v_failed := true;
      else raise exception 'T21b FAIL: unexpected: %', sqlerrm; end if;
    end;
    if not v_failed then raise exception 'T21b FAIL: consumption with rejected decision was NOT rejected'; end if;
    raise notice 'T21b PASS: rejected decision → consumption rejected';

    -- Approve again for further tests
    insert into public.amaia_sync_manifest_exclusion_decisions
      (investigation_id, decision, decided_by, reason)
    values (v_inv_id, 'approved', 'operator_qa', 're-approved') returning id into v_dec_id;
  end;

  -- T21c: hash mismatch → rejected
  v_failed := false;
  begin
    insert into public.amaia_sync_manifest_exclusion_consumptions
      (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
       investigation_hash_at_consumption)
    values (v_inv_id, v_dec_id, v_run_exc, v_manifest_id, 'WRONG_HASH');
  exception when others then
    if sqlerrm like '%hash mismatch%' then v_failed := true;
    else raise exception 'T21c FAIL: unexpected: %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'T21c FAIL: hash mismatch was NOT rejected'; end if;
  raise notice 'T21c PASS: hash mismatch → consumption rejected';

  -- T21d: manifest with sets_match=false → rejected
  declare v_bad_cycle uuid; v_bad_run uuid; v_bad_manifest uuid;
  begin
    insert into public.amaia_sync_cycles (trigger_type, owner_identity)
    values ('manual', 'qa_t21d') returning id into v_bad_cycle;
    insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
    values ('qa_t21d', 'running', v_bad_cycle, 'logestado') returning id into v_bad_run;
    insert into public.amaia_sync_run_manifests (run_id, domain_name, source_id_count, source_id_hash)
    values (v_bad_run, 'logestado', 1, 'bad') returning id into v_bad_manifest;
    update public.amaia_sync_run_manifests
      set phase='confirmed_compared', persisted_id_count=0, persisted_id_hash='diff',
          sets_match=false, verified_at=now()
      where id=v_bad_manifest;
    v_failed := false;
    begin
      insert into public.amaia_sync_manifest_exclusion_consumptions
        (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
         investigation_hash_at_consumption)
      values (v_inv_id, v_dec_id, v_bad_run, v_bad_manifest, 'inv_hash_777');
    exception when others then
      if sqlerrm like '%sets_match is not true%' then v_failed := true;
      else raise exception 'T21d FAIL: unexpected: %', sqlerrm; end if;
    end;
    if not v_failed then raise exception 'T21d FAIL: consumption with sets_match=false was NOT rejected'; end if;
    raise notice 'T21d PASS: manifest sets_match=false → consumption rejected';
  end;

  -- T21e: investigation not current → rejected
  begin
    insert into public.amaia_sync_manifest_exclusion_investigations
      (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
       amaia_lookup_evidence, amaia_lookup_at)
    values (v_subj_id, 2, 'inv_hash_777_v2', 'logestado', 777, 'recheck', now())
    returning id into v_inv2_id;
    update public.amaia_sync_manifest_exclusion_subjects
      set current_investigation_id=v_inv2_id, current_investigation_seq=2 where id=v_subj_id;
    -- Try to consume old investigation
    v_failed := false;
    begin
      insert into public.amaia_sync_manifest_exclusion_consumptions
        (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
         investigation_hash_at_consumption)
      values (v_inv_id, v_dec_id, v_run_exc, v_manifest_id, 'inv_hash_777');
    exception when others then
      if sqlerrm like '%not current%' then v_failed := true;
      else raise exception 'T21e FAIL: unexpected: %', sqlerrm; end if;
    end;
    if not v_failed then raise exception 'T21e FAIL: consumption of non-current investigation was NOT rejected'; end if;
    raise notice 'T21e PASS: non-current investigation → consumption rejected';
  end;

  -- T21f: valid consumption (new investigation approved + correct hash + sets_match=true)
  declare v_dec_final uuid;
  begin
    insert into public.amaia_sync_manifest_exclusion_decisions
      (investigation_id, decision, decided_by, reason)
    values (v_inv2_id, 'approved', 'operator_qa', 'approved v2')
    returning id into v_dec_final;
    insert into public.amaia_sync_manifest_exclusion_consumptions
      (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
       investigation_hash_at_consumption)
    values (v_inv2_id, v_dec_final, v_run_exc, v_manifest_id, 'inv_hash_777_v2');
    raise notice 'T21f PASS: valid consumption accepted';
  end;
end $$;

-- ============================================================
-- T22: Rollback chain — manifest + consumption + watermark atomicity
-- Simulates the runtime fenced transaction: all three steps inside
-- one PL/pgSQL subtransaction. Failure reverts ALL three.
-- ============================================================
do $$
declare
  v_cycle_id uuid; v_run_id uuid; v_manifest_id uuid;
  v_subj_id uuid; v_inv_id uuid; v_dec_id uuid;
  v_wm_before bigint; v_wm_after bigint;
  v_cons_count integer; v_manifest_phase text; v_manifest_match boolean;
  v_failed_as_expected boolean := false;
begin
  -- Setup: create all prerequisites OUTSIDE the subtransaction
  insert into public.amaia_sync_cycles (trigger_type, owner_identity)
  values ('manual', 'qa_t22') returning id into v_cycle_id;
  insert into public.amaia_sync_runs (job_name, status, cycle_id, domain_name)
  values ('qa_t22', 'running', v_cycle_id, 'logestado') returning id into v_run_id;

  -- Manifest starts at source_fetched (NOT confirmed_compared yet)
  insert into public.amaia_sync_run_manifests (run_id, domain_name, source_id_count, source_id_hash)
  values (v_run_id, 'logestado', 1, 't22h') returning id into v_manifest_id;

  -- Create subject with approved exclusion
  insert into public.amaia_sync_manifest_exclusion_subjects (domain_name, excluded_amaia_id)
  values ('logestado', 555) returning id into v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_investigations
    (subject_id, investigation_seq, investigation_hash, domain_name, excluded_amaia_id,
     amaia_lookup_evidence, amaia_lookup_at)
  values (v_subj_id, 1, 'h555', 'logestado', 555, 'test', now()) returning id into v_inv_id;
  update public.amaia_sync_manifest_exclusion_subjects
    set current_investigation_id=v_inv_id, current_investigation_seq=1 where id=v_subj_id;
  insert into public.amaia_sync_manifest_exclusion_decisions
    (investigation_id, decision, decided_by, reason)
  values (v_inv_id, 'approved', 'qa', 'test') returning id into v_dec_id;

  -- Record watermark before
  select last_id into v_wm_before from public.amaia_sync_watermarks
    where entity_name='qa_fencing';

  -- === SUBTRANSACTION: simulates fenced runtime transaction ===
  -- Steps 5→6→7 all inside one block. Failure reverts all.
  begin
    -- Step 5: update manifest to sets_match=true (INSIDE subtransaction)
    update public.amaia_sync_run_manifests
      set phase='confirmed_compared', persisted_id_count=1, persisted_id_hash='t22h',
          sets_match=true, verified_at=now()
      where id=v_manifest_id;

    -- Step 6: insert consumption with WRONG hash → trigger rejects → subtransaction reverts
    insert into public.amaia_sync_manifest_exclusion_consumptions
      (investigation_id, decision_id, consumed_by_run_id, consumed_by_manifest_id,
       investigation_hash_at_consumption)
    values (v_inv_id, v_dec_id, v_run_id, v_manifest_id, 'WRONG_HASH_T22');

    -- Step 7: watermark advance (should NOT be reached due to Step 6 failure)
    update public.amaia_sync_watermarks set last_id=999
      where entity_name='qa_fencing' and watermark_type='id' and last_id is not distinct from v_wm_before;

  exception when others then
    -- Expected: trigger #8 rejects hash mismatch, entire subtransaction reverts
    if sqlerrm like '%hash mismatch%' then
      v_failed_as_expected := true;
    else
      raise exception 'T22 FAIL: unexpected error in subtransaction: %', sqlerrm;
    end if;
  end;
  -- === END SUBTRANSACTION ===

  if not v_failed_as_expected then
    raise exception 'T22 FAIL: subtransaction did NOT fail as expected';
  end if;

  -- Verify: manifest reverted to source_fetched (the subtransaction update was rolled back)
  select phase, sets_match into v_manifest_phase, v_manifest_match
    from public.amaia_sync_run_manifests where id=v_manifest_id;
  if v_manifest_phase is distinct from 'source_fetched' then
    raise exception 'T22 FAIL: manifest phase is %, expected source_fetched (should have reverted)', v_manifest_phase;
  end if;
  if v_manifest_match is not null then
    raise exception 'T22 FAIL: manifest sets_match is %, expected NULL (should have reverted)', v_manifest_match;
  end if;

  -- Verify: no consumption persisted
  select count(*) into v_cons_count
    from public.amaia_sync_manifest_exclusion_consumptions
    where consumed_by_run_id = v_run_id and investigation_id = v_inv_id;
  if v_cons_count != 0 then
    raise exception 'T22 FAIL: % consumptions persisted after subtransaction rollback', v_cons_count;
  end if;

  -- Verify: watermark unchanged
  select last_id into v_wm_after from public.amaia_sync_watermarks where entity_name='qa_fencing';
  if v_wm_after is distinct from v_wm_before then
    raise exception 'T22 FAIL: watermark changed from % to % (should have reverted)', v_wm_before, v_wm_after;
  end if;

  raise notice 'T22 PASS: subtransaction rollback reverted manifest (source_fetched) + 0 consumptions + watermark unchanged';
end $$;

-- ============================================================
-- CLEANUP
-- ============================================================
drop table if exists qa_ids;

rollback;
