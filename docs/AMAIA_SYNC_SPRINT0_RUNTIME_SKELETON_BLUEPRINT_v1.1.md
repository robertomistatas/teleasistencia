# AMAIA-SYNC Sprint 0 — Runtime Skeleton Blueprint v1.1

**Type:** Sprint implementation blueprint  
**Phase:** 9.4D  
**Sprint:** 0  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.0 (rejected — 6 critical, 6 medium findings)  
**Parent architecture:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**Parent blueprint:** AMAIA_SYNC_RUNTIME_IMPLEMENTATION_BLUEPRINT_v1.6.1 (Codex approved with observations)  
**Parent protocol:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (Codex approved)  
**Parent plan:** AMAIA_SYNC_RUNTIME_TYPESCRIPT_IMPLEMENTATION_PLAN_v1.1 (Codex approved with observations)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.0

| # | ID | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | C1 | Critical | Pre-logger fallback uses `console.error()`, contradicts stdout-only contract | All output via `process.stdout.write()`. Zero stderr emissions. |
| 2 | C2 | Critical | Signal handlers registered after metrics server — leaves unprotected window | Handlers registered immediately after engine identity, before any resource allocation. |
| 3 | C3 | Critical | No `uncaughtException` / `unhandledRejection` handlers despite Sprint 0 async infrastructure | Both handlers specified from Sprint 0. Fatal JSON + best-effort shutdown + exit non-zero. |
| 4 | C4 | Critical | Hardcoded whitelist presented as "append-only gate implemented" — whitelist ≠ validation | `DomainConfig` extended with `validatedAppendOnly` + `validationEvidence`. Listed ≠ validated distinction explicit. |
| 5 | C5 | Critical | Dockerfile copies `node_modules` from builder stage including devDependencies | Runtime stage runs its own `npm ci --omit=dev`. Builder `node_modules` never copied. |
| 6 | C6 | Critical | `SUPABASE_DB_URL` validated only as non-empty string — insufficient | URL parsing: scheme, host, database, username validated. Privileged users blocked. |
| 7 | M1 | Medium | Document status references stale | Protocol v1.6.4 → approved. Plan v1.1 → approved with observations. |
| 8 | M2 | Medium | Config validation language overpromises credential validity | Clarified: presence + format validation only. Not connectivity or credential verification. |
| 9 | M3 | Medium | `amaia_sync_cycles_total` placeholder not explicitly initialized | Explicitly initialized with `inc(0)` at construction. Visible in `/metrics` from Sprint 0. |
| 10 | M4 | Medium | `engine.tick` every 60s contaminates logs | `ENABLE_IDLE_TICK_LOGS` boolean added. Default `false`. Tick logs suppressed unless opted in. |
| 11 | M5 | Medium | `EXPOSE 9090` undocumented as default-only | Documented: `EXPOSE` is default metrics port. Runtime listens on `METRICS_PORT` (configurable). |
| 12 | M6 | Medium | `package-lock.json` missing from artifacts tree | Added to artifacts. |

---

## Normative Document Review

All four normative documents were reviewed exhaustively before designing this blueprint.

### Constraints extracted and respected

| Source | Constraint | Sprint 0 compliance |
|---|---|---|
| Architecture v1.8.2 §5 | Engine identity = UUID v4 + owner_identity format | Implemented at startup |
| Architecture v1.8.2 §3 | Only control_llamadas and logestado are valid V1 domains | Domain registry enforces |
| Architecture v1.8.2 §3.3 | Fail-closed for unsupported domains. Zero valid = config error exit | Domain registry enforces |
| Architecture v1.8.2 R26 | Unvalidated domains ineligible | Append-only validation gate with evidence (C4) |
| Architecture v1.8.2 §20 | Structured JSON logging format with specified fields | Logger implements |
| Architecture v1.8.2 §20 | Prometheus metrics with specified naming convention | Metrics implements |
| Architecture v1.8.2 §22 | Graceful shutdown: SIGTERM → stop → close → exit | Shutdown handler implements |
| Architecture v1.8.2 R1/R2 | Single scheduler, single worker | Single-process daemon |
| Blueprint v1.6.1 §3 | Module tree structure | Sprint 0 files match tree |
| Blueprint v1.6.1 §4 | Bootstrap sequence (steps 1–2, 7–10 for Sprint 0) | Implemented with hardened signal registration (C2) |
| Blueprint v1.6.1 §21 | Configuration variables with types, defaults, validation | Config module implements with structural URL validation (C6) |
| Blueprint v1.6.1 §13.1 | `SUPABASE_DB_URL` (not SUPABASE_URL + SERVICE_KEY) for direct pg | Config validates presence and URL structure (C6) |
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
6. Respond correctly to OS signals and unhandled exceptions.

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
│   │   └── domain-registry.ts            ← Domain definitions + append-only validation gate
│   ├── observability/
│   │   ├── logger.ts                     ← Structured JSON logger
│   │   └── metrics.ts                    ← Prometheus metrics + HTTP endpoint
│   └── errors/
│       └── error-types.ts                ← Sprint 0 error taxonomy
├── package.json
├── package-lock.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

This matches the Blueprint v1.6.1 §3 module tree for the Sprint 0 subset. `package-lock.json` included for reproducible builds (M6).

---

## 4. Module Specifications

### 4.1 Configuration — `src/config/config.ts`

#### Responsibility

Load environment variables, validate presence and format, apply defaults, expose typed configuration. Fail fast on invalid configuration.

**Scope clarification (M2):** Sprint 0 configuration performs **presence validation** (required variables exist and are non-empty) and **format validation** (numeric ranges, URL structure, enum membership). It does NOT perform **credential validation** (database connectivity, authentication, authorization). Credential validation is performed at connection time in their respective sprints (Sprint 1 for PostgreSQL, Sprint 6 for MySQL).

#### Interface

```typescript
interface RuntimeConfig {
  // PostgreSQL (presence + format validated at startup, connectivity validated Sprint 1)
  supabaseDbUrl: string

  // MySQL (presence validated at startup, connectivity validated Sprint 6)
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
  enableIdleTickLogs: boolean
}

function loadConfig(): RuntimeConfig
```

#### Variable table

| Environment variable | Type | Required | Default | Validation |
|---|---|---|---|---|
| `SUPABASE_DB_URL` | string | Yes | — | Valid URL; scheme `postgres://` or `postgresql://`; host non-empty; database non-empty; username non-empty; username not in blocked list (C6) |
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
| `ENABLE_IDLE_TICK_LOGS` | boolean | No | `false` | `true` or `false` (case-insensitive) |

Source: Blueprint v1.6.1 §21 + Sprint 0 operational requirements (M4).

#### SUPABASE_DB_URL structural validation (C6)

`SUPABASE_DB_URL` undergoes structural validation beyond presence check:

```typescript
function validateSupabaseDbUrl(raw: string): string[] {
  const errors: string[] = []
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return ['SUPABASE_DB_URL: not a valid URL']
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    errors.push(`SUPABASE_DB_URL: scheme must be postgres:// or postgresql://, got ${parsed.protocol}`)
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
  const BLOCKED_USERS = ['postgres', 'supabase_admin', 'service_role']
  if (parsed.username && BLOCKED_USERS.includes(parsed.username)) {
    errors.push(`SUPABASE_DB_URL: privileged user '${parsed.username}' is blocked — use amaia_sync_runtime role`)
  }
  return errors
}
```

**Blocked users rationale:** Architecture v1.8.2 §21 requires `SET LOCAL ROLE amaia_sync_runtime` per fenced transaction. Connecting as a privileged database user (postgres, supabase_admin, service_role) bypasses RLS and violates the security model. The config validator prevents this class of misconfiguration at startup.

**Never log the full URL.** The `engine.config_loaded` event may log the scheme and host for diagnostics (e.g., `postgresql://<host>`) but MUST NOT include username, password, port, or database path.

#### Validation strategy

1. Read all environment variables from `process.env`.
2. For each required string variable (except `SUPABASE_DB_URL`): if missing or empty string → collect error.
3. For `SUPABASE_DB_URL`: if missing → collect error. If present → run structural validation (C6) → collect all errors.
4. For each optional numeric variable: if present but not parseable as integer → collect error.
5. For each optional numeric variable: if parsed but outside valid range → collect error.
6. For `SYNC_LOG_LEVEL`: if present but not in `{'info', 'warn', 'error'}` → collect error.
7. For `ENABLE_IDLE_TICK_LOGS`: if present but not in `{'true', 'false'}` (case-insensitive) → collect error.
8. If any errors collected → throw `ConfigurationError` with all errors listed.
9. Apply defaults to optional variables not present.
10. Return frozen `RuntimeConfig` object.

**All errors are reported together.** The validator does not stop at the first error. Operators see the complete list of configuration problems in a single attempt.

#### Security constraint

Configuration values containing secrets (`SUPABASE_DB_URL`, `AMAIA_MYSQL_PASSWORD`) are NEVER logged in full. The `engine.config_loaded` event logs only non-secret configuration values (interval, batch size, port, log level, etc.). For `SUPABASE_DB_URL`, at most the scheme and host are logged — never username, password, database, or port.

---

### 4.2 Domain Registry — `src/config/domain-registry.ts`

#### Responsibility

Define the set of supported syncable domains. Enforce the append-only validation gate (R26). Distinguish between listed and validated domains. Reject unsupported domains. Fail if zero validated domains remain.

#### Listed vs Validated distinction (C4)

| Concept | Meaning | Example |
|---|---|---|
| **Listed domain** | A domain known to the Runtime V1 codebase. Appears in the hardcoded registry. | `control_llamadas` appears in the source code. |
| **Validated append-only domain** | A listed domain whose append-only behavior has been analyzed, audited, evidenced, and approved in normative documents. | `control_llamadas` is validated per Architecture v1.8.2 §3 + §3.3 (evidence: vendor documentation, schema analysis, historical sampling, operational verification). |

A hardcoded whitelist proves a domain is **listed**. It does NOT prove the domain is **append-only**. The `validatedAppendOnly` flag and `validationEvidence` field carry the proof.

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
  validatedAppendOnly: boolean
  validationEvidence: string
}

interface DomainRegistry {
  getDomains(): ReadonlyArray<DomainConfig>
  getValidatedDomains(): ReadonlyArray<DomainConfig>
  getDomain(name: string): DomainConfig
  isSupported(name: string): boolean
}

function buildDomainRegistry(): DomainRegistry
```

#### Domain definitions

| Domain | AMAIA source | Supabase destination | Identity basis | Watermark column | Watermark type | Source model | validatedAppendOnly | validationEvidence |
|---|---|---|---|---|---|---|---|---|
| `control_llamadas` | `control_llamadas` | `amaia_call_logs` | `source_amaia_id` | `id` | `id` | `append_only` | `true` | Architecture v1.8.2 §3 + §3.3: append-only validated via vendor documentation, schema analysis, historical sampling, operational verification. Approved by Codex audit. |
| `logestado` | `logestado` | `amaia_alert_logs` | `source_amaia_id` | `id` | `id` | `append_only` | `true` | Architecture v1.8.2 §3 + §3.3: append-only validated via vendor documentation, schema analysis, historical sampling, operational verification. Approved by Codex audit. |

Source: Architecture v1.8.2 §3.

#### Append-only validation gate (R26) — corrected (C4)

The gate operates in two layers:

**Layer 1 — Listed gate:** The domain must appear in the hardcoded registry. Unknown domains are rejected immediately via `UnsupportedDomainError`.

**Layer 2 — Validation gate:** The domain must have `validatedAppendOnly === true` with a non-empty `validationEvidence` string. A listed domain that has not been validated (e.g., a future domain added to the codebase before its audit completes) is **ineligible** — it is skipped during domain iteration, exactly as Architecture v1.8.2 §3.3 specifies:

> "If evidence is missing or insufficient: domain.status = unsupported. Engine skips it."

**Startup behavior:**

1. Registry constructed with all listed domains.
2. `getValidatedDomains()` returns only domains where `validatedAppendOnly === true` AND `validationEvidence` is non-empty.
3. If `getValidatedDomains()` returns zero domains → throw `ConfigurationError`.
4. Log `engine.domains_registered` with names of validated domains and their evidence references.

**No dynamic registration.** No configuration-driven domain activation. No override flags. No "try anyway" mode. This matches Architecture v1.8.2 §3.3: "No informal activation. No override flags."

#### Registry methods

| Method | Behavior |
|---|---|
| `getDomains()` | Returns all listed domains (validated and unvalidated). |
| `getValidatedDomains()` | Returns only domains with `validatedAppendOnly === true` and non-empty `validationEvidence`. |
| `getDomain(name)` | Returns domain config if listed. Throws `UnsupportedDomainError` if not listed. |
| `isSupported(name)` | Returns `true` if listed AND validated. `false` otherwise. |

#### Immutability

The domain registry is frozen after construction. No mutations after `buildDomainRegistry()` returns.

---

### 4.3 Structured Logging — `src/observability/logger.ts`

#### Responsibility

Emit structured JSON logs to stdout. Provide severity levels. Include correlation metadata when available.

#### Output contract (C1)

**All Runtime log output uses stdout exclusively.** No application output to stderr. No exceptions.

This includes:
- Normal operational logs (info, warn, error)
- Fatal startup failures
- Pre-logger fallback output
- Unhandled exception/rejection evidence

Every emission is a single-line JSON object written via `process.stdout.write()` (or via the Logger abstraction which writes to stdout).

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

`fatal` always emits regardless of configured level. It is used for unrecoverable startup failures and unhandled exceptions.

#### Timestamp

`ts` field uses `new Date().toISOString()`. ISO 8601 UTC. This is the log emission timestamp, not a database freshness primitive. (Inside fenced transactions, `clock_timestamp()` is the sole freshness primitive per Blueprint v1.6.1 §11.1 — not applicable to Sprint 0.)

#### Sprint 0 events

| Event | Level | When |
|---|---|---|
| `engine.config_loaded` | info | After successful configuration validation |
| `engine.domains_registered` | info | After domain registry construction (includes validated domain names + evidence references) |
| `engine.start` | info | After all initialization, before entering idle loop |
| `engine.tick` | info | Each idle loop iteration — **emitted only when `ENABLE_IDLE_TICK_LOGS=true`** (M4) |
| `engine.shutdown` | info | Graceful shutdown initiated |
| `engine.shutdown_complete` | info | Graceful shutdown completed, before exit |
| `engine.fatal` | error | Unrecoverable failure (startup, uncaught exception, unhandled rejection) |

#### Pre-logger fallback (C1)

When the logger is not yet initialized (failure occurs before step 9 of bootstrap), a minimal fallback emits structured JSON directly to stdout:

```typescript
function emitFallbackLog(
  engineInstanceId: string,
  ownerIdentity: string,
  event: string,
  detail: Record<string, unknown>
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    engine_instance_id: engineInstanceId,
    owner_identity: ownerIdentity,
    cycle_id: null,
    domain: null,
    run_id: null,
    manifest_id: null,
    event,
    detail
  })
  process.stdout.write(line + '\n')
}
```

This fallback:
- Uses `process.stdout.write()`, never `console.error()` or `console.log()` (C1).
- Produces the same JSON schema as the Logger.
- Is used only when the Logger has not yet been constructed.

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

| Metric | Type | Labels | Description | Initialization |
|---|---|---|---|---|
| Default process metrics | various | — | Node.js process metrics (CPU, memory, event loop, GC) via `prom-client` `collectDefaultMetrics()` | Automatic |
| `amaia_sync_engine_info` | gauge | `version`, `node_version`, `hostname` | Runtime identification. Set to 1 at startup. | Set at construction |
| `amaia_sync_engine_uptime_seconds` | gauge | — | Seconds since engine.start. Updated each tick. | Set to 0 at construction |
| `amaia_sync_cycles_total` | counter | `status` | Cycle completion counter. **Explicitly initialized at construction** with `inc(0)` to ensure the metric appears in `/metrics` output from Sprint 0 (M3). Not incremented until Sprint 7. | `inc(0)` at construction |

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
| `ConfigurationError` | Missing/invalid env vars, zero validated domains, URL validation failure | Log fatal, exit non-zero |
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
3.  Register SIGTERM handler                  ← (C2) before any resource allocation
4.  Register SIGINT handler                   ← (C2) before any resource allocation
5.  Register uncaughtException handler        ← (C3) before any async work
6.  Register unhandledRejection handler       ← (C3) before any async work
7.  Load and validate configuration           → ConfigurationError on failure
8.  Build domain registry                     → ConfigurationError if zero validated domains
9.  Create logger (with engine identity + configured level)
10. Log engine.config_loaded (non-secret values only)
11. Log engine.domains_registered (validated domain names + evidence references)
12. Create metrics server
13. Initialize placeholder metrics            ← (M3) amaia_sync_cycles_total inc(0)
14. Start metrics HTTP server                 → StartupError on failure
15. Log engine.start
16. Record startup timestamp for uptime metric
17. Enter idle loop
```

**Signal and exception handlers (steps 3–6) are registered immediately after identity generation and before any resource allocation (C2).** This eliminates the unprotected window where the process could die without structured shutdown evidence.

These handlers must tolerate partially initialized state — logger, config, and metrics may not exist when a signal arrives during steps 7–14. The handlers use the pre-logger fallback (Section 4.3) when the logger is unavailable.

Source: Blueprint v1.6.1 §4 (steps 1–2 and 7–10 for Sprint 0 scope), with hardened signal registration per C2.

**If any step 7–14 fails:** log `engine.fatal` (via logger if available, via fallback if not), exit with code 1. No partial startup.

#### Idle loop

```typescript
while (running) {
  if (config.enableIdleTickLogs) {
    logger.info('engine.tick', { uptime_seconds: elapsedSeconds() })
  }
  metricsServer.set('amaia_sync_engine_uptime_seconds', elapsedSeconds())
  await sleep(config.syncCycleIntervalMs)
}
```

When `ENABLE_IDLE_TICK_LOGS=false` (default), the loop updates the uptime metric silently. No log contamination (M4).

When `ENABLE_IDLE_TICK_LOGS=true`, `engine.tick` is emitted each iteration for liveness verification during debugging or deployment validation.

In future sprints, this loop is replaced by the full scheduler acquisition → recovery → cycle execution sequence (Blueprint v1.6.1 §5).

#### Signal handlers (C2)

```typescript
let logger: Logger | null = null
let metricsServer: MetricsServer | null = null
let shuttingDown = false
let running = true

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return          // idempotent
  shuttingDown = true
  running = false

  const logShutdown = (event: string, detail?: Record<string, unknown>) => {
    if (logger) {
      logger.info(event, detail)
    } else {
      emitFallbackLog(engineInstanceId, ownerIdentity, event, detail ?? {})
    }
  }

  logShutdown('engine.shutdown', { signal })

  if (metricsServer) {
    try {
      await metricsServer.stop()
    } catch (err) {
      if (logger) {
        logger.error('engine.shutdown_error', { component: 'metrics', error: String(err) })
      } else {
        emitFallbackLog(engineInstanceId, ownerIdentity, 'engine.shutdown_error', {
          component: 'metrics', error: String(err)
        })
      }
    }
  }

  logShutdown('engine.shutdown_complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
```

**Registered at step 3–4**, before config, logger, metrics, or any resource. The handler checks for `null` on `logger` and `metricsServer` before using them.

**Idempotent.** The `shuttingDown` flag prevents re-entry. Repeated signals after the first are no-ops.

#### Unhandled exception/rejection handlers (C3)

Sprint 0 already contains async infrastructure (metrics HTTP server, idle loop with `await sleep()`, shutdown promises). Unhandled exceptions and rejections MUST produce structured evidence and trigger an orderly exit.

```typescript
process.on('uncaughtException', (err: Error) => {
  const detail = { error: String(err), stack: err.stack ?? null }
  if (logger) {
    logger.fatal('engine.fatal', { ...detail, trigger: 'uncaughtException' })
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'engine.fatal', {
      ...detail, trigger: 'uncaughtException'
    })
  }
  // Best-effort shutdown: stop metrics if possible
  if (metricsServer && !shuttingDown) {
    shuttingDown = true
    metricsServer.stop().catch(() => {}).finally(() => process.exit(1))
  } else {
    process.exit(1)
  }
})

process.on('unhandledRejection', (reason: unknown) => {
  const detail = { error: String(reason), trigger: 'unhandledRejection' }
  if (logger) {
    logger.fatal('engine.fatal', detail)
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'engine.fatal', detail)
  }
  if (metricsServer && !shuttingDown) {
    shuttingDown = true
    metricsServer.stop().catch(() => {}).finally(() => process.exit(1))
  } else {
    process.exit(1)
  }
})
```

**Registered at steps 5–6**, before any async work begins.

**Behavior contract:**

| Step | Action |
|---|---|
| 1 | Emit `engine.fatal` JSON to stdout with `trigger` field |
| 2 | Attempt best-effort metrics shutdown (non-blocking, with `.catch()`) |
| 3 | Exit with code 1 |

**No unstructured stack traces.** The `stack` property is captured inside the JSON `detail` field. Node.js default behavior of printing raw stack traces to stderr is replaced by structured JSON to stdout.

#### Startup failure (C1)

```typescript
try {
  await bootstrap()
} catch (err) {
  if (logger) {
    logger.fatal('engine.fatal', { error: String(err) })
  } else {
    emitFallbackLog(engineInstanceId, ownerIdentity, 'engine.fatal', {
      error: String(err)
    })
  }
  process.exit(1)
}
```

All fallback output uses `process.stdout.write()` via `emitFallbackLog()` (C1). Zero stderr emissions.

---

## 5. Startup Invalid — Failure Modes

| Condition | Error class | Log event | Exit code |
|---|---|---|---|
| Required env var missing | `ConfigurationError` | `engine.fatal` | 1 |
| Env var outside valid range | `ConfigurationError` | `engine.fatal` | 1 |
| `SYNC_LOG_LEVEL` invalid value | `ConfigurationError` | `engine.fatal` | 1 |
| `SUPABASE_DB_URL` invalid scheme | `ConfigurationError` | `engine.fatal` | 1 |
| `SUPABASE_DB_URL` empty host/database/username | `ConfigurationError` | `engine.fatal` | 1 |
| `SUPABASE_DB_URL` privileged user blocked | `ConfigurationError` | `engine.fatal` | 1 |
| Zero validated domains in registry | `ConfigurationError` | `engine.fatal` | 1 |
| Metrics HTTP server bind failure | `StartupError` | `engine.fatal` | 1 |
| Uncaught exception during bootstrap | (native Error) | `engine.fatal` | 1 |
| Unhandled promise rejection during bootstrap | (native Error) | `engine.fatal` | 1 |

All failures produce structured JSON to stdout (C1) — including pre-logger failures — and exit non-zero.

---

## 6. Graceful Shutdown — Complete Specification

### Triggers

| Trigger | Handler | Exit code |
|---|---|---|
| `SIGTERM` | `shutdown('SIGTERM')` | 0 |
| `SIGINT` | `shutdown('SIGINT')` | 0 |
| `uncaughtException` | Fatal log + best-effort shutdown | 1 |
| `unhandledRejection` | Fatal log + best-effort shutdown | 1 |

### Sequence (SIGTERM / SIGINT)

```
1. Set shuttingDown = true (idempotency flag)
2. Set running = false (breaks idle loop)
3. Log engine.shutdown with signal name (logger or fallback)
4. Stop metrics HTTP server if initialized (drain with 5s timeout)
5. Log engine.shutdown_complete (logger or fallback)
6. Exit 0
```

### Sequence (uncaughtException / unhandledRejection)

```
1. Emit engine.fatal JSON to stdout with trigger and error detail
2. Set shuttingDown = true
3. Best-effort metrics server stop (non-blocking, .catch() swallowed)
4. Exit 1
```

### Properties

| Property | Guarantee |
|---|---|
| Idempotent | Second signal/exception during shutdown is a no-op |
| Ordered | Metrics stops before exit |
| Logged | All triggers produce structured JSON evidence |
| Null-safe | Handlers tolerate uninitialized logger and metrics (C2) |
| stdout-only | Zero stderr emissions (C1) |
| Exit code | 0 on clean signal shutdown. 1 on exception/rejection. |

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

## 8. Dockerfile (C5, M5)

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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist dist/
USER sync
EXPOSE 9090
CMD ["node", "dist/index.js"]
```

### Build strategy (C5)

The runtime stage installs its own production-only dependencies via `npm ci --omit=dev`. The builder's `node_modules` (which includes devDependencies like typescript, eslint, vitest) is **never copied** to the runtime image.

| Stage | Dependencies installed | Purpose |
|---|---|---|
| `builder` | All (dev + prod) | Compile TypeScript to JavaScript |
| runtime | Production only (`--omit=dev`) | Run the daemon |

**The runtime image contains zero devDependencies.** The document and Dockerfile are now consistent.

### Properties

| Property | Value | Justification |
|---|---|---|
| Base image | `node:20-alpine` | Node.js 20 LTS per Blueprint v1.6.1 §22. Alpine for minimal attack surface. |
| Multi-stage | Yes | Builder stage compiles. Runtime stage has production deps only (C5). |
| Non-root user | `sync` | Security. Daemon does not require root. |
| Signal handling | `CMD ["node", ...]` (exec form) | PID 1 receives SIGTERM directly. No shell wrapper. |
| `EXPOSE 9090` | Default metrics port (M5) | `EXPOSE` documents the default port. The runtime listens on `METRICS_PORT` which is configurable. If `METRICS_PORT` is set to a different value, `EXPOSE` has no operational effect — it is metadata only. |
| No ENTRYPOINT | — | `CMD` is sufficient. No wrapper scripts needed. |

---

## 9. QA Matrix

### 9.1 Mandatory scenario matrix

| # | Scenario | Expected result | Validates |
|---|---|---|---|
| T1 | Startup with all required env vars valid | `engine.start` event emitted. Process running. Metrics endpoint responds. | Bootstrap sequence |
| T2 | Missing single required env var (`SUPABASE_DB_URL`) | `ConfigurationError` thrown. `engine.fatal` emitted to stdout. Exit code 1. | Fail-fast config validation |
| T3 | Missing multiple required env vars | `ConfigurationError` with all missing vars listed. Exit code 1. | Aggregate error reporting |
| T4 | Optional numeric var with invalid value (e.g., `SYNC_BATCH_SIZE=abc`) | `ConfigurationError`. Exit code 1. | Type validation |
| T5 | Optional numeric var outside range (e.g., `SYNC_BATCH_SIZE=0`) | `ConfigurationError`. Exit code 1. | Range validation |
| T6 | `SYNC_LOG_LEVEL=debug` (invalid) | `ConfigurationError`. Exit code 1. | Enum validation |
| T7 | All optional vars omitted | Defaults applied. Engine starts. Config matches default values. `enableIdleTickLogs` is `false`. | Default application |
| T8 | Domain registry returns 2 validated domains | `control_llamadas` and `logestado` registered with `validatedAppendOnly=true`. `engine.domains_registered` logged with evidence references. | R26 validation gate (C4) |
| T9 | `getDomain('unknown_table')` | `UnsupportedDomainError` thrown. | R26 listed gate |
| T10 | `isSupported('unknown_table')` | Returns `false`. | R26 query |
| T11 | Domain registry query for `control_llamadas` | Returns correct `DomainConfig` with all fields matching Architecture §3 table, including `validatedAppendOnly=true` and non-empty `validationEvidence`. | Domain definition accuracy (C4) |
| T12 | Metrics endpoint `GET /metrics` | HTTP 200. Body contains `amaia_sync_engine_info`. Body contains `amaia_sync_engine_uptime_seconds`. Body contains `amaia_sync_cycles_total`. Prometheus text format. | Metrics exposition |
| T13 | Metrics endpoint includes process metrics | `process_cpu_seconds_total`, `process_resident_memory_bytes` present. | Default metrics |
| T14 | SIGTERM received during idle loop | `engine.shutdown` logged. `engine.shutdown_complete` logged. Metrics server stopped. Exit code 0. | Graceful shutdown |
| T15 | SIGINT received during idle loop | Same as T14. | Graceful shutdown (SIGINT) |
| T16 | Two SIGTERM signals in rapid succession | First triggers shutdown. Second is no-op. Single `engine.shutdown` event. | Idempotent shutdown |
| T17 | Log output format | Every log line is valid JSON. Contains `ts`, `level`, `engine_instance_id`, `owner_identity`, `event` fields. | Structured logging format |
| T18 | Log level filtering (`SYNC_LOG_LEVEL=error`) | `info` and `warn` events suppressed. `error` and `fatal` events emitted. | Log level gating |
| T19 | Secret values not logged | `engine.config_loaded` event does NOT contain full `SUPABASE_DB_URL` or `AMAIA_MYSQL_PASSWORD`. At most scheme + host for URL. | Security |
| T20 | Engine identity format | `owner_identity` matches pattern `engine:{uuid}:{hostname}:{pid}`. `engine_instance_id` is valid UUID v4. | Architecture §5 compliance |
| T21 | Startup failure before logger init | `engine.fatal` JSON emitted to **stdout** via `process.stdout.write()`. No stderr output. Exit code 1. | Pre-logger fallback (C1) |
| T22 | `SUPABASE_DB_URL=not-a-url` | `ConfigurationError` with "not a valid URL" message. Exit code 1. | URL validation (C6) |
| T23 | `SUPABASE_DB_URL=http://host/db` | `ConfigurationError` with invalid scheme message. Exit code 1. | Scheme validation (C6) |
| T24 | `SUPABASE_DB_URL=postgresql://postgres@host/db` | `ConfigurationError` with blocked privileged user message. Exit code 1. | Privileged user block (C6) |
| T25 | `SUPABASE_DB_URL=postgresql://sync_user@host/db` | Accepted. No validation error for this URL. | Valid URL accepted (C6) |
| T26 | `SUPABASE_DB_URL=postgresql://user@host/` (empty database) | `ConfigurationError` with empty database message. Exit code 1. | Database validation (C6) |
| T27 | Uncaught exception during idle loop | `engine.fatal` JSON emitted to stdout with `trigger: 'uncaughtException'` and `stack` field. Best-effort metrics shutdown. Exit code 1. | uncaughtException handler (C3) |
| T28 | Unhandled promise rejection during idle loop | `engine.fatal` JSON emitted to stdout with `trigger: 'unhandledRejection'`. Best-effort metrics shutdown. Exit code 1. | unhandledRejection handler (C3) |
| T29 | Signal received before logger/metrics initialized | `engine.shutdown` JSON emitted to stdout via fallback. Exit code 0. No crash. | Early signal safety (C2) |
| T30 | `ENABLE_IDLE_TICK_LOGS=false` (default) | Idle loop runs. `engine.tick` NOT emitted. Uptime metric still updated. | Tick suppression (M4) |
| T31 | `ENABLE_IDLE_TICK_LOGS=true` | Idle loop runs. `engine.tick` emitted each iteration. | Tick opt-in (M4) |
| T32 | `amaia_sync_cycles_total` in `/metrics` at startup | Metric present in Prometheus output with value 0 before any cycle runs. | Explicit initialization (M3) |
| T33 | Domain with `validatedAppendOnly=false` | Domain returned by `getDomains()` but NOT by `getValidatedDomains()`. `isSupported()` returns `false`. | Listed ≠ validated (C4) |

### 9.2 Invariant coverage (Sprint 0)

| Invariant | Test | Status |
|---|---|---|
| R1 — Single scheduler | T1 (single process) | Structural |
| R2 — Single worker | T1 (single process) | Structural |
| R26 — Unvalidated domains ineligible | T8, T9, T10, T11, T33 | Explicit — listed gate + validation gate (C4) |

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
4. **Configuration:** Table of all environment variables with types, defaults, and descriptions (including `ENABLE_IDLE_TICK_LOGS`).
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
| 2 | Implementation completed | All 6 source files + 5 config files implemented |
| 3 | QA scenario matrix green | All 33 tests pass |
| 4 | No critical defects | Zero open critical/major defects |
| 5 | CI pipeline green | lint + typecheck + unit + docker build + startup verify |
| 6 | Documentation updated | README.md created |
| 7 | Git commit created | Single commit with all Sprint 0 artifacts |
| 8 | Reproducible build | Docker image builds and starts with production deps only (C5) |
| 9 | Evidence artifacts stored | QA results + CI logs captured |

---

## 14. Architectural Invariant Compliance Matrix

| Invariant | Sprint 0 status | How addressed |
|---|---|---|
| R1 Single scheduler | Structural | Single process, no multi-worker |
| R2 Single worker | Structural | Single process, no threading |
| R26 Unvalidated domains ineligible | Implemented | Two-layer gate: listed (hardcoded) + validated (`validatedAppendOnly` with `validationEvidence`). Zero validated → startup failure. (C4) |
| R3–R25, R27–R35 | Deferred | Subsystems not yet built. Covered in Sprints 1–8. |

---

## 15. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Metrics library `prom-client` API breaking change | Low | Pin version in package-lock.json. Alpine image reproducible. |
| Node.js 20 `crypto.randomUUID()` not available | None | Available since Node.js 14.17. Node.js 20 is guaranteed. |
| `METRICS_PORT` conflicts with existing service on AMAIASQL | Low | Configurable. Default 9090 avoids common ports. |
| Config validates DB URL structure but Sprint 0 doesn't connect | Intentional | Fail-fast design. Structural validation (scheme, host, database, user) catches misconfiguration at startup. Connectivity validation deferred to Sprint 1 (M2). |
| `URL` constructor parsing edge cases | Low | Node.js WHATWG URL parser is well-tested. PostgreSQL connection strings use standard URL format. |

---

## 16. Sprint Boundary Contract

### What Sprint 0 delivers to Sprint 1

| Artifact | Contract |
|---|---|
| `RuntimeConfig` | Typed, validated configuration object. Sprint 1 reads `supabaseDbUrl` from it. URL structure already validated (C6). |
| `DomainRegistry` | Immutable registry of validated domains. Sprint 1+ queries domain metadata. `validatedAppendOnly` and `validationEvidence` available per domain (C4). |
| `Logger` | Structured logger with context support. Sprint 1+ passes `cycle_id`, `domain`, etc. All output to stdout (C1). |
| `MetricsServer` | Prometheus registry with `amaia_sync_cycles_total` already visible (M3). Sprint 1+ registers additional metrics via `inc()` and `set()`. |
| Error base classes | `ConfigurationError` and `StartupError` used by later subsystems. `UnsupportedDomainError` used by domain-runner. |
| `index.ts` | Bootstrap + shutdown. Sprint 1 adds `pg-client` init between steps 14 and 15. Sprint 6 adds `mysql-client`. Signal/exception handlers already registered (C2, C3). |
| Signal + exception handlers | Shutdown orchestration with null-safety. Sprint 1+ adds cleanup steps (pool close, lease release) to the shutdown function. |
| `emitFallbackLog()` | Pre-logger structured output to stdout. Available for any module that needs to emit evidence before the logger is constructed. |

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

**READY FOR CODEX HOSTILE RE-AUDIT**

---

**End of document.**
