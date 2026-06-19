# AMAIA-SYNC Runtime Architecture v1.0

**Phase:** 9.3  
**Status:** Design — no implementation  
**Prerequisite phases:** 9.1D (empirical validation, closed), 9.2 (schema deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Auditor:** Codex (auditor forense)  
**Date:** 2026-06-18

---

## 1. Runtime Topology

The AMAIA-SYNC runtime is a single-process, multi-domain synchronization engine that runs on VM AMAIASQL. It connects read-only to AMAIA MySQL and read-write to Supabase PostgreSQL. There is no intermediate broker, no queue, and no Vercel dependency.

### 1.1 Scheduler

**Responsibility:** Orchestrate the execution cycle. The Scheduler determines which domains need processing, in what order, and at what cadence. It is the sole entry point for both scheduled runs and manual operator-triggered runs.

**Justification:** A centralized scheduler prevents concurrent domain processors from competing for resources or violating ordering constraints (notably the alerta-logestado dependency documented in 9.1D V-003/V-004). The scheduler runs within the same OS process as all other components — there is no inter-process communication.

**Behavioral contract:**

- The Scheduler maintains a static domain registry that maps each domain name to its processor, its configured cadence, and its priority tier.
- On each tick, the Scheduler evaluates which domains are eligible for execution based on elapsed time since their last successful run, current lease state, and priority.
- The Scheduler never runs two domain processors concurrently for the same entity_name. Cross-domain parallelism is permitted but not required in V1.
- The Scheduler is responsible for invoking the Reconciliation Engine and Correlation Engine at their configured cadences, treating them as special-purpose processors that do not hold domain leases.

### 1.2 Lease Manager

**Responsibility:** Acquire, renew, and release mutual-exclusion leases on `amaia_sync_leases`. Prevent double execution of the same domain by concurrent processes (e.g., two VM instances or a crashed-and-restarted process).

**Justification:** The fencing token model was established in 9.1C and materialized in 9.2 migration 009. The Lease Manager is the sole component that writes to `amaia_sync_leases`. All other components receive a lease token from the Lease Manager and must verify it before any write operation.

**Behavioral contract:**

- Exposes three operations: `acquire(entity_name)`, `heartbeat(entity_name, token)`, `release(entity_name, token)`.
- Acquisition is atomic: a single conditional UPDATE that succeeds only if the lease is free (owner_identity IS NULL) or expired (lease_expires_at < now()). On success, lease_token is incremented by 1, owner_identity is set, acquired_at and lease_expires_at are set.
- Heartbeat extends lease_expires_at and updates heartbeat_at, but only if the caller's token matches the current lease_token. If the token does not match, the heartbeat fails and the caller must stop immediately.
- Release clears owner_identity and nullifies lease_expires_at, but only if the caller's token matches. The lease_token is never decremented.
- owner_identity follows the format `{hostname}:{process_id}:{worker_id}:{run_id}` established in 9.1C.

### 1.3 Watermark Manager

**Responsibility:** Read and advance watermarks on `amaia_sync_watermarks`. The Watermark Manager encapsulates the all-or-nothing advancement rule defined in 9.1C.

**Justification:** Watermark advancement is the most safety-critical operation in the engine. 9.1C established that partial advancement is forbidden — the watermark moves forward only when 100% of planned pages have been persisted successfully. Isolating this logic in a dedicated manager prevents domain processors from accidentally advancing on partial success.

**Behavioral contract:**

- Exposes two operations: `read(entity_name)` and `advance(entity_name, token, new_value)`.
- `read` returns the current watermark state: last_id or last_timestamp (depending on watermark_type), overlap_window, and watermark_expr.
- `advance` writes the new watermark value only if: (a) the caller's lease token matches the current lease_token in amaia_sync_leases, and (b) the new value is strictly greater than the current value. If either condition fails, advance returns failure and the caller must not treat the run as successful.
- The five-term contract from 9.1C is enforced: watermark_before is read at the start of the run, lower_bound = watermark_before minus overlap_window, upper_bound is fixed at the start and never recalculated on retry, watermark_after is written only on full success.

### 1.4 Domain Processors

**Responsibility:** Execute the incremental sync cycle for a single domain: fetch from AMAIA, normalize, upsert to Supabase. Each domain has its own processor instance with domain-specific configuration.

**Justification:** 9.1D confirmed that each domain has distinct watermark strategies, data volumes, and anomaly profiles. A generic processor with per-domain configuration (rather than seven entirely separate implementations) balances code reuse with domain-specific handling.

**Behavioral contract:**

- A domain processor receives a lease token, a watermark snapshot, and a domain configuration object from the Scheduler.
- It fetches data from AMAIA MySQL using a SELECT query bounded by [lower_bound, upper_bound].
- It normalizes fetched rows according to domain-specific rules (e.g., COALESCE for beneficiario/red timestamps, hash/canonicalization for health context).
- It upserts normalized rows to Supabase using the amaia_id as the conflict key.
- It returns a result object containing: rows_fetched, rows_upserted, rows_skipped, errors encountered, and the proposed watermark_after value.
- It never advances the watermark itself — it returns the proposed value to the Scheduler, which delegates to the Watermark Manager.

### 1.5 Reconciliation Engine

**Responsibility:** Execute periodic full-count and row-level comparisons between AMAIA source and Supabase destination to detect drift, orphans, and tombstone candidates. Writes results to `amaia_sync_reconciliation_results` and tombstone transitions to `amaia_sync_tombstone_events`.

**Justification:** Incremental sync by definition cannot detect deletions or retroactive modifications that fall outside the watermark window. 9.1C established that tombstones require full reconciliation with a 2-cycle grace period before confirmation. The Reconciliation Engine is the sole writer of sync_status transitions on destination tables.

**Behavioral contract:**

- Operates independently of domain processor runs — it does not hold a domain lease and does not advance watermarks.
- For each domain, it compares the set of amaia_id values present in AMAIA against those present in Supabase with sync_status = 'active'.
- Discrepancies are classified as: drift (count mismatch), orphan_row (present in Supabase but absent in AMAIA), late_update (present in both but field values differ), tombstone_candidate (absent in AMAIA for 2+ consecutive reconciliation cycles).
- Tombstone transitions follow the state machine: detected (first cycle absent) → confirmed (second consecutive cycle absent) → inactive_confirmed (sync_status updated on destination row). Reappearance at any point before confirmation triggers reverted.
- Writes one row per domain per reconciliation run to amaia_sync_reconciliation_results. Writes one row per state transition to amaia_sync_tombstone_events.

### 1.6 Correlation Engine

**Responsibility:** Detect and record cross-domain referential anomalies that cannot be resolved by the sync engine alone. Writes to `amaia_correlation_issues`.

**Justification:** 9.1D V-006 identified 33 historical alerts with zero logestado entries — a cross-domain anomaly that is neither a sync failure nor a data quality issue within a single domain, but a referential inconsistency in the AMAIA source. These anomalies must be tracked without blocking normal sync operations.

**Behavioral contract:**

- Runs after domain processors complete, not during.
- Checks referential expectations: every alerta should have at least one logestado entry; every red entry should reference a valid beneficiario; every health context entry should reference a valid beneficiario.
- New anomalies are inserted into amaia_correlation_issues with status 'open'. Anomalies that resolve on a subsequent run are updated to 'resolved'.
- The Correlation Engine never modifies domain data. It is purely observational and its findings are advisory.

### 1.7 Observability Layer

**Responsibility:** Persist structured evidence of every runtime operation into `amaia_sync_runs` and emit operational metrics.

**Justification:** 9.2 migration 013 added rich evidence fields (domain_name, lower_bound, upper_bound, watermark_before/after, lease_token, owner_identity, attempt_number, reason_code) to amaia_sync_runs. The Observability Layer is responsible for populating these fields completely and accurately on every run, regardless of outcome.

**Behavioral contract:**

- A new amaia_sync_runs row is inserted at the start of every domain processor invocation with status = 'running'.
- On completion (success or failure), the row is updated with final status, reason_code, all watermark evidence fields, row counts, timing, and reconciliation_status if applicable.
- On retry, a new row is inserted with previous_attempt_run_id pointing to the failed attempt. The original row's status remains 'failed'.
- On orphan recovery, a new row is inserted with supersedes_run_id pointing to the orphaned run. The orphaned row's status is updated to 'orphan_recovered'.
- The Observability Layer never makes decisions — it records decisions made by other components.

---

## 2. Runtime Execution Lifecycle

Each domain processor invocation follows this exact sequence. Deviation from this order is a bug.

### Step 1: Acquire Lease

The Scheduler requests the Lease Manager to acquire the lease for entity_name. If the lease is held by another process and not expired, the run is recorded with status = 'skipped_lock_held' and reason_code = 'LEASE_HELD'. No further steps execute.

If the lease is expired (indicating a potential orphan), the Lease Manager acquires it with a new fencing token. The Scheduler records started_by_recovery = true and supersedes_run_id pointing to the last known run for this domain. The orphaned run is updated to status = 'orphan_recovered' and reason_code = 'LEASE_EXPIRED_ORPHAN'.

### Step 2: Read Watermark

The Watermark Manager reads the current watermark for entity_name. This produces watermark_before (either last_id or last_timestamp depending on watermark_type). This value is recorded in the amaia_sync_runs row immediately.

### Step 3: Build Incremental Window

The processor computes:
- **lower_bound** = watermark_before minus overlap_window (15 minutes for beneficiario/red, 5 minutes for alerta, zero for id-based domains).
- **upper_bound** = current maximum observable value in AMAIA at this instant. This value is fixed once and never recalculated on retry.

Both values are recorded in the amaia_sync_runs row.

### Step 4: Fetch from AMAIA

The processor executes a read-only SELECT against AMAIA MySQL bounded by [lower_bound, upper_bound]. The query is domain-specific (see Section 3). Pagination is used if the result set exceeds a configurable page size.

If the MySQL connection fails, the run terminates with status = 'failed' and reason_code = 'MYSQL_ERROR' or 'CONNECTION_TIMEOUT'. The watermark is not advanced.

### Step 5: Normalize

Fetched rows are transformed into the Supabase destination schema. Normalization includes:
- Type coercion (AMAIA integer IDs to amaia_id fields).
- Timestamp normalization (AMAIA local timestamps to UTC).
- For health context domains: canonicalization and hashing per the 9.2 contract (canonical_text, hash, hash_version).
- For beneficiario/red: COALESCE(updatedAt, createAt) evaluation for watermark ordering.

If normalization produces an error for a specific row, that row is skipped and counted in a quality_issues tally. The run continues.

### Step 6: Upsert to Supabase

Normalized rows are upserted to Supabase using amaia_id as the conflict key (ON CONFLICT (amaia_id) DO UPDATE). Before each batch write, the processor verifies that its lease token still matches by calling Lease Manager heartbeat.

If the heartbeat fails (token mismatch), the run terminates immediately with status = 'failed' and reason_code = 'LEASE_LOST_RACE'. The watermark is not advanced.

If the Supabase write fails, the run terminates with status = 'failed' and reason_code = 'SUPABASE_ERROR'. The watermark is not advanced.

### Step 7: Advance Watermark

Only if 100% of planned pages have been upserted successfully, the processor requests the Watermark Manager to advance the watermark to upper_bound. The Watermark Manager verifies the lease token one final time before writing.

If advancement fails (token mismatch or value regression), the run is recorded as status = 'failed' and reason_code = 'LEASE_LOST_RACE'. The upserted data remains in Supabase (idempotent — it will be re-fetched on the next run due to the overlap window).

If advancement succeeds, the run is recorded as status = 'success' and reason_code = 'SUCCESS' (or 'SUCCESS_WITH_QUALITY_ISSUES' if any rows were skipped in Step 5).

### Step 8: Persist Evidence

The amaia_sync_runs row is updated with all final values: watermark_after, rows_fetched, rows_upserted, status, reason_code, timing. This write does not depend on the lease token — it is an audit record owned by the Observability Layer.

### Step 9: Release Lease

The Lease Manager releases the lease for entity_name. If the release fails (token already superseded), this is logged but does not change the run's recorded status — the run already completed its data operations.

### Rules of Success and Failure

A run is **successful** if and only if: all pages fetched, all rows upserted (or explicitly skipped with quality tracking), watermark advanced, evidence persisted.

A run is **failed** if any of the following occur: lease acquisition denied, MySQL connection error, Supabase write error, lease token invalidated mid-run, watermark advancement rejected.

A run is **skipped** if the lease is held by another active process (status = 'skipped_lock_held').

A run is **abandoned** if an operator manually terminates it via an external signal (status = 'abandoned', reason_code = 'ABANDONED_BY_OPERATOR').

There is no partial success. A run that upserted 999 of 1000 rows is failed, not partial.

---

## 3. Domain Processing Strategy

### 3.1 control_llamadas

- **Watermark type:** id (append-only, confirmed in 9.1D V-004).
- **Watermark expression:** N/A — primary key ordering is sufficient.
- **Overlap window:** 0 — append-only means no late updates.
- **Relative frequency:** High. Call logs are generated continuously during operating hours.
- **Expected cost:** Low per row (flat structure, no normalization beyond type coercion). Volume can be high in absolute terms.
- **Operational risk:** Low. Append-only with id-based watermark is the simplest and most reliable incremental strategy. No COALESCE, no timestamp ambiguity, no NULL watermark fields.
- **Reconciliation strategy:** Weekly full count comparison. Daily is unnecessary given the append-only guarantee — drift would indicate a Supabase-side deletion (which should never happen) or an AMAIA retroactive delete (which would violate the observed append-only behavior).

### 3.2 logestado

- **Watermark type:** id (append-only, confirmed in 9.1D V-004).
- **Watermark expression:** N/A — primary key ordering is sufficient.
- **Overlap window:** 0 — append-only means no late updates.
- **Relative frequency:** High. Alert state changes generate logestado entries continuously.
- **Expected cost:** Low per row. Volume is substantial (58,031+ alert entries with associated log trails).
- **Operational risk:** Low for sync itself. The critical dependency is downstream: logestado is the sole mechanism for detecting alert evolution (9.1D confirmed alerta.updateAt is 100% NULL). A missed logestado entry means a missed alert state change. This elevates the importance of reconciliation for this domain specifically.
- **Reconciliation strategy:** Daily full count comparison. The downstream criticality of logestado (sole alert change detector) justifies a more aggressive reconciliation cadence than control_llamadas despite the same append-only guarantee.
- **Ordering constraint:** logestado must be processed before alerta in each cycle, because the Correlation Engine checks for alerts without logestado entries. Processing alerta first would create transient false-positive correlation issues.

### 3.3 beneficiario

- **Watermark type:** timestamp (COALESCE-based, confirmed in 9.1D V-001).
- **Watermark expression:** COALESCE(updatedAt, createAt). Stored in amaia_sync_watermarks.watermark_expr (9.2 migration 012).
- **Overlap window:** 15 minutes. Justified by 9.1D finding that 18% of beneficiario rows have NULL updatedAt, meaning COALESCE falls back to createAt. A 15-minute overlap guards against clock skew and rows where createAt was set slightly before the previous watermark read.
- **Relative frequency:** Medium. Beneficiary records change less frequently than call logs or alert logs, but updates do occur (address changes, contact updates, status transitions).
- **Expected cost:** Medium. 2,237 total beneficiaries (9.1D). Each incremental run processes only the delta, but normalization includes type coercion and timestamp UTC conversion.
- **Operational risk:** Medium. The COALESCE strategy is sound but inherently less precise than id-based watermarking. The 15-minute overlap mitigates but does not eliminate the risk of a row whose COALESCE timestamp falls exactly at the boundary. Reconciliation is the safety net.
- **Reconciliation strategy:** Weekly full count comparison plus monthly row-level field comparison. The small total volume (2,237) makes full row-level comparison feasible at monthly cadence.

### 3.4 red (support network)

- **Watermark type:** timestamp (COALESCE-based, confirmed in 9.1D V-001).
- **Watermark expression:** COALESCE(updatedAt, createAt). 9.1D found 80% of red rows have NULL updatedAt — the highest NULL rate of any domain.
- **Overlap window:** 15 minutes. Same rationale as beneficiario, amplified by the 80% NULL rate.
- **Relative frequency:** Medium-low. Support network changes are less frequent than beneficiary changes.
- **Expected cost:** Medium. 4,621 total rows (9.1D). Normalization includes estado preservation (business status, not sync signal — documented in 9.2 migration 017).
- **Operational risk:** Medium-high. The 80% NULL updatedAt rate means the vast majority of rows use createAt as the effective watermark, which never changes after initial insertion. This means: (a) updates to existing red rows that do not touch updatedAt will be invisible to the incremental sync, and (b) the only way to detect such updates is full reconciliation. This is the domain where reconciliation is most critical as a compensating control.
- **Reconciliation strategy:** Weekly full count comparison plus weekly row-level field comparison on a sample (10% of rows, rotated). Monthly full row-level comparison. The high NULL rate demands more aggressive reconciliation than beneficiario.

### 3.5 alerta

- **Watermark type:** Indirect. alerta.updateAt is 100% NULL (9.1D V-003, 58,031/58,031). Direct timestamp-based incremental sync is impossible.
- **Watermark expression:** N/A. There is no usable timestamp column on alerta.
- **Detection mechanism:** New or changed alerts are detected exclusively via new logestado entries. When logestado sync processes a new entry, the referenced alert's amaia_id is added to a refetch queue. The alerta processor then fetches those specific alerts by primary key, not by watermark window.
- **Overlap window:** 5 minutes on the logestado side. The alerta processor itself does not maintain its own watermark — it is driven by logestado.
- **Relative frequency:** Coupled to logestado frequency. Alerta processing runs after each logestado sync cycle.
- **Expected cost:** Variable. Each run processes only the alerts referenced by new logestado entries, which can range from zero to hundreds depending on operational activity.
- **Operational risk:** High. This is the most complex domain because it depends on a cross-domain signal (logestado) rather than a self-contained watermark. If logestado sync falls behind, alert state changes will be delayed proportionally. The 33 historical alerts without logestado entries (9.1D V-006) are handled by the Correlation Engine, not by this processor.
- **Reconciliation strategy:** Daily full count comparison. Weekly row-level field comparison on active alerts (alert_status_id in 0, 1, 2). The indirect detection mechanism makes reconciliation essential — it is the only way to detect alert changes that somehow occur without a corresponding logestado entry (which should not happen, but the 33 historical anomalies prove it has).

### 3.6 enfermedades (health conditions)

- **Watermark type:** id on the AMAIA source table (beneficiario_enfermedad).
- **Watermark expression:** N/A — source table id ordering.
- **Overlap window:** 0. The source data is effectively append-only: conditions are added to a beneficiary's record but rarely modified or removed.
- **Relative frequency:** Low. Health conditions change infrequently.
- **Expected cost:** Low per row, but normalization is expensive: each row requires canonicalization (trim, whitespace collapse, case normalization, diacritic handling) and hashing per 9.2 migration 015. The unique index on (beneficiary_amaia_id, hash, hash_version) means duplicate canonical entries are automatically deduplicated by the upsert's ON CONFLICT clause targeting the dedup index.
- **Operational risk:** Low for sync. Medium for data quality — 9.1D V-005 found duplicate entries in AMAIA (same beneficiary, same condition text, two source_id values). The dedup index handles this correctly, but it means rows_upserted may be less than rows_fetched without this being an error.
- **Reconciliation strategy:** Monthly full count comparison. The low change frequency and dedup index make aggressive reconciliation unnecessary.

### 3.7 medicamentos (medications)

- **Watermark type:** id on the AMAIA source table (beneficiario_medicamento).
- **Watermark expression:** N/A — source table id ordering.
- **Overlap window:** 0. Same append-only rationale as enfermedades.
- **Relative frequency:** Low-medium. Medication lists change more frequently than conditions (new prescriptions, discontinuations) but still infrequently compared to call logs.
- **Expected cost:** Same as enfermedades — cheap fetch, expensive normalization (canonicalization + hashing). Same dedup behavior via the unique index on (beneficiary_amaia_id, hash, hash_version).
- **Operational risk:** Low for sync. Medium for data quality — same duplicate pattern as enfermedades, same mitigation. Additionally, 9.1D noted that no semantic correction is applied (ASTORVACTATINA remains distinct from ATORVASTATINA), which is correct but means reconciliation must not flag these as drift.
- **Reconciliation strategy:** Monthly full count comparison. Same rationale as enfermedades.

---

## 4. Lease Management

### 4.1 Acquisition

A lease is acquired by a single atomic conditional UPDATE on amaia_sync_leases:

The UPDATE succeeds only if the row for entity_name has owner_identity IS NULL (free) or lease_expires_at < now() (expired). On success, the following fields are set in the same statement: lease_token = lease_token + 1, owner_identity = caller's structured identity, acquired_at = now(), lease_expires_at = now() + configured TTL, heartbeat_at = now().

If the UPDATE affects zero rows, the lease is held by another active process. The caller records the run as skipped_lock_held and does not retry within the same scheduler tick.

The atomicity of this operation is guaranteed by PostgreSQL's row-level locking. No explicit advisory locks or SELECT FOR UPDATE are needed — the conditional UPDATE is both the check and the mutation.

### 4.2 Heartbeat

During long-running domain processor operations (multi-page fetches, large upserts), the processor periodically calls heartbeat. The heartbeat UPDATE extends lease_expires_at and sets heartbeat_at = now(), but only if lease_token matches the caller's token.

Heartbeat interval must be strictly less than half the lease TTL. For a TTL of 5 minutes, heartbeat interval is 2 minutes. This ensures that a healthy process always renews before expiration, while a crashed process is detectable within one TTL.

If heartbeat returns zero affected rows (token mismatch), the caller has been superseded. The processor must terminate immediately — any subsequent write to Supabase would violate the fencing guarantee.

### 4.3 Expiration

A lease is considered expired when lease_expires_at < now() and no heartbeat has been received. Expiration is not an active process — no background reaper is required. Instead, the next acquisition attempt for the same entity_name detects the expiration condition and acquires over it.

The expired lease's owner_identity is overwritten. The previous owner's lease_token is superseded by the new, higher token. If the previous owner attempts any write (upsert, watermark advance, heartbeat) after this point, the token mismatch causes immediate rejection.

### 4.4 Release

On successful run completion, the processor explicitly releases the lease by setting owner_identity = NULL, lease_expires_at = NULL, heartbeat_at = NULL. The lease_token is preserved — it is never decremented. This makes the lease immediately available for the next scheduled run without waiting for TTL expiration.

Release is conditional on token match. If the token has already been superseded (theoretically impossible in the success path, but defensive), the release is a no-op and is logged as an anomaly.

### 4.5 Orphan Recovery

An orphaned run is one where the owning process crashed or lost connectivity without releasing the lease. Detection is passive: the next acquisition attempt finds an expired lease and acquires over it.

The recovery sequence is:

1. The Lease Manager acquires the expired lease with a new token.
2. The Scheduler queries amaia_sync_runs for the last run by the previous owner on this domain with status = 'running'.
3. That run's status is updated to 'orphan_recovered' and reason_code = 'LEASE_EXPIRED_ORPHAN'.
4. A new amaia_sync_runs row is created with supersedes_run_id pointing to the orphaned run and started_by_recovery = true.
5. The new run reads the watermark (which was never advanced by the orphan, since advancement requires success) and begins a fresh incremental cycle.

The orphan's upserted data (if any) is harmless: the upsert is idempotent, and the overlap window ensures the same rows will be fetched again.

### 4.6 Double Execution Prevention

The fencing token is the sole mechanism for preventing double execution. No other mechanism (PID files, OS-level locks, database advisory locks) is used.

The invariant is: at any point in time, at most one process holds a valid (unexpired, token-matched) lease for a given entity_name. Any write operation (upsert, watermark advance) must verify the token before proceeding. A stale token is proof of supersession, and the holder must stop.

This guarantee holds even under network partitions: if process A loses connectivity to Supabase but continues running, and process B acquires the expired lease with a higher token, process A's next write attempt will fail the token check. The window of vulnerability is bounded by the lease TTL.

---

## 5. Watermark Advancement Rules

### 5.1 Successful Advancement

The watermark is advanced to upper_bound if and only if all of the following conditions are true:

1. Every page in the incremental window [lower_bound, upper_bound] has been fetched from AMAIA.
2. Every fetched row has been either upserted to Supabase or explicitly skipped with a recorded quality issue.
3. The caller's lease token still matches the current token in amaia_sync_leases at the moment of advancement.
4. The proposed new value (upper_bound) is strictly greater than the current watermark value.

If all conditions are met, the watermark is advanced and the run is recorded as 'success'.

If conditions 1 and 2 are met but some rows were skipped due to quality issues, the watermark is still advanced (the skipped rows are tracked, not lost) and the run is recorded as 'success' with reason_code = 'SUCCESS_WITH_QUALITY_ISSUES'.

### 5.2 Blocked Advancement

The watermark is NOT advanced if any of the following are true:

1. Any page fetch from AMAIA failed (MySQL error, timeout, connection loss).
2. Any batch upsert to Supabase failed (write error, connection loss).
3. The lease token was invalidated (superseded by another process).
4. The proposed new value would regress the watermark (should never happen, but the check is defensive).

In all blocked cases, the run is recorded as 'failed' with the appropriate reason_code. The watermark retains its previous value. The next run will start from the same watermark_before, applying the same overlap window, producing the same lower_bound. The upper_bound will be recalculated fresh (it is not preserved across logical runs — only across retries of the same logical run).

### 5.3 Logical Rollback

There is no watermark rollback mechanism. The watermark only moves forward. If a sync run introduced incorrect data, the correction path is:

1. Fix the normalization logic that produced incorrect data.
2. Run a reconciliation cycle that detects the drift.
3. The next incremental run re-fetches and re-upserts the corrected data within the overlap window.

If the affected rows fall outside the overlap window, a manual operator intervention is required: either temporarily increase the overlap window or trigger a full-domain resync by resetting the watermark to a known-good value. This is a deliberate operator action, not an automated rollback.

### 5.4 Retry Behavior

When a run fails and is retried (same logical run, incremented attempt_number), the retry uses the same lower_bound and the same upper_bound as the original attempt. The upper_bound is fixed at the start of the logical run and does not change on retry. This prevents the retry from seeing a larger window than the original attempt, which could introduce ordering anomalies.

The retry reads a fresh watermark_before (which should be identical to the original, since the failed run did not advance it) and verifies that it matches expectations. If it does not match (indicating another process advanced it in the interim), the retry is abandoned and a new logical run begins instead.

### 5.5 Orphan Recovery and Watermark

When an orphaned run is recovered, the watermark is read fresh. Since the orphan never advanced the watermark (advancement requires success, and the orphan failed or crashed), the watermark is in the same state as before the orphan started. The recovery run begins a new logical run with a fresh upper_bound — it does not inherit the orphan's upper_bound.

---

## 6. Retry and Recovery Strategy

### 6.1 MySQL Errors

**Symptom:** Connection refused, query timeout, protocol error, or unexpected result set.

**Behavior:** The domain processor terminates the current page fetch. No further pages are fetched. The run is recorded as 'failed' with reason_code = 'MYSQL_ERROR' or 'CONNECTION_TIMEOUT'.

**Retry policy:** Exponential backoff starting at 30 seconds, doubling on each attempt, capped at 5 minutes. Maximum 3 retry attempts per logical run. Each retry creates a new amaia_sync_runs row with previous_attempt_run_id linking to the prior attempt.

**Justification:** AMAIA MySQL is a production system under load. Aggressive retry would amplify the problem. 3 attempts with exponential backoff gives the source system time to recover from transient issues (connection pool exhaustion, slow queries) without abandoning the run prematurely.

### 6.2 Supabase Errors

**Symptom:** Write failure on upsert, permission denied, constraint violation, connection loss.

**Behavior:** The domain processor stops the upsert batch. No further batches are written. The watermark is not advanced. The run is recorded as 'failed' with reason_code = 'SUPABASE_ERROR'.

**Retry policy:** Same as MySQL errors: exponential backoff from 30 seconds, max 3 attempts. A constraint violation (e.g., unexpected unique conflict) is not retried — it indicates a schema mismatch, recorded as 'SCHEMA_MISMATCH'.

**Justification:** Supabase write failures are typically either transient (connection issues, rate limiting) or permanent (constraint violations, permission changes). Exponential backoff handles the transient case; the SCHEMA_MISMATCH classification handles the permanent case without wasting retry attempts.

### 6.3 Timeout

**Symptom:** A single page fetch or batch upsert exceeds the configured operation timeout.

**Behavior:** The operation is cancelled. The run follows the same path as the corresponding error type (MYSQL_ERROR for fetch timeouts, SUPABASE_ERROR for upsert timeouts).

**Retry policy:** Same exponential backoff. On retry, the page size may be reduced (halved) to lower the probability of a repeat timeout. Page size reduction is logged as evidence.

**Justification:** Timeouts on large pages are often caused by result set size rather than system unavailability. Reducing page size on retry addresses the root cause for volume-related timeouts while the exponential backoff handles system-level issues.

### 6.4 Loss of Connectivity

**Symptom:** Complete loss of network connectivity to either AMAIA MySQL or Supabase.

**Behavior:** Indistinguishable from a timeout at the operation level. The first operation that fails triggers the same error path.

**Retry policy:** Same exponential backoff. If all 3 retries fail, the logical run is marked as 'failed'. The Scheduler does not attempt a new logical run for this domain until the next scheduled tick.

**At the Scheduler level:** If multiple domains fail consecutively with CONNECTION_TIMEOUT, the Scheduler enters a global cooldown period (configurable, default 10 minutes) during which no new domain runs are initiated. This prevents the Scheduler from exhausting retry budgets across all domains during a system-wide outage.

### 6.5 Process Crash

**Symptom:** The sync engine process terminates unexpectedly (segfault, OOM kill, unhandled exception).

**Behavior:** All held leases become orphans. No cleanup is performed by the crashed process.

**Recovery:** On restart, the Scheduler resumes from its static domain registry. Each domain's lease state is evaluated on the first scheduled tick. Expired leases are acquired with orphan recovery (Section 4.5). Non-expired leases are skipped (the previous process may have been killed recently and the lease has not yet expired).

**Justification:** Crash recovery is handled entirely by the lease expiration mechanism. No PID files, no lock files, no "last known state" persistence outside of amaia_sync_leases and amaia_sync_watermarks. This keeps recovery stateless and eliminates the class of bugs where stale crash markers prevent startup.

### 6.6 VM Crash or Restart

**Symptom:** The entire VM AMAIASQL restarts.

**Behavior:** Identical to process crash from the sync engine's perspective. All leases become orphans.

**Recovery:** Same as process crash. The sync engine starts fresh, evaluates all leases, recovers orphans.

**Additional consideration:** The VM restart may also affect AMAIA MySQL (if running on the same machine). The Scheduler's global cooldown mechanism (6.4) prevents repeated connection failures from consuming retry budgets during the MySQL startup period.

### 6.7 Lease Expired During Execution

**Symptom:** A heartbeat call returns zero affected rows, indicating the lease token no longer matches.

**Behavior:** The domain processor terminates immediately. No further fetches, no further upserts, no watermark advancement. The run is recorded as 'failed' with reason_code = 'LEASE_LOST_RACE'.

**Retry policy:** No automatic retry within the same scheduler tick. The lease is now held by another process. Retrying would mean competing for the lease, which defeats the mutual exclusion guarantee.

**Justification:** A lost lease is not a transient error — it means another process has legitimately acquired the lease. The correct behavior is to yield, not to compete. The other process will complete the work.

---

## 7. Reconciliation Strategy

### 7.1 Reconciliation Levels

Three levels of reconciliation are defined, corresponding to the reconciliation_level CHECK constraint in amaia_sync_reconciliation_results (9.2 migration 010).

**Daily reconciliation:** Count-level comparison only. For each domain, compare SELECT COUNT(*) from AMAIA against SELECT COUNT(*) from Supabase WHERE sync_status = 'active'. Record source_count, destination_count, drift. This is cheap (two count queries) and detects gross discrepancies.

**Weekly reconciliation:** Count-level comparison plus id-set comparison. For each domain, retrieve the full set of amaia_id values from both sources and compute the symmetric difference. Record orphan_row_count (in Supabase but not in AMAIA), tombstone_candidate_count (missing candidates for tombstone evaluation), and late_update_count (present in both but with mismatched modification indicators).

**Full reconciliation (monthly):** Row-level field comparison for a configurable subset of domains. For small domains (beneficiario: 2,237 rows, red: 4,621 rows), compare every field of every active row. For large domains (control_llamadas, logestado), compare a statistical sample. Record all discrepancy types.

### 7.2 Domain-Specific Cadences

| Domain | Daily | Weekly | Full (monthly) |
|---|---|---|---|
| control_llamadas | Count | Count + id-set | Sample (1%) |
| logestado | Count | Count + id-set | Sample (1%) |
| beneficiario | Count | Count + id-set | Full row-level |
| red | Count | Count + id-set + sample field | Full row-level |
| alerta | Count | Count + id-set + active field | Full row-level (active only) |
| enfermedades | Count | Count + id-set | Full row-level |
| medicamentos | Count | Count + id-set | Full row-level |

**Justification for red's elevated weekly cadence:** The 80% NULL updatedAt rate (9.1D) means incremental sync is blind to in-place updates that do not touch updatedAt. Weekly field sampling compensates for this specific weakness.

**Justification for alerta's elevated weekly cadence:** The indirect detection mechanism (logestado-driven) means any alert change not accompanied by a logestado entry is invisible to incremental sync. The 33 historical anomalies (9.1D V-006) prove this has happened.

### 7.3 Drift Detection

Drift is defined as: source_count != destination_count (at count level) or non-empty symmetric difference of amaia_id sets (at id-set level) or field value mismatch for the same amaia_id (at row level).

When drift is detected:

1. The reconciliation_results row records drift > 0 and the specific counts (orphan_row_count, late_update_count, etc.).
2. The corresponding amaia_sync_runs row (if the reconciliation was triggered as part of a sync cycle) receives reconciliation_status = 'drift_detected'.
3. No automatic correction is applied in V1. Drift is recorded, not repaired. The operator reviews the reconciliation results and decides the correction strategy.

**Justification for no automatic correction:** Automatic correction requires a conflict resolution policy (source-wins, destination-wins, merge). In V1, with read-only access to AMAIA, source-wins is the only viable policy. However, automatic source-wins correction could mask bugs in the normalization layer by silently overwriting corrected data. Manual review in V1 builds the empirical evidence needed to safely automate in V2.

### 7.4 Tombstone Detection

Tombstones are rows present in Supabase with sync_status = 'active' but absent from AMAIA. They are detected exclusively during weekly or full reconciliation (never during incremental sync).

The tombstone lifecycle follows the state machine defined in 9.1C and materialized in amaia_sync_tombstone_events (9.2 migration 011):

**Cycle 1 — Detection:** The id-set comparison finds amaia_id X in Supabase but not in AMAIA. A tombstone_events row is inserted with transition = 'detected'. No change to sync_status.

**Cycle 2 — Confirmation:** The next reconciliation cycle re-checks amaia_id X. If still absent from AMAIA, a tombstone_events row is inserted with transition = 'confirmed', and the destination row's sync_status is updated to 'missing_pending_confirmation'.

**Operator review:** An operator reviews missing_pending_confirmation rows and either confirms the removal (sync_status → 'inactive_confirmed') or flags it as a false positive.

**Reversion:** If amaia_id X reappears in AMAIA at any point before operator confirmation, a tombstone_events row is inserted with transition = 'reverted'. The sync_status is returned to 'active'. This handles the case where AMAIA temporarily hid a row (e.g., during a maintenance window).

**Justification for 2-cycle grace:** A single absence could be caused by a transient AMAIA issue (partial backup restore, temporary filter, connectivity issue during reconciliation). Requiring 2 consecutive absences across 2 independent reconciliation runs makes false-positive tombstones extremely unlikely.

---

## 8. Correlation Issues Strategy

### 8.1 Purpose

amaia_correlation_issues (9.2 migration from Fase 9.1 base) records cross-domain referential anomalies that exist in AMAIA's source data and are inherited by the sync without being caused by the sync.

These anomalies cannot be resolved by the sync engine. They require operator awareness and, potentially, action on the AMAIA side (which the sync engine cannot perform — read-only access, per project constraint).

### 8.2 Issue Types

**Alerts without logestado:** An alert exists in amaia_alerts but has zero corresponding entries in amaia_alert_logs (logestado). 9.1D V-006 found 33 such alerts. These are historical: they existed before the sync engine was built. However, new instances could appear if AMAIA's internal logic creates an alert without logging a state change.

**Orphan references:** A red (support network) entry references a beneficiario amaia_id that does not exist in amaia_beneficiaries. Or a health context entry references a beneficiario amaia_id that does not exist. These indicate referential integrity issues in AMAIA's source data.

**Inconsistencies of origin:** A logestado entry references an alert amaia_id that does not exist in amaia_alerts. This would indicate that the alert was synced incompletely or that the logestado references a deleted alert.

**Historical anomalies:** Any anomaly that existed before the sync engine's first run. These are detected during the initial full reconciliation and recorded with a flag indicating they are pre-existing, not caused by the sync.

### 8.3 Issue Lifecycle

**Detection:** The Correlation Engine runs after all domain processors complete in a sync cycle. It executes cross-domain referential checks (e.g., LEFT JOIN amaia_alerts a ON ... WHERE alert_log.alert_amaia_id NOT IN (SELECT amaia_id FROM amaia_alerts)). New anomalies are inserted into amaia_correlation_issues with status = 'open' and the current run_id.

**Persistence:** Each issue records: the two domains involved, the specific amaia_id values, the type of anomaly, and the run during which it was detected. Issues are not deduplicated — if the same anomaly persists across multiple runs, it appears once (the original detection), not once per run. Subsequent detections update the last_seen timestamp.

**Resolution:** If a subsequent Correlation Engine run finds that the anomaly no longer exists (e.g., AMAIA added the missing logestado entry), the issue's status is updated to 'resolved' with the resolving run_id.

**Escalation:** Issues that remain 'open' beyond a configurable threshold (default: 7 days) are flagged for operator review. The sync engine does not take automatic action — it records and reports.

**Archival:** Resolved issues are retained indefinitely for audit purposes. They are never deleted.

### 8.4 Relationship to Sync Operations

Correlation issues do not block sync operations. An alert without logestado is synced normally — its alert_status_id reflects whatever AMAIA reports. The correlation issue is an informational flag, not a processing gate.

The only exception: if a correlation issue indicates that a domain processor's output may be incomplete (e.g., a batch of logestado entries references alerts that have not yet been synced), the Scheduler may defer the Correlation Engine run until the dependent domain has been processed. This is an ordering optimization, not a blocking dependency.

---

## 9. Observability Strategy

### 9.1 Metrics

All metrics are derived from amaia_sync_runs. No external metrics system is required in V1.

**Per-run metrics (recorded in each amaia_sync_runs row):**
- rows_fetched: total rows returned by AMAIA queries.
- rows_upserted: total rows successfully written to Supabase.
- Duration: derived from started_at and completed_at timestamps.
- Attempt number: retry count within the logical run.
- Reason code: precise outcome classification.

**Aggregate metrics (derived by querying amaia_sync_runs):**
- Success rate per domain: COUNT(status='success') / COUNT(*) over a time window.
- Average run duration per domain.
- Retry rate per domain: COUNT(attempt_number > 1) / COUNT(*).
- Orphan recovery rate: COUNT(started_by_recovery=true) over a time window.
- Lease contention rate: COUNT(status='skipped_lock_held') over a time window.

### 9.2 Logs

The sync engine emits structured logs (JSON format) to stdout. Log levels:

- **INFO:** Run start, run completion, watermark advanced, lease acquired, lease released.
- **WARN:** Quality issues encountered (rows skipped), heartbeat approaching TTL, reconciliation drift detected, correlation issue opened.
- **ERROR:** Run failed, lease lost, MySQL error, Supabase error, schema mismatch.

Each log entry includes: timestamp, domain_name, run_id, lease_token, owner_identity. This enables correlation of log entries with amaia_sync_runs rows.

### 9.3 Evidence

The evidence model is the amaia_sync_runs table itself, with the rich fields added in 9.2 migration 013. Every run produces a complete evidence record:

- **Input evidence:** watermark_before_id/timestamp, lower_bound, upper_bound, overlap_applied.
- **Execution evidence:** lease_token, owner_identity, attempt_number, previous_attempt_run_id, supersedes_run_id, started_by_recovery.
- **Output evidence:** watermark_after_id/timestamp, rows_fetched, rows_upserted, status, reason_code, reconciliation_status.

This evidence is sufficient to reconstruct the complete execution history of any domain without relying on logs (which may be lost on VM restart).

### 9.4 Audit

An external auditor (Codex) can verify the integrity of the sync by querying amaia_sync_runs:

- **Watermark continuity:** For each domain, the sequence of watermark_after values across successful runs must be monotonically increasing with no gaps larger than the overlap window.
- **Lease integrity:** For each domain, no two runs with status = 'running' should overlap in time (started_at/completed_at).
- **Retry integrity:** For each chain of previous_attempt_run_id links, all attempts must share the same lower_bound and upper_bound.
- **Orphan accounting:** Every run with status = 'orphan_recovered' must have exactly one corresponding run with supersedes_run_id pointing to it.
- **Reconciliation coverage:** For each domain, reconciliation runs must occur at or above the cadences defined in Section 7.2.

### 9.5 Traceability

End-to-end traceability from a Supabase destination row back to the AMAIA source:

1. Each destination row has an amaia_id column linking to the AMAIA primary key.
2. The amaia_sync_runs table records which run upserted data for each domain within a specific [lower_bound, upper_bound] window.
3. The owner_identity field on each run identifies the exact process, host, and worker that performed the operation.
4. For health context rows, the source_id column provides an additional direct pointer to the originating AMAIA row, independent of the dedup hash.

---

## 10. QA Strategy

### 10.1 First Load (Initial Sync)

**Objective:** Verify that the sync engine correctly performs a full initial load for each domain when no watermark exists.

**Test conditions:**
- All watermarks are at their initial seed values (as set by 9.2 migration from Fase 9.1 base: last_id = 0 or last_timestamp = epoch).
- No data exists in any Supabase destination table.

**Verification criteria:**
- After completion, the count of rows in each Supabase destination table matches the count of rows in the corresponding AMAIA source table.
- The watermark for each domain has advanced to the maximum observed value.
- Each domain has exactly one amaia_sync_runs row with status = 'success'.
- No correlation issues are generated for the initial load itself (the Correlation Engine runs after load and may detect pre-existing AMAIA anomalies, which is expected behavior, not a test failure).
- For health context domains: dedup index works correctly — duplicate source entries produce fewer destination rows than source rows, and the difference equals the number of confirmed duplicates.

### 10.2 Empty Incremental

**Objective:** Verify correct behavior when no new data exists in AMAIA since the last successful sync.

**Test conditions:**
- All watermarks are at their post-initial-load values.
- No changes have been made in AMAIA since the last sync.

**Verification criteria:**
- Each domain processor runs, fetches zero rows (or only rows within the overlap window that are already present), upserts zero net-new rows.
- The watermark advances to the new upper_bound (which may be identical to watermark_before for id-based domains or slightly later for timestamp-based domains).
- Each domain has an amaia_sync_runs row with status = 'success', rows_fetched >= 0 (overlap rows), rows_upserted = 0 (all ON CONFLICT hits).
- No errors, no quality issues, no correlation issues generated.

### 10.3 Incremental with Data

**Objective:** Verify correct incremental sync when new data has been added to AMAIA.

**Test conditions:**
- At least one domain has new rows in AMAIA since the last sync.
- For timestamp-based domains: at least one row has a timestamp within the overlap window (to verify idempotent re-upsert).

**Verification criteria:**
- New rows appear in the Supabase destination table.
- Pre-existing rows within the overlap window are re-upserted without duplication (row count stable).
- Watermark advances past the new rows.
- amaia_sync_runs records the correct rows_fetched and rows_upserted counts.
- For alerta domain: new logestado entries trigger refetch of their parent alerts, and those alerts' field values in Supabase match AMAIA.

### 10.4 Retry

**Objective:** Verify that transient failures trigger retry with correct behavior.

**Test conditions:**
- Simulate a MySQL connection failure on the second page of a multi-page fetch.
- Simulate a Supabase write failure on a batch upsert.

**Verification criteria:**
- The failed run is recorded with the appropriate reason_code.
- A retry run is initiated with incremented attempt_number and previous_attempt_run_id linking to the failure.
- The retry uses the same lower_bound and upper_bound as the original.
- On retry success, the watermark advances.
- The exponential backoff delay between attempts matches the configured policy.
- After max retries exceeded, the logical run is marked 'failed' and no further retries are attempted until the next scheduled tick.

### 10.5 Recovery (Orphan)

**Objective:** Verify that an orphaned run is correctly detected and recovered.

**Test conditions:**
- Simulate a process crash by leaving a lease with an expired TTL and a corresponding amaia_sync_runs row with status = 'running'.

**Verification criteria:**
- On next scheduler tick, the expired lease is acquired with a new (higher) token.
- The orphaned run's status is updated to 'orphan_recovered'.
- A new run is created with supersedes_run_id pointing to the orphan and started_by_recovery = true.
- The new run reads the watermark (unchanged, since the orphan never advanced it) and completes a fresh sync cycle.
- The recovery run's lease_token is strictly greater than the orphan's.

### 10.6 Reconciliation

**Objective:** Verify that each reconciliation level correctly detects discrepancies.

**Test conditions:**
- Inject a known discrepancy: delete one row from a Supabase destination table (simulating data loss), and add one row directly to a Supabase destination table with a non-existent amaia_id (simulating an orphan).

**Verification criteria:**
- Daily reconciliation: detects count mismatch (drift != 0).
- Weekly reconciliation: identifies the specific amaia_id that is missing (tombstone candidate) and the specific amaia_id that is orphaned (orphan_row_count > 0).
- amaia_sync_reconciliation_results records all counts correctly.
- Tombstone state machine is initiated for the missing row (transition = 'detected').
- On second reconciliation cycle: tombstone is confirmed (transition = 'confirmed'), sync_status updated to 'missing_pending_confirmation'.

### 10.7 Tombstones

**Objective:** Verify the complete tombstone lifecycle including the 2-cycle grace period.

**Test conditions:**
- A row exists in Supabase but is absent from AMAIA.

**Verification criteria:**
- First reconciliation: tombstone_events row with transition = 'detected'. sync_status remains 'active'.
- Second reconciliation: tombstone_events row with transition = 'confirmed'. sync_status updated to 'missing_pending_confirmation'.
- If the row reappears in AMAIA between cycles: tombstone_events row with transition = 'reverted'. sync_status returns to 'active'.
- Reversion is possible at any point before operator confirmation.
- After operator marks 'inactive_confirmed': no further tombstone processing occurs for that amaia_id.

### 10.8 Duplicates (Health Context)

**Objective:** Verify that the dedup index correctly handles duplicate source entries.

**Test conditions:**
- Two AMAIA source rows for the same beneficiary with identical text (after canonicalization) but different source_id values. This scenario was confirmed real in 9.1D V-005.

**Verification criteria:**
- Both rows are fetched from AMAIA.
- Both rows produce the same canonical_text, hash, and hash_version after normalization.
- The upsert ON CONFLICT on (beneficiary_amaia_id, hash, hash_version) results in a single destination row.
- The surviving row's source_id reflects the last upserted value (source-wins, since the two source rows are semantically identical).
- rows_upserted in amaia_sync_runs accounts for the dedup correctly (not counted as an error).
- No quality issue or correlation issue is generated for this expected behavior.

### 10.9 Correlation

**Objective:** Verify that cross-domain anomalies are correctly detected and tracked.

**Test conditions:**
- Sync an alert that has zero logestado entries (reproducing the 33 historical anomalies found in 9.1D V-006).
- Sync a logestado entry that references an alert amaia_id not yet present in amaia_alerts (timing issue due to processing order).

**Verification criteria:**
- The alert-without-logestado anomaly is recorded in amaia_correlation_issues with status = 'open'.
- The orphan logestado reference is detected and recorded (or, if processing order is correct per Section 3.2, this anomaly should not occur — which validates the ordering constraint).
- If the anomaly resolves on a subsequent run (the missing logestado appears, or the missing alert is synced), the issue's status is updated to 'resolved'.
- Correlation issues do not block or alter normal sync processing.
- The 33 historical anomalies from 9.1D are correctly recorded as pre-existing issues on the initial correlation run.

---

## Appendix A: Domain Configuration Reference

| Domain | entity_name | watermark_type | watermark_expr | overlap_window | Priority |
|---|---|---|---|---|---|
| control_llamadas | control_llamadas | id | N/A | 0 | 1 (high) |
| logestado | logestado | id | N/A | 0 | 1 (high) |
| beneficiario | beneficiario | timestamp | COALESCE(updatedAt, createAt) | 15 min | 2 (medium) |
| red | red | timestamp | COALESCE(updatedAt, createAt) | 15 min | 2 (medium) |
| alerta | alerta | indirect (via logestado) | N/A | 5 min (on logestado side) | 1 (high, but processed after logestado) |
| enfermedades | enfermedades | id | N/A | 0 | 3 (low) |
| medicamentos | medicamentos | id | N/A | 0 | 3 (low) |

## Appendix B: Processing Order

The Scheduler must respect the following ordering constraints:

1. **logestado before alerta.** Alerta processing depends on logestado entries to detect changes. Processing alerta first would create a window where the Correlation Engine could flag false-positive "alert without logestado" issues.

2. **beneficiario before red.** Red entries reference beneficiario amaia_id values. Processing beneficiario first ensures the referential target exists before the referencing row is synced, preventing transient correlation issues.

3. **beneficiario before enfermedades and medicamentos.** Health context entries reference beneficiario amaia_id values. Same rationale as red.

4. **control_llamadas has no ordering dependency.** It can run in any position.

A valid processing order is: control_llamadas → logestado → alerta → beneficiario → red → enfermedades → medicamentos. Alternative valid orders exist as long as the three constraints above are satisfied.

## Appendix C: Lease Configuration

| Parameter | Value | Justification |
|---|---|---|
| Lease TTL | 5 minutes | Balances crash detection speed against heartbeat overhead. A crashed process is detected within 5 minutes. |
| Heartbeat interval | 2 minutes | Less than half the TTL, ensuring a healthy process always renews before expiration. |
| Max retries per logical run | 3 | Sufficient for transient failures without exhausting resources during persistent outages. |
| Initial backoff | 30 seconds | Gives the source/destination system time to recover from transient issues. |
| Max backoff | 5 minutes | Prevents excessively long waits between retries. |
| Global cooldown (multi-domain failure) | 10 minutes | Prevents retry budget exhaustion during system-wide outages. |

## Appendix D: Reconciliation Schedule

| Level | Cadence | Domains | Cost |
|---|---|---|---|
| Daily (count) | Every 24 hours | All 7 domains | 14 COUNT queries (2 per domain) |
| Weekly (id-set) | Every 7 days | All 7 domains | 14 full-id-set queries + set comparison |
| Weekly (field sample) | Every 7 days | red, alerta | Configurable sample size (default 10%) |
| Monthly (full row-level) | Every 30 days | beneficiario, red, alerta, enfermedades, medicamentos | Full field comparison, small domains only |
| Monthly (sample row-level) | Every 30 days | control_llamadas, logestado | 1% sample |

## Appendix E: Reason Code Catalog

| reason_code | Terminal status | Retryable | Description |
|---|---|---|---|
| SUCCESS | success | N/A | All pages fetched and upserted, watermark advanced. |
| SUCCESS_WITH_QUALITY_ISSUES | success | N/A | Watermark advanced but some rows were skipped during normalization. |
| LEASE_HELD | skipped_lock_held | No | Another process holds an active lease for this domain. |
| LEASE_LOST_RACE | failed | No | Lease token was superseded during execution. |
| LEASE_EXPIRED_ORPHAN | orphan_recovered | N/A | Applied to the orphaned run, not the recovering run. |
| CONNECTION_TIMEOUT | failed | Yes | Network timeout reaching AMAIA or Supabase. |
| MYSQL_ERROR | failed | Yes | AMAIA MySQL returned an error. |
| SUPABASE_ERROR | failed | Yes | Supabase write operation failed. |
| SCHEMA_MISMATCH | failed | No | Unexpected constraint violation or missing column. |
| RECONCILIATION_DRIFT | success* | N/A | Run succeeded but reconciliation detected drift. *Status is 'success'; drift is recorded in reconciliation_status. |
| QUALITY_ISSUES | failed | No | Quality issues exceeded the configurable threshold. |
| ABANDONED_BY_OPERATOR | abandoned | No | Operator manually terminated the run. |
| UNKNOWN_ERROR | failed | Yes | Unclassified error. Investigated before next scheduled run. |

---

**End of document.**
