# AMAIA-SYNC Sprint 0 — Runtime Skeleton Blueprint v1.0

**Type:** Sprint implementation blueprint  
**Phase:** 9.4D  
**Sprint:** 0  
**Status:** Pending Codex hostile audit  
**Parent architecture:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**Parent blueprint:** AMAIA_SYNC_RUNTIME_IMPLEMENTATION_BLUEPRINT_v1.6.1 (Codex approved with observations)  
**Parent protocol:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (pending Codex audit)  
**Parent plan:** AMAIA_SYNC_RUNTIME_TYPESCRIPT_IMPLEMENTATION_PLAN_v1.1 (pending Codex re-audit)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Normative Document Review

All four normative documents were reviewed exhaustively before designing this blueprint.

### Constraints extracted and respected

| Source | Constraint | Sprint 0 compliance |
|---|---|---|
| Architecture v1.8.2 §5 | Engine identity = UUID v4 + owner_identity format | Implemented at startup |
| Architecture v1.8.2 §3 | Only control_llamadas and logestado are valid V1 domains | Domain registry enforces |
| Architecture v1.8.2 §3.3 | Fail-closed for unsupported domains. Zero valid = config error exit | Domain registry enforces |
| Architecture v1.8.2 R26 | Unvalidated domains ineligible | Append-only gate implemented |
| Architecture v1.8.2 §20 | Structured JSON logging format with specified fields | Logger implements |
| Architecture v1.8.2 §20 | Prometheus metrics with specified naming convention | Metrics implements |
| Architecture v1.8.2 §22 | Graceful shutdown: SIGTERM → stop → close → exit | Shutdown handler implements |
| Architecture v1.8.2 R1/R2 | Single scheduler, single worker | Single-process daemon |
| Blueprint v1.6.1 §3 | Module tree structure | Sprint 0 files match tree |
| Blueprint v1.6.1 §4 | Bootstrap sequence (steps 1–2, 7–10 for Sprint 0) | Implemented |
| Blueprint v1.6.1 §21 | Configuration variables with types, defaults, validation | Config module implements |
| Blueprint v1.6.1 §13.1 | `SUPABASE_DB_URL` (not SUPABASE_URL + SERVICE_KEY) for direct pg | Config validates presence |
| Implementation Plan v1.1 §8 | Sprint 0 scope: skeleton only, no business logic | Strictly enforced |
| Implementation Plan v1.1 §18 | Definition of Done criteria | Adopted |
| Implementation Plan v1.1 §19 | CI pipeline stages | Adopted |

### Contradiction analysis

| Potential issue | Analysis | Resolution |
|---|---|---|
| Architecture §22 lists `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`; Blueprint §21 lists `SUPABASE_DB_URL` | Blueprint §13.1 explicitly declares: "Direct pg driver. supabase-js not used by Runtime Engine." The Blueprint refines the Architecture's deployment table for the direct-pg strategy. | Sprint 0 uses `SUPABASE_DB_URL` per the Blueprint. No contradiction — refinement, not conflict. |
| Architecture §20 logging includes cycle_id, domain, run_id, manifest_id | These fields are context-dependent. Sprint 0 has no cycles, runs, or manifests. | Fields are optional in the logger interface. Null/omitted when not applicable. Consistent with the format — same schema, context-dependent population. |
| Architecture §15 error taxonomy is extensive; Sprint 0 limits to 4 | Implementation Plan §8 explicitly scopes Sprint 0 to skeleton errors only. | 4 error classes at Sprint 0. Remaining classes introduced in their respective sprints. No contradiction — planned incremental delivery. |

**Zero contradictions detected.**

---

## 1. Business Problem

Before synchronizing data between AMAIA and Supabase, we must validate that the runtime daemon can:

1. Bootstrap from environment configuration.
2. Validate its operational prerequisites.
3. Expose observability endpoints.
4. Wire dependencies for later injection.
5. Manage its own lifecycle (startup, idle, shutdown).
6. Respond correctly to OS signals.

This reduces infrastructure and deployment risk. A daemon that cannot start, configure itself, or shut down gracefully cannot synchronize data reliably.

## 2. Sprint Objective

Construct the minimal operational skeleton of the AMAIA-SYNC daemon.

**Demonstrate:** the Runtime can exist as a permanent, observable process.

**This sprint does NOT implement:**

- PostgreSQL connectivity or PoolClient lifecycle
- MySQL connectivity or AMAIA fetching
- Scheduler lease or domain lease
- Cycle creation or domain iteration
- Run lifecycle or manifest evidence
- Recovery or operational error channel
- Watermark or CAS advancement
- Any synchronization logic

## 3. Artifacts

```
amaia-sync-runtime/
├── src/
│   ├── index.ts                          ← Bootstrap + daemon loop + shutdown
│   ├── config/
│   │   ├── config.ts                     ← Environment loading + validation
│   │   └── domain-registry.ts            ← Domain definitions + append-only gate
│   ├── observability/
│   │   ├── logger.ts                     ← Structured JSON logger
│   │   └── metrics.ts                    ← Prometheus metrics + HTTP endpoint
│   └── errors/
│       └── error-types.ts                ← Sprint 0 error taxonomy
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

This matches the Blueprint v1.6.1 §3 module tree for the Sprint 0 subset.

---

## 4. Module Specifications

### 4.1 Configuration — `src/config/config.ts`

#### Responsibility

Load environment variables, validate required variables, apply defaults, expose typed configuration. Fail fast on invalid configuration.

#### Interface

```typescript
interface RuntimeConfig {
  // PostgreSQL (validated at startup, used from Sprint 1)
  supabaseDbUrl: string

  // MySQL (validated at startup, used from Sprint 6)
  amaiaMysqlHost: string
  amaiaMysqlPort: number
  amaiaMysqlUser: string
  amaiaMysqlPassword: string
  amaiaMysqlDatabase: string

  // Sync behavior
  syncCycleIntervalMs: number
  syncSafetyLagId: number
  syncLeaseTtlSeconds: number
  syncBatchSize: number
  syncMaxWindow: number
  syncPreRunStaleTtlSeconds: number

  // Observability
  syncLogLevel: 'info' | 'warn' | 'error'
  metricsPort: number
}

function loadConfig(): RuntimeConfig
```

#### Variable table

| Environment variable | Type | Required | Default | Validation |
|---|---|---|---|---|
| `SUPABASE_DB_URL` | string | Yes | — | Non-empty string |
| `AMAIA_MYSQL_HOST` | string | Yes | — | Non-empty string |
| `AMAIA_MYSQL_PORT` | number | No | 3306 | Integer, 1–65535 |
| `AMAIA_MYSQL_USER` | string | Yes | — | Non-empty string |
| `AMAIA_MYSQL_PASSWORD` | string | Yes | — | Non-empty string |
| `AMAIA_MYSQL_DATABASE` | string | Yes | — | Non-empty string |
| `SYNC_CYCLE_INTERVAL_MS` | number | No | 60000 | Integer, ≥ 1000 |
| `SYNC_SAFETY_LAG_ID` | number | No | 100 | Integer, ≥ 0 |
| `SYNC_LEASE_TTL_SECONDS` | number | No | 300 | Integer, ≥ 60 |
| `SYNC_BATCH_SIZE` | number | No | 1000 | Integer, 1–50000 |
| `SYNC_MAX_WINDOW` | number | No | 10000 | Integer, 1–100000 |
| `SYNC_PRE_RUN_STALE_TTL_SECONDS` | number | No | 600 | Integer, ≥ 60 |
| `SYNC_LOG_LEVEL` | string | No | `info` | One of: `info`, `warn`, `error` |
| `METRICS_PORT` | number | No | 9090 | Integer, 1–65535 |

Source: Blueprint v1.6.1 §21.

#### Validation strategy

1. Read all environment variables from `process.env`.
2. For each required variable: if missing or empty string → collect error.
3. For each optional numeric variable: if present but not parseable as integer → collect error.
4. For each optional numeric variable: if parsed but outside valid range → collect error.
5. For `SYNC_LOG_LEVEL`: if present but not in `{'info', 'warn', 'error'}` → collect error.
6. If any errors collected → throw `ConfigurationError` with all errors listed.
7. Apply defaults to optional variables not present.
8. Return frozen `RuntimeConfig` object.

**All errors are reported together.** The validator does not stop at the first error. Operators see the complete list of configuration problems in a single attempt.

#### Security constraint

Configuration values containing secrets (`SUPABASE_DB_URL`, `AMAIA_MYSQL_PASSWORD`) are NEVER logged. The `engine.config_loaded` event logs only non-secret configuration values (interval, batch size, port, log level, etc.).

---

### 4.2 Domain Registry — `src/config/domain-registry.ts`

#### Responsibility

Define the set of supported syncable domains. Enforce the append-only gate (R26). Reject unsupported domains. Fail if zero valid domains remain after validation.

#### Interface

```typescript
type SourceModel = 'append_only'
type WatermarkType = 'id'

interface DomainConfig {
  name: string
  amaiaTable: string
  supabaseTable: string
  identityBasis: string
  watermarkColumn: string
  watermarkType: WatermarkType
  sourceModel: SourceModel
}

interface DomainRegistry {
  getDomains(): ReadonlyArray<DomainConfig>
  getDomain(name: string): DomainConfig
  isSupported(name: string): boolean
}

function buildDomainRegistry(): DomainRegistry
```

#### Domain definitions

| Domain | AMAIA source | Supabase destination | Identity basis | Watermark column | Watermark type | Source model |
|---|---|---|---|---|---|---|
| `control_llamadas` | `control_llamadas` | `amaia_call_logs` | `source_amaia_id` | `id` | `id` | `append_only` |
| `logestado` | `logestado` | `amaia_alert_logs` | `source_amaia_id` | `id` | `id` | `append_only` |

Source: Architecture v1.8.2 §3.

#### Append-only gate (R26)

The domain registry is a **hardcoded whitelist**. Only the two domains above are architecturally supported in V1.

1. The registry contains exactly 2 domain definitions.
2. `getDomain(name)` for an unknown name → throws `UnsupportedDomainError`.
3. `isSupported(name)` for an unknown name → returns `false`.
4. If the registry is constructed with zero valid domains → throws `ConfigurationError`.

**No dynamic registration.** No configuration-driven domain activation. No override flags. No "try anyway" mode. This matches Architecture v1.8.2 §3.3: "No informal activation. No override flags."

#### Immutability

The domain registry is frozen after construction. No mutations after `buildDomainRegistry()` returns.

---

### 4.3 Structured Logging — `src/observability/logger.ts`

#### Responsibility

Emit structured JSON logs to stdout. Provide severity levels. Include correlation metadata when available.

#### Log format

```json
{
  "ts": "2026-06-24T10:30:00.000Z",
  "level": "info",
  "engine_instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "owner_identity": "engine:550e8400-e29b-41d4-a716-446655440000:amaiasql:12345",
  "cycle_id": null,
  "domain": null,
  "run_id": null,
  "manifest_id": null,
  "event": "engine.start",
  "detail": {}
}
```

Source: Architecture v1.8.2 §20.

One JSON object per line. No multi-line output. No ANSI color codes. Stdout only — no file output, no stderr for application logs.

#### Severity levels

| Level | Numeric | Usage |
|---|---|---|
| `error` | 0 | Failures requiring attention |
| `warn` | 1 | Degraded conditions |
| `info` | 2 | Normal operational events |

`SYNC_LOG_LEVEL` controls the minimum severity emitted. Default: `info` (all levels).

#### Interface

```typescript
interface LogContext {
  cycle_id?: string
  domain?: string
  run_id?: string
  manifest_id?: string
}

interface Logger {
  info(event: string, detail?: Record<string, unknown>, context?: LogContext): void
  warn(event: string, detail?: Record<string, unknown>, context?: LogContext): void
  error(event: string, detail?: Record<string, unknown>, context?: LogContext): void
  fatal(event: string, detail?: Record<string, unknown>, context?: LogContext): void
}

function createLogger(
  engineInstanceId: string,
  ownerIdentity: string,
  level: 'info' | 'warn' | 'error'
): Logger
```

`fatal` always emits regardless of configured level. It is used for unrecoverable startup failures.

#### Timestamp

`ts` field uses `new Date().toISOString()`. ISO 8601 UTC. This is the log emission timestamp, not a database freshness primitive. (Inside fenced transactions, `clock_timestamp()` is the sole freshness primitive per Blueprint v1.6.1 §11.1 — not applicable to Sprint 0.)

#### Sprint 0 events

| Event | Level | When |
|---|---|---|
| `engine.config_loaded` | info | After successful configuration validation |
| `engine.domains_registered` | info | After domain registry construction |
| `engine.start` | info | After all initialization, before entering idle loop |
| `engine.tick` | info | Each idle loop iteration (for liveness verification) |
| `engine.shutdown` | info | Graceful shutdown initiated |
| `engine.shutdown_complete` | info | Graceful shutdown completed, before exit |
| `engine.fatal` | error | Unrecoverable startup failure |

---

### 4.4 Metrics Layer — `src/observability/metrics.ts`

#### Responsibility

Expose a Prometheus-compatible HTTP endpoint. Register process metrics and Sprint 0 application metrics.

#### Interface

```typescript
interface MetricsServer {
  start(port: number): Promise<void>
  stop(): Promise<void>
  inc(name: string, labels?: Record<string, string>): void
  set(name: string, value: number, labels?: Record<string, string>): void
}

function createMetricsServer(): MetricsServer
```

#### HTTP endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4; charset=utf-8
```

Single route. No other HTTP routes. Plain HTTP (no TLS — internal network only per Architecture v1.8.2 §21).

#### Sprint 0 metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| Default process metrics | various | — | Node.js process metrics (CPU, memory, event loop, GC) via `prom-client` `collectDefaultMetrics()` |
| `amaia_sync_engine_info` | gauge | `version`, `node_version`, `hostname` | Runtime identification. Set to 1 at startup. |
| `amaia_sync_engine_uptime_seconds` | gauge | — | Seconds since engine.start. Updated each tick. |
| `amaia_sync_cycles_total` | counter | `status` | Placeholder. Registered at Sprint 0, not incremented until Sprint 7. |

Metric naming follows the `amaia_sync_` prefix convention from Architecture v1.8.2 §20.

**No business metrics.** Metrics like `amaia_sync_runs_total`, `amaia_sync_rows_fetched`, etc. are registered in their respective sprints when the subsystems that emit them are built.

#### Shutdown

`stop()` closes the HTTP server. No new connections accepted. Existing connections drained (with a 5-second timeout).

---

### 4.5 Error Taxonomy — `src/errors/error-types.ts`

#### Responsibility

Define Sprint 0 error classes. Strictly limited to four classes.

#### Error classes

```typescript
class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR'
  constructor(message: string, public readonly errors: string[])
}

class StartupError extends Error {
  readonly code = 'STARTUP_ERROR'
  constructor(message: string, public readonly cause?: Error)
}

class ShutdownError extends Error {
  readonly code = 'SHUTDOWN_ERROR'
  constructor(message: string, public readonly cause?: Error)
}

class UnsupportedDomainError extends Error {
  readonly code = 'UNSUPPORTED_DOMAIN_ERROR'
  constructor(public readonly domain: string)
}
```

| Class | Usage | Action |
|---|---|---|
| `ConfigurationError` | Missing/invalid env vars, zero valid domains | Log fatal, exit non-zero |
| `StartupError` | Metrics server fails to start, other bootstrap failures | Log fatal, exit non-zero |
| `ShutdownError` | Failure during graceful shutdown | Log error, exit non-zero |
| `UnsupportedDomainError` | Unknown domain queried from registry | Thrown by domain-registry.ts |

**No future error classes introduced.** `AmaiaConnectionError`, `SupabaseConnectionError`, `DomainLeaseContentionError`, `GuardedTerminalizationError`, etc. are introduced in their respective sprints (Blueprint v1.6.1 §15).

---

### 4.6 Bootstrap — `src/index.ts`

#### Responsibility

Entry point. Orchestrates startup sequence, daemon loop, and shutdown.

#### Engine identity

Generated at startup per Architecture v1.8.2 §5:

```typescript
const engineInstanceId: string = randomUUID()   // UUID v4
const hostname: string = os.hostname()
const pid: number = process.pid
const ownerIdentity: string = `engine:${engineInstanceId}:${hostname}:${pid}`
```

`engineInstanceId` and `ownerIdentity` are immutable for the lifetime of the process.

#### Startup sequence

```
1.  Generate engine_instance_id (UUID v4)
2.  Construct owner_identity
3.  Load and validate configuration          → ConfigurationError on failure
4.  Build domain registry                    → ConfigurationError if zero valid domains
5.  Create logger (with engine identity + configured level)
6.  Log engine.config_loaded (non-secret values only)
7.  Log engine.domains_registered (domain names)
8.  Create metrics server
9.  Start metrics HTTP server                → StartupError on failure
10. Register SIGTERM handler
11. Register SIGINT handler
12. Log engine.start
13. Record startup timestamp for uptime metric
14. Enter idle loop
```

Source: Blueprint v1.6.1 §4 (steps 1–2 and 7–10 for Sprint 0 scope).

Steps 3–6 of the Blueprint's bootstrap sequence (Initialize MySQL client, Initialize PostgreSQL client, Generate engine_instance_id, Construct owner_identity) are reordered for Sprint 0: identity generation moves first (needed for logging), database clients are deferred to Sprint 1/6.

**If any step 1–9 fails:** log `engine.fatal`, exit with code 1. No partial startup.

#### Idle loop

```typescript
while (running) {
  logger.info('engine.tick', { uptime_seconds: elapsedSeconds() })
  metricsServer.set('amaia_sync_engine_uptime_seconds', elapsedSeconds())
  await sleep(config.syncCycleIntervalMs)
}
```

No business logic. The loop demonstrates daemon liveness and observability.

In future sprints, this loop is replaced by the full scheduler acquisition → recovery → cycle execution sequence (Blueprint v1.6.1 §5).

#### Signal handlers

```typescript
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return          // idempotent
  shuttingDown = true
  running = false
  logger.info('engine.shutdown', { signal })
  try {
    await metricsServer.stop()
  } catch (err) {
    logger.error('engine.shutdown_error', { component: 'metrics', error: String(err) })
  }
  logger.info('engine.shutdown_complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
```

**Idempotent.** The `shuttingDown` flag prevents re-entry. Repeated SIGTERM/SIGINT signals after the first are no-ops.

**No `process.on('uncaughtException')` or `process.on('unhandledRejection')` handlers in Sprint 0.** These are added when async business logic introduces rejection paths (Sprint 1+).

#### Startup failure

```typescript
try {
  await bootstrap()
} catch (err) {
  if (logger) {
    logger.fatal('engine.fatal', { error: String(err) })
  } else {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'engine.fatal',
      detail: { error: String(err) }
    }))
  }
  process.exit(1)
}
```

If the logger is not yet initialized (config failure before logger creation), fallback to raw JSON on stderr. Exit code 1 always.

---

## 5. Startup Invalid — Failure Modes

| Condition | Error class | Log event | Exit code |
|---|---|---|---|
| Required env var missing | `ConfigurationError` | `engine.fatal` | 1 |
| Env var outside valid range | `ConfigurationError` | `engine.fatal` | 1 |
| `SYNC_LOG_LEVEL` invalid value | `ConfigurationError` | `engine.fatal` | 1 |
| Zero valid domains in registry | `ConfigurationError` | `engine.fatal` | 1 |
| Metrics HTTP server bind failure | `StartupError` | `engine.fatal` | 1 |

All failures produce structured JSON output (even in the pre-logger fallback path) and exit non-zero.

---

## 6. Graceful Shutdown — Complete Specification

### Trigger

`SIGTERM` or `SIGINT` received by the process.

### Sequence

```
1. Set shuttingDown = true (idempotency flag)
2. Set running = false (breaks idle loop)
3. Log engine.shutdown with signal name
4. Stop metrics HTTP server (drain with 5s timeout)
5. Log engine.shutdown_complete
6. Exit 0
```

### Properties

| Property | Guarantee |
|---|---|
| Idempotent | Second signal during shutdown is a no-op |
| Ordered | Metrics stops before exit |
| Logged | Both start and completion of shutdown are logged |
| Exit code | 0 on clean shutdown |

### Future extensions

In Sprint 1+, the shutdown sequence grows to include: wait for fenced tx completion, release scheduler lease, close PostgreSQL pool, close MySQL connection. These are added when their subsystems are built. The Sprint 0 shutdown handler is designed to be extended, not replaced.

---

## 7. Package Configuration

### 7.1 package.json

```json
{
  "name": "amaia-sync-runtime",
  "version": "0.1.0",
  "description": "AMAIA-SYNC Runtime Engine — single-process synchronization daemon",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "lint": "eslint src/ --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

#### Dependencies

| Package | Purpose | Justification |
|---|---|---|
| `prom-client` | Prometheus metrics registry + HTTP exposition | Architecture v1.8.2 §20 requires Prometheus metrics |

#### Dev dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `tsx` | Development runner (ts-node alternative) |
| `vitest` | Test runner |
| `eslint` | Linter |
| `@typescript-eslint/parser` | TypeScript ESLint parser |
| `@typescript-eslint/eslint-plugin` | TypeScript ESLint rules |
| `@types/node` | Node.js type definitions |

**No runtime dependency on `uuid`.** Node.js 20 LTS provides `crypto.randomUUID()` natively.

**No dependency on `pino`, `winston`, or other logging libraries.** The structured logger is implemented directly — it is a thin JSON serializer to stdout, not a configurable logging framework.

### 7.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`strict: true` enables all strict type-checking options. No `any` escapes without explicit justification.

---

## 8. Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
RUN addgroup -S sync && adduser -S sync -G sync
WORKDIR /app
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/package.json .
USER sync
EXPOSE 9090
CMD ["node", "dist/index.js"]
```

### Properties

| Property | Value | Justification |
|---|---|---|
| Base image | `node:20-alpine` | Node.js 20 LTS per Blueprint v1.6.1 §22. Alpine for minimal attack surface. |
| Multi-stage | Yes | Builder stage discarded. Production image has no TypeScript compiler or dev dependencies. |
| Non-root user | `sync` | Security. Daemon does not require root. |
| Signal handling | `CMD ["node", ...]` (exec form) | PID 1 receives SIGTERM directly. No shell wrapper. |
| Exposed port | 9090 | Metrics endpoint (configurable via `METRICS_PORT`). |
| No ENTRYPOINT | — | `CMD` is sufficient. No wrapper scripts needed. |

---

## 9. QA Matrix

### 9.1 Mandatory scenario matrix

| # | Scenario | Expected result | Validates |
|---|---|---|---|
| T1 | Startup with all required env vars valid | `engine.start` event emitted. Process running. Metrics endpoint responds. | Bootstrap sequence |
| T2 | Missing single required env var (`SUPABASE_DB_URL`) | `ConfigurationError` thrown. `engine.fatal` logged. Exit code 1. | Fail-fast config validation |
| T3 | Missing multiple required env vars | `ConfigurationError` with all missing vars listed. Exit code 1. | Aggregate error reporting |
| T4 | Optional numeric var with invalid value (e.g., `SYNC_BATCH_SIZE=abc`) | `ConfigurationError`. Exit code 1. | Type validation |
| T5 | Optional numeric var outside range (e.g., `SYNC_BATCH_SIZE=0`) | `ConfigurationError`. Exit code 1. | Range validation |
| T6 | `SYNC_LOG_LEVEL=debug` (invalid) | `ConfigurationError`. Exit code 1. | Enum validation |
| T7 | All optional vars omitted | Defaults applied. Engine starts. Config matches default values. | Default application |
| T8 | Domain registry returns 2 valid domains | `control_llamadas` and `logestado` registered. `engine.domains_registered` logged. | R26 whitelist |
| T9 | `getDomain('unknown_table')` | `UnsupportedDomainError` thrown. | R26 rejection |
| T10 | `isSupported('unknown_table')` | Returns `false`. | R26 query |
| T11 | Domain registry query for `control_llamadas` | Returns correct `DomainConfig` with all fields matching Architecture §3 table. | Domain definition accuracy |
| T12 | Metrics endpoint `GET /metrics` | HTTP 200. Body contains `amaia_sync_engine_info`. Body contains `amaia_sync_engine_uptime_seconds`. Body contains `amaia_sync_cycles_total`. Prometheus text format. | Metrics exposition |
| T13 | Metrics endpoint includes process metrics | `process_cpu_seconds_total`, `process_resident_memory_bytes` present. | Default metrics |
| T14 | SIGTERM received during idle loop | `engine.shutdown` logged. `engine.shutdown_complete` logged. Metrics server stopped. Exit code 0. | Graceful shutdown |
| T15 | SIGINT received during idle loop | Same as T14. | Graceful shutdown (SIGINT) |
| T16 | Two SIGTERM signals in rapid succession | First triggers shutdown. Second is no-op. Single `engine.shutdown` event. | Idempotent shutdown |
| T17 | Log output format | Every log line is valid JSON. Contains `ts`, `level`, `engine_instance_id`, `owner_identity`, `event` fields. | Structured logging format |
| T18 | Log level filtering (`SYNC_LOG_LEVEL=error`) | `info` and `warn` events suppressed. `error` and `fatal` events emitted. | Log level gating |
| T19 | Secret values not logged | `engine.config_loaded` event does NOT contain `SUPABASE_DB_URL` or `AMAIA_MYSQL_PASSWORD` values. | Security |
| T20 | Engine identity format | `owner_identity` matches pattern `engine:{uuid}:{hostname}:{pid}`. `engine_instance_id` is valid UUID v4. | Architecture §5 compliance |
| T21 | Startup failure before logger init | JSON output to console contains `engine.fatal` event. Exit code 1. | Pre-logger fallback |

### 9.2 Invariant coverage (Sprint 0)

| Invariant | Test | Status |
|---|---|---|
| R1 — Single scheduler | T1 (single process) | Structural |
| R2 — Single worker | T1 (single process) | Structural |
| R26 — Unvalidated domains ineligible | T8, T9, T10, T11 | Explicit |

Other invariants (R3–R25, R27–R35) are not yet testable — their subsystems do not exist in Sprint 0. They will be covered in Sprints 1–8 per Implementation Plan v1.1 §17.

---

## 10. CI/CD Pipeline

Per Implementation Plan v1.1 §19.

### Pipeline stages (Sprint 0)

```
1. lint         → eslint src/ --ext .ts
2. typecheck    → tsc --noEmit
3. unit tests   → vitest run
4. docker build → docker build -t amaia-sync-runtime:sprint0 .
5. startup verify → docker run with valid env → verify engine.start in stdout
6. shutdown verify → docker stop → verify exit code 0
```

Integration tests (stage 4 of the full pipeline) are deferred to Sprint 1 when PostgreSQL connectivity exists. Docker Compose is not needed for Sprint 0.

Migration verify (stage 7 of the full pipeline) is deferred — Sprint 0 introduces no database changes.

### Pipeline failure

Any stage failure blocks commit. No exceptions.

---

## 11. README.md

The README documents:

1. **What:** AMAIA-SYNC Runtime Engine — single-process daemon synchronizing AMAIA MySQL to Supabase PostgreSQL.
2. **Status:** Sprint 0 — operational skeleton. No business logic.
3. **Prerequisites:** Node.js 20+, Docker (optional).
4. **Configuration:** Table of all environment variables with types, defaults, and descriptions.
5. **Build:** `npm ci && npm run build`
6. **Run:** `npm start` (requires env vars) or `docker run` with `-e` flags.
7. **Test:** `npm test`
8. **Verify:** `curl http://localhost:9090/metrics` for Prometheus endpoint.
9. **Architecture:** References to normative documents in `/docs`.

---

## 12. Out of Scope — Explicit Prohibitions

The following are **prohibited** in Sprint 0 implementation:

| Prohibited | Belongs to |
|---|---|
| `pg` or `pg-pool` dependency | Sprint 1 |
| `mysql2` dependency | Sprint 6 |
| Any `*-repository.ts` file | Sprint 1+ |
| `engine.ts`, `scheduler.ts`, `cycle-runner.ts`, `domain-runner.ts` | Sprint 2–7 |
| Any `*-service.ts` file | Sprint 2+ |
| `amaia-fetcher.ts`, `domain-queries.ts` | Sprint 6 |
| Error classes beyond the 4 specified | Respective sprints |
| Metrics beyond the 4 categories specified | Respective sprints |
| `uncaughtException` / `unhandledRejection` handlers | Sprint 1+ |
| Any import of `pg`, `mysql2`, `@supabase/supabase-js` | Respective sprints |
| Database tables, migrations, DDL | Phase 9.3 (already deployed) |
| Lease acquisition logic | Sprint 2 |
| Run or cycle creation | Sprint 3/7 |
| Recovery logic | Sprint 4 |
| Manifest operations | Sprint 5 |
| AMAIA fetching | Sprint 6 |
| Watermark or CAS logic | Sprint 5 |

---

## 13. Definition of Done

Per Implementation Plan v1.1 §18.

| # | Criterion | Sprint 0 verification |
|---|---|---|
| 1 | Sprint blueprint Codex-approved | This document audited and approved by Codex |
| 2 | Implementation completed | All 6 source files + 4 config files implemented |
| 3 | QA scenario matrix green | All 21 tests pass |
| 4 | No critical defects | Zero open critical/major defects |
| 5 | CI pipeline green | lint + typecheck + unit + docker build + startup verify |
| 6 | Documentation updated | README.md created |
| 7 | Git commit created | Single commit with all Sprint 0 artifacts |
| 8 | Reproducible build | Docker image builds and starts successfully |
| 9 | Evidence artifacts stored | QA results + CI logs captured |

---

## 14. Architectural Invariant Compliance Matrix

| Invariant | Sprint 0 status | How addressed |
|---|---|---|
| R1 Single scheduler | Structural | Single process, no multi-worker |
| R2 Single worker | Structural | Single process, no threading |
| R26 Unvalidated domains ineligible | Implemented | Domain registry whitelist + append-only gate |
| R3–R25, R27–R35 | Deferred | Subsystems not yet built. Covered in Sprints 1–8. |

---

## 15. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Metrics library `prom-client` API breaking change | Low | Pin version in package-lock.json. Alpine image reproducible. |
| Node.js 20 `crypto.randomUUID()` not available | None | Available since Node.js 14.17. Node.js 20 is guaranteed. |
| `METRICS_PORT` conflicts with existing service on AMAIASQL | Low | Configurable. Default 9090 avoids common ports. |
| Config validates DB vars but Sprint 0 doesn't connect | Intentional | Fail-fast design. Operators discover misconfiguration at first deployment, not at Sprint 6. |

---

## 16. Sprint Boundary Contract

### What Sprint 0 delivers to Sprint 1

| Artifact | Contract |
|---|---|
| `RuntimeConfig` | Typed, validated configuration object. Sprint 1 reads `supabaseDbUrl` from it. |
| `DomainRegistry` | Immutable registry of valid domains. Sprint 1+ queries domain metadata. |
| `Logger` | Structured logger with context support. Sprint 1+ passes `cycle_id`, `domain`, etc. |
| `MetricsServer` | Prometheus registry. Sprint 1+ registers additional metrics via `inc()` and `set()`. |
| Error base classes | `ConfigurationError` and `StartupError` used by later subsystems. `UnsupportedDomainError` used by domain-runner. |
| `index.ts` | Bootstrap + shutdown. Sprint 1 adds `pg-client` init between steps 9 and 10. Sprint 6 adds `mysql-client`. |
| Signal handlers | Shutdown orchestration. Sprint 1+ adds cleanup steps (pool close, lease release). |

### What Sprint 0 does NOT constrain

Sprint 0 makes no decisions about:

- PoolClient lifecycle or transaction management
- Fenced transaction structure
- Lease acquisition strategy
- Recovery detection predicates
- Manifest phase state machine
- Domain execution order within cycles
- CAS semantics

These are fully specified by the Architecture v1.8.2 and Blueprint v1.6.1, and will be implemented in their respective sprints without conflict.

---

**READY FOR CODEX HOSTILE AUDIT**

---

**End of document.**
