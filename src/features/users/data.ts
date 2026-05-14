import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/lib/types'

import type {
  UserDirectoryFilters,
  UserEditPermission,
  UserOperationalProfile,
  UserUpdateInput,
} from '@/features/users/types'

export const userRoleLabels: Record<UserRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  teleoperadora: 'Teleoperadora',
}

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado.')
  }

  return supabase
}

function sanitizeSearchTerm(value: string) {
  return value.trim().replaceAll(',', ' ')
}

export function getOperationalUserName(profile: UserOperationalProfile) {
  return profile.full_name?.trim() || profile.email
}

export function hasPendingVisibleName(profile: UserOperationalProfile) {
  return !profile.full_name?.trim()
}

export function getUserEditPermission(
  actorRole: UserRole,
  target: UserOperationalProfile,
): UserEditPermission {
  if (actorRole === 'super_admin') {
    return {
      canEdit: true,
      reason: null,
    }
  }

  if (target.role === 'super_admin') {
    return {
      canEdit: false,
      reason: 'Los perfiles super admin solo pueden ser modificados por otro super admin.',
    }
  }

  return {
    canEdit: false,
    reason: 'Tu rol tiene acceso de consulta. La edicion operacional sigue reservada a super admin por la RLS actual.',
  }
}

export async function fetchOperationalUsers(filters: UserDirectoryFilters) {
  let query = assertSupabase()
    .from('profiles')
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .order('created_at', { ascending: false })

  const normalizedQuery = sanitizeSearchTerm(filters.query)

  if (normalizedQuery) {
    query = query.or(`full_name.ilike.%${normalizedQuery}%,email.ilike.%${normalizedQuery}%`)
  }

  if (filters.role !== 'all') {
    query = query.eq('role', filters.role)
  }

  if (filters.state === 'active') {
    query = query.eq('is_active', true)
  }

  if (filters.state === 'inactive') {
    query = query.eq('is_active', false)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data as UserOperationalProfile[] | null) ?? []
}

export async function updateOperationalUser(
  actorRole: UserRole,
  userId: string,
  input: UserUpdateInput,
) {
  if (actorRole !== 'super_admin') {
    throw new Error('Solo super admin puede editar perfiles en la configuracion actual.')
  }

  const { data, error } = await assertSupabase()
    .from('profiles')
    .update({
      full_name: input.fullName.trim() || null,
      role: input.role,
      is_active: input.isActive,
    })
    .eq('id', userId)
    .select('id, email, full_name, role, is_active, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  return data as UserOperationalProfile
}