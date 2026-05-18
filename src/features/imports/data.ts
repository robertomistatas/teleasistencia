import { read, utils } from 'xlsx'

import { supabase } from '@/lib/supabase'

const EXPECTED_HEADERS = ['RUT', 'Nombre', 'Telefono', 'Tipo telefono'] as const

type ExpectedHeader = (typeof EXPECTED_HEADERS)[number]

export type BeneficiaryImportParsedRow = {
  rowNumber: number
  rut: string
  nombre: string
  telefono: string
  tipoTelefono: string
}

export type BeneficiaryImportPreviewRow = {
  rowNumber: number
  rawPayload: BeneficiaryImportParsedRow
  normalizedPayload: {
    rutNormalized: string | null
    beneficiaryName: string | null
    inputName: string | null
    phoneNormalized: string | null
    importContactType: 'principal' | 'red_apoyo' | null
    contactType: string | null
    isPrimary: boolean | null
  }
  resultStatus: 'created' | 'updated' | 'skipped' | 'warning' | 'error'
  message: string
  beneficiaryId: string | null
  contactId: string | null
  shouldCreateBeneficiary: boolean
  shouldUpdateBeneficiaryName: boolean
  shouldCreateContact: boolean
  shouldReplacePrimary: boolean
}

export type BeneficiaryImportSummary = {
  totalRows: number
  createdRows: number
  updatedRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
}

export type BeneficiaryImportPreviewResult = {
  sourceFilename: string | null
  summary: BeneficiaryImportSummary
  rows: BeneficiaryImportPreviewRow[]
}

export type BeneficiaryImportExecutionResult = BeneficiaryImportPreviewResult & {
  runId: string
  status: string
}

export type ImportRunSummary = {
  id: string
  createdAt: string
  sourceFilename: string
  status: string
  totalRows: number
  createdRows: number
  updatedRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
  finishedAt: string | null
}

type ImportRunRow = {
  id: string
  created_at: string
  source_filename: string
  status: string
  total_rows: number
  created_rows: number
  updated_rows: number
  skipped_rows: number
  warning_rows: number
  error_rows: number
  finished_at: string | null
}

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado.')
  }

  return supabase
}

function normalizeHeaderValue(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeCellValue(value: unknown) {
  return String(value ?? '').trim()
}

function getExactHeaderError(headers: string[]) {
  const expected = EXPECTED_HEADERS.join(' | ')
  const obtained = headers.length > 0 ? headers.join(' | ') : '(sin encabezados)'

  return `El archivo debe traer exactamente las columnas ${expected}. Encabezados detectados: ${obtained}.`
}

export async function parseBeneficiaryImportFile(file: File) {
  const workbook = read(await file.arrayBuffer(), {
    type: 'array',
    raw: false,
    cellText: true,
  })

  if (workbook.SheetNames.length !== 1) {
    throw new Error('El archivo debe contener una sola hoja.')
  }

  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    throw new Error('El archivo Excel no contiene hojas visibles.')
  }

  const sheet = workbook.Sheets[firstSheetName]

  if (!sheet) {
    throw new Error('No fue posible leer la hoja principal del archivo.')
  }

  const matrix = utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })

  if (matrix.length === 0) {
    throw new Error('El archivo esta vacio.')
  }

  const headerRow = (matrix[0] ?? []).map(normalizeHeaderValue)
  const firstFourHeaders = headerRow.slice(0, EXPECTED_HEADERS.length)
  const extraHeaders = headerRow.slice(EXPECTED_HEADERS.length).filter((value) => value.length > 0)

  if (
    extraHeaders.length > 0
    || firstFourHeaders.length !== EXPECTED_HEADERS.length
    || firstFourHeaders.some((header, index) => header !== EXPECTED_HEADERS[index])
  ) {
    throw new Error(getExactHeaderError(firstFourHeaders.concat(extraHeaders)))
  }

  const rows: BeneficiaryImportParsedRow[] = []

  matrix.slice(1).forEach((row, rowIndex) => {
    const cells = (row ?? []).map(normalizeCellValue)
    const firstFourCells = cells.slice(0, EXPECTED_HEADERS.length)
    const extraCells = cells.slice(EXPECTED_HEADERS.length).filter((value) => value.length > 0)
    const isEmptyRow = firstFourCells.every((value) => value.length === 0)

    if (isEmptyRow) {
      return
    }

    if (extraCells.length > 0) {
      throw new Error(`La fila ${rowIndex + 2} contiene columnas adicionales fuera de A-D.`)
    }

    rows.push({
      rowNumber: rowIndex + 2,
      rut: firstFourCells[0] ?? '',
      nombre: firstFourCells[1] ?? '',
      telefono: firstFourCells[2] ?? '',
      tipoTelefono: firstFourCells[3] ?? '',
    })
  })

  if (rows.length === 0) {
    throw new Error('El archivo no contiene filas de datos debajo del encabezado.')
  }

  return {
    fileName: file.name,
    headers: [...EXPECTED_HEADERS] as ExpectedHeader[],
    rows,
  }
}

function ensureObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.')
  }

  return value as Record<string, unknown>
}

function mapSummary(value: unknown): BeneficiaryImportSummary {
  const object = ensureObject(value)

  return {
    totalRows: Number(object.totalRows ?? 0),
    createdRows: Number(object.createdRows ?? 0),
    updatedRows: Number(object.updatedRows ?? 0),
    skippedRows: Number(object.skippedRows ?? 0),
    warningRows: Number(object.warningRows ?? 0),
    errorRows: Number(object.errorRows ?? 0),
  }
}

function mapPreviewRow(value: unknown): BeneficiaryImportPreviewRow {
  const object = ensureObject(value)
  const normalizedPayload = ensureObject(object.normalizedPayload)
  const rawPayload = ensureObject(object.rawPayload)

  return {
    rowNumber: Number(object.rowNumber ?? 0),
    rawPayload: {
      rowNumber: Number(rawPayload.rowNumber ?? object.rowNumber ?? 0),
      rut: String(rawPayload.rut ?? ''),
      nombre: String(rawPayload.nombre ?? ''),
      telefono: String(rawPayload.telefono ?? ''),
      tipoTelefono: String(rawPayload.tipoTelefono ?? ''),
    },
    normalizedPayload: {
      rutNormalized: typeof normalizedPayload.rutNormalized === 'string' ? normalizedPayload.rutNormalized : null,
      beneficiaryName: typeof normalizedPayload.beneficiaryName === 'string' ? normalizedPayload.beneficiaryName : null,
      inputName: typeof normalizedPayload.inputName === 'string' ? normalizedPayload.inputName : null,
      phoneNormalized: typeof normalizedPayload.phoneNormalized === 'string' ? normalizedPayload.phoneNormalized : null,
      importContactType: normalizedPayload.importContactType === 'principal' || normalizedPayload.importContactType === 'red_apoyo'
        ? normalizedPayload.importContactType
        : null,
      contactType: typeof normalizedPayload.contactType === 'string' ? normalizedPayload.contactType : null,
      isPrimary: typeof normalizedPayload.isPrimary === 'boolean' ? normalizedPayload.isPrimary : null,
    },
    resultStatus: String(object.resultStatus ?? 'error') as BeneficiaryImportPreviewRow['resultStatus'],
    message: String(object.message ?? ''),
    beneficiaryId: typeof object.beneficiaryId === 'string' ? object.beneficiaryId : null,
    contactId: typeof object.contactId === 'string' ? object.contactId : null,
    shouldCreateBeneficiary: Boolean(object.shouldCreateBeneficiary),
    shouldUpdateBeneficiaryName: Boolean(object.shouldUpdateBeneficiaryName),
    shouldCreateContact: Boolean(object.shouldCreateContact),
    shouldReplacePrimary: Boolean(object.shouldReplacePrimary),
  }
}

function mapPreviewResult(value: unknown): BeneficiaryImportPreviewResult {
  const object = ensureObject(value)
  const rows = Array.isArray(object.rows) ? object.rows.map(mapPreviewRow) : []

  return {
    sourceFilename: typeof object.sourceFilename === 'string' ? object.sourceFilename : null,
    summary: mapSummary(object.summary),
    rows,
  }
}

function mapExecutionResult(value: unknown): BeneficiaryImportExecutionResult {
  const object = ensureObject(value)
  const preview = mapPreviewResult(value)

  if (typeof object.runId !== 'string') {
    throw new Error('La ejecucion no devolvio un identificador de corrida.')
  }

  return {
    ...preview,
    runId: object.runId,
    status: typeof object.status === 'string' ? object.status : 'processed',
  }
}

export async function previewBeneficiaryImport(
  sourceFilename: string,
  rows: BeneficiaryImportParsedRow[],
) {
  const { data, error } = await assertSupabase().rpc('preview_beneficiary_contacts_import', {
    p_source_filename: sourceFilename,
    p_rows: rows,
  })

  if (error) {
    throw error
  }

  return mapPreviewResult(data)
}

export async function executeBeneficiaryImport(
  sourceFilename: string,
  rows: BeneficiaryImportParsedRow[],
) {
  const { data, error } = await assertSupabase().rpc('execute_beneficiary_contacts_import', {
    p_source_filename: sourceFilename,
    p_rows: rows,
  })

  if (error) {
    throw error
  }

  return mapExecutionResult(data)
}

export async function fetchRecentBeneficiaryImportRuns() {
  const { data, error } = await assertSupabase()
    .from('import_runs')
    .select('id, created_at, source_filename, status, total_rows, created_rows, updated_rows, skipped_rows, warning_rows, error_rows, finished_at')
    .eq('import_type', 'beneficiary_contacts')
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    throw error
  }

  return ((data as ImportRunRow[] | null) ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    sourceFilename: row.source_filename,
    status: row.status,
    totalRows: row.total_rows,
    createdRows: row.created_rows,
    updatedRows: row.updated_rows,
    skippedRows: row.skipped_rows,
    warningRows: row.warning_rows,
    errorRows: row.error_rows,
    finishedAt: row.finished_at,
  }))
}

export function getBeneficiaryImportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (!message) {
    return 'No fue posible procesar la importacion en este momento.'
  }

  if (message.includes('Solo admin y super_admin')) {
    return 'Solo admin y super_admin pueden usar esta importacion.'
  }

  if (message.includes('columnas')) {
    return message
  }

  if (message.includes('El archivo no contiene filas')) {
    return message
  }

  if (message.includes('Supabase no esta configurado')) {
    return message
  }

  return message
}