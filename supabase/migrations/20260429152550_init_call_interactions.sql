-- =============================================
-- init_call_interactions
-- Base estructural para corridas de importacion
-- de llamadas AMAIA e interacciones telefonicas
-- normalizadas.
-- =============================================

create type public.call_direction as enum (
	'incoming',
	'outgoing',
	'unknown'
);

create type public.call_interaction_source as enum (
	'amaia_import',
	'manual',
	'system'
);

create type public.call_match_status as enum (
	'matched',
	'unmatched',
	'ambiguous'
);

create table public.call_import_runs (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	created_by uuid not null references public.profiles (id) on delete restrict,
	file_name text not null,
	status public.import_run_status not null default 'uploaded',
	total_rows integer not null default 0 check (total_rows >= 0),
	valid_rows integer not null default 0 check (valid_rows >= 0),
	error_rows integer not null default 0 check (error_rows >= 0),
	inserted_rows integer not null default 0 check (inserted_rows >= 0),
	updated_rows integer not null default 0 check (updated_rows >= 0),
	skipped_rows integer not null default 0 check (skipped_rows >= 0),
	unmatched_rows integer not null default 0 check (unmatched_rows >= 0),
	notes text,
	finished_at timestamptz
);

create table public.call_import_rows (
	id uuid primary key default gen_random_uuid(),
	run_id uuid not null references public.call_import_runs (id) on delete cascade,
	row_number integer not null check (row_number > 0),
	raw_payload jsonb not null default '{}'::jsonb,
	amaia_call_id_raw text,
	amaia_call_id text,
	fecha_raw text,
	call_date date,
	beneficiary_name_raw text,
	commune_raw text,
	event_raw text,
	direction public.call_direction not null default 'unknown',
	fono_raw text,
	fono_normalized text,
	ini_raw text,
	started_at timestamptz,
	fin_raw text,
	ended_at timestamptz,
	seg_raw text,
	duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
	resultado_raw text,
	observacion_raw text,
	api_id_raw text,
	validation_status public.import_validation_status not null default 'pending',
	processing_status public.import_processing_status not null default 'pending',
	error_messages jsonb not null default '[]'::jsonb,
	beneficiary_id uuid references public.beneficiaries (id) on delete set null,
	beneficiary_contact_id uuid references public.beneficiary_contacts (id) on delete set null,
	call_interaction_id uuid,
	created_at timestamptz not null default now(),
	processed_at timestamptz,
	unique (run_id, row_number)
);

create table public.call_interactions (
	id uuid primary key default gen_random_uuid(),
	source public.call_interaction_source not null default 'amaia_import',
	source_run_id uuid references public.call_import_runs (id) on delete set null,
	source_row_id uuid references public.call_import_rows (id) on delete set null,
	amaia_call_id text,
	api_id text,
	call_date date,
	started_at timestamptz,
	ended_at timestamptz,
	duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
	direction public.call_direction not null default 'unknown',
	phone_raw text,
	phone_normalized text,
	beneficiary_id uuid references public.beneficiaries (id) on delete set null,
	beneficiary_contact_id uuid references public.beneficiary_contacts (id) on delete set null,
	matched_status public.call_match_status not null default 'unmatched',
	is_valid_contact boolean not null default false,
	counts_as_valid_followup boolean not null default false,
	handled_by_user_id uuid references public.profiles (id) on delete set null,
	amaia_beneficiary_name_raw text,
	amaia_commune_raw text,
	amaia_result_raw text,
	amaia_observation_raw text,
	notes text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.call_import_rows
	add constraint call_import_rows_call_interaction_id_fkey
	foreign key (call_interaction_id)
	references public.call_interactions (id)
	on delete set null;

create trigger call_interactions_set_updated_at
	before update on public.call_interactions
	for each row
	execute function public.set_updated_at();

create index idx_call_import_runs_created_at_desc
	on public.call_import_runs (created_at desc);
create index idx_call_import_runs_created_by
	on public.call_import_runs (created_by);
create index idx_call_import_runs_status
	on public.call_import_runs (status);

create index idx_call_import_rows_run_id
	on public.call_import_rows (run_id);
create index idx_call_import_rows_amaia_call_id
	on public.call_import_rows (amaia_call_id);
create index idx_call_import_rows_fono_normalized
	on public.call_import_rows (fono_normalized);
create index idx_call_import_rows_beneficiary_id
	on public.call_import_rows (beneficiary_id);
create index idx_call_import_rows_beneficiary_contact_id
	on public.call_import_rows (beneficiary_contact_id);
create index idx_call_import_rows_validation_status
	on public.call_import_rows (validation_status);
create index idx_call_import_rows_processing_status
	on public.call_import_rows (processing_status);

create index idx_call_interactions_amaia_call_id
	on public.call_interactions (amaia_call_id);
create index idx_call_interactions_api_id
	on public.call_interactions (api_id);
create index idx_call_interactions_call_date
	on public.call_interactions (call_date);
create index idx_call_interactions_started_at
	on public.call_interactions (started_at);
create index idx_call_interactions_phone_normalized
	on public.call_interactions (phone_normalized);
create index idx_call_interactions_beneficiary_id
	on public.call_interactions (beneficiary_id);
create index idx_call_interactions_beneficiary_contact_id
	on public.call_interactions (beneficiary_contact_id);
create index idx_call_interactions_matched_status
	on public.call_interactions (matched_status);
create index idx_call_interactions_is_valid_contact
	on public.call_interactions (is_valid_contact);
create index idx_call_interactions_counts_as_valid_followup
	on public.call_interactions (counts_as_valid_followup);

create unique index idx_call_interactions_unique_amaia_call_id
	on public.call_interactions (amaia_call_id)
	where amaia_call_id is not null and amaia_call_id <> '';

alter table public.call_import_runs enable row level security;
alter table public.call_import_rows enable row level security;
alter table public.call_interactions enable row level security;

create policy "call_import_runs_select_admin_super_admin"
	on public.call_import_runs
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_import_runs_insert_admin_super_admin"
	on public.call_import_runs
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_import_runs_update_admin_super_admin"
	on public.call_import_runs
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_import_rows_select_admin_super_admin"
	on public.call_import_rows
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_import_rows_insert_admin_super_admin"
	on public.call_import_rows
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_import_rows_update_admin_super_admin"
	on public.call_import_rows
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_interactions_select_admin_super_admin"
	on public.call_interactions
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

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
		)
	);

create policy "call_interactions_insert_admin_super_admin"
	on public.call_interactions
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "call_interactions_update_admin_super_admin"
	on public.call_interactions
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);
