import path from 'node:path'

import type { CliOptions, LoadedManifest, PreflightCheck, PreflightReport, ValidatorResult } from '../types.js'

function createCheck(
  name: string,
  result: PreflightCheck['result'],
  blocking: boolean,
  message: string,
  details?: Record<string, unknown>,
): PreflightCheck {
  return {
    name,
    result,
    blocking,
    message,
    details,
  }
}

export function createPreflightReport(
  cliOptions: CliOptions,
  loadedManifest: LoadedManifest,
  validatorResult: ValidatorResult,
  artifactsRunDirectory: string,
): PreflightReport {
  const checks: PreflightCheck[] = []

  checks.push(createCheck('manifest_accessible', 'pass', true, 'Manifest file resolved', { manifestPath: loadedManifest.manifestPath }))
  checks.push(createCheck('manifest_parseable', 'pass', true, 'Manifest JSON parsed successfully'))

  checks.push(
    createCheck(
      'manifest_semantic_validation',
      validatorResult.violations.length === 0 ? 'pass' : 'fail',
      true,
      validatorResult.violations.length === 0
        ? 'Manifest semantic validation passed'
        : 'Manifest semantic validation failed',
      {
        violations: validatorResult.violations,
        warnings: validatorResult.warnings,
      },
    ),
  )

  checks.push(
    createCheck(
      'environment_name_matches',
      loadedManifest.manifest.environment.environment_name === cliOptions.targetEnvironment ? 'pass' : 'fail',
      true,
      loadedManifest.manifest.environment.environment_name === cliOptions.targetEnvironment
        ? 'CLI environment matches manifest environment_name'
        : 'CLI environment does not match manifest environment_name',
      {
        manifestEnvironment: loadedManifest.manifest.environment.environment_name,
        cliEnvironment: cliOptions.targetEnvironment,
      },
    ),
  )

  const qaDeclared = loadedManifest.manifest.qa.required_sql_qa_files.length >= 3
  checks.push(createCheck('qa_files_declared', qaDeclared ? 'pass' : 'fail', true, qaDeclared ? 'Required QA files declared' : 'Required QA files missing'))

  const sourceDocumentsDeclared = loadedManifest.manifest.identity.source_documents.length > 0
  checks.push(
    createCheck(
      'source_documents_declared',
      sourceDocumentsDeclared ? 'pass' : 'fail',
      true,
      sourceDocumentsDeclared ? 'Source documents declared' : 'Source documents missing',
    ),
  )

  checks.push(
    createCheck('artifacts_path_resolvable', path.isAbsolute(artifactsRunDirectory) ? 'pass' : 'fail', true, 'Artifacts path resolved', {
      artifactsRunDirectory,
    }),
  )

  ;[
    'duplicate_batch_db',
    'marker_conflict_db',
    'user_email_conflict_db',
    'rut_conflict_db',
    'phone_conflict_db',
    'cleanup_incomplete_db',
    'partial_run_consistency_db',
  ].forEach((name) => {
    checks.push(createCheck(name, 'not_implemented', false, 'Deferred to later runtime phase; not implemented in 4.8B'))
  })

  const hasBlockingFailure = checks.some((check) => check.blocking && check.result === 'fail')
  const hasNotImplemented = checks.some((check) => check.result === 'not_implemented')

  return {
    run_id: cliOptions.runId ?? '',
    batch_id: loadedManifest.manifest.identity.batch_id,
    mode: cliOptions.mode,
    generated_at: new Date().toISOString(),
    result: hasBlockingFailure ? 'fail' : hasNotImplemented ? 'warning' : 'pass',
    checks,
  }
}