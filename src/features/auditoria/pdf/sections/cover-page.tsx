import { Image, Page, Text, View } from '@react-pdf/renderer'

import {
  formatAuditPdfReportType,
  formatAuditPdfRole,
  type AuditReportPayload,
} from '@/features/auditoria/pdf/types/audit-report'
import { PdfMetadataRow } from '@/features/auditoria/pdf/components/pdf-metadata-row'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function CoverPage({ payload, logoSrc }: { payload: AuditReportPayload; logoSrc: string | null | undefined }) {
  return (
    <Page size="A4" style={pdfStyles.coverPage}>
      {logoSrc ? (
        <View style={pdfStyles.coverLogoWrap}>
          <Image src={logoSrc} style={pdfStyles.coverLogo} />
        </View>
      ) : null}

      <Text style={pdfStyles.coverEyebrow}>Informe institucional</Text>
      <Text style={pdfStyles.coverTitle}>{payload.metadata.title}</Text>
      <Text style={pdfStyles.coverSubtitle}>{payload.metadata.subtitle}</Text>

      <View style={[pdfStyles.metadataPanel, pdfStyles.coverMetadataPanel]} wrap={false}>
        <PdfMetadataRow label="Tipo de informe" value={formatAuditPdfReportType(payload.reportType)} />
        <PdfMetadataRow label="Rango visual" value={payload.filters.rangeLabel} />
        <PdfMetadataRow label="Fecha de generación" value={payload.metadata.generatedAtLabel} />
        <PdfMetadataRow label="Generado por" value={payload.generatedBy.name} />
        <PdfMetadataRow
          label="Rol"
          value={formatAuditPdfRole(payload.generatedBy.role)}
          isLast
        />
      </View>
    </Page>
  )
}