-- =============================================
-- controlled_qa_to_real_transition
-- Cierra la operacion QA visible sin borrar
-- historia ni import runs. Desactiva perfiles QA,
-- retira beneficiarios QA de la operacion vigente
-- y cierra asignaciones activas relacionadas.
-- =============================================

do $$
declare
	v_transition_at timestamptz := now();
	v_closed_assignments integer := 0;
	v_inactivated_beneficiaries integer := 0;
	v_inactivated_profiles integer := 0;
	v_banned_auth_users integer := 0;
begin
	with qa_profiles as (
		select p.id
		from public.profiles as p
		where p.id in (
			'38700216-21a8-42c8-8b94-f120df74ab40',
			'118f0677-844d-40fe-ba63-fa5a35b241c2',
			'4f4d4e08-18fa-4353-be44-b3172fbed6f4',
			'63a214b3-b060-4916-8539-1ed0e896ebed',
			'd1f9f00e-f847-4289-97ce-c09cd36e68c9',
			'ac4b1619-189a-43b4-a43a-436d09e7c3ee',
			'6781075d-3513-4fa2-b0c2-cd98f45a0b80',
			'c2ed2e6d-7b75-4666-bfb8-ef620c29eea5'
		)
	),
	qa_beneficiaries as (
		select b.id
		from public.beneficiaries as b
		join qa_profiles as qp
			on qp.id = b.created_by
		where b.status = 'active'
	)
	update public.beneficiary_assignments as ba
	set
		status = 'inactive',
		ends_at = coalesce(ba.ends_at, v_transition_at),
		updated_by = null,
		ended_by = null,
		updated_at = v_transition_at,
		ended_reason = coalesce(
			nullif(ba.ended_reason, ''),
			'Cierre operacional QA -> operacion real'
		),
		notes = concat_ws(
			E'\n\n',
			nullif(ba.notes, ''),
			'Cierre operacional QA -> operacion real aplicado el '
				|| to_char(v_transition_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
				|| ' UTC. Historial preservado.'
		)
	where ba.status = 'active'
		and ba.beneficiary_id in (select qb.id from qa_beneficiaries as qb);

	get diagnostics v_closed_assignments = row_count;

	with qa_profiles as (
		select p.id
		from public.profiles as p
		where p.id in (
			'38700216-21a8-42c8-8b94-f120df74ab40',
			'118f0677-844d-40fe-ba63-fa5a35b241c2',
			'4f4d4e08-18fa-4353-be44-b3172fbed6f4',
			'63a214b3-b060-4916-8539-1ed0e896ebed',
			'd1f9f00e-f847-4289-97ce-c09cd36e68c9',
			'ac4b1619-189a-43b4-a43a-436d09e7c3ee',
			'6781075d-3513-4fa2-b0c2-cd98f45a0b80',
			'c2ed2e6d-7b75-4666-bfb8-ef620c29eea5'
		)
	)
	update public.beneficiaries as b
	set
		status = 'inactive',
		updated_by = null,
		updated_at = v_transition_at,
		notes = concat_ws(
			E'\n\n',
			nullif(b.notes, ''),
			'Retirado de la operacion vigente durante la transicion QA -> operacion real el '
				|| to_char(v_transition_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
				|| ' UTC. Historial preservado.'
		)
	where b.status = 'active'
		and b.created_by in (select qp.id from qa_profiles as qp);

	get diagnostics v_inactivated_beneficiaries = row_count;

	with qa_profiles as (
		select p.id
		from public.profiles as p
		where p.id in (
			'38700216-21a8-42c8-8b94-f120df74ab40',
			'118f0677-844d-40fe-ba63-fa5a35b241c2',
			'4f4d4e08-18fa-4353-be44-b3172fbed6f4',
			'63a214b3-b060-4916-8539-1ed0e896ebed',
			'd1f9f00e-f847-4289-97ce-c09cd36e68c9',
			'ac4b1619-189a-43b4-a43a-436d09e7c3ee',
			'6781075d-3513-4fa2-b0c2-cd98f45a0b80',
			'c2ed2e6d-7b75-4666-bfb8-ef620c29eea5'
		)
	)
	update public.profiles as p
	set is_active = false
	where p.is_active is distinct from false
		and p.id in (select qp.id from qa_profiles as qp);

	get diagnostics v_inactivated_profiles = row_count;

	if exists (
		select 1
		from information_schema.columns
		where table_schema = 'auth'
			and table_name = 'users'
			and column_name = 'banned_until'
	) then
		with qa_profiles as (
			select p.id
			from public.profiles as p
			where p.id in (
				'38700216-21a8-42c8-8b94-f120df74ab40',
				'118f0677-844d-40fe-ba63-fa5a35b241c2',
				'4f4d4e08-18fa-4353-be44-b3172fbed6f4',
				'63a214b3-b060-4916-8539-1ed0e896ebed',
				'd1f9f00e-f847-4289-97ce-c09cd36e68c9',
				'ac4b1619-189a-43b4-a43a-436d09e7c3ee',
				'6781075d-3513-4fa2-b0c2-cd98f45a0b80',
				'c2ed2e6d-7b75-4666-bfb8-ef620c29eea5'
			)
		)
		update auth.users as u
		set banned_until = greatest(
			coalesce(u.banned_until, v_transition_at),
			v_transition_at + interval '100 years'
		)
		where u.id in (select qp.id from qa_profiles as qp);

		get diagnostics v_banned_auth_users = row_count;
	end if;

	raise notice 'QA transition complete. Assignments closed: %, beneficiaries inactivated: %, profiles inactivated: %, auth users banned: %.',
		v_closed_assignments,
		v_inactivated_beneficiaries,
		v_inactivated_profiles,
		v_banned_auth_users;
end;
$$;