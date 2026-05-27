begin;

create temporary table qa_results (
  test_name text,
  passed boolean,
  details text
);

create temporary table qa_ctx as
select
  super_admin.super_admin_id,
  coalesce(admin.admin_id, super_admin.super_admin_id) as admin_id,
  coalesce(tele.tele_1_id, admin.admin_id, super_admin.super_admin_id) as operator_a_id,
  coalesce(tele.tele_2_id, tele.tele_1_id, admin.admin_id, super_admin.super_admin_id) as operator_b_id,
  tele.tele_1_id,
  tele.tele_2_id
from (
  select id as super_admin_id
  from public.profiles
  where role = 'super_admin'
  order by is_active desc, created_at asc
  limit 1
) as super_admin
left join lateral (
  select id as admin_id
  from public.profiles
  where role = 'admin'
  order by is_active desc, created_at asc
  limit 1
) as admin on true
left join lateral (
  select
    (
      select id
      from public.profiles
      where role = 'teleoperadora'
      order by is_active desc, created_at asc
      limit 1
    ) as tele_1_id,
    (
      select id
      from public.profiles
      where role = 'teleoperadora'
      order by is_active desc, created_at asc
      offset 1
      limit 1
    ) as tele_2_id
) as tele on true;

insert into qa_results
select
  'ctx_roles_available_with_fallback',
  super_admin_id is not null and admin_id is not null and operator_a_id is not null and operator_b_id is not null,
  jsonb_build_object(
    'super_admin_id', super_admin_id,
    'admin_id', admin_id,
    'operator_a_id', operator_a_id,
    'operator_b_id', operator_b_id,
    'tele_1_id', tele_1_id,
    'tele_2_id', tele_2_id
  )::text
from qa_ctx;

-- cleanup prior QA artifacts for deterministic assertions
delete from public.followup_events
where call_log_id in (
  select id
  from public.raw_call_logs
  where source = 'qa_phase4_5_runtime'
);

delete from public.call_correlations
where raw_call_log_id in (
  select id
  from public.raw_call_logs
  where source = 'qa_phase4_5_runtime'
);

delete from public.raw_call_logs
where source = 'qa_phase4_5_runtime';

delete from public.beneficiary_assignments
where id in (
  'f45aaaa1-0000-0000-0000-000000000001',
  'f45aaaa2-0000-0000-0000-000000000002',
  'f45aaaa3-0000-0000-0000-000000000003',
  'f45aaaa4-0000-0000-0000-000000000004'
);

delete from public.beneficiary_contacts
where id in (
  'f45cccc1-0000-0000-0000-000000000001',
  'f45cccc2-0000-0000-0000-000000000002',
  'f45cccc3-0000-0000-0000-000000000003',
  'f45cccc4-0000-0000-0000-000000000004'
);

delete from public.beneficiaries
where id in (
  'f4500001-0000-0000-0000-000000000001',
  'f4500002-0000-0000-0000-000000000002',
  'f4500003-0000-0000-0000-000000000003',
  'f4500004-0000-0000-0000-000000000004'
);

insert into public.beneficiaries (
  id,
  rut_raw,
  rut_normalized,
  first_name,
  last_name,
  full_name,
  status,
  created_by,
  updated_by
)
select
  x.id,
  x.rut_raw,
  x.rut_normalized,
  x.first_name,
  x.last_name,
  x.full_name,
  x.status,
  x.created_by,
  x.updated_by
from (
  values
    ('f4500001-0000-0000-0000-000000000001'::uuid, '98.710.001-1', public.normalize_rut('98.710.001-1'), 'QA', 'AlDia', 'QA AlDia', 'active'::public.beneficiary_status),
    ('f4500002-0000-0000-0000-000000000002'::uuid, '98.710.002-2', public.normalize_rut('98.710.002-2'), 'QA', 'Pendiente', 'QA Pendiente', 'active'::public.beneficiary_status),
    ('f4500003-0000-0000-0000-000000000003'::uuid, '98.710.003-3', public.normalize_rut('98.710.003-3'), 'QA', 'Urgente', 'QA Urgente', 'active'::public.beneficiary_status),
    ('f4500004-0000-0000-0000-000000000004'::uuid, '98.710.004-4', public.normalize_rut('98.710.004-4'), 'QA', 'SinContacto', 'QA SinContacto', 'active'::public.beneficiary_status)
) as v(id, rut_raw, rut_normalized, first_name, last_name, full_name, status),
qa_ctx c
cross join lateral (
  values (v.id, v.rut_raw, v.rut_normalized, v.first_name, v.last_name, v.full_name, v.status, c.super_admin_id, c.super_admin_id)
) as x(id, rut_raw, rut_normalized, first_name, last_name, full_name, status, created_by, updated_by)
on conflict (id) do update
set
  rut_raw = excluded.rut_raw,
  rut_normalized = excluded.rut_normalized,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  full_name = excluded.full_name,
  status = excluded.status,
  updated_by = excluded.updated_by,
  updated_at = now();

insert into public.beneficiary_contacts (
  id,
  beneficiary_id,
  contact_type,
  contact_name,
  phone_raw,
  phone_normalized,
  is_primary,
  is_active
)
values
  ('f45cccc1-0000-0000-0000-000000000001', 'f4500001-0000-0000-0000-000000000001', 'family_contact', 'QA Red Apoyo', '+56 9 5111 1111', public.normalize_chilean_phone('+56 9 5111 1111'), false, true),
  ('f45cccc2-0000-0000-0000-000000000002', 'f4500002-0000-0000-0000-000000000002', 'primary_phone', 'QA Principal Pendiente', '+56 9 5222 2222', public.normalize_chilean_phone('+56 9 5222 2222'), true, true),
  ('f45cccc3-0000-0000-0000-000000000003', 'f4500003-0000-0000-0000-000000000003', 'primary_phone', 'QA Principal Urgente', '+56 9 5333 3333', public.normalize_chilean_phone('+56 9 5333 3333'), true, true),
  ('f45cccc4-0000-0000-0000-000000000004', 'f4500004-0000-0000-0000-000000000004', 'primary_phone', 'QA Principal SinContacto', '+56 9 5444 4444', public.normalize_chilean_phone('+56 9 5444 4444'), true, true)
on conflict (id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  contact_type = excluded.contact_type,
  contact_name = excluded.contact_name,
  phone_raw = excluded.phone_raw,
  phone_normalized = excluded.phone_normalized,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.beneficiary_assignments (
  id,
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  starts_at,
  source,
  created_by,
  updated_by,
  reason
)
select
  v.id,
  v.beneficiary_id,
  a.assigned_user_id,
  'primary',
  'active',
  now() - interval '60 days',
  'manual',
  c.super_admin_id,
  c.super_admin_id,
  'QA phase 4.5 fixture'
from (
  values
    ('f45aaaa1-0000-0000-0000-000000000001'::uuid, 'f4500001-0000-0000-0000-000000000001'::uuid),
    ('f45aaaa2-0000-0000-0000-000000000002'::uuid, 'f4500002-0000-0000-0000-000000000002'::uuid),
    ('f45aaaa3-0000-0000-0000-000000000003'::uuid, 'f4500003-0000-0000-0000-000000000003'::uuid),
    ('f45aaaa4-0000-0000-0000-000000000004'::uuid, 'f4500004-0000-0000-0000-000000000004'::uuid)
) as v(id, beneficiary_id)
cross join qa_ctx c
cross join lateral (
  values (case when v.beneficiary_id in ('f4500001-0000-0000-0000-000000000001'::uuid, 'f4500003-0000-0000-0000-000000000003'::uuid) then c.operator_a_id else c.operator_b_id end)
) as a(assigned_user_id)
on conflict (id) do update
set
  assigned_user_id = excluded.assigned_user_id,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = null,
  updated_by = excluded.updated_by,
  updated_at = now(),
  reason = excluded.reason;

insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_status,
  duration_seconds,
  raw_payload,
  created_by
)
select
  v.id,
  'qa_phase4_5_runtime',
  v.external_call_id,
  v.called_at,
  v.raw_phone,
  v.raw_status,
  v.duration_seconds,
  jsonb_build_object('qa_phase', '4.5', 'external_call_id', v.external_call_id),
  c.super_admin_id
from (
  values
    ('f45c1111-0000-0000-0000-000000000001'::uuid, 'QA-4.5-ALDIA', now() - interval '5 days', '+56 9 5111 1111', 'contacto_efectivo', 80),
    ('f45c2222-0000-0000-0000-000000000002'::uuid, 'QA-4.5-PENDIENTE', now() - interval '20 days', '+56 9 5222 2222', 'contacto_efectivo', 75),
    ('f45c3333-0000-0000-0000-000000000003'::uuid, 'QA-4.5-URGENTE', now() - interval '40 days', '+56 9 5333 3333', 'contacto_efectivo', 60),
    ('f45c4444-0000-0000-0000-000000000004'::uuid, 'QA-4.5-SINCONTACTO', now() - interval '2 days', '+56 9 5444 4444', 'no_responde', 45),
    ('f45c5555-0000-0000-0000-000000000005'::uuid, 'QA-4.5-FUTURE', now() + interval '2 days', '+56 9 5222 2222', 'contacto_efectivo', 30)
) as v(id, external_call_id, called_at, raw_phone, raw_status, duration_seconds)
cross join qa_ctx c
on conflict (id) do update
set
  called_at = excluded.called_at,
  raw_phone = excluded.raw_phone,
  raw_status = excluded.raw_status,
  duration_seconds = excluded.duration_seconds,
  raw_payload = excluded.raw_payload,
  created_by = excluded.created_by;

insert into public.call_correlations (
  id,
  raw_call_log_id,
  correlation_status,
  beneficiary_id,
  beneficiary_contact_id,
  matched_phone,
  contact_type,
  match_method,
  confidence_score,
  assignment_id_at_call_time,
  responsible_user_id_at_call_time,
  reason,
  created_by,
  updated_by
)
select
  v.id,
  v.raw_call_log_id,
  'matched_single',
  v.beneficiary_id,
  v.beneficiary_contact_id,
  v.matched_phone,
  v.contact_type,
  'phone_exact_active_contact',
  100,
  v.assignment_id,
  u.responsible_user_id,
  'QA phase 4.5 correlation fixture',
  c.super_admin_id,
  c.super_admin_id
from (
  values
    ('f45d1111-0000-0000-0000-000000000001'::uuid, 'f45c1111-0000-0000-0000-000000000001'::uuid, 'f4500001-0000-0000-0000-000000000001'::uuid, 'f45cccc1-0000-0000-0000-000000000001'::uuid, public.normalize_chilean_phone('+56 9 5111 1111'), 'family_contact'::public.contact_type, 'f45aaaa1-0000-0000-0000-000000000001'::uuid),
    ('f45d2222-0000-0000-0000-000000000002'::uuid, 'f45c2222-0000-0000-0000-000000000002'::uuid, 'f4500002-0000-0000-0000-000000000002'::uuid, 'f45cccc2-0000-0000-0000-000000000002'::uuid, public.normalize_chilean_phone('+56 9 5222 2222'), 'primary_phone'::public.contact_type, 'f45aaaa2-0000-0000-0000-000000000002'::uuid),
    ('f45d3333-0000-0000-0000-000000000003'::uuid, 'f45c3333-0000-0000-0000-000000000003'::uuid, 'f4500003-0000-0000-0000-000000000003'::uuid, 'f45cccc3-0000-0000-0000-000000000003'::uuid, public.normalize_chilean_phone('+56 9 5333 3333'), 'primary_phone'::public.contact_type, 'f45aaaa3-0000-0000-0000-000000000003'::uuid),
    ('f45d4444-0000-0000-0000-000000000004'::uuid, 'f45c4444-0000-0000-0000-000000000004'::uuid, 'f4500004-0000-0000-0000-000000000004'::uuid, 'f45cccc4-0000-0000-0000-000000000004'::uuid, public.normalize_chilean_phone('+56 9 5444 4444'), 'primary_phone'::public.contact_type, 'f45aaaa4-0000-0000-0000-000000000004'::uuid),
    ('f45d5555-0000-0000-0000-000000000005'::uuid, 'f45c5555-0000-0000-0000-000000000005'::uuid, 'f4500002-0000-0000-0000-000000000002'::uuid, 'f45cccc2-0000-0000-0000-000000000002'::uuid, public.normalize_chilean_phone('+56 9 5222 2222'), 'primary_phone'::public.contact_type, 'f45aaaa2-0000-0000-0000-000000000002'::uuid)
) as v(id, raw_call_log_id, beneficiary_id, beneficiary_contact_id, matched_phone, contact_type, assignment_id)
cross join qa_ctx c
cross join lateral (
  values (case when v.beneficiary_id in ('f4500001-0000-0000-0000-000000000001'::uuid, 'f4500003-0000-0000-0000-000000000003'::uuid) then c.operator_a_id else c.operator_b_id end)
) as u(responsible_user_id)
on conflict (raw_call_log_id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  beneficiary_contact_id = excluded.beneficiary_contact_id,
  matched_phone = excluded.matched_phone,
  contact_type = excluded.contact_type,
  assignment_id_at_call_time = excluded.assignment_id_at_call_time,
  responsible_user_id_at_call_time = excluded.responsible_user_id_at_call_time,
  reason = excluded.reason,
  updated_by = excluded.updated_by,
  updated_at = now();

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select super_admin_id::text from qa_ctx), true);

create temporary table qa_rpc_run_1 as
select public.generate_follow_up_events_from_call_logs('qa_phase4_5_runtime', 200, null) as payload;

insert into qa_results
select
  'rpc_created_rows',
  (payload->>'createdRows')::integer = 4,
  payload::text
from qa_rpc_run_1;

insert into qa_results
select
  'rpc_effective_rows',
  (payload->>'effectiveRows')::integer = 3,
  payload::text
from qa_rpc_run_1;

insert into qa_results
select
  'rpc_error_rows_future_timestamp',
  (payload->>'errorRows')::integer = 1,
  payload::text
from qa_rpc_run_1;

create temporary table qa_rpc_run_2 as
select public.generate_follow_up_events_from_call_logs('qa_phase4_5_runtime', 200, null) as payload;

insert into qa_results
select
  'rpc_second_run_dedup',
  (payload->>'createdRows')::integer = 0 and (payload->>'skippedDuplicates')::integer >= 4,
  payload::text
from qa_rpc_run_2;

insert into qa_results
select
  'dedup_unique_call_log_id',
  not exists (
    select fe.call_log_id
    from public.followup_events fe
    join public.raw_call_logs rcl on rcl.id = fe.call_log_id
    where rcl.source = 'qa_phase4_5_runtime'
    group by fe.call_log_id
    having count(*) > 1
  ),
  'no duplicate followup_events per call_log_id';

insert into qa_results
select
  'audit_traceability_fields_present',
  exists (
    select 1
    from public.followup_events fe
    join public.raw_call_logs rcl on rcl.id = fe.call_log_id
    where rcl.source = 'qa_phase4_5_runtime'
      and fe.call_log_id is not null
      and fe.operator_profile_id is not null
      and fe.event_outcome is not null
      and fe.is_effective_contact is not null
      and fe.event_timestamp is not null
      and fe.source = 'amaia_call'
  ),
  'generated followup events include call_log_id/operator/outcome/effective/timestamp/source';

insert into qa_results
select
  'audit_no_orphan_beneficiary',
  not exists (
    select 1
    from public.followup_events fe
    join public.raw_call_logs rcl on rcl.id = fe.call_log_id
    where rcl.source = 'qa_phase4_5_runtime'
      and fe.beneficiary_id is null
  ),
  'all generated followup events keep beneficiary_id';

insert into qa_results
select
  'canonical_effective_contact_rule_global',
  not exists (
    select 1
    from public.followup_events fe
    where (fe.event_outcome = 'contacto_efectivo'::public.follow_up_event_outcome and fe.is_effective_contact = false)
       or (fe.event_outcome <> 'contacto_efectivo'::public.follow_up_event_outcome and fe.is_effective_contact = true)
  ),
  'No rows violate event_outcome <-> is_effective_contact canonical rule';

insert into qa_results
select
  'canonical_effective_contact_rule_generated_scope',
  not exists (
    select 1
    from public.followup_events fe
    join public.raw_call_logs rcl on rcl.id = fe.call_log_id
    where rcl.source = 'qa_phase4_5_runtime'
      and (
        (fe.event_outcome = 'contacto_efectivo'::public.follow_up_event_outcome and fe.is_effective_contact = false)
        or (fe.event_outcome <> 'contacto_efectivo'::public.follow_up_event_outcome and fe.is_effective_contact = true)
      )
  ),
  'Generated events respect canonical effective-contact rule';

insert into qa_results
select
  'views_security_invoker_enabled',
  (
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'v_follow_up_coverage_by_beneficiary'
        and c.relkind = 'v'
        and c.reloptions is not null
        and c.reloptions @> array['security_invoker=true']
    )
    and exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'v_follow_up_operational_summary'
        and c.relkind = 'v'
        and c.reloptions is not null
        and c.reloptions @> array['security_invoker=true']
    )
  ),
  'Both operational views are created with security_invoker=true';

insert into qa_results
select
  'coverage_al_dia',
  exists (
    select 1
    from public.v_follow_up_coverage_by_beneficiary v
    where v.beneficiary_id = 'f4500001-0000-0000-0000-000000000001'
      and v.coverage_state = 'al_dia'
  ),
  'beneficiary QA AlDia must be al_dia';

insert into qa_results
select
  'coverage_pendiente',
  exists (
    select 1
    from public.v_follow_up_coverage_by_beneficiary v
    where v.beneficiary_id = 'f4500002-0000-0000-0000-000000000002'
      and v.coverage_state = 'pendiente'
  ),
  'beneficiary QA Pendiente must be pendiente';

insert into qa_results
select
  'coverage_urgente',
  exists (
    select 1
    from public.v_follow_up_coverage_by_beneficiary v
    where v.beneficiary_id = 'f4500003-0000-0000-0000-000000000003'
      and v.coverage_state = 'urgente'
  ),
  'beneficiary QA Urgente must be urgente';

insert into qa_results
select
  'coverage_sin_contacto',
  exists (
    select 1
    from public.v_follow_up_coverage_by_beneficiary v
    where v.beneficiary_id = 'f4500004-0000-0000-0000-000000000004'
      and v.coverage_state = 'sin_contacto'
  ),
  'beneficiary QA SinContacto must be sin_contacto';

insert into qa_results
select
  'contact_type_mapping_red_apoyo',
  exists (
    select 1
    from public.followup_events fe
    where fe.call_log_id = 'f45c1111-0000-0000-0000-000000000001'
      and fe.contact_type = 'red_apoyo'
  ),
  'family_contact must map to red_apoyo';

insert into qa_results
select
  'operational_summary_counts',
  exists (
    select 1
    from public.v_follow_up_operational_summary s
    where s.al_dia_beneficiaries >= 1
      and s.pendiente_beneficiaries >= 1
      and s.urgente_beneficiaries >= 1
      and s.sin_contacto_beneficiaries >= 1
  ),
  'summary has all baseline coverage buckets';

select * from qa_results order by test_name;

select
  count(*) as total_tests,
  count(*) filter (where passed) as passed_tests,
  count(*) filter (where not passed) as failed_tests
from qa_results;

rollback;
