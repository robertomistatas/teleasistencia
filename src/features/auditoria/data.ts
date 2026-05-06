import { supabase } from '@/lib/supabase'
import type { FollowupStatus } from '@/lib/types'

export type AuditExecutiveMetrics = {
  totalActiveBeneficiaries: number
  totalUpToDate: number
  totalPending: number
  totalUrgent: number
  totalNoData: number
  upToDatePercentage: number
}

export type AuditTeleoperatorRankingItem = {
  teleoperatorId: string
  teleoperatorName: string
  teleoperatorEmail: string | null
  totalPortfolio: number
  totalUpToDate: number
  totalPending: number
  totalUrgent: number
  totalNoData: number
  coveragePercentage: number
}

export type AuditExecutiveRiskItem = {
  beneficiaryId: string
  beneficiaryName: string
  rut: string | null
  daysSinceLastValidFollowup: number | null
  teleoperatorName: string | null
  teleoperatorEmail: string | null
}

export type AuditExecutiveSummary = {
  metrics: AuditExecutiveMetrics
  ranking: AuditTeleoperatorRankingItem[]
  topUrgentBeneficiaries: AuditExecutiveRiskItem[]
}

type AuditActiveAssignmentRow = Record<string, unknown>

type FollowupStatusRow = {
  status?: FollowupStatus | null
  days_since_last_valid_followup?: number | null
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
  const statusRow = pickSingle(value)
  return statusRow?.status ?? 'no_data'
}

function resolveDaysSinceLastValidFollowup(
  value: FollowupStatusRow | FollowupStatusRow[] | null | undefined,
) {
  const statusRow = pickSingle(value)
  return statusRow?.days_since_last_valid_followup ?? null
}

function calculatePercentage(numerator: number, denominator: number) {
  if (denominator === 0) {
    return 0
  }

  return Math.round((numerator / denominator) * 1000) / 10
}

async function fetchActivePrimaryAssignments() {
  const client = assertSupabase()
  const { data, error } = await client
    .from('beneficiary_assignments')
    .select(
      `
        beneficiary_id,
        assigned_user_id,
        beneficiary:beneficiaries (
          id,
          status,
          beneficiary_followup_status (
            status,
            days_since_last_valid_followup
          )
        ),
        assigned_user:profiles!beneficiary_assignments_assigned_user_id_fkey (
          id,
          email,
          full_name
        )
      `,
    )
    .eq('status', 'active')
    .eq('assignment_type', 'primary')

  if (error) {
    throw error
  }

  return ((data as AuditActiveAssignmentRow[]) ?? []).filter((row) => {
    const beneficiary = pickSingle(
      row.beneficiary as Record<string, unknown> | Record<string, unknown>[] | null,
    )

    return (beneficiary?.status as string | null) === 'active'
  })
}

function buildTeleoperatorCoverageTable(rows: AuditActiveAssignmentRow[]) {
  const tableMap = new Map<string, AuditTeleoperatorRankingItem>()

  for (const row of rows) {
    const assignedUser = pickSingle(
      row.assigned_user as Record<string, unknown> | Record<string, unknown>[] | null,
    )
    const beneficiary = pickSingle(
      row.beneficiary as Record<string, unknown> | Record<string, unknown>[] | null,
    )

    if (!assignedUser || !beneficiary?.id) {
      continue
    }

    const teleoperatorId = String(assignedUser.id)
    const status = resolveFollowupStatus(
      beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
    )

    const current =
      tableMap.get(teleoperatorId) ??
      {
        teleoperatorId,
        teleoperatorName:
          (assignedUser.full_name as string | null)?.trim() ||
          (assignedUser.email as string | null) ||
          'Teleoperadora sin nombre',
        teleoperatorEmail: (assignedUser.email as string | null) ?? null,
        totalPortfolio: 0,
        totalUpToDate: 0,
        totalPending: 0,
        totalUrgent: 0,
        totalNoData: 0,
        coveragePercentage: 0,
      }

    current.totalPortfolio += 1

    if (status === 'up_to_date') {
      current.totalUpToDate += 1
    } else if (status === 'pending') {
      current.totalPending += 1
    } else if (status === 'urgent') {
      current.totalUrgent += 1
    } else {
      current.totalNoData += 1
    }

    tableMap.set(teleoperatorId, current)
  }

  return Array.from(tableMap.values())
    .map((item) => ({
      ...item,
      coveragePercentage: calculatePercentage(item.totalUpToDate, item.totalPortfolio),
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

      if (right.totalPortfolio !== left.totalPortfolio) {
        return right.totalPortfolio - left.totalPortfolio
      }

      return left.teleoperatorName.localeCompare(right.teleoperatorName)
    })
}

export async function fetchTeleoperatorTable() {
  const activeAssignments = await fetchActivePrimaryAssignments()
  return buildTeleoperatorCoverageTable(activeAssignments)
}

export async function fetchAuditExecutiveSummary() {
  const client = assertSupabase()

  const [beneficiariesResponse, assignmentsResponse] = await Promise.all([
    client
      .from('beneficiaries')
      .select(
        `
          id,
          rut_raw,
          rut_normalized,
          full_name,
          first_name,
          last_name,
          status,
          beneficiary_followup_status (
            status,
            days_since_last_valid_followup
          )
        `,
      )
      .eq('status', 'active'),
    fetchActivePrimaryAssignments(),
  ])

  if (beneficiariesResponse.error) {
    throw beneficiariesResponse.error
  }

  const activeBeneficiaries = ((beneficiariesResponse.data as Array<Record<string, unknown>>) ?? [])
  const activeAssignments = assignmentsResponse

  const metrics = activeBeneficiaries.reduce<AuditExecutiveMetrics>(
    (accumulator, beneficiary) => {
      const status = resolveFollowupStatus(
        beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
      )

      accumulator.totalActiveBeneficiaries += 1

      if (status === 'up_to_date') {
        accumulator.totalUpToDate += 1
      } else if (status === 'pending') {
        accumulator.totalPending += 1
      } else if (status === 'urgent') {
        accumulator.totalUrgent += 1
      } else {
        accumulator.totalNoData += 1
      }

      return accumulator
    },
    {
      totalActiveBeneficiaries: 0,
      totalUpToDate: 0,
      totalPending: 0,
      totalUrgent: 0,
      totalNoData: 0,
      upToDatePercentage: 0,
    },
  )

  metrics.upToDatePercentage = calculatePercentage(
    metrics.totalUpToDate,
    metrics.totalActiveBeneficiaries,
  )

  const assignmentMap = new Map<
    string,
    {
      teleoperatorName: string | null
      teleoperatorEmail: string | null
    }
  >()

  for (const row of activeAssignments) {
    const assignedUser = pickSingle(
      row.assigned_user as Record<string, unknown> | Record<string, unknown>[] | null,
    )

    if (!assignedUser) {
      continue
    }
    assignmentMap.set(String(row.beneficiary_id), {
      teleoperatorName:
        (assignedUser.full_name as string | null)?.trim() ||
        (assignedUser.email as string | null) ||
        'Teleoperadora sin nombre',
      teleoperatorEmail: (assignedUser.email as string | null) ?? null,
    })
  }

  const ranking = buildTeleoperatorCoverageTable(activeAssignments)

  const topUrgentBeneficiaries = activeBeneficiaries
    .filter((beneficiary) =>
      resolveFollowupStatus(
        beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
      ) === 'urgent',
    )
    .map((beneficiary) => {
      const assignment = assignmentMap.get(String(beneficiary.id))

      return {
        beneficiaryId: String(beneficiary.id),
        beneficiaryName: buildBeneficiaryName(beneficiary),
        rut:
          (beneficiary.rut_raw as string | null) ??
          (beneficiary.rut_normalized as string | null) ??
          null,
        daysSinceLastValidFollowup: resolveDaysSinceLastValidFollowup(
          beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
        ),
        teleoperatorName: assignment?.teleoperatorName ?? null,
        teleoperatorEmail: assignment?.teleoperatorEmail ?? null,
      } satisfies AuditExecutiveRiskItem
    })
    .sort((left, right) => {
      const leftDays = left.daysSinceLastValidFollowup ?? -1
      const rightDays = right.daysSinceLastValidFollowup ?? -1

      if (rightDays !== leftDays) {
        return rightDays - leftDays
      }

      return left.beneficiaryName.localeCompare(right.beneficiaryName)
    })
    .slice(0, 10)

  return {
    metrics,
    ranking,
    topUrgentBeneficiaries,
  } satisfies AuditExecutiveSummary
}