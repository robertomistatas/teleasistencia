create or replace function public.evaluate_beneficiary_contacts_import_rows(
	p_rows jsonb
)
returns table (
	row_number integer,
	raw_payload jsonb,
	normalized_payload jsonb,
	result_status public.import_row_result_status,
	message text,
	beneficiary_id uuid,
	contact_id uuid,
	should_create_beneficiary boolean,
	should_update_beneficiary_name boolean,
	should_create_contact boolean,
	should_replace_primary boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_item jsonb;
	v_index integer := 0;
	v_row_number integer;
	v_raw_payload jsonb;
	v_normalized_payload jsonb;
	v_result_status public.import_row_result_status;
	v_message text;
	v_beneficiary_id uuid;
	v_contact_id uuid;
	v_should_create_beneficiary boolean;
	v_should_update_beneficiary_name boolean;
	v_should_create_contact boolean;
	v_should_replace_primary boolean;
	v_rut_raw text;
	v_rut_normalized text;
	v_name_raw text;
	v_name_normalized text;
	v_phone_raw text;
	v_phone_normalized text;
	v_type_raw text;
	v_import_contact_type text;
	v_contact_type public.contact_type;
	v_is_primary boolean;
	v_existing_name text;
	v_effective_name text;
	v_active_primary_phone text;
	v_beneficiary_created_in_file boolean;
	v_existing_contact_id uuid;
	v_shared_phone_owner_rut text;
	v_shared_phone_exists boolean;
	v_errors text[];
	v_warnings text[];
	v_base_message text;
	v_contact_key text;
	v_state jsonb;
	v_state_by_rut jsonb := '{}'::jsonb;
	v_phone_owner_by_phone jsonb := '{}'::jsonb;
	v_seen_contact_keys text[] := array[]::text[];
begin
	if v_requester_id is null then
		raise exception 'No autorizado para previsualizar importaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar beneficiarios';
	end if;

	if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
		raise exception 'Las filas de importacion deben enviarse como un arreglo JSON';
	end if;

	if jsonb_array_length(p_rows) = 0 then
		raise exception 'El archivo no contiene filas de datos';
	end if;

	for v_item in select value from jsonb_array_elements(p_rows)
	loop
		v_index := v_index + 1;
		v_raw_payload := coalesce(v_item, '{}'::jsonb);
		v_row_number := coalesce(nullif(v_item->>'rowNumber', '')::integer, v_index);
		v_errors := array[]::text[];
		v_warnings := array[]::text[];
		v_beneficiary_id := null;
		v_contact_id := null;
		v_should_create_beneficiary := false;
		v_should_update_beneficiary_name := false;
		v_should_create_contact := false;
		v_should_replace_primary := false;
		v_existing_name := null;
		v_effective_name := null;
		v_active_primary_phone := null;
		v_beneficiary_created_in_file := false;
		v_existing_contact_id := null;
		v_shared_phone_owner_rut := null;
		v_shared_phone_exists := false;

		v_rut_raw := nullif(btrim(coalesce(v_item->>'rut', '')), '');
		v_name_raw := nullif(btrim(coalesce(v_item->>'nombre', '')), '');
		v_phone_raw := nullif(btrim(coalesce(v_item->>'telefono', '')), '');
		v_type_raw := nullif(btrim(coalesce(v_item->>'tipoTelefono', '')), '');

		if v_rut_raw is null then
			v_errors := array_append(v_errors, 'RUT obligatorio');
		else
			v_rut_normalized := public.normalize_rut(v_rut_raw);
			if v_rut_normalized is null then
				v_errors := array_append(v_errors, 'RUT invalido');
			end if;
		end if;

		v_name_normalized := public.normalize_person_name(v_name_raw);
		if v_name_normalized is null then
			v_errors := array_append(v_errors, 'Nombre obligatorio');
		end if;

		if v_phone_raw is null then
			v_errors := array_append(v_errors, 'Telefono obligatorio');
		else
			v_phone_normalized := public.normalize_chilean_phone(v_phone_raw);
			if v_phone_normalized is null then
				v_errors := array_append(v_errors, 'Telefono invalido');
			end if;
		end if;

		if v_type_raw is null then
			v_errors := array_append(v_errors, 'Tipo telefono obligatorio');
		else
			v_import_contact_type := public.normalize_import_contact_type(v_type_raw);
			if v_import_contact_type is null then
				v_errors := array_append(v_errors, 'Tipo telefono invalido; usa principal o red_apoyo');
			end if;
		end if;

		if array_length(v_errors, 1) is not null then
			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_name_normalized,
				'phoneNormalized', v_phone_normalized,
				'importContactType', v_import_contact_type
			);
			result_status := 'error';
			message := array_to_string(v_errors, ' | ');
			beneficiary_id := null;
			contact_id := null;
			should_create_beneficiary := false;
			should_update_beneficiary_name := false;
			should_create_contact := false;
			should_replace_primary := false;
			return next;
			continue;
		end if;

		if v_import_contact_type = 'principal' then
			v_contact_type := 'primary_phone';
			v_is_primary := true;
		else
			v_contact_type := 'support_network';
			v_is_primary := false;
		end if;

		if v_state_by_rut ? v_rut_normalized then
			v_state := v_state_by_rut -> v_rut_normalized;
			v_beneficiary_id := nullif(v_state->>'beneficiary_id', '')::uuid;
			v_effective_name := nullif(v_state->>'effective_name', '');
			v_existing_name := v_effective_name;
			v_active_primary_phone := nullif(v_state->>'active_primary_phone', '');
			v_beneficiary_created_in_file := coalesce((v_state->>'created_in_file')::boolean, false);
			v_should_create_beneficiary := false;
		else
			select b.id, public.normalize_person_name(b.full_name)
			into v_beneficiary_id, v_existing_name
			from public.beneficiaries as b
			where b.rut_normalized = v_rut_normalized
			limit 1;

			if v_beneficiary_id is null then
				v_should_create_beneficiary := true;
				v_beneficiary_created_in_file := true;
				v_effective_name := v_name_normalized;
			else
				v_should_create_beneficiary := false;
				v_beneficiary_created_in_file := false;
				select bc.phone_normalized
				into v_active_primary_phone
				from public.beneficiary_contacts as bc
				where bc.beneficiary_id = v_beneficiary_id
					and bc.is_active is true
					and bc.is_primary is true
				order by bc.created_at desc
				limit 1;

				v_effective_name := coalesce(v_existing_name, v_name_normalized);
			end if;
		end if;

		if v_existing_name is null and v_beneficiary_id is not null then
			v_should_update_beneficiary_name := true;
			v_effective_name := v_name_normalized;
		elsif v_effective_name is distinct from v_name_normalized then
			v_warnings := array_append(v_warnings, 'Nombre distinto; se conserva el nombre ya registrado');
			v_effective_name := coalesce(v_effective_name, v_name_normalized);
		end if;

		v_contact_key := v_rut_normalized || '|' || v_phone_normalized;

		if v_contact_key = any(v_seen_contact_keys) then
			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_effective_name,
				'inputName', v_name_normalized,
				'phoneNormalized', v_phone_normalized,
				'importContactType', v_import_contact_type,
				'contactType', v_contact_type,
				'isPrimary', v_is_primary
			);
			result_status := 'skipped';
			message := 'Contacto duplicado dentro del mismo archivo; no se creara un nuevo registro';
			beneficiary_id := v_beneficiary_id;
			contact_id := null;
			should_create_beneficiary := false;
			should_update_beneficiary_name := false;
			should_create_contact := false;
			should_replace_primary := false;
			return next;
			continue;
		end if;

		if v_beneficiary_id is not null then
			select bc.id
			into v_existing_contact_id
			from public.beneficiary_contacts as bc
			where bc.beneficiary_id = v_beneficiary_id
				and bc.phone_normalized = v_phone_normalized
			order by bc.created_at desc
			limit 1;
		end if;

		if v_existing_contact_id is not null then
			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_effective_name,
				'inputName', v_name_normalized,
				'phoneNormalized', v_phone_normalized,
				'importContactType', v_import_contact_type,
				'contactType', v_contact_type,
				'isPrimary', v_is_primary
			);
			result_status := 'skipped';
			message := 'Contacto duplicado para el beneficiario; no se creara un nuevo registro';
			beneficiary_id := v_beneficiary_id;
			contact_id := v_existing_contact_id;
			should_create_beneficiary := false;
			should_update_beneficiary_name := false;
			should_create_contact := false;
			should_replace_primary := false;
			return next;
			continue;
		end if;

		if v_phone_owner_by_phone ? v_phone_normalized then
			v_shared_phone_owner_rut := nullif(v_phone_owner_by_phone->>v_phone_normalized, '');
			if v_shared_phone_owner_rut is distinct from v_rut_normalized then
				v_warnings := array_append(v_warnings, 'Telefono compartido con otro beneficiario del mismo archivo');
			end if;
		else
			select exists (
				select 1
				from public.beneficiary_contacts as bc
				where bc.phone_normalized = v_phone_normalized
					and (v_beneficiary_id is null or bc.beneficiary_id is distinct from v_beneficiary_id)
			)
			into v_shared_phone_exists;

			if v_shared_phone_exists then
				v_warnings := array_append(v_warnings, 'Telefono compartido con otro beneficiario existente');
			end if;

			v_phone_owner_by_phone := v_phone_owner_by_phone || jsonb_build_object(v_phone_normalized, v_rut_normalized);
		end if;

		if v_is_primary and v_active_primary_phone is not null and v_active_primary_phone <> v_phone_normalized then
			v_should_replace_primary := true;
			v_warnings := array_append(v_warnings, 'Principal anterior reemplazado');
		end if;

		v_should_create_contact := true;
		v_seen_contact_keys := array_append(v_seen_contact_keys, v_contact_key);

		v_state_by_rut := v_state_by_rut || jsonb_build_object(
			v_rut_normalized,
			jsonb_build_object(
				'beneficiary_id', v_beneficiary_id,
				'beneficiary_exists_in_db', coalesce(v_beneficiary_id is not null, false),
				'created_in_file', v_beneficiary_created_in_file,
				'effective_name', v_effective_name,
				'active_primary_phone', case when v_is_primary then v_phone_normalized else v_active_primary_phone end
			)
		);

		if v_should_create_beneficiary then
			v_base_message := 'Se creara un nuevo beneficiario y su contacto';
		elsif v_beneficiary_created_in_file then
			v_base_message := 'Se agregara un contacto adicional al beneficiario creado en esta corrida';
		elsif v_should_update_beneficiary_name then
			v_base_message := 'Se actualizara el nombre vacio del beneficiario y se agregara el contacto';
		else
			v_base_message := 'Se agregara un contacto al beneficiario existente';
		end if;

		v_normalized_payload := jsonb_build_object(
			'rutNormalized', v_rut_normalized,
			'beneficiaryName', v_effective_name,
			'inputName', v_name_normalized,
			'phoneNormalized', v_phone_normalized,
			'importContactType', v_import_contact_type,
			'contactType', v_contact_type,
			'isPrimary', v_is_primary
		);

		row_number := v_row_number;
		raw_payload := v_raw_payload;
		normalized_payload := v_normalized_payload;
		if array_length(v_warnings, 1) is not null then
			result_status := 'warning';
			message := v_base_message || '. Advertencias: ' || array_to_string(v_warnings, ' | ');
		elsif v_should_create_beneficiary then
			result_status := 'created';
			message := v_base_message;
		else
			result_status := 'updated';
			message := v_base_message;
		end if;
		beneficiary_id := v_beneficiary_id;
		contact_id := null;
		should_create_beneficiary := v_should_create_beneficiary;
		should_update_beneficiary_name := v_should_update_beneficiary_name;
		should_create_contact := v_should_create_contact;
		should_replace_primary := v_should_replace_primary;
		return next;
	end loop;
end;
$$;

create or replace function public.execute_beneficiary_contacts_import(
	p_source_filename text,
	p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_run_id uuid := gen_random_uuid();
	v_now timestamptz := now();
	v_created_rows integer := 0;
	v_updated_rows integer := 0;
	v_skipped_rows integer := 0;
	v_warning_rows integer := 0;
	v_error_rows integer := 0;
	v_source_filename text := nullif(btrim(coalesce(p_source_filename, '')), '');
	v_eval record;
	v_actual_beneficiary_id uuid;
	v_actual_contact_id uuid;
	v_duplicate_contact_id uuid;
	v_created_beneficiary_ids jsonb := '{}'::jsonb;
	v_rut_normalized text;
	v_beneficiary_name text;
	v_phone_normalized text;
	v_phone_raw text;
	v_contact_type public.contact_type;
	v_is_primary boolean;
	v_effective_status public.import_row_result_status;
	v_effective_message text;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar importaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar beneficiarios';
	end if;

	if v_source_filename is null then
		raise exception 'El nombre del archivo es obligatorio';
	end if;

	insert into public.import_runs (
		id,
		created_by,
		import_type,
		source_filename,
		status,
		total_rows,
		metadata
	)
	values (
		v_run_id,
		v_requester_id,
		'beneficiary_contacts',
		v_source_filename,
		'processing',
		jsonb_array_length(p_rows),
		jsonb_build_object('previewedAt', v_now)
	);

	for v_eval in
		select *
		from public.evaluate_beneficiary_contacts_import_rows(p_rows)
	loop
		v_actual_beneficiary_id := v_eval.beneficiary_id;
		v_actual_contact_id := v_eval.contact_id;
		v_effective_status := v_eval.result_status;
		v_effective_message := v_eval.message;

		if v_eval.result_status = 'error' then
			v_error_rows := v_error_rows + 1;
		elsif v_eval.result_status = 'skipped' then
			v_skipped_rows := v_skipped_rows + 1;
		else
			v_rut_normalized := nullif(v_eval.normalized_payload->>'rutNormalized', '');
			v_beneficiary_name := nullif(v_eval.normalized_payload->>'beneficiaryName', '');
			v_phone_normalized := nullif(v_eval.normalized_payload->>'phoneNormalized', '');
			v_phone_raw := nullif(v_eval.raw_payload->>'telefono', '');
			v_contact_type := (v_eval.normalized_payload->>'contactType')::public.contact_type;
			v_is_primary := coalesce((v_eval.normalized_payload->>'isPrimary')::boolean, false);

			if v_actual_beneficiary_id is null and v_created_beneficiary_ids ? v_rut_normalized then
				v_actual_beneficiary_id := nullif(v_created_beneficiary_ids->>v_rut_normalized, '')::uuid;
			end if;

			if v_actual_beneficiary_id is null then
				insert into public.beneficiaries (
					rut_raw,
					rut_normalized,
					full_name,
					status,
					created_by,
					updated_by,
					created_at,
					updated_at
				)
				values (
					v_eval.raw_payload->>'rut',
					v_rut_normalized,
					v_beneficiary_name,
					'active',
					v_requester_id,
					v_requester_id,
					v_now,
					v_now
				)
				returning id into v_actual_beneficiary_id;

				v_created_beneficiary_ids := v_created_beneficiary_ids || jsonb_build_object(v_rut_normalized, v_actual_beneficiary_id);
			elsif v_eval.should_update_beneficiary_name and v_beneficiary_name is not null then
				update public.beneficiaries
				set
					full_name = v_beneficiary_name,
					updated_by = v_requester_id,
					updated_at = v_now
				where id = v_actual_beneficiary_id
					and public.normalize_person_name(full_name) is null;
			end if;

			if v_is_primary then
				update public.beneficiary_contacts
				set
					is_active = false,
					is_primary = false,
					updated_at = v_now
				where beneficiary_id = v_actual_beneficiary_id
					and is_active is true
					and is_primary is true
					and phone_normalized is distinct from v_phone_normalized;
			end if;

			select bc.id
			into v_duplicate_contact_id
			from public.beneficiary_contacts as bc
			where bc.beneficiary_id = v_actual_beneficiary_id
				and bc.phone_normalized = v_phone_normalized
			order by bc.created_at desc
			limit 1;

			if v_duplicate_contact_id is not null then
				v_actual_contact_id := v_duplicate_contact_id;
				v_effective_status := 'skipped';
				v_effective_message := 'Contacto duplicado detectado durante la ejecucion; no se creo un nuevo registro';
				v_skipped_rows := v_skipped_rows + 1;
			else
				insert into public.beneficiary_contacts (
					beneficiary_id,
					contact_type,
					contact_name,
					relationship,
					phone_raw,
					phone_normalized,
					is_primary,
					is_active,
					counts_as_valid_followup,
					notes,
					created_at,
					updated_at
				)
				values (
					v_actual_beneficiary_id,
					v_contact_type,
					null,
					case when v_contact_type = 'support_network' then 'Red de apoyo importada' else null end,
					v_phone_raw,
					v_phone_normalized,
					v_is_primary,
					true,
					true,
					'Importado desde archivo ' || v_source_filename,
					v_now,
					v_now
				)
				returning id into v_actual_contact_id;

				case v_effective_status
					when 'created' then
						v_created_rows := v_created_rows + 1;
					when 'updated' then
						v_updated_rows := v_updated_rows + 1;
					when 'warning' then
						v_warning_rows := v_warning_rows + 1;
					else
						null;
				end case;
			end if;
		end if;

		insert into public.import_run_rows (
			import_run_id,
			row_number,
			raw_payload,
			normalized_payload,
			result_status,
			message,
			beneficiary_id,
			beneficiary_contact_id,
			created_at
		)
		values (
			v_run_id,
			v_eval.row_number,
			v_eval.raw_payload,
			v_eval.normalized_payload,
			v_effective_status,
			v_effective_message,
			v_actual_beneficiary_id,
			v_actual_contact_id,
			v_now
		);
	end loop;

	update public.import_runs
	set
		status = case when v_error_rows > 0 then 'processed_with_errors'::public.import_run_status else 'processed'::public.import_run_status end,
		created_rows = v_created_rows,
		updated_rows = v_updated_rows,
		skipped_rows = v_skipped_rows,
		warning_rows = v_warning_rows,
		error_rows = v_error_rows,
		finished_at = now(),
		metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			'executedAt', now(),
			'importType', 'beneficiary_contacts'
		)
	where id = v_run_id;

	return (
		with rows as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'rowNumber', irr.row_number,
						'rawPayload', irr.raw_payload,
						'normalizedPayload', irr.normalized_payload,
						'resultStatus', irr.result_status,
						'message', irr.message,
						'beneficiaryId', irr.beneficiary_id,
						'contactId', irr.beneficiary_contact_id
					)
					order by irr.row_number
				),
				'[]'::jsonb
			) as payload
			from public.import_run_rows as irr
			where irr.import_run_id = v_run_id
		)
		select jsonb_build_object(
			'runId', v_run_id,
			'sourceFilename', v_source_filename,
			'status', case when v_error_rows > 0 then 'processed_with_errors' else 'processed' end,
			'summary', jsonb_build_object(
				'totalRows', jsonb_array_length(p_rows),
				'createdRows', v_created_rows,
				'updatedRows', v_updated_rows,
				'skippedRows', v_skipped_rows,
				'warningRows', v_warning_rows,
				'errorRows', v_error_rows
			),
			'rows', rows.payload
		)
		from rows
	);
end;
$$;

create or replace function public.create_beneficiary_primary_assignment(
	p_beneficiary_id uuid,
	p_assigned_user_id uuid,
	p_reason text,
	p_source public.beneficiary_assignment_source default 'manual',
	p_source_run_id uuid default null,
	p_source_row_id uuid default null
)
returns table (
	beneficiary_id uuid,
	assignment_id uuid,
	assigned_user_id uuid,
	assigned_user_name text,
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
	v_assigned_user record;
	v_assignment_id uuid := gen_random_uuid();
begin
	if p_beneficiary_id is null then
		raise exception 'El beneficiario es obligatorio';
	end if;

	if p_assigned_user_id is null then
		raise exception 'La teleoperadora destino es obligatoria';
	end if;

	if v_reason is null then
		raise exception 'El motivo de la asignacion es obligatorio';
	end if;

	if v_requester_id is null then
		raise exception 'No autorizado para crear la responsable oficial';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin o super_admin pueden crear la responsable oficial';
	end if;

	perform 1
	from public.beneficiaries as b
	where b.id = p_beneficiary_id;

	if not found then
		raise exception 'El beneficiario no existe';
	end if;

	select p.id, p.full_name, p.email, p.role, p.is_active
	into v_assigned_user
	from public.profiles as p
	where p.id = p_assigned_user_id;

	if not found then
		raise exception 'La teleoperadora destino no existe';
	end if;

	if v_assigned_user.role <> 'teleoperadora' then
		raise exception 'La teleoperadora destino debe tener rol teleoperadora';
	end if;

	if v_assigned_user.is_active is distinct from true then
		raise exception 'La teleoperadora destino debe estar activa';
	end if;

	if exists (
		select 1
		from public.beneficiary_assignments as ba
		where ba.beneficiary_id = p_beneficiary_id
			and ba.assignment_type = 'primary'
			and ba.status = 'active'
	) then
		raise exception 'El beneficiario ya tiene una asignacion oficial vigente';
	end if;

	if exists (
		select 1
		from public.beneficiary_assignments as ba
		where ba.beneficiary_id = p_beneficiary_id
			and ba.assigned_user_id = p_assigned_user_id
			and ba.assignment_type = 'support'
			and ba.status = 'active'
	) then
		raise exception 'La teleoperadora destino ya figura como apoyo temporal activo para este beneficiario';
	end if;

	insert into public.beneficiary_assignments (
		id,
		beneficiary_id,
		assigned_user_id,
		assignment_type,
		status,
		starts_at,
		source,
		source_run_id,
		source_row_id,
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
		p_assigned_user_id,
		'primary',
		'active',
		v_effective_at,
		coalesce(p_source, 'manual'),
		p_source_run_id,
		p_source_row_id,
		v_requester_id,
		v_requester_id,
		v_reason,
		'Asignacion oficial creada. Motivo: ' || v_reason,
		v_effective_at,
		v_effective_at
	);

	return query
	select
		p_beneficiary_id,
		v_assignment_id,
		p_assigned_user_id,
		coalesce(v_assigned_user.full_name, v_assigned_user.email, 'Responsable oficial'),
		v_effective_at;
end;
$$;

create or replace function public.evaluate_assignment_import_rows(
	p_target_user_id uuid,
	p_rows jsonb
)
returns table (
	row_number integer,
	raw_payload jsonb,
	normalized_payload jsonb,
	result_status public.import_row_result_status,
	message text,
	beneficiary_id uuid,
	active_assignment_id uuid,
	active_assignment_user_id uuid,
	active_assignment_user_name text,
	has_name_warning boolean,
	has_related_support_warning boolean,
	should_apply boolean,
	should_reassign boolean,
	should_create boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_target_user record;
	v_item jsonb;
	v_index integer := 0;
	v_row_number integer;
	v_raw_payload jsonb;
	v_rut_raw text;
	v_rut_normalized text;
	v_name_raw text;
	v_name_normalized text;
	v_beneficiary record;
	v_active_primary record;
	v_related_support_count integer;
	v_duplicate_valid_ruts text[] := array[]::text[];
	v_status public.import_row_result_status;
	v_message_parts text[];
	v_normalized_payload jsonb;
	v_should_apply boolean;
	v_should_reassign boolean;
	v_should_create boolean;
	v_has_name_warning boolean;
	v_has_related_support_warning boolean;
	v_result_beneficiary_id uuid;
	v_result_active_assignment_id uuid;
	v_result_active_assignment_user_id uuid;
	v_result_active_assignment_user_name text;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para previsualizar importaciones de asignaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar asignaciones';
	end if;

	if p_target_user_id is null then
		raise exception 'La teleoperadora destino es obligatoria';
	end if;

	select p.id, p.full_name, p.email, p.role, p.is_active
	into v_target_user
	from public.profiles as p
	where p.id = p_target_user_id;

	if not found or v_target_user.role <> 'teleoperadora' or v_target_user.is_active is distinct from true then
		raise exception 'La teleoperadora destino debe existir, estar activa y tener rol teleoperadora';
	end if;

	if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
		raise exception 'Las filas de importacion deben enviarse como un arreglo JSON';
	end if;

	if jsonb_array_length(p_rows) = 0 then
		raise exception 'El archivo no contiene filas de datos';
	end if;

	for v_item in select value from jsonb_array_elements(p_rows)
	loop
		v_index := v_index + 1;
		v_raw_payload := coalesce(v_item, '{}'::jsonb);
		v_row_number := coalesce(nullif(v_item->>'rowNumber', '')::integer, v_index);
		v_status := null;
		v_message_parts := array[]::text[];
		v_should_apply := false;
		v_should_reassign := false;
		v_should_create := false;
		v_has_name_warning := false;
		v_has_related_support_warning := false;
		v_result_beneficiary_id := null;
		v_result_active_assignment_id := null;
		v_result_active_assignment_user_id := null;
		v_result_active_assignment_user_name := null;

		v_rut_raw := nullif(btrim(coalesce(v_item->>'rut', '')), '');
		v_name_raw := nullif(btrim(coalesce(v_item->>'nombre', '')), '');
		v_name_normalized := public.normalize_person_name(v_name_raw);
		v_rut_normalized := null;
		v_beneficiary := null;
		v_active_primary := null;
		v_related_support_count := 0;

		if v_rut_raw is null then
			v_status := 'error';
			v_message_parts := array_append(v_message_parts, 'RUT invalido');
		else
			v_rut_normalized := public.normalize_rut(v_rut_raw);
			if v_rut_normalized is null then
				v_status := 'error';
				v_message_parts := array_append(v_message_parts, 'RUT invalido');
			end if;
		end if;

		if v_status = 'error' then
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', null
			);

			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := v_normalized_payload;
			result_status := 'error';
			message := array_to_string(v_message_parts, ' | ');
			beneficiary_id := v_result_beneficiary_id;
			active_assignment_id := v_result_active_assignment_id;
			active_assignment_user_id := v_result_active_assignment_user_id;
			active_assignment_user_name := v_result_active_assignment_user_name;
			has_name_warning := false;
			has_related_support_warning := false;
			should_apply := false;
			should_reassign := false;
			should_create := false;
			return next;
			continue;
		end if;

		select
			b.id,
			b.full_name
		into v_beneficiary
		from public.beneficiaries as b
		where b.rut_normalized = v_rut_normalized
		limit 1;

		if not found then
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', null
			);

			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := v_normalized_payload;
			result_status := 'error';
			message := 'Beneficiario no encontrado.';
			beneficiary_id := v_result_beneficiary_id;
			active_assignment_id := v_result_active_assignment_id;
			active_assignment_user_id := v_result_active_assignment_user_id;
			active_assignment_user_name := v_result_active_assignment_user_name;
			has_name_warning := false;
			has_related_support_warning := false;
			should_apply := false;
			should_reassign := false;
			should_create := false;
			return next;
			continue;
		end if;

		v_result_beneficiary_id := v_beneficiary.id;

		if v_rut_normalized = any(v_duplicate_valid_ruts) then
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', public.normalize_person_name(v_beneficiary.full_name),
				'inputName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', 'duplicate'
			);

			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := v_normalized_payload;
			result_status := 'warning';
			message := 'RUT repetido en archivo. Se considera solo la primera aparicion valida.';
			beneficiary_id := v_result_beneficiary_id;
			active_assignment_id := v_result_active_assignment_id;
			active_assignment_user_id := v_result_active_assignment_user_id;
			active_assignment_user_name := v_result_active_assignment_user_name;
			has_name_warning := false;
			has_related_support_warning := false;
			should_apply := false;
			should_reassign := false;
			should_create := false;
			return next;
			continue;
		end if;

		if v_name_normalized is not null
			and public.normalize_person_name(v_beneficiary.full_name) is not null
			and public.normalize_person_name(v_beneficiary.full_name) is distinct from v_name_normalized then
			v_has_name_warning := true;
			v_message_parts := array_append(v_message_parts, 'Nombre del archivo difiere del nombre registrado. Se usara el beneficiario existente por RUT.');
		end if;

		if exists (
			select 1
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = v_beneficiary.id
				and ba.assigned_user_id = p_target_user_id
				and ba.assignment_type = 'support'
				and ba.status = 'active'
		) then
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', coalesce(public.normalize_person_name(v_beneficiary.full_name), v_name_normalized),
				'inputName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', null
			);

			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := v_normalized_payload;
			result_status := 'error';
			message := 'La teleoperadora destino figura como apoyo temporal activo. Cierre el apoyo antes de reasignar.';
			beneficiary_id := v_result_beneficiary_id;
			active_assignment_id := v_result_active_assignment_id;
			active_assignment_user_id := v_result_active_assignment_user_id;
			active_assignment_user_name := v_result_active_assignment_user_name;
			has_name_warning := v_has_name_warning;
			has_related_support_warning := false;
			should_apply := false;
			should_reassign := false;
			should_create := false;
			return next;
			continue;
		end if;

		select count(*)::integer
		into v_related_support_count
		from public.beneficiary_assignments as ba
		where ba.beneficiary_id = v_beneficiary.id
			and ba.assignment_type = 'support'
			and ba.status = 'active';

		if v_related_support_count > 0 then
			v_has_related_support_warning := true;
			v_message_parts := array_append(v_message_parts, 'El beneficiario mantiene apoyo temporal activo relacionado.');
		end if;

		select
			ba.id,
			ba.assigned_user_id,
			coalesce(p.full_name, p.email, 'Responsable oficial') as assigned_user_name
		into v_active_primary
		from public.beneficiary_assignments as ba
		join public.profiles as p
			on p.id = ba.assigned_user_id
		where ba.beneficiary_id = v_beneficiary.id
			and ba.assignment_type = 'primary'
			and ba.status = 'active'
		limit 1;

		v_result_active_assignment_id := v_active_primary.id;
		v_result_active_assignment_user_id := v_active_primary.assigned_user_id;
		v_result_active_assignment_user_name := v_active_primary.assigned_user_name;

		if not found then
			v_status := case when v_has_name_warning or v_has_related_support_warning then 'warning' else 'created' end;
			v_should_apply := true;
			v_should_create := true;
			v_message_parts := array_prepend('Se creara una asignacion primary nueva para la teleoperadora seleccionada.', v_message_parts);
			v_duplicate_valid_ruts := array_append(v_duplicate_valid_ruts, v_rut_normalized);
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', coalesce(public.normalize_person_name(v_beneficiary.full_name), v_name_normalized),
				'inputName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', 'created'
			);
		elsif v_active_primary.assigned_user_id = p_target_user_id then
			v_status := case when v_has_name_warning or v_has_related_support_warning then 'warning' else 'skipped' end;
			v_should_apply := false;
			v_message_parts := array_prepend('El beneficiario ya estaba asignado a la misma teleoperadora como primary activa.', v_message_parts);
			v_duplicate_valid_ruts := array_append(v_duplicate_valid_ruts, v_rut_normalized);
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', coalesce(public.normalize_person_name(v_beneficiary.full_name), v_name_normalized),
				'inputName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', 'skipped'
			);
		else
			v_status := case when v_has_name_warning or v_has_related_support_warning then 'warning' else 'reassigned' end;
			v_should_apply := true;
			v_should_reassign := true;
			v_message_parts := array_prepend('Se ejecutara reasignacion controlada reutilizando la logica de Fase 3.', v_message_parts);
			v_duplicate_valid_ruts := array_append(v_duplicate_valid_ruts, v_rut_normalized);
			v_normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', coalesce(public.normalize_person_name(v_beneficiary.full_name), v_name_normalized),
				'inputName', v_name_normalized,
				'targetUserId', p_target_user_id,
				'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
				'operation', 'reassigned'
			);
		end if;

		row_number := v_row_number;
		raw_payload := v_raw_payload;
		normalized_payload := v_normalized_payload;
		result_status := v_status;
		message := array_to_string(v_message_parts, ' ');
		beneficiary_id := v_result_beneficiary_id;
		active_assignment_id := v_result_active_assignment_id;
		active_assignment_user_id := v_result_active_assignment_user_id;
		active_assignment_user_name := v_result_active_assignment_user_name;
		has_name_warning := v_has_name_warning;
		has_related_support_warning := v_has_related_support_warning;
		should_apply := v_should_apply;
		should_reassign := v_should_reassign;
		should_create := v_should_create;
		return next;
	end loop;
end;
$$;

create or replace function public.execute_assignment_import(
	p_source_filename text,
	p_target_user_id uuid,
	p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_run_id uuid := gen_random_uuid();
	v_now timestamptz := now();
	v_source_filename text := nullif(btrim(coalesce(p_source_filename, '')), '');
	v_target_user record;
	v_eval record;
	v_run_row_id uuid;
	v_created_rows integer := 0;
	v_reassigned_rows integer := 0;
	v_skipped_rows integer := 0;
	v_warning_rows integer := 0;
	v_error_rows integer := 0;
	v_effective_status public.import_row_result_status;
	v_effective_message text;
	v_effective_normalized_payload jsonb;
	v_assignment_id uuid;
	v_previous_assignment_id uuid;
	v_effective_operation text;
	v_effective_active_assignment_id uuid;
	v_effective_active_assignment_user_id uuid;
	v_effective_active_assignment_user_name text;
	v_effective_should_apply boolean;
	v_effective_should_reassign boolean;
	v_effective_should_create boolean;
	v_effective_has_name_warning boolean;
	v_effective_has_related_support_warning boolean;
	v_create_result record;
	v_reassign_result record;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar importaciones de asignaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar asignaciones';
	end if;

	if p_target_user_id is null then
		raise exception 'La teleoperadora destino es obligatoria';
	end if;

	if v_source_filename is null then
		raise exception 'El nombre del archivo es obligatorio';
	end if;

	select p.id, p.full_name, p.email, p.role, p.is_active
	into v_target_user
	from public.profiles as p
	where p.id = p_target_user_id;

	if not found or v_target_user.role <> 'teleoperadora' or v_target_user.is_active is distinct from true then
		raise exception 'La teleoperadora destino debe existir, estar activa y tener rol teleoperadora';
	end if;

	insert into public.import_runs (
		id,
		created_by,
		import_type,
		source_filename,
		status,
		total_rows,
		metadata
	)
	values (
		v_run_id,
		v_requester_id,
		'assignment_import',
		v_source_filename,
		'processing',
		jsonb_array_length(p_rows),
		jsonb_build_object(
			'previewedAt', v_now,
			'targetUserId', p_target_user_id,
			'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino')
		)
	);

	for v_eval in
		select *
		from public.evaluate_assignment_import_rows(p_target_user_id, p_rows)
	loop
		v_run_row_id := gen_random_uuid();
		v_effective_status := v_eval.result_status;
		v_effective_message := v_eval.message;
		v_effective_normalized_payload := coalesce(v_eval.normalized_payload, '{}'::jsonb);
		v_assignment_id := null;
		v_previous_assignment_id := v_eval.active_assignment_id;
		v_effective_operation := coalesce(v_eval.normalized_payload->>'operation', null);
		v_effective_active_assignment_id := v_eval.active_assignment_id;
		v_effective_active_assignment_user_id := v_eval.active_assignment_user_id;
		v_effective_active_assignment_user_name := v_eval.active_assignment_user_name;
		v_effective_should_apply := v_eval.should_apply;
		v_effective_should_reassign := v_eval.should_reassign;
		v_effective_should_create := v_eval.should_create;
		v_effective_has_name_warning := v_eval.has_name_warning;
		v_effective_has_related_support_warning := v_eval.has_related_support_warning;

		if v_eval.result_status = 'error' then
			v_error_rows := v_error_rows + 1;
		elsif not v_eval.should_apply then
			if v_eval.result_status = 'warning' then
				v_warning_rows := v_warning_rows + 1;
			else
				v_skipped_rows := v_skipped_rows + 1;
			end if;
		else
			begin
				if v_eval.should_create then
					select *
					into v_create_result
					from public.create_beneficiary_primary_assignment(
						v_eval.beneficiary_id,
						p_target_user_id,
						'Importacion masiva de asignaciones',
						'import',
						v_run_id,
						v_run_row_id
					)
					limit 1;

					v_assignment_id := v_create_result.assignment_id;
					v_effective_operation := 'created';
					v_effective_active_assignment_id := v_create_result.assignment_id;
					v_effective_active_assignment_user_id := p_target_user_id;
					v_effective_active_assignment_user_name := coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino');
					v_effective_should_apply := true;
					v_effective_should_create := true;
					v_effective_should_reassign := false;
					if v_eval.result_status = 'warning' then
						v_warning_rows := v_warning_rows + 1;
					else
						v_created_rows := v_created_rows + 1;
					end if;
				elsif v_eval.should_reassign then
					select *
					into v_reassign_result
					from public.reassign_beneficiary_primary_assignment(
						v_eval.beneficiary_id,
						p_target_user_id,
						'Importacion masiva de asignaciones'
					)
					limit 1;

					v_previous_assignment_id := v_reassign_result.previous_assignment_id;
					v_assignment_id := v_reassign_result.new_assignment_id;
					v_effective_operation := 'reassigned';
					v_effective_active_assignment_id := v_reassign_result.new_assignment_id;
					v_effective_active_assignment_user_id := p_target_user_id;
					v_effective_active_assignment_user_name := coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino');
					v_effective_should_apply := true;
					v_effective_should_create := false;
					v_effective_should_reassign := true;

					update public.beneficiary_assignments
					set
						source = 'import',
						source_run_id = v_run_id,
						source_row_id = v_run_row_id,
						updated_by = v_requester_id,
						updated_at = now(),
						notes = concat_ws(
							E'\n\n',
							nullif(notes, ''),
							'Trazabilidad importacion: run ' || v_run_id || ', row ' || v_run_row_id
						)
					where id = v_assignment_id;

					if v_eval.result_status = 'warning' then
						v_warning_rows := v_warning_rows + 1;
					else
						v_reassigned_rows := v_reassigned_rows + 1;
					end if;
				else
					v_effective_status := 'skipped';
					v_effective_message := 'La fila no requiere cambios operacionales.';
					v_effective_operation := 'skipped';
					v_effective_should_apply := false;
					v_effective_should_create := false;
					v_effective_should_reassign := false;
					v_skipped_rows := v_skipped_rows + 1;
				end if;
			exception
				when others then
					if SQLERRM like '%ya figura como apoyo temporal activo%' then
						v_effective_status := 'error';
						v_effective_message := 'La teleoperadora destino figura como apoyo temporal activo. Cierre el apoyo antes de reasignar.';
						v_effective_operation := null;
						v_effective_should_apply := false;
						v_effective_should_create := false;
						v_effective_should_reassign := false;
					elsif SQLERRM like '%ya tiene una asignacion oficial vigente%' then
						if exists (
							select 1
							from public.beneficiary_assignments as ba
							where ba.beneficiary_id = v_eval.beneficiary_id
								and ba.assigned_user_id = p_target_user_id
								and ba.assignment_type = 'primary'
								and ba.status = 'active'
						) then
							select
								ba.id,
								ba.assigned_user_id,
								coalesce(p.full_name, p.email, 'Responsable oficial')
							into
								v_effective_active_assignment_id,
								v_effective_active_assignment_user_id,
								v_effective_active_assignment_user_name
							from public.beneficiary_assignments as ba
							join public.profiles as p
								on p.id = ba.assigned_user_id
							where ba.beneficiary_id = v_eval.beneficiary_id
								and ba.assigned_user_id = p_target_user_id
								and ba.assignment_type = 'primary'
								and ba.status = 'active'
							limit 1;

							v_effective_status := 'skipped';
							v_effective_message := 'El beneficiario ya estaba asignado a la misma teleoperadora como primary activa.';
							v_effective_operation := 'skipped';
							v_effective_should_apply := false;
							v_effective_should_create := false;
							v_effective_should_reassign := false;
						else
							v_effective_status := 'error';
							v_effective_message := SQLERRM;
						end if;
					elsif SQLERRM like '%no tiene una asignacion oficial vigente%' then
						select *
						into v_create_result
						from public.create_beneficiary_primary_assignment(
							v_eval.beneficiary_id,
							p_target_user_id,
							'Importacion masiva de asignaciones',
							'import',
							v_run_id,
							v_run_row_id
						)
						limit 1;

						v_assignment_id := v_create_result.assignment_id;
						v_effective_operation := 'created';
						v_effective_active_assignment_id := v_create_result.assignment_id;
						v_effective_active_assignment_user_id := p_target_user_id;
						v_effective_active_assignment_user_name := coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino');
						v_effective_should_apply := true;
						v_effective_should_create := true;
						v_effective_should_reassign := false;
						v_previous_assignment_id := null;
						v_effective_status := case when v_eval.result_status = 'warning' then 'warning' else 'created' end;
						v_effective_message := replace(v_eval.message, 'Se ejecutara reasignacion controlada reutilizando la logica de Fase 3.', 'Se creo una asignacion primary nueva tras detectar ausencia concurrente de primary activa.');
						if v_effective_status = 'warning' then
							v_warning_rows := v_warning_rows + 1;
						else
							v_created_rows := v_created_rows + 1;
						end if;
					else
						v_effective_status := 'error';
						v_effective_message := SQLERRM;
						v_effective_should_apply := false;
						v_effective_should_create := false;
						v_effective_should_reassign := false;
					end if;

					if v_effective_status = 'error' then
						v_error_rows := v_error_rows + 1;
					elsif v_effective_status = 'skipped' then
						v_skipped_rows := v_skipped_rows + 1;
					end if;
			end;
		end if;

		v_effective_normalized_payload := v_effective_normalized_payload || jsonb_build_object(
			'targetUserId', p_target_user_id,
			'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
			'operation', v_effective_operation,
			'reason', 'Importacion masiva de asignaciones',
			'assignmentId', v_assignment_id,
			'previousAssignmentId', v_previous_assignment_id,
			'activeAssignmentId', v_effective_active_assignment_id,
			'activeAssignmentUserId', v_effective_active_assignment_user_id,
			'activeAssignmentUserName', v_effective_active_assignment_user_name,
			'shouldApply', v_effective_should_apply,
			'shouldReassign', v_effective_should_reassign,
			'shouldCreate', v_effective_should_create,
			'hasNameWarning', v_effective_has_name_warning,
			'hasRelatedSupportWarning', v_effective_has_related_support_warning
		);

		insert into public.import_run_rows (
			id,
			import_run_id,
			row_number,
			raw_payload,
			normalized_payload,
			result_status,
			message,
			beneficiary_id,
			beneficiary_assignment_id,
			created_at
		)
		values (
			v_run_row_id,
			v_run_id,
			v_eval.row_number,
			v_eval.raw_payload,
			v_effective_normalized_payload,
			v_effective_status,
			v_effective_message,
			v_eval.beneficiary_id,
			v_assignment_id,
			v_now
		);
	end loop;

	update public.import_runs
	set
		status = case when v_error_rows > 0 then 'processed_with_errors'::public.import_run_status else 'processed'::public.import_run_status end,
		created_rows = v_created_rows,
		updated_rows = 0,
		reassigned_rows = v_reassigned_rows,
		skipped_rows = v_skipped_rows,
		warning_rows = v_warning_rows,
		error_rows = v_error_rows,
		finished_at = now(),
		metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			'executedAt', now(),
			'importType', 'assignment_import',
			'targetUserId', p_target_user_id,
			'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino')
		)
	where id = v_run_id;

	return (
		with rows as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'rowNumber', irr.row_number,
						'rawPayload', irr.raw_payload,
						'normalizedPayload', irr.normalized_payload,
						'resultStatus', irr.result_status,
						'message', irr.message,
						'beneficiaryId', irr.beneficiary_id,
						'activeAssignmentId', nullif(irr.normalized_payload->>'activeAssignmentId', ''),
						'activeAssignmentUserId', nullif(irr.normalized_payload->>'activeAssignmentUserId', ''),
						'activeAssignmentUserName', nullif(irr.normalized_payload->>'activeAssignmentUserName', ''),
						'hasNameWarning', coalesce((irr.normalized_payload->>'hasNameWarning')::boolean, false),
						'hasRelatedSupportWarning', coalesce((irr.normalized_payload->>'hasRelatedSupportWarning')::boolean, false),
						'shouldApply', coalesce((irr.normalized_payload->>'shouldApply')::boolean, false),
						'shouldReassign', coalesce((irr.normalized_payload->>'shouldReassign')::boolean, false),
						'shouldCreate', coalesce((irr.normalized_payload->>'shouldCreate')::boolean, false),
						'assignmentId', irr.beneficiary_assignment_id
					)
					order by irr.row_number
				),
				'[]'::jsonb
			) as payload
			from public.import_run_rows as irr
			where irr.import_run_id = v_run_id
		)
		select jsonb_build_object(
			'runId', v_run_id,
			'sourceFilename', v_source_filename,
			'targetUserId', p_target_user_id,
			'targetUserName', coalesce(v_target_user.full_name, v_target_user.email, 'Teleoperadora destino'),
			'status', case when v_error_rows > 0 then 'processed_with_errors' else 'processed' end,
			'summary', jsonb_build_object(
				'totalRows', jsonb_array_length(p_rows),
				'createdRows', v_created_rows,
				'reassignedRows', v_reassigned_rows,
				'skippedRows', v_skipped_rows,
				'warningRows', v_warning_rows,
				'errorRows', v_error_rows
			),
			'rows', rows.payload
		)
		from rows
	);
end;
$$;

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

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
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

create or replace function public.preview_call_log_correlation(
	p_called_at timestamptz,
	p_raw_phone text
)
returns table (
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
	v_preview_raw_call_id uuid := gen_random_uuid();
	v_preview_external_call_id text := 'preview-' || gen_random_uuid()::text;
	v_correlation record;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para previsualizar correlaciones de llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden previsualizar importaciones de llamadas';
	end if;

	insert into public.raw_call_logs (
		id,
		source,
		external_call_id,
		called_at,
		raw_phone,
		raw_payload,
		created_by
	)
	values (
		v_preview_raw_call_id,
		'amaia_net2phone_excel',
		v_preview_external_call_id,
		p_called_at,
		p_raw_phone,
		jsonb_build_object('preview', true),
		v_requester_id
	);

	select *
	into v_correlation
	from public.correlate_raw_call_log(v_preview_raw_call_id)
	limit 1;

	delete from public.raw_call_logs
	where id = v_preview_raw_call_id;

	return query
	select
		v_correlation.correlation_status,
		v_correlation.beneficiary_id,
		v_correlation.beneficiary_contact_id,
		v_correlation.assignment_id_at_call_time,
		v_correlation.responsible_user_id_at_call_time,
		v_correlation.matched_phone,
		v_correlation.match_method,
		v_correlation.confidence_score,
		v_correlation.reason;
end;
$$;

create or replace function public.evaluate_call_logs_import_rows(
	p_rows jsonb
)
returns table (
	row_number integer,
	raw_payload jsonb,
	normalized_payload jsonb,
	result_status public.import_row_result_status,
	message text,
	external_call_id text,
	called_at timestamptz,
	duration_seconds integer,
	phone_normalized text,
	correlation_status public.call_correlation_status,
	beneficiary_id uuid,
	beneficiary_contact_id uuid,
	assignment_id_at_call_time uuid,
	responsible_user_id_at_call_time uuid,
	raw_call_log_id uuid,
	correlation_id uuid,
	should_apply boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_item jsonb;
	v_index integer := 0;
	v_row_number integer;
	v_raw_payload jsonb;
	v_normalized_payload jsonb;
	v_result_status public.import_row_result_status;
	v_message_parts text[];
	v_external_call_id text;
	v_called_at timestamptz;
	v_duration_seconds integer;
	v_phone_normalized text;
	v_correlation_status public.call_correlation_status;
	v_beneficiary_id uuid;
	v_beneficiary_contact_id uuid;
	v_assignment_id_at_call_time uuid;
	v_responsible_user_id_at_call_time uuid;
	v_raw_call_log_id uuid;
	v_correlation_id uuid;
	v_should_apply boolean;
	v_existing_raw_call record;
	v_preview_correlation record;
	v_seen_external_call_ids text[] := array[]::text[];
	v_raw_phone text;
	v_duration_raw text;
	v_raw_status text;
	v_operation text;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para previsualizar importaciones de llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar llamadas';
	end if;

	for v_item in
		select value
		from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as payload(value)
	loop
		v_index := v_index + 1;
		v_raw_payload := coalesce(v_item, '{}'::jsonb);
		v_row_number := coalesce(nullif(v_raw_payload->>'rowNumber', '')::integer, v_index + 1);
		v_external_call_id := nullif(btrim(coalesce(v_raw_payload->>'id', '')), '');
		v_called_at := public.parse_call_log_called_at(v_raw_payload->'fecha');
		v_duration_raw := nullif(btrim(coalesce(v_raw_payload->>'duracion', '')), '');
		v_duration_seconds := public.parse_call_log_duration_seconds(v_duration_raw);
		v_raw_phone := nullif(btrim(coalesce(v_raw_payload->>'telefono', '')), '');
		v_phone_normalized := public.normalize_chilean_phone(v_raw_phone);
		v_raw_status := nullif(btrim(coalesce(v_raw_payload->>'estado', '')), '');
		v_correlation_status := null;
		v_beneficiary_id := null;
		v_beneficiary_contact_id := null;
		v_assignment_id_at_call_time := null;
		v_responsible_user_id_at_call_time := null;
		v_raw_call_log_id := null;
		v_correlation_id := null;
		v_should_apply := false;
		v_message_parts := array[]::text[];
		v_operation := null;

		if v_external_call_id is null then
			v_result_status := 'error';
			v_message_parts := array_append(v_message_parts, 'external_call_id es obligatorio.');
		elsif v_external_call_id = any(v_seen_external_call_ids) then
			v_result_status := 'skipped';
			v_operation := 'skipped';
			v_message_parts := array_append(v_message_parts, 'External call id duplicado dentro del archivo. Se considera solo la primera aparición.');
		elsif v_called_at is null then
			v_seen_external_call_ids := array_append(v_seen_external_call_ids, v_external_call_id);
			v_result_status := 'error';
			v_message_parts := array_append(v_message_parts, 'La fecha no pudo interpretarse como timestamptz.');
		elsif v_duration_raw is null or v_duration_seconds is null then
			v_seen_external_call_ids := array_append(v_seen_external_call_ids, v_external_call_id);
			v_result_status := 'error';
			v_message_parts := array_append(v_message_parts, 'La duracion debe venir como entero en segundos, MM:SS o HH:MM:SS.');
		else
			v_seen_external_call_ids := array_append(v_seen_external_call_ids, v_external_call_id);

			select
				rcl.id as raw_call_log_id,
				rcl.phone_normalized,
				cc.id as correlation_id,
				cc.correlation_status,
				cc.beneficiary_id,
				cc.beneficiary_contact_id,
				cc.assignment_id_at_call_time,
				cc.responsible_user_id_at_call_time
			into v_existing_raw_call
			from public.raw_call_logs as rcl
			left join public.call_correlations as cc
				on cc.raw_call_log_id = rcl.id
			where rcl.source = 'amaia_net2phone_excel'
				and rcl.external_call_id = v_external_call_id
			limit 1;

			if found then
				v_result_status := 'skipped';
				v_operation := 'skipped';
				v_raw_call_log_id := v_existing_raw_call.raw_call_log_id;
				v_correlation_id := v_existing_raw_call.correlation_id;
				v_phone_normalized := coalesce(v_existing_raw_call.phone_normalized, v_phone_normalized);
				v_correlation_status := v_existing_raw_call.correlation_status;
				v_beneficiary_id := v_existing_raw_call.beneficiary_id;
				v_beneficiary_contact_id := v_existing_raw_call.beneficiary_contact_id;
				v_assignment_id_at_call_time := v_existing_raw_call.assignment_id_at_call_time;
				v_responsible_user_id_at_call_time := v_existing_raw_call.responsible_user_id_at_call_time;
				v_message_parts := array_append(v_message_parts, 'La llamada ya existe para source amaia_net2phone_excel y external_call_id; se omitira la reimportacion.');
			else
				select *
				into v_preview_correlation
				from public.preview_call_log_correlation(v_called_at, v_raw_phone)
				limit 1;

				v_correlation_status := v_preview_correlation.correlation_status;
				v_beneficiary_id := v_preview_correlation.beneficiary_id;
				v_beneficiary_contact_id := v_preview_correlation.beneficiary_contact_id;
				v_assignment_id_at_call_time := v_preview_correlation.assignment_id_at_call_time;
				v_responsible_user_id_at_call_time := v_preview_correlation.responsible_user_id_at_call_time;
				v_phone_normalized := coalesce(v_preview_correlation.matched_phone, v_phone_normalized);
				v_should_apply := true;
				v_operation := 'created';

				if v_duration_seconds = 0 then
					v_result_status := 'warning';
					v_message_parts := array_append(v_message_parts, 'La duracion es 0 segundos; se conserva la evidencia.');
				else
					v_result_status := 'created';
				end if;

				case v_correlation_status
					when 'matched_single' then
						v_message_parts := array_append(v_message_parts, coalesce(v_preview_correlation.reason, 'La llamada se correlaciono con un beneficiario unico.'));
					when 'matched_multiple' then
						v_result_status := 'warning';
						v_message_parts := array_append(v_message_parts, coalesce(v_preview_correlation.reason, 'La llamada quedo con correlacion multiple y requiere revision futura.'));
					when 'unmatched' then
						v_result_status := 'warning';
						v_message_parts := array_append(v_message_parts, coalesce(v_preview_correlation.reason, 'La llamada se conserva sin match.'));
					when 'invalid_phone' then
						v_result_status := 'warning';
						v_message_parts := array_append(v_message_parts, coalesce(v_preview_correlation.reason, 'La llamada se conserva con telefono invalido.'));
					else
						v_message_parts := array_append(v_message_parts, 'La llamada se importara con correlacion pendiente de clasificacion.');
				end case;

				if v_raw_status is null then
					v_result_status := 'warning';
					v_message_parts := array_append(v_message_parts, 'Estado de llamada vacío. Se conserva como evidencia, pero no se usa para matching.');
				end if;
			end if;
		end if;

		v_normalized_payload := jsonb_build_object(
			'externalCallId', v_external_call_id,
			'calledAt', v_called_at,
			'phoneNormalized', v_phone_normalized,
			'durationSeconds', v_duration_seconds,
			'callType', nullif(btrim(coalesce(v_raw_payload->>'tipoLlamada', '')), ''),
			'rawStatus', v_raw_status,
			'correlationStatus', v_correlation_status,
			'beneficiaryId', v_beneficiary_id,
			'beneficiaryContactId', v_beneficiary_contact_id,
			'assignmentIdAtCallTime', v_assignment_id_at_call_time,
			'responsibleUserIdAtCallTime', v_responsible_user_id_at_call_time,
			'operation', v_operation,
			'shouldApply', v_should_apply
		);

		row_number := v_row_number;
		raw_payload := v_raw_payload;
		normalized_payload := v_normalized_payload;
		result_status := v_result_status;
		message := array_to_string(v_message_parts, ' ');
		external_call_id := v_external_call_id;
		called_at := v_called_at;
		duration_seconds := v_duration_seconds;
		phone_normalized := v_phone_normalized;
		correlation_status := v_correlation_status;
		beneficiary_id := v_beneficiary_id;
		beneficiary_contact_id := v_beneficiary_contact_id;
		assignment_id_at_call_time := v_assignment_id_at_call_time;
		responsible_user_id_at_call_time := v_responsible_user_id_at_call_time;
		raw_call_log_id := v_raw_call_log_id;
		correlation_id := v_correlation_id;
		should_apply := v_should_apply;
		return next;
	end loop;
end;
$$;