create type public.kpi_snapshot_scope as enum (
	'global',
	'operator'
);

create table public.kpi_daily_snapshots (
	id uuid primary key default gen_random_uuid(),
	snapshot_date date not null,
	scope_type public.kpi_snapshot_scope not null,
	operator_profile_id uuid references public.profiles (id) on delete cascade,
	total_beneficiaries integer not null default 0 check (total_beneficiaries >= 0),
	effective_beneficiaries integer not null default 0 check (effective_beneficiaries >= 0),
	pending_beneficiaries integer not null default 0 check (pending_beneficiaries >= 0),
	overdue_beneficiaries integer not null default 0 check (overdue_beneficiaries >= 0),
	urgent_beneficiaries integer not null default 0 check (urgent_beneficiaries >= 0),
	stale_beneficiary_count integer not null default 0 check (stale_beneficiary_count >= 0),
	avg_aging_days numeric(10, 2),
	avg_overdue_days numeric(10, 2),
	successful_followups integer not null default 0 check (successful_followups >= 0),
	failed_followups integer not null default 0 check (failed_followups >= 0),
	effective_coverage numeric(6, 2) not null default 0,
	pending_coverage numeric(6, 2) not null default 0,
	overdue_coverage numeric(6, 2) not null default 0,
	urgent_coverage numeric(6, 2) not null default 0,
	effective_contact_rate numeric(6, 2) not null default 0,
	operator_effectiveness_rate numeric(6, 2),
	correlation_rate numeric(6, 2),
	unmatched_rate numeric(6, 2),
	duplicate_rate numeric(6, 2),
	warning_rate numeric(6, 2),
	window_days integer not null default 30 check (window_days > 0),
	metadata jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	check (
		(scope_type = 'global' and operator_profile_id is null)
		or (scope_type = 'operator' and operator_profile_id is not null)
	)
);

create index idx_kpi_daily_snapshots_snapshot_date
	on public.kpi_daily_snapshots (snapshot_date desc);

create index idx_kpi_daily_snapshots_operator_profile_id
	on public.kpi_daily_snapshots (operator_profile_id);

create unique index idx_kpi_daily_snapshots_global_unique
	on public.kpi_daily_snapshots (snapshot_date, scope_type)
	where operator_profile_id is null;

create unique index idx_kpi_daily_snapshots_operator_unique
	on public.kpi_daily_snapshots (snapshot_date, scope_type, operator_profile_id)
	where operator_profile_id is not null;

alter table public.kpi_daily_snapshots enable row level security;

create policy "kpi_daily_snapshots_select_admin_super_admin"
	on public.kpi_daily_snapshots
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "kpi_daily_snapshots_select_teleoperadora_own"
	on public.kpi_daily_snapshots
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) = 'teleoperadora'
		and scope_type = 'operator'
		and operator_profile_id = (select auth.uid())
	);

create or replace view public.v_operational_kpi_beneficiary_runtime
with (security_invoker = true)
as
select
	workspace.beneficiary_id,
	workspace.beneficiary_name,
	workspace.beneficiary_rut,
	workspace.beneficiary_commune,
	workspace.beneficiary_region,
	workspace.coverage_state,
	workspace.priority_rank,
	workspace.last_effective_followup_at,
	workspace.days_since_effective_followup as aging_days,
	case
		when workspace.days_since_effective_followup is null then null
		else greatest(workspace.days_since_effective_followup - 30, 0)
	end as overdue_days,
	(workspace.coverage_state = 'al_dia'::public.follow_up_coverage_state) as effective_coverage,
	(workspace.coverage_state = 'pendiente'::public.follow_up_coverage_state) as pending_coverage,
	(workspace.coverage_state in ('urgente'::public.follow_up_coverage_state, 'sin_contacto'::public.follow_up_coverage_state)) as overdue_coverage,
	(workspace.coverage_state = 'urgente'::public.follow_up_coverage_state) as urgent_coverage,
	(workspace.coverage_state in ('urgente'::public.follow_up_coverage_state, 'sin_contacto'::public.follow_up_coverage_state)) as stale_beneficiary,
	workspace.latest_follow_up_event_id,
	workspace.latest_follow_up_event_at,
	workspace.latest_outcome,
	workspace.latest_contact_type,
	workspace.latest_source,
	workspace.active_assignment_id,
	workspace.active_assignment_type,
	workspace.active_assignment_starts_at,
	workspace.assigned_operator_profile_id,
	workspace.assigned_operator_name,
	operator_profile.role as assigned_operator_role,
	coalesce(operator_profile.is_active, false) as assigned_operator_is_active,
	workspace.last_operator_name,
	workspace.legacy_followup_status,
	workspace.status_calculated_at
from public.v_operational_follow_up_workspace as workspace
left join public.profiles as operator_profile
	on operator_profile.id = workspace.assigned_operator_profile_id;

create or replace view public.v_operational_kpi_summary_runtime
with (security_invoker = true)
as
with activity_window as (
	select
		count(*) filter (
			where fe.is_effective_contact = true
				and fe.event_type <> 'internal_note'
		)::integer as successful_followups,
		count(*) filter (
			where fe.is_effective_contact = false
				and fe.event_type <> 'internal_note'
		)::integer as failed_followups
	from public.followup_events as fe
	where coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at)
		>= date_trunc('day', now()) - interval '30 days'
)
select
	now() as generated_at,
	30::integer as window_days,
	count(*)::integer as total_beneficiaries,
	count(*) filter (where effective_coverage)::integer as effective_beneficiaries,
	count(*) filter (where pending_coverage)::integer as pending_beneficiaries,
	count(*) filter (where overdue_coverage)::integer as overdue_beneficiaries,
	count(*) filter (where urgent_coverage)::integer as urgent_beneficiaries,
	count(*) filter (where stale_beneficiary)::integer as stale_beneficiary_count,
	round(coalesce(avg(aging_days)::numeric, 0), 2) as avg_aging_days,
	round(coalesce(avg(overdue_days) filter (where overdue_days is not null)::numeric, 0), 2) as avg_overdue_days,
	round(coalesce((count(*) filter (where effective_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2) as effective_coverage,
	round(coalesce((count(*) filter (where pending_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2) as pending_coverage,
	round(coalesce((count(*) filter (where overdue_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2) as overdue_coverage,
	round(coalesce((count(*) filter (where urgent_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2) as urgent_coverage,
	activity_window.successful_followups,
	activity_window.failed_followups,
	round(
		coalesce(
			(activity_window.successful_followups::numeric / nullif(activity_window.successful_followups + activity_window.failed_followups, 0)) * 100,
			0
		),
		2
	) as effective_contact_rate,
	count(*) filter (
		where assigned_operator_profile_id is null
			or assigned_operator_role is distinct from 'teleoperadora'::public.user_role
			or assigned_operator_is_active is distinct from true
	)::integer as beneficiaries_without_active_operator
from public.v_operational_kpi_beneficiary_runtime
cross join activity_window
group by activity_window.successful_followups, activity_window.failed_followups;

create or replace view public.v_operator_kpi_summary_runtime
with (security_invoker = true)
as
with active_operator_beneficiaries as (
	select *
	from public.v_operational_kpi_beneficiary_runtime
	where assigned_operator_profile_id is not null
		and assigned_operator_role = 'teleoperadora'::public.user_role
		and assigned_operator_is_active = true
),
operator_activity as (
	select
		coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id) as operator_profile_id,
		count(*) filter (
			where fe.is_effective_contact = true
				and fe.event_type <> 'internal_note'
		)::integer as successful_followups,
		count(*) filter (
			where fe.is_effective_contact = false
				and fe.event_type <> 'internal_note'
		)::integer as failed_followups
	from public.followup_events as fe
	join public.profiles as operator_profile
		on operator_profile.id = coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id)
	where operator_profile.role = 'teleoperadora'
		and operator_profile.is_active = true
		and coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at)
			>= date_trunc('day', now()) - interval '30 days'
	group by coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id)
)
select
	operator_profile.id as operator_profile_id,
	coalesce(operator_profile.full_name, operator_profile.email) as operator_name,
	30::integer as window_days,
	count(active_operator_beneficiaries.beneficiary_id)::integer as total_beneficiaries,
	count(*) filter (where active_operator_beneficiaries.effective_coverage)::integer as effective_beneficiaries,
	count(*) filter (where active_operator_beneficiaries.pending_coverage)::integer as pending_beneficiaries,
	count(*) filter (where active_operator_beneficiaries.overdue_coverage)::integer as overdue_beneficiaries,
	count(*) filter (where active_operator_beneficiaries.urgent_coverage)::integer as urgent_beneficiaries,
	count(*) filter (where active_operator_beneficiaries.stale_beneficiary)::integer as stale_beneficiary_count,
	round(coalesce(avg(active_operator_beneficiaries.aging_days)::numeric, 0), 2) as avg_aging_days,
	round(coalesce(avg(active_operator_beneficiaries.overdue_days) filter (where active_operator_beneficiaries.overdue_days is not null)::numeric, 0), 2) as avg_overdue_days,
	round(coalesce((count(*) filter (where active_operator_beneficiaries.effective_coverage)::numeric / nullif(count(active_operator_beneficiaries.beneficiary_id), 0)) * 100, 0), 2) as effective_coverage,
	round(coalesce((count(*) filter (where active_operator_beneficiaries.pending_coverage)::numeric / nullif(count(active_operator_beneficiaries.beneficiary_id), 0)) * 100, 0), 2) as pending_coverage,
	round(coalesce((count(*) filter (where active_operator_beneficiaries.overdue_coverage)::numeric / nullif(count(active_operator_beneficiaries.beneficiary_id), 0)) * 100, 0), 2) as overdue_coverage,
	round(coalesce((count(*) filter (where active_operator_beneficiaries.urgent_coverage)::numeric / nullif(count(active_operator_beneficiaries.beneficiary_id), 0)) * 100, 0), 2) as urgent_coverage,
	coalesce(operator_activity.successful_followups, 0) as successful_followups,
	coalesce(operator_activity.failed_followups, 0) as failed_followups,
	round(
		coalesce(
			(operator_activity.successful_followups::numeric / nullif(operator_activity.successful_followups + operator_activity.failed_followups, 0)) * 100,
			0
		),
		2
	) as operator_effectiveness_rate
from public.profiles as operator_profile
left join active_operator_beneficiaries
	on active_operator_beneficiaries.assigned_operator_profile_id = operator_profile.id
left join operator_activity
	on operator_activity.operator_profile_id = operator_profile.id
where operator_profile.role = 'teleoperadora'
	and operator_profile.is_active = true
group by
	operator_profile.id,
	operator_profile.full_name,
	operator_profile.email,
	operator_activity.successful_followups,
	operator_activity.failed_followups;

create or replace view public.v_import_quality_kpi_runtime
with (security_invoker = true)
as
with scoped_runs as (
	select
		ir.id,
		ir.started_at,
		ir.processed_rows,
		ir.valid_rows,
		ir.correlated_rows,
		ir.warning_rows,
		greatest(coalesce((ir.metadata->>'unmatchedRows')::integer, 0), 0) as unmatched_rows
	from public.import_runs as ir
	where ir.import_type = 'call_logs_import'
		and ir.started_at >= date_trunc('day', now()) - interval '30 days'
),
duplicate_rows as (
	select
		issue.import_job_id,
		count(*)::integer as duplicate_rows
	from public.call_log_correlation_issues as issue
	where issue.issue_type = 'duplicate_call'
	group by issue.import_job_id
)
select
	now() as generated_at,
	30::integer as window_days,
	count(*)::integer as import_runs,
	coalesce(sum(scoped_runs.processed_rows), 0)::integer as processed_rows,
	coalesce(sum(scoped_runs.valid_rows), 0)::integer as valid_rows,
	coalesce(sum(scoped_runs.correlated_rows), 0)::integer as correlated_rows,
	coalesce(sum(scoped_runs.unmatched_rows), 0)::integer as unmatched_rows,
	coalesce(sum(coalesce(duplicate_rows.duplicate_rows, 0)), 0)::integer as duplicate_rows,
	coalesce(sum(scoped_runs.warning_rows), 0)::integer as warning_rows,
	round(coalesce((sum(scoped_runs.correlated_rows)::numeric / nullif(sum(scoped_runs.valid_rows), 0)) * 100, 0), 2) as correlation_rate,
	round(coalesce((sum(scoped_runs.unmatched_rows)::numeric / nullif(sum(scoped_runs.valid_rows), 0)) * 100, 0), 2) as unmatched_rate,
	round(coalesce((sum(coalesce(duplicate_rows.duplicate_rows, 0))::numeric / nullif(sum(scoped_runs.processed_rows), 0)) * 100, 0), 2) as duplicate_rate,
	round(coalesce((sum(scoped_runs.warning_rows)::numeric / nullif(sum(scoped_runs.processed_rows), 0)) * 100, 0), 2) as warning_rate
from scoped_runs
left join duplicate_rows
	on duplicate_rows.import_job_id = scoped_runs.id;

create materialized view public.operational_metrics_cache
as
select
	now() as refreshed_at,
	operational_summary.generated_at as operational_generated_at,
	operational_summary.window_days as operational_window_days,
	operational_summary.total_beneficiaries,
	operational_summary.effective_beneficiaries,
	operational_summary.pending_beneficiaries,
	operational_summary.overdue_beneficiaries,
	operational_summary.urgent_beneficiaries,
	operational_summary.stale_beneficiary_count,
	operational_summary.avg_aging_days,
	operational_summary.avg_overdue_days,
	operational_summary.effective_coverage,
	operational_summary.pending_coverage,
	operational_summary.overdue_coverage,
	operational_summary.urgent_coverage,
	operational_summary.successful_followups,
	operational_summary.failed_followups,
	operational_summary.effective_contact_rate,
	operational_summary.beneficiaries_without_active_operator,
	import_quality.generated_at as import_generated_at,
	import_quality.window_days as import_window_days,
	import_quality.import_runs,
	import_quality.processed_rows,
	import_quality.valid_rows,
	import_quality.correlated_rows,
	import_quality.unmatched_rows,
	import_quality.duplicate_rows,
	import_quality.warning_rows,
	import_quality.correlation_rate,
	import_quality.unmatched_rate,
	import_quality.duplicate_rate,
	import_quality.warning_rate
from public.v_operational_kpi_summary_runtime as operational_summary
cross join public.v_import_quality_kpi_runtime as import_quality
with no data;

create unique index idx_operational_metrics_cache_singleton
	on public.operational_metrics_cache ((true));

create or replace view public.v_kpi_daily_snapshot_history
with (security_invoker = true)
as
select
	snapshot.id,
	snapshot.snapshot_date,
	snapshot.scope_type,
	snapshot.operator_profile_id,
	coalesce(profile.full_name, profile.email) as operator_name,
	snapshot.total_beneficiaries,
	snapshot.effective_beneficiaries,
	snapshot.pending_beneficiaries,
	snapshot.overdue_beneficiaries,
	snapshot.urgent_beneficiaries,
	snapshot.stale_beneficiary_count,
	snapshot.avg_aging_days,
	snapshot.avg_overdue_days,
	snapshot.successful_followups,
	snapshot.failed_followups,
	snapshot.effective_coverage,
	snapshot.pending_coverage,
	snapshot.overdue_coverage,
	snapshot.urgent_coverage,
	snapshot.effective_contact_rate,
	snapshot.operator_effectiveness_rate,
	snapshot.correlation_rate,
	snapshot.unmatched_rate,
	snapshot.duplicate_rate,
	snapshot.warning_rate,
	snapshot.window_days,
	snapshot.metadata,
	snapshot.created_at
from public.kpi_daily_snapshots as snapshot
left join public.profiles as profile
	on profile.id = snapshot.operator_profile_id;

create or replace function public.get_operational_kpi_summary(
	p_reference_date date default current_date,
	p_window_days integer default 30
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
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar KPIs operacionales';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('teleoperadora', 'admin', 'super_admin') then
		raise exception 'No autorizado para consultar KPIs operacionales';
	end if;

	return (
		with scoped_beneficiaries as (
			select beneficiary.*
			from public.v_operational_kpi_beneficiary_runtime as beneficiary
			where case
				when v_requester_role = 'teleoperadora' then exists (
					select 1
					from public.beneficiary_assignments as assignment
					where assignment.beneficiary_id = beneficiary.beneficiary_id
						and assignment.assigned_user_id = v_requester_id
						and assignment.status = 'active'
						and assignment.starts_at <= now()
						and (assignment.ends_at is null or assignment.ends_at >= now())
				)
				else true
			end
		),
		scoped_activity as (
			select
				count(*) filter (
					where fe.is_effective_contact = true
						and fe.event_type <> 'internal_note'
				)::integer as successful_followups,
				count(*) filter (
					where fe.is_effective_contact = false
						and fe.event_type <> 'internal_note'
				)::integer as failed_followups
			from public.followup_events as fe
			join scoped_beneficiaries as beneficiary
				on beneficiary.beneficiary_id = fe.beneficiary_id
			where coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at)
				>= (p_reference_date::timestamptz - make_interval(days => v_window_days))
				and coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at)
				< (p_reference_date::timestamptz + interval '1 day')
		)
		select jsonb_build_object(
			'referenceDate', p_reference_date,
			'windowDays', v_window_days,
			'scope', case when v_requester_role = 'teleoperadora' then 'own_portfolio' else 'global' end,
			'totalBeneficiaries', count(*)::integer,
			'effectiveBeneficiaries', count(*) filter (where effective_coverage)::integer,
			'pendingBeneficiaries', count(*) filter (where pending_coverage)::integer,
			'overdueBeneficiaries', count(*) filter (where overdue_coverage)::integer,
			'urgentBeneficiaries', count(*) filter (where urgent_coverage)::integer,
			'staleBeneficiaries', count(*) filter (where stale_beneficiary)::integer,
			'effectiveCoverage', round(coalesce((count(*) filter (where effective_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2),
			'pendingCoverage', round(coalesce((count(*) filter (where pending_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2),
			'overdueCoverage', round(coalesce((count(*) filter (where overdue_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2),
			'urgentCoverage', round(coalesce((count(*) filter (where urgent_coverage)::numeric / nullif(count(*), 0)) * 100, 0), 2),
			'avgAgingDays', round(coalesce(avg(aging_days)::numeric, 0), 2),
			'avgOverdueDays', round(coalesce(avg(overdue_days) filter (where overdue_days is not null)::numeric, 0), 2),
			'successfulFollowups', scoped_activity.successful_followups,
			'failedFollowups', scoped_activity.failed_followups,
			'effectiveContactRate', round(
				coalesce(
					(scoped_activity.successful_followups::numeric / nullif(scoped_activity.successful_followups + scoped_activity.failed_followups, 0)) * 100,
					0
				),
				2
			)
		)
		from scoped_beneficiaries
		cross join scoped_activity
		group by scoped_activity.successful_followups, scoped_activity.failed_followups
	);
end;
$$;

create or replace function public.get_operator_kpi_summary(
	p_reference_date date default current_date,
	p_window_days integer default 30
)
returns table (
	operator_profile_id uuid,
	operator_name text,
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
	operator_effectiveness_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_window_days integer := greatest(coalesce(p_window_days, 30), 1);
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar KPIs por operadora';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('teleoperadora', 'admin', 'super_admin') then
		raise exception 'No autorizado para consultar KPIs por operadora';
	end if;

	return query
	with scoped_operators as (
		select
			profile.id as operator_profile_id,
			coalesce(profile.full_name, profile.email) as operator_name
		from public.profiles as profile
		where profile.role = 'teleoperadora'
			and profile.is_active = true
			and case
				when v_requester_role = 'teleoperadora' then profile.id = v_requester_id
				else true
			end
	),
	scoped_beneficiaries as (
		select beneficiary.*
		from public.v_operational_kpi_beneficiary_runtime as beneficiary
		where beneficiary.assigned_operator_profile_id is not null
			and beneficiary.assigned_operator_role = 'teleoperadora'::public.user_role
			and beneficiary.assigned_operator_is_active = true
			and case
				when v_requester_role = 'teleoperadora' then beneficiary.assigned_operator_profile_id = v_requester_id
				else true
			end
	),
	operator_activity as (
		select
			coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id) as activity_operator_profile_id,
			count(*) filter (
				where fe.is_effective_contact = true
					and fe.event_type <> 'internal_note'
			)::integer as successful_followups,
			count(*) filter (
				where fe.is_effective_contact = false
					and fe.event_type <> 'internal_note'
			)::integer as failed_followups
		from public.followup_events as fe
		join public.profiles as actor
			on actor.id = coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id)
		where actor.role = 'teleoperadora'
			and actor.is_active = true
			and coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at)
				>= (p_reference_date::timestamptz - make_interval(days => v_window_days))
			and coalesce(fe.event_timestamp, fe.occurred_at, fe.created_at)
				< (p_reference_date::timestamptz + interval '1 day')
			and case
				when v_requester_role = 'teleoperadora' then coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id) = v_requester_id
				else true
			end
		group by coalesce(fe.operator_profile_id, fe.created_by, fe.assigned_user_id)
	)
	select
		operator.operator_profile_id,
		operator.operator_name,
		count(beneficiary.beneficiary_id)::integer as total_beneficiaries,
		count(*) filter (where beneficiary.effective_coverage)::integer as effective_beneficiaries,
		count(*) filter (where beneficiary.pending_coverage)::integer as pending_beneficiaries,
		count(*) filter (where beneficiary.overdue_coverage)::integer as overdue_beneficiaries,
		count(*) filter (where beneficiary.urgent_coverage)::integer as urgent_beneficiaries,
		count(*) filter (where beneficiary.stale_beneficiary)::integer as stale_beneficiary_count,
		round(coalesce(avg(beneficiary.aging_days)::numeric, 0), 2) as avg_aging_days,
		round(coalesce(avg(beneficiary.overdue_days) filter (where beneficiary.overdue_days is not null)::numeric, 0), 2) as avg_overdue_days,
		round(coalesce((count(*) filter (where beneficiary.effective_coverage)::numeric / nullif(count(beneficiary.beneficiary_id), 0)) * 100, 0), 2) as effective_coverage,
		round(coalesce((count(*) filter (where beneficiary.pending_coverage)::numeric / nullif(count(beneficiary.beneficiary_id), 0)) * 100, 0), 2) as pending_coverage,
		round(coalesce((count(*) filter (where beneficiary.overdue_coverage)::numeric / nullif(count(beneficiary.beneficiary_id), 0)) * 100, 0), 2) as overdue_coverage,
		round(coalesce((count(*) filter (where beneficiary.urgent_coverage)::numeric / nullif(count(beneficiary.beneficiary_id), 0)) * 100, 0), 2) as urgent_coverage,
		coalesce(operator_activity.successful_followups, 0) as successful_followups,
		coalesce(operator_activity.failed_followups, 0) as failed_followups,
		round(
			coalesce(
				(operator_activity.successful_followups::numeric / nullif(operator_activity.successful_followups + operator_activity.failed_followups, 0)) * 100,
				0
			),
			2
		) as operator_effectiveness_rate
	from scoped_operators as operator
	left join scoped_beneficiaries as beneficiary
		on beneficiary.assigned_operator_profile_id = operator.operator_profile_id
	left join operator_activity
		on operator_activity.activity_operator_profile_id = operator.operator_profile_id
	group by operator.operator_profile_id, operator.operator_name, operator_activity.successful_followups, operator_activity.failed_followups
	order by overdue_coverage desc, urgent_beneficiaries desc, operator_name asc;
end;
$$;

create or replace function public.get_import_quality_kpis(
	p_days integer default 30
)
returns jsonb
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
		raise exception 'No autorizado para consultar KPIs de importacion';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar KPIs de importacion';
	end if;

	return (
		with scoped_runs as (
			select
				ir.id,
				ir.started_at,
				ir.processed_rows,
				ir.valid_rows,
				ir.correlated_rows,
				ir.warning_rows,
				greatest(coalesce((ir.metadata->>'unmatchedRows')::integer, 0), 0) as unmatched_rows
			from public.import_runs as ir
			where ir.import_type = 'call_logs_import'
				and ir.started_at >= date_trunc('day', now()) - make_interval(days => v_days)
		),
		duplicate_rows as (
			select
				issue.import_job_id,
				count(*)::integer as duplicate_rows
			from public.call_log_correlation_issues as issue
			where issue.issue_type = 'duplicate_call'
			group by issue.import_job_id
		)
		select jsonb_build_object(
			'windowDays', v_days,
			'importRuns', count(*)::integer,
			'processedRows', coalesce(sum(scoped_runs.processed_rows), 0)::integer,
			'validRows', coalesce(sum(scoped_runs.valid_rows), 0)::integer,
			'correlatedRows', coalesce(sum(scoped_runs.correlated_rows), 0)::integer,
			'unmatchedRows', coalesce(sum(scoped_runs.unmatched_rows), 0)::integer,
			'duplicateRows', coalesce(sum(coalesce(duplicate_rows.duplicate_rows, 0)), 0)::integer,
			'warningRows', coalesce(sum(scoped_runs.warning_rows), 0)::integer,
			'correlationRate', round(coalesce((sum(scoped_runs.correlated_rows)::numeric / nullif(sum(scoped_runs.valid_rows), 0)) * 100, 0), 2),
			'unmatchedRate', round(coalesce((sum(scoped_runs.unmatched_rows)::numeric / nullif(sum(scoped_runs.valid_rows), 0)) * 100, 0), 2),
			'duplicateRate', round(coalesce((sum(coalesce(duplicate_rows.duplicate_rows, 0))::numeric / nullif(sum(scoped_runs.processed_rows), 0)) * 100, 0), 2),
			'warningRate', round(coalesce((sum(scoped_runs.warning_rows)::numeric / nullif(sum(scoped_runs.processed_rows), 0)) * 100, 0), 2)
		)
		from scoped_runs
		left join duplicate_rows
			on duplicate_rows.import_job_id = scoped_runs.id
	);
end;
$$;

create or replace function public.get_overdue_beneficiaries(
	p_limit integer default 100
)
returns table (
	beneficiary_id uuid,
	beneficiary_name text,
	beneficiary_rut text,
	coverage_state public.follow_up_coverage_state,
	aging_days integer,
	overdue_days integer,
	stale_beneficiary boolean,
	last_effective_followup_at timestamptz,
	assigned_operator_profile_id uuid,
	assigned_operator_name text,
	priority_rank integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_limit integer := greatest(coalesce(p_limit, 100), 1);
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar cartera vencida';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('teleoperadora', 'admin', 'super_admin') then
		raise exception 'No autorizado para consultar cartera vencida';
	end if;

	return query
	select
		beneficiary.beneficiary_id,
		beneficiary.beneficiary_name,
		beneficiary.beneficiary_rut,
		beneficiary.coverage_state,
		beneficiary.aging_days,
		beneficiary.overdue_days,
		beneficiary.stale_beneficiary,
		beneficiary.last_effective_followup_at,
		beneficiary.assigned_operator_profile_id,
		beneficiary.assigned_operator_name,
		beneficiary.priority_rank
	from public.v_operational_kpi_beneficiary_runtime as beneficiary
	where beneficiary.stale_beneficiary = true
		and case
			when v_requester_role = 'teleoperadora' then exists (
				select 1
				from public.beneficiary_assignments as assignment
				where assignment.beneficiary_id = beneficiary.beneficiary_id
					and assignment.assigned_user_id = v_requester_id
					and assignment.status = 'active'
					and assignment.starts_at <= now()
					and (assignment.ends_at is null or assignment.ends_at >= now())
			)
			else true
		end
	order by beneficiary.priority_rank asc, beneficiary.overdue_days desc nulls last, beneficiary.aging_days desc nulls last, beneficiary.beneficiary_name asc
	limit v_limit;
end;
$$;

create or replace function public.capture_kpi_daily_snapshot(
	p_snapshot_date date default current_date,
	p_window_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_window_days integer := greatest(coalesce(p_window_days, 30), 1);
	v_rows_upserted integer := 0;
	v_last_row_count integer := 0;
	v_import_quality jsonb;
	v_operational_summary jsonb;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para capturar snapshots KPI';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden capturar snapshots KPI';
	end if;

	v_import_quality := public.get_import_quality_kpis(v_window_days);
	v_operational_summary := public.get_operational_kpi_summary(p_snapshot_date, v_window_days);

	insert into public.kpi_daily_snapshots (
		snapshot_date,
		scope_type,
		operator_profile_id,
		total_beneficiaries,
		effective_beneficiaries,
		pending_beneficiaries,
		overdue_beneficiaries,
		urgent_beneficiaries,
		stale_beneficiary_count,
		avg_aging_days,
		avg_overdue_days,
		successful_followups,
		failed_followups,
		effective_coverage,
		pending_coverage,
		overdue_coverage,
		urgent_coverage,
		effective_contact_rate,
		operator_effectiveness_rate,
		correlation_rate,
		unmatched_rate,
		duplicate_rate,
		warning_rate,
		window_days,
		metadata
	)
	select
		p_snapshot_date,
		'global'::public.kpi_snapshot_scope,
		null,
		(v_operational_summary->>'totalBeneficiaries')::integer,
		(v_operational_summary->>'effectiveBeneficiaries')::integer,
		(v_operational_summary->>'pendingBeneficiaries')::integer,
		(v_operational_summary->>'overdueBeneficiaries')::integer,
		(v_operational_summary->>'urgentBeneficiaries')::integer,
		(v_operational_summary->>'staleBeneficiaries')::integer,
		(v_operational_summary->>'avgAgingDays')::numeric,
		(v_operational_summary->>'avgOverdueDays')::numeric,
		(v_operational_summary->>'successfulFollowups')::integer,
		(v_operational_summary->>'failedFollowups')::integer,
		(v_operational_summary->>'effectiveCoverage')::numeric,
		(v_operational_summary->>'pendingCoverage')::numeric,
		(v_operational_summary->>'overdueCoverage')::numeric,
		(v_operational_summary->>'urgentCoverage')::numeric,
		(v_operational_summary->>'effectiveContactRate')::numeric,
		null,
		(v_import_quality->>'correlationRate')::numeric,
		(v_import_quality->>'unmatchedRate')::numeric,
		(v_import_quality->>'duplicateRate')::numeric,
		(v_import_quality->>'warningRate')::numeric,
		v_window_days,
		jsonb_build_object(
			'capturedBy', v_requester_id,
			'source', 'get_operational_kpi_summary',
			'importQuality', v_import_quality
		)
	from (select 1) as summary
	on conflict (snapshot_date, scope_type)
	where operator_profile_id is null
	do update set
		total_beneficiaries = excluded.total_beneficiaries,
		effective_beneficiaries = excluded.effective_beneficiaries,
		pending_beneficiaries = excluded.pending_beneficiaries,
		overdue_beneficiaries = excluded.overdue_beneficiaries,
		urgent_beneficiaries = excluded.urgent_beneficiaries,
		stale_beneficiary_count = excluded.stale_beneficiary_count,
		avg_aging_days = excluded.avg_aging_days,
		avg_overdue_days = excluded.avg_overdue_days,
		successful_followups = excluded.successful_followups,
		failed_followups = excluded.failed_followups,
		effective_coverage = excluded.effective_coverage,
		pending_coverage = excluded.pending_coverage,
		overdue_coverage = excluded.overdue_coverage,
		urgent_coverage = excluded.urgent_coverage,
		effective_contact_rate = excluded.effective_contact_rate,
		correlation_rate = excluded.correlation_rate,
		unmatched_rate = excluded.unmatched_rate,
		duplicate_rate = excluded.duplicate_rate,
		warning_rate = excluded.warning_rate,
		window_days = excluded.window_days,
		metadata = excluded.metadata;

	get diagnostics v_rows_upserted = row_count;

	insert into public.kpi_daily_snapshots (
		snapshot_date,
		scope_type,
		operator_profile_id,
		total_beneficiaries,
		effective_beneficiaries,
		pending_beneficiaries,
		overdue_beneficiaries,
		urgent_beneficiaries,
		stale_beneficiary_count,
		avg_aging_days,
		avg_overdue_days,
		successful_followups,
		failed_followups,
		effective_coverage,
		pending_coverage,
		overdue_coverage,
		urgent_coverage,
		effective_contact_rate,
		operator_effectiveness_rate,
		window_days,
		metadata
	)
	select
		p_snapshot_date,
		'operator'::public.kpi_snapshot_scope,
		operator.operator_profile_id,
		operator.total_beneficiaries,
		operator.effective_beneficiaries,
		operator.pending_beneficiaries,
		operator.overdue_beneficiaries,
		operator.urgent_beneficiaries,
		operator.stale_beneficiary_count,
		operator.avg_aging_days,
		operator.avg_overdue_days,
		operator.successful_followups,
		operator.failed_followups,
		operator.effective_coverage,
		operator.pending_coverage,
		operator.overdue_coverage,
		operator.urgent_coverage,
		round(
			coalesce(
				(operator.successful_followups::numeric / nullif(operator.successful_followups + operator.failed_followups, 0)) * 100,
				0
			),
			2
		),
		operator.operator_effectiveness_rate,
		v_window_days,
		jsonb_build_object(
			'capturedBy', v_requester_id,
			'source', 'get_operator_kpi_summary'
		)
	from public.get_operator_kpi_summary(p_snapshot_date, v_window_days) as operator
	on conflict (snapshot_date, scope_type, operator_profile_id)
	where operator_profile_id is not null
	do update set
		total_beneficiaries = excluded.total_beneficiaries,
		effective_beneficiaries = excluded.effective_beneficiaries,
		pending_beneficiaries = excluded.pending_beneficiaries,
		overdue_beneficiaries = excluded.overdue_beneficiaries,
		urgent_beneficiaries = excluded.urgent_beneficiaries,
		stale_beneficiary_count = excluded.stale_beneficiary_count,
		avg_aging_days = excluded.avg_aging_days,
		avg_overdue_days = excluded.avg_overdue_days,
		successful_followups = excluded.successful_followups,
		failed_followups = excluded.failed_followups,
		effective_coverage = excluded.effective_coverage,
		pending_coverage = excluded.pending_coverage,
		overdue_coverage = excluded.overdue_coverage,
		urgent_coverage = excluded.urgent_coverage,
		effective_contact_rate = excluded.effective_contact_rate,
		operator_effectiveness_rate = excluded.operator_effectiveness_rate,
		window_days = excluded.window_days,
		metadata = excluded.metadata;

	get diagnostics v_last_row_count = row_count;
	v_rows_upserted := v_rows_upserted + v_last_row_count;

	return v_rows_upserted;
end;
$$;

create or replace function public.refresh_operational_metrics_cache()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_refreshed_at timestamptz := now();
begin
	if v_requester_id is null then
		raise exception 'No autorizado para refrescar cache operacional';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden refrescar cache operacional';
	end if;

	refresh materialized view public.operational_metrics_cache;

	return v_refreshed_at;
end;
$$;

comment on view public.v_operational_kpi_beneficiary_runtime
	is 'Canonical beneficiary-level KPI runtime layer derived from v_operational_follow_up_workspace without frontend KPI logic.';

comment on view public.v_operational_kpi_summary_runtime
	is 'Canonical operational KPI summary runtime layer for the live operation.';

comment on view public.v_operator_kpi_summary_runtime
	is 'Canonical operator-level KPI runtime layer for active teleoperadoras only.';

comment on view public.v_import_quality_kpi_runtime
	is 'Canonical import quality KPI runtime layer sourced from import_runs and call_log_correlation_issues.';

comment on materialized view public.operational_metrics_cache
	is 'Optional administrative KPI cache for future dashboards. Must be refreshed explicitly.';

comment on table public.kpi_daily_snapshots
	is 'Prospective daily KPI snapshots for historical trend analysis. Does not reconstruct past states retroactively.';

revoke all on function public.get_operational_kpi_summary(date, integer) from public;
revoke all on function public.get_operator_kpi_summary(date, integer) from public;
revoke all on function public.get_import_quality_kpis(integer) from public;
revoke all on function public.get_overdue_beneficiaries(integer) from public;
revoke all on function public.capture_kpi_daily_snapshot(date, integer) from public;
revoke all on function public.refresh_operational_metrics_cache() from public;

grant select on public.v_operational_kpi_beneficiary_runtime to authenticated;
grant select on public.v_operational_kpi_summary_runtime to authenticated;
grant select on public.v_operator_kpi_summary_runtime to authenticated;
grant select on public.v_import_quality_kpi_runtime to authenticated;
grant select on public.v_kpi_daily_snapshot_history to authenticated;

grant execute on function public.get_operational_kpi_summary(date, integer) to authenticated;
grant execute on function public.get_operator_kpi_summary(date, integer) to authenticated;
grant execute on function public.get_import_quality_kpis(integer) to authenticated;
grant execute on function public.get_overdue_beneficiaries(integer) to authenticated;
grant execute on function public.capture_kpi_daily_snapshot(date, integer) to authenticated;
grant execute on function public.refresh_operational_metrics_cache() to authenticated;