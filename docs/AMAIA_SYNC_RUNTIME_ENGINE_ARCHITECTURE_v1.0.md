# AMAIA-SYNC Runtime Engine Architecture v1.0

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile audit  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-23

---

## 1. Problem Statement

Mistatas operates a teleasistencia platform for elderly care. The operational source of truth for beneficiary data, support networks, alerts, call logs, and health context is AMAIA — a legacy MySQL database hosted on VM AMAIASQL. Mistatas' modern platform runs on Supabase (PostgreSQL). The two systems must stay synchronized so that the Supabase platform can provide real-time dashboards, SLA monitoring, institutional reporting, and operational workflows based on current AMAIA data.

AMAIA is **read-only** from the sync engine's perspective. No writes, no schema changes, no stored procedures. The sync engine extracts data from AMAIA and persists it into Supabase destination tables, maintaining cryptographic evidence of what was synced, what diverged, and what was excluded.

## 2. Functional Objective

The Runtime Engine is a single-process, single-threaded synchronization daemon that:

1. Periodically fetches incremental changes from AMAIA MySQL.
2. Persists them into Supabase destination tables.
3. Constructs identity manifests proving what was fetched and what was persisted.
4. Compares source vs destination sets with cryptographic hashes.
5. Advances watermarks atomically via CAS.
6. Handles provisional windows for high-velocity domains.
7. Detects and records discrepancies (missing, extra, excluded).
8. Recovers from failures without data loss or silent corruption.

## 3. Syncable Domains

| Domain | AMAIA source table | Supabase destination | Identity basis | Watermark type |
|---|---|---|---|---|
| beneficiario | beneficiario | amaia_beneficiaries | source_amaia_id | timestamp |
| red | red | amaia_support_network | source_amaia_id | timestamp |
| control_llamadas | control_llamadas | amaia_call_logs | source_amaia_id | id |
| logestado | logestado | amaia_alert_logs | source_amaia_id | id |
| alerta | alerta | amaia_alerts | source_amaia_id | timestamp |
| enfermedades | beneficiario_enfermedad | amaia_health_conditions | canonical_dedup_key | id |
| medicamentos | beneficiario_medicamento | amaia_medications | canonical_dedup_key | id |

Each domain has a registered `amaia_sync_domain_identity_policies` row that declares its identity basis, hash algorithm, and serialization version. The runtime MUST read this policy before creating any manifest.

## 4. Scheduler Model

### Single serialized orchestrator

V1 uses a **single engine process** that owns the scheduler lease. There is no multi-worker architecture. The scheduler is responsible for:

1. Acquiring the scheduler lease from `amaia_sync_leases` (entity_name='scheduler').
2. Creating a cycle record in `amaia_sync_cycles`.
3. Iterating through domains in a deterministic order.
4. For each domain: acquiring the domain lease, creating a run, executing the sync, releasing the domain lease.
5. Completing the cycle.

### Scheduler lease acquisition

```
SELECT * FROM amaia_sync_leases WHERE entity_name='scheduler' FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token, lease_expires_at, heartbeat_at, acquired_at
```

If another process holds a non-expired scheduler lease, the engine exits immediately. This is cooperative serialization — not DB-enforced authentication.

### Cycle creation

After acquiring the scheduler lease:

```
INSERT INTO amaia_sync_cycles (
  trigger_type, owner_identity,
  scheduler_owner_identity, scheduler_lease_token
) VALUES ('scheduled', :engine_identity, :owner_identity, :lease_token);
```

The `scheduler_owner_identity` and `scheduler_lease_token` are immutable (enforced by trigger #10). They tie the cycle to the scheduler lease state at creation time.

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

The scheduler iterates domains in a fixed, deterministic order:

1. beneficiario
2. red
3. control_llamadas
4. logestado
5. alerta
6. enfermedades
7. medicamentos

This order is not architecturally significant in V1 (single-threaded), but is declared for reproducibility and debugging.

## 7. Domain Lease Acquisition

Before processing any domain, the engine acquires the domain lease:

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate: owner_identity IS NULL OR lease_expires_at <= now()
-- UPDATE: owner_identity, lease_token (increment), lease_expires_at, heartbeat_at, acquired_at
```

The domain lease serves as the **early fence** (Protocol Invariant 79). Every write to Supabase domain tables occurs within a transaction that has acquired this lease.

If the domain lease is held by another process (not expired), the engine skips this domain with status `skipped_lock_held` and moves to the next.

### Lease heartbeat

While processing a domain, the engine periodically updates `heartbeat_at` and extends `lease_expires_at`. The heartbeat interval MUST be shorter than the lease TTL to prevent expiration during normal processing.

```
Recommended: lease TTL = 5 minutes, heartbeat interval = 60 seconds.
```

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
running → success       (normal completion)
running → failed        (unrecoverable error in this run)
running → orphan_recovered  (recovery process detected stale run)
```

`skipped_lock_held` is set at creation time (not a transition from running).

### Lower and upper bounds

- `lower_bound`: the current watermark value (last synced position).
- `upper_bound`: the safe upper bound computed from AMAIA before acquiring the domain lease.

The engine reads the watermark **before** the fenced transaction to determine the range. Inside the fenced transaction, it revalidates the watermark via CAS.

## 9. Extraction from AMAIA

### Connection

The engine connects to AMAIA MySQL via a read-only connection:

```
Host: AMAIASQL (internal network)
User: amaia_sync_reader (SELECT only)
Database: amaia
Connection pool: 1 connection (single-threaded)
```

### Fetch protocol

1. **Read watermark** from Supabase: `SELECT last_id, last_timestamp FROM amaia_sync_watermarks WHERE entity_name=:domain`.
2. **Compute safe upper bound** from AMAIA: `SELECT MAX(id) - :safety_lag FROM :source_table` (for id-based) or equivalent for timestamp-based.
3. **Fetch rows** from AMAIA: `SELECT * FROM :source_table WHERE id > :lower AND id <= :upper ORDER BY id` (for id-based).
4. The fetch happens **before** the Supabase fenced transaction (Invariant 82: fetch before fence).

### Safety lag

A configurable offset (default: 100 for id-based, 30 seconds for timestamp-based) that prevents reading rows that may be part of an uncommitted AMAIA transaction. The safe upper bound is `MAX(cursor) - safety_lag`.

### Empty incrementals

If `safe_upper_bound <= lower_bound`, the domain has no new data. The engine creates a run with empty bounds, creates a manifest with zero source items, finalizes it (source_id_count=0, sets_match=true), and completes it. This is a valid empty incremental (Protocol v1.6.4 M1).

## 10. Persistence into Supabase

### Upsert strategy

For each fetched row from AMAIA, the engine performs an upsert into the Supabase destination table:

```sql
INSERT INTO :destination (amaia_id, ..., synced_at)
VALUES (:amaia_id, ..., now())
ON CONFLICT (amaia_id) DO UPDATE SET ..., synced_at = now()
WHERE :destination.hash IS DISTINCT FROM EXCLUDED.hash;
```

The `ON CONFLICT ... WHERE hash IS DISTINCT FROM` ensures idempotency: re-syncing the same unchanged row is a no-op.

### Transaction boundary

The upsert of destination rows happens **inside** the fenced transaction (after domain lease FOR UPDATE), but **before** manifest finalization. The sequence within one fenced transaction is:

1. Lock domain lease FOR UPDATE.
2. Revalidate watermark (read current value under lock).
3. Upsert destination rows.
4. Call `amaia_sync_finalize_source` (if source items were inserted beforehand).
5. Call `amaia_sync_finalize_comparison`.
6. If sets_match=true: call `amaia_sync_advance_watermark_cas`.
7. Call `amaia_sync_complete_manifest`.
8. COMMIT.

If any step fails, the entire transaction rolls back (Invariant 91).

## 11. Identity Manifest Construction

### Source items

Before the fenced transaction, as each AMAIA row is fetched, the engine inserts source identity items:

```sql
INSERT INTO amaia_sync_manifest_identity_items
  (manifest_id, item_role, source_amaia_id, identity_basis)
VALUES (:manifest_id, 'source', :amaia_id, 'source_amaia_id');
```

For dedup domains, the engine computes the canonical key and inserts:

```sql
INSERT INTO amaia_sync_manifest_identity_items
  (manifest_id, item_role, identity_basis, canonical_key,
   beneficiary_amaia_id, canonical_hash, canonical_hash_version)
VALUES (:manifest_id, 'source', 'canonical_dedup_key', :canonical_key,
        :beneficiary_amaia_id, :hash, :hash_version);
```

Source items are inserted **at phase=created** by the runtime role. Trigger #11 enforces that only source items can be inserted at this phase, and only by the runtime (or any non-manifest_owner caller).

### Finalization

The runtime calls `amaia_sync_finalize_source(manifest_id, run_id)` which:
- Locks lease → run → manifest (canonical order).
- Computes source_id_count and source_id_hash from the source items.
- Advances phase to `source_fetched`.

Then calls `amaia_sync_finalize_comparison(manifest_id, run_id)` which:
- Queries the real destination table for the persisted set (P_check).
- Derives missing (S\P) and extra (P\S) sets.
- Processes exclusions (lock subjects in total order, validate current investigation, insert excluded items, record consumptions).
- Computes persisted_id_count, persisted_id_hash, sets_match.
- Advances phase to `confirmed_compared`.

All derived items (persisted, missing, extra, excluded) are inserted by the finalizer functions running as `amaia_sync_manifest_owner` via SECURITY DEFINER. The runtime cannot insert these directly (trigger #11 + RLS enforce this).

## 12. Source vs Persisted Comparison

### Non-dedup domains

```
S_raw = {source_amaia_id for each source item}
P_check = {amaia_id from destination WHERE amaia_id > lower AND amaia_id <= upper}
missing = S_raw \ P_check
extra = P_check \ S_raw
sets_match = (|missing| = 0) AND (|extra| - |excluded| = 0)
```

### Dedup domains

```
S_raw = {canonical_key for each source item}
P_check = {canonical_key from destination WHERE key IN S_raw}
missing = S_raw \ P_check
extra: not computed in incremental (reconciliation handles universe-level extras)
sets_match = (|missing| = 0)
```

### Hash verification

Both source and persisted sets are hashed:
- `source_amaia_id` basis: elements sorted numerically, joined with `|`, SHA-256.
- `canonical_dedup_key` basis: elements sorted lexicographically, joined with `:`, SHA-256.

The hash is **set-identity verification**: it proves that the fetched set and the persisted set contain the same elements.

## 13. Provisional Window Handling

### When it applies

High-velocity id-based domains (logestado, control_llamadas) may have rows inserted in AMAIA between the engine's `safe_upper_bound` computation and the actual fetch. The provisional window covers the range `(confirmed_upper_bound, provisional_upper_bound]`.

### Protocol

1. After `finalize_comparison`, the engine checks if `raw_max_id > upper_bound`.
2. If yes: call `amaia_sync_finalize_provisional(manifest_id, run_id, provisional_upper_bound)`.
3. The finalizer queries the real destination for the provisional zone, computes count/hash independently, sets `provisional_verified=true`.
4. Phase advances to `provisional_persisted`.
5. Then `complete_manifest` can proceed (Invariant 90: verified gate).

### When it does not apply

If `raw_max_id <= upper_bound` or no provisional zone exists, the engine calls `complete_manifest` directly from `confirmed_compared`. The function sets `provisional_skipped=true` if `raw_max_id > upper_bound` and no provisional was processed.

## 14. CAS Watermark Advancement

### Contract

When `sets_match=true`, the runtime MUST call:

```sql
SELECT amaia_sync_advance_watermark_cas(
  :domain, 'id', :expected_cursor, :new_cursor, :run_id
);
```

Within the **same transaction** as `finalize_comparison` and `complete_manifest` (Invariant 91).

### CAS validation (inside the function)

- `p_new_cursor > p_expected_cursor` (monotonic).
- `p_new_cursor = run.upper_bound` (confirmed sync range).
- `p_type = 'id'` (V1 only supports id-based CAS).
- Lease valid: `owner_identity` match, `lease_expires_at > now()`.
- Run valid: `status = 'running'`, `domain_name` match.
- Exactly 1 row affected.

### CAS failure

If the CAS fails (wrong cursor, expired lease, etc.), it raises an exception. Because this happens inside the fenced transaction, PostgreSQL rolls back everything: manifest evidence, phase advancement, exclusion consumptions, and destination upserts. The watermark does not advance. The next cycle retries the same range.

### When CAS is not called

If `sets_match=false` (discrepancies detected), the watermark is NOT advanced. The manifest is still completed (recording the failure), but the next cycle will retry the same range. This is by design: the engine does not advance past unresolved discrepancies.

## 15. Abandonment and Recovery

### When abandonment occurs

A separate recovery process (or the engine itself on startup) scans for stale runs:

```sql
SELECT r.* FROM amaia_sync_runs r
JOIN amaia_sync_leases l ON l.entity_name = r.domain_name
WHERE r.status = 'running'
AND (r.owner_identity IS DISTINCT FROM l.owner_identity
     OR r.lease_token IS DISTINCT FROM l.lease_token
     OR l.lease_expires_at <= now());
```

### Abandon protocol

For each stale run with a non-terminal manifest:

```sql
SELECT amaia_sync_abandon_manifest(:manifest_id, :abandoned_by, :reason);
```

Lock order: domain_lease → run → manifest (Invariant 84).

`abandoned_by` is operational evidence from the `amaia_sync_recovery_runtime` trust boundary (Invariant 92). It is not independently authenticated by the schema.

### Healthy run protection

A running run whose `(owner_identity, lease_token)` match the current domain lease AND whose lease has not expired cannot be abandoned (Invariant 86). This prevents a recovery process from abandoning an active engine's in-progress work.

### Recovery on startup

When the engine starts:

1. Generate `engine_instance_id`.
2. Attempt scheduler lease acquisition.
3. Scan for stale runs from previous engine instances.
4. Abandon their manifests.
5. Mark runs as `orphan_recovered`.
6. Proceed with normal cycle scheduling.

## 16. Error Handling

### Error classification

| Category | Example | Action |
|---|---|---|
| Transient AMAIA | Connection timeout, query timeout | Retry with backoff. Log. Continue to next domain. |
| Transient Supabase | Connection reset, lock timeout | Retry with backoff. Transaction rolls back automatically. |
| CAS failure | Wrong cursor (concurrent modification) | Transaction rolls back. Log warning. Retry next cycle. |
| Lease expired during processing | Heartbeat failed | Transaction rolls back. Engine re-acquires lease or skips domain. |
| Schema mismatch | Missing column in destination | Fail run. Log error. Do not retry (requires manual intervention). |
| AMAIA data anomaly | NULL in required field, orphan FK | Record in workset_exceptions. Continue sync. |

### Per-domain isolation

A failure in one domain does NOT prevent processing of other domains. The engine catches exceptions at the domain level, marks the run as failed, releases the domain lease, and proceeds to the next domain.

### Cycle-level failure

If the scheduler lease expires during a cycle (all heartbeats failed), the engine stops processing. The next startup recovers stale runs.

## 17. Retry and Backoff

### Domain-level retry

The engine does NOT retry a failed domain within the same cycle. It moves to the next domain. The next cycle will retry the failed domain with the same watermark (since it was not advanced).

### Connection-level retry

AMAIA and Supabase connections use exponential backoff with jitter:

```
Base delay: 1 second
Max delay: 30 seconds
Max attempts: 3
Jitter: ±25%
```

### Cycle-level scheduling

The scheduler runs on a fixed interval (configurable, default: 60 seconds). If a cycle takes longer than the interval, the next cycle starts immediately after the current one completes. There is no overlap — the scheduler lease prevents concurrent cycles.

## 18. Idempotency Guarantees

| Operation | Idempotency |
|---|---|
| AMAIA fetch | Safe to repeat. Read-only. |
| Destination upsert | Idempotent via ON CONFLICT. Hash-based skip for unchanged rows. |
| Source item insertion | Idempotent via partial unique index on (manifest_id, source_amaia_id). |
| Manifest creation | NOT idempotent (creates new manifest). But manifests are scoped to runs, and runs are scoped to cycles. A retry creates a new cycle. |
| Finalization functions | NOT idempotent (phase advancement is one-way). A retry after failure creates a new run/manifest. |
| CAS | Idempotent in effect: if already advanced, the CAS fails and the transaction rolls back. No double-advance. |

### Re-run safety

If a cycle fails mid-domain, the next cycle starts fresh:
- Same watermark (not advanced).
- New run, new manifest.
- Destination upserts are idempotent.
- The failed run's manifest remains at whatever phase it reached (or is abandoned by recovery).

## 19. Concurrency Model

### V1: Single serialized orchestrator

- One engine process per deployment.
- One database connection to AMAIA (read).
- One database connection to Supabase (read/write).
- No parallelism within a cycle.
- No parallelism across domains.
- The scheduler lease ensures at most one engine operates at a time.

### Why single-threaded

- Simplicity: no deadlock risk between domains, no lock contention analysis needed.
- Auditability: deterministic execution order, single-threaded logs.
- Correctness: the manifest finalization protocol was designed for a single serialized orchestrator (Protocol v1.6.4 Section 4).
- Sufficiency: 7 domains with incremental sync do not require parallelism. A full cycle completes in seconds to low minutes.

### Multi-worker (V2, not in scope)

If future requirements demand parallelism, V2 would use per-domain workers with domain lease isolation. This is declared as an unsupported operational misconfiguration in V1 (Protocol v1.6.4 Section 4).

## 20. Observability

### Structured logging

All log entries are structured JSON with fields:

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
| `domain.fetch` | info | AMAIA fetch complete (row count, range) |
| `domain.persist` | info | Upsert complete (inserted, updated, unchanged) |
| `domain.manifest_complete` | info | Manifest finalized (sets_match, counts) |
| `domain.cas_advanced` | info | Watermark advanced |
| `domain.skip` | info | Domain skipped (lock held) |
| `domain.empty` | info | Empty incremental |
| `domain.mismatch` | warn | sets_match=false (discrepancies) |
| `domain.error` | error | Domain failed |
| `cycle.complete` | info | Cycle complete (summary) |
| `recovery.stale_run` | warn | Stale run detected |
| `recovery.abandoned` | warn | Manifest abandoned |

### Metrics

Exposed via a lightweight HTTP endpoint (`:9090/metrics`, Prometheus format):

| Metric | Type | Labels |
|---|---|---|
| `amaia_sync_cycles_total` | counter | status |
| `amaia_sync_runs_total` | counter | domain, status |
| `amaia_sync_rows_fetched` | counter | domain |
| `amaia_sync_rows_upserted` | counter | domain |
| `amaia_sync_manifests_total` | counter | domain, sets_match |
| `amaia_sync_watermark_position` | gauge | domain |
| `amaia_sync_cycle_duration_seconds` | histogram | — |
| `amaia_sync_domain_duration_seconds` | histogram | domain |
| `amaia_sync_cas_failures_total` | counter | domain |
| `amaia_sync_lease_heartbeat_age_seconds` | gauge | entity |

### Alerts (recommended)

| Condition | Severity | Action |
|---|---|---|
| No successful cycle in 10 minutes | High | Page oncall |
| sets_match=false for any domain | Medium | Investigate discrepancy |
| Stale run detected (>2 lease TTLs old) | Medium | Check engine health |
| CAS failure rate > 0 sustained | Medium | Check for concurrent access |
| AMAIA connection failure sustained >3 cycles | High | Check AMAIASQL VM |

### Audit trail

All sync activity is recorded in database tables:
- `amaia_sync_cycles`: every scheduling cycle.
- `amaia_sync_runs`: every domain run with timing, counts, status.
- `amaia_sync_run_manifests`: cryptographic evidence of every comparison.
- `amaia_sync_manifest_identity_items`: per-item evidence.
- `amaia_sync_watermarks`: cursor position history (via `updated_at`).

## 21. Security

### Runtime role

The engine connects to Supabase as a service_role key holder but operates under `amaia_sync_runtime` via `SET LOCAL ROLE` at the start of each transaction. This ensures:

- RLS policies are enforced for the runtime role.
- The runtime cannot UPDATE manifests (no grant, no RLS policy).
- The runtime cannot INSERT derived items (RLS `WITH CHECK item_role='source'` + trigger #11).
- SECURITY DEFINER functions execute as `amaia_sync_manifest_owner`, bypassing runtime restrictions only within the reviewed function bodies.

### Service key management

```
SUPABASE_SERVICE_KEY: stored in environment variable, never logged.
AMAIA_MYSQL_PASSWORD: stored in environment variable, never logged.
```

Both keys are loaded at startup and never serialized to disk, logs, or error messages.

### AMAIA MySQL access

```
User: amaia_sync_reader
Privileges: SELECT only on required tables
Host restriction: only from AMAIASQL VM IP
No CREATE, INSERT, UPDATE, DELETE, DROP, ALTER, GRANT
```

### Network

```
AMAIASQL → AMAIA MySQL: internal network, port 3306
AMAIASQL → Supabase: HTTPS, session pooler endpoint
No inbound connections required on AMAIASQL for the sync engine.
```

## 22. Deployment Model

### Target environment

```
VM: AMAIASQL (Ubuntu)
Runtime: Node.js (matching existing Mistatas stack)
Process manager: systemd unit or PM2
```

### Docker (optional)

A Dockerfile is provided for reproducible builds, but the primary deployment is a systemd service on AMAIASQL to minimize latency to the MySQL instance.

### Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Service role key | Yes |
| `AMAIA_MYSQL_HOST` | MySQL host | Yes |
| `AMAIA_MYSQL_PORT` | MySQL port (default 3306) | No |
| `AMAIA_MYSQL_USER` | MySQL user | Yes |
| `AMAIA_MYSQL_PASSWORD` | MySQL password | Yes |
| `AMAIA_MYSQL_DATABASE` | MySQL database name | Yes |
| `SYNC_CYCLE_INTERVAL_MS` | Cycle interval (default 60000) | No |
| `SYNC_SAFETY_LAG_ID` | ID safety lag (default 100) | No |
| `SYNC_SAFETY_LAG_SECONDS` | Timestamp safety lag (default 30) | No |
| `SYNC_LEASE_TTL_SECONDS` | Lease TTL (default 300) | No |
| `SYNC_HEARTBEAT_INTERVAL_MS` | Heartbeat interval (default 60000) | No |
| `SYNC_LOG_LEVEL` | Log level (default info) | No |
| `METRICS_PORT` | Prometheus metrics port (default 9090) | No |

### Scheduling

The engine runs continuously as a daemon. It does not rely on external cron. The internal scheduler loop:

```
while (running) {
  acquireSchedulerLease()
  if (acquired) {
    executeCycle()
    releaseSchedulerLease()  // or let it expire
  }
  sleep(SYNC_CYCLE_INTERVAL_MS)
}
```

### Graceful shutdown

On SIGTERM/SIGINT:
1. Set `running = false`.
2. Wait for current domain to complete (with timeout).
3. Release scheduler lease.
4. Close database connections.
5. Exit.

If the shutdown timeout expires, the engine exits immediately. The lease expires naturally, and recovery handles any stale runs on next startup.

## 23. Failure Scenarios

| Scenario | Impact | Recovery |
|---|---|---|
| Engine crash mid-domain | Run stuck in 'running', manifest stuck in non-terminal | Next startup: recovery abandons stale manifests, marks runs orphan_recovered |
| AMAIA unreachable | No new data fetched | Empty cycles until AMAIA recovers. Watermarks unchanged. |
| Supabase unreachable | Transaction cannot start | Retry with backoff. No partial state (transaction never began). |
| Lease expires during processing | Fenced transaction fails (CAS rejects expired lease) | Transaction rolls back. Next cycle re-acquires lease. |
| Concurrent engine started | Second engine fails scheduler lease acquisition | Second engine logs warning and exits. |
| Supabase schema drift | Upsert fails (missing column, type mismatch) | Run marked failed. Requires manual DDL fix. |
| AMAIA data corruption | Invalid data fetched | Workset exceptions recorded. Run may succeed with partial data. |
| Disk full on AMAIASQL | Engine cannot write logs | Engine may crash. Recovery on restart. Supabase state is consistent (transaction-based). |
| PostgreSQL deadlock | Transaction aborted by PG | Rare in single-threaded model. Automatic retry next cycle. |

## 24. QA Strategy for Phase 9.4

### Unit tests

- Domain configuration loading.
- Watermark computation (safety lag).
- Identity hashing (numeric sort, canonical sort, correct delimiters).
- AMAIA query builder (per domain, per watermark type).
- Upsert query builder.

### Integration tests

- Full cycle against local MySQL + local Supabase (Docker Compose).
- Empty incremental lifecycle.
- Non-empty incremental with known data.
- Discrepancy detection (insert source without destination).
- CAS success and CAS failure (concurrent cursor modification).
- Lease acquisition and heartbeat.
- Recovery: crash simulation → stale run → abandon → retry.

### End-to-end tests

- Deploy engine on AMAIASQL.
- Insert known rows into AMAIA test tables.
- Run one cycle.
- Verify destination tables, manifests, watermarks.
- Verify sets_match=true.
- Introduce a discrepancy.
- Run another cycle.
- Verify sets_match=false, missing/extra recorded.

### QA SQL suite

The existing `qa_phase93c_schema_patch_and_finalization.sql` (18 tests) validates the database-level contracts. Phase 9.4 QA focuses on the runtime behavior above the database layer.

## 25. Explicit Non-Goals

| Non-goal | Reason |
|---|---|
| Multi-worker parallelism | V1 is single-threaded. Protocol explicitly declares multi-process as unsupported. |
| Bidirectional sync | AMAIA is read-only. Supabase is the operational platform. Data flows one way. |
| Real-time streaming | Incremental polling is sufficient for SLA requirements (minute-level freshness). |
| Schema migration of AMAIA | The engine does not modify AMAIA schema. It reads existing tables. |
| UI integration | The engine is a headless daemon. Dashboards read from Supabase tables, not from the engine. |
| SOS Mujer | Excluded from this application entirely. |
| Reconciliation engine | Phase 9.5 scope. The runtime engine handles incremental sync only. |
| Alert remediation | Handled by the remediation queue (separate process). The engine populates the queue. |
| Dedup membership management | The engine records memberships during dedup sync. Membership lifecycle (close, tombstone) is a separate concern within the sync domain processing, not a standalone subsystem. |

---

## Summary

The AMAIA-SYNC Runtime Engine is a single-process, single-threaded Node.js daemon deployed on AMAIASQL. It extracts incremental changes from AMAIA MySQL, persists them into Supabase, and constructs cryptographic identity manifests that prove the fidelity of every sync operation. It uses the lease-based fencing, manifest finalization, and CAS watermark protocol deployed in Phase 9.3C. Failures are isolated per domain, recovered on restart, and auditable through structured logs and database records.

---

READY FOR HOSTILE AUDIT
