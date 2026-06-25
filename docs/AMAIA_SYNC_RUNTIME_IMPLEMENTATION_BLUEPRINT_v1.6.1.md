# AMAIA-SYNC Runtime Implementation Blueprint v1.6.1

**Type:** Implementation blueprint — FINAL SELF-CONTAINED VERSION  
**Status:** Approved with observations → documentation hygiene applied  
**Supersedes:** v1.6 (approved — inlined all inherited sections for implementation handoff)  
**Parent:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.6

| # | Type | Fix |
|---|---|---|
| Obs | Documentation hygiene | All "Identical to vX.Y" references replaced with inline content. Guarded Terminalization fully embedded. Document is self-contained. |

---

## 1. Business Problem

AMAIA MySQL contains operational data for elderly care. Supabase needs it current. The Runtime Engine synchronizes incrementally with cryptographic evidence.

## 2. Runtime Goals

1. Synchronize control_llamadas and logestado.
2. Manifest evidence every cycle.
3. Watermark advancement only on verified success.
4. Detect/record discrepancies.
5. Recover without data loss.
6. Headless daemon on AMAIASQL.

## 3. Runtime Module Tree

```
amaia-sync-runtime/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── config.ts
│   │   └── domain-registry.ts
│   ├── core/
│   │   ├── engine.ts
│   │   ├── scheduler.ts
│   │   ├── cycle-runner.ts
│   │   └── domain-runner.ts
│   ├── services/
│   │   ├── lease-manager.ts
│   │   ├── watermark-service.ts
│   │   ├── manifest-service.ts
│   │   ├── run-service.ts
│   │   ├── recovery-service.ts
│   │   └── operational-error-service.ts
│   ├── repositories/
│   │   ├── pg-client.ts
│   │   ├── mysql-client.ts
│   │   ├── run-repository.ts
│   │   ├── cycle-repository.ts
│   │   ├── lease-repository.ts
│   │   ├── watermark-repository.ts
│   │   ├── manifest-repository.ts
│   │   ├── destination-repository.ts
│   │   └── operational-error-repository.ts
│   ├── extraction/
│   │   ├── amaia-fetcher.ts
│   │   └── domain-queries.ts
│   ├── observability/
│   │   ├── logger.ts
│   │   └── metrics.ts
│   └── errors/
│       └── error-types.ts
├── Dockerfile
├── package.json
└── tsconfig.json
```

## 4. Bootstrap Sequence

```
1. Load and validate configuration.
2. Validate domain registry — append-only gate (R26).
3. Initialize MySQL client (read-only).
4. Initialize PostgreSQL pg client using SUPABASE_DB_URL (Section 13.1).
5. Generate engine_instance_id (UUID v4).
6. Construct owner_identity.
7. Register SIGTERM/SIGINT handlers.
8. Start metrics HTTP server.
9. Log engine.start.
10. Enter daemon loop.
```

## 5. Runtime Lifecycle

```
while (running) {
  let schedulerAcquired = false
  try {
    schedulerAcquired = await scheduler.acquireLease()
    if (!schedulerAcquired) { log; sleep; continue }
    recovery.runCycleStartRecovery()                    // R28
    cycle = cycleRunner.createCycle()
    cycleRunner.executeCycle(cycle)
  } catch (authorityError) {
    log authority.failure
  } finally {
    if (schedulerAcquired) {
      try { await scheduler.releaseLease() }
      catch { log; metric++ }
    }
  }
  sleep(CYCLE_INTERVAL)
}
// Shutdown
try { await scheduler.releaseLease() } catch {}
mysql.close()
pgPool.end()
```

## 6. Scheduler Service

```typescript
interface SchedulerService {
  acquireLease(): Promise<boolean>;
  heartbeat(): Promise<void>;
  isLeaseValid(): Promise<boolean>;
  releaseLease(): Promise<void>;
  getLeaseCredentials(): { owner_identity: string; lease_token: number };
}
```

Heartbeat only between domains. Scheduler lease = cycle admission (R16).

## 7. Cycle Runner

```typescript
interface CycleRunner {
  createCycle(): Promise<Cycle>;
  executeCycle(cycle: Cycle): Promise<CycleResult>;
}
```

Fixed order: control_llamadas, logestado. Domain errors → continue. Authority errors → abort.

## 8. Domain Runner

### 8.0 Post-Release State Machine

Both non-empty and empty paths use this **identical** state machine. No field or step may differ.

**State fields (declared before try):**

```typescript
let lease: Lease | null = null
let committed = false
let originalError: unknown = null
let rollbackOk = false
let shouldCloseLockContention = false
let capturedUnrecoverable: UnrecoverableError | null = null
```

**Fenced try/catch:**

```
try { ... COMMIT; committed = true }
catch (e) {
  originalError = e
  try { ROLLBACK; rollbackOk = true }
  catch { log+metric; rollbackOk = false }
  shouldCloseLockContention = rollbackOk && isLockContention(e)
  if (isUnrecoverable(e)) capturedUnrecoverable = e
}
finally {
  if (rollbackOk || committed) client.release()
  else client.release(true)  // destroy poisoned client
}
```

**Post-release (all pool ops here):**

```
if (shouldCloseLockContention)
  try { closeLockContention(preRun) } catch { log+metric }
if (capturedUnrecoverable)
  try { recordUnrecoverableError(...) } catch { log+metric }
if (originalError) throw originalError
if (committed && lease)
  try { releaseDomainLease(...) } catch { log+metric }
```

### Non-empty path

```typescript
async executeDomain(cycle: Cycle, domain: DomainConfig): Promise<DomainResult> {
  // PRE-FENCE
  const watermark = await watermarkService.readCurrent(domain)
  const bounds = watermarkService.computeBounds(domain, watermark)
  if (bounds.isEmpty) return await this.executeEmptyIncremental(cycle, domain, watermark)
  const rows = await amaiaFetcher.fetch(domain, bounds)
  const preRun = await runService.createPreRun(cycle, domain, bounds)

  let lease: Lease | null = null
  let committed = false
  let originalError: unknown = null
  let rollbackOk = false
  let shouldCloseLockContention = false
  let capturedUnrecoverable: UnrecoverableError | null = null

  const client = await pgPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE amaia_sync_runtime')
    lease = await leaseManager.acquireDomainLease(client, domain)
    await runService.bindToLease(client, preRun, lease)
    await watermarkService.hardRevalidate(client, domain, bounds)
    const manifest = await manifestService.createManifest(client, preRun, domain)
    await manifestService.insertSourceItems(client, manifest, rows)
    await destinationRepo.upsertRows(client, domain, rows)
    await manifestService.finalizeSource(client, manifest, preRun)
    const setsMatch = await manifestService.finalizeComparison(client, manifest, preRun)
    if (setsMatch && manifest.sourceCount > 0)
      await manifestService.advanceWatermarkCas(client, domain, bounds, preRun)
    await manifestService.guardedTerminalization(client, manifest, preRun, setsMatch)
    await client.query('COMMIT')
    committed = true
  } catch (e) {
    originalError = e
    try { await client.query('ROLLBACK'); rollbackOk = true }
    catch (re) {
      logger.error('domain.rollback_failed', {
        domain: domain.name, run_id: preRun.id,
        original_error: serialize(e), rollback_error: serialize(re)
      })
      metrics.inc('amaia_sync_rollback_failures_total', { domain: domain.name })
    }
    shouldCloseLockContention = rollbackOk && isLockContention(e)
    if (isUnrecoverable(e)) capturedUnrecoverable = e as UnrecoverableError
  } finally {
    if (rollbackOk || committed) client.release()
    else client.release(true)
  }

  if (shouldCloseLockContention) {
    try { await runService.closeLockContention(preRun) }
    catch (ce) {
      logger.warn('domain.lock_contention_close_failed', {
        domain: domain.name, run_id: preRun.id, error: serialize(ce)
      })
      metrics.inc('amaia_sync_lock_contention_close_failures_total', { domain: domain.name })
    }
  }
  if (capturedUnrecoverable) {
    try {
      await operationalErrorService.recordUnrecoverableError(
        preRun.id, capturedUnrecoverable.type, capturedUnrecoverable.message
      )
    } catch (re) {
      logger.error('operational_error_record_failed', {
        run_id: preRun.id, original_error: serialize(originalError), record_error: serialize(re)
      })
      metrics.inc('amaia_sync_operational_error_record_failures_total')
    }
  }
  if (originalError) throw originalError

  if (committed && lease) {
    try { await leaseManager.releaseDomainLease(domain, lease) }
    catch (e) {
      logger.warn('domain.lease_release_failed', { domain: domain.name })
      metrics.inc('amaia_sync_lease_release_failures_total', { domain: domain.name })
    }
  }
}
```

### 8.1 Empty Incremental Flow

```typescript
async executeEmptyIncremental(cycle, domain, watermark) {
  const bounds = { lower: watermark.last_id, upper: watermark.last_id, isEmpty: true }
  const preRun = await runService.createPreRun(cycle, domain, bounds)

  let lease: Lease | null = null
  let committed = false
  let originalError: unknown = null
  let rollbackOk = false
  let shouldCloseLockContention = false
  let capturedUnrecoverable: UnrecoverableError | null = null

  const client = await pgPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE amaia_sync_runtime')
    lease = await leaseManager.acquireDomainLease(client, domain)
    await runService.bindToLease(client, preRun, lease)
    await watermarkService.hardRevalidate(client, domain, bounds)
    const manifest = await manifestService.createManifest(client, preRun, domain)
    await manifestService.finalizeSource(client, manifest, preRun)
    await manifestService.finalizeComparison(client, manifest, preRun)
    // CAS SKIPPED (R9)
    await manifestService.guardedTerminalization(client, manifest, preRun, true)
    await client.query('COMMIT')
    committed = true
  } catch (e) {
    originalError = e
    try { await client.query('ROLLBACK'); rollbackOk = true }
    catch (re) {
      logger.error('domain.rollback_failed', {
        domain: domain.name, run_id: preRun.id,
        original_error: serialize(e), rollback_error: serialize(re)
      })
      metrics.inc('amaia_sync_rollback_failures_total', { domain: domain.name })
    }
    shouldCloseLockContention = rollbackOk && isLockContention(e)
    if (isUnrecoverable(e)) capturedUnrecoverable = e as UnrecoverableError
  } finally {
    if (rollbackOk || committed) client.release()
    else client.release(true)
  }

  if (shouldCloseLockContention) {
    try { await runService.closeLockContention(preRun) }
    catch (ce) {
      logger.warn('domain.lock_contention_close_failed', {
        domain: domain.name, run_id: preRun.id, error: serialize(ce)
      })
      metrics.inc('amaia_sync_lock_contention_close_failures_total', { domain: domain.name })
    }
  }
  if (capturedUnrecoverable) {
    try {
      await operationalErrorService.recordUnrecoverableError(
        preRun.id, capturedUnrecoverable.type, capturedUnrecoverable.message
      )
    } catch (re) {
      logger.error('operational_error_record_failed', {
        run_id: preRun.id, original_error: serialize(originalError), record_error: serialize(re)
      })
      metrics.inc('amaia_sync_operational_error_record_failures_total')
    }
  }
  if (originalError) throw originalError

  if (committed && lease) {
    try { await leaseManager.releaseDomainLease(domain, lease) }
    catch (e) {
      logger.warn('domain.lease_release_failed', { domain: domain.name })
      metrics.inc('amaia_sync_lease_release_failures_total', { domain: domain.name })
    }
  }
}
```

**Empty incrementals create runs and manifests. They never advance watermarks (R9).**

### 8.2 PoolClient Rules

1. No `pgPool.query()` while fenced PoolClient checked out.
2. No repository acquires its own client.
3. No repository BEGIN/COMMIT/ROLLBACK.
4. `SET LOCAL ROLE` on same PoolClient.
5. `client.release()` or `client.release(true)` in `finally`.
6. Session pooler required.
7. No non-fenced pool op before `client.release()`.
8. **Rollback failure → `client.release(true)` (destroy).** Healthy rollback or commit → `client.release()`.

### 8.3 Post-Commit Lease Release Rules

- Track `let lease: Lease | null = null` and `let committed = false`.
- Release only if `committed && lease`.
- Try/catch: log + metric. Never changes domain result.
- Applied identically to empty and non-empty paths.

### 8.4 Error Handling Ordering Rules

```
1. Try fenced work on PoolClient
2. Catch: capture originalError
3.   Try ROLLBACK (protected); set rollbackOk
4.   Set shouldCloseLockContention = rollbackOk && isLockContention
5.   If isUnrecoverable: capturedUnrecoverable = e
6. Finally:
     if (rollbackOk || committed) client.release()
     else client.release(true)              ← DESTROY POISONED CLIENT
7. If shouldCloseLockContention: try close (pool, best-effort)
8. If capturedUnrecoverable: try record (pool, best-effort)
9. If originalError: throw originalError    ← ALWAYS
10. If committed && lease: try release (pool, best-effort)
```

### 8.5 Poisoned Client Semantics

If ROLLBACK fails, the connection is in unknown state. `client.release(true)` destroys it. Pool creates fresh connection on next `connect()`. Safe with `max: 1`.

## 9. Lease Manager

```typescript
interface LeaseManager {
  acquireDomainLease(client: PoolClient, domain: string): Promise<Lease>;
  releaseDomainLease(domain: string, lease: Lease): Promise<void>;
}
```

Fenced: `acquireDomainLease(client)`. Non-fenced: `releaseDomainLease` (pool, best-effort).

## 10. Watermark Service

```typescript
interface WatermarkService {
  readCurrent(domain: string): Promise<Watermark>;
  computeBounds(domain: string, watermark: Watermark): Bounds;
  hardRevalidate(client: PoolClient, domain: string, bounds: Bounds): Promise<void>;
}
```

## 11. Manifest Service

```typescript
interface ManifestService {
  createManifest(client: PoolClient, run: Run, domain: DomainConfig): Promise<Manifest>;
  insertSourceItems(client: PoolClient, manifest: Manifest, rows: AmaiaRow[]): Promise<void>;
  finalizeSource(client: PoolClient, manifest: Manifest, run: Run): Promise<void>;
  finalizeComparison(client: PoolClient, manifest: Manifest, run: Run): Promise<boolean>;
  advanceWatermarkCas(client: PoolClient, domain: string, bounds: Bounds, run: Run): Promise<void>;
  guardedTerminalization(client: PoolClient, manifest: Manifest, run: Run, setsMatch: boolean): Promise<void>;
}
```

### 11.1 Guarded Terminalization — Complete Specification

**Purpose:** Single terminal operation that atomically validates the domain lease and finalizes the run. Immediately before COMMIT.

**Freshness primitive:** `clock_timestamp()` is the **only** allowed time function.

| Prohibited | Reason |
|---|---|
| `now()` | Transaction-start timestamp. Frozen within tx. |
| `CURRENT_TIMESTAMP` | Alias for `now()`. |
| `transaction_timestamp()` | Transaction-start. |
| JavaScript `Date.now()` | Not authoritative. |
| Cached lease objects | Stale by definition. |

**CTE SQL with enforced dependency chain (guard → complete → updated):**

```sql
WITH guard AS (
  SELECT r.id AS run_id, m.id AS manifest_id
  FROM public.amaia_sync_runs r
  JOIN public.amaia_sync_run_manifests m
    ON m.id = $1 AND m.run_id = r.id
  JOIN public.amaia_sync_leases l
    ON l.entity_name = r.domain_name
  WHERE r.id = $2
    AND l.owner_identity = r.owner_identity
    AND l.lease_token = r.lease_token
    AND l.lease_expires_at > clock_timestamp()
    AND r.status = 'running'
    AND m.phase = 'confirmed_compared'
),
complete AS (
  SELECT public.amaia_sync_complete_manifest($1, $2) AS completed
  FROM guard
),
updated AS (
  UPDATE public.amaia_sync_runs r
  SET status = $3,
      finished_at = clock_timestamp()
  FROM complete
  JOIN guard ON true
  WHERE r.id = guard.run_id
    AND r.status = 'running'
  RETURNING r.id
)
SELECT
  (SELECT count(*) FROM guard) AS guard_count,
  (SELECT count(*) FROM complete) AS complete_count,
  (SELECT count(*) FROM updated) AS updated_count;
```

**Parameters:** `$1` = manifest_id (uuid), `$2` = run_id (uuid), `$3` = terminal status ('success' | 'completed_with_discrepancy').

**Dependency chain:**
- `complete` executes `FROM guard` — runs only if guard produces rows.
- `updated` executes `FROM complete JOIN guard ON true` — runs only if complete produced rows.
- **Terminal run status cannot be updated unless `complete_manifest` executed successfully.**

**Full guarded predicate (all evaluated inside PostgreSQL):**
- `l.owner_identity = r.owner_identity` — lease owner matches run owner.
- `l.lease_token = r.lease_token` — lease token matches.
- `l.lease_expires_at > clock_timestamp()` — lease temporally valid at evaluation time.
- `r.status = 'running'` — run not already terminal.
- `m.phase = 'confirmed_compared'` — manifest at expected pre-terminal phase.

**Mandatory assertions (in application code):**

```typescript
const { guard_count, complete_count, updated_count } = result.rows[0]
if (guard_count !== '1' || complete_count !== '1' || updated_count !== '1') {
  throw new GuardedTerminalizationError(
    `guard=${guard_count} complete=${complete_count} updated=${updated_count}`
  )
}
```

Any mismatch → throw → transaction rollback.

**Explicit guarantees:**
- Terminal run status cannot be updated unless `complete_manifest` executed successfully.
- `updated` depends on `complete`. No gap.
- `clock_timestamp()` is the sole freshness primitive.
- No timing assumptions are made about COMMIT latency.
- No runtime-side lease validity checks are authoritative.

## 12. Run Service

```typescript
interface RunService {
  createPreRun(cycle: Cycle, domain: DomainConfig, bounds: Bounds): Promise<Run>;
  bindToLease(client: PoolClient, run: Run, lease: Lease): Promise<void>;
  closeLockContention(run: Run): Promise<void>;
}
```

## 13. Repository Layer

| Repository | Fenced (PoolClient) | Non-fenced (pool) |
|---|---|---|
| run-repository | bind | createPreRun, closeLockContention, recovery |
| lease-repository | acquireDomainLease | release, scheduler, recovery |
| watermark-repository | hardRevalidate | readCurrent |
| manifest-repository | create, insertItems, RPC | — |
| destination-repository | upsertRows | — |
| operational-error-repository | — | writeError, readErrors |

### 13.1 PostgreSQL Access Strategy

Direct `pg` driver. Session pooler. `max: 1`.

```
Connection: postgresql://postgres.[ref]:[database-password]@[host]:5432/postgres
```

`pg-client.ts`: manages Pool, provides `connect()`. No tx helpers. Domain-runner owns BEGIN/COMMIT/ROLLBACK.

**supabase-js not used by Runtime Engine.**

## 14. MySQL Reader

Single read-only connection. Batched. No writes (R3).

| Domain | Query |
|---|---|
| control_llamadas | `SELECT * FROM control_llamadas WHERE id > ? AND id <= ? ORDER BY id LIMIT ?` |
| logestado | `SELECT * FROM logestado WHERE id > ? AND id <= ? ORDER BY id LIMIT ?` |

## 15. Error Taxonomy

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
| `UnrecoverableError` | Domain | Rollback, record to channel, skip |

## 16. Retry Policy

| Context | Strategy |
|---|---|
| Connection | Exponential backoff: 1s, 30s max, 3 attempts, ±25% jitter |
| Domain failure | No retry within cycle |
| Cycle scheduling | Fixed interval (default 60s) |

## 17. Recovery Service

Executes at startup AND before every cycle (R28).

### 17.1 Detection

**Bound stale:**

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running' AND r.owner_identity IS NOT NULL
AND (r.owner_identity IS DISTINCT FROM l.owner_identity
     OR r.lease_token IS DISTINCT FROM l.lease_token
     OR l.lease_expires_at <= clock_timestamp())
AND clock_timestamp() > greatest(l.lease_expires_at, l.heartbeat_at + interval '10 minutes');
```

**Unbound stale (R34):**

```sql
SELECT r.* FROM amaia_sync_runs r
WHERE r.status = 'running' AND r.owner_identity IS NULL
  AND r.created_at < clock_timestamp() - interval '10 minutes';
```

### 17.2 Recovery Action Flows

Each stale run in its own transaction. Idempotent.

**Bound stale with manifest:**
1. Lock run. If `status != 'running'` → no-op.
2. If manifest exists and not terminal → `amaia_sync_abandon_manifest`.
3. Check Operational Failure Channel → `failed` or `orphan_recovered`.
4. Update run.

**Bound stale without manifest:** Lock → check channel → update.

**Unbound stale:** Same, no manifest check.

**Idempotency:** `WHERE status='running'` skips recovered. Re-abandon on terminal manifest is caught as no-op.

## 18. Operational Failure Channel

```typescript
interface OperationalErrorService {
  recordUnrecoverableError(runId: string, errorType: string, detail: string): Promise<void>;
  hasUnrecoverableError(runId: string): Promise<boolean>;
}
```

- Same `pgPool` (max=1). No write while fenced PoolClient checked out.
- Writes after rollback + client.release().
- Recovery's sole source of truth for `failed`.

## 19. Structured Logging

JSON to stdout: ts, level, engine_instance_id, cycle_id, domain, run_id, manifest_id, event, detail.

## 20. Metrics

| Metric | Type |
|---|---|
| `amaia_sync_cycles_total{status}` | counter |
| `amaia_sync_runs_total{domain,status}` | counter |
| `amaia_sync_empty_incrementals_total{domain}` | counter |
| `amaia_sync_lock_contentions_total{domain}` | counter |
| `amaia_sync_lock_contention_close_failures_total{domain}` | counter |
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
| `amaia_sync_lease_release_failures_total{domain}` | counter |
| `amaia_sync_scheduler_release_failures_total` | counter |
| `amaia_sync_rollback_failures_total{domain}` | counter |
| `amaia_sync_operational_error_record_failures_total` | counter |

## 21. Configuration

| Variable | Type | Default | Validation |
|---|---|---|---|
| `SUPABASE_DB_URL` | string | — | Required |
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

## 22. Deployment

```
VM: AMAIASQL (Ubuntu), Node.js 20 LTS, systemd
Secrets: /etc/amaia-sync/env (chmod 600)
```

## 23. QA Strategy

### Unit tests

| Module | Tests |
|---|---|
| config | Missing/invalid vars, defaults |
| domain-registry | Append-only gate, zero valid → error |
| watermark-service | Safety lag, max window, empty |
| manifest-service | Guarded Terminalization CTE predicate |
| operational-error-service | Write + read + classify |

### Integration tests

| Scenario | Validates |
|---|---|
| Full cycle, 2 domains | End-to-end |
| Empty incremental | No CAS, success, identical state machine |
| Empty incremental + unrecoverable error | Recorded after client.release() |
| Discrepancy | completed_with_discrepancy |
| CAS failure | Rollback, client released |
| Guard: lease expired | guard_count=0 → rollback |
| Guard: manifest.phase wrong | guard_count=0 → rollback |
| Guard: run.status wrong | guard_count=0 → rollback |
| Guard: owner mismatch | guard_count=0 → rollback |
| Guard: token mismatch | guard_count=0 → rollback |
| Guard: success | guard=1, complete=1, updated=1 |
| Guard: complete_count=0 prevents update | verified |
| Watermark revalidation failure | Rollback |
| Lock contention | close after client.release() |
| Lock contention close failure | Metric, original preserved |
| AMAIA fetch failure | No pre-run |
| Recovery: bound + manifest | abandoned, orphan_recovered |
| Recovery: bound no manifest | orphan_recovered |
| Recovery: unbound stale | orphan_recovered |
| Recovery: durable evidence | failed |
| Recovery: repeated call | No-op |
| Recovery: crash after abandon | Next call completes |
| Authority failure | Scheduler in finally |
| Lease release failure | Non-fatal, metric |
| Unrecoverable error | Recorded after release |
| Operational error record failure | Original preserved |
| Rollback failure | client.release(true); original preserved |
| Rollback failure → next tx fresh client | Verified |
| Rollback failure + lock contention | Close skipped |
| Pool ordering: close after release | Instrumented |
| Pool ordering: record after release | Instrumented |
| Pool ordering: releaseDomainLease after release | Instrumented |
| PoolClient: same client | Instrumented |
| PoolClient: release in finally | Verified |

## 24. Non-Goals

| Item | Reason |
|---|---|
| Timestamp domains | V1 id-only |
| Mutable domains | V1 append-only |
| Provisional | Dormant |
| Reconciliation | Phase 9.5 |
| supabase-js | Direct pg only |
| Multi-worker | Single-threaded |
| ORM | Raw SQL |

## 25. Architectural Invariant Mapping

| Invariant | Implemented by |
|---|---|
| R1 Single scheduler | scheduler.ts |
| R2 Single worker | engine.ts |
| R3 AMAIA readonly | mysql-client.ts |
| R4 Fetch before fence | domain-runner.ts |
| R5 Evidence inside fence | all on PoolClient |
| R6 CAS inside tx | client.query(SELECT cas...) |
| R7 No advance without completion | CTE: updated FROM complete |
| R8 No abandon healthy | recovery-service.ts |
| R9 Empty no CAS | executeEmptyIncremental |
| R10 Multi-process unsupported | scheduler lease |
| R11 Id-based only | domain-registry.ts |
| R12 No evidence before commit | PoolClient + COMMIT at end |
| R13 No provisional | never calls |
| R14 Within TTL | no heartbeat in tx |
| R15/R19 Append-only | startup gate |
| R16 Domain lease = authority | guard CTE |
| R17 Bounded | max_window |
| R18 Non-empty success → advance | conditional CAS |
| R20 Lease at fence start | acquireDomainLease(client) after BEGIN |
| R21 Expired → stale | clock_timestamp() |
| R22 Pre-run NULL | createPreRun (pool) |
| R23 Binding before manifest | order |
| R24 Hard revalidation | hardRevalidate(client) |
| R25 Release advisory | committed && lease, try/catch, post-release |
| R26 Unvalidated ineligible | startup gate |
| R27 Terminal predicate | CTE guard: clock_timestamp() + full predicate including m.phase='confirmed_compared' |
| R28 Recovery startup+cycle | cycle-runner.ts |
| R29 Pre-run after fetch | order |
| R30 Lock contention closure | post-release, best-effort, gated on rollbackOk |
| R31 Single terminal op | CTE: guard → complete → updated. updated depends on complete. |
| R32 Fresh predicate | lease_expires_at > clock_timestamp() by PostgreSQL |
| R33/R34 Unbound local | no lease JOIN |
| R35 Rollback → unbound | ROLLBACK (protected) + client.release() or release(true) in finally |

---

READY FOR FINAL DOCUMENTATION CLOSURE
