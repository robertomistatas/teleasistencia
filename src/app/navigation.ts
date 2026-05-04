import type { UserRole } from '@/lib/types'

export type NavItem = {
  label: string
  path: string
  description: string
}

export const roleNavigation: Record<UserRole, NavItem[]> = {
  super_admin: [
    {
      label: 'Inicio',
      path: '/super-admin/inicio',
      description: 'Resumen operacional',
    },
    {
      label: 'Beneficiarios',
      path: '/super-admin/beneficiarios',
      description: 'Vista global del padron',
    },
    {
      label: 'Auditoria',
      path: '/super-admin/auditoria',
      description: 'Supervision transversal',
    },
  ],
  admin: [
    {
      label: 'Inicio',
      path: '/admin/inicio',
      description: 'Resumen operacional',
    },
    {
      label: 'Beneficiarios',
      path: '/admin/beneficiarios',
      description: 'Exploracion operativa',
    },
    {
      label: 'Auditoria',
      path: '/admin/auditoria',
      description: 'Revision operativa',
    },
  ],
  teleoperadora: [
    {
      label: 'Inicio',
      path: '/teleoperadora/inicio',
      description: 'Priorizacion diaria',
    },
    {
      label: 'Mi cartera',
      path: '/teleoperadora/cartera',
      description: 'Beneficiarios asignados',
    },
    {
      label: 'Seguimientos',
      path: '/teleoperadora/seguimientos',
      description: 'Pendiente de fase posterior',
    },
    {
      label: 'Estado de seguimiento',
      path: '/teleoperadora/estado',
      description: 'Priorizacion por estado',
    },
    {
      label: 'Historial de interacciones',
      path: '/teleoperadora/interacciones',
      description: 'Contexto de llamadas',
    },
  ],
}

export function getDefaultPathForRole(role: UserRole) {
  return roleNavigation[role][0]?.path ?? '/'
}