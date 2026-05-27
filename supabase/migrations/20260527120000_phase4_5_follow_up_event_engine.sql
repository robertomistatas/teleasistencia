-- =============================================
-- phase4_5_follow_up_event_engine
-- Canonical follow-up event engine based on
-- correlated call logs -> followup_events ->
-- beneficiary coverage state.
-- =============================================

create type public.follow_up_event_outcome as enum (
  'contacto_efectivo',
  'no_responde',
  'ocupado',
  'mensaje_dejado',
  'numero_invalido',
  'rechaza_llamada',
  'sin_clasificar'
);

create type public.follow_up_contact_type as enum (
  'principal',
  'red_apoyo',
  'desconocido'
);

create type public.follow_up_coverage_state as enum (
  'al_dia',
  'pendiente',
  'urgente',
  'sin_contacto'
);

alter table public.followup_events
  add column if not exists call_log_id uuid references public.raw_call_logs (id) on delete set null,
  add column if not exists correlation_id uuid references public.call_correlations (id) on delete set null,
  add column if not exists assignment_id uuid references public.beneficiary_assignments (id) on delete set null,
  add column if not exists operator_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists event_timestamp timestamptz,
  add column if not exists event_outcome public.follow_up_event_outcome,
  add column if not exists is_effective_contact boolean,
  add column if not exists contact_phone text,
  add column if not exists contact_type public.follow_up_contact_type;

update public.followup_events
set
  event_timestamp = coalesce(event_timestamp, occurred_at, created_at),
  event_outcome = coalesce(
    event_outcome,
    case
      when event_type in ('contact_beneficiary', 'contact_support_network') then 'contacto_efectivo'::public.follow_up_event_outcome
      when event_type = 'wrong_number' then 'numero_invalido'::public.follow_up_event_outcome
      when event_type = 'no_answer' then 'no_responde'::public.follow_up_event_outcome
      else 'sin_clasificar'::public.follow_up_event_outcome
    end
  ),
  operator_profile_id = coalesce(operator_profile_id, created_by, assigned_user_id),
  contact_type = coalesce(
    contact_type,
    case
      when event_type = 'contact_support_network' then 'red_apoyo'::public.follow_up_contact_type
      when event_type = 'contact_beneficiary' then 'principal'::public.follow_up_contact_type
      else 'desconocido'::public.follow_up_contact_type
    end
  );

update public.followup_events
set is_effective_contact = (event_outcome = 'contacto_efectivo'::public.follow_up_event_outcome);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'followup_events_effective_contact_matches_outcome'
      and conrelid = 'public.followup_events'::regclass
  ) then
    alter table public.followup_events
      add constraint followup_events_effective_contact_matches_outcome
      check (
        (event_outcome = 'contacto_efectivo'::public.follow_up_event_outcome and is_effective_contact = true)
        or (event_outcome <> 'contacto_efectivo'::public.follow_up_event_outcome and is_effective_contact = false)
      );
  end if;
end;
$$;

alter table public.followup_events
  alter column event_timestamp set not null,
  alter column event_outcome set not null,
  alter column is_effective_contact set not null,
  alter column contact_type set not null,
  alter column event_timestamp set default now(),
  alter column event_outcome set default 'sin_clasificar'::public.follow_up_event_outcome,
  alter column is_effective_contact set default false,
  alter column contact_type set default 'desconocido'::public.follow_up_contact_type;

create unique index if not exists idx_followup_events_call_log_id_unique
  on public.followup_events (call_log_id);

create index if not exists idx_followup_events_event_timestamp_desc
  on public.followup_events (event_timestamp desc);

create index if not exists idx_followup_events_is_effective_contact
  on public.followup_events (is_effective_contact);

create index if not exists idx_followup_events_event_outcome
  on public.followup_events (event_outcome);

create index if not exists idx_followup_events_operator_profile_id
  on public.followup_events (operator_profile_id);

create index if not exists idx_followup_events_assignment_id
  on public.followup_events (assignment_id);

alter table public.beneficiary_followup_status
  add column if not exists coverage_state public.follow_up_coverage_state;

update public.beneficiary_followup_status
set coverage_state = case status
  when 'up_to_date' then 'al_dia'::public.follow_up_coverage_state
  when 'pending' then 'pendiente'::public.follow_up_coverage_state
  when 'urgent' then 'urgente'::public.follow_up_coverage_state
  else 'sin_contacto'::public.follow_up_coverage_state
end
where coverage_state is null;

alter table public.beneficiary_followup_status
  alter column coverage_state set default 'sin_contacto'::public.follow_up_coverage_state,
  alter column coverage_state set not null;

create or replace function public.calculate_follow_up_coverage_state(
  p_last_effective_contact_at timestamptz,
  p_reference_date timestamptz default now()
)
returns public.follow_up_coverage_state
language plpgsql
stable
set search_path = public
as $$
declare
  v_reference_date timestamptz := coalesce(p_reference_date, now());
  v_days_since_contact integer;
begin
  if p_last_effective_contact_at is null then
    return 'sin_contacto';
  end if;

  v_days_since_contact := greatest(
    0,
    (v_reference_date at time zone 'UTC')::date - (p_last_effective_contact_at at time zone 'UTC')::date
  );

  if v_days_since_contact <= 15 then
    return 'al_dia';
  elseif v_days_since_contact <= 30 then
    return 'pendiente';
  end if;

  return 'urgente';
end;
$$;

create or replace function public.calculate_followup_status(
  last_effective_contact_at timestamptz,
  reference_date timestamptz default now()
)
returns public.followup_status
language sql
stable
set search_path = public
as $$
  select case public.calculate_follow_up_coverage_state(last_effective_contact_at, reference_date)
    when 'al_dia' then 'up_to_date'::public.followup_status
    when 'pendiente' then 'pending'::public.followup_status
    when 'urgente' then 'urgent'::public.followup_status
    else 'no_data'::public.followup_status
  end
$$;

create or replace function public.normalize_follow_up_event_outcome(
  p_raw_status text,
  p_correlation_status public.call_correlation_status default null
)
returns public.follow_up_event_outcome
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := lower(regexp_replace(coalesce(btrim(p_raw_status), ''), '\\s+', '_', 'g'));
begin
  if p_correlation_status = 'invalid_phone' then
    return 'numero_invalido';
  end if;

  if v_value in (
    'contacto_efectivo',
    'no_responde',
    'ocupado',
    'mensaje_dejado',
    'numero_invalido',
    'rechaza_llamada',
    'sin_clasificar'
  ) then
    return v_value::public.follow_up_event_outcome;
  end if;

  return 'sin_clasificar';
end;
$$;

create or replace function public.map_follow_up_contact_type(
  p_contact_type public.contact_type
)
returns public.follow_up_contact_type
language sql
immutable
set search_path = public
as $$
  select case p_contact_type
    when 'primary_phone' then 'principal'::public.follow_up_contact_type
    when 'family_contact' then 'red_apoyo'::public.follow_up_contact_type
    else 'desconocido'::public.follow_up_contact_type
  end
$$;

create or replace function public.map_follow_up_event_type(
  p_outcome public.follow_up_event_outcome,
  p_contact_type public.follow_up_contact_type
)
returns public.followup_event_type
language sql
immutable
set search_path = public
as $$
  select case
    when p_outcome = 'contacto_efectivo' and p_contact_type = 'red_apoyo' then 'contact_support_network'::public.followup_event_type
    when p_outcome = 'contacto_efectivo' then 'contact_beneficiary'::public.followup_event_type
    when p_outcome = 'numero_invalido' then 'wrong_number'::public.followup_event_type
    when p_outcome = 'sin_clasificar' then 'internal_note'::public.followup_event_type
    else 'no_answer'::public.followup_event_type
  end
$$;

create or replace function public.recalculate_beneficiary_followup_status_internal(p_beneficiary_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_effective_contact_at timestamptz;
  v_last_effective_event_id uuid;
  v_days_since_last_effective_contact integer;
  v_status public.followup_status;
  v_coverage_state public.follow_up_coverage_state;
  v_reference_date timestamptz := now();
begin
  if p_beneficiary_id is null then
    raise exception 'p_beneficiary_id cannot be null';
  end if;

  select
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) as effective_contact_at,
    fe.id
  into
    v_last_effective_contact_at,
    v_last_effective_event_id
  from public.followup_events as fe
  where fe.beneficiary_id = p_beneficiary_id
    and fe.is_effective_contact = true
  order by coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) desc, fe.created_at desc, fe.id desc
  limit 1;

  if v_last_effective_contact_at is null then
    v_days_since_last_effective_contact := null;
  else
    v_days_since_last_effective_contact := greatest(
      0,
      (v_reference_date at time zone 'UTC')::date - (v_last_effective_contact_at at time zone 'UTC')::date
    );
  end if;

  v_coverage_state := public.calculate_follow_up_coverage_state(v_last_effective_contact_at, v_reference_date);
  v_status := public.calculate_followup_status(v_last_effective_contact_at, v_reference_date);

  insert into public.beneficiary_followup_status (
    beneficiary_id,
    status,
    coverage_state,
    last_valid_followup_at,
    last_valid_followup_event_id,
    days_since_last_valid_followup,
    calculated_at,
    updated_at
  )
  values (
    p_beneficiary_id,
    v_status,
    v_coverage_state,
    v_last_effective_contact_at,
    v_last_effective_event_id,
    v_days_since_last_effective_contact,
    v_reference_date,
    v_reference_date
  )
  on conflict (beneficiary_id) do update
  set
    status = excluded.status,
    coverage_state = excluded.coverage_state,
    last_valid_followup_at = excluded.last_valid_followup_at,
    last_valid_followup_event_id = excluded.last_valid_followup_event_id,
    days_since_last_valid_followup = excluded.days_since_last_valid_followup,
    calculated_at = excluded.calculated_at,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.handle_followup_event_status_recalculation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.beneficiary_id is not null then
      perform public.recalculate_beneficiary_followup_status_internal(old.beneficiary_id);
    end if;
    return old;
  end if;

  if new.beneficiary_id is not null then
    perform public.recalculate_beneficiary_followup_status_internal(new.beneficiary_id);
  end if;

  if tg_op = 'UPDATE'
    and old.beneficiary_id is not null
    and old.beneficiary_id is distinct from new.beneficiary_id then
    perform public.recalculate_beneficiary_followup_status_internal(old.beneficiary_id);
  end if;

  return new;
end;
$$;

drop trigger if exists followup_events_recalculate_status_after_insert
  on public.followup_events;

drop trigger if exists followup_events_recalculate_status_after_write
  on public.followup_events;

create trigger followup_events_recalculate_status_after_write
after insert or update or delete on public.followup_events
for each row
execute function public.handle_followup_event_status_recalculation();

create or replace function public.generate_follow_up_events_from_call_logs(
  p_source text default null,
  p_limit integer default 500,
  p_call_log_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_id uuid := (select auth.uid());
  v_requester_role public.user_role;
  v_candidate record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_outcome public.follow_up_event_outcome;
  v_contact_type public.follow_up_contact_type;
  v_event_type public.followup_event_type;
  v_assignment_id uuid;
  v_operator_profile_id uuid;
  v_inserted_event_id uuid;
  v_created_rows integer := 0;
  v_effective_rows integer := 0;
  v_skipped_duplicates integer := 0;
  v_skipped_ineligible integer := 0;
  v_error_rows integer := 0;
begin
  if v_requester_id is null then
    raise exception 'Not authorized to generate follow up events from call logs';
  end if;

  select public.get_user_role(v_requester_id)
  into v_requester_role;

  if v_requester_role not in ('admin', 'super_admin') then
    raise exception 'Only admin and super_admin can generate follow up events from call logs';
  end if;

  for v_candidate in
    select
      rcl.id as call_log_id,
      rcl.source,
      rcl.external_call_id,
      rcl.called_at,
      rcl.raw_status,
      rcl.raw_phone,
      rcl.phone_normalized,
      cc.id as correlation_id,
      cc.correlation_status,
      cc.beneficiary_id,
      cc.beneficiary_contact_id,
      cc.contact_type as correlation_contact_type,
      cc.assignment_id_at_call_time,
      cc.responsible_user_id_at_call_time,
      cc.reason as correlation_reason
    from public.raw_call_logs as rcl
    join public.call_correlations as cc
      on cc.raw_call_log_id = rcl.id
    where (p_source is null or rcl.source = nullif(btrim(p_source), ''))
      and (p_call_log_ids is null or rcl.id = any(p_call_log_ids))
    order by rcl.called_at asc, rcl.id asc
    limit v_limit
  loop
    if exists (
      select 1
      from public.followup_events as fe
      where fe.call_log_id = v_candidate.call_log_id
    ) then
      v_skipped_duplicates := v_skipped_duplicates + 1;
      continue;
    end if;

    if v_candidate.beneficiary_id is null then
      v_skipped_ineligible := v_skipped_ineligible + 1;
      continue;
    end if;

    if v_candidate.called_at is null
      or v_candidate.called_at > (now() + interval '5 minutes') then
      v_error_rows := v_error_rows + 1;
      continue;
    end if;

    v_outcome := public.normalize_follow_up_event_outcome(v_candidate.raw_status, v_candidate.correlation_status);
    v_contact_type := public.map_follow_up_contact_type(v_candidate.correlation_contact_type);
    v_event_type := public.map_follow_up_event_type(v_outcome, v_contact_type);

    v_assignment_id := v_candidate.assignment_id_at_call_time;

    if v_assignment_id is null then
      select ba.id
      into v_assignment_id
      from public.beneficiary_assignments as ba
      where ba.beneficiary_id = v_candidate.beneficiary_id
        and ba.starts_at <= v_candidate.called_at
        and (ba.ends_at is null or ba.ends_at >= v_candidate.called_at)
      order by
        case when ba.status = 'active' then 0 else 1 end,
        ba.starts_at desc,
        ba.created_at desc,
        ba.id asc
      limit 1;
    end if;

    v_operator_profile_id := coalesce(
      v_candidate.responsible_user_id_at_call_time,
      (select ba.assigned_user_id from public.beneficiary_assignments as ba where ba.id = v_assignment_id),
      v_requester_id
    );

    insert into public.followup_events (
      beneficiary_id,
      beneficiary_contact_id,
      assigned_user_id,
      created_by,
      source,
      event_type,
      occurred_at,
      is_valid_followup,
      notes,
      call_log_id,
      correlation_id,
      assignment_id,
      operator_profile_id,
      event_timestamp,
      event_outcome,
      is_effective_contact,
      contact_phone,
      contact_type,
      confirmed_by_call_log
    )
    values (
      v_candidate.beneficiary_id,
      v_candidate.beneficiary_contact_id,
      coalesce((select ba.assigned_user_id from public.beneficiary_assignments as ba where ba.id = v_assignment_id), v_operator_profile_id),
      v_requester_id,
      'amaia_call',
      v_event_type,
      v_candidate.called_at,
      public.is_effective_contact(v_outcome::text),
      concat_ws(
        ' ',
        'Generated from call log.',
        concat('source=', coalesce(v_candidate.source, 'n/a')),
        concat('external_call_id=', coalesce(v_candidate.external_call_id, 'n/a')),
        concat('correlation_reason=', coalesce(v_candidate.correlation_reason, 'n/a'))
      ),
      v_candidate.call_log_id,
      v_candidate.correlation_id,
      v_assignment_id,
      v_operator_profile_id,
      v_candidate.called_at,
      v_outcome,
      public.is_effective_contact(v_outcome::text),
      coalesce(v_candidate.phone_normalized, nullif(btrim(v_candidate.raw_phone), '')),
      v_contact_type,
      true
    )
    on conflict (call_log_id) do nothing
    returning id into v_inserted_event_id;

    if v_inserted_event_id is null then
      v_skipped_duplicates := v_skipped_duplicates + 1;
      continue;
    end if;

    v_created_rows := v_created_rows + 1;

    if public.is_effective_contact(v_outcome::text) then
      v_effective_rows := v_effective_rows + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'createdRows', v_created_rows,
    'effectiveRows', v_effective_rows,
    'skippedDuplicates', v_skipped_duplicates,
    'skippedIneligible', v_skipped_ineligible,
    'errorRows', v_error_rows,
    'processedLimit', v_limit,
    'source', nullif(btrim(coalesce(p_source, '')), '')
  );
end;
$$;

create or replace view public.v_follow_up_coverage_by_beneficiary
with (security_invoker = true)
as
with last_effective as (
  select distinct on (fe.beneficiary_id)
    fe.beneficiary_id,
    fe.id as follow_up_event_id,
    fe.call_log_id,
    fe.assignment_id,
    fe.operator_profile_id,
    fe.event_outcome,
    coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) as last_effective_contact_at
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
    ba.id as active_assignment_id,
    ba.assigned_user_id as active_assignment_user_id
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
  le.follow_up_event_id,
  le.call_log_id,
  le.last_effective_contact_at,
  case
    when le.last_effective_contact_at is null then null
    else greatest(0, (now() at time zone 'UTC')::date - (le.last_effective_contact_at at time zone 'UTC')::date)
  end as days_since_last_effective_contact,
  public.calculate_follow_up_coverage_state(le.last_effective_contact_at, now()) as coverage_state,
  bfs.status as legacy_followup_status,
  le.event_outcome as last_event_outcome,
  le.operator_profile_id as responsible_operator_profile_id,
  coalesce(op.full_name, op.email) as responsible_operator_name,
  coalesce(le.assignment_id, aa.active_assignment_id) as assignment_id,
  aa.active_assignment_user_id,
  coalesce(assignee.full_name, assignee.email) as active_assignment_user_name,
  bfs.calculated_at as status_calculated_at
from public.beneficiaries as b
left join last_effective as le
  on le.beneficiary_id = b.id
left join public.beneficiary_followup_status as bfs
  on bfs.beneficiary_id = b.id
left join active_assignment as aa
  on aa.beneficiary_id = b.id
left join public.profiles as op
  on op.id = le.operator_profile_id
left join public.profiles as assignee
  on assignee.id = aa.active_assignment_user_id;

create or replace view public.v_follow_up_operational_summary
with (security_invoker = true)
as
select
  now() as generated_at,
  count(*)::integer as total_beneficiaries,
  count(*) filter (where coverage_state = 'al_dia')::integer as al_dia_beneficiaries,
  count(*) filter (where coverage_state = 'pendiente')::integer as pendiente_beneficiaries,
  count(*) filter (where coverage_state = 'urgente')::integer as urgente_beneficiaries,
  count(*) filter (where coverage_state = 'sin_contacto')::integer as sin_contacto_beneficiaries,
  (select count(*)::integer from public.followup_events) as total_follow_up_events,
  (select count(*)::integer from public.followup_events where is_effective_contact = true) as total_effective_follow_up_events,
  (select count(*)::integer from public.followup_events where call_log_id is not null) as call_log_backed_follow_up_events
from public.v_follow_up_coverage_by_beneficiary;

comment on table public.followup_events
  is 'Canonical institutional follow-up events. Coverage and KPIs must be computed from this table.';

comment on column public.followup_events.call_log_id
  is 'Optional raw_call_logs origin for full traceability and deduplication of generated events.';

comment on column public.followup_events.event_outcome
  is 'Canonical operational outcome persisted explicitly for auditability.';

comment on column public.followup_events.is_effective_contact
  is 'Explicit effective-contact flag. Coverage is derived only from true values.';

comment on column public.beneficiary_followup_status.coverage_state
  is 'Canonical Spanish operational coverage state derived from the latest effective follow-up event.';

comment on function public.calculate_follow_up_coverage_state(timestamptz, timestamptz)
  is 'Computes al_dia/pendiente/urgente/sin_contacto from the latest effective follow-up timestamp.';

comment on function public.generate_follow_up_events_from_call_logs(text, integer, uuid[])
  is 'Generates followup_events from correlated call logs with deduplication by call_log_id and explicit outcome/effective persistence.';

comment on view public.v_follow_up_coverage_by_beneficiary
  is 'Operational beneficiary coverage with latest effective follow-up, responsible operator, and active assignment context.';

comment on view public.v_follow_up_operational_summary
  is 'Aggregated operational summary prepared for dashboard consumption without recalculating canonical rules client-side.';

revoke all on function public.calculate_follow_up_coverage_state(timestamptz, timestamptz) from public;
revoke all on function public.normalize_follow_up_event_outcome(text, public.call_correlation_status) from public;
revoke all on function public.map_follow_up_contact_type(public.contact_type) from public;
revoke all on function public.map_follow_up_event_type(public.follow_up_event_outcome, public.follow_up_contact_type) from public;
revoke all on function public.generate_follow_up_events_from_call_logs(text, integer, uuid[]) from public;

grant execute on function public.generate_follow_up_events_from_call_logs(text, integer, uuid[]) to authenticated;

grant select on public.v_follow_up_coverage_by_beneficiary to authenticated;
grant select on public.v_follow_up_operational_summary to authenticated;
