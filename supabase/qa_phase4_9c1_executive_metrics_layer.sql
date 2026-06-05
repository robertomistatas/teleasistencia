begin;

create temporary table qa_exec_results (
	test_name text primary key,
	status text not null check (status in ('passed', 'failed', 'skipped')),
	details jsonb not null default '{}'::jsonb
);

do $$
declare
	v_super_admin_id uuid;
	v_admin_id uuid;
	v_inactive_admin_id uuid;
	v_teleoperadora_id uuid;
	v_nonexistent_user_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
	v_snapshot_date date := current_date;
	v_summary jsonb;
	v_history_rows integer := 0;
	v_min_date date;
	v_max_date date;
	v_summary_available boolean := false;
	v_summary_enough boolean := false;
	v_def text;
begin
	select id
	into v_super_admin_id
	from public.profiles
	where role = 'super_admin'
		and is_active = true
	order by created_at asc
	limit 1;

	select id
	into v_admin_id
	from public.profiles
	where role = 'admin'
		and is_active = true
	order by created_at asc
	limit 1;

	select id
	into v_inactive_admin_id
	from public.profiles
	where role = 'admin'
		and is_active = false
	order by created_at asc
	limit 1;

	select id
	into v_teleoperadora_id
	from public.profiles
	where role = 'teleoperadora'
		and is_active = true
	order by created_at asc
	limit 1;

	insert into qa_exec_results (test_name, status, details)
	select
		'functions_exist',
		case when count(procedure_ref) = 2 then 'passed' else 'failed' end,
		jsonb_build_object('foundFunctions', count(procedure_ref))
	from (
		select to_regprocedure('public.get_executive_metrics_summary(date,integer,integer)') as procedure_ref
		union all
		select to_regprocedure('public.get_executive_metrics_history(integer)') as procedure_ref
	) as required_functions;

	select lower(pg_get_functiondef(to_regprocedure('public.get_executive_metrics_summary(date,integer,integer)')))
	into v_def;

	insert into qa_exec_results (test_name, status, details)
	values (
		'get_executive_metrics_summary_fail_closed_guard',
		case
			when v_def like '%coalesce(v_requester_role::text, '''') not in (''admin'', ''super_admin'')%'
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('guardFound', v_def like '%coalesce(v_requester_role::text, '''') not in (''admin'', ''super_admin'')%')
	);

	select lower(pg_get_functiondef(to_regprocedure('public.get_executive_metrics_history(integer)')))
	into v_def;

	insert into qa_exec_results (test_name, status, details)
	values (
		'get_executive_metrics_history_fail_closed_guard',
		case
			when v_def like '%coalesce(v_requester_role::text, '''') not in (''admin'', ''super_admin'')%'
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('guardFound', v_def like '%coalesce(v_requester_role::text, '''') not in (''admin'', ''super_admin'')%')
	);

	if v_super_admin_id is not null then
		perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);

		perform public.capture_kpi_daily_snapshot(v_snapshot_date - 1, 7);
		perform public.capture_kpi_daily_snapshot(v_snapshot_date, 7);

		select public.get_executive_metrics_summary(v_snapshot_date, 30, 7)
		into v_summary;

		insert into qa_exec_results (test_name, status, details)
		values (
			'get_executive_metrics_summary_super_admin_allowed',
			case
				when v_summary ? 'current'
					and v_summary ? 'history'
					and (v_summary->'current') ? 'effectiveCoverage'
					and (v_summary->'current') ? 'correlationRate'
				then 'passed'
				else 'failed'
			end,
			jsonb_build_object('summary', v_summary)
		);

		select
			coalesce((v_summary->'history'->>'available')::boolean, false),
			coalesce((v_summary->'history'->>'enoughForTrend')::boolean, false)
		into v_summary_available, v_summary_enough;

		insert into qa_exec_results (test_name, status, details)
		values (
			'get_executive_metrics_summary_history_semantics',
			case when v_summary_available = true and v_summary_enough = true then 'passed' else 'failed' end,
			jsonb_build_object('history', v_summary->'history')
		);

		select
			count(*)::integer,
			min(snapshot_date),
			max(snapshot_date)
		into v_history_rows, v_min_date, v_max_date
		from public.get_executive_metrics_history(7);

		insert into qa_exec_results (test_name, status, details)
		values (
			'get_executive_metrics_history_reads_global_snapshots',
			case when v_history_rows >= 2 then 'passed' else 'failed' end,
			jsonb_build_object('historyRows', v_history_rows, 'minDate', v_min_date, 'maxDate', v_max_date)
		);
	else
		insert into qa_exec_results (test_name, status, details)
		values (
			'get_executive_metrics_summary_super_admin_allowed',
			'skipped',
			jsonb_build_object('reason', 'No hay super_admin activo disponible en el entorno')
		);

		insert into qa_exec_results (test_name, status, details)
		values (
			'get_executive_metrics_summary_history_semantics',
			'skipped',
			jsonb_build_object('reason', 'No hay super_admin activo disponible en el entorno')
		);

		insert into qa_exec_results (test_name, status, details)
		values (
			'get_executive_metrics_history_reads_global_snapshots',
			'skipped',
			jsonb_build_object('reason', 'No hay super_admin activo disponible en el entorno')
		);
	end if;

	if v_admin_id is not null then
		perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
		begin
			perform public.get_executive_metrics_summary(current_date, 30, 30);
			perform public.get_executive_metrics_history(30);
			insert into qa_exec_results (test_name, status, details)
			values ('admin_allowed_executive_layer', 'passed', jsonb_build_object('adminId', v_admin_id));
		exception when others then
			insert into qa_exec_results (test_name, status, details)
			values ('admin_allowed_executive_layer', 'failed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_exec_results (test_name, status, details)
		values (
			'admin_allowed_executive_layer',
			'skipped',
			jsonb_build_object('reason', 'No hay admin activo disponible en el entorno')
		);
	end if;

	if v_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_teleoperadora_id::text, true);
		begin
			perform public.get_executive_metrics_summary(current_date, 30, 30);
			insert into qa_exec_results (test_name, status, details)
			values ('teleoperadora_denied_executive_summary', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_exec_results (test_name, status, details)
			values ('teleoperadora_denied_executive_summary', 'passed', jsonb_build_object('message', sqlerrm));
		end;

		begin
			perform public.get_executive_metrics_history(30);
			insert into qa_exec_results (test_name, status, details)
			values ('teleoperadora_denied_executive_history', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_exec_results (test_name, status, details)
			values ('teleoperadora_denied_executive_history', 'passed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_exec_results (test_name, status, details)
		values (
			'teleoperadora_denied_executive_summary',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);

		insert into qa_exec_results (test_name, status, details)
		values (
			'teleoperadora_denied_executive_history',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);
	end if;

	if v_inactive_admin_id is not null then
		perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
		begin
			perform public.get_executive_metrics_summary(current_date, 30, 30);
			insert into qa_exec_results (test_name, status, details)
			values ('inactive_admin_denied_executive_summary', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_exec_results (test_name, status, details)
			values ('inactive_admin_denied_executive_summary', 'passed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_exec_results (test_name, status, details)
		values (
			'inactive_admin_denied_executive_summary',
			'skipped',
			jsonb_build_object('reason', 'No hay admin inactivo disponible en el entorno')
		);
	end if;

	perform set_config('request.jwt.claim.sub', v_nonexistent_user_id::text, true);
	begin
		perform public.get_executive_metrics_history(30);
		insert into qa_exec_results (test_name, status, details)
		values ('null_role_denied_executive_history', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_exec_results (test_name, status, details)
		values ('null_role_denied_executive_history', 'passed', jsonb_build_object('message', sqlerrm));
	end;
end;
$$;

select
	test_name,
	status,
	details
from qa_exec_results
order by test_name;

select jsonb_build_object(
	'total_tests', count(*)::integer,
	'passed_tests', count(*) filter (where status = 'passed')::integer,
	'failed_tests', count(*) filter (where status = 'failed')::integer,
	'skipped_tests', count(*) filter (where status = 'skipped')::integer
) as qa_summary
from qa_exec_results;

rollback;
