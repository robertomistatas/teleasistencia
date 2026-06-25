# AMAIA-SYNC Sprint 0 — Local QA Report v1.0

**Type:** QA evidence report  
**Phase:** 9.4E  
**Sprint:** 0  
**Implementation version:** v1.1 (operational hardening applied)  
**Blueprint:** AMAIA_SYNC_SPRINT0_RUNTIME_SKELETON_BLUEPRINT_v1.1 (Codex approved with observations)  
**Git baseline:** Commit bd93634 (Phase 9.3C closed — Sprint 0 artifacts not yet committed)  
**QA executor:** Roberto (Architect) + Claude (Constructor)  
**Date:** 2026-06-25

---

## 1. Executive Summary

Sprint 0 Local QA has been completed on the development workstation. All executed tests pass. The implementation satisfies the Sprint 0 Blueprint v1.1, all 5 Codex observations (OBS-1 through OBS-5), and all 4 operational hardening corrections (MC-1 through MC-4).

| Category | Result |
|---|---|
| Typecheck | **PASS** |
| Lint | **PASS** (with non-blocking compatibility warning) |
| Build | **PASS** |
| Startup sequence | **PASS** |
| Health endpoint | **PASS** |
| Metrics endpoint | **PASS** |
| Graceful shutdown | **PASS** |
| Docker operational validation | **PENDING** |

**Local QA Status: GREEN**

Docker operational validation remains pending — requires execution on the target Ubuntu environment (VM AMAIASQL) or a Docker-capable host.

---

## 2. Environment

### Hardware

| Property | Value |
|---|---|
| Machine | HP Soporte workstation |
| OS | Windows 11 Pro 10.0.26200 |
| Platform | win32 / x64 |

### Runtime

| Component | Version |
|---|---|
| Node.js | v24.13.0 |
| TypeScript | 5.9.3 |
| npm | (bundled with Node.js 24) |

### Key dependencies (locked)

| Package | Locked version | Purpose |
|---|---|---|
| `prom-client` | 15.1.3 | Prometheus metrics (runtime) |
| `typescript` | 5.9.3 | TypeScript compiler (dev) |
| `eslint` | 8.57.1 | Linter (dev) |
| `@typescript-eslint/eslint-plugin` | 7.18.0 | TS lint rules (dev) |
| `vitest` | 1.6.0 | Test runner (dev) |

### Execution context

| Property | Value |
|---|---|
| Execution host | Developer workstation (Windows) |
| Target deployment host | VM AMAIASQL (Ubuntu, Node.js 20 LTS, systemd) |
| Network | Local only — no external database connectivity |
| Database connectivity | Not tested (Sprint 0 scope — presence/format validation only) |

---

## 3. QA Scope

### Validated

| Area | Coverage |
|---|---|
| TypeScript compilation | All 6 source files compile without errors under `strict: true` |
| ESLint | All 6 source files pass lint with zero errors |
| Bootstrap sequence | 17-step startup sequence executes correctly |
| Configuration validation | Required vars, optional defaults, URL structural validation, privileged user blocking |
| Domain registry | 2-layer gate (listed + validated), R26 enforcement, immutability |
| Structured logging | JSON stdout-only, level filtering, fatal level serialization |
| Pre-logger fallback | Structured JSON via `process.stdout.write()`, parametrizable level |
| Metrics exposition | Prometheus `/metrics` endpoint with 4 metric categories |
| Health endpoint | `GET /health` returns 200 with engine_instance_id and uptime |
| Graceful shutdown | SIGINT/SIGTERM → `engine.shutdown` → `engine.shutdown_complete` → exit 0 |
| Exception handlers | `uncaughtException`/`unhandledRejection` → `level:fatal` → exit 1 |
| Idle loop control | `ENABLE_IDLE_TICK_LOGS=false` suppresses ticks; `=true` emits them |

### NOT validated

| Area | Reason | Deferred to |
|---|---|---|
| Docker image build | Requires Docker engine (not available on QA workstation) | Operational validation on AMAIASQL |
| Docker HEALTHCHECK | Requires running container | Operational validation on AMAIASQL |
| Node.js 20 LTS runtime | Dev workstation runs Node.js 24; target is Node.js 20 LTS | Operational validation on AMAIASQL |
| SIGTERM via OS signal | Windows does not forward SIGTERM to child processes | Verified via `process.emit('SIGINT')` in-process |
| Automated test suite (vitest) | No test files created in Sprint 0 scope | Sprint 0 QA is manual + CI pipeline |
| Database connectivity | Sprint 0 does not connect to databases | Sprint 1 (PostgreSQL), Sprint 6 (MySQL) |

---

## 4. Test Execution Matrix

### 4.1 Build pipeline

| # | Test | Command | Expected | Observed | Status |
|---|---|---|---|---|---|
| B1 | TypeScript typecheck | `npm run typecheck` | Zero errors | Zero errors | **PASS** |
| B2 | ESLint | `npm run lint` | Zero errors | Zero errors (1 non-blocking warning) | **PASS** |
| B3 | Build | `npm run build` | Compiles to `dist/` | Compiled successfully | **PASS** |

### 4.2 Startup and lifecycle

| # | Test | Command | Expected | Observed | Status |
|---|---|---|---|---|---|
| S1 | Startup with valid config | `npm start` (with valid env vars, `METRICS_PORT=9100`) | `engine.config_loaded` → `engine.domains_registered` → `engine.start` | All 3 events emitted in order, JSON format, stdout-only | **PASS** |
| S2 | Config: secrets not logged | Inspect `engine.config_loaded` output | No `SUPABASE_DB_URL` full value, no `AMAIA_MYSQL_PASSWORD` | Only `supabase_db_target: "postgresql://localhost"` logged | **PASS** |
| S3 | Config: missing required var | Run without `SUPABASE_DB_URL` | `ConfigurationError`, `engine.fatal`, exit 1 | `"level":"fatal"`, exit 1, aggregate error list | **PASS** |
| S4 | Config: invalid URL scheme | `SUPABASE_DB_URL=http://host/db` | `ConfigurationError` with scheme error | Error includes "scheme must be postgres:// or postgresql://" | **PASS** |
| S5 | Config: blocked privileged user | `SUPABASE_DB_URL=postgresql://postgres@host/db` | `ConfigurationError` with blocked user error | Error includes "privileged user 'postgres' is blocked" | **PASS** |
| S6 | Config: valid URL accepted | `SUPABASE_DB_URL=postgresql://amaia_sync_runtime:p@host/db` | No validation error | Config loads successfully | **PASS** |
| S7 | Graceful shutdown (SIGINT) | Ctrl+C during idle loop | `engine.shutdown` → `engine.shutdown_complete` → exit 0 | Both events emitted, exit 0 | **PASS** |
| S8 | Idle tick suppression | `ENABLE_IDLE_TICK_LOGS=false` (default) | No `engine.tick` events | No tick events observed | **PASS** |
| S9 | Idle tick emission | `ENABLE_IDLE_TICK_LOGS=true` | `engine.tick` each interval | Tick events with `uptime_seconds` | **PASS** |

### 4.3 Endpoints

| # | Test | Command | Expected | Observed | Status |
|---|---|---|---|---|---|
| E1 | Health endpoint | `curl http://localhost:9100/health` | 200 OK, JSON with status/engine_instance_id/uptime_seconds | `{"status":"ok","engine_instance_id":"<uuid>","uptime_seconds":20}` | **PASS** |
| E2 | Metrics endpoint | `curl http://localhost:9100/metrics` | 200 OK, Prometheus text format | HTTP 200, Prometheus format | **PASS** |
| E3 | Metric: engine_info | Check `/metrics` body | `amaia_sync_engine_info` present with version/node_version/hostname labels | Present with correct labels | **PASS** |
| E4 | Metric: uptime | Check `/metrics` body | `amaia_sync_engine_uptime_seconds` present | Present, value updates | **PASS** |
| E5 | Metric: cycles_total | Check `/metrics` body | `amaia_sync_cycles_total` present with value 0 | Present, value 0 | **PASS** |
| E6 | Metric: process metrics | Check `/metrics` body | `process_cpu_seconds_total`, `process_resident_memory_bytes` present | Both present | **PASS** |
| E7 | Unknown route | `curl http://localhost:9100/unknown` | 404 | 404 | **PASS** |

### 4.4 Error handling

| # | Test | Command | Expected | Observed | Status |
|---|---|---|---|---|---|
| X1 | Fatal log level (MC-3) | Trigger startup failure | `"level":"fatal"` in output | `"level":"fatal"` confirmed | **PASS** |
| X2 | uncaughtException (MC-4) | Throw error during idle loop | `engine.fatal` with trigger + stack, exit 1 | Fatal JSON with `"trigger":"uncaughtException"`, stack trace in detail, exit 1 | **PASS** |
| X3 | unhandledRejection stack (OBS-2) | Reject promise with Error | `error` and `stack` fields preserved | Both fields present when reason is Error | **PASS** |
| X4 | Pre-logger fallback (C1) | Fail before logger creation | JSON to stdout via `process.stdout.write()` | Structured JSON on stdout, zero stderr | **PASS** |

### 4.5 Domain registry

| # | Test | Command | Expected | Observed | Status |
|---|---|---|---|---|---|
| D1 | Validated domains | `getValidatedDomains()` | 2 domains with `validatedAppendOnly=true` | `control_llamadas` and `logestado`, both validated | **PASS** |
| D2 | Exact evidence (OBS-4) | Check `validationEvidence` | `AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 §3 + §3.3` | Exact match | **PASS** |
| D3 | Unsupported domain | `getDomain('unknown')` | `UnsupportedDomainError` | Error code `UNSUPPORTED_DOMAIN_ERROR` | **PASS** |
| D4 | isSupported query | `isSupported('unknown')` | `false` | `false` | **PASS** |
| D5 | isSupported valid | `isSupported('control_llamadas')` | `true` | `true` | **PASS** |

### 4.6 Codex observation compliance

| # | OBS | Test | Observed | Status |
|---|---|---|---|---|
| O1 | OBS-1 | `emitFallbackLog()` with level `'info'`, `'warn'`, `'error'`, `'fatal'` | All 4 levels emit correctly | **PASS** |
| O2 | OBS-2 | `unhandledRejection` with Error reason | `error` = message, `stack` = stack trace | **PASS** |
| O3 | OBS-3 | `SUPABASE_DB_URL` with `Postgres` (mixed case) | Normalized to `postgres`, blocked | **PASS** |
| O4 | OBS-4 | `validationEvidence` exact string | Matches immutable reference exactly | **PASS** |
| O5 | OBS-5 | README METRICS_PORT Docker mapping | Documented with example | **PASS** |

---

## 5. Evidence Summary

### 5.1 Log events observed during valid startup

```
engine.config_loaded  → level:info, non-secret values only
engine.domains_registered → level:info, 2 domains with evidence references
engine.start          → level:info, engine_instance_id + owner_identity + metrics_port
```

### 5.2 Log events observed during graceful shutdown

```
engine.shutdown       → level:info, signal:"SIGINT"
engine.shutdown_complete → level:info
```

### 5.3 Log events observed during fatal failure

```
engine.fatal          → level:fatal, error message, exit code 1
```

### 5.4 Log format verification

Every emitted log line is:
- Valid JSON (single line)
- Contains: `ts`, `level`, `engine_instance_id`, `owner_identity`, `event`, `detail`
- Contains: `cycle_id`, `domain`, `run_id`, `manifest_id` (all `null` in Sprint 0)
- Written to stdout exclusively — zero stderr output observed

### 5.5 Engine identity format

```
owner_identity = "engine:{uuid-v4}:{hostname}:{pid}"
```

Matches Architecture v1.8.2 §5.

### 5.6 Metrics verified in `/metrics` response

```
amaia_sync_engine_info{version="0.1.0",node_version="v24.13.0",hostname="HPSOPORTE"} 1
amaia_sync_engine_uptime_seconds <value>
amaia_sync_cycles_total 0
process_cpu_seconds_total <value>
process_resident_memory_bytes <value>
```

### 5.7 Health endpoint response

```json
{"status":"ok","engine_instance_id":"<uuid>","uptime_seconds":20}
```

Content-Type: `application/json`. HTTP 200.

---

## 6. Observations

### OBS-QA-1 — TypeScript / @typescript-eslint compatibility warning

**Observed during:** `npm run lint`

**Warning text:**

```
WARNING: You are currently running a version of TypeScript which is not
officially supported by @typescript-eslint.

You may find that it works just fine, or you may not.

SUPPORTED TYPESCRIPT VERSIONS: >=4.7.4 <5.6.0

YOUR TYPESCRIPT VERSION: 5.9.3
```

**Assessment:** Non-blocking. ESLint executes successfully and produces zero errors. The warning is informational — `@typescript-eslint` 7.18.0 has not yet declared support for TypeScript 5.9.x. No functional impact observed.

**Risk:** Low. If a future TypeScript update introduces syntax that the current `@typescript-eslint` parser cannot handle, lint would break. Mitigated by pinning versions in `package-lock.json`.

**Action required:** None for Sprint 0. Consider upgrading `@typescript-eslint` to a version that supports TypeScript 5.9+ when available, or pin TypeScript to `<5.6.0` if strict compatibility is required.

### OBS-QA-2 — Node.js version mismatch

**Development:** Node.js v24.13.0  
**Target deployment:** Node.js 20 LTS (per Blueprint v1.6.1 §22)  
**Dockerfile base image:** `node:20-alpine`

**Assessment:** Sprint 0 uses only ES2022 features and Node.js 20+ APIs (`crypto.randomUUID()`, `node:http`, `node:os`). No Node.js 24-specific APIs used. The Docker image enforces Node.js 20 at runtime. Risk of version-specific incompatibility is minimal but must be validated via Docker build on the target environment.

**Action required:** Docker operational validation on AMAIASQL (Node.js 20 LTS).

---

## 7. Pending Operational Validation

The following validations must be completed before Sprint 0 can be formally closed.

| # | Validation | Environment | Dependency |
|---|---|---|---|
| PV-1 | `docker build -t amaia-sync-runtime:sprint0 .` | Docker-capable host | Docker engine |
| PV-2 | `docker run` with valid env vars | Docker-capable host | PV-1 |
| PV-3 | Container reaches `healthy` status via HEALTHCHECK | Docker-capable host | PV-2 |
| PV-4 | `curl /health` and `curl /metrics` from host | Docker-capable host | PV-2 |
| PV-5 | `docker stop` → graceful shutdown (exit 0) | Docker-capable host | PV-2 |
| PV-6 | Node.js 20 LTS runtime compatibility | Docker container (node:20-alpine) | PV-1 |

**Execution plan:** These validations are executed when the code is deployed to the AMAIASQL VM or any Docker-capable environment. They do not require database connectivity — Sprint 0 does not connect to databases.

---

## 8. Final Assessment

### Artifact inventory

| File | Lines | Status |
|---|---|---|
| `src/index.ts` | 207 | Verified |
| `src/config/config.ts` | 181 | Verified |
| `src/config/domain-registry.ts` | 96 | Verified |
| `src/observability/logger.ts` | 95 | Verified |
| `src/observability/metrics.ts` | 126 | Verified |
| `src/errors/error-types.ts` | 40 | Verified |
| **Total source** | **745** | |
| `package.json` | — | Verified |
| `package-lock.json` | — | Verified (reproducible) |
| `tsconfig.json` | — | Verified |
| `Dockerfile` | — | Verified (not executed) |
| `README.md` | — | Verified |
| `.env.example` | — | Verified |
| `.gitignore` | — | Verified |
| `eslint.config.js` | — | Verified |

### Compliance matrix

| Requirement | Source | Status |
|---|---|---|
| Blueprint v1.1 — 17-step bootstrap | Sprint 0 Blueprint §4.6 | **COMPLIANT** |
| Blueprint v1.1 — 4 error classes only | Sprint 0 Blueprint §4.5 | **COMPLIANT** |
| Blueprint v1.1 — stdout-only logging | Sprint 0 Blueprint §4.3 (C1) | **COMPLIANT** |
| Blueprint v1.1 — R26 append-only gate | Sprint 0 Blueprint §4.2 (C4) | **COMPLIANT** |
| Blueprint v1.1 — URL structural validation | Sprint 0 Blueprint §4.1 (C6) | **COMPLIANT** |
| Blueprint v1.1 — Signal handlers before resources | Sprint 0 Blueprint §4.6 (C2) | **COMPLIANT** |
| Blueprint v1.1 — Exception handlers from Sprint 0 | Sprint 0 Blueprint §4.6 (C3) | **COMPLIANT** |
| Codex OBS-1 — Fallback log parametrizable level | Codex audit | **COMPLIANT** |
| Codex OBS-2 — unhandledRejection preserves stack | Codex audit | **COMPLIANT** |
| Codex OBS-3 — Username normalization | Codex audit | **COMPLIANT** |
| Codex OBS-4 — Exact immutable evidence reference | Codex audit | **COMPLIANT** |
| Codex OBS-5 — README METRICS_PORT mapping | Codex audit | **COMPLIANT** |
| MC-1 — Health endpoint | Operational hardening | **COMPLIANT** |
| MC-2 — Docker HEALTHCHECK | Operational hardening | **COMPLIANT** (Dockerfile, not executed) |
| MC-3 — Fatal log level | Operational hardening | **COMPLIANT** |
| MC-4 — Exception handlers stop idle loop | Operational hardening | **COMPLIANT** |
| Zero prohibited dependencies | Sprint 0 Blueprint §12 | **COMPLIANT** |
| Zero future sprint contamination | Sprint 0 Blueprint §12 | **COMPLIANT** |

### Prohibition verification

| Prohibited item | Present in codebase | Status |
|---|---|---|
| `pg` / `pg-pool` dependency | No | **CLEAN** |
| `mysql2` dependency | No | **CLEAN** |
| `@supabase/supabase-js` dependency | No | **CLEAN** |
| Repository files (`*-repository.ts`) | No | **CLEAN** |
| Service files (`*-service.ts`) | No | **CLEAN** |
| Engine/scheduler/cycle/domain runner | No | **CLEAN** |
| Lease, recovery, manifest, watermark logic | No | **CLEAN** |
| Business logic | No | **CLEAN** |

### Test execution summary

| Category | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| Build pipeline | 3 | 3 | 0 | 0 |
| Startup and lifecycle | 9 | 9 | 0 | 0 |
| Endpoints | 7 | 7 | 0 | 0 |
| Error handling | 4 | 4 | 0 | 0 |
| Domain registry | 5 | 5 | 0 | 0 |
| Codex observations | 5 | 5 | 0 | 0 |
| **Total** | **33** | **33** | **0** | **0** |

### Final classification

```
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   LOCAL QA STATUS:  GREEN                                 ║
║                                                           ║
║   33/33 tests passed                                      ║
║   0 critical defects                                      ║
║   0 major defects                                         ║
║   2 non-blocking observations (OBS-QA-1, OBS-QA-2)       ║
║                                                           ║
║   Docker operational validation: PENDING                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

Sprint 0 is ready for git commit and Docker operational validation on the target environment.

---

**End of report.**
