import type { FollowupStatus } from '@/lib/types'

export type AssignmentViewTab = 'global' | 'teleoperator'

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
  assignmentType: 'primary'
  teleoperatorId: string
  teleoperatorName: string
  teleoperatorEmail: string | null
  isProfileActive: boolean
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
  totalUpToDate: number
  totalPending: number
  totalUrgent: number
  totalNoData: number
  coveragePercentage: number
}

export type AssignmentExecutiveSummary = {
  totalActivePortfolios: number
  totalAssignedBeneficiaries: number
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