# AMAIA-SYNC Runtime Engine Architecture v1.5

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.4 (rejected — 2 critical, 3 major, 2 minor corrections)  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.4

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | Run created pre-fence with lease credentials, but lease acquired inside fence | Pre-run created with NULL credentials. Bind-run-to-lease operation inside fenced tx. R22, R23. |
| C2 | Critical | CAS skipped for empty/discrepancy → watermark not revalidated | Hard watermark revalidation added for ALL paths before manifest creation. R24. |
| M1 | Major | Domain lease release semantics undefined | Added Section 7.2: advisory release, not correctness-critical. R25. |
| M2 | Major | skipped_lock_held as run status contradicts pre-fence run model | Eliminated as run status. Lock contention = cycle-level event, no run created. |
| M3 | Major | Empty incremental semantics imprecise | Corrected: "no eligible rows in current safe bounded window" (not "nothing new in AMAIA"). |
| m1 | Minor | Append-only validation procedure missing | Added Section 3.4: validation procedure with evidence types. R26. |
| m2 | Minor | Durable failure evidence undefined | Added Section 15.4: durable evidence requirements for `failed` status. |

---

## 1. Problem Statement

Mistatas operates a teleasistencia platform for elderly care. AMAIA (legacy MySQL, VM AMAIASQL) is the source of truth. Supabase (PostgreSQL) is the modern operational platform. The sync engine keeps Supabase current with AMAIA data.

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

Both V1 domains are **append-only** and **immutable after insertion**. The auto-increment primary key provides a monotonic cursor.

**Runtime V1 correctness guarantees are claimed only for append-only domains.**

The runtime MUST skip any domain whose watermark_type is not 'id' or whose domain is not in the active V1 list. Fail-closed.

### 3.1 Deferred Timestamp Domains

| Domain | Status | Reason |
|---|---|---|
| beneficiario | OUT OF SCOPE V1 | Timestamp watermark. Requires CAS timestamp support. |
| red | OUT OF SCOPE V1 | Timestamp watermark. |
| alerta | OUT OF SCOPE V1 | Timestamp watermark. |

### 3.2 Deferred Mutable Domains

| Domain | Status | Reason |
|---|---|---|
| enfermedades | OUT OF SCOPE V1 | Mutable source. `WHERE id > watermark` misses mutations to existing rows. |
| medicamentos | OUT OF SCOPE V1 | Mutable source. Same limitation. |

Require mutation detection, reconciliation, and a cursor model beyond simple id-based watermarks. Infrastructure deployed in Phase 9.3C as dormant capability.

### 3.3 Delete Semantics

**Runtime V1 does not provide delete synchronization guarantees.**

Active V1 domains are append-only: no deletes in AMAIA. Delete handling is outside V1 scope. Tombstone infrastructure (Phase 9.3C) is dormant.

**If evidence emerges that control_llamadas or logestado are not strictly append-only, the domain MUST be immediately excluded from Runtime V1.**

### 3.4 Append-Only Validation Procedure

Runtime V1 deployment requires **manual architectural validation** per domain before activation.

Acceptable evidence:

| Evidence type | Description |
|---|---|
| Vendor documentation | AMAIA vendor confirms table is insert-only. |
| Schema analysis | No UPDATE/DELETE triggers, no UPDATE grants to application users, no soft-delete columns. |
| Historical sampling | Query `information_schema` or audit logs for UPDATE/DELETE activity over a representative period. |
| Operational verification | DBA confirms no application code path issues UPDATE/DELETE against the table. |

At least two independent evidence types are required per domain.

**Domains lacking append-only evidence are ineligible for Runtime V1** (R26).

## 4. Scheduler Model

### Single serialized orchestrator

V1 uses a **single engine process** that owns the scheduler lease.

1. Acquire the scheduler lease.
2. Create a cycle record.
3. Iterate through active domains.
4. For each domain: create pre-run, fetch AMAIA, execute fenced transaction.
5. Complete the cycle.

### Scheduler lease acquisition

```
SELECT * FROM amaia_sync_leases WHERE entity_name='scheduler' FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

Cooperative serialization. If held, engine exits.

### 4.1 Scheduler Lease as Cycle Admission Control

The scheduler lease governs **cycle admission only**. Once the fenced transaction begins, the **domain lease is the sole correctness authority** (R16).

Scheduler lease loss during an active domain transaction does not invalidate that transaction.

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

UUID prevents PID-reuse collisions.

## 6. Domain Processing Order

Fixed:

1. control_llamadas
2. logestado

All other domains skipped.

## 7. Domain Lease

### Acquisition timing

The domain lease is acquired **inside the fenced transaction** (step 2 of Section 10). Pre-fence operations run without domain lease ownership (R20).

### Lease mechanics

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

If held by another process, the fenced transaction aborts. No run is created for this domain (lock contention is an operational event, not a run record — see Section 8).

### 7.1 Domain Execution Time Constraint

No heartbeat during fenced tx. **Maximum domain execution < lease TTL.**

Lease expiry → CAS rejects → full rollback.

### 7.2 Domain Lease Release

After a successful commit, the runtime releases the domain lease:

```
UPDATE amaia_sync_leases
SET owner_identity = NULL, lease_token = lease_token
WHERE entity_name = :domain
  AND owner_identity = :owner_identity
  AND lease_token = :lease_token;
```

Release is **best-effort and advisory**. If it fails (network error, process crash after commit), the lease expires naturally via TTL.

**Lease release failure never invalidates a committed synchronization** (R25). The commit was atomic and complete before the release attempt.

## 8. Run Lifecycle

### 8.1 Pre-Run Creation (outside fenced transaction)

Before the fenced transaction, the engine creates a **pre-run**:

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

**Pre-runs carry NULL lease credentials** (R22). The `lease_token` and `owner_identity` are unknown at this point because the domain lease has not been acquired yet.

Pre-runs are operational evidence only. They record that the engine intends to process this domain.

### 8.2 Bind Run to Lease (inside fenced transaction)

After acquiring the domain lease (step 2 of Section 10), the engine binds the pre-run:

```sql
UPDATE amaia_sync_runs
SET owner_identity = :lease_owner_identity,
    lease_token = :lease_token
WHERE id = :run_id
  AND status = 'running'
  AND owner_identity IS NULL
  AND lease_token IS NULL;
```

This atomically associates the run with the acquired lease. **No manifest operation may execute before bind-run-to-lease succeeds** (R23).

If binding fails (run already bound, run not found, unexpected state), the fenced transaction aborts.

### 8.3 Run Status Transitions

```
running → success                     (fenced tx, CAS + complete)
running → completed_with_discrepancy  (fenced tx, no CAS, sets_match=false)
running → orphan_recovered            (recovery)
running → failed                      (recovery, with durable error evidence)
```

There is no `skipped_lock_held` run status. Lock contention before the fenced transaction produces an **operational event** (log + metric), not a run record. No run is created if the domain lease cannot be acquired.

### 8.4 Run State Persistence

**Success path (non-empty):** Inside fenced tx:

```
bind → watermark revalidation → evidence → CAS → complete_manifest → status='success' → COMMIT
```

**Success path (empty):** Inside fenced tx:

```
bind → watermark revalidation → evidence (zero items) → complete_manifest → status='success' → COMMIT
```

No CAS for empty incrementals. Still `success` because no discrepancy was detected.

**Discrepancy path:** Inside fenced tx:

```
bind → watermark revalidation → evidence → complete_manifest → status='completed_with_discrepancy' → COMMIT
```

Watermark NOT advanced. Next cycle retries.

**Failure path:** Transaction rolls back. Run remains `running` with NULL credentials (pre-run state). Recovery handles.

### 8.5 Run Without Manifest Recovery

Run with `status='running'` and no manifest → `orphan_recovered` with `error_message='orphan run without manifest'`.

This covers:
- Engine crash after pre-run creation but before fenced tx.
- Engine crash after fenced tx starts but before manifest creation.
- Fenced tx rollback (run reverts to pre-run state with NULL credentials).

## 9. Extraction from AMAIA

### Connection

```
Host: AMAIASQL (internal)
User: amaia_sync_reader (SELECT only)
Connection pool: 1 (single-threaded)
```

### Fetch protocol

1. **Read watermark** from Supabase.
2. **Compute safe upper bound** from AMAIA: `SELECT MAX(id) - :safety_lag FROM :source_table`.
3. **Apply max_incremental_window** (Section 9.3).
4. **Fetch rows** into memory (batched, Section 9.2).
5. Fetch happens before fenced tx (R4), without domain lease (R20).

### 9.1 Pre-Fence Safety Proof

Safe in V1:

1. **Single orchestrator.** Scheduler lease = global exclusivity.
2. **No domain lease needed for reads.** Side-effect-free.
3. **CAS revalidation under fence.**
4. **Hard watermark revalidation** (R24) inside fence catches any cursor drift.
5. **Engine death before fence.** No CAS → no advance.

**Pre-fence extraction is safe because watermark advancement is fence-protected by CAS, and all paths revalidate the watermark before producing evidence.**

### Safety lag

Default: 100. `safe_upper_bound = MAX(id) - safety_lag`.

### 9.2 Incremental Batch Processing

- Page size: 1000 rows (configurable).
- All pages fetched into memory before fenced tx.

### 9.3 Maximum Runtime Window

```
max_incremental_window = 10000 (configurable)

effective_upper_bound = min(safe_upper_bound, lower_bound + max_incremental_window)
```

Guarantees bounded memory, tx duration, and lease consumption.

### Empty incrementals

If `effective_upper_bound <= lower_bound`:

**No eligible rows were found inside the current safe bounded window.** Rows may still exist beyond `safe_upper_bound` due to safety lag. This is not "nothing new in AMAIA" — it is "nothing new within the observable safe range."

The engine:

1. Creates pre-run (lower=upper=current watermark).
2. Begins fenced tx.
3. Acquires domain lease.
4. Binds run to lease.
5. Hard watermark revalidation.
6. Creates manifest (zero source items).
7. `finalize_source` → count=0.
8. `finalize_comparison` → sets_match=true.
9. **No CAS.**
10. `complete_manifest`.
11. Run `status='success'`.
12. COMMIT.

Empty manifests are **intentional audit artifacts**.

### 9.4 Empty Manifest Retention

- Counted via `amaia_sync_empty_incrementals_total`.
- No discrepancy alerts.
- Configurable retention subject to institutional audit requirements.
- Excluded from discrepancy dashboards.

**Never auto-delete:** discrepancy manifests, abandoned manifests, failed runs.

## 10. Fenced Transaction

**All manifest evidence, destination mutations, CAS operations, and terminal run status updates occur inside the fenced transaction. Pre-run creation is intentionally outside. Pre-run is operational evidence, not atomic manifest evidence.**

### Sequence

```
1.  BEGIN
2.  Acquire domain lease FOR UPDATE
3.  Bind run to lease (set owner_identity, lease_token)
4.  Hard watermark revalidation:
      SELECT last_id FROM watermarks WHERE entity_name=:domain
      ASSERT last_id = run.lower_bound
5.  Create manifest (phase=created)
6.  Insert source identity items (from in-memory rows)
7.  Upsert destination rows (from in-memory rows)
8.  Call finalize_source
9.  Call finalize_comparison
10. If sets_match=true AND source_id_count>0: call advance_watermark_cas
11. Call complete_manifest
12. If sets_match=true: UPDATE run status='success'
    Else: UPDATE run status='completed_with_discrepancy'
13. COMMIT
```

If any step fails, the entire transaction rolls back. **No manifest evidence is durable until commit.** The pre-run reverts to NULL-credential state on rollback.

### 10.1 Hard Watermark Revalidation (Step 4)

Before any manifest evidence is produced, the runtime reads the current watermark under the domain lease lock and asserts:

```
current_watermark == run.lower_bound
```

This applies to **all execution paths**: non-empty, empty, discrepancy. It is not skipped for empty incrementals.

If the assertion fails:
- The watermark moved between the pre-fence read and the fenced tx.
- This should be impossible in V1 (single orchestrator), but the check defends against operational misconfiguration.
- The fenced tx rolls back. The pre-run is eventually recovered.

**No terminal manifest evidence may be produced if watermark revalidation fails** (R24).

### 10.2 Domain-Level Atomicity

One domain, one pre-run, one manifest, one transaction, at most one CAS. No partial manifests.

## 11. Identity Manifest Construction

### Source items (step 6)

Inside fenced tx. Trigger #11 enforces role and phase.

### Finalization (steps 8–9)

- `finalize_source`: computes source hash, advances to `source_fetched`.
- `finalize_comparison`: queries destination, derives differences, advances to `confirmed_compared`.

Derived items by SECURITY DEFINER as `amaia_sync_manifest_owner`.

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

Sorted numerically, joined with `|`, SHA-256.

## 13. Provisional Window (Dormant in V1)

V1 never invokes `amaia_sync_finalize_provisional`. DB capability dormant.

**Compatibility assumption:** `complete_manifest` supports direct completion from `confirmed_compared`. If this changes, Runtime V1 must be updated.

## 14. CAS Watermark Advancement

### Contract

When `sets_match=true` AND `source_id_count > 0`:

```sql
SELECT amaia_sync_advance_watermark_cas(:domain, 'id', :expected, :new, :run_id);
```

Inside fenced tx, same transaction as evidence.

### CAS not called

1. Empty incremental (source_id_count = 0): watermark already revalidated by step 4.
2. Discrepancy (sets_match = false): watermark revalidated, discrepancy recorded.

## 15. Abandonment and Recovery

### 15.1 Stale Run Predicate

```
stale_threshold = greatest(lease_expires_at, heartbeat_at + 2 * lease_ttl)
```

Stale when `now() > stale_threshold` AND (credentials mismatch OR lease expired).

**Expired leases alone are sufficient** (R21).

### 15.2 Detection

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running'
AND (r.owner_identity IS DISTINCT FROM l.owner_identity
     OR r.lease_token IS DISTINCT FROM l.lease_token
     OR l.lease_expires_at <= now()
     OR r.owner_identity IS NULL)
AND now() > greatest(l.lease_expires_at, l.heartbeat_at + interval '10 minutes');
```

Note: `r.owner_identity IS NULL` catches pre-runs that were never bound (engine crashed before fenced tx).

### 15.3 Run Without Manifest Recovery

Run `running` with no manifest (bound or unbound) → `orphan_recovered`.

### 15.4 Durable Failure Evidence

The `failed` status requires **durable operational evidence** persisted **outside** any rolled-back transaction.

Examples:
- Unsupported configuration detected and logged to a persistent error record.
- Schema incompatibility recorded in an audit table before the fenced tx was attempted.
- Append-only validation failure detected during pre-flight checks.

**Without durable evidence, recovery always classifies stale runs as `orphan_recovered`.** The `failed` status is reserved for situations where manual intervention is required and the reason is provably recorded.

### 15.5 Recovery on Startup

1. Generate `engine_instance_id`.
2. Acquire scheduler lease.
3. Scan for stale runs (including unbound pre-runs).
4. Abandon manifests where they exist, classify runs.
5. Proceed with normal scheduling.

## 16. Error Handling

### 16.1 Domain Failures

Single domain. Engine catches exception, logs, **continues to next domain**.

| Example | Action |
|---|---|
| Upsert constraint violation | Rollback. Pre-run stays 'running'. Recovery handles. |
| CAS failure | Rollback. Retry next cycle. |
| AMAIA query timeout | Skip domain this cycle. No pre-run created. |
| Domain lease held | Fenced tx aborts immediately. Pre-run stays 'running'. Recovery handles. |
| Watermark revalidation failure | Rollback. Pre-run stays 'running'. Recovery handles. |

### 16.2 Authority Failures

**Abort entire cycle.**

| Example | Action |
|---|---|
| Scheduler lease expired (between domains) | Exit cycle. |
| Supabase connection permanently lost | Exit cycle. |
| AMAIA connection permanently lost | Exit cycle. |

### 16.3 Unsupported Multi-Process Execution

Unsupported for **scheduling correctness**. Domain lease + CAS protect against same-domain corruption.

**Unsupported does not imply unfenced.**

## 17. Retry and Backoff

No domain retry within same cycle. Next cycle retries.

Connection retry: exponential backoff (1s, 30s max, 3 attempts, ±25% jitter).

Cycle: fixed interval (default 60s). No overlap.

## 18. Idempotency

| Operation | Idempotency |
|---|---|
| AMAIA fetch | Safe. Read-only. |
| Destination upsert | Idempotent (ON CONFLICT + hash skip). |
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
| `domain.start` / `domain.skip_unsupported` | info |
| `domain.lock_contention` | info |
| `domain.fetch` / `domain.persist` | info |
| `domain.bind_run` | info |
| `domain.watermark_revalidated` | info |
| `domain.manifest_complete` / `domain.cas_advanced` / `domain.empty` | info |
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
| `amaia_sync_lock_contentions_total` | counter | domain |
| `amaia_sync_rows_fetched` / `_upserted` | counter | domain |
| `amaia_sync_manifests_total` | counter | domain, sets_match |
| `amaia_sync_watermark_position` | gauge | domain |
| `amaia_sync_cycle_duration_seconds` | histogram | — |
| `amaia_sync_domain_duration_seconds` | histogram | domain |
| `amaia_sync_cas_failures_total` | counter | domain |
| `amaia_sync_authority_failures_total` | counter | reason |
| `amaia_sync_discrepancies_total` | counter | domain |
| `amaia_sync_watermark_revalidation_failures_total` | counter | domain |

### Alerts

| Condition | Severity |
|---|---|
| No successful cycle in 10 minutes | High |
| Discrepancy detected | Medium |
| Stale run detected | Medium |
| Authority failure | High |
| AMAIA connection failure >3 cycles | High |
| Watermark revalidation failure | High |

## 21. Security

Service_role key + `SET LOCAL ROLE amaia_sync_runtime` per fenced tx. RLS enforced. SECURITY DEFINER for manifest_owner.

Secrets: environment variables, never logged.

AMAIA: `amaia_sync_reader`, SELECT only, host-restricted.

Network: internal AMAIA (3306), HTTPS Supabase (session pooler). No inbound.

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
| `SYNC_LOG_LEVEL` | No (info) |
| `METRICS_PORT` | No (9090) |

Graceful shutdown: SIGTERM → stop flag → wait for fenced tx → release scheduler lease → close connections → exit.

## 23. Failure Scenarios

| Scenario | Recovery |
|---|---|
| Crash mid-fence | Rollback. Pre-run 'running' with NULL creds. Recovery abandons manifest if exists. |
| Crash after pre-run, before fence | Pre-run 'running' with NULL creds. No manifest. Recovery closes. |
| AMAIA unreachable | Skip domain. No pre-run. |
| Supabase unreachable | Exit cycle. |
| Lease expires mid-fence | CAS rejects. Rollback. |
| Scheduler lease lost mid-domain | Domain completes (R16). Cycle aborts after. |
| Lock contention | Fenced tx aborts. Pre-run recovered. |
| Watermark revalidation fails | Rollback. Pre-run recovered. |
| Backlog > max_window | Progressive catch-up. |
| Append-only violated | Domain excluded immediately. |

## 24. QA Strategy

### Unit tests

- Domain config (skip timestamp, skip mutable, skip unknown).
- Watermark computation (safety lag, max_window).
- Hash (numeric/pipe).
- Pre-run creation with NULL credentials.
- Bind-run-to-lease logic.
- Append-only validation evidence check.

### Integration tests

- Full cycle (2 domains).
- Empty incremental (success, no CAS, watermark revalidated).
- Non-empty incremental.
- Discrepancy → `completed_with_discrepancy`.
- CAS success / failure.
- Hard watermark revalidation failure → rollback.
- Bind-run failure → rollback.
- Recovery: crash → stale pre-run (NULL creds) → orphan_recovered.
- Recovery: run without manifest.
- Lock contention → no run created, event logged.
- Authority failure.
- Domain lease release (success + failure = no corruption).

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
| R5 | **All evidence inside fence.** Source items, upserts, finalization, CAS, terminal run status. Pre-run creation is outside. |
| R6 | **CAS inside same transaction.** All commit or all rollback. |
| R7 | **No watermark advancement without manifest completion.** |
| R8 | **Recovery cannot abandon healthy runs.** |
| R9 | **Empty incrementals never advance watermarks.** |
| R10 | **Multi-process unsupported for scheduling.** Domain fencing still holds. |
| R11 | **V1 supports only id-based domains.** |
| R12 | **No manifest evidence durable before commit.** Pre-run is not manifest evidence. |
| R13 | **V1 never invokes provisional finalization.** |
| R14 | **Domain execution within one lease TTL.** |
| R15 | **Every active V1 domain formally validated as append-only.** |
| R16 | **Domain lease is sole commit authority.** |
| R17 | **All V1 executions bounded** (max_incremental_window). |
| R18 | **Non-empty successful runs imply watermark advancement.** |
| R19 | **V1 supports only append-only domains.** |
| R20 | **Domain lease ownership begins only at fenced tx start.** |
| R21 | **Expired leases alone sufficient for stale classification.** |
| R22 | **Pre-runs never carry lease credentials.** Created with NULL owner_identity and NULL lease_token. |
| R23 | **Manifest processing begins only after successful run-to-lease binding.** |
| R24 | **All execution paths require successful hard watermark revalidation** before any manifest evidence is produced. |
| R25 | **Domain lease release is advisory, not correctness-critical.** |
| R26 | **Domains without append-only evidence are ineligible for Runtime V1.** |

---

## Summary

The AMAIA-SYNC Runtime Engine v1.5 is a single-process, single-threaded Node.js daemon on AMAIASQL that synchronizes **2 append-only id-based domains** (control_llamadas, logestado). Pre-runs are created outside the fenced transaction with NULL lease credentials; the bind-run-to-lease operation inside the fence atomically associates the run with the acquired domain lease. Hard watermark revalidation occurs inside the fence on ALL paths (including empty and discrepancy) before any manifest evidence is produced. Domain lease release after commit is advisory — failure does not invalidate committed work. Lock contention produces operational events, not run records. 26 invariants (R1–R26) declared for hostile audit.

---

READY FOR HOSTILE RE-AUDIT
