# AMAIA-SYNC Runtime Implementation Blueprint v1.3

**Type:** Implementation blueprint  
**Status:** Pending hostile implementation re-audit  
**Supersedes:** v1.2 (rejected — 1 critical, 3 major, 2 minor)  
**Parent:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.2

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | DO block not valid parameterized query; predicate missing manifest.phase | CTE-based SQL with $1-$3. Full predicate includes m.phase='confirmed_compared'. guard_count + updated_count assertions. |
| M1 | Major | Operational Failure Channel needs second connection | Writes only after rollback + client.release. Same pool. No concurrent second connection. |
| M2 | Major | Recovery idempotency underspecified | Per-run recovery transactions. Idempotent: re-abandon safe, repeated no-op. |
| M3 | Major | Post-commit lease release state ambiguous | Explicit `lease` + `committed` tracking. Release only if committed && lease. |
| m1 | Minor | Empty path missing release metric | Identical release handling for empty and non-empty. |
| m2 | Minor | QA missing full predicate tests | 6 guard predicate tests added. |

---

## 1–4. Unchanged from v1.2

Business Problem, Runtime Goals, Module Tree, Bootstrap Sequence — identical to v1.2.

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

## 7. Cycle Runner

```typescript
interface CycleRunner {
  createCycle(): Promise<Cycle>;
  executeCycle(cycle: Cycle): Promise<CycleResult>;
}
```

## 8. Domain Runner

```typescript
async executeDomain(cycle: Cycle, domain: DomainConfig): Promise<DomainResult> {
  // PRE-FENCE
  const watermark = await watermarkService.readCurrent(domain)
  const bounds = watermarkService.computeBounds(domain, watermark)
  if (bounds.isEmpty) return await this.executeEmptyIncremental(cycle, domain, watermark)
  const rows = await amaiaFetcher.fetch(domain, bounds)               // R4, R29
  const preRun = await runService.createPreRun(cycle, domain, bounds)  // R22

  // FENCED TRANSACTION
  let lease: Lease | null = null
  let committed = false
  let capturedUnrecoverable: Error | null = null
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
    await client.query('ROLLBACK')
    if (isLockContention(e)) {
      await runService.closeLockContention(preRun)
    } else if (isUnrecoverable(e)) {
      capturedUnrecoverable = e
    }
    throw e
  } finally {
    client.release()
    // Record durable evidence AFTER rollback + release (Section 18)
    if (capturedUnrecoverable) {
      await operationalErrorService.recordUnrecoverableError(
        preRun.id, capturedUnrecoverable.type, capturedUnrecoverable.message
      )
    }
  }

  // POST-COMMIT (best-effort, non-fatal)
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
    await client.query('ROLLBACK')
    if (isLockContention(e)) await runService.closeLockContention(preRun)
    throw e
  } finally {
    client.release()
  }

  if (committed && lease) {
    try { await leaseManager.releaseDomainLease(domain, lease) }
    catch (e) {
      logger.warn('domain.lease_release_failed', { domain: domain.name })
      metrics.inc('amaia_sync_lease_release_failures_total', { domain: domain.name })
    }
  }
}
```

### 8.2 PoolClient Rules

1. No `pgPool.query()` inside fenced work.
2. No repository acquires its own client.
3. No repository BEGIN/COMMIT/ROLLBACK.
4. `SET LOCAL ROLE` on the same PoolClient.
5. `client.release()` in `finally`.
6. Session pooler required.

### 8.3 Post-Commit Lease Release Rules

- Track `let lease: Lease | null = null` and `let committed = false`.
- Release only if `committed && lease`.
- Try/catch: log + metric only. Never changes domain result.
- Applied identically to empty and non-empty paths.

## 9–10. Lease Manager + Watermark Service

Identical interfaces to v1.2. All fenced methods accept `PoolClient`.

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

### 11.1 Guarded Terminalization Implementation

**`clock_timestamp()` is the only allowed freshness primitive.**

| Prohibited | Reason |
|---|---|
| `now()` | Transaction-start. |
| `CURRENT_TIMESTAMP` | Alias for `now()`. |
| `transaction_timestamp()` | Transaction-start. |
| JavaScript `Date.now()` | Not authoritative. |
| Cached lease objects | Stale. |

**Parameterized CTE SQL:**

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
  FROM guard
  WHERE r.id = guard.run_id
    AND r.status = 'running'
  RETURNING r.id
)
SELECT
  (SELECT count(*) FROM guard) AS guard_count,
  (SELECT count(*) FROM updated) AS updated_count;
```

**Parameters:** `$1` = manifest_id, `$2` = run_id, `$3` = terminal status.

**Assertions:**

```typescript
const { guard_count, updated_count } = result.rows[0]
if (guard_count !== '1' || updated_count !== '1') {
  throw new GuardedTerminalizationError(`guard=${guard_count} updated=${updated_count}`)
}
```

**Full predicate:**
- `l.owner_identity = r.owner_identity`
- `l.lease_token = r.lease_token`
- `l.lease_expires_at > clock_timestamp()`
- `r.status = 'running'`
- `m.phase = 'confirmed_compared'`

## 12. Run Service

```typescript
interface RunService {
  createPreRun(cycle: Cycle, domain: DomainConfig, bounds: Bounds): Promise<Run>;
  bindToLease(client: PoolClient, run: Run, lease: Lease): Promise<void>;
  closeLockContention(run: Run): Promise<void>;
}
```

## 13. Repository Layer + 13.1 PostgreSQL Access Strategy

Identical to v1.2. Direct `pg` driver, session pooler, `max: 1`.

## 14–16. MySQL Reader + Error Taxonomy + Retry Policy

Identical to v1.2. Added `UnrecoverableError` to taxonomy.

## 17. Recovery Service

### 17.1 Detection

Identical queries to v1.2 (using `clock_timestamp()`).

### 17.2 Recovery Action Flows

Each stale run processed in its own transaction. Idempotent.

**Bound stale with manifest:**

```
BEGIN
SET LOCAL ROLE amaia_sync_recovery_runtime
SELECT r.* FROM amaia_sync_runs r WHERE r.id = :run_id FOR UPDATE
IF r.status != 'running' → COMMIT (no-op)
SELECT m.* FROM amaia_sync_run_manifests m WHERE m.run_id = r.id
IF m exists AND m.phase NOT IN ('comparison_complete','abandoned'):
  CALL amaia_sync_abandon_manifest(m.id, :abandoned_by, :reason)
COMMIT
-- After commit: classify using Operational Failure Channel
hasDurableEvidence = await operationalErrorService.hasUnrecoverableError(run_id)
-- Separate transaction:
BEGIN
UPDATE amaia_sync_runs SET status = (evidence ? 'failed' : 'orphan_recovered'),
  finished_at = clock_timestamp() WHERE id = :run_id AND status = 'running'
COMMIT
```

**Bound stale without manifest:**

```
BEGIN
SELECT r.* FROM amaia_sync_runs r WHERE r.id = :run_id FOR UPDATE
IF r.status != 'running' → COMMIT (no-op)
COMMIT
hasDurableEvidence = ...
BEGIN
UPDATE ... SET status = (evidence ? 'failed' : 'orphan_recovered') WHERE status = 'running'
COMMIT
```

**Unbound stale:** Same as bound-without-manifest. No manifest check.

**Idempotency:**
- `WHERE status = 'running'` → already-recovered runs skipped.
- `amaia_sync_abandon_manifest` on already-terminal → raises exception → recovery catches as no-op.
- Crash after abandon, before run update → next call: manifest already abandoned, run still running → skips abandon, updates run.

## 18. Operational Failure Channel

```typescript
interface OperationalErrorService {
  recordUnrecoverableError(runId: string, errorType: string, detail: string): Promise<void>;
  hasUnrecoverableError(runId: string): Promise<boolean>;
}
```

**V1 pool discipline:**
- Same `pgPool` (max=1).
- **No write while fenced PoolClient checked out.**
- Sequence: detect error → capture in memory → rollback → `client.release()` (in finally) → `pgPool.query(INSERT ...)`.
- Recovery reads also use normal pool queries.

## 19–22. Logging, Metrics, Configuration, Deployment

Identical to v1.2. Metrics include `amaia_sync_lease_release_failures_total{domain}`.

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
| Full cycle, 2 domains | End-to-end with PoolClient |
| Empty incremental | No CAS, success, identical release |
| Discrepancy | completed_with_discrepancy |
| CAS failure | Rollback, client released |
| Guard: lease expired (clock_timestamp) | guard_count=0 → rollback |
| Guard: manifest.phase != confirmed_compared | guard_count=0 → rollback |
| Guard: run.status != running | guard_count=0 → rollback |
| Guard: lease owner mismatch | guard_count=0 → rollback |
| Guard: lease token mismatch | guard_count=0 → rollback |
| Guard: success | guard_count=1, updated_count=1 |
| Watermark revalidation failure | Rollback |
| Lock contention | skipped_lock_contention |
| AMAIA fetch failure | No pre-run |
| Recovery: bound + manifest | abandoned, orphan_recovered |
| Recovery: bound no manifest | orphan_recovered |
| Recovery: unbound stale | orphan_recovered |
| Recovery: durable evidence | failed |
| Recovery: repeated call | No-op |
| Recovery: crash after abandon before update | Next call completes |
| Authority failure | Scheduler in finally |
| Lease release failure | Non-fatal, metric |
| Unrecoverable error | Recorded after rollback+release, no deadlock |
| PoolClient: same client for all fenced | Instrumented |
| PoolClient: release in finally | Verified |
| Transaction pooler rejected | Fails |

## 24. Non-Goals

Identical to v1.2.

## 25. Architectural Invariant Mapping

| Invariant | Implemented by |
|---|---|
| R1 Single scheduler | scheduler.ts |
| R2 Single worker | engine.ts |
| R3 AMAIA readonly | mysql-client.ts |
| R4 Fetch before fence | domain-runner.ts |
| R5 Evidence inside fence | all on PoolClient |
| R6 CAS inside tx | client.query(SELECT cas...) |
| R7 No advance without completion | CAS before guard CTE |
| R8 No abandon healthy | recovery-service.ts |
| R9 Empty no CAS | executeEmptyIncremental |
| R10 Multi-process unsupported | scheduler lease |
| R11 Id-based only | domain-registry.ts |
| R12 No evidence before commit | PoolClient + COMMIT at end |
| R13 No provisional | never calls |
| R14 Within TTL | no heartbeat in tx |
| R15/R19 Append-only | startup gate |
| R16 Domain lease = authority | guard CTE validates lease |
| R17 Bounded | max_window |
| R18 Non-empty success → advance | conditional CAS |
| R20 Lease at fence start | acquireDomainLease(client) after BEGIN |
| R21 Expired → stale | clock_timestamp() in recovery |
| R22 Pre-run NULL | createPreRun (pool) |
| R23 Binding before manifest | order in executeDomain |
| R24 Hard revalidation | hardRevalidate(client) |
| R25 Release advisory | committed && lease, try/catch |
| R26 Unvalidated ineligible | startup gate |
| R27 Terminal predicate | CTE guard: `clock_timestamp()` + full predicate including `m.phase='confirmed_compared'` |
| R28 Recovery startup+cycle | cycle-runner.ts |
| R29 Pre-run after fetch | order |
| R30 Lock contention closure | closeLockContention(pool) |
| R31 Single terminal op | CTE: guard → complete → update in one statement |
| R32 Fresh predicate | `lease_expires_at > clock_timestamp()` |
| R33/R34 Unbound local | no lease JOIN for unbound |
| R35 Rollback → unbound | ROLLBACK + client.release() in finally |

---

READY FOR HOSTILE IMPLEMENTATION RE-AUDIT
