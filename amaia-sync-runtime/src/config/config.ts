import { ConfigurationError } from '../errors/error-types.js'

export interface RuntimeConfig {
  supabaseDbUrl: string

  amaiaMysqlHost: string
  amaiaMysqlPort: number
  amaiaMysqlUser: string
  amaiaMysqlPassword: string
  amaiaMysqlDatabase: string

  syncCycleIntervalMs: number
  syncSafetyLagId: number
  syncLeaseTtlSeconds: number
  syncBatchSize: number
  syncMaxWindow: number
  syncPreRunStaleTtlSeconds: number

  syncLogLevel: 'info' | 'warn' | 'error'
  metricsPort: number
  enableIdleTickLogs: boolean
}

const BLOCKED_USERS = ['postgres', 'supabase_admin', 'service_role']
const VALID_LOG_LEVELS = ['info', 'warn', 'error'] as const

export function validateSupabaseDbUrl(raw: string): string[] {
  const errors: string[] = []
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return ['SUPABASE_DB_URL: not a valid URL']
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    errors.push(
      `SUPABASE_DB_URL: scheme must be postgres:// or postgresql://, got ${parsed.protocol}`,
    )
  }
  if (!parsed.hostname) {
    errors.push('SUPABASE_DB_URL: host is empty')
  }
  if (!parsed.pathname || parsed.pathname === '/') {
    errors.push('SUPABASE_DB_URL: database name is empty')
  }
  if (!parsed.username) {
    errors.push('SUPABASE_DB_URL: username is empty')
  }
  // OBS-3: normalize username before checking blocked list
  const normalizedUser = parsed.username
    ? decodeURIComponent(parsed.username).toLowerCase()
    : ''
  if (normalizedUser && BLOCKED_USERS.includes(normalizedUser)) {
    errors.push(
      `SUPABASE_DB_URL: privileged user '${normalizedUser}' is blocked — use amaia_sync_runtime role`,
    )
  }
  return errors
}

export function safeDbUrlSummary(raw: string): string {
  try {
    const parsed = new URL(raw)
    return `${parsed.protocol}//${parsed.hostname}`
  } catch {
    return '<invalid URL>'
  }
}

function requireString(
  env: NodeJS.ProcessEnv,
  key: string,
  errors: string[],
): string {
  const val = env[key]
  if (!val || val.trim() === '') {
    errors.push(`${key}: required but missing or empty`)
    return ''
  }
  return val.trim()
}

function optionalInt(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultVal: number,
  min: number,
  max: number,
  errors: string[],
): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return defaultVal
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    errors.push(`${key}: must be an integer, got '${raw}'`)
    return defaultVal
  }
  if (parsed < min || parsed > max) {
    errors.push(`${key}: must be between ${min} and ${max}, got ${parsed}`)
    return defaultVal
  }
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const errors: string[] = []

  // Required strings
  const supabaseDbUrl = requireString(env, 'SUPABASE_DB_URL', errors)
  if (supabaseDbUrl) {
    errors.push(...validateSupabaseDbUrl(supabaseDbUrl))
  }

  const amaiaMysqlHost = requireString(env, 'AMAIA_MYSQL_HOST', errors)
  const amaiaMysqlUser = requireString(env, 'AMAIA_MYSQL_USER', errors)
  const amaiaMysqlPassword = requireString(env, 'AMAIA_MYSQL_PASSWORD', errors)
  const amaiaMysqlDatabase = requireString(env, 'AMAIA_MYSQL_DATABASE', errors)

  // Optional numerics
  const amaiaMysqlPort = optionalInt(env, 'AMAIA_MYSQL_PORT', 3306, 1, 65535, errors)
  const syncCycleIntervalMs = optionalInt(env, 'SYNC_CYCLE_INTERVAL_MS', 60000, 1000, Number.MAX_SAFE_INTEGER, errors)
  const syncSafetyLagId = optionalInt(env, 'SYNC_SAFETY_LAG_ID', 100, 0, Number.MAX_SAFE_INTEGER, errors)
  const syncLeaseTtlSeconds = optionalInt(env, 'SYNC_LEASE_TTL_SECONDS', 300, 60, Number.MAX_SAFE_INTEGER, errors)
  const syncBatchSize = optionalInt(env, 'SYNC_BATCH_SIZE', 1000, 1, 50000, errors)
  const syncMaxWindow = optionalInt(env, 'SYNC_MAX_WINDOW', 10000, 1, 100000, errors)
  const syncPreRunStaleTtlSeconds = optionalInt(env, 'SYNC_PRE_RUN_STALE_TTL_SECONDS', 600, 60, Number.MAX_SAFE_INTEGER, errors)
  const metricsPort = optionalInt(env, 'METRICS_PORT', 9090, 1, 65535, errors)

  // SYNC_LOG_LEVEL
  let syncLogLevel: 'info' | 'warn' | 'error' = 'info'
  const rawLogLevel = env['SYNC_LOG_LEVEL']
  if (rawLogLevel !== undefined && rawLogLevel !== '') {
    const lower = rawLogLevel.toLowerCase()
    if (!VALID_LOG_LEVELS.includes(lower as typeof VALID_LOG_LEVELS[number])) {
      errors.push(`SYNC_LOG_LEVEL: must be one of [info, warn, error], got '${rawLogLevel}'`)
    } else {
      syncLogLevel = lower as 'info' | 'warn' | 'error'
    }
  }

  // ENABLE_IDLE_TICK_LOGS
  let enableIdleTickLogs = false
  const rawTickLogs = env['ENABLE_IDLE_TICK_LOGS']
  if (rawTickLogs !== undefined && rawTickLogs !== '') {
    const lower = rawTickLogs.toLowerCase()
    if (lower === 'true') {
      enableIdleTickLogs = true
    } else if (lower === 'false') {
      enableIdleTickLogs = false
    } else {
      errors.push(`ENABLE_IDLE_TICK_LOGS: must be 'true' or 'false', got '${rawTickLogs}'`)
    }
  }

  if (errors.length > 0) {
    throw new ConfigurationError(
      `Configuration validation failed (${errors.length} error${errors.length > 1 ? 's' : ''})`,
      errors,
    )
  }

  const config: RuntimeConfig = {
    supabaseDbUrl,
    amaiaMysqlHost,
    amaiaMysqlPort,
    amaiaMysqlUser,
    amaiaMysqlPassword,
    amaiaMysqlDatabase,
    syncCycleIntervalMs,
    syncSafetyLagId,
    syncLeaseTtlSeconds,
    syncBatchSize,
    syncMaxWindow,
    syncPreRunStaleTtlSeconds,
    syncLogLevel,
    metricsPort,
    enableIdleTickLogs,
  }

  return Object.freeze(config)
}
