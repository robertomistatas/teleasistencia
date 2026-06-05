begin;

create temporary table qa_exec_risk_results (
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

	if v_super_admin_id is not null then
		perform set_config('request.jwt.claim.sub', v_super_admin_id::text, true);
		perform public.capture_kpi_daily_snapshot(v_snapshot_date - 1, 7);
		perform public.capture_kpi_daily_snapshot(v_snapshot_date, 7);

		select public.get_executive_metrics_summary(v_snapshot_date, 30, 7)
		into v_summary;

		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'executive_summary_exposes_sla_risk_block',
			case
				when v_summary ? 'slaRisk'
					and (v_summary->'slaRisk') ? 'slaComplianceState'
					and (v_summary->'slaRisk') ? 'institutionalRiskLevel'
					and (v_summary->'slaRisk') ? 'riskDrivers'
				then 'passed'
				else 'failed'
			end,
			jsonb_build_object('summary', v_summary->'slaRisk')
		);

		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'executive_sla_risk_states_valid',
			case
				when coalesce(v_summary->'slaRisk'->>'slaComplianceState', '') in ('healthy', 'watch', 'risk', 'critical')
					and coalesce(v_summary->'slaRisk'->>'overdueSeverityState', '') in ('healthy', 'watch', 'risk', 'critical')
					and coalesce(v_summary->'slaRisk'->>'staleConcentrationState', '') in ('healthy', 'watch', 'risk', 'critical')
					and coalesce(v_summary->'slaRisk'->>'criticalBacklogState', '') in ('healthy', 'watch', 'risk', 'critical')
					and coalesce(v_summary->'slaRisk'->>'agingInstitutionalState', '') in ('healthy', 'watch', 'risk', 'critical')
					and (
						coalesce((v_summary->'slaRisk'->>'degradationAvailable')::boolean, false) = false
						or coalesce(v_summary->'slaRisk'->>'operationalDegradationState', '') in ('healthy', 'watch', 'risk', 'critical')
					)
					and coalesce(v_summary->'slaRisk'->>'institutionalRiskLevel', '') in ('healthy', 'watch', 'risk', 'critical')
				then 'passed'
				else 'failed'
			end,
			jsonb_build_object('slaRisk', v_summary->'slaRisk')
		);
	else
		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'executive_summary_exposes_sla_risk_block',
			'skipped',
			jsonb_build_object('reason', 'No hay super_admin activo disponible en el entorno')
		);

		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'executive_sla_risk_states_valid',
			'skipped',
			jsonb_build_object('reason', 'No hay super_admin activo disponible en el entorno')
		);
	end if;

	if v_admin_id is not null then
		perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
		begin
			perform public.get_executive_metrics_summary(current_date, 30, 30);
			insert into qa_exec_risk_results (test_name, status, details)
			values ('admin_allowed_sla_risk_summary', 'passed', jsonb_build_object('adminId', v_admin_id));
		exception when others then
			insert into qa_exec_risk_results (test_name, status, details)
			values ('admin_allowed_sla_risk_summary', 'failed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'admin_allowed_sla_risk_summary',
			'skipped',
			jsonb_build_object('reason', 'No hay admin activo disponible en el entorno')
		);
	end if;

	if v_teleoperadora_id is not null then
		perform set_config('request.jwt.claim.sub', v_teleoperadora_id::text, true);
		begin
			perform public.get_executive_metrics_summary(current_date, 30, 30);
			insert into qa_exec_risk_results (test_name, status, details)
			values ('teleoperadora_denied_sla_risk_summary', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_exec_risk_results (test_name, status, details)
			values ('teleoperadora_denied_sla_risk_summary', 'passed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'teleoperadora_denied_sla_risk_summary',
			'skipped',
			jsonb_build_object('reason', 'No hay teleoperadora activa disponible en el entorno')
		);
	end if;

	if v_inactive_admin_id is not null then
		perform set_config('request.jwt.claim.sub', v_inactive_admin_id::text, true);
		begin
			perform public.get_executive_metrics_summary(current_date, 30, 30);
			insert into qa_exec_risk_results (test_name, status, details)
			values ('inactive_admin_denied_sla_risk_summary', 'failed', jsonb_build_object('status', 'unexpected_success'));
		exception when others then
			insert into qa_exec_risk_results (test_name, status, details)
			values ('inactive_admin_denied_sla_risk_summary', 'passed', jsonb_build_object('message', sqlerrm));
		end;
	else
		insert into qa_exec_risk_results (test_name, status, details)
		values (
			'inactive_admin_denied_sla_risk_summary',
			'skipped',
			jsonb_build_object('reason', 'No hay admin inactivo disponible en el entorno')
		);
	end if;

	perform set_config('request.jwt.claim.sub', v_nonexistent_user_id::text, true);
	begin
		perform public.get_executive_metrics_summary(current_date, 30, 30);
		insert into qa_exec_risk_results (test_name, status, details)
		values ('null_role_denied_sla_risk_summary', 'failed', jsonb_build_object('status', 'unexpected_success'));
	exception when others then
		insert into qa_exec_risk_results (test_name, status, details)
		values ('null_role_denied_sla_risk_summary', 'passed', jsonb_build_object('message', sqlerrm));
	end;
end;
$$;

select
	test_name,
	status,
	details
from qa_exec_risk_results
order by test_name;

select jsonb_build_object(
	'total_tests', count(*)::integer,
	'passed_tests', count(*) filter (where status = 'passed')::integer,
	'failed_tests', count(*) filter (where status = 'failed')::integer,
	'skipped_tests', count(*) filter (where status = 'skipped')::integer
) as qa_summary
from qa_exec_risk_results;

rollback;
