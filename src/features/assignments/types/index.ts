import type { FollowupStatus } from '@/lib/types'

export type AssignmentViewTab = 'global' | 'teleoperator'
export type AssignmentType = 'primary' | 'support'

export type AssignmentCoverageFilter = 'all' | 'high' | 'medium' | 'low'

export type AssignmentPortfolioHealth = 'healthy' | 'attention' | 'risk'

export type AssignmentLoadLevel = 'light' | 'balanced' | 'high'

export type AssignmentPortfolioBeneficiary = {
  assignmentId: string
  beneficiaryId: string
  beneficiaryName: string
  beneficiaryRut: string | null
  commune: string | null
  region: string | null
  beneficiaryStatus: 'active' | 'inactive' | 'deceased'
  followupStatus: FollowupStatus
  daysSinceLastValidFollowup: number | null
  lastValidFollowupAt: string | null
  startsAt: string
  reason: string | null
  assignmentType: AssignmentType
  teleoperatorId: string
  teleoperatorName: string
  teleoperatorEmail: string | null
  isProfileActive: boolean
  primaryResponsibleId: string
  primaryResponsibleName: string
  primaryResponsibleEmail: string | null
  supportResponsibleNames: string[]
  supportCount: number
}

export type AssignmentTeleoperatorOption = {
  id: string
  fullName: string
  email: string | null
}

export type AssignmentPortfolioSummary = {
  teleoperatorId: string
  teleoperatorName: string
  teleoperatorEmail: string | null
  isProfileActive: boolean
  totalPortfolio: number
  totalSupportAssignments: number
  totalUpToDate: number
  totalPending: number
  totalUrgent: number
  totalNoData: number
  coveragePercentage: number
}

export type AssignmentExecutiveSummary = {
  totalActivePortfolios: number
  totalAssignedBeneficiaries: number
  totalActiveSupportAssignments: number
  averageCoveragePercentage: number
  activeTeleoperators: number
  portfolioWithMostUrgent: AssignmentPortfolioSummary | null
  portfolioWithLowestCoverage: AssignmentPortfolioSummary | null
}

export type AssignmentOverviewData = {
  summary: AssignmentExecutiveSummary
  portfolios: AssignmentPortfolioSummary[]
  beneficiaries: AssignmentPortfolioBeneficiary[]
}

export type ReassignBeneficiaryPrimaryAssignmentResult = {
  beneficiaryId: string
  previousAssignmentId: string
  previousAssignedUserId: string
  previousAssignedUserName: string
  newAssignmentId: string
  newAssignedUserId: string
  newAssignedUserName: string
  effectiveAt: string
}

export type AddSupportAssignmentResult = {
  assignmentId: string
  beneficiaryId: string
  supportUserId: string
  supportUserName: string
  primaryUserId: string
  primaryUserName: string
  startsAt: string
}

export type EndSupportAssignmentResult = {
  assignmentId: string
  beneficiaryId: string
  supportUserId: string
  supportUserName: string
  endedAt: string
}

export type AssignmentHistoryItem = {
  assignmentId: string
  beneficiaryId: string
  assignmentType: string
  status: string
  assignedUserId: string
  assignedUserName: string
  assignedUserEmail: string | null
  startsAt: string
  endsAt: string | null
  reason: string | null
  endedReason: string | null
  createdBy: string | null
  createdByName: string | null
  endedBy: string | null
  endedByName: string | null
  createdAt: string
  updatedAt: string
}