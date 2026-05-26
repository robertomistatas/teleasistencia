import { read, utils } from 'xlsx'

import { supabase } from '@/lib/supabase'

const EXPECTED_HEADERS = ['RUT', 'Nombre', 'Telefono', 'Tipo telefono'] as const
const EXPECTED_ASSIGNMENT_HEADERS = ['RUT', 'Nombre'] as const
const EXPECTED_CALL_LOG_HEADERS = ['id', 'Fecha', 'Beneficiario', 'Teléfono', 'Tipo de llamada', 'Duración', 'Observaciones', 'Estado'] as const

type ExpectedHeader = (typeof EXPECTED_HEADERS)[number]
type ExpectedAssignmentHeader = (typeof EXPECTED_ASSIGNMENT_HEADERS)[number]
type ExpectedCallLogHeader = (typeof EXPECTED_CALL_LOG_HEADERS)[number]

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

export type AssignmentImportParsedRow = {
  rowNumber: number
  rut: string
  nombre: string
}

export type AssignmentImportPreviewRow = {
  rowNumber: number
  rawPayload: AssignmentImportParsedRow
  normalizedPayload: {
    rutNormalized: string | null
    beneficiaryName: string | null
    inputName: string | null
    targetUserId: string | null
    targetUserName: string | null
    operation: 'created' | 'reassigned' | 'skipped' | 'duplicate' | null
  }
  resultStatus: 'created' | 'reassigned' | 'skipped' | 'warning' | 'error'
  message: string
  beneficiaryId: string | null
  activeAssignmentId: string | null
  activeAssignmentUserId: string | null
  activeAssignmentUserName: string | null
  assignmentId: string | null
  hasNameWarning: boolean
  hasRelatedSupportWarning: boolean
  shouldApply: boolean
  shouldReassign: boolean
  shouldCreate: boolean
}

export type AssignmentImportSummary = {
  totalRows: number
  createdRows: number
  reassignedRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
}

export type AssignmentImportPreviewResult = {
  sourceFilename: string | null
  targetUserId: string | null
  summary: AssignmentImportSummary
  rows: AssignmentImportPreviewRow[]
}

export type AssignmentImportExecutionResult = AssignmentImportPreviewResult & {
  runId: string
  status: string
  targetUserName: string | null
}

export type CallLogsImportParsedRow = {
  rowNumber: number
  id: string
  fecha: string | number | null
  beneficiario: string
  telefono: string
  tipoLlamada: string
  duracion: string
  observaciones: string
  estado: string
}

export type CallLogsImportPreviewRow = {
  rowNumber: number
  rawPayload: CallLogsImportParsedRow
  normalizedPayload: {
    externalCallId: string | null
    calledAt: string | null
    phoneNormalized: string | null
    durationSeconds: number | null
    callType: string | null
    rawStatus: string | null
    correlationStatus: 'matched_single' | 'matched_multiple' | 'unmatched' | 'invalid_phone' | null
    beneficiaryId: string | null
    beneficiaryContactId: string | null
    assignmentIdAtCallTime: string | null
    responsibleUserIdAtCallTime: string | null
    operation: 'created' | 'skipped' | null
    shouldApply: boolean
  }
  resultStatus: 'created' | 'skipped' | 'warning' | 'error'
  message: string
  status: 'created' | 'skipped' | 'warning' | 'error'
  externalCallId: string | null
  calledAt: string | null
  rawPhone: string | null
  durationSeconds: number | null
  rawStatus: string | null
  phoneNormalized: string | null
  correlationStatus: 'matched_single' | 'matched_multiple' | 'unmatched' | 'invalid_phone' | null
  beneficiaryId: string | null
  beneficiaryName: string | null
  beneficiaryContactId: string | null
  assignmentIdAtCallTime: string | null
  responsibleUserIdAtCallTime: string | null
  operation: 'created' | 'skipped' | null
  rawCallLogId: string | null
  correlationId: string | null
  shouldApply: boolean
}

export type CallLogsImportSummary = {
  totalRows: number
  createdRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
  matchedSingleRows: number
  matchedMultipleRows: number
  unmatchedRows: number
  invalidPhoneRows: number
}

export type CallLogsImportPreviewResult = {
  sourceFilename: string | null
  summary: CallLogsImportSummary
  rows: CallLogsImportPreviewRow[]
}

export type CallLogsImportExecutionResult = CallLogsImportPreviewResult & {
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

export type AssignmentImportRunSummary = {
  id: string
  createdAt: string
  sourceFilename: string
  status: string
  totalRows: number
  createdRows: number
  reassignedRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
  finishedAt: string | null
  targetUserId: string | null
  targetUserName: string | null
}

export type CallLogsImportRunSummary = {
  id: string
  createdAt: string
  sourceFilename: string
  status: string
  totalRows: number
  createdRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
  matchedSingleRows: number
  matchedMultipleRows: number
  unmatchedRows: number
  invalidPhoneRows: number
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
  reassigned_rows?: number | null
  finished_at: string | null
  metadata?: Record<string, unknown> | null
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

function getAssignmentStructureError() {
  return 'El archivo debe contener una sola hoja con columnas exactas: RUT | Nombre'
}

function getCallLogsStructureError(headers: string[]) {
  const expected = EXPECTED_CALL_LOG_HEADERS.join(' | ')
  const obtained = headers.length > 0 ? headers.join(' | ') : '(sin encabezados)'

  return `El archivo debe contener una sola hoja con columnas exactas: ${expected}. Encabezados detectados: ${obtained}.`
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

export async function parseAssignmentImportFile(file: File) {
  const workbook = read(await file.arrayBuffer(), {
    type: 'array',
    raw: false,
    cellText: true,
  })

  if (workbook.SheetNames.length !== 1) {
    throw new Error(getAssignmentStructureError())
  }

  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    throw new Error(getAssignmentStructureError())
  }

  const sheet = workbook.Sheets[firstSheetName]

  if (!sheet) {
    throw new Error(getAssignmentStructureError())
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
  const firstHeaders = headerRow.slice(0, EXPECTED_ASSIGNMENT_HEADERS.length)
  const extraHeaders = headerRow.slice(EXPECTED_ASSIGNMENT_HEADERS.length).filter((value) => value.length > 0)

  if (
    extraHeaders.length > 0
    || firstHeaders.length !== EXPECTED_ASSIGNMENT_HEADERS.length
    || firstHeaders.some((header, index) => header !== EXPECTED_ASSIGNMENT_HEADERS[index])
  ) {
    throw new Error(getAssignmentStructureError())
  }

  const rows: AssignmentImportParsedRow[] = []

  matrix.slice(1).forEach((row, rowIndex) => {
    const cells = (row ?? []).map(normalizeCellValue)
    const firstCells = cells.slice(0, EXPECTED_ASSIGNMENT_HEADERS.length)
    const extraCells = cells.slice(EXPECTED_ASSIGNMENT_HEADERS.length).filter((value) => value.length > 0)
    const isEmptyRow = firstCells.every((value) => value.length === 0)

    if (isEmptyRow) {
      return
    }

    if (extraCells.length > 0) {
      throw new Error(getAssignmentStructureError())
    }

    rows.push({
      rowNumber: rowIndex + 2,
      rut: firstCells[0] ?? '',
      nombre: firstCells[1] ?? '',
    })
  })

  if (rows.length === 0) {
    throw new Error('El archivo no contiene filas de datos debajo del encabezado.')
  }

  return {
    fileName: file.name,
    headers: [...EXPECTED_ASSIGNMENT_HEADERS] as ExpectedAssignmentHeader[],
    rows,
  }
}

function readDisplayedMatrix(sheet: unknown) {
  return utils.sheet_to_json<(string | number | null)[]>(sheet as Parameters<typeof utils.sheet_to_json>[0], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
}

function normalizeRawCellValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return null
}

export async function parseCallLogsImportFile(file: File) {
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

  const matrix = readDisplayedMatrix(sheet)

  if (matrix.length === 0) {
    throw new Error('El archivo esta vacio.')
  }

  const headerRow = (matrix[0] ?? []).map(normalizeHeaderValue)
  const firstHeaders = headerRow.slice(0, EXPECTED_CALL_LOG_HEADERS.length)
  const extraHeaders = headerRow.slice(EXPECTED_CALL_LOG_HEADERS.length).filter((value) => value.length > 0)

  if (
    extraHeaders.length > 0
    || firstHeaders.length !== EXPECTED_CALL_LOG_HEADERS.length
    || firstHeaders.some((header, index) => header !== EXPECTED_CALL_LOG_HEADERS[index])
  ) {
    throw new Error(getCallLogsStructureError(firstHeaders.concat(extraHeaders)))
  }

  const rows: CallLogsImportParsedRow[] = []

  matrix.slice(1).forEach((row, rowIndex) => {
    const cells = (row ?? []).map(normalizeCellValue)
    const firstCells = cells.slice(0, EXPECTED_CALL_LOG_HEADERS.length)
    const extraCells = cells.slice(EXPECTED_CALL_LOG_HEADERS.length).filter((value) => value.length > 0)
    const isEmptyRow = firstCells.every((value) => value.length === 0)

    if (isEmptyRow) {
      return
    }

    if (extraCells.length > 0) {
      throw new Error(`La fila ${rowIndex + 2} contiene columnas adicionales fuera de A-H.`)
    }

    const dateCellRef = utils.encode_cell({ r: rowIndex + 1, c: 1 })
    const dateCellValue = normalizeRawCellValue(sheet[dateCellRef]?.v)

    rows.push({
      rowNumber: rowIndex + 2,
      id: firstCells[0] ?? '',
      fecha: dateCellValue ?? firstCells[1] ?? null,
      beneficiario: firstCells[2] ?? '',
      telefono: firstCells[3] ?? '',
      tipoLlamada: firstCells[4] ?? '',
      duracion: firstCells[5] ?? '',
      observaciones: firstCells[6] ?? '',
      estado: firstCells[7] ?? '',
    })
  })

  if (rows.length === 0) {
    throw new Error('El archivo no contiene filas de datos debajo del encabezado.')
  }

  return {
    fileName: file.name,
    headers: [...EXPECTED_CALL_LOG_HEADERS] as ExpectedCallLogHeader[],
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

function mapAssignmentSummary(value: unknown): AssignmentImportSummary {
  const object = ensureObject(value)

  return {
    totalRows: Number(object.totalRows ?? 0),
    createdRows: Number(object.createdRows ?? 0),
    reassignedRows: Number(object.reassignedRows ?? 0),
    skippedRows: Number(object.skippedRows ?? 0),
    warningRows: Number(object.warningRows ?? 0),
    errorRows: Number(object.errorRows ?? 0),
  }
}

function mapCallLogsSummary(value: unknown): CallLogsImportSummary {
  const object = ensureObject(value)

  return {
    totalRows: Number(object.totalRows ?? 0),
    createdRows: Number(object.createdRows ?? 0),
    skippedRows: Number(object.skippedRows ?? 0),
    warningRows: Number(object.warningRows ?? 0),
    errorRows: Number(object.errorRows ?? 0),
    matchedSingleRows: Number(object.matchedSingleRows ?? 0),
    matchedMultipleRows: Number(object.matchedMultipleRows ?? 0),
    unmatchedRows: Number(object.unmatchedRows ?? 0),
    invalidPhoneRows: Number(object.invalidPhoneRows ?? 0),
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

function mapAssignmentPreviewRow(value: unknown): AssignmentImportPreviewRow {
  const object = ensureObject(value)
  const normalizedPayload = ensureObject(object.normalizedPayload)
  const rawPayload = ensureObject(object.rawPayload)
  const operationValue = normalizedPayload.operation
  const operation = operationValue === 'created'
    || operationValue === 'reassigned'
    || operationValue === 'skipped'
    || operationValue === 'duplicate'
    ? operationValue
    : null

  return {
    rowNumber: Number(object.rowNumber ?? 0),
    rawPayload: {
      rowNumber: Number(rawPayload.rowNumber ?? object.rowNumber ?? 0),
      rut: String(rawPayload.rut ?? ''),
      nombre: String(rawPayload.nombre ?? ''),
    },
    normalizedPayload: {
      rutNormalized: typeof normalizedPayload.rutNormalized === 'string' ? normalizedPayload.rutNormalized : null,
      beneficiaryName: typeof normalizedPayload.beneficiaryName === 'string' ? normalizedPayload.beneficiaryName : null,
      inputName: typeof normalizedPayload.inputName === 'string' ? normalizedPayload.inputName : null,
      targetUserId: typeof normalizedPayload.targetUserId === 'string' ? normalizedPayload.targetUserId : null,
      targetUserName: typeof normalizedPayload.targetUserName === 'string' ? normalizedPayload.targetUserName : null,
      operation,
    },
    resultStatus: String(object.resultStatus ?? 'error') as AssignmentImportPreviewRow['resultStatus'],
    message: String(object.message ?? ''),
    beneficiaryId: typeof object.beneficiaryId === 'string' ? object.beneficiaryId : null,
    activeAssignmentId: typeof object.activeAssignmentId === 'string' ? object.activeAssignmentId : null,
    activeAssignmentUserId: typeof object.activeAssignmentUserId === 'string' ? object.activeAssignmentUserId : null,
    activeAssignmentUserName: typeof object.activeAssignmentUserName === 'string' ? object.activeAssignmentUserName : null,
    assignmentId: typeof object.assignmentId === 'string' ? object.assignmentId : null,
    hasNameWarning: Boolean(object.hasNameWarning),
    hasRelatedSupportWarning: Boolean(object.hasRelatedSupportWarning),
    shouldApply: Boolean(object.shouldApply),
    shouldReassign: Boolean(object.shouldReassign),
    shouldCreate: Boolean(object.shouldCreate),
  }
}

function mapCallLogsPreviewRow(value: unknown): CallLogsImportPreviewRow {
  const object = ensureObject(value)
  const normalizedPayload = ensureObject(object.normalizedPayload)
  const rawPayload = ensureObject(object.rawPayload)
  const correlationStatusValue = normalizedPayload.correlationStatus
  const correlationStatus = correlationStatusValue === 'matched_single'
    || correlationStatusValue === 'matched_multiple'
    || correlationStatusValue === 'unmatched'
    || correlationStatusValue === 'invalid_phone'
    ? correlationStatusValue
    : null
  const operationValue = normalizedPayload.operation
  const operation = operationValue === 'created' || operationValue === 'skipped'
    ? operationValue
    : null

  return {
    rowNumber: Number(object.rowNumber ?? 0),
    rawPayload: {
      rowNumber: Number(rawPayload.rowNumber ?? object.rowNumber ?? 0),
      id: String(rawPayload.id ?? ''),
      fecha: typeof rawPayload.fecha === 'number' || typeof rawPayload.fecha === 'string' ? rawPayload.fecha : null,
      beneficiario: String(rawPayload.beneficiario ?? ''),
      telefono: String(rawPayload.telefono ?? ''),
      tipoLlamada: String(rawPayload.tipoLlamada ?? ''),
      duracion: String(rawPayload.duracion ?? ''),
      observaciones: String(rawPayload.observaciones ?? ''),
      estado: String(rawPayload.estado ?? ''),
    },
    normalizedPayload: {
      externalCallId: typeof normalizedPayload.externalCallId === 'string' ? normalizedPayload.externalCallId : null,
      calledAt: typeof normalizedPayload.calledAt === 'string' ? normalizedPayload.calledAt : null,
      phoneNormalized: typeof normalizedPayload.phoneNormalized === 'string' ? normalizedPayload.phoneNormalized : null,
      durationSeconds: typeof normalizedPayload.durationSeconds === 'number' ? normalizedPayload.durationSeconds : null,
      callType: typeof normalizedPayload.callType === 'string' ? normalizedPayload.callType : null,
      rawStatus: typeof normalizedPayload.rawStatus === 'string' ? normalizedPayload.rawStatus : null,
      correlationStatus,
      beneficiaryId: typeof normalizedPayload.beneficiaryId === 'string' ? normalizedPayload.beneficiaryId : null,
      beneficiaryContactId: typeof normalizedPayload.beneficiaryContactId === 'string' ? normalizedPayload.beneficiaryContactId : null,
      assignmentIdAtCallTime: typeof normalizedPayload.assignmentIdAtCallTime === 'string' ? normalizedPayload.assignmentIdAtCallTime : null,
      responsibleUserIdAtCallTime: typeof normalizedPayload.responsibleUserIdAtCallTime === 'string' ? normalizedPayload.responsibleUserIdAtCallTime : null,
      operation,
      shouldApply: Boolean(normalizedPayload.shouldApply),
    },
    resultStatus: String(object.resultStatus ?? 'error') as CallLogsImportPreviewRow['resultStatus'],
    message: String(object.message ?? ''),
    status: String(object.status ?? object.resultStatus ?? 'error') as CallLogsImportPreviewRow['status'],
    externalCallId: typeof object.externalCallId === 'string' ? object.externalCallId : null,
    calledAt: typeof object.calledAt === 'string'
      ? object.calledAt
      : (typeof normalizedPayload.calledAt === 'string' ? normalizedPayload.calledAt : null),
    rawPhone: typeof object.rawPhone === 'string'
      ? object.rawPhone
      : (rawPayload.telefono ? String(rawPayload.telefono) : null),
    durationSeconds: typeof object.durationSeconds === 'number'
      ? object.durationSeconds
      : (typeof normalizedPayload.durationSeconds === 'number' ? normalizedPayload.durationSeconds : null),
    rawStatus: typeof object.rawStatus === 'string'
      ? object.rawStatus
      : (typeof normalizedPayload.rawStatus === 'string' ? normalizedPayload.rawStatus : null),
    phoneNormalized: typeof object.phoneNormalized === 'string' ? object.phoneNormalized : null,
    correlationStatus: typeof object.correlationStatus === 'string'
      && (object.correlationStatus === 'matched_single'
        || object.correlationStatus === 'matched_multiple'
        || object.correlationStatus === 'unmatched'
        || object.correlationStatus === 'invalid_phone')
      ? object.correlationStatus
      : correlationStatus,
    beneficiaryId: typeof object.beneficiaryId === 'string' ? object.beneficiaryId : null,
    beneficiaryName: typeof object.beneficiaryName === 'string' ? object.beneficiaryName : null,
    beneficiaryContactId: typeof object.beneficiaryContactId === 'string' ? object.beneficiaryContactId : null,
    assignmentIdAtCallTime: typeof object.assignmentIdAtCallTime === 'string'
      ? object.assignmentIdAtCallTime
      : (typeof normalizedPayload.assignmentIdAtCallTime === 'string' ? normalizedPayload.assignmentIdAtCallTime : null),
    responsibleUserIdAtCallTime: typeof object.responsibleUserIdAtCallTime === 'string'
      ? object.responsibleUserIdAtCallTime
      : (typeof normalizedPayload.responsibleUserIdAtCallTime === 'string' ? normalizedPayload.responsibleUserIdAtCallTime : null),
    operation: (typeof object.operation === 'string' && (object.operation === 'created' || object.operation === 'skipped'))
      ? object.operation
      : operation,
    rawCallLogId: typeof object.rawCallLogId === 'string' ? object.rawCallLogId : null,
    correlationId: typeof object.correlationId === 'string' ? object.correlationId : null,
    shouldApply: Boolean(object.shouldApply ?? normalizedPayload.shouldApply),
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

function mapAssignmentPreviewResult(value: unknown): AssignmentImportPreviewResult {
  const object = ensureObject(value)
  const rows = Array.isArray(object.rows) ? object.rows.map(mapAssignmentPreviewRow) : []

  return {
    sourceFilename: typeof object.sourceFilename === 'string' ? object.sourceFilename : null,
    targetUserId: typeof object.targetUserId === 'string' ? object.targetUserId : null,
    summary: mapAssignmentSummary(object.summary),
    rows,
  }
}

function mapAssignmentExecutionResult(value: unknown): AssignmentImportExecutionResult {
  const object = ensureObject(value)
  const preview = mapAssignmentPreviewResult(value)

  if (typeof object.runId !== 'string') {
    throw new Error('La ejecucion no devolvio un identificador de corrida.')
  }

  return {
    ...preview,
    runId: object.runId,
    status: typeof object.status === 'string' ? object.status : 'processed',
    targetUserName: typeof object.targetUserName === 'string' ? object.targetUserName : null,
  }
}

function mapCallLogsPreviewResult(value: unknown): CallLogsImportPreviewResult {
  const object = ensureObject(value)
  const rows = Array.isArray(object.rows) ? object.rows.map(mapCallLogsPreviewRow) : []

  return {
    sourceFilename: typeof object.sourceFilename === 'string' ? object.sourceFilename : null,
    summary: mapCallLogsSummary(object.summary),
    rows,
  }
}

function mapCallLogsExecutionResult(value: unknown): CallLogsImportExecutionResult {
  const object = ensureObject(value)
  const preview = mapCallLogsPreviewResult(value)

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

export async function previewAssignmentImport(
  sourceFilename: string,
  targetUserId: string,
  rows: AssignmentImportParsedRow[],
) {
  const { data, error } = await assertSupabase().rpc('preview_assignment_import', {
    p_source_filename: sourceFilename,
    p_target_user_id: targetUserId,
    p_rows: rows,
  })

  if (error) {
    throw error
  }

  return mapAssignmentPreviewResult(data)
}

export async function executeAssignmentImport(
  sourceFilename: string,
  targetUserId: string,
  rows: AssignmentImportParsedRow[],
) {
  const { data, error } = await assertSupabase().rpc('execute_assignment_import', {
    p_source_filename: sourceFilename,
    p_target_user_id: targetUserId,
    p_rows: rows,
  })

  if (error) {
    throw error
  }

  return mapAssignmentExecutionResult(data)
}

export async function previewCallLogsImport(
  sourceFilename: string,
  rows: CallLogsImportParsedRow[],
) {
  const { data, error } = await assertSupabase().rpc('preview_call_logs_import', {
    p_source_filename: sourceFilename,
    p_rows: rows,
  })

  if (error) {
    throw error
  }

  return mapCallLogsPreviewResult(data)
}

export async function executeCallLogsImport(
  sourceFilename: string,
  rows: CallLogsImportParsedRow[],
) {
  const { data, error } = await assertSupabase().rpc('execute_call_logs_import', {
    p_source_filename: sourceFilename,
    p_rows: rows,
  })

  if (error) {
    throw error
  }

  return mapCallLogsExecutionResult(data)
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

export async function fetchRecentAssignmentImportRuns() {
  const { data, error } = await assertSupabase()
    .from('import_runs')
    .select('id, created_at, source_filename, status, total_rows, created_rows, reassigned_rows, skipped_rows, warning_rows, error_rows, finished_at, metadata')
    .eq('import_type', 'assignment_import')
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    throw error
  }

  return ((data as ImportRunRow[] | null) ?? []).map((row) => {
    const metadata = row.metadata ?? null

    return {
      id: row.id,
      createdAt: row.created_at,
      sourceFilename: row.source_filename,
      status: row.status,
      totalRows: row.total_rows,
      createdRows: row.created_rows,
      reassignedRows: Number(row.reassigned_rows ?? 0),
      skippedRows: row.skipped_rows,
      warningRows: row.warning_rows,
      errorRows: row.error_rows,
      finishedAt: row.finished_at,
      targetUserId: metadata && typeof metadata.targetUserId === 'string' ? metadata.targetUserId : null,
      targetUserName: metadata && typeof metadata.targetUserName === 'string' ? metadata.targetUserName : null,
    }
  })
}

export async function fetchRecentCallLogsImportRuns() {
  const { data, error } = await assertSupabase()
    .from('import_runs')
    .select('id, created_at, source_filename, status, total_rows, created_rows, skipped_rows, warning_rows, error_rows, finished_at, metadata')
    .eq('import_type', 'call_logs_import')
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    throw error
  }

  return ((data as ImportRunRow[] | null) ?? []).map((row) => {
    const metadata = row.metadata ?? null

    return {
      id: row.id,
      createdAt: row.created_at,
      sourceFilename: row.source_filename,
      status: row.status,
      totalRows: row.total_rows,
      createdRows: row.created_rows,
      skippedRows: row.skipped_rows,
      warningRows: row.warning_rows,
      errorRows: row.error_rows,
      matchedSingleRows: metadata && typeof metadata.matchedSingleRows === 'number' ? metadata.matchedSingleRows : 0,
      matchedMultipleRows: metadata && typeof metadata.matchedMultipleRows === 'number' ? metadata.matchedMultipleRows : 0,
      unmatchedRows: metadata && typeof metadata.unmatchedRows === 'number' ? metadata.unmatchedRows : 0,
      invalidPhoneRows: metadata && typeof metadata.invalidPhoneRows === 'number' ? metadata.invalidPhoneRows : 0,
      finishedAt: row.finished_at,
    }
  })
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

export function getAssignmentImportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (!message) {
    return 'No fue posible procesar la importacion de asignaciones en este momento.'
  }

  if (message.includes('Solo admin y super_admin')) {
    return 'Solo admin y super_admin pueden usar esta importacion.'
  }

  if (message.includes('teleoperadora destino')) {
    return 'Selecciona una teleoperadora activa y valida antes de continuar.'
  }

  if (message.includes('El archivo debe contener una sola hoja')) {
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

export function getCallLogsImportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (!message) {
    return 'No fue posible procesar la importacion de llamadas en este momento.'
  }

  if (message.includes('Solo admin y super_admin')) {
    return 'Solo admin y super_admin pueden usar esta importacion.'
  }

  if (message.includes('columnas exactas') || message.includes('una sola hoja')) {
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