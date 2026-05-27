import { supabase } from '@/lib/supabase'
import type { BeneficiaryContact, FollowupEventType, MinimalBeneficiary } from '@/lib/types'

export type OperationalCoverageState = 'urgente' | 'pendiente' | 'sin_contacto' | 'al_dia'

export type FollowUpOutcome =
  | 'contacto_efectivo'
  | 'no_responde'
  | 'ocupado'
  | 'mensaje_dejado'
  | 'numero_invalido'
  | 'rechaza_llamada'
  | 'sin_clasificar'

export type FollowUpContactType = 'principal' | 'red_apoyo' | 'desconocido'

export type WorkspaceAssignmentType = 'primary' | 'support'

export type OperationalWorkspaceFilters = {
  page: number
  pageSize: number
  search: string
  coverageState: 'all' | OperationalCoverageState
  assignedOperatorId: 'all' | string
  minDaysSince: string
  maxDaysSince: string
}

export type OperationalWorkspaceItem = {
  beneficiaryId: string
  beneficiaryName: string
  beneficiaryRut: string | null
  beneficiaryCommune: string | null
  beneficiaryRegion: string | null
  coverageState: OperationalCoverageState
  priorityRank: number
  lastEffectiveFollowupAt: string | null
  daysSinceEffectiveFollowup: number | null
  latestFollowUpEventAt: string | null
  latestOutcome: FollowUpOutcome | null
  latestContactType: FollowUpContactType | null
  activeAssignmentId: string | null
  activeAssignmentType: WorkspaceAssignmentType | null
  activeAssignmentStartsAt: string | null
  assignedOperatorProfileId: string | null
  assignedOperatorName: string | null
  lastOperatorName: string | null
}

export type OperationalWorkspaceResult = {
  items: OperationalWorkspaceItem[]
  totalCount: number
  page: number
  pageSize: number
}

export type OperationalOperatorOption = {
  id: string
  label: string
}

export type OperationalTimelineEvent = {
  id: string
  beneficiaryContactId: string | null
  eventType: FollowupEventType
  eventTimestamp: string
  eventOutcome: FollowUpOutcome
  contactType: FollowUpContactType
  isEffectiveContact: boolean
  requiresSupport: boolean
  source: 'manual' | 'amaia_call' | 'system'
  notes: string | null
  contactPhone: string | null
  operatorName: string | null
}

export type OperationalBeneficiaryDetail = {
  workspace: OperationalWorkspaceItem
  beneficiary: MinimalBeneficiary & {
    birthDate: string | null
    address: string | null
    notes: string | null
  }
  contacts: BeneficiaryContact[]
  timeline: OperationalTimelineEvent[]
}

export type ManualFollowupInput = {
  beneficiaryId: string
  beneficiaryContactId: string | null
  eventType: FollowupEventType
  notes: string | null
}

export type ManualFollowupResult = {
  followUpEventId: string
}

export const coverageStateMeta: Record<
  OperationalCoverageState,
  {
    label: string
    tone: 'danger' | 'warning' | 'muted' | 'success'
    badgeClass: string
    rowClass: string
    accentClass: string
  }
> = {
  urgente: {
    label: 'Urgente',
    tone: 'danger',
    badgeClass: 'border-rose-300 bg-rose-600 text-white',
    rowClass: 'bg-rose-50/70',
    accentClass: 'bg-rose-600',
  },
  pendiente: {
    label: 'Pendiente',
    tone: 'warning',
    badgeClass: 'border-amber-300 bg-amber-100 text-amber-950',
    rowClass: 'bg-amber-50/70',
    accentClass: 'bg-amber-400',
  },
  sin_contacto: {
    label: 'Sin contacto',
    tone: 'muted',
    badgeClass: 'border-slate-300 bg-slate-200 text-slate-700',
    rowClass: 'bg-slate-100/80',
    accentClass: 'bg-slate-400',
  },
  al_dia: {
    label: 'Al dia',
    tone: 'success',
    badgeClass: 'border-emerald-300 bg-emerald-600 text-white',
    rowClass: 'bg-emerald-50/70',
    accentClass: 'bg-emerald-600',
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

export const outcomeLabels: Record<FollowUpOutcome, string> = {
  contacto_efectivo: 'Contacto efectivo',
  no_responde: 'No responde',
  ocupado: 'Ocupado',
  mensaje_dejado: 'Mensaje dejado',
  numero_invalido: 'Numero invalido',
  rechaza_llamada: 'Rechaza llamada',
  sin_clasificar: 'Sin clasificar',
}

export const contactTypeLabels: Record<FollowUpContactType, string> = {
  principal: 'Principal',
  red_apoyo: 'Red de apoyo',
  desconocido: 'Desconocido',
}

export const followupSourceLabels: Record<'manual' | 'amaia_call' | 'system', string> = {
  manual: 'Registro manual',
  amaia_call: 'Llamada AMAIA',
  system: 'Sistema',
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

type WorkspaceRow = {
  beneficiary_id: string
  beneficiary_name: string | null
  beneficiary_rut: string | null
  beneficiary_commune: string | null
  beneficiary_region: string | null
  coverage_state: OperationalCoverageState
  priority_rank: number
  last_effective_followup_at: string | null
  days_since_effective_followup: number | null
  latest_follow_up_event_at: string | null
  latest_outcome: FollowUpOutcome | null
  latest_contact_type: FollowUpContactType | null
  active_assignment_id: string | null
  active_assignment_type: WorkspaceAssignmentType | null
  active_assignment_starts_at: string | null
  assigned_operator_profile_id: string | null
  assigned_operator_name: string | null
  last_operator_name: string | null
}

type BeneficiaryContactRow = {
  id: string
  beneficiary_id: string
  contact_type: string
  contact_name: string | null
  relationship: string | null
  phone_raw: string | null
  phone_normalized: string | null
  is_primary: boolean
  is_active: boolean
  counts_as_valid_followup: boolean
  notes: string | null
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

function sanitizeSearchTerm(value: string) {
  return value.trim().replaceAll(',', ' ')
}

function buildBeneficiaryName(raw: {
  beneficiary_name?: string | null
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
}) {
  const fullName = (raw.beneficiary_name ?? raw.full_name)?.trim()

  if (fullName) {
    return fullName
  }

  return [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim() || 'Beneficiario sin nombre'
}

function getOperatorLabel(raw: { full_name?: string | null; email?: string | null }) {
  return raw.full_name?.trim() || raw.email || 'Sin operadora visible'
}

function mapWorkspaceRow(row: WorkspaceRow): OperationalWorkspaceItem {
  return {
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: buildBeneficiaryName({ beneficiary_name: row.beneficiary_name }),
    beneficiaryRut: row.beneficiary_rut ?? null,
    beneficiaryCommune: row.beneficiary_commune ?? null,
    beneficiaryRegion: row.beneficiary_region ?? null,
    coverageState: row.coverage_state,
    priorityRank: row.priority_rank,
    lastEffectiveFollowupAt: row.last_effective_followup_at ?? null,
    daysSinceEffectiveFollowup: row.days_since_effective_followup ?? null,
    latestFollowUpEventAt: row.latest_follow_up_event_at ?? null,
    latestOutcome: row.latest_outcome ?? null,
    latestContactType: row.latest_contact_type ?? null,
    activeAssignmentId: row.active_assignment_id ?? null,
    activeAssignmentType: row.active_assignment_type ?? null,
    activeAssignmentStartsAt: row.active_assignment_starts_at ?? null,
    assignedOperatorProfileId: row.assigned_operator_profile_id ?? null,
    assignedOperatorName: row.assigned_operator_name ?? null,
    lastOperatorName: row.last_operator_name ?? null,
  }
}

export async function fetchOperationalCoverageWorkspace(filters: OperationalWorkspaceFilters) {
  const client = assertSupabase()
  let query = client
    .from('v_operational_follow_up_workspace')
    .select(
      'beneficiary_id, beneficiary_name, beneficiary_rut, beneficiary_commune, beneficiary_region, coverage_state, priority_rank, last_effective_followup_at, days_since_effective_followup, latest_follow_up_event_at, latest_outcome, latest_contact_type, active_assignment_id, active_assignment_type, active_assignment_starts_at, assigned_operator_profile_id, assigned_operator_name, last_operator_name',
      { count: 'exact' },
    )

  const normalizedSearch = sanitizeSearchTerm(filters.search)

  if (filters.coverageState !== 'all') {
    query = query.eq('coverage_state', filters.coverageState)
  }

  if (filters.assignedOperatorId !== 'all') {
    query = query.eq('assigned_operator_profile_id', filters.assignedOperatorId)
  }

  if (normalizedSearch) {
    query = query.or(
      `beneficiary_name.ilike.%${normalizedSearch}%,beneficiary_rut.ilike.%${normalizedSearch}%`,
    )
  }

  if (filters.minDaysSince.trim()) {
    const minDays = Number(filters.minDaysSince)

    if (!Number.isNaN(minDays)) {
      query = query.gte('days_since_effective_followup', minDays)
    }
  }

  if (filters.maxDaysSince.trim()) {
    const maxDays = Number(filters.maxDaysSince)

    if (!Number.isNaN(maxDays)) {
      query = query.lte('days_since_effective_followup', maxDays)
    }
  }

  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize - 1
  const { data, error, count } = await query
    .order('priority_rank', { ascending: true })
    .order('days_since_effective_followup', { ascending: false, nullsFirst: false })
    .order('last_effective_followup_at', { ascending: true, nullsFirst: true })
    .order('beneficiary_name', { ascending: true })
    .range(from, to)

  if (error) {
    throw error
  }

  return {
    items: ((data as WorkspaceRow[] | null) ?? []).map(mapWorkspaceRow),
    totalCount: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  } satisfies OperationalWorkspaceResult
}

export async function fetchOperationalOperators() {
  const { data, error } = await assertSupabase()
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'teleoperadora')
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    throw error
  }

  return ((data as Array<{ id: string; full_name: string | null; email: string }> | null) ?? []).map(
    (row) => ({
      id: row.id,
      label: getOperatorLabel(row),
    }),
  ) satisfies OperationalOperatorOption[]
}

export async function fetchOperationalBeneficiaryDetail(beneficiaryId: string) {
  const client = assertSupabase()
  const [workspaceResponse, beneficiaryResponse, contactsResponse, timelineResponse] = await Promise.all([
    client
      .from('v_operational_follow_up_workspace')
      .select(
        'beneficiary_id, beneficiary_name, beneficiary_rut, beneficiary_commune, beneficiary_region, coverage_state, priority_rank, last_effective_followup_at, days_since_effective_followup, latest_follow_up_event_at, latest_outcome, latest_contact_type, active_assignment_id, active_assignment_type, active_assignment_starts_at, assigned_operator_profile_id, assigned_operator_name, last_operator_name',
      )
      .eq('beneficiary_id', beneficiaryId)
      .maybeSingle(),
    client
      .from('beneficiaries')
      .select('id, rut_raw, full_name, first_name, last_name, commune, region, status, birth_date, address, notes')
      .eq('id', beneficiaryId)
      .maybeSingle(),
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
      .from('followup_events')
      .select(
        `
          id,
          beneficiary_contact_id,
          event_type,
          event_timestamp,
          event_outcome,
          contact_type,
          is_effective_contact,
          requires_support,
          source,
          notes,
          contact_phone,
          operator:profiles!followup_events_operator_profile_id_fkey (
            id,
            full_name,
            email
          )
        `,
      )
      .eq('beneficiary_id', beneficiaryId)
      .order('event_timestamp', { ascending: false })
      .limit(30),
  ])

  if (workspaceResponse.error) {
    throw workspaceResponse.error
  }

  if (beneficiaryResponse.error) {
    throw beneficiaryResponse.error
  }

  if (contactsResponse.error) {
    throw contactsResponse.error
  }

  if (timelineResponse.error) {
    throw timelineResponse.error
  }

  const workspace = workspaceResponse.data as WorkspaceRow | null
  const beneficiary = beneficiaryResponse.data as Record<string, unknown> | null

  if (!workspace || !beneficiary) {
    throw new Error('El beneficiario no esta disponible en el workspace operacional.')
  }

  return {
    workspace: mapWorkspaceRow(workspace),
    beneficiary: {
      id: String(beneficiary.id),
      rutRaw: (beneficiary.rut_raw as string | null) ?? null,
      fullName: buildBeneficiaryName({
        full_name: (beneficiary.full_name as string | null) ?? null,
        first_name: (beneficiary.first_name as string | null) ?? null,
        last_name: (beneficiary.last_name as string | null) ?? null,
      }),
      commune: (beneficiary.commune as string | null) ?? null,
      region: (beneficiary.region as string | null) ?? null,
      status: ((beneficiary.status as string | null) ?? 'active') as MinimalBeneficiary['status'],
      birthDate: (beneficiary.birth_date as string | null) ?? null,
      address: (beneficiary.address as string | null) ?? null,
      notes: (beneficiary.notes as string | null) ?? null,
    },
    contacts: ((contactsResponse.data as BeneficiaryContactRow[] | null) ?? []).map((contact) => ({
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
    timeline: ((timelineResponse.data as Array<Record<string, unknown>> | null) ?? []).map((event) => {
      const operatorRaw = pickSingle(
        event.operator as Record<string, unknown> | Record<string, unknown>[] | null,
      )

      return {
        id: String(event.id),
        beneficiaryContactId: (event.beneficiary_contact_id as string | null) ?? null,
        eventType: event.event_type as FollowupEventType,
        eventTimestamp: String(event.event_timestamp),
        eventOutcome: event.event_outcome as FollowUpOutcome,
        contactType: event.contact_type as FollowUpContactType,
        isEffectiveContact: Boolean(event.is_effective_contact),
        requiresSupport: Boolean(event.requires_support),
        source: event.source as 'manual' | 'amaia_call' | 'system',
        notes: (event.notes as string | null) ?? null,
        contactPhone: (event.contact_phone as string | null) ?? null,
        operatorName: operatorRaw
          ? getOperatorLabel({
              full_name: (operatorRaw.full_name as string | null) ?? null,
              email: (operatorRaw.email as string | null) ?? null,
            })
          : null,
      } satisfies OperationalTimelineEvent
    }),
  } satisfies OperationalBeneficiaryDetail
}

export async function createManualFollowupEvent(input: ManualFollowupInput): Promise<ManualFollowupResult> {
  const { data, error } = await assertSupabase().rpc('create_manual_follow_up_event', {
    p_beneficiary_id: input.beneficiaryId,
    p_event_type: input.eventType,
    p_beneficiary_contact_id: input.beneficiaryContactId,
    p_notes: input.notes,
    p_occurred_at: new Date().toISOString(),
  })

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('No fue posible confirmar el seguimiento registrado.')
  }

  return {
    followUpEventId: String(data),
  }
}