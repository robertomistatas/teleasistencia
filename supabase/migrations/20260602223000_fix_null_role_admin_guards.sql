create or replace function public.preview_call_logs_import(
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
begin
	if v_requester_id is null then
		raise exception 'No autorizado para previsualizar importaciones de llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden previsualizar importaciones de llamadas';
	end if;

	return (
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
		from summary, rows
	);
end;
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
	v_processed_rows integer := 0;
	v_valid_rows integer := 0;
	v_invalid_rows integer := 0;
	v_correlated_rows integer := 0;
	v_uncorrelated_rows integer := 0;
	v_matched_single_rows integer := 0;
	v_matched_multiple_rows integer := 0;
	v_unmatched_rows integer := 0;
	v_invalid_phone_rows integer := 0;
	v_existing_raw_call record;
	v_has_empty_raw_status boolean;
	v_import_run_row_id uuid;
	v_issue_type public.call_log_correlation_issue_type;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar importaciones de llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
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
		source_type,
		status,
		started_at,
		total_rows,
		processed_rows,
		valid_rows,
		invalid_rows,
		correlated_rows,
		uncorrelated_rows,
		metadata
	)
	values (
		v_run_id,
		v_requester_id,
		'call_logs_import',
		v_source_filename,
		'amaia_net2phone_excel',
		'processing',
		v_now,
		jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
		0,
		0,
		0,
		0,
		0,
		jsonb_build_object('previewedAt', v_now, 'source', 'amaia_net2phone_excel')
	);

	for v_eval in
		select *
		from public.evaluate_call_logs_import_rows(p_rows)
	loop
		v_processed_rows := v_processed_rows + 1;
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
			v_invalid_rows := v_invalid_rows + 1;
		elsif not v_eval.should_apply then
			v_skipped_rows := v_skipped_rows + 1;
			v_valid_rows := v_valid_rows + 1;
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
					v_effective_message := concat_ws(' ', v_effective_message, 'Estado de llamada vacio. Se conserva como evidencia, pero no se usa para matching.');
				end if;

				v_valid_rows := v_valid_rows + 1;
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
					v_valid_rows := v_valid_rows + 1;
			end;
		end if;

		case v_effective_correlation_status
			when 'matched_single' then
				v_matched_single_rows := v_matched_single_rows + 1;
				v_correlated_rows := v_correlated_rows + 1;
			when 'matched_multiple' then
				v_matched_multiple_rows := v_matched_multiple_rows + 1;
				v_uncorrelated_rows := v_uncorrelated_rows + 1;
			when 'unmatched' then
				v_unmatched_rows := v_unmatched_rows + 1;
				v_uncorrelated_rows := v_uncorrelated_rows + 1;
			when 'invalid_phone' then
				v_invalid_phone_rows := v_invalid_phone_rows + 1;
				v_uncorrelated_rows := v_uncorrelated_rows + 1;
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
		)
		returning id into v_import_run_row_id;

		v_issue_type := public.classify_call_log_correlation_issue(
			v_effective_status,
			v_effective_correlation_status,
			v_effective_beneficiary_id,
			v_effective_assignment_id,
			v_effective_responsible_user_id,
			v_effective_message
		);

		if v_effective_status in ('warning', 'error') then
			insert into public.import_job_errors (
				import_job_id,
				import_run_row_id,
				row_number,
				severity,
				error_code,
				message,
				details,
				created_at
			)
			values (
				v_run_id,
				v_import_run_row_id,
				v_eval.row_number,
				case when v_effective_status = 'error' then 'error' else 'warning' end,
				coalesce(v_issue_type::text, case when v_effective_status = 'error' then 'invalid_call_data' else 'unknown' end),
				v_effective_message,
				jsonb_build_object(
					'externalCallId', v_eval.external_call_id,
					'correlationStatus', v_effective_correlation_status,
					'rawCallLogId', v_effective_raw_call_log_id,
					'correlationId', v_effective_correlation_id,
					'phoneNormalized', v_effective_phone_normalized
				),
				v_now
			);
		end if;

		if v_issue_type is not null then
			insert into public.call_log_correlation_issues (
				import_job_id,
				import_run_row_id,
				row_number,
				raw_call_log_id,
				correlation_id,
				issue_type,
				external_call_id,
				phone_normalized,
				beneficiary_id,
				beneficiary_contact_id,
				assignment_id_at_call_time,
				responsible_user_id_at_call_time,
				issue_message,
				details,
				created_at
			)
			values (
				v_run_id,
				v_import_run_row_id,
				v_eval.row_number,
				v_effective_raw_call_log_id,
				v_effective_correlation_id,
				v_issue_type,
				v_eval.external_call_id,
				v_effective_phone_normalized,
				v_effective_beneficiary_id,
				v_effective_beneficiary_contact_id,
				v_effective_assignment_id,
				v_effective_responsible_user_id,
				v_effective_message,
				jsonb_build_object(
					'resultStatus', v_effective_status,
					'correlationStatus', v_effective_correlation_status,
					'normalizedPayload', v_effective_normalized_payload
				),
				v_now
			);
		end if;
	end loop;

	update public.import_runs
	set
		status = case when v_error_rows > 0 then 'processed_with_errors'::public.import_run_status else 'processed'::public.import_run_status end,
		created_rows = v_created_rows,
		updated_rows = 0,
		skipped_rows = v_skipped_rows,
		warning_rows = v_warning_rows,
		error_rows = v_error_rows,
		processed_rows = v_processed_rows,
		valid_rows = v_valid_rows,
		invalid_rows = v_invalid_rows,
		correlated_rows = v_correlated_rows,
		uncorrelated_rows = v_uncorrelated_rows,
		finished_at = now(),
		metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			'executedAt', now(),
			'importType', 'call_logs_import',
			'source', 'amaia_net2phone_excel',
			'matchedSingleRows', v_matched_single_rows,
			'matchedMultipleRows', v_matched_multiple_rows,
			'unmatchedRows', v_unmatched_rows,
			'invalidPhoneRows', v_invalid_phone_rows,
			'processedRows', v_processed_rows,
			'validRows', v_valid_rows,
			'invalidRows', v_invalid_rows,
			'correlatedRows', v_correlated_rows,
			'uncorrelatedRows', v_uncorrelated_rows
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
				'processedRows', v_processed_rows,
				'validRows', v_valid_rows,
				'invalidRows', v_invalid_rows,
				'correlatedRows', v_correlated_rows,
				'uncorrelatedRows', v_uncorrelated_rows,
				'matchedSingleRows', v_matched_single_rows,
				'matchedMultipleRows', v_matched_multiple_rows,
				'unmatchedRows', v_unmatched_rows,
				'invalidPhoneRows', v_invalid_phone_rows
			) as payload
		)
		select jsonb_build_object(
			'runId', v_run_id,
			'sourceFilename', v_source_filename,
			'sourceType', 'amaia_net2phone_excel',
			'startedAt', v_now,
			'status', case when v_error_rows > 0 then 'processed_with_errors' else 'processed' end,
			'summary', summary.payload,
			'rows', rows.payload
		)
		from rows, summary
	);
end;
$$;

create or replace function public.get_call_import_monitoring_summary(
	p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar monitoreo de imports';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar monitoreo de imports';
	end if;

	return (
		with scoped_runs as (
			select ir.*,
				p.full_name as imported_by_name,
				p.email as imported_by_email
			from public.import_runs as ir
			left join public.profiles as p
				on p.id = ir.created_by
			where ir.import_type = 'call_logs_import'
		),
		summary as (
			select jsonb_build_object(
				'totalImports', count(*)::integer,
				'successfulImports', count(*) filter (where status = 'processed' and error_rows = 0)::integer,
				'importsWithErrors', count(*) filter (where status in ('processed_with_errors', 'failed') or error_rows > 0)::integer,
				'correlationRate', round(
					coalesce((sum(correlated_rows)::numeric / nullif(sum(valid_rows), 0)) * 100, 0),
					2
				)
			) as payload
			from scoped_runs
		),
		runs as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'id', id,
						'sourceType', source_type,
						'filename', source_filename,
						'importedBy', created_by,
						'importedByName', imported_by_name,
						'importedByEmail', imported_by_email,
						'status', status,
						'startedAt', started_at,
						'finishedAt', finished_at,
						'totalRows', total_rows,
						'processedRows', processed_rows,
						'validRows', valid_rows,
						'invalidRows', invalid_rows,
						'correlatedRows', correlated_rows,
						'uncorrelatedRows', uncorrelated_rows,
						'warningCount', warning_rows,
						'errorCount', error_rows,
						'metadata', metadata,
						'createdAt', created_at
					)
					order by created_at desc
				),
				'[]'::jsonb
			) as payload
			from (
				select *
				from scoped_runs
				order by created_at desc
				limit greatest(coalesce(p_limit, 20), 1)
			) as limited_runs
		)
		select jsonb_build_object(
			'summary', summary.payload,
			'imports', runs.payload
		)
		from summary, runs
	);
end;
$$;

create or replace function public.get_call_import_detail(
	p_import_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar detalle de imports';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar detalle de imports';
	end if;

	return (
		with selected_run as (
			select ir.*,
				p.full_name as imported_by_name,
				p.email as imported_by_email
			from public.import_runs as ir
			left join public.profiles as p
				on p.id = ir.created_by
			where ir.id = p_import_run_id
				and ir.import_type = 'call_logs_import'
		),
		job as (
			select jsonb_build_object(
				'id', id,
				'sourceType', source_type,
				'filename', source_filename,
				'importedBy', created_by,
				'importedByName', imported_by_name,
				'importedByEmail', imported_by_email,
				'status', status,
				'startedAt', started_at,
				'finishedAt', finished_at,
				'totalRows', total_rows,
				'processedRows', processed_rows,
				'validRows', valid_rows,
				'invalidRows', invalid_rows,
				'correlatedRows', correlated_rows,
				'uncorrelatedRows', uncorrelated_rows,
				'warningCount', warning_rows,
				'errorCount', error_rows,
				'metadata', metadata,
				'createdAt', created_at
			) as payload
			from selected_run
		),
		errors as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'id', e.id,
						'rowNumber', e.row_number,
						'severity', e.severity,
						'errorCode', e.error_code,
						'message', e.message,
						'details', e.details,
						'createdAt', e.created_at
					)
					order by e.row_number nulls last, e.created_at asc
				),
				'[]'::jsonb
			) as payload
			from public.import_job_errors as e
			where e.import_job_id = p_import_run_id
				and e.severity = 'error'
		),
		warnings as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'id', e.id,
						'rowNumber', e.row_number,
						'severity', e.severity,
						'errorCode', e.error_code,
						'message', e.message,
						'details', e.details,
						'createdAt', e.created_at
					)
					order by e.row_number nulls last, e.created_at asc
				),
				'[]'::jsonb
			) as payload
			from public.import_job_errors as e
			where e.import_job_id = p_import_run_id
				and e.severity = 'warning'
		)
		select jsonb_build_object(
			'job', coalesce(job.payload, '{}'::jsonb),
			'errors', errors.payload,
			'warnings', warnings.payload
		)
		from job, errors, warnings
	);
end;
$$;

create or replace function public.get_call_import_correlation_issues(
	p_import_run_id uuid
)
returns table (
	id uuid,
	row_number integer,
	issue_type public.call_log_correlation_issue_type,
	issue_message text,
	external_call_id text,
	phone_normalized text,
	beneficiary_id uuid,
	beneficiary_name text,
	assignment_id_at_call_time uuid,
	responsible_user_id_at_call_time uuid,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar diagnostico de correlacion';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar diagnostico de correlacion';
	end if;

	return query
	select
		issue.id,
		issue.row_number,
		issue.issue_type,
		issue.issue_message,
		issue.external_call_id,
		issue.phone_normalized,
		issue.beneficiary_id,
		b.full_name,
		issue.assignment_id_at_call_time,
		issue.responsible_user_id_at_call_time,
		issue.created_at
	from public.call_log_correlation_issues as issue
	left join public.beneficiaries as b
		on b.id = issue.beneficiary_id
	where issue.import_job_id = p_import_run_id
	order by issue.row_number nulls last, issue.created_at asc;
end;
$$;

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

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
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