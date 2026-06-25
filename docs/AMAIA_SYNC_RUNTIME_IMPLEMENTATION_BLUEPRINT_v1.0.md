# AMAIA-SYNC Runtime Implementation Blueprint v1.0

**Type:** Implementation blueprint  
**Status:** Pending architectural review  
**Parent:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## 1. Business Problem

AMAIA MySQL contains operational data for elderly care (call logs, alert state logs). The Mistatas platform on Supabase needs this data current for dashboards, SLA monitoring, and institutional reporting. The Runtime Engine synchronizes AMAIA → Supabase incrementally, producing cryptographic evidence of every sync operation.

## 2. Runtime Goals

1. Synchronize control_llamadas and logestado from AMAIA to Supabase.
2. Produce manifest evidence for every sync cycle.
3. Advance watermarks only on verified success.
4. Detect and record discrepancies.
5. Recover from failures without data loss.
6. Run as a headless daemon on AMAIASQL.

## 3. Runtime Module Tree

```
amaia-sync-runtime/
├── src/
│   ├── index.ts                    # Entry point: bootstrap + daemon loop
│   ├── config/
│   │   ├── config.ts               # Configuration loader + validation
│   │   └── domain-registry.ts      # Active domain definitions + append-only gate
│   ├── core/
│   │   ├── engine.ts               # Top-level daemon lifecycle
│   │   ├── scheduler.ts            # Scheduler lease acquisition + heartbeat
│   │   ├── cycle-runner.ts         # Cycle creation + domain iteration + recovery
│   │   └── domain-runner.ts        # Per-domain: pre-fence + fenced tx + post-commit
│   ├── services/
│   │   ├── lease-manager.ts        # Lease acquire/release/heartbeat/validate
│   │   ├── watermark-service.ts    # Read watermark + compute bounds + hard revalidation
│   │   ├── manifest-service.ts     # Create manifest + insert source items + call finalizers + guarded terminalization
│   │   ├── run-service.ts          # Pre-run create + bind + terminal status + lock-contention close
│   │   └── recovery-service.ts     # Stale detection + abandon + orphan classification
│   ├── repositories/
│   │   ├── supabase-client.ts      # Supabase connection + SET LOCAL ROLE + transaction management
│   │   ├── mysql-client.ts         # AMAIA MySQL readonly connection pool
│   │   ├── run-repository.ts       # amaia_sync_runs CRUD
│   │   ├── cycle-repository.ts     # amaia_sync_cycles CRUD
│   │   ├── lease-repository.ts     # amaia_sync_leases CRUD
│   │   ├── watermark-repository.ts # amaia_sync_watermarks read
│   │   ├── manifest-repository.ts  # amaia_sync_run_manifests + identity_items insert
│   │   └── destination-repository.ts # Domain-specific upsert into destination tables
│   ├── extraction/
│   │   ├── amaia-fetcher.ts        # Batched fetch from AMAIA per domain
│   │   └── domain-queries.ts       # Per-domain SELECT queries for AMAIA
│   ├── observability/
│   │   ├── logger.ts               # Structured JSON logger
│   │   └── metrics.ts              # Prometheus metrics registry + HTTP endpoint
│   └── errors/
│       └── error-types.ts          # Error taxonomy classes
├── Dockerfile
├── package.json
└── tsconfig.json
```

## 4. Bootstrap Sequence

```
1. Load and validate configuration (config.ts).
2. Validate domain registry — append-only gate (R26):
   - For each configured domain, check append-only evidence.
   - Unsupported domains → status=unsupported, skipped.
   - Zero valid domains → exit with configuration error.
3. Initialize MySQL client (read-only connection).
4. Initialize Supabase client (service_role key).
5. Generate engine_instance_id (UUID v4).
6. Construct owner_identity = "engine:{uuid}:{hostname}:{pid}".
7. Register SIGTERM/SIGINT handlers for graceful shutdown.
8. Start metrics HTTP server.
9. Log engine.start event.
10. Enter daemon loop (engine.ts).
```

## 5. Runtime Lifecycle

```
┌─────────────────────────────────────────────────────┐
│                    DAEMON LOOP                       │
│                                                      │
│  while (running) {                                   │
│    try {                                             │
│      acquired = scheduler.acquireLease()             │
│      if (!acquired) {                                │
│        log scheduler.lease_held                      │
│        sleep(CYCLE_INTERVAL)                         │
│        continue                                      │
│      }                                               │
│      recovery.runCycleStartRecovery()    // R28      │
│      cycle = cycleRunner.createCycle()               │
│      cycleRunner.executeCycle(cycle)                  │
│      scheduler.releaseLease()                        │
│    } catch (authorityError) {                        │
│      log authority.failure                           │
│    }                                                 │
│    sleep(CYCLE_INTERVAL)                             │
│  }                                                   │
│  // Graceful shutdown                                │
│  scheduler.releaseLease()                            │
│  mysql.close()                                       │
│  supabase.close()                                    │
└─────────────────────────────────────────────────────┘
```

## 6. Scheduler Service

**File:** `scheduler.ts`

**Responsibilities:**
- Acquire scheduler lease (`entity_name='scheduler'`).
- Heartbeat between domains (before + after each domain).
- Validate scheduler lease before each domain (expiry abort rule).
- Release lease on shutdown.

**Mapping to architecture:**
- Section 4 (Scheduler Model).
- Section 4.1 (Cycle Admission Control): scheduler lease loss mid-domain is tolerated (R16).
- Section 4.2 (Heartbeat): only between domains.

**Interface:**

```typescript
interface SchedulerService {
  acquireLease(): Promise<boolean>;
  heartbeat(): Promise<void>;
  isLeaseValid(): Promise<boolean>;
  releaseLease(): Promise<void>;
  getLeaseCredentials(): { owner_identity: string; lease_token: number };
}
```

## 7. Cycle Runner

**File:** `cycle-runner.ts`

**Responsibilities:**
- Create cycle record.
- Iterate active domains in fixed order (control_llamadas, logestado).
- Before each domain: scheduler heartbeat + lease validity check.
- After each domain: scheduler heartbeat.
- On scheduler lease expiry: abort cycle, do not start next domain.
- Catch domain errors: log, continue to next domain.
- Catch authority errors: abort cycle.

**Mapping:**
- Section 4.3 (Per-Domain Flow).
- Section 16.1 (Domain Failures → continue).
- Section 16.2 (Authority Failures → abort).

**Interface:**

```typescript
interface CycleRunner {
  createCycle(): Promise<Cycle>;
  executeCycle(cycle: Cycle): Promise<CycleResult>;
}
```

## 8. Domain Runner

**File:** `domain-runner.ts`

**Responsibilities:**
- Execute the complete per-domain flow from architecture Section 4.3.
- Pre-fence: read watermark, compute bounds, fetch AMAIA, create pre-run.
- Fenced transaction: all 12 steps from Section 10.
- Post-commit: best-effort lease release.
- Post-rollback (lock contention): close pre-run as `skipped_lock_contention`.
- Post-rollback (other): pre-run remains unbound, recovered next cycle (R35).

**Mapping:**
- Section 4.3 (Per-Domain Flow) — single authoritative sequence.
- Section 7 (Domain Lease).
- Section 8 (Run Lifecycle).
- Section 9 (Extraction).
- Section 10 (Fenced Transaction).

**Internal flow:**

```
async executeDomain(cycle, domain):
  // PRE-FENCE
  watermark = await watermarkService.readCurrent(domain)
  bounds = await watermarkService.computeBounds(domain, watermark)
  if (bounds.isEmpty) → executeEmptyIncremental(...)
  rows = await amaiaFetcher.fetch(domain, bounds)     // R4, R29
  preRun = await runService.createPreRun(cycle, domain, bounds)  // R22

  // FENCED TRANSACTION
  try {
    await supabase.beginTransaction()
    await supabase.setLocalRole('amaia_sync_runtime')
    lease = await leaseManager.acquireDomainLease(domain)  // R20, step 2
    await runService.bindToLease(preRun, lease)             // R23, step 3
    await watermarkService.hardRevalidate(domain, bounds)   // R24, step 4
    manifest = await manifestService.createManifest(preRun, domain)  // step 5
    await manifestService.insertSourceItems(manifest, rows)          // step 6
    await destinationRepo.upsertRows(domain, rows)                   // step 7
    await manifestService.finalizeSource(manifest, preRun)            // step 8
    setsMatch = await manifestService.finalizeComparison(manifest, preRun)  // step 9
    if (setsMatch && manifest.sourceCount > 0)
      await manifestService.advanceWatermarkCas(domain, bounds, preRun)  // step 10
    await manifestService.guardedTerminalization(manifest, preRun, lease, setsMatch)  // step 11, R27/R31/R32
    await supabase.commit()  // step 12
  } catch (e) {
    await supabase.rollback()
    if (isLockContention(e))
      await runService.closeLockContention(preRun)  // R30
    throw e
  }

  // POST-COMMIT
  await leaseManager.releaseDomainLease(domain, lease)  // R25
```

## 9. Lease Manager

**File:** `lease-manager.ts`

**Responsibilities:**
- Acquire domain lease via `SELECT ... FOR UPDATE` inside fenced tx (R20).
- Validate lease ownership predicate.
- Release domain lease post-commit (best-effort, R25).
- Read lease for recovery predicates.

**Interface:**

```typescript
interface LeaseManager {
  acquireDomainLease(domain: string): Promise<Lease>;
  releaseDomainLease(domain: string, lease: Lease): Promise<void>;
  validateLeasePredicate(lease: Lease, run: Run): boolean;
}
```

## 10. Watermark Service

**File:** `watermark-service.ts`

**Responsibilities:**
- Read current watermark from Supabase.
- Compute safe upper bound from AMAIA: `MAX(id) - safety_lag`.
- Apply max_incremental_window: `min(safe_upper, lower + max_window)`.
- Hard revalidation inside fenced tx: `ASSERT current == run.lower_bound` (R24).
- Detect empty incrementals (`effective_upper <= lower`).

**Interface:**

```typescript
interface WatermarkService {
  readCurrent(domain: string): Promise<Watermark>;
  computeBounds(domain: string, watermark: Watermark): Promise<Bounds>;
  hardRevalidate(domain: string, bounds: Bounds): Promise<void>;
}
```

## 11. Manifest Service

**File:** `manifest-service.ts`

**Responsibilities:**
- Create manifest (`phase=created`).
- Insert source identity items (batch, inside fenced tx).
- Call `amaia_sync_finalize_source` (step 8).
- Call `amaia_sync_finalize_comparison` (step 9).
- Call `amaia_sync_advance_watermark_cas` (step 10, conditional).
- Execute Guarded Terminalization (step 11):
  - Read domain lease and assert fresh predicate.
  - Call `amaia_sync_complete_manifest`.
  - Update run terminal status (`success` | `completed_with_discrepancy`).

**Interface:**

```typescript
interface ManifestService {
  createManifest(run: Run, domain: DomainConfig): Promise<Manifest>;
  insertSourceItems(manifest: Manifest, rows: AmaiaRow[]): Promise<void>;
  finalizeSource(manifest: Manifest, run: Run): Promise<void>;
  finalizeComparison(manifest: Manifest, run: Run): Promise<boolean>;
  advanceWatermarkCas(domain: string, bounds: Bounds, run: Run): Promise<void>;
  guardedTerminalization(manifest: Manifest, run: Run, lease: Lease, setsMatch: boolean): Promise<void>;
}
```

## 12. Run Service

**File:** `run-service.ts`

**Responsibilities:**
- Create pre-run with NULL credentials (R22, R29).
- Bind run to lease inside fenced tx (R23).
- Set terminal status inside fenced tx.
- Close lock-contention pre-run post-rollback (R30).

**Interface:**

```typescript
interface RunService {
  createPreRun(cycle: Cycle, domain: DomainConfig, bounds: Bounds): Promise<Run>;
  bindToLease(run: Run, lease: Lease): Promise<void>;
  setTerminalStatus(run: Run, status: 'success' | 'completed_with_discrepancy'): Promise<void>;
  closeLockContention(run: Run): Promise<void>;
}
```

## 13. Repository Layer

All database access through typed repositories. No raw SQL outside repositories.

| Repository | Table(s) | Operations |
|---|---|---|
| `cycle-repository` | amaia_sync_cycles | INSERT |
| `run-repository` | amaia_sync_runs | INSERT, UPDATE |
| `lease-repository` | amaia_sync_leases | SELECT FOR UPDATE, UPDATE |
| `watermark-repository` | amaia_sync_watermarks | SELECT |
| `manifest-repository` | amaia_sync_run_manifests, identity_items | INSERT |
| `destination-repository` | amaia_call_logs, amaia_alert_logs | INSERT ON CONFLICT |

### Supabase Client (`supabase-client.ts`)

- Single connection via service_role key.
- `beginTransaction()`, `commit()`, `rollback()`.
- `SET LOCAL ROLE amaia_sync_runtime` at transaction start.
- RPC calls for SECURITY DEFINER functions.

Transaction lifecycle owned by domain-runner. Repositories receive transaction context as parameter.

## 14. MySQL Reader Layer

**Files:** `amaia-fetcher.ts`, `domain-queries.ts`

- Single read-only connection.
- Batched: `SELECT * FROM :table WHERE id > ? AND id <= ? ORDER BY id LIMIT ?`.
- `MAX(id)` for safe upper bound.
- No writes, no procedures, no temp tables (R3).

| Domain | Table | Query |
|---|---|---|
| control_llamadas | control_llamadas | `SELECT * FROM control_llamadas WHERE id > ? AND id <= ? ORDER BY id LIMIT ?` |
| logestado | logestado | `SELECT * FROM logestado WHERE id > ? AND id <= ? ORDER BY id LIMIT ?` |

## 15. Error Taxonomy

**File:** `error-types.ts`

| Error class | Category | Action |
|---|---|---|
| `AmaiaConnectionError` | Authority | Abort cycle |
| `SupabaseConnectionError` | Authority | Abort cycle |
| `SchedulerLeaseExpiredError` | Authority | Abort cycle |
| `DomainLeaseContentionError` | Domain | Close pre-run, skip |
| `WatermarkRevalidationError` | Domain | Rollback, skip |
| `CasFailureError` | Domain | Rollback, skip |
| `GuardedTerminalizationError` | Domain | Rollback, skip |
| `UpsertError` | Domain | Rollback, skip |
| `FinalizeError` | Domain | Rollback, skip |
| `AmaiaFetchError` | Domain | No pre-run, skip |

## 16. Retry Policy

| Context | Strategy |
|---|---|
| MySQL/Supabase connection | Exponential backoff: 1s base, 30s max, 3 attempts, ±25% jitter |
| Domain failure | No retry within cycle. Next cycle retries same watermark. |
| Cycle scheduling | Fixed interval (default 60s) |

## 17. Recovery Service

**File:** `recovery-service.ts`

Executes at startup AND before every cycle (R28).

**Bound stale detection** (lease JOIN):

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running' AND r.owner_identity IS NOT NULL
AND (r.owner_identity IS DISTINCT FROM l.owner_identity
     OR r.lease_token IS DISTINCT FROM l.lease_token
     OR l.lease_expires_at <= now())
AND now() > greatest(l.lease_expires_at, l.heartbeat_at + interval '10 minutes');
```

**Unbound stale detection** (run-local only, R34):

```sql
SELECT r.* FROM amaia_sync_runs r
WHERE r.status = 'running' AND r.owner_identity IS NULL
  AND r.created_at < now() - interval '10 minutes';
```

Classification: no durable evidence → `orphan_recovered`. Durable evidence in Operational Failure Channel → `failed`.

## 18. Structured Logging

**File:** `logger.ts`

JSON to stdout:

```json
{
  "ts": "ISO8601",
  "level": "info|warn|error",
  "engine_instance_id": "uuid",
  "cycle_id": "uuid|null",
  "domain": "string|null",
  "run_id": "uuid|null",
  "manifest_id": "uuid|null",
  "event": "string",
  "detail": {}
}
```

## 19. Metrics

**File:** `metrics.ts`

Prometheus on `METRICS_PORT` (default 9090).

| Metric | Type |
|---|---|
| `amaia_sync_cycles_total{status}` | counter |
| `amaia_sync_runs_total{domain,status}` | counter |
| `amaia_sync_empty_incrementals_total{domain}` | counter |
| `amaia_sync_lock_contentions_total{domain}` | counter |
| `amaia_sync_rows_fetched{domain}` | counter |
| `amaia_sync_rows_upserted{domain}` | counter |
| `amaia_sync_manifests_total{domain,sets_match}` | counter |
| `amaia_sync_watermark_position{domain}` | gauge |
| `amaia_sync_cycle_duration_seconds` | histogram |
| `amaia_sync_domain_duration_seconds{domain}` | histogram |
| `amaia_sync_cas_failures_total{domain}` | counter |
| `amaia_sync_guarded_term_failures_total{domain}` | counter |
| `amaia_sync_authority_failures_total{reason}` | counter |
| `amaia_sync_discrepancies_total{domain}` | counter |
| `amaia_sync_recovery_runs_total{outcome}` | counter |

## 20. Configuration Model

**File:** `config.ts`

Environment variables only. No config files. No runtime mutation.

| Variable | Type | Default | Validation |
|---|---|---|---|
| `SUPABASE_URL` | string | — | Required, URL |
| `SUPABASE_SERVICE_KEY` | string | — | Required |
| `AMAIA_MYSQL_HOST` | string | — | Required |
| `AMAIA_MYSQL_PORT` | number | 3306 | 1–65535 |
| `AMAIA_MYSQL_USER` | string | — | Required |
| `AMAIA_MYSQL_PASSWORD` | string | — | Required |
| `AMAIA_MYSQL_DATABASE` | string | — | Required |
| `SYNC_CYCLE_INTERVAL_MS` | number | 60000 | ≥1000 |
| `SYNC_SAFETY_LAG_ID` | number | 100 | ≥0 |
| `SYNC_LEASE_TTL_SECONDS` | number | 300 | ≥60 |
| `SYNC_BATCH_SIZE` | number | 1000 | 1–50000 |
| `SYNC_MAX_WINDOW` | number | 10000 | 1–100000 |
| `SYNC_PRE_RUN_STALE_TTL_SECONDS` | number | 600 | ≥60 |
| `SYNC_LOG_LEVEL` | string | info | info\|warn\|error |
| `METRICS_PORT` | number | 9090 | 1–65535 |

Startup fails if required variables missing or validation fails.

## 21. Deployment on AMAIASQL

```
VM: AMAIASQL (Ubuntu)
Runtime: Node.js 20 LTS
Process manager: systemd

[Unit]
Description=AMAIA-SYNC Runtime Engine V1
After=network-online.target

[Service]
Type=simple
User=amaia-sync
EnvironmentFile=/etc/amaia-sync/env
ExecStart=/usr/bin/node /opt/amaia-sync-runtime/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Secrets in `/etc/amaia-sync/env` with `chmod 600`.

## 22. QA Strategy

### Unit tests

| Module | Tests |
|---|---|
| config | Missing vars → error. Invalid → error. Defaults. |
| domain-registry | Append-only gate. Unknown rejected. Zero valid → error. |
| watermark-service | Safety lag. Max window. Empty detection. |
| lease-manager | Predicate validation. |
| run-service | Pre-run NULL. Bind. Lock contention close. |
| manifest-service | Guarded Terminalization predicate. |
| error-types | Authority vs domain classification. |

### Integration tests (Docker Compose: local MySQL + local Supabase)

| Scenario | Validates |
|---|---|
| Full cycle, 2 domains | End-to-end |
| Empty incremental | No CAS, success, watermark unchanged |
| Discrepancy | completed_with_discrepancy, watermark unchanged |
| CAS failure | Full rollback, pre-run unbound |
| Guarded Terminalization failure | Full rollback |
| Watermark revalidation failure | Full rollback |
| Lock contention | skipped_lock_contention |
| AMAIA fetch failure | No pre-run |
| Recovery: bound stale | Manifest abandoned, orphan_recovered |
| Recovery: unbound stale | orphan_recovered |
| Recovery: run without manifest | orphan_recovered |
| Authority failure | Cycle aborted |
| Max window cap | Only max_window rows |
| Graceful shutdown | Current domain completes |

## 23. Non-Goals

| Item | Reason |
|---|---|
| Timestamp domains | V1 id-only |
| Mutable domains | V1 append-only |
| Delete sync | No deletes |
| Multi-worker | Single-threaded |
| Provisional | Dormant |
| Reconciliation | Phase 9.5 |
| UI | Headless |
| SOS Mujer | Excluded |
| ORM | Raw SQL via repositories |
| Hot reload | Restart required |

## 24. Architectural Invariant Mapping

| Invariant | Implemented by |
|---|---|
| R1 Single scheduler | scheduler.ts: acquireLease |
| R2 Single worker | engine.ts: single loop |
| R3 AMAIA readonly | mysql-client.ts: read-only |
| R4 Fetch before fence | domain-runner.ts: fetch before beginTransaction |
| R5 Evidence inside fence | domain-runner.ts: steps 5–11 inside tx |
| R6 CAS inside tx | manifest-service.ts: advanceWatermarkCas |
| R7 No advance without completion | manifest-service.ts: CAS before terminalization |
| R8 No abandon healthy | recovery-service.ts: predicate check |
| R9 Empty no CAS | domain-runner.ts: conditional |
| R10 Multi-process unsupported | scheduler.ts: lease |
| R11 Id-based only | domain-registry.ts: check |
| R12 No evidence before commit | supabase-client.ts: tx boundary |
| R13 No provisional | manifest-service.ts: never calls |
| R14 Within TTL | config.ts + domain-runner.ts: no heartbeat in tx |
| R15/R19 Append-only | domain-registry.ts: gate |
| R16 Domain lease = authority | lease-manager.ts + guardedTerminalization |
| R17 Bounded | watermark-service.ts: max_window |
| R18 Non-empty success → advance | manifest-service.ts: conditional CAS |
| R20 Lease at fence start | domain-runner.ts: acquire in beginTransaction |
| R21 Expired → stale | recovery-service.ts |
| R22 Pre-run NULL | run-service.ts: createPreRun |
| R23 Binding before manifest | domain-runner.ts: order |
| R24 Hard revalidation | watermark-service.ts |
| R25 Release advisory | lease-manager.ts: try/catch |
| R26 Unvalidated ineligible | domain-registry.ts: startup |
| R27 Terminal predicate | manifest-service.ts: guardedTerminalization |
| R28 Recovery startup+cycle | cycle-runner.ts |
| R29 Pre-run after fetch | domain-runner.ts |
| R30 Lock contention closure | run-service.ts |
| R31 Single terminal op | manifest-service.ts |
| R32 Fresh predicate | manifest-service.ts |
| R33/R34 Unbound local | recovery-service.ts: no lease JOIN |
| R35 Rollback → unbound | domain-runner.ts: rollback reverts bind |

---

READY FOR ARCHITECTURAL REVIEW
