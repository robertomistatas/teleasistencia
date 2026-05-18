import { supabase } from '@/lib/supabase'
import type { FollowupStatus } from '@/lib/types'
import type {
  AddSupportAssignmentResult,
  AssignmentHistoryItem,
  AssignmentExecutiveSummary,
  AssignmentOverviewData,
  AssignmentPortfolioBeneficiary,
  AssignmentPortfolioSummary,
  AssignmentTeleoperatorOption,
  EndSupportAssignmentResult,
  ReassignBeneficiaryPrimaryAssignmentResult,
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
  reason?: string | null
  beneficiary: Record<string, unknown> | Record<string, unknown>[] | null
  assigned_user: Record<string, unknown> | Record<string, unknown>[] | null
}

type ReassignRpcRow = {
  beneficiary_id: string
  previous_assignment_id: string
  previous_assigned_user_id: string
  previous_assigned_user_name: string
  new_assignment_id: string
  new_assigned_user_id: string
  new_assigned_user_name: string
  effective_at: string
}

type AddSupportRpcRow = {
  assignment_id: string
  beneficiary_id: string
  support_user_id: string
  support_user_name: string
  primary_user_id: string
  primary_user_name: string
  starts_at: string
}

type EndSupportRpcRow = {
  assignment_id: string
  beneficiary_id: string
  support_user_id: string
  support_user_name: string
  ended_at: string
}

type AssignmentHistoryRpcRow = {
  assignment_id: string
  beneficiary_id: string
  assignment_type: string
  status: string
  assigned_user_id: string
  assigned_user_name: string
  assigned_user_email?: string | null
  starts_at: string
  ends_at?: string | null
  reason?: string | null
  ended_reason?: string | null
  created_by?: string | null
  created_by_name?: string | null
  ended_by?: string | null
  ended_by_name?: string | null
  created_at: string
  updated_at: string
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
  const totalActiveSupportAssignments = portfolios.reduce(
    (sum, item) => sum + item.totalSupportAssignments,
    0,
  )
  const primaryPortfolios = portfolios.filter((item) => item.totalPortfolio > 0)
  const totalCoverage = primaryPortfolios.reduce((sum, item) => sum + item.coveragePercentage, 0)
  const averageCoveragePercentage = primaryPortfolios.length > 0
    ? Math.round(totalCoverage / primaryPortfolios.length)
    : 0

  const portfolioWithMostUrgent = primaryPortfolios
    .slice()
    .sort((left, right) => {
      if (right.totalUrgent !== left.totalUrgent) {
        return right.totalUrgent - left.totalUrgent
      }

      return left.coveragePercentage - right.coveragePercentage
    })[0] ?? null

  const portfolioWithLowestCoverage = primaryPortfolios
    .slice()
    .sort((left, right) => {
      if (left.coveragePercentage !== right.coveragePercentage) {
        return left.coveragePercentage - right.coveragePercentage
      }

      return right.totalUrgent - left.totalUrgent
    })[0] ?? null

  return {
    totalActivePortfolios: primaryPortfolios.length,
    totalAssignedBeneficiaries,
    totalActiveSupportAssignments,
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
        reason,
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
    .in('assignment_type', ['primary', 'support'])
    .order('starts_at', { ascending: false })

  if (error) {
    throw error
  }

  const beneficiaries: AssignmentPortfolioBeneficiary[] = []
  const portfolios = new Map<string, AssignmentPortfolioSummary>()
  const activeRows = ((data as AssignmentRow[]) ?? [])
  const primaryRowsByBeneficiary = new Map<string, AssignmentRow>()
  const supportNamesByBeneficiary = new Map<string, string[]>()

  for (const row of activeRows) {
    const assignmentType = String(row.assignment_type)

    if (assignmentType === 'primary') {
      primaryRowsByBeneficiary.set(String(row.beneficiary_id), row)
      continue
    }

    if (assignmentType !== 'support') {
      continue
    }

    const assignedUserRaw = pickSingle(row.assigned_user)

    if (!assignedUserRaw) {
      continue
    }

    const beneficiaryId = String(row.beneficiary_id)
    const currentNames = supportNamesByBeneficiary.get(beneficiaryId) ?? []
    currentNames.push(
      getOperationalDisplayName({
        full_name: (assignedUserRaw.full_name as string | null) ?? null,
        email: (assignedUserRaw.email as string | null) ?? null,
      }),
    )
    supportNamesByBeneficiary.set(beneficiaryId, currentNames)
  }

  for (const row of activeRows) {
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
    const beneficiaryId = String(row.beneficiary_id)
    const assignmentType = String(row.assignment_type) as AssignmentPortfolioBeneficiary['assignmentType']
    const primaryRow = primaryRowsByBeneficiary.get(beneficiaryId) ?? row
    const primaryUserRaw = pickSingle(primaryRow.assigned_user)
    const primaryResponsibleId = String(primaryUserRaw?.id ?? assignedUserRaw.id)
    const primaryResponsibleName = getOperationalDisplayName({
      full_name: (primaryUserRaw?.full_name as string | null) ?? null,
      email: (primaryUserRaw?.email as string | null) ?? null,
    })
    const primaryResponsibleEmail = (primaryUserRaw?.email as string | null) ?? teleoperatorEmail
    const followupStatus = resolveFollowupStatus(
      beneficiaryRaw.beneficiary_followup_status as FollowupStatusRow | FollowupStatusRow[] | null,
    )
    const supportResponsibleNames = (supportNamesByBeneficiary.get(beneficiaryId) ?? []).filter(
      (name) => name !== teleoperatorName,
    )

    const beneficiaryItem = {
      assignmentId: String(row.id),
      beneficiaryId,
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
      reason: (row.reason as string | null) ?? null,
      assignmentType,
      teleoperatorId,
      teleoperatorName,
      teleoperatorEmail,
      isProfileActive,
      primaryResponsibleId,
      primaryResponsibleName,
      primaryResponsibleEmail,
      supportResponsibleNames,
      supportCount: supportResponsibleNames.length,
    } satisfies AssignmentPortfolioBeneficiary

    beneficiaries.push(beneficiaryItem)

    const currentPortfolio = portfolios.get(teleoperatorId) ?? {
      teleoperatorId,
      teleoperatorName,
      teleoperatorEmail,
      isProfileActive,
      totalPortfolio: 0,
      totalSupportAssignments: 0,
      totalUpToDate: 0,
      totalPending: 0,
      totalUrgent: 0,
      totalNoData: 0,
      coveragePercentage: 0,
    }

    if (assignmentType === 'support') {
      currentPortfolio.totalSupportAssignments += 1
      portfolios.set(teleoperatorId, currentPortfolio)
      continue
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

      if (right.totalSupportAssignments !== left.totalSupportAssignments) {
        return right.totalSupportAssignments - left.totalSupportAssignments
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

      if (left.assignmentType !== right.assignmentType) {
        return left.assignmentType === 'primary' ? -1 : 1
      }

      return left.beneficiaryName.localeCompare(right.beneficiaryName)
    }),
  }
}

export async function fetchActiveTeleoperatorOptions(
  excludeUserIds: string[] = [],
): Promise<AssignmentTeleoperatorOption[]> {
  const client = assertSupabase()
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'teleoperadora')
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    throw error
  }

  const excludedIdSet = new Set(excludeUserIds)

  return ((data as Array<Record<string, unknown>>) ?? [])
    .filter((row) => !excludedIdSet.has(String(row.id)))
    .map((row) => ({
    id: String(row.id),
    fullName: getOperationalDisplayName({
      full_name: (row.full_name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
    }),
    email: (row.email as string | null) ?? null,
  }))
}

export async function reassignBeneficiaryPrimaryAssignment({
  beneficiaryId,
  newAssignedUserId,
  reason,
}: {
  beneficiaryId: string
  newAssignedUserId: string
  reason: string
}): Promise<ReassignBeneficiaryPrimaryAssignmentResult> {
  const client = assertSupabase()
  const { data, error } = await client.rpc('reassign_beneficiary_primary_assignment', {
    p_beneficiary_id: beneficiaryId,
    p_new_assigned_user_id: newAssignedUserId,
    p_reason: reason,
  })

  if (error) {
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('No fue posible confirmar el cambio de responsable.')
  }

  const value = row as ReassignRpcRow

  return {
    beneficiaryId: value.beneficiary_id,
    previousAssignmentId: value.previous_assignment_id,
    previousAssignedUserId: value.previous_assigned_user_id,
    previousAssignedUserName: value.previous_assigned_user_name,
    newAssignmentId: value.new_assignment_id,
    newAssignedUserId: value.new_assigned_user_id,
    newAssignedUserName: value.new_assigned_user_name,
    effectiveAt: value.effective_at,
  }
}

export function getReassignResponsibleErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (!message) {
    return 'No fue posible cambiar la responsable en este momento. Intenta nuevamente.'
  }

  if (message.includes('Solo super_admin')) {
    return 'Solo una cuenta administrativa autorizada puede ejecutar este cambio.'
  }

  if (message.includes('Solo admin o super_admin')) {
    return 'Solo admin o super_admin pueden ejecutar esta acción.'
  }

  if (message.includes('La nueva responsable debe ser distinta')) {
    return 'Selecciona una responsable distinta a la actual.'
  }

  if (message.includes('debe tener rol teleoperadora')) {
    return 'La nueva responsable debe ser una teleoperadora activa.'
  }

  if (message.includes('debe estar activa')) {
    return 'La nueva responsable debe estar activa para recibir esta cartera.'
  }

  if (message.includes('motivo del cambio es obligatorio')) {
    return 'Debes ingresar un motivo para continuar.'
  }

  if (message.includes('no tiene una asignacion oficial vigente')) {
    return 'Este beneficiario ya no tiene una responsable oficial vigente visible.'
  }

  return message
}

export async function addSupportAssignment({
  beneficiaryId,
  supportUserId,
  reason,
}: {
  beneficiaryId: string
  supportUserId: string
  reason: string
}): Promise<AddSupportAssignmentResult> {
  const client = assertSupabase()
  const { data, error } = await client.rpc('add_support_assignment', {
    p_beneficiary_id: beneficiaryId,
    p_support_user_id: supportUserId,
    p_reason: reason,
  })

  if (error) {
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('No fue posible confirmar el apoyo temporal.')
  }

  const value = row as AddSupportRpcRow

  return {
    assignmentId: value.assignment_id,
    beneficiaryId: value.beneficiary_id,
    supportUserId: value.support_user_id,
    supportUserName: value.support_user_name,
    primaryUserId: value.primary_user_id,
    primaryUserName: value.primary_user_name,
    startsAt: value.starts_at,
  }
}

export async function endSupportAssignment({
  assignmentId,
  reason,
}: {
  assignmentId: string
  reason: string
}): Promise<EndSupportAssignmentResult> {
  const client = assertSupabase()
  const { data, error } = await client.rpc('end_support_assignment', {
    p_assignment_id: assignmentId,
    p_reason: reason,
  })

  if (error) {
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('No fue posible cerrar el apoyo temporal.')
  }

  const value = row as EndSupportRpcRow

  return {
    assignmentId: value.assignment_id,
    beneficiaryId: value.beneficiary_id,
    supportUserId: value.support_user_id,
    supportUserName: value.support_user_name,
    endedAt: value.ended_at,
  }
}

export async function fetchAssignmentHistory(
  beneficiaryId: string,
): Promise<AssignmentHistoryItem[]> {
  const client = assertSupabase()
  const { data, error } = await client.rpc('get_assignment_history', {
    p_beneficiary_id: beneficiaryId,
  })

  if (error) {
    throw error
  }

  return ((data as AssignmentHistoryRpcRow[]) ?? []).map((row) => ({
    assignmentId: row.assignment_id,
    beneficiaryId: row.beneficiary_id,
    assignmentType: row.assignment_type,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name,
    assignedUserEmail: row.assigned_user_email ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    reason: row.reason ?? null,
    endedReason: row.ended_reason ?? null,
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    endedBy: row.ended_by ?? null,
    endedByName: row.ended_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}