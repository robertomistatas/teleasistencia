# AMAIA-SYNC Runtime Implementation Blueprint v1.2

**Type:** Implementation blueprint  
**Status:** Pending hostile implementation re-audit  
**Supersedes:** v1.1.1 (rejected — 2 critical, 4 major, 2 minor)  
**Parent:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.1.1

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | `now()` is transaction-start timestamp | `clock_timestamp()` is the only allowed freshness primitive. |
| C2 | Critical | `pg.query` hides PoolClient leakage | All fenced work uses explicit PoolClient. Strict rules in Section 8.2. |
| M1 | Major | Domain lease release can throw post-commit | Best-effort, non-fatal, try/catch with log+metric. |
| M2 | Major | Operational Failure Channel has no component | Added operational-error-service.ts + repository. Section 18. |
| M3 | Major | Recovery defines detection but not actions | Full flows in Section 17.2. |
| M4 | Major | Scheduler lease release not in finally | Daemon loop uses schedulerAcquired flag + finally. |
| m1 | Minor | "service-role-password" implies JWT | Replaced with "database password". |
| m2 | Minor | No QA for PoolClient discipline | Added 6 integration tests in Section 23. |

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
      catch { log scheduler.release_failed; metric++ }
    }
  }
  sleep(CYCLE_INTERVAL)
}
// Graceful shutdown
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

**File:** `domain-runner.ts`

```typescript
async executeDomain(cycle: Cycle, domain: DomainConfig): Promise<DomainResult> {
  // PRE-FENCE (no PoolClient)
  const watermark = await watermarkService.readCurrent(domain)
  const bounds = watermarkService.computeBounds(domain, watermark)
  if (bounds.isEmpty) return await this.executeEmptyIncremental(cycle, domain, watermark)
  const rows = await amaiaFetcher.fetch(domain, bounds)               // R4, R29
  const preRun = await runService.createPreRun(cycle, domain, bounds)  // R22

  // FENCED TRANSACTION (explicit PoolClient)
  const client = await pgPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE amaia_sync_runtime')
    const lease = await leaseManager.acquireDomainLease(client, domain)
    await runService.bindToLease(client, preRun, lease)
    await watermarkService.hardRevalidate(client, domain, bounds)
    const manifest = await manifestService.createManifest(client, preRun, domain)
    await manifestService.insertSourceItems(client, manifest, rows)
    await destinationRepo.upsertRows(client, domain, rows)
    await manifestService.finalizeSource(client, manifest, preRun)
    const setsMatch = await manifestService.finalizeComparison(client, manifest, preRun)
    if (setsMatch && manifest.sourceCount > 0)
      await manifestService.advanceWatermarkCas(client, domain, bounds, preRun)
    await manifestService.guardedTerminalization(client, manifest, preRun, lease, setsMatch)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    if (isLockContention(e)) await runService.closeLockContention(preRun)
    throw e
  } finally {
    client.release()
  }

  // POST-COMMIT (best-effort, non-fatal)
  try { await leaseManager.releaseDomainLease(domain, lease) }
  catch (e) {
    logger.warn('domain.lease_release_failed', { domain: domain.name })
    metrics.inc('amaia_sync_lease_release_failures_total', { domain: domain.name })
  }
}
```

### 8.1 Empty Incremental Flow

```typescript
async executeEmptyIncremental(cycle, domain, watermark) {
  const bounds = { lower: watermark.last_id, upper: watermark.last_id, isEmpty: true }
  const preRun = await runService.createPreRun(cycle, domain, bounds)

  const client = await pgPool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE amaia_sync_runtime')
    const lease = await leaseManager.acquireDomainLease(client, domain)
    await runService.bindToLease(client, preRun, lease)
    await watermarkService.hardRevalidate(client, domain, bounds)
    const manifest = await manifestService.createManifest(client, preRun, domain)
    await manifestService.finalizeSource(client, manifest, preRun)
    await manifestService.finalizeComparison(client, manifest, preRun)
    // CAS SKIPPED (R9)
    await manifestService.guardedTerminalization(client, manifest, preRun, lease, true)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    if (isLockContention(e)) await runService.closeLockContention(preRun)
    throw e
  } finally {
    client.release()
  }

  try { await leaseManager.releaseDomainLease(domain, lease) }
  catch { logger.warn('domain.lease_release_failed') }
}
```

**Empty incrementals create runs and manifests. They never advance watermarks (R9).**

### 8.2 PoolClient Rules

1. **No `pgPool.query()` inside fenced work.** All fenced queries use the explicit `client`.
2. **No repository may acquire its own client.** Every fenced method receives `client: PoolClient`.
3. **No repository may BEGIN/COMMIT/ROLLBACK.** Only domain-runner controls the transaction.
4. **`SET LOCAL ROLE` on the same PoolClient** as all fenced operations.
5. **`client.release()` in `finally`.** No exception path leaks the client.
6. **Session pooler required.** Transaction pooler incompatible with `SET LOCAL ROLE`.

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
  guardedTerminalization(client: PoolClient, manifest: Manifest, run: Run, lease: Lease, setsMatch: boolean): Promise<void>;
}
```

### 11.1 Guarded Terminalization Implementation

**`clock_timestamp()` is the only allowed freshness primitive.**

| Prohibited | Reason |
|---|---|
| `now()` | Transaction-start timestamp. Frozen within tx. |
| `CURRENT_TIMESTAMP` | Alias for `now()`. |
| `transaction_timestamp()` | Explicit transaction-start. |
| JavaScript `Date.now()` | Not authoritative. |
| Cached lease objects | Stale by definition. |

Implementation via `client.query()`:

```sql
DO $$ DECLARE v_ok boolean; BEGIN
  SELECT (l.owner_identity = r.owner_identity
    AND l.lease_token = r.lease_token
    AND l.lease_expires_at > clock_timestamp()
    AND r.status = 'running')
  INTO v_ok
  FROM amaia_sync_leases l, amaia_sync_runs r
  WHERE l.entity_name = $1 AND r.id = $2;
  IF NOT v_ok THEN RAISE EXCEPTION 'guarded terminalization failed'; END IF;
  PERFORM amaia_sync_complete_manifest($3, $2);
  UPDATE amaia_sync_runs SET status = $4, finished_at = clock_timestamp() WHERE id = $2;
END $$;
```

**No runtime-side lease validity checks are authoritative.**

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
| run-repository | bind, setTerminalStatus | createPreRun, closeLockContention, recovery |
| cycle-repository | — | INSERT |
| lease-repository | acquireDomainLease | release, scheduler, recovery |
| watermark-repository | hardRevalidate | readCurrent |
| manifest-repository | create, insertItems, RPC | — |
| destination-repository | upsertRows | — |
| operational-error-repository | — | writeError, readErrors |

### 13.1 PostgreSQL Access Strategy

Direct `pg` driver. Session pooler.

```
Driver: pg (node-postgres)
Connection: postgresql://postgres.[ref]:[database-password]@[host]:5432/postgres
Pool: max=1, SSL=required
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

**Bound stale with manifest:**
1. Check Operational Failure Channel for durable evidence.
2. Call `amaia_sync_abandon_manifest`.
3. Update run: `failed` (if evidence) or `orphan_recovered` (default).
4. Idempotent.

**Bound stale without manifest:**
1. Check channel.
2. Update run: `failed` or `orphan_recovered`.

**Unbound stale:**
1. Check channel.
2. Update run: `failed` or `orphan_recovered`.
3. No manifest abandonment.

**Rule:** Without durable evidence → always `orphan_recovered`.

## 18. Operational Failure Channel

**Files:** `operational-error-service.ts`, `operational-error-repository.ts`

```typescript
interface OperationalErrorService {
  recordUnrecoverableError(runId: string, errorType: string, detail: string): Promise<void>;
  hasUnrecoverableError(runId: string): Promise<boolean>;
}
```

- Writes outside fenced tx (separate pool connection).
- Recovery's sole source of truth for `failed`.
- No in-memory state. No ephemeral logs.

## 19. Structured Logging

JSON to stdout. Fields: ts, level, engine_instance_id, cycle_id, domain, run_id, manifest_id, event, detail.

## 20. Metrics

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
| `amaia_sync_lease_release_failures_total{domain}` | counter |
| `amaia_sync_scheduler_release_failures_total` | counter |

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
| manifest-service | Guarded Terminalization with `clock_timestamp()` |
| operational-error-service | Write + read + classify |

### Integration tests (Docker Compose)

| Scenario | Validates |
|---|---|
| Full cycle, 2 domains | End-to-end with PoolClient |
| Empty incremental | No CAS, success |
| Discrepancy | completed_with_discrepancy |
| CAS failure | Rollback, client released |
| Guarded Terminalization failure | Rollback via clock_timestamp |
| Watermark revalidation failure | Rollback |
| Lock contention | skipped_lock_contention |
| AMAIA fetch failure | No pre-run |
| Recovery: bound stale + manifest | abandoned, orphan_recovered |
| Recovery: bound stale no manifest | orphan_recovered |
| Recovery: unbound stale | orphan_recovered |
| Recovery: durable evidence | failed |
| Authority failure | Cycle aborted, scheduler in finally |
| Lease release failure | Non-fatal |
| Max window cap | Bounded |
| Graceful shutdown | Completes current domain |
| PoolClient: all fenced on same client | Instrumented |
| PoolClient: no pool.query in fence | Instrumented |
| PoolClient: SET LOCAL ROLE same client | Verified |
| PoolClient: rollback reverts all | Verified |
| PoolClient: release in finally | Verified |
| Transaction pooler rejected | Fails appropriately |

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
| R1 Single scheduler | scheduler.ts: acquireLease |
| R2 Single worker | engine.ts: single loop |
| R3 AMAIA readonly | mysql-client.ts: read-only |
| R4 Fetch before fence | domain-runner.ts: fetch before pgPool.connect() |
| R5 Evidence inside fence | domain-runner.ts: all on PoolClient inside BEGIN/COMMIT |
| R6 CAS inside tx | manifest-service.ts: client.query(SELECT cas...) |
| R7 No advance without completion | CAS before guardedTerminalization |
| R8 No abandon healthy | recovery-service.ts: predicate |
| R9 Empty no CAS | domain-runner.ts: executeEmptyIncremental skips CAS |
| R10 Multi-process unsupported | scheduler.ts: lease |
| R11 Id-based only | domain-registry.ts |
| R12 No evidence before commit | domain-runner.ts: PoolClient, COMMIT at end |
| R13 No provisional | manifest-service.ts: never calls |
| R14 Within TTL | no heartbeat in tx |
| R15/R19 Append-only | domain-registry.ts: gate |
| R16 Domain lease = authority | guardedTerminalization |
| R17 Bounded | watermark-service.ts: max_window |
| R18 Non-empty success → advance | conditional CAS |
| R20 Lease at fence start | acquireDomainLease(client) after BEGIN |
| R21 Expired → stale | recovery: clock_timestamp() |
| R22 Pre-run NULL | createPreRun (pool) |
| R23 Binding before manifest | order in executeDomain |
| R24 Hard revalidation | hardRevalidate(client) |
| R25 Release advisory | try/catch non-fatal post-commit |
| R26 Unvalidated ineligible | startup gate |
| R27 Terminal predicate | `clock_timestamp()` in SQL DO block. now() prohibited. |
| R28 Recovery startup+cycle | cycle-runner.ts |
| R29 Pre-run after fetch | order in executeDomain |
| R30 Lock contention closure | closeLockContention(pool) outside tx |
| R31 Single terminal op | SQL DO block: predicate + complete + status |
| R32 Fresh predicate | `lease_expires_at > clock_timestamp()` by PostgreSQL |
| R33/R34 Unbound local | recovery: no lease JOIN for unbound |
| R35 Rollback → unbound | client.query('ROLLBACK'); client.release() in finally |

---

READY FOR HOSTILE IMPLEMENTATION RE-AUDIT
