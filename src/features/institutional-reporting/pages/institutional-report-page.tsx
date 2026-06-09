import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'

import { Badge, PageState, Panel } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import {
  type ExecutiveMetricsHistoryPoint,
  type ExecutiveMetricsSummary,
  fetchExecutiveMetricsHistory,
  fetchExecutiveMetricsSummary,
  fetchExecutiveOperatorComparison,
  getExecutiveMetricsErrorMessage,
  type OperatorDashboardSummaryRow,
} from '@/features/executive-metrics/data'
import { formatDateTime } from '@/lib/format'

type ResourceState<T> = {
  data: T | null
  error: string | null
}

type InstitutionalReportState = {
  summary: ResourceState<ExecutiveMetricsSummary>
  history: ResourceState<ExecutiveMetricsHistoryPoint[]>
  operators: ResourceState<OperatorDashboardSummaryRow[]>
}

type NoteTone = 'muted' | 'warning' | 'danger'

type InstitutionalNote = {
  title: string
  body: string
  tone: NoteTone
}

type EmissionMetadata = {
  emittedAt: Date
  emittedByName: string
  emittedByEmail: string
  emittedByRole: string
}

const EMPTY_HISTORY: ExecutiveMetricsHistoryPoint[] = []
const EMPTY_OPERATORS: OperatorDashboardSummaryRow[] = []

function createEmptyState(): InstitutionalReportState {
  return {
    summary: { data: null, error: null },
    history: { data: null, error: null },
    operators: { data: null, error: null },
  }
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin dato'
  }

  return `${value.toFixed(2)}%`
}

function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin dato'
  }

  return new Intl.NumberFormat('es-CL').format(value)
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin dato'
  }

  return `${value.toFixed(1)} dias`
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return 'Sin dato'
  }

  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`))
}

function formatRiskLabel(value: ExecutiveMetricsSummary['slaRisk']['institutionalRiskLevel'] | null | undefined) {
  switch (value) {
    case 'healthy':
      return 'Saludable'
    case 'watch':
      return 'En observacion'
    case 'risk':
      return 'En riesgo'
    case 'critical':
      return 'Critico'
    default:
      return 'Sin dato'
  }
}

function getRiskTone(value: ExecutiveMetricsSummary['slaRisk']['institutionalRiskLevel'] | null | undefined) {
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

function formatEmissionDate(date: Date) {
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }).format(date)
}

function formatEmissionTime(date: Date) {
  return new Intl.DateTimeFormat('es-CL', { timeStyle: 'medium' }).format(date)
}

function formatRoleLabel(role: string) {
  if (role === 'super_admin') return 'Super administrador'
  if (role === 'admin') return 'Administrador'
  return role
}

function getHistoricalStatusLabel(summary: ExecutiveMetricsSummary) {
  if (!summary.history.available) return 'Sin historico'
  if (!summary.history.enoughForTrend) return 'Historico parcial'
  return 'Historico comparable'
}

function getNoteToneClasses(tone: NoteTone) {
  switch (tone) {
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-950'
    case 'danger':
      return 'border-rose-200 bg-rose-50 text-rose-950'
    case 'muted':
    default:
      return 'border-slate-200 bg-slate-50 text-slate-800'
  }
}

function getOperatorHealthRows(operators: OperatorDashboardSummaryRow[]) {
  return operators
    .slice()
    .sort((left, right) => {
      if (right.totalBeneficiaries !== left.totalBeneficiaries) {
        return right.totalBeneficiaries - left.totalBeneficiaries
      }

      if (right.overdueCoverage !== left.overdueCoverage) {
        return right.overdueCoverage - left.overdueCoverage
      }

      return left.operatorName.localeCompare(right.operatorName)
    })
    .slice(0, 4)
}

function buildInstitutionalNotes(
  summary: ExecutiveMetricsSummary | null,
  history: ExecutiveMetricsHistoryPoint[],
  historyError: string | null,
  operators: OperatorDashboardSummaryRow[],
) {
  const notes: InstitutionalNote[] = []

  if (!summary) {
    notes.push({
      title: 'Resumen institucional no disponible',
      body: 'No fue posible consolidar la lectura institucional actual con las fuentes ejecutivas autorizadas.',
      tone: 'danger',
    })
    return notes
  }

  if (!summary.history.available) {
    notes.push({
      title: 'Historico no disponible',
      body: 'El reporte no cuenta todavia con snapshots suficientes para mostrar contexto historico persistido.',
      tone: 'warning',
    })
  } else if (!summary.history.enoughForTrend) {
    notes.push({
      title: 'Historico insuficiente',
      body: 'Existe historico parcial, pero no alcanza para comparar tendencia institucional completa del periodo.',
      tone: 'warning',
    })
  }

  if (historyError) {
    notes.push({
      title: 'Lectura historica con incidencia',
      body: historyError,
      tone: 'warning',
    })
  }

  if (summary.slaRisk.riskDrivers.length > 0) {
    notes.push({
      title: 'Drivers institucionales activos',
      body: summary.slaRisk.riskDrivers.join(' | '),
      tone: summary.slaRisk.attentionRequired ? 'danger' : 'muted',
    })
  }

  if (summary.current.importRuns === 0) {
    notes.push({
      title: 'Sin corridas de importacion en ventana',
      body: `La ventana evaluada de ${formatCount(summary.windowDays)} dias no registra corridas de importacion para calidad de datos.`,
      tone: 'warning',
    })
  }

  if (history.length > 0 && summary.history.latestSnapshotDate) {
    notes.push({
      title: 'Ultima captura disponible',
      body: `La ultima captura institucional registrada corresponde a ${formatShortDate(summary.history.latestSnapshotDate)} y se expone sin completar dias faltantes.`,
      tone: 'muted',
    })
  }

  if (operators.length === 0) {
    notes.push({
      title: 'Comparativo por operadora sin filas visibles',
      body: 'El reporte no expone comparativo institucional por operadora mientras no existan filas visibles desde el RPC ejecutivo autorizado.',
      tone: 'muted',
    })
  }

  return notes
}

function PrintOnlyHeader({
  emission,
  summary,
}: {
  emission: EmissionMetadata
  summary: ExecutiveMetricsSummary | null
}) {
  return (
    <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
            Mistatas — Teleasistencia Institucional
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Estado institucional del servicio
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Reporte exportable — uso exclusivo de direccion y comite.
          </p>
        </div>
        <div className="shrink-0 text-right text-sm text-slate-700">
          <p className="font-semibold text-slate-950">{formatEmissionDate(emission.emittedAt)}</p>
          <p className="mt-1">{formatEmissionTime(emission.emittedAt)}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-slate-700">
        <div>
          <span className="font-semibold text-slate-950">Emitido por: </span>
          {emission.emittedByName}
          {emission.emittedByEmail ? ` (${emission.emittedByEmail})` : ''}
        </div>
        <div>
          <span className="font-semibold text-slate-950">Rol emisor: </span>
          {formatRoleLabel(emission.emittedByRole)}
        </div>
        <div>
          <span className="font-semibold text-slate-950">Periodo evaluado: </span>
          {summary
            ? `${formatCount(summary.historyDays)} dias (ventana KPI: ${formatCount(summary.windowDays)} dias)`
            : 'Sin dato'}
        </div>
        <div>
          <span className="font-semibold text-slate-950">Ultimo snapshot: </span>
          {summary ? formatShortDate(summary.history.latestSnapshotDate) : 'Sin dato'}
        </div>
        <div>
          <span className="font-semibold text-slate-950">Snapshots disponibles: </span>
          {summary ? formatCount(summary.history.snapshotsAvailable) : 'Sin dato'}
        </div>
        <div>
          <span className="font-semibold text-slate-950">Estado historico: </span>
          {summary ? getHistoricalStatusLabel(summary) : 'Sin dato'}
        </div>
        <div>
          <span className="font-semibold text-slate-950">Fuente de datos: </span>
          RPCs ejecutivos autorizados + snapshots persistidos
        </div>
        <div>
          <span className="font-semibold text-slate-950">Referencia: </span>
          {summary?.referenceDate ?? 'Sin dato'}
        </div>
      </div>

      {summary && (
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-200 pt-5">
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cobertura institucional</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatPercent(summary.current.effectiveCoverage)}</p>
            <p className="mt-1 text-xs text-slate-600">
              {formatCount(summary.current.effectiveBeneficiaries)} de {formatCount(summary.current.totalBeneficiaries)} beneficiarios
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">SLA compliance</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatPercent(summary.slaRisk.slaComplianceRate)}</p>
            <p className="mt-1 text-xs text-slate-600">Estado: {formatRiskLabel(summary.slaRisk.slaComplianceState)}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Riesgo institucional</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatRiskLabel(summary.slaRisk.institutionalRiskLevel)}</p>
            <p className="mt-1 text-xs text-slate-600">
              {summary.slaRisk.attentionRequired ? 'Atencion ejecutiva requerida' : 'Sin tension severa activa'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function PrintOnlyFooter({ emission }: { emission: EmissionMetadata }) {
  return (
    <div className="hidden print:block mt-8 border-t border-slate-300 pt-4">
      <div className="flex items-start justify-between gap-6 text-xs text-slate-500">
        <p className="max-w-lg">
          Fuente de datos: get_executive_metrics_summary · get_executive_metrics_history · get_operator_kpi_summary · v_kpi_daily_snapshot_history.
          Sin recalculo frontend ni interpolacion de puntos faltantes.
        </p>
        <p className="shrink-0 text-right">
          Emitido: {formatEmissionDate(emission.emittedAt)} {formatEmissionTime(emission.emittedAt)}<br />
          {emission.emittedByName} — {formatRoleLabel(emission.emittedByRole)}<br />
          Mistatas Teleasistencia Institucional
        </p>
      </div>
    </div>
  )
}

function ExportActionsBar({ onPrint }: { onPrint: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-sm print:hidden">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-950">Exportar reporte institucional</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Genera PDF o impresion formal usando solo fuentes ejecutivas validadas. Sin recalculo frontend.
        </p>
      </div>
      <button
        type="button"
        onClick={onPrint}
        className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition-colors hover:bg-slate-800"
      >
        Imprimir reporte institucional
      </button>
    </div>
  )
}

function Section({
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
    <Panel className="space-y-6 print:break-inside-avoid">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
        </div>
        {badge}
      </div>
      {children}
    </Panel>
  )
}

function DataCard({
  label,
  value,
  helper,
  tone = 'default',
}: {
  label: string
  value: string
  helper: string
  tone?: 'default' | 'accent' | 'danger'
}) {
  const classes = {
    default: 'border-slate-200 bg-white',
    accent: 'border-sky-200 bg-sky-50',
    danger: 'border-rose-200 bg-rose-50',
  }[tone]

  return (
    <article className={`rounded-[24px] border p-5 ${classes}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{helper}</p>
    </article>
  )
}

export function InstitutionalReportPage() {
  const { isConfigured, profile } = useAuth()
  const [state, setState] = useState<InstitutionalReportState>(createEmptyState)
  const [loading, setLoading] = useState(true)
  const [emissionMeta, setEmissionMeta] = useState<EmissionMetadata | null>(null)

  useEffect(() => {
    if (!profile || !isConfigured) {
      return
    }

    if (profile.role !== 'admin' && profile.role !== 'super_admin') {
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

      setEmissionMeta({
        emittedAt: new Date(),
        emittedByName: profile.full_name?.trim() || profile.email || 'Sin nombre',
        emittedByEmail: profile.email || '',
        emittedByRole: profile.role,
      })

      setLoading(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isConfigured, profile])

  const summary = state.summary.data
  const history = state.history.data ?? EMPTY_HISTORY
  const operators = state.operators.data ?? EMPTY_OPERATORS
  const operatorHighlights = useMemo(() => getOperatorHealthRows(operators), [operators])
  const latestHistoricalCapture = useMemo(() => {
    if (history.length === 0) {
      return null
    }

    return history.slice(1).reduce<ExecutiveMetricsHistoryPoint>((latest, current) => {
      const latestTime = new Date(latest.createdAt || `${latest.snapshotDate}T00:00:00`).getTime()
      const currentTime = new Date(current.createdAt || `${current.snapshotDate}T00:00:00`).getTime()

      return currentTime > latestTime ? current : latest
    }, history[0])
  }, [history])
  const notes = useMemo(
    () => buildInstitutionalNotes(summary, history, state.history.error, operators),
    [summary, history, state.history.error, operators],
  )

  const handlePrint = () => {
    flushSync(() => {
      setEmissionMeta({
        emittedAt: new Date(),
        emittedByName: profile?.full_name?.trim() || profile?.email || 'Sin nombre',
        emittedByEmail: profile?.email || '',
        emittedByRole: profile?.role ?? '',
      })
    })
    window.print()
  }

  if (!profile) {
    return null
  }

  if (profile.role === 'teleoperadora') {
    return (
      <PageState
        title="Reporte institucional no disponible"
        description="La teleoperadora no tiene acceso a la lectura institucional consolidada ni a los snapshots ejecutivos."
      />
    )
  }

  if (!isConfigured) {
    return (
      <PageState
        title="Reporte institucional no disponible"
        description="Configura Supabase para consultar la capa ejecutiva institucional autorizada."
      />
    )
  }

  if (loading) {
    return (
      <PageState
        title="Cargando reporte institucional"
        description="Estamos consolidando la lectura institucional usando solo fuentes ejecutivas y snapshots ya validados."
      />
    )
  }

  if (state.summary.error && !summary) {
    return (
      <PageState
        title="No fue posible cargar el reporte institucional"
        description={state.summary.error}
      />
    )
  }

  return (
    <div className="space-y-6 print:space-y-4" data-print-scope="institutional-report">
      <ExportActionsBar onPrint={handlePrint} />

      {emissionMeta && (
        <PrintOnlyHeader emission={emissionMeta} summary={summary} />
      )}

      <Panel className="overflow-hidden p-0 print:hidden">
        <div className="grid xl:grid-cols-[1.2fr_0.8fr]">
          <div className="bg-[linear-gradient(135deg,#1f2937_0%,#334155_52%,#0f172a_100%)] px-7 py-8 text-white sm:px-9">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="muted" className="border-white/15 bg-white/10 text-slate-100">
                Fase 4.9C.4
              </Badge>
              <Badge tone="info" className="border-white/15 bg-sky-400/15 text-sky-100">
                Reporte institucional
              </Badge>
              <Badge tone={summary ? getRiskTone(summary.slaRisk.institutionalRiskLevel) : 'muted'} className="border-white/15 bg-white/10 text-white">
                {summary ? formatRiskLabel(summary.slaRisk.institutionalRiskLevel) : 'Sin dato'}
              </Badge>
            </div>

            <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight">
              Estado institucional del servicio
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-200">
              Vista consolidada para direccion, comite y reporte municipal. Expone semantica validada desde RPCs ejecutivos y snapshots persistidos, sin recalculo frontend ni interpretacion subjetiva libre.
            </p>

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Fecha de referencia</p>
                <p className="mt-3 text-2xl font-semibold">{summary?.referenceDate ?? 'Sin dato'}</p>
                <p className="mt-2 text-sm text-slate-300">Ventana KPI: {formatCount(summary?.windowDays ?? 0)} dias.</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/8 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Ultima captura</p>
                <p className="mt-3 text-2xl font-semibold">{formatShortDate(summary?.history.latestSnapshotDate)}</p>
                <p className="mt-2 text-sm text-slate-300">Historico evaluado: {formatCount(summary?.historyDays ?? 0)} dias.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-7 py-8 sm:px-9">
            <DataCard
              label="Cobertura institucional"
              value={formatPercent(summary?.current.effectiveCoverage)}
              helper={summary ? `${formatCount(summary.current.effectiveBeneficiaries)} beneficiarios al dia sobre ${formatCount(summary.current.totalBeneficiaries)} visibles.` : 'Sin lectura actual disponible.'}
              tone="accent"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <DataCard
                label="SLA compliance"
                value={formatPercent(summary?.slaRisk.slaComplianceRate)}
                helper={summary ? `Estado backend: ${formatRiskLabel(summary.slaRisk.slaComplianceState)}.` : 'Sin dato.'}
              />
              <DataCard
                label="Backlog critico"
                value={formatCount(summary?.slaRisk.criticalBacklogCount)}
                helper={summary ? `${formatPercent(summary.slaRisk.criticalBacklogRate)} del universo institucional.` : 'Sin dato.'}
                tone="danger"
              />
            </div>
          </div>
        </div>
      </Panel>

      <Section
        eyebrow="1. Executive Summary"
        title="Resumen ejecutivo consolidado"
        description="Presenta la lectura institucional principal del servicio con foco en cobertura, riesgo, cumplimiento y tendencia general expuesta por backend."
        badge={summary ? <Badge tone={getRiskTone(summary.slaRisk.institutionalRiskLevel)}>{formatRiskLabel(summary.slaRisk.institutionalRiskLevel)}</Badge> : undefined}
      >
        {!summary ? (
          <PageState title="Sin resumen institucional" description="No fue posible construir el consolidado ejecutivo actual." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <DataCard
              label="Cobertura institucional"
              value={formatPercent(summary.current.effectiveCoverage)}
              helper={`${formatCount(summary.current.effectiveBeneficiaries)} casos al dia.`}
              tone="accent"
            />
            <DataCard
              label="Riesgo institucional"
              value={formatRiskLabel(summary.slaRisk.institutionalRiskLevel)}
              helper={summary.slaRisk.attentionRequired ? 'Existe atencion ejecutiva requerida.' : 'No hay tension ejecutiva severa activa.'}
            />
            <DataCard
              label="SLA compliance"
              value={formatPercent(summary.slaRisk.slaComplianceRate)}
              helper={`Estado SLA: ${formatRiskLabel(summary.slaRisk.slaComplianceState)}.`}
            />
            <DataCard
              label="Backlog critico"
              value={formatCount(summary.slaRisk.criticalBacklogCount)}
              helper={`${formatPercent(summary.slaRisk.criticalBacklogRate)} del universo institucional.`}
              tone="danger"
            />
            <DataCard
              label="Tendencia general"
              value={summary.history.enoughForTrend ? 'Comparable' : 'Insuficiente'}
              helper={summary.history.enoughForTrend
                ? `Baseline ${formatShortDate(summary.history.baselineSnapshotDate)} a ${formatShortDate(summary.history.latestSnapshotDate)}.`
                : 'Se declara historico insuficiente cuando no hay snapshots comparables.'}
            />
          </div>
        )}
      </Section>

      <Section
        eyebrow="2. Operational Health"
        title="Salud operacional institucional"
        description="Lectura agregada del estado operativo usando cobertura, cartera vencida, stale, efectividad y volumen ya calculados en backend."
        badge={summary ? <Badge tone="info">{formatCount(summary.current.activityVolume)} gestiones</Badge> : undefined}
      >
        {!summary ? (
          <PageState title="Sin salud operacional" description="No hay lectura operacional institucional disponible." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <DataCard label="Cobertura" value={formatPercent(summary.current.effectiveCoverage)} helper={`${formatCount(summary.current.totalBeneficiaries)} beneficiarios visibles.`} tone="accent" />
              <DataCard label="Overdue" value={formatPercent(summary.current.overdueCoverage)} helper={`${formatCount(summary.current.overdueBeneficiaries)} beneficiarios vencidos.`} tone="danger" />
              <DataCard label="Stale" value={formatCount(summary.current.stalePortfolio)} helper={`${formatCount(summary.current.backlogAccumulated)} backlog acumulado.`} />
              <DataCard label="Efectividad" value={formatPercent(summary.current.effectiveContactRate)} helper={`${formatCount(summary.current.successfulFollowups)} gestiones efectivas.`} />
              <DataCard label="Volumen de actividad" value={formatCount(summary.current.activityVolume)} helper={`${formatCount(summary.current.failedFollowups)} gestiones no efectivas.`} />
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Comparativo visible por operadora</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Muestra institucional de carteras visibles</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    El reporte solo ordena visualmente filas ya emitidas por `get_operator_kpi_summary(...)`; no recalcula ranking ni semantica KPI.
                  </p>
                </div>
                <Badge tone="muted">{formatCount(operators.length)} filas</Badge>
              </div>

              {!operatorHighlights.length ? (
                <p className="mt-4 text-sm leading-7 text-slate-600">No hay filas visibles para comparativo institucional por operadora en la consulta actual.</p>
              ) : (
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {operatorHighlights.map((operator) => (
                    <article key={operator.operatorProfileId} className="rounded-[20px] border border-slate-200 bg-white p-4">
                      <p className="text-lg font-semibold tracking-tight text-slate-950">{operator.operatorName}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {formatCount(operator.totalBeneficiaries)} beneficiarios, {formatCount(operator.urgentBeneficiaries)} urgentes, {formatCount(operator.staleBeneficiaryCount)} stale.
                      </p>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Cobertura</p>
                          <p className="mt-2 font-semibold text-slate-950">{formatPercent(operator.effectiveCoverage)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Overdue</p>
                          <p className="mt-2 font-semibold text-slate-950">{formatPercent(operator.overdueCoverage)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Efectividad</p>
                          <p className="mt-2 font-semibold text-slate-950">{formatPercent(operator.operatorEffectivenessRate)}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section
        eyebrow="3. SLA & Risk"
        title="Cumplimiento y riesgo institucional"
        description="Presenta el estado de riesgo, la degradacion, la concentracion stale y el backlog critico ya clasificados por la capa ejecutiva."
        badge={summary ? <Badge tone={summary.slaRisk.attentionRequired ? 'warning' : 'success'}>{summary.slaRisk.attentionRequired ? 'Atencion requerida' : 'Sin tension severa'}</Badge> : undefined}
      >
        {!summary ? (
          <PageState title="Sin lectura SLA" description="No fue posible cargar la lectura institucional de SLA y riesgo." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DataCard label="Estado de riesgo" value={formatRiskLabel(summary.slaRisk.institutionalRiskLevel)} helper={`Drivers activos: ${formatCount(summary.slaRisk.riskDrivers.length)}.`} tone="danger" />
              <DataCard label="Degradacion" value={summary.slaRisk.degradationAvailable ? formatRiskLabel(summary.slaRisk.operationalDegradationState) : 'Sin base'} helper={summary.slaRisk.degradationAvailable ? 'Existe comparacion historica de degradacion.' : 'No hay snapshots suficientes para clasificar degradacion.'} />
              <DataCard label="Concentracion stale" value={formatPercent(summary.slaRisk.staleConcentrationRate)} helper={`Estado: ${formatRiskLabel(summary.slaRisk.staleConcentrationState)}.`} />
              <DataCard label="Critical backlog" value={formatCount(summary.slaRisk.criticalBacklogCount)} helper={`Estado: ${formatRiskLabel(summary.slaRisk.criticalBacklogState)}.`} tone="danger" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Aging institucional</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatDays(summary.slaRisk.agingInstitutionalDays)}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Estado backend: {formatRiskLabel(summary.slaRisk.agingInstitutionalState)}. Overdue promedio severo: {formatDays(summary.current.avgOverdueDays)}.
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Drivers de riesgo reportados</p>
                {summary.slaRisk.riskDrivers.length === 0 ? (
                  <p className="mt-3 text-sm leading-7 text-slate-600">No existen drivers severos activos reportados por la capa ejecutiva actual.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {summary.slaRisk.riskDrivers.map((driver) => (
                      <li key={driver} className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-700">
                        {driver}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section
        eyebrow="4. Historical Context"
        title="Contexto historico disponible"
        description="Declara con claridad si existen snapshots, cual fue la ultima captura, que periodo se evalua y si el historico es suficiente para comparacion."
        badge={summary ? <Badge tone={summary.history.enoughForTrend ? 'success' : 'warning'}>{summary.history.enoughForTrend ? 'Historico comparable' : 'Historico parcial'}</Badge> : undefined}
      >
        {!summary ? (
          <PageState title="Sin contexto historico" description="No fue posible consolidar el historico institucional actual." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DataCard label="Snapshots disponibles" value={formatCount(summary.history.snapshotsAvailable)} helper="Cantidad real de snapshots persistidos visibles para la ventana." />
              <DataCard label="Ultima captura" value={formatShortDate(summary.history.latestSnapshotDate)} helper={latestHistoricalCapture ? `Registrada ${formatDateTime(latestHistoricalCapture.createdAt)}` : 'Sin metadata adicional.'} />
              <DataCard label="Periodo evaluado" value={`${formatCount(summary.historyDays)} dias`} helper={`Baseline: ${formatShortDate(summary.history.baselineSnapshotDate)}.`} />
              <DataCard label="Estado historico" value={summary.history.enoughForTrend ? 'Suficiente' : 'Insuficiente'} helper={summary.history.available ? 'No se reconstruyen puntos faltantes.' : 'Aun no existen snapshots visibles para historico.'} />
            </div>

            {state.history.error && !history.length ? (
              <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950">
                {state.history.error}
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700">
                No hay filas historicas para este periodo. El reporte declara ausencia de historico en vez de interpolarlo.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[24px] border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-slate-500">
                      <th className="px-4 py-3 font-semibold">Snapshot</th>
                      <th className="px-4 py-3 font-semibold">Cobertura</th>
                      <th className="px-4 py-3 font-semibold">Overdue</th>
                      <th className="px-4 py-3 font-semibold">Actividad</th>
                      <th className="px-4 py-3 font-semibold">Correlation</th>
                      <th className="px-4 py-3 font-semibold">Stale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {history.slice(-6).reverse().map((point) => (
                      <tr key={point.snapshotDate}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-950">{point.snapshotDate}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDateTime(point.createdAt)}</p>
                        </td>
                        <td className="px-4 py-3">{formatPercent(point.effectiveCoverage)}</td>
                        <td className="px-4 py-3">{formatPercent(point.overdueCoverage)}</td>
                        <td className="px-4 py-3">{formatCount(point.activityVolume)}</td>
                        <td className="px-4 py-3">{formatPercent(point.correlationRate)}</td>
                        <td className="px-4 py-3">{formatCount(point.staleBeneficiaryCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        eyebrow="5. Import / Data Quality"
        title="Calidad de datos e importacion"
        description="Expone correlation rate, unmatched rate, warnings y duplicados usando la lectura ejecutiva ya validada para import quality."
        badge={summary ? <Badge tone="info">{formatCount(summary.current.importRuns)} corridas</Badge> : undefined}
      >
        {!summary ? (
          <PageState title="Sin calidad de datos" description="No fue posible cargar la capa institucional de import quality." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DataCard label="Correlation rate" value={formatPercent(summary.current.correlationRate)} helper={`${formatCount(summary.current.importRuns)} corridas consideradas.`} tone="accent" />
            <DataCard label="Unmatched rate" value={formatPercent(summary.current.unmatchedRate)} helper="Filas no correlacionadas dentro de la ventana evaluada." />
            <DataCard label="Warnings" value={formatPercent(summary.current.warningRate)} helper="Alertas de calidad reportadas por importaciones validadas." />
            <DataCard label="Duplicados" value={formatPercent(summary.current.duplicateRate)} helper="Porcentaje de duplicados detectados sin recalculo frontend." />
          </div>
        )}
      </Section>

      <Section
        eyebrow="6. Institutional Notes"
        title="Notas institucionales automaticas"
        description="Observaciones deterministicas basadas en disponibilidad de datos, estado historico y drivers ya validados. No se generan conclusiones subjetivas."
        badge={<Badge tone="muted">{formatCount(notes.length)} notas</Badge>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {notes.map((note) => (
            <article key={`${note.title}-${note.body}`} className={`rounded-[24px] border p-5 ${getNoteToneClasses(note.tone)}`}>
              <p className="text-xs uppercase tracking-[0.18em] opacity-70">Nota automatica</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight">{note.title}</h3>
              <p className="mt-3 text-sm leading-7">{note.body}</p>
            </article>
          ))}
        </div>
      </Section>

      {emissionMeta && (
        <PrintOnlyFooter emission={emissionMeta} />
      )}

      <div className="flex flex-wrap gap-3 print:hidden">
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition-colors hover:bg-slate-800"
        >
          Imprimir reporte institucional
        </button>
        <Link to={profile.role === 'admin' ? '/admin/metricas' : '/super-admin/metricas'} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50">
          Abrir metricas ejecutivas
        </Link>
        <Link to={profile.role === 'admin' ? '/admin/beneficiarios' : '/super-admin/beneficiarios'} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50">
          Abrir operacion global
        </Link>
      </div>
    </div>
  )
}
