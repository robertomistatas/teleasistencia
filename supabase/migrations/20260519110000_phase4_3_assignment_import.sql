-- =============================================
-- phase4_3_assignment_import
-- Importacion masiva controlada de asignaciones
-- reutilizando la logica operacional de Fase 3.
-- =============================================

alter table public.import_runs
	add column if not exists reassigned_rows integer not null default 0 check (reassigned_rows >= 0);

alter table public.import_run_rows
	add column if not exists beneficiary_assignment_id uuid references public.beneficiary_assignments (id) on delete set null;

create index if not exists idx_import_run_rows_beneficiary_assignment_id
	on public.import_run_rows (beneficiary_assignment_id);

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

	if v_requester_role not in ('admin', 'super_admin') then
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

	if v_requester_role not in ('admin', 'super_admin') then
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

create or replace function public.preview_assignment_import(
	p_source_filename text,
	p_target_user_id uuid,
	p_rows jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
	with evaluated as (
		select *
		from public.evaluate_assignment_import_rows(p_target_user_id, p_rows)
	),
	summary as (
		select jsonb_build_object(
			'totalRows', count(*),
			'createdRows', count(*) filter (where result_status = 'created'),
			'reassignedRows', count(*) filter (where result_status = 'reassigned'),
			'skippedRows', count(*) filter (where result_status = 'skipped'),
			'warningRows', count(*) filter (where result_status = 'warning'),
			'errorRows', count(*) filter (where result_status = 'error')
		) as payload
		from evaluated
	),
	rows as (
		select coalesce(
			jsonb_agg(
				jsonb_build_object(
					'rowNumber', row_number,
					'rawPayload', raw_payload,
					'normalizedPayload', normalized_payload,
					'resultStatus', result_status,
					'message', message,
					'beneficiaryId', beneficiary_id,
					'activeAssignmentId', active_assignment_id,
					'activeAssignmentUserId', active_assignment_user_id,
					'activeAssignmentUserName', active_assignment_user_name,
					'hasNameWarning', has_name_warning,
					'hasRelatedSupportWarning', has_related_support_warning,
					'shouldApply', should_apply,
					'shouldReassign', should_reassign,
					'shouldCreate', should_create
				)
				order by row_number
			),
			'[]'::jsonb
		) as payload
		from evaluated
	)
	select jsonb_build_object(
		'sourceFilename', nullif(btrim(coalesce(p_source_filename, '')), ''),
		'targetUserId', p_target_user_id,
		'summary', summary.payload,
		'rows', rows.payload
	)
	from summary, rows;
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

	if v_requester_role not in ('admin', 'super_admin') then
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

comment on function public.create_beneficiary_primary_assignment(uuid, uuid, text, public.beneficiary_assignment_source, uuid, uuid)
	is 'Crea la asignacion primary inicial con validaciones operacionales y trazabilidad opcional.';

comment on function public.evaluate_assignment_import_rows(uuid, jsonb)
	is 'Evalua las filas del import de asignaciones usando match canonico por RUT y reglas de Fase 3 sin persistir cambios.';

comment on function public.preview_assignment_import(text, uuid, jsonb)
	is 'Devuelve una previsualizacion no persistente del import masivo de asignaciones.';

comment on function public.execute_assignment_import(text, uuid, jsonb)
	is 'Ejecuta la importacion masiva de asignaciones reutilizando la logica operacional de Fase 3 y registrando auditoria por corrida y fila.';

revoke all on function public.create_beneficiary_primary_assignment(uuid, uuid, text, public.beneficiary_assignment_source, uuid, uuid) from public;
revoke all on function public.evaluate_assignment_import_rows(uuid, jsonb) from public;
revoke all on function public.preview_assignment_import(text, uuid, jsonb) from public;
revoke all on function public.execute_assignment_import(text, uuid, jsonb) from public;

grant execute on function public.create_beneficiary_primary_assignment(uuid, uuid, text, public.beneficiary_assignment_source, uuid, uuid) to authenticated;
grant execute on function public.preview_assignment_import(text, uuid, jsonb) to authenticated;
grant execute on function public.execute_assignment_import(text, uuid, jsonb) to authenticated;