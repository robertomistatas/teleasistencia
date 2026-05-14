import { StyleSheet } from '@react-pdf/renderer'

export const auditPdfColors = {
  celeste: '#2D8CDE',
  lila: '#8752E8',
  rosa: '#D46ABB',
  gris: '#64748B',
  blanco: '#FFFFFF',
  texto: '#0B1526',
  borde: '#E4EBF3',
  fondoSuave: '#F7FAFC',
  exito: '#2E8B57',
  advertencia: '#B9770E',
  peligro: '#C65A5A',
  textoSuave: '#8A94A6',
  azulProfundo: '#173B63',
  fondoAzul: '#F3F8FC',
  fondoRiesgo: '#FFF7F4',
  fondoLavanda: '#F7F3FD',
  fondoRosa: '#FBF4F8',
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
    paddingTop: 48,
    paddingBottom: 34,
    paddingHorizontal: 42,
    lineHeight: 1.42,
  },
  coverPage: {
    backgroundColor: auditPdfColors.blanco,
    color: auditPdfColors.texto,
    fontFamily: auditPdfFontFamilies.body,
    fontSize: 11,
    paddingTop: 34,
    paddingBottom: 34,
    paddingHorizontal: 42,
    lineHeight: 1.42,
  },
  header: {
    position: 'absolute',
    top: 14,
    left: 42,
    right: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
    paddingBottom: 4,
  },
  headerBrandBlock: {
    maxWidth: '60%',
  },
  headerTitle: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 7.2,
    color: auditPdfColors.azulProfundo,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerDocumentTitle: {
    marginTop: 2,
    fontSize: 9.2,
    color: auditPdfColors.gris,
  },
  headerMetaBlock: {
    maxWidth: '28%',
  },
  headerMeta: {
    fontSize: 7.4,
    color: auditPdfColors.textoSuave,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 42,
    right: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.35,
    borderTopColor: auditPdfColors.borde,
    paddingTop: 4,
  },
  footerText: {
    fontSize: 6.7,
    color: auditPdfColors.textoSuave,
  },
  coverBrandBlock: {
    alignSelf: 'flex-end',
    width: 88,
  },
  coverLogoWrap: {
    width: 88,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  coverLogo: {
    width: 88,
    height: 64,
    objectFit: 'contain',
    alignSelf: 'center',
  },
  coverAccentRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  coverRule: {
    width: 56,
    height: 2.5,
    backgroundColor: auditPdfColors.celeste,
  },
  coverRuleSoft: {
    marginLeft: 8,
    width: 18,
    height: 2.5,
    backgroundColor: auditPdfColors.lila,
    opacity: 0.55,
  },
  coverEyebrow: {
    marginTop: 52,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 8.5,
    color: auditPdfColors.azulProfundo,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  coverTitle: {
    marginTop: 16,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 28,
    color: auditPdfColors.texto,
    lineHeight: 1.12,
    maxWidth: 410,
  },
  coverSubtitle: {
    marginTop: 14,
    fontSize: 10.8,
    color: auditPdfColors.gris,
    lineHeight: 1.58,
    maxWidth: 320,
  },
  metadataPanel: {
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: auditPdfColors.borde,
    paddingTop: 12,
    paddingBottom: 0,
    backgroundColor: auditPdfColors.blanco,
  },
  coverMetadataPanel: {
    marginTop: 76,
    maxWidth: 344,
  },
  section: {
    marginTop: 22,
  },
  sectionEyebrow: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 7.8,
    color: auditPdfColors.azulProfundo,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    marginTop: 6,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 15,
    color: auditPdfColors.texto,
    lineHeight: 1.18,
  },
  sectionDescription: {
    marginTop: 6,
    fontSize: 9.2,
    color: auditPdfColors.gris,
    lineHeight: 1.5,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
  },
  metadataLabel: {
    fontSize: 7.5,
    color: auditPdfColors.textoSuave,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
    maxWidth: '34%',
  },
  metadataValue: {
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 9.4,
    color: auditPdfColors.texto,
    textAlign: 'right',
    maxWidth: '60%',
  },
  narrativeCard: {
    marginTop: 12,
    borderLeftWidth: 2,
    borderLeftColor: auditPdfColors.celeste,
    paddingTop: 2,
    paddingRight: 12,
    paddingBottom: 2,
    paddingLeft: 12,
    backgroundColor: auditPdfColors.blanco,
  },
  narrativeText: {
    fontSize: 9.5,
    color: auditPdfColors.texto,
    lineHeight: 1.6,
  },
  kpiBlock: {
    marginTop: 16,
  },
  kpiRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  kpiColumn: {
    flex: 1,
  },
  kpiColumnGap: {
    marginRight: 12,
  },
  kpiCardPrimary: {
    width: '100%',
    minHeight: 136,
    backgroundColor: auditPdfColors.fondoAzul,
    borderTopWidth: 1.4,
    borderTopColor: auditPdfColors.celeste,
  },
  kpiCard: {
    borderWidth: 0.7,
    borderColor: auditPdfColors.borde,
    borderRadius: 12,
    paddingTop: 12,
    paddingRight: 14,
    paddingBottom: 16,
    paddingLeft: 14,
    backgroundColor: auditPdfColors.blanco,
    minHeight: 120,
  },
  kpiCardRisk: {
    minHeight: 112,
    backgroundColor: auditPdfColors.fondoSuave,
  },
  kpiHeader: {
    minHeight: 28,
  },
  kpiTitle: {
    marginTop: 8,
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 8.9,
    color: auditPdfColors.azulProfundo,
    lineHeight: 1.25,
  },
  kpiBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 1.6,
    paddingHorizontal: 5.5,
    borderWidth: 0.45,
  },
  kpiBadgeLabel: {
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 6.5,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  kpiValue: {
    marginTop: 14,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 24.5,
    color: auditPdfColors.azulProfundo,
  },
  kpiHelper: {
    marginTop: 12,
    fontSize: 8.1,
    color: auditPdfColors.textoSuave,
    lineHeight: 1.42,
  },
  tableWrap: {
    marginTop: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: auditPdfColors.borde,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: auditPdfColors.blanco,
    borderBottomWidth: 1,
    borderBottomColor: auditPdfColors.borde,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.6,
    borderBottomColor: auditPdfColors.borde,
  },
  tableRowAlt: {
    backgroundColor: '#FBFCFE',
  },
  tableCell: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 10,
    fontSize: 8.8,
    color: auditPdfColors.texto,
  },
  tableCellPrimary: {
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 9,
    lineHeight: 1.18,
  },
  tableCellSecondary: {
    marginTop: 3,
    fontSize: 7.1,
    color: auditPdfColors.textoSuave,
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
    paddingVertical: 7,
    paddingHorizontal: 10,
    fontFamily: auditPdfFontFamilies.title,
    fontSize: 7.1,
    color: auditPdfColors.textoSuave,
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  tableHeaderCellRight: {
    textAlign: 'right',
  },
  listWrap: {
    marginTop: 14,
  },
  listItem: {
    marginTop: 8,
    borderLeftWidth: 2,
    borderLeftColor: auditPdfColors.lila,
    paddingTop: 3,
    paddingRight: 0,
    paddingBottom: 3,
    paddingLeft: 12,
    backgroundColor: auditPdfColors.blanco,
  },
  listItemTitle: {
    fontFamily: auditPdfFontFamilies.bodyMedium,
    fontSize: 10.2,
    fontWeight: 700,
    color: auditPdfColors.texto,
  },
  listItemText: {
    marginTop: 4,
    fontSize: 8.5,
    color: auditPdfColors.gris,
    lineHeight: 1.42,
  },
  conclusionBox: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: auditPdfColors.borde,
    paddingTop: 8,
    paddingBottom: 2,
    paddingHorizontal: 0,
    backgroundColor: auditPdfColors.blanco,
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
    fontSize: 8,
    color: auditPdfColors.rosa,
  },
  bulletText: {
    flex: 1,
    fontSize: 9.2,
    color: auditPdfColors.texto,
    lineHeight: 1.5,
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

export function getKpiToneSurface(tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted') {
  if (tone === 'success') {
    return '#F2FBF6'
  }

  if (tone === 'warning') {
    return '#FFF8EE'
  }

  if (tone === 'danger') {
    return '#FFF3F2'
  }

  if (tone === 'muted') {
    return '#F6F8FB'
  }

  return '#F1F7FC'
}