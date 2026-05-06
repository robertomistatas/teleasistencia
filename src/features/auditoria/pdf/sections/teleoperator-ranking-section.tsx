import { View } from '@react-pdf/renderer'

import type { AuditReportPayload } from '@/features/auditoria/pdf/types/audit-report'
import { PdfSectionTitle } from '@/features/auditoria/pdf/components/pdf-section-title'
import { PdfTable } from '@/features/auditoria/pdf/components/pdf-table'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

function truncateEmail(value: string, maxLength = 24) {
  if (value.length <= maxLength) {
    return value
  }

  const [localPart, domain = ''] = value.split('@')

  if (!domain) {
    return `${value.slice(0, maxLength - 1)}…`
  }

  const preservedLocal = localPart.slice(0, Math.max(8, maxLength - domain.length - 4))
  return `${preservedLocal}…@${domain}`
}

function buildTeleoperatorCell(value: string) {
  const looksLikeEmail = value.includes('@')

  if (looksLikeEmail) {
    return {
      text: truncateEmail(value),
      compact: true,
      emphasize: true,
      secondaryText: 'Sin nombre visible en el perfil',
    }
  }

  return {
    text: value,
    emphasize: true,
  }
}

export function TeleoperatorRankingSection({ payload }: { payload: AuditReportPayload }) {
  const rows = payload.teleoperatorMetrics.map((item) => ({
    key: item.teleoperatorId,
    cells: [
      buildTeleoperatorCell(item.teleoperatorName),
      { text: String(item.portfolio), align: 'right' as const },
      { text: String(item.upToDate), align: 'right' as const },
      { text: String(item.pending), align: 'right' as const },
      { text: String(item.urgent), align: 'right' as const },
      { text: String(item.noData), align: 'right' as const },
      { text: `${item.coveragePercentage}%`, align: 'right' as const, emphasize: true },
    ],
  }))

  return (
    <View style={pdfStyles.section} wrap={false}>
      <PdfSectionTitle
        eyebrow="Teleoperadoras"
        title="Cumplimiento de cartera asignada"
        description="Tabla institucional para lectura comparativa y seguimiento de cobertura actual."
      />
      <PdfTable
        columns={[
          { label: 'Responsable', flex: 2.95 },
          { label: 'Cartera', flex: 0.78, align: 'right' },
          { label: 'Al día', flex: 0.78, align: 'right' },
          { label: 'Pend.', flex: 0.82, align: 'right' },
          { label: 'Urg.', flex: 0.72, align: 'right' },
          { label: 'Sin datos', flex: 0.96, align: 'right' },
          { label: 'Cobertura', flex: 1.04, align: 'right' },
        ]}
        rows={
          rows.length > 0
            ? rows
            : [{
                key: 'empty',
                cells: [
                  { text: 'Sin datos disponibles', emphasize: true },
                  { text: '-', align: 'right' },
                  { text: '-', align: 'right' },
                  { text: '-', align: 'right' },
                  { text: '-', align: 'right' },
                  { text: '-', align: 'right' },
                  { text: '-', align: 'right' },
                ],
              }]
        }
      />
    </View>
  )
}