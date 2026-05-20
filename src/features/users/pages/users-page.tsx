import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { Panel, secondaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import {
  fetchOperationalUsers,
  getOperationalUserName,
  getUserEditPermission,
  hasPendingVisibleName,
  userRoleLabels,
} from '@/features/users/data'
import {
  PendingNameBadge,
  UserRoleBadge,
  UserStatusBadge,
} from '@/features/users/components/user-badges'
import { UserEditorPanel } from '@/features/users/components/user-editor-panel'
import type {
  UserOperationalProfile,
  UserStateFilter,
} from '@/features/users/types'
import { formatDateTime } from '@/lib/format'
import type { UserRole } from '@/lib/types'

const stateOptions: Array<{ value: UserStateFilter; label: string }> = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
]

const roleOptions: Array<{ value: UserRole | 'all'; label: string }> = [
  { value: 'all', label: 'Todos los roles' },
  { value: 'super_admin', label: userRoleLabels.super_admin },
  { value: 'admin', label: userRoleLabels.admin },
  { value: 'teleoperadora', label: userRoleLabels.teleoperadora },
]

export function UsersPage() {
  const { profile } = useAuth()
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [stateFilter, setStateFilter] = useState<UserStateFilter>('active')
  const [users, setUsers] = useState<UserOperationalProfile[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    let cancelled = false

    const loadUsers = async () => {
      setLoading(true)
      setError(null)

      try {
        const nextUsers = await fetchOperationalUsers({
          query: deferredQuery,
          role: roleFilter,
          state: stateFilter,
        })

        if (cancelled) {
          return
        }

        setUsers(nextUsers)
        setSelectedUserId((currentValue) => {
          if (currentValue && nextUsers.some((user) => user.id === currentValue)) {
            return currentValue
          }

          return nextUsers[0]?.id ?? null
        })
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setUsers([])
        setSelectedUserId(null)
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No fue posible cargar los usuarios operativos.',
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadUsers()

    return () => {
      cancelled = true
    }
  }, [deferredQuery, reloadKey, roleFilter, stateFilter])

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  )

  const summary = useMemo(() => {
    const activeCount = users.filter((user) => user.is_active).length
    const inactiveCount = users.length - activeCount
    const pendingNames = users.filter(hasPendingVisibleName).length

    return {
      total: users.length,
      activeCount,
      inactiveCount,
      pendingNames,
    }
  }, [users])

  const hasActiveFilters = Boolean(deferredQuery.trim()) || roleFilter !== 'all' || stateFilter !== 'active'

  if (!profile) {
    return null
  }

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Usuarios</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Gestion operacional de perfiles existentes
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Esta vista consolida identidad visible, rol y estado de los usuarios operativos ya registrados en public.profiles, sin intervenir autenticacion ni flujos de alta.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[540px]">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Usuarios visibles</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{summary.total}</p>
            </div>
            <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-emerald-700">Activos</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-900">{summary.activeCount}</p>
            </div>
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Nombre pendiente</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-amber-900">{summary.pendingNames}</p>
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_220px_220px_auto] lg:items-end">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Buscar por nombre o correo</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtra usuarios operativos por identidad visible o correo"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Rol</span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as UserRole | 'all')}
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Estado</span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as UserStateFilter)}
            >
              {stateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className={secondaryButtonClass}
            type="button"
            onClick={() => {
              setQuery('')
              setRoleFilter('all')
              setStateFilter('active')
            }}
            disabled={!hasActiveFilters}
          >
            Limpiar filtros
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)]">
        <Panel className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-6 py-5">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Listado de usuarios</p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Usuarios operativos
            </h3>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-sm text-slate-600">Cargando usuarios operativos...</div>
          ) : error ? (
            <div className="px-6 py-12 text-sm text-rose-700">{error}</div>
          ) : users.length === 0 ? (
            <div className="px-6 py-12">
              <h4 className="text-lg font-semibold tracking-tight text-slate-950">
                {hasActiveFilters
                  ? 'No encontramos usuarios con esos filtros.'
                  : 'Aun no existen usuarios operativos registrados.'}
              </h4>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                {hasActiveFilters
                  ? 'Prueba otro nombre, correo, rol o estado para recuperar perfiles ya existentes en public.profiles.'
                  : 'Cuando existan perfiles sincronizados desde autenticacion, apareceran aqui para su administracion operacional.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left">
                <thead className="bg-slate-50/80 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-medium">Nombre visible</th>
                    <th className="px-6 py-4 font-medium">Correo</th>
                    <th className="px-6 py-4 font-medium">Rol</th>
                    <th className="px-6 py-4 font-medium">Estado</th>
                    <th className="px-6 py-4 font-medium">Fecha creacion</th>
                    <th className="px-6 py-4 font-medium">Ultima actualizacion</th>
                    <th className="px-6 py-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-sm text-slate-700">
                  {users.map((user) => {
                    const permission = getUserEditPermission(profile.role, user)
                    const isSelected = user.id === selectedUserId

                    return (
                      <tr
                        key={user.id}
                        className={isSelected ? 'bg-amber-50/70' : 'bg-white'}
                      >
                        <td className="px-6 py-4 align-top">
                          <div className="space-y-2">
                            <p className="font-semibold tracking-tight text-slate-900">
                              {getOperationalUserName(user)}
                            </p>
                            {hasPendingVisibleName(user) && <PendingNameBadge />}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top text-slate-600">{user.email}</td>
                        <td className="px-6 py-4 align-top">
                          <UserRoleBadge role={user.role} />
                        </td>
                        <td className="px-6 py-4 align-top">
                          <UserStatusBadge is_active={user.is_active} />
                        </td>
                        <td className="px-6 py-4 align-top text-slate-600">
                          {formatDateTime(user.created_at)}
                        </td>
                        <td className="px-6 py-4 align-top text-slate-600">
                          {formatDateTime(user.updated_at)}
                        </td>
                        <td className="px-6 py-4 align-top">
                          <button
                            className={secondaryButtonClass}
                            type="button"
                            onClick={() => setSelectedUserId(user.id)}
                          >
                            {permission.canEdit ? 'Editar' : 'Ver perfil'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <UserEditorPanel
          actorRole={profile.role}
          user={selectedUser}
          onSaved={async () => {
            setReloadKey((currentValue) => currentValue + 1)
          }}
        />
      </div>
    </div>
  )
}