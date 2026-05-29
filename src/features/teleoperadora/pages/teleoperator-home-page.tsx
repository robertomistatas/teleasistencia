import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { StatusBadge } from '@/features/teleoperadora/components/status-badge'
import { followupStatusMeta } from '@/features/teleoperadora/followup-metadata'
import {
  fetchTeleoperatorPortfolio,
  type PortfolioItem,
} from '@/features/teleoperadora/data'
import { formatDateTime, formatRelativeFollowupDays } from '@/lib/format'

export function TeleoperatorHomePage() {
  const { user } = useAuth()
  const userId = user?.id
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!userId) {
        return
      }

      setLoading(true)
      setError(null)

      try {
        setItems(await fetchTeleoperatorPortfolio(userId))
      } catch (error) {
        setError(error instanceof Error ? error.message : 'No fue posible cargar el resumen.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [userId])

  if (loading) {
    return (
      <PageState
        title="Cargando inicio operativo"
        description="Estamos preparando la priorizacion diaria de la teleoperadora."
      />
    )
  }

  if (error) {
    return (
      <PageState
        title="No fue posible cargar el inicio"
        description={error}
      />
    )
  }

  const urgent = items.filter((item) => item.followupStatus === 'urgent')
  const pending = items.filter((item) => item.followupStatus === 'pending')
  const noData = items.filter((item) => item.followupStatus === 'no_data')
  const topCases = items.slice(0, 4)

  return (
    <div className="space-y-5">
      <Panel className="relative overflow-hidden p-6 sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.14),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.12),_transparent_30%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <Badge tone="info">Inicio personal</Badge>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Prioriza la cartera asignada sin salir del contexto operativo.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              El frontend ya usa el estado consolidado entregado por backend y concentra ficha, historial y registro manual en una sola vertical de trabajo.
            </p>
          </div>

          <Link
            to="/teleoperadora/cartera"
            className={primaryButtonClass}
          >
            Abrir mi cartera
          </Link>
        </div>
      </Panel>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-5">
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Asignados</p>
          <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{items.length}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-sm uppercase tracking-[0.18em] text-rose-500">Urgentes</p>
          <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{urgent.length}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-sm uppercase tracking-[0.18em] text-amber-600">Pendientes</p>
          <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{pending.length}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Sin datos</p>
          <p className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{noData.length}</p>
        </Panel>
      </section>

      <Panel className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Casos prioritarios</p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Urgentes, pendientes y sin datos
            </h3>
          </div>
          <Badge tone="warning">Orden operativo</Badge>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {topCases.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No hay casos priorizados en este momento.
            </div>
          )}

          {topCases.map((item) => (
            <article
              key={item.assignmentId}
              className={`relative overflow-hidden rounded-[24px] border p-5 ${followupStatusMeta[item.followupStatus].panelClass}`}
            >
              <div className={`absolute inset-y-0 left-0 w-2 ${followupStatusMeta[item.followupStatus].accentClass}`} />
              <div className="flex items-center justify-between gap-3">
                <h4 className="pl-2 text-lg font-semibold tracking-tight text-slate-950">
                  {item.beneficiary.fullName}
                </h4>
                <StatusBadge status={item.followupStatus} />
              </div>
              <p className="mt-2 pl-2 text-sm text-slate-600">
                {item.beneficiary.commune || 'Comuna sin dato'}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] bg-white/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Dias sin contacto</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {formatRelativeFollowupDays(item.daysSinceLastValidFollowup)}
                  </p>
                </div>
                <div className="rounded-[20px] bg-white/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Ultima interaccion</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">
                    {item.lastInteractionAt ? formatDateTime(item.lastInteractionAt) : 'Sin dato'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.lastInteractionLabel || 'Sin interacciones visibles'}
                  </p>
                </div>
              </div>
              <Link
                to={`/teleoperadora/beneficiarios/${item.beneficiaryId}`}
                className={`mt-4 ${primaryButtonClass}`}
              >
                Revisar ficha
              </Link>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  )
}