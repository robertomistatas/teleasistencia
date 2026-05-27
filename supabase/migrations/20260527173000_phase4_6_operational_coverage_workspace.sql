-- =============================================
-- phase4_6_operational_coverage_workspace
-- Operational coverage workspace backed only by
-- canonical follow_up_events and beneficiary
-- follow-up status.
-- =============================================

drop policy if exists "beneficiaries_select_all_roles" on public.beneficiaries;

create policy "beneficiaries_select_admin_super_admin"
  on public.beneficiaries
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
  );

create policy "beneficiaries_select_teleoperadora_active_assignment"
  on public.beneficiaries
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) = 'teleoperadora'
    and exists (
      select 1
      from public.beneficiary_assignments as ba
      where ba.beneficiary_id = public.beneficiaries.id
        and ba.assigned_user_id = (select auth.uid())
        and ba.status = 'active'
        and ba.starts_at <= now()
        and (ba.ends_at is null or ba.ends_at >= now())
    )
  );

drop policy if exists "beneficiary_contacts_select_all_roles" on public.beneficiary_contacts;

create policy "beneficiary_contacts_select_admin_super_admin"
  on public.beneficiary_contacts
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
  );

create policy "beneficiary_contacts_select_teleoperadora_active_assignment"
  on public.beneficiary_contacts
  for select
  to authenticated
  using (
    public.get_user_role((select auth.uid())) = 'teleoperadora'
    and exists (
      select 1
      from public.beneficiary_assignments as ba
      where ba.beneficiary_id = public.beneficiary_contacts.beneficiary_id
        and ba.assigned_user_id = (select auth.uid())
        and ba.status = 'active'
        and ba.starts_at <= now()
        and (ba.ends_at is null or ba.ends_at >= now())
    )
  );

create index if not exists idx_beneficiary_followup_status_coverage_state
  on public.beneficiary_followup_status (coverage_state);

create or replace view public.v_operational_follow_up_workspace
with (security_invoker = true)
as
with latest_event as (
  select distinct on (fe.beneficiary_id)
    fe.beneficiary_id,
    fe.id as follow_up_event_id,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) as event_at,
    fe.event_outcome,
    fe.contact_type,
    fe.operator_profile_id,
    fe.source
  from public.followup_events as fe
  order by
    fe.beneficiary_id,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) desc,
    fe.created_at desc,
    fe.id desc
),
last_effective as (
  select distinct on (fe.beneficiary_id)
    fe.beneficiary_id,
    fe.id as follow_up_event_id,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) as last_effective_contact_at,
    fe.operator_profile_id
  from public.followup_events as fe
  where fe.is_effective_contact = true
  order by
    fe.beneficiary_id,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) desc,
    fe.created_at desc,
    fe.id desc
),
active_assignment as (
  select distinct on (ba.beneficiary_id)
    ba.beneficiary_id,
    ba.id as assignment_id,
    ba.assignment_type,
    ba.assigned_user_id,
    ba.starts_at
  from public.beneficiary_assignments as ba
  where ba.status = 'active'
    and ba.starts_at <= now()
    and (ba.ends_at is null or ba.ends_at >= now())
  order by
    ba.beneficiary_id,
    case when ba.assignment_type = 'primary' then 0 else 1 end,
    ba.starts_at desc,
    ba.created_at desc,
    ba.id asc
)
select
  b.id as beneficiary_id,
  b.full_name as beneficiary_name,
  b.rut_raw as beneficiary_rut,
  b.commune as beneficiary_commune,
  b.region as beneficiary_region,
  coalesce(bfs.coverage_state, 'sin_contacto'::public.follow_up_coverage_state) as coverage_state,
  case coalesce(bfs.coverage_state, 'sin_contacto'::public.follow_up_coverage_state)
    when 'urgente' then 1
    when 'pendiente' then 2
    when 'sin_contacto' then 3
    else 4
  end as priority_rank,
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
  bfs.calculated_at as status_calculated_at
from public.beneficiaries as b
left join public.beneficiary_followup_status as bfs
  on bfs.beneficiary_id = b.id
left join latest_event
  on latest_event.beneficiary_id = b.id
left join last_effective as le
  on le.beneficiary_id = b.id
left join active_assignment as aa
  on aa.beneficiary_id = b.id
left join public.profiles as assignee
  on assignee.id = aa.assigned_user_id
left join public.profiles as last_operator
  on last_operator.id = coalesce(latest_event.operator_profile_id, le.operator_profile_id)
where b.status = 'active';

create or replace function public.create_manual_follow_up_event(
  p_beneficiary_id uuid,
  p_event_type public.followup_event_type,
  p_beneficiary_contact_id uuid default null,
  p_notes text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_role public.user_role;
  v_contact public.beneficiary_contacts%rowtype;
  v_active_assignment public.beneficiary_assignments%rowtype;
  v_contact_type public.follow_up_contact_type;
  v_event_outcome public.follow_up_event_outcome;
  v_requires_support boolean;
  v_is_valid_followup boolean;
  v_follow_up_event_id uuid;
begin
  if v_actor_id is null then
    raise exception 'No existe usuario autenticado para registrar el seguimiento.';
  end if;

  v_actor_role := public.get_user_role(v_actor_id);

  if v_actor_role not in ('teleoperadora', 'admin', 'super_admin') then
    raise exception 'El rol autenticado no puede registrar seguimientos manuales.';
  end if;

  if p_beneficiary_contact_id is not null then
    select *
    into v_contact
    from public.beneficiary_contacts as bc
    where bc.id = p_beneficiary_contact_id
      and bc.beneficiary_id = p_beneficiary_id;

    if not found then
      raise exception 'El contacto seleccionado no pertenece al beneficiario.';
    end if;
  end if;

  if v_actor_role = 'teleoperadora' then
    select ba.*
    into v_active_assignment
    from public.beneficiary_assignments as ba
    where ba.beneficiary_id = p_beneficiary_id
      and ba.assigned_user_id = v_actor_id
      and ba.status = 'active'
      and ba.starts_at <= now()
      and (ba.ends_at is null or ba.ends_at >= now())
    order by
      case when ba.assignment_type = 'primary' then 0 else 1 end,
      ba.starts_at desc,
      ba.created_at desc,
      ba.id asc
    limit 1;

    if v_active_assignment.id is null then
      raise exception 'El beneficiario no pertenece a la cartera activa de la teleoperadora.';
    end if;
  else
    select ba.*
    into v_active_assignment
    from public.beneficiary_assignments as ba
    where ba.beneficiary_id = p_beneficiary_id
      and ba.status = 'active'
      and ba.starts_at <= now()
      and (ba.ends_at is null or ba.ends_at >= now())
    order by
      case when ba.assignment_type = 'primary' then 0 else 1 end,
      ba.starts_at desc,
      ba.created_at desc,
      ba.id asc
    limit 1;
  end if;

  v_contact_type := case
    when v_contact.id is not null and v_contact.contact_type in ('primary_phone', 'app_phone', 'sim_phone') then 'principal'::public.follow_up_contact_type
    when v_contact.id is not null and v_contact.contact_type in ('support_network', 'family_contact', 'emergency_contact') then 'red_apoyo'::public.follow_up_contact_type
    when p_event_type = 'contact_support_network' then 'red_apoyo'::public.follow_up_contact_type
    when p_event_type = 'contact_beneficiary' then 'principal'::public.follow_up_contact_type
    else 'desconocido'::public.follow_up_contact_type
  end;

  v_event_outcome := case p_event_type
    when 'contact_beneficiary' then 'contacto_efectivo'::public.follow_up_event_outcome
    when 'contact_support_network' then 'contacto_efectivo'::public.follow_up_event_outcome
    when 'requests_help' then 'contacto_efectivo'::public.follow_up_event_outcome
    when 'no_answer' then 'no_responde'::public.follow_up_event_outcome
    when 'phone_off' then 'no_responde'::public.follow_up_event_outcome
    when 'wrong_number' then 'numero_invalido'::public.follow_up_event_outcome
    else 'sin_clasificar'::public.follow_up_event_outcome
  end;

  v_requires_support := p_event_type in ('requests_help', 'support_referral');
  v_is_valid_followup := p_event_type in ('contact_beneficiary', 'contact_support_network', 'requests_help');

  insert into public.followup_events (
    beneficiary_id,
    beneficiary_contact_id,
    assignment_id,
    assigned_user_id,
    created_by,
    operator_profile_id,
    source,
    event_type,
    occurred_at,
    event_timestamp,
    event_outcome,
    is_effective_contact,
    contact_phone,
    contact_type,
    is_valid_followup,
    requires_support,
    notes
  )
  values (
    p_beneficiary_id,
    p_beneficiary_contact_id,
    v_active_assignment.id,
    v_active_assignment.assigned_user_id,
    v_actor_id,
    v_actor_id,
    'manual'::public.followup_event_source,
    p_event_type,
    coalesce(p_occurred_at, now()),
    coalesce(p_occurred_at, now()),
    v_event_outcome,
    v_event_outcome = 'contacto_efectivo'::public.follow_up_event_outcome,
    coalesce(v_contact.phone_raw, v_contact.phone_normalized),
    v_contact_type,
    v_is_valid_followup,
    v_requires_support,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_follow_up_event_id;

  return v_follow_up_event_id;
end;
$$;

comment on view public.v_operational_follow_up_workspace
  is 'Operational queue for Phase 4.6. Provides beneficiary coverage, priority, latest outcome and active assignment using canonical follow-up data only.';

comment on function public.create_manual_follow_up_event(uuid, public.followup_event_type, uuid, text, timestamptz)
  is 'Creates a canonical manual follow-up event, persisting the active assignment context and actor attribution without duplicating coverage logic in the client.';

revoke all on function public.create_manual_follow_up_event(uuid, public.followup_event_type, uuid, text, timestamptz) from public;

grant execute on function public.create_manual_follow_up_event(uuid, public.followup_event_type, uuid, text, timestamptz) to authenticated;

grant select on public.v_operational_follow_up_workspace to authenticated;