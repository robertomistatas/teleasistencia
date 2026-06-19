# AMAIA-SYNC Runtime Architecture v1.2.2

**Phase:** 9.3 Rev.5  
**Status:** Design — no implementation  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.1.md (8 corrections: 3 blockers, 5 medium)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Auditor:** Codex (auditor forense)  
**Date:** 2026-06-18

---

## Scope of this revision

All content from v1.2 and v1.2.1 is incorporated by reference unless explicitly superseded below. This revision addresses 3 critical blockers and 5 medium findings from Codex's rejection of v1.2.1.

**Unchanged from v1.2/v1.2.1:**
- Correction 1 (Complete Lease Ownership Predicate)
- Correction 6 (Durable Alerta Backlog Semantics)
- Correction 7 (Durable Cycle Traceability) — except upstream_run_id semantics (Medium 7)
- v1.2.1 Correction C (Global Lease Ordering Rule) — extended by Medium 4

**Modified:**
- v1.2 Correction 2 / v1.2.1 Correction A (Workset Integrity) — superseded by Blockers 1 and 2
- v1.2 Correction 3 / v1.2.1 Correction C (Reconciliation Lease) — extended by Medium 4
- v1.2 Correction 4 / v1.2.1 Correction B (Resurrection) — extended by Medium 5
- v1.2 Correction 5 (Historical Coverage) — superseded by Blocker 3 and Medium 8

**New DDL required:** 1 new table (amaia_sync_workset_exceptions). Declared in Schema Gap Analysis.

---

## Blocker 1: Logestado Source-to-Destination Completeness

### Problem

v1.2/v1.2.1 validate the alerta workset AFTER logestado has already advanced its watermark. If the logestado processor skipped a source row (normalization failure, quality issue) and advanced the watermark past it, that row never reaches amaia_alert_logs. The alerta pre-validation scan cannot detect an absence — it can only validate what is present. The gap is invisible.

### Root cause

v1.0 Step 5 (Normalize) allows: "If normalization produces an error for a specific row, that row is skipped and counted in a quality_issues tally." For most domains, this is acceptable — the row is missed but reconciliation catches it later. For logestado, this is unacceptable because logestado is the sole detection mechanism for alert state changes (9.1D V-003: alerta.updateAt is 100% NULL). A skipped logestado row means a permanently invisible alert change.

### Invariant

**Logestado Zero-Skip Rule:** The logestado domain processor MUST NOT skip any row in its fetch range. Every row fetched from AMAIA's logestado table in [lower_bound, upper_bound] MUST be persisted to amaia_alert_logs before the logestado watermark advances. No exceptions.

### Behavioral contract

**Normalization failure handling for logestado (overrides v1.0 Step 5 for this domain only):**

If a logestado row cannot be fully normalized (e.g., malformed action text, unexpected data type), the processor MUST still persist it with the following minimum viable fields:
- amaia_id: the logestado primary key (integer, always available from the source query).
- alert_amaia_id: the alert reference from the source row (must be preserved exactly as received from AMAIA, even if other fields fail normalization).
- action_date: the timestamp (required NOT NULL in the destination schema).
- synced_at: set to now().

All other fields (action, user_id_amaia, alert_id FK, raw_action, action_type, actor_name) may be set to NULL or defaults if normalization fails. The row is persisted in a degraded state rather than skipped.

**Post-upsert count verification:**

After upserting all rows in a page, the logestado processor verifies:

count_fetched (rows received from AMAIA in this page) = count_persisted (rows confirmed written to amaia_alert_logs with amaia_id in the page's range).

If count_fetched != count_persisted, the page is treated as a failure. The run terminates with status = 'failed' and reason_code = 'SUPABASE_ERROR'. The watermark does not advance.

**SUCCESS_WITH_QUALITY_ISSUES for logestado:**

This reason_code is permitted for logestado only if ALL of the following are true:
1. Every row in the fetch range was persisted (zero skips).
2. Every persisted row has a non-null amaia_id.
3. Every persisted row has a non-null alert_amaia_id (if the source row had one; see Blocker 2 for handling of source rows with null alert references).
4. Quality issues are limited to degraded non-critical fields (action text, actor name, etc.).

If any row was not persisted, the status MUST be 'failed', not 'success' or 'SUCCESS_WITH_QUALITY_ISSUES'.

### Interaction with alerta

Because every logestado row is persisted, the alerta workset pre-validation scan (v1.2.1 Correction A) has a complete dataset to validate. No row can be invisible. The two guarantees are complementary:
- Blocker 1 guarantees every source row reaches amaia_alert_logs.
- v1.2.1 Correction A guarantees every amaia_alert_logs row in the range has a valid alert_amaia_id before the alerta cursor advances.

Together, they form a closed chain: AMAIA source → amaia_alert_logs (Blocker 1, zero-skip) → alerta workset (Correction A, referential validation) → alerta processing.

### Schema impact

None. This is a behavioral contract on the logestado domain processor.

---

## Blocker 2: Durable Phantom Reference Resolution

### Problem

v1.2.1 Correction A handles phantom references (alert_amaia_id that doesn't exist in AMAIA or Supabase) by blocking the alerta cursor indefinitely. This is fail-closed, but without a resolution mechanism it becomes fail-stuck. A single phantom reference permanently blocks all alert state change detection — an unbounded operational impact from a single source data anomaly.

### Solution: Workset Exception Ledger

A new table, amaia_sync_workset_exceptions, provides a durable, auditable, operator-approved mechanism for advancing the cursor past irrecoverable references.

### Table design

**amaia_sync_workset_exceptions**

| Column | Type | Nullable | Constraint | Purpose |
|---|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() | Row identity |
| domain_name | text | no | | Domain context (always 'alerta' in V1) |
| source_amaia_id | integer | no | | The amaia_alert_logs.amaia_id that contains the problematic reference |
| referenced_amaia_id | integer | yes | | The phantom alert_amaia_id value. NULL if the source row itself has null alert_amaia_id |
| detection_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL | The sync run that detected the anomaly |
| invalidity_type | text | no | CHECK ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other') | Classification of why the reference is invalid |
| amaia_lookup_evidence | text | no | | What the AMAIA lookup returned: "SELECT result: 0 rows for id=99999999 at 2026-06-18T14:30:00Z" or "source row alert_id IS NULL". Must be a factual observation, not an interpretation |
| amaia_lookup_at | timestamptz | no | | When the AMAIA lookup was performed |
| status | text | no | CHECK ('pending_review', 'approved', 'rejected'), default 'pending_review' | Exception lifecycle state |
| approved_by | text | yes | | Structured identity or name of the operator who approved. NULL until approved |
| approved_at | timestamptz | yes | | When the exception was approved. NULL until approved |
| comment | text | no | | Mandatory explanation. Cannot be empty string (CHECK length > 0). For pending: describes the anomaly. For approved: documents the operator's rationale |
| created_at | timestamptz | no | default now() | Detection timestamp |

Unique constraint: (domain_name, source_amaia_id). One exception per source row per domain. A rejected exception that reappears requires a new investigation, not a re-approval of the old one — the old row is updated to 'rejected' and a new row is created.

Indexes: (domain_name, status), (detection_run_id).

RLS: admin/super_admin select. Write access restricted to the sync engine (insert on detection) and operators (update for approval/rejection).

### Exception lifecycle

**Detection:** During the alerta pre-validation scan (v1.2.1 Correction A), when Phase 1 or Phase 2 fails, the alerta processor inserts one amaia_sync_workset_exceptions row per invalid source_amaia_id with status = 'pending_review'. If a row already exists for the same (domain_name, source_amaia_id), no duplicate is created.

**Review:** An operator inspects the exception. The amaia_lookup_evidence field provides the factual basis. The operator verifies independently whether the reference is truly irrecoverable.

**Approval:** The operator updates status to 'approved', sets approved_by, approved_at, and adds a rationale in comment. This is an explicit, auditable human decision.

**Rejection:** The operator determines the reference is recoverable (e.g., the alert needs to be synced first, or the AMAIA data needs correction). Status is set to 'rejected'. The alerta cursor remains blocked until the underlying issue is resolved.

### Cursor advancement with exceptions

The revised pre-validation logic for the alerta processor:

1. Execute Phase 1 and Phase 2 as defined in v1.2.1 Correction A.
2. If both phases pass: proceed normally.
3. If either phase fails: collect the set of invalid source_amaia_id values.
4. For each invalid source_amaia_id: check amaia_sync_workset_exceptions for an 'approved' exception.
5. If ALL invalid source_amaia_id values have approved exceptions: the validation passes. These source rows are excluded from the workset (they do not generate alert_amaia_id entries for processing). The cursor advances past them. The run records reason_code = 'SUCCESS_WITH_QUALITY_ISSUES' (not 'SUCCESS') to preserve the audit signal.
6. If ANY invalid source_amaia_id lacks an approved exception: the validation fails. Cursor does not advance. reason_code = 'WORKSET_INTEGRITY_FAILURE'.

### Invariant

**A phantom or null alert reference blocks the alerta trigger cursor unless and until an operator has approved a durable, auditable exception for that specific source row. No automated mechanism may bypass this gate. No exception may be approved without a non-empty human-authored comment and a timestamped identity.**

### Interaction with retry

A blocked run (WORKSET_INTEGRITY_FAILURE) is not automatically retried. The Scheduler records the failure and defers alerta to the next cycle. On the next cycle, the pre-validation re-evaluates: if an exception was approved in the interim, the cursor can advance. If not, it remains blocked.

### Interaction with Blocker 1

Blocker 1 guarantees every logestado row is persisted. Blocker 2 guarantees every persisted row with an invalid reference is tracked and requires explicit resolution. Together:
- No row is silently skipped (Blocker 1).
- No invalid row is silently consumed (Blocker 2).
- No valid row is blocked by an invalid one that has been explicitly excepted (exception mechanism).

### Schema impact

**DDL required:** One new table (amaia_sync_workset_exceptions) with the structure defined above.

---

## Blocker 3: Deterministic Tier 4 Coverage with Success-Based SLA

### Problem (combines Codex blockers 3 and 8)

v1.2 Tier 4 processes segments sequentially (segment 1 in week 1, segment 2 in week 2, etc.). If segment 3 fails, the rotation moves to segment 4 the next week. Segment 3 is not retried until week 15 (after a full 12-week rotation). The "84-day SLA" assumes zero failures, which is unrealistic.

Additionally, v1.2 did not define how closed alerts without logestado entries are classified into tiers. The classification was implicit.

### Correction: Oldest-first segment selection with success tracking

**Segment selection algorithm (supersedes v1.2 Tier 4 sequential rotation):**

On each weekly reconciliation cycle, the Reconciliation Engine selects the Tier 4 segment to process as follows:

1. For each of the 12 segments, determine last_successful_coverage_at: the executed_at of the most recent amaia_sync_reconciliation_results row where scope_descriptor identifies this segment AND the reconciliation completed without error (the associated sync run, if any, has status != 'failed').
2. Select the segment with the oldest last_successful_coverage_at value.
3. If multiple segments are tied (e.g., all have never been successfully covered), select the one with the lowest segment number.

This is a catch-up-first strategy: failed or deferred segments are automatically prioritized on the next cycle.

**Multi-segment catch-up:**

If the selected segment's last_successful_coverage_at is older than 84 days, the Reconciliation Engine processes TWO segments in the same cycle: the most overdue and the second-most overdue. This accelerated catch-up continues until no segment is beyond the 84-day SLA. The maximum segments per cycle is bounded at 2 to limit reconciliation duration and lease hold time.

**SLA measurement:**

The 84-day SLA is measured by success, not attempt:
- A segment is considered "covered" only when its reconciliation completes without error and produces a valid reconciliation_results row.
- A failed attempt does NOT reset the segment's coverage clock.
- The SLA is violated if any segment's last_successful_coverage_at exceeds 84 days.
- SLA compliance is auditable: for each segment, query reconciliation_results filtered by scope_descriptor and verify the most recent successful execution is within 84 days.

**scope_descriptor for success tracking:**

Each Tier 4 reconciliation_results row records:
- scope_descriptor: 'tier4:field_compare:historical:segment_{N}_of_12:amaia_id_range_{low}_{high}:success' for successful completions, or 'tier4:field_compare:historical:segment_{N}_of_12:amaia_id_range_{low}_{high}:failed:{reason}' for failures.

The ':success' or ':failed:{reason}' suffix enables the segment selection algorithm to distinguish successful coverage from failed attempts without joining to amaia_sync_runs.

### Deterministic classification of closed alerts without logestado

**Problem:** Tier 3 (recently closed, <90 days) uses "most recent logestado entry's action_date" to determine the closed date. Alerts without logestado entries (the 33 from 9.1D V-006, plus any future occurrences) have no logestado-derived date.

**Classification rule (replaces implicit handling):**

For any alert with alert_status_id in (3, 4, 5), the closed_date is determined as follows:

1. **Primary signal: most recent logestado action_date.** Query amaia_alert_logs for the most recent action_date WHERE alert_amaia_id = this alert's amaia_id. If found, this is the closed_date.

2. **Fallback signal: alert_created_at.** If no logestado entry exists for this alert (including the 33 historical anomalies from 9.1D V-006), use the alert's own alert_created_at field (timestamptz NOT NULL, confirmed present in the deployed schema). This is not the closed date but it is the best available temporal anchor.

3. **Tier assignment:**
   - If closed_date (from signal 1 or 2) is within the last 90 days → Tier 3.
   - If closed_date is older than 90 days → Tier 4.
   - If alert_status_id in (3, 4, 5) and the alert is tracked in amaia_correlation_issues as 'alerta_sin_beneficiario' or equivalent anomaly type → Tier 4 unconditionally, regardless of date. Rationale: known anomalous alerts are historical by definition and should not receive the elevated frequency of Tier 3.

4. **No unclassified alerts.** Every alert with alert_status_id in (3, 4, 5) receives exactly one tier assignment. The fallback chain (logestado action_date → alert_created_at → unconditional Tier 4) is exhaustive.

### Schema impact

No additional DDL beyond what v1.2 already declared (scope_descriptor column on reconciliation_results). The success/failure suffix in scope_descriptor is a data convention, not a schema change.

---

## Medium 4: Multi-Lease Partial Acquisition Cleanup

**Extends:** v1.2.1 Correction C (Global Lease Ordering Rule).

### Problem

If a process acquires lease L_i (e.g., logestado at position 6) and then fails to acquire lease L_j (e.g., alerta at position 7), v1.2.1 does not specify what happens to L_i. The process could retain L_i indefinitely while waiting for L_j, blocking other processes from using L_i.

### Invariant

**All-or-nothing multi-lease acquisition.** If a process requires leases {L_a, L_b, ..., L_n} (in canonical order), and acquisition of any L_k fails:

1. All previously acquired leases {L_a, ..., L_{k-1}} are released immediately.
2. The release follows reverse canonical order (L_{k-1} first, L_a last).
3. The failed acquisition is recorded with reason_code = 'LEASE_HELD' referencing L_k.
4. No retry of the multi-lease acquisition is attempted within the same cycle. The operation is deferred to the next cycle.

### Timeout handling

If the exclusive row lock on a lease row blocks for longer than a configurable timeout (default: 10 seconds, distinct from the lease TTL), the acquisition is treated as failed. The same cleanup applies: release all previously acquired leases in reverse order.

### Evidence

The sync_runs or reconciliation_results row for the deferred operation records:
- status = 'skipped_lock_held'
- reason_code = 'LEASE_HELD'
- The domain_name of the lease that could not be acquired is recorded in the evidence fields (lower_bound or a dedicated detail field).

### Schema impact

None. Behavioral contract only.

---

## Medium 5: Resurrection Event Transactional Atomicity

**Extends:** v1.2.1 Correction B (Consistent Resurrection Contract).

### Problem

v1.2.1 defines the resurrection invariant "active implies fresh" but does not explicitly require the tombstone_events 'reverted' row to be written in the same transaction as the sync_status change. If the transaction commits the status change but crashes before the event is recorded, the row is active without audit evidence.

### Invariant

**Resurrection atomicity rule:** The following three operations MUST execute within a single database transaction:

1. Upsert of fresh AMAIA field data to the destination row.
2. Setting sync_status = 'active' on the destination row.
3. Insert of a tombstone_events row with transition = 'reverted'.

If any of the three operations fails, the entire transaction rolls back. No row can be 'active' without a corresponding 'reverted' event in the audit trail.

**Application to Path A (incremental sync):**
The domain processor's upsert transaction includes: field data write, sync_status = 'active', and tombstone_events insert. All atomic.

**Application to Path B (reconciliation detection):**
The reconciliation transaction includes: sync_status = 'reactivation_pending' and tombstone_events insert with transition = 'reverted'. Both atomic. The subsequent refresh transaction (domain processor) includes: field data write, sync_status = 'active'. No additional tombstone_events row is needed for the refresh step — the 'reverted' event was already recorded during detection.

**Application to Path B (refresh failure):**
If the domain processor fetches from AMAIA and the row does not exist (false resurrection), the transaction includes: sync_status = 'inactive_confirmed' and tombstone_events insert with transition = 'detected' (restarting the lifecycle). Both atomic.

### Schema impact

None. Behavioral contract only.

---

## Medium 6: Runtime-Mandatory cycle_id and scope_descriptor

**Extends:** v1.2 Correction 7 (Durable Cycle Traceability).

### Problem

v1.2 declares cycle_id (on sync_runs and reconciliation_results) and scope_descriptor (on reconciliation_results) as nullable columns for schema-level backward compatibility. But if the runtime is permitted to omit them, the traceability guarantee is hollow — an auditor cannot distinguish "old row from before traceability was implemented" from "new row where the engine forgot to set cycle_id."

### Runtime contract

**For amaia_sync_runs:** Every new row inserted by the sync engine, the Reconciliation Engine, or the Correlation Engine MUST have a non-null cycle_id. The cycle_id is set by the Scheduler at cycle start and propagated to all operations within the cycle. A sync_runs row with null cycle_id is a bug.

**For amaia_sync_reconciliation_results:** Every new row inserted by the Reconciliation Engine MUST have non-null cycle_id AND non-null scope_descriptor. A reconciliation_results row with null cycle_id or null scope_descriptor is a bug.

**Schema-level nullable is preserved** for backward compatibility with any existing rows (currently 0 rows, but the principle holds for future schema migrations that might run before the engine is updated). The constraint is enforced at the application layer, not the database layer.

**Audit rule:** Any amaia_sync_runs row with null cycle_id that has started_at after the v1.2.2 engine deployment date is flagged as an integrity violation.

### Schema impact

None. The columns remain nullable in the schema. The mandate is a runtime contract, not a DDL change.

---

## Medium 7: Precise upstream_run_id Semantics

**Extends:** v1.2 Correction 7 (Durable Cycle Traceability).

### Problem

v1.2 defines upstream_run_id as "for alerta runs, explicitly records the logestado run whose watermark output was consumed." But when alerta processes backlog spanning multiple prior logestado runs (e.g., the logestado watermark was advanced by runs R1, R2, R3 across cycles N-2, N-1, N), which run does upstream_run_id point to?

### Semantics

**upstream_run_id points to the most recent SUCCESSFUL logestado run that established the upper bound M used by the alerta processor.**

Formally: the alerta processor reads M from amaia_sync_watermarks WHERE entity_name = 'logestado'. This value was written by a specific logestado run (the one that advanced the watermark to M). That run's id is the upstream_run_id.

**How to identify it:** The alerta processor queries amaia_sync_runs for the most recent row WHERE domain_name = 'logestado' AND status = 'success' AND watermark_after_id = M. This is the run that established M.

**Even when backlog spans multiple runs:** If M was set by logestado run R3 in cycle N, and the alerta trigger cursor N was last advanced in cycle N-3, the alerta run's upstream_run_id points to R3 — the run that established the specific watermark value used as the upper bound. It does not point to R1 or R2, even though the backlog includes rows synced by those earlier runs.

**Rationale:** The upstream_run_id answers the question "which logestado run's watermark did this alerta run trust as its upper bound?" This is the causally relevant run. The full history of how the backlog accumulated is available by querying the chain of logestado runs with watermark_after_id values in the range (N, M].

**For non-alerta domains:** upstream_run_id is NULL. No other domain currently has a cross-domain causal dependency. If a future domain introduces one, the same semantics apply.

### Schema impact

None. Semantic clarification only.

---

## Medium 8: Tier 4 Segments Track Success, Not Attempt

This finding is fully resolved by Blocker 3. The segment selection algorithm, SLA measurement, and scope_descriptor suffix convention defined in Blocker 3 all enforce success-based tracking. No additional correction is needed.

For completeness, the key rules:
- A failed reconciliation of a segment does NOT update the segment's last_successful_coverage_at.
- The scope_descriptor suffix ':success' vs ':failed:{reason}' enables unambiguous filtering.
- The SLA (84 days) is measured against the most recent ':success' entry, not the most recent attempt.

---

## Schema Gap Analysis — Delta from v1.2

All DDL from v1.2 remains required and unchanged. The following is additive.

### New table

| Table | Justification | Finding |
|---|---|---|
| amaia_sync_workset_exceptions | Durable, operator-approved exception ledger for phantom/invalid alert references. Required to resolve fail-stuck blocking without resorting to silent skip. | Blocker 2 |

**Columns:**
- id: uuid PK, default gen_random_uuid()
- domain_name: text NOT NULL
- source_amaia_id: integer NOT NULL
- referenced_amaia_id: integer (nullable — NULL when the source row itself has null alert_amaia_id)
- detection_run_id: uuid, FK → amaia_sync_runs(id) ON DELETE SET NULL
- invalidity_type: text NOT NULL, CHECK ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other')
- amaia_lookup_evidence: text NOT NULL
- amaia_lookup_at: timestamptz NOT NULL
- status: text NOT NULL, CHECK ('pending_review', 'approved', 'rejected'), default 'pending_review'
- approved_by: text (nullable)
- approved_at: timestamptz (nullable)
- comment: text NOT NULL, CHECK (length(comment) > 0)
- created_at: timestamptz NOT NULL, default now()

**Constraints:**
- UNIQUE (domain_name, source_amaia_id)

**Indexes:**
- idx_amaia_sync_workset_exceptions_domain_status on (domain_name, status)
- idx_amaia_sync_workset_exceptions_detection_run_id on (detection_run_id)

**RLS:** enabled. Policy: admin/super_admin select.

### Complete DDL inventory (v1.2 + v1.2.2)

| Category | Item | Source |
|---|---|---|
| New table | amaia_sync_cycles | v1.2 C7 |
| New table | amaia_sync_workset_exceptions | v1.2.2 Blocker 2 |
| New column | amaia_sync_runs.cycle_id (uuid, nullable, FK) | v1.2 C7 |
| New column | amaia_sync_runs.upstream_run_id (uuid, nullable, FK) | v1.2 C7 |
| New column | amaia_sync_reconciliation_results.cycle_id (uuid, nullable, FK) | v1.2 C7 |
| New column | amaia_sync_reconciliation_results.scope_descriptor (text, nullable) | v1.2 C5/C7 |
| Modified CHECK | amaia_sync_runs.reason_code + 'WORKSET_INTEGRITY_FAILURE' | v1.2 C2 |
| Modified CHECK | amaia_beneficiaries.sync_status + 'reactivation_pending' | v1.2 C4 |
| Modified CHECK | amaia_support_network.sync_status + 'reactivation_pending' | v1.2 C4 |
| Modified CHECK | amaia_alerts.sync_status + 'reactivation_pending' | v1.2 C4 |
| New index | idx_amaia_sync_runs_cycle_id | v1.2 C7 |
| New index | idx_amaia_sync_runs_upstream_run_id | v1.2 C7 |
| New index | idx_amaia_sync_reconciliation_results_cycle_id | v1.2 C7 |
| New index | idx_amaia_sync_cycles_started_at | v1.2 C7 |
| New index | idx_amaia_sync_cycles_status | v1.2 C7 |
| New index | idx_amaia_sync_workset_exceptions_domain_status | v1.2.2 Blocker 2 |
| New index | idx_amaia_sync_workset_exceptions_detection_run_id | v1.2.2 Blocker 2 |
| Data correction | amaia_sync_watermarks entity_name='alerta' | v1.1 C1 |

**Totals:** 2 new tables, 4 new columns, 4 modified CHECKs, 7 new indexes, 1 data correction.

---

## Hallazgo Codex → Resolución v1.2.2

### Critical blockers (v1.2.1 audit)

| # | Hallazgo | Resolución | Schema | Closed? |
|---|---|---|---|---|
| B1 | Logestado can skip source rows and advance watermark, making alerta blind to the gap | Logestado Zero-Skip Rule: every row persisted (degraded if needed), count verification post-upsert, SUCCESS_WITH_QUALITY_ISSUES only if zero skips. Behavioral override of v1.0 Step 5 for logestado. | None | Yes |
| B2 | Phantom references block alerta indefinitely with no resolution path | amaia_sync_workset_exceptions ledger: operator-approved exceptions with mandatory evidence, identity, comment. Cursor advances past excepted rows only. Status lifecycle: pending_review → approved/rejected. | DDL: 1 new table | Yes |
| B3 | Tier 4 SLA assumes zero failures; closed alerts without logestado unclassified | Oldest-first segment selection with catch-up (up to 2 segments/cycle). SLA measured by success. Classification fallback: logestado action_date → alert_created_at → unconditional Tier 4 for anomalies. | None (within v1.2 DDL) | Yes |

### Medium findings (v1.2.1 audit)

| # | Hallazgo | Resolución | Schema | Closed? |
|---|---|---|---|---|
| M4 | Partial multi-lease acquisition retains unused leases | All-or-nothing: if any acquisition in the canonical sequence fails, all previously acquired leases are released in reverse order. 10s lock timeout. Deferred to next cycle. | None | Yes |
| M5 | Resurrection Path A may commit active status without tombstone event | Resurrection atomicity rule: upsert + sync_status + tombstone_events insert in same transaction. Applies to Path A, Path B detection, and Path B refresh failure. | None | Yes |
| M6 | cycle_id and scope_descriptor nullable allows engine to omit them | Runtime contract: non-null mandatory for all new rows. Schema remains nullable for backward compat. Null after deployment date = integrity violation. | None | Yes |
| M7 | upstream_run_id ambiguous when backlog spans multiple logestado runs | Points to the specific logestado run that advanced watermark to M (the upper bound). Identified by: domain_name='logestado' AND status='success' AND watermark_after_id=M. | None | Yes |
| M8 | Tier 4 segment "covered" on attempt, not success | Merged into Blocker 3. scope_descriptor suffix ':success'/':failed:{reason}'. SLA clock resets only on success. | None | Yes |

### Inherited from prior versions (unchanged)

| # | Hallazgo | Source | Status |
|---|---|---|---|
| 1 | Lease ownership predicate incomplete | Codex v1.1 | Closed (v1.2 C1) |
| 2 | Alerta workset NULL-only validation | Codex v1.1 | Closed (v1.2 C2 → v1.2.1 A → v1.2.2 B1+B2) |
| 3 | Reconciliation TOCTOU | Codex v1.1 | Closed (v1.2 C3) |
| 4 | Tombstone stale resurrection | Codex v1.1 | Closed (v1.2 C4 → v1.2.1 B → v1.2.2 M5) |
| 5 | Tier 4 non-deterministic | Codex v1.1 | Closed (v1.2 C5 → v1.2.2 B3+M8) |
| 6 | Alerta backlog blocked | Codex v1.1 | Closed (v1.2 C6) |
| 7 | No cycle traceability | Codex v1.1 | Closed (v1.2 C7 → v1.2.2 M6+M7) |
| A | Workset referential validation gap | Internal v1.2 | Closed (v1.2.1 A → v1.2.2 B1+B2) |
| B | Resurrection contract contradiction | Internal v1.2 | Closed (v1.2.1 B → v1.2.2 M5) |
| C | Multi-lease deadlock vector | Internal v1.2 | Closed (v1.2.1 C → v1.2.2 M4) |

---

## Open Risks (updated)

### Risk 1-4: Unchanged from v1.2

See v1.2 Open Risks 1-4 (clock skew, fail-closed blocking, reconciliation contention, cycles table growth).

### Risk 5: Logestado degraded persistence masking source issues

The Zero-Skip Rule (Blocker 1) allows logestado rows to be persisted with degraded non-critical fields. If the degradation is systematic (e.g., a schema change in AMAIA breaks action text parsing), a large number of degraded rows accumulate without triggering a hard failure. The operator may not notice until reconciliation detects field drift.

**Mitigation:** The SUCCESS_WITH_QUALITY_ISSUES reason_code and the quality issue count in amaia_sync_runs provide a durable signal. A configurable threshold can trigger an alert if quality issues exceed N% of rows in a single run. This threshold is an operational parameter, not an architectural invariant.

### Risk 6: Workset exception abuse

The exception ledger allows an operator to approve advancing past phantom references. An operator who approves exceptions without proper investigation could silently lose alert state changes.

**Mitigation:** The ledger requires a non-empty comment, a timestamped identity (approved_by), and factual AMAIA lookup evidence. These are necessary but not sufficient controls. Organizational process (review of exceptions by a second operator, periodic audit of approved exceptions) is outside the scope of the sync engine architecture but is recommended.

---

## Final Architectural Decision

This revision closes 3 critical blockers and 5 medium findings from Codex's rejection of v1.2.1.

**Blocker 1 (logestado completeness):** The Zero-Skip Rule makes logestado the only domain where row-level persistence is mandatory regardless of normalization quality. Every source row reaches amaia_alert_logs. The alerta workset pre-validation can then trust that its input is complete.

**Blocker 2 (phantom resolution):** The workset exception ledger (amaia_sync_workset_exceptions) provides a durable, auditable, operator-gated resolution path. No silent skips. No indefinite blocking. The operator explicitly authorizes each exception with evidence and rationale.

**Blocker 3 (Tier 4 SLA):** Oldest-first segment selection with catch-up guarantees the 84-day SLA under failure conditions. SLA is measured by successful coverage, not attempt. Classification of closed alerts without logestado uses a deterministic fallback chain.

**DDL delta from v1.2:** One new table (amaia_sync_workset_exceptions). All other corrections are behavioral contracts within the existing DDL envelope.

**Cumulative DDL from v1.2 through v1.2.2:** 2 new tables, 4 new columns, 4 modified CHECKs, 7 new indexes, 1 data correction.

The document is ready for re-audit. If Codex approves, the next step is Fase 9.3-schema: authoring migration files for the complete DDL set declared across v1.2 and v1.2.2.

---

**End of document.**
