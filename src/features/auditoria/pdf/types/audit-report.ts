import type { UserRole } from '@/lib/types'

export type AuditPdfReportType =
  | 'executive-general'
  | 'teleoperator-portfolio'
  | 'risk'
  | 'data-quality'
  | 'amaia-calls'
  | 'manual-actions'

export type AuditReportMetadata = {
  title: string
  subtitle: string
  generatedAtLabel: string
  templateVersion: string
  branding: 'mistatas'
}

export type AuditReportGeneratedBy = {
  name: string
  email: string | null
  role: UserRole | 'unknown'
}

export type AuditReportFilters = {
  rangeLabel: string
  reportScope: string
}

export type AuditReportKpi = {
  label: string
  value: string
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted'
  helper: string
}

export type AuditReportExecutiveSummary = {
  primaryKpi: AuditReportKpi
  secondaryKpis: AuditReportKpi[]
  narrative: string
  alerts: string[]
}

export type AuditReportTeleoperatorMetric = {
  teleoperatorId: string
  teleoperatorName: string
  portfolio: number
  upToDate: number
  pending: number
  urgent: number
  noData: number
  coveragePercentage: number
}

export type AuditReportRiskMetric = {
  label: string
  value: string
  helper: string
  tone: 'success' | 'warning' | 'danger' | 'muted' | 'primary'
}

export type AuditReportRiskHighlight = {
  beneficiaryName: string
  description: string
}

export type AuditReportRiskSummary = {
  metrics: AuditReportRiskMetric[]
  highlights: AuditReportRiskHighlight[]
  alerts: string[]
}

export type AuditReportPayload = {
  metadata: AuditReportMetadata
  executiveSummary: AuditReportExecutiveSummary
  teleoperatorMetrics: AuditReportTeleoperatorMetric[]
  riskSummary: AuditReportRiskSummary
  reportType: AuditPdfReportType
  filters: AuditReportFilters
  generatedBy: AuditReportGeneratedBy
}

export function formatAuditPdfReportType(reportType: AuditPdfReportType) {
  if (reportType === 'executive-general') {
    return 'Informe ejecutivo general'
  }

  if (reportType === 'teleoperator-portfolio') {
    return 'Informe de cartera por teleoperadora'
  }

  if (reportType === 'risk') {
    return 'Informe de riesgo operativo'
  }

  if (reportType === 'data-quality') {
    return 'Informe de calidad de datos'
  }

  if (reportType === 'amaia-calls') {
    return 'Informe de llamadas Amaia'
  }

  return 'Informe de acciones manuales'
}

export function formatAuditPdfRole(role: AuditReportGeneratedBy['role']) {
  if (role === 'super_admin') {
    return 'Super administración'
  }

  if (role === 'admin') {
    return 'Administración'
  }

  if (role === 'teleoperadora') {
    return 'Teleoperadora'
  }

  return 'Sin rol identificado'
}