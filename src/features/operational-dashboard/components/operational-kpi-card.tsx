import { Badge, Panel } from '@/components/ui'

export function OperationalKpiCard({
  eyebrow,
  label,
  value,
  helper,
  tone,
}: {
  eyebrow: string
  label: string
  value: string
  helper: string
  tone: 'healthy' | 'warning' | 'overdue' | 'urgent' | 'stale' | 'info'
}) {
  const toneMap = {
    healthy: {
      badge: 'success' as const,
      panelClass: 'border-emerald-200/80 bg-emerald-50/80',
      valueClass: 'text-emerald-950',
    },
    warning: {
      badge: 'warning' as const,
      panelClass: 'border-amber-200/80 bg-amber-50/85',
      valueClass: 'text-amber-950',
    },
    overdue: {
      badge: 'warning' as const,
      panelClass: 'border-orange-200/90 bg-orange-50/80',
      valueClass: 'text-orange-950',
    },
    urgent: {
      badge: 'danger' as const,
      panelClass: 'border-rose-200/90 bg-rose-50/85',
      valueClass: 'text-rose-950',
    },
    stale: {
      badge: 'muted' as const,
      panelClass: 'border-slate-200/90 bg-slate-100/90',
      valueClass: 'text-slate-950',
    },
    info: {
      badge: 'info' as const,
      panelClass: 'border-sky-200/80 bg-sky-50/80',
      valueClass: 'text-sky-950',
    },
  }[tone]

  return (
    <Panel className={`p-5 ${toneMap.panelClass}`}>
      <Badge tone={toneMap.badge}>{eyebrow}</Badge>
      <p className="mt-4 text-sm uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${toneMap.valueClass}`}>{value}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{helper}</p>
    </Panel>
  )
}
