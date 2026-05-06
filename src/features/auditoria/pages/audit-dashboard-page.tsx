import { useEffect, useState } from 'react'

import { Badge, Panel } from '@/components/ui'
import {
  fetchAuditExecutiveSummary,
  fetchTeleoperatorTable,
  type AuditExecutiveRiskItem,
  type AuditExecutiveSummary,
  type AuditTeleoperatorRankingItem,
} from '@/features/auditoria/data'
import { followupStatusMeta } from '@/features/teleoperadora/data'
import { cn } from '@/lib/cn'

type DateRangeOption = 'last-month' | 'last-week' | 'custom'
type AuditTab = 'summary' | 'teleoperators' | 'risk' | 'reports'

const rangeOptions: Array<{ value: DateRangeOption; label: string }> = [
  { value: 'last-month', label: 'Último mes' },
  { value: 'last-week', label: 'Última semana' },
  { value: 'custom', label: 'Personalizado' },
]

const auditTabs: Array<{ id: AuditTab; label: string; title: string; description: string }> = [
  {
    id: 'summary',
    label: 'Resumen ejecutivo',
    title: 'Resumen ejecutivo',
    description: 'KPIs globales, alertas principales y lectura ejecutiva del estado de la operación.',
  },
  {
    id: 'teleoperators',
    label: 'Teleoperadoras',
    title: 'Teleoperadoras',
    description: 'Comparación de cumplimiento de cartera asignada y estructura base de análisis por responsable.',
  },
  {
    id: 'risk',
    label: 'Riesgo',
    title: 'Riesgo',
    description: 'Priorización de beneficiarios críticos, agrupaciones y focos de revisión operacional.',
  },
  {
    id: 'reports',
    label: 'Reportes',
    title: 'Reportes',
    description: 'Preparación de informes ejecutivos y estructura formal de salida para PDF.',
  },
]

type SummaryStateProps = {
  title: string
  description: string
  tone: 'info' | 'danger' | 'muted'
  action?: {
    label: string
    onClick: () => void
  }
}

function getFriendlyAuditErrorMessage(scope: 'summary' | 'teleoperators') {
  if (scope === 'summary') {
    return 'No pudimos actualizar el resumen en este momento. Intenta nuevamente en unos instantes.'
  }

  return 'No pudimos actualizar la tabla de teleoperadoras en este momento. Intenta nuevamente en unos instantes.'
}

function SummaryState({ title, description, tone, action }: SummaryStateProps) {
  return (
    <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10">
      <Badge tone={tone}>{tone === 'danger' ? 'Error' : tone === 'info' ? 'Cargando' : 'Sin datos'}</Badge>
      <h4 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">{title}</h4>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

function KpiCard({
  title,
  value,
  tone,
  helper,
}: {
  title: string
  value: string
  tone: 'success' | 'warning' | 'danger' | 'muted' | 'info'
  helper: string
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
      <Badge tone={tone}>{title}</Badge>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{helper}</p>
    </div>
  )
}

function RankingTable({ items }: { items: AuditTeleoperatorRankingItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-[0.18em] text-slate-500">
            <th className="px-4 py-3 font-semibold">Teleoperadora</th>
            <th className="px-4 py-3 font-semibold">Cartera</th>
            <th className="px-4 py-3 font-semibold">Al día</th>
            <th className="px-4 py-3 font-semibold">Pendientes</th>
            <th className="px-4 py-3 font-semibold">Urgentes</th>
            <th className="px-4 py-3 font-semibold">Sin datos</th>
            <th className="px-4 py-3 font-semibold">Cobertura</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.teleoperatorId} className="align-top text-slate-700">
              <td className="px-4 py-4">
                <p className="font-semibold text-slate-950">{item.teleoperatorName}</p>
                <p className="mt-1 text-xs text-slate-500">{item.teleoperatorEmail ?? 'Sin correo visible'}</p>
              </td>
              <td className="px-4 py-4 font-medium">{item.totalPortfolio}</td>
              <td className="px-4 py-4">{item.totalUpToDate}</td>
              <td className="px-4 py-4">{item.totalPending}</td>
              <td className="px-4 py-4">{item.totalUrgent}</td>
              <td className="px-4 py-4">{item.totalNoData}</td>
              <td className="px-4 py-4">
                <span className="font-semibold text-slate-950">{item.coveragePercentage}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function getCoverageBadgeTone(coveragePercentage: number): 'success' | 'warning' | 'danger' | 'muted' {
  if (coveragePercentage >= 70) {
    return 'success'
  }

  if (coveragePercentage >= 40) {
    return 'warning'
  }

  if (coveragePercentage > 0) {
    return 'danger'
  }

  return 'muted'
}

function TeleoperatorsTab({
  items,
  loading,
  error,
  onRetry,
}: {
  items: AuditTeleoperatorRankingItem[]
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <SummaryState
        title="Cargando cumplimiento por teleoperadora"
        description="Estamos consultando la cartera activa y el estado consolidado para construir la tabla de supervisión."
        tone="info"
      />
    )
  }

  if (error) {
    return (
      <SummaryState
        title="No fue posible cargar la tabla de teleoperadoras"
        description={error}
        tone="danger"
        action={{
          label: 'Reintentar',
          onClick: onRetry,
        }}
      />
    )
  }

  if (items.length === 0) {
    return (
      <SummaryState
        title="No hay carteras activas para comparar"
        description="Cuando existan asignaciones activas primarias, esta vista mostrará el cumplimiento de cartera asignada por teleoperadora."
        tone="muted"
      />
    )
  }

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Tabla comparativa</p>
          <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
            Cumplimiento de cartera asignada
          </h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Ordenada por supervisión prioritaria: más urgentes, más sin datos y menor cobertura primero.
          </p>
        </div>
        <Badge tone="warning">Sin autoría de llamadas AMAIA</Badge>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.18em] text-slate-500">
              <th className="px-4 py-3 font-semibold">Teleoperadora</th>
              <th className="px-4 py-3 font-semibold">Cartera</th>
              <th className="px-4 py-3 font-semibold">Al día</th>
              <th className="px-4 py-3 font-semibold">Pendientes</th>
              <th className="px-4 py-3 font-semibold">Urgentes</th>
              <th className="px-4 py-3 font-semibold">Sin datos</th>
              <th className="px-4 py-3 font-semibold">Cobertura %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.teleoperatorId} className="align-top text-slate-700">
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-950">{item.teleoperatorName}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.teleoperatorEmail ?? 'Sin correo visible'}</p>
                </td>
                <td className="px-4 py-4 font-medium">{item.totalPortfolio}</td>
                <td className="px-4 py-4">{item.totalUpToDate}</td>
                <td className="px-4 py-4">{item.totalPending}</td>
                <td className="px-4 py-4">{item.totalUrgent}</td>
                <td className="px-4 py-4">{item.totalNoData}</td>
                <td className="px-4 py-4">
                  <Badge tone={getCoverageBadgeTone(item.coveragePercentage)}>
                    {item.coveragePercentage}%
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExecutiveRiskList({ items }: { items: AuditExecutiveRiskItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.beneficiaryId}
          className={cn(
            'rounded-[24px] border p-4',
            followupStatusMeta.urgent.panelClass,
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-base font-semibold tracking-tight text-slate-950">
                {item.beneficiaryName}
              </p>
              <p className="mt-1 text-sm text-slate-600">{item.rut ?? 'RUT no disponible'}</p>
            </div>
            <Badge tone="danger">
              {item.daysSinceLastValidFollowup !== null
                ? `${item.daysSinceLastValidFollowup} días sin contacto`
                : 'Sin días disponibles'}
            </Badge>
          </div>

          <div className="mt-4 text-sm leading-6 text-slate-700">
            <p className="font-medium text-slate-900">Teleoperadora asignada</p>
            <p>
              {item.teleoperatorName ?? 'Sin asignación activa'}
              {item.teleoperatorEmail ? ` · ${item.teleoperatorEmail}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function SummaryTab({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: AuditExecutiveSummary | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <SummaryState
        title="Cargando resumen ejecutivo"
        description="Estamos consultando cobertura actual, cumplimiento de cartera asignada y riesgo ejecutivo desde Supabase."
        tone="info"
      />
    )
  }

  if (error) {
    return (
      <SummaryState
        title="No fue posible cargar el resumen ejecutivo"
        description={error}
        tone="danger"
        action={{
          label: 'Reintentar',
          onClick: onRetry,
        }}
      />
    )
  }

  if (!summary || summary.metrics.totalActiveBeneficiaries === 0) {
    return (
      <SummaryState
        title="No hay cartera activa para mostrar"
        description="Cuando existan beneficiarios activos y asignaciones vigentes, este resumen mostrará cobertura, ranking y riesgo ejecutivo."
        tone="muted"
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          title="Cobertura global"
          value={`${summary.metrics.upToDatePercentage}%`}
          tone="success"
          helper="Beneficiarios al día sobre el total de beneficiarios activos."
        />
        <KpiCard
          title="Beneficiarios activos"
          value={String(summary.metrics.totalActiveBeneficiaries)}
          tone="info"
          helper="Universo actual considerado para la lectura ejecutiva del módulo."
        />
        <KpiCard
          title="Al día"
          value={String(summary.metrics.totalUpToDate)}
          tone="success"
          helper="Beneficiarios con cumplimiento de seguimiento vigente."
        />
        <KpiCard
          title="Pendientes"
          value={String(summary.metrics.totalPending)}
          tone="warning"
          helper="Beneficiarios que requieren seguimiento próximo para evitar deterioro."
        />
        <KpiCard
          title="Urgentes"
          value={String(summary.metrics.totalUrgent)}
          tone="danger"
          helper="Beneficiarios con mayor riesgo operativo por falta de contacto vigente."
        />
        <KpiCard
          title="Sin datos"
          value={String(summary.metrics.totalNoData)}
          tone="muted"
          helper="Beneficiarios sin evidencia suficiente en el estado consolidado actual."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Mini ranking</p>
              <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                Cumplimiento de cartera asignada
              </h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Ordenado por mayor necesidad de atención: urgentes, sin datos y menor cobertura primero.
              </p>
            </div>
            <Badge tone="warning">Atención prioritaria arriba</Badge>
          </div>

          <div className="mt-4">
            {summary.ranking.length > 0 ? (
              <RankingTable items={summary.ranking} />
            ) : (
              <SummaryState
                title="No hay carteras activas asignadas"
                description="El ranking aparecerá cuando existan asignaciones activas primarias asociadas a teleoperadoras."
                tone="muted"
              />
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="border-b border-slate-100 pb-4">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Riesgo ejecutivo</p>
            <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Top 10 beneficiarios urgentes
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Beneficiarios activos con mayor cantidad de días sin contacto válido, mostrando teleoperadora asignada si existe.
            </p>
          </div>

          <div className="mt-4">
            {summary.topUrgentBeneficiaries.length > 0 ? (
              <ExecutiveRiskList items={summary.topUrgentBeneficiaries} />
            ) : (
              <SummaryState
                title="No hay beneficiarios urgentes para mostrar"
                description="Cuando existan casos urgentes en el estado consolidado, se listarán aquí para revisión ejecutiva rápida."
                tone="muted"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlaceholderTab({ description }: { description: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Placeholder</p>
      <h4 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
        Contenido en construcción
      </h4>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{description}</p>
    </div>
  )
}

export function AuditDashboardPage() {
  const [selectedRange, setSelectedRange] = useState<DateRangeOption>('last-month')
  const [activeTab, setActiveTab] = useState<AuditTab>('summary')
  const [summary, setSummary] = useState<AuditExecutiveSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [teleoperatorTable, setTeleoperatorTable] = useState<AuditTeleoperatorRankingItem[]>([])
  const [teleoperatorsLoading, setTeleoperatorsLoading] = useState(true)
  const [teleoperatorsError, setTeleoperatorsError] = useState<string | null>(null)

  const currentTab = auditTabs.find((tab) => tab.id === activeTab) ?? auditTabs[0]

  const loadSummary = async () => {
    setSummaryLoading(true)
    setSummaryError(null)

    try {
      const nextSummary = await fetchAuditExecutiveSummary()
      setSummary(nextSummary)
    } catch {
      setSummaryError(getFriendlyAuditErrorMessage('summary'))
    } finally {
      setSummaryLoading(false)
    }
  }

  const loadTeleoperatorTable = async () => {
    setTeleoperatorsLoading(true)
    setTeleoperatorsError(null)

    try {
      const nextTable = await fetchTeleoperatorTable()
      setTeleoperatorTable(nextTable)
    } catch {
      setTeleoperatorsError(getFriendlyAuditErrorMessage('teleoperators'))
    } finally {
      setTeleoperatorsLoading(false)
    }
  }

  useEffect(() => {
    void loadSummary()
    void loadTeleoperatorTable()
  }, [])

  return (
    <div className="space-y-5">
      <Panel className="p-6 sm:p-7">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <Badge tone="info">Resumen conectado</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
              Auditoría y reportes
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              Lectura ejecutiva del estado actual de la operación, usando como fuente de verdad el
              estado consolidado de seguimiento del backend. El filtro de rango se mantiene como
              referencia visual en esta fase y no fuerza cálculo histórico.
            </p>
          </div>

          <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Rango de fechas
            </p>
            <div className="mt-4 grid gap-2">
              {rangeOptions.map((option) => {
                const isActive = selectedRange === option.value

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedRange(option.value)}
                    className={cn(
                      'flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition',
                      isActive
                        ? 'border-slate-950 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)]'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100',
                    )}
                  >
                    <span>{option.label}</span>
                    <span className={cn('text-xs uppercase tracking-[0.18em]', isActive ? 'text-slate-200' : 'text-slate-400')}>
                      Visual
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap gap-2">
          {auditTabs.map((tab) => {
            const isActive = tab.id === activeTab

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded-2xl px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-950',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </Panel>

      <Panel className="p-8">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Contenido</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {currentTab.title}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              {currentTab.description}
            </p>
          </div>
          <Badge tone="muted">{rangeOptions.find((option) => option.value === selectedRange)?.label}</Badge>
        </div>

        <div className="mt-6">
          {activeTab === 'summary' ? (
            <SummaryTab
              summary={summary}
              loading={summaryLoading}
              error={summaryError}
              onRetry={() => {
                void loadSummary()
              }}
            />
          ) : activeTab === 'teleoperators' ? (
            <TeleoperatorsTab
              items={teleoperatorTable}
              loading={teleoperatorsLoading}
              error={teleoperatorsError}
              onRetry={() => {
                void loadTeleoperatorTable()
              }}
            />
          ) : (
            <PlaceholderTab description="Esta tab queda preparada para conectar métricas, tablas y reportes en las fases siguientes del módulo de auditoría." />
          )}
        </div>
      </Panel>
    </div>
  )
}