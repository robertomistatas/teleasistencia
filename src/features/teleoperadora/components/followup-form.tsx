import { useMemo, useState, type FormEvent } from 'react'

import { Badge, Panel, primaryButtonClass } from '@/components/ui'
import type {
  ManualFollowupInput,
  TeleoperatorBeneficiaryDetail,
} from '@/features/teleoperadora/data'
import {
  createManualFollowupEvent,
  followupEventLabels,
  supportEventTypes,
  validFollowupEventTypes,
} from '@/features/teleoperadora/data'
import { useAuth } from '@/features/auth/use-auth'
import type { FollowupEventType } from '@/lib/types'

const followupOptions = [
  'contact_beneficiary',
  'contact_support_network',
  'no_answer',
  'phone_off',
  'wrong_number',
  'requests_help',
  'support_referral',
  'internal_note',
] as const satisfies FollowupEventType[]

type FollowupFormProps = {
  beneficiary: TeleoperatorBeneficiaryDetail
  onSaved: () => Promise<void> | void
}

export function FollowupForm({ beneficiary, onSaved }: FollowupFormProps) {
  const { user } = useAuth()
  const [selectedType, setSelectedType] = useState<FollowupEventType | null>(null)
  const [selectedContactId, setSelectedContactId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const derivedFlags = useMemo(
    () => ({
      isValidFollowup: selectedType ? validFollowupEventTypes.has(selectedType) : false,
      requiresSupport: selectedType ? supportEventTypes.has(selectedType) : false,
    }),
    [selectedType],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedType) {
      setError('Selecciona un tipo de evento para registrar el seguimiento manual.')
      return
    }

    if (!user) {
      setError('No existe usuario autenticado para registrar el seguimiento.')
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccess(null)

    const payload: ManualFollowupInput = {
      beneficiaryId: beneficiary.beneficiary.id,
      beneficiaryContactId: selectedContactId || null,
      assignedUserId: user.id,
      createdBy: user.id,
      eventType: selectedType,
      isValidFollowup: derivedFlags.isValidFollowup,
      notes: notes.trim() || null,
      requiresSupport: derivedFlags.requiresSupport,
    }

    try {
      await createManualFollowupEvent(payload)
      setSuccess('Seguimiento guardado en followup_events.')
      setSelectedType(null)
      setSelectedContactId('')
      setNotes('')
      await onSaved()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No fue posible guardar el seguimiento.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel className="p-6">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Registrar seguimiento manual</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
            Captura operativa minima
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={derivedFlags.isValidFollowup ? 'success' : 'muted'}>
            {derivedFlags.isValidFollowup ? 'Seguimiento valido' : 'Sin seguimiento valido'}
          </Badge>
          <Badge tone={derivedFlags.requiresSupport ? 'warning' : 'muted'}>
            {derivedFlags.requiresSupport ? 'Requiere soporte' : 'Sin derivacion'}
          </Badge>
        </div>
      </div>

      <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
        <div>
          <p className="text-sm font-medium text-slate-700">Tipo de evento</p>
          <p className="mt-1 text-sm text-slate-500">
            La tabla followup_events admite un solo event_type por registro, por eso el formulario deja una seleccion activa aunque se exprese con checkboxes.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {followupOptions.map((option) => {
              const isActive = selectedType === option

              return (
                <label
                  key={option}
                  className={[
                    'cursor-pointer rounded-[24px] border px-4 py-4 transition',
                    isActive
                      ? 'border-slate-950 bg-slate-950 text-white shadow-lg'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50',
                  ].join(' ')}
                >
                  <input
                    className="sr-only"
                    type="checkbox"
                    checked={isActive}
                    onChange={() => setSelectedType(isActive ? null : option)}
                  />
                  <span className="block text-sm font-semibold tracking-tight">
                    {followupEventLabels[option]}
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Telefono usado</span>
          <select
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            value={selectedContactId}
            onChange={(event) => setSelectedContactId(event.target.value)}
          >
            <option value="">Sin asociar a un contacto especifico</option>
            {beneficiary.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.contactName || followupEventLabels.contact_beneficiary} - {contact.phoneRaw || contact.phoneNormalized || 'Sin telefono'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Notas</span>
          <textarea
            className="mt-2 min-h-32 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Contexto de la gestion, acuerdos, observaciones o derivacion interna."
          />
        </label>

        {(error || success) && (
          <div
            className={[
              'rounded-2xl px-4 py-3 text-sm',
              error
                ? 'border border-rose-200 bg-rose-50 text-rose-700'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700',
            ].join(' ')}
          >
            {error ?? success}
          </div>
        )}

        <button
          className={primaryButtonClass}
          type="submit"
          disabled={submitting}
        >
          {submitting ? 'Guardando...' : 'Guardar seguimiento'}
        </button>
      </form>
    </Panel>
  )
}