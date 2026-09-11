do $$
begin
  create type public.operational_follow_up_state as enum (
    'al_dia',
    'pendiente',
    'urgente',
    'nuevo_en_gracia',
    'pendiente_primer_contacto',
    'urgente_sin_primer_contacto',
    'antiguedad_no_determinada'
  );
exception
  when duplicate_object then null;
end
$$;

create or replace function public.calculate_operational_follow_up_state(
  p_coverage_state public.follow_up_coverage_state,
  p_amaia_created_at timestamptz,
  p_active_amaia_match_count integer,
  p_reference_date date
)
returns public.operational_follow_up_state
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_age_days integer;
begin
  if p_coverage_state = 'al_dia' then
    return 'al_dia';
  elsif p_coverage_state = 'pendiente' then
    return 'pendiente';
  elsif p_coverage_state = 'urgente' then
    return 'urgente';
  end if;

  if coalesce(p_active_amaia_match_count, 0) <> 1 or p_amaia_created_at is null then
    return 'antiguedad_no_determinada';
  end if;

  v_age_days := p_reference_date - (p_amaia_created_at at time zone 'America/Santiago')::date;

  if v_age_days < 0 then
    return 'antiguedad_no_determinada';
  elsif v_age_days <= 15 then
    return 'nuevo_en_gracia';
  elsif v_age_days <= 30 then
    return 'pendiente_primer_contacto';
  else
    return 'urgente_sin_primer_contacto';
  end if;
end;
$function$;

create or replace function public.calculate_operational_age_days(
  p_coverage_state public.follow_up_coverage_state,
  p_days_since_effective integer,
  p_amaia_created_at timestamptz,
  p_active_amaia_match_count integer,
  p_reference_date date
)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_age_days integer;
begin
  if p_coverage_state <> 'sin_contacto' then
    return p_days_since_effective;
  end if;

  if coalesce(p_active_amaia_match_count, 0) <> 1 or p_amaia_created_at is null then
    return null;
  end if;

  v_age_days := p_reference_date - (p_amaia_created_at at time zone 'America/Santiago')::date;
  if v_age_days < 0 then
    return null;
  end if;

  return v_age_days;
end;
$function$;

create or replace view public.v_operational_follow_up_workspace as
with latest_event as (
  select distinct on (fe.beneficiary_id)
    fe.beneficiary_id,
    fe.id as follow_up_event_id,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) as event_at,
    fe.event_outcome,
    fe.contact_type,
    fe.operator_profile_id,
    fe.source
  from public.followup_events fe
  order by fe.beneficiary_id, coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) desc, fe.created_at desc, fe.id desc
),
last_effective as (
  select distinct on (fe.beneficiary_id)
    fe.beneficiary_id,
    fe.id as follow_up_event_id,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) as last_effective_contact_at,
    fe.operator_profile_id
  from public.followup_events fe
  where fe.is_effective_contact = true
  order by fe.beneficiary_id, coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) desc, fe.created_at desc, fe.id desc
),
active_assignment as (
  select distinct on (ba.beneficiary_id)
    ba.beneficiary_id,
    ba.id as assignment_id,
    ba.assignment_type,
    ba.assigned_user_id,
    ba.starts_at
  from public.beneficiary_assignments ba
  where ba.status = 'active'::public.beneficiary_assignment_status
    and ba.starts_at <= now()
    and (ba.ends_at is null or ba.ends_at >= now())
  order by ba.beneficiary_id,
    case when ba.assignment_type = 'primary'::public.beneficiary_assignment_type then 0 else 1 end,
    ba.starts_at desc,
    ba.created_at desc,
    ba.id
),
active_amaia_identity as (
  select
    public.normalize_rut(ab.rut) as rut_normalized,
    count(*) filter (where ab.business_status_id = 1)::integer as active_match_count,
    case
      when count(*) filter (where ab.business_status_id = 1) = 1
      then max(ab.amaia_created_at) filter (where ab.business_status_id = 1)
      else null
    end as amaia_created_at_authority
  from public.amaia_beneficiaries ab
  where public.normalize_rut(ab.rut) is not null
  group by public.normalize_rut(ab.rut)
),
resolved as (
  select
    b.id as beneficiary_id,
    b.full_name as beneficiary_name,
    b.rut_raw as beneficiary_rut,
    b.commune as beneficiary_commune,
    b.region as beneficiary_region,
    coalesce(bfs.coverage_state, 'sin_contacto'::public.follow_up_coverage_state) as coverage_state,
    coalesce(bfs.last_valid_followup_at, le.last_effective_contact_at) as last_effective_followup_at,
    bfs.days_since_last_valid_followup as days_since_effective_followup,
    latest_event.follow_up_event_id as latest_follow_up_event_id,
    latest_event.event_at as latest_follow_up_event_at,
    latest_event.event_outcome as latest_outcome,
    latest_event.contact_type as latest_contact_type,
    latest_event.source as latest_source,
    aa.assignment_id as active_assignment_id,
    aa.assignment_type as active_assignment_type,
    aa.starts_at as active_assignment_starts_at,
    aa.assigned_user_id as assigned_operator_profile_id,
    coalesce(assignee.full_name, assignee.email) as assigned_operator_name,
    coalesce(last_operator.full_name, last_operator.email) as last_operator_name,
    bfs.status as legacy_followup_status,
    bfs.calculated_at as status_calculated_at,
    public.calculate_operational_follow_up_state(
      coalesce(bfs.coverage_state, 'sin_contacto'::public.follow_up_coverage_state),
      ai.amaia_created_at_authority,
      coalesce(ai.active_match_count, 0),
      (now() at time zone 'America/Santiago')::date
    ) as operational_state,
    public.calculate_operational_age_days(
      coalesce(bfs.coverage_state, 'sin_contacto'::public.follow_up_coverage_state),
      bfs.days_since_last_valid_followup,
      ai.amaia_created_at_authority,
      coalesce(ai.active_match_count, 0),
      (now() at time zone 'America/Santiago')::date
    ) as operational_age_days,
    coalesce(ai.active_match_count, 0) as amaia_active_match_count,
    ai.amaia_created_at_authority
  from public.beneficiaries b
  left join public.beneficiary_followup_status bfs on bfs.beneficiary_id = b.id
  left join latest_event on latest_event.beneficiary_id = b.id
  left join last_effective le on le.beneficiary_id = b.id
  left join active_assignment aa on aa.beneficiary_id = b.id
  left join public.profiles assignee on assignee.id = aa.assigned_user_id
  left join public.profiles last_operator on last_operator.id = coalesce(latest_event.operator_profile_id, le.operator_profile_id)
  left join active_amaia_identity ai
    on ai.rut_normalized = public.normalize_rut(coalesce(b.rut_normalized, b.rut_raw))
  where b.status = 'active'::public.beneficiary_status
    and b.service_type = 'municipal'::public.beneficiary_service_type
)
select
  beneficiary_id,
  beneficiary_name,
  beneficiary_rut,
  beneficiary_commune,
  beneficiary_region,
  coverage_state,
  case operational_state
    when 'urgente'::public.operational_follow_up_state then 1
    when 'urgente_sin_primer_contacto'::public.operational_follow_up_state then 1
    when 'pendiente'::public.operational_follow_up_state then 2
    when 'pendiente_primer_contacto'::public.operational_follow_up_state then 2
    when 'antiguedad_no_determinada'::public.operational_follow_up_state then 3
    when 'nuevo_en_gracia'::public.operational_follow_up_state then 4
    else 5
  end as priority_rank,
  last_effective_followup_at,
  days_since_effective_followup,
  latest_follow_up_event_id,
  latest_follow_up_event_at,
  latest_outcome,
  latest_contact_type,
  latest_source,
  active_assignment_id,
  active_assignment_type,
  active_assignment_starts_at,
  assigned_operator_profile_id,
  assigned_operator_name,
  last_operator_name,
  legacy_followup_status,
  status_calculated_at,
  operational_state,
  operational_age_days,
  amaia_active_match_count,
  amaia_created_at_authority
from resolved;

create or replace view public.v_operational_kpi_beneficiary_runtime as
select
  workspace.beneficiary_id,
  workspace.beneficiary_name,
  workspace.beneficiary_rut,
  workspace.beneficiary_commune,
  workspace.beneficiary_region,
  workspace.coverage_state,
  workspace.priority_rank,
  workspace.last_effective_followup_at,
  workspace.operational_age_days as aging_days,
  case
    when workspace.operational_state in (
      'urgente'::public.operational_follow_up_state,
      'urgente_sin_primer_contacto'::public.operational_follow_up_state
    ) and workspace.operational_age_days is not null
      then greatest(workspace.operational_age_days - 30, 0)
    else null
  end as overdue_days,
  workspace.operational_state = 'al_dia'::public.operational_follow_up_state as effective_coverage,
  workspace.operational_state in (
    'pendiente'::public.operational_follow_up_state,
    'pendiente_primer_contacto'::public.operational_follow_up_state
  ) as pending_coverage,
  workspace.operational_state in (
    'urgente'::public.operational_follow_up_state,
    'urgente_sin_primer_contacto'::public.operational_follow_up_state
  ) as overdue_coverage,
  workspace.operational_state in (
    'urgente'::public.operational_follow_up_state,
    'urgente_sin_primer_contacto'::public.operational_follow_up_state
  ) as urgent_coverage,
  workspace.operational_state in (
    'urgente'::public.operational_follow_up_state,
    'urgente_sin_primer_contacto'::public.operational_follow_up_state
  ) as stale_beneficiary,
  workspace.latest_follow_up_event_id,
  workspace.latest_follow_up_event_at,
  workspace.latest_outcome,
  workspace.latest_contact_type,
  workspace.latest_source,
  workspace.active_assignment_id,
  workspace.active_assignment_type,
  workspace.active_assignment_starts_at,
  workspace.assigned_operator_profile_id,
  workspace.assigned_operator_name,
  operator_profile.role as assigned_operator_role,
  coalesce(operator_profile.is_active, false) as assigned_operator_is_active,
  workspace.last_operator_name,
  workspace.legacy_followup_status,
  workspace.status_calculated_at,
  workspace.operational_state,
  workspace.amaia_created_at_authority
from public.v_operational_follow_up_workspace workspace
left join public.profiles operator_profile on operator_profile.id = workspace.assigned_operator_profile_id;

drop function if exists public.get_overdue_beneficiaries(integer);

create function public.get_overdue_beneficiaries(p_limit integer default 100)
returns table(
  beneficiary_id uuid,
  beneficiary_name text,
  beneficiary_rut text,
  coverage_state public.follow_up_coverage_state,
  operational_state public.operational_follow_up_state,
  aging_days integer,
  overdue_days integer,
  stale_beneficiary boolean,
  last_effective_followup_at timestamptz,
  assigned_operator_profile_id uuid,
  assigned_operator_name text,
  priority_rank integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requester_id uuid := (select auth.uid());
  v_requester_role public.user_role;
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
begin
  if v_requester_id is null then
    raise exception 'No autorizado para consultar cartera vencida';
  end if;

  select public.get_user_role(v_requester_id)
  into v_requester_role;

  if coalesce(v_requester_role::text, '') not in ('teleoperadora', 'admin', 'super_admin') then
    raise exception 'No autorizado para consultar cartera vencida';
  end if;

  return query
  select
    beneficiary.beneficiary_id,
    beneficiary.beneficiary_name,
    beneficiary.beneficiary_rut,
    beneficiary.coverage_state,
    beneficiary.operational_state,
    beneficiary.aging_days,
    beneficiary.overdue_days,
    beneficiary.stale_beneficiary,
    beneficiary.last_effective_followup_at,
    beneficiary.assigned_operator_profile_id,
    beneficiary.assigned_operator_name,
    beneficiary.priority_rank
  from public.v_operational_kpi_beneficiary_runtime beneficiary
  where beneficiary.stale_beneficiary = true
    and case
      when v_requester_role = 'teleoperadora' then exists (
        select 1
        from public.beneficiary_assignments assignment
        where assignment.beneficiary_id = beneficiary.beneficiary_id
          and assignment.assigned_user_id = v_requester_id
          and assignment.status = 'active'
          and assignment.starts_at <= now()
          and (assignment.ends_at is null or assignment.ends_at >= now())
      )
      else true
    end
  order by beneficiary.priority_rank asc,
    beneficiary.overdue_days desc nulls last,
    beneficiary.aging_days desc nulls last,
    beneficiary.beneficiary_name asc
  limit v_limit;
end;
$function$;

revoke all on function public.get_overdue_beneficiaries(integer) from public;
revoke all on function public.get_overdue_beneficiaries(integer) from anon;
grant execute on function public.get_overdue_beneficiaries(integer) to authenticated;
