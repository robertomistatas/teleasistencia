drop policy if exists "followup_events_select_teleoperadora_active_assignment"
	on public.followup_events;

create policy "followup_events_select_teleoperadora_active_assignment"
	on public.followup_events
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) = 'teleoperadora'
		and exists (
			select 1
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = public.followup_events.beneficiary_id
				and ba.assigned_user_id = (select auth.uid())
				and ba.status = 'active'
				and ba.starts_at <= now()
				and (ba.ends_at is null or ba.ends_at >= now())
		)
	);

drop policy if exists "followup_events_insert_teleoperadora_manual_own_assignment"
	on public.followup_events;

create policy "followup_events_insert_teleoperadora_manual_own_assignment"
	on public.followup_events
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) = 'teleoperadora'
		and source = 'manual'
		and created_by = (select auth.uid())
		and exists (
			select 1
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = public.followup_events.beneficiary_id
				and ba.assigned_user_id = (select auth.uid())
				and ba.status = 'active'
				and ba.starts_at <= now()
				and (ba.ends_at is null or ba.ends_at >= now())
		)
	);

drop policy if exists "beneficiary_followup_status_select_teleoperadora_active_assignment"
	on public.beneficiary_followup_status;

create policy "beneficiary_followup_status_select_teleoperadora_active_assignment"
	on public.beneficiary_followup_status
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) = 'teleoperadora'
		and exists (
			select 1
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = public.beneficiary_followup_status.beneficiary_id
				and ba.assigned_user_id = (select auth.uid())
				and ba.status = 'active'
				and ba.starts_at <= now()
				and (ba.ends_at is null or ba.ends_at >= now())
		)
	);

drop policy if exists "call_interactions_select_teleoperadora_active_assignment"
	on public.call_interactions;

create policy "call_interactions_select_teleoperadora_active_assignment"
	on public.call_interactions
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) = 'teleoperadora'
		and exists (
			select 1
			from public.beneficiary_assignments as ba
			where ba.beneficiary_id = public.call_interactions.beneficiary_id
				and ba.assigned_user_id = (select auth.uid())
				and ba.status = 'active'
				and ba.starts_at <= now()
				and (ba.ends_at is null or ba.ends_at >= now())
		)
	);