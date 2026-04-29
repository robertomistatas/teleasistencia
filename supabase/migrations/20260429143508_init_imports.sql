-- =============================================
-- init_imports
-- Base estructural para corridas de importacion
-- de beneficiarios y asignaciones.
-- Solo persiste metadata del archivo y filas
-- procesadas; no usa Supabase Storage.
-- =============================================

create type public.import_run_status as enum (
	'uploaded',
	'processing',
	'processed',
	'processed_with_errors',
	'failed',
	'cancelled'
);

create type public.import_validation_status as enum (
	'pending',
	'valid',
	'invalid'
);

create type public.import_processing_status as enum (
	'pending',
	'inserted',
	'updated',
	'skipped',
	'failed',
	'closed',
	'unchanged'
);

create type public.assignment_import_mode as enum (
	'replace_portfolio',
	'incremental'
);

create table public.beneficiary_import_runs (
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
	notes text,
	finished_at timestamptz
);

create table public.beneficiary_import_rows (
	id uuid primary key default gen_random_uuid(),
	run_id uuid not null references public.beneficiary_import_runs (id) on delete cascade,
	row_number integer not null check (row_number > 0),
	raw_payload jsonb not null default '{}'::jsonb,
	rut_raw text,
	rut_normalized text,
	full_name_raw text,
	phone_raw text,
	phone_normalized text,
	tipo_telefono_raw text,
	contact_type public.contact_type,
	validation_status public.import_validation_status not null default 'pending',
	processing_status public.import_processing_status not null default 'pending',
	error_messages jsonb not null default '[]'::jsonb,
	beneficiary_id uuid references public.beneficiaries (id) on delete set null,
	beneficiary_contact_id uuid references public.beneficiary_contacts (id) on delete set null,
	created_at timestamptz not null default now(),
	processed_at timestamptz,
	unique (run_id, row_number)
);

create table public.assignment_import_runs (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	created_by uuid not null references public.profiles (id) on delete restrict,
	assigned_user_id uuid not null references public.profiles (id) on delete restrict,
	file_name text not null,
	mode public.assignment_import_mode not null default 'replace_portfolio',
	status public.import_run_status not null default 'uploaded',
	total_rows integer not null default 0 check (total_rows >= 0),
	valid_rows integer not null default 0 check (valid_rows >= 0),
	error_rows integer not null default 0 check (error_rows >= 0),
	inserted_rows integer not null default 0 check (inserted_rows >= 0),
	updated_rows integer not null default 0 check (updated_rows >= 0),
	skipped_rows integer not null default 0 check (skipped_rows >= 0),
	closed_rows integer not null default 0 check (closed_rows >= 0),
	notes text,
	finished_at timestamptz
);

create table public.assignment_import_rows (
	id uuid primary key default gen_random_uuid(),
	run_id uuid not null references public.assignment_import_runs (id) on delete cascade,
	row_number integer not null check (row_number > 0),
	raw_payload jsonb not null default '{}'::jsonb,
	rut_raw text,
	rut_normalized text,
	full_name_raw text,
	beneficiary_id uuid references public.beneficiaries (id) on delete set null,
	current_assignment_id uuid references public.beneficiary_assignments (id) on delete set null,
	new_assignment_id uuid references public.beneficiary_assignments (id) on delete set null,
	validation_status public.import_validation_status not null default 'pending',
	processing_status public.import_processing_status not null default 'pending',
	error_messages jsonb not null default '[]'::jsonb,
	created_at timestamptz not null default now(),
	processed_at timestamptz,
	unique (run_id, row_number)
);

create index idx_beneficiary_import_runs_created_at_desc
	on public.beneficiary_import_runs (created_at desc);
create index idx_beneficiary_import_runs_created_by
	on public.beneficiary_import_runs (created_by);
create index idx_beneficiary_import_runs_status
	on public.beneficiary_import_runs (status);

create index idx_beneficiary_import_rows_run_id
	on public.beneficiary_import_rows (run_id);
create index idx_beneficiary_import_rows_rut_normalized
	on public.beneficiary_import_rows (rut_normalized);
create index idx_beneficiary_import_rows_phone_normalized
	on public.beneficiary_import_rows (phone_normalized);
create index idx_beneficiary_import_rows_validation_status
	on public.beneficiary_import_rows (validation_status);
create index idx_beneficiary_import_rows_processing_status
	on public.beneficiary_import_rows (processing_status);

create index idx_assignment_import_runs_created_at_desc
	on public.assignment_import_runs (created_at desc);
create index idx_assignment_import_runs_created_by
	on public.assignment_import_runs (created_by);
create index idx_assignment_import_runs_assigned_user_id
	on public.assignment_import_runs (assigned_user_id);
create index idx_assignment_import_runs_status
	on public.assignment_import_runs (status);

create index idx_assignment_import_rows_run_id
	on public.assignment_import_rows (run_id);
create index idx_assignment_import_rows_rut_normalized
	on public.assignment_import_rows (rut_normalized);
create index idx_assignment_import_rows_beneficiary_id
	on public.assignment_import_rows (beneficiary_id);
create index idx_assignment_import_rows_validation_status
	on public.assignment_import_rows (validation_status);
create index idx_assignment_import_rows_processing_status
	on public.assignment_import_rows (processing_status);

alter table public.beneficiary_import_runs enable row level security;
alter table public.beneficiary_import_rows enable row level security;
alter table public.assignment_import_runs enable row level security;
alter table public.assignment_import_rows enable row level security;

create policy "beneficiary_import_runs_select_admin_super_admin"
	on public.beneficiary_import_runs
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_import_runs_insert_admin_super_admin"
	on public.beneficiary_import_runs
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_import_runs_update_admin_super_admin"
	on public.beneficiary_import_runs
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_import_rows_select_admin_super_admin"
	on public.beneficiary_import_rows
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_import_rows_insert_admin_super_admin"
	on public.beneficiary_import_rows
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_import_rows_update_admin_super_admin"
	on public.beneficiary_import_rows
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "assignment_import_runs_select_admin_super_admin"
	on public.assignment_import_runs
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "assignment_import_runs_insert_admin_super_admin"
	on public.assignment_import_runs
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "assignment_import_runs_update_admin_super_admin"
	on public.assignment_import_runs
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "assignment_import_rows_select_admin_super_admin"
	on public.assignment_import_rows
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "assignment_import_rows_insert_admin_super_admin"
	on public.assignment_import_rows
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "assignment_import_rows_update_admin_super_admin"
	on public.assignment_import_rows
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);
