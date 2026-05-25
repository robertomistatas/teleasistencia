-- =============================================
-- fix_phase4_4a_correlate_raw_call_log_conflict
-- Corrige ambiguedad entre parametro de salida y
-- columna usada por el upsert de correlacion.
-- =============================================

create or replace function public.correlate_raw_call_log(
	p_raw_call_log_id uuid
)
returns table (
	raw_call_log_id uuid,
	correlation_id uuid,
	correlation_status public.call_correlation_status,
	beneficiary_id uuid,
	beneficiary_contact_id uuid,
	assignment_id_at_call_time uuid,
	responsible_user_id_at_call_time uuid,
	matched_phone text,
	match_method public.call_match_method,
	confidence_score integer,
	reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_raw_call public.raw_call_logs%rowtype;
	v_phone_normalized text;
	v_matching_contact_count integer := 0;
	v_matching_beneficiary_count integer := 0;
	v_selected_contact record;
	v_correlation_status public.call_correlation_status;
	v_beneficiary_id uuid;
	v_beneficiary_contact_id uuid;
	v_assignment_id_at_call_time uuid;
	v_responsible_user_id_at_call_time uuid;
	v_matched_phone text;
	v_contact_type public.contact_type;
	v_match_method public.call_match_method;
	v_confidence_score integer := 0;
	v_reason text;
	v_correlation_id uuid;
begin
	if p_raw_call_log_id is null then
		raise exception 'La llamada cruda es obligatoria';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para correlacionar llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin o super_admin pueden correlacionar llamadas';
	end if;

	select rcl.*
	into v_raw_call
	from public.raw_call_logs as rcl
	where rcl.id = p_raw_call_log_id
	for update;

	if not found then
		raise exception 'La llamada cruda indicada no existe';
	end if;

	v_phone_normalized := public.normalize_chilean_phone(v_raw_call.raw_phone);

	if v_raw_call.phone_normalized is distinct from v_phone_normalized then
		update public.raw_call_logs
		set phone_normalized = v_phone_normalized
		where id = v_raw_call.id;
	end if;

	v_matched_phone := v_phone_normalized;

	if v_phone_normalized is null then
		v_correlation_status := 'invalid_phone';
		v_match_method := 'invalid_phone';
		v_confidence_score := 0;
		v_reason := 'No fue posible normalizar raw_phone con public.normalize_chilean_phone.';
		v_matched_phone := null;
	else
		select
			count(*)::integer,
			count(distinct bc.beneficiary_id)::integer
		into v_matching_contact_count, v_matching_beneficiary_count
		from public.beneficiary_contacts as bc
		where bc.phone_normalized = v_phone_normalized;

		if v_matching_contact_count = 0 then
			v_correlation_status := 'unmatched';
			v_match_method := 'no_contact_match';
			v_confidence_score := 0;
			v_reason := 'Telefono normalizado valido sin contactos asociados en beneficiary_contacts.';
		elsif v_matching_beneficiary_count > 1 then
			v_correlation_status := 'matched_multiple';
			v_match_method := 'phone_exact_multiple_contacts';
			v_confidence_score := 40;
			v_reason := format(
				'Telefono normalizado %s asociado a %s contactos de %s beneficiarios; no se resuelve automaticamente.',
				v_phone_normalized,
				v_matching_contact_count,
				v_matching_beneficiary_count
			);
		else
			select
				bc.id,
				bc.beneficiary_id,
				bc.contact_type,
				bc.is_active,
				bc.is_primary
			into v_selected_contact
			from public.beneficiary_contacts as bc
			where bc.phone_normalized = v_phone_normalized
			order by
				case when bc.is_active then 0 else 1 end,
				case when bc.is_primary then 0 else 1 end,
				bc.updated_at desc,
				bc.created_at desc,
				bc.id asc
			limit 1;

			v_correlation_status := 'matched_single';
			v_beneficiary_id := v_selected_contact.beneficiary_id;
			v_beneficiary_contact_id := v_selected_contact.id;
			v_contact_type := v_selected_contact.contact_type;

			if v_selected_contact.is_active then
				v_match_method := 'phone_exact_active_contact';
				if v_selected_contact.is_primary then
					v_confidence_score := 100;
					v_reason := 'Telefono normalizado asociado a un unico beneficiario mediante contacto activo principal.';
				else
					v_confidence_score := 95;
					v_reason := 'Telefono normalizado asociado a un unico beneficiario mediante contacto activo no principal.';
				end if;
			else
				v_match_method := 'phone_exact_inactive_contact';
				v_confidence_score := 80;
				v_reason := 'Telefono normalizado asociado a un unico beneficiario mediante contacto historico o inactivo.';
			end if;

			if v_matching_contact_count > 1 then
				v_reason := v_reason || format(
					' Se priorizo el contacto %s entre %s contactos del mismo beneficiario.',
					v_beneficiary_contact_id,
					v_matching_contact_count
				);
			end if;

			select
				ba.id,
				ba.assigned_user_id
			into v_assignment_id_at_call_time, v_responsible_user_id_at_call_time
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = v_beneficiary_id
				and ba.assignment_type = 'primary'
				and ba.status = 'active'
				and ba.starts_at <= v_raw_call.called_at
				and (ba.ends_at is null or ba.ends_at >= v_raw_call.called_at)
			order by ba.starts_at desc, ba.created_at desc, ba.id desc
			limit 1;

			if v_assignment_id_at_call_time is null then
				v_reason := v_reason || ' No se encontro primary vigente al momento de la llamada.';
			else
				v_reason := v_reason || ' Se resolvio primary vigente al momento de la llamada.';
			end if;
		end if;
	end if;

	insert into public.call_correlations (
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
	values (
		v_raw_call.id,
		v_correlation_status,
		v_beneficiary_id,
		v_beneficiary_contact_id,
		v_matched_phone,
		v_contact_type,
		v_match_method,
		v_confidence_score,
		v_assignment_id_at_call_time,
		v_responsible_user_id_at_call_time,
		v_reason,
		v_requester_id,
		v_requester_id
	)
	on conflict on constraint call_correlations_raw_call_log_id_unique do update
	set
		correlation_status = excluded.correlation_status,
		beneficiary_id = excluded.beneficiary_id,
		beneficiary_contact_id = excluded.beneficiary_contact_id,
		matched_phone = excluded.matched_phone,
		contact_type = excluded.contact_type,
		match_method = excluded.match_method,
		confidence_score = excluded.confidence_score,
		assignment_id_at_call_time = excluded.assignment_id_at_call_time,
		responsible_user_id_at_call_time = excluded.responsible_user_id_at_call_time,
		reason = excluded.reason,
		updated_at = now(),
		updated_by = excluded.updated_by
	returning id into v_correlation_id;

	return query
	select
		v_raw_call.id,
		v_correlation_id,
		v_correlation_status,
		v_beneficiary_id,
		v_beneficiary_contact_id,
		v_assignment_id_at_call_time,
		v_responsible_user_id_at_call_time,
		v_matched_phone,
		v_match_method,
		v_confidence_score,
		v_reason;
end;
$$;

comment on function public.correlate_raw_call_log(uuid)
	is 'Correlaciona una llamada cruda contra beneficiary_contacts y beneficiary_assignments, manteniendo un unico resultado auditable por raw_call_log_id.';