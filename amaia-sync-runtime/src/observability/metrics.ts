import { createServer, type Server } from 'node:http'
import client from 'prom-client'

export interface HealthInfo {
  engineInstanceId: string
  uptimeSeconds: () => number
  getPoolState?: () => string | null
}

export interface MetricsServer {
  start(port: number): Promise<void>
  stop(): Promise<void>
  inc(name: string, labels?: Record<string, string>): void
  set(name: string, value: number, labels?: Record<string, string>): void
}

export function createMetricsServer(hostname: string, health: HealthInfo): MetricsServer {
  const registry = new client.Registry()
  client.collectDefaultMetrics({ register: registry })

  const engineInfo = new client.Gauge({
    name: 'amaia_sync_engine_info',
    help: 'Runtime identification',
    labelNames: ['version', 'node_version', 'hostname'],
    registers: [registry],
  })
  engineInfo.set(
    {
      version: '0.1.0',
      node_version: process.version,
      hostname,
    },
    1,
  )

  const uptimeGauge = new client.Gauge({
    name: 'amaia_sync_engine_uptime_seconds',
    help: 'Seconds since engine.start',
    registers: [registry],
  })
  uptimeGauge.set(0)

  const cyclesTotal = new client.Counter({
    name: 'amaia_sync_cycles_total',
    help: 'Cycle completion counter',
    labelNames: ['status'],
    registers: [registry],
  })
  // M3: explicitly initialize so the metric appears in /metrics from Sprint 0
  cyclesTotal.inc(0)

  // Sprint 1 metrics
  const dbPoolErrors = new client.Counter({
    name: 'amaia_sync_db_pool_errors_total',
    help: 'Pool error events on idle connections',
    registers: [registry],
  })
  dbPoolErrors.inc(0)

  const dbClientDestroys = new client.Counter({
    name: 'amaia_sync_db_client_destroys_total',
    help: 'Confirmed intentional client destructions',
    registers: [registry],
  })
  dbClientDestroys.inc(0)

  const dbQueryTimeouts = new client.Counter({
    name: 'amaia_sync_db_query_timeouts_total',
    help: 'Query timeouts by tier',
    labelNames: ['tier'],
    registers: [registry],
  })
  dbQueryTimeouts.inc(0)

  const dbSelfDeadlocks = new client.Counter({
    name: 'amaia_sync_db_self_deadlocks_prevented_total',
    help: 'State guard rejections',
    registers: [registry],
  })
  dbSelfDeadlocks.inc(0)

  const dbPoolPoisoned = new client.Counter({
    name: 'amaia_sync_db_pool_poisoned_total',
    help: 'POISONED state entries',
    registers: [registry],
  })
  dbPoolPoisoned.inc(0)

  const dbProbeDuration = new client.Gauge({
    name: 'amaia_sync_db_probe_duration_seconds',
    help: 'Startup probe latency',
    registers: [registry],
  })

  const gauges = new Map<string, client.Gauge>([
    ['amaia_sync_engine_uptime_seconds', uptimeGauge],
    ['amaia_sync_db_probe_duration_seconds', dbProbeDuration],
  ])

  const counters = new Map<string, client.Counter>([
    ['amaia_sync_cycles_total', cyclesTotal],
    ['amaia_sync_db_pool_errors_total', dbPoolErrors],
    ['amaia_sync_db_client_destroys_total', dbClientDestroys],
    ['amaia_sync_db_query_timeouts_total', dbQueryTimeouts],
    ['amaia_sync_db_self_deadlocks_prevented_total', dbSelfDeadlocks],
    ['amaia_sync_db_pool_poisoned_total', dbPoolPoisoned],
  ])

  let server: Server | null = null

  return {
    start(port: number): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server = createServer(async (req, res) => {
          if (req.url === '/metrics' && req.method === 'GET') {
            try {
              const metrics = await registry.metrics()
              res.writeHead(200, { 'Content-Type': registry.contentType })
              res.end(metrics)
            } catch {
              res.writeHead(500)
              res.end()
            }
          } else if (req.url === '/health' && req.method === 'GET') {
            const poolState = health.getPoolState?.() ?? null
            const isPoisoned = poolState === 'POISONED'
            const statusCode = isPoisoned ? 503 : 200
            const body = JSON.stringify({
              status: isPoisoned ? 'poisoned' : 'ok',
              engine_instance_id: health.engineInstanceId,
              uptime_seconds: Math.round(health.uptimeSeconds()),
              ...(isPoisoned && { restart_required: true }),
              ...(poolState && { pool_state: poolState }),
            })
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(body)
          } else {
            res.writeHead(404)
            res.end()
          }
        })

        server.on('error', reject)
        server.listen(port, () => resolve())
      })
    },

    stop(): Promise<void> {
      return new Promise<void>((resolve) => {
        if (!server) {
          resolve()
          return
        }
        const timeout = setTimeout(() => {
          server?.close()
          resolve()
        }, 5000)
        server.close(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
    },

    inc(name: string, labels?: Record<string, string>): void {
      const counter = counters.get(name)
      if (counter) {
        if (labels) counter.inc(labels)
        else counter.inc()
      }
    },

    set(name: string, value: number, labels?: Record<string, string>): void {
      const gauge = gauges.get(name)
      if (gauge) {
        if (labels) gauge.set(labels, value)
        else gauge.set(value)
      }
    },
  }
}
