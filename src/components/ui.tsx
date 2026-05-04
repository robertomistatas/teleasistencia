import type { PropsWithChildren, ReactNode } from 'react'

import { cn } from '@/lib/cn'

type PanelProps = PropsWithChildren<{
  className?: string
}>

type BadgeTone = 'danger' | 'warning' | 'success' | 'muted' | 'info'

const badgeToneClasses: Record<BadgeTone, string> = {
  danger: 'border-rose-200/70 bg-rose-50 text-rose-700',
  warning: 'border-amber-200/70 bg-amber-50 text-amber-800',
  success: 'border-emerald-200/70 bg-emerald-50 text-emerald-700',
  muted: 'border-slate-200/80 bg-slate-100 text-slate-600',
  info: 'border-sky-200/70 bg-sky-50 text-sky-700',
}

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white no-underline shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-white disabled:opacity-100'

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 no-underline shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100'

export const darkSidebarButtonClass =
  'inline-flex items-center justify-center rounded-[22px] border border-white/10 bg-white/0 px-4 py-3 text-sm font-semibold text-slate-100 no-underline transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400 disabled:opacity-100'

export function Panel({ children, className }: PanelProps) {
  return (
    <section
      className={cn(
        'rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function Badge({
  tone,
  children,
  className,
}: PropsWithChildren<{ tone: BadgeTone; className?: string }>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]',
        badgeToneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function PageState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Panel className="flex min-h-[260px] flex-col items-start justify-center gap-4 p-8">
      <Badge tone="info">Seguimientos Mistatas</Badge>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">{description}</p>
      </div>
      {action}
    </Panel>
  )
}