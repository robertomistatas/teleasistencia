import { Badge } from '@/components/ui'
import { userRoleLabels } from '@/features/users/data'
import type { UserOperationalProfile } from '@/features/users/types'
import { cn } from '@/lib/cn'
import type { UserRole } from '@/lib/types'

const roleToneByRole: Record<UserRole, 'danger' | 'info' | 'muted'> = {
  super_admin: 'danger',
  admin: 'info',
  teleoperadora: 'muted',
}

export function UserRoleBadge({ role }: { role: UserRole }) {
  return <Badge tone={roleToneByRole[role]}>{userRoleLabels[role]}</Badge>
}

export function UserStatusBadge({ is_active }: Pick<UserOperationalProfile, 'is_active'>) {
  return (
    <Badge tone={is_active ? 'success' : 'muted'}>
      {is_active ? 'Activo' : 'Inactivo'}
    </Badge>
  )
}

export function PendingNameBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warning" className={cn('normal-case tracking-normal', className)}>
      Nombre pendiente
    </Badge>
  )
}