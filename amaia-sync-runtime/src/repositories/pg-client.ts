import pg from 'pg'
import { SupabaseConnectionError } from '../errors/error-types.js'
import type { Logger } from '../observability/logger.js'
import type { MetricsServer } from '../observability/metrics.js'

// --- Pool Occupancy State Machine (Blueprint v1.3 §4A) ---

export type PoolState =
  | 'IDLE'
  | 'ACQUIRING'
  | 'CHECKED_OUT'
  | 'QUERYING'
  | 'DRAINING'
  | 'DESTROYING'
  | 'DONE'
  | 'POISONED'

export type DrainCompletionReason =
  | 'NORMAL'
  | 'SHUTDOWN_ABORT'
  | 'POISONED'
  | 'TIMEOUT'

export interface ShutdownResult {
  reason: DrainCompletionReason
}

export interface PgClientConfig {
  connectionString: string
  logger: Logger
  metrics: MetricsServer
  onPoisoned: () => void
}

export interface PgClient {
  connect(): Promise<pg.PoolClient>
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>
  shutdown(timeoutMs?: number): Promise<ShutdownResult>
  probe(): Promise<void>
  getState(): PoolState
}

const STATEMENT_TIMEOUT_MS = 30_000
const QUERY_TIMEOUT_MS = 60_000
const CONNECTION_TIMEOUT_MS = 10_000
const IDLE_TIMEOUT_MS = 30_000
const POISONED_SHUTDOWN_TIMEOUT_MS = 10_000
const DEFAULT_DRAIN_TIMEOUT_MS = 75_000
const PROBE_TIMEOUT_MS = 10_000
const PROBE_MAX_ATTEMPTS = 3
const PROBE_BASE_DELAY_MS = 1000
const PROBE_MAX_DELAY_MS = 30_000

// --- Error sanitization (Blueprint v1.1 §10.3) ---

interface PgError extends Error {
  code?: string
  severity?: string
  constraint?: string
}

function sanitizeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) }
  const e = err as PgError
  // Fix 7: detail and hint removed — may contain sensitive data (query params, row values).
  // Only message, code, severity, constraint are safe for logging.
  return {
    message: e.message,
    ...(e.code && { code: e.code }),
    ...(e.severity && { severity: e.severity }),
    ...(e.constraint && { constraint: e.constraint }),
  }
}

// --- Connection-level error classification (Blueprint v1.1 §7.5, §9.3) ---

const CONNECTION_ERROR_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '08006', // connection_failure
  '08003', // connection_does_not_exist
  '08001', // sqlclient_unable_to_establish
  '25P02', // in_failed_sql_transaction (stale aborted tx)
])

const CONNECTION_ERROR_MESSAGES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'unexpected eof',
  'connection terminated',
  'connection closed',
]

export function isConnectionLevelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const e = err as PgError
  if (e.code && CONNECTION_ERROR_CODES.has(e.code)) return true
  const msg = e.message.toLowerCase()
  return CONNECTION_ERROR_MESSAGES.some((pattern) => msg.includes(pattern.toLowerCase()))
}

// --- Factory ---

export function createPgClient(config: PgClientConfig): PgClient {
  const { logger, metrics, onPoisoned } = config

  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: 1,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    allowExitOnIdle: false,
    query_timeout: QUERY_TIMEOUT_MS,
    ssl: config.connectionString.includes('sslmode=')
      ? undefined
      : { rejectUnauthorized: true },
  })

  // State is mutated across await boundaries (shutdown may fire between awaits).
  // Use currentState() to defeat TypeScript's flow narrowing in async methods.
  let state: PoolState = 'IDLE'
  const currentState = (): PoolState => state
  let terminalShutdownReason: DrainCompletionReason | null = null
  let drainResolve: ((reason: DrainCompletionReason) => void) | null = null
  let barrierLoggedOnce = false

  // Pool error event (Blueprint v1.1 §5.4)
  pool.on('error', (err: Error) => {
    logger.error('db.pool_error', { error: sanitizeError(err) })
    metrics.inc('amaia_sync_db_pool_errors_total')
  })

  logger.info('db.pool_created', {
    max: 1,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  })

  // --- Drain signaling ---

  function signalDrain(reason: DrainCompletionReason): void {
    if (drainResolve) {
      const resolve = drainResolve
      drainResolve = null
      resolve(reason)
    }
  }

  function waitForDrainSignal(timeoutMs: number): Promise<DrainCompletionReason> {
    return new Promise<DrainCompletionReason>((resolve) => {
      drainResolve = resolve
      setTimeout(() => {
        if (drainResolve) {
          drainResolve = null
          resolve('TIMEOUT')
        }
      }, timeoutMs)
    })
  }

  // --- POISONED entry (Blueprint v1.4 §8.6, v1.5 §8.6A) ---

  function enterPoisoned(err: unknown, trigger: string, previousState: PoolState): void {
    state = 'POISONED'
    logger.fatal('db.pool_poisoned', {
      error: sanitizeError(err),
      trigger,
      previous_state: previousState,
    })
    metrics.inc('amaia_sync_db_pool_poisoned_total')
    onPoisoned()
  }

  // --- releaseRawDuringAcquisition (Blueprint v1.5 §6.1A) ---

  function releaseRawDuringAcquisition(
    rawClient: pg.PoolClient,
    reason: string,
  ): void {
    const previousState = state // OBS-FINAL-1: capture BEFORE release

    try {
      rawClient.release(true)
    } catch (releaseError) {
      enterPoisoned(releaseError, reason, previousState)
      if (previousState === 'DRAINING') signalDrain('POISONED')
      throw new SupabaseConnectionError(
        `Raw release failed during acquisition (${reason})`,
        releaseError instanceof Error ? releaseError : undefined,
      )
    }

    logger.info('db.acquisition_release', { reason })
    if (previousState === 'ACQUIRING') state = 'IDLE'
    if (previousState === 'DRAINING') signalDrain('SHUTDOWN_ABORT')
  }

  // --- Wrapped release installer (Blueprint v1.5 §6.3) ---

  function installReleaseWrapper(rawClient: pg.PoolClient): void {
    const originalRelease = rawClient.release.bind(rawClient)
    let alreadyReleased = false

    rawClient.release = ((destroy?: boolean): void => {
      if (alreadyReleased) return
      alreadyReleased = true

      const previousState = state // OBS-FINAL-1: capture BEFORE release

      try {
        originalRelease(destroy)
      } catch (releaseError) {
        enterPoisoned(releaseError, 'wrapped_release', previousState)
        if (previousState === 'DRAINING') signalDrain('POISONED')
        throw releaseError
      }

      if (destroy) {
        metrics.inc('amaia_sync_db_client_destroys_total')
        logger.warn('db.client_destroyed')
      }

      if (previousState === 'CHECKED_OUT') state = 'IDLE'
      if (previousState === 'DRAINING') signalDrain('NORMAL')
    }) as typeof rawClient.release
  }

  // --- Race helper for POISONED shutdown ---

  async function raceWithTimeout(
    promise: Promise<void>,
    timeoutMs: number,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        logger.error('db.poisoned_shutdown_timeout', { timeout_ms: timeoutMs })
        resolve()
      }, timeoutMs)
    })
    try {
      await Promise.race([promise, timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // --- Fix 5: Query timeout classification ---

  function classifyQueryTimeout(err: unknown): void {
    if (!(err instanceof Error)) return
    const e = err as PgError
    // T2: PostgreSQL server-side statement_timeout → error code 57014 (query_canceled)
    if (e.code === '57014') {
      metrics.inc('amaia_sync_db_query_timeouts_total', { tier: 't2_statement' })
      return
    }
    // T3: Client-side query_timeout → socket abort → connection-level error patterns
    const msg = e.message.toLowerCase()
    if (
      msg.includes('query_timeout') ||
      msg.includes('timeout expired') ||
      (isConnectionLevelError(err) && msg.includes('timeout'))
    ) {
      metrics.inc('amaia_sync_db_query_timeouts_total', { tier: 't3_client' })
    }
  }

  // --- Startup probe retry (Architecture v1.8.2 §17) ---

  function jitteredDelay(attempt: number): number {
    const base = Math.min(PROBE_BASE_DELAY_MS * Math.pow(2, attempt), PROBE_MAX_DELAY_MS)
    const jitter = 1 + (Math.random() * 0.5 - 0.25) // ±25%
    return Math.round(base * jitter)
  }

  // --- Public interface ---

  const pgClient: PgClient = {
    async connect(): Promise<pg.PoolClient> {
      // Step 1: Guard
      if (state !== 'IDLE') {
        logger.error('db.self_deadlock_prevented', {
          current_state: state,
          operation: 'connect',
        })
        metrics.inc('amaia_sync_db_self_deadlocks_prevented_total')
        throw new SupabaseConnectionError(`Cannot connect: state is ${state}`)
      }

      // Step 2
      state = 'ACQUIRING'

      // Step 3: pool.connect
      let rawClient: pg.PoolClient
      try {
        rawClient = await pool.connect()
      } catch (connectError) {
        state = currentState() === 'ACQUIRING' ? 'IDLE' : currentState()
        if (currentState() === 'DRAINING') signalDrain('SHUTDOWN_ABORT')
        throw new SupabaseConnectionError(
          'PostgreSQL connection failed',
          connectError instanceof Error ? connectError : undefined,
        )
      }

      // Step 4: Connection Initialization Barrier
      try {
        await rawClient.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}'`)
      } catch (barrierError) {
        logger.error('db.connect_barrier_failed', {
          error: sanitizeError(barrierError),
        })
        releaseRawDuringAcquisition(rawClient, 'barrier_failed')
        throw new SupabaseConnectionError(
          'Connection initialization barrier failed',
          barrierError instanceof Error ? barrierError : undefined,
        )
      }

      if (!barrierLoggedOnce) {
        logger.info('db.connect_barrier_success', {
          statement_timeout: STATEMENT_TIMEOUT_MS,
        })
        barrierLoggedOnce = true
      }

      // Step 5: Shutdown recheck (C2)
      if (currentState() === 'DRAINING') {
        logger.warn('db.connect_shutdown_abort')
        releaseRawDuringAcquisition(rawClient, 'shutdown_abort')
        throw new SupabaseConnectionError('Shutdown during acquisition')
      }

      // Step 6: Wrap release
      installReleaseWrapper(rawClient)

      // Step 7
      state = 'CHECKED_OUT'

      // Step 8
      return rawClient
    },

    async query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
      // Step 1: Guard
      if (state !== 'IDLE') {
        logger.error('db.self_deadlock_prevented', {
          current_state: state,
          operation: 'query',
        })
        metrics.inc('amaia_sync_db_self_deadlocks_prevented_total')
        throw new SupabaseConnectionError(`Cannot query: state is ${state}`)
      }

      // Step 2
      state = 'QUERYING'

      try {
        return await pool.query(text, params)
      } catch (queryErr) {
        // Fix 5: detect and count T2/T3 timeouts
        classifyQueryTimeout(queryErr)
        throw queryErr
      } finally {
        // Step 3: finally — check currentState() because shutdown may have changed it
        if (currentState() === 'QUERYING') state = 'IDLE'
        if (currentState() === 'DRAINING') signalDrain('NORMAL')
      }
    },

    async shutdown(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<ShutdownResult> {
      const current = state

      // Step 2: already shutting down
      if (current === 'DESTROYING' || current === 'DONE') {
        return { reason: terminalShutdownReason ?? 'NORMAL' }
      }

      // Step 3: POISONED — Fix 4: persist reason BEFORE DESTROYING
      if (current === 'POISONED') {
        terminalShutdownReason = 'POISONED'
        state = 'DESTROYING'
        await raceWithTimeout(pool.end().catch(() => {}), POISONED_SHUTDOWN_TIMEOUT_MS)
        state = 'DONE'
        return { reason: 'POISONED' }
      }

      // Step 4: IDLE
      if (current === 'IDLE') {
        state = 'DESTROYING'
        try {
          await pool.end()
        } catch {
          // best-effort
        }
        state = 'DONE'
        logger.info('db.pool_destroyed', { drain_reason: 'NORMAL' })
        return { reason: 'NORMAL' }
      }

      // Step 5: ACQUIRING, CHECKED_OUT, QUERYING
      state = 'DRAINING'
      logger.info('db.shutdown_draining', { waiting_for_state: current })

      // Step 6: Wait for drain
      const drainReason = await waitForDrainSignal(timeoutMs)

      // Step 7: Handle drain result
      logger.info('db.shutdown_drain_complete', { reason: drainReason })

      switch (drainReason) {
        case 'NORMAL':
        case 'SHUTDOWN_ABORT': {
          state = 'DESTROYING'
          try {
            await pool.end()
          } catch {
            // best-effort
          }
          state = 'DONE'
          logger.info('db.pool_destroyed', { drain_reason: drainReason })
          return { reason: drainReason }
        }
        case 'POISONED': {
          // Fix 4: persist reason BEFORE DESTROYING
          terminalShutdownReason = 'POISONED'
          state = 'DESTROYING'
          await raceWithTimeout(pool.end().catch(() => {}), POISONED_SHUTDOWN_TIMEOUT_MS)
          state = 'DONE'
          return { reason: 'POISONED' }
        }
        case 'TIMEOUT': {
          // Fix 4: persist reason BEFORE returning
          terminalShutdownReason = 'TIMEOUT'
          logger.error('db.shutdown_drain_timeout', {
            timeout_ms: timeoutMs,
            stuck_in_state: current,
          })
          return { reason: 'TIMEOUT' }
        }
      }
    },

    async probe(): Promise<void> {
      // Probe uses pgClient.query() → IDLE→QUERYING→IDLE (state machine aware).
      // Each attempt is raced against PROBE_TIMEOUT_MS (10s) to restore the
      // startup-specific timeout without bypassing the state machine.
      const startTime = Date.now()

      for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
        try {
          await Promise.race([
            pgClient.query('SELECT 1'),
            new Promise<never>((_resolve, reject) =>
              setTimeout(
                () => reject(new SupabaseConnectionError('Startup probe timeout')),
                PROBE_TIMEOUT_MS,
              ),
            ),
          ])
          const latencyMs = Date.now() - startTime
          metrics.set('amaia_sync_db_probe_duration_seconds', latencyMs / 1000)
          logger.info('db.probe_success', { latency_ms: latencyMs })
          return
        } catch (err) {
          if (attempt < PROBE_MAX_ATTEMPTS) {
            const nextRetryMs = jitteredDelay(attempt)
            logger.warn('db.probe_failed', {
              attempt,
              max_attempts: PROBE_MAX_ATTEMPTS,
              error: sanitizeError(err),
              next_retry_ms: nextRetryMs,
            })
            await new Promise<void>((r) => setTimeout(r, nextRetryMs))
          } else {
            logger.error('db.probe_exhausted', {
              attempts: PROBE_MAX_ATTEMPTS,
              error: sanitizeError(err),
            })
            throw new SupabaseConnectionError(
              `Startup probe failed after ${PROBE_MAX_ATTEMPTS} attempts`,
              err instanceof Error ? err : undefined,
            )
          }
        }
      }
    },

    getState(): PoolState {
      return state
    },
  }

  return pgClient
}
