import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { loadConfig, safeDbUrlSummary, type RuntimeConfig } from './config/config.js'
import { buildDomainRegistry, type DomainRegistry } from './config/domain-registry.js'
import { createLogger, emitFallbackLog, type Logger } from './observability/logger.js'
import { createMetricsServer, type MetricsServer } from './observability/metrics.js'
import { createPgClient, type PgClient, type ShutdownResult } from './repositories/pg-client.js'

// Step 1–2: Engine identity (immutable for process lifetime)
const engineInstanceId: string = randomUUID()
const currentHostname: string = os.hostname()
const pid: number = process.pid
const ownerIdentity: string = `engine:${engineInstanceId}:${currentHostname}:${pid}`

// Mutable state for shutdown coordination
let logger: Logger | null = null
let metricsServer: MetricsServer | null = null
let pgClientInstance: PgClient | null = null
let config: RuntimeConfig | null = null
let shuttingDown = false
let running = true
let startTimestamp: number = 0

function elapsedSeconds(): number {
  if (startTimestamp === 0) return 0
  return (Date.now() - startTimestamp) / 1000
}

// --- Shutdown handler (Blueprint v1.5 §12.2) ---

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  running = false

  if (logger) {
    logger.info('engine.shutdown', { signal })
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'info', 'engine.shutdown', { signal })
  }

  let exitCode = 0

  if (pgClientInstance) {
    try {
      const result: ShutdownResult = await pgClientInstance.shutdown(75_000)
      if (result.reason === 'POISONED' || result.reason === 'TIMEOUT') {
        exitCode = 1
      }
    } catch (err) {
      if (logger) {
        logger.error('engine.shutdown_error', { component: 'pgClient', error: String(err) })
      }
      exitCode = 1
    }
  }

  if (exitCode !== 0) {
    process.exit(exitCode)
  }

  if (metricsServer) {
    try {
      await metricsServer.stop()
    } catch (err) {
      if (logger) {
        logger.error('engine.shutdown_error', { component: 'metrics', error: String(err) })
      } else {
        emitFallbackLog(engineInstanceId, ownerIdentity, 'error', 'engine.shutdown_error', {
          component: 'metrics',
          error: String(err),
        })
      }
    }
  }

  if (logger) {
    logger.info('engine.shutdown_complete')
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'info', 'engine.shutdown_complete', {})
  }

  process.exit(0)
}

// Step 3–4: Register signal handlers immediately after identity
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Step 5: uncaughtException handler
process.on('uncaughtException', (err: Error) => {
  running = false
  shuttingDown = true
  const detail: Record<string, unknown> = {
    error: err.message,
    stack: err.stack ?? null,
    trigger: 'uncaughtException',
  }
  if (logger) {
    logger.fatal('engine.fatal', detail)
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'fatal', 'engine.fatal', detail)
  }
  if (metricsServer) {
    metricsServer
      .stop()
      .catch(() => {})
      .finally(() => process.exit(1))
  } else {
    process.exit(1)
  }
})

// Step 6: unhandledRejection handler
process.on('unhandledRejection', (reason: unknown) => {
  running = false
  shuttingDown = true
  const detail: Record<string, unknown> = { trigger: 'unhandledRejection' }
  if (reason instanceof Error) {
    detail.error = reason.message
    detail.stack = reason.stack ?? null
  } else {
    detail.error = String(reason)
  }
  if (logger) {
    logger.fatal('engine.fatal', detail)
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'fatal', 'engine.fatal', detail)
  }
  if (metricsServer) {
    metricsServer
      .stop()
      .catch(() => {})
      .finally(() => process.exit(1))
  } else {
    process.exit(1)
  }
})

// --- onPoisoned callback (Blueprint v1.5 §8.6A) ---
const onPoisoned = (): void => {
  running = false
  setImmediate(() => shutdown('POISONED'))
}

// --- Bootstrap ---

async function bootstrap(): Promise<void> {
  // Step 7: Load and validate configuration
  config = loadConfig()

  // Step 8: Build domain registry
  const registry: DomainRegistry = buildDomainRegistry()

  // Step 9: Create logger
  logger = createLogger(engineInstanceId, ownerIdentity, config.syncLogLevel)

  // Step 10: Log engine.config_loaded (non-secret values only)
  logger.info('engine.config_loaded', {
    supabase_db_target: safeDbUrlSummary(config.supabaseDbUrl),
    amaia_mysql_host: config.amaiaMysqlHost,
    amaia_mysql_port: config.amaiaMysqlPort,
    sync_cycle_interval_ms: config.syncCycleIntervalMs,
    sync_safety_lag_id: config.syncSafetyLagId,
    sync_lease_ttl_seconds: config.syncLeaseTtlSeconds,
    sync_batch_size: config.syncBatchSize,
    sync_max_window: config.syncMaxWindow,
    sync_pre_run_stale_ttl_seconds: config.syncPreRunStaleTtlSeconds,
    sync_log_level: config.syncLogLevel,
    metrics_port: config.metricsPort,
    enable_idle_tick_logs: config.enableIdleTickLogs,
  })

  // Step 11: Log engine.domains_registered
  const validatedDomains = registry.getValidatedDomains()
  logger.info('engine.domains_registered', {
    domains: validatedDomains.map((d) => ({
      name: d.name,
      amaia_table: d.amaiaTable,
      supabase_table: d.supabaseTable,
      validated_append_only: d.validatedAppendOnly,
      validation_evidence: d.validationEvidence,
    })),
    count: validatedDomains.length,
  })

  // Sprint 1 Step 10: Create metrics server (before PgClient so metrics are available)
  metricsServer = createMetricsServer(currentHostname, {
    engineInstanceId,
    uptimeSeconds: elapsedSeconds,
    getPoolState: () => pgClientInstance?.getState() ?? null,
  })

  // Sprint 1 Step 10: Create PgClient (pool object)
  pgClientInstance = createPgClient({
    connectionString: config.supabaseDbUrl,
    logger,
    metrics: metricsServer,
    onPoisoned,
  })

  // Sprint 1 Step 11: Run startup connectivity probe
  await pgClientInstance.probe()

  // Step 14: Start metrics HTTP server
  await metricsServer.start(config.metricsPort)

  // Step 15: Log engine.start
  logger.info('engine.start', {
    engine_instance_id: engineInstanceId,
    owner_identity: ownerIdentity,
    metrics_port: config.metricsPort,
  })

  // Step 16: Record startup timestamp
  startTimestamp = Date.now()

  // Step 17: Enter idle loop
  while (running) {
    if (config.enableIdleTickLogs) {
      logger.info('engine.tick', { uptime_seconds: elapsedSeconds() })
    }
    metricsServer.set('amaia_sync_engine_uptime_seconds', elapsedSeconds())
    await sleep(config.syncCycleIntervalMs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- Entry point ---

bootstrap().catch((err: unknown) => {
  const errorStr = err instanceof Error ? err.message : String(err)
  if (logger) {
    logger.fatal('engine.fatal', { error: errorStr })
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'fatal', 'engine.fatal', {
      error: errorStr,
    })
  }
  process.exit(1)
})
