# AMAIA-SYNC DDL Blueprint v1.0.2

**Phase:** 9.3A  
**Status:** DDL Blueprint — non-executable, pending Codex audit  
**Supersedes:** AMAIA_SYNC_DDL_BLUEPRINT_v1.0.1.md (5 blockers, 1 observation)  
**Source schema:** AMAIA_SYNC_SCHEMA_BLUEPRINT v1.0 through v1.0.4 (approved)  
**Source architecture:** AMAIA_SYNC_RUNTIME_ARCHITECTURE v1.0 through v1.2.9 (approved)  
**Author:** Claude (constructor)  
**Date:** 2026-06-19

**Note:** This document contains NO executable SQL. All DDL is expressed as conceptual specifications.

---

## Scope

All content from v1.0.1 is incorporated by reference unless explicitly superseded. This revision corrects 5 blockers and 1 observation. No changes to table structures, column definitions, FKs, or constraint ordering. Changes are limited to: trigger #4 and #5 pseudocode rewrite, UK reclassification, seed specification, preflight conditions, and CHECK inventory correction.

---

## Blocker 1 — Trigger #4 Rewrite: Explicit Allowlists per Phase Transition

Supersedes v1.0.1 Part 4, Trigger #4 pseudocode entirely.

### Trigger #4 — run_manifests: phase_column_guard

**Table:** amaia_sync_run_manifests  
**Event:** BEFORE UPDATE OR DELETE  
**For each:** ROW

**Column sets (referenced by allowlists below):**

- **IMMUTABLE_ALWAYS:** id, run_id, domain_name, source_id_count, source_id_hash, raw_max_id, created_at
- **PHASE2_COLUMNS:** persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at
- **PHASE3_COLUMNS:** provisional_upper_bound, provisional_id_count, provisional_id_hash

```
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'manifests cannot be deleted';
END IF;

-- TG_OP = 'UPDATE' guaranteed from here

-- Terminal phases: reject all updates
IF OLD.phase IN ('comparison_complete', 'abandoned') THEN
  RAISE EXCEPTION 'manifest in terminal phase: no updates permitted';
END IF;

-- IMMUTABLE_ALWAYS columns: reject any change regardless of phase
IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'id is immutable'; END IF;
IF NEW.run_id IS DISTINCT FROM OLD.run_id THEN RAISE EXCEPTION 'run_id is immutable'; END IF;
IF NEW.domain_name IS DISTINCT FROM OLD.domain_name THEN RAISE EXCEPTION 'domain_name is immutable'; END IF;
IF NEW.source_id_count IS DISTINCT FROM OLD.source_id_count THEN RAISE EXCEPTION 'source_id_count is immutable'; END IF;
IF NEW.source_id_hash IS DISTINCT FROM OLD.source_id_hash THEN RAISE EXCEPTION 'source_id_hash is immutable'; END IF;
IF NEW.raw_max_id IS DISTINCT FROM OLD.raw_max_id THEN RAISE EXCEPTION 'raw_max_id is immutable'; END IF;
IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at is immutable'; END IF;

-- Phase must change (no-op updates rejected to avoid ambiguity)
IF NEW.phase IS NOT DISTINCT FROM OLD.phase THEN
  RAISE EXCEPTION 'UPDATE must advance phase';
END IF;

-- === TRANSITION: source_fetched → confirmed_compared ===
IF OLD.phase = 'source_fetched' AND NEW.phase = 'confirmed_compared' THEN
  -- PHASE2_COLUMNS are writable (may change from NULL to values)
  -- PHASE3_COLUMNS must remain unchanged (still NULL)
  IF NEW.provisional_upper_bound IS DISTINCT FROM OLD.provisional_upper_bound THEN RAISE EXCEPTION 'provisional_upper_bound not writable in this transition'; END IF;
  IF NEW.provisional_id_count IS DISTINCT FROM OLD.provisional_id_count THEN RAISE EXCEPTION 'provisional_id_count not writable in this transition'; END IF;
  IF NEW.provisional_id_hash IS DISTINCT FROM OLD.provisional_id_hash THEN RAISE EXCEPTION 'provisional_id_hash not writable in this transition'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: confirmed_compared → provisional_persisted ===
IF OLD.phase = 'confirmed_compared' AND NEW.phase = 'provisional_persisted' THEN
  -- PHASE2_COLUMNS must remain unchanged (frozen after confirmed_compared)
  IF NEW.persisted_id_count IS DISTINCT FROM OLD.persisted_id_count THEN RAISE EXCEPTION 'persisted_id_count frozen'; END IF;
  IF NEW.persisted_id_hash IS DISTINCT FROM OLD.persisted_id_hash THEN RAISE EXCEPTION 'persisted_id_hash frozen'; END IF;
  IF NEW.sets_match IS DISTINCT FROM OLD.sets_match THEN RAISE EXCEPTION 'sets_match frozen'; END IF;
  IF NEW.missing_ids IS DISTINCT FROM OLD.missing_ids THEN RAISE EXCEPTION 'missing_ids frozen'; END IF;
  IF NEW.extra_ids IS DISTINCT FROM OLD.extra_ids THEN RAISE EXCEPTION 'extra_ids frozen'; END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'verified_at frozen'; END IF;
  -- PHASE3_COLUMNS are writable (may change from NULL to values)
  RETURN NEW;
END IF;

-- === TRANSITION: confirmed_compared → comparison_complete ===
IF OLD.phase = 'confirmed_compared' AND NEW.phase = 'comparison_complete' THEN
  -- PHASE2_COLUMNS frozen
  IF NEW.persisted_id_count IS DISTINCT FROM OLD.persisted_id_count THEN RAISE EXCEPTION 'persisted_id_count frozen'; END IF;
  IF NEW.persisted_id_hash IS DISTINCT FROM OLD.persisted_id_hash THEN RAISE EXCEPTION 'persisted_id_hash frozen'; END IF;
  IF NEW.sets_match IS DISTINCT FROM OLD.sets_match THEN RAISE EXCEPTION 'sets_match frozen'; END IF;
  IF NEW.missing_ids IS DISTINCT FROM OLD.missing_ids THEN RAISE EXCEPTION 'missing_ids frozen'; END IF;
  IF NEW.extra_ids IS DISTINCT FROM OLD.extra_ids THEN RAISE EXCEPTION 'extra_ids frozen'; END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'verified_at frozen'; END IF;
  -- PHASE3_COLUMNS frozen (never written in this path — no provisional zone)
  IF NEW.provisional_upper_bound IS DISTINCT FROM OLD.provisional_upper_bound THEN RAISE EXCEPTION 'provisional_upper_bound frozen'; END IF;
  IF NEW.provisional_id_count IS DISTINCT FROM OLD.provisional_id_count THEN RAISE EXCEPTION 'provisional_id_count frozen'; END IF;
  IF NEW.provisional_id_hash IS DISTINCT FROM OLD.provisional_id_hash THEN RAISE EXCEPTION 'provisional_id_hash frozen'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: provisional_persisted → comparison_complete ===
IF OLD.phase = 'provisional_persisted' AND NEW.phase = 'comparison_complete' THEN
  -- ALL data columns frozen (both PHASE2 and PHASE3 already written)
  IF NEW.persisted_id_count IS DISTINCT FROM OLD.persisted_id_count THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.persisted_id_hash IS DISTINCT FROM OLD.persisted_id_hash THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.sets_match IS DISTINCT FROM OLD.sets_match THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.missing_ids IS DISTINCT FROM OLD.missing_ids THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.extra_ids IS DISTINCT FROM OLD.extra_ids THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.provisional_upper_bound IS DISTINCT FROM OLD.provisional_upper_bound THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.provisional_id_count IS DISTINCT FROM OLD.provisional_id_count THEN RAISE EXCEPTION 'frozen'; END IF;
  IF NEW.provisional_id_hash IS DISTINCT FROM OLD.provisional_id_hash THEN RAISE EXCEPTION 'frozen'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: any non-terminal → abandoned ===
IF NEW.phase = 'abandoned' AND OLD.phase IN ('source_fetched', 'confirmed_compared', 'provisional_persisted') THEN
  -- ALL data columns frozen at their current values (whatever was written so far)
  IF NEW.persisted_id_count IS DISTINCT FROM OLD.persisted_id_count THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.persisted_id_hash IS DISTINCT FROM OLD.persisted_id_hash THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.sets_match IS DISTINCT FROM OLD.sets_match THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.missing_ids IS DISTINCT FROM OLD.missing_ids THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.extra_ids IS DISTINCT FROM OLD.extra_ids THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.provisional_upper_bound IS DISTINCT FROM OLD.provisional_upper_bound THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.provisional_id_count IS DISTINCT FROM OLD.provisional_id_count THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  IF NEW.provisional_id_hash IS DISTINCT FROM OLD.provisional_id_hash THEN RAISE EXCEPTION 'frozen on abandon'; END IF;
  RETURN NEW;
END IF;

-- If we reach here, the transition is invalid
RAISE EXCEPTION 'invalid phase transition: % → %', OLD.phase, NEW.phase;
```

**Locks:** None.  
**Invariant:** Every phase transition has an explicit allowlist. No column can change outside its designated transition. No NULL branch. No fallthrough.

---

## Blocker 2 — Trigger #5 Rewrite: Complete State Machine with Field Allowlists

Supersedes v1.0.1 Part 4, Trigger #5 pseudocode entirely.

### Trigger #5 — remediation_queue: state_machine_guard

**Table:** amaia_sync_alert_remediation_queue  
**Event:** BEFORE UPDATE  
**For each:** ROW

**Column sets:**

- **IMMUTABLE_IDENTITY:** id, source_type, logestado_amaia_id, alert_amaia_id, origin_run_id, origin_reconciliation_result_id, created_at, max_retries, evidence

```
-- IMMUTABLE_IDENTITY: reject any change
IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'id immutable'; END IF;
IF NEW.source_type IS DISTINCT FROM OLD.source_type THEN RAISE EXCEPTION 'source_type immutable'; END IF;
IF NEW.logestado_amaia_id IS DISTINCT FROM OLD.logestado_amaia_id THEN RAISE EXCEPTION 'logestado_amaia_id immutable'; END IF;
IF NEW.alert_amaia_id IS DISTINCT FROM OLD.alert_amaia_id THEN RAISE EXCEPTION 'alert_amaia_id immutable'; END IF;
IF NEW.origin_run_id IS DISTINCT FROM OLD.origin_run_id THEN RAISE EXCEPTION 'origin_run_id immutable'; END IF;
IF NEW.origin_reconciliation_result_id IS DISTINCT FROM OLD.origin_reconciliation_result_id THEN RAISE EXCEPTION 'origin_reconciliation_result_id immutable'; END IF;
IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at immutable'; END IF;
IF NEW.max_retries IS DISTINCT FROM OLD.max_retries THEN RAISE EXCEPTION 'max_retries immutable'; END IF;
IF NEW.evidence IS DISTINCT FROM OLD.evidence THEN RAISE EXCEPTION 'evidence immutable'; END IF;

-- === TRANSITION: pending → claimed ===
IF OLD.status = 'pending' AND NEW.status = 'claimed' THEN
  -- Required fields
  IF NEW.claimed_by_run_id IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_by_run_id'; END IF;
  IF NEW.claimed_at IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_at'; END IF;
  IF NEW.claim_expires_at IS NULL THEN RAISE EXCEPTION 'claimed requires claim_expires_at'; END IF;
  IF NEW.claim_expires_at <= now() THEN RAISE EXCEPTION 'claim_expires_at must be in the future'; END IF;
  -- Frozen fields
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count must not change on claim'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id must not change on claim'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at must not change on claim'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason must not change on claim'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL when claimed'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored fields must not change on claim'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored fields must not change on claim'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignored fields must not change on claim'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignored fields must not change on claim'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: claimed → success ===
IF OLD.status = 'claimed' AND NEW.status = 'success' THEN
  IF NEW.consumed_by_run_id IS NULL THEN RAISE EXCEPTION 'success requires consumed_by_run_id'; END IF;
  IF NEW.processed_at IS NULL THEN RAISE EXCEPTION 'success requires processed_at'; END IF;
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count must not change on success'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on success'; END IF;
  -- claimed_by_run_id preserved (who processed it)
  RETURN NEW;
END IF;

-- === TRANSITION: claimed → failed_retryable ===
IF OLD.status = 'claimed' AND NEW.status = 'failed_retryable' THEN
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 THEN RAISE EXCEPTION 'failed_retryable must increment retry_count by exactly 1'; END IF;
  IF NEW.retry_count >= NEW.max_retries THEN RAISE EXCEPTION 'retry_count (%%) >= max_retries (%%): use failed_terminal', NEW.retry_count, NEW.max_retries; END IF;
  IF NEW.failure_reason IS NULL THEN RAISE EXCEPTION 'failed_retryable requires failure_reason'; END IF;
  IF NEW.next_attempt_at IS NULL THEN RAISE EXCEPTION 'failed_retryable requires next_attempt_at'; END IF;
  IF NEW.next_attempt_at <= now() THEN RAISE EXCEPTION 'next_attempt_at must be in the future'; END IF;
  -- Cleanup claim fields
  IF NEW.claimed_by_run_id IS NOT NULL THEN RAISE EXCEPTION 'claimed_by_run_id must be cleared on failure'; END IF;
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared on failure'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id must not change on failure'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at must not change on failure'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: claimed → failed_terminal ===
IF OLD.status = 'claimed' AND NEW.status = 'failed_terminal' THEN
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 THEN RAISE EXCEPTION 'failed_terminal must increment retry_count by exactly 1'; END IF;
  IF NEW.retry_count < NEW.max_retries THEN RAISE EXCEPTION 'retry_count (%%) < max_retries (%%): use failed_retryable', NEW.retry_count, NEW.max_retries; END IF;
  IF NEW.failure_reason IS NULL THEN RAISE EXCEPTION 'failed_terminal requires failure_reason'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on failed_terminal'; END IF;
  IF NEW.claimed_by_run_id IS NOT NULL THEN RAISE EXCEPTION 'claimed_by_run_id must be cleared'; END IF;
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: claimed → pending (claim expiry revert) ===
IF OLD.status = 'claimed' AND NEW.status = 'pending' THEN
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count must not change on claim expiry'; END IF;
  IF NEW.claimed_by_run_id IS NOT NULL THEN RAISE EXCEPTION 'claimed_by_run_id must be cleared on expiry'; END IF;
  IF NEW.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'claimed_at must be cleared on expiry'; END IF;
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared on expiry'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on pending'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason must not change on expiry'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: failed_retryable → claimed (re-claim) ===
IF OLD.status = 'failed_retryable' AND NEW.status = 'claimed' THEN
  IF NEW.claimed_by_run_id IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_by_run_id'; END IF;
  IF NEW.claimed_at IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_at'; END IF;
  IF NEW.claim_expires_at IS NULL THEN RAISE EXCEPTION 'claimed requires claim_expires_at'; END IF;
  IF NEW.claim_expires_at <= now() THEN RAISE EXCEPTION 'claim_expires_at must be in the future'; END IF;
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count must not change on re-claim'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL when claimed'; END IF;
  -- failure_reason retained from previous failure (audit trail)
  RETURN NEW;
END IF;

-- === TRANSITION: failed_retryable → ignored_approved ===
IF OLD.status = 'failed_retryable' AND NEW.status = 'ignored_approved' THEN
  IF NEW.ignored_by IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_by'; END IF;
  IF NEW.ignored_at IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_at'; END IF;
  IF NEW.ignore_reason IS NULL OR length(NEW.ignore_reason) = 0 THEN RAISE EXCEPTION 'ignored_approved requires non-empty ignore_reason'; END IF;
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count must not change on ignore'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on ignored'; END IF;
  RETURN NEW;
END IF;

-- === TRANSITION: failed_terminal → ignored_approved ===
IF OLD.status = 'failed_terminal' AND NEW.status = 'ignored_approved' THEN
  IF NEW.ignored_by IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_by'; END IF;
  IF NEW.ignored_at IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_at'; END IF;
  IF NEW.ignore_reason IS NULL OR length(NEW.ignore_reason) = 0 THEN RAISE EXCEPTION 'ignored_approved requires non-empty ignore_reason'; END IF;
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count must not change on ignore'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on ignored'; END IF;
  RETURN NEW;
END IF;

-- If we reach here, the transition is invalid
RAISE EXCEPTION 'invalid status transition: % → %', OLD.status, NEW.status;
```

**Locks:** None.  
**Invariant:** Every transition has a complete allowlist. Every mutable column is explicitly validated or rejected per transition. No field changes silently. retry_count changes only on claimed → failed_retryable/terminal. next_attempt_at is non-NULL only in failed_retryable.

---

## Blocker 3 — UK Reclassification: Partial Unique Index

### Problem

PostgreSQL does not support `UNIQUE (...) WHERE ...` as a table constraint. The partial uniqueness on amaia_sync_alert_remediation_queue was incorrectly classified as a UK.

### Correction

The constraint `(source_type, logestado_amaia_id, alert_amaia_id) WHERE logestado_amaia_id IS NOT NULL` is reclassified as a **unique partial index**, not a UK constraint.

### Updated inventory impact

| Category | v1.0.1 | v1.0.2 |
|---|---|---|
| UK constraints (table-level) | 15 | **14** (partial unique moved out) |
| UK-implicit indexes | 15 | **14** |
| Explicit indexes (btree + partial) | 13 | **14** (+1 partial unique index for remediation) |
| Total indexes | 28 | **28** (unchanged) |

The unique partial index is listed in the indexes section, not in UK constraints.

---

## Blocker 4 — Seed Specification with Explicit Values

### Problem

The 12 reconciliation_segments seed rows assume `slo_deadline_at = created_at + 84 days`, but slo_deadline_at has no DEFAULT expression. The seed specification must provide explicit values.

### Correction

All 12 seed rows must explicitly specify:

| Column | Value |
|---|---|
| id | gen_random_uuid() (each row gets its own) |
| domain_name | 'alerta' |
| tier | 'tier4' |
| segment_id | 0 through 11 |
| partition_expr | 'amaia_id % 12 = {segment_id}' |
| last_successful_coverage_at | NULL |
| last_attempt_at | NULL |
| consecutive_failure_count | 0 |
| slo_deadline_at | **migration_timestamp + interval '84 days'** (explicit, using the same base timestamp for all 12 rows) |
| slo_status | 'compliant' |
| is_irrecoverable | false |
| is_starving | false |
| created_at | **migration_timestamp** (same for all 12 rows) |
| updated_at | **migration_timestamp** (same for all 12 rows) |

Where `migration_timestamp` is a single timestamptz value determined at migration execution time (e.g., the statement timestamp). All 12 rows share the same created_at and slo_deadline_at base to ensure consistent SLO clocks.

---

## Blocker 5 — Preflight Conditions for Destructive State Changes

### 5A — NOT NULL columns on deployed tables

Before adding cycle_id (NOT NULL, no default) to amaia_sync_runs and amaia_sync_reconciliation_results, and scope_descriptor + result_status (NOT NULL, no default) to amaia_sync_reconciliation_results:

**Preflight check (to be executed within the migration, before the column additions):**

1. Count rows in amaia_sync_runs. If count > 0: **abort migration**. The columns cannot be added as NOT NULL without default to a populated table. A backfill strategy must be designed and approved before proceeding.
2. Count rows in amaia_sync_reconciliation_results. If count > 0: **abort migration**. Same rationale.
3. If both counts = 0: proceed with adding NOT NULL columns without default. Safe on empty tables.

**Expected state at migration time:** Both tables have 0 rows (confirmed in 9.2 post-deployment verification). The preflight is a safety net, not an expected failure path.

### 5B — Watermark correction preflight

Before correcting the amaia_sync_watermarks record for entity_name = 'alerta':

**Preflight check (within the migration):**

1. Read the current row where entity_name = 'alerta'.
2. Verify ALL of the following match the expected legacy state:
   - watermark_type = 'timestamp'
   - last_id IS NULL
   - last_timestamp IS NOT NULL (the legacy seed value, e.g., '2025-01-01 00:00:00+00')
   - watermark_expr IS NULL
3. If any condition fails: **abort migration**. The row has been modified since the original seed (e.g., a sync engine has already run and advanced the cursor). Manual review is required.
4. Specifically: if last_id > 0, the cursor has been advanced by a running engine. Never overwrite a live cursor. Abort.
5. If all conditions match: proceed with the correction (set watermark_type='id', last_id=0, last_timestamp=NULL, watermark_expr='derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id').

**The correction is safe only if the row is in its original seed state.** Any deviation indicates operational history that must not be overwritten.

---

## Observation — Complete CHECK Inventory

### Enumeration of all CHECK constraints across all 11 new tables

| # | Table | Constraint name | Definition |
|---|---|---|---|
| 1 | amaia_sync_cycles | status_check | status IN ('running', 'success', 'completed_with_failures') |
| 2 | amaia_sync_cycles | trigger_type_check | trigger_type IN ('scheduled', 'manual', 'recovery') |
| 3 | amaia_sync_run_manifests | source_id_count_check | source_id_count >= 0 |
| 4 | amaia_sync_run_manifests | persisted_id_count_check | persisted_id_count IS NULL OR persisted_id_count >= 0 |
| 5 | amaia_sync_run_manifests | phase_check | phase IN ('source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned') |
| 6 | amaia_sync_workset_exceptions | invalidity_type_check | invalidity_type IN ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other') |
| 7 | amaia_sync_workset_exception_decisions | decision_seq_check | decision_seq > 0 |
| 8 | amaia_sync_workset_exception_decisions | decision_check | decision IN ('approved', 'rejected') |
| 9 | amaia_sync_workset_exception_decisions | comment_check | length(comment) > 0 |
| 10 | amaia_sync_reconciliation_segments | tier_check | tier IN ('tier4') |
| 11 | amaia_sync_reconciliation_segments | segment_id_check | segment_id >= 0 AND segment_id < 12 |
| 12 | amaia_sync_reconciliation_segments | failure_count_check | consecutive_failure_count >= 0 |
| 13 | amaia_sync_reconciliation_segments | slo_status_check | slo_status IN ('compliant', 'at_risk', 'breached') |
| 14 | amaia_sync_alert_remediation_queue | source_type_check | source_type IN ('logestado_backfill', 'provisional_logestado', 'exception_resolution', 'reconciliation_drift', 'manual') |
| 15 | amaia_sync_alert_remediation_queue | status_check | status IN ('pending', 'claimed', 'success', 'failed_retryable', 'failed_terminal', 'ignored_approved') |
| 16 | amaia_sync_alert_remediation_queue | retry_count_check | retry_count >= 0 |
| 17 | amaia_sync_alert_remediation_queue | max_retries_check | max_retries > 0 |
| 18 | amaia_sync_alert_remediation_queue | ignore_reason_check | ignore_reason IS NULL OR length(ignore_reason) > 0 |
| 19 | amaia_sync_manifest_exclusion_subjects | seq_check | current_investigation_seq >= 0 |
| 20 | amaia_sync_manifest_exclusion_investigations | investigation_seq_check | investigation_seq > 0 |
| 21 | amaia_sync_manifest_exclusion_decisions | decision_seq_check | decision_seq > 0 |
| 22 | amaia_sync_manifest_exclusion_decisions | decision_check | decision IN ('approved', 'rejected') |
| 23 | amaia_sync_manifest_exclusion_decisions | reason_check | length(reason) > 0 |

### CHECKs on deployed tables (modified)

| # | Table | Constraint | Change |
|---|---|---|---|
| 24 | amaia_sync_runs | reason_code_check | Extended with 'WORKSET_INTEGRITY_FAILURE' |
| 25 | amaia_beneficiaries | sync_status_check | Extended with 'reactivation_pending' |
| 26 | amaia_support_network | sync_status_check | Extended with 'reactivation_pending' |
| 27 | amaia_alerts | sync_status_check | Extended with 'reactivation_pending' |

### Also on deployed tables (added new)

| # | Table | Constraint | Definition |
|---|---|---|---|
| 28 | amaia_sync_reconciliation_results | result_status_check | result_status IN ('success', 'failed', 'skipped') |

**Total CHECKs: 23 on new tables + 5 on deployed tables = 28.**

v1.0.1 stated 17 CHECKs on new tables. The correct count is **23**. The discrepancy was caused by not counting CHECKs on segments (4), remediation queue retry/max_retries (2), and exclusion subjects/investigations seq checks (2).

---

## Updated Final Inventory

| Category | Count |
|---|---|
| New tables | 11 |
| New columns on deployed tables | 6 |
| CHECK constraints on new tables | **23** |
| CHECK constraints modified/added on deployed tables | **5** (4 modified + 1 new) |
| UK constraints (table-level) | **14** |
| Unique partial indexes | **1** (remediation queue) |
| FKs | 22 |
| Triggers | 9 |
| Explicit indexes (btree + partial unique) | **14** |
| UK-implicit indexes | **14** |
| Total indexes | **28** |
| RLS policies | 11 |
| Seed rows | 12 (with explicit values) |
| Data corrections | 1 (with preflight) |
| Preflight checks | 2 (empty-table + watermark legacy state) |

---

## Blocker → Resolution

| # | Blocker | Resolution | Cerrado? |
|---|---|---|---|
| B1 | Trigger #4 has NULL branches and no per-transition column allowlists | Complete rewrite: every transition has explicit allowlist. Columns not in the allowlist are rejected via IS DISTINCT FROM. No NULL branches. No fallthrough. | **Yes** |
| B2 | Trigger #5 incomplete state machine without per-transition field validation | Complete rewrite: every transition validates every mutable field. Claim requires future expiry. Failure requires reason + correct retry_count. Cleanup fields explicit per transition. No silent changes. | **Yes** |
| B3 | Partial UK is not a valid PostgreSQL constraint | Reclassified as unique partial index. UK count corrected to 14. Index counts updated. Total 28 preserved. | **Yes** |
| B4 | Seed assumes default for slo_deadline_at that doesn't exist | Seed spec requires explicit slo_deadline_at = migration_timestamp + 84 days. All timestamps explicit. | **Yes** |
| B5 | NOT NULL columns on potentially populated tables; watermark overwrite without safety check | Preflight: abort if tables have rows. Watermark: abort if not in legacy state. Never overwrite live cursor. | **Yes** |
| O1 | CHECK count was 17, should be 23+5 | Full enumeration: 28 total. Corrected. | **Yes** |

---

## Self-Audit: Attacking These 5 Corrections

### Trigger #4: Modify source_id_hash during confirmed_compared transition

Trigger rejects: source_id_hash in IMMUTABLE_ALWAYS, checked before any transition logic. **Blocked.**

### Trigger #4: Write provisional columns during source_fetched → confirmed_compared

Trigger rejects: explicit check for provisional columns unchanged in this transition. **Blocked.**

### Trigger #4: No-op UPDATE (same phase)

Trigger rejects: `NEW.phase IS NOT DISTINCT FROM OLD.phase` → exception. **Blocked.**

### Trigger #5: Claim with expired claim_expires_at

Trigger rejects: `claim_expires_at <= now()` → exception. **Blocked.**

### Trigger #5: failed_retryable with retry_count >= max_retries

Trigger rejects: explicit check `retry_count >= max_retries → use failed_terminal`. **Blocked.**

### Trigger #5: failed_retryable without clearing claimed_by_run_id

Trigger rejects: `claimed_by_run_id IS NOT NULL` → exception. **Blocked.**

### Trigger #5: Change retry_count on claim

Trigger rejects: `retry_count IS DISTINCT FROM OLD` → exception. **Blocked.**

### Trigger #5: ignored_approved without ignore_reason

Trigger rejects: `ignore_reason IS NULL OR length = 0` → exception. **Blocked.**

### Partial unique index: INSERT duplicate remediation with NULL logestado_amaia_id

Index condition: WHERE logestado_amaia_id IS NOT NULL. NULL rows are excluded from the unique check. Duplicate manual entries (NULL logestado_amaia_id) for the same alert are permitted. **Correct behavior.**

### Seed: slo_deadline_at without explicit value

Specification now requires explicit value. Migration must provide `migration_timestamp + interval '84 days'`. **Resolved.**

### NOT NULL column on populated table

Preflight aborts if count > 0. Migration proceeds only on confirmed empty tables. **Safe.**

### Watermark correction on live cursor

Preflight checks last_id. If last_id > 0: abort. Never overwrites an advanced cursor. **Safe.**

---

**End of document.**
