import { Buffer } from 'buffer'
import { pdf } from '@react-pdf/renderer'

import type {
  AuditPdfReportType,
  AuditReportGeneratedBy,
  AuditReportPayload,
} from '@/features/auditoria/pdf/types/audit-report'
import { ExecutiveAuditReportPdf } from '@/features/auditoria/pdf/templates/executive-audit-report-pdf'
import type {
  AuditExecutiveSummary,
  AuditRiskDashboard,
  AuditTeleoperatorRankingItem,
} from '@/features/auditoria/data'

import logoAssetUrl from '../../../../../media/logo.png'

const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'long',
  timeStyle: 'short',
})

function buildGeneratedBy(input: {
  name: string | null | undefined
  email: string | null | undefined
  role: string | null | undefined
}): AuditReportGeneratedBy {
  return {
    name: input.name?.trim() || input.email || 'Usuario sin nombre',
    email: input.email ?? null,
    role: input.role === 'admin' || input.role === 'super_admin' || input.role === 'teleoperadora'
      ? input.role
      : 'unknown',
  }
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('No fue posible convertir el asset del logo a data URL.'))
    }

    reader.onerror = () => {
      reject(reader.error ?? new Error('No fue posible leer el asset del logo.'))
    }

    reader.readAsDataURL(blob)
  })
}

async function resolveExecutiveAuditLogoSrc() {
  const response = await fetch(logoAssetUrl)

  if (!response.ok) {
    throw new Error(`No fue posible cargar el logo institucional. HTTP ${response.status}`)
  }

  const logoBlob = await response.blob()
  return await blobToDataUrl(logoBlob)
}

function ensureBrowserBuffer() {
  const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer }

  if (typeof browserGlobal.Buffer === 'undefined') {
    browserGlobal.Buffer = Buffer
  }
}

export function prepareExecutiveAuditReportPayload({
  summary,
  teleoperatorTable,
  riskDashboard,
  rangeLabel,
  generatedBy,
  reportType = 'executive-general',
}: {
  summary: AuditExecutiveSummary
  teleoperatorTable: AuditTeleoperatorRankingItem[]
  riskDashboard: AuditRiskDashboard
  rangeLabel: string
  generatedBy: {
    name: string | null | undefined
    email: string | null | undefined
    role: string | null | undefined
  }
  reportType?: AuditPdfReportType
}): AuditReportPayload {
  const generatedAtLabel = dateTimeFormatter.format(new Date())
  const resolvedGeneratedBy = buildGeneratedBy(generatedBy)

  return {
    metadata: {
      title: 'Informe ejecutivo de auditoría',
      subtitle: 'Estado de cobertura, cartera asignada y riesgo operativo',
      generatedAtLabel,
      templateVersion: 'v1.0.0',
      branding: 'mistatas',
    },
    executiveSummary: {
      primaryKpi: {
        label: 'Cobertura global',
        value: `${summary.metrics.upToDatePercentage}%`,
        tone: 'primary',
        helper: 'Beneficiarios al día sobre el total activo observado en la lectura actual.',
      },
      secondaryKpis: [
        {
          label: 'Beneficiarios activos',
          value: String(summary.metrics.totalActiveBeneficiaries),
          tone: 'muted',
          helper: 'Universo vigente considerado para el informe ejecutivo.',
        },
        {
          label: 'Urgentes',
          value: String(summary.metrics.totalUrgent),
          tone: 'danger',
          helper: 'Casos que requieren revisión prioritaria por falta de contacto vigente.',
        },
        {
          label: 'Sin datos',
          value: String(summary.metrics.totalNoData),
          tone: 'warning',
          helper: 'Beneficiarios sin evidencia suficiente en el estado consolidado actual.',
        },
      ],
      narrative:
        'Este informe reutiliza la lectura vigente del módulo Auditoría para presentar una síntesis ejecutiva formal, consistente y reproducible, sin recalcular métricas ni consultar nuevas fuentes.',
      alerts: [
        'La cobertura global se presenta con la misma fuente de verdad ya visible en el módulo.',
        'El ranking de teleoperadoras mantiene la lógica de cumplimiento de cartera asignada ya cargada en auditoría.',
      ],
    },
    teleoperatorMetrics: teleoperatorTable.slice(0, 8).map((item) => ({
      teleoperatorId: item.teleoperatorId,
      teleoperatorName: item.teleoperatorName,
      portfolio: item.totalPortfolio,
      upToDate: item.totalUpToDate,
      pending: item.totalPending,
      urgent: item.totalUrgent,
      noData: item.totalNoData,
      coveragePercentage: item.coveragePercentage,
    })),
    riskSummary: {
      metrics: [
        {
          label: 'Urgentes',
          value: String(riskDashboard.metrics.totalUrgent),
          helper: 'Casos que requieren atención prioritaria por falta de contacto vigente.',
          tone: 'danger',
        },
        {
          label: 'Sin datos',
          value: String(riskDashboard.metrics.totalNoData),
          helper: 'Beneficiarios sin evidencia suficiente de seguimiento en el estado consolidado.',
          tone: 'warning',
        },
        {
          label: '>30 días',
          value: String(riskDashboard.metrics.totalMoreThan30DaysWithoutContact),
          helper: 'Casos con más de 30 días desde el último contacto válido registrado.',
          tone: 'primary',
        },
        {
          label: 'Sin asignación',
          value: String(riskDashboard.metrics.totalWithoutActiveAssignment),
          helper: 'Beneficiarios sin responsable activo asignado en la cartera vigente.',
          tone: 'muted',
        },
      ],
      highlights: riskDashboard.criticalBeneficiaries.slice(0, 5).map((item) => ({
        beneficiaryName: item.beneficiaryName,
        description: `${item.riskReason}${item.teleoperatorName ? ` · ${item.teleoperatorName}` : ' · Sin asignación activa'}`,
      })),
      alerts: [
        'El bloque de riesgo conserva los mismos casos críticos ya visibles en la tab Riesgo.',
        'No se agregan cálculos nuevos: el documento consume únicamente datos ya preparados por Auditoría.',
      ],
    },
    reportType,
    filters: {
      rangeLabel,
      reportScope: 'Datos actuales del módulo de auditoría',
    },
    generatedBy: resolvedGeneratedBy,
  }
}

export async function generateExecutiveAuditReportBlob(
  payload: AuditReportPayload,
  options?: { includeLogo?: boolean },
) {
  ensureBrowserBuffer()

  const includeLogo = options?.includeLogo ?? true

  console.info('[audit-pdf] Generating executive PDF blob', {
    includeLogo,
    reportType: payload.reportType,
  })

  const logoSrc = includeLogo ? await resolveExecutiveAuditLogoSrc() : null
  const document = <ExecutiveAuditReportPdf payload={payload} logoAssetSrc={logoSrc} />
  const blob = await pdf(document).toBlob()

  console.info('[audit-pdf] Executive PDF blob generated', {
    size: blob.size,
    type: blob.type,
  })

  return blob
}

export async function downloadExecutiveAuditReportPdf(payload: AuditReportPayload) {
  const blob = await generateExecutiveAuditReportBlob(payload)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const fileDate = new Date().toISOString().slice(0, 10)

  anchor.href = url
  anchor.download = `informe-ejecutivo-auditoria-${fileDate}.pdf`
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
    anchor.remove()
  }, 1000)

  return blob
}