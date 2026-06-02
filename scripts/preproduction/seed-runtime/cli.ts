import { RuntimeError } from './errors.js'
import { ALLOWED_MODES, type CliOptions, type RuntimeMode } from './types.js'

const REQUIRED_FLAGS = ['mode', 'manifest', 'env', 'requested-by'] as const

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(`--${flag}`)
  if (index === -1) {
    return undefined
  }

  return args[index + 1]
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`)
}

export function parseCliArgs(argv: string[]): CliOptions {
  for (const flag of REQUIRED_FLAGS) {
    if (!hasFlag(argv, flag)) {
      throw new RuntimeError('CLI_VALIDATION_ERROR', `Missing required flag --${flag}`)
    }
  }

  const mode = readFlagValue(argv, 'mode')
  if (!mode || !ALLOWED_MODES.includes(mode as RuntimeMode)) {
    throw new RuntimeError('CLI_VALIDATION_ERROR', 'Invalid --mode value', { mode })
  }

  const manifestPath = readFlagValue(argv, 'manifest')
  const targetEnvironment = readFlagValue(argv, 'env')
  const requestedBy = readFlagValue(argv, 'requested-by')

  if (!manifestPath || !targetEnvironment || !requestedBy) {
    throw new RuntimeError('CLI_VALIDATION_ERROR', 'Missing required CLI values')
  }

  return {
    mode: mode as RuntimeMode,
    manifestPath,
    targetEnvironment,
    requestedBy,
    strict: hasFlag(argv, 'strict'),
    runId: readFlagValue(argv, 'run-id'),
    dryRun: hasFlag(argv, 'dry-run'),
  }
}