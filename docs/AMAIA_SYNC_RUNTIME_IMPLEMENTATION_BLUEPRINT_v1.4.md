# AMAIA-SYNC Runtime Implementation Blueprint v1.4

**Type:** Implementation blueprint  
**Status:** Pending hostile implementation re-audit  
**Supersedes:** v1.3 (rejected — 1 critical, 2 major, 1 minor)  
**Parent:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.3

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | CTE `updated` did not depend on `complete` — run could terminalize without manifest completion | `updated` now `FROM complete JOIN guard ON true`. `complete_count` returned and asserted. |
| M1 | Major | Operational error record could mask original error | Best-effort try/catch. Original error always re-thrown. Metric for record failures. |
| M2 | Major | ROLLBACK could throw and mask original error | Protected try/catch. Lock contention closure gated on rollback success. Metric added. |
| m1 | Minor | QA missing complete_count test | Added: complete_count=0 prevents run update. |

---

## 1–7. Unchanged from v1.3

Business Problem, Runtime Goals, Module Tree, Bootstrap, Lifecycle, Scheduler, Cycle Runner — identical to v1.3.

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
  let originalError: unknown = null
  let capturedUnrecoverable: UnrecoverableError | null = null
  let rollbackSucceeded = false
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
    try {
      await client.query('ROLLBACK')
      rollbackSucceeded = true
    } catch (rollbackError) {
      logger.error('domain.rollback_failed', {
        domain: domain.name, run_id: preRun.id,
        original_error: serialize(e), rollback_error: serialize(rollbackError)
      })
      metrics.inc('amaia_sync_rollback_failures_total', { domain: domain.name })
    }
    if (rollbackSucceeded && isLockContention(e)) {
      await runService.closeLockContention(preRun)
    }
    if (isUnrecoverable(e)) {
      capturedUnrecoverable = e as UnrecoverableError
    }
  } finally {
    client.release()
  }

  // OPERATIONAL ERROR RECORDING (best-effort, after client release)
  if (capturedUnrecoverable) {
    try {
      await operationalErrorService.recordUnrecoverableError(
        preRun.id, capturedUnrecoverable.type, capturedUnrecoverable.message
      )
    } catch (recordError) {
      logger.error('operational_error_record_failed', {
        run_id: preRun.id,
        original_error: serialize(originalError),
        record_error: serialize(recordError)
      })
      metrics.inc('amaia_sync_operational_error_record_failures_total')
    }
  }

  // RE-THROW ORIGINAL ERROR (never masked)
  if (originalError) throw originalError

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
  let originalError: unknown = null
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
    try { await client.query('ROLLBACK') }
    catch (re) {
      logger.error('domain.rollback_failed', { domain: domain.name, run_id: preRun.id })
      metrics.inc('amaia_sync_rollback_failures_total', { domain: domain.name })
    }
    if (isLockContention(e)) await runService.closeLockContention(preRun)
  } finally {
    client.release()
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

Identical to v1.3.

### 8.3 Post-Commit Lease Release Rules

Identical to v1.3.

### 8.4 Error Handling Ordering Rules

1. **Rollback failure never masks original error.** Protected by try/catch. Original captured in `originalError`.
2. **Lock contention closure only if rollback succeeded.** Gated on `rollbackSucceeded`.
3. **Operational error recording never masks original error.** Protected by try/catch. `originalError` always re-thrown after all finally/recording completes.
4. **If operational error recording fails:** recovery cannot classify as `failed` from missing evidence. Default remains `orphan_recovered`. Original error is logged and metriced regardless.
5. **`client.release()` always executes in finally.** Even if rollback threw.
6. **`originalError` is always re-thrown** after client release and operational error recording.

## 9–10. Lease Manager + Watermark Service

Identical to v1.3.

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

**`clock_timestamp()` only. `now()` / `CURRENT_TIMESTAMP` / `transaction_timestamp()` / JS clock / cached leases prohibited.**

**CTE SQL with enforced dependency chain: guard → complete → updated:**

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

**Dependency chain:**
- `complete` executes `FROM guard` — only runs if guard produces rows.
- `updated` executes `FROM complete JOIN guard ON true` — only runs if complete produced rows.
- **Terminal run status cannot be updated unless complete_manifest executed from the complete CTE.**

**Parameters:** `$1` = manifest_id, `$2` = run_id, `$3` = terminal status.

**Assertions:**

```typescript
const { guard_count, complete_count, updated_count } = result.rows[0]
if (guard_count !== '1' || complete_count !== '1' || updated_count !== '1') {
  throw new GuardedTerminalizationError(
    `guard=${guard_count} complete=${complete_count} updated=${updated_count}`
  )
}
```

**Full predicate (all evaluated inside PostgreSQL):**
- `l.owner_identity = r.owner_identity`
- `l.lease_token = r.lease_token`
- `l.lease_expires_at > clock_timestamp()`
- `r.status = 'running'`
- `m.phase = 'confirmed_compared'`

## 12–16. Run Service, Repository, MySQL, Error Taxonomy, Retry

Identical to v1.3. Error taxonomy includes `UnrecoverableError`.

## 17. Recovery Service

Identical to v1.3. Detection uses `clock_timestamp()`. Per-run transactions. Idempotent.

## 18. Operational Failure Channel

Identical contract to v1.3. Added rule:

**If `recordUnrecoverableError` fails:** recovery cannot classify as `failed`. Default `orphan_recovered`. The original error is still logged and metriced. The recording failure is logged with both original and record errors, and metriced via `amaia_sync_operational_error_record_failures_total`.

## 19–20. Logging + Metrics

Added metrics:

| Metric | Type |
|---|---|
| `amaia_sync_rollback_failures_total{domain}` | counter |
| `amaia_sync_operational_error_record_failures_total` | counter |

All other metrics identical to v1.3.

## 21–22. Configuration + Deployment

Identical to v1.3.

## 23. QA Strategy

### Unit tests

Identical to v1.3.

### Integration tests

| Scenario | Validates |
|---|---|
| Full cycle, 2 domains | End-to-end |
| Empty incremental | No CAS, success, identical release |
| Discrepancy | completed_with_discrepancy |
| CAS failure | Rollback, client released |
| Guard: lease expired | guard_count=0 → rollback |
| Guard: manifest.phase wrong | guard_count=0 → rollback |
| Guard: run.status wrong | guard_count=0 → rollback |
| Guard: owner mismatch | guard_count=0 → rollback |
| Guard: token mismatch | guard_count=0 → rollback |
| Guard: success | guard=1, complete=1, updated=1 |
| Guard: complete_count=0 prevents run update | complete fails → updated=0 |
| Watermark revalidation failure | Rollback |
| Lock contention | skipped_lock_contention |
| AMAIA fetch failure | No pre-run |
| Recovery: bound + manifest | abandoned, orphan_recovered |
| Recovery: bound no manifest | orphan_recovered |
| Recovery: unbound stale | orphan_recovered |
| Recovery: durable evidence | failed |
| Recovery: repeated call | No-op |
| Recovery: crash after abandon | Next call completes |
| Authority failure | Scheduler in finally |
| Lease release failure | Non-fatal, metric |
| Unrecoverable error | Recorded after rollback+release |
| Operational error record failure | Original error preserved, metric incremented |
| Rollback failure | Original error preserved, client released, metric |
| Rollback failure + lock contention | Lock contention closure skipped |
| PoolClient: same client | Instrumented |
| PoolClient: release in finally | Verified even on rollback failure |

## 24. Non-Goals

Identical to v1.3.

## 25. Architectural Invariant Mapping

| Invariant | Implemented by |
|---|---|
| R1 Single scheduler | scheduler.ts |
| R2 Single worker | engine.ts |
| R3 AMAIA readonly | mysql-client.ts |
| R4 Fetch before fence | domain-runner.ts |
| R5 Evidence inside fence | all on PoolClient |
| R6 CAS inside tx | client.query(SELECT cas...) |
| R7 No advance without completion | CTE dependency: `updated FROM complete` ensures complete_manifest ran before status update |
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
| R27 Terminal predicate | CTE guard: clock_timestamp() + full predicate including m.phase |
| R28 Recovery startup+cycle | cycle-runner.ts |
| R29 Pre-run after fetch | order |
| R30 Lock contention closure | gated on rollbackSucceeded |
| R31 Single terminal op | CTE chain: guard → complete → updated. Run status depends on complete. |
| R32 Fresh predicate | lease_expires_at > clock_timestamp() |
| R33/R34 Unbound local | no lease JOIN for unbound |
| R35 Rollback → unbound | ROLLBACK (protected) + client.release() in finally |

---

READY FOR HOSTILE IMPLEMENTATION RE-AUDIT
