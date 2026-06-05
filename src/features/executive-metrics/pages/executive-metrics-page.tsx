import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { ExecutiveMetricCard } from '@/features/executive-metrics/components/executive-metric-card'
import { ExecutiveRiskCard } from '@/features/executive-metrics/components/executive-risk-card'
import { ExecutiveTrendChart } from '@/features/executive-metrics/components/executive-trend-chart'
import {
  type ExecutiveRiskState,
  fetchExecutiveMetricsHistory,
  fetchExecutiveMetricsSummary,
  fetchExecutiveOperatorComparison,
  getExecutiveMetricsErrorMessage,
  type ExecutiveMetricsHistoryPoint,
  type ExecutiveMetricsSummary,
  type OperatorDashboardSummaryRow,
} from '@/features/executive-metrics/data'
import { formatDateTime } from '@/lib/format'

type ResourceState<T> = {
  data: T | null
  error: string | null
}

type ExecutiveState = {
  summary: ResourceState<ExecutiveMetricsSummary>
  history: ResourceState<ExecutiveMetricsHistoryPoint[]>
  operators: ResourceState<OperatorDashboardSummaryRow[]>
}

function createEmptyState(): ExecutiveState {
  return {
    summary: { data: null, error: null },
    history: { data: null, error: null },
    operators: { data: null, error: null },
  }
}

function formatPercent(value: number | null) {
  if (value === null) {
    return 'Sin dato'
  }

  return `${value.toFixed(2)}%`
}

function formatCount(value: number | null) {
  if (value === null) {
    return 'Sin dato'
  }

  return new Intl.NumberFormat('es-CL').format(value)
}

function formatDays(value: number | null) {
  if (value === null) {
    return 'Sin dato'
  }

  return `${value.toFixed(1)} dias`
}

function formatDelta(value: number | null, suffix = 'pts') {
  if (value === null) {
    return 'Historico insuficiente'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)} ${suffix}`
}

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T00:00:00`))
}

function formatRiskStateLabel(value: ExecutiveRiskState) {
  switch (value) {
    case 'healthy':
      return 'Healthy'
    case 'watch':
      return 'Watch'
    case 'risk':
      return 'Risk'
    case 'critical':
      return 'Critical'
    default:
      return value
  }
}

function getBadgeToneForRiskState(value: ExecutiveRiskState) {
  switch (value) {
    case 'healthy':
      return 'success' as const
    case 'watch':
      return 'warning' as const
    case 'risk':
      return 'warning' as const
    case 'critical':
      return 'danger' as const
    default:
      return 'muted' as const
  }
}

function getExecutiveTone(metric: 'effectiveCoverage' | 'overdueCoverage' | 'effectiveContactRate' | 'correlationRate' | 'backlog' | 'aging' | 'critical' | 'history') {
  switch (metric) {
    case 'effectiveCoverage':
    case 'effectiveContactRate':
    case 'correlationRate':
      return 'healthy' as const
    case 'overdueCoverage':
      return 'risk' as const
    case 'backlog':
      return 'warning' as const
    case 'aging':
      return 'stable' as const
    case 'critical':
      return 'critical' as const
    case 'history':
      return 'historical' as const
    default:
      return 'stable' as const
  }
}

function getAdminWorkspacePath(role: 'admin' | 'super_admin') {
  return role === 'admin' ? '/admin/beneficiarios' : '/super-admin/beneficiarios'
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

export function ExecutiveMetricsPage() {
  const { isConfigured, profile } = useAuth()
  const [state, setState] = useState<ExecutiveState>(createEmptyState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile || !isConfigured) {
      return
    }

    let cancelled = false

    const load = async () => {
      setLoading(true)

      const results = await Promise.allSettled([
        fetchExecutiveMetricsSummary(undefined, 30, 30),
        fetchExecutiveMetricsHistory(30),
        fetchExecutiveOperatorComparison(undefined, 30),
      ])

      if (cancelled) {
        return
      }

      const [summaryResult, historyResult, operatorsResult] = results

      setState({
        summary: summaryResult.status === 'fulfilled'
          ? { data: summaryResult.value, error: null }
          : { data: null, error: getExecutiveMetricsErrorMessage(summaryResult.reason, profile.role) },
        history: historyResult.status === 'fulfilled'
          ? { data: historyResult.value, error: null }
          : { data: null, error: getExecutiveMetricsErrorMessage(historyResult.reason, profile.role) },
        operators: operatorsResult.status === 'fulfilled'
          ? { data: operatorsResult.value, error: null }
          : { data: null, error: getExecutiveMetricsErrorMessage(operatorsResult.reason, profile.role) },
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
      if (right.totalBeneficiaries !== left.totalBeneficiaries) {
        return right.totalBeneficiaries - left.totalBeneficiaries
      }

      if (right.overdueCoverage !== left.overdueCoverage) {
        return right.overdueCoverage - left.overdueCoverage
      }

      return left.operatorName.localeCompare(right.operatorName)
    })
  }, [state.operators.data])
  const summary = state.summary.data
  const historyData = state.history.data
  const history = historyData ?? []
  const historyMeta = summary?.history ?? null
  const current = summary?.current ?? null
  const slaRisk = summary?.slaRisk ?? null
  const historyUnavailable = historyMeta ? !historyMeta.available : true
  const historyInsufficient = historyMeta ? historyMeta.available && !historyMeta.enoughForTrend : false
  const trendSeries = useMemo(() => {
    const historyPoints = historyData ?? []

    return [
      {
        eyebrow: 'Coverage trend',
        title: 'Effective coverage trend',
        description: 'Serie historica real de cobertura efectiva institucional tomada desde snapshots globales persistidos.',
        color: '#047857',
        valueVariant: 'percent' as const,
        latestValueLabel: current ? formatPercent(current.effectiveCoverage) : 'Sin dato',
        summaryLabel: 'No se recalcula cobertura; solo se grafica la serie historica expuesta por backend.',
        points: historyPoints.map((point) => ({
          label: formatSnapshotDate(point.snapshotDate),
          value: point.effectiveCoverage,
        })),
      },
      {
        eyebrow: 'Overdue trend',
        title: 'Overdue coverage trend',
        description: 'Evolucion del porcentaje de cartera vencida institucional sobre snapshots reales.',
        color: '#c2410c',
        valueVariant: 'percent' as const,
        latestValueLabel: current ? formatPercent(current.overdueCoverage) : 'Sin dato',
        summaryLabel: 'Ayuda a leer presion operativa acumulada sin mezclar UI tactica.',
        points: historyPoints.map((point) => ({
          label: formatSnapshotDate(point.snapshotDate),
          value: point.overdueCoverage,
        })),
      },
      {
        eyebrow: 'Urgent trend',
        title: 'Urgent coverage trend',
        description: 'Serie institucional de casos urgentes como porcentaje del universo visible en cada snapshot.',
        color: '#be123c',
        valueVariant: 'percent' as const,
        latestValueLabel: current ? formatPercent(current.urgentCoverage) : 'Sin dato',
        summaryLabel: 'La serie proviene del historico persistido, sin interpolar dias faltantes.',
        points: historyPoints.map((point) => ({
          label: formatSnapshotDate(point.snapshotDate),
          value: point.urgentCoverage,
        })),
      },
      {
        eyebrow: 'Activity trend',
        title: 'Effective contact rate trend',
        description: 'Evolucion historica de la efectividad operacional general desde snapshots ejecutivos reales.',
        color: '#1d4ed8',
        valueVariant: 'percent' as const,
        latestValueLabel: current ? formatPercent(current.effectiveContactRate) : 'Sin dato',
        summaryLabel: 'La pagina formatea la tasa; no reconstruye el KPI desde eventos.',
        points: historyPoints.map((point) => ({
          label: formatSnapshotDate(point.snapshotDate),
          value: point.effectiveContactRate,
        })),
      },
      {
        eyebrow: 'Import trend',
        title: 'Correlation rate trend',
        description: 'Serie institucional de calidad de correlacion usando exclusivamente snapshots que ya capturaron import quality.',
        color: '#7c3aed',
        valueVariant: 'percent' as const,
        latestValueLabel: current ? formatPercent(current.correlationRate) : 'Sin dato',
        summaryLabel: 'Si un snapshot no trae correlation rate, el chart lo muestra como historico ausente, no inventado.',
        points: historyPoints.map((point) => ({
          label: formatSnapshotDate(point.snapshotDate),
          value: point.correlationRate,
        })),
      },
      {
        eyebrow: 'Backlog trend',
        title: 'Stale beneficiaries trend',
        description: 'Lectura historica del backlog stale institucional para direccion y stakeholders.',
        color: '#475569',
        valueVariant: 'count' as const,
        latestValueLabel: current ? formatCount(current.stalePortfolio) : 'Sin dato',
        summaryLabel: 'Expone volumen stale persistido por snapshot, sin derivar historico desde runtime.',
        points: historyPoints.map((point) => ({
          label: formatSnapshotDate(point.snapshotDate),
          value: point.staleBeneficiaryCount,
        })),
      },
    ]
  }, [current, historyData])

  if (!profile) {
    return null
  }

  if (profile.role === 'teleoperadora') {
    return (
      <PageState
        title="Capa ejecutiva no disponible"
        description="La teleoperadora no tiene alcance institucional global ni acceso a tendencias historicas ejecutivas."
      />
    )
  }

  if (!isConfigured) {
    return (
      <PageState
        title="Metricas ejecutivas no disponibles"
        description="Configura Supabase para consultar la capa KPI ejecutiva y los snapshots historicos reales."
      />
    )
  }

  if (loading) {
    return (
      <PageState
        title="Cargando metricas ejecutivas"
        description="Estamos consultando el resumen institucional, los comparativos por operadora y la historia real de snapshots sin reconstruir tendencias en frontend."
      />
    )
  }

  if (state.summary.error && !state.summary.data) {
    return (
      <PageState
        title="No fue posible cargar la capa ejecutiva"
        description={state.summary.error}
        action={(
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButtonClass} onClick={() => window.location.reload()}>
              Reintentar
            </button>
            <Link to={getAdminWorkspacePath(profile.role)} className={primaryButtonClass}>
              Abrir operacion global
            </Link>
          </div>
        )}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Panel className="overflow-hidden p-0">
        <div className="grid gap-0 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="bg-[linear-gradient(145deg,#0f172a_0%,#172554_45%,#1d4ed8_100%)] px-6 py-7 text-white sm:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" className="border-white/15 bg-white/10 text-white">
                Fase 4.9C.1
              </Badge>
              <Badge tone="warning" className="border-amber-300/20 bg-amber-300/10 text-amber-100">
                Capa ejecutiva institucional
              </Badge>
              {historyMeta && (
                <Badge tone="muted" className="border-white/10 bg-white/10 text-slate-100">
                  {historyMeta.available ? `${historyMeta.snapshotsAvailable} snapshots reales` : 'Sin historico persistido'}
                </Badge>
              )}
            </div>
            <h2 className="mt-5 max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Lectura institucional para responder como esta funcionando el sistema sin mezclar tactica viva con historico inventado.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-200">
              Esta vista consume exclusivamente la capa KPI 4.9A y la nueva capa ejecutiva 4.9C.1: runtime institucional,
              comparativos backend por operadora y tendencias basadas solo en snapshots persistidos reales.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={getAdminWorkspacePath(profile.role)} className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-slate-100">
                Abrir operacion global
              </Link>
              <Link to="/auditoria" className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/0 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Abrir auditoria
              </Link>
            </div>
          </div>

          <div className="grid gap-4 bg-[linear-gradient(180deg,#eff6ff_0%,#f8fafc_100%)] px-6 py-7 sm:px-8">
            <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cobertura institucional</p>
              <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
                {current ? formatPercent(current.effectiveCoverage) : 'Sin dato'}
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {current ? `${formatCount(current.effectiveBeneficiaries)} beneficiarios al dia sobre ${formatCount(current.totalBeneficiaries)} visibles.` : 'No hay lectura institucional disponible.'}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Riesgo institucional</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-rose-950">
                  {slaRisk ? formatRiskStateLabel(slaRisk.institutionalRiskLevel) : 'Sin dato'}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Priorizacion ejecutiva consolidada desde backend, no inferida solo por colores de frontend.
                </p>
              </div>
              <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Historial confiable</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {historyMeta ? formatCount(historyMeta.snapshotsAvailable) : '0'}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Snapshots globales persistidos disponibles para lectura ejecutiva real.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {current && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          <ExecutiveMetricCard
            eyebrow="Cobertura"
            label="Cobertura promedio"
            value={formatPercent(current.effectiveCoverage)}
            helper={`${formatCount(current.effectiveBeneficiaries)} beneficiarios al dia.`}
            tone={getExecutiveTone('effectiveCoverage')}
          />
          <ExecutiveMetricCard
            eyebrow="Rezago"
            label="Overdue institucional"
            value={formatPercent(current.overdueCoverage)}
            helper={`${formatCount(current.overdueBeneficiaries)} casos vencidos visibles.`}
            tone={getExecutiveTone('overdueCoverage')}
          />
          <ExecutiveMetricCard
            eyebrow="Operacion"
            label="Efectividad general"
            value={formatPercent(current.effectiveContactRate)}
            helper={`${formatCount(current.successfulFollowups)} gestiones efectivas en ventana.`}
            tone={getExecutiveTone('effectiveContactRate')}
          />
          <ExecutiveMetricCard
            eyebrow="Importacion"
            label="Correlation rate"
            value={formatPercent(current.correlationRate)}
            helper={`${formatCount(current.importRuns)} corridas consideradas en la ventana.`}
            tone={getExecutiveTone('correlationRate')}
          />
          <ExecutiveMetricCard
            eyebrow="Backlog"
            label="Backlog acumulado"
            value={formatCount(current.backlogAccumulated)}
            helper="Se deriva del backlog stale institucional ya calculado en backend."
            tone={getExecutiveTone('backlog')}
          />
          <ExecutiveMetricCard
            eyebrow="Aging"
            label="Aging promedio"
            value={formatDays(current.avgAgingDays)}
            helper={`${formatDays(current.avgOverdueDays)} de atraso promedio severo.`}
            tone={getExecutiveTone('aging')}
          />
          <ExecutiveMetricCard
            eyebrow="Critico"
            label="Beneficiarios criticos"
            value={formatCount(current.criticalBeneficiaries)}
            helper={`${formatCount(current.stalePortfolio)} casos stale visibles.`}
            tone={getExecutiveTone('critical')}
          />
          <ExecutiveMetricCard
            eyebrow="Historico"
            label="Tendencia actividad"
            value={formatDelta(historyMeta?.activityVolumeDelta ?? null, 'gestiones')}
            helper={historyMeta?.enoughForTrend ? 'Delta contra el primer snapshot disponible del periodo.' : 'No hay suficientes snapshots para inferir tendencia historica.'}
            tone={getExecutiveTone('history')}
          />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
        <PanelFrame
          eyebrow="Institutional SLA"
          title="Cumplimiento SLA institucional"
          description="Lectura ejecutiva de cumplimiento, severidad y envejecimiento ya clasificada en backend para evitar semantica improvisada en frontend."
          badge={slaRisk ? <Badge tone={getBadgeToneForRiskState(slaRisk.slaComplianceState)}>{formatRiskStateLabel(slaRisk.slaComplianceState)}</Badge> : undefined}
        >
          {!slaRisk ? (
            <InlineState
              title="Sin lectura SLA"
              description="No fue posible construir la lectura institucional de SLA y severidad."
              tone="warning"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ExecutiveRiskCard
                eyebrow="SLA"
                title="SLA compliance"
                value={formatPercent(slaRisk.slaComplianceRate)}
                helper="El estado ya viene clasificado por backend como cumplimiento institucional."
                state={slaRisk.slaComplianceState}
              />
              <ExecutiveRiskCard
                eyebrow="Severidad"
                title="Overdue severity"
                value={formatPercent(slaRisk.overdueSeverityRate)}
                helper="Porcentaje institucional de cartera vencida para lectura ejecutiva."
                state={slaRisk.overdueSeverityState}
              />
              <ExecutiveRiskCard
                eyebrow="Concentracion"
                title="Stale concentration"
                value={formatPercent(slaRisk.staleConcentrationRate)}
                helper="Participacion de casos stale sobre el universo institucional visible."
                state={slaRisk.staleConcentrationState}
              />
              <ExecutiveRiskCard
                eyebrow="Aging"
                title="Aging institucional"
                value={formatDays(slaRisk.agingInstitutionalDays)}
                helper="Envejecimiento promedio de seguimiento efectivo a nivel institucional."
                state={slaRisk.agingInstitutionalState}
              />
            </div>
          )}
        </PanelFrame>

        <PanelFrame
          eyebrow="Executive risk"
          title="Riesgo y priorizacion institucional"
          description="Resume backlog critico, degradacion operacional y drivers de riesgo sin transformar la vista en una lista tactica de beneficiarios."
          badge={slaRisk ? <Badge tone={getBadgeToneForRiskState(slaRisk.institutionalRiskLevel)}>{formatRiskStateLabel(slaRisk.institutionalRiskLevel)}</Badge> : undefined}
        >
          {!slaRisk ? (
            <InlineState
              title="Sin lectura de riesgo"
              description="No fue posible consolidar la priorizacion institucional en este momento."
              tone="warning"
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ExecutiveRiskCard
                  eyebrow="Backlog"
                  title="Critical backlog"
                  value={formatCount(slaRisk.criticalBacklogCount)}
                  helper={`${formatPercent(slaRisk.criticalBacklogRate)} del universo institucional se encuentra en urgencia.`}
                  state={slaRisk.criticalBacklogState}
                />
                <ExecutiveRiskCard
                  eyebrow="Degradacion"
                  title="Operational degradation"
                  value={slaRisk.degradationAvailable && slaRisk.operationalDegradationState ? formatRiskStateLabel(slaRisk.operationalDegradationState) : 'Sin historico'}
                  helper={slaRisk.degradationAvailable
                    ? 'Se determina desde deltas historicos reales de snapshots persistidos.'
                    : 'No hay suficientes snapshots para clasificar degradacion reciente.'}
                  state={slaRisk.degradationAvailable && slaRisk.operationalDegradationState ? slaRisk.operationalDegradationState : 'watch'}
                />
                <ExecutiveRiskCard
                  eyebrow="Institucion"
                  title="Risk level"
                  value={formatRiskStateLabel(slaRisk.institutionalRiskLevel)}
                  helper={slaRisk.attentionRequired
                    ? 'La lectura institucional requiere atencion ejecutiva priorizada.'
                    : 'La lectura institucional no muestra tension ejecutiva severa.'}
                  state={slaRisk.institutionalRiskLevel}
                />
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Drivers de riesgo</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">Factores que explican la priorizacion institucional</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      Estas observaciones vienen condicionadas por el estado backend de SLA, severidad, backlog y degradacion historica.
                    </p>
                  </div>
                  <Badge tone={slaRisk.attentionRequired ? 'warning' : 'success'}>
                    {slaRisk.attentionRequired ? 'Atencion requerida' : 'Sin tension severa'}
                  </Badge>
                </div>

                {slaRisk.riskDrivers.length > 0 ? (
                  <ul className="mt-4 space-y-3">
                    {slaRisk.riskDrivers.map((driver) => (
                      <li key={driver} className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-700">
                        {driver}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-4 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-7 text-emerald-900">
                    No hay drivers de riesgo severo activos en la lectura institucional actual.
                  </div>
                )}
              </div>
            </div>
          )}
        </PanelFrame>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <PanelFrame
          eyebrow="Executive summary"
          title="Salud institucional consolidada"
          description="Lectura rapida del estado del sistema usando resumen operacional global, calidad de importacion y backlog institucional ya consolidados en backend."
          badge={current ? <Badge tone="info">Institucion completa</Badge> : undefined}
        >
          {!current ? (
            <InlineState
              title="Sin resumen institucional"
              description={state.summary.error ?? 'No fue posible construir la lectura ejecutiva actual.'}
              tone="warning"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Universo institucional</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatCount(current.totalBeneficiaries)}</p>
                <p className="mt-2 text-sm text-slate-600">Beneficiarios activos visibles para administracion.</p>
              </div>
              <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-800">Cobertura vigente</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950">{formatPercent(current.effectiveCoverage)}</p>
                <p className="mt-2 text-sm text-emerald-900">{formatCount(current.pendingBeneficiaries)} pendientes antes de volverse backlog.</p>
              </div>
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-rose-800">Cartera critica</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-rose-950">{formatCount(current.criticalBeneficiaries)}</p>
                <p className="mt-2 text-sm text-rose-900">{formatCount(current.overdueBeneficiaries)} vencidos y {formatCount(current.stalePortfolio)} stale.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Actividad general</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatCount(current.activityVolume)}</p>
                <p className="mt-2 text-sm text-slate-600">{formatCount(current.successfulFollowups)} efectivas / {formatCount(current.failedFollowups)} no efectivas.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Import quality</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatPercent(current.unmatchedRate)}</p>
                <p className="mt-2 text-sm text-slate-600">{formatPercent(current.duplicateRate)} duplicados / {formatPercent(current.warningRate)} warnings.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Aging promedio</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatDays(current.avgAgingDays)}</p>
                <p className="mt-2 text-sm text-slate-600">Atraso severo promedio: {formatDays(current.avgOverdueDays)}.</p>
              </div>
            </div>
          )}
        </PanelFrame>

        <PanelFrame
          eyebrow="Historical layer"
          title="Tendencia institucional basada en snapshots reales"
          description="Solo se lee historico persistido en kpi_daily_snapshots. Si no existe snapshot, se declara explicitamente y no se inventa serie."
          badge={historyMeta ? <Badge tone={historyUnavailable ? 'warning' : 'success'}>{historyUnavailable ? 'Sin historico' : `${historyMeta.snapshotsAvailable} snapshots`}</Badge> : undefined}
        >
          {state.history.error && !history.length ? (
            <InlineState
              title="Historial no disponible"
              description={state.history.error}
              tone="warning"
            />
          ) : historyUnavailable ? (
            <InlineState
              title="Historico aun no disponible"
              description="Todavia no existen snapshots globales suficientes para construir una lectura ejecutiva historica confiable."
              tone="info"
            />
          ) : historyInsufficient ? (
            <InlineState
              title="Historico parcial"
              description="Existe al menos un snapshot real, pero todavia no hay suficientes puntos para inferir tendencia comparativa del periodo."
              tone="info"
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Snapshots disponibles</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatCount(historyMeta?.snapshotsAvailable ?? 0)}</p>
                  <p className="mt-2 text-sm text-slate-600">Cantidad real de puntos historicos persistidos para este periodo.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ultimo snapshot</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{historyMeta?.latestSnapshotDate ?? 'Sin dato'}</p>
                  <p className="mt-2 text-sm text-slate-600">Fecha mas reciente disponible sin completar huecos ausentes.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Periodo evaluado</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatCount(summary?.historyDays ?? 30)} dias</p>
                  <p className="mt-2 text-sm text-slate-600">Ventana solicitada al RPC historico ejecutivo.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Estado historico</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{historyMeta?.enoughForTrend ? 'Comparable' : 'Parcial'}</p>
                  <p className="mt-2 text-sm text-slate-600">Se declara insuficiencia si faltan snapshots para comparar tendencia.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cobertura vs baseline</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatDelta(historyMeta?.effectiveCoverageDelta ?? null)}</p>
                  <p className="mt-2 text-sm text-slate-600">Cambio entre el primer y el ultimo snapshot del periodo.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Backlog vs baseline</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatDelta(historyMeta?.backlogDelta ?? null, 'casos')}</p>
                  <p className="mt-2 text-sm text-slate-600">No se interpreta en frontend; se expone como delta historico real.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Correlation vs baseline</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatDelta(historyMeta?.correlationRateDelta ?? null)}</p>
                  <p className="mt-2 text-sm text-slate-600">Disponible solo si el historico global capturo import quality en snapshots.</p>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                {trendSeries.map((series) => (
                  <ExecutiveTrendChart
                    key={series.title}
                    eyebrow={series.eyebrow}
                    title={series.title}
                    description={series.description}
                    points={series.points}
                    color={series.color}
                    valueVariant={series.valueVariant}
                    latestValueLabel={series.latestValueLabel}
                    summaryLabel={series.summaryLabel}
                  />
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Snapshot</th>
                      <th className="pb-3 pr-4 font-semibold">Cobertura</th>
                      <th className="pb-3 pr-4 font-semibold">Overdue</th>
                      <th className="pb-3 pr-4 font-semibold">Actividad</th>
                      <th className="pb-3 pr-4 font-semibold">Correlation</th>
                      <th className="pb-3 pr-0 font-semibold">Backlog stale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {history.slice(-8).reverse().map((point) => (
                      <tr key={point.snapshotDate}>
                        <td className="py-3 pr-4">
                          <p className="font-semibold text-slate-950">{point.snapshotDate}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDateTime(point.createdAt)}</p>
                        </td>
                        <td className="py-3 pr-4">{formatPercent(point.effectiveCoverage)}</td>
                        <td className="py-3 pr-4">{formatPercent(point.overdueCoverage)}</td>
                        <td className="py-3 pr-4">{formatCount(point.activityVolume)}</td>
                        <td className="py-3 pr-4">{formatPercent(point.correlationRate)}</td>
                        <td className="py-3 pr-0">{formatCount(point.staleBeneficiaryCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </PanelFrame>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <PanelFrame
          eyebrow="Comparativo institucional"
          title="Operadoras visibles en la lectura global"
          description="Comparativo backend-first de cartera y presion operacional. Esta vista no recalcula ranking: solo ordena visualmente la lectura ya entregada por get_operator_kpi_summary(...)."
          badge={<Badge tone="info">{formatCount(operatorRows.length)} operadoras</Badge>}
        >
          {state.operators.error && !operatorRows.length ? (
            <InlineState
              title="Comparativo no disponible"
              description={state.operators.error}
              tone="warning"
            />
          ) : !operatorRows.length ? (
            <InlineState
              title="Sin operadoras visibles"
              description="Cuando existan teleoperadoras activas con cartera vigente, el comparativo institucional aparecera aqui."
              tone="info"
            />
          ) : (
            <div className="space-y-3">
              {operatorRows.slice(0, 6).map((operator) => (
                <div key={operator.operatorProfileId} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-lg font-semibold tracking-tight text-slate-950">{operator.operatorName}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {formatCount(operator.totalBeneficiaries)} beneficiarios visibles, {formatCount(operator.staleBeneficiaryCount)} stale, {formatCount(operator.urgentBeneficiaries)} urgentes.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Cobertura</p>
                        <p className="mt-2 text-lg font-semibold text-slate-950">{formatPercent(operator.effectiveCoverage)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Overdue</p>
                        <p className="mt-2 text-lg font-semibold text-slate-950">{formatPercent(operator.overdueCoverage)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Efectividad</p>
                        <p className="mt-2 text-lg font-semibold text-slate-950">{formatPercent(operator.operatorEffectivenessRate)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelFrame>

        <PanelFrame
          eyebrow="Institutional reading"
          title="Cumplimiento general y observaciones de salud"
          description="La capa ejecutiva resume cobertura, backlog, import quality y disponibilidad historica para una lectura rapida de estabilidad institucional."
          badge={historyMeta ? <Badge tone={historyMeta.enoughForTrend ? 'success' : 'warning'}>{historyMeta.enoughForTrend ? 'Historico comparable' : 'Historico parcial'}</Badge> : undefined}
        >
          {!current ? (
            <InlineState
              title="Sin lectura institucional"
              description="No fue posible consolidar la lectura ejecutiva actual."
              tone="warning"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Actividad reciente</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatCount(current.activityVolume)}</p>
                <p className="mt-2 text-sm text-slate-600">Ventana ejecutiva de {formatCount(summary?.windowDays ?? 30)} dias.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tendencia de cobertura</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatDelta(historyMeta?.effectiveCoverageDelta ?? null)}</p>
                <p className="mt-2 text-sm text-slate-600">Basada solo en snapshots globales persistidos.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ventana historica</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                  {historyMeta?.baselineSnapshotDate ?? 'Sin base'} {historyMeta?.latestSnapshotDate ? `→ ${historyMeta.latestSnapshotDate}` : ''}
                </p>
                <p className="mt-2 text-sm text-slate-600">No se rellena historico ausente ni se interpolan dias faltantes.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Import quality actual</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatPercent(current.correlationRate)}</p>
                <p className="mt-2 text-sm text-slate-600">Unmatched {formatPercent(current.unmatchedRate)} / warnings {formatPercent(current.warningRate)}.</p>
              </div>
            </div>
          )}
        </PanelFrame>
      </div>
    </div>
  )
}
