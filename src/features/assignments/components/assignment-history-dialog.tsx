import { useEffect, useState } from 'react'

import { Badge, Panel, secondaryButtonClass } from '@/components/ui'
import { fetchAssignmentHistory } from '@/features/assignments/data'
import type {
  AssignmentHistoryItem,
  AssignmentPortfolioBeneficiary,
} from '@/features/assignments/types'
import { formatDateTime } from '@/lib/format'

function getAssignmentTypeLabel(type: string) {
  if (type === 'primary') {
    return 'Responsable oficial'
  }

  if (type === 'support') {
    return 'Apoyo temporal'
  }

  return type
}

function getAssignmentStatusLabel(status: string) {
  if (status === 'active') {
    return 'Activa'
  }

  if (status === 'inactive') {
    return 'Inactiva'
  }

  return status
}

export function AssignmentHistoryDialog({
  beneficiary,
  onClose,
}: {
  beneficiary: AssignmentPortfolioBeneficiary
  onClose: () => void
}) {
  const [items, setItems] = useState<AssignmentHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const nextItems = await fetchAssignmentHistory(beneficiary.beneficiaryId)

        if (cancelled) {
          return
        }

        setItems(nextItems)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setItems([])
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No fue posible cargar el historial de asignaciones.',
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [beneficiary.beneficiaryId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/45 px-4 py-4 backdrop-blur-sm sm:py-6">
      <div className="max-h-full w-full max-w-4xl">
        <Panel className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0 sm:max-h-[calc(100vh-3rem)]">
          <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-6 sm:px-7 sm:py-7">
            <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Historial de asignaciones</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {beneficiary.beneficiaryName}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                La secuencia muestra responsables oficiales y apoyos temporales en orden cronológico, con trazabilidad de apertura y cierre.
              </p>
            </div>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={onClose}
            >
              Cerrar
            </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7 sm:py-6">
            <div className="space-y-4">
            {loading && (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                Cargando historial de asignaciones...
              </div>
            )}

            {!loading && error && (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">
                {error}
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                No hay historial visible para este beneficiario.
              </div>
            )}

            {!loading && !error && items.map((item) => (
              <article key={item.assignmentId} className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold tracking-tight text-slate-950">
                      {item.assignedUserName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.assignedUserEmail || 'Correo no visible'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={item.assignmentType === 'primary' ? 'info' : 'warning'}>
                      {getAssignmentTypeLabel(item.assignmentType)}
                    </Badge>
                    <Badge tone={item.status === 'active' ? 'success' : 'muted'}>
                      {getAssignmentStatusLabel(item.status)}
                    </Badge>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Inicio</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{formatDateTime(item.startsAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Término</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {item.endsAt ? formatDateTime(item.endsAt) : 'Aún vigente'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Creada por</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{item.createdByName || 'Sin registro'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Cerrada por</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{item.endedByName || 'Sin cierre'}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[20px] bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Motivo de inicio</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.reason || 'Sin motivo registrado'}</p>
                  </div>
                  <div className="rounded-[20px] bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Motivo de cierre</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.endedReason || 'Sin cierre registrado'}</p>
                  </div>
                </div>
              </article>
            ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}