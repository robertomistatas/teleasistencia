# AMAIA-SYNC Runtime Engine Architecture v1.7

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.6 (rejected — 1 critical, 2 major, 2 minor corrections)  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.6

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | Lease could expire between terminal revalidation (step 10) and actual terminal writes (steps 11–13) | Replaced with Guarded Terminalization: single operation that validates lease + completes manifest + sets terminal run status immediately before COMMIT. R31, R32. |
| M1 | Major | Unbound pre-run stale predicate depends on domain lease heartbeat | Separate predicates: unbound = run-local age (PRE_RUN_STALE_TTL). Bound = domain lease credentials/expiry. R33. |
| M2 | Major | Contradictory sequences between Section 8.4 and Section 10 | Single authoritative sequence. No alternative sequences anywhere. |
| m1 | Minor | "Post-commit" for lock contention (no commit occurred) | Corrected: post-rollback closure. |
| m2 | Minor | Append-only startup behavior underspecified | Engine starts, excludes unvalidated domains, exits if zero valid domains. |

---

## 1. Problem Statement

Mistatas operates a teleasistencia platform for elderly care. AMAIA (legacy MySQL, VM AMAIASQL) is the source of truth. Supabase (PostgreSQL) is the modern operational platform. The sync engine keeps Supabase current.

AMAIA is **read-only** from the sync engine's perspective.

## 2. Functional Objective

Single-process, single-threaded synchronization daemon that:

1. Fetches incremental changes from AMAIA MySQL.
2. Persists them into Supabase destination tables.
3. Constructs identity manifests with cryptographic hash evidence.
4. Compares source vs destination sets.
5. Advances watermarks atomically via CAS.
6. Detects and records discrepancies.
7. Recovers from failures without data loss or silent corruption.

## 3. Syncable Domains (V1)

### Active domains

| Domain | AMAIA source | Supabase destination | Identity basis | Watermark | Source model |
|---|---|---|---|---|---|
| control_llamadas | control_llamadas | amaia_call_logs | source_amaia_id | id | Append-only |
| logestado | logestado | amaia_alert_logs | source_amaia_id | id | Append-only |

Both append-only, immutable after insertion, auto-increment PK. Fail-closed for unsupported types.

### 3.1 Deferred Domains

| Domain | Status | Reason |
|---|---|---|
| beneficiario | OUT OF SCOPE V1 | Timestamp watermark |
| red | OUT OF SCOPE V1 | Timestamp watermark |
| alerta | OUT OF SCOPE V1 | Timestamp watermark |
| enfermedades | OUT OF SCOPE V1 | Mutable source |
| medicamentos | OUT OF SCOPE V1 | Mutable source |

### 3.2 Delete Semantics

V1 does not provide delete synchronization. Active domains are append-only. Tombstone infrastructure dormant.

**If evidence emerges that a domain is not append-only, it MUST be immediately excluded.**

### 3.3 Append-Only Validation Procedure

**Deployment gate.** At least two independent evidence types required per domain.

| Evidence type | Description |
|---|---|
| Vendor documentation | AMAIA vendor confirms insert-only. |
| Schema analysis | No UPDATE/DELETE triggers or grants. |
| Historical sampling | Audit logs for UPDATE/DELETE activity. |
| Operational verification | DBA confirms no UPDATE/DELETE paths. |

**Startup behavior:** Engine starts, evaluates each active domain's append-only evidence. Unvalidated domains are excluded fail-closed. If zero valid domains remain, engine exits with configuration error.

## 4. Scheduler Model

### Single serialized orchestrator

1. Acquire scheduler lease.
2. Cycle-start recovery (Section 15.6).
3. Create cycle record.
4. Iterate active domains.
5. For each domain: pre-fence → fenced tx → post-commit or post-rollback.
6. Complete cycle.

### Scheduler lease acquisition

```
SELECT * FROM amaia_sync_leases WHERE entity_name='scheduler' FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

Cooperative serialization. If held, engine exits.

### 4.1 Scheduler Lease as Cycle Admission Control

Scheduler lease = **cycle admission only**. Domain lease = sole commit authority (R16).

Scheduler lease loss during active domain tx does not invalidate it.

### 4.2 Scheduler Heartbeat

TTL: 5 minutes. Renewed **only between domains** (before and after each).

No heartbeat during domain execution.

**Expiry abort:** Before starting any new domain, verify `scheduler_lease_expires_at > now()`. If expired, exit cycle.

### 4.3 Per-Domain Flow

This is the **single authoritative sequence**. No alternative sequences exist.

**Pre-fence:**

```
1. Read watermark from Supabase.
2. Compute safe/effective upper_bound from AMAIA.
3. Fetch AMAIA rows into memory (batched).
4. If fetch fails → log event, skip domain. No pre-run created.
5. Create pre-run (NULL credentials).
```

**Fenced transaction:** (Section 10)

**Post-commit:** Best-effort domain lease release.

**Post-rollback (lock contention):** Immediate closure of pre-run as `skipped_lock_contention` outside the rolled-back transaction.

**Post-rollback (other failure):** Pre-run remains `running` with NULL credentials. Recovered at next cycle start (R28).

### Cycle creation

```
INSERT INTO amaia_sync_cycles (
  trigger_type, owner_identity,
  scheduler_owner_identity, scheduler_lease_token
) VALUES ('scheduled', :engine_identity, :owner_identity, :lease_token);
```

Immutable lineage (trigger #10).

## 5. Engine Identity

```
engine_instance_id = UUID v4 (at startup)
owner_identity = "engine:{engine_instance_id}:{hostname}:{pid}"
```

## 6. Domain Processing Order

Fixed: 1. control_llamadas, 2. logestado.

## 7. Domain Lease

### Acquisition

Inside fenced tx (step 2 of Section 10). Pre-fence: no domain lease (R20).

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate + UPDATE
```

If held → fenced tx aborts → pre-run closed post-rollback (Section 8.6).

### 7.1 Domain Execution Time Constraint

No heartbeat during fenced tx. **Maximum domain execution < lease TTL.**

Lease expiry is caught by:
- **CAS** (for non-empty matched path) — validates lease as part of CAS.
- **Guarded Terminalization** (for ALL paths) — validates lease immediately before terminal writes.

Both are inside the fenced tx. No terminal state can be committed with an expired lease.

### 7.2 Domain Lease Release

After successful commit:

```
UPDATE amaia_sync_leases SET owner_identity = NULL
WHERE entity_name = :domain
  AND owner_identity = :owner_identity AND lease_token = :lease_token;
```

**Best-effort and advisory** (R25). Failure → TTL expiration.

## 8. Run Lifecycle

### 8.1 Pre-Run Creation

Created **after successful AMAIA fetch**, before fenced tx (R29):

```sql
INSERT INTO amaia_sync_runs (
  job_name, status, cycle_id, domain_name,
  lease_token, owner_identity,
  lower_bound, upper_bound
) VALUES (
  :domain, 'running', :cycle_id, :domain,
  NULL, NULL,
  :lower_bound, :upper_bound
);
```

**NULL credentials** (R22). AMAIA fetch failure → no pre-run (R29).

### 8.2 Bind Run to Lease

Inside fenced tx (step 3 of Section 10):

```sql
UPDATE amaia_sync_runs
SET owner_identity = :lease_owner_identity, lease_token = :lease_token
WHERE id = :run_id AND status = 'running'
  AND owner_identity IS NULL AND lease_token IS NULL;
```

**No manifest operation before binding** (R23).

### 8.3 Run Status Transitions

```
running → success                     (Guarded Terminalization, inside fenced tx)
running → completed_with_discrepancy  (Guarded Terminalization, inside fenced tx)
running → skipped_lock_contention     (post-rollback, immediate closure)
running → orphan_recovered            (recovery)
running → failed                      (recovery, durable error evidence)
```

### 8.4 Guarded Terminalization (inside fenced tx)

This is the **single terminal operation** that atomically validates the lease and finalizes the run. It occurs immediately before COMMIT (step 11 of Section 10).

**Predicate (validated at terminalization time):**

```
domain_lease.owner_identity == run.owner_identity
AND domain_lease.lease_token == run.lease_token
AND domain_lease.lease_expires_at > now()
AND run.status == 'running'
AND manifest.phase == 'confirmed_compared'
```

**Operations (executed atomically within the same step):**

```
1. Validate predicate. If false → raise exception → rollback.
2. complete_manifest (phase → comparison_complete).
3. Update run terminal status:
   - success (if sets_match=true)
   - completed_with_discrepancy (if sets_match=false)
4. Update run.finished_at = now().
```

**There is no gap between lease validation and terminal writes.** The predicate check and the terminal writes are a single logical operation within the same SQL statement sequence, with no intervening COMMIT or operation that could allow the lease to expire.

For the non-empty matched path, CAS (step 10) also validates the lease before Guarded Terminalization. This is defense-in-depth, not the primary terminal fence.

### 8.5 Run Without Manifest Recovery

Run `running` with no manifest → `orphan_recovered`.

### 8.6 Lock Contention Closure

If domain lease acquisition fails (step 2 of fenced tx):

1. Fenced tx rolls back.
2. **Outside the rolled-back transaction**, the runtime immediately closes the pre-run:

```sql
UPDATE amaia_sync_runs
SET status = 'skipped_lock_contention', finished_at = now()
WHERE id = :run_id AND status = 'running' AND owner_identity IS NULL;
```

If immediate closure fails → recovered at next cycle start (R28, R30).

## 9. Extraction from AMAIA

### Connection

```
Host: AMAIASQL (internal)
User: amaia_sync_reader (SELECT only)
Connection pool: 1
```

### Fetch protocol

1. Read watermark.
2. Compute safe upper bound: `MAX(id) - safety_lag`.
3. Apply max_incremental_window.
4. Fetch rows into memory (batched).
5. **Fetch failure → event + metric. No pre-run** (R29).

### 9.1 Pre-Fence Safety Proof

1. Single orchestrator.
2. Reads are side-effect-free.
3. Hard watermark revalidation (R24) inside fence.
4. Guarded Terminalization (R27, R31, R32) validates lease before any terminal write.
5. Engine death before fence → no advance.

### Safety lag

Default: 100.

### 9.2 Batch Processing

Page size: 1000 (configurable). All pages into memory before fenced tx.

### 9.3 Maximum Runtime Window

```
max_incremental_window = 10000 (configurable)
effective_upper_bound = min(safe_upper_bound, lower_bound + max_incremental_window)
```

### Empty incrementals

If `effective_upper_bound <= lower_bound`:

No eligible rows in the current safe bounded window.

1. Create pre-run.
2. Fenced tx: bind, watermark revalidation, manifest (0 items), finalize, **Guarded Terminalization** (validates lease, completes manifest, status='success'). No CAS.
3. COMMIT.

Empty manifests are intentional audit artifacts.

### 9.4 Empty Manifest Retention

Counted via metric. No discrepancy alerts. Configurable retention. Excluded from dashboards.

**Never auto-delete:** discrepancy manifests, abandoned manifests, failed runs.

## 10. Fenced Transaction

**Single authoritative sequence. No alternative exists.**

```
1.  BEGIN
2.  Acquire domain lease FOR UPDATE
3.  Bind run to lease
4.  Hard watermark revalidation:
      ASSERT current_watermark == run.lower_bound
5.  Create manifest (phase=created)
6.  Insert source identity items
7.  Upsert destination rows
8.  Call finalize_source
9.  Call finalize_comparison
10. If sets_match=true AND source_id_count>0: call advance_watermark_cas
11. Guarded Terminalization:
      validate fresh lease predicate
      complete_manifest
      set terminal run status (success | completed_with_discrepancy)
12. COMMIT
```

If any step fails → full rollback. **No manifest evidence durable until commit.**

### 10.1 Hard Watermark Revalidation (Step 4)

All paths. `current_watermark == run.lower_bound`. Failure → rollback.

### 10.2 Guarded Terminalization (Step 11)

All paths. Lease predicate + manifest completion + terminal run status as a single logical terminal operation. See Section 8.4 for full specification.

### 10.3 Domain-Level Atomicity

One pre-run, one manifest, one transaction, at most one CAS. No partial manifests.

## 11. Identity Manifest Construction

Source items inside fenced tx (step 6). Trigger #11 enforces role/phase.

Finalization (steps 8–9): `finalize_source` + `finalize_comparison`. Derived items by SECURITY DEFINER.

## 12. Source vs Persisted Comparison

```
S_raw = {source_amaia_id for each source item}
P_check = {amaia_id from destination WHERE amaia_id > lower AND amaia_id <= upper}
missing = S_raw \ P_check
extra = P_check \ S_raw
sets_match = (|missing| = 0) AND (|extra| - |excluded| = 0)
```

Hash: sorted numerically, joined with `|`, SHA-256.

## 13. Provisional Window (Dormant)

V1 never invokes `amaia_sync_finalize_provisional`. Dormant.

**Compatibility assumption:** `complete_manifest` supports direct `confirmed_compared → comparison_complete`.

## 14. CAS Watermark Advancement

When `sets_match=true` AND `source_id_count > 0`:

```sql
SELECT amaia_sync_advance_watermark_cas(:domain, 'id', :expected, :new, :run_id);
```

Inside fenced tx (step 10), before Guarded Terminalization (step 11).

CAS validates the lease independently. Guarded Terminalization re-validates. Defense-in-depth.

CAS not called for empty or discrepancy paths.

## 15. Abandonment and Recovery

### 15.1 Bound vs Unbound Recovery Predicates

**Bound runs** (owner_identity IS NOT NULL): recovered via domain lease predicate.

```
stale_threshold = greatest(lease_expires_at, heartbeat_at + 2 * lease_ttl)

Stale when: now() > stale_threshold
AND (credentials mismatch OR lease expired)
```

**Unbound pre-runs** (owner_identity IS NULL): recovered via run-local age.

```
Stale when: run.created_at < now() - PRE_RUN_STALE_TTL
```

Default `PRE_RUN_STALE_TTL = 10 minutes`.

Unbound pre-runs do not have associated domain lease credentials, so domain lease heartbeat is irrelevant. Their age from `created_at` is the only staleness signal.

### 15.2 Detection

**Bound runs:**

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running' AND r.owner_identity IS NOT NULL
AND (r.owner_identity IS DISTINCT FROM l.owner_identity
     OR r.lease_token IS DISTINCT FROM l.lease_token
     OR l.lease_expires_at <= now())
AND now() > greatest(l.lease_expires_at, l.heartbeat_at + interval '10 minutes');
```

**Unbound pre-runs:**

```sql
SELECT r.* FROM amaia_sync_runs r
WHERE r.status = 'running'
  AND r.owner_identity IS NULL
  AND r.created_at < now() - interval '10 minutes';
```

### 15.3 Abandon Protocol

For bound runs with manifests: `amaia_sync_abandon_manifest`. Lock order: domain_lease → run → manifest.

### 15.4 Healthy Run Protection

Bound run with credentials match + lease valid + not expired = healthy. Cannot abandon.

### 15.5 Run Without Manifest Recovery

Run `running` with no manifest (bound or unbound) → `orphan_recovered`.

### 15.6 Continuous Recovery

Recovery executes:

1. **At engine startup.**
2. **Before every cycle start** (after scheduler lease, before domain iteration).

Cleans both bound stale runs and unbound stale pre-runs.

### 15.7 Recovery Outcome Classification

| Outcome | Condition |
|---|---|
| `orphan_recovered` | Stale, no durable error evidence. Default. |
| `failed` | Durable error evidence in operational error channel. |

### 15.8 Durable Failure Evidence

`failed` requires evidence outside rolled-back tx in a dedicated channel:

- Persistent audit table.
- Durable structured log with ingestion guarantee.
- Operational incident store.

## 16. Error Handling

### 16.1 Domain Failures

Single domain. Engine catches exception, logs, **continues to next domain**.

| Example | Action |
|---|---|
| Upsert constraint violation | Rollback. Pre-run recovered next cycle. |
| CAS failure | Rollback. Retry next cycle. |
| Guarded Terminalization failure | Rollback. Pre-run recovered. |
| Watermark revalidation failure | Rollback. Pre-run recovered. |
| AMAIA fetch failure | Event + metric. No pre-run. Skip. |
| Domain lease contention | Rollback. Pre-run → `skipped_lock_contention` (post-rollback closure). |

### 16.2 Authority Failures

**Abort entire cycle.**

| Example | Action |
|---|---|
| Scheduler lease expired (between domains) | Exit cycle. |
| Supabase connection lost | Exit cycle. |
| AMAIA connection lost | Exit cycle. |

### 16.3 Unsupported Multi-Process

Unsupported for scheduling. Domain lease + CAS protect same-domain correctness. **Unsupported ≠ unfenced.**

## 17. Retry and Backoff

No domain retry within cycle. Next cycle retries. Connection: exponential backoff (1s, 30s max, 3 attempts, ±25% jitter). Cycle: fixed interval (default 60s).

## 18. Idempotency

| Operation | Idempotency |
|---|---|
| AMAIA fetch | Safe. Read-only. |
| Destination upsert | Idempotent (ON CONFLICT + hash). |
| Source item insertion | Idempotent (partial unique index). |
| Manifest creation | NOT idempotent. |
| CAS | Idempotent in effect. |

## 19. Concurrency

Single process, single thread, single AMAIA connection, single Supabase connection.

## 20. Observability

### Structured logging (JSON)

```json
{
  "ts": "ISO8601", "level": "info|warn|error",
  "engine_instance_id": "uuid", "cycle_id": "uuid",
  "domain": "string", "run_id": "uuid", "manifest_id": "uuid",
  "event": "string", "detail": {}
}
```

### Key events

| Event | Level |
|---|---|
| `engine.start` | info |
| `scheduler.lease_acquired` / `scheduler.lease_held` | info / warn |
| `scheduler.lease_expired_mid_cycle` | warn |
| `cycle.start` / `cycle.complete` | info |
| `cycle.recovery_executed` | info |
| `domain.start` / `domain.skip_unsupported` | info |
| `domain.fetch` / `domain.fetch_failed` | info / error |
| `domain.lock_contention` | info |
| `domain.bind_run` / `domain.watermark_revalidated` | info |
| `domain.guarded_terminalization` | info |
| `domain.guarded_terminalization_failed` | error |
| `domain.cas_advanced` / `domain.empty` | info |
| `domain.discrepancy` | warn |
| `domain.error` | error |
| `authority.failure` | error |
| `recovery.bound_stale` / `recovery.unbound_stale` / `recovery.orphan_no_manifest` / `recovery.abandoned` | warn |

### Metrics

| Metric | Type | Labels |
|---|---|---|
| `amaia_sync_cycles_total` | counter | status |
| `amaia_sync_runs_total` | counter | domain, status |
| `amaia_sync_empty_incrementals_total` | counter | domain |
| `amaia_sync_lock_contentions_total` | counter | domain |
| `amaia_sync_rows_fetched` / `_upserted` | counter | domain |
| `amaia_sync_manifests_total` | counter | domain, sets_match |
| `amaia_sync_watermark_position` | gauge | domain |
| `amaia_sync_cycle_duration_seconds` | histogram | — |
| `amaia_sync_domain_duration_seconds` | histogram | domain |
| `amaia_sync_cas_failures_total` | counter | domain |
| `amaia_sync_guarded_term_failures_total` | counter | domain |
| `amaia_sync_authority_failures_total` | counter | reason |
| `amaia_sync_discrepancies_total` | counter | domain |
| `amaia_sync_recovery_runs_total` | counter | outcome |

### Alerts

| Condition | Severity |
|---|---|
| No successful cycle in 10 minutes | High |
| Discrepancy detected | Medium |
| Stale run detected | Medium |
| Authority failure | High |
| Guarded Terminalization failure | High |
| AMAIA connection failure >3 cycles | High |

## 21. Security

Service_role key + `SET LOCAL ROLE amaia_sync_runtime` per fenced tx. RLS enforced. SECURITY DEFINER for manifest_owner.

Secrets: environment variables, never logged. AMAIA: `amaia_sync_reader`, SELECT only, host-restricted. Network: internal AMAIA (3306), HTTPS Supabase. No inbound.

## 22. Deployment

```
VM: AMAIASQL (Ubuntu), Node.js, systemd/PM2
```

| Variable | Required |
|---|---|
| `SUPABASE_URL` | Yes |
| `SUPABASE_SERVICE_KEY` | Yes |
| `AMAIA_MYSQL_HOST` | Yes |
| `AMAIA_MYSQL_PORT` | No (3306) |
| `AMAIA_MYSQL_USER` | Yes |
| `AMAIA_MYSQL_PASSWORD` | Yes |
| `AMAIA_MYSQL_DATABASE` | Yes |
| `SYNC_CYCLE_INTERVAL_MS` | No (60000) |
| `SYNC_SAFETY_LAG_ID` | No (100) |
| `SYNC_LEASE_TTL_SECONDS` | No (300) |
| `SYNC_BATCH_SIZE` | No (1000) |
| `SYNC_MAX_WINDOW` | No (10000) |
| `SYNC_PRE_RUN_STALE_TTL_SECONDS` | No (600) |
| `SYNC_LOG_LEVEL` | No (info) |
| `METRICS_PORT` | No (9090) |

Graceful shutdown: SIGTERM → stop → wait for fenced tx → release scheduler lease → close connections → exit.

## 23. Failure Scenarios

| Scenario | Recovery |
|---|---|
| Crash mid-fence | Rollback. Pre-run (NULL creds) recovered at cycle start. |
| Crash after pre-run, before fence | Pre-run (NULL creds). Recovered by unbound stale predicate. |
| AMAIA fetch failure | Event only. No pre-run. |
| Supabase unreachable | Exit cycle. |
| Lease expires mid-fence | Guarded Terminalization rejects. Rollback. |
| CAS failure | Rollback. Retry next cycle. |
| Scheduler lease lost mid-domain | Domain completes (R16). Cycle aborts after. |
| Lock contention | Rollback. Pre-run → `skipped_lock_contention`. |
| Watermark revalidation failure | Rollback. Pre-run recovered. |
| Backlog > max_window | Progressive catch-up. |
| Append-only violated | Domain excluded immediately. |
| Zero valid domains at startup | Engine exits with configuration error. |

## 24. QA Strategy

### Unit tests

- Domain config (skip unsupported, fail-closed unvalidated, exit if zero).
- Watermark computation (safety lag, max_window).
- Hash (numeric/pipe).
- Pre-run NULL credentials.
- Bind-run-to-lease.
- Guarded Terminalization predicate.
- Unbound pre-run stale predicate vs bound stale predicate.

### Integration tests

- Full cycle (2 domains).
- Empty incremental (Guarded Terminalization, no CAS).
- Non-empty incremental (CAS + Guarded Terminalization).
- Discrepancy → `completed_with_discrepancy` (Guarded Terminalization, no CAS).
- CAS success / failure.
- Guarded Terminalization failure (expired lease) → rollback.
- Hard watermark revalidation failure → rollback.
- Bind-run failure → rollback.
- Recovery: bound stale → orphan_recovered.
- Recovery: unbound stale pre-run → orphan_recovered.
- Recovery: run without manifest.
- Lock contention → `skipped_lock_contention`.
- AMAIA fetch failure → no pre-run.
- Authority failure.
- Domain lease release (success + failure).

## 25. Non-Goals

| Non-goal | Reason |
|---|---|
| Timestamp domains | V1 id-only. |
| Mutable domains | V1 append-only. |
| Delete synchronization | No deletes. |
| Multi-worker | Single-threaded. |
| Bidirectional sync | AMAIA read-only. |
| Provisional finalization | Dormant. |
| Reconciliation | Phase 9.5. |
| UI integration | Headless. |
| SOS Mujer | Excluded. |

## 26. Architectural Invariants

| # | Invariant |
|---|---|
| R1 | **Single scheduler.** |
| R2 | **Single worker.** |
| R3 | **AMAIA readonly.** |
| R4 | **Fetch before fence.** |
| R5 | **All evidence inside fence.** Pre-run outside. |
| R6 | **CAS inside same transaction.** |
| R7 | **No watermark advancement without manifest completion.** |
| R8 | **Recovery cannot abandon healthy runs.** |
| R9 | **Empty incrementals never advance watermarks.** |
| R10 | **Multi-process unsupported for scheduling.** Domain fencing holds. |
| R11 | **V1 id-based domains only.** |
| R12 | **No manifest evidence durable before commit.** |
| R13 | **V1 never invokes provisional finalization.** |
| R14 | **Domain execution within one lease TTL.** |
| R15 | **Active V1 domains formally validated append-only.** |
| R16 | **Domain lease = sole commit authority.** |
| R17 | **All V1 executions bounded.** |
| R18 | **Non-empty successful runs imply watermark advancement.** |
| R19 | **V1 append-only domains only.** |
| R20 | **Domain lease begins at fenced tx start.** |
| R21 | **Expired leases sufficient for stale classification.** |
| R22 | **Pre-runs carry NULL credentials.** |
| R23 | **Manifest processing after binding only.** |
| R24 | **All paths: hard watermark revalidation.** |
| R25 | **Domain lease release is advisory.** |
| R26 | **Unvalidated domains ineligible.** |
| R27 | **Every terminal path: fresh lease validation via Guarded Terminalization.** |
| R28 | **Recovery at startup AND before every cycle.** |
| R29 | **Pre-runs only after successful AMAIA fetch.** |
| R30 | **Lock contention after pre-run: terminally closed or recovered.** |
| R31 | **Run terminalization and manifest completion are a single guarded terminal operation.** No gap between lease validation and terminal writes. |
| R32 | **No terminal run status without fresh lease predicate in the same terminal operation.** |
| R33 | **Unbound pre-runs recovered by run-local age (PRE_RUN_STALE_TTL), not domain lease heartbeat.** |

---

## Summary

The AMAIA-SYNC Runtime Engine v1.7 is a single-process, single-threaded Node.js daemon on AMAIASQL synchronizing 2 append-only id-based domains. Pre-runs carry NULL credentials and are created only after successful AMAIA fetch. The fenced transaction binds the run to the domain lease, hard-revalidates the watermark, produces all evidence, and terminates via **Guarded Terminalization** — a single atomic operation that validates the lease predicate, completes the manifest, and sets the terminal run status immediately before COMMIT. No gap exists between lease validation and terminal writes. CAS provides defense-in-depth for non-empty matched paths. Unbound pre-runs are recovered by run-local age; bound runs by domain lease predicate. Recovery runs at startup and before every cycle. 33 invariants (R1–R33).

---

READY FOR HOSTILE RE-AUDIT
