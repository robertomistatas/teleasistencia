# AMAIA-SYNC Runtime Architecture v1.2.3

**Phase:** 9.3 Rev.6  
**Status:** Design — no implementation  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.2.md  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Auditor:** Codex (auditor forense)  
**Date:** 2026-06-18

---

## Scope

All content from v1.2, v1.2.1, and v1.2.2 is incorporated by reference unless explicitly superseded. This revision replaces Blockers 1-3 and resolves 5 medium findings with formal invariants. Each invariant states: what is measured, against what, where evidence lives, what transaction protects it, what happens on failure, and what cannot be guaranteed.

---

## Blocker 1: Set-Identity Zero-Skip with Durable Manifest

### What v1.2.2 got wrong

v1.2.2 verified `count_fetched == count_persisted`. Codex demonstrated this is insufficient: sets {101, 103} and {101, 102} both have count 2 but are different sets. Row 103 is silently lost.

### Invariant

**Logestado Set-Identity Rule:** The logestado watermark MUST NOT advance unless the exact set of amaia_id values fetched from AMAIA equals the exact set of amaia_id values persisted to amaia_alert_logs, verified by deterministic hash comparison and recorded in a durable manifest.

### Mechanism

**Step 1 — Fix upper_bound.** At run start, the processor reads the current maximum observable logestado id from AMAIA. This is upper_bound, fixed for the logical run (including retries). Recorded in amaia_sync_runs.upper_bound.

**Step 2 — Keyset pagination.** Pages are fetched using `WHERE id > :last_page_max AND id <= :upper_bound ORDER BY id ASC LIMIT :page_size`. Keyset pagination produces stable, non-overlapping pages. No row can appear in two pages. No row can be skipped between pages.

**Step 3 — Accumulate source manifest.** As each page is fetched, the processor accumulates the set of amaia_id values in memory. After the last page, the complete source set S is known.

**Step 4 — Compute source hash.** Sort S ascending. Concatenate as pipe-delimited string: "101|103|105". Compute SHA-256. This is source_id_hash.

**Step 5 — Create manifest row.** Insert into amaia_sync_run_manifests:
- run_id, domain_name = 'logestado'
- source_id_count = |S|
- source_id_hash = computed hash
- persisted_id_count = NULL (not yet verified)
- persisted_id_hash = NULL
- sets_match = NULL
- phase = 'source_fetched'

This row is committed immediately (separate transaction from the upsert). It records the plan even if the process crashes before upserting.

**Step 6 — Upsert all rows.** Normal batch upsert to amaia_alert_logs within fenced transactions (v1.2 Correction 2 transactional fencing, v1.2 Correction 1 ownership predicate).

**Step 7 — Read persisted set.** Query amaia_alert_logs for all amaia_id WHERE amaia_id > lower_bound AND amaia_id <= upper_bound. This is the persisted set P.

**Step 8 — Compute persisted hash.** Same algorithm as Step 4, applied to P. This is persisted_id_hash.

**Step 9 — Compare.** sets_match = (source_id_hash == persisted_id_hash AND source_id_count == persisted_id_count).

**Step 10 — Update manifest.** Update the manifest row: persisted_id_count, persisted_id_hash, sets_match, phase = 'comparison_complete', verified_at = now().

If sets_match = false: compute S \ P (missing_ids) and P \ S (extra_ids). Store in manifest as jsonb arrays. The run fails with reason_code = 'SUPABASE_ERROR'. Watermark does NOT advance.

If sets_match = true: proceed to watermark advance.

### What is measured

The symmetric difference of two integer sets: amaia_id values fetched from AMAIA vs amaia_id values confirmed present in amaia_alert_logs.

### Against what set

Source: the query result from AMAIA for [lower_bound, upper_bound].
Destination: the query result from amaia_alert_logs for the same range.

### Where is evidence

amaia_sync_run_manifests: source_id_hash, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at. One row per run. Immutable after comparison_complete.

### What transaction protects it

The manifest creation (Step 5) is its own committed transaction — it survives crashes. The comparison (Steps 7-10) is a read-then-update that does not modify domain data. The watermark advance (conditional on sets_match = true) is protected by the ownership predicate transaction (v1.2 Correction 1).

### What happens if it fails

sets_match = false: run fails, watermark stays, manifest records the exact discrepancy (missing_ids, extra_ids). Operator can diagnose which specific amaia_id was lost or appeared unexpectedly. Retry re-fetches the same range (upper_bound is fixed).

### What CANNOT be guaranteed

If AMAIA itself returns inconsistent results between the fetch (Step 3) and a hypothetical re-query (e.g., a row is deleted from AMAIA between the fetch and the verification), the manifest will show a mismatch that is not the engine's fault. This is a source-side consistency issue that the engine cannot control. The manifest records the observed state at fetch time; reconciliation detects source-side drift.

### Applicability beyond logestado

The manifest mechanism is domain-general. Any domain processor can create a manifest. For logestado, it is MANDATORY (watermark advance blocked on sets_match = true). For other domains in V1, it is OPTIONAL (recommended for initial load, not required for steady-state incremental). The table design supports any domain_name.

### DDL required

**New table: amaia_sync_run_manifests**

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| run_id | uuid | no | FK → amaia_sync_runs(id) ON DELETE CASCADE, UNIQUE |
| domain_name | text | no | |
| source_id_count | integer | no | CHECK >= 0 |
| source_id_hash | text | no | |
| persisted_id_count | integer | yes | CHECK (null or >= 0) |
| persisted_id_hash | text | yes | |
| sets_match | boolean | yes | |
| missing_ids | jsonb | yes | |
| extra_ids | jsonb | yes | |
| phase | text | no | CHECK ('source_fetched', 'destination_verified', 'comparison_complete') |
| verified_at | timestamptz | yes | |
| created_at | timestamptz | no | default now() |

Indexes: (run_id) already unique, (domain_name, phase).

---

## Blocker 2: Immutable, Versioned Exception Ledger

### What v1.2.2 got wrong

Codex identified 5 specific flaws. This redesign addresses each one.

| v1.2.2 flaw | v1.2.3 resolution |
|---|---|
| UNIQUE(domain, source_amaia_id) blocks re-investigation | Unique key includes source_row_hash — new investigation per distinct row version |
| approved_by/approved_at nullable when status='approved' | Decisions are a separate append-only table where decided_by and decided_at are NOT NULL |
| Approval not tied to row content | source_row_hash fingerprints the row; approval applies only to the exact version investigated |
| Exception read + cursor advance not atomic | Consumption recorded in the same fenced transaction as cursor advance |
| No evidence of which run consumed which exception | amaia_sync_workset_exception_consumptions links exception + decision + consuming run |

### Table 1: amaia_sync_workset_exceptions (investigation records)

Records the anomaly. Append-only: rows are inserted on detection, never updated or deleted.

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK |
| domain_name | text | no | |
| source_amaia_id | integer | no | The amaia_alert_logs.amaia_id with the invalid reference |
| referenced_amaia_id | integer | yes | The phantom alert_amaia_id. NULL if the issue is a null reference |
| source_row_hash | text | no | SHA-256 of "amaia_id={v}\|alert_amaia_id={v_or_null}\|action_date={ISO8601}" |
| invalidity_type | text | no | CHECK ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other') |
| amaia_lookup_evidence | text | no | Factual observation: query executed, result count, timestamp |
| amaia_lookup_at | timestamptz | no | |
| detection_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL |
| created_at | timestamptz | no | default now() |

Unique: (domain_name, source_amaia_id, source_row_hash). One investigation per distinct version of the source row. If the source row is re-synced with different content (different alert_amaia_id, different action_date), the hash changes and a new investigation is required.

### Table 2: amaia_sync_workset_exception_decisions (operator decisions)

Records operator judgments. Append-only: each decision is a new row. The latest decision for an exception is the effective decision. History is immutable.

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK |
| exception_id | uuid | no | FK → amaia_sync_workset_exceptions(id) ON DELETE CASCADE |
| decision | text | no | CHECK ('approved', 'rejected') |
| decided_by | text | no | Operator identity |
| decided_at | timestamptz | no | default now() |
| comment | text | no | CHECK (length(comment) > 0) |
| created_at | timestamptz | no | default now() |

No nullable fields. Every decision has an author, a timestamp, and a non-empty rationale. An 'approved' decision explicitly authorizes the cursor to advance past this specific source_amaia_id with this specific source_row_hash.

### Table 3: amaia_sync_workset_exception_consumptions (consumption evidence)

Records when and by which run an approved exception was consumed. Append-only.

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK |
| exception_id | uuid | no | FK → amaia_sync_workset_exceptions(id) |
| decision_id | uuid | no | FK → amaia_sync_workset_exception_decisions(id) |
| consumed_by_run_id | uuid | no | FK → amaia_sync_runs(id) |
| source_row_hash_at_consumption | text | no | Re-computed at consumption time |
| consumed_at | timestamptz | no | default now() |

The source_row_hash_at_consumption is re-computed from the current amaia_alert_logs row at the moment of consumption. If it differs from the exception's source_row_hash, the consumption is invalid and the cursor cannot advance.

### Cursor advancement with exceptions — transactional contract

The following operations execute within a single fenced transaction (ownership predicate verified):

1. Read the alerta trigger cursor N from amaia_sync_watermarks.
2. Read the logestado watermark M.
3. Run pre-validation (v1.2.1 Correction A, phases 1 and 2).
4. If validation fails: collect invalid source_amaia_id values.
5. For each invalid source_amaia_id:
   a. Compute current source_row_hash from the amaia_alert_logs row.
   b. Query amaia_sync_workset_exceptions for matching (domain_name, source_amaia_id, source_row_hash).
   c. If no matching exception exists: transaction rolls back. WORKSET_INTEGRITY_FAILURE.
   d. If exception exists: query the latest amaia_sync_workset_exception_decisions for this exception_id.
   e. If latest decision != 'approved': transaction rolls back. WORKSET_INTEGRITY_FAILURE.
   f. If approved: verify source_row_hash_at_consumption == exception.source_row_hash. If mismatch (row changed since investigation): roll back. WORKSET_INTEGRITY_FAILURE.
   g. If all checks pass: insert consumption record into amaia_sync_workset_exception_consumptions.
6. Derive workset (excluding excepted source_amaia_ids). Process alerts.
7. Advance trigger cursor.
8. Commit.

If the transaction commits, the consumption records are atomically persisted with the cursor advance. If it rolls back, no consumption is recorded and the cursor stays at N.

### What CANNOT be guaranteed

The exception mechanism depends on human judgment. An operator who approves an exception without proper investigation introduces a data gap that the system cannot detect. The ledger provides accountability (who approved, when, why) but not correctness. Organizational review processes are outside the scope of this architecture.

### DDL required

3 new tables as defined above. Replaces the single amaia_sync_workset_exceptions table from v1.2.2.

---

## Blocker 3: Tier 4 Conditional SLO with Segment State Table

### What v1.2.2 got wrong

v1.2.2 claimed "guarantees 84 days under failure conditions." Codex correctly rejected this: if a segment fails every attempt for 12 consecutive weeks, the "guarantee" is breached regardless of catch-up. An architecture cannot guarantee outcomes that depend on external system availability.

### Honest reformulation

Tier 4 coverage is a **conditional SLO**, not an absolute guarantee. The architecture defines:
- Conditions under which the SLO is met.
- Conditions under which the SLO is at risk.
- Conditions under which the SLO is mathematically irrecoverable.
- Operational alerts at each threshold.
- Maximum catch-up capacity.

### SLO definition

**SLO-TIER4-84:** Every Tier 4 segment receives at least one successful field comparison within 84 days of its previous successful field comparison (or within 84 days of system deployment for never-covered segments).

**Condition for SLO compliance:** The SLO is met if and only if: for every segment, last_successful_coverage_at > now() - 84 days, or last_successful_coverage_at IS NULL and segment created_at > now() - 84 days.

### Segment state table

**New table: amaia_sync_reconciliation_segments**

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK |
| domain_name | text | no | |
| tier | text | no | CHECK ('tier4') — extensible for future tiers |
| segment_id | integer | no | CHECK (segment_id >= 0 AND segment_id < 12) |
| partition_expr | text | no | e.g., 'amaia_id % 12 = 3' |
| last_successful_coverage_at | timestamptz | yes | NULL = never successfully covered |
| last_attempt_at | timestamptz | yes | NULL = never attempted |
| consecutive_failure_count | integer | no | default 0, CHECK >= 0 |
| slo_deadline_at | timestamptz | yes | Computed: last_successful_coverage_at + 84 days, or created_at + 84 days if never covered |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | default now() |

Unique: (domain_name, tier, segment_id).

Indexes: (slo_deadline_at), (domain_name, tier, last_successful_coverage_at).

Seeded with 12 rows for domain_name = 'alerta', tier = 'tier4', segment_id 0 through 11, partition_expr = 'amaia_id % 12 = {segment_id}'.

### Partition stability

Segment assignment: `segment = amaia_id % 12`. This is stable across population changes. An alert's segment never changes. No rebalancing is needed. Segment sizes are approximately equal for uniformly distributed amaia_id values.

### Segment selection algorithm

On each reconciliation cycle:

1. Read all 12 segment rows ordered by: consecutive_failure_count DESC (starvation detection), slo_deadline_at ASC NULLS FIRST (most urgent first).
2. Select the first N segments where N = min(overdue_or_due_count, max_segments_per_cycle).
3. max_segments_per_cycle is a configurable operational parameter (default 3). It represents the maximum reconciliation capacity per cycle, bounded by available time and lease hold duration.

### Dynamic catch-up

max_segments_per_cycle is not fixed at 2 (as v1.2.2 stated). It is configurable and can be increased by the operator when the SLO is at risk. The architecture does not fix a number; it defines the selection algorithm and leaves the capacity limit as an operational parameter.

### SLO status classification

| Status | Condition | Action |
|---|---|---|
| **compliant** | All segments: slo_deadline_at > now() | Normal operation |
| **at_risk** | Any segment: slo_deadline_at < now() + 14 days AND last_successful_coverage_at IS NOT NULL | Operational alert. Consider increasing max_segments_per_cycle |
| **breached** | Any segment: slo_deadline_at < now() | SLO violated. Immediate attention required. Increase max_segments_per_cycle or investigate root cause |
| **irrecoverable** | overdue_segments > max_segments_per_cycle * remaining_weeks_before_all_deadlines | Mathematically impossible to catch up with current capacity. Requires capacity increase or SLO renegotiation |
| **starvation** | Any segment: consecutive_failure_count >= 5 | Segment-specific persistent failure. The failure cause must be investigated independently of other segments |

### Segment updates

After each Tier 4 reconciliation attempt:

**On success:**
- last_successful_coverage_at = now()
- last_attempt_at = now()
- consecutive_failure_count = 0
- slo_deadline_at = now() + 84 days

**On failure:**
- last_attempt_at = now()
- consecutive_failure_count = consecutive_failure_count + 1
- last_successful_coverage_at: unchanged
- slo_deadline_at: unchanged

### Starvation prevention

If a segment reaches consecutive_failure_count = 5, the Reconciliation Engine:
1. Records the starvation status.
2. Still attempts this segment on the next cycle (does not skip it).
3. But also attempts other overdue segments in the same cycle (does not let one starving segment monopolize all capacity).

A starving segment is prioritized but not exclusively — it shares catch-up capacity with other overdue segments.

### Classification of closed alerts without logestado

Deterministic fallback chain (supersedes v1.2.2):

1. **Primary signal:** Most recent action_date from amaia_alert_logs WHERE alert_amaia_id = this alert's amaia_id. If found and action_date > now() - 90 days → Tier 3. If > 90 days → Tier 4.
2. **Fallback signal:** alert_created_at from amaia_alerts (timestamptz NOT NULL, confirmed in deployed schema). If alert_created_at > now() - 90 days → Tier 3. If > 90 days → Tier 4.
3. **Anomaly override:** If the alert is tracked in amaia_correlation_issues (the 33 from 9.1D V-006 or future occurrences) → Tier 4 unconditionally.

No alert is unclassified. The chain is exhaustive: every alert reaches a tier assignment.

### What CANNOT be guaranteed

- **100% coverage within 84 days** if the system experiences persistent failures exceeding catch-up capacity. This is an SLO, not an SLA. The architecture provides maximum-effort catch-up and transparent status reporting, but cannot overcome sustained unavailability.
- **Equal segment processing time.** Segment sizes are approximately equal but not identical (modulo distribution). Some segments may take longer than others.
- **Real-time SLO status.** The status is updated on each reconciliation cycle. Between cycles, the status may be stale.

### DDL required

New table: amaia_sync_reconciliation_segments as defined above.

---

## Medium 1: cycle_id and scope_descriptor NOT NULL

### Justification for NOT NULL

All affected tables (amaia_sync_runs, amaia_sync_reconciliation_results) have 0 rows in the deployed schema. There are no historical rows to accommodate. Adding NOT NULL columns without default is safe.

### Changes from v1.2

| Table | Column | v1.2 | v1.2.3 |
|---|---|---|---|
| amaia_sync_runs | cycle_id | uuid, nullable, FK | uuid, **NOT NULL**, FK |
| amaia_sync_reconciliation_results | cycle_id | uuid, nullable, FK | uuid, **NOT NULL**, FK |
| amaia_sync_reconciliation_results | scope_descriptor | text, nullable | text, **NOT NULL** |

amaia_sync_runs.upstream_run_id remains nullable (populated only for alerta runs, NULL for all other domains).

### Operational implication

The Scheduler MUST create the amaia_sync_cycles row before creating any amaia_sync_runs or amaia_sync_reconciliation_results rows in the cycle. This is the natural order of operations. No run exists outside a cycle.

---

## Medium 2: Structured result_status on Reconciliation Results

### Problem

v1.2.2 encoded success/failure in the scope_descriptor text suffix (':success' / ':failed:{reason}'). This is fragile, requires parsing, and prevents efficient querying.

### Correction

Add a structured column to amaia_sync_reconciliation_results:

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| result_status | text | no | CHECK ('success', 'failed', 'skipped') |

scope_descriptor reverts to describing only scope (no ':success'/':failed' suffix). result_status describes outcome.

- 'success': reconciliation completed, all comparisons executed, results are complete.
- 'failed': reconciliation started but could not complete (error, timeout, lease lost).
- 'skipped': reconciliation deferred (lease held by sync, segment not due).

The Tier 4 segment selection algorithm uses result_status = 'success' to determine last_successful_coverage_at, not scope_descriptor parsing.

### DDL required

New column on amaia_sync_reconciliation_results.

---

## Medium 3: Best-Effort Lease Cleanup — Honest Limits

### Problem

v1.2.2 Medium 4 stated "release immediately" for partial multi-lease acquisition cleanup. If the process loses connectivity to Supabase at the moment of cleanup, it cannot release.

### Honest contract

**Best-effort release with TTL fallback:**

1. If multi-lease acquisition fails at position K, the process attempts to release leases L_{K-1} through L_1 in reverse canonical order.
2. Each release is a standalone database operation. If a release succeeds, the lease is freed immediately. If it fails (connectivity loss, timeout), the process logs the failure locally and moves on.
3. Unreleased leases expire naturally via their TTL (5 minutes per v1.0 Appendix C). No other process is blocked for longer than the TTL.
4. The process does NOT retry the failed releases. The TTL is the ultimate safety net.

### What is guaranteed

- Leases that can be released will be released immediately (best effort).
- Leases that cannot be released will expire within the TTL.
- No lease is held indefinitely due to partial acquisition failure.

### What is NOT guaranteed

- Immediate release of all held leases. If connectivity is lost, release is delayed until TTL expiration.
- Zero impact on other processes. During the TTL window, the held domain(s) are unavailable for sync or reconciliation.

---

## Medium 4: Structured Lease Contention Evidence

### Problem

v1.2.2 suggested using lower_bound for contention metadata. Codex rejected this as semantic overloading.

### Correction

Add a dedicated column to amaia_sync_runs:

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| blocked_entity_name | text | yes | Populated only when reason_code = 'LEASE_HELD' |

This records the entity_name of the lease that could not be acquired. For multi-lease scenarios, it is the specific entity at which acquisition failed.

Combined with the existing owner_identity field on the blocking lease (readable from amaia_sync_leases at detection time) and the error_message field (which can record the blocking owner's identity as supplementary text), this provides sufficient contention evidence.

### DDL required

New nullable column on amaia_sync_runs.

---

## Medium 5: Causal Workset Evidence Chain

### Problem

v1.2.2 did not provide end-to-end evidence linking source range → fetched IDs → persisted IDs → exceptions applied → alerts processed → alerta run.

### Resolution via manifest + exception consumption + upstream_run_id

The evidence chain is now fully durable across three mechanisms:

| Link in chain | Evidence location | Populated by |
|---|---|---|
| Logestado source range [lower_bound, upper_bound] | amaia_sync_runs (logestado run) | Logestado processor |
| Fetched IDs (exact set) | amaia_sync_run_manifests.source_id_hash | Logestado processor (Blocker 1) |
| Persisted IDs (exact set) | amaia_sync_run_manifests.persisted_id_hash | Logestado processor (Blocker 1) |
| Set equality verified | amaia_sync_run_manifests.sets_match | Logestado processor (Blocker 1) |
| Exceptions applied (per source row) | amaia_sync_workset_exception_consumptions | Alerta processor (Blocker 2) |
| Which logestado run established the upper bound | amaia_sync_runs.upstream_run_id (on alerta run) | Alerta processor (Medium 7 from v1.2.2) |
| Alerta trigger cursor range [N, M] | amaia_sync_runs.watermark_before_id, upper_bound (on alerta run) | Alerta processor |
| Alerts processed | amaia_sync_runs.records_processed (on alerta run) | Alerta processor |

**Verification query:** Given an alerta run R_a:
1. Read upstream_run_id → logestado run R_l.
2. Read R_l's manifest → confirm sets_match = true, read source_id_hash.
3. Read R_a's watermark_before_id (N) and upper_bound (M) → this is the logestado range consumed.
4. Query exception_consumptions WHERE consumed_by_run_id = R_a.id → any exceptions applied.
5. Compute: workset_size = (distinct alert_amaia_id in amaia_alert_logs WHERE amaia_id > N AND amaia_id <= M) - (excepted source_amaia_ids).
6. Verify: R_a.records_processed matches the expected workset_size.

This chain is fully auditable from durable state. No log parsing required.

---

## Schema Gap Analysis — Cumulative from v1.2

### New tables (complete list, v1.2 through v1.2.3)

| # | Table | Source | Purpose |
|---|---|---|---|
| 1 | amaia_sync_cycles | v1.2 C7 | Cycle identity and lifecycle |
| 2 | amaia_sync_run_manifests | v1.2.3 B1 | Set-identity verification for zero-skip |
| 3 | amaia_sync_workset_exceptions | v1.2.3 B2 (redesign) | Anomaly investigation records |
| 4 | amaia_sync_workset_exception_decisions | v1.2.3 B2 | Operator decisions (append-only) |
| 5 | amaia_sync_workset_exception_consumptions | v1.2.3 B2 | Consumption evidence (append-only) |
| 6 | amaia_sync_reconciliation_segments | v1.2.3 B3 | Tier 4 segment state tracking |

### New columns on existing tables

| Table | Column | Type | Nullable | Source |
|---|---|---|---|---|
| amaia_sync_runs | cycle_id | uuid | **no** | v1.2 C7, M1 override to NOT NULL |
| amaia_sync_runs | upstream_run_id | uuid | yes | v1.2 C7 |
| amaia_sync_runs | blocked_entity_name | text | yes | v1.2.3 M4 |
| amaia_sync_reconciliation_results | cycle_id | uuid | **no** | v1.2 C7, M1 override to NOT NULL |
| amaia_sync_reconciliation_results | scope_descriptor | text | **no** | v1.2 C5/C7, M1 override to NOT NULL |
| amaia_sync_reconciliation_results | result_status | text | no | v1.2.3 M2 |

### Modified CHECK constraints

| Table | Constraint | Change | Source |
|---|---|---|---|
| amaia_sync_runs | reason_code | + 'WORKSET_INTEGRITY_FAILURE' | v1.2 C2 |
| amaia_beneficiaries | sync_status | + 'reactivation_pending' | v1.2 C4 |
| amaia_support_network | sync_status | + 'reactivation_pending' | v1.2 C4 |
| amaia_alerts | sync_status | + 'reactivation_pending' | v1.2 C4 |

### New indexes

| Table | Index | Columns | Source |
|---|---|---|---|
| amaia_sync_runs | cycle_id | (cycle_id) | v1.2 C7 |
| amaia_sync_runs | upstream_run_id | (upstream_run_id) | v1.2 C7 |
| amaia_sync_reconciliation_results | cycle_id | (cycle_id) | v1.2 C7 |
| amaia_sync_cycles | started_at | (started_at) | v1.2 C7 |
| amaia_sync_cycles | status | (status) | v1.2 C7 |
| amaia_sync_run_manifests | domain_phase | (domain_name, phase) | v1.2.3 B1 |
| amaia_sync_workset_exceptions | domain_source_hash | (domain_name, source_amaia_id, source_row_hash) | v1.2.3 B2 (unique) |
| amaia_sync_workset_exception_decisions | exception_id | (exception_id) | v1.2.3 B2 |
| amaia_sync_workset_exception_consumptions | consumed_by_run_id | (consumed_by_run_id) | v1.2.3 B2 |
| amaia_sync_reconciliation_segments | slo_deadline | (slo_deadline_at) | v1.2.3 B3 |
| amaia_sync_reconciliation_segments | domain_tier_coverage | (domain_name, tier, last_successful_coverage_at) | v1.2.3 B3 |

### Data corrections (no DDL)

| Table | Row | Change | Source |
|---|---|---|---|
| amaia_sync_watermarks | entity_name = 'alerta' | watermark_type → 'id', last_id → 0, last_timestamp → NULL, watermark_expr → 'derived:...' | v1.1 C1 |
| amaia_sync_reconciliation_segments | 12 seed rows | segment_id 0-11 for domain_name='alerta', tier='tier4' | v1.2.3 B3 |

### Totals

- 6 new tables
- 6 new columns on 2 existing tables
- 4 modified CHECK constraints
- 11 new indexes
- 1 data correction + 12 seed rows

---

## Guarantees vs SLOs — Honest Assessment

### Absolute guarantees (provable by architecture)

| Guarantee | Mechanism | Evidence |
|---|---|---|
| No logestado row silently skipped | Set-identity hash comparison (Blocker 1) | amaia_sync_run_manifests.sets_match |
| No phantom reference silently consumed | Exception ledger with approved decisions (Blocker 2) | amaia_sync_workset_exception_consumptions |
| No cursor advance without set-identity proof | Watermark advance conditional on sets_match = true | amaia_sync_run_manifests + amaia_sync_runs |
| No stale writer commits data | 4-part ownership predicate in transactional fencing | amaia_sync_leases state within transaction |
| No tombstone resurrection without fresh data | Resurrection atomicity rule (v1.2.2 M5) | tombstone_events + destination row in same transaction |
| No multi-lease deadlock | Global canonical ordering (v1.2.1 C) | Application-layer invariant |
| No exception consumed without matching hash | source_row_hash_at_consumption verified at consumption time | amaia_sync_workset_exception_consumptions |

### Conditional SLOs (depend on external factors)

| SLO | Condition for compliance | Breach trigger |
|---|---|---|
| SLO-TIER4-84: historical coverage | System availability sufficient for at least 10 of 12 weekly cycles per quarter | Any segment's slo_deadline_at < now() |
| Alert state change detection latency | AMAIA availability, logestado sync cadence | Logestado watermark stale > configured threshold |
| Reconciliation completeness | Lease contention below threshold, database performance adequate | Reconciliation runs consistently deferred by sync contention |

### Cannot be guaranteed

| Limitation | Reason | Mitigation |
|---|---|---|
| Zero data loss if AMAIA deletes retroactively | Read-only access, no change-data-capture from AMAIA | Reconciliation detects drift; watermark overlap reduces window |
| Perfect sync with AMAIA referential issues | Source data anomalies are inherited | Correlation issues track anomalies; exception ledger resolves phantom references |
| Immediate detection of all changes | Bounded by sync cadence | Configurable cadence; operator can trigger manual cycles |
| SLO compliance under sustained outage | Mathematical limit on catch-up capacity | Transparent status reporting; operator escalation |
| Correctness of operator-approved exceptions | Human judgment | Ledger provides accountability, not correctness |

---

## Hallazgo Codex → Resolución v1.2.3

### Blockers (v1.2.2 audit)

| # | Hallazgo | Resolución | DDL | Closed? |
|---|---|---|---|---|
| B1 | count_fetched == count_persisted does not prove set identity | Set-identity hash comparison via amaia_sync_run_manifests. SHA-256 of sorted amaia_id sets. Watermark advances only on sets_match = true. Missing/extra IDs recorded on mismatch. | 1 new table | Yes |
| B2 | Exception ledger: non-versionable, mutable, non-atomic, no consumption evidence | 3-table append-only redesign: exceptions (versioned by source_row_hash), decisions (immutable, NOT NULL decided_by/decided_at/comment), consumptions (linked to run, hash re-verified). All in fenced transaction. | 3 new tables (replace v1.2.2's 1) | Yes |
| B3 | 84-day "guarantee" is mathematically impossible under sustained failures | Reformulated as SLO-TIER4-84. Segment state table tracks last_successful_coverage_at. Oldest-first selection. Dynamic catch-up. Starvation detection. Explicit status classification: compliant/at_risk/breached/irrecoverable. | 1 new table | Yes |

### Medium findings (v1.2.2 audit)

| # | Hallazgo | Resolución | DDL | Closed? |
|---|---|---|---|---|
| M1 | cycle_id/scope_descriptor nullable | Changed to NOT NULL. 0 existing rows makes this safe. | Column nullability change | Yes |
| M2 | Success encoded in scope_descriptor text | New result_status column on reconciliation_results: CHECK ('success', 'failed', 'skipped'). | 1 new column | Yes |
| M3 | "Immediate release guaranteed" is false under connectivity loss | Reformulated as best-effort release with TTL fallback. No guarantee of immediate release. TTL (5 min) is the upper bound. | None | Yes |
| M4 | Contention evidence in lower_bound | New blocked_entity_name column on sync_runs. Populated only on LEASE_HELD. | 1 new column | Yes |
| M5 | No end-to-end causal evidence chain | Resolved via manifest (B1) + exception consumptions (B2) + upstream_run_id (v1.2.2 M7). Full chain: source set → persisted set → exceptions → alerts processed. Auditable query defined. | None (uses B1+B2 tables) | Yes |

---

**End of document.**
