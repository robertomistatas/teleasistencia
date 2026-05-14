import type { Profile, UserRole } from '@/lib/types'

export type UserOperationalProfile = Profile

export type UserStateFilter = 'all' | 'active' | 'inactive'

export type UserDirectoryFilters = {
  query: string
  role: UserRole | 'all'
  state: UserStateFilter
}

export type UserUpdateInput = {
  fullName: string
  role: UserRole
  isActive: boolean
}

export type UserEditPermission = {
  canEdit: boolean
  reason: string | null
}