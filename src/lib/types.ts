export type UserRole = 'super_admin' | 'admin' | 'teleoperadora'

export type FollowupStatus = 'up_to_date' | 'pending' | 'urgent' | 'no_data'

export type FollowupEventType =
  | 'contact_beneficiary'
  | 'contact_support_network'
  | 'no_answer'
  | 'phone_off'
  | 'wrong_number'
  | 'requests_help'
  | 'support_referral'
  | 'internal_note'

export type Profile = {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export type MinimalBeneficiary = {
  id: string
  rutRaw: string | null
  fullName: string
  commune: string | null
  region: string | null
  status: 'active' | 'inactive' | 'deceased'
}

export type BeneficiaryContact = {
  id: string
  beneficiaryId: string
  contactType: string
  contactName: string | null
  relationship: string | null
  phoneRaw: string | null
  phoneNormalized: string | null
  isPrimary: boolean
  isActive: boolean
  countsAsValidFollowup: boolean
  notes: string | null
}

export type CallInteraction = {
  id: string
  callDate: string | null
  startedAt: string | null
  endedAt: string | null
  direction: string
  matchedStatus: string
  isValidContact: boolean
  countsAsValidFollowup: boolean
  phoneRaw: string | null
  phoneNormalized: string | null
  result: string | null
  observation: string | null
  notes: string | null
}

export type FollowupEvent = {
  id: string
  beneficiaryContactId: string | null
  eventType: FollowupEventType
  occurredAt: string
  isValidFollowup: boolean
  requiresSupport: boolean
  source: 'manual' | 'amaia_call' | 'system'
  notes: string | null
  createdBy: string
}