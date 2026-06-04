import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'

export function SignInPage() {
  const { error: authError, isConfigured, profile, signIn, status } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated' && profile?.is_active) {
    return <Navigate to="/" replace />
  }

  if (!isConfigured) {
    return (
      <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center">
          <PageState
            title="Falta configurar Supabase"
            description="Define las variables de entorno del proyecto antes de intentar autenticar usuarios reales."
          />
        </div>
      </main>
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSubmitError(null)

    try {
      await signIn(email.trim(), password)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'No fue posible iniciar sesion.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6 text-slate-900">
          <Badge tone="info">Seguimientos Mistatas</Badge>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-700">
              Teleoperacion y seguimiento
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Frontend operativo alineado con cartera, ficha y seguimiento manual.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              Esta fase habilita autenticacion con Supabase, layout por rol y el flujo minimo completo de teleoperadora sin recalcular estados en cliente.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Panel>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Core UI</p>
              <p className="mt-3 text-lg font-semibold text-slate-900">Layout y rutas protegidas</p>
            </Panel>
            <Panel>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Teleoperadora</p>
              <p className="mt-3 text-lg font-semibold text-slate-900">Cartera y ficha operativa</p>
            </Panel>
            <Panel>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Seguimiento</p>
              <p className="mt-3 text-lg font-semibold text-slate-900">Registro manual en followup_events</p>
            </Panel>
          </div>
        </section>

        <Panel className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Acceso</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Iniciar sesion
              </h2>
            </div>
            <Badge tone="success">Supabase Auth</Badge>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Correo</span>
              <input
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teleoperadora@mistatas.cl"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Contrasena</span>
              <input
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </label>

            {(submitError || authError) && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError ?? authError}
              </div>
            )}

            <button
              className={`w-full ${primaryButtonClass}`}
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Ingresando...' : 'Entrar al espacio de trabajo'}
            </button>
          </form>
        </Panel>
      </div>
    </main>
  )
}