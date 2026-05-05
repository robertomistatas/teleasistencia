-- =============================================
-- add_followup_status_recalculation_triggers
-- Recalculo automatico de beneficiary_followup_status
-- al insertar followup_events y call_interactions validas.
-- =============================================

create or replace function public.recalculate_beneficiary_followup_status_internal(p_beneficiary_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_last_valid_followup_at timestamptz;
	v_last_valid_followup_event_id uuid;
	v_days_since_last_valid_followup integer;
	v_status public.followup_status;
begin
	if p_beneficiary_id is null then
		raise exception 'p_beneficiary_id no puede ser null';
	end if;

	with valid_followup_events as (
		select
			fe.occurred_at as contact_at,
			fe.id as followup_event_id,
			0 as source_priority
		from public.followup_events as fe
		where fe.beneficiary_id = p_beneficiary_id
			and (
				fe.is_valid_followup = true
				or fe.event_type in ('contact_beneficiary', 'contact_support_network')
			)
	),
	valid_call_interactions as (
		select
			coalesce(ci.started_at, ci.ended_at, ci.call_date::timestamptz) as contact_at,
			null::uuid as followup_event_id,
			1 as source_priority
		from public.call_interactions as ci
		where ci.beneficiary_id = p_beneficiary_id
			and ci.duration_seconds >= 10
			and ci.counts_as_valid_followup = true
			and ci.matched_status = 'matched'
	),
	valid_contacts as (
		select *
		from valid_followup_events
		union all
		select *
		from valid_call_interactions
	)
	select
		vc.contact_at,
		vc.followup_event_id
	into
		v_last_valid_followup_at,
		v_last_valid_followup_event_id
	from valid_contacts as vc
	where vc.contact_at is not null
	order by vc.contact_at desc, vc.source_priority asc
	limit 1;

	if v_last_valid_followup_at is null then
		v_days_since_last_valid_followup := null;
		v_status := 'no_data';
	else
		v_days_since_last_valid_followup := greatest(
			0,
			floor(extract(epoch from (now() - v_last_valid_followup_at)) / 86400)::integer
		);

		if v_days_since_last_valid_followup <= 15 then
			v_status := 'up_to_date';
		elseif v_days_since_last_valid_followup <= 30 then
			v_status := 'pending';
		else
			v_status := 'urgent';
		end if;
	end if;

	insert into public.beneficiary_followup_status (
		beneficiary_id,
		status,
		last_valid_followup_at,
		last_valid_followup_event_id,
		days_since_last_valid_followup,
		calculated_at,
		updated_at
	)
	values (
		p_beneficiary_id,
		v_status,
		v_last_valid_followup_at,
		v_last_valid_followup_event_id,
		v_days_since_last_valid_followup,
		now(),
		now()
	)
	on conflict (beneficiary_id) do update
	set
		status = excluded.status,
		last_valid_followup_at = excluded.last_valid_followup_at,
		last_valid_followup_event_id = excluded.last_valid_followup_event_id,
		days_since_last_valid_followup = excluded.days_since_last_valid_followup,
		calculated_at = now(),
		updated_at = now();
end;
$$;

create or replace function public.recalculate_beneficiary_followup_status(p_beneficiary_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_is_authorized boolean := false;
begin
	if p_beneficiary_id is null then
		raise exception 'p_beneficiary_id no puede ser null';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para recalcular este beneficiario';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role in ('admin', 'super_admin') then
		v_is_authorized := true;
	elseif v_requester_role = 'teleoperadora' then
		select exists (
			select 1
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = p_beneficiary_id
				and ba.assigned_user_id = v_requester_id
				and ba.status = 'active'
		)
		into v_is_authorized;
	end if;

	if not v_is_authorized then
		raise exception 'No autorizado para recalcular este beneficiario';
	end if;

	perform public.recalculate_beneficiary_followup_status_internal(p_beneficiary_id);
end;
$$;

create or replace function public.handle_followup_event_status_recalculation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	perform public.recalculate_beneficiary_followup_status_internal(new.beneficiary_id);
	return new;
end;
$$;

drop trigger if exists followup_events_recalculate_status_after_insert
	on public.followup_events;

create trigger followup_events_recalculate_status_after_insert
after insert on public.followup_events
for each row
execute function public.handle_followup_event_status_recalculation();

create or replace function public.handle_call_interaction_status_recalculation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.beneficiary_id is not null
		and new.duration_seconds >= 10
		and new.counts_as_valid_followup = true
		and new.matched_status = 'matched' then
		perform public.recalculate_beneficiary_followup_status_internal(new.beneficiary_id);
	end if;

	return new;
end;
$$;

drop trigger if exists call_interactions_recalculate_status_after_insert
	on public.call_interactions;

create trigger call_interactions_recalculate_status_after_insert
after insert on public.call_interactions
for each row
execute function public.handle_call_interaction_status_recalculation();

revoke all on function public.recalculate_beneficiary_followup_status_internal(uuid) from public;
