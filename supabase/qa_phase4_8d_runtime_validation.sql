begin;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table qa_runtime_results (
	section text not null,
	payload jsonb not null
) on commit drop;

create temp table qa_runtime_runs (
	label text primary key,
	run_id uuid,
	payload jsonb
) on commit drop;

do $$
declare
	v_super_admin_id uuid := '4600f0f9-d2cb-4bc0-9a54-6ab1253bad1a';
	v_teleoperadora_id uuid := '9405c7c7-6f02-47bf-9f4d-9659ed2eafd2';
	v_inactive_admin_id uuid := '63a214b3-b060-4916-8539-1ed0e896ebed';
	v_nonexistent_user_id uuid := '00000000-0000-0000-0000-000000000000';
	v_active_admin_count integer;
	v_run_tag text := to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSMS');
	v_source_filename text;
	v_rows jsonb;
	v_preview jsonb;
	v_execute_first jsonb;
	v_execute_second jsonb;
	v_followup_first jsonb;
	v_followup_second jsonb;
	v_first_run_id uuid;
	v_second_run_id uuid;
	v_monitoring jsonb;
	v_detail jsonb;
	v_issue_count integer;
begin
	select count(*)
	into v_active_admin_count
	from public.profiles
	where role = 'admin'
		and is_active = true;

	insert into qa_runtime_results (section, payload)
	values (
		'environment_admin_availability',
		jsonb_build_object(
			'activeAdminCount', v_active_admin_count,
			'note', case when v_active_admin_count = 0 then 'No hay admin activo en la base enlazada; la validacion allow para admin queda bloqueada por entorno.' else 'Hay admin activo disponible.' end
		)
	);

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
	select public.get_call_import_monitoring_summary(3)
	into v_monitoring;
	insert into qa_runtime_results (section, payload)
	values (
		'permissions_super_admin_monitoring',
		jsonb_build_object('status', 'allowed', 'summary', v_monitoring->'summary')
	);

	perform set_config('request.jwt.claim.sub', v_teleoperadora_id::text, true);
	begin
		perform public.get_call_import_monitoring_summary(3);
		insert into qa_runtime_results (section, payload)
		values ('permissions_teleoperadora_monitoring', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_runtime_results (section, payload)
		values ('permissions_teleoperadora_monitoring', jsonb_build_object('status', 'denied', 'message', sqlerrm));
	end;

	begin
		perform public.preview_call_logs_import('qa_permission_probe.json', '[]'::jsonb);
		insert into qa_runtime_results (section, payload)
		values ('permissions_teleoperadora_preview_import', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_runtime_results (section, payload)
		values ('permissions_teleoperadora_preview_import', jsonb_build_object('status', 'denied', 'message', sqlerrm));
	end;

	perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
	begin
		perform public.get_call_import_monitoring_summary(3);
		insert into qa_runtime_results (section, payload)
		values ('permissions_inactive_admin_monitoring', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_runtime_results (section, payload)
		values ('permissions_inactive_admin_monitoring', jsonb_build_object('status', 'denied', 'message', sqlerrm));
	end;

	perform set_config('request.jwt.claim.sub', v_nonexistent_user_id::text, true);
	begin
		perform public.get_call_import_monitoring_summary(3);
		insert into qa_runtime_results (section, payload)
		values ('permissions_nonexistent_user_monitoring', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_runtime_results (section, payload)
		values ('permissions_nonexistent_user_monitoring', jsonb_build_object('status', 'denied', 'message', sqlerrm));
	end;

	v_source_filename := 'qa_phase4_8d_runtime_' || v_run_tag || '.json';
	v_rows := jsonb_build_array(
		jsonb_build_object(
			'rowNumber', 2,
			'id', 'qa48d-' || v_run_tag || '-matched-single',
			'fecha', '2026-06-02 10:00:00',
			'duracion', '00:45',
			'telefono', '999999999',
			'estado', 'Contestada',
			'tipoLlamada', 'Saliente',
			'beneficiario', 'QA 4.8D matched single',
			'observaciones', 'matched single'
		),
		jsonb_build_object(
			'rowNumber', 3,
			'id', 'qa48d-' || v_run_tag || '-assignment-not-found',
			'fecha', '2026-06-02 10:05:00',
			'duracion', '00:30',
			'telefono', '+56 951438143',
			'estado', 'Contestada',
			'tipoLlamada', 'Saliente',
			'beneficiario', 'QA 4.8D assignment not found',
			'observaciones', 'assignment not found'
		),
		jsonb_build_object(
			'rowNumber', 4,
			'id', 'qa48d-' || v_run_tag || '-assignment-inactive',
			'fecha', '2026-06-02 10:10:00',
			'duracion', '00:30',
			'telefono', '+56911111111',
			'estado', 'Contestada',
			'tipoLlamada', 'Saliente',
			'beneficiario', 'QA 4.8D assignment inactive',
			'observaciones', 'assignment inactive'
		),
		jsonb_build_object(
			'rowNumber', 5,
			'id', 'qa48d-' || v_run_tag || '-ambiguous',
			'fecha', '2026-06-02 10:15:00',
			'duracion', '00:20',
			'telefono', '+56 9 4444 4444',
			'estado', 'Contestada',
			'tipoLlamada', 'Saliente',
			'beneficiario', 'QA 4.8D ambiguous',
			'observaciones', 'ambiguous'
		),
		jsonb_build_object(
			'rowNumber', 6,
			'id', 'qa48d-' || v_run_tag || '-phone-not-matched',
			'fecha', '2026-06-02 10:20:00',
			'duracion', '00:18',
			'telefono', '+56 9 5555 1212',
			'estado', 'Contestada',
			'tipoLlamada', 'Saliente',
			'beneficiario', 'QA 4.8D unmatched',
			'observaciones', 'phone not matched'
		),
		jsonb_build_object(
			'rowNumber', 7,
			'id', 'qa48d-' || v_run_tag || '-invalid-phone',
			'fecha', '2026-06-02 10:25:00',
			'duracion', '00:10',
			'telefono', 'abc',
			'estado', 'Contestada',
			'tipoLlamada', 'Saliente',
			'beneficiario', 'QA 4.8D invalid phone',
			'observaciones', 'invalid phone'
		)
	);

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
	select public.preview_call_logs_import(v_source_filename, v_rows)
	into v_preview;
	insert into qa_runtime_results (section, payload)
	values ('preview_summary', v_preview->'summary');

	select public.execute_call_logs_import(v_source_filename, v_rows)
	into v_execute_first;
	v_first_run_id := (v_execute_first->>'runId')::uuid;
	insert into qa_runtime_runs (label, run_id, payload)
	values ('first', v_first_run_id, v_execute_first);
	insert into qa_runtime_results (section, payload)
	values ('execute_first_summary', v_execute_first->'summary');

	select public.get_call_import_detail(v_first_run_id)
	into v_detail;
	insert into qa_runtime_results (section, payload)
	values (
		'execute_first_detail_counts',
		jsonb_build_object(
			'errors', jsonb_array_length(coalesce(v_detail->'errors', '[]'::jsonb)),
			'warnings', jsonb_array_length(coalesce(v_detail->'warnings', '[]'::jsonb))
		)
	);

	select count(*)
	into v_issue_count
	from public.get_call_import_correlation_issues(v_first_run_id);
	insert into qa_runtime_results (section, payload)
	values ('execute_first_issue_count', jsonb_build_object('count', v_issue_count));

	select public.generate_follow_up_events_from_call_logs(
		'amaia_net2phone_excel',
		500,
		array(
			select irr.raw_call_log_id
			from public.import_run_rows as irr
			where irr.import_run_id = v_first_run_id
				and irr.raw_call_log_id is not null
		)
	)
	into v_followup_first;
	insert into qa_runtime_results (section, payload)
	values ('followup_first_summary', v_followup_first);

	select public.execute_call_logs_import(v_source_filename, v_rows)
	into v_execute_second;
	v_second_run_id := (v_execute_second->>'runId')::uuid;
	insert into qa_runtime_runs (label, run_id, payload)
	values ('second', v_second_run_id, v_execute_second);
	insert into qa_runtime_results (section, payload)
	values ('execute_second_summary', v_execute_second->'summary');

	select public.generate_follow_up_events_from_call_logs(
		'amaia_net2phone_excel',
		500,
		array(
			select irr.raw_call_log_id
			from public.import_run_rows as irr
			where irr.import_run_id = v_first_run_id
				and irr.raw_call_log_id is not null
		)
	)
	into v_followup_second;
	insert into qa_runtime_results (section, payload)
	values ('followup_second_summary', v_followup_second);
end;
$$;

select
	section,
	payload
from qa_runtime_results
order by section;

select
	'first_run_issue_breakdown' as section,
	jsonb_agg(
		jsonb_build_object(
			'issueType', issue_type,
			'count', issue_count
		)
		order by issue_type
	) as payload
from (
	select issue_type::text as issue_type, count(*)::integer as issue_count
	from public.get_call_import_correlation_issues((select run_id from qa_runtime_runs where label = 'first'))
	group by issue_type
) as issues;

select
	'first_run_row_status_breakdown' as section,
	jsonb_agg(
		jsonb_build_object(
			'resultStatus', result_status,
			'correlationStatus', correlation_status,
			'count', row_count
		)
		order by result_status, correlation_status
	) as payload
from (
	select
		irr.result_status::text as result_status,
		coalesce(irr.correlation_status::text, 'null') as correlation_status,
		count(*)::integer as row_count
	from public.import_run_rows as irr
	where irr.import_run_id = (select run_id from qa_runtime_runs where label = 'first')
	group by irr.result_status::text, coalesce(irr.correlation_status::text, 'null')
) as row_status;

select
	'first_run_error_breakdown' as section,
	coalesce(
		jsonb_agg(
			jsonb_build_object(
				'severity', severity,
				'errorCode', error_code,
				'count', item_count
			)
			order by severity, error_code
		),
		'[]'::jsonb
	) as payload
from (
	select severity::text as severity, error_code, count(*)::integer as item_count
	from public.import_job_errors
	where import_job_id = (select run_id from qa_runtime_runs where label = 'first')
	group by severity::text, error_code
) as error_items;

select
	'first_run_persistence_counts' as section,
	jsonb_build_object(
		'rawCallLogs', (
			select count(*)::integer
			from public.import_run_rows
			where import_run_id = (select run_id from qa_runtime_runs where label = 'first')
				and raw_call_log_id is not null
		),
		'followupEvents', (
			select count(*)::integer
			from public.followup_events as fe
			where fe.call_log_id = any(
				array(
					select irr.raw_call_log_id
					from public.import_run_rows as irr
					where irr.import_run_id = (select run_id from qa_runtime_runs where label = 'first')
						and irr.raw_call_log_id is not null
				)
			)
		),
		'callInteractions', (
			select count(*)::integer
			from public.call_interactions as ci
			where ci.phone_normalized = any(
				array(
					select distinct irr.phone_normalized
					from public.import_run_rows as irr
					where irr.import_run_id = (select run_id from qa_runtime_runs where label = 'first')
						and irr.phone_normalized is not null
				)
			)
		)
	) as payload;

select
	'run_payloads' as section,
	jsonb_agg(
		jsonb_build_object(
			'label', label,
			'runId', run_id,
			'summary', payload->'summary'
		)
		order by label
	) as payload
from qa_runtime_runs;

rollback;
