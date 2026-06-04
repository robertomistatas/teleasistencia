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
