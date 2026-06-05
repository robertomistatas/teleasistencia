create or replace function public.get_executive_metrics_summary(
	p_reference_date date default current_date,
	p_window_days integer default 30,
	p_history_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_window_days integer := greatest(coalesce(p_window_days, 30), 1);
	v_history_days integer := greatest(coalesce(p_history_days, 30), 1);
	v_operational_summary jsonb;
	v_import_quality jsonb;
	v_total_beneficiaries integer := 0;
	v_effective_beneficiaries integer := 0;
	v_pending_beneficiaries integer := 0;
	v_overdue_beneficiaries integer := 0;
	v_urgent_beneficiaries integer := 0;
	v_stale_beneficiaries integer := 0;
	v_effective_coverage numeric := 0;
	v_pending_coverage numeric := 0;
	v_overdue_coverage numeric := 0;
	v_urgent_coverage numeric := 0;
	v_avg_aging_days numeric := 0;
	v_avg_overdue_days numeric := 0;
	v_successful_followups integer := 0;
	v_failed_followups integer := 0;
	v_effective_contact_rate numeric := 0;
	v_correlation_rate numeric := 0;
	v_unmatched_rate numeric := 0;
	v_duplicate_rate numeric := 0;
	v_warning_rate numeric := 0;
	v_import_runs integer := 0;
	v_activity_volume integer := 0;
	v_snapshots_available integer := 0;
	v_baseline_snapshot_date date;
	v_latest_snapshot_date date;
	v_baseline_snapshot record;
	v_latest_snapshot record;
	v_effective_coverage_delta numeric;
	v_overdue_coverage_delta numeric;
	v_effective_contact_rate_delta numeric;
	v_correlation_rate_delta numeric;
	v_backlog_delta integer;
	v_avg_aging_days_delta numeric;
	v_activity_volume_delta integer;
	v_stale_concentration_rate numeric := 0;
	v_sla_rank integer := 1;
	v_overdue_rank integer := 1;
	v_stale_rank integer := 1;
	v_backlog_rank integer := 1;
	v_aging_rank integer := 1;
	v_degradation_rank integer;
	v_institutional_risk_rank integer := 1;
	v_sla_state text := 'healthy';
	v_overdue_state text := 'healthy';
	v_stale_state text := 'healthy';
	v_backlog_state text := 'healthy';
	v_aging_state text := 'healthy';
	v_degradation_state text;
	v_institutional_risk_level text := 'healthy';
	v_risk_drivers text[] := '{}'::text[];
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar metricas ejecutivas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar metricas ejecutivas';
	end if;

	v_operational_summary := public.get_operational_kpi_summary(p_reference_date, v_window_days);
	v_import_quality := public.get_import_quality_kpis(v_window_days);

	v_total_beneficiaries := coalesce((v_operational_summary->>'totalBeneficiaries')::integer, 0);
	v_effective_beneficiaries := coalesce((v_operational_summary->>'effectiveBeneficiaries')::integer, 0);
	v_pending_beneficiaries := coalesce((v_operational_summary->>'pendingBeneficiaries')::integer, 0);
	v_overdue_beneficiaries := coalesce((v_operational_summary->>'overdueBeneficiaries')::integer, 0);
	v_urgent_beneficiaries := coalesce((v_operational_summary->>'urgentBeneficiaries')::integer, 0);
	v_stale_beneficiaries := coalesce((v_operational_summary->>'staleBeneficiaries')::integer, 0);
	v_effective_coverage := coalesce((v_operational_summary->>'effectiveCoverage')::numeric, 0);
	v_pending_coverage := coalesce((v_operational_summary->>'pendingCoverage')::numeric, 0);
	v_overdue_coverage := coalesce((v_operational_summary->>'overdueCoverage')::numeric, 0);
	v_urgent_coverage := coalesce((v_operational_summary->>'urgentCoverage')::numeric, 0);
	v_avg_aging_days := coalesce((v_operational_summary->>'avgAgingDays')::numeric, 0);
	v_avg_overdue_days := coalesce((v_operational_summary->>'avgOverdueDays')::numeric, 0);
	v_successful_followups := coalesce((v_operational_summary->>'successfulFollowups')::integer, 0);
	v_failed_followups := coalesce((v_operational_summary->>'failedFollowups')::integer, 0);
	v_effective_contact_rate := coalesce((v_operational_summary->>'effectiveContactRate')::numeric, 0);
	v_correlation_rate := coalesce((v_import_quality->>'correlationRate')::numeric, 0);
	v_unmatched_rate := coalesce((v_import_quality->>'unmatchedRate')::numeric, 0);
	v_duplicate_rate := coalesce((v_import_quality->>'duplicateRate')::numeric, 0);
	v_warning_rate := coalesce((v_import_quality->>'warningRate')::numeric, 0);
	v_import_runs := coalesce((v_import_quality->>'importRuns')::integer, 0);
	v_activity_volume := v_successful_followups + v_failed_followups;
	v_stale_concentration_rate := round(coalesce((v_stale_beneficiaries::numeric / nullif(v_total_beneficiaries, 0)) * 100, 0), 2);

	select
		count(*)::integer,
		min(snapshot_date),
		max(snapshot_date)
	into
		v_snapshots_available,
		v_baseline_snapshot_date,
		v_latest_snapshot_date
	from public.v_kpi_daily_snapshot_history as history
	where history.scope_type = 'global'::public.kpi_snapshot_scope
		and history.snapshot_date >= (p_reference_date - make_interval(days => v_history_days - 1))
		and history.snapshot_date <= p_reference_date;

	if v_snapshots_available > 0 then
		select *
		into v_baseline_snapshot
		from public.v_kpi_daily_snapshot_history as history
		where history.scope_type = 'global'::public.kpi_snapshot_scope
			and history.snapshot_date >= (p_reference_date - make_interval(days => v_history_days - 1))
			and history.snapshot_date <= p_reference_date
		order by history.snapshot_date asc
		limit 1;

		select *
		into v_latest_snapshot
		from public.v_kpi_daily_snapshot_history as history
		where history.scope_type = 'global'::public.kpi_snapshot_scope
			and history.snapshot_date >= (p_reference_date - make_interval(days => v_history_days - 1))
			and history.snapshot_date <= p_reference_date
		order by history.snapshot_date desc
		limit 1;
	end if;

	if v_snapshots_available >= 2 then
		v_effective_coverage_delta := round(coalesce(v_latest_snapshot.effective_coverage, 0) - coalesce(v_baseline_snapshot.effective_coverage, 0), 2);
		v_overdue_coverage_delta := round(coalesce(v_latest_snapshot.overdue_coverage, 0) - coalesce(v_baseline_snapshot.overdue_coverage, 0), 2);
		v_effective_contact_rate_delta := round(coalesce(v_latest_snapshot.effective_contact_rate, 0) - coalesce(v_baseline_snapshot.effective_contact_rate, 0), 2);
		v_correlation_rate_delta := round(coalesce(v_latest_snapshot.correlation_rate, 0) - coalesce(v_baseline_snapshot.correlation_rate, 0), 2);
		v_backlog_delta := coalesce(v_latest_snapshot.stale_beneficiary_count, 0) - coalesce(v_baseline_snapshot.stale_beneficiary_count, 0);
		v_avg_aging_days_delta := round(coalesce(v_latest_snapshot.avg_aging_days, 0) - coalesce(v_baseline_snapshot.avg_aging_days, 0), 2);
		v_activity_volume_delta := (
			coalesce(v_latest_snapshot.successful_followups, 0) + coalesce(v_latest_snapshot.failed_followups, 0)
		) - (
			coalesce(v_baseline_snapshot.successful_followups, 0) + coalesce(v_baseline_snapshot.failed_followups, 0)
		);
	end if;

	v_sla_rank := case
		when v_effective_coverage >= 85 then 1
		when v_effective_coverage >= 70 then 2
		when v_effective_coverage >= 55 then 3
		else 4
	end;

	v_overdue_rank := case
		when v_overdue_coverage < 10 then 1
		when v_overdue_coverage < 20 then 2
		when v_overdue_coverage < 35 then 3
		else 4
	end;

	v_stale_rank := case
		when v_stale_concentration_rate < 10 then 1
		when v_stale_concentration_rate < 20 then 2
		when v_stale_concentration_rate < 35 then 3
		else 4
	end;

	v_backlog_rank := case
		when v_urgent_coverage < 5 then 1
		when v_urgent_coverage < 12 then 2
		when v_urgent_coverage < 20 then 3
		else 4
	end;

	v_aging_rank := case
		when v_avg_aging_days < 15 then 1
		when v_avg_aging_days < 25 then 2
		when v_avg_aging_days < 35 then 3
		else 4
	end;

	if v_snapshots_available >= 2 then
		v_degradation_rank := case
			when coalesce(v_effective_coverage_delta, 0) <= -10
				or coalesce(v_overdue_coverage_delta, 0) >= 10
				or coalesce(v_effective_contact_rate_delta, 0) <= -10
				or coalesce(v_backlog_delta, 0) >= 25
			then 4
			when coalesce(v_effective_coverage_delta, 0) <= -5
				or coalesce(v_overdue_coverage_delta, 0) >= 5
				or coalesce(v_effective_contact_rate_delta, 0) <= -5
				or coalesce(v_backlog_delta, 0) >= 10
			then 3
			when coalesce(v_effective_coverage_delta, 0) < 0
				or coalesce(v_overdue_coverage_delta, 0) > 0
				or coalesce(v_effective_contact_rate_delta, 0) < 0
				or coalesce(v_backlog_delta, 0) > 0
			then 2
			else 1
		end;
	else
		v_degradation_rank := null;
	end if;

	v_sla_state := case v_sla_rank when 1 then 'healthy' when 2 then 'watch' when 3 then 'risk' else 'critical' end;
	v_overdue_state := case v_overdue_rank when 1 then 'healthy' when 2 then 'watch' when 3 then 'risk' else 'critical' end;
	v_stale_state := case v_stale_rank when 1 then 'healthy' when 2 then 'watch' when 3 then 'risk' else 'critical' end;
	v_backlog_state := case v_backlog_rank when 1 then 'healthy' when 2 then 'watch' when 3 then 'risk' else 'critical' end;
	v_aging_state := case v_aging_rank when 1 then 'healthy' when 2 then 'watch' when 3 then 'risk' else 'critical' end;
	v_degradation_state := case
		when v_degradation_rank is null then null
		when v_degradation_rank = 1 then 'healthy'
		when v_degradation_rank = 2 then 'watch'
		when v_degradation_rank = 3 then 'risk'
		else 'critical'
	end;

	v_institutional_risk_rank := greatest(
		v_sla_rank,
		v_overdue_rank,
		v_stale_rank,
		v_backlog_rank,
		v_aging_rank,
		coalesce(v_degradation_rank, 1)
	);

	v_institutional_risk_level := case v_institutional_risk_rank
		when 1 then 'healthy'
		when 2 then 'watch'
		when 3 then 'risk'
		else 'critical'
	end;

	v_risk_drivers := array_remove(array[
		case when v_sla_rank >= 3 then 'La cobertura efectiva institucional esta bajo el umbral objetivo.' end,
		case when v_overdue_rank >= 3 then 'La severidad de cartera vencida requiere priorizacion ejecutiva.' end,
		case when v_stale_rank >= 3 then 'La concentracion stale muestra deuda operacional acumulada.' end,
		case when v_backlog_rank >= 3 then 'El backlog critico de beneficiarios urgentes supera el rango esperado.' end,
		case when v_aging_rank >= 3 then 'El aging promedio institucional muestra rezago sostenido.' end,
		case when coalesce(v_degradation_rank, 1) >= 3 then 'Los snapshots reales muestran degradacion operativa reciente.' end
	], null);

	return jsonb_build_object(
		'referenceDate', p_reference_date,
		'windowDays', v_window_days,
		'historyDays', v_history_days,
		'current', jsonb_build_object(
			'totalBeneficiaries', v_total_beneficiaries,
			'effectiveBeneficiaries', v_effective_beneficiaries,
			'pendingBeneficiaries', v_pending_beneficiaries,
			'overdueBeneficiaries', v_overdue_beneficiaries,
			'urgentBeneficiaries', v_urgent_beneficiaries,
			'staleBeneficiaries', v_stale_beneficiaries,
			'effectiveCoverage', v_effective_coverage,
			'pendingCoverage', v_pending_coverage,
			'overdueCoverage', v_overdue_coverage,
			'urgentCoverage', v_urgent_coverage,
			'avgAgingDays', v_avg_aging_days,
			'avgOverdueDays', v_avg_overdue_days,
			'successfulFollowups', v_successful_followups,
			'failedFollowups', v_failed_followups,
			'activityVolume', v_activity_volume,
			'effectiveContactRate', v_effective_contact_rate,
			'backlogAccumulated', v_stale_beneficiaries,
			'criticalBeneficiaries', v_urgent_beneficiaries,
			'stalePortfolio', v_stale_beneficiaries,
			'correlationRate', v_correlation_rate,
			'unmatchedRate', v_unmatched_rate,
			'duplicateRate', v_duplicate_rate,
			'warningRate', v_warning_rate,
			'importRuns', v_import_runs
		),
		'history', jsonb_build_object(
			'available', v_snapshots_available > 0,
			'enoughForTrend', v_snapshots_available >= 2,
			'snapshotsAvailable', v_snapshots_available,
			'baselineSnapshotDate', v_baseline_snapshot_date,
			'latestSnapshotDate', v_latest_snapshot_date,
			'effectiveCoverageDelta', v_effective_coverage_delta,
			'overdueCoverageDelta', v_overdue_coverage_delta,
			'effectiveContactRateDelta', v_effective_contact_rate_delta,
			'correlationRateDelta', v_correlation_rate_delta,
			'backlogDelta', v_backlog_delta,
			'avgAgingDaysDelta', v_avg_aging_days_delta,
			'activityVolumeDelta', v_activity_volume_delta
		),
		'slaRisk', jsonb_build_object(
			'slaComplianceRate', v_effective_coverage,
			'slaComplianceState', v_sla_state,
			'overdueSeverityRate', v_overdue_coverage,
			'overdueSeverityState', v_overdue_state,
			'staleConcentrationRate', v_stale_concentration_rate,
			'staleConcentrationState', v_stale_state,
			'criticalBacklogCount', v_urgent_beneficiaries,
			'criticalBacklogRate', v_urgent_coverage,
			'criticalBacklogState', v_backlog_state,
			'agingInstitutionalDays', v_avg_aging_days,
			'agingInstitutionalState', v_aging_state,
			'degradationAvailable', v_snapshots_available >= 2,
			'operationalDegradationState', v_degradation_state,
			'institutionalRiskLevel', v_institutional_risk_level,
			'attentionRequired', v_institutional_risk_rank >= 3,
			'riskDrivers', to_jsonb(v_risk_drivers)
		)
	);
end;
$$;

comment on function public.get_executive_metrics_summary(date, integer, integer)
	is 'Executive institutional KPI summary with canonical SLA and risk states derived in backend from 4.9A runtime KPIs plus real persisted global snapshots only.';
