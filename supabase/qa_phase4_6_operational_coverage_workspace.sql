begin;

create temporary table qa_results (
  test_name text not null,
  passed boolean not null,
  details text not null
);

create temporary table qa_warnings (
  warning_name text not null,
  details text not null
);

create temporary table qa_ctx as
select
  super_admin.super_admin_id,
  coalesce(admin.admin_id, super_admin.super_admin_id) as admin_id,
  coalesce(tele.tele_1_id, admin.admin_id, super_admin.super_admin_id) as operator_a_id,
  coalesce(tele.tele_2_id, tele.tele_1_id, admin.admin_id, super_admin.super_admin_id) as operator_b_id
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
    'operator_b_id', operator_b_id
  )::text
from qa_ctx;

insert into qa_warnings
select
  'ctx_role_identity_overlap',
  jsonb_build_object(
    'message', 'Las identidades QA resueltas no son todas distintas. Se admite en entornos pobres, pero reduce la fuerza de las verificaciones de aislamiento por rol.',
    'super_admin_id', super_admin_id,
    'admin_id', admin_id,
    'operator_a_id', operator_a_id,
    'operator_b_id', operator_b_id
  )::text
from qa_ctx
where cardinality(array_remove(array[super_admin_id, admin_id, operator_a_id, operator_b_id], null))
  <> cardinality(
    array(
      select distinct identity_id
      from unnest(array[super_admin_id, admin_id, operator_a_id, operator_b_id]) as identity_id
      where identity_id is not null
    )
  );

delete from public.followup_events
where beneficiary_id in (
  'f4600001-0000-0000-0000-000000000001',
  'f4600002-0000-0000-0000-000000000002',
  'f4600003-0000-0000-0000-000000000003'
);

delete from public.beneficiary_assignments
where id in (
  'f46aaaa1-0000-0000-0000-000000000001',
  'f46aaaa2-0000-0000-0000-000000000002',
  'f46aaaa3-0000-0000-0000-000000000003'
);

delete from public.beneficiary_contacts
where id in (
  'f46cccc1-0000-0000-0000-000000000001',
  'f46cccc2-0000-0000-0000-000000000002',
  'f46cccc3-0000-0000-0000-000000000003'
);

delete from public.beneficiaries
where id in (
  'f4600001-0000-0000-0000-000000000001',
  'f4600002-0000-0000-0000-000000000002',
  'f4600003-0000-0000-0000-000000000003'
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
    ('f4600001-0000-0000-0000-000000000001'::uuid, '98.760.001-1', public.normalize_rut('98.760.001-1'), 'QA46', 'AsignadaA', 'QA46 AsignadaA', 'active'::public.beneficiary_status),
    ('f4600002-0000-0000-0000-000000000002'::uuid, '98.760.002-2', public.normalize_rut('98.760.002-2'), 'QA46', 'AsignadaB', 'QA46 AsignadaB', 'active'::public.beneficiary_status),
    ('f4600003-0000-0000-0000-000000000003'::uuid, '98.760.003-3', public.normalize_rut('98.760.003-3'), 'QA46', 'SinAsignar', 'QA46 SinAsignar', 'active'::public.beneficiary_status)
) as v(id, rut_raw, rut_normalized, first_name, last_name, full_name, status)
cross join qa_ctx c
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
  ('f46cccc1-0000-0000-0000-000000000001', 'f4600001-0000-0000-0000-000000000001', 'primary_phone', 'QA46 Principal A', '+56 9 6111 1111', public.normalize_chilean_phone('+56 9 6111 1111'), true, true),
  ('f46cccc2-0000-0000-0000-000000000002', 'f4600002-0000-0000-0000-000000000002', 'primary_phone', 'QA46 Principal B', '+56 9 6222 2222', public.normalize_chilean_phone('+56 9 6222 2222'), true, true),
  ('f46cccc3-0000-0000-0000-000000000003', 'f4600003-0000-0000-0000-000000000003', 'primary_phone', 'QA46 Principal C', '+56 9 6333 3333', public.normalize_chilean_phone('+56 9 6333 3333'), true, true)
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
  b.id,
  b.beneficiary_id,
  v.assigned_user_id,
  'primary',
  'active',
  now() - interval '20 days',
  'manual',
  c.super_admin_id,
  c.super_admin_id,
  'QA phase 4.6 fixture'
from (
  values
    ('f46aaaa1-0000-0000-0000-000000000001'::uuid, 'f4600001-0000-0000-0000-000000000001'::uuid),
    ('f46aaaa2-0000-0000-0000-000000000002'::uuid, 'f4600002-0000-0000-0000-000000000002'::uuid)
) as b(id, beneficiary_id)
cross join qa_ctx c
cross join lateral (
  values (case when b.beneficiary_id = 'f4600001-0000-0000-0000-000000000001'::uuid then c.operator_a_id else c.operator_b_id end)
) as v(assigned_user_id)
on conflict (id) do update
set
  assigned_user_id = excluded.assigned_user_id,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = null,
  updated_by = excluded.updated_by,
  updated_at = now();

insert into qa_results
select
  'view_exists' as test_name,
  exists (
    select 1
    from pg_views
    where schemaname = 'public'
      and viewname = 'v_operational_follow_up_workspace'
  ) as passed,
  'La vista operacional 4.6 debe existir en public.' as details;

insert into qa_results
select
  'view_security_invoker' as test_name,
  exists (
    select 1
    from pg_class
    where oid = 'public.v_operational_follow_up_workspace'::regclass
      and coalesce(array_to_string(reloptions, ','), '') ilike '%security_invoker=true%'
  ) as passed,
  'La vista operacional debe ejecutarse con security_invoker=true.' as details;

insert into qa_results
select
  'manual_follow_up_function_exists' as test_name,
  exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'create_manual_follow_up_event'
  ) as passed,
  'La RPC canonica create_manual_follow_up_event debe existir.' as details;

insert into qa_results
select
  'coverage_state_index_exists' as test_name,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'beneficiary_followup_status'
      and indexname = 'idx_beneficiary_followup_status_coverage_state'
  ) as passed,
  'beneficiary_followup_status.coverage_state debe tener indice dedicado.' as details;

insert into qa_results
select
  'beneficiaries_tele_rls_hardened' as test_name,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'beneficiaries'
      and policyname = 'beneficiaries_select_teleoperadora_active_assignment'
  ) as passed,
  'Teleoperadora debe leer beneficiaries solo via asignacion activa.' as details;

insert into qa_results
select
  'beneficiary_contacts_tele_rls_hardened' as test_name,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'beneficiary_contacts'
      and policyname = 'beneficiary_contacts_select_teleoperadora_active_assignment'
  ) as passed,
  'Teleoperadora debe leer beneficiary_contacts solo via asignacion activa.' as details;

insert into qa_results
select
  'workspace_columns_present' as test_name,
  not exists (
    select 1
    from (
      values
        ('beneficiary_id'),
        ('beneficiary_name'),
        ('beneficiary_rut'),
        ('coverage_state'),
        ('priority_rank'),
        ('last_effective_followup_at'),
        ('days_since_effective_followup'),
        ('latest_outcome'),
        ('latest_contact_type'),
        ('assigned_operator_name')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'v_operational_follow_up_workspace'
        and column_name = required.column_name
    )
  ) as passed,
  'La vista debe exponer columnas operacionales obligatorias.' as details;

grant select on table qa_ctx to authenticated;
grant select, insert on table qa_results to authenticated;
grant select, insert on table qa_warnings to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select super_admin_id::text from qa_ctx), true);

create temporary table qa_admin_created_event as
select public.create_manual_follow_up_event(
  'f4600001-0000-0000-0000-000000000001'::uuid,
  'contact_beneficiary'::public.followup_event_type,
  'f46cccc1-0000-0000-0000-000000000001'::uuid,
  'QA 4.6 admin global event',
  now() - interval '1 day'
) as event_id;

create temporary table qa_admin_unassigned_event as
select public.create_manual_follow_up_event(
  'f4600003-0000-0000-0000-000000000003'::uuid,
  'internal_note'::public.followup_event_type,
  'f46cccc3-0000-0000-0000-000000000003'::uuid,
  'QA 4.6 admin unassigned event',
  now()
) as event_id;

select set_config('request.jwt.claim.sub', (select operator_a_id::text from qa_ctx), true);

create temporary table qa_operator_created_event as
select public.create_manual_follow_up_event(
  'f4600001-0000-0000-0000-000000000001'::uuid,
  'contact_beneficiary'::public.followup_event_type,
  'f46cccc1-0000-0000-0000-000000000001'::uuid,
  'QA 4.6 operator own event',
  now()
) as event_id;

do $$
begin
  perform public.create_manual_follow_up_event(
    'f4600002-0000-0000-0000-000000000002'::uuid,
    'contact_beneficiary'::public.followup_event_type,
    null,
    'QA 4.6 forbidden operator event',
    now()
  );

  insert into qa_results values (
    'teleoperator_cannot_create_manual_event_outside_assignment',
    false,
    'La teleoperadora pudo crear un evento fuera de su cartera activa.'
  );
exception
  when others then
    insert into qa_results values (
      'teleoperator_cannot_create_manual_event_outside_assignment',
      position('no pertenece a la cartera activa' in lower(sqlerrm)) > 0,
      sqlerrm
    );
end;
$$;

insert into qa_results
select
  'manual_event_assignment_id_not_null_when_active_assignment_exists',
  fe.assignment_id = 'f46aaaa1-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object(
    'event_id', fe.id,
    'assignment_id', fe.assignment_id
  )::text
from public.followup_events as fe
join qa_operator_created_event as q
  on q.event_id = fe.id;

insert into qa_results
select
  'manual_event_assigned_user_matches_active_assignment_for_admin',
  fe.assigned_user_id = (select operator_a_id from qa_ctx)
    and fe.operator_profile_id = (select super_admin_id from qa_ctx)
    and fe.created_by = (select super_admin_id from qa_ctx),
  jsonb_build_object(
    'event_id', fe.id,
    'assigned_user_id', fe.assigned_user_id,
    'operator_profile_id', fe.operator_profile_id,
    'created_by', fe.created_by
  )::text
from public.followup_events as fe
join qa_admin_created_event as q
  on q.event_id = fe.id;

insert into qa_results
select
  'manual_event_assigned_user_matches_actor_assignment_for_teleoperator',
  fe.assigned_user_id = (select operator_a_id from qa_ctx)
    and fe.operator_profile_id = (select operator_a_id from qa_ctx)
    and fe.created_by = (select operator_a_id from qa_ctx),
  jsonb_build_object(
    'event_id', fe.id,
    'assigned_user_id', fe.assigned_user_id,
    'operator_profile_id', fe.operator_profile_id,
    'created_by', fe.created_by
  )::text
from public.followup_events as fe
join qa_operator_created_event as q
  on q.event_id = fe.id;

insert into qa_results
select
  'manual_event_allows_admin_global_creation_without_assignment',
  fe.id is not null
    and fe.assignment_id is null
    and fe.assigned_user_id is null
    and fe.operator_profile_id = (select super_admin_id from qa_ctx),
  jsonb_build_object(
    'event_id', fe.id,
    'assignment_id', fe.assignment_id,
    'assigned_user_id', fe.assigned_user_id,
    'operator_profile_id', fe.operator_profile_id
  )::text
from public.followup_events as fe
join qa_admin_unassigned_event as q
  on q.event_id = fe.id;

select set_config('request.jwt.claim.sub', (select operator_a_id::text from qa_ctx), true);

insert into qa_results
select
  'workspace_rls_isolated_for_teleoperator',
  count(*) = 1
    and bool_and(beneficiary_id = 'f4600001-0000-0000-0000-000000000001'::uuid),
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.v_operational_follow_up_workspace
where beneficiary_id in (
  'f4600001-0000-0000-0000-000000000001'::uuid,
  'f4600002-0000-0000-0000-000000000002'::uuid,
  'f4600003-0000-0000-0000-000000000003'::uuid
);

select set_config('request.jwt.claim.sub', (select admin_id::text from qa_ctx), true);

insert into qa_results
select
  'workspace_global_visibility_for_admin',
  count(*) = 3,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.v_operational_follow_up_workspace
where beneficiary_id in (
  'f4600001-0000-0000-0000-000000000001'::uuid,
  'f4600002-0000-0000-0000-000000000002'::uuid,
  'f4600003-0000-0000-0000-000000000003'::uuid
);

select set_config('request.jwt.claim.sub', (select super_admin_id::text from qa_ctx), true);

insert into qa_results
select
  'workspace_global_visibility_for_super_admin',
  count(*) = 3,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.v_operational_follow_up_workspace
where beneficiary_id in (
  'f4600001-0000-0000-0000-000000000001'::uuid,
  'f4600002-0000-0000-0000-000000000002'::uuid,
  'f4600003-0000-0000-0000-000000000003'::uuid
);

select *
from qa_results
where not passed
order by test_name;

select *
from qa_warnings
order by warning_name;

select *
from qa_results
order by test_name;

select
  count(*)::integer as total_tests,
  count(*) filter (where passed)::integer as passed_tests,
  count(*) filter (where not passed)::integer as failed_tests
from qa_results;

rollback;