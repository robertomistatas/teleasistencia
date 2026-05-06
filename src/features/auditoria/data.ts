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

export type AuditRiskMetrics = {
  totalUrgent: number
  totalNoData: number
  totalMoreThan30DaysWithoutContact: number
  totalMoreThan45DaysWithoutContact: number
  totalWithoutActiveAssignment: number
}

export type AuditRiskBeneficiaryItem = {
  beneficiaryId: string
  beneficiaryName: string
  rut: string | null
  commune: string
  followupStatus: FollowupStatus
  daysSinceLastValidFollowup: number | null
  lastValidFollowupAt: string | null
  teleoperatorName: string | null
  teleoperatorEmail: string | null
  riskReason: string
  riskTags: string[]
  hasActiveAssignment: boolean
}

export type AuditRiskTeleoperatorSummaryItem = {
  teleoperatorKey: string
  teleoperatorName: string
  teleoperatorEmail: string | null
  totalUrgent: number
  totalNoData: number
  totalMoreThan30DaysWithoutContact: number
  totalNoContactOrNoData: number
  totalRisk: number
}

export type AuditRiskCommuneSummaryItem = {
  commune: string
  totalUrgent: number
  totalNoData: number
  totalMoreThan30DaysWithoutContact: number
  totalRisk: number
}

export type AuditRiskDashboard = {
  metrics: AuditRiskMetrics
  criticalBeneficiaries: AuditRiskBeneficiaryItem[]
  byTeleoperator: AuditRiskTeleoperatorSummaryItem[]
  byCommune: AuditRiskCommuneSummaryItem[]
}

type AuditActiveAssignmentRow = Record<string, unknown>

type AuditBeneficiaryAssignment = {
  teleoperatorId: string
  teleoperatorName: string
  teleoperatorEmail: string | null
}

type FollowupStatusRow = {
  status?: FollowupStatus | null
  last_valid_followup_at?: string | null
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

function resolveLastValidFollowupAt(
  value: FollowupStatusRow | FollowupStatusRow[] | null | undefined,
) {
  const statusRow = pickSingle(value)
  return statusRow?.last_valid_followup_at ?? null
}

function calculatePercentage(numerator: number, denominator: number) {
  if (denominator === 0) {
    return 0
  }

  return Math.round((numerator / denominator) * 1000) / 10
}

function buildTeleoperatorLabel(raw: Record<string, unknown>) {
  return (
    (raw.full_name as string | null)?.trim() ||
    (raw.email as string | null) ||
    'Teleoperadora sin nombre'
  )
}

function buildAssignmentMap(rows: AuditActiveAssignmentRow[]) {
  const assignmentMap = new Map<string, AuditBeneficiaryAssignment>()

  for (const row of rows) {
    const assignedUser = pickSingle(
      row.assigned_user as Record<string, unknown> | Record<string, unknown>[] | null,
    )

    if (!assignedUser) {
      continue
    }

    assignmentMap.set(String(row.beneficiary_id), {
      teleoperatorId: String(assignedUser.id),
      teleoperatorName: buildTeleoperatorLabel(assignedUser),
      teleoperatorEmail: (assignedUser.email as string | null) ?? null,
    })
  }

  return assignmentMap
}

function hasAnyRisk(flags: {
  noActiveAssignment: boolean
  urgent: boolean
  moreThan45DaysWithoutContact: boolean
  moreThan30DaysWithoutContact: boolean
  noData: boolean
}) {
  return (
    flags.noActiveAssignment ||
    flags.urgent ||
    flags.moreThan45DaysWithoutContact ||
    flags.moreThan30DaysWithoutContact ||
    flags.noData
  )
}

function buildRiskTags(flags: {
  noActiveAssignment: boolean
  urgent: boolean
  moreThan45DaysWithoutContact: boolean
  moreThan30DaysWithoutContact: boolean
  noData: boolean
}) {
  const tags: string[] = []

  if (flags.noActiveAssignment) {
    tags.push('Sin asignación activa')
  }

  if (flags.urgent) {
    tags.push('Beneficiario urgente')
  }

  if (flags.moreThan45DaysWithoutContact) {
    tags.push('Más de 45 días sin contacto')
  }

  if (flags.moreThan30DaysWithoutContact) {
    tags.push('Más de 30 días sin contacto')
  }

  if (flags.noData) {
    tags.push('Sin datos de seguimiento')
  }

  return tags
}

function compareRiskBeneficiaries(left: AuditRiskBeneficiaryItem, right: AuditRiskBeneficiaryItem) {
  const leftNoAssignment = Number(!left.hasActiveAssignment)
  const rightNoAssignment = Number(!right.hasActiveAssignment)

  if (rightNoAssignment !== leftNoAssignment) {
    return rightNoAssignment - leftNoAssignment
  }

  const leftUrgent = Number(left.followupStatus === 'urgent')
  const rightUrgent = Number(right.followupStatus === 'urgent')

  if (rightUrgent !== leftUrgent) {
    return rightUrgent - leftUrgent
  }

  const leftMoreThan45 = Number((left.daysSinceLastValidFollowup ?? -1) > 45)
  const rightMoreThan45 = Number((right.daysSinceLastValidFollowup ?? -1) > 45)

  if (rightMoreThan45 !== leftMoreThan45) {
    return rightMoreThan45 - leftMoreThan45
  }

  const leftMoreThan30 = Number((left.daysSinceLastValidFollowup ?? -1) > 30)
  const rightMoreThan30 = Number((right.daysSinceLastValidFollowup ?? -1) > 30)

  if (rightMoreThan30 !== leftMoreThan30) {
    return rightMoreThan30 - leftMoreThan30
  }

  const leftNoData = Number(left.followupStatus === 'no_data')
  const rightNoData = Number(right.followupStatus === 'no_data')

  if (rightNoData !== leftNoData) {
    return rightNoData - leftNoData
  }

  const leftDays = left.daysSinceLastValidFollowup ?? -1
  const rightDays = right.daysSinceLastValidFollowup ?? -1

  if (rightDays !== leftDays) {
    return rightDays - leftDays
  }

  return left.beneficiaryName.localeCompare(right.beneficiaryName)
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
        teleoperatorName: buildTeleoperatorLabel(assignedUser),
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

export async function fetchRiskDashboard() {
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
          commune,
          status,
          beneficiary_followup_status (
            status,
            last_valid_followup_at,
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
  const assignmentMap = buildAssignmentMap(assignmentsResponse)

  const metrics: AuditRiskMetrics = {
    totalUrgent: 0,
    totalNoData: 0,
    totalMoreThan30DaysWithoutContact: 0,
    totalMoreThan45DaysWithoutContact: 0,
    totalWithoutActiveAssignment: 0,
  }

  const criticalBeneficiaries: AuditRiskBeneficiaryItem[] = []

  for (const beneficiary of activeBeneficiaries) {
    const followupStatus = resolveFollowupStatus(
      beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
    )
    const daysSinceLastValidFollowup = resolveDaysSinceLastValidFollowup(
      beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
    )
    const lastValidFollowupAt = resolveLastValidFollowupAt(
      beneficiary.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
    )
    const assignment = assignmentMap.get(String(beneficiary.id))

    const flags = {
      noActiveAssignment: !assignment,
      urgent: followupStatus === 'urgent',
      moreThan45DaysWithoutContact: (daysSinceLastValidFollowup ?? -1) > 45,
      moreThan30DaysWithoutContact: (daysSinceLastValidFollowup ?? -1) > 30,
      noData: followupStatus === 'no_data',
    }

    if (flags.urgent) {
      metrics.totalUrgent += 1
    }

    if (flags.noData) {
      metrics.totalNoData += 1
    }

    if (flags.moreThan30DaysWithoutContact) {
      metrics.totalMoreThan30DaysWithoutContact += 1
    }

    if (flags.moreThan45DaysWithoutContact) {
      metrics.totalMoreThan45DaysWithoutContact += 1
    }

    if (flags.noActiveAssignment) {
      metrics.totalWithoutActiveAssignment += 1
    }

    if (!hasAnyRisk(flags)) {
      continue
    }

    const riskTags = buildRiskTags(flags)

    criticalBeneficiaries.push({
      beneficiaryId: String(beneficiary.id),
      beneficiaryName: buildBeneficiaryName(beneficiary),
      rut:
        (beneficiary.rut_raw as string | null) ??
        (beneficiary.rut_normalized as string | null) ??
        null,
      commune: (beneficiary.commune as string | null)?.trim() || 'Sin comuna',
      followupStatus,
      daysSinceLastValidFollowup,
      lastValidFollowupAt,
      teleoperatorName: assignment?.teleoperatorName ?? null,
      teleoperatorEmail: assignment?.teleoperatorEmail ?? null,
      riskReason: riskTags[0] ?? 'Requiere revisión',
      riskTags,
      hasActiveAssignment: Boolean(assignment),
    })
  }

  criticalBeneficiaries.sort(compareRiskBeneficiaries)

  const teleoperatorSummaryMap = new Map<string, AuditRiskTeleoperatorSummaryItem>()
  const communeSummaryMap = new Map<string, AuditRiskCommuneSummaryItem>()

  for (const item of criticalBeneficiaries) {
    const teleoperatorKey = item.hasActiveAssignment
      ? item.teleoperatorName ?? item.teleoperatorEmail ?? 'teleoperator-without-name'
      : 'unassigned'
    const teleoperatorName = item.hasActiveAssignment
      ? item.teleoperatorName ?? item.teleoperatorEmail ?? 'Teleoperadora sin nombre'
      : 'Sin asignación activa'
    const currentTeleoperator =
      teleoperatorSummaryMap.get(teleoperatorKey) ??
      {
        teleoperatorKey,
        teleoperatorName,
        teleoperatorEmail: item.hasActiveAssignment ? item.teleoperatorEmail : null,
        totalUrgent: 0,
        totalNoData: 0,
        totalMoreThan30DaysWithoutContact: 0,
        totalNoContactOrNoData: 0,
        totalRisk: 0,
      }

    currentTeleoperator.totalRisk += 1

    if (item.followupStatus === 'urgent') {
      currentTeleoperator.totalUrgent += 1
    }

    if (item.followupStatus === 'no_data') {
      currentTeleoperator.totalNoData += 1
    }

    if ((item.daysSinceLastValidFollowup ?? -1) > 30) {
      currentTeleoperator.totalMoreThan30DaysWithoutContact += 1
      currentTeleoperator.totalNoContactOrNoData += 1
    } else if (item.followupStatus === 'no_data') {
      currentTeleoperator.totalNoContactOrNoData += 1
    }

    teleoperatorSummaryMap.set(teleoperatorKey, currentTeleoperator)

    const communeKey = item.commune
    const currentCommune =
      communeSummaryMap.get(communeKey) ??
      {
        commune: communeKey,
        totalUrgent: 0,
        totalNoData: 0,
        totalMoreThan30DaysWithoutContact: 0,
        totalRisk: 0,
      }

    currentCommune.totalRisk += 1

    if (item.followupStatus === 'urgent') {
      currentCommune.totalUrgent += 1
    }

    if (item.followupStatus === 'no_data') {
      currentCommune.totalNoData += 1
    }

    if ((item.daysSinceLastValidFollowup ?? -1) > 30) {
      currentCommune.totalMoreThan30DaysWithoutContact += 1
    }

    communeSummaryMap.set(communeKey, currentCommune)
  }

  const byTeleoperator = Array.from(teleoperatorSummaryMap.values()).sort((left, right) => {
    if (right.totalRisk !== left.totalRisk) {
      return right.totalRisk - left.totalRisk
    }

    if (right.totalUrgent !== left.totalUrgent) {
      return right.totalUrgent - left.totalUrgent
    }

    return left.teleoperatorName.localeCompare(right.teleoperatorName)
  })

  const byCommune = Array.from(communeSummaryMap.values()).sort((left, right) => {
    if (right.totalRisk !== left.totalRisk) {
      return right.totalRisk - left.totalRisk
    }

    if (right.totalUrgent !== left.totalUrgent) {
      return right.totalUrgent - left.totalUrgent
    }

    return left.commune.localeCompare(right.commune)
  })

  return {
    metrics,
    criticalBeneficiaries,
    byTeleoperator,
    byCommune,
  } satisfies AuditRiskDashboard
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

  const assignmentMap = buildAssignmentMap(activeAssignments)

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