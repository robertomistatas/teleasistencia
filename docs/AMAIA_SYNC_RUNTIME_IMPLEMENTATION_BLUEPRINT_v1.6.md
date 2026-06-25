# AMAIA-SYNC Runtime Implementation Blueprint v1.6

**Type:** Implementation blueprint  
**Status:** Pending hostile implementation re-audit  
**Supersedes:** v1.5 (rejected — 0 critical, 2 major, 1 minor)  
**Parent:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.5

| # | Severity | Finding | Resolution |
|---|---|---|---|
| M1 | Major | Empty path lacks capturedUnrecoverable / recordUnrecoverableError | Empty path now includes identical error-state fields and post-release operational error recording. |
| M2 | Major | Rollback failure returns poisoned PoolClient to pool | Rollback failure → `client.release(true)` to destroy client. Healthy rollback → `client.release()`. |
| m1 | Minor | QA missing releaseDomainLease ordering test | Added instrumented ordering test. |

---

## 1–7. Unchanged from v1.5

## 8. Domain Runner

### 8.0 Post-Release State Machine

Both non-empty and empty paths use this **identical** state machine. No field or step may differ between paths.

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

  // FENCED TRANSACTION — identical state fields
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

  // POST-RELEASE
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

  // IDENTICAL state fields
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

  // IDENTICAL post-release
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

### 8.2 PoolClient Rules

1. No `pgPool.query()` while fenced PoolClient checked out.
2. No repository acquires its own client.
3. No repository BEGIN/COMMIT/ROLLBACK.
4. `SET LOCAL ROLE` on same PoolClient.
5. `client.release()` or `client.release(true)` in `finally`.
6. Session pooler required.
7. No non-fenced pool op before `client.release()`.
8. **Rollback failure → `client.release(true)` (destroy).** Healthy rollback or commit → `client.release()` (return to pool).

### 8.3 Post-Commit Lease Release Rules

Identical to v1.5.

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

If ROLLBACK fails, the PostgreSQL connection is in an unknown state:

- The transaction may still be open.
- Session-level settings (SET LOCAL ROLE) may be unpredictable.
- Row locks may persist until the connection is terminated.

**A poisoned client MUST NOT be returned healthy to the pool.**

`client.release(true)` in node-postgres destroys the underlying connection and removes it from the pool. The pool creates a fresh connection for the next `pgPool.connect()`.

This is safe with `max: 1`: the destroyed client is the only client. Next `connect()` creates a fresh one. No leaked state.

## 9–10. Lease Manager + Watermark Service

Identical to v1.5.

## 11. Manifest Service + 11.1 Guarded Terminalization

Identical to v1.5. CTE chain: guard → complete → updated. `clock_timestamp()`. Three count assertions.

## 12–16. Run Service, Repository, MySQL, Error Taxonomy, Retry

Identical to v1.5.

## 17. Recovery Service

Identical to v1.5.

## 18. Operational Failure Channel

Identical to v1.5.

## 19–20. Logging + Metrics

Identical to v1.5.

## 21–22. Configuration + Deployment

Identical to v1.5.

## 23. QA Strategy

### Unit tests

Identical to v1.5.

### Integration tests

| Scenario | Validates |
|---|---|
| Full cycle, 2 domains | End-to-end |
| Empty incremental | No CAS, success, identical state machine |
| Empty incremental + unrecoverable error | Recorded after client.release() |
| Discrepancy | completed_with_discrepancy |
| CAS failure | Rollback, client released, no deadlock |
| Guard: lease expired | guard_count=0 → rollback |
| Guard: manifest.phase wrong | guard_count=0 → rollback |
| Guard: run.status wrong | guard_count=0 → rollback |
| Guard: owner mismatch | guard_count=0 → rollback |
| Guard: token mismatch | guard_count=0 → rollback |
| Guard: success | guard=1, complete=1, updated=1 |
| Guard: complete_count=0 prevents update | verified |
| Watermark revalidation failure | Rollback |
| Lock contention | close after client.release(), no deadlock |
| Lock contention close failure | Metric, original preserved, recovery handles |
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
| Rollback failure | client.release(true) destroys; original preserved |
| Rollback failure → next tx fresh client | Verified: next connect() creates new connection |
| Rollback failure + lock contention | Close skipped (rollbackOk=false) |
| **Pool ordering: close after release** | Instrumented |
| **Pool ordering: record after release** | Instrumented |
| **Pool ordering: releaseDomainLease after release** | Instrumented |
| PoolClient: same client | Instrumented |
| PoolClient: release in finally | Verified even on rollback failure |

## 24. Non-Goals

Identical to v1.5.

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
| R9 Empty no CAS | executeEmptyIncremental (identical state machine, skips CAS) |
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
| R27 Terminal predicate | CTE guard: clock_timestamp() + m.phase |
| R28 Recovery startup+cycle | cycle-runner.ts |
| R29 Pre-run after fetch | order |
| R30 Lock contention closure | post-release, best-effort, gated on rollbackOk |
| R31 Single terminal op | CTE: guard → complete → updated |
| R32 Fresh predicate | lease_expires_at > clock_timestamp() |
| R33/R34 Unbound local | no lease JOIN |
| R35 Rollback → unbound | ROLLBACK (protected) + client.release() or release(true) in finally |

---

READY FOR HOSTILE IMPLEMENTATION RE-AUDIT
