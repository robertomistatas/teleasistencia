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
      description: 'Consola operacional viva',
    },
    {
      label: 'Metricas ejecutivas',
      path: '/super-admin/metricas',
      description: 'Salud institucional e historico real',
    },
    {
      label: 'Beneficiarios',
      path: '/super-admin/beneficiarios',
      description: 'Cola operacional global',
    },
    {
      label: 'Auditoría y reportes',
      path: '/auditoria',
      description: 'Supervisión transversal',
    },
    {
      label: 'Carteras operacionales',
      path: '/assignments',
      description: 'Ownership y carga',
    },
    {
      label: 'Importación asignaciones',
      path: '/imports/assignments',
      description: 'Carteras operacionales por Excel',
    },
    {
      label: 'Importaciones',
      path: '/imports/beneficiaries',
      description: 'Beneficiarios y contactos',
    },
    {
      label: 'Importación llamadas AMAIA',
      path: '/imports/calls',
      description: 'Llamadas crudas y correlación',
    },
    {
      label: 'Monitoreo imports llamadas',
      path: '/imports/calls/monitoring',
      description: 'Historial, errores y diagnósticos',
    },
    {
      label: 'Usuarios',
      path: '/users',
      description: 'Perfiles operativos',
    },
  ],
  admin: [
    {
      label: 'Inicio',
      path: '/admin/inicio',
      description: 'Consola operacional viva',
    },
    {
      label: 'Metricas ejecutivas',
      path: '/admin/metricas',
      description: 'Salud institucional e historico real',
    },
    {
      label: 'Beneficiarios',
      path: '/admin/beneficiarios',
      description: 'Cola operacional global',
    },
    {
      label: 'Auditoría y reportes',
      path: '/auditoria',
      description: 'Revisión operativa',
    },
    {
      label: 'Carteras operacionales',
      path: '/assignments',
      description: 'Ownership y carga',
    },
    {
      label: 'Importación asignaciones',
      path: '/imports/assignments',
      description: 'Carteras operacionales por Excel',
    },
    {
      label: 'Importaciones',
      path: '/imports/beneficiaries',
      description: 'Beneficiarios y contactos',
    },
    {
      label: 'Importación llamadas AMAIA',
      path: '/imports/calls',
      description: 'Llamadas crudas y correlación',
    },
    {
      label: 'Monitoreo imports llamadas',
      path: '/imports/calls/monitoring',
      description: 'Historial, errores y diagnósticos',
    },
    {
      label: 'Usuarios',
      path: '/users',
      description: 'Perfiles operativos',
    },
  ],
  teleoperadora: [
    {
      label: 'Inicio',
      path: '/teleoperadora/inicio',
      description: 'Consola táctica de mi operación',
    },
    {
      label: 'Mi cartera',
      path: '/teleoperadora/cartera',
      description: 'Cobertura priorizada',
    },
    {
      label: 'Seguimientos',
      path: '/teleoperadora/seguimientos',
      description: 'Timeline operativo',
    },
    {
      label: 'Estado de seguimiento',
      path: '/teleoperadora/estado',
      description: 'Cobertura canonica',
    },
    {
      label: 'Historial de interacciones',
      path: '/teleoperadora/interacciones',
      description: 'Detalle por beneficiario',
    },
  ],
}

export function getDefaultPathForRole(role: UserRole) {
  return roleNavigation[role][0]?.path ?? '/'
}
