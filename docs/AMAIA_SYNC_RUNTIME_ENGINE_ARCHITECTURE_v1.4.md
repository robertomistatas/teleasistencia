# AMAIA-SYNC Runtime Engine Architecture v1.4

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.3 (rejected — 2 critical, 4 major, 2 minor corrections)  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-23

---

## Changes from v1.3

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | Mutable dedup domains invisible to id-based watermark | V1 scoped to 2 append-only domains only. enfermedades/medicamentos deferred. R19. |
| C2 | Critical | Delete correctness undeclared | Explicit: V1 does not claim delete guarantees. Append-only sources have no deletes. |
| M1 | Major | Empty success contradicts R18 | R18 corrected: non-empty successful runs imply watermark advancement. Empty success is valid without CAS. |
| M2 | Major | "All Supabase writes inside fence" overstated | Corrected: manifest evidence + destination + CAS + terminal run status inside fence. Run creation outside. |
| M3 | Major | Domain lease acquired pre-fetch contradicts v1.2 fence model | Domain lease acquired only at fenced tx start. Pre-fence: no domain lease. R20. |
| M4 | Major | Stale predicate inconsistent between prose and SQL | Formalized: expired lease alone sufficient for stale classification. R21. |
| m1 | Minor | Multi-process "unsupported" implies unfenced | Clarified: unsupported for scheduling, but domain lease + CAS still protect. |
| m2 | Minor | 7-day retention too rigid | Configurable retention. Discrepancy/abandoned/failed manifests never auto-deleted. |

---

## 1. Problem Statement

Mistatas operates a teleasistencia platform for elderly care. AMAIA (legacy MySQL, VM AMAIASQL) is the source of truth for beneficiary data, support networks, alerts, call logs, and health context. Supabase (PostgreSQL) is the modern operational platform. The sync engine keeps Supabase current with AMAIA data.

AMAIA is **read-only** from the sync engine's perspective.

## 2. Functional Objective

The Runtime Engine is a single-process, single-threaded synchronization daemon that:

1. Fetches incremental changes from AMAIA MySQL.
2. Persists them into Supabase destination tables.
3. Constructs identity manifests with cryptographic hash evidence.
4. Compares source vs destination sets.
5. Advances watermarks atomically via CAS.
6. Detects and records discrepancies.
7. Recovers from failures without data loss or silent corruption.

## 3. Syncable Domains (V1)

### Active domains

| Domain | AMAIA source table | Supabase destination | Identity basis | Watermark type | Source model |
|---|---|---|---|---|---|
| control_llamadas | control_llamadas | amaia_call_logs | source_amaia_id | id | Append-only |
| logestado | logestado | amaia_alert_logs | source_amaia_id | id | Append-only |

Both V1 domains are **append-only** and use **id-based watermarks**. Rows are never modified or deleted after insertion. The auto-increment primary key provides a monotonic cursor.

**Runtime V1 correctness guarantees are claimed only for append-only domains.**

The runtime MUST skip any domain whose watermark_type is not 'id'. Unknown or unsupported watermark types are never processed (fail-closed).

### 3.1 Deferred Timestamp Domains

| Domain | AMAIA source table | Status | Reason |
|---|---|---|---|
| beneficiario | beneficiario | OUT OF SCOPE V1 | Timestamp watermark. Requires CAS timestamp support. |
| red | red | OUT OF SCOPE V1 | Timestamp watermark. |
| alerta | alerta | OUT OF SCOPE V1 | Timestamp watermark. |

Require: timestamp CAS, monotonicity guarantees, hybrid cursor model. Future Phase 9.x.

### 3.2 Deferred Mutable Domains

| Domain | AMAIA source table | Status | Reason |
|---|---|---|---|
| enfermedades | beneficiario_enfermedad | OUT OF SCOPE V1 | Mutable source. |
| medicamentos | beneficiario_medicamento | OUT OF SCOPE V1 | Mutable source. |

These domains have rows that can be updated or soft-deleted in AMAIA after insertion. An id-based watermark (`WHERE id > watermark`) only observes new rows. Mutations to existing rows with `id <= watermark` are invisible to the incremental fetch.

Correct synchronization of mutable domains requires:

- **Mutation detection:** A change-tracking cursor (e.g., `updated_at` column, change-data-capture, or full reconciliation).
- **Reconciliation:** Periodic full-table comparison to detect drift caused by updates and deletes.
- **Canonical key lifecycle management:** The dedup membership model (canonical keys, episodes) is designed for this, but the runtime integration requires the mutation detection layer above it.

The domain identity policies and dedup infrastructure (memberships table, canonical key triggers, dedup hash functions) are deployed in the database (Phase 9.3C) as dormant capabilities. The runtime will activate them when the mutation detection layer is designed.

### 3.3 Delete Semantics

**Runtime V1 does not claim delete synchronization guarantees.**

The two active V1 domains (control_llamadas, logestado) are append-only: rows are never deleted in AMAIA. Therefore, delete detection is not required for correctness.

For deferred mutable domains, delete detection will be handled by reconciliation (Phase 9.5) and the tombstone_events infrastructure deployed in Phase 9.3C.

For deferred timestamp domains, delete semantics will be defined alongside their sync architecture.

**If evidence emerges that control_llamadas or logestado are not strictly append-only, the domain MUST be immediately excluded from Runtime V1 until its mutation model is formally revalidated.**

## 4. Scheduler Model

### Single serialized orchestrator

V1 uses a **single engine process** that owns the scheduler lease.

1. Acquire the scheduler lease.
2. Create a cycle record.
3. Iterate through active domains.
4. For each domain: create run, fetch AMAIA, execute fenced transaction, release.
5. Complete the cycle.

### Scheduler lease acquisition

```
SELECT * FROM amaia_sync_leases WHERE entity_name='scheduler' FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

If held by another process, the engine exits immediately. Cooperative serialization, not DB authentication.

### 4.1 Scheduler Lease as Cycle Admission Control

The scheduler lease governs **cycle admission only**. It determines which engine process may create cycles and initiate domain processing.

Once the fenced transaction begins, the **domain lease becomes the sole correctness authority** (Invariant R16). The CAS validates the domain lease, not the scheduler lease.

**Scheduler lease loss during an active domain transaction does not invalidate the transaction.** The domain lease fencing + CAS provide commit correctness independently. After the domain completes, the engine detects the expired scheduler lease and aborts the cycle.

### 4.2 Scheduler Heartbeat

TTL: 5 minutes. Renewed **only between domains**:

1. Before starting each domain.
2. After completing each domain.

No heartbeat during domain execution.

**Expiry abort rule:** Before starting any new domain, verify `scheduler_lease_expires_at > now()`. If expired, exit cycle.

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
engine_instance_id = UUID v4 (generated once at startup)
owner_identity = "engine:{engine_instance_id}:{hostname}:{pid}"
```

Used for leases, runs, and healthy-run detection. UUID prevents PID-reuse collisions.

## 6. Domain Processing Order

Fixed deterministic order:

1. control_llamadas
2. logestado

Deferred domains skipped via watermark_type check and domain exclusion list.

## 7. Domain Lease

### Acquisition timing

The domain lease is acquired **inside the fenced transaction** (step 6 of Section 10). Before the fenced transaction, the engine does NOT hold the domain lease. Pre-fence operations (read watermark, create run, fetch AMAIA) run without domain lease ownership.

This is safe because:
- Pre-fence operations are read-only (watermark read, AMAIA fetch).
- Run creation is operational evidence, not atomic manifest evidence.
- The fenced transaction revalidates everything under the domain lease lock.

### Lease mechanics

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token (increment), lease_expires_at, heartbeat_at, acquired_at
```

The domain lease serves as the **early fence** (Protocol Invariant 79). If held by another process, the fenced transaction aborts immediately, and the engine skips this domain.

### 7.1 Domain Execution Time Constraint

No heartbeat during the fenced transaction. Domain lease acquired at fence start, must remain valid through commit.

**Maximum domain execution duration < lease TTL.**

Lease expiry during execution → CAS rejects → full rollback → next cycle reprocesses.

## 8. Run Lifecycle

### Run creation (outside fenced transaction)

Before the fenced transaction:

```
1. Read watermark from Supabase.
2. Compute safe upper bound from AMAIA.
3. Apply max_incremental_window cap.
4. Create run:

INSERT INTO amaia_sync_runs (
  job_name, status, cycle_id, domain_name,
  lease_token, owner_identity,
  lower_bound, upper_bound
) VALUES (:domain, 'running', :cycle_id, :domain,
          :lease_token, :owner_identity,
          :lower_bound, :upper_bound);

5. Fetch AMAIA rows into memory.
6. Begin fenced transaction (Section 10).
```

**Run records are operational evidence, not atomic manifest evidence.** R5/R12 do not apply to run creation. A run can exist without a manifest (engine crash between step 4 and fenced tx).

### Run status transitions

```
running → success                     (fenced tx, normal + CAS)
running → completed_with_discrepancy  (fenced tx, sets_match=false, no CAS)
running → orphan_recovered            (recovery, stale run)
running → failed                      (recovery, durable error evidence)
```

`skipped_lock_held` is set at creation time.

### 8.1 Run State Persistence

**Success path (non-empty):** Inside fenced tx:

```
CAS → complete_manifest → UPDATE run status='success' → COMMIT
```

**Success path (empty):** Inside fenced tx:

```
complete_manifest → UPDATE run status='success' → COMMIT
```

No CAS for empty incrementals. Still `success` because no discrepancy was detected.

**Discrepancy path:** Inside fenced tx:

```
complete_manifest → UPDATE run status='completed_with_discrepancy' → COMMIT
```

Manifest terminal, discrepancy recorded, watermark NOT advanced. Next cycle retries.

**Failure path:** Transaction rolls back. Run remains `running`. Recovery handles later.

### 8.2 Run Without Manifest Recovery

Run with `status='running'` and no manifest → `orphan_recovered` with `error_message='orphan run without manifest'`.

## 9. Extraction from AMAIA

### Connection

```
Host: AMAIASQL (internal network)
User: amaia_sync_reader (SELECT only)
Database: amaia
Connection pool: 1 connection (single-threaded)
```

### Fetch protocol

1. **Read watermark** from Supabase.
2. **Compute safe upper bound** from AMAIA: `SELECT MAX(id) - :safety_lag FROM :source_table`.
3. **Apply max_incremental_window** (Section 9.3).
4. **Fetch rows** into memory (batched, Section 9.2).
5. Fetch happens **before** the fenced transaction (R4), **without domain lease** (R20).

### 9.1 Pre-Fence Safety Proof

Safe in V1:

1. **Single orchestrator.** Scheduler lease = global exclusivity.
2. **No domain lease needed for reads.** Watermark read and AMAIA fetch are side-effect-free.
3. **CAS revalidation under fence.** Any cursor change between pre-fence read and fenced CAS causes CAS failure → full rollback.
4. **Engine death before fence.** No CAS → no advance → next cycle reprocesses.

**Pre-fence extraction is safe because watermark advancement is fence-protected by CAS.**

### Safety lag

Default: 100. `safe_upper_bound = MAX(id) - safety_lag`.

### 9.2 Incremental Batch Processing

- Page size: 1000 rows (configurable).
- All pages fetched into memory before fenced tx.
- No Supabase writes during AMAIA fetch.

### 9.3 Maximum Runtime Window

```
max_incremental_window = 10000 (configurable)

effective_upper_bound = min(
    safe_upper_bound,
    lower_bound + max_incremental_window
)
```

Guarantees bounded memory, bounded tx duration, bounded lease consumption. Backlogs processed progressively over multiple cycles.

**A runtime execution must never attempt to consume an unbounded source range.**

### Empty incrementals

If `effective_upper_bound <= lower_bound`:

1. Create run.
2. Begin fenced tx.
3. Acquire domain lease.
4. Create manifest (zero source items).
5. `finalize_source` → count=0.
6. `finalize_comparison` → sets_match=true.
7. **No CAS.**
8. `complete_manifest`.
9. Run `status='success'`.
10. COMMIT.

Empty manifests are **intentional audit artifacts**: they prove the engine checked and found nothing new.

### 9.4 Empty Manifest Retention

- Counted separately via `amaia_sync_empty_incrementals_total`.
- No discrepancy alerts.
- Configurable retention subject to institutional audit requirements.
- Excluded from discrepancy dashboards.

**Never auto-delete:** discrepancy manifests, abandoned manifests, failed runs. These are permanent audit records.

## 10. Fenced Transaction

The fenced transaction is the core atomic unit. **All manifest evidence, destination mutations, CAS operations, and terminal run status updates occur inside the fenced transaction. Initial run creation is intentionally outside.**

### Sequence

```
1.  BEGIN
2.  Acquire domain lease FOR UPDATE
3.  Revalidate watermark (read current value under lock)
4.  Create manifest (phase=created)
5.  Insert source identity items (from in-memory rows)
6.  Upsert destination rows (from in-memory rows)
7.  Call finalize_source
8.  Call finalize_comparison
9.  If sets_match=true AND source_id_count>0: call advance_watermark_cas
10. Call complete_manifest
11. If sets_match=true: UPDATE run status='success'
    Else: UPDATE run status='completed_with_discrepancy'
12. COMMIT
```

If any step fails, the entire transaction rolls back. **No manifest evidence is durable until commit.**

### 10.1 Domain-Level Atomicity

One domain, one run, one manifest, one transaction, at most one CAS. No partial manifests, no per-batch CAS.

## 11. Identity Manifest Construction

### Source items (step 5)

Inside fenced tx. Trigger #11 enforces role and phase.

### Finalization (steps 7–8)

- `finalize_source`: computes source hash, advances to `source_fetched`.
- `finalize_comparison`: queries destination, derives differences, advances to `confirmed_compared`.

Derived items inserted by SECURITY DEFINER as `amaia_sync_manifest_owner`.

## 12. Source vs Persisted Comparison

### Append-only domains (control_llamadas, logestado)

```
S_raw = {source_amaia_id for each source item}
P_check = {amaia_id from destination WHERE amaia_id > lower AND amaia_id <= upper}
missing = S_raw \ P_check
extra = P_check \ S_raw
sets_match = (|missing| = 0) AND (|extra| - |excluded| = 0)
```

### Hash verification

Elements sorted numerically, joined with `|`, SHA-256 (`sha256_pipe_delimited_sorted` / `integer_decimal_v1`).

## 13. Provisional Window (Dormant in V1)

V1 never invokes `amaia_sync_finalize_provisional`. DB capability dormant.

Single orchestrator + safety lag + max_incremental_window eliminate provisional window necessity.

Runtime transitions: `confirmed_compared → comparison_complete` via `complete_manifest`.

**Compatibility assumption:** `complete_manifest` supports direct completion from `confirmed_compared`. If this changes, Runtime V1 must be updated.

## 14. CAS Watermark Advancement

### Contract

When `sets_match=true` AND `source_id_count > 0`:

```sql
SELECT amaia_sync_advance_watermark_cas(:domain, 'id', :expected, :new, :run_id);
```

Inside fenced tx, same transaction as all evidence.

### Validation

- `p_type = 'id'`.
- `p_new > p_expected` (monotonic).
- `p_new = run.upper_bound`.
- Domain lease valid.
- Run valid.
- Exactly 1 row affected.

### CAS not called

1. Empty incremental (source_id_count = 0): no CAS.
2. Discrepancy (sets_match = false): no CAS. Run = `completed_with_discrepancy`.

## 15. Abandonment and Recovery

### 15.1 Stale Run Predicate

A run is **stale** when:

```
now() > stale_threshold
```

where:

```
stale_threshold = greatest(
    lease_expires_at,
    heartbeat_at + (2 * lease_ttl)
)
```

AND at least one of:
- Credentials mismatch (`run.owner_identity != lease.owner_identity` OR `run.lease_token != lease.lease_token`).
- Lease expired (`lease_expires_at <= now()`).

**Expired leases alone are sufficient to classify a stale run** (R21), even if credentials match — an expired lease means the owner stopped heartbeating.

### Detection query

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running'
AND (
    r.owner_identity IS DISTINCT FROM l.owner_identity
    OR r.lease_token IS DISTINCT FROM l.lease_token
    OR l.lease_expires_at <= now()
)
AND now() > greatest(
    l.lease_expires_at,
    l.heartbeat_at + (2 * interval '5 minutes')
);
```

### Abandon protocol

```sql
SELECT amaia_sync_abandon_manifest(:manifest_id, :abandoned_by, :reason);
```

Lock order: domain_lease → run → manifest.

### Healthy run protection

Credentials match + lease valid + lease not expired = healthy. Cannot be abandoned (Protocol Invariant 86).

### 15.2 Run Without Manifest Recovery

Run `running` with no manifest → `orphan_recovered`, `error_message='orphan run without manifest'`.

### 15.3 Recovery Outcome Classification

| Outcome | Condition |
|---|---|
| `orphan_recovered` | Stale run, no durable unrecoverable error evidence. Default for crashes, reboots, lease expiration. |
| `failed` | Durable unrecoverable error evidence exists outside the rolled-back transaction (e.g., schema incompatibility logged to error table). |

**Without durable unrecoverable evidence, stale runs always become `orphan_recovered`.**

### Recovery on startup

1. Generate `engine_instance_id`.
2. Acquire scheduler lease.
3. Scan for stale runs (including run-without-manifest).
4. Abandon manifests, classify runs.
5. Proceed with normal scheduling.

## 16. Error Handling

### 16.1 Domain Failures

Single domain affected. Engine catches exception, logs, **continues to next domain**.

| Example | Action |
|---|---|
| Upsert constraint violation | Rollback. Run stays 'running'. Retry next cycle. |
| CAS failure | Rollback. Retry next cycle. |
| AMAIA query timeout | Skip domain. |
| Domain lease held | Skip domain (`skipped_lock_held`). |

### 16.2 Authority Failures

Engine lost right to operate. **Abort entire cycle.**

| Example | Action |
|---|---|
| Scheduler lease expired (between domains) | Exit cycle. |
| Supabase connection permanently lost | Exit cycle. Retry next tick. |
| AMAIA connection permanently lost | Exit cycle. Retry next tick. |

### 16.3 Unsupported Multi-Process Execution

Multi-process deployment is unsupported for **scheduling correctness**: two engines may create duplicate cycles, process domains redundantly, and waste resources.

However, multi-process deployment does NOT cause **data corruption** for any single domain, because:

- The domain lease prevents concurrent fenced transactions on the same domain.
- The CAS prevents double watermark advancement.
- Manifest finalization validates lease ownership.

**Unsupported does not imply unfenced.** The domain-level protections hold regardless of how many engine processes exist. What breaks is cycle-level coordination, not domain-level correctness.

## 17. Retry and Backoff

No domain retry within same cycle. Next cycle retries with same watermark.

Connection retry: exponential backoff (1s base, 30s max, 3 attempts, ±25% jitter).

Cycle scheduling: fixed interval (default 60s). No overlap.

## 18. Idempotency Guarantees

| Operation | Idempotency |
|---|---|
| AMAIA fetch | Safe. Read-only. |
| Destination upsert | Idempotent (ON CONFLICT + hash skip). |
| Source item insertion | Idempotent (partial unique index). |
| Manifest creation | NOT idempotent. New cycle = new manifest. |
| CAS | Idempotent in effect. Double-advance impossible. |

## 19. Concurrency Model

Single process, single thread, one AMAIA connection, one Supabase connection. Scheduler lease prevents concurrent engines.

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
| `domain.start` / `domain.skip_unsupported` / `domain.skip_lock_held` | info |
| `domain.fetch` / `domain.persist` / `domain.manifest_complete` | info |
| `domain.cas_advanced` / `domain.empty` | info |
| `domain.discrepancy` | warn |
| `domain.error` | error |
| `authority.failure` | error |
| `recovery.stale_run` / `recovery.orphan_no_manifest` / `recovery.abandoned` | warn |

### Metrics

| Metric | Type | Labels |
|---|---|---|
| `amaia_sync_cycles_total` | counter | status |
| `amaia_sync_runs_total` | counter | domain, status |
| `amaia_sync_empty_incrementals_total` | counter | domain |
| `amaia_sync_rows_fetched` / `_upserted` | counter | domain |
| `amaia_sync_manifests_total` | counter | domain, sets_match |
| `amaia_sync_watermark_position` | gauge | domain |
| `amaia_sync_cycle_duration_seconds` | histogram | — |
| `amaia_sync_domain_duration_seconds` | histogram | domain |
| `amaia_sync_cas_failures_total` | counter | domain |
| `amaia_sync_authority_failures_total` | counter | reason |
| `amaia_sync_discrepancies_total` | counter | domain |
| `amaia_sync_window_utilization_ratio` | gauge | domain |

### Alerts

| Condition | Severity |
|---|---|
| No successful cycle in 10 minutes | High |
| Discrepancy detected | Medium |
| Stale run detected | Medium |
| Authority failure | High |
| AMAIA connection failure >3 cycles | High |
| Window utilization >90% sustained | Medium |

## 21. Security

### Runtime role

Service_role key + `SET LOCAL ROLE amaia_sync_runtime` per fenced tx. RLS enforced. SECURITY DEFINER for manifest_owner operations.

### Secrets

Environment variables, never logged.

### AMAIA MySQL

`amaia_sync_reader`, SELECT only, host-restricted.

### Network

Internal AMAIA (3306), HTTPS Supabase (session pooler). No inbound.

## 22. Deployment

```
VM: AMAIASQL (Ubuntu), Node.js, systemd/PM2
```

### Environment variables

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
| `SYNC_LOG_LEVEL` | No (info) |
| `METRICS_PORT` | No (9090) |

### Graceful shutdown

SIGTERM/SIGINT → stop flag → wait for fenced tx → release scheduler lease → close connections → exit.

## 23. Failure Scenarios

| Scenario | Recovery |
|---|---|
| Crash mid-fence | Rollback automatic. Run 'running'. Recovery abandons. |
| Crash after run, before fence | Run-without-manifest. Recovery closes. |
| AMAIA unreachable | Skip domain. Watermark unchanged. |
| Supabase unreachable | Exit cycle. Retry next tick. |
| Lease expires mid-fence | CAS rejects. Full rollback. |
| Scheduler lease lost mid-domain | Domain completes (R16). Cycle aborts after. |
| Backlog > max_window | Progressive catch-up. |
| Append-only assumption violated | Domain MUST be excluded immediately. |

## 24. QA Strategy

### Unit tests

- Domain config (skip timestamp, skip mutable, skip unknown).
- Watermark computation (safety lag, max_window).
- Hash (numeric/pipe).
- AMAIA query builder (append-only id-based only).
- Append-only validation.

### Integration tests

- Full cycle (2 domains).
- Empty incremental (success, no CAS).
- Non-empty incremental.
- Discrepancy → `completed_with_discrepancy`.
- CAS success / failure.
- Recovery: crash → stale → abandon.
- Recovery: run without manifest.
- Authority failure: scheduler lease expiry.
- Max window cap.
- Domain lease contention → skip.
- Scheduler lease loss mid-domain → domain completes, cycle aborts.

## 25. Explicit Non-Goals

| Non-goal | Reason |
|---|---|
| Timestamp domains | V1 id-only. |
| Mutable domain sync | V1 append-only only. |
| Delete synchronization | V1 sources have no deletes. |
| Multi-worker | Single-threaded. |
| Bidirectional sync | AMAIA read-only. |
| Provisional finalization | Dormant. |
| Reconciliation | Phase 9.5. |
| UI integration | Headless. |
| SOS Mujer | Excluded. |

## 26. Architectural Invariants

| # | Invariant |
|---|---|
| R1 | **Single scheduler.** At most one engine holds the scheduler lease. |
| R2 | **Single worker.** One thread, one process. |
| R3 | **AMAIA readonly.** SELECT only. |
| R4 | **Fetch before fence.** AMAIA extraction before fenced tx. |
| R5 | **All evidence inside fence.** Source items, upserts, finalization, CAS, terminal run status. Run creation is outside. |
| R6 | **CAS inside same transaction.** All commit or all rollback. |
| R7 | **No watermark advancement without manifest completion.** |
| R8 | **Recovery cannot abandon healthy runs.** |
| R9 | **Empty incrementals never advance watermarks.** |
| R10 | **Multi-process unsupported for scheduling.** Domain-level fencing still holds. |
| R11 | **V1 supports only id-based domains.** |
| R12 | **No manifest evidence durable before commit.** Run creation is not manifest evidence. |
| R13 | **V1 never invokes provisional finalization.** |
| R14 | **Domain execution within one lease TTL.** |
| R15 | **Every active V1 domain formally validated as append-only.** |
| R16 | **Domain lease is sole commit authority.** Scheduler lease is cycle admission only. |
| R17 | **All V1 executions are bounded** (max_incremental_window). |
| R18 | **Non-empty successful runs imply watermark advancement.** Empty success is valid without CAS. |
| R19 | **V1 supports only formally validated append-only domains.** Mutable domains excluded. |
| R20 | **Domain lease ownership begins only at fenced transaction start.** Pre-fence operations run without domain lease. |
| R21 | **Expired leases alone are sufficient to classify stale runs.** Credential match with expired lease = stale. |

---

## Summary

The AMAIA-SYNC Runtime Engine v1.4 is a single-process, single-threaded Node.js daemon on AMAIASQL that synchronizes **2 append-only id-based domains** (control_llamadas, logestado) from AMAIA MySQL to Supabase. Mutable domains (enfermedades, medicamentos) and timestamp domains (beneficiario, red, alerta) are deferred. AMAIA data is fetched in bounded windows (max 10,000) into memory before the fenced transaction. The domain lease is acquired only at fence start (not pre-fence). All manifest evidence commits atomically; run creation is intentionally outside the fence. Discrepancies produce `completed_with_discrepancy`, not `success`. Empty incrementals are valid success without CAS. Multi-process is unsupported for scheduling but domain fencing still protects. 21 invariants (R1–R21) declared for hostile audit.

---

READY FOR HOSTILE RE-AUDIT
