import { Panel } from '@/components/ui'

type TrendPoint = {
  label: string
  value: number | null
}

function formatRangeLabel(value: number, variant: 'percent' | 'count') {
  if (variant === 'percent') {
    return `${value.toFixed(2)}%`
  }

  return new Intl.NumberFormat('es-CL').format(Math.round(value))
}

function buildPolyline(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

export function ExecutiveTrendChart({
  eyebrow,
  title,
  description,
  points,
  color,
  valueVariant,
  latestValueLabel,
  summaryLabel,
}: {
  eyebrow: string
  title: string
  description: string
  points: TrendPoint[]
  color: string
  valueVariant: 'percent' | 'count'
  latestValueLabel: string
  summaryLabel: string
}) {
  const validPoints = points.filter((point) => point.value !== null)
  const hasHistory = validPoints.length > 0
  const enoughForTrend = validPoints.length >= 2

  const chartWidth = 320
  const chartHeight = 120
  const chartPaddingX = 10
  const chartPaddingY = 12

  const minValue = hasHistory ? Math.min(...validPoints.map((point) => point.value as number)) : 0
  const maxValue = hasHistory ? Math.max(...validPoints.map((point) => point.value as number)) : 0
  const valueSpan = maxValue - minValue

  const normalizedPoints = validPoints.map((point, index) => {
    const x = chartPaddingX + (
      validPoints.length === 1
        ? (chartWidth - chartPaddingX * 2) / 2
        : ((chartWidth - chartPaddingX * 2) / (validPoints.length - 1)) * index
    )

    const y = valueSpan === 0
      ? chartHeight / 2
      : chartHeight - chartPaddingY - (((point.value as number) - minValue) / valueSpan) * (chartHeight - chartPaddingY * 2)

    return {
      x,
      y,
      label: point.label,
      value: point.value as number,
    }
  })

  const latestPoint = normalizedPoints.at(-1) ?? null
  const baselinePoint = normalizedPoints[0] ?? null
  const polyline = enoughForTrend ? buildPolyline(normalizedPoints) : ''

  return (
    <Panel className="space-y-5 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h3>
        <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Lectura actual</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{latestValueLabel}</p>
            <p className="mt-2 text-sm text-slate-600">{summaryLabel}</p>
          </div>
          {hasHistory && baselinePoint && latestPoint && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Baseline</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{formatRangeLabel(baselinePoint.value, valueVariant)}</p>
                <p className="mt-1 text-xs text-slate-500">{baselinePoint.label}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Ultimo snapshot</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{formatRangeLabel(latestPoint.value, valueVariant)}</p>
                <p className="mt-1 text-xs text-slate-500">{latestPoint.label}</p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          {!hasHistory ? (
            <div className="flex h-full min-h-[160px] items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm leading-7 text-slate-600">
              No existen snapshots persistidos para esta serie en el periodo evaluado.
            </div>
          ) : !enoughForTrend ? (
            <div className="flex h-full min-h-[160px] items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm leading-7 text-slate-600">
              Existe un solo snapshot real para esta serie. El historico sigue siendo insuficiente para una tendencia comparativa.
            </div>
          ) : (
            <div className="space-y-3">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-[180px] w-full overflow-visible">
                <line x1={chartPaddingX} y1={chartHeight - chartPaddingY} x2={chartWidth - chartPaddingX} y2={chartHeight - chartPaddingY} stroke="#cbd5e1" strokeWidth="1" />
                <line x1={chartPaddingX} y1={chartPaddingY} x2={chartPaddingX} y2={chartHeight - chartPaddingY} stroke="#e2e8f0" strokeWidth="1" />
                <polyline
                  points={polyline}
                  fill="none"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {normalizedPoints.map((point) => (
                  <circle
                    key={`${point.label}-${point.value}`}
                    cx={point.x}
                    cy={point.y}
                    r="4.5"
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                ))}
              </svg>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>{normalizedPoints[0]?.label}</span>
                <span>
                  Rango {formatRangeLabel(minValue, valueVariant)} - {formatRangeLabel(maxValue, valueVariant)}
                </span>
                <span>{normalizedPoints.at(-1)?.label}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
