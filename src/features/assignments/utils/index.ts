import type {
  AssignmentCoverageFilter,
  AssignmentLoadLevel,
  AssignmentPortfolioHealth,
  AssignmentPortfolioSummary,
} from '@/features/assignments/types'

export function getOperationalDisplayName(raw: {
  full_name?: string | null
  email?: string | null
}) {
  const fullName = raw.full_name?.trim()

  if (fullName) {
    return fullName
  }

  return raw.email?.trim() || 'Responsable sin nombre visible'
}

export function formatPercentage(value: number) {
  return `${value}%`
}

export function calculatePercentage(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0
  }

  return Math.round((numerator / denominator) * 100)
}

export function getCoverageFilterLabel(filter: AssignmentCoverageFilter) {
  if (filter === 'high') {
    return 'Cobertura alta'
  }

  if (filter === 'medium') {
    return 'Cobertura media'
  }

  if (filter === 'low') {
    return 'Cobertura baja'
  }

  return 'Todas las coberturas'
}

export function matchesCoverageFilter(
  coveragePercentage: number,
  filter: AssignmentCoverageFilter,
) {
  if (filter === 'all') {
    return true
  }

  if (filter === 'high') {
    return coveragePercentage >= 75
  }

  if (filter === 'medium') {
    return coveragePercentage >= 50 && coveragePercentage < 75
  }

  return coveragePercentage < 50
}

export function getPortfolioHealth(summary: AssignmentPortfolioSummary): AssignmentPortfolioHealth {
  if (summary.coveragePercentage < 50 || summary.totalUrgent >= 6 || summary.totalNoData >= 5) {
    return 'risk'
  }

  if (summary.coveragePercentage < 75 || summary.totalUrgent >= 3 || summary.totalNoData >= 2) {
    return 'attention'
  }

  return 'healthy'
}

export function getPortfolioHealthMeta(health: AssignmentPortfolioHealth) {
  if (health === 'healthy') {
    return {
      label: 'Cartera saludable',
      tone: 'success' as const,
      panelClass: 'border-emerald-200 bg-emerald-50',
      textClass: 'text-emerald-800',
    }
  }

  if (health === 'attention') {
    return {
      label: 'Cobertura en revisión',
      tone: 'warning' as const,
      panelClass: 'border-amber-200 bg-amber-50',
      textClass: 'text-amber-800',
    }
  }

  return {
    label: 'Cartera en riesgo',
    tone: 'danger' as const,
    panelClass: 'border-rose-200 bg-rose-50',
    textClass: 'text-rose-800',
  }
}

export function getLoadLevel(
  totalPortfolio: number,
  averagePortfolioSize: number,
): AssignmentLoadLevel {
  if (averagePortfolioSize <= 0) {
    return 'balanced'
  }

  if (totalPortfolio >= Math.ceil(averagePortfolioSize * 1.2)) {
    return 'high'
  }

  if (totalPortfolio <= Math.floor(averagePortfolioSize * 0.75)) {
    return 'light'
  }

  return 'balanced'
}

export function getLoadLevelMeta(level: AssignmentLoadLevel) {
  if (level === 'high') {
    return {
      label: 'Alta carga',
      tone: 'warning' as const,
    }
  }

  if (level === 'light') {
    return {
      label: 'Carga acotada',
      tone: 'muted' as const,
    }
  }

  return {
    label: 'Carga equilibrada',
    tone: 'info' as const,
  }
}