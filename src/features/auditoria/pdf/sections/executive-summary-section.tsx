import { Text, View } from '@react-pdf/renderer'

import type { AuditReportPayload } from '@/features/auditoria/pdf/types/audit-report'
import { PdfKpiCard } from '@/features/auditoria/pdf/components/pdf-kpi-card'
import { PdfSectionTitle } from '@/features/auditoria/pdf/components/pdf-section-title'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function ExecutiveSummarySection({ payload }: { payload: AuditReportPayload }) {
  const secondaryKpis = payload.executiveSummary.secondaryKpis
  const secondaryRows = [] as Array<typeof secondaryKpis>

  for (let index = 0; index < secondaryKpis.length; index += 2) {
    secondaryRows.push(secondaryKpis.slice(index, index + 2))
  }

  return (
    <View style={pdfStyles.section} wrap={false}>
      <PdfSectionTitle
        eyebrow="Resumen ejecutivo"
        title="Lectura principal de la operación"
        description="Síntesis construida con los datos ya consolidados del módulo de auditoría."
      />

      <View style={pdfStyles.narrativeCard} wrap={false}>
        <Text style={pdfStyles.narrativeText}>{payload.executiveSummary.narrative}</Text>
      </View>

      <View style={pdfStyles.kpiBlock}>
        <PdfKpiCard item={payload.executiveSummary.primaryKpi} isPrimary badgeLabel="Resumen" />

        {secondaryRows.map((row, rowIndex) => (
          <View key={`secondary-row-${rowIndex}`} style={pdfStyles.kpiRow} wrap={false}>
            {row.map((item, itemIndex) => (
              <View
                key={item.label}
                style={
                  itemIndex < row.length - 1
                    ? [pdfStyles.kpiColumn, pdfStyles.kpiColumnGap]
                    : pdfStyles.kpiColumn
                }
              >
                <PdfKpiCard item={item} badgeLabel="Indicador" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}