import { Text, View } from '@react-pdf/renderer'

import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function PdfSectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <View>
      <Text style={pdfStyles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={pdfStyles.sectionTitle}>{title}</Text>
      {description ? <Text style={pdfStyles.sectionDescription}>{description}</Text> : null}
    </View>
  )
}