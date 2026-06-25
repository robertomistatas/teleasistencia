# AMAIA-SYNC Runtime Engine Architecture v1.2

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.1 (rejected — 3 critical, 3 major, 1 minor corrections)  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-23

---

## Changes from v1.1

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | Timestamp domains vs id-only CAS | V1 scoped to 4 id-based domains. Timestamp domains deferred. |
| C2 | Critical | Source items inserted pre-fence (not atomic with CAS) | All evidence insertion moved inside fenced transaction. AMAIA fetch remains pre-fence (memory only). |
| C3 | Critical | Lease heartbeat inside long transaction impossible | Heartbeat eliminated during domain execution. Domain must complete within one lease TTL. Heartbeat only between domains. |
| M4 | Major | Run lifecycle ambiguity | Formalized: success set inside fenced tx; failure = run stays 'running' until recovery. |
| M5 | Major | Provisional window unnecessary in V1 | Eliminated from runtime. Dormant DB capability. Runtime never invokes finalize_provisional. |
| M6 | Major | Failure taxonomy missing authority failures | Separated domain failures (continue) from authority failures (abort cycle). |
| M7 | Minor | Empty incremental noise | Empty manifests declared as intentional audit artifacts. Metric added. |

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

All V1 domains use **id-based watermarks**. The CAS function `amaia_sync_advance_watermark_cas` supports only `cursor_type='id'`.

Each domain has a registered `amaia_sync_domain_identity_policies` row that declares its identity basis, hash algorithm, and serialization version. The runtime MUST read this policy before creating any manifest.

### 3.1 Deferred Timestamp Domains

| Domain | AMAIA source table | Supabase destination | Watermark type | Status |
|---|---|---|---|---|
| beneficiario | beneficiario | amaia_beneficiaries | timestamp | OUT OF SCOPE V1 |
| red | red | amaia_support_network | timestamp | OUT OF SCOPE V1 |
| alerta | alerta | amaia_alerts | timestamp | OUT OF SCOPE V1 |

These domains require:

- A timestamp-aware CAS function (`amaia_sync_advance_watermark_cas` with `cursor_type='timestamp'`).
- Monotonicity guarantees for timestamps (AMAIA does not provide auto-increment on these tables).
- A timestamp safety-lag model (clock skew, transaction isolation visibility).
- Possibly a hybrid cursor model (timestamp + tiebreaker).

These are non-trivial design problems that will be addressed in a future Phase 9.x. The domain identity policies for these domains exist in the database (seeded in Phase 9.3C) but the runtime will not process them.

**The runtime MUST skip any domain whose watermark_type is not 'id'.** If a domain's watermark row has `watermark_type='timestamp'`, the runtime logs a skip event and moves to the next domain. This is fail-closed: unknown or unsupported watermark types are never processed.

## 4. Scheduler Model

### Single serialized orchestrator

V1 uses a **single engine process** that owns the scheduler lease. There is no multi-worker architecture. The scheduler is responsible for:

1. Acquiring the scheduler lease from `amaia_sync_leases` (entity_name='scheduler').
2. Creating a cycle record in `amaia_sync_cycles`.
3. Iterating through active domains in a deterministic order.
4. For each domain: acquiring the domain lease, creating a run, executing the sync, releasing the domain lease.
5. Completing the cycle.

### Scheduler lease acquisition

```
SELECT * FROM amaia_sync_leases WHERE entity_name='scheduler' FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

If another process holds a non-expired scheduler lease, the engine exits immediately. This is cooperative serialization — not DB-enforced authentication.

### 4.1 Scheduler Lease Heartbeat

The scheduler lease has a fixed TTL (default: 5 minutes). The engine renews it **only between domains**:

1. **Before** starting each domain (pre-domain heartbeat).
2. **After** completing each domain (post-domain heartbeat).

Renewal updates `heartbeat_at = now()` and `lease_expires_at = now() + TTL`.

**There is no heartbeat during domain execution.** The domain lease and scheduler lease are acquired before the fenced transaction begins and remain fixed throughout. The domain must complete within one lease TTL (see Section 7.1).

**Expiry abort rule:** Before starting any new domain, the engine MUST verify that the scheduler lease is still valid (`lease_expires_at > now()`). If the lease has expired, the engine MUST NOT start a new domain. It marks the current cycle as incomplete and exits the cycle loop.

### Cycle creation

After acquiring the scheduler lease:

```
INSERT INTO amaia_sync_cycles (
  trigger_type, owner_identity,
  scheduler_owner_identity, scheduler_lease_token
) VALUES ('scheduled', :engine_identity, :owner_identity, :lease_token);
```

The `scheduler_owner_identity` and `scheduler_lease_token` are immutable (enforced by trigger #10).

## 5. Engine Identity

The engine constructs its identity at boot:

```
engine_instance_id = UUID v4 (generated once at startup)
owner_identity = "engine:{engine_instance_id}:{hostname}:{pid}"
```

This identity is used for:
- Scheduler lease `owner_identity`.
- Domain lease `owner_identity`.
- Run `owner_identity`.
- Healthy-run detection (credentials match = same engine instance).

The `engine_instance_id` prevents PID-reuse collisions across restarts.

## 6. Domain Processing Order

The scheduler iterates active V1 domains in a fixed, deterministic order:

1. control_llamadas
2. logestado
3. enfermedades
4. medicamentos

This order is not architecturally significant in V1 (single-threaded), but is declared for reproducibility and debugging. Deferred domains (beneficiario, red, alerta) are skipped via watermark_type check.

## 7. Domain Lease Acquisition

Before processing any domain, the engine acquires the domain lease:

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token (increment), lease_expires_at, heartbeat_at, acquired_at
```

The domain lease serves as the **early fence** (Protocol Invariant 79). Every write to Supabase domain tables occurs within a transaction that has acquired this lease.

If the domain lease is held by another process (not expired), the engine skips this domain with status `skipped_lock_held` and moves to the next.

### 7.1 Domain Execution Time Constraint

V1 does not heartbeat the domain lease during the fenced transaction. The domain lease is acquired at the start of the fenced transaction and must remain valid through commit.

**Maximum domain execution duration < lease TTL.**

If a domain cannot complete inside one lease TTL, the architecture must be redesigned before production. V1 intentionally prioritizes correctness and simplicity over throughput.

If the lease expires during execution, the CAS will reject the commit (lease validation fails), the transaction aborts, and the next cycle reprocesses the same range.

### Why no heartbeat during the fenced transaction

A PostgreSQL transaction holds all locks acquired within it until COMMIT or ROLLBACK. Heartbeating the domain lease would require a separate connection (the main connection is in-transaction), introducing complexity and a split-brain risk between the lease state and the transaction state. V1 avoids this by constraining domain execution to one TTL window.

## 8. Run Lifecycle

For each domain in each cycle:

```
INSERT INTO amaia_sync_runs (
  job_name, status, cycle_id, domain_name,
  lease_token, owner_identity,
  lower_bound, upper_bound
) VALUES (:domain, 'running', :cycle_id, :domain,
          :lease_token, :owner_identity,
          :lower_bound, :upper_bound);
```

### Run status transitions

```
running → success           (normal completion, inside fenced tx)
running → orphan_recovered  (recovery detected stale run, outside fenced tx)
running → failed            (recovery marks unrecoverable, outside fenced tx)
```

`skipped_lock_held` is set at creation time (not a transition from running).

### 8.1 Run State Persistence

**Success path:** Inside the fenced transaction, after `complete_manifest`, the run status is updated to `success`. Both the manifest completion and the run status change commit atomically.

```
complete_manifest (phase → comparison_complete)
→ UPDATE run SET status='success', finished_at=now()
→ COMMIT
```

**Failure path:** If the fenced transaction rolls back (CAS failure, exception, lease expiry), the run remains in `status='running'`. No `running → failed` transition occurs inside the rolled-back transaction — it would be rolled back too.

The run is subsequently handled by recovery:
- If the engine restarts: recovery detects the stale run and transitions it to `orphan_recovered`.
- If the run's error is unrecoverable: recovery marks it `failed`.

**There is no `running → failed` transition inside a rolled-back transaction.** This is architecturally impossible — a rollback reverts all changes including status updates.

### Lower and upper bounds

- `lower_bound`: the current watermark value (last synced position).
- `upper_bound`: the safe upper bound computed from AMAIA before the fenced transaction.

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
3. **Fetch rows** from AMAIA into memory (batched, see Section 9.2).
4. The fetch happens **before** the Supabase fenced transaction (Invariant R4: fetch before fence).

### 9.1 Pre-Fence Upper Bound Safety Proof

The upper_bound and AMAIA fetch occur **before** the Supabase fenced transaction. This is safe in V1:

1. **Single serialized orchestrator.** The scheduler lease guarantees global exclusivity.
2. **Domain lease exclusivity.** The domain lease prevents concurrent writes.
3. **No multi-worker.** No parallel consumer exists.
4. **CAS revalidation under fence.** The watermark CAS validates `last_id IS NOT DISTINCT FROM expected_cursor`. Any concurrent modification causes CAS failure and full rollback.
5. **Lease expiry invalidates the commit.** If the engine dies between fetch and fence, the watermark is never advanced. The next cycle reprocesses the same range.

**Pre-fence extraction is safe because watermark advancement remains fully fence-protected by CAS.**

### Safety lag

A configurable offset (default: 100) that prevents reading rows that may be part of an uncommitted AMAIA transaction. The safe upper bound is `MAX(id) - safety_lag`. V1 uses only id-based watermarks, so the safety lag is always an integer offset.

### Empty incrementals

If `safe_upper_bound <= lower_bound`, the domain has no new data. The engine:

1. Creates a run with `lower_bound = upper_bound = current watermark`.
2. Creates a manifest with zero source items.
3. Calls `finalize_source` → `source_id_count=0`, `source_id_hash=hash("")`.
4. Calls `finalize_comparison` → `persisted_id_count=0`, `sets_match=true`.
5. **Does NOT call `amaia_sync_advance_watermark_cas`.** The watermark remains unchanged.
6. Calls `complete_manifest` → phase `comparison_complete`.
7. Updates run `status='success'`.

Advancing a watermark without observing new source elements provides no value and increases audit ambiguity. Empty incremental manifests are **intentional audit artifacts**: they prove the engine checked the domain and found nothing new.

### 9.2 Incremental Batch Processing

The runtime fetches AMAIA rows in pages to limit memory consumption:

- **Page size:** 1000 rows (configurable via `SYNC_BATCH_SIZE`, default 1000).
- **Fetch loop:** `SELECT * FROM :source WHERE id > :page_start AND id <= :upper ORDER BY id LIMIT :batch_size`.
- **All pages are fetched into memory before the fenced transaction begins.**

The fetched rows are held in memory. No Supabase writes occur during the AMAIA fetch phase. The fenced transaction (Section 10) processes all rows atomically.

## 10. Fenced Transaction

The fenced transaction is the core atomic unit of the sync engine. **All Supabase writes for a domain occur inside this single transaction.**

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
11. Update run status='success'
12. COMMIT
```

If any step fails, the entire transaction rolls back. **No manifest evidence is durable until the fenced transaction commits.**

### Why source items are inside the fence

v1.1 had source items inserted pre-fence, which created a contradiction: source items could be durable without the corresponding manifest evidence (CAS, comparison hash) being durable. In v1.2, all evidence — source items, destination upserts, manifest finalization, CAS, run status — commits atomically.

### 10.1 Domain-Level Atomicity Guarantee

Each domain execution within a cycle produces **exactly one manifest** and **at most one CAS attempt**.

There are no:
- Partial manifests.
- Partial CAS.
- Per-batch CAS.
- Per-batch manifests.

One domain, one run, one manifest, one transaction, one CAS.

## 11. Identity Manifest Construction

### Source items

Inside the fenced transaction (step 5), for each fetched AMAIA row:

```sql
INSERT INTO amaia_sync_manifest_identity_items
  (manifest_id, item_role, source_amaia_id, identity_basis)
VALUES (:manifest_id, 'source', :amaia_id, 'source_amaia_id');
```

For dedup domains:

```sql
INSERT INTO amaia_sync_manifest_identity_items
  (manifest_id, item_role, identity_basis, canonical_key,
   beneficiary_amaia_id, canonical_hash, canonical_hash_version)
VALUES (:manifest_id, 'source', 'canonical_dedup_key', :canonical_key,
        :beneficiary_amaia_id, :hash, :hash_version);
```

Source items are inserted at `phase=created`. Trigger #11 enforces role and phase constraints.

### Finalization

Inside the fenced transaction (steps 7–8):

- `finalize_source`: locks lease → run → manifest, computes source hash, advances to `source_fetched`.
- `finalize_comparison`: queries destination, derives missing/extra/excluded, advances to `confirmed_compared`.

All derived items (persisted, missing, extra, excluded) are inserted by SECURITY DEFINER functions as `amaia_sync_manifest_owner`. The runtime cannot insert these directly.

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
extra: not computed in incremental (reconciliation handles universe-level extras)
sets_match = (|missing| = 0)
```

### Hash verification

- `source_amaia_id` basis: elements sorted numerically, joined with `|`, SHA-256.
- `canonical_dedup_key` basis: elements sorted lexicographically, joined with `:`, SHA-256.

## 13. Provisional Window (Dormant in V1)

### V1 decision

V1 Runtime **never invokes `amaia_sync_finalize_provisional`**.

The provisional finalization protocol is implemented in the database (Phase 9.3C) as a dormant capability. The runtime transitions directly from `confirmed_compared` to `comparison_complete` via `complete_manifest`.

### Justification

V1's single serialized orchestrator with safety lag eliminates the conditions that make provisional windows necessary:

- **Single writer:** No concurrent process can insert rows into the destination between the engine's fetch and its comparison.
- **Safety lag:** The upper bound is set below AMAIA's MAX(id), reducing the probability of new rows appearing in the sync range during processing to near zero.
- **Short execution window:** Domain execution completes within one lease TTL (Section 7.1), limiting the time window for AMAIA insertions.

### Future activation

Provisional finalization is reserved for future high-throughput runtime versions that may use reduced safety lags, parallel workers, or streaming extraction. The database functions and manifest columns remain deployed and tested.

## 14. CAS Watermark Advancement

### Contract

When `sets_match=true` AND `source_id_count > 0`, the runtime calls:

```sql
SELECT amaia_sync_advance_watermark_cas(
  :domain, 'id', :expected_cursor, :new_cursor, :run_id
);
```

Inside the fenced transaction (step 9), in the same transaction as manifest evidence and phase advancement.

### CAS validation (inside the function)

- `p_type = 'id'` (V1 only).
- `p_new_cursor > p_expected_cursor` (monotonic).
- `p_new_cursor = run.upper_bound` (confirmed sync range).
- Lease valid: `owner_identity` match, `lease_expires_at > now()`.
- Run valid: `status = 'running'`, `domain_name` match.
- Exactly 1 row affected.

### CAS failure

Raises exception → full transaction rollback → no evidence durable, no watermark advance, run stays `running`. Next cycle retries.

### When CAS is not called

1. **Empty incremental** (`source_id_count = 0`): no CAS (Invariant R9).
2. **Discrepancy detected** (`sets_match = false`): no CAS. Manifest completes recording the failure. Next cycle retries same range.

## 15. Abandonment and Recovery

### Stale threshold formula

```
stale_threshold = greatest(
    lease_expires_at,
    heartbeat_at + (2 * lease_ttl)
)
```

A run is considered **stale** when `now() > stale_threshold` AND the run's credentials do not match the current domain lease. The 2x TTL buffer prevents abandoning slow-but-alive engines.

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

```sql
SELECT amaia_sync_abandon_manifest(:manifest_id, :abandoned_by, :reason);
```

Lock order: domain_lease → run → manifest (Invariant 84).

### Healthy run protection

A running run whose `(owner_identity, lease_token)` match the current domain lease AND whose lease has not expired cannot be abandoned (Protocol Invariant 86).

### Recovery on startup

1. Generate `engine_instance_id`.
2. Attempt scheduler lease acquisition.
3. Scan for stale runs from previous engine instances.
4. Abandon their manifests, mark runs `orphan_recovered`.
5. Proceed with normal scheduling.

## 16. Error Handling

### 16.1 Domain Failures

Domain failures affect a single domain. The engine catches the exception, logs the error, and **continues to the next domain**.

| Example | Action |
|---|---|
| Schema mismatch (missing column) | Log error. Run stays 'running'. Recovery handles later. |
| Data anomaly (NULL in required field) | Record in workset_exceptions. Continue sync if possible. |
| Upsert failure (constraint violation) | Transaction rolls back. Run stays 'running'. |
| CAS failure (wrong cursor) | Transaction rolls back. Run stays 'running'. Retry next cycle. |
| Destination table locked | Transaction rolls back. Retry next cycle. |

### 16.2 Authority Failures

Authority failures indicate the engine has lost its right to operate. The engine **aborts the entire cycle immediately**.

| Example | Action |
|---|---|
| Scheduler lease expired | Stop processing. Do not start next domain. Exit cycle. |
| Scheduler lease lost (another process acquired it) | Stop processing. Exit cycle. |
| Scheduler credentials invalid | Stop processing. Exit cycle. |
| Supabase connection permanently lost | Stop processing. Exit cycle. Retry on next scheduler tick. |
| AMAIA connection permanently lost | Stop processing. Exit cycle. Retry on next scheduler tick. |

Authority failures are checked **before each domain** (scheduler lease validity). If detected mid-domain, the fenced transaction will fail on CAS/lease validation and roll back naturally.

## 17. Retry and Backoff

### Domain-level retry

No retry within the same cycle. The next cycle retries the domain with the same watermark.

### Connection-level retry

```
Base delay: 1 second
Max delay: 30 seconds
Max attempts: 3
Jitter: ±25%
```

### Cycle scheduling

Fixed interval (default: 60 seconds). No overlap — scheduler lease prevents concurrent cycles.

## 18. Idempotency Guarantees

| Operation | Idempotency |
|---|---|
| AMAIA fetch | Safe to repeat. Read-only. |
| Destination upsert | Idempotent via ON CONFLICT + hash-based skip. |
| Source item insertion | Idempotent via partial unique index. |
| Manifest creation | NOT idempotent. New cycle = new run = new manifest. |
| Finalization functions | NOT idempotent. Phase advancement is one-way. |
| CAS | Idempotent in effect: double-advance impossible. |

## 19. Concurrency Model

### V1: Single serialized orchestrator

- One engine process per deployment.
- One connection to AMAIA (read).
- One connection to Supabase (read/write).
- No parallelism.
- Scheduler lease ensures at most one engine.

### Why single-threaded

- Simplicity: no deadlock, no contention.
- Correctness: protocol designed for single orchestrator.
- Sufficiency: 4 id-based domains complete in seconds to low minutes.

## 20. Observability

### Structured logging

```json
{
  "ts": "ISO8601",
  "level": "info|warn|error",
  "engine_instance_id": "uuid",
  "cycle_id": "uuid",
  "domain": "string",
  "run_id": "uuid",
  "manifest_id": "uuid",
  "event": "string",
  "detail": {}
}
```

### Key log events

| Event | Level | When |
|---|---|---|
| `engine.start` | info | Boot |
| `scheduler.lease_acquired` | info | Lease obtained |
| `scheduler.lease_held` | warn | Another process holds lease |
| `cycle.start` | info | Cycle begins |
| `domain.start` | info | Domain processing begins |
| `domain.skip_timestamp` | info | Timestamp domain skipped (V1) |
| `domain.skip_lock_held` | info | Domain lease held by another |
| `domain.fetch` | info | AMAIA fetch complete |
| `domain.persist` | info | Upsert complete |
| `domain.manifest_complete` | info | Manifest finalized |
| `domain.cas_advanced` | info | Watermark advanced |
| `domain.empty` | info | Empty incremental |
| `domain.mismatch` | warn | sets_match=false |
| `domain.error` | error | Domain failed |
| `cycle.complete` | info | Cycle complete |
| `authority.lease_expired` | error | Scheduler lease expired, cycle aborted |
| `recovery.stale_run` | warn | Stale run detected |
| `recovery.abandoned` | warn | Manifest abandoned |

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

### Alerts

| Condition | Severity |
|---|---|
| No successful cycle in 10 minutes | High |
| sets_match=false for any domain | Medium |
| Stale run detected | Medium |
| Authority failure | High |
| AMAIA connection failure >3 cycles | High |

## 21. Security

### Runtime role

The engine connects to Supabase via service_role key but operates under `amaia_sync_runtime` via `SET LOCAL ROLE` at the start of each fenced transaction. RLS policies enforce:

- Runtime can INSERT manifests and source items.
- Runtime cannot UPDATE manifests or INSERT derived items.
- SECURITY DEFINER functions execute as `amaia_sync_manifest_owner`.

### Secrets

```
SUPABASE_SERVICE_KEY: environment variable, never logged.
AMAIA_MYSQL_PASSWORD: environment variable, never logged.
```

### AMAIA MySQL

```
User: amaia_sync_reader
Privileges: SELECT only
Host restriction: AMAIASQL VM IP only
```

### Network

```
AMAIASQL → AMAIA MySQL: internal, port 3306
AMAIASQL → Supabase: HTTPS, session pooler
No inbound connections required.
```

## 22. Deployment Model

### Target

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
| `AMAIA_MYSQL_PORT` | MySQL port (default 3306) | No |
| `AMAIA_MYSQL_USER` | MySQL user | Yes |
| `AMAIA_MYSQL_PASSWORD` | MySQL password | Yes |
| `AMAIA_MYSQL_DATABASE` | Database name | Yes |
| `SYNC_CYCLE_INTERVAL_MS` | Cycle interval (default 60000) | No |
| `SYNC_SAFETY_LAG_ID` | ID safety lag (default 100) | No |
| `SYNC_LEASE_TTL_SECONDS` | Lease TTL (default 300) | No |
| `SYNC_BATCH_SIZE` | Rows per AMAIA page (default 1000) | No |
| `SYNC_LOG_LEVEL` | Log level (default info) | No |
| `METRICS_PORT` | Prometheus port (default 9090) | No |

### Scheduling

Continuous daemon with internal loop. No external cron. Scheduler lease prevents overlap.

### Graceful shutdown

On SIGTERM/SIGINT:
1. Set `running = false`.
2. Wait for current fenced transaction to complete (with timeout).
3. Release scheduler lease.
4. Close connections.
5. Exit.

## 23. Failure Scenarios

| Scenario | Impact | Recovery |
|---|---|---|
| Engine crash mid-domain | Run stays 'running', manifest non-terminal | Recovery abandons manifest, marks run orphan_recovered |
| AMAIA unreachable | No data fetched | Empty cycles. Watermarks unchanged. |
| Supabase unreachable | Transaction cannot start | Retry next cycle. No partial state. |
| Lease expires during fenced tx | CAS rejects (lease invalid) | Full rollback. Next cycle reprocesses. |
| Concurrent engine started | Second engine fails scheduler lease | Logs warning, exits. |
| Schema drift | Upsert fails | Run stays 'running'. Manual fix required. |
| Disk full on AMAIASQL | Engine may crash | Recovery on restart. Supabase consistent. |

## 24. QA Strategy for Phase 9.4

### Unit tests

- Domain configuration loading (skip timestamp domains).
- Watermark computation (id-based safety lag).
- Identity hashing (numeric sort with pipe, canonical sort with colon).
- AMAIA query builder (id-based domains only).
- Upsert query builder.

### Integration tests

- Full cycle against local MySQL + local Supabase.
- Empty incremental (no CAS called).
- Non-empty incremental with known data.
- Discrepancy detection.
- CAS success and failure.
- Lease acquisition.
- Recovery: crash simulation → stale run → abandon → retry.
- Authority failure: scheduler lease expiry mid-cycle.
- Timestamp domain skipped.

### End-to-end tests

- Deploy on AMAIASQL.
- Insert rows into AMAIA id-based tables.
- Run one cycle.
- Verify destinations, manifests, watermarks.
- Introduce discrepancy → verify sets_match=false.

## 25. Explicit Non-Goals

| Non-goal | Reason |
|---|---|
| Timestamp domain sync | V1 supports only id-based CAS. Deferred to future phase. |
| Multi-worker parallelism | V1 is single-threaded. Multi-process unsupported. |
| Bidirectional sync | AMAIA is read-only. |
| Real-time streaming | Incremental polling sufficient for SLA. |
| Provisional finalization | Dormant DB capability. V1 runtime skips provisional. |
| Schema migration of AMAIA | Engine reads only. |
| UI integration | Headless daemon. |
| SOS Mujer | Excluded from this application. |
| Reconciliation engine | Phase 9.5 scope. |
| Alert remediation execution | Separate process. Engine populates queue. |

## 26. Architectural Invariants

| # | Invariant |
|---|---|
| R1 | **Single scheduler.** At most one engine holds the scheduler lease. Cooperative serialization. |
| R2 | **Single worker.** One thread, one process. No parallelism in V1. |
| R3 | **AMAIA readonly.** SELECT only. No writes, no procedures, no temp tables. |
| R4 | **Fetch before fence.** AMAIA extraction occurs before the fenced transaction. Data held in memory. |
| R5 | **All evidence inside fence.** Source items, destination upserts, manifest finalization, CAS, and run status commit atomically in one transaction. No manifest evidence is durable before commit. |
| R6 | **CAS inside same transaction.** Watermark CAS in the same transaction as evidence. All commit or all rollback. |
| R7 | **No watermark advancement without manifest completion.** Failed manifests never advance watermarks. |
| R8 | **Recovery cannot abandon healthy runs.** Credentials match + lease valid = healthy. |
| R9 | **Empty incrementals never advance watermarks.** Zero source items → no CAS. |
| R10 | **Multi-process unsupported in V1.** Operational misconfiguration. Not defended by DB. |
| R11 | **V1 supports only id-based domains.** Timestamp domains are skipped. Unknown watermark types are rejected. |
| R12 | **No manifest evidence durable before commit.** Source items, derived items, phase changes — all inside the fenced transaction. |
| R13 | **V1 never invokes provisional finalization.** The DB capability is dormant. Runtime transitions directly to comparison_complete. |
| R14 | **Domain execution within one lease TTL.** No heartbeat during fenced transaction. Lease expiry aborts via CAS rejection. |

---

## Summary

The AMAIA-SYNC Runtime Engine v1.2 is a single-process, single-threaded Node.js daemon on AMAIASQL that synchronizes 4 id-based domains (control_llamadas, logestado, enfermedades, medicamentos) from AMAIA MySQL to Supabase. Timestamp domains are deferred. AMAIA data is fetched in batches into memory before the fenced transaction. All Supabase writes — source items, destination upserts, manifest finalization, CAS, run status — commit atomically in one transaction. There is no heartbeat during the fenced transaction; domains must complete within one lease TTL. Provisional finalization is dormant. Failures are classified as domain-level (continue) or authority-level (abort cycle). 14 architectural invariants (R1–R14) are declared for hostile audit.

---

READY FOR HOSTILE RE-AUDIT
