type StatusCardProps = {
  label: string
  value: string
  tone?: 'neutral' | 'success'
}

const toneClasses: Record<NonNullable<StatusCardProps['tone']>, string> = {
  neutral: 'border-slate-200 bg-white text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

export function StatusCard({
  label,
  value,
  tone = 'neutral',
}: StatusCardProps) {
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </article>
  )
}