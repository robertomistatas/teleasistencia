import { View } from '@react-pdf/renderer'

import { formatAuditPdfReportType, type AuditReportPayload } from '@/features/auditoria/pdf/types/audit-report'
import { PdfMetadataRow } from '@/features/auditoria/pdf/components/pdf-metadata-row'
import { PdfSectionTitle } from '@/features/auditoria/pdf/components/pdf-section-title'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function ReportMetadataSection({ payload }: { payload: AuditReportPayload }) {
  return (
    <View style={pdfStyles.section} wrap={false}>
      <PdfSectionTitle
        eyebrow="Control documental"
        title="Datos del informe"
        description="Resumen de alcance y control documental del reporte ejecutivo."
      />
      <View style={pdfStyles.metadataPanel}>
        <PdfMetadataRow label="Tipo" value={formatAuditPdfReportType(payload.reportType)} />
        <PdfMetadataRow label="Rango" value={payload.filters.rangeLabel} />
        <PdfMetadataRow label="Alcance" value={payload.filters.reportScope} />
        <PdfMetadataRow label="Versión" value={payload.metadata.templateVersion} />
        <PdfMetadataRow label="Usuario" value={payload.generatedBy.name} isLast />
      </View>
    </View>
  )
}