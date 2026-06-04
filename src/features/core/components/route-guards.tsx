import type { PropsWithChildren } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { PageState } from '@/components/ui'
import { getDefaultPathForRole } from '@/app/navigation'
import { useAuth } from '@/features/auth/use-auth'
import type { UserRole } from '@/lib/types'

export function RequireAuth({ children }: PropsWithChildren) {
  const location = useLocation()
  const { isConfigured, profile, status } = useAuth()

  if (!isConfigured) {
    return (
      <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center">
          <PageState
            title="Falta configurar Supabase"
            description="El frontend requiere las variables de entorno de Supabase antes de habilitar rutas protegidas."
          />
        </div>
      </main>
    )
  }

  if (status === 'loading') {
    return (
      <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center">
          <PageState
            title="Cargando sesion"
            description="Estamos validando autenticacion y perfil para construir la navegacion por rol."
          />
        </div>
      </main>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!profile) {
    return (
      <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center">
          <PageState
            title="Profile no disponible"
            description="La sesion existe, pero el registro en public.profiles no esta accesible para el usuario autenticado."
          />
        </div>
      </main>
    )
  }

  if (!profile.is_active) {
    return (
      <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center">
          <PageState
            title="Usuario inactivo"
            description="Tu perfil esta inactivo. Contacta a administracion antes de continuar."
          />
        </div>
      </main>
    )
  }

  return <>{children}</>
}

export function RequireRole({
  allowedRoles,
  children,
}: PropsWithChildren<{ allowedRoles: UserRole[] }>) {
  const { profile } = useAuth()

  if (!profile) {
    return <Navigate to="/login" replace />
  }

  if (!profile.is_active) {
    return <Navigate to="/login" replace />
  }

  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return <>{children}</>
}

export function RedirectToRoleHome() {
  const { profile } = useAuth()

  if (!profile) {
    return <Navigate to="/login" replace />
  }

  return <Navigate to={getDefaultPathForRole(profile.role)} replace />
}