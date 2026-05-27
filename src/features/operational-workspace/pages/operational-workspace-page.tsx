import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { CoverageStateBadge } from '@/features/operational-workspace/components/coverage-state-badge'
import {
  contactTypeLabels,
  coverageStateMeta,
  fetchOperationalCoverageWorkspace,
  fetchOperationalOperators,
  outcomeLabels,
  type OperationalCoverageState,
  type OperationalOperatorOption,
  type OperationalWorkspaceFilters,
  type OperationalWorkspaceItem,
} from '@/features/operational-workspace/data'
import { formatDateTime, formatRelativeFollowupDays, formatTextFallback } from '@/lib/format'

const defaultFilters: OperationalWorkspaceFilters = {
  page: 1,
  pageSize: 15,
  search: '',
  coverageState: 'all',
  assignedOperatorId: 'all',
  minDaysSince: '',
  maxDaysSince: '',
}

const coverageOptions: Array<{ value: 'all' | OperationalCoverageState; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'urgente', label: 'Urgente' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'sin_contacto', label: 'Sin contacto' },
  { value: 'al_dia', label: 'Al dia' },
]

function getWorkspaceBasePath(role: 'teleoperadora' | 'admin' | 'super_admin') {
  if (role === 'teleoperadora') {
    return '/teleoperadora/beneficiarios'
  }

  if (role === 'admin') {
    return '/admin/beneficiarios'
  }

  return '/super-admin/beneficiarios'
}

function getAudienceCopy(role: 'teleoperadora' | 'admin' | 'super_admin') {
  if (role === 'teleoperadora') {
    return {
      eyebrow: 'Mi cola operativa',
      title: 'Gestion diaria priorizada desde la cobertura canonica.',
      description: 'Solo ves beneficiarios asignados. La prioridad nace desde beneficiary_followup_status y los eventos canonicos de follow_up_events.',
    }
  }

  return {
    eyebrow: 'Workspace operacional',
    title: 'Cobertura viva para coordinacion diaria real.',
    description: 'Supervisa la operacion diaria sin reconstruir reglas en frontend. La cola se ordena por prioridad canonica y envejecimiento del seguimiento efectivo.',
  }
}

export function OperationalWorkspacePage() {
  const { profile } = useAuth()
  const [filters, setFilters] = useState(defaultFilters)
  const [items, setItems] = useState<OperationalWorkspaceItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [operatorOptions, setOperatorOptions] = useState<OperationalOperatorOption[]>([])

  useEffect(() => {
    if (!profile || profile.role === 'teleoperadora') {
      return
    }

    const loadOperators = async () => {
      try {
        setOperatorOptions(await fetchOperationalOperators())
      } catch {
        setOperatorOptions([])
      }
    }

    void loadOperators()
  }, [profile])

  useEffect(() => {
    if (!profile) {
      return
    }

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetchOperationalCoverageWorkspace(filters)
        setItems(response.items)
        setTotalCount(response.totalCount)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar el workspace operacional.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [filters, profile])

  if (!profile) {
    return null
  }

  const audienceCopy = getAudienceCopy(profile.role)
  const detailBasePath = getWorkspaceBasePath(profile.role)
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize))

  if (loading) {
    return (
      <PageState
        title="Cargando workspace operacional"
        description="Estamos consultando la cola priorizada y su cobertura canonica."
      />
    )
  }

  if (error) {
    return (
      <PageState
        title="No fue posible cargar la consola operacional"
        description={error}
      />
    )
  }

  return (
    <div className="space-y-5">
      <Panel className="p-6 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">{audienceCopy.eyebrow}</p>
            <h2 className="mt-2 max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              {audienceCopy.title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              {audienceCopy.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">Orden: urgente, pendiente, sin contacto, al dia</Badge>
            <Badge tone="muted">{totalCount} visibles</Badge>
          </div>
        </div>
      </Panel>

      <Panel className="p-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="block xl:col-span-2">
            <span className="text-sm font-medium text-slate-700">Buscar</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value, page: 1 }))}
              placeholder="Nombre o RUT"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Cobertura</span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={filters.coverageState}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  coverageState: event.target.value as OperationalWorkspaceFilters['coverageState'],
                  page: 1,
                }))
              }
            >
              {coverageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {profile.role !== 'teleoperadora' && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Teleoperadora</span>
              <select
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                value={filters.assignedOperatorId}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, assignedOperatorId: event.target.value, page: 1 }))
                }
              >
                <option value="all">Todas</option>
                {operatorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Dias desde</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              inputMode="numeric"
              value={filters.minDaysSince}
              onChange={(event) => setFilters((current) => ({ ...current, minDaysSince: event.target.value, page: 1 }))}
              placeholder="0"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Dias hasta</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              inputMode="numeric"
              value={filters.maxDaysSince}
              onChange={(event) => setFilters((current) => ({ ...current, maxDaysSince: event.target.value, page: 1 }))}
              placeholder="60"
            />
          </label>
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-6 py-4">Prioridad</th>
                <th className="px-6 py-4">Beneficiario</th>
                <th className="px-6 py-4">RUT</th>
                <th className="px-6 py-4">Cobertura</th>
                <th className="px-6 py-4">Dias sin contacto</th>
                <th className="px-6 py-4">Ultimo contacto efectivo</th>
                <th className="px-6 py-4">Teleoperadora asignada</th>
                <th className="px-6 py-4">Ultimo outcome</th>
                <th className="px-6 py-4">Tipo contacto</th>
                <th className="px-6 py-4 text-right">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const meta = coverageStateMeta[item.coverageState]

                return (
                  <tr key={item.beneficiaryId} className={`${meta.rowClass} align-top`}>
                    <td className="px-6 py-4">
                      <span className={`inline-flex h-3 w-3 rounded-full ${meta.accentClass}`} />
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-950">{item.beneficiaryName}</p>
                      <p className="mt-1 text-slate-500">{formatTextFallback(item.beneficiaryCommune)}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{formatTextFallback(item.beneficiaryRut)}</td>
                    <td className="px-6 py-4"><CoverageStateBadge state={item.coverageState} /></td>
                    <td className="px-6 py-4 font-medium text-slate-900">{formatRelativeFollowupDays(item.daysSinceEffectiveFollowup)}</td>
                    <td className="px-6 py-4 text-slate-700">{formatDateTime(item.lastEffectiveFollowupAt)}</td>
                    <td className="px-6 py-4 text-slate-700">{formatTextFallback(item.assignedOperatorName)}</td>
                    <td className="px-6 py-4 text-slate-700">{item.latestOutcome ? outcomeLabels[item.latestOutcome] : 'Sin dato'}</td>
                    <td className="px-6 py-4 text-slate-700">{item.latestContactType ? contactTypeLabels[item.latestContactType] : 'Sin dato'}</td>
                    <td className="px-6 py-4 text-right">
                      <Link to={`${detailBasePath}/${item.beneficiaryId}`} className={primaryButtonClass}>Abrir</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-4 lg:hidden">
          {items.map((item) => {
            const meta = coverageStateMeta[item.coverageState]

            return (
              <article key={item.beneficiaryId} className={`relative overflow-hidden rounded-[24px] border border-slate-200 p-5 ${meta.rowClass}`}>
                <div className={`absolute inset-y-0 left-0 w-2 ${meta.accentClass}`} />
                <div className="flex items-start justify-between gap-3 pl-2">
                  <div>
                    <p className="text-lg font-semibold tracking-tight text-slate-950">{item.beneficiaryName}</p>
                    <p className="mt-1 text-sm text-slate-600">{formatTextFallback(item.beneficiaryRut)}</p>
                  </div>
                  <CoverageStateBadge state={item.coverageState} />
                </div>

                <div className="mt-4 grid gap-3 pl-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Dias sin contacto</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatRelativeFollowupDays(item.daysSinceEffectiveFollowup)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Ultimo outcome</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{item.latestOutcome ? outcomeLabels[item.latestOutcome] : 'Sin dato'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Ultimo contacto efectivo</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatDateTime(item.lastEffectiveFollowupAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Teleoperadora asignada</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatTextFallback(item.assignedOperatorName)}</p>
                  </div>
                </div>

                <Link to={`${detailBasePath}/${item.beneficiaryId}`} className={`mt-5 ${primaryButtonClass}`}>
                  Abrir detalle
                </Link>
              </article>
            )
          })}
        </div>

        {items.length === 0 && (
          <div className="p-6">
            <PageState title="Sin resultados" description="No hay beneficiarios que coincidan con los filtros operacionales actuales." />
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          Pagina {filters.page} de {totalPages}. Mostrando hasta {filters.pageSize} filas por vista.
        </div>
        <div className="flex gap-3">
          <button
            className={secondaryButtonClass}
            type="button"
            disabled={filters.page <= 1}
            onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
          >
            Anterior
          </button>
          <button
            className={primaryButtonClass}
            type="button"
            disabled={filters.page >= totalPages}
            onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
          >
            Siguiente
          </button>
        </div>
      </Panel>
    </div>
  )
}