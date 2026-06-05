import { fetchOperatorDashboardSummary, type OperatorDashboardSummaryRow } from '@/features/operational-dashboard/data'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/lib/types'

export type ExecutiveMetricsCurrent = {
  totalBeneficiaries: number
  effectiveBeneficiaries: number
  pendingBeneficiaries: number
  overdueBeneficiaries: number
  urgentBeneficiaries: number
  staleBeneficiaries: number
  effectiveCoverage: number
  pendingCoverage: number
  overdueCoverage: number
  urgentCoverage: number
  avgAgingDays: number
  avgOverdueDays: number
  successfulFollowups: number
  failedFollowups: number
  activityVolume: number
  effectiveContactRate: number
  backlogAccumulated: number
  criticalBeneficiaries: number
  stalePortfolio: number
  correlationRate: number
  unmatchedRate: number
  duplicateRate: number
  warningRate: number
  importRuns: number
}

export type ExecutiveMetricsHistorySummary = {
  available: boolean
  enoughForTrend: boolean
  snapshotsAvailable: number
  baselineSnapshotDate: string | null
  latestSnapshotDate: string | null
  effectiveCoverageDelta: number | null
  overdueCoverageDelta: number | null
  effectiveContactRateDelta: number | null
  correlationRateDelta: number | null
  backlogDelta: number | null
  avgAgingDaysDelta: number | null
  activityVolumeDelta: number | null
}

export type ExecutiveMetricsSummary = {
  referenceDate: string
  windowDays: number
  historyDays: number
  current: ExecutiveMetricsCurrent
  history: ExecutiveMetricsHistorySummary
  slaRisk: ExecutiveSlaRiskSummary
}

export type ExecutiveRiskState = 'healthy' | 'watch' | 'risk' | 'critical'

export type ExecutiveSlaRiskSummary = {
  slaComplianceRate: number
  slaComplianceState: ExecutiveRiskState
  overdueSeverityRate: number
  overdueSeverityState: ExecutiveRiskState
  staleConcentrationRate: number
  staleConcentrationState: ExecutiveRiskState
  criticalBacklogCount: number
  criticalBacklogRate: number
  criticalBacklogState: ExecutiveRiskState
  agingInstitutionalDays: number
  agingInstitutionalState: ExecutiveRiskState
  degradationAvailable: boolean
  operationalDegradationState: ExecutiveRiskState | null
  institutionalRiskLevel: ExecutiveRiskState
  attentionRequired: boolean
  riskDrivers: string[]
}

export type ExecutiveMetricsHistoryPoint = {
  snapshotDate: string
  totalBeneficiaries: number
  effectiveBeneficiaries: number
  pendingBeneficiaries: number
  overdueBeneficiaries: number
  urgentBeneficiaries: number
  staleBeneficiaryCount: number
  avgAgingDays: number
  avgOverdueDays: number
  effectiveCoverage: number
  pendingCoverage: number
  overdueCoverage: number
  urgentCoverage: number
  successfulFollowups: number
  failedFollowups: number
  activityVolume: number
  effectiveContactRate: number
  correlationRate: number | null
  unmatchedRate: number | null
  duplicateRate: number | null
  warningRate: number | null
  windowDays: number
  createdAt: string
}

type ExecutiveMetricsSummaryRpc = {
  referenceDate: string
  windowDays: number
  historyDays: number
  current: ExecutiveMetricsCurrent
  history: ExecutiveMetricsHistorySummary
  slaRisk: ExecutiveSlaRiskSummary
}

type ExecutiveMetricsHistoryRowRpc = {
  snapshot_date: string
  total_beneficiaries: number
  effective_beneficiaries: number
  pending_beneficiaries: number
  overdue_beneficiaries: number
  urgent_beneficiaries: number
  stale_beneficiary_count: number
  avg_aging_days: number
  avg_overdue_days: number
  effective_coverage: number
  pending_coverage: number
  overdue_coverage: number
  urgent_coverage: number
  successful_followups: number
  failed_followups: number
  activity_volume: number
  effective_contact_rate: number
  correlation_rate: number | null
  unmatched_rate: number | null
  duplicate_rate: number | null
  warning_rate: number | null
  window_days: number
  created_at: string
}

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado.')
  }

  return supabase
}

function mapExecutiveHistoryPoint(row: ExecutiveMetricsHistoryRowRpc): ExecutiveMetricsHistoryPoint {
  return {
    snapshotDate: row.snapshot_date,
    totalBeneficiaries: row.total_beneficiaries,
    effectiveBeneficiaries: row.effective_beneficiaries,
    pendingBeneficiaries: row.pending_beneficiaries,
    overdueBeneficiaries: row.overdue_beneficiaries,
    urgentBeneficiaries: row.urgent_beneficiaries,
    staleBeneficiaryCount: row.stale_beneficiary_count,
    avgAgingDays: row.avg_aging_days,
    avgOverdueDays: row.avg_overdue_days,
    effectiveCoverage: row.effective_coverage,
    pendingCoverage: row.pending_coverage,
    overdueCoverage: row.overdue_coverage,
    urgentCoverage: row.urgent_coverage,
    successfulFollowups: row.successful_followups,
    failedFollowups: row.failed_followups,
    activityVolume: row.activity_volume,
    effectiveContactRate: row.effective_contact_rate,
    correlationRate: row.correlation_rate,
    unmatchedRate: row.unmatched_rate,
    duplicateRate: row.duplicate_rate,
    warningRate: row.warning_rate,
    windowDays: row.window_days,
    createdAt: row.created_at,
  }
}

export async function fetchExecutiveMetricsSummary(referenceDate?: string, windowDays = 30, historyDays = 30) {
  const { data, error } = await assertSupabase().rpc('get_executive_metrics_summary', {
    p_reference_date: referenceDate ?? new Date().toISOString().slice(0, 10),
    p_window_days: windowDays,
    p_history_days: historyDays,
  })

  if (error) {
    throw error
  }

  const payload = (data as ExecutiveMetricsSummaryRpc | null) ?? null

  if (!payload) {
    throw new Error('No fue posible construir el resumen ejecutivo institucional.')
  }

  return payload satisfies ExecutiveMetricsSummary
}

export async function fetchExecutiveMetricsHistory(days = 30) {
  const { data, error } = await assertSupabase().rpc('get_executive_metrics_history', {
    p_days: days,
  })

  if (error) {
    throw error
  }

  return ((data as ExecutiveMetricsHistoryRowRpc[] | null) ?? []).map(mapExecutiveHistoryPoint)
}

export async function fetchExecutiveOperatorComparison(referenceDate?: string, windowDays = 30) {
  return fetchOperatorDashboardSummary(referenceDate, windowDays)
}

export function getExecutiveMetricsErrorMessage(error: unknown, role: UserRole) {
  const message = error instanceof Error ? error.message : ''

  if (!message) {
    return 'No fue posible cargar la capa ejecutiva en este momento.'
  }

  if (message.includes('Solo admin y super_admin')) {
    return 'La lectura institucional solo esta disponible para admin y super_admin.'
  }

  if (message.includes('No autorizado')) {
    return role === 'teleoperadora'
      ? 'Tu perfil no tiene alcance institucional para esta lectura.'
      : 'No fue posible autorizar la consulta ejecutiva solicitada.'
  }

  if (message.includes('Supabase no esta configurado')) {
    return message
  }

  return message
}

export type { OperatorDashboardSummaryRow }
