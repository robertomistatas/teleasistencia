-- =============================================
-- init_profiles
-- Base estructural inicial para usuarios y roles.
-- Incluye enum de roles, tabla profiles, automatización
-- desde auth.users, función de lectura de rol, RLS y
-- políticas mínimas de acceso.
-- =============================================

-- 1) Enum de roles del sistema.
create type public.user_role as enum (
	'super_admin',
	'admin',
	'teleoperadora'
);

-- 2) Tabla de perfiles de usuario enlazada 1:1 con auth.users.
create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	email text not null,
	role public.user_role not null default 'teleoperadora',
	full_name text,
	is_active boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfiles de usuario sincronizados con auth.users.';
comment on column public.profiles.role is 'Rol operacional del usuario dentro del sistema.';

-- 2.1) Trigger function genérica para mantener updated_at.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

comment on function public.set_updated_at() is 'Actualiza automáticamente updated_at antes de cada update.';

-- 3) Función auxiliar para obtener el rol de cualquier usuario.
-- Se define como SECURITY DEFINER para poder usarse en políticas RLS
-- sin depender de permisos de lectura directos sobre profiles.
create function public.get_user_role(uid uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
	select p.role
	from public.profiles as p
	where p.id = uid
$$;

comment on function public.get_user_role(uuid) is 'Retorna el rol del usuario a partir de su profile.';

-- 4) Trigger function para crear automáticamente el profile
-- cuando se inserta un nuevo usuario en auth.users.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.profiles (id, email)
	values (
		new.id,
		coalesce(new.email, '')
	)
	on conflict (id) do nothing;

	return new;
end;
$$;

comment on function public.handle_new_auth_user() is 'Crea un profile automáticamente al registrarse un usuario en auth.users.';

-- 4.1) Backfill inicial para usuarios ya existentes en auth.users.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '')
from auth.users as u
on conflict (id) do nothing;

create trigger on_auth_user_created
	after insert on auth.users
	for each row
	execute function public.handle_new_auth_user();

create trigger profiles_set_updated_at
	before update on public.profiles
	for each row
	execute function public.set_updated_at();

-- 5) Activación de RLS.
alter table public.profiles enable row level security;

-- 6) Políticas básicas de acceso.
-- Cada usuario autenticado puede leer su propio profile.
create policy "profiles_select_own"
	on public.profiles
	for select
	to authenticated
	using ((select auth.uid()) = id);

-- Roles administrativos pueden leer todos los profiles.
create policy "profiles_select_admin_all"
	on public.profiles
	for select
	to authenticated
	using (public.get_user_role((select auth.uid())) = 'admin');

create policy "profiles_select_super_admin_all"
	on public.profiles
	for select
	to authenticated
	using (public.get_user_role((select auth.uid())) = 'super_admin');

-- En esta base inicial, solo super_admin puede actualizar profiles,
-- incluyendo el campo role.
create policy "profiles_update_super_admin"
	on public.profiles
	for update
	to authenticated
	using (public.get_user_role((select auth.uid())) = 'super_admin')
	with check (public.get_user_role((select auth.uid())) = 'super_admin');

-- 7) Índices de soporte para consultas habituales.
create index idx_profiles_role on public.profiles (role);
create index idx_profiles_email_lower on public.profiles (lower(email));
