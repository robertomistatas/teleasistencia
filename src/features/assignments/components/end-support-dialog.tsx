import { useState } from 'react'

import { Badge, Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui'
import {
  endSupportAssignment,
  getReassignResponsibleErrorMessage,
} from '@/features/assignments/data'
import type {
  AssignmentPortfolioBeneficiary,
  EndSupportAssignmentResult,
} from '@/features/assignments/types'

export function EndSupportDialog({
  beneficiary,
  onClose,
  onSuccess,
}: {
  beneficiary: AssignmentPortfolioBeneficiary
  onClose: () => void
  onSuccess: (result: EndSupportAssignmentResult) => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const canSubmit = reason.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) {
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const result = await endSupportAssignment({
        assignmentId: beneficiary.assignmentId,
        reason: reason.trim(),
      })

      onSuccess(result)
    } catch (error) {
      setSubmitError(getReassignResponsibleErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl">
        <Panel className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Cierre de apoyo</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Finalizar apoyo temporal
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                Esta acción cerrará el apoyo temporal activo y mantendrá intacta la responsable oficial del beneficiario.
              </p>
            </div>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={onClose}
              disabled={submitting}
            >
              Cerrar
            </button>
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="warning">Apoyo temporal activo</Badge>
              <Badge tone="info">Responsable oficial conservada</Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Beneficiario</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{beneficiary.beneficiaryName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Teleoperadora de apoyo</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{beneficiary.teleoperatorName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Responsable oficial</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{beneficiary.primaryResponsibleName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Impacto</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  El apoyo temporal se cerrará y el historial quedará conservado.
                </p>
              </div>
            </div>
          </div>

          <label className="mt-6 block">
            <span className="text-sm font-medium text-slate-700">Motivo de cierre</span>
            <textarea
              className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explica por qué termina este apoyo temporal"
              disabled={submitting}
            />
          </label>

          {submitError && <p className="mt-4 text-sm text-rose-700">{submitError}</p>}

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {submitting ? 'Cerrando apoyo...' : 'Confirmar cierre'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}