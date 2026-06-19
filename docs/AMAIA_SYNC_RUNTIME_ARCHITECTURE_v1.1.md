# AMAIA-SYNC Runtime Architecture v1.1

**Phase:** 9.3 Rev.2  
**Status:** Design — no implementation  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.0.md  
**Prerequisite phases:** 9.1D (empirical validation, closed), 9.2 (schema deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Auditor:** Codex (auditor forense)  
**Date:** 2026-06-18

---

## Executive Summary

This document is a targeted revision of v1.0, not a redesign. Codex audited v1.0 and identified 5 critical and 2 medium findings. All corrections in this revision address those findings exclusively. No approved architecture from phases 9.1D or 9.2 is modified. No deployed table is altered. The watermark model, lease model, reconciliation model, correlation model, and health context model remain unchanged.

The five critical corrections are:

1. The alerta domain's dependency on logestado now uses a durable, derived workset backed by a dedicated trigger cursor, eliminating the risk of lost alert changes after a crash between logestado watermark advance and alert processing.
2. Lease fencing is strengthened from check-then-write (vulnerable to TOCTOU) to transactional fencing, where token verification and data write execute within the same database transaction under an exclusive row lock.
3. Empty incremental runs (zero rows, watermark unchanged) receive a single, unambiguous semantic definition.
4. Tombstones that have reached inactive_confirmed can be reactivated if the source row reappears in AMAIA, closing the permanent-invisibility risk.
5. Alert reconciliation coverage is extended from active alerts only to a tiered strategy covering active, closed, and historical alerts.

The two medium corrections are:

6. An explicit operational barrier prevents reconciliation from observing partially-written sync state.
7. The logestado-to-alerta processing dependency is elevated from a scheduling convention to an enforced guarantee with defined completeness, success, and blocking criteria.

All corrections are compatible with the Phase 9.2 schema as deployed. Corrections 1 and 4 require minor data-level changes (one watermark row update, no DDL) that will be executed in the implementation phase.

---

## Changes from v1.0

All section and appendix numbers below refer to v1.0. Items marked [NEW] have no v1.0 counterpart.

1. **Section 1.4 (Domain Processors):** Alerta processor now receives a derived workset from the Scheduler instead of an opaque "refetch queue." The workset derivation mechanism is specified in Critical Correction 1.
2. **Section 2, Step 3 (Build Incremental Window):** Alerta domain is excluded from the generic window-building step. Its window is replaced by the trigger cursor mechanism described in Critical Correction 1.
3. **Section 2, Step 6 (Upsert to Supabase):** Token verification before each batch is replaced by transactional fencing as described in Critical Correction 2. The heartbeat remains but is decoupled from the fencing guarantee.
4. **Section 3.5 (alerta domain strategy):** Rewritten to reflect the durable workset and trigger cursor. The statement "The alerta processor itself does not maintain its own watermark" is retracted — alerta maintains a trigger cursor watermark tracking logestado consumption.
5. **Section 4.2 (Heartbeat):** Heartbeat is clarified as a liveness signal for lease TTL extension. It is no longer described as the fencing mechanism. Fencing is handled by transactional locks per Critical Correction 2.
6. **[NEW] Empty incremental semantics:** Defined in Critical Correction 3. Replaces the implicit behavior in v1.0 Section 2.
7. **Section 7.4 (Tombstone Detection):** Extended with a resurrection path (Critical Correction 4). The 'reverted' transition now applies at any stage of the tombstone lifecycle, including after inactive_confirmed.
8. **Section 7.2 (Domain-Specific Cadences):** Alerta reconciliation row updated to reflect tiered coverage (Critical Correction 5).
9. **[NEW] Sync-reconciliation execution barrier:** Defined in Medium Correction 1.
10. **[NEW] Logestado-alerta handoff guarantee:** Defined in Medium Correction 2. Replaces the v1.0 ordering convention in Appendix B.

---

## Critical Correction 1: Durable Alert Workset

### Problem Statement

v1.0 defined the alerta processor as "driven by logestado" and stated it "does not maintain its own watermark." When logestado sync identifies new entries, the set of affected alert amaia_ids is passed to the alerta processor for refetching. v1.0 treated this set as an in-memory data structure passed between processors within the same cycle.

Codex identified the fatal flaw: if the process crashes after logestado's watermark has been advanced but before the alerta processor consumes the workset, the affected alerts are never refetched. The logestado watermark has moved past those entries, so they will never be re-derived on restart. Alert state changes are permanently lost.

This contradicts v1.0's own declaration that there is "no queue" — the in-memory workset was functioning as an implicit, non-durable queue.

### Architectural Correction

The alerta processor maintains a **trigger cursor** — a durable watermark that tracks the last logestado amaia_id it has successfully consumed. The workset is **derived on demand** from already-persisted data in Supabase, never held in memory as a queue.

### What is persisted

The trigger cursor is persisted as the alerta entry in amaia_sync_watermarks. The existing seed row for alerta (currently watermark_type = 'timestamp', which is inutilizable per 9.1D V-003 finding that alerta.updateAt is 100% NULL) is repurposed:

- watermark_type: changed from 'timestamp' to 'id'.
- last_id: stores the last logestado amaia_id consumed by the alerta processor.
- last_timestamp: set to NULL (no longer used).
- watermark_expr: set to 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id' (descriptive metadata documenting the derivation path).
- source_table: remains 'alerta' (the domain's source data still comes from AMAIA's alerta table; the cursor mechanism is separate from the data source).

This is a data-level change (one UPDATE to an existing row), not a DDL change. The amaia_sync_watermarks schema supports it without modification.

### Where is persisted

In amaia_sync_watermarks, the same table and row that already exists for the alerta domain. No new table, no new row, no new column.

### How the workset is derived

On each alerta processing cycle:

1. Read the alerta trigger cursor: last_id = N (the last logestado amaia_id the alerta processor has consumed).
2. Read the logestado watermark: last_id = M (the most recent logestado amaia_id successfully synced by the logestado processor).
3. If N == M: no pending work. The cycle is an empty incremental (see Critical Correction 3).
4. If N < M: derive the workset by querying amaia_alert_logs in Supabase for all rows with amaia_id > N AND amaia_id <= M, extracting the distinct set of alert_amaia_id values. This query uses the existing index idx_amaia_alert_logs_amaia_id and the existing column alert_amaia_id (with its own index idx_amaia_alert_logs_alert_amaia_id).
5. The resulting set of alert_amaia_id values is the workset: the exact alerts that need to be refetched from AMAIA.

The workset is derived from data that is already durable in Supabase (amaia_alert_logs rows persisted by the logestado processor). It is not stored separately. It is not a queue. It is a deterministic query against committed state.

### When is the cursor advanced

The trigger cursor advances from N to M only after all alerts in the workset have been successfully fetched from AMAIA and upserted to Supabase. The advancement follows the same all-or-nothing rule as all other watermarks (9.1C): if any alert in the workset fails to sync, the cursor does not advance.

### When is the cursor eliminated

Never. The trigger cursor is a permanent watermark entry. It is not deleted after processing; it records durable progress.

### How retry participates

If the alerta processor fails mid-workset (e.g., AMAIA connection error while fetching the third alert in a set of ten), the run is recorded as 'failed'. The trigger cursor remains at N. On retry, the full workset is re-derived from the same query (amaia_id > N AND amaia_id <= M). The workset is identical because both N and M are unchanged. Alerts that were already upserted before the failure are re-upserted idempotently (ON CONFLICT on amaia_id).

The upper bound M is fixed for the duration of the logical run (including retries), consistent with the 9.1C rule that upper_bound is never recalculated on retry. If logestado advances further during the retry period (producing M' > M), those new entries are deferred to the next logical run.

### How orphan recovery participates

If the process crashes with the alerta lease held:

1. On restart, the lease is detected as expired and acquired via orphan recovery (Section 4.5 of v1.0, unchanged).
2. The trigger cursor is read: last_id = N (unchanged, since the crashed run never advanced it).
3. The logestado watermark is read: last_id = M (potentially advanced further if the logestado processor succeeded before or after the crash).
4. The workset is re-derived: all amaia_alert_logs rows with amaia_id > N AND amaia_id <= M.
5. Processing proceeds from scratch. All previously upserted alerts (if any) are re-upserted idempotently.

The orphaned run's supersedes_run_id chain is maintained as documented in v1.0.

### Auditability

Every alerta run records in amaia_sync_runs:
- watermark_before_id: the trigger cursor value at the start (N).
- watermark_after_id: the trigger cursor value after success (M), or NULL on failure.
- lower_bound: string representation of N.
- upper_bound: string representation of M.
- rows_fetched: count of distinct alerts fetched from AMAIA.
- rows_upserted: count of alerts successfully upserted.
- reason_code: standard catalog value.

This evidence fully reconstructs which logestado range was consumed and which alerts were refreshed.

---

## Critical Correction 2: Transactional Fencing

### Problem Statement

v1.0 specified that the domain processor "verifies that its lease token still matches by calling Lease Manager heartbeat" before each batch write. Codex identified the TOCTOU vulnerability:

1. Worker A calls heartbeat — token matches.
2. Worker A's lease expires (heartbeat was the last renewal, and TTL elapses before the write completes).
3. Worker B acquires the lease with a new fencing token.
4. Worker A's batch write proceeds and commits — stale write.

The gap between "verify token" and "write data" is exploitable by any delay: network latency, garbage collection pause, OS scheduling, large batch processing time. The heartbeat check and the data write are separate operations in separate database round-trips.

### Architectural Correction

**Principle: the fencing token verification and the data write must execute within the same database transaction, under an exclusive row lock on the lease entry. No operation may read the token in one database round-trip and write data in a separate one.**

### Mechanism

Each batch write executes within a single database transaction that performs the following operations atomically:

1. **Acquire exclusive row lock on the lease entry.** The transaction's first operation reads the current lease_token from amaia_sync_leases for the domain's entity_name, using an exclusive row lock. This lock ensures that no other process can modify the lease row (including acquiring or releasing the lease) until this transaction completes.

2. **Verify the fencing token.** The read token is compared to the writer's held token. If they do not match, the transaction rolls back immediately. No data is written.

3. **Execute the batch write.** If the token matches, the batch upsert to the domain's destination table proceeds within the same transaction.

4. **Commit.** The transaction commits, releasing the exclusive row lock. The batch write and the token verification are atomically committed together.

### Why this eliminates the TOCTOU

The exclusive row lock on the lease entry has two effects:

**Effect 1: Stale writers are detected before writing.** If Worker B has already acquired the lease (committed a new token), Worker A's lock acquisition in step 1 reads the committed new token and detects the mismatch in step 2. The transaction rolls back before any data is written.

**Effect 2: Concurrent lease acquisition is blocked during the batch.** If Worker A's token is still valid at step 1, the exclusive lock prevents Worker B from modifying the lease row until Worker A's transaction commits. Worker B's lease acquisition attempt blocks. When Worker A commits, the batch is written under a valid lease. Worker B then proceeds with its acquisition, and Worker A's next batch (if any) will detect the new token.

Together, these effects make it impossible for a stale writer to commit data after its lease has been superseded. The worst case is that Worker B's lease acquisition is delayed by the duration of Worker A's in-flight batch. This is correct behavior: Worker A legitimately holds the lease during that batch.

### Interaction with large batches

A large batch extends the duration of the exclusive row lock. This has two consequences:

**Consequence 1: Lease acquisition latency.** A concurrent lease acquirer blocks for the batch duration. For domains with large batches (e.g., initial load of control_llamadas), this could mean blocking for seconds or tens of seconds. This is acceptable: the acquirer is waiting because the current holder is actively working, not because it is stale.

**Consequence 2: Batch timeout.** If a batch transaction exceeds a configured statement timeout, the database engine cancels the transaction and releases the lock. The batch is rolled back. The run is recorded as 'failed' with reason_code = 'SUPABASE_ERROR'. This prevents a hung writer from holding the lock indefinitely.

The batch size is the tuning lever: smaller batches mean shorter lock hold times and finer-grained stale detection, at the cost of more transactional overhead. Larger batches reduce overhead but extend lock hold times. The optimal batch size is domain-specific and determined empirically during implementation.

### Interaction with heartbeat

The heartbeat remains as a liveness signal for the lease TTL. Its role is to extend lease_expires_at so that other processes do not consider the lease abandoned. The heartbeat is **not** the fencing mechanism — transactional fencing is.

The heartbeat operates outside of batch transactions. It is a standalone UPDATE to lease_expires_at and heartbeat_at, conditional on token match. If the heartbeat fails (token mismatch), the processor must not start a new batch transaction — but this is a courtesy early-exit, not the fencing guarantee itself. The fencing guarantee is provided by the batch transaction's exclusive lock.

### Watermark advancement

The watermark advance operation follows the same transactional fencing pattern. The transaction that advances the watermark also acquires an exclusive row lock on the lease entry and verifies the token. If the token has been superseded between the last batch commit and the watermark advance, the advance is rolled back and the run is recorded as 'failed'. The upserted data remains in Supabase and is idempotent — it will be covered by the next run's overlap window.

---

## Critical Correction 3: Empty Incremental Semantics

### Problem Statement

v1.0 did not define the exact behavior when a domain processor runs and finds no new data. Specifically, the case where watermark_before equals upper_bound (or the fetch returns zero rows outside the overlap window) was ambiguous: is this a success? Is the watermark advanced? What evidence is recorded?

### Architectural Correction

An empty incremental is a normal, successful run that found no new data. It receives the following unambiguous definition:

### Run status

**status = 'success'**. An empty incremental is not an error, not a skip, not a special case. It completed the full lifecycle (lease acquired, watermark read, window built, fetch executed, zero rows returned, watermark evaluated, lease released) without any failure.

### Reason code

**reason_code = 'SUCCESS'**. Finding zero rows is not a quality issue. It is the expected outcome when the source has not changed since the last sync.

### Watermark behavior

The watermark advance depends on the relationship between watermark_before and upper_bound:

**Case A: watermark_before < upper_bound.** The fetch returned zero rows in the range (lower_bound, upper_bound], but upper_bound is ahead of watermark_before. The watermark advances to upper_bound. This is correct: the engine has confirmed that no data exists in this range, and advancing prevents the same empty range from being re-scanned on the next run.

**Case B: watermark_before == upper_bound.** There is no range to scan. The watermark does not advance (advancing to the same value is a no-op). The run completes immediately after confirming there is no work.

In both cases, the run is recorded as 'success'.

### Metrics recorded

- rows_fetched: 0 (or the count of overlap-window rows re-scanned, which may be non-zero even when no new rows exist).
- rows_upserted: 0 (overlap re-scans are idempotent and count as 0 net new upserts).
- records_processed: 0.

### Evidence stored

A complete amaia_sync_runs row is created with all evidence fields populated:

- watermark_before_id or watermark_before_timestamp: the value read at start.
- watermark_after_id or watermark_after_timestamp: same as upper_bound (Case A) or NULL (Case B, since no advance occurred).
- lower_bound, upper_bound: the computed window.
- overlap_applied: the overlap window used.
- lease_token, owner_identity: the lease held during the run.
- status: 'success'.
- reason_code: 'SUCCESS'.
- attempt_number: 1 (no retry needed for an empty run).

This evidence allows an auditor to distinguish between "ran and found nothing" (healthy) and "did not run" (potential scheduling issue).

---

## Critical Correction 4: Tombstone Resurrection Path

### Problem Statement

v1.0 defined the tombstone lifecycle as: detected → confirmed → (operator review) → inactive_confirmed. The 'reverted' transition existed but was documented only for the case where a row reappears before confirmation. Codex observed that after a row reaches inactive_confirmed, there is no documented path back to active. If AMAIA re-introduces a previously removed row (or if the original absence was a transient AMAIA-side issue detected too late), the row remains invisible in Supabase permanently.

### Architectural Correction

The 'reverted' transition is extended to apply at **any stage** of the tombstone lifecycle, including after inactive_confirmed. The existing CHECK constraint on amaia_sync_tombstone_events.transition already includes 'reverted', so no schema change is required.

### Reactivation triggers

A tombstone at any stage is reactivated when the source row is confirmed to exist in AMAIA. There are two detection paths:

**Path 1: Reconciliation (primary).** During the id-set comparison phase of weekly or full reconciliation, the Reconciliation Engine compares amaia_ids present in AMAIA against those in Supabase. If an amaia_id that is present in Supabase with sync_status = 'missing_pending_confirmation' or 'inactive_confirmed' is also present in AMAIA, this is a resurrection signal.

**Path 2: Incremental sync (secondary).** During normal incremental processing, if a domain processor fetches a row from AMAIA whose amaia_id already exists in Supabase with sync_status != 'active', the upsert must include a reset of sync_status to 'active'. This handles the case where the resurrected row falls within the current watermark window.

### Reactivation sequence

Regardless of detection path, the reactivation sequence is:

1. A new row is inserted into amaia_sync_tombstone_events with transition = 'reverted' and the reconciliation_run_id or sync run_id that detected the reappearance.
2. The destination row's sync_status is updated to 'active'.
3. The destination row's field values are updated to match the current AMAIA source (via upsert on the next incremental run if detected by reconciliation, or within the same upsert if detected by incremental sync).

### Evidence required

The tombstone_events row for the 'reverted' transition records:
- The run_id that detected the reappearance (reconciliation_run_id or the sync run's id).
- The timestamp of detection.
- The domain_name and source_amaia_id of the resurrected row.

The full tombstone history for the amaia_id is preserved: detected → confirmed → reverted (or detected → confirmed → [operator action → inactive_confirmed] → reverted). This audit trail is sufficient to reconstruct the complete lifecycle.

### Interaction with reconciliation

The Reconciliation Engine explicitly checks rows with sync_status in ('missing_pending_confirmation', 'inactive_confirmed') against AMAIA source during every id-set reconciliation. These rows are not excluded from the comparison set. This ensures that resurrection is detected within the reconciliation cadence regardless of whether the row falls within the incremental watermark window.

### Interaction with incremental sync

The domain processor's upsert logic must handle rows where the destination sync_status is not 'active'. When upserting a row fetched from AMAIA, if the existing destination row has sync_status = 'missing_pending_confirmation' or 'inactive_confirmed', the upsert resets sync_status to 'active' and records the 'reverted' tombstone event. This is a single atomic operation — the upsert and the status reset occur in the same transaction.

### Permanence of inactive_confirmed

Operator-confirmed inactivation (inactive_confirmed) is not permanent. It is a human judgment that was correct at the time of confirmation. If AMAIA contradicts that judgment by re-introducing the row, the system trusts AMAIA (the source of truth for row existence) and reactivates. The operator is notified of the reactivation via the tombstone_events audit trail.

---

## Critical Correction 5: Alert Reconciliation Coverage

### Problem Statement

v1.0 specified "Weekly row-level field comparison on active alerts (alert_status_id in 0, 1, 2)." Codex identified that this excludes closed alerts (alert_status_id 3, 4, 5), which collectively represent a significant population (4,325 + 1,004 + 210 = 5,539 rows per 9.1D V-003). These alerts could diverge between AMAIA and Supabase without detection.

### Architectural Correction

Alert reconciliation uses a tiered strategy that covers the full population without converting AMAIA into a permanent full-table scan.

### Tier 1: Count and id-set (weekly, all alerts)

Every weekly reconciliation performs a full count comparison and id-set comparison across ALL alerts, regardless of alert_status_id. This detects gross discrepancies (missing rows, extra rows, tombstone candidates) in the entire population. Cost: two count queries plus one id-set query per side. Feasible at 58,031 rows.

### Tier 2: Active alert field comparison (weekly)

Alerts with alert_status_id in (0, 1, 2) receive a weekly row-level field comparison. These are the alerts most likely to change (they are still being worked on in AMAIA). This is unchanged from v1.0.

### Tier 3: Recently closed alert field comparison (monthly)

Alerts with alert_status_id in (3, 4, 5) that were closed within the last 90 days (determined by the most recent logestado entry for that alert) receive a monthly row-level field comparison. These alerts are unlikely to change but may receive late corrections or administrative updates within the first months after closure.

### Tier 4: Historical closed alert field comparison (quarterly)

Alerts with alert_status_id in (3, 4, 5) that have been closed for more than 90 days receive a quarterly row-level field comparison on a statistical sample (10% of the historical population, rotated). These alerts are stable and should not change. The sample provides ongoing verification without the cost of a full scan.

### Evidence registered

Each reconciliation run records in amaia_sync_reconciliation_results:
- reconciliation_level: 'daily', 'weekly', or 'full' (existing constraint).
- source_count, destination_count, drift: covering the tier's scope.
- orphan_row_count: rows present in Supabase but not in AMAIA within the tier's scope.
- late_update_count: field mismatches detected.
- The domain_name is 'alerta' for all tiers. The tier is identifiable from the combination of reconciliation_level and the executed_at cadence.

### Updated reconciliation table (replaces v1.0 Section 7.2 for alerta)

| Scope | Cadence | Content | Cost |
|---|---|---|---|
| All alerts | Weekly | Count + id-set | 2 counts + 1 id-set per side |
| Active (status 0-2) | Weekly | Row-level field comparison | ~52,000 rows |
| Recently closed (status 3-5, <90 days) | Monthly | Row-level field comparison | Variable, ~1,000-3,000 rows |
| Historical closed (status 3-5, >90 days) | Quarterly | 10% sample field comparison | ~500 rows |

---

## Medium Correction 1: Sync-Reconciliation Execution Barriers

### Problem Statement

v1.0 stated that the Reconciliation Engine "operates independently of domain processor runs — it does not hold a domain lease." Codex identified that this independence creates a risk: if reconciliation runs concurrently with a domain sync, it may observe partially-written state (e.g., half of a batch upserted, watermark not yet advanced), producing false drift signals.

### Operational Contract

The following barriers govern the relationship between sync and reconciliation:

**Barrier 1: Domain-level mutual exclusion.** Reconciliation for domain X must not execute while a domain processor for X holds an active lease. Before starting reconciliation for a domain, the Reconciliation Engine checks amaia_sync_leases for that entity_name. If owner_identity is not NULL and lease_expires_at is in the future, reconciliation for that domain is deferred to the next scheduled reconciliation cycle. The Reconciliation Engine does not acquire a lease — it merely observes lease state as a precondition.

**Barrier 2: Cross-domain consistency window.** For domains with ordering dependencies (logestado → alerta, beneficiario → red/enfermedades/medicamentos), reconciliation must not execute between the completion of the upstream domain's sync and the completion of the downstream domain's sync within the same cycle. Concretely: if logestado has synced but alerta has not yet processed the resulting workset, reconciliation of alerta would observe logestado entries without their corresponding alert updates, producing false orphan counts.

The Scheduler enforces this by running reconciliation only after all domain processors in the current cycle have completed (or been skipped). Reconciliation is a post-cycle activity, not an interleaved one.

**Barrier 3: Reconciliation does not write domain data.** The Reconciliation Engine writes only to amaia_sync_reconciliation_results, amaia_sync_tombstone_events, and sync_status columns. It never upserts domain data (field values, amaia_id assignments, business_status). This eliminates the risk of reconciliation interfering with an in-progress or upcoming sync.

**Barrier 4: Transient state tolerance.** If a reconciliation run detects drift, it records the drift but does not trigger automatic correction. This design (established in v1.0 Section 7.3 and unchanged) provides a natural tolerance for transient states: if the drift was caused by a partially-completed cycle that will resolve on the next sync, the next reconciliation run will show zero drift. Only persistent drift across multiple reconciliation cycles warrants operator attention.

---

## Medium Correction 2: Logestado-Alerta Handoff Guarantee

### Problem Statement

v1.0 Appendix B stated "logestado before alerta" as a processing order convention. Codex identified that a convention is insufficient — if the Scheduler deviates from this order (due to a bug, a configuration error, or an ad-hoc manual run), the alerta processor could derive an incomplete or stale workset.

### Operational Guarantee

The logestado-to-alerta dependency is elevated to an enforced invariant with three formal criteria:

### Completeness criterion

The alerta processor must not start until the logestado processor's most recent run in the current cycle has reached a terminal status ('success', 'failed', 'skipped_lock_held', or 'abandoned'). A logestado run with status = 'running' blocks alerta processing.

**Enforcement:** The Scheduler checks the status of the most recent amaia_sync_runs row for domain_name = 'logestado' and started_at within the current cycle's time window. If status = 'running', alerta is deferred.

### Success criterion

The alerta processor uses the logestado watermark as its upper bound (M in Critical Correction 1). This value is only meaningful if the logestado run that produced it was successful. If logestado failed, its watermark was not advanced, and the alerta processor's upper bound is the same as its trigger cursor — resulting in an empty incremental (no work to do).

**Consequence:** A failed logestado run does not block alerta processing — it simply means alerta has nothing new to process. The alerta processor runs, finds N == M, completes as an empty incremental (Critical Correction 3), and releases its lease. This is correct behavior: no logestado progress means no alert changes to detect.

### Blocking criterion

The Scheduler must not start alerta processing if logestado has not been attempted in the current cycle. This prevents the case where a Scheduler bug skips logestado entirely: the alerta processor would still see the old M value and miss any pending changes.

**Enforcement:** The Scheduler maintains a per-cycle execution log. Before starting alerta, it verifies that logestado appears in the current cycle's log with a terminal status. If absent, alerta is deferred to the next cycle.

### Evidence chain

Each alerta run records in amaia_sync_runs:
- The trigger cursor (watermark_before_id = N) and the logestado watermark used as upper bound (upper_bound = M).
- These two values, combined with the logestado run's watermark_after_id, form a verifiable chain: the alerta run's upper_bound must equal the logestado run's watermark_after_id for the same cycle.

An auditor can verify this chain to confirm that every alerta run processed exactly the logestado range that was available at the time, with no gaps and no stale references.

---

## Runtime Impact Summary

### Modified components

| Component | Change | Impact |
|---|---|---|
| Alerta Domain Processor | Derived workset via trigger cursor instead of in-memory refetch queue | Architectural change to alerta processing flow. Other domain processors unchanged. |
| Lease Manager | No change. Heartbeat remains as liveness signal. | None. |
| Batch write path (all domains) | Transactional fencing replaces check-then-write | Every batch write now executes within a transaction that acquires exclusive row lock on lease entry. Adds transactional overhead per batch. |
| Watermark advance path (all domains) | Transactional fencing on advance | Watermark advance now executes within a transaction that acquires exclusive row lock on lease entry. |
| Reconciliation Engine | Execution barriers added; resurrection detection added; alert coverage extended | Reconciliation runs only post-cycle. Checks for inactive/pending rows against AMAIA source. Alert reconciliation covers all statuses. |
| Scheduler | Enforced handoff guarantee for logestado→alerta; per-cycle execution log | Scheduler must track per-cycle domain execution status. Alerta processing gated on logestado completion. |
| Observability Layer | Empty incremental evidence; resurrection evidence | New evidence patterns, no structural change. |

### Unmodified components

| Component | Reason |
|---|---|
| Watermark Manager | The all-or-nothing advancement rule (9.1C) is unchanged. The trigger cursor is a watermark and follows the same rules. |
| Correlation Engine | No changes to cross-domain anomaly detection. |
| Domain Processors (non-alerta) | control_llamadas, logestado, beneficiario, red, enfermedades, medicamentos processing strategies unchanged. |
| Lease acquisition/release/expiration | Lease lifecycle unchanged. Transactional fencing operates within batch writes, not within lease operations. |

---

## Compatibility with Phase 9.2

All corrections in this revision are compatible with the schema deployed in Phase 9.2 (commit f5cd978). No DDL changes are required.

### Data-level changes required at implementation time

1. **Alerta watermark row:** UPDATE amaia_sync_watermarks SET watermark_type = 'id', last_id = 0, last_timestamp = NULL, watermark_expr = 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id' WHERE entity_name = 'alerta'. This is a single-row data correction, not a schema change.

2. **No other data changes.** The tombstone resurrection mechanism uses the existing 'reverted' transition value (already in the CHECK constraint). The transactional fencing is a runtime behavior change, not a schema change. The reconciliation tiers are a scheduling change, not a schema change.

### Schema elements used by this revision

| Table | Column/Constraint | Used by |
|---|---|---|
| amaia_sync_watermarks | entity_name = 'alerta', watermark_type, last_id | Critical Correction 1 (trigger cursor) |
| amaia_alert_logs | amaia_id, alert_amaia_id | Critical Correction 1 (workset derivation) |
| amaia_sync_leases | entity_name, lease_token | Critical Correction 2 (transactional fencing) |
| amaia_sync_runs | all evidence fields | Critical Corrections 1, 3 (evidence) |
| amaia_sync_tombstone_events | transition = 'reverted' | Critical Correction 4 (resurrection) |
| amaia_sync_reconciliation_results | all fields | Critical Correction 5 (tiered reconciliation) |
| destination tables (beneficiaries, support_network, alerts) | sync_status | Critical Correction 4 (status reset to 'active') |

All referenced columns, constraints, and indexes exist in the deployed schema.

---

## Open Risks

### Risk 1: Transactional fencing lock contention under high concurrency

The exclusive row lock on the lease entry during each batch write means that if multiple processes attempt to operate on the same domain simultaneously (one writing, one trying to acquire), the acquirer blocks until the batch commits. In V1, this is acceptable because the architecture is single-process with no legitimate concurrent access to the same domain. In a future multi-process deployment, batch size tuning and statement timeouts become critical. This risk is deferred to V2.

### Risk 2: Alerta trigger cursor drift from logestado watermark

If the logestado watermark is manually reset (operator intervention) to a value lower than the alerta trigger cursor, the alerta processor's derived workset query (amaia_id > N AND amaia_id <= M where M < N) returns zero rows. This is a no-op, not an error, but it means alert changes in the re-scanned logestado range are not re-processed for alerts.

**Mitigation:** Any manual watermark reset for logestado must be accompanied by a corresponding reset of the alerta trigger cursor. This is an operator procedure, not an automated safeguard, and must be documented in the operational runbook.

### Risk 3: Tombstone resurrection during incremental sync for timestamp-based domains

For timestamp-based domains (beneficiario, red), a resurrected row in AMAIA may have a COALESCE(updatedAt, createAt) value that falls outside the current watermark window. In this case, incremental sync will not encounter the row, and resurrection depends entirely on reconciliation. The reconciliation cadence (weekly for id-set) determines the maximum latency for detecting resurrection.

**Mitigation:** The weekly reconciliation cadence is sufficient for the expected frequency of resurrections (exceptional, per 9.1C tombstone design). If faster detection is required, the reconciliation cadence for affected domains can be increased to daily.

### Risk 4: Statement timeout on batch transactions

The transactional fencing mechanism relies on database statement timeouts to prevent hung writers from holding the exclusive lock indefinitely. If the statement timeout is set too low, legitimate large batches may be cancelled. If set too high, a hung writer blocks lease acquisition for too long.

**Mitigation:** The statement timeout is a per-domain configuration parameter, tuned empirically during implementation based on observed batch processing times. Initial load runs (which process the largest batches) may require a higher timeout than steady-state incremental runs.

---

## Final Architectural Decision

This revision addresses all 5 critical and 2 medium findings from Codex's audit of v1.0. The corrections are:

1. **Durable alert workset:** The in-memory refetch queue is replaced by a derived workset backed by a durable trigger cursor. The cursor lives in the existing amaia_sync_watermarks table. The workset is derived from already-persisted amaia_alert_logs data. No data can be lost on crash, retry, or orphan recovery.

2. **Transactional fencing:** The check-then-write pattern is replaced by an exclusive-lock-then-write pattern within the same database transaction. A stale writer cannot commit data after its lease has been superseded. The fencing guarantee is provided by the database engine's transactional isolation, not by application-level heartbeat checks.

3. **Empty incremental:** A run that finds no new data is a successful run with zero rows. Watermark advances to upper_bound (if different from before) or stays unchanged (if equal). Full evidence is recorded. No ambiguity.

4. **Tombstone resurrection:** The 'reverted' transition applies at any stage of the tombstone lifecycle, including after inactive_confirmed. Reactivation is detected by both reconciliation (primary) and incremental sync (secondary). The existing schema supports this without modification.

5. **Alert reconciliation coverage:** A four-tier strategy covers active, recently closed, historical closed, and total population. No tier requires a full table scan of AMAIA on every cycle.

6. **Sync-reconciliation barriers:** Reconciliation executes only after all domain processors in the cycle have completed. Domain-level lease observation prevents concurrent sync/reconciliation for the same domain.

7. **Logestado-alerta handoff:** Enforced via completeness, success, and blocking criteria checked by the Scheduler before starting alerta processing. A verifiable evidence chain links alerta runs to the logestado watermark they consumed.

No approved architecture from 9.1D or 9.2 has been modified. No deployed table requires DDL changes. One data-level row update (alerta watermark repurpose) is required at implementation time. The document is ready for re-audit.

---

**End of document.**
