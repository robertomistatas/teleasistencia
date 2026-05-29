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
  tele.tele_1_id as operator_a_id,
  tele.tele_2_id as operator_b_id
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
  'ctx_roles_available',
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
    'message', 'Las identidades QA resueltas no son todas distintas. La cobertura de aislamiento por rol se debilita si el entorno es muy pobre.',
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

delete from public.beneficiary_followup_status
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001',
  'f4700002-0000-0000-0000-000000000002',
  'f4700003-0000-0000-0000-000000000003',
  'f4700004-0000-0000-0000-000000000004'
);

delete from public.followup_events
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001',
  'f4700002-0000-0000-0000-000000000002',
  'f4700003-0000-0000-0000-000000000003',
  'f4700004-0000-0000-0000-000000000004'
);

delete from public.call_interactions
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001',
  'f4700002-0000-0000-0000-000000000002',
  'f4700003-0000-0000-0000-000000000003',
  'f4700004-0000-0000-0000-000000000004'
);

delete from public.beneficiary_assignments
where id in (
  'f47aaaa1-0000-0000-0000-000000000001',
  'f47aaaa2-0000-0000-0000-000000000002',
  'f47aaaa3-0000-0000-0000-000000000003'
);

delete from public.beneficiary_contacts
where id in (
  'f47cccc1-0000-0000-0000-000000000001',
  'f47cccc2-0000-0000-0000-000000000002',
  'f47cccc3-0000-0000-0000-000000000003',
  'f47cccc4-0000-0000-0000-000000000004'
);

delete from public.beneficiaries
where id in (
  'f4700001-0000-0000-0000-000000000001',
  'f4700002-0000-0000-0000-000000000002',
  'f4700003-0000-0000-0000-000000000003',
  'f4700004-0000-0000-0000-000000000004'
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
    ('f4700001-0000-0000-0000-000000000001'::uuid, '98.770.001-1', public.normalize_rut('98.770.001-1'), 'QA47', 'Vigente', 'QA47 Vigente', 'active'::public.beneficiary_status),
    ('f4700002-0000-0000-0000-000000000002'::uuid, '98.770.002-2', public.normalize_rut('98.770.002-2'), 'QA47', 'Futura', 'QA47 Futura', 'active'::public.beneficiary_status),
    ('f4700003-0000-0000-0000-000000000003'::uuid, '98.770.003-3', public.normalize_rut('98.770.003-3'), 'QA47', 'Expirada', 'QA47 Expirada', 'active'::public.beneficiary_status),
    ('f4700004-0000-0000-0000-000000000004'::uuid, '98.770.004-4', public.normalize_rut('98.770.004-4'), 'QA47', 'SinAsignacion', 'QA47 SinAsignacion', 'active'::public.beneficiary_status)
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
  ('f47cccc1-0000-0000-0000-000000000001', 'f4700001-0000-0000-0000-000000000001', 'primary_phone', 'QA47 Contacto Vigente', '+56 9 7111 1111', public.normalize_chilean_phone('+56 9 7111 1111'), true, true),
  ('f47cccc2-0000-0000-0000-000000000002', 'f4700002-0000-0000-0000-000000000002', 'primary_phone', 'QA47 Contacto Futuro', '+56 9 7222 2222', public.normalize_chilean_phone('+56 9 7222 2222'), true, true),
  ('f47cccc3-0000-0000-0000-000000000003', 'f4700003-0000-0000-0000-000000000003', 'primary_phone', 'QA47 Contacto Expirado', '+56 9 7333 3333', public.normalize_chilean_phone('+56 9 7333 3333'), true, true),
  ('f47cccc4-0000-0000-0000-000000000004', 'f4700004-0000-0000-0000-000000000004', 'primary_phone', 'QA47 Contacto Libre', '+56 9 7444 4444', public.normalize_chilean_phone('+56 9 7444 4444'), true, true)
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
  ends_at,
  source,
  created_by,
  updated_by,
  reason
)
select
  v.id,
  v.beneficiary_id,
  v.assigned_user_id,
  'primary',
  'active',
  v.starts_at,
  v.ends_at,
  'manual',
  c.super_admin_id,
  c.super_admin_id,
  'QA phase 4.7 fixture'
from qa_ctx c
cross join lateral (
  values
    ('f47aaaa1-0000-0000-0000-000000000001'::uuid, 'f4700001-0000-0000-0000-000000000001'::uuid, c.operator_a_id, now() - interval '20 days', null::timestamptz),
    ('f47aaaa2-0000-0000-0000-000000000002'::uuid, 'f4700002-0000-0000-0000-000000000002'::uuid, c.operator_b_id, now() + interval '3 days', null::timestamptz),
    ('f47aaaa3-0000-0000-0000-000000000003'::uuid, 'f4700003-0000-0000-0000-000000000003'::uuid, c.operator_b_id, now() - interval '20 days', now() - interval '1 day')
) as v(id, beneficiary_id, assigned_user_id, starts_at, ends_at)
on conflict (id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  assigned_user_id = excluded.assigned_user_id,
  assignment_type = excluded.assignment_type,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  updated_by = excluded.updated_by,
  updated_at = now();

insert into public.call_interactions (
  id,
  source,
  call_date,
  started_at,
  ended_at,
  duration_seconds,
  direction,
  phone_raw,
  phone_normalized,
  beneficiary_id,
  beneficiary_contact_id,
  matched_status,
  is_valid_contact,
  counts_as_valid_followup,
  handled_by_user_id,
  amaia_result_raw,
  notes
)
select
  v.id,
  'manual',
  current_date - 1,
  now() - interval '1 day',
  now() - interval '1 day' + interval '5 minutes',
  300,
  'outgoing',
  v.phone_raw,
  public.normalize_chilean_phone(v.phone_raw),
  v.beneficiary_id,
  v.contact_id,
  'matched',
  true,
  true,
  c.super_admin_id,
  'QA 4.7 llamada base',
  v.notes
from qa_ctx c
cross join lateral (
  values
    ('f4711111-0000-0000-0000-000000000001'::uuid, 'f4700001-0000-0000-0000-000000000001'::uuid, 'f47cccc1-0000-0000-0000-000000000001'::uuid, '+56 9 7111 1111', 'QA 4.7 vigente'),
    ('f4711112-0000-0000-0000-000000000002'::uuid, 'f4700002-0000-0000-0000-000000000002'::uuid, 'f47cccc2-0000-0000-0000-000000000002'::uuid, '+56 9 7222 2222', 'QA 4.7 futura'),
    ('f4711113-0000-0000-0000-000000000003'::uuid, 'f4700003-0000-0000-0000-000000000003'::uuid, 'f47cccc3-0000-0000-0000-000000000003'::uuid, '+56 9 7333 3333', 'QA 4.7 expirada'),
    ('f4711114-0000-0000-0000-000000000004'::uuid, 'f4700004-0000-0000-0000-000000000004'::uuid, 'f47cccc4-0000-0000-0000-000000000004'::uuid, '+56 9 7444 4444', 'QA 4.7 sin asignacion')
) as v(id, beneficiary_id, contact_id, phone_raw, notes)
on conflict (id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  beneficiary_contact_id = excluded.beneficiary_contact_id,
  handled_by_user_id = excluded.handled_by_user_id,
  notes = excluded.notes,
  updated_at = now();

insert into public.followup_events (
  id,
  beneficiary_id,
  beneficiary_contact_id,
  assignment_id,
  assigned_user_id,
  operator_profile_id,
  created_by,
  source,
  event_type,
  occurred_at,
  event_timestamp,
  event_outcome,
  is_effective_contact,
  contact_type,
  notes
)
select
  v.id,
  v.beneficiary_id,
  v.contact_id,
  v.assignment_id,
  v.assigned_user_id,
  c.super_admin_id,
  c.super_admin_id,
  'manual',
  'contact_beneficiary',
  now() - interval '2 days',
  now() - interval '2 days',
  'contacto_efectivo',
  true,
  'principal',
  v.notes
from qa_ctx c
cross join lateral (
  values
    ('f47eeee1-0000-0000-0000-000000000001'::uuid, 'f4700001-0000-0000-0000-000000000001'::uuid, 'f47cccc1-0000-0000-0000-000000000001'::uuid, 'f47aaaa1-0000-0000-0000-000000000001'::uuid, c.operator_a_id, 'QA 4.7 evento vigente'),
    ('f47eeee2-0000-0000-0000-000000000002'::uuid, 'f4700002-0000-0000-0000-000000000002'::uuid, 'f47cccc2-0000-0000-0000-000000000002'::uuid, 'f47aaaa2-0000-0000-0000-000000000002'::uuid, c.operator_b_id, 'QA 4.7 evento futuro'),
    ('f47eeee3-0000-0000-0000-000000000003'::uuid, 'f4700003-0000-0000-0000-000000000003'::uuid, 'f47cccc3-0000-0000-0000-000000000003'::uuid, 'f47aaaa3-0000-0000-0000-000000000003'::uuid, c.operator_b_id, 'QA 4.7 evento expirado'),
    ('f47eeee4-0000-0000-0000-000000000004'::uuid, 'f4700004-0000-0000-0000-000000000004'::uuid, 'f47cccc4-0000-0000-0000-000000000004'::uuid, null::uuid, null::uuid, 'QA 4.7 evento sin asignacion')
) as v(id, beneficiary_id, contact_id, assignment_id, assigned_user_id, notes)
on conflict (id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  beneficiary_contact_id = excluded.beneficiary_contact_id,
  assignment_id = excluded.assignment_id,
  assigned_user_id = excluded.assigned_user_id,
  operator_profile_id = excluded.operator_profile_id,
  created_by = excluded.created_by,
  source = excluded.source,
  event_type = excluded.event_type,
  occurred_at = excluded.occurred_at,
  event_timestamp = excluded.event_timestamp,
  event_outcome = excluded.event_outcome,
  is_effective_contact = excluded.is_effective_contact,
  contact_type = excluded.contact_type,
  notes = excluded.notes,
  updated_at = now();

insert into public.beneficiary_followup_status (
  beneficiary_id,
  status,
  last_valid_followup_at,
  last_valid_followup_event_id,
  days_since_last_valid_followup,
  calculated_at
)
values
  ('f4700001-0000-0000-0000-000000000001', 'up_to_date', now() - interval '2 days', 'f47eeee1-0000-0000-0000-000000000001', 2, now()),
  ('f4700002-0000-0000-0000-000000000002', 'pending', now() - interval '20 days', 'f47eeee2-0000-0000-0000-000000000002', 20, now()),
  ('f4700003-0000-0000-0000-000000000003', 'urgent', now() - interval '40 days', 'f47eeee3-0000-0000-0000-000000000003', 40, now()),
  ('f4700004-0000-0000-0000-000000000004', 'no_data', null, null, null, now())
on conflict (beneficiary_id) do update
set
  status = excluded.status,
  last_valid_followup_at = excluded.last_valid_followup_at,
  last_valid_followup_event_id = excluded.last_valid_followup_event_id,
  days_since_last_valid_followup = excluded.days_since_last_valid_followup,
  calculated_at = excluded.calculated_at,
  updated_at = now();

insert into qa_results
select
  'policy_followup_events_select_temporal_exists',
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'followup_events'
      and policyname = 'followup_events_select_teleoperadora_active_assignment'
      and coalesce(qual, '') ilike '%ba.starts_at <= now()%'
      and coalesce(qual, '') ilike '%ba.ends_at is null%'
      and coalesce(qual, '') ilike '%ba.ends_at >= now()%'
  ),
  'La policy select de followup_events para teleoperadora debe incluir ventana temporal vigente.';

insert into qa_results
select
  'policy_followup_events_insert_temporal_exists',
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'followup_events'
      and policyname = 'followup_events_insert_teleoperadora_manual_own_assignment'
      and coalesce(with_check, '') ilike '%ba.starts_at <= now()%'
      and coalesce(with_check, '') ilike '%ba.ends_at is null%'
      and coalesce(with_check, '') ilike '%ba.ends_at >= now()%'
  ),
  'La policy insert de followup_events para teleoperadora debe incluir ventana temporal vigente.';

insert into qa_results
select
  'policy_beneficiary_followup_status_select_temporal_exists',
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'beneficiary_followup_status'
      and policyname = 'beneficiary_followup_status_select_teleoperadora_active_assignment'
      and coalesce(qual, '') ilike '%ba.starts_at <= now()%'
      and coalesce(qual, '') ilike '%ba.ends_at is null%'
      and coalesce(qual, '') ilike '%ba.ends_at >= now()%'
  ),
  'La policy select de beneficiary_followup_status para teleoperadora debe incluir ventana temporal vigente.';

insert into qa_results
select
  'policy_call_interactions_select_temporal_exists',
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'call_interactions'
      and policyname = 'call_interactions_select_teleoperadora_active_assignment'
      and coalesce(qual, '') ilike '%ba.starts_at <= now()%'
      and coalesce(qual, '') ilike '%ba.ends_at is null%'
      and coalesce(qual, '') ilike '%ba.ends_at >= now()%'
  ),
  'La policy select de call_interactions para teleoperadora debe incluir ventana temporal vigente.';

grant select, insert on table qa_results to authenticated;
grant select, insert on table qa_warnings to authenticated;
grant select on table qa_ctx to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select operator_a_id::text from qa_ctx), true);

insert into qa_results
select
  'teleoperator_current_assignment_can_select_followup_events',
  count(*) = 1 and bool_and(beneficiary_id = 'f4700001-0000-0000-0000-000000000001'::uuid),
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.followup_events
where beneficiary_id = 'f4700001-0000-0000-0000-000000000001'::uuid;

insert into qa_results
select
  'teleoperator_current_assignment_can_select_beneficiary_followup_status',
  count(*) = 1 and bool_and(beneficiary_id = 'f4700001-0000-0000-0000-000000000001'::uuid),
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.beneficiary_followup_status
where beneficiary_id = 'f4700001-0000-0000-0000-000000000001'::uuid;

insert into qa_results
select
  'teleoperator_current_assignment_can_select_call_interactions',
  count(*) = 1 and bool_and(beneficiary_id = 'f4700001-0000-0000-0000-000000000001'::uuid),
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.call_interactions
where beneficiary_id = 'f4700001-0000-0000-0000-000000000001'::uuid;

insert into qa_results
select
  'teleoperator_without_assignment_cannot_select_followup_events',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.followup_events
where beneficiary_id = 'f4700004-0000-0000-0000-000000000004'::uuid;

insert into qa_results
select
  'teleoperator_without_assignment_cannot_select_beneficiary_followup_status',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.beneficiary_followup_status
where beneficiary_id = 'f4700004-0000-0000-0000-000000000004'::uuid;

insert into qa_results
select
  'teleoperator_without_assignment_cannot_select_call_interactions',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.call_interactions
where beneficiary_id = 'f4700004-0000-0000-0000-000000000004'::uuid;

select set_config('request.jwt.claim.sub', (select operator_b_id::text from qa_ctx), true);

insert into qa_results
select
  'teleoperator_future_assignment_cannot_select_followup_events',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.followup_events
where beneficiary_id = 'f4700002-0000-0000-0000-000000000002'::uuid;

insert into qa_results
select
  'teleoperator_future_assignment_cannot_select_beneficiary_followup_status',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.beneficiary_followup_status
where beneficiary_id = 'f4700002-0000-0000-0000-000000000002'::uuid;

insert into qa_results
select
  'teleoperator_future_assignment_cannot_select_call_interactions',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.call_interactions
where beneficiary_id = 'f4700002-0000-0000-0000-000000000002'::uuid;

insert into qa_results
select
  'teleoperator_expired_assignment_cannot_select_followup_events',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.followup_events
where beneficiary_id = 'f4700003-0000-0000-0000-000000000003'::uuid;

insert into qa_results
select
  'teleoperator_expired_assignment_cannot_select_beneficiary_followup_status',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.beneficiary_followup_status
where beneficiary_id = 'f4700003-0000-0000-0000-000000000003'::uuid;

insert into qa_results
select
  'teleoperator_expired_assignment_cannot_select_call_interactions',
  count(*) = 0,
  jsonb_build_object('visible_count', count(*))::text
from public.call_interactions
where beneficiary_id = 'f4700003-0000-0000-0000-000000000003'::uuid;

select set_config('request.jwt.claim.sub', (select admin_id::text from qa_ctx), true);

insert into qa_results
select
  'admin_global_visibility_followup_events',
  count(*) = 4,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.followup_events
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001'::uuid,
  'f4700002-0000-0000-0000-000000000002'::uuid,
  'f4700003-0000-0000-0000-000000000003'::uuid,
  'f4700004-0000-0000-0000-000000000004'::uuid
);

insert into qa_results
select
  'admin_global_visibility_beneficiary_followup_status',
  count(*) = 4,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.beneficiary_followup_status
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001'::uuid,
  'f4700002-0000-0000-0000-000000000002'::uuid,
  'f4700003-0000-0000-0000-000000000003'::uuid,
  'f4700004-0000-0000-0000-000000000004'::uuid
);

insert into qa_results
select
  'admin_global_visibility_call_interactions',
  count(*) = 4,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.call_interactions
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001'::uuid,
  'f4700002-0000-0000-0000-000000000002'::uuid,
  'f4700003-0000-0000-0000-000000000003'::uuid,
  'f4700004-0000-0000-0000-000000000004'::uuid
);

select set_config('request.jwt.claim.sub', (select super_admin_id::text from qa_ctx), true);

insert into qa_results
select
  'super_admin_global_visibility_followup_events',
  count(*) = 4,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.followup_events
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001'::uuid,
  'f4700002-0000-0000-0000-000000000002'::uuid,
  'f4700003-0000-0000-0000-000000000003'::uuid,
  'f4700004-0000-0000-0000-000000000004'::uuid
);

insert into qa_results
select
  'super_admin_global_visibility_beneficiary_followup_status',
  count(*) = 4,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.beneficiary_followup_status
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001'::uuid,
  'f4700002-0000-0000-0000-000000000002'::uuid,
  'f4700003-0000-0000-0000-000000000003'::uuid,
  'f4700004-0000-0000-0000-000000000004'::uuid
);

insert into qa_results
select
  'super_admin_global_visibility_call_interactions',
  count(*) = 4,
  jsonb_build_object(
    'visible_count', count(*),
    'beneficiary_ids', coalesce(jsonb_agg(beneficiary_id order by beneficiary_id), '[]'::jsonb)
  )::text
from public.call_interactions
where beneficiary_id in (
  'f4700001-0000-0000-0000-000000000001'::uuid,
  'f4700002-0000-0000-0000-000000000002'::uuid,
  'f4700003-0000-0000-0000-000000000003'::uuid,
  'f4700004-0000-0000-0000-000000000004'::uuid
);

select set_config('request.jwt.claim.sub', (select operator_a_id::text from qa_ctx), true);

do $$
begin
  insert into public.followup_events (
    beneficiary_id,
    beneficiary_contact_id,
    assigned_user_id,
    operator_profile_id,
    created_by,
    source,
    event_type,
    occurred_at,
    event_timestamp,
    event_outcome,
    is_effective_contact,
    contact_type,
    notes
  )
  values (
    'f4700001-0000-0000-0000-000000000001'::uuid,
    null,
    (select operator_a_id from qa_ctx),
    (select operator_a_id from qa_ctx),
    (select operator_a_id from qa_ctx),
    'manual'::public.followup_event_source,
    'internal_note'::public.followup_event_type,
    now(),
    now(),
    'sin_clasificar'::public.follow_up_event_outcome,
    false,
    'desconocido'::public.follow_up_contact_type,
    'QA 4.7 insert vigente teleoperadora'
  );

  insert into qa_results values (
    'teleoperator_current_assignment_can_insert_followup_event',
    true,
    'La teleoperadora pudo insertar un followup manual sobre asignacion vigente.'
  );
exception
  when others then
    insert into qa_results values (
      'teleoperator_current_assignment_can_insert_followup_event',
      false,
      sqlerrm
    );
end;
$$;

select set_config('request.jwt.claim.sub', (select operator_b_id::text from qa_ctx), true);

do $$
begin
  insert into public.followup_events (
    beneficiary_id,
    beneficiary_contact_id,
    assigned_user_id,
    operator_profile_id,
    created_by,
    source,
    event_type,
    occurred_at,
    event_timestamp,
    event_outcome,
    is_effective_contact,
    contact_type,
    notes
  )
  values (
    'f4700002-0000-0000-0000-000000000002'::uuid,
    null,
    (select operator_b_id from qa_ctx),
    (select operator_b_id from qa_ctx),
    (select operator_b_id from qa_ctx),
    'manual'::public.followup_event_source,
    'internal_note'::public.followup_event_type,
    now(),
    now(),
    'sin_clasificar'::public.follow_up_event_outcome,
    false,
    'desconocido'::public.follow_up_contact_type,
    'QA 4.7 insert futuro teleoperadora'
  );

  insert into qa_results values (
    'teleoperator_future_assignment_cannot_insert_followup_event',
    false,
    'La teleoperadora pudo insertar un followup con asignacion futura.'
  );
exception
  when others then
    insert into qa_results values (
      'teleoperator_future_assignment_cannot_insert_followup_event',
      position('row-level security' in lower(sqlerrm)) > 0,
      sqlerrm
    );
end;
$$;

do $$
begin
  insert into public.followup_events (
    beneficiary_id,
    beneficiary_contact_id,
    assigned_user_id,
    operator_profile_id,
    created_by,
    source,
    event_type,
    occurred_at,
    event_timestamp,
    event_outcome,
    is_effective_contact,
    contact_type,
    notes
  )
  values (
    'f4700003-0000-0000-0000-000000000003'::uuid,
    null,
    (select operator_b_id from qa_ctx),
    (select operator_b_id from qa_ctx),
    (select operator_b_id from qa_ctx),
    'manual'::public.followup_event_source,
    'internal_note'::public.followup_event_type,
    now(),
    now(),
    'sin_clasificar'::public.follow_up_event_outcome,
    false,
    'desconocido'::public.follow_up_contact_type,
    'QA 4.7 insert expirado teleoperadora'
  );

  insert into qa_results values (
    'teleoperator_expired_assignment_cannot_insert_followup_event',
    false,
    'La teleoperadora pudo insertar un followup con asignacion expirada.'
  );
exception
  when others then
    insert into qa_results values (
      'teleoperator_expired_assignment_cannot_insert_followup_event',
      position('row-level security' in lower(sqlerrm)) > 0,
      sqlerrm
    );
end;
$$;

select set_config('request.jwt.claim.sub', (select operator_a_id::text from qa_ctx), true);

do $$
begin
  insert into public.followup_events (
    beneficiary_id,
    beneficiary_contact_id,
    assigned_user_id,
    operator_profile_id,
    created_by,
    source,
    event_type,
    occurred_at,
    event_timestamp,
    event_outcome,
    is_effective_contact,
    contact_type,
    notes
  )
  values (
    'f4700004-0000-0000-0000-000000000004'::uuid,
    null,
    (select operator_a_id from qa_ctx),
    (select operator_a_id from qa_ctx),
    (select operator_a_id from qa_ctx),
    'manual'::public.followup_event_source,
    'internal_note'::public.followup_event_type,
    now(),
    now(),
    'sin_clasificar'::public.follow_up_event_outcome,
    false,
    'desconocido'::public.follow_up_contact_type,
    'QA 4.7 insert sin asignacion teleoperadora'
  );

  insert into qa_results values (
    'teleoperator_without_assignment_cannot_insert_followup_event',
    false,
    'La teleoperadora pudo insertar un followup sin asignacion activa.'
  );
exception
  when others then
    insert into qa_results values (
      'teleoperator_without_assignment_cannot_insert_followup_event',
      position('row-level security' in lower(sqlerrm)) > 0,
      sqlerrm
    );
end;
$$;

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