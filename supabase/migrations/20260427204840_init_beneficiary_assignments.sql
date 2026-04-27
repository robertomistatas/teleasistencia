-- =============================================
-- init_beneficiary_assignments
-- Base estructural inicial de asignaciones
-- operativas de cartera.
-- =============================================

-- 1) Enum de tipos de asignación.
create type public.beneficiary_assignment_type as enum (
	'primary',
	'temporary',
	'support'
);

-- 2) Enum de estado de asignación.
create type public.beneficiary_assignment_status as enum (
	'active',
	'ended',
	'inactive'
);

-- 3) Enum de origen de asignación.
create type public.beneficiary_assignment_source as enum (
	'manual',
	'import',
	'system'
);

-- 4) Tabla principal de asignaciones.
create table public.beneficiary_assignments (
	id uuid primary key default gen_random_uuid(),
	beneficiary_id uuid not null references public.beneficiaries (id) on delete cascade,
	assigned_user_id uuid not null references public.profiles (id) on delete restrict,
	assignment_type public.beneficiary_assignment_type not null default 'primary',
	status public.beneficiary_assignment_status not null default 'active',
	starts_at timestamptz not null default now(),
	ends_at timestamptz,
	source public.beneficiary_assignment_source not null default 'manual',
	source_run_id uuid,
	source_row_id uuid,
	created_by uuid references public.profiles (id),
	updated_by uuid references public.profiles (id),
	notes text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint beneficiary_assignments_ends_at_check check (ends_at is null or ends_at >= starts_at)
);

-- 5) Trigger para mantener updated_at.
create trigger beneficiary_assignments_set_updated_at
	before update on public.beneficiary_assignments
	for each row
	execute function public.set_updated_at();

-- 6) Índices de soporte para consultas habituales.
create index idx_beneficiary_assignments_beneficiary_id
	on public.beneficiary_assignments (beneficiary_id);
create index idx_beneficiary_assignments_assigned_user_id
	on public.beneficiary_assignments (assigned_user_id);
create index idx_beneficiary_assignments_status
	on public.beneficiary_assignments (status);
create index idx_beneficiary_assignments_assignment_type
	on public.beneficiary_assignments (assignment_type);
create index idx_beneficiary_assignments_beneficiary_status_type
	on public.beneficiary_assignments (beneficiary_id, status, assignment_type);

-- 7) Índices únicos parciales para consistencia operativa.
create unique index idx_beneficiary_assignments_active_primary_unique
	on public.beneficiary_assignments (beneficiary_id)
	where status = 'active' and assignment_type = 'primary';

create unique index idx_beneficiary_assignments_active_exact_unique
	on public.beneficiary_assignments (beneficiary_id, assigned_user_id, assignment_type)
	where status = 'active';

-- 8) Activación de RLS.
alter table public.beneficiary_assignments enable row level security;

-- 9) Policies de lectura.
create policy "beneficiary_assignments_select_admin_super_admin"
	on public.beneficiary_assignments
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_assignments_select_teleoperadora_own"
	on public.beneficiary_assignments
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) = 'teleoperadora'
		and assigned_user_id = (select auth.uid())
	);

-- 10) Policies de escritura.
create policy "beneficiary_assignments_insert_admin_super_admin"
	on public.beneficiary_assignments
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_assignments_update_admin_super_admin"
	on public.beneficiary_assignments
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);
