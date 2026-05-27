import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { FollowupForm } from '@/features/teleoperadora/components/followup-form'
import { CoverageStateBadge } from '@/features/operational-workspace/components/coverage-state-badge'
import {
  contactTypeLabels,
  fetchOperationalBeneficiaryDetail,
  followupEventLabels,
  followupSourceLabels,
  outcomeLabels,
  type OperationalBeneficiaryDetail,
} from '@/features/operational-workspace/data'
import { formatDateTime, formatRelativeFollowupDays, formatTextFallback } from '@/lib/format'

function getWorkspacePath(role: 'teleoperadora' | 'admin' | 'super_admin') {
  if (role === 'teleoperadora') {
    return '/teleoperadora/cartera'
  }

  if (role === 'admin') {
    return '/admin/beneficiarios'
  }

  return '/super-admin/beneficiarios'
}

export function OperationalBeneficiaryPage() {
  const { beneficiaryId } = useParams<{ beneficiaryId: string }>()
  const { profile } = useAuth()
  const [data, setData] = useState<OperationalBeneficiaryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async (options?: { preserveData?: boolean }) => {
    if (!beneficiaryId) {
      return
    }

    if (options?.preserveData) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setError(null)

    try {
      setData(await fetchOperationalBeneficiaryDetail(beneficiaryId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar el beneficiario.')
    } finally {
      if (options?.preserveData) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }, [beneficiaryId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  if (!profile) {
    return null
  }

  const workspacePath = getWorkspacePath(profile.role)

  if (!beneficiaryId) {
    return (
      <PageState title="Beneficiario invalido" description="La vista requiere un identificador valido." />
    )
  }

  if (loading) {
    return (
      <PageState title="Cargando detalle operacional" description="Estamos preparando cobertura, contactos y timeline canonico." />
    )
  }

  if (error || !data) {
    return (
      <PageState
        title="No fue posible abrir el detalle"
        description={error ?? 'El beneficiario no esta visible en tu workspace.'}
        action={<Link to={workspacePath} className={primaryButtonClass}>Volver al workspace</Link>}
      />
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_420px]">
      <div className="space-y-5">
        {refreshing && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-700">
            Actualizando detalle con el seguimiento recien guardado...
          </div>
        )}

        <Panel className="p-6 sm:p-7">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Detalle operacional</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{data.beneficiary.fullName}</h2>
              <p className="mt-2 text-sm text-slate-600">RUT: {formatTextFallback(data.beneficiary.rutRaw)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <CoverageStateBadge state={data.workspace.coverageState} />
              {data.workspace.activeAssignmentType && (
                <Badge tone={data.workspace.activeAssignmentType === 'primary' ? 'info' : 'warning'}>
                  {data.workspace.activeAssignmentType === 'primary' ? 'Asignacion principal' : 'Asignacion apoyo'}
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Ultimo contacto efectivo</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{formatDateTime(data.workspace.lastEffectiveFollowupAt)}</p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Dias sin contacto</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{formatRelativeFollowupDays(data.workspace.daysSinceEffectiveFollowup)}</p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Ultimo outcome</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {data.workspace.latestOutcome ? outcomeLabels[data.workspace.latestOutcome] : 'Sin dato'}
              </p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Teleoperadora asignada</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{formatTextFallback(data.workspace.assignedOperatorName)}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Datos beneficiario</h3>
              <dl className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="flex justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Comuna</dt>
                  <dd className="font-medium text-slate-900">{formatTextFallback(data.beneficiary.commune)}</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Region</dt>
                  <dd className="font-medium text-slate-900">{formatTextFallback(data.beneficiary.region)}</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Inicio asignacion</dt>
                  <dd className="font-medium text-slate-900">{formatDateTime(data.workspace.activeAssignmentStartsAt)}</dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Direccion</dt>
                  <dd className="mt-2 font-medium text-slate-900">{formatTextFallback(data.beneficiary.address)}</dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Notas</dt>
                  <dd className="mt-2 font-medium text-slate-900">{formatTextFallback(data.beneficiary.notes)}</dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-950">Telefonos y contactos</h3>
              <div className="mt-4 space-y-3">
                {data.contacts.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No hay contactos activos visibles.
                  </div>
                )}

                {data.contacts.map((contact) => (
                  <article key={contact.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {contact.isPrimary && <Badge tone="info">Principal</Badge>}
                      {contact.countsAsValidFollowup && <Badge tone="success">Aporta cobertura</Badge>}
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-950">
                      {contact.contactName || contact.relationship || 'Contacto sin nombre'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{contact.phoneRaw || contact.phoneNormalized || 'Sin telefono'}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatTextFallback(contact.notes)}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Timeline operacional</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Ultimos follow_up_events</h3>
            </div>
            <Badge tone="info">Canonico</Badge>
          </div>

          <div className="mt-5 space-y-3">
            {data.timeline.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No hay seguimientos visibles para este beneficiario.
              </div>
            )}

            {data.timeline.map((event) => (
              <article key={event.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{followupSourceLabels[event.source]}</Badge>
                  <Badge tone={event.isEffectiveContact ? 'success' : 'muted'}>
                    {event.isEffectiveContact ? 'Contacto efectivo' : 'Sin contacto efectivo'}
                  </Badge>
                  <Badge tone={event.requiresSupport ? 'warning' : 'muted'}>
                    {event.requiresSupport ? 'Requiere soporte' : 'Sin derivacion'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Evento</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{followupEventLabels[event.eventType]}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Outcome</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{outcomeLabels[event.eventOutcome]}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Tipo contacto</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{contactTypeLabels[event.contactType]}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Fecha</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatDateTime(event.eventTimestamp)}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Operadora</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatTextFallback(event.operatorName)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Telefono / contacto</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatTextFallback(event.contactPhone)}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{formatTextFallback(event.notes)}</p>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel className="p-6">
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Navegacion</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Volver a la cola</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">Retorna al workspace operacional priorizado sin perder el foco diario.</p>
          <Link to={workspacePath} className={`mt-5 ${primaryButtonClass}`}>Volver al workspace</Link>
        </Panel>

        <FollowupForm beneficiary={data} onSaved={() => loadDetail({ preserveData: true })} />
      </div>
    </div>
  )
}