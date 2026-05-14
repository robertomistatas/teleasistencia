import { Badge, Panel } from '@/components/ui'

export function AssignmentKpiCard({
  eyebrow,
  title,
  value,
  helper,
  tone = 'info',
}: {
  eyebrow: string
  title: string
  value: string
  helper: string
  tone?: 'success' | 'warning' | 'danger' | 'muted' | 'info'
}) {
  return (
    <Panel className="p-5">
      <Badge tone={tone}>{eyebrow}</Badge>
      <p className="mt-4 text-sm uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{helper}</p>
    </Panel>
  )
}