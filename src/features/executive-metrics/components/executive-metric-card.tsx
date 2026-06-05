import { Badge, Panel } from '@/components/ui'

export function ExecutiveMetricCard({
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
  tone: 'healthy' | 'warning' | 'risk' | 'critical' | 'stable' | 'historical'
}) {
  const toneMap = {
    healthy: {
      badge: 'success' as const,
      panelClass: 'border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.95)_0%,rgba(255,255,255,0.96)_100%)]',
      valueClass: 'text-emerald-950',
    },
    warning: {
      badge: 'warning' as const,
      panelClass: 'border-amber-200/85 bg-[linear-gradient(180deg,rgba(255,251,235,0.96)_0%,rgba(255,255,255,0.97)_100%)]',
      valueClass: 'text-amber-950',
    },
    risk: {
      badge: 'warning' as const,
      panelClass: 'border-orange-200/85 bg-[linear-gradient(180deg,rgba(255,247,237,0.96)_0%,rgba(255,255,255,0.97)_100%)]',
      valueClass: 'text-orange-950',
    },
    critical: {
      badge: 'danger' as const,
      panelClass: 'border-rose-200/85 bg-[linear-gradient(180deg,rgba(255,241,242,0.96)_0%,rgba(255,255,255,0.97)_100%)]',
      valueClass: 'text-rose-950',
    },
    stable: {
      badge: 'muted' as const,
      panelClass: 'border-slate-200/85 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.97)_100%)]',
      valueClass: 'text-slate-950',
    },
    historical: {
      badge: 'info' as const,
      panelClass: 'border-sky-200/85 bg-[linear-gradient(180deg,rgba(240,249,255,0.96)_0%,rgba(255,255,255,0.97)_100%)]',
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
