import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Badge, PageState, Panel, primaryButtonClass } from '@/components/ui'
import { useAuth } from '@/features/auth/use-auth'
import { FollowupForm } from '@/features/teleoperadora/components/followup-form'
import { StatusBadge } from '@/features/teleoperadora/components/status-badge'
import {
  fetchTeleoperatorBeneficiaryDetail,
  followupEventLabels,
  type TeleoperatorBeneficiaryDetail,
} from '@/features/teleoperadora/data'
import { formatDateTime, formatRelativeFollowupDays, formatTextFallback } from '@/lib/format'

export function BeneficiaryDetailPage() {
  const { beneficiaryId } = useParams<{ beneficiaryId: string }>()
  const { user } = useAuth()
  const userId = user?.id
  const [data, setData] = useState<TeleoperatorBeneficiaryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    if (!beneficiaryId || !userId) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const nextData = await fetchTeleoperatorBeneficiaryDetail(userId, beneficiaryId)
      setData(nextData)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No fue posible cargar la ficha.')
    } finally {
      setLoading(false)
    }
  }, [beneficiaryId, userId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  if (!beneficiaryId) {
    return (
      <PageState
        title="Beneficiario invalido"
        description="La ficha requiere un identificador de beneficiario valido."
      />
    )
  }

  if (loading) {
    return (
      <PageState
        title="Cargando ficha beneficiario"
        description="Estamos consultando datos base, telefonos, llamadas, seguimientos y estado actual."
      />
    )
  }

  if (error || !data) {
    return (
      <PageState
        title="No fue posible abrir la ficha"
        description={error ?? 'La cartera activa no contiene este beneficiario.'}
        action={
          <Link
            to="/teleoperadora/cartera"
            className={primaryButtonClass}
          >
            Volver a mi cartera
          </Link>
        }
      />
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_420px]">
      <div className="space-y-5">
        <Panel className="p-6 sm:p-7">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Ficha beneficiario</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                {data.beneficiary.fullName}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                RUT: {formatTextFallback(data.beneficiary.rutRaw)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={data.status.status} />
              <Badge tone="info">Asignacion activa</Badge>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Ultimo contacto valido</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {formatTextFallback(formatDateTime(data.status.lastValidFollowupAt))}
              </p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Dias sin seguimiento</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {formatRelativeFollowupDays(data.status.daysSinceLastValidFollowup)}
              </p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Comuna</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {formatTextFallback(data.beneficiary.commune)}
              </p>
            </div>
            <div className="rounded-[24px] bg-slate-50 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Inicio asignacion</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {formatDateTime(data.assignment.startsAt)}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Datos basicos</h3>
              <dl className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="flex justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Fecha nacimiento</dt>
                  <dd className="font-medium text-slate-900">
                    {formatTextFallback(data.beneficiary.birthDate)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Region</dt>
                  <dd className="font-medium text-slate-900">
                    {formatTextFallback(data.beneficiary.region)}
                  </dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Direccion</dt>
                  <dd className="mt-2 font-medium text-slate-900">
                    {formatTextFallback(data.beneficiary.address)}
                  </dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt>Notas beneficiario</dt>
                  <dd className="mt-2 font-medium text-slate-900">
                    {formatTextFallback(data.beneficiary.notes)}
                  </dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-950">Telefonos y contactos</h3>
              <div className="mt-4 space-y-3">
                {data.contacts.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No hay contactos activos asociados.
                  </div>
                )}

                {data.contacts.map((contact) => (
                  <article key={contact.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {contact.isPrimary && <Badge tone="info">Principal</Badge>}
                      {contact.countsAsValidFollowup && <Badge tone="success">Valida seguimiento</Badge>}
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-950">
                      {contact.contactName || contact.relationship || contact.contactType}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {contact.phoneRaw || contact.phoneNormalized || 'Sin telefono'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatTextFallback(contact.notes)}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Historial llamadas</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                call_interactions
              </h3>
            </div>
            <Badge tone="info">Ultimas 20</Badge>
          </div>

          <div className="mt-5 space-y-3">
            {data.calls.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No hay llamadas visibles para este beneficiario.
              </div>
            )}

            {data.calls.map((call) => (
              <article key={call.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={call.countsAsValidFollowup ? 'success' : 'muted'}>
                    {call.countsAsValidFollowup ? 'Cuenta como seguimiento' : 'No cuenta como seguimiento'}
                  </Badge>
                  <Badge tone={call.isValidContact ? 'success' : 'muted'}>
                    {call.isValidContact ? 'Contacto valido' : 'Sin contacto valido'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Fecha</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {formatDateTime(call.startedAt || call.callDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Direccion</p>
                    <p className="mt-1 text-sm font-medium capitalize text-slate-900">
                      {call.direction}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Telefono</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {formatTextFallback(call.phoneRaw || call.phoneNormalized)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Resultado AMAIA</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {formatTextFallback(call.result)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {formatTextFallback(call.observation || call.notes)}
                </p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Historial seguimientos</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                followup_events
              </h3>
            </div>
            <Badge tone="info">Ultimos 20</Badge>
          </div>

          <div className="mt-5 space-y-3">
            {data.followups.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No hay seguimientos registrados para este beneficiario.
              </div>
            )}

            {data.followups.map((followup) => (
              <article key={followup.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{followup.source}</Badge>
                  <Badge tone={followup.isValidFollowup ? 'success' : 'muted'}>
                    {followup.isValidFollowup ? 'Seguimiento valido' : 'No valido'}
                  </Badge>
                  <Badge tone={followup.requiresSupport ? 'warning' : 'muted'}>
                    {followup.requiresSupport ? 'Requiere soporte' : 'Sin derivacion'}
                  </Badge>
                </div>
                <p className="mt-3 text-base font-semibold text-slate-950">
                  {followupEventLabels[followup.eventType]}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateTime(followup.occurredAt)}
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {formatTextFallback(followup.notes)}
                </p>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <FollowupForm beneficiary={data} onSaved={loadDetail} />
      </div>
    </div>
  )
}