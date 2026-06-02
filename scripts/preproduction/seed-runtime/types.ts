export const ALLOWED_MODES = ['plan', 'seed', 'resume', 'validate', 'cleanup-preview'] as const

export type RuntimeMode = (typeof ALLOWED_MODES)[number]

export interface CliOptions {
  mode: RuntimeMode
  manifestPath: string
  targetEnvironment: string
  requestedBy: string
  strict: boolean
  runId?: string
  dryRun: boolean
}

export interface RuntimeViolation {
  code: string
  severity: 'critical' | 'warning'
  message: string
  path?: string
}

export interface ValidatorResult {
  violations: RuntimeViolation[]
  warnings: RuntimeViolation[]
}

export interface ManifestIdentity {
  batch_id: string
  source_documents: string[]
}

export interface ManifestEnvironment {
  environment_name: string
  contains_real_data: boolean
}

export interface ManifestMarkers {
  batch_token: string
  notes_marker: string
}

export interface ManifestUser {
  user_key: string
  expected_email: string
  reusable: boolean
}

export interface ManifestOperator {
  operator_key: string
}

export interface ManifestContact {
  contact_key: string
  beneficiary_code: string
  phone: string
}

export interface ManifestCase {
  case_id: string
  beneficiary_code: string
  expected_rut_body: string
  expected_rut_dv: string
  coverage_expected: 'al_dia' | 'pendiente' | 'urgente' | 'sin_contacto'
  assignment_state: 'active' | 'future' | 'expired' | 'unassigned'
  contacts: ManifestContact[]
  visibility_expected: Record<string, unknown>
  acceptance_criteria: string[]
  cleanup_group: string
  timeline_expectations: Record<string, unknown>
}

export interface ExpectedCounts {
  beneficiaries_total: number
  active_assigned_beneficiaries: number
  future_assigned_beneficiaries: number
  expired_assigned_beneficiaries: number
  unassigned_beneficiaries: number
  assignments_total: number
  contacts_total: number
  raw_call_logs_min: number
  call_correlations_min: number
  followup_events_min: number
  users_total: number
  operators_total: number
}

export interface CoverageExpectationBucket {
  count: number
  case_ids: string[]
}

export interface ManifestCoverageExpectations {
  al_dia: CoverageExpectationBucket
  pendiente: CoverageExpectationBucket
  urgente: CoverageExpectationBucket
  sin_contacto: CoverageExpectationBucket
}

export interface ManifestQa {
  required_sql_qa_files: string[]
}

export interface ManifestCleanupScope {
  includes_beneficiary_followup_status: boolean
}

export interface ManifestCleanup {
  cleanup_scope: ManifestCleanupScope
  deletion_order: string[]
  post_cleanup_assertions: string[]
}

export interface SeedManifest {
  schema_version: string
  manifest_type: string
  identity: ManifestIdentity
  environment: ManifestEnvironment
  markers: ManifestMarkers
  users: ManifestUser[]
  operators: ManifestOperator[]
  cases: ManifestCase[]
  expected_counts: ExpectedCounts
  coverage_expectations: ManifestCoverageExpectations
  qa: ManifestQa
  cleanup: ManifestCleanup
}

export interface LoadedManifest {
  manifest: SeedManifest
  manifestPath: string
  manifestFingerprint: string
}

export interface DependencyPlan {
  batch_id: string
  manifest_fingerprint: string
  planned_entities: {
    users: number
    profiles: number
    beneficiaries: number
    contacts: number
    assignments: number
    raw_call_logs_min: number
    call_correlations_min: number
    followup_events_min: number
    derived_state: number
  }
}

export type PreflightCheckResult = 'pass' | 'warning' | 'fail' | 'not_implemented'

export interface PreflightCheck {
  name: string
  result: PreflightCheckResult
  blocking: boolean
  message: string
  details?: Record<string, unknown>
}

export interface PreflightReport {
  run_id: string
  batch_id: string
  mode: RuntimeMode
  generated_at: string
  result: 'pass' | 'warning' | 'fail'
  checks: PreflightCheck[]
}

export interface ExecutionJournalPhase {
  phase: string
  status: 'started' | 'completed' | 'failed'
  started_at: string
  completed_at: string | null
  details?: Record<string, unknown>
}

export interface ExecutionJournal {
  run_id: string
  batch_id: string
  mode: RuntimeMode
  target_environment: string
  requested_by: string
  started_at: string
  completed_at: string | null
  runtime_status: 'running' | 'completed' | 'completed_with_warnings' | 'failed'
  manifest_fingerprint: string
  phase_history: ExecutionJournalPhase[]
  final_decision: ActivationDecision | null
}

export interface ActivationDecision {
  run_id: string
  batch_id: string
  mode: RuntimeMode
  activation_eligible: boolean
  decision: 'plan_ready' | 'blocked'
  result: 'pass' | 'warning' | 'fail'
  reasons: string[]
  generated_at: string
}

export interface PlanRuntimeResult {
  journal: ExecutionJournal
  preflightReport: PreflightReport
  dependencyPlan: DependencyPlan
  activationDecision: ActivationDecision
}