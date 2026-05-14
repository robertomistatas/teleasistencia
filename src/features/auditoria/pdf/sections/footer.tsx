import { Text, View } from '@react-pdf/renderer'

import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function AuditPdfFooter() {
  return (
    <View fixed style={pdfStyles.footer}>
      <Text style={pdfStyles.footerText}>Documento institucional Mistatas</Text>
      <Text
        style={pdfStyles.footerText}
        render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
      />
    </View>
  )
}