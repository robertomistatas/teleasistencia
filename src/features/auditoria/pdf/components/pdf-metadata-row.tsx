import { Text, View } from '@react-pdf/renderer'

import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function PdfMetadataRow({ label, value, isLast = false }: { label: string; value: string; isLast?: boolean }) {
  return (
    <View style={isLast ? [pdfStyles.metadataRow, { borderBottomWidth: 0 }] : pdfStyles.metadataRow}>
      <Text style={pdfStyles.metadataLabel}>{label}</Text>
      <Text style={pdfStyles.metadataValue}>{value}</Text>
    </View>
  )
}