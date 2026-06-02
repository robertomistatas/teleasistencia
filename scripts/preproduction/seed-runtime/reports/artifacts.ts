import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ActivationDecision, DependencyPlan, ExecutionJournal, PreflightReport } from '../types.js'

export interface ArtifactPaths {
  batchDirectory: string
  runsDirectory: string
  runDirectory: string
  latestDirectory: string
}

export function resolveArtifactPaths(batchId: string, runId: string): ArtifactPaths {
  const batchDirectory = path.resolve('artifacts', 'preproduction', batchId)
  const runsDirectory = path.join(batchDirectory, 'runs')
  const runDirectory = path.join(runsDirectory, runId)
  const latestDirectory = path.join(batchDirectory, 'latest')

  return {
    batchDirectory,
    runsDirectory,
    runDirectory,
    latestDirectory,
  }
}

async function writeJson(filePath: string, contents: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

export async function writeArtifacts(
  paths: ArtifactPaths,
  journal: ExecutionJournal,
  preflightReport: PreflightReport,
  dependencyPlan: DependencyPlan,
  activationDecision: ActivationDecision,
): Promise<void> {
  await mkdir(paths.runDirectory, { recursive: true })
  await mkdir(paths.latestDirectory, { recursive: true })

  await writeJson(path.join(paths.runDirectory, 'execution_journal.json'), journal)
  await writeJson(path.join(paths.runDirectory, 'preflight_report.json'), preflightReport)
  await writeJson(path.join(paths.runDirectory, 'dependency_plan.json'), dependencyPlan)
  await writeJson(path.join(paths.runDirectory, 'activation_decision.json'), activationDecision)

  await writeJson(path.join(paths.latestDirectory, 'execution_journal.json'), journal)
  await writeJson(path.join(paths.latestDirectory, 'preflight_report.json'), preflightReport)
  await writeJson(path.join(paths.latestDirectory, 'dependency_plan.json'), dependencyPlan)
  await writeJson(path.join(paths.latestDirectory, 'activation_decision.json'), activationDecision)
}