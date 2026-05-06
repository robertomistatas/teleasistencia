import { Text, View } from '@react-pdf/renderer'

import type { AuditReportPayload } from '@/features/auditoria/pdf/types/audit-report'
import { PdfSectionTitle } from '@/features/auditoria/pdf/components/pdf-section-title'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function ConclusionsAndAlertsSection({ payload }: { payload: AuditReportPayload }) {
  const conclusions = [
    ...payload.executiveSummary.alerts,
    ...payload.riskSummary.alerts,
  ]

  return (
    <View style={pdfStyles.section} wrap={false}>
      <PdfSectionTitle
        eyebrow="Conclusiones"
        title="Hallazgos y alertas"
        description="Cierre ejecutivo preparado para lectura institucional y decisiones de seguimiento."
      />
      <View style={pdfStyles.conclusionBox} wrap={false}>
        {conclusions.map((item) => (
          <View key={item} style={pdfStyles.bulletRow}>
            <Text style={pdfStyles.bulletMark}>•</Text>
            <Text style={pdfStyles.bulletText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}