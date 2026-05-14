import { Badge, Panel, secondaryButtonClass } from '@/components/ui'
import type { AssignmentPortfolioSummary } from '@/features/assignments/types'
import {
  formatPercentage,
  getLoadLevel,
  getLoadLevelMeta,
  getPortfolioHealth,
  getPortfolioHealthMeta,
} from '@/features/assignments/utils'

export function TeleoperatorSummaryTable({
  items,
  averagePortfolioSize,
  selectedTeleoperatorId,
  onSelect,
}: {
  items: AssignmentPortfolioSummary[]
  averagePortfolioSize: number
  selectedTeleoperatorId: string | null
  onSelect: (teleoperatorId: string) => void
}) {
  if (items.length === 0) {
    return (
      <Panel className="p-8">
        <p className="text-lg font-semibold tracking-tight text-slate-950">Sin carteras visibles</p>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
          Ajusta los filtros para revisar la distribución operacional vigente de ownership PRIMARY.
        </p>
      </Panel>
    )
  }

  return (
    <Panel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 px-6 py-5">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Vista global operacional</p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
          Distribución actual de responsables oficiales
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
          La tabla usa exclusivamente asignaciones activas `primary` como ownership institucional vigente. No habilita movimientos ni cambios estructurales.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70 text-left text-xs uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="px-6 py-4 font-medium">Responsable operacional</th>
              <th className="px-4 py-4 font-medium">Cartera</th>
              <th className="px-4 py-4 font-medium">Al día</th>
              <th className="px-4 py-4 font-medium">Pendientes</th>
              <th className="px-4 py-4 font-medium">Urgentes</th>
              <th className="px-4 py-4 font-medium">Sin datos</th>
              <th className="px-4 py-4 font-medium">Cobertura</th>
              <th className="px-4 py-4 font-medium">Lectura</th>
              <th className="px-6 py-4 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {items.map((item) => {
              const healthMeta = getPortfolioHealthMeta(getPortfolioHealth(item))
              const loadMeta = getLoadLevelMeta(
                getLoadLevel(item.totalPortfolio, averagePortfolioSize),
              )
              const isSelected = selectedTeleoperatorId === item.teleoperatorId

              return (
                <tr key={item.teleoperatorId} className={isSelected ? 'bg-slate-50/70' : undefined}>
                  <td className="px-6 py-5 align-top">
                    <div className="space-y-3">
                      <div>
                        <p className="text-base font-semibold tracking-tight text-slate-950">
                          {item.teleoperatorName}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.teleoperatorEmail || 'Correo no visible'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="info">Responsable oficial</Badge>
                        <Badge tone={loadMeta.tone}>{loadMeta.label}</Badge>
                        {!item.isProfileActive && <Badge tone="warning">Perfil inactivo</Badge>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-5 text-sm font-semibold text-slate-950">{item.totalPortfolio}</td>
                  <td className="px-4 py-5 text-sm text-slate-700">{item.totalUpToDate}</td>
                  <td className="px-4 py-5 text-sm text-slate-700">{item.totalPending}</td>
                  <td className="px-4 py-5 text-sm text-slate-700">{item.totalUrgent}</td>
                  <td className="px-4 py-5 text-sm text-slate-700">{item.totalNoData}</td>
                  <td className="px-4 py-5 text-sm font-semibold text-slate-950">
                    {formatPercentage(item.coveragePercentage)}
                  </td>
                  <td className="px-4 py-5 align-top">
                    <Badge tone={healthMeta.tone}>{healthMeta.label}</Badge>
                  </td>
                  <td className="px-6 py-5 align-top">
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => onSelect(item.teleoperatorId)}
                    >
                      Ver cartera
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}