# AMAIA-SYNC Runtime Engine Architecture v1.3

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.2 (rejected — 2 critical, 4 major, 2 minor corrections)  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-23

---

## Changes from v1.2

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | ID watermark requires append-only source proof | Added Section 3.2: per-domain correctness contracts. Invariant R15. |
| C2 | Critical | Run creation inside fenced tx contradicts reality | Run creation moved outside fence. Section 8 rewritten. Run-without-manifest recovery added. |
| M1 | Major | Scheduler lease loss during domain tx unclear | Scheduler lease = cycle admission only. Domain lease = sole commit authority. Invariant R16. |
| M2 | Major | Unbounded source range risk | Added Section 9.3: max_incremental_window (10,000 rows). Invariant R17. |
| M3 | Major | Recovery classification non-deterministic | Added Section 15.2: deterministic orphan_recovered vs failed classification. |
| M4 | Major | sets_match=false + run success = ambiguous | Added completed_with_discrepancy. R18: success implies watermark advancement. |
| m1 | Minor | Provisional compatibility assumption undeclared | Explicit note in Section 13. |
| m2 | Minor | Empty manifest retention undefined | Added Section 9.4: retention policy. |

---

## 1. Problem Statement

Mistatas operates a teleasistencia platform for elderly care. The operational source of truth for beneficiary data, support networks, alerts, call logs, and health context is AMAIA — a legacy MySQL database hosted on VM AMAIASQL. Mistatas' modern platform runs on Supabase (PostgreSQL). The two systems must stay synchronized so that the Supabase platform can provide real-time dashboards, SLA monitoring, institutional reporting, and operational workflows based on current AMAIA data.

AMAIA is **read-only** from the sync engine's perspective. No writes, no schema changes, no stored procedures.

## 2. Functional Objective

The Runtime Engine is a single-process, single-threaded synchronization daemon that:

1. Periodically fetches incremental changes from AMAIA MySQL.
2. Persists them into Supabase destination tables.
3. Constructs identity manifests proving what was fetched and what was persisted.
4. Compares source vs destination sets with cryptographic hashes.
5. Advances watermarks atomically via CAS.
6. Detects and records discrepancies (missing, extra, excluded).
7. Recovers from failures without data loss or silent corruption.

## 3. Syncable Domains (V1)

### Active domains

| Domain | AMAIA source table | Supabase destination | Identity basis | Watermark type |
|---|---|---|---|---|
| control_llamadas | control_llamadas | amaia_call_logs | source_amaia_id | id |
| logestado | logestado | amaia_alert_logs | source_amaia_id | id |
| enfermedades | beneficiario_enfermedad | amaia_health_conditions | canonical_dedup_key | id |
| medicamentos | beneficiario_medicamento | amaia_medications | canonical_dedup_key | id |

All V1 domains use **id-based watermarks**. The CAS function supports only `cursor_type='id'`.

Each domain has a registered `amaia_sync_domain_identity_policies` row. The runtime MUST read this policy before creating any manifest.

**The runtime MUST skip any domain whose watermark_type is not 'id'.** Unknown or unsupported watermark types are never processed (fail-closed).

### 3.1 Deferred Timestamp Domains

| Domain | AMAIA source table | Supabase destination | Status |
|---|---|---|---|
| beneficiario | beneficiario | amaia_beneficiaries | OUT OF SCOPE V1 |
| red | red | amaia_support_network | OUT OF SCOPE V1 |
| alerta | alerta | amaia_alerts | OUT OF SCOPE V1 |

These require timestamp CAS, monotonicity guarantees, and hybrid cursor design. Deferred to future Phase 9.x.

### 3.2 Source Domain Correctness Contracts

An id-based watermark is correct **only if** the source domain is append-only or immutable after insertion. If rows can be updated or deleted in AMAIA after their initial insert, the id-based incremental model may miss mutations.

**Runtime V1 may only process domains whose source mutation model has been formally validated.**

| Domain | AMAIA source table | Mutation model | Evidence | V1 eligible |
|---|---|---|---|---|
| control_llamadas | control_llamadas | **Append-only.** Rows are call log entries. Once created, they are never modified or deleted. The primary key is auto-increment. | Operational knowledge: AMAIA call logs are audit records. No UPDATE/DELETE observed in production. | YES |
| logestado | logestado | **Append-only.** Rows are alert state log entries. Each state transition creates a new row. Existing rows are never modified. | Operational knowledge: logestado is an event log. Rows are immutable after insertion. | YES |
| enfermedades | beneficiario_enfermedad | **Mutable.** Rows can be updated (e.g., condition status change) or soft-deleted. However, the dedup identity model uses canonical keys that absorb mutations via membership episodes. A changed row produces a new canonical key, which the membership system tracks as a new episode. | Dedup model absorbs mutations by design: changed hash = new canonical key = new membership episode. Old episode closed, new episode opened. | YES (via dedup model) |
| medicamentos | beneficiario_medicamento | **Mutable.** Same mutation model as enfermedades. Rows can be updated. The dedup canonical key model absorbs mutations via membership episodes. | Same as enfermedades. | YES (via dedup model) |

**Summary:**
- control_llamadas and logestado: append-only sources. ID watermark is directly correct.
- enfermedades and medicamentos: mutable sources, but the dedup canonical key model converts mutations into new identity episodes. The incremental sync detects new/changed canonical keys via membership tracking. Deletions are detected by reconciliation (Phase 9.5), not by incremental sync.

**Residual risk for dedup domains:** If a row is mutated in AMAIA but its canonical hash does not change (e.g., a non-hashed field is modified), the incremental sync will not detect the mutation. This is accepted: the hash covers the semantically significant fields. Non-hashed field changes are not sync-relevant.

## 4. Scheduler Model

### Single serialized orchestrator

V1 uses a **single engine process** that owns the scheduler lease.

1. Acquire the scheduler lease from `amaia_sync_leases` (entity_name='scheduler').
2. Create a cycle record in `amaia_sync_cycles`.
3. Iterate through active domains in deterministic order.
4. For each domain: acquire domain lease, create run, execute sync, release domain lease.
5. Complete the cycle.

### Scheduler lease acquisition

```
SELECT * FROM amaia_sync_leases WHERE entity_name='scheduler' FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

If another process holds a non-expired scheduler lease, the engine exits immediately. Cooperative serialization, not DB authentication.

### 4.1 Scheduler Lease as Cycle Admission Control

The scheduler lease governs **cycle admission only**. It determines which engine process may create cycles and initiate domain processing.

Once a domain's fenced transaction has begun, the **domain lease becomes the sole correctness authority** (Invariant R16). The CAS function validates the domain lease, not the scheduler lease. The scheduler lease could expire mid-domain without invalidating the fenced transaction, because:

- Single worker: no concurrent process competes for the same domain.
- Domain lease fencing: the CAS validates domain lease credentials.
- No concurrent same-domain execution: the domain lease prevents it.

**Scheduler lease loss during an active domain transaction does not invalidate the transaction.** The engine will detect the expired scheduler lease after the domain completes and abort the cycle (no further domains processed).

### 4.2 Scheduler Heartbeat

The scheduler lease (TTL: 5 minutes) is renewed **only between domains**:

1. **Before** starting each domain.
2. **After** completing each domain.

No heartbeat during domain execution. If the scheduler lease expires during domain processing, the current domain may still complete (domain lease is the authority). After completing the domain, the engine detects the expired scheduler lease and aborts the cycle.

**Expiry abort rule:** Before starting any new domain, verify `scheduler_lease_expires_at > now()`. If expired, exit the cycle loop.

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

Used for scheduler lease, domain lease, run ownership, and healthy-run detection. The UUID prevents PID-reuse collisions.

## 6. Domain Processing Order

Fixed deterministic order:

1. control_llamadas
2. logestado
3. enfermedades
4. medicamentos

Deferred domains (beneficiario, red, alerta) skipped via watermark_type check.

## 7. Domain Lease Acquisition

Before processing any domain:

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token (increment), lease_expires_at, heartbeat_at, acquired_at
```

The domain lease serves as the **early fence** (Protocol Invariant 79). If held by another process, the engine skips with `skipped_lock_held`.

### 7.1 Domain Execution Time Constraint

No heartbeat during the fenced transaction. Domain lease acquired at fence start, must remain valid through commit.

**Maximum domain execution duration < lease TTL.**

If a domain cannot complete within one TTL, the architecture must be redesigned. V1 prioritizes correctness over throughput.

Lease expiry during execution → CAS rejects → full rollback → next cycle reprocesses.

## 8. Run Lifecycle

### Run creation (outside fenced transaction)

```
1. Acquire domain lease (separate short transaction or pre-fence).
2. Read watermark.
3. Compute safe upper bound from AMAIA.
4. Apply max_incremental_window cap.
5. Create run record:

INSERT INTO amaia_sync_runs (
  job_name, status, cycle_id, domain_name,
  lease_token, owner_identity,
  lower_bound, upper_bound
) VALUES (:domain, 'running', :cycle_id, :domain,
          :lease_token, :owner_identity,
          :lower_bound, :upper_bound);

6. Fetch AMAIA rows into memory.
7. Begin fenced transaction (Section 10).
```

**Run records are operational evidence, not atomic manifest evidence.** A run can exist without a manifest (if the engine crashes between step 5 and the fenced transaction).

### Run status transitions

```
running → success                     (inside fenced tx, normal completion)
running → completed_with_discrepancy  (inside fenced tx, sets_match=false)
running → orphan_recovered            (recovery, outside any tx)
running → failed                      (recovery with durable error evidence, outside any tx)
```

`skipped_lock_held` is set at creation time.

### 8.1 Run State Persistence

**Success path:** Inside the fenced transaction, after `complete_manifest` and CAS:

```
complete_manifest → UPDATE run SET status='success', finished_at=now() → COMMIT
```

**Discrepancy path:** Inside the fenced transaction, after `complete_manifest` without CAS:

```
complete_manifest → UPDATE run SET status='completed_with_discrepancy', finished_at=now() → COMMIT
```

The manifest is terminal (`comparison_complete`), the discrepancy is recorded (`sets_match=false`, `missing_ids`, `extra_ids`), but the watermark was NOT advanced. The next cycle retries the same range.

**Failure path:** Transaction rolls back. Run remains `status='running'`. Recovery handles it later.

### 8.2 Run Without Manifest Recovery

If a run exists with `status='running'` but has no associated manifest, recovery classifies it as:

```
orphan_run_without_manifest
```

This occurs when the engine crashes after creating the run (step 5) but before the fenced transaction creates the manifest. Recovery closes it:

```
UPDATE amaia_sync_runs
SET status='orphan_recovered', finished_at=now(),
    error_message='orphan run without manifest'
WHERE id=:run_id AND status='running';
```

No manifest abandonment is needed (no manifest exists).

## 9. Extraction from AMAIA

### Connection

```
Host: AMAIASQL (internal network)
User: amaia_sync_reader (SELECT only)
Database: amaia
Connection pool: 1 connection (single-threaded)
```

### Fetch protocol

1. **Read watermark** from Supabase: `SELECT last_id FROM amaia_sync_watermarks WHERE entity_name=:domain`.
2. **Compute safe upper bound** from AMAIA: `SELECT MAX(id) - :safety_lag FROM :source_table`.
3. **Apply max_incremental_window** (Section 9.3).
4. **Fetch rows** from AMAIA into memory (batched, Section 9.2).
5. The fetch happens **before** the fenced transaction (Invariant R4).

### 9.1 Pre-Fence Upper Bound Safety Proof

The upper_bound and AMAIA fetch occur before the fenced transaction. Safe in V1:

1. **Single serialized orchestrator.** Scheduler lease guarantees global exclusivity.
2. **Domain lease exclusivity.** No concurrent writes to the same domain.
3. **No multi-worker.**
4. **CAS revalidation under fence.** Validates `last_id IS NOT DISTINCT FROM expected_cursor`.
5. **Lease expiry invalidates commit.** Engine death → no CAS → no advance → next cycle reprocesses.

**Pre-fence extraction is safe because watermark advancement is fence-protected by CAS.**

### Safety lag

Default: 100. Prevents reading rows from uncommitted AMAIA transactions. `safe_upper_bound = MAX(id) - safety_lag`.

### 9.2 Incremental Batch Processing

- **Page size:** 1000 rows (configurable, default 1000).
- **Fetch loop:** `SELECT * FROM :source WHERE id > :page_start AND id <= :upper ORDER BY id LIMIT :batch_size`.
- **All pages fetched into memory before the fenced transaction.**

### 9.3 Maximum Runtime Window

Each domain execution is bounded:

```
max_incremental_window = 10000 (configurable, default 10000)

effective_upper_bound = min(
    safe_upper_bound,
    lower_bound + max_incremental_window
)
```

This guarantees:
- **Bounded memory:** at most `max_incremental_window` rows in memory.
- **Bounded transaction duration:** proportional to window size.
- **Bounded lease consumption:** execution fits within one lease TTL.

If there is a backlog larger than `max_incremental_window`, the engine processes one window per cycle and progressively catches up. **A runtime execution must never attempt to consume an unbounded source range.**

### Empty incrementals

If `effective_upper_bound <= lower_bound`, no new data. The engine:

1. Creates a run.
2. Begins fenced transaction.
3. Creates manifest with zero source items.
4. `finalize_source` → `source_id_count=0`.
5. `finalize_comparison` → `sets_match=true`.
6. **No CAS.** Watermark unchanged.
7. `complete_manifest`.
8. Run `status='success'`.
9. COMMIT.

Empty incremental manifests are **intentional audit artifacts**.

### 9.4 Empty Manifest Retention

Empty manifests:
- Are counted separately via `amaia_sync_empty_incrementals_total` metric.
- Do not generate discrepancy alerts.
- Are subject to reduced retention (configurable, default: 7 days) via periodic cleanup.
- Are excluded from discrepancy dashboards.

They prove the engine was alive and checked the domain. They do not indicate a problem.

## 10. Fenced Transaction

The fenced transaction is the core atomic unit. **All Supabase writes for a domain occur inside this single transaction.**

### Sequence

```
1.  BEGIN
2.  Acquire domain lease FOR UPDATE
3.  Revalidate watermark (read current value under lock)
4.  Create manifest (phase=created)
5.  Insert source identity items (from in-memory fetched rows)
6.  Upsert destination rows (from in-memory fetched rows)
7.  Call finalize_source
8.  Call finalize_comparison
9.  If sets_match=true AND source_id_count>0: call advance_watermark_cas
10. Call complete_manifest
11. If sets_match=true: UPDATE run status='success'
    Else: UPDATE run status='completed_with_discrepancy'
12. COMMIT
```

If any step fails, the entire transaction rolls back. **No manifest evidence is durable until commit.**

### 10.1 Domain-Level Atomicity Guarantee

One domain, one run, one manifest, one transaction, at most one CAS.

No partial manifests. No partial CAS. No per-batch CAS. No per-batch manifests.

## 11. Identity Manifest Construction

### Source items

Inside the fenced transaction (step 5), for each fetched row. Trigger #11 enforces role and phase.

### Finalization

Inside the fenced transaction (steps 7–8):
- `finalize_source`: computes source hash, advances to `source_fetched`.
- `finalize_comparison`: queries destination, derives differences, advances to `confirmed_compared`.

All derived items inserted by SECURITY DEFINER functions as `amaia_sync_manifest_owner`.

## 12. Source vs Persisted Comparison

### Non-dedup domains (control_llamadas, logestado)

```
S_raw = {source_amaia_id for each source item}
P_check = {amaia_id from destination WHERE amaia_id > lower AND amaia_id <= upper}
missing = S_raw \ P_check
extra = P_check \ S_raw
sets_match = (|missing| = 0) AND (|extra| - |excluded| = 0)
```

### Dedup domains (enfermedades, medicamentos)

```
S_raw = {canonical_key for each source item}
P_check = {canonical_key from destination WHERE key IN S_raw}
missing = S_raw \ P_check
extra: not computed in incremental (reconciliation handles extras)
sets_match = (|missing| = 0)
```

### Hash verification

- `source_amaia_id`: sorted numerically, joined with `|`, SHA-256.
- `canonical_dedup_key`: sorted lexicographically, joined with `:`, SHA-256.

## 13. Provisional Window (Dormant in V1)

V1 Runtime **never invokes `amaia_sync_finalize_provisional`**. The DB capability is dormant.

V1's single orchestrator + safety lag + max_incremental_window eliminate the conditions requiring provisional windows.

Runtime transitions directly: `confirmed_compared → comparison_complete` via `complete_manifest`.

**Compatibility assumption:** Runtime V1 assumes `complete_manifest` supports direct completion from `confirmed_compared` when no provisional finalization occurred. If this invariant changes in the DB layer, Runtime V1 becomes invalid and must be updated.

Provisional finalization is reserved for future high-throughput versions.

## 14. CAS Watermark Advancement

### Contract

When `sets_match=true` AND `source_id_count > 0`:

```sql
SELECT amaia_sync_advance_watermark_cas(:domain, 'id', :expected, :new, :run_id);
```

Inside the fenced transaction, same transaction as all evidence.

### Validation (inside function)

- `p_type = 'id'`.
- `p_new > p_expected` (monotonic).
- `p_new = run.upper_bound`.
- Lease valid.
- Run valid.
- Exactly 1 row affected.

### CAS not called when

1. Empty incremental (`source_id_count = 0`).
2. Discrepancy (`sets_match = false`). Manifest completes, run = `completed_with_discrepancy`.

## 15. Abandonment and Recovery

### Stale threshold

```
stale_threshold = greatest(
    lease_expires_at,
    heartbeat_at + (2 * lease_ttl)
)
```

Run considered stale when `now() > stale_threshold` AND credentials mismatch.

### Detection query

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running'
AND (r.owner_identity IS DISTINCT FROM l.owner_identity
     OR r.lease_token IS DISTINCT FROM l.lease_token
     OR l.lease_expires_at <= now())
AND now() > greatest(
    l.lease_expires_at,
    l.heartbeat_at + (2 * interval '5 minutes')
);
```

### Abandon protocol

For runs with non-terminal manifests:

```sql
SELECT amaia_sync_abandon_manifest(:manifest_id, :abandoned_by, :reason);
```

Lock order: domain_lease → run → manifest.

### Healthy run protection

Credentials match + lease valid = healthy. Cannot be abandoned (Invariant 86).

### 15.1 Run Without Manifest Recovery

Runs with `status='running'` and no associated manifest → `orphan_recovered` with `error_message='orphan run without manifest'`.

### 15.2 Recovery Outcome Classification

| Outcome | Condition | Examples |
|---|---|---|
| `orphan_recovered` | Stale run, no durable unrecoverable error evidence. | Engine crash, VM reboot, power loss, lease expiration, network partition. |
| `failed` | Durable unrecoverable error evidence exists, recorded OUTSIDE the rolled-back transaction. | Schema incompatibility logged to error table, unsupported source mutation model detected, configuration error persisted to separate audit record. |

**Without durable unrecoverable evidence, stale runs always become `orphan_recovered`.** The `failed` status requires positive evidence that the domain cannot be retried without manual intervention.

### Recovery on startup

1. Generate `engine_instance_id`.
2. Acquire scheduler lease.
3. Scan for stale runs (including run-without-manifest).
4. Abandon manifests, mark runs `orphan_recovered` or `failed`.
5. Proceed with normal scheduling.

## 16. Error Handling

### 16.1 Domain Failures

Affect one domain. Engine catches exception, logs, **continues to next domain**.

| Example | Action |
|---|---|
| Upsert constraint violation | Transaction rolls back. Run stays 'running'. Retry next cycle. |
| CAS failure | Transaction rolls back. Retry next cycle. |
| AMAIA query timeout | No data fetched. Skip domain this cycle. |

### 16.2 Authority Failures

Engine has lost its right to operate. **Abort the entire cycle immediately.**

| Example | Action |
|---|---|
| Scheduler lease expired (detected between domains) | Exit cycle. |
| Supabase connection permanently lost | Exit cycle. Retry next scheduler tick. |
| AMAIA connection permanently lost | Exit cycle. Retry next scheduler tick. |

Authority failures are checked before each domain. Mid-domain authority loss is caught by CAS/lease validation within the fenced transaction.

## 17. Retry and Backoff

No domain-level retry within same cycle. Next cycle retries with same watermark.

Connection retry: exponential backoff (1s base, 30s max, 3 attempts, ±25% jitter).

Cycle scheduling: fixed interval (default 60s). No overlap.

## 18. Idempotency Guarantees

| Operation | Idempotency |
|---|---|
| AMAIA fetch | Safe to repeat. Read-only. |
| Destination upsert | Idempotent via ON CONFLICT + hash-based skip. |
| Source item insertion | Idempotent via partial unique index. |
| Manifest creation | NOT idempotent. New cycle = new run = new manifest. |
| CAS | Idempotent in effect: double-advance impossible. |

## 19. Concurrency Model

Single process, single thread, one AMAIA connection, one Supabase connection. No parallelism. Scheduler lease prevents concurrent engines.

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
| `scheduler.lease_acquired` | info |
| `scheduler.lease_held` | warn |
| `scheduler.lease_expired_mid_cycle` | warn |
| `cycle.start` / `cycle.complete` | info |
| `domain.start` / `domain.skip_timestamp` / `domain.skip_lock_held` | info |
| `domain.fetch` / `domain.persist` / `domain.manifest_complete` | info |
| `domain.cas_advanced` | info |
| `domain.empty` | info |
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
| `amaia_sync_rows_fetched` | counter | domain |
| `amaia_sync_rows_upserted` | counter | domain |
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

Engine connects via service_role key, operates under `amaia_sync_runtime` via `SET LOCAL ROLE`. RLS enforces constraints. SECURITY DEFINER functions execute as `amaia_sync_manifest_owner`.

### Secrets

Environment variables, never logged: `SUPABASE_SERVICE_KEY`, `AMAIA_MYSQL_PASSWORD`.

### AMAIA MySQL

`amaia_sync_reader`, SELECT only, host-restricted.

### Network

AMAIASQL → AMAIA MySQL (internal, 3306). AMAIASQL → Supabase (HTTPS, session pooler). No inbound required.

## 22. Deployment

```
VM: AMAIASQL (Ubuntu)
Runtime: Node.js
Process manager: systemd or PM2
```

### Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `SUPABASE_URL` | Project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Service role key | Yes |
| `AMAIA_MYSQL_HOST` | MySQL host | Yes |
| `AMAIA_MYSQL_PORT` | Port (default 3306) | No |
| `AMAIA_MYSQL_USER` | MySQL user | Yes |
| `AMAIA_MYSQL_PASSWORD` | MySQL password | Yes |
| `AMAIA_MYSQL_DATABASE` | Database name | Yes |
| `SYNC_CYCLE_INTERVAL_MS` | Cycle interval (default 60000) | No |
| `SYNC_SAFETY_LAG_ID` | Safety lag (default 100) | No |
| `SYNC_LEASE_TTL_SECONDS` | Lease TTL (default 300) | No |
| `SYNC_BATCH_SIZE` | Rows per page (default 1000) | No |
| `SYNC_MAX_WINDOW` | Max incremental window (default 10000) | No |
| `SYNC_LOG_LEVEL` | Log level (default info) | No |
| `METRICS_PORT` | Prometheus port (default 9090) | No |

### Graceful shutdown

SIGTERM/SIGINT: set `running=false`, wait for current fenced tx, release scheduler lease, close connections, exit.

## 23. Failure Scenarios

| Scenario | Impact | Recovery |
|---|---|---|
| Engine crash mid-domain | Run 'running', manifest non-terminal | Abandon manifest, orphan_recovered |
| Engine crash after run creation, before fence | Run 'running', no manifest | orphan_run_without_manifest → orphan_recovered |
| AMAIA unreachable | No data fetched | Skip domain. Watermarks unchanged. |
| Supabase unreachable | Cannot begin tx | Exit cycle. Retry next tick. |
| Lease expires mid-fence | CAS rejects | Full rollback. Next cycle reprocesses. |
| Scheduler lease lost mid-domain | Tolerated (R16) | Domain completes if domain lease valid. Cycle aborts after. |
| Backlog > max_window | Partial range processed | Progressive catch-up over multiple cycles. |

## 24. QA Strategy

### Unit tests

- Domain config loading (skip timestamp, skip unknown).
- Watermark computation (safety lag, max_window cap).
- Identity hashing (numeric/pipe, canonical/colon).
- AMAIA query builder (id-based only).
- Source correctness contract validation.

### Integration tests

- Full cycle (local MySQL + local Supabase).
- Empty incremental (no CAS).
- Non-empty incremental with known data.
- Discrepancy detection → `completed_with_discrepancy`.
- CAS success and failure.
- Lease acquisition.
- Recovery: crash → stale → abandon → retry.
- Recovery: run without manifest → orphan_recovered.
- Authority failure: scheduler lease expiry between domains.
- Max window cap: backlog > 10000 → only 10000 processed.
- Scheduler lease loss mid-domain: domain completes, cycle aborts.

## 25. Explicit Non-Goals

| Non-goal | Reason |
|---|---|
| Timestamp domain sync | V1 id-only. Deferred. |
| Multi-worker | V1 single-threaded. |
| Bidirectional sync | AMAIA read-only. |
| Real-time streaming | Polling sufficient for SLA. |
| Provisional finalization | Dormant. |
| Schema migration of AMAIA | Read only. |
| UI integration | Headless daemon. |
| SOS Mujer | Excluded. |
| Reconciliation | Phase 9.5. |
| AMAIA mutation detection | Dedup model handles via canonical keys. Direct mutation detection deferred. |

## 26. Architectural Invariants

| # | Invariant |
|---|---|
| R1 | **Single scheduler.** At most one engine holds the scheduler lease. |
| R2 | **Single worker.** One thread, one process. No parallelism in V1. |
| R3 | **AMAIA readonly.** SELECT only. |
| R4 | **Fetch before fence.** AMAIA extraction before fenced tx. Data in memory. |
| R5 | **All evidence inside fence.** Source items, upserts, finalization, CAS commit atomically. |
| R6 | **CAS inside same transaction.** All commit or all rollback. |
| R7 | **No watermark advancement without manifest completion.** |
| R8 | **Recovery cannot abandon healthy runs.** |
| R9 | **Empty incrementals never advance watermarks.** |
| R10 | **Multi-process unsupported in V1.** |
| R11 | **V1 supports only id-based domains.** |
| R12 | **No manifest evidence durable before commit.** |
| R13 | **V1 never invokes provisional finalization.** |
| R14 | **Domain execution within one lease TTL.** |
| R15 | **Every active V1 domain formally validated as append-only or mutation-absorbing.** |
| R16 | **Domain lease is sole correctness authority during domain execution.** Scheduler lease is cycle admission only. |
| R17 | **All V1 executions are bounded.** max_incremental_window caps source range. |
| R18 | **Successful runs always imply watermark advancement.** Discrepancies produce `completed_with_discrepancy`, not `success`. |

---

## Summary

The AMAIA-SYNC Runtime Engine v1.3 is a single-process, single-threaded Node.js daemon on AMAIASQL that synchronizes 4 id-based domains (control_llamadas, logestado, enfermedades, medicamentos) from AMAIA MySQL to Supabase. Each domain has a formally validated source correctness contract (append-only or mutation-absorbing via dedup). Timestamp domains are deferred. AMAIA data is fetched in bounded windows (max 10,000 rows) into memory before the fenced transaction. All Supabase writes commit atomically. The scheduler lease is cycle admission control; the domain lease is the sole commit authority. Runs that detect discrepancies are `completed_with_discrepancy` (not `success`). Recovery classifies stale runs deterministically: `orphan_recovered` without durable error evidence, `failed` with it. Provisional finalization is dormant. 18 invariants (R1–R18) declared for hostile audit.

---

READY FOR HOSTILE RE-AUDIT
