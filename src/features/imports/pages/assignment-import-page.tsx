import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  PageState,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui'
import { fetchActiveTeleoperatorOptions } from '@/features/assignments/data'
import { useAuth } from '@/features/auth/use-auth'
import {
  executeAssignmentImport,
  fetchRecentAssignmentImportRuns,
  getAssignmentImportErrorMessage,
  parseAssignmentImportFile,
  previewAssignmentImport,
  type AssignmentImportExecutionResult,
  type AssignmentImportParsedRow,
  type AssignmentImportPreviewResult,
  type AssignmentImportPreviewRow,
  type AssignmentImportRunSummary,
} from '@/features/imports/data'
import { formatDateTime } from '@/lib/format'

const importGuidelines = [
  'Archivo Excel con una sola hoja y columnas exactas: RUT, Nombre.',
  'La teleoperadora destino se selecciona en la UI y nunca se infiere desde el archivo.',
  'El preview usa match canonico por normalize_rut y no persiste cambios.',
  'La ejecucion reutiliza la reasignacion controlada de Fase 3 y registra trazabilidad por corrida y por fila.',
]

const resultTone: Record<AssignmentImportPreviewRow['resultStatus'], 'danger' | 'warning' | 'success' | 'muted' | 'info'> = {
  created: 'success',
  reassigned: 'info',
  skipped: 'muted',
  warning: 'warning',
  error: 'danger',
}

const resultLabel: Record<AssignmentImportPreviewRow['resultStatus'], string> = {
  created: 'Creado',
  reassigned: 'Reasignado',
  skipped: 'Omitido',
  warning: 'Warning',
  error: 'Error',
}

const operationLabel: Record<NonNullable<AssignmentImportPreviewRow['normalizedPayload']['operation']>, string> = {
  created: 'Crear primary',
  reassigned: 'Reasignar primary',
  skipped: 'Sin cambio',
  duplicate: 'Duplicado en archivo',
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

function ResultBadge({ status }: { status: AssignmentImportPreviewRow['resultStatus'] }) {
  return <Badge tone={resultTone[status]}>{resultLabel[status]}</Badge>
}

function ImportSummaryGrid({
  summary,
}: {
  summary: AssignmentImportPreviewResult['summary']
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <SummaryCard label="Filas" value={summary.totalRows} tone="slate" />
      <SummaryCard label="Creadas" value={summary.createdRows} tone="emerald" />
      <SummaryCard label="Reasignadas" value={summary.reassignedRows} tone="sky" />
      <SummaryCard label="Omitidas" value={summary.skippedRows} tone="slate" />
      <SummaryCard label="Warnings" value={summary.warningRows} tone="amber" />
      <SummaryCard label="Errores" value={summary.errorRows} tone="rose" />
    </div>
  )
}

function PreviewTable({ rows }: { rows: AssignmentImportPreviewRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
        <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Fila</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Accion</th>
            <th className="px-4 py-3 font-medium">RUT normalizado</th>
            <th className="px-4 py-3 font-medium">Beneficiario usado</th>
            <th className="px-4 py-3 font-medium">Primary activa actual</th>
            <th className="px-4 py-3 font-medium">Mensaje</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
          {rows.map((row) => (
            <tr key={row.rowNumber} className="align-top">
              <td className="px-4 py-4 font-semibold text-slate-900">{row.rowNumber}</td>
              <td className="px-4 py-4"><ResultBadge status={row.resultStatus} /></td>
              <td className="px-4 py-4">
                {row.normalizedPayload.operation ? operationLabel[row.normalizedPayload.operation] : 'Sin accion'}
              </td>
              <td className="px-4 py-4">{row.normalizedPayload.rutNormalized ?? 'Sin normalizar'}</td>
              <td className="px-4 py-4">{row.normalizedPayload.beneficiaryName ?? row.rawPayload.nombre ?? 'Sin nombre'}</td>
              <td className="px-4 py-4">{row.activeAssignmentUserName ?? 'Sin primary activa'}</td>
              <td className="px-4 py-4 text-slate-600">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AssignmentImportPage() {
  const { isConfigured, profile } = useAuth()
  const [selectedTargetUserId, setSelectedTargetUserId] = useState('')
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<AssignmentImportParsedRow[]>([])
  const [structureError, setStructureError] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<AssignmentImportPreviewResult | null>(null)
  const [executionResult, setExecutionResult] = useState<AssignmentImportExecutionResult | null>(null)
  const [runs, setRuns] = useState<AssignmentImportRunSummary[]>([])
  const [teleoperatorOptions, setTeleoperatorOptions] = useState<Array<{ id: string; fullName: string; email: string | null }>>([])
  const [loadingContext, setLoadingContext] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTargetUser = useMemo(
    () => teleoperatorOptions.find((item) => item.id === selectedTargetUserId) ?? null,
    [selectedTargetUserId, teleoperatorOptions],
  )

  const importableRows = useMemo(
    () => previewResult?.rows.filter((row) => row.shouldApply).length ?? 0,
    [previewResult],
  )

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoadingContext(true)
      setError(null)

      try {
        const [nextTeleoperators, nextRuns] = await Promise.all([
          fetchActiveTeleoperatorOptions(),
          fetchRecentAssignmentImportRuns(),
        ])

        if (cancelled) {
          return
        }

        setTeleoperatorOptions(nextTeleoperators)
        setRuns(nextRuns)
        setSelectedTargetUserId((currentValue) => (
          currentValue && nextTeleoperators.some((item) => item.id === currentValue)
            ? currentValue
            : ''
        ))
      } catch (loadError) {
        if (!cancelled) {
          setError(getAssignmentImportErrorMessage(loadError))
        }
      } finally {
        if (!cancelled) {
          setLoadingContext(false)
        }
      }
    }

    if (isConfigured) {
      void load()
    } else {
      setLoadingContext(false)
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
        description="Configura Supabase para usar la previsualizacion y la ejecucion controlada del importador."
      />
    )
  }

  if (loadingContext) {
    return (
      <PageState
        title="Cargando importacion de asignaciones"
        description="Estamos preparando teleoperadoras activas, trazabilidad reciente y validaciones operacionales."
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

  const handleTargetChange = (nextTargetUserId: string) => {
    setSelectedTargetUserId(nextTargetUserId)
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
      const parsed = await parseAssignmentImportFile(nextFile)
      setSelectedFileName(parsed.fileName)
      setParsedRows(parsed.rows)
    } catch (fileError) {
      setSelectedFileName(nextFile.name)
      setStructureError(getAssignmentImportErrorMessage(fileError))
    } finally {
      event.target.value = ''
    }
  }

  const handlePreview = async () => {
    if (!selectedFileName || parsedRows.length === 0 || !selectedTargetUserId) {
      return
    }

    setPreviewLoading(true)
    setExecutionResult(null)
    setError(null)

    try {
      const result = await previewAssignmentImport(selectedFileName, selectedTargetUserId, parsedRows)
      setPreviewResult(result)
    } catch (previewError) {
      setPreviewResult(null)
      setError(getAssignmentImportErrorMessage(previewError))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExecute = async () => {
    if (!selectedFileName || parsedRows.length === 0 || !previewResult || !selectedTargetUserId) {
      return
    }

    setImportLoading(true)
    setError(null)

    try {
      const result = await executeAssignmentImport(selectedFileName, selectedTargetUserId, parsedRows)
      setExecutionResult(result)
      setPreviewResult(result)
      setRuns(await fetchRecentAssignmentImportRuns())
    } catch (executionError) {
      setError(getAssignmentImportErrorMessage(executionError))
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Fase 4.3</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Importacion masiva de asignaciones con preview operacional
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              La persistencia critica vive en RPCs y reutiliza las reglas de Assignment Management. Esta pantalla solo valida la estructura del Excel, exige la teleoperadora destino y coordina preview y ejecucion con auditoria completa.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[520px]">
            <SummaryCard label="Teleoperadora" value={selectedTargetUser ? 1 : 0} tone="slate" />
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
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Selecciona destino y Excel fuente</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                El sistema no infiere responsables desde el archivo. Primero eliges la teleoperadora activa destino y luego cargas un Excel con una sola hoja y dos columnas exactas.
              </p>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Teleoperadora destino</span>
              <select
                className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                value={selectedTargetUserId}
                onChange={(event) => handleTargetChange(event.target.value)}
              >
                <option value="" disabled>
                  {teleoperatorOptions.length === 0 ? 'Sin teleoperadoras activas' : 'Selecciona una teleoperadora destino'}
                </option>
                {teleoperatorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.fullName}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                La importacion permanece bloqueada hasta que selecciones manualmente la teleoperadora destino.
              </p>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Archivo Excel</span>
              <input
                className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:font-semibold file:text-white"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
              />
            </label>

            {selectedTargetUser ? (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Destino seleccionado</p>
                <p className="mt-2">{selectedTargetUser.fullName}</p>
                <p className="mt-1 text-slate-600">La importacion creara o reasignara primary a esta cartera operacional.</p>
              </div>
            ) : null}

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
                disabled={previewLoading || importLoading || parsedRows.length === 0 || !selectedTargetUserId || Boolean(structureError)}
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
                  Cada fila ya fue evaluada por la RPC con match canonico por RUT y las mismas restricciones operacionales de Fase 3.
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
                El preview no encontro filas aplicables. Corrige los errores o revisa los duplicados antes de confirmar.
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
            <span>Destino: {executionResult.targetUserName ?? selectedTargetUser?.fullName ?? 'Teleoperadora destino'}</span>
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

        {runs.length === 0 ? (
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
                  <th className="px-4 py-3 font-medium">Destino</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Filas</th>
                  <th className="px-4 py-3 font-medium">Creadas</th>
                  <th className="px-4 py-3 font-medium">Reasignadas</th>
                  <th className="px-4 py-3 font-medium">Warnings</th>
                  <th className="px-4 py-3 font-medium">Errores</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-4">{formatDateTime(run.createdAt)}</td>
                    <td className="px-4 py-4 font-medium text-slate-900">{run.sourceFilename}</td>
                    <td className="px-4 py-4">{run.targetUserName ?? 'Sin metadata'}</td>
                    <td className="px-4 py-4">
                      <Badge tone={runStatusTone[run.status] ?? 'info'}>{run.status}</Badge>
                    </td>
                    <td className="px-4 py-4">{run.totalRows}</td>
                    <td className="px-4 py-4">{run.createdRows}</td>
                    <td className="px-4 py-4">{run.reassignedRows}</td>
                    <td className="px-4 py-4">{run.warningRows}</td>
                    <td className="px-4 py-4">{run.errorRows}</td>
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