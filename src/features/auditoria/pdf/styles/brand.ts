import { StyleSheet } from '@react-pdf/renderer'

export const auditPdfColors = {
  celeste: '#33A6FA',
  lila: '#8752E8',
  rosa: '#E547C9',
  gris: '#666666',
  blanco: '#FFFFFF',
  texto: '#0F172A',
  borde: '#D9E4F1',
  fondoSuave: '#F6FAFE',
  exito: '#0F9D6C',
  advertencia: '#D98A00',
  peligro: '#D64562',
} as const

export const auditPdfSpacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const

export const auditPdfFontFamilies = {
  title: 'Helvetica-Bold',
  body: 'Helvetica',
  bodyMedium: 'Helvetica-Bold',
} as const

export const pdfStyles = StyleSheet.create({
  page: {
    backgroundColor: auditPdfColors.blanco,
    color: auditPdfColors.texto,
    fontFamily: auditPdfFontFamilies.body,
    fontSize: 11,
    paddingTop: 54,
    paddingBottom: 40,
    paddingHorizontal: 38,
    lineHeight: 1.4,
  },
  coverPage: {
    backgroundColor: auditPdfColors.blanco,
    color: auditPdfColors.texto,
    fontFamily: auditPdfFontFamilies.body,
    fontSize: 11,
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 38,
    lineHeight: 1.4,
  },
  header: {
    position: 'absolute',
    top: 16,
    left: 38,
    right: 38,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
    paddingBottom: 6,
  },
  headerBrandBlock: {
    maxWidth: '62%',
  },
  headerTitle: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 8,
    color: auditPdfColors.celeste,
    textTransform: 'uppercase',
  },
  headerDocumentTitle: {
    marginTop: 3,
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 10,
    color: auditPdfColors.texto,
  },
  headerMetaBlock: {
    maxWidth: '34%',
  },
  headerMeta: {
    fontSize: 8.5,
    color: auditPdfColors.gris,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 38,
    right: 38,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: auditPdfColors.borde,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 8,
    color: auditPdfColors.gris,
  },
  coverLogoWrap: {
    width: 114,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    borderRadius: 14,
  },
  coverLogo: {
    width: 90,
    height: 72,
    objectFit: 'contain',
    alignSelf: 'center',
  },
  coverEyebrow: {
    marginTop: 22,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 10,
    color: auditPdfColors.celeste,
    textTransform: 'uppercase',
  },
  coverTitle: {
    marginTop: 12,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 24,
    color: auditPdfColors.texto,
    lineHeight: 1.18,
    maxWidth: 390,
  },
  coverSubtitle: {
    marginTop: 10,
    fontSize: 12,
    color: auditPdfColors.gris,
    lineHeight: 1.45,
    maxWidth: 370,
  },
  metadataPanel: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    borderRadius: 14,
    padding: 14,
    backgroundColor: auditPdfColors.fondoSuave,
  },
  coverMetadataPanel: {
    marginTop: 24,
    maxWidth: 380,
  },
  section: {
    marginTop: 18,
  },
  sectionEyebrow: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 9,
    color: auditPdfColors.celeste,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    marginTop: 5,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 16,
    color: auditPdfColors.texto,
  },
  sectionDescription: {
    marginTop: 5,
    fontSize: 10,
    color: auditPdfColors.gris,
    lineHeight: 1.45,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
  },
  metadataLabel: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 8,
    color: auditPdfColors.gris,
    textTransform: 'uppercase',
    maxWidth: '38%',
  },
  metadataValue: {
    fontSize: 10,
    color: auditPdfColors.texto,
    textAlign: 'right',
    maxWidth: '58%',
  },
  narrativeCard: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    backgroundColor: auditPdfColors.fondoSuave,
    padding: 14,
  },
  narrativeText: {
    fontSize: 10,
    color: auditPdfColors.texto,
    lineHeight: 1.5,
  },
  kpiBlock: {
    marginTop: 14,
  },
  kpiRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  kpiColumn: {
    flex: 1,
  },
  kpiColumnGap: {
    marginRight: 12,
  },
  kpiCardPrimary: {
    width: '100%',
    minHeight: 132,
  },
  kpiCard: {
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    borderRadius: 14,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 14,
    paddingLeft: 12,
    backgroundColor: auditPdfColors.blanco,
    minHeight: 120,
  },
  kpiCardRisk: {
    minHeight: 112,
  },
  kpiHeader: {
    minHeight: 32,
  },
  kpiTitle: {
    marginTop: 7,
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 10,
    color: auditPdfColors.texto,
    lineHeight: 1.22,
  },
  kpiBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  kpiBadgeLabel: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 7.5,
    color: auditPdfColors.blanco,
    textTransform: 'uppercase',
  },
  kpiValue: {
    marginTop: 12,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 21,
    color: auditPdfColors.texto,
  },
  kpiHelper: {
    marginTop: 10,
    fontSize: 9,
    color: auditPdfColors.gris,
    lineHeight: 1.4,
  },
  tableWrap: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    borderRadius: 14,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: auditPdfColors.fondoSuave,
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
  },
  tableCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 9,
    color: auditPdfColors.texto,
  },
  tableCellPrimary: {
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 9.2,
    lineHeight: 1.2,
  },
  tableCellSecondary: {
    marginTop: 3,
    fontSize: 7.4,
    color: auditPdfColors.gris,
    lineHeight: 1.2,
  },
  tableCellCompact: {
    fontSize: 7.9,
    lineHeight: 1.18,
  },
  tableCellRight: {
    textAlign: 'right',
  },
  tableHeaderCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 7.8,
    color: auditPdfColors.gris,
    textTransform: 'uppercase',
  },
  tableHeaderCellRight: {
    textAlign: 'right',
  },
  listWrap: {
    marginTop: 10,
  },
  listItem: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    borderRadius: 14,
    padding: 12,
    backgroundColor: auditPdfColors.fondoSuave,
  },
  listItemTitle: {
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 11,
    fontWeight: 700,
    color: auditPdfColors.texto,
  },
  listItemText: {
    marginTop: 4,
    fontSize: 9,
    color: auditPdfColors.gris,
    lineHeight: 1.35,
  },
  conclusionBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: auditPdfColors.borde,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: auditPdfColors.fondoSuave,
  },
  conclusionItem: {
    marginTop: 8,
    fontSize: 10,
    color: auditPdfColors.texto,
    lineHeight: 1.4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  bulletMark: {
    width: 10,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 10,
    color: auditPdfColors.celeste,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: auditPdfColors.texto,
    lineHeight: 1.4,
  },
})

export function getKpiToneColor(tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted') {
  if (tone === 'success') {
    return auditPdfColors.exito
  }

  if (tone === 'warning') {
    return auditPdfColors.advertencia
  }

  if (tone === 'danger') {
    return auditPdfColors.peligro
  }

  if (tone === 'muted') {
    return auditPdfColors.gris
  }

  return auditPdfColors.celeste
}