begin;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table qa_kpi_results (
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
	v_zero_activity_teleoperadora_id uuid;
	v_empty_portfolio_teleoperadora_id uuid;
	v_summary jsonb;
	v_import_quality jsonb;
	v_cache_rows integer;
	v_before_global integer;
	v_after_first_global integer;
	v_after_second_global integer;
	v_history_rows integer;
	v_operator_rows integer;
	v_operator_rows_seen integer;
	v_operator_other_rows integer;
	v_overdue_rows integer;
	v_payload jsonb;
	v_missing_count integer;
	v_raw_call_logs_direct_refs integer;
	v_snapshot_date date := current_date + 30;
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

	select p.id
	into v_zero_activity_teleoperadora_id
	from public.profiles as p
	where p.role = 'teleoperadora'
		and p.is_active = true
		and not exists (
			select 1
			from public.followup_events as fe
			where coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id) = p.id
				and fe.event_type <> 'internal_note'
				and coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at) >= date_trunc('day', now()) - interval '30 days'
		)
	order by p.created_at asc
	limit 1;

	select p.id
	into v_empty_portfolio_teleoperadora_id
	from public.profiles as p
	where p.role = 'teleoperadora'
		and p.is_active = true
		and not exists (
			select 1
			from public.beneficiary_assignments as ba
			join public.beneficiaries as b
				on b.id = ba.beneficiary_id
			where ba.assigned_user_id = p.id
				and ba.status = 'active'
				and ba.starts_at <= now()
				and (ba.ends_at is null or ba.ends_at >= now())
				and b.status = 'active'
		)
	order by p.created_at asc
	limit 1;

	select count(*)
	into v_missing_count
	from (
		select 'v_operational_kpi_beneficiary_runtime' as artifact_name, 'view' as artifact_kind
		union all select 'v_operational_kpi_summary_runtime', 'view'
		union all select 'v_operator_kpi_summary_runtime', 'view'
		union all select 'v_import_quality_kpi_runtime', 'view'
		union all select 'v_kpi_daily_snapshot_history', 'view'
		union all select 'kpi_daily_snapshots', 'table'
		union all select 'operational_metrics_cache', 'matview'
	) as expected
	where not exists (
		select 1
		from pg_class as c
		join pg_namespace as n on n.oid = c.relnamespace
		where n.nspname = 'public'
			and c.relname = expected.artifact_name
			and (
				(expected.artifact_kind = 'view' and c.relkind = 'v')
				or (expected.artifact_kind = 'table' and c.relkind = 'r')
				or (expected.artifact_kind = 'matview' and c.relkind = 'm')
			)
	);

	insert into qa_kpi_results (test_name, status, details)
	values (
		'artifacts_relations_exist',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('missingCount', v_missing_count)
	);

	select count(*)
	into v_missing_count
	from (
		select 'get_operational_kpi_summary' as function_name, 'date, integer' as signature
		union all select 'get_operator_kpi_summary', 'date, integer'
		union all select 'get_import_quality_kpis', 'integer'
		union all select 'get_overdue_beneficiaries', 'integer'
		union all select 'capture_kpi_daily_snapshot', 'date, integer'
		union all select 'refresh_operational_metrics_cache', ''
	) as expected
	where to_regprocedure(
		'public.' || expected.function_name || '(' || expected.signature || ')'
	) is null;

	insert into qa_kpi_results (test_name, status, details)
	values (
		'artifacts_rpcs_exist',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('missingCount', v_missing_count)
	);

	insert into qa_kpi_results (test_name, status, details)
	values (
		'artifacts_enum_exists',
		case when to_regtype('public.kpi_snapshot_scope') is not null then 'passed' else 'failed' end,
		jsonb_build_object('enumName', 'kpi_snapshot_scope')
	);

	with definitions as (
		select lower(pg_get_viewdef(to_regclass('public.v_import_quality_kpi_runtime'), true)) as definition
		where to_regclass('public.v_import_quality_kpi_runtime') is not null
		union all
		select lower(pg_get_functiondef(to_regprocedure('public.get_import_quality_kpis(integer)')))
		where to_regprocedure('public.get_import_quality_kpis(integer)') is not null
	)
	select count(*)
	into v_raw_call_logs_direct_refs
	from definitions
	where definition like '%from public.raw_call_logs%'
		or definition like '%join public.raw_call_logs%';

	insert into qa_kpi_results (test_name, status, details)
	values (
		'import_kpi_not_raw_call_logs_direct',
		case when v_raw_call_logs_direct_refs = 0 then 'passed' else 'failed' end,
		jsonb_build_object('directRawCallLogsReferences', v_raw_call_logs_direct_refs)
	);

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);

	select public.get_operational_kpi_summary(current_date, 30)
	into v_summary;

	insert into qa_kpi_results (test_name, status, details)
	values (
		'operational_summary_formula_sanity',
		case
			when coalesce((v_summary->>'totalBeneficiaries')::integer, -1) >= 0
				and coalesce((v_summary->>'effectiveCoverage')::numeric, -1) between 0 and 100
				and coalesce((v_summary->>'pendingCoverage')::numeric, -1) between 0 and 100
				and coalesce((v_summary->>'overdueCoverage')::numeric, -1) between 0 and 100
				and coalesce((v_summary->>'urgentCoverage')::numeric, -1) between 0 and 100
				and coalesce((v_summary->>'effectiveContactRate')::numeric, -1) between 0 and 100
				and coalesce((v_summary->>'totalBeneficiaries')::integer, 0) >= coalesce((v_summary->>'effectiveBeneficiaries')::integer, 0)
				and coalesce((v_summary->>'totalBeneficiaries')::integer, 0) >= coalesce((v_summary->>'pendingBeneficiaries')::integer, 0)
				and coalesce((v_summary->>'totalBeneficiaries')::integer, 0) >= coalesce((v_summary->>'overdueBeneficiaries')::integer, 0)
				and coalesce((v_summary->>'overdueBeneficiaries')::integer, 0) >= coalesce((v_summary->>'urgentBeneficiaries')::integer, 0)
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('summary', v_summary)
	);

	insert into qa_kpi_results (test_name, status, details)
	values (
		'operational_summary_no_dangerous_nulls',
		case
			when v_summary ? 'totalBeneficiaries'
				and v_summary ? 'effectiveCoverage'
				and v_summary ? 'pendingCoverage'
				and v_summary ? 'overdueCoverage'
				and v_summary ? 'urgentCoverage'
				and v_summary ? 'successfulFollowups'
				and v_summary ? 'failedFollowups'
				and v_summary ? 'effectiveContactRate'
				and jsonb_typeof(v_summary->'totalBeneficiaries') <> 'null'
				and jsonb_typeof(v_summary->'effectiveCoverage') <> 'null'
				and jsonb_typeof(v_summary->'pendingCoverage') <> 'null'
				and jsonb_typeof(v_summary->'overdueCoverage') <> 'null'
				and jsonb_typeof(v_summary->'urgentCoverage') <> 'null'
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('summary', v_summary)
	);

	insert into qa_kpi_results (test_name, status, details)
	select
		'beneficiary_runtime_semantics',
		case
			when count(*) filter (
				where coverage_state = 'sin_contacto'::public.follow_up_coverage_state
					and aging_days is not null
			) = 0
				and count(*) filter (
					where coverage_state in ('urgente'::public.follow_up_coverage_state, 'sin_contacto'::public.follow_up_coverage_state)
						and stale_beneficiary is distinct from true
				) = 0
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object(
			'sinContactoWithAgingDays', count(*) filter (
				where coverage_state = 'sin_contacto'::public.follow_up_coverage_state
					and aging_days is not null
			),
			'staleMismatchCount', count(*) filter (
				where coverage_state in ('urgente'::public.follow_up_coverage_state, 'sin_contacto'::public.follow_up_coverage_state)
					and stale_beneficiary is distinct from true
			)
		)
	from public.v_operational_kpi_beneficiary_runtime;

	perform set_config('request.jwt.claim.sub', coalesce(v_active_admin_id, v_super_admin_id)::text, true);
	select public.get_operational_kpi_summary(current_date, 30)
	into v_payload;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_operational_kpi_summary_admin_or_super_admin',
		'passed',
		jsonb_build_object('scope', v_payload->>'scope', 'referenceDate', v_payload->>'referenceDate')
	);

	if v_active_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_active_teleoperadora_id::text, true);
		select public.get_operational_kpi_summary(current_date, 30)
		into v_payload;
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operational_kpi_summary_teleoperadora_scope',
			case when coalesce(v_payload->>'scope', '') = 'own_portfolio' then 'passed' else 'failed' end,
			jsonb_build_object('scope', v_payload->>'scope', 'teleoperadoraId', v_active_teleoperadora_id)
		);
	else
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operational_kpi_summary_teleoperadora_scope',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);
	end if;

	if v_empty_portfolio_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_empty_portfolio_teleoperadora_id::text, true);
		select public.get_operational_kpi_summary(current_date, 30)
		into v_payload;
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operational_kpi_summary_empty_scope_zero_payload',
			case
				when v_payload is not null
					and coalesce(v_payload->>'scope', '') = 'own_portfolio'
					and coalesce((v_payload->>'totalBeneficiaries')::integer, -1) = 0
					and coalesce((v_payload->>'effectiveBeneficiaries')::integer, -1) = 0
					and coalesce((v_payload->>'pendingBeneficiaries')::integer, -1) = 0
					and coalesce((v_payload->>'overdueBeneficiaries')::integer, -1) = 0
					and coalesce((v_payload->>'urgentBeneficiaries')::integer, -1) = 0
					and coalesce((v_payload->>'staleBeneficiaries')::integer, -1) = 0
					and coalesce((v_payload->>'successfulFollowups')::integer, -1) = 0
					and coalesce((v_payload->>'failedFollowups')::integer, -1) = 0
					and coalesce((v_payload->>'effectiveCoverage')::numeric, -1) = 0
					and coalesce((v_payload->>'pendingCoverage')::numeric, -1) = 0
					and coalesce((v_payload->>'overdueCoverage')::numeric, -1) = 0
					and coalesce((v_payload->>'urgentCoverage')::numeric, -1) = 0
					and coalesce((v_payload->>'avgAgingDays')::numeric, -1) = 0
					and coalesce((v_payload->>'avgOverdueDays')::numeric, -1) = 0
					and coalesce((v_payload->>'effectiveContactRate')::numeric, -1) = 0
				then 'passed'
				else 'failed'
			end,
			jsonb_build_object('teleoperadoraId', v_empty_portfolio_teleoperadora_id, 'payload', v_payload)
		);
	else
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operational_kpi_summary_empty_scope_zero_payload',
			'skipped',
			jsonb_build_object('reason', 'No se encontro teleoperadora activa con cartera visible vacia en el entorno')
		);
	end if;

	perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
	begin
		perform public.get_operational_kpi_summary(current_date, 30);
		insert into qa_kpi_results (test_name, status, details)
		values ('get_operational_kpi_summary_inactive_admin_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_kpi_results (test_name, status, details)
		values ('get_operational_kpi_summary_inactive_admin_denied', 'passed', jsonb_build_object('message', sqlerrm));
	end;

	perform set_config('request.jwt.claim.sub', v_nonexistent_user_id::text, true);
	begin
		perform public.get_operational_kpi_summary(current_date, 30);
		insert into qa_kpi_results (test_name, status, details)
		values ('get_operational_kpi_summary_null_role_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_kpi_results (test_name, status, details)
		values ('get_operational_kpi_summary_null_role_denied', 'passed', jsonb_build_object('message', sqlerrm));
	end;

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
	select count(*)
	into v_operator_rows
	from public.get_operator_kpi_summary(current_date, 30);
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_operator_kpi_summary_admin_comparative',
		case when v_operator_rows >= 0 then 'passed' else 'failed' end,
		jsonb_build_object('rowCount', v_operator_rows)
	);

	select count(*)
	into v_missing_count
	from public.get_operator_kpi_summary(current_date, 30)
	where operator_effectiveness_rate not between 0 and 100
		or effective_coverage not between 0 and 100
		or pending_coverage not between 0 and 100
		or overdue_coverage not between 0 and 100
		or urgent_coverage not between 0 and 100;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_operator_kpi_summary_rate_ranges',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('outOfRangeRows', v_missing_count)
	);

	select count(*)
	into v_missing_count
	from public.get_operator_kpi_summary(current_date, 30) as summary
	join public.profiles as p
		on p.id = summary.operator_profile_id
	where p.is_active is distinct from true;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_operator_kpi_summary_excludes_inactive_operators',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('inactiveRows', v_missing_count)
	);

	if v_active_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_active_teleoperadora_id::text, true);
		select count(*)
		into v_operator_rows_seen
		from public.get_operator_kpi_summary(current_date, 30);
		select count(*)
		into v_operator_other_rows
		from public.get_operator_kpi_summary(current_date, 30)
		where operator_profile_id <> v_active_teleoperadora_id;
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operator_kpi_summary_teleoperadora_own_row_only',
			case when v_operator_rows_seen <= 1 and v_operator_other_rows = 0 then 'passed' else 'failed' end,
			jsonb_build_object('returnedRows', v_operator_rows_seen, 'otherRows', v_operator_other_rows, 'teleoperadoraId', v_active_teleoperadora_id)
		);
	else
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operator_kpi_summary_teleoperadora_own_row_only',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);
	end if;

	if v_zero_activity_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_zero_activity_teleoperadora_id::text, true);
		select count(*)
		into v_operator_rows_seen
		from public.get_operator_kpi_summary(current_date, 30);
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operator_kpi_summary_zero_activity_operator_safe',
			case when v_operator_rows_seen <= 1 then 'passed' else 'failed' end,
			jsonb_build_object('returnedRows', v_operator_rows_seen, 'teleoperadoraId', v_zero_activity_teleoperadora_id)
		);
	else
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_operator_kpi_summary_zero_activity_operator_safe',
			'skipped',
			jsonb_build_object('reason', 'No se encontro teleoperadora activa sin actividad reciente en el entorno')
		);
	end if;

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
	select public.get_import_quality_kpis(30)
	into v_import_quality;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_import_quality_kpis_admin_allowed',
		'passed',
		jsonb_build_object('payload', v_import_quality)
	);

	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_import_quality_kpis_ranges_and_consistency',
		case
			when coalesce((v_import_quality->>'correlationRate')::numeric, -1) between 0 and 100
				and coalesce((v_import_quality->>'unmatchedRate')::numeric, -1) between 0 and 100
				and coalesce((v_import_quality->>'duplicateRate')::numeric, -1) between 0 and 100
				and coalesce((v_import_quality->>'warningRate')::numeric, -1) between 0 and 100
				and coalesce((v_import_quality->>'validRows')::integer, 0) >= coalesce((v_import_quality->>'correlatedRows')::integer, 0)
				and coalesce((v_import_quality->>'processedRows')::integer, 0) >= coalesce((v_import_quality->>'warningRows')::integer, 0)
			then 'passed'
			else 'failed'
		end,
		jsonb_build_object('payload', v_import_quality)
	);

	if v_active_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_active_teleoperadora_id::text, true);
		begin
			perform public.get_import_quality_kpis(30);
			insert into qa_kpi_results (test_name, status, details)
			values ('get_import_quality_kpis_teleoperadora_denied', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_kpi_results (test_name, status, details)
			values ('get_import_quality_kpis_teleoperadora_denied', 'passed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_import_quality_kpis_teleoperadora_denied',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);
	end if;

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
	select count(*)
	into v_overdue_rows
	from public.get_overdue_beneficiaries(50);
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_overdue_beneficiaries_admin_global',
		case when v_overdue_rows >= 0 then 'passed' else 'failed' end,
		jsonb_build_object('rowCount', v_overdue_rows)
	);

	select count(*)
	into v_missing_count
	from (
		select
			beneficiary_id,
			priority_rank,
			overdue_days,
			aging_days,
			lag(priority_rank) over (order by priority_rank asc, overdue_days desc nulls last, aging_days desc nulls last, beneficiary_name asc) as previous_priority_rank
		from public.get_overdue_beneficiaries(200)
	) as ordered
	where previous_priority_rank is not null
		and priority_rank < previous_priority_rank;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_overdue_beneficiaries_stable_order',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('orderingViolations', v_missing_count)
	);

	select count(*)
	into v_missing_count
	from public.get_overdue_beneficiaries(200)
	where coverage_state = 'sin_contacto'::public.follow_up_coverage_state
		and aging_days is not null;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'get_overdue_beneficiaries_null_aging_semantics',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('sinContactoWithAgingDays', v_missing_count)
	);

	if v_active_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_active_teleoperadora_id::text, true);
		select count(*)
		into v_overdue_rows
		from public.get_overdue_beneficiaries(100);
		select count(*)
		into v_missing_count
		from public.get_overdue_beneficiaries(100) as overdue
		where not exists (
			select 1
			from public.beneficiary_assignments as assignment
			where assignment.beneficiary_id = overdue.beneficiary_id
				and assignment.assigned_user_id = v_active_teleoperadora_id
				and assignment.status = 'active'
				and assignment.starts_at <= now()
				and (assignment.ends_at is null or assignment.ends_at >= now())
		);
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_overdue_beneficiaries_teleoperadora_scope',
			case when v_missing_count = 0 then 'passed' else 'failed' end,
			jsonb_build_object('rowCount', v_overdue_rows, 'outOfScopeRows', v_missing_count, 'teleoperadoraId', v_active_teleoperadora_id)
		);
	else
		insert into qa_kpi_results (test_name, status, details)
		values (
			'get_overdue_beneficiaries_teleoperadora_scope',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);
	end if;

	perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
	select count(*)
	into v_before_global
	from public.kpi_daily_snapshots
	where snapshot_date = v_snapshot_date
		and scope_type = 'global'::public.kpi_snapshot_scope;

	perform public.capture_kpi_daily_snapshot(v_snapshot_date, 7);

	select count(*)
	into v_after_first_global
	from public.kpi_daily_snapshots
	where snapshot_date = v_snapshot_date
		and scope_type = 'global'::public.kpi_snapshot_scope;

	perform public.capture_kpi_daily_snapshot(v_snapshot_date, 7);

	select count(*)
	into v_after_second_global
	from public.kpi_daily_snapshots
	where snapshot_date = v_snapshot_date
		and scope_type = 'global'::public.kpi_snapshot_scope;

	insert into qa_kpi_results (test_name, status, details)
	values (
		'capture_kpi_daily_snapshot_global_upsert',
		case when v_after_first_global = 1 and v_after_second_global = 1 then 'passed' else 'failed' end,
		jsonb_build_object('before', v_before_global, 'afterFirst', v_after_first_global, 'afterSecond', v_after_second_global, 'snapshotDate', v_snapshot_date)
	);

	select count(*)
	into v_missing_count
	from public.kpi_daily_snapshots
	where snapshot_date = v_snapshot_date
		and window_days <> 7;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'capture_kpi_daily_snapshot_respects_window',
		case when v_missing_count = 0 then 'passed' else 'failed' end,
		jsonb_build_object('windowMismatchRows', v_missing_count, 'snapshotDate', v_snapshot_date)
	);

	select count(*)
	into v_history_rows
	from public.v_kpi_daily_snapshot_history
	where snapshot_date = v_snapshot_date;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'v_kpi_daily_snapshot_history_reads_snapshot',
		case when v_history_rows > 0 then 'passed' else 'failed' end,
		jsonb_build_object('historyRows', v_history_rows, 'snapshotDate', v_snapshot_date)
	);

	perform public.refresh_operational_metrics_cache();
	select count(*)
	into v_cache_rows
	from public.operational_metrics_cache;
	insert into qa_kpi_results (test_name, status, details)
	values (
		'refresh_operational_metrics_cache_refreshes_view',
		case when v_cache_rows = 1 then 'passed' else 'failed' end,
		jsonb_build_object('cacheRows', v_cache_rows)
	);

	perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
	begin
		perform public.get_import_quality_kpis(7);
		insert into qa_kpi_results (test_name, status, details)
		values ('null_role_hardening_inactive_admin_import_kpis', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_kpi_results (test_name, status, details)
		values ('null_role_hardening_inactive_admin_import_kpis', 'passed', jsonb_build_object('message', sqlerrm));
	end;

	perform set_config('request.jwt.claim.sub', v_nonexistent_user_id::text, true);
	begin
		perform public.get_overdue_beneficiaries(10);
		insert into qa_kpi_results (test_name, status, details)
		values ('null_role_hardening_nonexistent_user_overdue', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_kpi_results (test_name, status, details)
		values ('null_role_hardening_nonexistent_user_overdue', 'passed', jsonb_build_object('message', sqlerrm));
	end;
end;
$$;

select
	test_name,
	status,
	details
from qa_kpi_results
order by test_name;

select jsonb_build_object(
	'total_tests', count(*)::integer,
	'passed_tests', count(*) filter (where status = 'passed')::integer,
	'failed_tests', count(*) filter (where status = 'failed')::integer,
	'skipped_tests', count(*) filter (where status = 'skipped')::integer
) as qa_summary
from qa_kpi_results;

rollback;
