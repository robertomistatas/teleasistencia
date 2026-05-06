import { Text, View } from '@react-pdf/renderer'

import type { AuditReportKpi, AuditReportPayload } from '@/features/auditoria/pdf/types/audit-report'
import { PdfKpiCard } from '@/features/auditoria/pdf/components/pdf-kpi-card'
import { PdfSectionTitle } from '@/features/auditoria/pdf/components/pdf-section-title'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function RiskSummarySection({ payload }: { payload: AuditReportPayload }) {
  const riskKpis: AuditReportKpi[] = payload.riskSummary.metrics.map((metric) => ({
    label: metric.label,
    value: metric.value,
    tone: metric.tone,
    helper: metric.helper,
  }))
  const metricRows = [] as Array<typeof riskKpis>

  for (let index = 0; index < riskKpis.length; index += 2) {
    metricRows.push(riskKpis.slice(index, index + 2))
  }

  return (
    <View style={pdfStyles.section}>
      <PdfSectionTitle
        eyebrow="Riesgo"
        title="Resumen de criticidad operacional"
        description="Casos y alertas que hoy requieren revisión prioritaria dentro del módulo."
      />

      <View style={pdfStyles.kpiBlock}>
        {metricRows.map((row, rowIndex) => (
          <View key={`risk-row-${rowIndex}`} style={pdfStyles.kpiRow} wrap={false}>
            {row.map((metric, metricIndex) => (
              <View
                key={metric.label}
                style={
                  metricIndex < row.length - 1
                    ? [pdfStyles.kpiColumn, pdfStyles.kpiColumnGap]
                    : pdfStyles.kpiColumn
                }
              >
                <PdfKpiCard item={metric} badgeLabel="Riesgo" variant="risk" />
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={pdfStyles.listWrap}>
        {payload.riskSummary.highlights.map((item) => (
          <View key={item.beneficiaryName} style={pdfStyles.listItem} wrap={false}>
            <Text style={pdfStyles.listItemTitle}>{item.beneficiaryName}</Text>
            <Text style={pdfStyles.listItemText}>{item.description}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}