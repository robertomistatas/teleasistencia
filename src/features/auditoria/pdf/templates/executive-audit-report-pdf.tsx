import { Document, Font, Page } from '@react-pdf/renderer'

import type { AuditReportPayload } from '@/features/auditoria/pdf/types/audit-report'
import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'
import { CoverPage } from '@/features/auditoria/pdf/sections/cover-page'
import { ReportMetadataSection } from '@/features/auditoria/pdf/sections/report-metadata'
import { ExecutiveSummarySection } from '@/features/auditoria/pdf/sections/executive-summary-section'
import { TeleoperatorRankingSection } from '@/features/auditoria/pdf/sections/teleoperator-ranking-section'
import { RiskSummarySection } from '@/features/auditoria/pdf/sections/risk-summary-section'
import { ConclusionsAndAlertsSection } from '@/features/auditoria/pdf/sections/conclusions-and-alerts-section'
import { AuditPdfHeader } from '@/features/auditoria/pdf/sections/header'
import { AuditPdfFooter } from '@/features/auditoria/pdf/sections/footer'

import logoSrc from '../../../../../media/logo.png'

Font.registerHyphenationCallback((word) => [word])

export function ExecutiveAuditReportPdf({ payload, logoAssetSrc = logoSrc }: { payload: AuditReportPayload; logoAssetSrc?: string | null }) {
  return (
    <Document title={payload.metadata.title} author={payload.generatedBy.name} subject="Auditoría Mistatas">
      <CoverPage payload={payload} logoSrc={logoAssetSrc} />

      <Page size="A4" style={pdfStyles.page}>
        <AuditPdfHeader title={payload.metadata.title} generatedAtLabel={payload.metadata.generatedAtLabel} />
        <ReportMetadataSection payload={payload} />
        <ExecutiveSummarySection payload={payload} />
        <AuditPdfFooter />
      </Page>

      <Page size="A4" style={pdfStyles.page}>
        <AuditPdfHeader title={payload.metadata.title} generatedAtLabel={payload.metadata.generatedAtLabel} />
        <TeleoperatorRankingSection payload={payload} />
        <RiskSummarySection payload={payload} />
        <ConclusionsAndAlertsSection payload={payload} />
        <AuditPdfFooter />
      </Page>
    </Document>
  )
}