import type { ActivationDecision, CliOptions, ExecutionJournal, ExecutionJournalPhase, LoadedManifest } from '../types.js'

export function createExecutionJournal(cliOptions: CliOptions, loadedManifest: LoadedManifest): ExecutionJournal {
  return {
    run_id: cliOptions.runId ?? '',
    batch_id: loadedManifest.manifest.identity.batch_id,
    mode: cliOptions.mode,
    target_environment: cliOptions.targetEnvironment,
    requested_by: cliOptions.requestedBy,
    started_at: new Date().toISOString(),
    completed_at: null,
    runtime_status: 'running',
    manifest_fingerprint: loadedManifest.manifestFingerprint,
    phase_history: [],
    final_decision: null,
  }
}

export function startPhase(journal: ExecutionJournal, phase: string, details?: Record<string, unknown>): void {
  journal.phase_history.push({
    phase,
    status: 'started',
    started_at: new Date().toISOString(),
    completed_at: null,
    details,
  })
}

function findOpenPhase(journal: ExecutionJournal, phase: string): ExecutionJournalPhase {
  const openPhase = [...journal.phase_history]
    .reverse()
    .find((entry) => entry.phase === phase && entry.status === 'started' && entry.completed_at === null)

  if (!openPhase) {
    throw new Error(`Cannot close unknown phase ${phase}`)
  }

  return openPhase
}

export function completePhase(
  journal: ExecutionJournal,
  phase: string,
  status: 'completed' | 'failed',
  details?: Record<string, unknown>,
): void {
  const openPhase = findOpenPhase(journal, phase)
  openPhase.status = status
  openPhase.completed_at = new Date().toISOString()
  openPhase.details = {
    ...openPhase.details,
    ...details,
  }
}

export function finalizeJournal(
  journal: ExecutionJournal,
  runtimeStatus: ExecutionJournal['runtime_status'],
  activationDecision: ActivationDecision,
): void {
  journal.completed_at = new Date().toISOString()
  journal.runtime_status = runtimeStatus
  journal.final_decision = activationDecision
}