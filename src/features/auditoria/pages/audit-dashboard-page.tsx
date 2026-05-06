import { useEffect, useState } from 'react'

import { Badge, Panel } from '@/components/ui'
import {
  fetchAuditExecutiveSummary,
  fetchRiskDashboard,
  fetchTeleoperatorTable,
  type AuditExecutiveRiskItem,
  type AuditExecutiveSummary,
  type AuditRiskBeneficiaryItem,
  type AuditRiskCommuneSummaryItem,
  type AuditRiskDashboard,
  type AuditRiskTeleoperatorSummaryItem,
  type AuditTeleoperatorRankingItem,
} from '@/features/auditoria/data'
import { followupStatusMeta } from '@/features/teleoperadora/data'
import { formatDateTime } from '@/lib/format'
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

function getFriendlyAuditErrorMessage(scope: 'summary' | 'teleoperators' | 'risk') {
  if (scope === 'summary') {
    return 'No pudimos actualizar el resumen en este momento. Intenta nuevamente en unos instantes.'
  }

  if (scope === 'risk') {
    return 'No pudimos actualizar la vista de riesgo en este momento. Intenta nuevamente en unos instantes.'
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

function getRiskTagTone(tag: string): 'danger' | 'warning' | 'muted' {
  if (tag === 'Sin asignación activa' || tag === 'Beneficiario urgente' || tag === 'Más de 45 días sin contacto') {
    return 'danger'
  }

  if (tag === 'Más de 30 días sin contacto') {
    return 'warning'
  }

  return 'muted'
}

function RiskAlerts({ dashboard }: { dashboard: AuditRiskDashboard }) {
  const alerts = [
    {
      key: 'without-assignment',
      visible: dashboard.metrics.totalWithoutActiveAssignment > 0,
      tone: 'danger' as const,
      title: 'Sin asignación activa',
      description: `${dashboard.metrics.totalWithoutActiveAssignment} beneficiarios requieren reasignación o revisión inmediata.`,
    },
    {
      key: 'urgent',
      visible: dashboard.metrics.totalUrgent > 0,
      tone: 'danger' as const,
      title: 'Beneficiarios urgentes',
      description: `${dashboard.metrics.totalUrgent} beneficiarios requieren revisión prioritaria del seguimiento.`,
    },
    {
      key: 'more-than-45',
      visible: dashboard.metrics.totalMoreThan45DaysWithoutContact > 0,
      tone: 'warning' as const,
      title: 'Más de 45 días sin contacto',
      description: `${dashboard.metrics.totalMoreThan45DaysWithoutContact} casos concentran el mayor rezago operacional.`,
    },
    {
      key: 'no-data',
      visible: dashboard.metrics.totalNoData > 0,
      tone: 'muted' as const,
      title: 'Sin datos de seguimiento',
      description: `${dashboard.metrics.totalNoData} beneficiarios requieren validación de cobertura o trazabilidad.`,
    },
  ].filter((alert) => alert.visible)

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-100 pb-4">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Alertas operacionales</p>
        <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
          Focos de revisión inmediata
        </h4>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Señales clave para priorizar supervisión y reasignación operativa en la cartera activa.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {alerts.length > 0 ? (
          alerts.map((alert) => (
            <div key={alert.key} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h5 className="text-base font-semibold tracking-tight text-slate-950">{alert.title}</h5>
                <Badge tone={alert.tone}>Requiere revisión</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{alert.description}</p>
            </div>
          ))
        ) : (
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 md:col-span-2">
            No hay alertas operacionales activas en este momento.
          </div>
        )}
      </div>
    </div>
  )
}

function RiskBeneficiaryList({ items }: { items: AuditRiskBeneficiaryItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.beneficiaryId}
          className={cn('rounded-[24px] border p-5', followupStatusMeta[item.followupStatus].panelClass)}
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold tracking-tight text-slate-950">{item.beneficiaryName}</p>
                <Badge tone={followupStatusMeta[item.followupStatus].tone}>
                  {followupStatusMeta[item.followupStatus].label}
                </Badge>
                <Badge tone={!item.hasActiveAssignment ? 'danger' : 'info'}>
                  {!item.hasActiveAssignment ? 'Sin asignación activa' : 'Asignación activa'}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
                <p><span className="font-semibold text-slate-900">RUT:</span> {item.rut ?? 'Sin dato'}</p>
                <p><span className="font-semibold text-slate-900">Comuna:</span> {item.commune}</p>
                <p>
                  <span className="font-semibold text-slate-900">Días sin contacto:</span>{' '}
                  {item.daysSinceLastValidFollowup !== null ? item.daysSinceLastValidFollowup : 'Sin datos'}
                </p>
              </div>
            </div>

            <div className="rounded-[20px] border border-white/60 bg-white/70 px-4 py-3 text-sm text-slate-700 shadow-sm xl:min-w-[240px]">
              <p className="font-semibold text-slate-900">Motivo principal</p>
              <p className="mt-2 leading-6">{item.riskReason}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Último contacto válido</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{formatDateTime(item.lastValidFollowupAt)}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Teleoperadora asignada</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {item.teleoperatorName ?? 'Sin asignación activa'}
              </p>
              <p className="mt-1 text-xs text-slate-500">{item.teleoperatorEmail ?? 'Sin correo visible'}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/70 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Motivos de riesgo</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.riskTags.map((tag) => (
                  <Badge key={tag} tone={getRiskTagTone(tag)}>{tag}</Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RiskTeleoperatorSummaryTable({ items }: { items: AuditRiskTeleoperatorSummaryItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-[0.18em] text-slate-500">
            <th className="px-4 py-3 font-semibold">Teleoperadora</th>
            <th className="px-4 py-3 font-semibold">Urgentes</th>
            <th className="px-4 py-3 font-semibold">Sin datos</th>
            <th className="px-4 py-3 font-semibold">Más de 30 días</th>
            <th className="px-4 py-3 font-semibold">Sin contacto / sin datos</th>
            <th className="px-4 py-3 font-semibold">Total riesgo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.teleoperatorKey} className="align-top text-slate-700">
              <td className="px-4 py-4">
                <p className="font-semibold text-slate-950">{item.teleoperatorName}</p>
                <p className="mt-1 text-xs text-slate-500">{item.teleoperatorEmail ?? 'Sin correo visible'}</p>
              </td>
              <td className="px-4 py-4">{item.totalUrgent}</td>
              <td className="px-4 py-4">{item.totalNoData}</td>
              <td className="px-4 py-4">{item.totalMoreThan30DaysWithoutContact}</td>
              <td className="px-4 py-4">{item.totalNoContactOrNoData}</td>
              <td className="px-4 py-4 font-semibold text-slate-950">{item.totalRisk}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RiskCommuneSummaryTable({ items }: { items: AuditRiskCommuneSummaryItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-[0.18em] text-slate-500">
            <th className="px-4 py-3 font-semibold">Comuna</th>
            <th className="px-4 py-3 font-semibold">Urgentes</th>
            <th className="px-4 py-3 font-semibold">Sin datos</th>
            <th className="px-4 py-3 font-semibold">Más de 30 días</th>
            <th className="px-4 py-3 font-semibold">Total riesgo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.commune} className="align-top text-slate-700">
              <td className="px-4 py-4 font-semibold text-slate-950">{item.commune}</td>
              <td className="px-4 py-4">{item.totalUrgent}</td>
              <td className="px-4 py-4">{item.totalNoData}</td>
              <td className="px-4 py-4">{item.totalMoreThan30DaysWithoutContact}</td>
              <td className="px-4 py-4 font-semibold text-slate-950">{item.totalRisk}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RiskTab({
  dashboard,
  loading,
  error,
  onRetry,
}: {
  dashboard: AuditRiskDashboard | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <SummaryState
        title="Cargando vista de riesgo"
        description="Estamos consultando beneficiarios activos, estado consolidado y asignación vigente para priorizar la revisión operacional."
        tone="info"
      />
    )
  }

  if (error) {
    return (
      <SummaryState
        title="No fue posible cargar la vista de riesgo"
        description={error}
        tone="danger"
        action={{
          label: 'Reintentar',
          onClick: onRetry,
        }}
      />
    )
  }

  if (!dashboard || dashboard.criticalBeneficiaries.length === 0) {
    return (
      <SummaryState
        title="No hay riesgos críticos para mostrar en este momento."
        description="Cuando existan beneficiarios urgentes, sin datos, sin asignación activa o con rezago de contacto, aparecerán aquí para supervisión."
        tone="muted"
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Beneficiarios urgentes"
          value={String(dashboard.metrics.totalUrgent)}
          tone="danger"
          helper="Casos que requieren revisión inmediata por estado consolidado urgente."
        />
        <KpiCard
          title="Sin datos de seguimiento"
          value={String(dashboard.metrics.totalNoData)}
          tone="muted"
          helper="Beneficiarios activos sin evidencia suficiente para confirmar cobertura."
        />
        <KpiCard
          title="Más de 30 días sin contacto"
          value={String(dashboard.metrics.totalMoreThan30DaysWithoutContact)}
          tone="warning"
          helper="Rezago operativo que ya supera el umbral de 30 días sin contacto válido."
        />
        <KpiCard
          title="Más de 45 días sin contacto"
          value={String(dashboard.metrics.totalMoreThan45DaysWithoutContact)}
          tone="danger"
          helper="Casos con mayor deterioro acumulado y necesidad de intervención."
        />
        <KpiCard
          title="Sin asignación activa"
          value={String(dashboard.metrics.totalWithoutActiveAssignment)}
          tone="danger"
          helper="Beneficiarios que requieren revisión de responsable operativo."
        />
      </div>

      <RiskAlerts dashboard={dashboard} />

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Lista priorizada</p>
          <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
            Beneficiarios críticos para revisión
          </h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Ordenados por ausencia de asignación activa, urgencia, mayor rezago y falta de datos de seguimiento.
          </p>
        </div>

        <div className="mt-4">
          <RiskBeneficiaryList items={dashboard.criticalBeneficiaries} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="border-b border-slate-100 pb-4">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Resumen por teleoperadora</p>
            <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Concentración de riesgo por responsable
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Vista operativa para detectar concentración de urgencias, rezago y falta de datos.
            </p>
          </div>

          <div className="mt-4">
            <RiskTeleoperatorSummaryTable items={dashboard.byTeleoperator} />
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="border-b border-slate-100 pb-4">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Resumen por comuna</p>
            <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Concentración territorial de riesgo
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Ayuda a identificar comunas donde se acumula mayor necesidad de revisión.
            </p>
          </div>

          <div className="mt-4">
            <RiskCommuneSummaryTable items={dashboard.byCommune} />
          </div>
        </div>
      </div>
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
  const [riskDashboard, setRiskDashboard] = useState<AuditRiskDashboard | null>(null)
  const [riskLoading, setRiskLoading] = useState(true)
  const [riskError, setRiskError] = useState<string | null>(null)

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

  const loadRiskDashboard = async () => {
    setRiskLoading(true)
    setRiskError(null)

    try {
      const nextDashboard = await fetchRiskDashboard()
      setRiskDashboard(nextDashboard)
    } catch {
      setRiskError(getFriendlyAuditErrorMessage('risk'))
    } finally {
      setRiskLoading(false)
    }
  }

  useEffect(() => {
    void loadSummary()
    void loadTeleoperatorTable()
    void loadRiskDashboard()
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
          ) : activeTab === 'risk' ? (
            <RiskTab
              dashboard={riskDashboard}
              loading={riskLoading}
              error={riskError}
              onRetry={() => {
                void loadRiskDashboard()
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