-- =============================================
-- init_beneficiaries
-- Base estructural inicial de beneficiarios y
-- contactos asociados.
-- =============================================

-- 1) Enum de estado del beneficiario.
create type public.beneficiary_status as enum (
	'active',
	'inactive',
	'deceased'
);

-- 2) Enum de tipos de contacto.
create type public.contact_type as enum (
	'primary_phone',
	'sim_phone',
	'app_phone',
	'emergency_contact',
	'family_contact',
	'other'
);

-- 3) Tabla principal de beneficiarios.
create table public.beneficiaries (
	id uuid primary key default gen_random_uuid(),
	rut_raw text,
	rut_normalized text,
	first_name text,
	last_name text,
	birth_date date,
	address text,
	commune text,
	region text,
	notes text,
	status public.beneficiary_status not null default 'active',
	created_by uuid references public.profiles (id),
	updated_by uuid references public.profiles (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- 4) Tabla de contactos asociados al beneficiario.
create table public.beneficiary_contacts (
	id uuid primary key default gen_random_uuid(),
	beneficiary_id uuid not null references public.beneficiaries (id) on delete cascade,
	contact_type public.contact_type not null,
	contact_name text,
	relationship text,
	phone_raw text,
	phone_normalized text,
	is_primary boolean not null default false,
	is_active boolean not null default true,
	notes text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- 5) Triggers para mantener updated_at.
create trigger beneficiaries_set_updated_at
	before update on public.beneficiaries
	for each row
	execute function public.set_updated_at();

create trigger beneficiary_contacts_set_updated_at
	before update on public.beneficiary_contacts
	for each row
	execute function public.set_updated_at();

-- 6) Índices de soporte para consultas habituales.
create index idx_beneficiaries_rut_normalized on public.beneficiaries (rut_normalized);
create unique index idx_beneficiaries_rut_normalized_unique
	on public.beneficiaries (rut_normalized)
	where rut_normalized is not null and rut_normalized <> '';
create index idx_beneficiaries_status on public.beneficiaries (status);
create index idx_beneficiary_contacts_beneficiary_id on public.beneficiary_contacts (beneficiary_id);
create index idx_beneficiary_contacts_phone_normalized on public.beneficiary_contacts (phone_normalized);

-- 7) Activación de RLS.
alter table public.beneficiaries enable row level security;
alter table public.beneficiary_contacts enable row level security;

-- Policies iniciales: admin, super_admin y teleoperadora
-- pueden ver todos los registros temporalmente.
create policy "beneficiaries_select_all_roles"
	on public.beneficiaries
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin', 'teleoperadora')
	);

create policy "beneficiaries_insert_admin_super_admin"
	on public.beneficiaries
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiaries_update_admin_super_admin"
	on public.beneficiaries
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_contacts_select_all_roles"
	on public.beneficiary_contacts
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin', 'teleoperadora')
	);

create policy "beneficiary_contacts_insert_admin_super_admin"
	on public.beneficiary_contacts
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "beneficiary_contacts_update_admin_super_admin"
	on public.beneficiary_contacts
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);
