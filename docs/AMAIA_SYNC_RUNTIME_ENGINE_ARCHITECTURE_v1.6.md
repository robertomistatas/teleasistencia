# AMAIA-SYNC Runtime Engine Architecture v1.6

**Type:** Runtime architecture blueprint  
**Status:** Pending Codex hostile re-audit  
**Supersedes:** v1.5 (rejected — 1 critical, 3 major, 2 minor corrections)  
**Parent:** AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4 (approved)  
**Deployed baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.5

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | No-CAS paths (empty, discrepancy) lack lease-expiry fencing | Terminal Lease Revalidation added after finalize_comparison, before complete_manifest. All paths. R27. |
| M1 | Major | Pre-run / lock contention contradiction | Pre-run created AFTER successful AMAIA fetch. Lock contention → pre-run closed as `skipped_lock_contention` or recovered. R29, R30. |
| M2 | Major | AMAIA fetch failure vs pre-run timing | Resolved by R29: pre-run only after fetch. Fetch failure = event only, no run. |
| M3 | Major | Recovery only on startup insufficient | Continuous recovery: at startup AND before every cycle. R28. |
| m1 | Minor | Append-only validation not a hard gate | Deployment gate: engine startup fails closed for unvalidated domains. |
| m2 | Minor | Durable failure evidence location undefined | Dedicated operational error channel defined architecturally. |

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

Both append-only, immutable after insertion, auto-increment PK. Fail-closed for unsupported watermark types.

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

**Deployment gate.** If append-only evidence is missing for a domain, the engine startup **fails closed** for that domain. No informal activation.

Required: at least two independent evidence types per domain.

| Evidence type | Description |
|---|---|
| Vendor documentation | AMAIA vendor confirms insert-only. |
| Schema analysis | No UPDATE/DELETE triggers, no UPDATE grants to application users. |
| Historical sampling | Audit logs or information_schema for UPDATE/DELETE activity. |
| Operational verification | DBA confirms no application UPDATE/DELETE paths. |

## 4. Scheduler Model

### Single serialized orchestrator

1. Acquire scheduler lease.
2. **Cycle-start recovery** (Section 15.6).
3. Create cycle record.
4. Iterate active domains.
5. For each domain: pre-fence phase → fenced transaction → post-commit.
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

TTL: 5 minutes. Renewed **only between domains** (before and after each domain).

No heartbeat during domain execution.

**Expiry abort:** Before starting any new domain, verify `scheduler_lease_expires_at > now()`. If expired, exit cycle.

### 4.3 Per-Domain Flow

```
Pre-fence:
  1. Read watermark from Supabase.
  2. Compute safe/effective upper_bound from AMAIA.
  3. Fetch AMAIA rows into memory (batched).
  4. If fetch fails → log event, skip domain. No pre-run.
  5. Create pre-run (NULL credentials).

Fenced transaction:
  (Section 10)

Post-commit:
  Best-effort domain lease release.
  Close pre-run if lock contention occurred.
```

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

UUID prevents PID-reuse collisions.

## 6. Domain Processing Order

Fixed: 1. control_llamadas, 2. logestado. All others skipped.

## 7. Domain Lease

### Acquisition

Inside fenced tx (step 2 of Section 10). Pre-fence operations run without domain lease (R20).

```
SELECT * FROM amaia_sync_leases WHERE entity_name=:domain FOR UPDATE;
-- Validate + UPDATE
```

If held by another process → fenced tx aborts → pre-run closed as `skipped_lock_contention` (Section 8.6).

### 7.1 Domain Execution Time Constraint

No heartbeat during fenced tx. **Maximum domain execution < lease TTL.**

Lease expiry is rejected by:
- **CAS** for non-empty matched runs.
- **Terminal Lease Revalidation** for empty and discrepancy runs.

Both mechanisms ensure no terminal state is committed with an expired lease.

### 7.2 Domain Lease Release

After successful commit:

```
UPDATE amaia_sync_leases
SET owner_identity = NULL
WHERE entity_name = :domain
  AND owner_identity = :owner_identity
  AND lease_token = :lease_token;
```

**Best-effort and advisory** (R25). Failure → TTL expiration releases.

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

**Pre-runs carry NULL lease credentials** (R22). Operational evidence only.

If AMAIA fetch fails → no pre-run (R29).

### 8.2 Bind Run to Lease

Inside fenced tx (step 3):

```sql
UPDATE amaia_sync_runs
SET owner_identity = :lease_owner_identity,
    lease_token = :lease_token
WHERE id = :run_id
  AND status = 'running'
  AND owner_identity IS NULL
  AND lease_token IS NULL;
```

**No manifest operation before binding** (R23).

### 8.3 Run Status Transitions

```
running → success                     (fenced tx, CAS + complete)
running → completed_with_discrepancy  (fenced tx, no CAS, sets_match=false)
running → skipped_lock_contention     (post-rollback, domain lease held)
running → orphan_recovered            (recovery)
running → failed                      (recovery, durable error evidence)
```

### 8.4 Run State Persistence

**Success (non-empty):**

```
bind → revalidate → evidence → CAS → terminal lease revalidation → complete_manifest → status='success' → COMMIT
```

**Success (empty):**

```
bind → revalidate → evidence(0) → terminal lease revalidation → complete_manifest → status='success' → COMMIT
```

**Discrepancy:**

```
bind → revalidate → evidence → terminal lease revalidation → complete_manifest → status='completed_with_discrepancy' → COMMIT
```

**Failure:** Tx rollback. Pre-run remains `running` with NULL credentials. Recovery handles.

### 8.5 Run Without Manifest Recovery

Run `running` with no manifest → `orphan_recovered`.

### 8.6 Lock Contention Closure

If domain lease acquisition fails (step 2 of fenced tx):

1. Fenced tx rolls back.
2. **Outside the rolled-back tx**, the runtime immediately closes the pre-run:

```sql
UPDATE amaia_sync_runs
SET status = 'skipped_lock_contention', finished_at = now()
WHERE id = :run_id AND status = 'running' AND owner_identity IS NULL;
```

If the immediate closure fails (e.g., connection error), recovery will classify it as `orphan_recovered` at next cycle start (R28, R30).

## 9. Extraction from AMAIA

### Connection

```
Host: AMAIASQL (internal)
User: amaia_sync_reader (SELECT only)
Connection pool: 1
```

### Fetch protocol

1. Read watermark from Supabase.
2. Compute safe upper bound: `MAX(id) - safety_lag`.
3. Apply max_incremental_window.
4. Fetch rows into memory (batched).
5. **If fetch fails → operational event + metric. No pre-run created** (R29).

### 9.1 Pre-Fence Safety Proof

1. Single orchestrator.
2. No domain lease needed for reads.
3. CAS revalidation under fence (non-empty matched).
4. Hard watermark revalidation (R24) for all paths.
5. Terminal lease revalidation (R27) for all paths.
6. Engine death before fence → no advance.

**Pre-fence extraction is safe because all terminal paths validate both watermark and lease inside the fence.**

### Safety lag

Default: 100. `safe_upper_bound = MAX(id) - safety_lag`.

### 9.2 Batch Processing

Page size: 1000 (configurable). All pages into memory before fenced tx.

### 9.3 Maximum Runtime Window

```
max_incremental_window = 10000 (configurable)
effective_upper_bound = min(safe_upper_bound, lower_bound + max_incremental_window)
```

### Empty incrementals

If `effective_upper_bound <= lower_bound`:

**No eligible rows in the current safe bounded window.** Rows may exist beyond `safe_upper_bound`.

1. Create pre-run.
2. Fenced tx: bind, hard watermark revalidation, manifest (0 items), finalize, **terminal lease revalidation**, complete, status='success'.
3. No CAS.
4. COMMIT.

Empty manifests are intentional audit artifacts.

### 9.4 Empty Manifest Retention

Counted via `amaia_sync_empty_incrementals_total`. No discrepancy alerts. Configurable retention subject to institutional audit. Excluded from discrepancy dashboards.

**Never auto-delete:** discrepancy manifests, abandoned manifests, failed runs.

## 10. Fenced Transaction

**All manifest evidence, destination mutations, CAS operations, terminal lease revalidation, and terminal run status updates occur inside the fenced transaction. Pre-run creation is intentionally outside.**

### Sequence

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
10. Terminal Lease Revalidation:
      ASSERT lease.owner_identity == run.owner_identity
      ASSERT lease.lease_token == run.lease_token
      ASSERT lease.lease_expires_at > now()
      ASSERT run.status == 'running'
11. If sets_match=true AND source_id_count>0: call advance_watermark_cas
12. Call complete_manifest
13. UPDATE run terminal state:
      success | completed_with_discrepancy
14. COMMIT
```

### 10.1 Hard Watermark Revalidation (Step 4)

All paths. `current_watermark == run.lower_bound`. Failure → rollback.

### 10.2 Terminal Lease Revalidation (Step 10)

All paths: non-empty matched, empty, discrepancy. Validates that the domain lease is still held by this engine and has not expired.

For non-empty matched runs, CAS (step 11) **also** validates the lease. Terminal Lease Revalidation is redundant for that path but provides defense-in-depth.

For empty and discrepancy runs, Terminal Lease Revalidation is the **sole** lease-expiry fence, since CAS is not called.

Failure → rollback. Pre-run remains unresolved. Recovery handles.

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

V1 never invokes `amaia_sync_finalize_provisional`. Dormant DB capability.

**Compatibility assumption:** `complete_manifest` supports direct `confirmed_compared → comparison_complete`.

## 14. CAS Watermark Advancement

When `sets_match=true` AND `source_id_count > 0`. Inside fenced tx after terminal lease revalidation.

CAS not called for empty or discrepancy paths.

## 15. Abandonment and Recovery

### 15.1 Stale Run Predicate

```
stale_threshold = greatest(lease_expires_at, heartbeat_at + 2 * lease_ttl)
```

Stale when `now() > stale_threshold` AND (credentials mismatch OR lease expired OR owner_identity IS NULL).

**Expired leases alone sufficient** (R21). NULL credentials (unbound pre-runs) also qualify.

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

### 15.3 Abandon Protocol

For runs with manifests: `amaia_sync_abandon_manifest`. Lock order: domain_lease → run → manifest.

### 15.4 Healthy Run Protection

Credentials match + lease valid + not expired = healthy. Cannot abandon (Protocol Invariant 86).

### 15.5 Run Without Manifest Recovery

Run `running` with no manifest → `orphan_recovered`.

### 15.6 Continuous Recovery

Recovery executes:

1. **At engine startup** (before first cycle).
2. **Before every cycle start** (after scheduler lease acquisition, before domain iteration).

This prevents accumulation of stale pre-runs from previous failed domains within the same engine session.

**Startup-only recovery is insufficient** for a long-running daemon. A crash during domain 1 leaves a pre-run; recovery before the next cycle cleans it.

### 15.7 Recovery Outcome Classification

| Outcome | Condition |
|---|---|
| `orphan_recovered` | Stale, no durable error evidence. Default. |
| `failed` | Durable error evidence exists outside rolled-back tx. |

**Without durable evidence → always `orphan_recovered`.**

### 15.8 Durable Failure Evidence

`failed` requires evidence persisted **outside** any rolled-back transaction, in a **dedicated operational error channel**:

- Persistent audit table (e.g., `amaia_sync_operational_errors`).
- Durable structured log with ingestion guarantee.
- Operational incident store.

Must survive transaction rollback. Examples: schema incompatibility, append-only validation failure, unsupported configuration.

## 16. Error Handling

### 16.1 Domain Failures

Single domain. Engine catches exception, logs, **continues to next domain**.

| Example | Action |
|---|---|
| Upsert constraint violation | Rollback. Pre-run recovered. |
| CAS failure | Rollback. Retry next cycle. |
| Terminal lease revalidation failure | Rollback. Pre-run recovered. |
| Watermark revalidation failure | Rollback. Pre-run recovered. |
| AMAIA fetch failure | Event + metric. No pre-run. Skip domain. |
| Domain lease contention | Rollback. Pre-run → `skipped_lock_contention` or recovered. |

### 16.2 Authority Failures

**Abort entire cycle.**

| Example | Action |
|---|---|
| Scheduler lease expired (between domains) | Exit cycle. |
| Supabase connection permanently lost | Exit cycle. |
| AMAIA connection permanently lost | Exit cycle. |

### 16.3 Unsupported Multi-Process

Unsupported for scheduling. Domain lease + CAS protect against same-domain corruption. **Unsupported ≠ unfenced.**

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
| `domain.terminal_lease_revalidated` | info |
| `domain.terminal_lease_revalidation_failed` | error |
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
| `amaia_sync_terminal_revalidation_failures_total` | counter | domain |
| `amaia_sync_authority_failures_total` | counter | reason |
| `amaia_sync_discrepancies_total` | counter | domain |
| `amaia_sync_watermark_revalidation_failures_total` | counter | domain |
| `amaia_sync_recovery_runs_total` | counter | outcome |

### Alerts

| Condition | Severity |
|---|---|
| No successful cycle in 10 minutes | High |
| Discrepancy detected | Medium |
| Stale run detected | Medium |
| Authority failure | High |
| Terminal lease revalidation failure | High |
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
| `SYNC_LOG_LEVEL` | No (info) |
| `METRICS_PORT` | No (9090) |

Graceful shutdown: SIGTERM → stop → wait for fenced tx → release scheduler lease → close connections → exit.

## 23. Failure Scenarios

| Scenario | Recovery |
|---|---|
| Crash mid-fence | Rollback. Pre-run (NULL creds) recovered at next cycle. |
| Crash after pre-run, before fence | Pre-run (NULL creds). No manifest. Recovered at next cycle. |
| AMAIA fetch failure | Event only. No pre-run. |
| Supabase unreachable | Exit cycle. |
| Lease expires mid-fence | Terminal lease revalidation rejects. Rollback. |
| CAS failure | Rollback. Retry next cycle. |
| Scheduler lease lost mid-domain | Domain completes (R16). Cycle aborts after. |
| Lock contention | Rollback. Pre-run → `skipped_lock_contention`. |
| Watermark revalidation failure | Rollback. Pre-run recovered. |
| Backlog > max_window | Progressive catch-up. |
| Append-only violated | Domain excluded immediately. |

## 24. QA Strategy

### Unit tests

- Domain config (skip unsupported, fail-closed for unvalidated).
- Watermark computation (safety lag, max_window).
- Hash (numeric/pipe).
- Pre-run creation with NULL credentials.
- Bind-run-to-lease.
- Terminal lease revalidation logic.
- Append-only evidence check.

### Integration tests

- Full cycle (2 domains).
- Empty incremental (terminal lease revalidation, no CAS).
- Non-empty incremental.
- Discrepancy → `completed_with_discrepancy` (terminal lease revalidation, no CAS).
- CAS success / failure.
- Hard watermark revalidation failure → rollback.
- Terminal lease revalidation failure → rollback.
- Bind-run failure → rollback.
- Recovery at cycle start (stale pre-runs cleaned).
- Lock contention → `skipped_lock_contention`.
- AMAIA fetch failure → no pre-run.
- Authority failure.
- Domain lease release (success + failure).

## 25. Explicit Non-Goals

| Non-goal | Reason |
|---|---|
| Timestamp domains | V1 id-only. |
| Mutable domains | V1 append-only. |
| Delete synchronization | V1 sources: no deletes. |
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
| R5 | **All evidence inside fence.** Source items, upserts, finalization, CAS, terminal run status. Pre-run outside. |
| R6 | **CAS inside same transaction.** All commit or all rollback. |
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
| R17 | **All V1 executions bounded** (max_incremental_window). |
| R18 | **Non-empty successful runs imply watermark advancement.** |
| R19 | **V1 append-only domains only.** |
| R20 | **Domain lease begins at fenced tx start.** |
| R21 | **Expired leases sufficient for stale classification.** |
| R22 | **Pre-runs carry NULL credentials.** |
| R23 | **Manifest processing after binding only.** |
| R24 | **All paths: hard watermark revalidation.** |
| R25 | **Domain lease release is advisory.** |
| R26 | **Unvalidated domains ineligible.** |
| R27 | **Every terminal path: fresh domain lease validation.** CAS for non-empty matched; Terminal Lease Revalidation for empty and discrepancy. |
| R28 | **Recovery at startup AND before every cycle.** |
| R29 | **Pre-runs created only after successful AMAIA fetch.** |
| R30 | **Lock contention after pre-run: terminally closed or recovered.** |

---

## Summary

The AMAIA-SYNC Runtime Engine v1.6 is a single-process, single-threaded Node.js daemon on AMAIASQL synchronizing 2 append-only id-based domains (control_llamadas, logestado). Pre-runs are created after successful AMAIA fetch with NULL lease credentials. The fenced transaction binds the run to the acquired domain lease, hard-revalidates the watermark, produces all evidence, and performs Terminal Lease Revalidation before any terminal state is committed — ensuring no-CAS paths (empty, discrepancy) are also lease-expiry-fenced. Lock contention closes the pre-run as `skipped_lock_contention`. Recovery runs at startup and before every cycle to prevent stale pre-run accumulation. 30 invariants (R1–R30) declared for hostile audit.

---

READY FOR HOSTILE RE-AUDIT
