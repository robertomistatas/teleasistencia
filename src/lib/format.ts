const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Sin dato'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return dateTimeFormatter.format(parsed)
}

export function formatRelativeFollowupDays(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin datos'
  }

  if (value === 0) {
    return 'Hoy'
  }

  if (value === 1) {
    return 'Hace 1 dia'
  }

  return `Hace ${value} dias`
}

export function formatTextFallback(value: string | null | undefined) {
  if (!value || value.trim().length === 0) {
    return 'Sin dato'
  }

  return value
}