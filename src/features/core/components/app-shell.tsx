import { useMemo, useState, type PropsWithChildren } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { Badge, darkSidebarButtonClass, secondaryButtonClass } from '@/components/ui'
import { roleNavigation } from '@/app/navigation'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/cn'

function buildBreadcrumb(pathname: string) {
  const labelMap: Record<string, string> = {
    inicio: 'Consola operacional',
    metricas: 'Metricas ejecutivas',
    assignments: 'Carteras operacionales',
    cartera: 'Mi cartera',
    auditoria: 'Auditoria',
    users: 'Usuarios',
  }
  const parts = pathname.split('/').filter(Boolean)

  if (parts.length === 0) {
    return ['Inicio']
  }

  return parts.map((part) => labelMap[part] ?? part.replace(/-/g, ' '))
}

export function AppShell({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const navigation = profile ? roleNavigation[profile.role] : []
  const breadcrumb = useMemo(() => buildBreadcrumb(location.pathname), [location.pathname])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-gradient min-h-screen px-3 py-3 sm:px-5 sm:py-5">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1600px] gap-3 sm:gap-5">
        <aside
          className={cn(
            'fixed inset-y-3 left-3 z-40 flex w-[280px] flex-col rounded-[32px] border border-slate-900/10 bg-slate-950 px-5 py-6 text-slate-100 shadow-[0_25px_80px_rgba(15,23,42,0.35)] transition-transform lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-[120%]',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">
                Mistatas
              </p>
              <p className="text-xl font-semibold tracking-tight">Seguimientos</p>
            </Link>
            <button
              className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-white/10 hover:text-white"
              type="button"
              onClick={() => setSidebarOpen(false)}
            >
              Cerrar
            </button>
          </div>

          <div className="mt-8 rounded-[28px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Usuario activo</p>
            <p className="mt-3 text-base font-semibold text-white">
              {profile?.full_name?.trim() || profile?.email || 'Sin nombre'}
            </p>
            <p className="mt-1 text-sm text-slate-400">{profile?.email}</p>
            {profile && (
              <Badge tone="info" className="mt-4 border-white/10 bg-white/10 text-white">
                {profile.role.replace('_', ' ')}
              </Badge>
            )}
          </div>

          <nav className="mt-8 flex-1 space-y-2">
            {navigation.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'block rounded-[24px] px-4 py-4 transition',
                    isActive ? 'bg-white text-slate-950 shadow-lg' : 'bg-white/0 text-slate-300 hover:bg-white/7 hover:text-white',
                  )
                }
              >
                {({ isActive }) => (
                  <div>
                    <p className="text-sm font-semibold tracking-tight">{item.label}</p>
                    <p className={cn('mt-1 text-xs', isActive ? 'text-slate-600' : 'text-slate-400')}>
                      {item.description}
                    </p>
                  </div>
                )}
              </NavLink>
            ))}
          </nav>

          <button
            className={darkSidebarButtonClass}
            type="button"
            onClick={() => void handleSignOut()}
          >
            Cerrar sesion
          </button>
        </aside>

        {sidebarOpen && (
          <button
            className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm lg:hidden"
            type="button"
            aria-label="Cerrar menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className="relative z-10 flex-1">
          <header className="mb-5 rounded-[30px] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_24px_80px_rgba(15,23,42,0.06)] backdrop-blur sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <button
                  className={secondaryButtonClass}
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                >
                  Menu
                </button>
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Ruta activa</p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                    {breadcrumb[breadcrumb.length - 1]}
                  </h1>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                {breadcrumb.map((item, index) => (
                  <span key={`${item}-${index}`} className="inline-flex items-center gap-2">
                    {index > 0 && <span className="text-slate-300">/</span>}
                    <span>{item}</span>
                  </span>
                ))}
              </div>
            </div>
          </header>

          <main className="space-y-5">{children}</main>
        </div>
      </div>
    </div>
  )
}
