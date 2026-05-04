import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { StatusBadge } from '@/features/teleoperadora/components/status-badge'
import {
  fetchTeleoperatorPortfolio,
  followupStatusMeta,
  type PortfolioItem,
} from '@/features/teleoperadora/data'
import { formatDateTime, formatRelativeFollowupDays } from '@/lib/format'
import type { FollowupStatus } from '@/lib/types'

const portfolioFilters: Array<{ value: 'all' | FollowupStatus; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'urgent', label: 'Urgente' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'up_to_date', label: 'Al dia' },
  { value: 'no_data', label: 'Sin datos' },
]

export function PortfolioPage() {
  const { user } = useAuth()
  const userId = user?.id
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<'all' | FollowupStatus>('all')

  useEffect(() => {
    const load = async () => {
      if (!userId) {
        return
      }

      setLoading(true)
      setError(null)

      try {
        const portfolio = await fetchTeleoperatorPortfolio(userId)
        setItems(portfolio)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'No fue posible cargar la cartera.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [userId])

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return items.filter((item) => {
      const matchesFilter = filter === 'all' ? true : item.followupStatus === filter
      const matchesSearch =
        normalizedSearch.length === 0
          ? true
          : [item.beneficiary.fullName, item.beneficiary.rutRaw, item.beneficiary.commune]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(normalizedSearch))

      return matchesFilter && matchesSearch
    })
  }, [filter, items, searchTerm])

  const orderedStatuses = ['urgent', 'pending', 'no_data', 'up_to_date'] as const

  if (loading) {
    return (
      <PageState
        title="Cargando mi cartera"
        description="Estamos consultando beneficiary_assignments activas, beneficiarios y beneficiary_followup_status."
      />
    )
  }

  if (error) {
    return (
      <PageState
        title="No fue posible cargar la cartera"
        description={error}
      />
    )
  }

  return (
    <div className="space-y-5">
      <Panel className="p-6 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Mi cartera</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Beneficiarios asignados con prioridad operativa
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              La vista lista asignaciones activas propias y usa beneficiary_followup_status para colorear urgencia, pendiente, al dia o sin datos sin recalcular reglas en cliente.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[440px] xl:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Buscar</span>
              <input
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Nombre, RUT o comuna"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Filtro</span>
              <select
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                value={filter}
                onChange={(event) => setFilter(event.target.value as 'all' | FollowupStatus)}
              >
                {portfolioFilters.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {orderedStatuses.map((status) => {
          const total = items.filter((item) => item.followupStatus === status).length
          const meta = followupStatusMeta[status]

          return (
            <Panel key={status} className={`p-5 ${meta.panelClass}`}>
              <Badge tone={meta.tone} className={meta.badgeClass}>{meta.label}</Badge>
              <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{total}</p>
              <p className="mt-2 text-sm text-slate-600">Beneficiarios en este estado</p>
            </Panel>
          )
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {filteredItems.length === 0 && (
          <div className="xl:col-span-2 2xl:col-span-3">
            <PageState
              title="Sin resultados"
              description="No hay beneficiarios que coincidan con la busqueda o filtro seleccionado."
            />
          </div>
        )}

        {filteredItems.map((item) => {
          const meta = followupStatusMeta[item.followupStatus]

          return (
          <Panel key={item.assignmentId} className={`relative overflow-hidden flex flex-col gap-5 p-6 ${meta.panelClass}`}>
            <div className={`absolute inset-y-0 left-0 w-2 ${meta.accentClass}`} />
            <div className="flex items-start justify-between gap-4">
              <div className="pl-2">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Beneficiario</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  {item.beneficiary.fullName}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {item.beneficiary.commune || 'Comuna sin dato'}
                </p>
              </div>
              <StatusBadge status={item.followupStatus} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] bg-white/80 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Dias sin contacto</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {formatRelativeFollowupDays(item.daysSinceLastValidFollowup)}
                </p>
              </div>
              <div className="rounded-[22px] bg-white/80 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Ultima interaccion</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {item.lastInteractionAt ? formatDateTime(item.lastInteractionAt) : 'Sin dato'}
                </p>
                <p className="mt-1 text-xs text-slate-500">{item.lastInteractionLabel || 'Sin interacciones visibles'}</p>
              </div>
              <div className="rounded-[22px] bg-white/80 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">RUT</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {item.beneficiary.rutRaw || 'Sin dato'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pl-2">
              <p className="text-sm text-slate-500">
                Asignacion activa desde {formatDateTime(item.startsAt)}
              </p>
              <Link
                to={`/teleoperadora/beneficiarios/${item.beneficiaryId}`}
                className={primaryButtonClass}
              >
                Abrir ficha
              </Link>
            </div>
          </Panel>
        )})}
      </section>
    </div>
  )
}