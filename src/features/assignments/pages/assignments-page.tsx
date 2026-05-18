import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { Badge, PageState, Panel, secondaryButtonClass } from '@/components/ui'
import { AddSupportDialog } from '@/features/assignments/components/add-support-dialog'
import { AssignmentHistoryDialog } from '@/features/assignments/components/assignment-history-dialog'
import { fetchAssignmentsOverview } from '@/features/assignments/data'
import { ChangeResponsibleDialog } from '@/features/assignments/components/change-responsible-dialog'
import { AssignmentKpiCard } from '@/features/assignments/components/assignment-kpi-card'
import { EndSupportDialog } from '@/features/assignments/components/end-support-dialog'
import { TeleoperatorPortfolioPanel } from '@/features/assignments/components/teleoperator-portfolio-panel'
import { TeleoperatorSummaryTable } from '@/features/assignments/components/teleoperator-summary-table'
import { useAuth } from '@/features/auth/use-auth'
import type {
  AddSupportAssignmentResult,
  AssignmentCoverageFilter,
  AssignmentOverviewData,
  AssignmentPortfolioBeneficiary,
  AssignmentViewTab,
  EndSupportAssignmentResult,
  ReassignBeneficiaryPrimaryAssignmentResult,
} from '@/features/assignments/types'
import {
  formatPercentage,
  getCoverageFilterLabel,
  matchesCoverageFilter,
} from '@/features/assignments/utils'
import type { FollowupStatus } from '@/lib/types'

const tabs: Array<{ id: AssignmentViewTab; label: string; description: string }> = [
  {
    id: 'global',
    label: 'Vista global',
    description: 'Distribución institucional de carteras, cobertura, carga y apoyos temporales.',
  },
  {
    id: 'teleoperator',
    label: 'Vista por teleoperadora',
    description: 'Lectura detallada de responsables oficiales, apoyos temporales e historial visible.',
  },
]

const followupFilterOptions: Array<{ value: 'all' | FollowupStatus; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'urgent', label: 'Urgente' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'up_to_date', label: 'Al día' },
  { value: 'no_data', label: 'Sin datos' },
]

const coverageFilterOptions: Array<{ value: AssignmentCoverageFilter; label: string }> = [
  { value: 'all', label: 'Todas las coberturas' },
  { value: 'high', label: 'Cobertura alta' },
  { value: 'medium', label: 'Cobertura media' },
  { value: 'low', label: 'Cobertura baja' },
]

export function AssignmentsPage() {
  const { profile } = useAuth()
  const [data, setData] = useState<AssignmentOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState<AssignmentViewTab>('global')
  const [teleoperatorSearch, setTeleoperatorSearch] = useState('')
  const [beneficiarySearch, setBeneficiarySearch] = useState('')
  const [coverageFilter, setCoverageFilter] = useState<AssignmentCoverageFilter>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | FollowupStatus>('all')
  const [communeFilter, setCommuneFilter] = useState('all')
  const [selectedTeleoperatorId, setSelectedTeleoperatorId] = useState<string | null>(null)
  const [selectedBeneficiaryForChange, setSelectedBeneficiaryForChange] =
    useState<AssignmentPortfolioBeneficiary | null>(null)
  const [selectedBeneficiaryForSupport, setSelectedBeneficiaryForSupport] =
    useState<AssignmentPortfolioBeneficiary | null>(null)
  const [selectedSupportAssignmentForEnd, setSelectedSupportAssignmentForEnd] =
    useState<AssignmentPortfolioBeneficiary | null>(null)
  const [selectedBeneficiaryForHistory, setSelectedBeneficiaryForHistory] =
    useState<AssignmentPortfolioBeneficiary | null>(null)
  const [feedback, setFeedback] = useState<{
    title: string
    message: string
    tone: 'success' | 'info'
  } | null>(null)
  const deferredTeleoperatorSearch = useDeferredValue(teleoperatorSearch)
  const deferredBeneficiarySearch = useDeferredValue(beneficiarySearch)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const nextData = await fetchAssignmentsOverview()

        if (cancelled) {
          return
        }

        setData(nextData)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setData(null)
        setSelectedTeleoperatorId(null)
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No fue posible cargar la lectura operacional de carteras.',
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const filteredPortfolios = useMemo(() => {
    if (!data) {
      return []
    }

    const normalizedSearch = deferredTeleoperatorSearch.trim().toLowerCase()

    return data.portfolios.filter((portfolio) => {
      const matchesSearch = normalizedSearch.length === 0
        ? true
        : [portfolio.teleoperatorName, portfolio.teleoperatorEmail]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedSearch))

      return matchesSearch && matchesCoverageFilter(portfolio.coveragePercentage, coverageFilter)
    })
  }, [coverageFilter, data, deferredTeleoperatorSearch])

  useEffect(() => {
    if (filteredPortfolios.length === 0) {
      setSelectedTeleoperatorId(null)
      return
    }

    setSelectedTeleoperatorId((currentValue) => {
      if (currentValue && filteredPortfolios.some((item) => item.teleoperatorId === currentValue)) {
        return currentValue
      }

      return filteredPortfolios[0]?.teleoperatorId ?? null
    })
  }, [filteredPortfolios])

  const selectedPortfolio = useMemo(() => {
    return filteredPortfolios.find((item) => item.teleoperatorId === selectedTeleoperatorId) ?? null
  }, [filteredPortfolios, selectedTeleoperatorId])

  const availableCommunes = useMemo(() => {
    if (!data || !selectedPortfolio) {
      return []
    }

    return Array.from(
      new Set(
        data.beneficiaries
          .filter((item) => item.teleoperatorId === selectedPortfolio.teleoperatorId)
          .map((item) => item.commune)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((left, right) => left.localeCompare(right))
  }, [data, selectedPortfolio])

  const filteredBeneficiaries = useMemo(() => {
    if (!data || !selectedPortfolio) {
      return []
    }

    const normalizedSearch = deferredBeneficiarySearch.trim().toLowerCase()

    return data.beneficiaries.filter((item) => {
      if (item.teleoperatorId !== selectedPortfolio.teleoperatorId) {
        return false
      }

      const matchesBeneficiary = normalizedSearch.length === 0
        ? true
        : [item.beneficiaryName, item.beneficiaryRut, item.commune]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedSearch))

      const matchesStatus = statusFilter === 'all' ? true : item.followupStatus === statusFilter
      const matchesCommune = communeFilter === 'all' ? true : item.commune === communeFilter

      return matchesBeneficiary && matchesStatus && matchesCommune
    })
  }, [communeFilter, data, deferredBeneficiarySearch, selectedPortfolio, statusFilter])

  const averagePortfolioSize = useMemo(() => {
    if (!data || data.portfolios.length === 0) {
      return 0
    }

    return data.summary.totalAssignedBeneficiaries / data.portfolios.length
  }, [data])

  const canManageAssignments = profile?.role === 'admin' || profile?.role === 'super_admin'

  const handleReassignmentSuccess = (result: ReassignBeneficiaryPrimaryAssignmentResult) => {
    setFeedback({
      title: 'Responsable actualizada',
      message: `${result.previousAssignedUserName} -> ${result.newAssignedUserName}. El historial quedó conservado.`,
      tone: 'success',
    })
    setSelectedBeneficiaryForChange(null)
    setSelectedTeleoperatorId(result.newAssignedUserId)
    setTab('teleoperator')
    setReloadKey((currentValue) => currentValue + 1)
  }

  const handleAddSupportSuccess = (result: AddSupportAssignmentResult) => {
    setFeedback({
      title: 'Apoyo temporal agregado',
      message: `${result.supportUserName} quedó visible como apoyo temporal sin reemplazar a ${result.primaryUserName}.`,
      tone: 'success',
    })
    setSelectedBeneficiaryForSupport(null)
    setReloadKey((currentValue) => currentValue + 1)
  }

  const handleEndSupportSuccess = (result: EndSupportAssignmentResult) => {
    setFeedback({
      title: 'Apoyo temporal cerrado',
      message: `${result.supportUserName} dejó de figurar como apoyo temporal y el historial quedó conservado.`,
      tone: 'success',
    })
    setSelectedSupportAssignmentForEnd(null)
    setReloadKey((currentValue) => currentValue + 1)
  }

  if (loading) {
    return (
      <PageState
        title="Cargando carteras operacionales"
        description="Estamos preparando la lectura oficial de carteras, responsables y cobertura vigente para supervisión."
      />
    )
  }

  if (error) {
    return (
      <PageState
        title="No fue posible cargar el módulo"
        description={error}
      />
    )
  }

  if (!data) {
    return (
      <PageState
        title="Sin datos visibles"
        description="No encontramos carteras vigentes con responsable oficial para construir la vista operacional actual."
      />
    )
  }

  const hasActiveFilters = Boolean(deferredTeleoperatorSearch.trim())
    || Boolean(deferredBeneficiarySearch.trim())
    || coverageFilter !== 'all'
    || statusFilter !== 'all'
    || communeFilter !== 'all'

  return (
    <div className="space-y-5">
      {feedback && (
        <Panel className={feedback.tone === 'success' ? 'border border-emerald-200 bg-emerald-50 p-5' : 'border border-sky-200 bg-sky-50 p-5'}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={feedback.tone === 'success' ? 'text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800' : 'text-sm font-semibold uppercase tracking-[0.18em] text-sky-800'}>
                {feedback.title}
              </p>
              <p className={feedback.tone === 'success' ? 'mt-2 text-sm leading-7 text-emerald-900' : 'mt-2 text-sm leading-7 text-sky-900'}>
                {feedback.message}
              </p>
            </div>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setFeedback(null)}
            >
              Ocultar
            </button>
          </div>
        </Panel>
      )}

      <Panel className="p-6 sm:p-7">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Carteras operacionales</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Gestión controlada de responsables y apoyos temporales
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Esta fase mantiene la lectura oficial de carteras vigentes y agrega cambios controlados de responsable, apoyo temporal e historial trazable según el rol autorizado.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="info">Responsable oficial</Badge>
              <Badge tone="warning">Apoyo temporal</Badge>
              <Badge tone="success">Responsable oficial vigente</Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === tab
                  ? 'rounded-[24px] border border-slate-900 bg-slate-950 px-4 py-4 text-left text-white shadow-lg'
                  : 'rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-left text-slate-700 shadow-sm'}
                onClick={() => setTab(item.id)}
              >
                <p className="text-sm font-semibold tracking-tight">{item.label}</p>
                <p className={item.id === tab ? 'mt-1 text-xs text-slate-300' : 'mt-1 text-xs text-slate-500'}>
                  {item.description}
                </p>
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <AssignmentKpiCard
          eyebrow="KPIs"
          title="Carteras activas"
          value={String(data.summary.totalActivePortfolios)}
          helper="Responsables oficiales con cartera vigente visible en la lectura actual."
          tone="info"
        />
        <AssignmentKpiCard
          eyebrow="KPIs"
          title="Beneficiarios asignados"
          value={String(data.summary.totalAssignedBeneficiaries)}
          helper="Universo total cubierto por responsables oficiales vigentes."
          tone="info"
        />
        <AssignmentKpiCard
          eyebrow="KPIs"
          title="Cobertura promedio"
          value={formatPercentage(data.summary.averageCoveragePercentage)}
          helper="Porcentaje promedio de cartera al día entre responsables oficiales."
          tone="success"
        />
        <AssignmentKpiCard
          eyebrow="KPIs"
          title="Responsables activas"
          value={String(data.summary.activeTeleoperators)}
          helper="Responsables activas con cartera visible en la lectura institucional."
          tone="info"
        />
        <AssignmentKpiCard
          eyebrow="KPIs"
          title="Apoyos temporales"
          value={String(data.summary.totalActiveSupportAssignments)}
          helper="Asignaciones activas de apoyo temporal visibles en la operación actual."
          tone="warning"
        />
        <AssignmentKpiCard
          eyebrow="Alertas"
          title="Mayor urgencia"
          value={data.summary.portfolioWithMostUrgent?.teleoperatorName ?? 'Sin dato'}
          helper={data.summary.portfolioWithMostUrgent
            ? `${data.summary.portfolioWithMostUrgent.totalUrgent} beneficiarios urgentes en la cartera actual.`
            : 'No hay cartera destacada por urgencia visible.'}
          tone="warning"
        />
        <AssignmentKpiCard
          eyebrow="Alertas"
          title="Menor cobertura"
          value={data.summary.portfolioWithLowestCoverage?.teleoperatorName ?? 'Sin dato'}
          helper={data.summary.portfolioWithLowestCoverage
            ? `${formatPercentage(data.summary.portfolioWithLowestCoverage.coveragePercentage)} de cobertura vigente en la cartera actual.`
            : 'No hay cartera destacada por cobertura visible.'}
          tone="warning"
        />
      </section>

      <Panel className="p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_260px_260px_auto] lg:items-end">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Buscar teleoperadora</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              type="search"
              value={teleoperatorSearch}
              onChange={(event) => setTeleoperatorSearch(event.target.value)}
              placeholder="Nombre visible o correo"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Cobertura</span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={coverageFilter}
              onChange={(event) => setCoverageFilter(event.target.value as AssignmentCoverageFilter)}
            >
              {coverageFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Buscar beneficiario</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              type="search"
              value={beneficiarySearch}
              onChange={(event) => setBeneficiarySearch(event.target.value)}
              placeholder="Nombre, RUT o comuna"
            />
          </label>

          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setTeleoperatorSearch('')
              setBeneficiarySearch('')
              setCoverageFilter('all')
              setStatusFilter('all')
              setCommuneFilter('all')
            }}
            disabled={!hasActiveFilters}
          >
            Limpiar filtros
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[260px_260px_minmax(0,1fr)] lg:items-end">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Estado de seguimiento</span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | FollowupStatus)}
            >
              {followupFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Comuna</span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={communeFilter}
              onChange={(event) => setCommuneFilter(event.target.value)}
            >
              <option value="all">Todas las comunas</option>
              {availableCommunes.map((commune) => (
                <option key={commune} value={commune}>{commune}</option>
              ))}
            </select>
          </label>

          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
            Filtro activo de cobertura: <span className="font-semibold text-slate-900">{getCoverageFilterLabel(coverageFilter)}</span>.
            La vista usa la cartera oficial vigente, muestra apoyos temporales activos y mantiene historial trazable por beneficiario.
          </div>
        </div>
      </Panel>

      {tab === 'global' ? (
        <TeleoperatorSummaryTable
          items={filteredPortfolios}
          averagePortfolioSize={averagePortfolioSize}
          selectedTeleoperatorId={selectedTeleoperatorId}
          onSelect={(teleoperatorId) => {
            setSelectedTeleoperatorId(teleoperatorId)
            setTab('teleoperator')
          }}
        />
      ) : (
        <div className="space-y-5">
          <Panel className="p-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_auto] lg:items-end">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Responsable operacional</span>
                <select
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                  value={selectedTeleoperatorId ?? ''}
                  onChange={(event) => setSelectedTeleoperatorId(event.target.value || null)}
                >
                  {filteredPortfolios.map((portfolio) => (
                    <option key={portfolio.teleoperatorId} value={portfolio.teleoperatorId}>
                      {portfolio.teleoperatorName}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setTab('global')}
              >
                Volver a vista global
              </button>
            </div>
          </Panel>

          <TeleoperatorPortfolioPanel
            portfolio={selectedPortfolio}
            beneficiaries={filteredBeneficiaries}
            averagePortfolioSize={averagePortfolioSize}
            canManageAssignments={canManageAssignments}
            onRequestChangeResponsible={(beneficiary) => {
              setFeedback(null)
              setSelectedBeneficiaryForChange(beneficiary)
            }}
            onRequestAddSupport={(beneficiary) => {
              setFeedback(null)
              setSelectedBeneficiaryForSupport(beneficiary)
            }}
            onRequestEndSupport={(beneficiary) => {
              setFeedback(null)
              setSelectedSupportAssignmentForEnd(beneficiary)
            }}
            onRequestViewHistory={(beneficiary) => {
              setSelectedBeneficiaryForHistory(beneficiary)
            }}
          />
        </div>
      )}

      {selectedBeneficiaryForChange && canManageAssignments && (
        <ChangeResponsibleDialog
          beneficiary={selectedBeneficiaryForChange}
          excludedUserIds={[
            selectedBeneficiaryForChange.teleoperatorId,
            ...data.beneficiaries
              .filter(
                (item) =>
                  item.beneficiaryId === selectedBeneficiaryForChange.beneficiaryId
                  && item.assignmentType === 'support',
              )
              .map((item) => item.teleoperatorId),
          ]}
          onClose={() => setSelectedBeneficiaryForChange(null)}
          onSuccess={handleReassignmentSuccess}
        />
      )}

      {selectedBeneficiaryForSupport && canManageAssignments && (
        <AddSupportDialog
          beneficiary={selectedBeneficiaryForSupport}
          excludedUserIds={[
            selectedBeneficiaryForSupport.primaryResponsibleId,
            ...data.beneficiaries
              .filter(
                (item) =>
                  item.beneficiaryId === selectedBeneficiaryForSupport.beneficiaryId
                  && item.assignmentType === 'support',
              )
              .map((item) => item.teleoperatorId),
          ]}
          onClose={() => setSelectedBeneficiaryForSupport(null)}
          onSuccess={handleAddSupportSuccess}
        />
      )}

      {selectedSupportAssignmentForEnd && canManageAssignments && (
        <EndSupportDialog
          beneficiary={selectedSupportAssignmentForEnd}
          onClose={() => setSelectedSupportAssignmentForEnd(null)}
          onSuccess={handleEndSupportSuccess}
        />
      )}

      {selectedBeneficiaryForHistory && (
        <AssignmentHistoryDialog
          beneficiary={selectedBeneficiaryForHistory}
          onClose={() => setSelectedBeneficiaryForHistory(null)}
        />
      )}
    </div>
  )
}