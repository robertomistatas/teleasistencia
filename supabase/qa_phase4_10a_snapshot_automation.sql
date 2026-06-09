begin;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table qa_snapshot_automation_results (
	test_name text primary key,
	status text not null,
	details jsonb not null default '{}'::jsonb
) on commit drop;

do $$
declare
	v_super_admin_id uuid := '4600f0f9-d2cb-4bc0-9a54-6ab1253bad1a';
	v_known_teleoperadora_id uuid := '9405c7c7-6f02-47bf-9f4d-9659ed2eafd2';
	v_inactive_admin_id uuid := '63a214b3-b060-4916-8539-1ed0e896ebed';
	v_nonexistent_user_id uuid := '00000000-0000-0000-0000-000000000000';
	v_active_admin_id uuid;
	v_active_teleoperadora_id uuid;
	v_missing_count integer;
	v_job_id uuid;
	v_job_key text := 'qa-phase4-10a-' || replace(gen_random_uuid()::text, '-', '');
	v_job_status_rows integer;
	v_history_rows integer;
	v_global_rows integer;
	v_distinct_global_rows integer;
	v_operator_rows integer;
	v_distinct_operator_rows integer;
	v_failed_runs integer;
	v_payload jsonb;
	v_history_payload record;
	v_target_date date := current_date + 45;
begin
	select p.id
	into v_active_admin_id
	from public.profiles as p
	where p.role = 'admin'
		and p.is_active = true
	order by p.created_at asc
	limit 1;

	select p.id
	into v_active_teleoperadora_id
	from public.profiles as p
	where p.role = 'teleoperadora'
		and p.is_active = true
	order by case when p.id = v_known_teleoperadora_id then 0 else 1 end, p.created_at asc
	limit 1;

	select count(*)
	into v_missing_count
	from (
		select 'snapshot_jobs' as artifact_name, 'table' as artifact_kind
		union all select 'snapshot_job_runs', 'table'
	) as expected
	where not exists (
		select 1
		from pg_class as c
		join pg_namespace as n on n.oid = c.relnamespace
		where n.nspname = 'public'
			and c.relname = expected.artifact_name
			and expected.artifact_kind = 'table'
			and c.relkind = 'r'
	);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'artifacts_tables_exist',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('missingCount', v_missing_count)
	);

	select count(*)
	into v_missing_count
	from (
		select 'snapshot_job_cadence' as artifact_name
		union all select 'snapshot_job_run_type'
		union all select 'snapshot_job_run_status'
	) as expected
	where to_regtype('public.' || expected.artifact_name) is null;

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'artifacts_enums_exist',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('missingCount', v_missing_count)
	);

	select count(*)
	into v_missing_count
	from (
		select 'create_snapshot_job' as function_name, 'text, text, public.snapshot_job_cadence, integer, integer, jsonb, jsonb, boolean' as signature
		union all select 'run_snapshot_job', 'uuid, date, integer, public.snapshot_job_run_type, jsonb'
		union all select 'run_daily_snapshot_now', 'date, integer, public.snapshot_job_run_type, jsonb'
		union all select 'get_snapshot_job_history', 'uuid, integer'
		union all select 'get_snapshot_job_status', 'uuid'
	) as expected
	where to_regprocedure(
		'public.' || expected.function_name || '(' || expected.signature || ')'
	) is null;

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'artifacts_rpcs_exist',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('missingCount', v_missing_count)
	);

	perform set_config('request.jwt.claim.sub', coalesce(v_active_admin_id, v_super_admin_id)::text, true);

	v_job_id := public.create_snapshot_job(
		v_job_key,
		'QA Snapshot Automation Job',
		'daily'::public.snapshot_job_cadence,
		7,
		0,
		jsonb_build_object('timezone', 'America/Santiago', 'hour', 6),
		jsonb_build_object('createdByQa', true),
		true
	);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'create_snapshot_job_admin_allowed',
		case when v_job_id is not null then 'passed' else 'failed' end,
		jsonb_build_object('jobId', v_job_id, 'jobKey', v_job_key)
	);

	select count(*)
	into v_job_status_rows
	from public.get_snapshot_job_status(v_job_id);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'get_snapshot_job_status_before_run_visible',
		case when v_job_status_rows = 1 then 'passed' else 'failed' end,
		jsonb_build_object('rowCount', v_job_status_rows)
	);

	v_payload := public.run_snapshot_job(
		v_job_id,
		v_target_date,
		7,
		'scheduled'::public.snapshot_job_run_type,
		jsonb_build_object('qaRun', 'first')
	);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'run_snapshot_job_scheduled_success',
		case when coalesce(v_payload->>'status', '') = 'succeeded' then 'passed' else 'failed' end,
		jsonb_build_object('payload', v_payload)
	);

	v_payload := public.run_snapshot_job(
		v_job_id,
		v_target_date,
		7,
		'scheduled'::public.snapshot_job_run_type,
		jsonb_build_object('qaRun', 'second')
	);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'run_snapshot_job_rerun_consistent',
		case
			when coalesce(v_payload->>'status', '') = 'succeeded'
				and coalesce((v_payload->>'snapshotsCreated')::integer, -1) = 0
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('payload', v_payload)
	);

	select count(*)
	into v_global_rows
	from public.kpi_daily_snapshots
	where snapshot_date = v_target_date
		and scope_type = 'global'::public.kpi_snapshot_scope;

	select count(distinct snapshot_date::text || ':' || scope_type::text)
	into v_distinct_global_rows
	from public.kpi_daily_snapshots
	where snapshot_date = v_target_date
		and scope_type = 'global'::public.kpi_snapshot_scope;

	select count(*)
	into v_operator_rows
	from public.kpi_daily_snapshots
	where snapshot_date = v_target_date
		and scope_type = 'operator'::public.kpi_snapshot_scope;

	select count(distinct snapshot_date::text || ':' || scope_type::text || ':' || operator_profile_id::text)
	into v_distinct_operator_rows
	from public.kpi_daily_snapshots
	where snapshot_date = v_target_date
		and scope_type = 'operator'::public.kpi_snapshot_scope;

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'snapshots_unique_per_scope_date',
		case
			when v_global_rows = v_distinct_global_rows
				and v_operator_rows = v_distinct_operator_rows
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object(
			'globalRows', v_global_rows,
			'distinctGlobalRows', v_distinct_global_rows,
			'operatorRows', v_operator_rows,
			'distinctOperatorRows', v_distinct_operator_rows,
			'targetDate', v_target_date
		)
	);

	select count(*)
	into v_history_rows
	from public.get_snapshot_job_history(v_job_id, 10);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'get_snapshot_job_history_visible_after_runs',
		case when v_history_rows >= 2 then 'passed' else 'failed' end,
		jsonb_build_object('rowCount', v_history_rows)
	);

	select *
	into v_history_payload
	from public.get_snapshot_job_history(v_job_id, 1)
	limit 1;

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'run_metadata_timestamps_and_status_persisted',
		case
			when v_history_payload.status = 'succeeded'::public.snapshot_job_run_status
				and v_history_payload.started_at is not null
				and v_history_payload.finished_at is not null
				and v_history_payload.duration_ms is not null
				and v_history_payload.duration_ms >= 0
				and coalesce(v_history_payload.snapshots_updated, -1) >= 0
				and jsonb_typeof(v_history_payload.metadata) = 'object'
				and v_history_payload.metadata ? 'request'
				and v_history_payload.metadata ? 'result'
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object(
			'status', v_history_payload.status,
			'startedAt', v_history_payload.started_at,
			'finishedAt', v_history_payload.finished_at,
			'durationMs', v_history_payload.duration_ms,
			'metadata', v_history_payload.metadata
		)
	);

	v_payload := public.run_daily_snapshot_now(
		v_target_date + 1,
		7,
		'manual'::public.snapshot_job_run_type,
		jsonb_build_object('qaRun', 'manual')
	);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'run_daily_snapshot_now_manual_success',
		case when coalesce(v_payload->>'status', '') = 'succeeded' then 'passed' else 'failed' end,
		jsonb_build_object('payload', v_payload)
	);

	v_payload := public.run_daily_snapshot_now(
		v_target_date + 2,
		0,
		'manual'::public.snapshot_job_run_type,
		jsonb_build_object('qaRun', 'controlled_failure')
	);

	select count(*)
	into v_failed_runs
	from public.snapshot_job_runs
	where job_id is null
		and target_date = v_target_date + 2
		and status = 'failed'::public.snapshot_job_run_status;

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'controlled_failure_persisted_without_crashing',
		case
			when coalesce(v_payload->>'status', '') = 'failed'
				and v_failed_runs = 1
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('payload', v_payload, 'failedRuns', v_failed_runs)
	);

	select count(*)
	into v_job_status_rows
	from public.v_kpi_daily_snapshot_history
	where snapshot_date in (v_target_date, v_target_date + 1);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'v_kpi_daily_snapshot_history_still_consultable',
		case when v_job_status_rows > 0 then 'passed' else 'failed' end,
		jsonb_build_object('historyRows', v_job_status_rows)
	);

	select public.get_executive_metrics_summary(current_date, 30, 30)
	into v_payload;

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'get_executive_metrics_summary_not_regressed',
		case when v_payload is not null and v_payload ? 'current' and v_payload ? 'history' and v_payload ? 'slaRisk' then 'passed' else 'failed' end,
		jsonb_build_object('keys', jsonb_build_array(v_payload ? 'current', v_payload ? 'history', v_payload ? 'slaRisk'))
	);

	select count(*)
	into v_job_status_rows
	from public.get_executive_metrics_history(30);

	insert into qa_snapshot_automation_results (test_name, status, details)
	values (
		'get_executive_metrics_history_not_regressed',
		case when v_job_status_rows >= 0 then 'passed' else 'failed' end,
		jsonb_build_object('rowCount', v_job_status_rows)
	);

	if v_active_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_active_teleoperadora_id::text, true);

		begin
			perform public.create_snapshot_job(
				v_job_key || '-teleop',
				'Teleop denied',
				'daily'::public.snapshot_job_cadence,
				7,
				0,
				'{}'::jsonb,
				'{}'::jsonb,
				true
			);
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_create_snapshot_job_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_create_snapshot_job_denied', 'passed', jsonb_build_object('message', sqlerrm));
		end;

		begin
			perform public.run_daily_snapshot_now(current_date, 7, 'manual'::public.snapshot_job_run_type, '{}'::jsonb);
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_run_snapshot_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_run_snapshot_denied', 'passed', jsonb_build_object('message', sqlerrm));
		end;

		begin
			perform public.get_snapshot_job_history(null, 5);
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_history_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_history_denied', 'passed', jsonb_build_object('message', sqlerrm));
		end;

		begin
			perform public.get_snapshot_job_status(null);
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_status_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_snapshot_automation_results (test_name, status, details)
			values ('teleoperadora_status_denied', 'passed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_snapshot_automation_results (test_name, status, details)
		values
			('teleoperadora_create_snapshot_job_denied', 'skipped', jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')),
			('teleoperadora_run_snapshot_denied', 'skipped', jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')),
			('teleoperadora_history_denied', 'skipped', jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')),
			('teleoperadora_status_denied', 'skipped', jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno'));
	end if;

	perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);

	begin
		perform public.run_daily_snapshot_now(current_date, 7, 'manual'::public.snapshot_job_run_type, '{}'::jsonb);
		insert into qa_snapshot_automation_results (test_name, status, details)
		values ('inactive_admin_snapshot_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_snapshot_automation_results (test_name, status, details)
		values ('inactive_admin_snapshot_denied', 'passed', jsonb_build_object('message', sqlerrm));
	end;

	perform set_config('request.jwt.claim.sub', v_nonexistent_user_id::text, true);

	begin
		perform public.get_snapshot_job_status(null);
		insert into qa_snapshot_automation_results (test_name, status, details)
		values ('null_role_snapshot_status_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_snapshot_automation_results (test_name, status, details)
		values ('null_role_snapshot_status_denied', 'passed', jsonb_build_object('message', sqlerrm));
	end;
end;
$$;

select
	test_name,
	status,
	details
from qa_snapshot_automation_results
order by test_name;

select jsonb_build_object(
	'total_tests', count(*)::integer,
	'passed_tests', count(*) filter (where status = 'passed')::integer,
	'failed_tests', count(*) filter (where status = 'failed')::integer,
	'skipped_tests', count(*) filter (where status = 'skipped')::integer
) as qa_summary
from qa_snapshot_automation_results;

rollback;
