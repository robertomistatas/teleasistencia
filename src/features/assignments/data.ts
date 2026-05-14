import { supabase } from '@/lib/supabase'
import type { FollowupStatus } from '@/lib/types'
import type {
  AssignmentExecutiveSummary,
  AssignmentOverviewData,
  AssignmentPortfolioBeneficiary,
  AssignmentPortfolioSummary,
} from '@/features/assignments/types'
import {
  calculatePercentage,
  getOperationalDisplayName,
} from '@/features/assignments/utils'

type FollowupStatusRow = {
  status?: FollowupStatus | null
  last_valid_followup_at?: string | null
  days_since_last_valid_followup?: number | null
}

type AssignmentRow = {
  id: string
  beneficiary_id: string
  starts_at: string
  assignment_type: string
  beneficiary: Record<string, unknown> | Record<string, unknown>[] | null
  assigned_user: Record<string, unknown> | Record<string, unknown>[] | null
}

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase no esta configurado.')
  }

  return supabase
}

function pickSingle<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

function buildBeneficiaryName(raw: {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
}) {
  const fullName = raw.full_name?.trim()

  if (fullName) {
    return fullName
  }

  return [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim() || 'Beneficiario sin nombre'
}

function resolveFollowupStatus(
  value: FollowupStatusRow | FollowupStatusRow[] | null | undefined,
): FollowupStatus {
  const row = pickSingle(value)
  return row?.status ?? 'no_data'
}

function resolveDaysSinceLastValidFollowup(
  value: FollowupStatusRow | FollowupStatusRow[] | null | undefined,
) {
  const row = pickSingle(value)
  return row?.days_since_last_valid_followup ?? null
}

function resolveLastValidFollowupAt(
  value: FollowupStatusRow | FollowupStatusRow[] | null | undefined,
) {
  const row = pickSingle(value)
  return row?.last_valid_followup_at ?? null
}

function buildExecutiveSummary(portfolios: AssignmentPortfolioSummary[]): AssignmentExecutiveSummary {
  const totalAssignedBeneficiaries = portfolios.reduce((sum, item) => sum + item.totalPortfolio, 0)
  const totalCoverage = portfolios.reduce((sum, item) => sum + item.coveragePercentage, 0)
  const averageCoveragePercentage = portfolios.length > 0
    ? Math.round(totalCoverage / portfolios.length)
    : 0

  const portfolioWithMostUrgent = portfolios
    .slice()
    .sort((left, right) => {
      if (right.totalUrgent !== left.totalUrgent) {
        return right.totalUrgent - left.totalUrgent
      }

      return left.coveragePercentage - right.coveragePercentage
    })[0] ?? null

  const portfolioWithLowestCoverage = portfolios
    .slice()
    .sort((left, right) => {
      if (left.coveragePercentage !== right.coveragePercentage) {
        return left.coveragePercentage - right.coveragePercentage
      }

      return right.totalUrgent - left.totalUrgent
    })[0] ?? null

  return {
    totalActivePortfolios: portfolios.length,
    totalAssignedBeneficiaries,
    averageCoveragePercentage,
    activeTeleoperators: portfolios.filter((item) => item.isProfileActive).length,
    portfolioWithMostUrgent,
    portfolioWithLowestCoverage,
  }
}

export async function fetchAssignmentsOverview(): Promise<AssignmentOverviewData> {
  const client = assertSupabase()
  const { data, error } = await client
    .from('beneficiary_assignments')
    .select(
      `
        id,
        beneficiary_id,
        starts_at,
        assignment_type,
        beneficiary:beneficiaries (
          id,
          rut_raw,
          full_name,
          first_name,
          last_name,
          commune,
          region,
          status,
          beneficiary_followup_status (
            status,
            last_valid_followup_at,
            days_since_last_valid_followup
          )
        ),
        assigned_user:profiles!beneficiary_assignments_assigned_user_id_fkey (
          id,
          email,
          full_name,
          is_active
        )
      `,
    )
    .eq('status', 'active')
    .eq('assignment_type', 'primary')
    .order('starts_at', { ascending: false })

  if (error) {
    throw error
  }

  const beneficiaries: AssignmentPortfolioBeneficiary[] = []
  const portfolios = new Map<string, AssignmentPortfolioSummary>()

  for (const row of ((data as AssignmentRow[]) ?? [])) {
    const beneficiaryRaw = pickSingle(row.beneficiary)
    const assignedUserRaw = pickSingle(row.assigned_user)

    if (!beneficiaryRaw || !assignedUserRaw) {
      continue
    }

    const beneficiaryStatus =
      ((beneficiaryRaw.status as string | null) ?? 'active') as AssignmentPortfolioBeneficiary['beneficiaryStatus']

    if (beneficiaryStatus !== 'active') {
      continue
    }

    const teleoperatorId = String(assignedUserRaw.id)
    const teleoperatorName = getOperationalDisplayName({
      full_name: (assignedUserRaw.full_name as string | null) ?? null,
      email: (assignedUserRaw.email as string | null) ?? null,
    })
    const teleoperatorEmail = (assignedUserRaw.email as string | null) ?? null
    const isProfileActive = Boolean(assignedUserRaw.is_active)
    const followupStatus = resolveFollowupStatus(
      beneficiaryRaw.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
    )

    const beneficiaryItem = {
      assignmentId: String(row.id),
      beneficiaryId: String(row.beneficiary_id),
      beneficiaryName: buildBeneficiaryName({
        full_name: (beneficiaryRaw.full_name as string | null) ?? null,
        first_name: (beneficiaryRaw.first_name as string | null) ?? null,
        last_name: (beneficiaryRaw.last_name as string | null) ?? null,
      }),
      beneficiaryRut: (beneficiaryRaw.rut_raw as string | null) ?? null,
      commune: (beneficiaryRaw.commune as string | null) ?? null,
      region: (beneficiaryRaw.region as string | null) ?? null,
      beneficiaryStatus,
      followupStatus,
      daysSinceLastValidFollowup: resolveDaysSinceLastValidFollowup(
        beneficiaryRaw.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
      ),
      lastValidFollowupAt: resolveLastValidFollowupAt(
        beneficiaryRaw.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
      ),
      startsAt: String(row.starts_at),
      assignmentType: 'primary',
      teleoperatorId,
      teleoperatorName,
      teleoperatorEmail,
      isProfileActive,
    } satisfies AssignmentPortfolioBeneficiary

    beneficiaries.push(beneficiaryItem)

    const currentPortfolio = portfolios.get(teleoperatorId) ?? {
      teleoperatorId,
      teleoperatorName,
      teleoperatorEmail,
      isProfileActive,
      totalPortfolio: 0,
      totalUpToDate: 0,
      totalPending: 0,
      totalUrgent: 0,
      totalNoData: 0,
      coveragePercentage: 0,
    }

    currentPortfolio.totalPortfolio += 1

    if (followupStatus === 'up_to_date') {
      currentPortfolio.totalUpToDate += 1
    } else if (followupStatus === 'pending') {
      currentPortfolio.totalPending += 1
    } else if (followupStatus === 'urgent') {
      currentPortfolio.totalUrgent += 1
    } else {
      currentPortfolio.totalNoData += 1
    }

    portfolios.set(teleoperatorId, currentPortfolio)
  }

  const portfolioItems = Array.from(portfolios.values())
    .map((portfolio) => ({
      ...portfolio,
      coveragePercentage: calculatePercentage(portfolio.totalUpToDate, portfolio.totalPortfolio),
    }))
    .sort((left, right) => {
      if (right.totalUrgent !== left.totalUrgent) {
        return right.totalUrgent - left.totalUrgent
      }

      if (right.totalNoData !== left.totalNoData) {
        return right.totalNoData - left.totalNoData
      }

      if (left.coveragePercentage !== right.coveragePercentage) {
        return left.coveragePercentage - right.coveragePercentage
      }

      return left.teleoperatorName.localeCompare(right.teleoperatorName)
    })

  return {
    summary: buildExecutiveSummary(portfolioItems),
    portfolios: portfolioItems,
    beneficiaries: beneficiaries.sort((left, right) => {
      if (left.teleoperatorName !== right.teleoperatorName) {
        return left.teleoperatorName.localeCompare(right.teleoperatorName)
      }

      return left.beneficiaryName.localeCompare(right.beneficiaryName)
    }),
  }
}