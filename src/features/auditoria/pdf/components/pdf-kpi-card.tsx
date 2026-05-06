import { Text, View } from '@react-pdf/renderer'

import type { AuditReportKpi } from '@/features/auditoria/pdf/types/audit-report'
import { getKpiToneColor, pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function PdfKpiCard({
  item,
  isPrimary = false,
  badgeLabel = 'Indicador',
  variant = 'summary',
}: {
  item: AuditReportKpi
  isPrimary?: boolean
  badgeLabel?: string
  variant?: 'summary' | 'risk'
}) {
  const cardStyles = isPrimary
    ? variant === 'risk'
      ? [pdfStyles.kpiCard, pdfStyles.kpiCardPrimary, pdfStyles.kpiCardRisk]
      : [pdfStyles.kpiCard, pdfStyles.kpiCardPrimary]
    : variant === 'risk'
      ? [pdfStyles.kpiCard, pdfStyles.kpiCardRisk]
      : pdfStyles.kpiCard

  return (
    <View style={cardStyles} wrap={false}>
      <View style={[pdfStyles.kpiBadge, { backgroundColor: getKpiToneColor(item.tone) }]}>
        <Text style={pdfStyles.kpiBadgeLabel}>{badgeLabel}</Text>
      </View>
      <View style={pdfStyles.kpiHeader}>
        <Text style={pdfStyles.kpiTitle}>{item.label}</Text>
      </View>
      <Text style={pdfStyles.kpiValue}>{item.value}</Text>
      <Text style={pdfStyles.kpiHelper}>{item.helper}</Text>
    </View>
  )
}