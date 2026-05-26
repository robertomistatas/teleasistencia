import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  PageState,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import {
  executeCallLogsImport,
  fetchRecentCallLogsImportRuns,
  getCallLogsImportErrorMessage,
  parseCallLogsImportFile,
  previewCallLogsImport,
  type CallLogsImportExecutionResult,
  type CallLogsImportParsedRow,
  type CallLogsImportPreviewResult,
  type CallLogsImportPreviewRow,
  type CallLogsImportRunSummary,
} from '@/features/imports/data'
import { formatDateTime } from '@/lib/format'

const importGuidelines = [
  'Archivo Excel con una sola hoja y columnas exactas: id, Fecha, Beneficiario, Teléfono, Tipo de llamada, Duración, Observaciones, Estado.',
  'El source siempre se fija en backend como amaia_net2phone_excel y nunca se recibe desde frontend.',
  'El matching depende solo del teléfono normalizado; Beneficiario, Observaciones y Estado textual se conservan solo como evidencia.',
  'Preview y execute comparten la misma lógica interna de backend y execute reutiliza correlate_raw_call_log(...) para persistir correlación real.',
]

const resultTone: Record<CallLogsImportPreviewRow['resultStatus'], 'danger' | 'warning' | 'success' | 'muted' | 'info'> = {
  created: 'success',
  skipped: 'muted',
  warning: 'warning',
  error: 'danger',
}

const resultLabel: Record<CallLogsImportPreviewRow['resultStatus'], string> = {
  created: 'Creado',
  skipped: 'Omitido',
  warning: 'Warning',
  error: 'Error',
}

const operationLabel: Record<NonNullable<CallLogsImportPreviewRow['normalizedPayload']['operation']>, string> = {
  created: 'Crear raw_call_log',
  skipped: 'Sin cambio',
}

const correlationTone: Record<NonNullable<CallLogsImportPreviewRow['correlationStatus']>, 'success' | 'warning' | 'danger' | 'info'> = {
  matched_single: 'success',
  matched_multiple: 'warning',
  unmatched: 'info',
  invalid_phone: 'danger',
}

const correlationLabel: Record<NonNullable<CallLogsImportPreviewRow['correlationStatus']>, string> = {
  matched_single: 'Match único',
  matched_multiple: 'Match múltiple',
  unmatched: 'Sin match',
  invalid_phone: 'Teléfono inválido',
}

const runStatusTone: Record<string, 'danger' | 'warning' | 'success' | 'muted' | 'info'> = {
  uploaded: 'muted',
  processing: 'info',
  processed: 'success',
  processed_with_errors: 'warning',
  failed: 'danger',
  cancelled: 'muted',
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'slate' | 'emerald' | 'sky' | 'amber' | 'rose'
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone]

  return (
    <div className={`rounded-[24px] border px-4 py-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}

function ResultBadge({ status }: { status: CallLogsImportPreviewRow['resultStatus'] }) {
  return <Badge tone={resultTone[status]}>{resultLabel[status]}</Badge>
}

function CorrelationBadge({ status }: { status: CallLogsImportPreviewRow['correlationStatus'] }) {
  if (!status) {
    return <span className="text-slate-400">Sin correlación</span>
  }

  return <Badge tone={correlationTone[status]}>{correlationLabel[status]}</Badge>
}

function ImportSummaryGrid({
  summary,
}: {
  summary: CallLogsImportPreviewResult['summary']
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-9">
      <SummaryCard label="Filas" value={summary.totalRows} tone="slate" />
      <SummaryCard label="Creadas" value={summary.createdRows} tone="emerald" />
      <SummaryCard label="Omitidas" value={summary.skippedRows} tone="slate" />
      <SummaryCard label="Warnings" value={summary.warningRows} tone="amber" />
      <SummaryCard label="Errores" value={summary.errorRows} tone="rose" />
      <SummaryCard label="Match único" value={summary.matchedSingleRows} tone="emerald" />
      <SummaryCard label="Múltiple" value={summary.matchedMultipleRows} tone="amber" />
      <SummaryCard label="Sin match" value={summary.unmatchedRows} tone="sky" />
      <SummaryCard label="Inválido" value={summary.invalidPhoneRows} tone="rose" />
    </div>
  )
}

function PreviewTable({ rows }: { rows: CallLogsImportPreviewRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
        <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Fila</th>
            <th className="px-4 py-3 font-medium">External call ID</th>
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-4 py-3 font-medium">Teléfono</th>
            <th className="px-4 py-3 font-medium">Teléfono normalizado</th>
            <th className="px-4 py-3 font-medium">Duración</th>
            <th className="px-4 py-3 font-medium">Correlación</th>
            <th className="px-4 py-3 font-medium">Operación</th>
            <th className="px-4 py-3 font-medium">Resultado</th>
            <th className="px-4 py-3 font-medium">Mensaje</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
          {rows.map((row) => (
            <tr key={row.rowNumber} className="align-top">
              <td className="px-4 py-4 font-semibold text-slate-900">{row.rowNumber}</td>
              <td className="px-4 py-4">{row.externalCallId ?? row.rawPayload.id ?? 'Sin ID'}</td>
              <td className="px-4 py-4">{row.calledAt ? formatDateTime(row.calledAt) : String(row.rawPayload.fecha ?? 'Sin fecha')}</td>
              <td className="px-4 py-4">{row.rawPhone ?? row.rawPayload.telefono ?? 'Sin teléfono'}</td>
              <td className="px-4 py-4">{row.phoneNormalized ?? 'Sin normalizar'}</td>
              <td className="px-4 py-4">{row.durationSeconds ?? 'Sin parsear'}</td>
              <td className="px-4 py-4"><CorrelationBadge status={row.correlationStatus} /></td>
              <td className="px-4 py-4">
                {row.operation
                  ? operationLabel[row.operation]
                  : (row.normalizedPayload.operation ? operationLabel[row.normalizedPayload.operation] : 'Sin acción')}
              </td>
              <td className="px-4 py-4"><ResultBadge status={row.resultStatus} /></td>
              <td className="px-4 py-4 text-slate-600">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CallLogsImportPage() {
  const { isConfigured, profile } = useAuth()
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<CallLogsImportParsedRow[]>([])
  const [structureError, setStructureError] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<CallLogsImportPreviewResult | null>(null)
  const [executionResult, setExecutionResult] = useState<CallLogsImportExecutionResult | null>(null)
  const [runs, setRuns] = useState<CallLogsImportRunSummary[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const importableRows = useMemo(
    () => previewResult?.rows.filter((row) => row.shouldApply).length ?? 0,
    [previewResult],
  )

  useEffect(() => {
    let cancelled = false

    const loadRuns = async () => {
      setLoadingRuns(true)

      try {
        const nextRuns = await fetchRecentCallLogsImportRuns()

        if (!cancelled) {
          setRuns(nextRuns)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getCallLogsImportErrorMessage(loadError))
        }
      } finally {
        if (!cancelled) {
          setLoadingRuns(false)
        }
      }
    }

    if (isConfigured) {
      void loadRuns()
    } else {
      setLoadingRuns(false)
    }

    return () => {
      cancelled = true
    }
  }, [isConfigured])

  if (!profile) {
    return null
  }

  if (!isConfigured) {
    return (
      <PageState
        title="Importacion no disponible"
        description="Configura Supabase para usar la previsualizacion y la ejecucion controlada del importador de llamadas."
      />
    )
  }

  const clearWorkflow = () => {
    setSelectedFileName(null)
    setParsedRows([])
    setStructureError(null)
    setPreviewResult(null)
    setExecutionResult(null)
    setError(null)
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]

    clearWorkflow()

    if (!nextFile) {
      return
    }

    try {
      const parsed = await parseCallLogsImportFile(nextFile)
      setSelectedFileName(parsed.fileName)
      setParsedRows(parsed.rows)
    } catch (fileError) {
      setSelectedFileName(nextFile.name)
      setStructureError(getCallLogsImportErrorMessage(fileError))
    } finally {
      event.target.value = ''
    }
  }

  const handlePreview = async () => {
    if (!selectedFileName || parsedRows.length === 0) {
      return
    }

    setPreviewLoading(true)
    setExecutionResult(null)
    setError(null)

    try {
      const result = await previewCallLogsImport(selectedFileName, parsedRows)
      setPreviewResult(result)
    } catch (previewError) {
      setPreviewResult(null)
      setError(getCallLogsImportErrorMessage(previewError))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExecute = async () => {
    if (!selectedFileName || parsedRows.length === 0 || !previewResult) {
      return
    }

    setImportLoading(true)
    setError(null)

    try {
      const result = await executeCallLogsImport(selectedFileName, parsedRows)
      setExecutionResult(result)
      setPreviewResult(result)
      setRuns(await fetchRecentCallLogsImportRuns())
    } catch (executionError) {
      setError(getCallLogsImportErrorMessage(executionError))
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Fase 4.4B</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Importacion Excel de llamadas AMAIA / net2phone con preview operacional
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              La pantalla solo valida estructura, carga el archivo y coordina preview y execute. La persistencia y la correlación real viven en RPCs de backend reutilizando la base 4.4A.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
            <SummaryCard label="Archivo cargado" value={selectedFileName ? 1 : 0} tone="slate" />
            <SummaryCard label="Filas listas" value={parsedRows.length} tone="sky" />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <Panel className="p-6">
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Carga de archivo</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Selecciona el Excel fuente</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                El sistema exige una sola hoja y ocho columnas exactas. Si la estructura no coincide, el preview se bloquea antes de llegar a la RPC.
              </p>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Archivo Excel</span>
              <input
                className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:font-semibold file:text-white"
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
              />
            </label>

            {selectedFileName ? (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Archivo seleccionado</p>
                <p className="mt-2">{selectedFileName}</p>
                <p className="mt-1 text-slate-600">{parsedRows.length} filas detectadas para preview.</p>
              </div>
            ) : null}

            {structureError ? (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                {structureError}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                className={primaryButtonClass}
                type="button"
                onClick={handlePreview}
                disabled={previewLoading || importLoading || parsedRows.length === 0 || Boolean(structureError)}
              >
                {previewLoading ? 'Preparando preview...' : 'Previsualizar importacion'}
              </button>
              <button
                className={secondaryButtonClass}
                type="button"
                onClick={clearWorkflow}
                disabled={previewLoading || importLoading}
              >
                Limpiar seleccion
              </button>
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Reglas visibles</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Checklist operacional</h3>
          <div className="mt-4 space-y-3">
            {importGuidelines.map((item) => (
              <div key={item} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {previewResult ? (
        <Panel className="p-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Preview</p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Resultado antes de persistir</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Cada fila ya fue evaluada con la misma lógica interna que luego decide persistencia e idempotencia en execute.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  className={primaryButtonClass}
                  type="button"
                  onClick={handleExecute}
                  disabled={importLoading || previewLoading || importableRows === 0}
                >
                  {importLoading ? 'Importando...' : 'Confirmar importacion'}
                </button>
              </div>
            </div>

            <ImportSummaryGrid summary={previewResult.summary} />

            {importableRows === 0 ? (
              <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                El preview no encontro filas aplicables. Corrige los errores estructurales o revisa los duplicados antes de confirmar.
              </div>
            ) : null}

            <PreviewTable rows={previewResult.rows} />
          </div>
        </Panel>
      ) : null}

      {executionResult ? (
        <Panel className="p-6">
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Ejecucion confirmada</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Corrida registrada</h3>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <Badge tone={runStatusTone[executionResult.status] ?? 'info'}>{executionResult.status}</Badge>
            <span>ID corrida: {executionResult.runId}</span>
            <span>Archivo: {executionResult.sourceFilename ?? selectedFileName}</span>
          </div>
          <div className="mt-5">
            <ImportSummaryGrid summary={executionResult.summary} />
          </div>
        </Panel>
      ) : null}

      <Panel className="p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Trazabilidad</p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Ultimas corridas registradas</h3>
          </div>
          <p className="text-sm text-slate-500">Visibles solo para admin y super_admin por RLS.</p>
        </div>

        {loadingRuns ? (
          <div className="mt-6 text-sm text-slate-600">Cargando corridas recientes...</div>
        ) : runs.length === 0 ? (
          <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            Aun no hay corridas persistidas para este importador en el entorno actual.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
              <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Archivo</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Filas</th>
                  <th className="px-4 py-3 font-medium">Creadas</th>
                  <th className="px-4 py-3 font-medium">Warnings</th>
                  <th className="px-4 py-3 font-medium">Errores</th>
                  <th className="px-4 py-3 font-medium">Match único</th>
                  <th className="px-4 py-3 font-medium">Sin match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-4">{formatDateTime(run.createdAt)}</td>
                    <td className="px-4 py-4 font-medium text-slate-900">{run.sourceFilename}</td>
                    <td className="px-4 py-4">
                      <Badge tone={runStatusTone[run.status] ?? 'info'}>{run.status}</Badge>
                    </td>
                    <td className="px-4 py-4">{run.totalRows}</td>
                    <td className="px-4 py-4">{run.createdRows}</td>
                    <td className="px-4 py-4">{run.warningRows}</td>
                    <td className="px-4 py-4">{run.errorRows}</td>
                    <td className="px-4 py-4">{run.matchedSingleRows}</td>
                    <td className="px-4 py-4">{run.unmatchedRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}