import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { OperationalKpiCard } from '@/features/operational-dashboard/components/operational-kpi-card'
import {
  fetchImportQualityKpis,
  fetchOperationalDashboardRecentImports,
  fetchOperationalDashboardSummary,
  fetchOperatorDashboardSummary,
  fetchOverdueDashboardItems,
  getOperationalDashboardErrorMessage,
  type ImportQualityKpis,
  type OperationalDashboardSummary,
  type OperatorDashboardSummaryRow,
  type OverdueDashboardItem,
} from '@/features/operational-dashboard/data'
import { coverageStateMeta } from '@/features/operational-workspace/data'
import { formatDateTime, formatRelativeFollowupDays } from '@/lib/format'
import type { UserRole } from '@/lib/types'
import type { CallImportMonitoringRun } from '@/features/imports/data'

type ResourceState<T> = {
  data: T | null
  error: string | null
}

type DashboardState = {
  summary: ResourceState<OperationalDashboardSummary>
  operators: ResourceState<OperatorDashboardSummaryRow[]>
  overdue: ResourceState<OverdueDashboardItem[]>
  importQuality: ResourceState<ImportQualityKpis>
  recentImports: ResourceState<CallImportMonitoringRun[]>
}

function createEmptyState(): DashboardState {
  return {
    summary: { data: null, error: null },
    operators: { data: null, error: null },
    overdue: { data: null, error: null },
    importQuality: { data: null, error: null },
    recentImports: { data: null, error: null },
  }
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`
}

function formatCount(value: number) {
  return new Intl.NumberFormat('es-CL').format(value)
}

function formatDays(value: number) {
  return `${value.toFixed(1)} dias`
}

function getRoleHomePath(role: UserRole) {
  if (role === 'teleoperadora') {
    return '/teleoperadora/cartera'
  }

  if (role === 'admin') {
    return '/admin/beneficiarios'
  }

  return '/super-admin/beneficiarios'
}

function PanelFrame({
  eyebrow,
  title,
  description,
  badge,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Panel className="space-y-5 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
        </div>
        {badge}
      </div>
      {children}
    </Panel>
  )
}

function InlineState({
  title,
  description,
  tone = 'muted',
}: {
  title: string
  description: string
  tone?: 'muted' | 'info' | 'warning'
}) {
  const className = {
    muted: 'border-slate-200 bg-slate-50 text-slate-700',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone]

  return (
    <div className={`rounded-[24px] border px-5 py-6 ${className}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.18em]">{title}</p>
      <p className="mt-2 text-sm leading-7">{description}</p>
    </div>
  )
}

function getKpiCardTone(metric: 'effectiveCoverage' | 'overdueCoverage' | 'urgentCoverage' | 'effectiveContactRate' | 'correlationRate' | 'unmatchedRate') {
  switch (metric) {
    case 'effectiveCoverage':
    case 'effectiveContactRate':
    case 'correlationRate':
      return 'healthy' as const
    case 'overdueCoverage':
      return 'overdue' as const
    case 'urgentCoverage':
      return 'urgent' as const
    case 'unmatchedRate':
      return 'warning' as const
    default:
      return 'info' as const
  }
}

function formatOverdueDelta(value: number | null) {
  if (value === null) {
    return 'Sin imputación'
  }

  if (value === 0) {
    return '0 dias'
  }

  if (value === 1) {
    return '1 dia'
  }

  return `${value} dias`
}

export function OperationalDashboardPage() {
  const { isConfigured, profile } = useAuth()
  const [state, setState] = useState<DashboardState>(createEmptyState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile || !isConfigured) {
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)

      const results = await Promise.allSettled([
        fetchOperationalDashboardSummary(),
        fetchOperatorDashboardSummary(),
        fetchOverdueDashboardItems(10),
        profile.role === 'teleoperadora' ? Promise.resolve(null) : fetchImportQualityKpis(30),
        profile.role === 'teleoperadora' ? Promise.resolve(null) : fetchOperationalDashboardRecentImports(6),
      ])

      if (cancelled) {
        return
      }

      const [summaryResult, operatorsResult, overdueResult, importQualityResult, recentImportsResult] = results

      setState({
        summary: summaryResult.status === 'fulfilled'
          ? { data: summaryResult.value, error: null }
          : { data: null, error: getOperationalDashboardErrorMessage(summaryResult.reason, profile.role) },
        operators: operatorsResult.status === 'fulfilled'
          ? { data: operatorsResult.value, error: null }
          : { data: null, error: getOperationalDashboardErrorMessage(operatorsResult.reason, profile.role) },
        overdue: overdueResult.status === 'fulfilled'
          ? { data: overdueResult.value, error: null }
          : { data: null, error: getOperationalDashboardErrorMessage(overdueResult.reason, profile.role) },
        importQuality: importQualityResult.status === 'fulfilled'
          ? { data: importQualityResult.value, error: null }
          : { data: null, error: profile.role === 'teleoperadora' ? null : getOperationalDashboardErrorMessage(importQualityResult.reason, profile.role) },
        recentImports: recentImportsResult.status === 'fulfilled'
          ? { data: recentImportsResult.value?.imports ?? null, error: null }
          : { data: null, error: profile.role === 'teleoperadora' ? null : getOperationalDashboardErrorMessage(recentImportsResult.reason, profile.role) },
      })
      setLoading(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isConfigured, profile])

  const operatorRows = useMemo(() => {
    return (state.operators.data ?? []).slice().sort((left, right) => {
      if (right.overdueCoverage !== left.overdueCoverage) {
        return right.overdueCoverage - left.overdueCoverage
      }

      if (right.urgentBeneficiaries !== left.urgentBeneficiaries) {
        return right.urgentBeneficiaries - left.urgentBeneficiaries
      }

      return left.operatorName.localeCompare(right.operatorName)
    })
  }, [state.operators.data])

  if (!profile) {
    return null
  }

  if (!isConfigured) {
    return (
      <PageState
        title="Consola operacional no disponible"
        description="Configura Supabase para consultar la capa KPI 4.9A y la lectura operacional viva."
      />
    )
  }

  if (loading) {
    return (
      <PageState
        title="Cargando consola operacional"
        description="Estamos consultando la capa KPI canónica, el backlog visible y la actividad reciente sin recalcular métricas en frontend."
      />
    )
  }

  if (state.summary.error && !state.summary.data) {
    return (
      <PageState
        title="No fue posible cargar la consola operacional"
        description={state.summary.error}
        action={(
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButtonClass} onClick={() => window.location.reload()}>
              Reintentar
            </button>
            <Link to={getRoleHomePath(profile.role)} className={primaryButtonClass}>
              Abrir cola operacional
            </Link>
          </div>
        )}
      />
    )
  }

  const summary = state.summary.data
  const overdueItems = state.overdue.data ?? []
  const importQuality = state.importQuality.data
  const recentImports = state.recentImports.data ?? []
  const visibleScopeIsEmpty = summary ? summary.totalBeneficiaries === 0 : false
  const recentActivityCount = summary ? summary.successfulFollowups + summary.failedFollowups : 0

  return (
    <div className="space-y-6">
      <Panel className="overflow-hidden p-0">
        <div className="grid gap-0 xl:grid-cols-[1.35fr_0.9fr]">
          <div className="bg-slate-950 px-6 py-7 text-white sm:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning" className="border-amber-300/20 bg-amber-300/10 text-amber-200">
                Fase 4.9B
              </Badge>
              <Badge tone="info" className="border-white/15 bg-white/10 text-white">
                {profile.role.replace('_', ' ')}
              </Badge>
              {summary && (
                <Badge tone="muted" className="border-white/10 bg-white/10 text-slate-200">
                  Scope {summary.scope === 'global' ? 'global' : 'propio'}
                </Badge>
              )}
            </div>
            <h2 className="mt-5 max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Consola operacional viva para decidir cobertura, prioridad y riesgo sin recalcular negocio en React.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Esta vista consume exclusivamente la capa KPI 4.9A: resumen operacional, comparativo por teleoperadora,
              backlog vencido e indicadores de calidad de importación donde el rol tiene alcance visible.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={getRoleHomePath(profile.role)} className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-slate-100">
                Abrir cola operacional
              </Link>
              {profile.role !== 'teleoperadora' && (
                <Link to="/imports/calls/monitoring" className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/0 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                  Ver monitoreo de imports
                </Link>
              )}
            </div>
          </div>

          <div className="grid gap-4 bg-[linear-gradient(180deg,#f8fafc_0%,#fff7ed_100%)] px-6 py-7 sm:px-8">
            <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Universo visible</p>
              <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
                {summary ? formatCount(summary.totalBeneficiaries) : '0'}
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Beneficiarios visibles en la cartera vigente para este rol.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Backlog crítico</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-rose-950">
                  {summary ? formatCount(summary.staleBeneficiaries) : '0'}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Casos urgentes o sin contacto sostenido que requieren triaje inmediato.
                </p>
              </div>
              <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Actividad reciente</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {summary ? formatCount(recentActivityCount) : '0'}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {summary ? `${formatCount(summary.successfulFollowups)} efectivos / ${formatCount(summary.failedFollowups)} no efectivos` : 'Sin actividad visible.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {summary && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <OperationalKpiCard
            eyebrow="Cobertura"
            label="Effective coverage"
            value={formatPercent(summary.effectiveCoverage)}
            helper={`${formatCount(summary.effectiveBeneficiaries)} beneficiarios al dia dentro del scope visible.`}
            tone={getKpiCardTone('effectiveCoverage')}
          />
          <OperationalKpiCard
            eyebrow="Backlog"
            label="Overdue coverage"
            value={formatPercent(summary.overdueCoverage)}
            helper={`${formatCount(summary.overdueBeneficiaries)} casos vencidos para gestión táctica.`}
            tone={getKpiCardTone('overdueCoverage')}
          />
          <OperationalKpiCard
            eyebrow="Crítico"
            label="Urgent coverage"
            value={formatPercent(summary.urgentCoverage)}
            helper={`${formatCount(summary.urgentBeneficiaries)} beneficiarios con atraso severo visible.`}
            tone={getKpiCardTone('urgentCoverage')}
          />
          <OperationalKpiCard
            eyebrow="Actividad"
            label="Effective contact rate"
            value={formatPercent(summary.effectiveContactRate)}
            helper={`${formatCount(summary.successfulFollowups)} contactos efectivos en la ventana vigente.`}
            tone={getKpiCardTone('effectiveContactRate')}
          />
          <OperationalKpiCard
            eyebrow="Importación"
            label="Correlation rate"
            value={importQuality ? formatPercent(importQuality.correlationRate) : 'Sin scope'}
            helper={importQuality ? `${formatCount(importQuality.correlatedRows)} filas correlacionadas sobre ${formatCount(importQuality.validRows)} válidas.` : 'Este KPI solo está visible para administración.'}
            tone={getKpiCardTone('correlationRate')}
          />
          <OperationalKpiCard
            eyebrow="Importación"
            label="Unmatched rate"
            value={importQuality ? formatPercent(importQuality.unmatchedRate) : 'Sin scope'}
            helper={importQuality ? `${formatCount(importQuality.unmatchedRows)} filas quedaron sin match unívoco.` : 'La teleoperadora no tiene acceso a la calidad global de imports.'}
            tone={getKpiCardTone('unmatchedRate')}
          />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <PanelFrame
          eyebrow="Operational summary"
          title="Pulso táctico del scope visible"
          description="Cartera, cobertura, envejecimiento y actividad reciente ya calculados en backend sobre la capa KPI 4.9A."
          badge={summary ? <Badge tone={visibleScopeIsEmpty ? 'muted' : 'success'}>{visibleScopeIsEmpty ? 'Scope vacio' : 'Scope visible'}</Badge> : undefined}
        >
          {!summary ? (
            <InlineState
              title="Sin resumen visible"
              description={state.summary.error ?? 'No fue posible reconstruir el resumen operacional.'}
              tone="warning"
            />
          ) : visibleScopeIsEmpty ? (
            <InlineState
              title="Sin cartera visible"
              description="El backend devolvió un payload válido con métricas en cero. No hay beneficiarios visibles para este rol en este momento."
              tone="info"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cartera total</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatCount(summary.totalBeneficiaries)}</p>
                <p className="mt-2 text-sm text-slate-600">Universo activo evaluado en el scope actual.</p>
              </div>
              <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-800">Cobertura actual</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950">{formatPercent(summary.effectiveCoverage)}</p>
                <p className="mt-2 text-sm text-emerald-900">{formatCount(summary.effectiveBeneficiaries)} al día.</p>
              </div>
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-rose-800">Backlog vencido</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-rose-950">{formatCount(summary.staleBeneficiaries)}</p>
                <p className="mt-2 text-sm text-rose-900">Incluye urgentes y sin contacto.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Aging promedio</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatDays(summary.avgAgingDays)}</p>
                <p className="mt-2 text-sm text-slate-600">Días desde último contacto efectivo canonizado.</p>
              </div>
              <div className="rounded-[24px] border border-orange-200 bg-orange-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-orange-800">Overdue promedio</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-orange-950">{formatDays(summary.avgOverdueDays)}</p>
                <p className="mt-2 text-sm text-orange-900">Exceso promedio sobre el umbral severo.</p>
              </div>
              <div className="rounded-[24px] border border-sky-200 bg-sky-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-sky-800">Actividad reciente</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-sky-950">{formatPercent(summary.effectiveContactRate)}</p>
                <p className="mt-2 text-sm text-sky-900">
                  {formatCount(summary.successfulFollowups)} efectivos / {formatCount(summary.failedFollowups)} no efectivos.
                </p>
              </div>
            </div>
          )}
        </PanelFrame>

        <PanelFrame
          eyebrow="Import quality"
          title="Salud reciente del pipeline AMAIA"
          description="Solo visible donde el backend KPI permite alcance administrativo. No se recalcula calidad en frontend."
          badge={profile.role === 'teleoperadora' ? <Badge tone="muted">Sin scope global</Badge> : <Badge tone="info">Window 30 dias</Badge>}
        >
          {profile.role === 'teleoperadora' ? (
            <InlineState
              title="Panel no visible para teleoperadora"
              description="La calidad global de importación y las últimas corridas quedan restringidas a administración para evitar exposición de diagnósticos institucionales."
              tone="muted"
            />
          ) : state.importQuality.error ? (
            <InlineState
              title="No fue posible cargar calidad de importación"
              description={state.importQuality.error}
              tone="warning"
            />
          ) : !importQuality ? (
            <InlineState
              title="Sin lectura disponible"
              description="No se recibió un payload visible de calidad de importación para esta sesión administrativa."
              tone="info"
            />
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-emerald-800">Correlation rate</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-emerald-950">{formatPercent(importQuality.correlationRate)}</p>
                </div>
                <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-amber-800">Unmatched rate</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-950">{formatPercent(importQuality.unmatchedRate)}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-600">Duplicate rate</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatPercent(importQuality.duplicateRate)}</p>
                </div>
                <div className="rounded-[22px] border border-orange-200 bg-orange-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-orange-800">Warning rate</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-orange-950">{formatPercent(importQuality.warningRate)}</p>
                </div>
              </div>

              {state.recentImports.error ? (
                <InlineState
                  title="Sin historial reciente"
                  description={state.recentImports.error}
                  tone="warning"
                />
              ) : recentImports.length === 0 ? (
                <InlineState
                  title="Sin actividad reciente de importación"
                  description="No hay corridas recientes visibles para complementar los KPIs de calidad."
                  tone="info"
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Últimas corridas relevantes</p>
                    <Link to="/imports/calls/monitoring" className={secondaryButtonClass}>Abrir monitoreo</Link>
                  </div>
                  <div className="space-y-3">
                    {recentImports.slice(0, 4).map((run) => (
                      <div key={run.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-slate-950">{run.filename}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{run.sourceType}</p>
                          </div>
                          <Badge tone={run.errorCount > 0 ? 'warning' : 'success'}>{run.status.replaceAll('_', ' ')}</Badge>
                        </div>
                        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                          <p>Inicio: {formatDateTime(run.startedAt)}</p>
                          <p>Procesadas: {formatCount(run.processedRows)} / {formatCount(run.totalRows)}</p>
                          <p>Correladas: {formatCount(run.correlatedRows)} / {formatCount(run.validRows)}</p>
                          <p>Warnings / errores: {formatCount(run.warningCount)} / {formatCount(run.errorCount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </PanelFrame>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <PanelFrame
          eyebrow="Operator summary"
          title={profile.role === 'teleoperadora' ? 'Lectura individual de mi ejecución' : 'Comparativo táctico por teleoperadora'}
          description={profile.role === 'teleoperadora'
            ? 'Tu propia fila operativa calculada por backend, sin exposición a comparativos globales indebidos.'
            : 'Cartera asignada, atraso visible y efectividad reciente por teleoperadora activa.'}
          badge={<Badge tone={profile.role === 'teleoperadora' ? 'info' : 'warning'}>{profile.role === 'teleoperadora' ? 'Fila propia' : 'Comparativo global'}</Badge>}
        >
          {state.operators.error ? (
            <InlineState
              title="No fue posible cargar resumen por operadora"
              description={state.operators.error}
              tone="warning"
            />
          ) : operatorRows.length === 0 ? (
            <InlineState
              title="Sin scope visible"
              description="No hay filas visibles de teleoperadora para este rol o no existe cartera activa asignada."
              tone="info"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
                <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Operadora</th>
                    <th className="px-4 py-3 font-medium">Cartera</th>
                    <th className="px-4 py-3 font-medium">Coverage</th>
                    <th className="px-4 py-3 font-medium">Overdue</th>
                    <th className="px-4 py-3 font-medium">Urgentes</th>
                    <th className="px-4 py-3 font-medium">Efectivos</th>
                    <th className="px-4 py-3 font-medium">Actividad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                  {operatorRows.map((row) => {
                    const hasRecentActivity = row.successfulFollowups + row.failedFollowups > 0

                    return (
                      <tr key={row.operatorProfileId} className="align-top">
                        <td className="px-4 py-4">
                          <p className="font-semibold text-slate-950">{row.operatorName}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                            {hasRecentActivity ? 'Actividad visible' : 'Sin actividad reciente'}
                          </p>
                        </td>
                        <td className="px-4 py-4 font-medium text-slate-900">{formatCount(row.totalBeneficiaries)}</td>
                        <td className="px-4 py-4 text-emerald-800">{formatPercent(row.effectiveCoverage)}</td>
                        <td className="px-4 py-4 text-orange-900">{formatPercent(row.overdueCoverage)}</td>
                        <td className="px-4 py-4 text-rose-900">{formatCount(row.urgentBeneficiaries)}</td>
                        <td className="px-4 py-4 text-sky-900">{formatPercent(row.operatorEffectivenessRate)}</td>
                        <td className="px-4 py-4 text-slate-600">
                          {formatCount(row.successfulFollowups)} / {formatCount(row.failedFollowups)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PanelFrame>

        <PanelFrame
          eyebrow="Coverage & SLA"
          title="Backlog vencido y cartera crítica"
          description="Lista táctica de beneficiarios vencidos usando exclusivamente get_overdue_beneficiaries(...) y el runtime KPI layer."
          badge={<Badge tone={overdueItems.length > 0 ? 'warning' : 'success'}>{overdueItems.length > 0 ? `${overdueItems.length} visibles` : 'Sin backlog crítico'}</Badge>}
        >
          {state.overdue.error ? (
            <InlineState
              title="No fue posible cargar cartera vencida"
              description={state.overdue.error}
              tone="warning"
            />
          ) : overdueItems.length === 0 ? (
            <InlineState
              title={visibleScopeIsEmpty ? 'Sin scope visible' : 'Sin beneficiarios vencidos'}
              description={visibleScopeIsEmpty
                ? 'No hay cartera visible para construir backlog crítico en este momento.'
                : 'No se encontraron beneficiarios urgentes o sin contacto dentro del límite solicitado.'}
              tone={visibleScopeIsEmpty ? 'info' : 'muted'}
            />
          ) : (
            <div className="space-y-4">
              {summary && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-amber-800">Pendientes</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-950">{formatCount(summary.pendingBeneficiaries)}</p>
                  </div>
                  <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-rose-800">Urgentes</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-950">{formatCount(summary.urgentBeneficiaries)}</p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-slate-100 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-600">Stale</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{formatCount(summary.staleBeneficiaries)}</p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
              {overdueItems.map((item) => {
                const meta = coverageStateMeta[item.coverageState]

                return (
                  <article key={item.beneficiaryId} className={`relative overflow-hidden rounded-[24px] border border-slate-200 p-5 ${meta.rowClass}`}>
                    <div className={`absolute inset-y-0 left-0 w-2 ${meta.accentClass}`} />
                    <div className="flex flex-col gap-4 pl-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-lg font-semibold tracking-tight text-slate-950">{item.beneficiaryName}</p>
                        <p className="mt-1 text-sm text-slate-600">{item.beneficiaryRut ?? 'Sin RUT'} · {item.assignedOperatorName ?? 'Sin operadora visible'}</p>
                      </div>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 pl-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Aging</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{formatRelativeFollowupDays(item.agingDays)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Overdue</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{formatOverdueDelta(item.overdueDays)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Último contacto efectivo</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{formatDateTime(item.lastEffectiveFollowupAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Prioridad</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">Rank {item.priorityRank}</p>
                      </div>
                    </div>
                  </article>
                )
              })}
              </div>
            </div>
          )}
        </PanelFrame>
      </div>
    </div>
  )
}
