create or replace function public.recalculate_all_beneficiary_followup_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_recalculated_count integer := 0;
	v_beneficiary record;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para recalcular todos los beneficiarios';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'No autorizado para recalcular todos los beneficiarios';
	end if;

	for v_beneficiary in
		select b.id
		from public.beneficiaries as b
		where b.status = 'active'
	loop
		perform public.recalculate_beneficiary_followup_status(v_beneficiary.id);
		v_recalculated_count := v_recalculated_count + 1;
	end loop;

	return v_recalculated_count;
end;
$$;

create or replace function public.reassign_beneficiary_primary_assignment(
	p_beneficiary_id uuid,
	p_new_assigned_user_id uuid,
	p_reason text
)
returns table (
	beneficiary_id uuid,
	previous_assignment_id uuid,
	previous_assigned_user_id uuid,
	previous_assigned_user_name text,
	new_assignment_id uuid,
	new_assigned_user_id uuid,
	new_assigned_user_name text,
	effective_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_effective_at timestamptz := now();
	v_reason text := nullif(btrim(p_reason), '');
	v_current_assignment public.beneficiary_assignments%rowtype;
	v_current_assigned_user record;
	v_new_assigned_user record;
	v_new_assignment_id uuid := gen_random_uuid();
begin
	if p_beneficiary_id is null then
		raise exception 'El beneficiario es obligatorio';
	end if;

	if p_new_assigned_user_id is null then
		raise exception 'La nueva responsable es obligatoria';
	end if;

	if v_reason is null then
		raise exception 'El motivo del cambio es obligatorio';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para cambiar el responsable oficial';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin o super_admin pueden cambiar el responsable oficial';
	end if;

	select ba.*
	into v_current_assignment
	from public.beneficiary_assignments as ba
	where ba.beneficiary_id = p_beneficiary_id
		and ba.assignment_type = 'primary'
		and ba.status = 'active'
	for update;

	if not found then
		raise exception 'El beneficiario no tiene una asignacion oficial vigente';
	end if;

	if v_current_assignment.assigned_user_id = p_new_assigned_user_id then
		raise exception 'La nueva responsable debe ser distinta a la actual';
	end if;

	if exists (
		select 1
		from public.beneficiary_assignments as ba
		where ba.beneficiary_id = p_beneficiary_id
			and ba.assigned_user_id = p_new_assigned_user_id
			and ba.assignment_type = 'support'
			and ba.status = 'active'
	) then
		raise exception 'La nueva responsable ya figura como apoyo temporal activo para este beneficiario';
	end if;

	select p.id, p.full_name, p.email
	into v_current_assigned_user
	from public.profiles as p
	where p.id = v_current_assignment.assigned_user_id;

	select p.id, p.full_name, p.email, p.role, p.is_active
	into v_new_assigned_user
	from public.profiles as p
	where p.id = p_new_assigned_user_id;

	if not found then
		raise exception 'La nueva responsable no existe';
	end if;

	if v_new_assigned_user.role <> 'teleoperadora' then
		raise exception 'La nueva responsable debe tener rol teleoperadora';
	end if;

	if v_new_assigned_user.is_active is distinct from true then
		raise exception 'La nueva responsable debe estar activa';
	end if;

	update public.beneficiary_assignments
	set
		status = 'inactive',
		ends_at = v_effective_at,
		updated_by = v_requester_id,
		ended_by = v_requester_id,
		updated_at = v_effective_at,
		ended_reason = v_reason,
		notes = concat_ws(
			E'\n\n',
			nullif(notes, ''),
			'Reasignacion individual cerrada por ' || coalesce(v_requester_role::text, 'admin') || '. Motivo: ' || v_reason
		)
	where id = v_current_assignment.id;

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
		reason,
		notes,
		created_at,
		updated_at
	)
	values (
		v_new_assignment_id,
		p_beneficiary_id,
		p_new_assigned_user_id,
		'primary',
		'active',
		v_effective_at,
		'manual',
		v_requester_id,
		v_requester_id,
		v_reason,
		'Reasignacion individual recibida desde '
			|| coalesce(v_current_assigned_user.full_name, v_current_assigned_user.email, 'responsable anterior')
			|| '. Motivo: '
			|| v_reason,
		v_effective_at,
		v_effective_at
	);

	return query
	select
		p_beneficiary_id,
		v_current_assignment.id,
		v_current_assignment.assigned_user_id,
		coalesce(v_current_assigned_user.full_name, v_current_assigned_user.email, 'Responsable actual'),
		v_new_assignment_id,
		p_new_assigned_user_id,
		coalesce(v_new_assigned_user.full_name, v_new_assigned_user.email, 'Nueva responsable'),
		v_effective_at;
end;
$$;

create or replace function public.add_support_assignment(
	p_beneficiary_id uuid,
	p_support_user_id uuid,
	p_reason text
)
returns table (
	assignment_id uuid,
	beneficiary_id uuid,
	support_user_id uuid,
	support_user_name text,
	primary_user_id uuid,
	primary_user_name text,
	starts_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_effective_at timestamptz := now();
	v_reason text := nullif(btrim(p_reason), '');
	v_primary_assignment public.beneficiary_assignments%rowtype;
	v_primary_user record;
	v_support_user record;
	v_assignment_id uuid := gen_random_uuid();
begin
	if p_beneficiary_id is null then
		raise exception 'El beneficiario es obligatorio';
	end if;

	if p_support_user_id is null then
		raise exception 'La teleoperadora de apoyo es obligatoria';
	end if;

	if v_reason is null then
		raise exception 'El motivo del apoyo temporal es obligatorio';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para agregar apoyo temporal';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin o super_admin pueden agregar apoyo temporal';
	end if;

	select ba.*
	into v_primary_assignment
	from public.beneficiary_assignments as ba
	where ba.beneficiary_id = p_beneficiary_id
		and ba.assignment_type = 'primary'
		and ba.status = 'active'
	for update;

	if not found then
		raise exception 'El beneficiario no tiene una responsable oficial vigente';
	end if;

	if v_primary_assignment.assigned_user_id = p_support_user_id then
		raise exception 'La teleoperadora de apoyo debe ser distinta a la responsable oficial';
	end if;

	select p.id, p.full_name, p.email
	into v_primary_user
	from public.profiles as p
	where p.id = v_primary_assignment.assigned_user_id;

	select p.id, p.full_name, p.email, p.role, p.is_active
	into v_support_user
	from public.profiles as p
	where p.id = p_support_user_id;

	if not found then
		raise exception 'La teleoperadora de apoyo no existe';
	end if;

	if v_support_user.role <> 'teleoperadora' then
		raise exception 'La teleoperadora de apoyo debe tener rol teleoperadora';
	end if;

	if v_support_user.is_active is distinct from true then
		raise exception 'La teleoperadora de apoyo debe estar activa';
	end if;

	if exists (
		select 1
		from public.beneficiary_assignments as ba
		where ba.beneficiary_id = p_beneficiary_id
			and ba.assigned_user_id = p_support_user_id
			and ba.assignment_type = 'support'
			and ba.status = 'active'
	) then
		raise exception 'Ya existe un apoyo temporal activo para esta teleoperadora';
	end if;

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
		reason,
		notes,
		created_at,
		updated_at
	)
	values (
		v_assignment_id,
		p_beneficiary_id,
		p_support_user_id,
		'support',
		'active',
		v_effective_at,
		'manual',
		v_requester_id,
		v_requester_id,
		v_reason,
		'Apoyo temporal activo. Responsable oficial: '
			|| coalesce(v_primary_user.full_name, v_primary_user.email, 'responsable oficial')
			|| '. Motivo: '
			|| v_reason,
		v_effective_at,
		v_effective_at
	);

	return query
	select
		v_assignment_id,
		p_beneficiary_id,
		p_support_user_id,
		coalesce(v_support_user.full_name, v_support_user.email, 'Teleoperadora de apoyo'),
		v_primary_assignment.assigned_user_id,
		coalesce(v_primary_user.full_name, v_primary_user.email, 'Responsable oficial'),
		v_effective_at;
end;
$$;

create or replace function public.end_support_assignment(
	p_assignment_id uuid,
	p_reason text
)
returns table (
	assignment_id uuid,
	beneficiary_id uuid,
	support_user_id uuid,
	support_user_name text,
	ended_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_effective_at timestamptz := now();
	v_reason text := nullif(btrim(p_reason), '');
	v_assignment public.beneficiary_assignments%rowtype;
	v_support_user record;
begin
	if p_assignment_id is null then
		raise exception 'La asignacion de apoyo es obligatoria';
	end if;

	if v_reason is null then
		raise exception 'El motivo de cierre del apoyo es obligatorio';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para cerrar apoyo temporal';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin o super_admin pueden cerrar apoyo temporal';
	end if;

	select ba.*
	into v_assignment
	from public.beneficiary_assignments as ba
	where ba.id = p_assignment_id
		and ba.assignment_type = 'support'
		and ba.status = 'active'
	for update;

	if not found then
		raise exception 'No existe un apoyo temporal activo para cerrar';
	end if;

	select p.id, p.full_name, p.email
	into v_support_user
	from public.profiles as p
	where p.id = v_assignment.assigned_user_id;

	update public.beneficiary_assignments
	set
		status = 'inactive',
		ends_at = v_effective_at,
		updated_by = v_requester_id,
		ended_by = v_requester_id,
		updated_at = v_effective_at,
		ended_reason = v_reason,
		notes = concat_ws(
			E'\n\n',
			nullif(notes, ''),
			'Apoyo temporal cerrado. Motivo: ' || v_reason
		)
	where id = v_assignment.id;

	return query
	select
		v_assignment.id,
		v_assignment.beneficiary_id,
		v_assignment.assigned_user_id,
		coalesce(v_support_user.full_name, v_support_user.email, 'Teleoperadora de apoyo'),
		v_effective_at;
end;
$$;

create or replace function public.get_assignment_history(p_beneficiary_id uuid)
returns table (
	assignment_id uuid,
	beneficiary_id uuid,
	assignment_type public.beneficiary_assignment_type,
	status public.beneficiary_assignment_status,
	assigned_user_id uuid,
	assigned_user_name text,
	assigned_user_email text,
	starts_at timestamptz,
	ends_at timestamptz,
	reason text,
	ended_reason text,
	created_by uuid,
	created_by_name text,
	ended_by uuid,
	ended_by_name text,
	created_at timestamptz,
	updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if p_beneficiary_id is null then
		raise exception 'El beneficiario es obligatorio';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para consultar historial de asignaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin o super_admin pueden consultar historial de asignaciones';
	end if;

	return query
	select
		ba.id,
		ba.beneficiary_id,
		ba.assignment_type,
		ba.status,
		ba.assigned_user_id,
		coalesce(assigned_profile.full_name, assigned_profile.email, 'Responsable sin nombre'),
		assigned_profile.email,
		ba.starts_at,
		ba.ends_at,
		ba.reason,
		ba.ended_reason,
		ba.created_by,
		coalesce(created_profile.full_name, created_profile.email, 'Sin registro'),
		ba.ended_by,
		coalesce(ended_profile.full_name, ended_profile.email, 'Sin registro'),
		ba.created_at,
		ba.updated_at
	from public.beneficiary_assignments as ba
	left join public.profiles as assigned_profile
		on assigned_profile.id = ba.assigned_user_id
	left join public.profiles as created_profile
		on created_profile.id = ba.created_by
	left join public.profiles as ended_profile
		on ended_profile.id = ba.ended_by
	where ba.beneficiary_id = p_beneficiary_id
	order by ba.starts_at asc, ba.created_at asc;
end;
$$;

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

	if coalesce(v_actor_role::text, '') not in ('teleoperadora', 'admin', 'super_admin') then
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