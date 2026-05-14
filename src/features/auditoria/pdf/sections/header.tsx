import { Text, View } from '@react-pdf/renderer'

import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function AuditPdfHeader({ title, generatedAtLabel }: { title: string; generatedAtLabel: string }) {
  return (
    <View fixed style={pdfStyles.header}>
      <View style={pdfStyles.headerBrandBlock}>
        <Text style={pdfStyles.headerTitle}>Mistatas · Informe ejecutivo</Text>
        <Text style={pdfStyles.headerDocumentTitle}>{title}</Text>
      </View>
      <View style={pdfStyles.headerMetaBlock}>
        <Text style={pdfStyles.headerMeta}>{generatedAtLabel}</Text>
      </View>
    </View>
  )
}