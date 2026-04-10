import { StatusCard } from '@/components/status-card'
import { env, isSupabaseConfigured } from '@/lib/env'
import { supabase } from '@/lib/supabase'

const stack = [
  'React 19',
  'Vite 8',
  'TypeScript 6',
  'Tailwind CSS 4',
  'Supabase JS 2',
  'ESLint 9',
]

function App() {
  const supabaseState = isSupabaseConfigured && supabase ? 'Configurado' : 'Pendiente'
  const envState = isSupabaseConfigured
    ? 'Variables cargadas'
    : 'Completar .env antes de integrar Supabase'

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-slate-950/30 backdrop-blur sm:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.14),_transparent_30%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[1.4fr_0.9fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">
                Base inicial lista
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Teleasistencia lista para conectar con Vercel y Supabase.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                El repositorio ya tiene el stack solicitado, estructura base ordenada y una pantalla minima para validar que la app esta operativa.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {stack.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-4 self-start">
              <StatusCard label="Frontend" value="Operativo" tone="success" />
              <StatusCard label="Supabase" value={supabaseState} />
              <StatusCard label="Entorno" value={envState} />
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <StatusCard label="URL Supabase" value={env.supabaseUrl || 'Sin definir'} />
          <StatusCard
            label="Anon key"
            value={env.supabaseAnonKey ? 'Definida' : 'Sin definir'}
          />
          <StatusCard label="Siguiente paso" value="Conectar autenticacion y datos" />
        </section>
      </div>
    </main>
  )
}

export default App