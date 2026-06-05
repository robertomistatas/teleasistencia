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