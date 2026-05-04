import { supabase } from '@/lib/supabase'
import type {
  BeneficiaryContact,
  CallInteraction,
  FollowupEvent,
  FollowupEventType,
  FollowupStatus,
  MinimalBeneficiary,
} from '@/lib/types'

export type PortfolioItem = {
  assignmentId: string
  beneficiaryId: string
  beneficiary: MinimalBeneficiary
  followupStatus: FollowupStatus
  lastValidFollowupAt: string | null
  daysSinceLastValidFollowup: number | null
  startsAt: string
}

export type TeleoperatorBeneficiaryDetail = {
  assignmentId: string
  beneficiary: MinimalBeneficiary & {
    birthDate: string | null
    address: string | null
    notes: string | null
  }
  assignment: {
    assignmentType: string
    startsAt: string
    notes: string | null
  }
  status: {
    status: FollowupStatus
    lastValidFollowupAt: string | null
    daysSinceLastValidFollowup: number | null
  }
  contacts: BeneficiaryContact[]
  calls: CallInteraction[]
  followups: FollowupEvent[]
}

export type ManualFollowupInput = {
  beneficiaryId: string
  beneficiaryContactId: string | null
  assignedUserId: string
  createdBy: string
  eventType: FollowupEventType
  isValidFollowup: boolean
  requiresSupport: boolean
  notes: string | null
}

export const followupStatusMeta: Record<
  FollowupStatus,
  { label: string; tone: 'danger' | 'warning' | 'success' | 'muted' }
> = {
  urgent: { label: 'Urgente', tone: 'danger' },
  pending: { label: 'Pendiente', tone: 'warning' },
  up_to_date: { label: 'Al dia', tone: 'success' },
  no_data: { label: 'Sin datos', tone: 'muted' },
}

export const followupEventLabels: Record<FollowupEventType, string> = {
  contact_beneficiary: 'Contacto beneficiario',
  contact_support_network: 'Contacto red apoyo',
  no_answer: 'No contesta',
  phone_off: 'Numero apagado',
  wrong_number: 'Numero equivocado',
  requests_help: 'Solicita ayuda',
  support_referral: 'Derivacion soporte',
  internal_note: 'Nota interna',
}

export const validFollowupEventTypes = new Set<FollowupEventType>([
  'contact_beneficiary',
  'contact_support_network',
  'requests_help',
])

export const supportEventTypes = new Set<FollowupEventType>([
  'requests_help',
  'support_referral',
])

const followupStatusOrder: FollowupStatus[] = ['urgent', 'pending', 'no_data', 'up_to_date']

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

export async function fetchTeleoperatorPortfolio(userId: string) {
  const client = assertSupabase()
  const { data, error } = await client
    .from('beneficiary_assignments')
    .select(
      `
        id,
        beneficiary_id,
        starts_at,
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
        )
      `,
    )
    .eq('assigned_user_id', userId)
    .eq('status', 'active')
    .order('starts_at', { ascending: false })

  if (error) {
    throw error
  }

  const items = ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const beneficiaryRaw = pickSingle(row.beneficiary as Record<string, unknown> | Record<string, unknown>[] | null)
    const statusRaw = beneficiaryRaw
      ? pickSingle(
          beneficiaryRaw.beneficiary_followup_status as
            | Record<string, unknown>
            | Record<string, unknown>[]
            | null,
        )
      : null

    const followupStatus = (statusRaw?.status as FollowupStatus | undefined) ?? 'no_data'

    return {
      assignmentId: String(row.id),
      beneficiaryId: String(row.beneficiary_id),
      beneficiary: {
        id: String(beneficiaryRaw?.id),
        rutRaw: (beneficiaryRaw?.rut_raw as string | null) ?? null,
        fullName: buildBeneficiaryName(beneficiaryRaw ?? {}),
        commune: (beneficiaryRaw?.commune as string | null) ?? null,
        region: (beneficiaryRaw?.region as string | null) ?? null,
        status: ((beneficiaryRaw?.status as string | null) ?? 'active') as MinimalBeneficiary['status'],
      },
      followupStatus,
      lastValidFollowupAt: (statusRaw?.last_valid_followup_at as string | null) ?? null,
      daysSinceLastValidFollowup:
        (statusRaw?.days_since_last_valid_followup as number | null) ?? null,
      startsAt: String(row.starts_at),
    } satisfies PortfolioItem
  })

  return items.sort(
    (left, right) =>
      followupStatusOrder.indexOf(left.followupStatus) -
      followupStatusOrder.indexOf(right.followupStatus),
  )
}

export async function fetchTeleoperatorBeneficiaryDetail(
  userId: string,
  beneficiaryId: string,
) {
  const client = assertSupabase()
  const { data: assignment, error: assignmentError } = await client
    .from('beneficiary_assignments')
    .select(
      `
        id,
        starts_at,
        assignment_type,
        notes,
        beneficiary:beneficiaries (
          id,
          rut_raw,
          full_name,
          first_name,
          last_name,
          birth_date,
          address,
          commune,
          region,
          notes,
          status
        )
      `,
    )
    .eq('assigned_user_id', userId)
    .eq('beneficiary_id', beneficiaryId)
    .eq('status', 'active')
    .maybeSingle()

  if (assignmentError) {
    throw assignmentError
  }

  if (!assignment) {
    throw new Error('El beneficiario no pertenece a la cartera activa de la teleoperadora.')
  }

  const beneficiaryRaw = pickSingle(
    (assignment as Record<string, unknown>).beneficiary as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | null,
  )

  const [contactsResponse, callsResponse, followupsResponse, statusResponse] = await Promise.all([
    client
      .from('beneficiary_contacts')
      .select(
        'id, beneficiary_id, contact_type, contact_name, relationship, phone_raw, phone_normalized, is_primary, is_active, notes, counts_as_valid_followup',
      )
      .eq('beneficiary_id', beneficiaryId)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true }),
    client
      .from('call_interactions')
      .select(
        'id, call_date, started_at, ended_at, direction, matched_status, is_valid_contact, counts_as_valid_followup, phone_raw, phone_normalized, amaia_result_raw, amaia_observation_raw, notes',
      )
      .eq('beneficiary_id', beneficiaryId)
      .order('started_at', { ascending: false })
      .limit(20),
    client
      .from('followup_events')
      .select(
        'id, beneficiary_contact_id, event_type, occurred_at, is_valid_followup, requires_support, source, notes, created_by',
      )
      .eq('beneficiary_id', beneficiaryId)
      .order('occurred_at', { ascending: false })
      .limit(20),
    client
      .from('beneficiary_followup_status')
      .select('status, last_valid_followup_at, days_since_last_valid_followup')
      .eq('beneficiary_id', beneficiaryId)
      .maybeSingle(),
  ])

  if (contactsResponse.error) {
    throw contactsResponse.error
  }

  if (callsResponse.error) {
    throw callsResponse.error
  }

  if (followupsResponse.error) {
    throw followupsResponse.error
  }

  if (statusResponse.error) {
    throw statusResponse.error
  }

  return {
    assignmentId: String((assignment as Record<string, unknown>).id),
    beneficiary: {
      id: String(beneficiaryRaw?.id),
      rutRaw: (beneficiaryRaw?.rut_raw as string | null) ?? null,
      fullName: buildBeneficiaryName(beneficiaryRaw ?? {}),
      commune: (beneficiaryRaw?.commune as string | null) ?? null,
      region: (beneficiaryRaw?.region as string | null) ?? null,
      status: ((beneficiaryRaw?.status as string | null) ?? 'active') as MinimalBeneficiary['status'],
      birthDate: (beneficiaryRaw?.birth_date as string | null) ?? null,
      address: (beneficiaryRaw?.address as string | null) ?? null,
      notes: (beneficiaryRaw?.notes as string | null) ?? null,
    },
    assignment: {
      assignmentType: String((assignment as Record<string, unknown>).assignment_type),
      startsAt: String((assignment as Record<string, unknown>).starts_at),
      notes: ((assignment as Record<string, unknown>).notes as string | null) ?? null,
    },
    status: {
      status: ((statusResponse.data?.status as FollowupStatus | undefined) ?? 'no_data') as FollowupStatus,
      lastValidFollowupAt:
        (statusResponse.data?.last_valid_followup_at as string | null) ?? null,
      daysSinceLastValidFollowup:
        (statusResponse.data?.days_since_last_valid_followup as number | null) ?? null,
    },
    contacts: (contactsResponse.data ?? []).map((contact) => ({
      id: contact.id,
      beneficiaryId: contact.beneficiary_id,
      contactType: contact.contact_type,
      contactName: contact.contact_name,
      relationship: contact.relationship,
      phoneRaw: contact.phone_raw,
      phoneNormalized: contact.phone_normalized,
      isPrimary: contact.is_primary,
      isActive: contact.is_active,
      countsAsValidFollowup: contact.counts_as_valid_followup,
      notes: contact.notes,
    })),
    calls: (callsResponse.data ?? []).map((call) => ({
      id: call.id,
      callDate: call.call_date,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      direction: call.direction,
      matchedStatus: call.matched_status,
      isValidContact: call.is_valid_contact,
      countsAsValidFollowup: call.counts_as_valid_followup,
      phoneRaw: call.phone_raw,
      phoneNormalized: call.phone_normalized,
      result: call.amaia_result_raw,
      observation: call.amaia_observation_raw,
      notes: call.notes,
    })),
    followups: (followupsResponse.data ?? []).map((followup) => ({
      id: followup.id,
      beneficiaryContactId: followup.beneficiary_contact_id,
      eventType: followup.event_type,
      occurredAt: followup.occurred_at,
      isValidFollowup: followup.is_valid_followup,
      requiresSupport: followup.requires_support,
      source: followup.source,
      notes: followup.notes,
      createdBy: followup.created_by,
    })),
  } satisfies TeleoperatorBeneficiaryDetail
}

export async function createManualFollowupEvent(input: ManualFollowupInput) {
  const client = assertSupabase()
  const { error } = await client.from('followup_events').insert({
    beneficiary_id: input.beneficiaryId,
    beneficiary_contact_id: input.beneficiaryContactId,
    assigned_user_id: input.assignedUserId,
    created_by: input.createdBy,
    source: 'manual',
    event_type: input.eventType,
    is_valid_followup: input.isValidFollowup,
    requires_support: input.requiresSupport,
    occurred_at: new Date().toISOString(),
    notes: input.notes,
  })

  if (error) {
    throw error
  }
}