import { fetchCallImportMonitoringOverview, type CallImportMonitoringRun } from '@/features/imports/data'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/lib/types'

export type OperationalKpiScope = 'global' | 'own_portfolio'

export type OperationalDashboardSummary = {
  referenceDate: string
  windowDays: number
  scope: OperationalKpiScope
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
  effectiveContactRate: number
}

export type OperatorDashboardSummaryRow = {
  operatorProfileId: string
  operatorName: string
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
  operatorEffectivenessRate: number
}

export type ImportQualityKpis = {
  windowDays: number
  importRuns: number
  processedRows: number
  validRows: number
  correlatedRows: number
  unmatchedRows: number
  duplicateRows: number
  warningRows: number
  correlationRate: number
  unmatchedRate: number
  duplicateRate: number
  warningRate: number
}

export type OverdueDashboardItem = {
  beneficiaryId: string
  beneficiaryName: string
  beneficiaryRut: string | null
  coverageState: 'urgente' | 'pendiente' | 'sin_contacto' | 'al_dia'
  agingDays: number | null
  overdueDays: number | null
  staleBeneficiary: boolean
  lastEffectiveFollowupAt: string | null
  assignedOperatorProfileId: string | null
  assignedOperatorName: string | null
  priorityRank: number
}

type SummaryRpcResponse = {
  referenceDate: string
  windowDays: number
  scope: OperationalKpiScope
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
  effectiveContactRate: number
}

type OperatorSummaryRpcRow = {
  operator_profile_id: string
  operator_name: string
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
  operator_effectiveness_rate: number
}

type ImportQualityRpcResponse = {
  windowDays: number
  importRuns: number
  processedRows: number
  validRows: number
  correlatedRows: number
  unmatchedRows: number
  duplicateRows: number
  warningRows: number
  correlationRate: number
  unmatchedRate: number
  duplicateRate: number
  warningRate: number
}

type OverdueRpcRow = {
  beneficiary_id: string
  beneficiary_name: string
  beneficiary_rut: string | null
  coverage_state: 'urgente' | 'pendiente' | 'sin_contacto' | 'al_dia'
  aging_days: number | null
  overdue_days: number | null
  stale_beneficiary: boolean
  last_effective_followup_at: string | null
  assigned_operator_profile_id: string | null
  assigned_operator_name: string | null
  priority_rank: number
}

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado.')
  }

  return supabase
}

function mapSummary(payload: SummaryRpcResponse | null): OperationalDashboardSummary {
  if (!payload) {
    throw new Error('No fue posible construir el resumen operacional KPI.')
  }

  return {
    referenceDate: payload.referenceDate,
    windowDays: payload.windowDays,
    scope: payload.scope,
    totalBeneficiaries: payload.totalBeneficiaries,
    effectiveBeneficiaries: payload.effectiveBeneficiaries,
    pendingBeneficiaries: payload.pendingBeneficiaries,
    overdueBeneficiaries: payload.overdueBeneficiaries,
    urgentBeneficiaries: payload.urgentBeneficiaries,
    staleBeneficiaries: payload.staleBeneficiaries,
    effectiveCoverage: payload.effectiveCoverage,
    pendingCoverage: payload.pendingCoverage,
    overdueCoverage: payload.overdueCoverage,
    urgentCoverage: payload.urgentCoverage,
    avgAgingDays: payload.avgAgingDays,
    avgOverdueDays: payload.avgOverdueDays,
    successfulFollowups: payload.successfulFollowups,
    failedFollowups: payload.failedFollowups,
    effectiveContactRate: payload.effectiveContactRate,
  }
}

function mapOperatorRow(row: OperatorSummaryRpcRow): OperatorDashboardSummaryRow {
  return {
    operatorProfileId: row.operator_profile_id,
    operatorName: row.operator_name,
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
    operatorEffectivenessRate: row.operator_effectiveness_rate,
  }
}

function mapImportQuality(payload: ImportQualityRpcResponse | null): ImportQualityKpis {
  if (!payload) {
    throw new Error('No fue posible construir el panel de calidad de importacion.')
  }

  return {
    windowDays: payload.windowDays,
    importRuns: payload.importRuns,
    processedRows: payload.processedRows,
    validRows: payload.validRows,
    correlatedRows: payload.correlatedRows,
    unmatchedRows: payload.unmatchedRows,
    duplicateRows: payload.duplicateRows,
    warningRows: payload.warningRows,
    correlationRate: payload.correlationRate,
    unmatchedRate: payload.unmatchedRate,
    duplicateRate: payload.duplicateRate,
    warningRate: payload.warningRate,
  }
}

function mapOverdueRow(row: OverdueRpcRow): OverdueDashboardItem {
  return {
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: row.beneficiary_name,
    beneficiaryRut: row.beneficiary_rut,
    coverageState: row.coverage_state,
    agingDays: row.aging_days,
    overdueDays: row.overdue_days,
    staleBeneficiary: row.stale_beneficiary,
    lastEffectiveFollowupAt: row.last_effective_followup_at,
    assignedOperatorProfileId: row.assigned_operator_profile_id,
    assignedOperatorName: row.assigned_operator_name,
    priorityRank: row.priority_rank,
  }
}

export async function fetchOperationalDashboardSummary(referenceDate?: string, windowDays = 30) {
  const { data, error } = await assertSupabase().rpc('get_operational_kpi_summary', {
    p_reference_date: referenceDate ?? new Date().toISOString().slice(0, 10),
    p_window_days: windowDays,
  })

  if (error) {
    throw error
  }

  return mapSummary((data as SummaryRpcResponse | null) ?? null)
}

export async function fetchOperatorDashboardSummary(referenceDate?: string, windowDays = 30) {
  const { data, error } = await assertSupabase().rpc('get_operator_kpi_summary', {
    p_reference_date: referenceDate ?? new Date().toISOString().slice(0, 10),
    p_window_days: windowDays,
  })

  if (error) {
    throw error
  }

  return ((data as OperatorSummaryRpcRow[] | null) ?? []).map(mapOperatorRow)
}

export async function fetchImportQualityKpis(days = 30) {
  const { data, error } = await assertSupabase().rpc('get_import_quality_kpis', {
    p_days: days,
  })

  if (error) {
    throw error
  }

  return mapImportQuality((data as ImportQualityRpcResponse | null) ?? null)
}

export async function fetchOverdueDashboardItems(limit = 12) {
  const { data, error } = await assertSupabase().rpc('get_overdue_beneficiaries', {
    p_limit: limit,
  })

  if (error) {
    throw error
  }

  return ((data as OverdueRpcRow[] | null) ?? []).map(mapOverdueRow)
}

export async function fetchOperationalDashboardRecentImports(limit = 6) {
  const overview = await fetchCallImportMonitoringOverview(limit)

  return {
    summary: overview.summary,
    imports: overview.imports,
  } satisfies {
    summary: {
      totalImports: number
      successfulImports: number
      importsWithErrors: number
      correlationRate: number
    }
    imports: CallImportMonitoringRun[]
  }
}

export function getOperationalDashboardErrorMessage(error: unknown, role: UserRole) {
  const message = error instanceof Error ? error.message : ''

  if (!message) {
    return 'No fue posible cargar la consola operacional en este momento.'
  }

  if (message.includes('No autorizado')) {
    return role === 'teleoperadora'
      ? 'Tu perfil no tiene alcance visible para ese panel operacional.'
      : 'No fue posible autorizar la consulta operacional solicitada.'
  }

  if (message.includes('Solo admin y super_admin')) {
    return 'Este panel administrativo solo esta disponible para admin y super_admin.'
  }

  if (message.includes('Supabase no esta configurado')) {
    return message
  }

  return message
}
