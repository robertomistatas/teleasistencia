-- =============================================
-- gate_inactive_profiles_in_auth
-- Deniega permisos operativos a perfiles inactivos
-- tanto en RLS/RPC como en autenticacion derivada.
-- =============================================

create or replace function public.get_user_role(uid uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
	select p.role
	from public.profiles as p
	where p.id = uid
		and p.is_active = true
$$;

comment on function public.get_user_role(uuid)
	is 'Retorna el rol del usuario solo si el profile esta activo.';