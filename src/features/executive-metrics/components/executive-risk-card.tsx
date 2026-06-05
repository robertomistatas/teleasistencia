import { Badge, Panel } from '@/components/ui'

import type { ExecutiveRiskState } from '@/features/executive-metrics/data'

function getRiskToneMap(state: ExecutiveRiskState) {
  switch (state) {
    case 'healthy':
      return {
        badge: 'success' as const,
        panelClass: 'border-emerald-200/80 bg-emerald-50/70',
        valueClass: 'text-emerald-950',
      }
    case 'watch':
      return {
        badge: 'warning' as const,
        panelClass: 'border-amber-200/80 bg-amber-50/75',
        valueClass: 'text-amber-950',
      }
    case 'risk':
      return {
        badge: 'warning' as const,
        panelClass: 'border-orange-200/85 bg-orange-50/80',
        valueClass: 'text-orange-950',
      }
    case 'critical':
      return {
        badge: 'danger' as const,
        panelClass: 'border-rose-200/85 bg-rose-50/80',
        valueClass: 'text-rose-950',
      }
    default:
      return {
        badge: 'muted' as const,
        panelClass: 'border-slate-200/80 bg-slate-50/70',
        valueClass: 'text-slate-950',
      }
  }
}

export function ExecutiveRiskCard({
  eyebrow,
  title,
  value,
  helper,
  state,
}: {
  eyebrow: string
  title: string
  value: string
  helper: string
  state: ExecutiveRiskState
}) {
  const tone = getRiskToneMap(state)

  return (
    <Panel className={`p-5 ${tone.panelClass}`}>
      <Badge tone={tone.badge}>{eyebrow}</Badge>
      <p className="mt-4 text-sm uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${tone.valueClass}`}>{value}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{helper}</p>
    </Panel>
  )
}
