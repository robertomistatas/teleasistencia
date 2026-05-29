import { Badge, PageState, Panel, secondaryButtonClass } from '@/components/ui'
import { StatusBadge } from '@/features/teleoperadora/components/status-badge'
import { followupStatusMeta } from '@/features/teleoperadora/followup-metadata'
import type {
  AssignmentPortfolioBeneficiary,
  AssignmentPortfolioSummary,
} from '@/features/assignments/types'
import {
  formatPercentage,
  getLoadLevel,
  getLoadLevelMeta,
  getPortfolioHealth,
  getPortfolioHealthMeta,
} from '@/features/assignments/utils'
import { formatDateTime, formatRelativeFollowupDays } from '@/lib/format'

export function TeleoperatorPortfolioPanel({
  portfolio,
  beneficiaries,
  averagePortfolioSize,
  canManageAssignments,
  onRequestChangeResponsible,
  onRequestAddSupport,
  onRequestEndSupport,
  onRequestViewHistory,
}: {
  portfolio: AssignmentPortfolioSummary | null
  beneficiaries: AssignmentPortfolioBeneficiary[]
  averagePortfolioSize: number
  canManageAssignments: boolean
  onRequestChangeResponsible: (beneficiary: AssignmentPortfolioBeneficiary) => void
  onRequestAddSupport: (beneficiary: AssignmentPortfolioBeneficiary) => void
  onRequestEndSupport: (beneficiary: AssignmentPortfolioBeneficiary) => void
  onRequestViewHistory: (beneficiary: AssignmentPortfolioBeneficiary) => void
}) {
  if (!portfolio) {
    return (
      <PageState
        title="Sin cartera seleccionada"
        description="Selecciona una responsable operacional para revisar la cartera vigente y su responsable oficial visible."
      />
    )
  }

  const healthMeta = getPortfolioHealthMeta(getPortfolioHealth(portfolio))
  const loadMeta = getLoadLevelMeta(getLoadLevel(portfolio.totalPortfolio, averagePortfolioSize))

  return (
    <div className="space-y-5">
      <Panel className="p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Vista por teleoperadora</p>
            <h3 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              {portfolio.teleoperatorName}
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Esta lectura muestra la cartera vigente, sus beneficiarios en seguimiento y el estado consolidado de cobertura. La responsable visible corresponde a la referencia oficial de esta etapa.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="info">Responsable oficial</Badge>
              <Badge tone={healthMeta.tone}>{healthMeta.label}</Badge>
              <Badge tone={loadMeta.tone}>{loadMeta.label}</Badge>
              {portfolio.totalSupportAssignments > 0 && (
                <Badge tone="warning">{portfolio.totalSupportAssignments} apoyos temporales</Badge>
              )}
              {!portfolio.isProfileActive && <Badge tone="warning">Perfil inactivo</Badge>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Beneficiarios asignados</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{portfolio.totalPortfolio}</p>
            </div>
            <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Apoyos temporales</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-amber-900">{portfolio.totalSupportAssignments}</p>
            </div>
            <div className="rounded-[22px] border border-sky-200 bg-sky-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-sky-700">Cobertura vigente</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-sky-900">
                {formatPercentage(portfolio.coveragePercentage)}
              </p>
            </div>
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Al día</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{portfolio.totalUpToDate}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Pendientes</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{portfolio.totalPending}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Urgentes</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{portfolio.totalUrgent}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Sin datos</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{portfolio.totalNoData}</p>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {beneficiaries.length === 0 && (
          <div className="xl:col-span-2 2xl:col-span-3">
            <PageState
              title="Sin beneficiarios visibles"
              description="No hay beneficiarios que coincidan con los filtros activos para esta cartera."
            />
          </div>
        )}

        {beneficiaries.map((item) => {
          const meta = followupStatusMeta[item.followupStatus]
          const isPrimaryAssignment = item.assignmentType === 'primary'

          return (
            <Panel key={item.assignmentId} className={`relative overflow-hidden p-6 ${meta.panelClass}`}>
              <div className={`absolute inset-y-0 left-0 w-2 ${meta.accentClass}`} />
              <div className="pl-2">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Beneficiario asignado</p>
                    <h4 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                      {item.beneficiaryName}
                    </h4>
                    <p className="mt-2 text-sm text-slate-600">
                      {item.commune || 'Comuna sin dato'}
                    </p>
                  </div>
                  <StatusBadge status={item.followupStatus} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone={isPrimaryAssignment ? 'info' : 'warning'}>
                    {isPrimaryAssignment ? 'Responsable oficial' : 'Apoyo temporal'}
                  </Badge>
                  <Badge tone="muted">
                    {isPrimaryAssignment ? 'Responsable oficial vigente' : `Responsable oficial: ${item.primaryResponsibleName}`}
                  </Badge>
                  {isPrimaryAssignment && item.supportCount > 0 && (
                    <Badge tone="warning">{item.supportCount} apoyo(s) activo(s)</Badge>
                  )}
                  {!item.isProfileActive && <Badge tone="warning">Perfil a revisar</Badge>}
                </div>

                {item.supportCount > 0 && isPrimaryAssignment && (
                  <div className="mt-4 rounded-[20px] bg-white/80 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Apoyos temporales activos</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {item.supportResponsibleNames.join(', ')}
                    </p>
                  </div>
                )}

                {!isPrimaryAssignment && (
                  <div className="mt-4 rounded-[20px] bg-white/80 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Responsable oficial actual</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {item.primaryResponsibleName}
                    </p>
                  </div>
                )}

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[22px] bg-white/80 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Dias sin contacto</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">
                      {formatRelativeFollowupDays(item.daysSinceLastValidFollowup)}
                    </p>
                  </div>
                  <div className="rounded-[22px] bg-white/80 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Ultimo contacto válido</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">
                      {item.lastValidFollowupAt ? formatDateTime(item.lastValidFollowupAt) : 'Sin dato'}
                    </p>
                  </div>
                  <div className="rounded-[22px] bg-white/80 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Comuna / RUT</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">
                      {item.beneficiaryRut || 'Sin RUT visible'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{item.region || 'Region sin dato'}</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
                  <span>Responsabilidad visible desde {formatDateTime(item.startsAt)}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={meta.accentClass.replace('bg-', 'text-')}>
                      {meta.label}
                    </span>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => onRequestViewHistory(item)}
                    >
                      Ver historial
                    </button>
                    {canManageAssignments && isPrimaryAssignment && (
                      <>
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={() => onRequestAddSupport(item)}
                        >
                          Agregar apoyo temporal
                        </button>
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={() => onRequestChangeResponsible(item)}
                        >
                          Cambiar responsable
                        </button>
                      </>
                    )}
                    {canManageAssignments && !isPrimaryAssignment && (
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        onClick={() => onRequestEndSupport(item)}
                      >
                        Finalizar apoyo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          )
        })}
      </section>
    </div>
  )
}