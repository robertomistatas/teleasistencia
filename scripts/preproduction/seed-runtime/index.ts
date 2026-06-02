import { randomUUID } from 'node:crypto'

import { parseCliArgs } from './cli.js'
import { RuntimeError, isRuntimeError } from './errors.js'
import { createExecutionJournal, completePhase, finalizeJournal, startPhase } from './journal/journal.js'
import { loadManifest } from './manifest/loader.js'
import { validateManifest } from './manifest/validator.js'
import { createDependencyPlan } from './planning/dependency-plan.js'
import { createPreflightReport } from './preflight/preflight.js'
import { resolveArtifactPaths, writeArtifacts } from './reports/artifacts.js'
import type { ActivationDecision, CliOptions, ExecutionJournal, LoadedManifest, PlanRuntimeResult } from './types.js'

function createRunId(batchId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '__').replace('Z', '')
  return `${batchId}__plan__${timestamp}__${randomUUID().slice(0, 8)}`
}

function createActivationDecision(
  cliOptions: CliOptions,
  loadedManifest: LoadedManifest,
  preflightResult: 'pass' | 'warning' | 'fail',
): ActivationDecision {
  const reasons =
    preflightResult === 'fail'
      ? ['Plan mode blocked because local manifest or environment validation failed.']
      : preflightResult === 'warning'
        ? ['Plan mode completed with non-blocking not_implemented checks.']
        : ['Plan mode completed successfully.']

  return {
    run_id: cliOptions.runId ?? '',
    batch_id: loadedManifest.manifest.identity.batch_id,
    mode: cliOptions.mode,
    activation_eligible: false,
    decision: preflightResult === 'fail' ? 'blocked' : 'plan_ready',
    result: preflightResult,
    reasons,
    generated_at: new Date().toISOString(),
  }
}

async function runPlanMode(cliOptions: CliOptions): Promise<PlanRuntimeResult> {
  const loadedManifest = await loadManifest(cliOptions.manifestPath)
  cliOptions.runId = cliOptions.runId ?? createRunId(loadedManifest.manifest.identity.batch_id)

  const journal = createExecutionJournal(cliOptions, loadedManifest)

  startPhase(journal, 'load_manifest')
  completePhase(journal, 'load_manifest', 'completed', {
    manifestPath: loadedManifest.manifestPath,
  })

  startPhase(journal, 'validate_manifest')
  const validatorResult = validateManifest(loadedManifest.manifest)
  if (validatorResult.violations.length > 0) {
    completePhase(journal, 'validate_manifest', 'failed', {
      violations: validatorResult.violations,
      warnings: validatorResult.warnings,
    })
    throw new RuntimeError('MANIFEST_VALIDATION_FAILED', 'Manifest validation failed', {
      violations: validatorResult.violations,
      warnings: validatorResult.warnings,
      journal,
      loadedManifest,
    })
  }

  completePhase(journal, 'validate_manifest', 'completed', {
    violations: validatorResult.violations,
    warnings: validatorResult.warnings,
  })

  const artifactPaths = resolveArtifactPaths(loadedManifest.manifest.identity.batch_id, cliOptions.runId)

  startPhase(journal, 'preflight')
  const preflightReport = createPreflightReport(cliOptions, loadedManifest, validatorResult, artifactPaths.runDirectory)
  completePhase(journal, 'preflight', preflightReport.result === 'fail' ? 'failed' : 'completed', {
    result: preflightReport.result,
  })

  if (preflightReport.result === 'fail') {
    throw new RuntimeError('PREFLIGHT_FAILED', 'Preflight checks failed', {
      preflightReport,
      journal,
      loadedManifest,
    })
  }

  startPhase(journal, 'dependency_plan')
  const dependencyPlan = createDependencyPlan(loadedManifest)
  completePhase(journal, 'dependency_plan', 'completed', {
    plannedEntities: dependencyPlan.planned_entities,
  })

  const activationDecision = createActivationDecision(cliOptions, loadedManifest, preflightReport.result)
  finalizeJournal(
    journal,
    preflightReport.result === 'warning' ? 'completed_with_warnings' : 'completed',
    activationDecision,
  )

  preflightReport.run_id = cliOptions.runId

  await writeArtifacts(artifactPaths, journal, preflightReport, dependencyPlan, activationDecision)

  return {
    journal,
    preflightReport,
    dependencyPlan,
    activationDecision,
  }
}

function formatResult(result: PlanRuntimeResult): Record<string, unknown> {
  return {
    run_id: result.journal.run_id,
    batch_id: result.journal.batch_id,
    mode: result.journal.mode,
    runtime_status: result.journal.runtime_status,
    manifest_fingerprint: result.journal.manifest_fingerprint,
    preflight_result: result.preflightReport.result,
    activation_decision: result.activationDecision.decision,
    artifacts_generated: true,
  }
}

function extractJournal(error: RuntimeError): ExecutionJournal | undefined {
  const journal = error.details?.journal
  if (journal && typeof journal === 'object') {
    return journal as ExecutionJournal
  }

  return undefined
}

async function main(): Promise<void> {
  const cliOptions = parseCliArgs(process.argv.slice(2))

  if (cliOptions.mode !== 'plan') {
    throw new RuntimeError('MODE_NOT_IMPLEMENTED', `Mode ${cliOptions.mode} is not implemented in phase 4.8B`, {
      mode: cliOptions.mode,
    })
  }

  const result = await runPlanMode(cliOptions)
  console.log(JSON.stringify(formatResult(result), null, 2))
}

main().catch(async (error: unknown) => {
  if (isRuntimeError(error)) {
    const journal = extractJournal(error)
    if (journal) {
      journal.completed_at = new Date().toISOString()
      journal.runtime_status = 'failed'
    }

    console.error(
      JSON.stringify(
        {
          error_code: error.code,
          message: error.message,
          details: error.details,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
    return
  }

  console.error(error)
  process.exitCode = 1
})