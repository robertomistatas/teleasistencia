import { isValidRut } from './rut.js'

import type { SeedManifest, ValidatorResult, RuntimeViolation } from '../types.js'

function createViolation(
  severity: RuntimeViolation['severity'],
  code: string,
  message: string,
  path?: string,
): RuntimeViolation {
  return { severity, code, message, path }
}

function pushIf(
  collection: RuntimeViolation[],
  condition: boolean,
  code: string,
  message: string,
  path?: string,
): void {
  if (condition) {
    collection.push(createViolation('critical', code, message, path))
  }
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce<Record<T, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1
    return accumulator
  }, {} as Record<T, number>)
}

function missingRequiredCaseFields(manifest: SeedManifest): RuntimeViolation[] {
  const violations: RuntimeViolation[] = []

  manifest.cases.forEach((caseItem, index) => {
    if (!Array.isArray(caseItem.contacts) || caseItem.contacts.length === 0) {
      violations.push(createViolation('critical', 'CASE_CONTACTS_MISSING', 'Case must include contacts', `cases[${index}].contacts`))
    }

    if (!caseItem.visibility_expected || typeof caseItem.visibility_expected !== 'object') {
      violations.push(createViolation('critical', 'CASE_VISIBILITY_EXPECTED_MISSING', 'Case must include visibility_expected', `cases[${index}].visibility_expected`))
    }

    if (!Array.isArray(caseItem.acceptance_criteria) || caseItem.acceptance_criteria.length === 0) {
      violations.push(createViolation('critical', 'CASE_ACCEPTANCE_CRITERIA_MISSING', 'Case must include acceptance_criteria', `cases[${index}].acceptance_criteria`))
    }

    if (!caseItem.cleanup_group) {
      violations.push(createViolation('critical', 'CASE_CLEANUP_GROUP_MISSING', 'Case must include cleanup_group', `cases[${index}].cleanup_group`))
    }

    if (!caseItem.timeline_expectations || typeof caseItem.timeline_expectations !== 'object') {
      violations.push(createViolation('critical', 'CASE_TIMELINE_EXPECTATIONS_MISSING', 'Case must include timeline_expectations', `cases[${index}].timeline_expectations`))
    }
  })

  return violations
}

export function validateManifest(manifest: SeedManifest): ValidatorResult {
  const violations: RuntimeViolation[] = []
  const warnings: RuntimeViolation[] = []

  pushIf(violations, manifest.identity?.batch_id !== 'P48_PREPROD_20260601_A', 'BATCH_ID_INVALID', 'Unexpected batch_id', 'identity.batch_id')
  pushIf(
    violations,
    manifest.manifest_type !== 'phase4_8_controlled_preproduction_batch_manifest',
    'MANIFEST_TYPE_INVALID',
    'Unexpected manifest_type',
    'manifest_type',
  )
  pushIf(violations, !manifest.schema_version, 'SCHEMA_VERSION_MISSING', 'schema_version is required', 'schema_version')
  pushIf(
    violations,
    manifest.schema_version !== '1.0.0',
    'SCHEMA_VERSION_UNSUPPORTED',
    'schema_version must be exactly 1.0.0',
    'schema_version',
  )
  pushIf(
    violations,
    manifest.environment?.contains_real_data !== false,
    'CONTAINS_REAL_DATA_INVALID',
    'environment.contains_real_data must be false',
    'environment.contains_real_data',
  )
  pushIf(
    violations,
    manifest.markers?.batch_token !== manifest.identity?.batch_id,
    'BATCH_TOKEN_MISMATCH',
    'markers.batch_token must match identity.batch_id',
    'markers.batch_token',
  )
  pushIf(
    violations,
    manifest.markers?.notes_marker !== '[[PP48:P48_PREPROD_20260601_A]]',
    'NOTES_MARKER_INVALID',
    'markers.notes_marker must be exactly [[PP48:P48_PREPROD_20260601_A]]',
    'markers.notes_marker',
  )

  pushIf(violations, manifest.users.length !== 6, 'USERS_TOTAL_INVALID', 'users total must be 6', 'users')
  pushIf(violations, manifest.operators.length !== 4, 'OPERATORS_TOTAL_INVALID', 'operators total must be 4', 'operators')
  pushIf(violations, manifest.cases.length !== 48, 'CASES_TOTAL_INVALID', 'cases total must be 48', 'cases')

  const caseIds = manifest.cases.map((caseItem) => caseItem.case_id)
  pushIf(violations, new Set(caseIds).size !== caseIds.length, 'CASE_ID_DUPLICATE', 'case_id values must be unique', 'cases')

  const beneficiaryCodes = manifest.cases.map((caseItem) => caseItem.beneficiary_code)
  pushIf(
    violations,
    new Set(beneficiaryCodes).size !== beneficiaryCodes.length,
    'BENEFICIARY_CODE_DUPLICATE',
    'beneficiary_code values must be unique',
    'cases',
  )

  manifest.users.forEach((user, index) => {
    pushIf(violations, user.reusable !== false, 'USER_REUSABLE_INVALID', 'users must not be reusable', `users[${index}].reusable`)
    pushIf(
      violations,
      !user.expected_email.endsWith('@mistatas.invalid'),
      'USER_EMAIL_INVALID',
      'user email must end with @mistatas.invalid',
      `users[${index}].expected_email`,
    )
  })

  const counts = manifest.expected_counts
  const expectedCounts: Array<[number, number, string, string]> = [
    [counts.beneficiaries_total, 48, 'EXPECTED_BENEFICIARIES_TOTAL_INVALID', 'expected_counts.beneficiaries_total'],
    [counts.active_assigned_beneficiaries, 30, 'EXPECTED_ACTIVE_TOTAL_INVALID', 'expected_counts.active_assigned_beneficiaries'],
    [counts.future_assigned_beneficiaries, 6, 'EXPECTED_FUTURE_TOTAL_INVALID', 'expected_counts.future_assigned_beneficiaries'],
    [counts.expired_assigned_beneficiaries, 6, 'EXPECTED_EXPIRED_TOTAL_INVALID', 'expected_counts.expired_assigned_beneficiaries'],
    [counts.unassigned_beneficiaries, 6, 'EXPECTED_UNASSIGNED_TOTAL_INVALID', 'expected_counts.unassigned_beneficiaries'],
    [counts.assignments_total, 42, 'EXPECTED_ASSIGNMENTS_TOTAL_INVALID', 'expected_counts.assignments_total'],
    [counts.contacts_total, 108, 'EXPECTED_CONTACTS_TOTAL_INVALID', 'expected_counts.contacts_total'],
    [counts.followup_events_min, 108, 'EXPECTED_FOLLOWUP_EVENTS_MIN_INVALID', 'expected_counts.followup_events_min'],
    [counts.raw_call_logs_min, 96, 'EXPECTED_RAW_CALL_LOGS_MIN_INVALID', 'expected_counts.raw_call_logs_min'],
    [counts.call_correlations_min, 84, 'EXPECTED_CALL_CORRELATIONS_MIN_INVALID', 'expected_counts.call_correlations_min'],
    [counts.users_total, 6, 'EXPECTED_USERS_TOTAL_INVALID', 'expected_counts.users_total'],
    [counts.operators_total, 4, 'EXPECTED_OPERATORS_TOTAL_INVALID', 'expected_counts.operators_total'],
  ]

  expectedCounts.forEach(([actual, expected, code, fieldPath]) => {
    pushIf(violations, actual !== expected, code, `Expected ${expected} but found ${actual}`, fieldPath)
  })

  const coverageCounts = countBy(manifest.cases.map((caseItem) => caseItem.coverage_expected))
  pushIf(violations, coverageCounts.al_dia !== 12, 'COVERAGE_AL_DIA_INVALID', 'coverage al_dia count must be 12', 'cases')
  pushIf(violations, coverageCounts.pendiente !== 12, 'COVERAGE_PENDIENTE_INVALID', 'coverage pendiente count must be 12', 'cases')
  pushIf(violations, coverageCounts.urgente !== 12, 'COVERAGE_URGENTE_INVALID', 'coverage urgente count must be 12', 'cases')
  pushIf(violations, coverageCounts.sin_contacto !== 12, 'COVERAGE_SIN_CONTACTO_INVALID', 'coverage sin_contacto count must be 12', 'cases')

  const assignmentCounts = countBy(manifest.cases.map((caseItem) => caseItem.assignment_state))
  pushIf(violations, assignmentCounts.active !== 30, 'ASSIGNMENT_ACTIVE_INVALID', 'assignment_state active count must be 30', 'cases')
  pushIf(violations, assignmentCounts.future !== 6, 'ASSIGNMENT_FUTURE_INVALID', 'assignment_state future count must be 6', 'cases')
  pushIf(violations, assignmentCounts.expired !== 6, 'ASSIGNMENT_EXPIRED_INVALID', 'assignment_state expired count must be 6', 'cases')
  pushIf(violations, assignmentCounts.unassigned !== 6, 'ASSIGNMENT_UNASSIGNED_INVALID', 'assignment_state unassigned count must be 6', 'cases')

  manifest.cases.forEach((caseItem, index) => {
    pushIf(
      violations,
      !isValidRut(caseItem.expected_rut_body, caseItem.expected_rut_dv),
      'CASE_RUT_INVALID',
      `Invalid RUT DV for ${caseItem.case_id}`,
      `cases[${index}]`,
    )
  })

  violations.push(...missingRequiredCaseFields(manifest))

  const cleanupIncludesFollowupStatus = manifest.cleanup?.cleanup_scope?.includes_beneficiary_followup_status === true
  pushIf(
    violations,
    !cleanupIncludesFollowupStatus,
    'CLEANUP_SCOPE_INVALID',
    'cleanup must include beneficiary_followup_status',
    'cleanup.cleanup_scope.includes_beneficiary_followup_status',
  )
  pushIf(
    violations,
    !manifest.cleanup?.deletion_order?.includes('delete_or_recalculate_batch_beneficiary_followup_status'),
    'CLEANUP_DELETION_ORDER_INVALID',
    'cleanup.deletion_order must include delete_or_recalculate_batch_beneficiary_followup_status',
    'cleanup.deletion_order',
  )
  pushIf(
    violations,
    !manifest.cleanup?.post_cleanup_assertions?.includes('Cero beneficiary_followup_status del batch.'),
    'CLEANUP_POST_ASSERTION_INVALID',
    'cleanup.post_cleanup_assertions must include Cero beneficiary_followup_status del batch.',
    'cleanup.post_cleanup_assertions',
  )

  const requiredQaFiles = new Set(manifest.qa.required_sql_qa_files)
  ;[
    'supabase/qa_phase4_5_follow_up_event_engine.sql',
    'supabase/qa_phase4_6_operational_coverage_workspace.sql',
    'supabase/qa_phase4_7_canonical_hardening.sql',
  ].forEach((requiredFile) => {
    pushIf(
      violations,
      !requiredQaFiles.has(requiredFile),
      'QA_FILE_MISSING',
      `Missing required QA file ${requiredFile}`,
      'qa.required_sql_qa_files',
    )
  })

  pushIf(
    violations,
    !manifest.identity.source_documents.includes('docs/phase4_8_seed_runtime_spec.md'),
    'SOURCE_DOCUMENT_MISSING',
    'source_documents must include docs/phase4_8_seed_runtime_spec.md',
    'identity.source_documents',
  )

  const coverageExpectations = manifest.coverage_expectations
  const expectedCoverageCounts: Array<[number, number, string, string]> = [
    [coverageExpectations.al_dia.count, 12, 'COVERAGE_EXPECTATION_AL_DIA_INVALID', 'coverage_expectations.al_dia.count'],
    [coverageExpectations.pendiente.count, 12, 'COVERAGE_EXPECTATION_PENDIENTE_INVALID', 'coverage_expectations.pendiente.count'],
    [coverageExpectations.urgente.count, 12, 'COVERAGE_EXPECTATION_URGENTE_INVALID', 'coverage_expectations.urgente.count'],
    [coverageExpectations.sin_contacto.count, 12, 'COVERAGE_EXPECTATION_SIN_CONTACTO_INVALID', 'coverage_expectations.sin_contacto.count'],
  ]

  expectedCoverageCounts.forEach(([actual, expected, code, fieldPath]) => {
    pushIf(violations, actual !== expected, code, `Expected ${expected} but found ${actual}`, fieldPath)
  })

  if (manifest.environment.environment_name !== 'preproduction_controlled') {
    warnings.push(
      createViolation('warning', 'ENVIRONMENT_NAME_UNEXPECTED', 'Manifest environment_name differs from expected preproduction_controlled', 'environment.environment_name'),
    )
  }

  return { violations, warnings }
}