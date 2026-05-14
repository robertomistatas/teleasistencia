import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'

import { Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui'
import {
  getOperationalUserName,
  getUserEditPermission,
  hasPendingVisibleName,
  updateOperationalUser,
  userRoleLabels,
} from '@/features/users/data'
import {
  PendingNameBadge,
  UserRoleBadge,
  UserStatusBadge,
} from '@/features/users/components/user-badges'
import type { UserOperationalProfile } from '@/features/users/types'
import type { UserRole } from '@/lib/types'
import { formatDateTime } from '@/lib/format'

const roleOptions: UserRole[] = ['super_admin', 'admin', 'teleoperadora']

type UserEditorPanelProps = {
  actorRole: UserRole
  user: UserOperationalProfile | null
  onSaved: (user: UserOperationalProfile) => Promise<void> | void
}

export function UserEditorPanel({ actorRole, user, onSaved }: UserEditorPanelProps) {
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('teleoperadora')
  const [isActive, setIsActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false)

  useEffect(() => {
    setFullName(user?.full_name ?? '')
    setRole(user?.role ?? 'teleoperadora')
    setIsActive(user?.is_active ?? true)
    setSubmitting(false)
    setError(null)
    setSuccess(null)
    setConfirmingDeactivation(false)
  }, [user?.full_name, user?.id, user?.is_active, user?.role])

  if (!user) {
    return (
      <Panel className="p-6">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Vista operacional</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          Selecciona un usuario
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
          El panel lateral resume identidad operacional, permisos visibles y la edicion permitida para cada perfil existente.
        </p>
      </Panel>
    )
  }

  const permission = getUserEditPermission(actorRole, user)
  const namePending = hasPendingVisibleName(user)

  const handleActiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.checked
    setIsActive(nextValue)

    if (nextValue) {
      setConfirmingDeactivation(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!permission.canEdit) {
      return
    }

    if (user.is_active && !isActive && !confirmingDeactivation) {
      setConfirmingDeactivation(true)
      setSuccess(null)
      setError(null)
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const updatedUser = await updateOperationalUser(actorRole, user.id, {
        fullName,
        role,
        isActive,
      })

      setConfirmingDeactivation(false)
      setSuccess('Perfil operativo actualizado correctamente.')
      await onSaved(updatedUser)
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'No fue posible actualizar el perfil operativo.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel className="p-6">
      <div className="border-b border-slate-100 pb-5">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Perfil operativo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
            {getOperationalUserName(user)}
          </h2>
          {namePending && <PendingNameBadge />}
        </div>
        <p className="mt-2 text-sm text-slate-600">{user.email}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <UserRoleBadge role={user.role} />
          <UserStatusBadge is_active={user.is_active} />
        </div>
      </div>

      <dl className="mt-5 grid gap-4 text-sm text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="uppercase tracking-[0.16em] text-slate-400">Creado</dt>
          <dd className="mt-2 font-medium text-slate-900">{formatDateTime(user.created_at)}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.16em] text-slate-400">Ultima actualizacion</dt>
          <dd className="mt-2 font-medium text-slate-900">{formatDateTime(user.updated_at)}</dd>
        </div>
      </dl>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Nombre visible</span>
          <input
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Escribe el nombre institucional que debe verse en la plataforma"
            disabled={!permission.canEdit || submitting}
          />
          <p className="mt-2 text-xs leading-6 text-slate-500">
            Si queda vacio, la vista mostrara un aviso suave de nombre pendiente y usara el correo solo como respaldo visual.
          </p>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Rol</span>
          <select
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            disabled={!permission.canEdit || submitting}
          >
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {userRoleLabels[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
          <input
            className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-amber-400"
            type="checkbox"
            checked={isActive}
            onChange={handleActiveChange}
            disabled={!permission.canEdit || submitting}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">Usuario activo</span>
            <span className="mt-1 block text-sm leading-6 text-slate-600">
              Desactivar un usuario oculta su acceso operativo, pero no elimina historial ni seguimientos.
            </span>
          </span>
        </label>

        {confirmingDeactivation && (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p className="font-semibold">Confirmacion requerida para desactivar</p>
            <p className="mt-2 leading-6">
              Esto no eliminara historial ni seguimientos. Vuelve a guardar para confirmar la desactivacion o reactiva el usuario para cancelar.
            </p>
          </div>
        )}

        {!permission.canEdit && permission.reason && (
          <div className="rounded-[24px] border border-sky-200 bg-sky-50 px-4 py-4 text-sm leading-6 text-sky-800">
            {permission.reason}
          </div>
        )}

        {(error || success) && (
          <div
            aria-live="polite"
            className={[
              'rounded-[24px] px-4 py-4 text-sm leading-6',
              error
                ? 'border border-rose-200 bg-rose-50 text-rose-700'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700',
            ].join(' ')}
          >
            {error ?? success}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            className={primaryButtonClass}
            type="submit"
            disabled={!permission.canEdit || submitting}
          >
            {submitting
              ? 'Guardando...'
              : confirmingDeactivation
                ? 'Confirmar desactivacion'
                : 'Guardar cambios'}
          </button>
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={() => {
              setFullName(user.full_name ?? '')
              setRole(user.role)
              setIsActive(user.is_active)
              setError(null)
              setSuccess(null)
              setConfirmingDeactivation(false)
            }}
            disabled={submitting}
          >
            Restablecer
          </button>
        </div>
      </form>
    </Panel>
  )
}