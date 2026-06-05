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

	return (
		with scoped_history as (
			select history.*
			from public.v_kpi_daily_snapshot_history as history
			where history.scope_type = 'global'::public.kpi_snapshot_scope
				and history.snapshot_date >= (p_reference_date - make_interval(days => v_history_days - 1))
				and history.snapshot_date <= p_reference_date
			order by history.snapshot_date asc
		),
		history_stats as (
			select
				count(*)::integer as snapshots_available,
				min(snapshot_date) as baseline_snapshot_date,
				max(snapshot_date) as latest_snapshot_date
			from scoped_history
		),
		baseline_snapshot as (
			select *
			from scoped_history
			order by snapshot_date asc
			limit 1
		),
		latest_snapshot as (
			select *
			from scoped_history
			order by snapshot_date desc
			limit 1
		)
		select jsonb_build_object(
			'referenceDate', p_reference_date,
			'windowDays', v_window_days,
			'historyDays', v_history_days,
			'current', jsonb_build_object(
				'totalBeneficiaries', coalesce((v_operational_summary->>'totalBeneficiaries')::integer, 0),
				'effectiveBeneficiaries', coalesce((v_operational_summary->>'effectiveBeneficiaries')::integer, 0),
				'pendingBeneficiaries', coalesce((v_operational_summary->>'pendingBeneficiaries')::integer, 0),
				'overdueBeneficiaries', coalesce((v_operational_summary->>'overdueBeneficiaries')::integer, 0),
				'urgentBeneficiaries', coalesce((v_operational_summary->>'urgentBeneficiaries')::integer, 0),
				'staleBeneficiaries', coalesce((v_operational_summary->>'staleBeneficiaries')::integer, 0),
				'effectiveCoverage', coalesce((v_operational_summary->>'effectiveCoverage')::numeric, 0),
				'pendingCoverage', coalesce((v_operational_summary->>'pendingCoverage')::numeric, 0),
				'overdueCoverage', coalesce((v_operational_summary->>'overdueCoverage')::numeric, 0),
				'urgentCoverage', coalesce((v_operational_summary->>'urgentCoverage')::numeric, 0),
				'avgAgingDays', coalesce((v_operational_summary->>'avgAgingDays')::numeric, 0),
				'avgOverdueDays', coalesce((v_operational_summary->>'avgOverdueDays')::numeric, 0),
				'successfulFollowups', coalesce((v_operational_summary->>'successfulFollowups')::integer, 0),
				'failedFollowups', coalesce((v_operational_summary->>'failedFollowups')::integer, 0),
				'activityVolume', coalesce((v_operational_summary->>'successfulFollowups')::integer, 0)
					+ coalesce((v_operational_summary->>'failedFollowups')::integer, 0),
				'effectiveContactRate', coalesce((v_operational_summary->>'effectiveContactRate')::numeric, 0),
				'backlogAccumulated', coalesce((v_operational_summary->>'staleBeneficiaries')::integer, 0),
				'criticalBeneficiaries', coalesce((v_operational_summary->>'urgentBeneficiaries')::integer, 0),
				'stalePortfolio', coalesce((v_operational_summary->>'staleBeneficiaries')::integer, 0),
				'correlationRate', coalesce((v_import_quality->>'correlationRate')::numeric, 0),
				'unmatchedRate', coalesce((v_import_quality->>'unmatchedRate')::numeric, 0),
				'duplicateRate', coalesce((v_import_quality->>'duplicateRate')::numeric, 0),
				'warningRate', coalesce((v_import_quality->>'warningRate')::numeric, 0),
				'importRuns', coalesce((v_import_quality->>'importRuns')::integer, 0)
			),
			'history', jsonb_build_object(
				'available', coalesce((select snapshots_available from history_stats) > 0, false),
				'enoughForTrend', coalesce((select snapshots_available from history_stats) >= 2, false),
				'snapshotsAvailable', coalesce((select snapshots_available from history_stats), 0),
				'baselineSnapshotDate', (select baseline_snapshot_date from history_stats),
				'latestSnapshotDate', (select latest_snapshot_date from history_stats),
				'effectiveCoverageDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						round(
							coalesce((select latest_snapshot.effective_coverage from latest_snapshot), 0)
							- coalesce((select baseline_snapshot.effective_coverage from baseline_snapshot), 0),
							2
						)
					else null
				end,
				'overdueCoverageDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						round(
							coalesce((select latest_snapshot.overdue_coverage from latest_snapshot), 0)
							- coalesce((select baseline_snapshot.overdue_coverage from baseline_snapshot), 0),
							2
						)
					else null
				end,
				'effectiveContactRateDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						round(
							coalesce((select latest_snapshot.effective_contact_rate from latest_snapshot), 0)
							- coalesce((select baseline_snapshot.effective_contact_rate from baseline_snapshot), 0),
							2
						)
					else null
				end,
				'correlationRateDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						round(
							coalesce((select latest_snapshot.correlation_rate from latest_snapshot), 0)
							- coalesce((select baseline_snapshot.correlation_rate from baseline_snapshot), 0),
							2
						)
					else null
				end,
				'backlogDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						coalesce((select latest_snapshot.stale_beneficiary_count from latest_snapshot), 0)
						- coalesce((select baseline_snapshot.stale_beneficiary_count from baseline_snapshot), 0)
					else null
				end,
				'avgAgingDaysDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						round(
							coalesce((select latest_snapshot.avg_aging_days from latest_snapshot), 0)
							- coalesce((select baseline_snapshot.avg_aging_days from baseline_snapshot), 0),
							2
						)
					else null
				end,
				'activityVolumeDelta', case
					when (select snapshots_available from history_stats) >= 2 then
						(
							coalesce((select latest_snapshot.successful_followups from latest_snapshot), 0)
							+ coalesce((select latest_snapshot.failed_followups from latest_snapshot), 0)
						) - (
							coalesce((select baseline_snapshot.successful_followups from baseline_snapshot), 0)
							+ coalesce((select baseline_snapshot.failed_followups from baseline_snapshot), 0)
						)
					else null
				end
			)
		)
	);
end;
$$;

create or replace function public.get_executive_metrics_history(
	p_days integer default 30
)
returns table (
	snapshot_date date,
	total_beneficiaries integer,
	effective_beneficiaries integer,
	pending_beneficiaries integer,
	overdue_beneficiaries integer,
	urgent_beneficiaries integer,
	stale_beneficiary_count integer,
	avg_aging_days numeric,
	avg_overdue_days numeric,
	effective_coverage numeric,
	pending_coverage numeric,
	overdue_coverage numeric,
	urgent_coverage numeric,
	successful_followups integer,
	failed_followups integer,
	activity_volume integer,
	effective_contact_rate numeric,
	correlation_rate numeric,
	unmatched_rate numeric,
	duplicate_rate numeric,
	warning_rate numeric,
	window_days integer,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_days integer := greatest(coalesce(p_days, 30), 1);
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar historico ejecutivo';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar historico ejecutivo';
	end if;

	return query
	select
		history.snapshot_date,
		history.total_beneficiaries,
		history.effective_beneficiaries,
		history.pending_beneficiaries,
		history.overdue_beneficiaries,
		history.urgent_beneficiaries,
		history.stale_beneficiary_count,
		history.avg_aging_days,
		history.avg_overdue_days,
		history.effective_coverage,
		history.pending_coverage,
		history.overdue_coverage,
		history.urgent_coverage,
		history.successful_followups,
		history.failed_followups,
		(history.successful_followups + history.failed_followups)::integer as activity_volume,
		history.effective_contact_rate,
		history.correlation_rate,
		history.unmatched_rate,
		history.duplicate_rate,
		history.warning_rate,
		history.window_days,
		history.created_at
	from public.v_kpi_daily_snapshot_history as history
	where history.scope_type = 'global'::public.kpi_snapshot_scope
		and history.snapshot_date >= (current_date - make_interval(days => v_days - 1))
	order by history.snapshot_date asc;
end;
$$;

comment on function public.get_executive_metrics_summary(date, integer, integer)
	is 'Executive institutional KPI summary built from canonical 4.9A runtime KPIs plus real persisted global snapshots only.';

comment on function public.get_executive_metrics_history(integer)
	is 'Executive historical KPI series from persisted global kpi_daily_snapshots only. Does not reconstruct missing history.';

revoke all on function public.get_executive_metrics_summary(date, integer, integer) from public;
revoke all on function public.get_executive_metrics_history(integer) from public;

grant execute on function public.get_executive_metrics_summary(date, integer, integer) to authenticated;
grant execute on function public.get_executive_metrics_history(integer) to authenticated;
