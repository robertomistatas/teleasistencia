import { useState } from 'react'

import { Badge, Panel } from '@/components/ui'
import { cn } from '@/lib/cn'

type DateRangeOption = 'last-month' | 'last-week' | 'custom'
type AuditTab = 'summary' | 'teleoperators' | 'risk' | 'reports'

const rangeOptions: Array<{ value: DateRangeOption; label: string }> = [
  { value: 'last-month', label: 'Último mes' },
  { value: 'last-week', label: 'Última semana' },
  { value: 'custom', label: 'Personalizado' },
]

const auditTabs: Array<{ id: AuditTab; label: string; title: string; description: string }> = [
  {
    id: 'summary',
    label: 'Resumen ejecutivo',
    title: 'Resumen ejecutivo',
    description: 'KPIs globales, alertas principales y lectura ejecutiva del estado de la operación.',
  },
  {
    id: 'teleoperators',
    label: 'Teleoperadoras',
    title: 'Teleoperadoras',
    description: 'Comparación de cumplimiento de cartera asignada y estructura base de análisis por responsable.',
  },
  {
    id: 'risk',
    label: 'Riesgo',
    title: 'Riesgo',
    description: 'Priorización de beneficiarios críticos, agrupaciones y focos de revisión operacional.',
  },
  {
    id: 'reports',
    label: 'Reportes',
    title: 'Reportes',
    description: 'Preparación de informes ejecutivos y estructura formal de salida para PDF.',
  },
]

export function AuditDashboardPage() {
  const [selectedRange, setSelectedRange] = useState<DateRangeOption>('last-month')
  const [activeTab, setActiveTab] = useState<AuditTab>('summary')

  const currentTab = auditTabs.find((tab) => tab.id === activeTab) ?? auditTabs[0]

  return (
    <div className="space-y-5">
      <Panel className="p-6 sm:p-7">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <Badge tone="info">Módulo base</Badge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
              Auditoría y reportes
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              Base navegable para auditoría operacional, seguimiento ejecutivo y preparación de reportes.
              Esta fase deja listos el layout, los filtros globales y la estructura por tabs sin cargar métricas reales aún.
            </p>
          </div>

          <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Rango de fechas
            </p>
            <div className="mt-4 grid gap-2">
              {rangeOptions.map((option) => {
                const isActive = selectedRange === option.value

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedRange(option.value)}
                    className={cn(
                      'flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition',
                      isActive
                        ? 'border-slate-950 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)]'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100',
                    )}
                  >
                    <span>{option.label}</span>
                    <span className={cn('text-xs uppercase tracking-[0.18em]', isActive ? 'text-slate-200' : 'text-slate-400')}>
                      Filtro
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="p-3 sm:p-4">
        <div className="flex flex-wrap gap-2">
          {auditTabs.map((tab) => {
            const isActive = tab.id === activeTab

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded-2xl px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-950',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </Panel>

      <Panel className="p-8">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Contenido</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {currentTab.title}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              {currentTab.description}
            </p>
          </div>
          <Badge tone="muted">{rangeOptions.find((option) => option.value === selectedRange)?.label}</Badge>
        </div>

        <div className="mt-6 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Placeholder
          </p>
          <h4 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
            Contenido en construcción
          </h4>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            Esta tab queda preparada para conectar métricas, tablas y reportes en las fases siguientes del módulo de auditoría.
          </p>
        </div>
      </Panel>
    </div>
  )
}