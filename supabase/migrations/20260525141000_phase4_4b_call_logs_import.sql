-- =============================================
-- phase4_4b_call_logs_import
-- Importacion controlada de llamadas AMAIA /
-- net2phone reutilizando la correlacion 4.4A.
-- =============================================

alter table public.import_run_rows
	add column if not exists external_call_id text,
	add column if not exists raw_call_log_id uuid references public.raw_call_logs (id) on delete set null,
	add column if not exists correlation_id uuid references public.call_correlations (id) on delete set null,
	add column if not exists phone_normalized text,
	add column if not exists correlation_status public.call_correlation_status;

create index if not exists idx_import_run_rows_external_call_id
	on public.import_run_rows (external_call_id);

create index if not exists idx_import_run_rows_raw_call_log_id
	on public.import_run_rows (raw_call_log_id);

create index if not exists idx_import_run_rows_correlation_id
	on public.import_run_rows (correlation_id);

create index if not exists idx_import_run_rows_phone_normalized
	on public.import_run_rows (phone_normalized);

create index if not exists idx_import_run_rows_correlation_status
	on public.import_run_rows (correlation_status);

create or replace function public.parse_call_log_called_at(
	p_input jsonb
)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
	v_text text;
	v_numeric numeric;
	v_matches text[];
	v_year integer;
	v_month integer;
	v_day integer;
	v_hour integer;
	v_minute integer;
	v_second integer;
begin
	if p_input is null or p_input = 'null'::jsonb then
		return null;
	end if;

	if jsonb_typeof(p_input) = 'number' then
		v_numeric := (p_input #>> '{}')::numeric;
		return (timestamp '1899-12-30 00:00:00' + (v_numeric * interval '1 day')) at time zone 'America/Santiago';
	end if;

	v_text := nullif(btrim(p_input #>> '{}'), '');

	if v_text is null then
		return null;
	end if;

	if v_text ~ '^[0-9]+(\.[0-9]+)?$' then
		v_numeric := v_text::numeric;
		return (timestamp '1899-12-30 00:00:00' + (v_numeric * interval '1 day')) at time zone 'America/Santiago';
	end if;

	if v_text ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$' then
		begin
			return v_text::timestamptz;
		exception
			when others then
				return null;
		end;
	end if;

	v_matches := regexp_match(
		v_text,
		'^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$'
	);

	if v_matches is not null then
		begin
			v_year := v_matches[1]::integer;
			v_month := v_matches[2]::integer;
			v_day := v_matches[3]::integer;
			v_hour := coalesce(v_matches[4]::integer, 0);
			v_minute := coalesce(v_matches[5]::integer, 0);
			v_second := coalesce(v_matches[6]::integer, 0);

			return make_timestamp(v_year, v_month, v_day, v_hour, v_minute, v_second)
				at time zone 'America/Santiago';
		exception
			when others then
				return null;
		end;
	end if;

	v_matches := regexp_match(
		v_text,
		'^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$'
	);

	if v_matches is not null then
		begin
			v_day := v_matches[1]::integer;
			v_month := v_matches[3]::integer;
			v_year := v_matches[4]::integer;

			if char_length(v_matches[4]) = 2 then
				v_year := 2000 + v_year;
			end if;

			v_hour := coalesce(v_matches[5]::integer, 0);
			v_minute := coalesce(v_matches[6]::integer, 0);
			v_second := coalesce(v_matches[7]::integer, 0);

			return make_timestamp(v_year, v_month, v_day, v_hour, v_minute, v_second)
				at time zone 'America/Santiago';
		exception
			when others then
				return null;
		end;
	end if;

	return null;
end;
$$;

create or replace function public.parse_call_log_duration_seconds(
	p_input text
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
	v_text text := nullif(btrim(coalesce(p_input, '')), '');
	v_parts text[];
	v_hours integer;
	v_minutes integer;
	v_seconds integer;
begin
	if v_text is null then
		return null;
	end if;

	if v_text ~ '^[0-9]+$' then
		return v_text::integer;
	end if;

	v_parts := regexp_split_to_array(v_text, ':');

	if array_length(v_parts, 1) = 2
		and coalesce(v_parts[1], '') ~ '^[0-9]+$'
		and coalesce(v_parts[2], '') ~ '^[0-9]+$' then
		v_minutes := v_parts[1]::integer;
		v_seconds := v_parts[2]::integer;

		if v_seconds >= 60 then
			return null;
		end if;

		return (v_minutes * 60) + v_seconds;
	end if;

	if array_length(v_parts, 1) = 3
		and coalesce(v_parts[1], '') ~ '^[0-9]+$'
		and coalesce(v_parts[2], '') ~ '^[0-9]+$'
		and coalesce(v_parts[3], '') ~ '^[0-9]+$' then
		v_hours := v_parts[1]::integer;
		v_minutes := v_parts[2]::integer;
		v_seconds := v_parts[3]::integer;

		if v_minutes >= 60 or v_seconds >= 60 then
			return null;
		end if;

		return (v_hours * 3600) + (v_minutes * 60) + v_seconds;
	end if;

	return null;
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

	if v_requester_role not in ('admin', 'super_admin') then
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

	if v_requester_role not in ('admin', 'super_admin') then
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

create or replace function public.preview_call_logs_import(
	p_source_filename text,
	p_rows jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
	with evaluated as (
		select *
		from public.evaluate_call_logs_import_rows(p_rows)
	),
	summary as (
		select jsonb_build_object(
			'totalRows', count(*),
			'createdRows', count(*) filter (where result_status = 'created'),
			'skippedRows', count(*) filter (where result_status = 'skipped'),
			'warningRows', count(*) filter (where result_status = 'warning'),
			'errorRows', count(*) filter (where result_status = 'error'),
			'matchedSingleRows', count(*) filter (where correlation_status = 'matched_single'),
			'matchedMultipleRows', count(*) filter (where correlation_status = 'matched_multiple'),
			'unmatchedRows', count(*) filter (where correlation_status = 'unmatched'),
			'invalidPhoneRows', count(*) filter (where correlation_status = 'invalid_phone')
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
					'status', result_status,
					'message', message,
					'externalCallId', external_call_id,
					'calledAt', called_at,
					'rawPhone', nullif(btrim(coalesce(raw_payload->>'telefono', '')), ''),
					'durationSeconds', duration_seconds,
					'rawStatus', nullif(btrim(coalesce(raw_payload->>'estado', '')), ''),
					'phoneNormalized', phone_normalized,
					'correlationStatus', correlation_status,
					'beneficiaryId', beneficiary_id,
					'beneficiaryName', b.full_name,
					'beneficiaryContactId', beneficiary_contact_id,
					'assignmentIdAtCallTime', assignment_id_at_call_time,
					'responsibleUserIdAtCallTime', responsible_user_id_at_call_time,
					'operation', nullif(normalized_payload->>'operation', ''),
					'rawCallLogId', raw_call_log_id,
					'correlationId', correlation_id,
					'shouldApply', should_apply
				)
				order by row_number
			),
			'[]'::jsonb
		) as payload
		from evaluated
		left join public.beneficiaries as b
			on b.id = evaluated.beneficiary_id
	)
	select jsonb_build_object(
		'sourceFilename', nullif(btrim(coalesce(p_source_filename, '')), ''),
		'summary', summary.payload,
		'rows', rows.payload
	)
	from summary, rows;
$$;

create or replace function public.execute_call_logs_import(
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
	v_source_filename text := nullif(btrim(coalesce(p_source_filename, '')), '');
	v_eval record;
	v_raw_call record;
	v_correlation record;
	v_effective_status public.import_row_result_status;
	v_effective_message text;
	v_effective_normalized_payload jsonb;
	v_effective_phone_normalized text;
	v_effective_correlation_status public.call_correlation_status;
	v_effective_beneficiary_id uuid;
	v_effective_beneficiary_contact_id uuid;
	v_effective_assignment_id uuid;
	v_effective_responsible_user_id uuid;
	v_effective_raw_call_log_id uuid;
	v_effective_correlation_id uuid;
	v_created_rows integer := 0;
	v_skipped_rows integer := 0;
	v_warning_rows integer := 0;
	v_error_rows integer := 0;
	v_matched_single_rows integer := 0;
	v_matched_multiple_rows integer := 0;
	v_unmatched_rows integer := 0;
	v_invalid_phone_rows integer := 0;
	v_existing_raw_call record;
	v_has_empty_raw_status boolean;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar importaciones de llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar llamadas';
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
		'call_logs_import',
		v_source_filename,
		'processing',
		jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
		jsonb_build_object('previewedAt', v_now, 'source', 'amaia_net2phone_excel')
	);

	for v_eval in
		select *
		from public.evaluate_call_logs_import_rows(p_rows)
	loop
		v_effective_status := v_eval.result_status;
		v_effective_message := v_eval.message;
		v_effective_normalized_payload := coalesce(v_eval.normalized_payload, '{}'::jsonb);
		v_effective_phone_normalized := v_eval.phone_normalized;
		v_effective_correlation_status := v_eval.correlation_status;
		v_effective_beneficiary_id := v_eval.beneficiary_id;
		v_effective_beneficiary_contact_id := v_eval.beneficiary_contact_id;
		v_effective_assignment_id := v_eval.assignment_id_at_call_time;
		v_effective_responsible_user_id := v_eval.responsible_user_id_at_call_time;
		v_effective_raw_call_log_id := v_eval.raw_call_log_id;
		v_effective_correlation_id := v_eval.correlation_id;
		v_has_empty_raw_status := nullif(btrim(coalesce(v_eval.raw_payload->>'estado', '')), '') is null;

		if v_eval.result_status = 'error' then
			v_error_rows := v_error_rows + 1;
		elsif not v_eval.should_apply then
			v_skipped_rows := v_skipped_rows + 1;
		else
			begin
				insert into public.raw_call_logs (
					source,
					external_call_id,
					called_at,
					raw_phone,
					call_type,
					raw_status,
					duration_seconds,
					raw_beneficiary_label,
					raw_observations,
					raw_payload,
					created_by
				)
				values (
					'amaia_net2phone_excel',
					v_eval.external_call_id,
					v_eval.called_at,
					nullif(btrim(coalesce(v_eval.raw_payload->>'telefono', '')), ''),
					nullif(btrim(coalesce(v_eval.raw_payload->>'tipoLlamada', '')), ''),
					nullif(btrim(coalesce(v_eval.raw_payload->>'estado', '')), ''),
					v_eval.duration_seconds,
					nullif(btrim(coalesce(v_eval.raw_payload->>'beneficiario', '')), ''),
					nullif(btrim(coalesce(v_eval.raw_payload->>'observaciones', '')), ''),
					v_eval.raw_payload,
					v_requester_id
				)
				returning id, phone_normalized
				into v_raw_call;

				select *
				into v_correlation
				from public.correlate_raw_call_log(v_raw_call.id)
				limit 1;

				v_effective_raw_call_log_id := v_raw_call.id;
				v_effective_correlation_id := v_correlation.correlation_id;
				v_effective_phone_normalized := coalesce(v_raw_call.phone_normalized, v_correlation.matched_phone, v_effective_phone_normalized);
				v_effective_correlation_status := v_correlation.correlation_status;
				v_effective_beneficiary_id := v_correlation.beneficiary_id;
				v_effective_beneficiary_contact_id := v_correlation.beneficiary_contact_id;
				v_effective_assignment_id := v_correlation.assignment_id_at_call_time;
				v_effective_responsible_user_id := v_correlation.responsible_user_id_at_call_time;
				v_effective_normalized_payload := jsonb_set(
					jsonb_set(
						jsonb_set(
							coalesce(v_effective_normalized_payload, '{}'::jsonb),
							'{phoneNormalized}',
							coalesce(to_jsonb(v_effective_phone_normalized), 'null'::jsonb),
							true
						),
						'{correlationStatus}',
						coalesce(to_jsonb(v_effective_correlation_status), 'null'::jsonb),
						true
					),
					'{shouldApply}',
					'true'::jsonb,
					true
				);

				if v_eval.duration_seconds = 0
					or v_has_empty_raw_status
					or v_effective_correlation_status in ('matched_multiple', 'unmatched', 'invalid_phone') then
					v_effective_status := 'warning';
					v_warning_rows := v_warning_rows + 1;
				else
					v_effective_status := 'created';
					v_created_rows := v_created_rows + 1;
				end if;

				v_effective_message := v_correlation.reason;
				if v_eval.duration_seconds = 0 then
					v_effective_message := concat_ws(' ', v_effective_message, 'La duracion es 0 segundos; se conserva la evidencia.');
				end if;
				if v_has_empty_raw_status then
					v_effective_message := concat_ws(' ', v_effective_message, 'Estado de llamada vacío. Se conserva como evidencia, pero no se usa para matching.');
				end if;
			exception
				when unique_violation then
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
						and rcl.external_call_id = v_eval.external_call_id
					limit 1;

					v_effective_status := 'skipped';
					v_effective_message := 'La llamada ya existia al momento de ejecutar la importacion; se omitio la recreacion.';
					v_effective_raw_call_log_id := v_existing_raw_call.raw_call_log_id;
					v_effective_correlation_id := v_existing_raw_call.correlation_id;
					v_effective_phone_normalized := coalesce(v_existing_raw_call.phone_normalized, v_effective_phone_normalized);
					v_effective_correlation_status := v_existing_raw_call.correlation_status;
					v_effective_beneficiary_id := v_existing_raw_call.beneficiary_id;
					v_effective_beneficiary_contact_id := v_existing_raw_call.beneficiary_contact_id;
					v_effective_assignment_id := v_existing_raw_call.assignment_id_at_call_time;
					v_effective_responsible_user_id := v_existing_raw_call.responsible_user_id_at_call_time;
					v_effective_normalized_payload := jsonb_set(
						jsonb_set(
							coalesce(v_effective_normalized_payload, '{}'::jsonb),
							'{operation}',
							to_jsonb('skipped'::text),
							true
						),
						'{shouldApply}',
						'false'::jsonb,
						true
					);
					v_skipped_rows := v_skipped_rows + 1;
			end;
		end if;

		case v_effective_correlation_status
			when 'matched_single' then
				v_matched_single_rows := v_matched_single_rows + 1;
			when 'matched_multiple' then
				v_matched_multiple_rows := v_matched_multiple_rows + 1;
			when 'unmatched' then
				v_unmatched_rows := v_unmatched_rows + 1;
			when 'invalid_phone' then
				v_invalid_phone_rows := v_invalid_phone_rows + 1;
			else
				null;
		end case;

		insert into public.import_run_rows (
			import_run_id,
			row_number,
			raw_payload,
			normalized_payload,
			result_status,
			message,
			beneficiary_id,
			beneficiary_contact_id,
			external_call_id,
			raw_call_log_id,
			correlation_id,
			phone_normalized,
			correlation_status,
			created_at
		)
		values (
			v_run_id,
			v_eval.row_number,
			v_eval.raw_payload,
			v_effective_normalized_payload,
			v_effective_status,
			v_effective_message,
			v_effective_beneficiary_id,
			v_effective_beneficiary_contact_id,
			v_eval.external_call_id,
			v_effective_raw_call_log_id,
			v_effective_correlation_id,
			v_effective_phone_normalized,
			v_effective_correlation_status,
			v_now
		);
	end loop;

	update public.import_runs
	set
		status = case when v_error_rows > 0 then 'processed_with_errors'::public.import_run_status else 'processed'::public.import_run_status end,
		created_rows = v_created_rows,
		updated_rows = 0,
		skipped_rows = v_skipped_rows,
		warning_rows = v_warning_rows,
		error_rows = v_error_rows,
		finished_at = now(),
		metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			'executedAt', now(),
			'importType', 'call_logs_import',
			'source', 'amaia_net2phone_excel',
			'matchedSingleRows', v_matched_single_rows,
			'matchedMultipleRows', v_matched_multiple_rows,
			'unmatchedRows', v_unmatched_rows,
			'invalidPhoneRows', v_invalid_phone_rows
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
						   'status', irr.result_status,
						   'message', irr.message,
						   'externalCallId', irr.external_call_id,
						   'calledAt', nullif(irr.normalized_payload->>'calledAt', ''),
						   'rawPhone', nullif(btrim(coalesce(irr.raw_payload->>'telefono', '')), ''),
						   'durationSeconds', case
							   when jsonb_typeof(irr.normalized_payload->'durationSeconds') = 'number'
								   then irr.normalized_payload->'durationSeconds'
							   else 'null'::jsonb
						   end,
						   'rawStatus', nullif(btrim(coalesce(irr.raw_payload->>'estado', '')), ''),
						   'rawCallLogId', irr.raw_call_log_id,
						   'correlationId', irr.correlation_id,
						   'phoneNormalized', irr.phone_normalized,
						   'correlationStatus', irr.correlation_status,
						   'beneficiaryId', irr.beneficiary_id,
						   'beneficiaryName', b.full_name,
						   'beneficiaryContactId', irr.beneficiary_contact_id,
						   'assignmentIdAtCallTime', nullif(irr.normalized_payload->>'assignmentIdAtCallTime', ''),
						   'responsibleUserIdAtCallTime', nullif(irr.normalized_payload->>'responsibleUserIdAtCallTime', ''),
						   'operation', nullif(irr.normalized_payload->>'operation', ''),
						   'shouldApply', case
							   when nullif(irr.normalized_payload->>'shouldApply', '') is null then false
							   else (irr.normalized_payload->>'shouldApply')::boolean
						   end
					   )
					   order by irr.row_number
				   ),
				   '[]'::jsonb
			   ) as payload
			   from public.import_run_rows as irr
			   left join public.beneficiaries as b on b.id = irr.beneficiary_id
			   where irr.import_run_id = v_run_id
		   ),
		summary as (
			select jsonb_build_object(
				'totalRows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
				'createdRows', v_created_rows,
				'skippedRows', v_skipped_rows,
				'warningRows', v_warning_rows,
				'errorRows', v_error_rows,
				'matchedSingleRows', v_matched_single_rows,
				'matchedMultipleRows', v_matched_multiple_rows,
				'unmatchedRows', v_unmatched_rows,
				'invalidPhoneRows', v_invalid_phone_rows
			) as payload
		)
		select jsonb_build_object(
			'runId', v_run_id,
			'sourceFilename', v_source_filename,
			'status', case when v_error_rows > 0 then 'processed_with_errors' else 'processed' end,
			'summary', summary.payload,
			'rows', rows.payload
		)
		from rows, summary
	);
end;
$$;

comment on function public.parse_call_log_called_at(jsonb)
	is 'Parsea fechas de Excel como serial o texto y normaliza a UTC asumiendo America/Santiago cuando no hay zona horaria explicita.';

comment on function public.parse_call_log_duration_seconds(text)
	is 'Parsea duraciones en segundos, MM:SS o HH:MM:SS para importaciones de llamadas.';

comment on function public.preview_call_log_correlation(timestamptz, text)
	is 'Reutiliza la correlacion 4.4A sobre una llamada efimera para previsualizar el resultado sin persistir registros.';

comment on function public.evaluate_call_logs_import_rows(jsonb)
	is 'Evalua filas de importacion de llamadas reutilizando parseo canonico e idempotencia por source + external_call_id.';

comment on function public.preview_call_logs_import(text, jsonb)
	is 'Devuelve una previsualizacion no persistente del import Excel de llamadas AMAIA / net2phone.';

comment on function public.execute_call_logs_import(text, jsonb)
	is 'Ejecuta la importacion de llamadas AMAIA / net2phone, persiste raw_call_logs, correlaciona y registra auditoria por corrida y fila.';

revoke all on function public.parse_call_log_called_at(jsonb) from public;
revoke all on function public.parse_call_log_duration_seconds(text) from public;
revoke all on function public.preview_call_log_correlation(timestamptz, text) from public;
revoke all on function public.evaluate_call_logs_import_rows(jsonb) from public;
revoke all on function public.preview_call_logs_import(text, jsonb) from public;
revoke all on function public.execute_call_logs_import(text, jsonb) from public;

grant execute on function public.preview_call_logs_import(text, jsonb) to authenticated;
grant execute on function public.execute_call_logs_import(text, jsonb) to authenticated;