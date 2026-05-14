-- =============================================
-- add_reassign_primary_assignment_rpc
-- Movimiento individual controlado del
-- responsable oficial vigente de un beneficiario.
-- =============================================

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
	v_current_note text;
	v_new_note text;
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

	if v_requester_role <> 'super_admin' then
		raise exception 'Solo super_admin puede cambiar el responsable oficial';
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

	select
		p.id,
		p.full_name,
		p.email
	into v_current_assigned_user
	from public.profiles as p
	where p.id = v_current_assignment.assigned_user_id;

	select
		p.id,
		p.full_name,
		p.email,
		p.role,
		p.is_active
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

	v_current_note := concat_ws(
		E'\n\n',
		nullif(v_current_assignment.notes, ''),
		'Reasignacion individual cerrada. Motivo: ' || v_reason
	);

	v_new_note :=
		'Reasignacion individual recibida desde '
		|| coalesce(v_current_assigned_user.full_name, v_current_assigned_user.email, 'responsable anterior')
		|| '. Motivo: '
		|| v_reason;

	update public.beneficiary_assignments
	set
		status = 'ended',
		ends_at = v_effective_at,
		updated_by = v_requester_id,
		updated_at = v_effective_at,
		notes = v_current_note
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
		v_new_note,
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

comment on function public.reassign_beneficiary_primary_assignment(uuid, uuid, text)
	is 'Cierra la asignacion primary activa y crea una nueva asignacion primary activa para otra teleoperadora, preservando historial.';

revoke all on function public.reassign_beneficiary_primary_assignment(uuid, uuid, text) from public;
grant execute on function public.reassign_beneficiary_primary_assignment(uuid, uuid, text) to authenticated;