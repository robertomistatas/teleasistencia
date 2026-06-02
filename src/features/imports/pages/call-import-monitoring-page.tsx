import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  Badge,
  PageState,
  Panel,
  secondaryButtonClass,
} from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import {
  fetchCallImportCorrelationIssues,
  fetchCallImportDetail,
  fetchCallImportMonitoringOverview,
  getCallLogsImportErrorMessage,
  type CallImportCorrelationIssue,
  type CallImportJobDetail,
  type CallImportJobIssue,
  type CallImportMonitoringOverview,
  type CallImportMonitoringRun,
  type CallLogCorrelationIssueType,
} from '@/features/imports/data'
import { formatDateTime } from '@/lib/format'

const runStatusTone: Record<string, 'danger' | 'warning' | 'success' | 'muted' | 'info'> = {
  uploaded: 'muted',
  processing: 'info',
  processed: 'success',
  processed_with_errors: 'warning',
  failed: 'danger',
  cancelled: 'muted',
}

const issueTone: Record<CallLogCorrelationIssueType, 'danger' | 'warning' | 'success' | 'muted' | 'info'> = {
  beneficiary_not_found: 'warning',
  phone_not_matched: 'info',
  assignment_not_found: 'warning',
  assignment_inactive: 'warning',
  operator_not_found: 'warning',
  ambiguous_match: 'warning',
  invalid_call_data: 'danger',
  duplicate_call: 'muted',
  unknown: 'muted',
}

const issueLabel: Record<CallLogCorrelationIssueType, string> = {
  beneficiary_not_found: 'Beneficiario no encontrado',
  phone_not_matched: 'Teléfono sin match',
  assignment_not_found: 'Asignación no encontrada',
  assignment_inactive: 'Asignación inactiva',
  operator_not_found: 'Operadora no encontrada',
  ambiguous_match: 'Match ambiguo',
  invalid_call_data: 'Dato inválido',
  duplicate_call: 'Llamada duplicada',
  unknown: 'Sin clasificar',
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'slate' | 'emerald' | 'amber' | 'sky'
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
  }[tone]

  return (
    <div className={`rounded-[24px] border px-4 py-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={runStatusTone[status] ?? 'muted'}>{status.replaceAll('_', ' ')}</Badge>
}

function CorrelationIssueBadge({ issueType }: { issueType: CallLogCorrelationIssueType }) {
  return <Badge tone={issueTone[issueType]}>{issueLabel[issueType]}</Badge>
}

function MetricGrid({ job }: { job: CallImportMonitoringRun }) {
  const metrics = [
    { label: 'Filas totales', value: job.totalRows },
    { label: 'Procesadas', value: job.processedRows },
    { label: 'Válidas', value: job.validRows },
    { label: 'Inválidas', value: job.invalidRows },
    { label: 'Correladas', value: job.correlatedRows },
    { label: 'Sin correlación', value: job.uncorrelatedRows },
    { label: 'Warnings', value: job.warningCount },
    { label: 'Errores', value: job.errorCount },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{metric.label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{metric.value}</p>
        </div>
      ))}
    </div>
  )
}

function IssuesList({
  title,
  issues,
}: {
  title: string
  issues: CallImportJobIssue[]
}) {
  return (
    <Panel className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600">Incidencias registradas por fila y asociadas al import job.</p>
        </div>
        <Badge tone={title === 'Errores' ? 'danger' : 'warning'}>{issues.length}</Badge>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
          No hay elementos en esta categoría para la corrida seleccionada.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
            <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Fila</th>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Mensaje</th>
                <th className="px-4 py-3 font-medium">Registrado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
              {issues.map((issue) => (
                <tr key={issue.id} className="align-top">
                  <td className="px-4 py-4 font-semibold text-slate-900">{issue.rowNumber ?? 'Global'}</td>
                  <td className="px-4 py-4 uppercase text-slate-500">{issue.errorCode}</td>
                  <td className="px-4 py-4 text-slate-600">{issue.message}</td>
                  <td className="px-4 py-4 text-slate-500">{issue.createdAt ? formatDateTime(issue.createdAt) : 'Sin fecha'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function CorrelationIssuesTable({ issues }: { issues: CallImportCorrelationIssue[] }) {
  return (
    <Panel className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Diagnóstico de correlación</h2>
          <p className="text-sm text-slate-600">Problemas de match, asignación o datos inválidos detectados para esta corrida.</p>
        </div>
        <Badge tone="info">{issues.length}</Badge>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
          No se registraron problemas de correlación para la corrida seleccionada.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
            <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Fila</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">External call ID</th>
                <th className="px-4 py-3 font-medium">Beneficiario</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                <th className="px-4 py-3 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
              {issues.map((issue) => (
                <tr key={issue.id} className="align-top">
                  <td className="px-4 py-4 font-semibold text-slate-900">{issue.rowNumber ?? 'Global'}</td>
                  <td className="px-4 py-4"><CorrelationIssueBadge issueType={issue.issueType} /></td>
                  <td className="px-4 py-4">{issue.externalCallId ?? 'Sin ID'}</td>
                  <td className="px-4 py-4">{issue.beneficiaryName ?? issue.beneficiaryId ?? 'Sin beneficiario'}</td>
                  <td className="px-4 py-4">{issue.phoneNormalized ?? 'Sin normalizar'}</td>
                  <td className="px-4 py-4 text-slate-600">{issue.issueMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function HistoryTable({
  imports,
  selectedImportId,
  onSelect,
}: {
  imports: CallImportMonitoringRun[]
  selectedImportId: string | null
  onSelect: (importId: string) => void
}) {
  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Historial de imports</h2>
        <p className="text-sm text-slate-600">Cada fila corresponde a un import job de call logs reutilizando `import_runs` como registro auditable principal.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
          <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Archivo</th>
              <th className="px-4 py-3 font-medium">Inicio</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Filas</th>
              <th className="px-4 py-3 font-medium">Correlación</th>
              <th className="px-4 py-3 font-medium">Warnings / Errores</th>
              <th className="px-4 py-3 font-medium">Importado por</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
            {imports.map((importRun) => {
              const isSelected = importRun.id === selectedImportId

              return (
                <tr
                  key={importRun.id}
                  className={isSelected ? 'bg-sky-50/60' : 'hover:bg-slate-50/70'}
                >
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      onClick={() => onSelect(importRun.id)}
                      className="text-left"
                    >
                      <span className="block font-semibold text-slate-900">{importRun.filename}</span>
                      <span className="block text-xs text-slate-500">{importRun.id}</span>
                    </button>
                  </td>
                  <td className="px-4 py-4">{importRun.startedAt ? formatDateTime(importRun.startedAt) : 'Sin fecha'}</td>
                  <td className="px-4 py-4 uppercase text-slate-500">{importRun.sourceType}</td>
                  <td className="px-4 py-4"><StatusBadge status={importRun.status} /></td>
                  <td className="px-4 py-4">{importRun.processedRows} / {importRun.totalRows}</td>
                  <td className="px-4 py-4">{importRun.correlatedRows} / {importRun.validRows}</td>
                  <td className="px-4 py-4">{importRun.warningCount} / {importRun.errorCount}</td>
                  <td className="px-4 py-4">{importRun.importedByName ?? importRun.importedByEmail ?? importRun.importedBy ?? 'Sin usuario'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export function CallImportMonitoringPage() {
  const { isConfigured, profile } = useAuth()
  const [overview, setOverview] = useState<CallImportMonitoringOverview | null>(null)
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CallImportJobDetail | null>(null)
  const [correlationIssues, setCorrelationIssues] = useState<CallImportCorrelationIssue[]>([])
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadOverview = async () => {
      setLoadingOverview(true)

      try {
        const nextOverview = await fetchCallImportMonitoringOverview(25)

        if (cancelled) {
          return
        }

        setOverview(nextOverview)
        setSelectedImportId((current) => {
          if (current && nextOverview.imports.some((item) => item.id === current)) {
            return current
          }

          return nextOverview.imports[0]?.id ?? null
        })
        setError(null)
      } catch (loadError) {
        if (!cancelled) {
          setError(getCallLogsImportErrorMessage(loadError))
        }
      } finally {
        if (!cancelled) {
          setLoadingOverview(false)
        }
      }
    }

    if (isConfigured) {
      void loadOverview()
    } else {
      setLoadingOverview(false)
    }

    return () => {
      cancelled = true
    }
  }, [isConfigured])

  useEffect(() => {
    let cancelled = false

    const loadDetail = async () => {
      if (!selectedImportId) {
        setDetail(null)
        setCorrelationIssues([])
        return
      }

      setLoadingDetail(true)

      try {
        const [nextDetail, nextCorrelationIssues] = await Promise.all([
          fetchCallImportDetail(selectedImportId),
          fetchCallImportCorrelationIssues(selectedImportId),
        ])

        if (cancelled) {
          return
        }

        setDetail(nextDetail)
        setCorrelationIssues(nextCorrelationIssues)
        setError(null)
      } catch (loadError) {
        if (!cancelled) {
          setError(getCallLogsImportErrorMessage(loadError))
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false)
        }
      }
    }

    if (isConfigured) {
      void loadDetail()
    }

    return () => {
      cancelled = true
    }
  }, [isConfigured, selectedImportId])

  const selectedJob = detail?.job ?? overview?.imports.find((item) => item.id === selectedImportId) ?? null
  const summaryCards = useMemo(() => {
    if (!overview) {
      return null
    }

    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Imports" value={String(overview.summary.totalImports)} tone="slate" />
        <SummaryCard label="Exitosos" value={String(overview.summary.successfulImports)} tone="emerald" />
        <SummaryCard label="Con errores" value={String(overview.summary.importsWithErrors)} tone="amber" />
        <SummaryCard label="Tasa correlación" value={`${overview.summary.correlationRate.toFixed(2)}%`} tone="sky" />
      </div>
    )
  }, [overview])

  if (!profile) {
    return null
  }

  if (!isConfigured) {
    return (
      <PageState
        title="Monitoreo no disponible"
        description="Configura Supabase para consultar el monitoreo y los diagnósticos de importación de call logs."
      />
    )
  }

  if (loadingOverview && !overview) {
    return (
      <PageState
        title="Cargando monitoreo"
        description="Consultando resumen, historial y diagnósticos de importaciones de call logs."
      />
    )
  }

  return (
    <div className="space-y-6">
      <Panel className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Badge tone="info">FASE 4.8C</Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Import Monitoring & Operational Diagnostics</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                Vista auditable de cada ejecución de importación de llamadas AMAIA, con métricas operativas, warnings,
                errores y fallas de correlación sin romper el pipeline vigente basado en `import_runs`.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={secondaryButtonClass}
            >
              Refrescar vista
            </button>
            <Link to="/imports/calls" className={secondaryButtonClass}>
              Volver al importador
            </Link>
          </div>
        </div>

        {summaryCards}

        {error ? (
          <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </Panel>

      <HistoryTable
        imports={overview?.imports ?? []}
        selectedImportId={selectedImportId}
        onSelect={setSelectedImportId}
      />

      {!selectedJob ? (
        <PageState
          title="Sin corridas seleccionadas"
          description="Todavía no hay import jobs de call logs disponibles para inspeccionar en detalle."
        />
      ) : (
        <div className="space-y-6">
          <Panel className="space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900">Detalle de import job</h2>
                  <StatusBadge status={selectedJob.status} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{selectedJob.filename}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{selectedJob.id}</p>
              </div>

              <div className="text-sm text-slate-600">
                <p>Importado por: {selectedJob.importedByName ?? selectedJob.importedByEmail ?? selectedJob.importedBy ?? 'Sin usuario'}</p>
                <p>Inicio: {selectedJob.startedAt ? formatDateTime(selectedJob.startedAt) : 'Sin fecha'}</p>
                <p>Fin: {selectedJob.finishedAt ? formatDateTime(selectedJob.finishedAt) : 'En curso'}</p>
              </div>
            </div>

            <MetricGrid job={selectedJob} />

            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Metadata</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {JSON.stringify(selectedJob.metadata ?? {}, null, 2)}
                </pre>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Lectura rápida</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p>Source: {selectedJob.sourceType}</p>
                  <p>Procesadas: {selectedJob.processedRows} de {selectedJob.totalRows}</p>
                  <p>Correladas: {selectedJob.correlatedRows}</p>
                  <p>Sin correlación: {selectedJob.uncorrelatedRows}</p>
                  <p>Warnings: {selectedJob.warningCount}</p>
                  <p>Errores: {selectedJob.errorCount}</p>
                </div>
              </div>
            </div>
          </Panel>

          {loadingDetail ? (
            <PageState
              title="Cargando detalle"
              description="Recuperando errores, warnings y diagnóstico de correlación para la corrida seleccionada."
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-2">
              <IssuesList title="Errores" issues={detail?.errors ?? []} />
              <IssuesList title="Warnings" issues={detail?.warnings ?? []} />
            </div>
          )}

          <CorrelationIssuesTable issues={correlationIssues} />
        </div>
      )}
    </div>
  )
}