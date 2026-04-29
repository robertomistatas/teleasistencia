-- =============================================
-- init_followup_events
-- Base estructural del motor de seguimiento
-- para eventos manuales, telefonicos y estado
-- consolidado por beneficiario.
-- =============================================

create type public.followup_event_source as enum (
	'manual',
	'amaia_call',
	'system'
);

create type public.followup_event_type as enum (
	'contact_beneficiary',
	'contact_support_network',
	'no_answer',
	'phone_off',
	'wrong_number',
	'requests_help',
	'support_referral',
	'internal_note'
);

create type public.followup_status as enum (
	'up_to_date',
	'pending',
	'urgent',
	'no_data'
);

create table public.followup_events (
	id uuid primary key default gen_random_uuid(),
	beneficiary_id uuid not null references public.beneficiaries (id) on delete cascade,
	beneficiary_contact_id uuid references public.beneficiary_contacts (id) on delete set null,
	assigned_user_id uuid references public.profiles (id) on delete set null,
	created_by uuid not null references public.profiles (id) on delete restrict,
	source public.followup_event_source not null default 'manual',
	event_type public.followup_event_type not null,
	occurred_at timestamptz not null default now(),
	is_valid_followup boolean not null default false,
	requires_support boolean not null default false,
	confirmed_by_call_log boolean not null default false,
	confirmed_call_interaction_id uuid references public.call_interactions (id) on delete set null,
	call_interaction_id uuid references public.call_interactions (id) on delete set null,
	notes text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table public.beneficiary_followup_status (
	beneficiary_id uuid primary key references public.beneficiaries (id) on delete cascade,
	status public.followup_status not null default 'no_data',
	last_valid_followup_at timestamptz,
	last_valid_followup_event_id uuid references public.followup_events (id) on delete set null,
	days_since_last_valid_followup integer check (
		days_since_last_valid_followup is null or days_since_last_valid_followup >= 0
	),
	calculated_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create trigger followup_events_set_updated_at
	before update on public.followup_events
	for each row
	execute function public.set_updated_at();

create trigger beneficiary_followup_status_set_updated_at
	before update on public.beneficiary_followup_status
	for each row
	execute function public.set_updated_at();

create index idx_followup_events_beneficiary_id
	on public.followup_events (beneficiary_id);
create index idx_followup_events_beneficiary_contact_id
	on public.followup_events (beneficiary_contact_id);
create index idx_followup_events_assigned_user_id
	on public.followup_events (assigned_user_id);
create index idx_followup_events_created_by
	on public.followup_events (created_by);
create index idx_followup_events_source
	on public.followup_events (source);
create index idx_followup_events_event_type
	on public.followup_events (event_type);
create index idx_followup_events_occurred_at_desc
	on public.followup_events (occurred_at desc);
create index idx_followup_events_is_valid_followup
	on public.followup_events (is_valid_followup);
create index idx_followup_events_confirmed_by_call_log
	on public.followup_events (confirmed_by_call_log);
create index idx_followup_events_call_interaction_id
	on public.followup_events (call_interaction_id);
create index idx_followup_events_confirmed_call_interaction_id
	on public.followup_events (confirmed_call_interaction_id);

create index idx_beneficiary_followup_status_status
	on public.beneficiary_followup_status (status);
create index idx_beneficiary_followup_status_last_valid_followup_at
	on public.beneficiary_followup_status (last_valid_followup_at);
create index idx_beneficiary_followup_status_calculated_at
	on public.beneficiary_followup_status (calculated_at);

alter table public.followup_events enable row level security;
alter table public.beneficiary_followup_status enable row level security;

create policy "followup_events_select_admin_super_admin"
	on public.followup_events
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

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
		)
	);

create policy "followup_events_insert_admin_super_admin"
	on public.followup_events
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

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
		)
	);

create policy "followup_events_update_admin_super_admin"
	on public.followup_events
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_followup_status_select_admin_super_admin"
	on public.beneficiary_followup_status
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

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
		)
	);

create policy "beneficiary_followup_status_insert_admin_super_admin"
	on public.beneficiary_followup_status
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_followup_status_update_admin_super_admin"
	on public.beneficiary_followup_status
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);
