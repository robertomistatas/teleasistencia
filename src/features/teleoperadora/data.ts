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
  lastInteractionAt: string | null
  lastInteractionLabel: string | null
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

export type ManualFollowupResult = {
  recalculationWarning: string | null
}

export const followupStatusMeta: Record<
  FollowupStatus,
  {
    label: string
    tone: 'danger' | 'warning' | 'success' | 'muted'
    badgeClass: string
    panelClass: string
    accentClass: string
  }
> = {
  urgent: {
    label: 'Urgente',
    tone: 'danger',
    badgeClass: 'border-rose-300 bg-rose-600 text-white',
    panelClass: 'border-rose-200 bg-rose-50/90',
    accentClass: 'bg-rose-600',
  },
  pending: {
    label: 'Pendiente',
    tone: 'warning',
    badgeClass: 'border-amber-300 bg-amber-100 text-amber-950',
    panelClass: 'border-amber-200 bg-amber-50/90',
    accentClass: 'bg-amber-400',
  },
  up_to_date: {
    label: 'Al dia',
    tone: 'success',
    badgeClass: 'border-emerald-300 bg-emerald-600 text-white',
    panelClass: 'border-emerald-200 bg-emerald-50/90',
    accentClass: 'bg-emerald-600',
  },
  no_data: {
    label: 'Sin datos',
    tone: 'muted',
    badgeClass: 'border-slate-300 bg-slate-200 text-slate-700',
    panelClass: 'border-slate-200 bg-slate-100/90',
    accentClass: 'bg-slate-400',
  },
}

export const followupEventLabels: Record<FollowupEventType, string> = {
  contact_beneficiary: 'Hable con el beneficiario',
  contact_support_network: 'Hable con red de apoyo',
  no_answer: 'No contesto',
  phone_off: 'Telefono apagado',
  wrong_number: 'Numero incorrecto',
  requests_help: 'Solicita ayuda',
  support_referral: 'Derivado a soporte',
  internal_note: 'Solo registro interno',
}

export const contactTypeLabels: Record<string, string> = {
  primary_phone: 'Telefono principal',
  support_network: 'Red de apoyo',
  family_contact: 'Contacto familiar',
  emergency_contact: 'Contacto emergencia',
  app_phone: 'Telefono app',
  sim_phone: 'SIM / dispositivo',
  other: 'Otro contacto',
}

export const followupSourceLabels: Record<string, string> = {
  manual: 'Registro manual',
  amaia_call: 'Llamada AMAIA',
  system: 'Sistema',
}

export function getContactTypeLabel(contactType: string) {
  return contactTypeLabels[contactType] ?? contactType
}

export function getFollowupSourceLabel(source: string) {
  return followupSourceLabels[source] ?? source
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
const STATUS_UP_TO_DATE_MAX_DAYS = 15
const STATUS_PENDING_MAX_DAYS = 30
const MIN_VALID_CALL_DURATION_SECONDS = 10
const validFollowupStatusEventTypes = new Set<FollowupEventType>([
  'contact_beneficiary',
  'contact_support_network',
])

type LatestInteraction = {
  at: string | null
  label: string | null
}

type DerivedCoverage = {
  status: FollowupStatus
  lastValidFollowupAt: string | null
  daysSinceLastValidFollowup: number | null
}

type BackendCoverageRow = {
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

function pickBackendCoverage(value: BackendCoverageRow | BackendCoverageRow[] | null | undefined) {
  const raw = pickSingle(value)

  if (!raw?.status) {
    return null
  }

  return {
    status: raw.status,
    lastValidFollowupAt: raw.last_valid_followup_at ?? null,
    daysSinceLastValidFollowup: raw.days_since_last_valid_followup ?? null,
  } satisfies DerivedCoverage
}

function getStatusRank(status: FollowupStatus) {
  return followupStatusOrder.indexOf(status)
}

function getComparableTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY
  }

  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function getDaysSince(value: string) {
  const timestamp = new Date(value).getTime()

  if (Number.isNaN(timestamp)) {
    return null
  }

  const now = Date.now()
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000))
}

function isValidCallForCoverage(call: {
  duration_seconds?: number | null
  started_at?: string | null
  call_date?: string | null
}) {
  return (
    (call.duration_seconds ?? 0) >= MIN_VALID_CALL_DURATION_SECONDS &&
    Boolean(call.started_at ?? call.call_date)
  )
}

function isValidFollowupForCoverage(followup: {
  event_type: FollowupEventType
  occurred_at?: string | null
}) {
  return validFollowupStatusEventTypes.has(followup.event_type) && Boolean(followup.occurred_at)
}

function deriveCoverageFromSources(
  calls: Array<{
    duration_seconds?: number | null
    started_at?: string | null
    call_date?: string | null
  }>,
  followups: Array<{
    event_type: FollowupEventType
    occurred_at?: string | null
  }>,
): DerivedCoverage {
  const latestValidCallAt = calls
    .filter(isValidCallForCoverage)
    .map((call) => call.started_at ?? call.call_date ?? null)
    .sort((left, right) => getComparableTimestamp(right) - getComparableTimestamp(left))[0] ?? null

  const latestValidFollowupAt = followups
    .filter(isValidFollowupForCoverage)
    .map((followup) => followup.occurred_at ?? null)
    .sort((left, right) => getComparableTimestamp(right) - getComparableTimestamp(left))[0] ?? null

  const lastValidFollowupAt =
    getComparableTimestamp(latestValidCallAt) > getComparableTimestamp(latestValidFollowupAt)
      ? latestValidCallAt
      : latestValidFollowupAt

  if (!lastValidFollowupAt) {
    return {
      status: 'no_data',
      lastValidFollowupAt: null,
      daysSinceLastValidFollowup: null,
    }
  }

  const daysSinceLastValidFollowup = getDaysSince(lastValidFollowupAt)

  if (daysSinceLastValidFollowup === null) {
    return {
      status: 'no_data',
      lastValidFollowupAt: null,
      daysSinceLastValidFollowup: null,
    }
  }

  if (daysSinceLastValidFollowup <= STATUS_UP_TO_DATE_MAX_DAYS) {
    return {
      status: 'up_to_date',
      lastValidFollowupAt,
      daysSinceLastValidFollowup,
    }
  }

  if (daysSinceLastValidFollowup <= STATUS_PENDING_MAX_DAYS) {
    return {
      status: 'pending',
      lastValidFollowupAt,
      daysSinceLastValidFollowup,
    }
  }

  return {
    status: 'urgent',
    lastValidFollowupAt,
    daysSinceLastValidFollowup,
  }
}

function buildCoverageMap(
  beneficiaryIds: string[],
  calls: Array<{
    beneficiary_id: string | null
    duration_seconds?: number | null
    started_at?: string | null
    call_date?: string | null
  }>,
  followups: Array<{
    beneficiary_id: string | null
    event_type: FollowupEventType
    occurred_at?: string | null
  }>,
) {
  return new Map(
    beneficiaryIds.map((beneficiaryId) => {
      const beneficiaryCalls = calls.filter((call) => call.beneficiary_id === beneficiaryId)
      const beneficiaryFollowups = followups.filter(
        (followup) => followup.beneficiary_id === beneficiaryId,
      )

      return [beneficiaryId, deriveCoverageFromSources(beneficiaryCalls, beneficiaryFollowups)]
    }),
  )
}

function buildLatestInteractionMap(
  calls: Array<{
    beneficiary_id: string | null
    started_at: string | null
    call_date: string | null
    amaia_result_raw: string | null
    duration_seconds?: number | null
  }>,
  followups: Array<{
    beneficiary_id: string | null
    occurred_at: string | null
    event_type: FollowupEventType
  }>,
) {
  const latestMap = new Map<string, LatestInteraction>()

  for (const call of calls) {
    if (!call.beneficiary_id) {
      continue
    }

    const interactionAt = call.started_at ?? call.call_date
    const nextTimestamp = getComparableTimestamp(interactionAt)
    const previousTimestamp = getComparableTimestamp(latestMap.get(call.beneficiary_id)?.at)

    if (nextTimestamp > previousTimestamp) {
      latestMap.set(call.beneficiary_id, {
        at: interactionAt,
        label: call.amaia_result_raw?.trim() || 'Interaccion telefonica',
      })
    }
  }

  for (const followup of followups) {
    if (!followup.beneficiary_id) {
      continue
    }

    const nextTimestamp = getComparableTimestamp(followup.occurred_at)
    const previousTimestamp = getComparableTimestamp(latestMap.get(followup.beneficiary_id)?.at)

    if (nextTimestamp > previousTimestamp) {
      latestMap.set(followup.beneficiary_id, {
        at: followup.occurred_at,
        label: followupEventLabels[followup.event_type],
      })
    }
  }

  return latestMap
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

  const beneficiaryIds = ((data as Array<Record<string, unknown>>) ?? []).map((row) =>
    String(row.beneficiary_id),
  )

  let latestInteractionMap = new Map<string, LatestInteraction>()
  let coverageMap = new Map<string, DerivedCoverage>()

  if (beneficiaryIds.length > 0) {
    const [callsResponse, followupsResponse] = await Promise.all([
      client
        .from('call_interactions')
        .select('beneficiary_id, started_at, call_date, amaia_result_raw, duration_seconds')
        .in('beneficiary_id', beneficiaryIds),
      client
        .from('followup_events')
        .select('beneficiary_id, occurred_at, event_type')
        .in('beneficiary_id', beneficiaryIds),
    ])

    if (callsResponse.error) {
      throw callsResponse.error
    }

    if (followupsResponse.error) {
      throw followupsResponse.error
    }

    latestInteractionMap = buildLatestInteractionMap(
      callsResponse.data ?? [],
      (followupsResponse.data ?? []) as Array<{
        beneficiary_id: string | null
        occurred_at: string | null
        event_type: FollowupEventType
      }>,
    )

    coverageMap = buildCoverageMap(
      beneficiaryIds,
      (callsResponse.data ?? []) as Array<{
        beneficiary_id: string | null
        started_at: string | null
        call_date: string | null
        duration_seconds?: number | null
      }>,
      (followupsResponse.data ?? []) as Array<{
        beneficiary_id: string | null
        occurred_at: string | null
        event_type: FollowupEventType
      }>,
    )
  }

  const items = ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const beneficiaryRaw = pickSingle(row.beneficiary as Record<string, unknown> | Record<string, unknown>[] | null)
    const backendCoverage = beneficiaryRaw
      ? pickBackendCoverage(
          beneficiaryRaw.beneficiary_followup_status as
            | BackendCoverageRow
            | BackendCoverageRow[]
            | null,
        )
      : null
    const latestInteraction = latestInteractionMap.get(String(row.beneficiary_id))
    const fallbackCoverage = coverageMap.get(String(row.beneficiary_id)) ?? {
      status: 'no_data',
      lastValidFollowupAt: null,
      daysSinceLastValidFollowup: null,
    }
    const resolvedCoverage = backendCoverage ?? fallbackCoverage

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
      followupStatus: resolvedCoverage.status,
      lastValidFollowupAt: resolvedCoverage.lastValidFollowupAt,
      daysSinceLastValidFollowup: resolvedCoverage.daysSinceLastValidFollowup,
      lastInteractionAt: latestInteraction?.at ?? null,
      lastInteractionLabel: latestInteraction?.label ?? null,
      startsAt: String(row.starts_at),
    } satisfies PortfolioItem
  })

  return items.sort(
    (left, right) => {
      const statusDelta = getStatusRank(left.followupStatus) - getStatusRank(right.followupStatus)

      if (statusDelta !== 0) {
        return statusDelta
      }

      const interactionDelta =
        getComparableTimestamp(right.lastInteractionAt) -
        getComparableTimestamp(left.lastInteractionAt)

      if (interactionDelta !== 0) {
        return interactionDelta
      }

      return getComparableTimestamp(right.startsAt) - getComparableTimestamp(left.startsAt)
    },
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
        'id, call_date, started_at, ended_at, duration_seconds, direction, matched_status, is_valid_contact, counts_as_valid_followup, phone_raw, phone_normalized, amaia_result_raw, amaia_observation_raw, notes',
      )
      .eq('beneficiary_id', beneficiaryId)
      .order('started_at', { ascending: false })
      .limit(20),
    client
      .from('followup_events')
      .select(
        'id, beneficiary_id, beneficiary_contact_id, event_type, occurred_at, is_valid_followup, requires_support, source, notes, created_by',
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

  const derivedCoverage = deriveCoverageFromSources(
    (callsResponse.data ?? []) as Array<{
      duration_seconds?: number | null
      started_at?: string | null
      call_date?: string | null
    }>,
    (followupsResponse.data ?? []) as Array<{
      event_type: FollowupEventType
      occurred_at?: string | null
    }>,
  )
  const backendCoverage = pickBackendCoverage(statusResponse.data as BackendCoverageRow | null)
  const resolvedCoverage = backendCoverage ?? derivedCoverage

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
      status: resolvedCoverage.status,
      lastValidFollowupAt: resolvedCoverage.lastValidFollowupAt,
      daysSinceLastValidFollowup: resolvedCoverage.daysSinceLastValidFollowup,
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
      durationSeconds: call.duration_seconds,
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

export async function createManualFollowupEvent(input: ManualFollowupInput): Promise<ManualFollowupResult> {
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

  const { error: rpcError } = await client.rpc('recalculate_beneficiary_followup_status', {
    p_beneficiary_id: input.beneficiaryId,
  })

  return {
    recalculationWarning: rpcError
      ? 'El seguimiento se guardo, pero no fue posible recalcular el estado en este momento.'
      : null,
  }
}