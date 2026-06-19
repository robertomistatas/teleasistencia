# AMAIA-SYNC DDL Blueprint v1.0.3

**Phase:** 9.3A  
**Status:** DDL Blueprint — non-executable, pending Codex audit  
**Supersedes:** AMAIA_SYNC_DDL_BLUEPRINT_v1.0.2.md (2 blockers)  
**Author:** Claude (constructor)  
**Date:** 2026-06-19

**Note:** This document contains NO executable SQL.

---

## Scope

All content from v1.0.2 is incorporated by reference unless explicitly superseded. Only Trigger #5 pseudocode and the watermark preflight specification are changed. All other triggers, table definitions, constraints, indexes, seeds, inventories, and preflight conditions are unchanged from v1.0.2.

---

## Blocker 1 — Trigger #5 Definitive Rewrite: Exhaustive Allowlists

Supersedes v1.0.2 Trigger #5 pseudocode entirely.

### Trigger #5 — remediation_queue: state_machine_guard

**Table:** amaia_sync_alert_remediation_queue  
**Event:** BEFORE UPDATE  
**For each:** ROW

**Design principle:** For every transition, every mutable column is either in the allowlist (explicitly validated) or in the frozen set (rejected if changed). No column escapes validation. RETURN NEW appears only after all checks pass.

**Column classification:**

- **ALWAYS_IMMUTABLE:** id, source_type, logestado_amaia_id, alert_amaia_id, origin_run_id, origin_reconciliation_result_id, created_at, max_retries
- **STATE_MUTABLE (14 columns, each controlled per transition):** status, claimed_by_run_id, claimed_at, claim_expires_at, retry_count, failure_reason, next_attempt_at, consumed_by_run_id, processed_at, ignored_by, ignored_at, ignore_reason, ignore_evidence, evidence

**evidence policy:** evidence is mutable during claim (A), success (B), failure (C/D), and ignore (G/H) transitions — it may accumulate processing context. It is frozen during claim expiry revert (E) and re-claim (F), where no new processing occurs.

```
-- ============================================================
-- ALWAYS_IMMUTABLE: reject any change, all transitions
-- ============================================================
IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'id immutable'; END IF;
IF NEW.source_type IS DISTINCT FROM OLD.source_type THEN RAISE EXCEPTION 'source_type immutable'; END IF;
IF NEW.logestado_amaia_id IS DISTINCT FROM OLD.logestado_amaia_id THEN RAISE EXCEPTION 'logestado_amaia_id immutable'; END IF;
IF NEW.alert_amaia_id IS DISTINCT FROM OLD.alert_amaia_id THEN RAISE EXCEPTION 'alert_amaia_id immutable'; END IF;
IF NEW.origin_run_id IS DISTINCT FROM OLD.origin_run_id THEN RAISE EXCEPTION 'origin_run_id immutable'; END IF;
IF NEW.origin_reconciliation_result_id IS DISTINCT FROM OLD.origin_reconciliation_result_id THEN RAISE EXCEPTION 'origin_reconciliation_result_id immutable'; END IF;
IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at immutable'; END IF;
IF NEW.max_retries IS DISTINCT FROM OLD.max_retries THEN RAISE EXCEPTION 'max_retries immutable'; END IF;

-- ============================================================
-- A) pending → claimed
-- Allowlist: status, claimed_by_run_id, claimed_at, claim_expires_at, evidence
-- ============================================================
IF OLD.status = 'pending' AND NEW.status = 'claimed' THEN
  -- Required
  IF NEW.claimed_by_run_id IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_by_run_id'; END IF;
  IF NEW.claimed_at IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_at'; END IF;
  IF NEW.claim_expires_at IS NULL THEN RAISE EXCEPTION 'claimed requires claim_expires_at'; END IF;
  IF NEW.claim_expires_at <= now() THEN RAISE EXCEPTION 'claim_expires_at must be in the future'; END IF;
  -- Frozen
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on claim'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on claim'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL when claimed'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen on claim'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen on claim'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen on claim'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen on claim'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen on claim'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen on claim'; END IF;
  -- evidence: allowed to change (claim context)
  RETURN NEW;
END IF;

-- ============================================================
-- B) claimed → success
-- Allowlist: status, consumed_by_run_id, processed_at, evidence
-- ============================================================
IF OLD.status = 'claimed' AND NEW.status = 'success' THEN
  -- Required
  IF NEW.consumed_by_run_id IS NULL THEN RAISE EXCEPTION 'success requires consumed_by_run_id'; END IF;
  IF NEW.processed_at IS NULL THEN RAISE EXCEPTION 'success requires processed_at'; END IF;
  -- Frozen
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on success'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on success'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on success'; END IF;
  IF NEW.claimed_by_run_id IS DISTINCT FROM OLD.claimed_by_run_id THEN RAISE EXCEPTION 'claimed_by_run_id frozen on success (preserved for audit)'; END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'claimed_at frozen on success'; END IF;
  IF NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'claim_expires_at frozen on success'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen on success'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen on success'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen on success'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen on success'; END IF;
  -- evidence: allowed to change (processing result context)
  RETURN NEW;
END IF;

-- ============================================================
-- C) claimed → failed_retryable
-- Allowlist: status, retry_count, failure_reason, next_attempt_at,
--            claimed_by_run_id (cleanup), claimed_at (cleanup),
--            claim_expires_at (cleanup), evidence
-- ============================================================
IF OLD.status = 'claimed' AND NEW.status = 'failed_retryable' THEN
  -- Required
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 THEN RAISE EXCEPTION 'failed_retryable must increment retry_count by exactly 1'; END IF;
  IF NEW.retry_count >= NEW.max_retries THEN RAISE EXCEPTION 'retry_count >= max_retries: use failed_terminal'; END IF;
  IF NEW.failure_reason IS NULL THEN RAISE EXCEPTION 'failed_retryable requires failure_reason'; END IF;
  IF NEW.next_attempt_at IS NULL THEN RAISE EXCEPTION 'failed_retryable requires next_attempt_at'; END IF;
  IF NEW.next_attempt_at <= now() THEN RAISE EXCEPTION 'next_attempt_at must be in the future'; END IF;
  -- Cleanup
  IF NEW.claimed_by_run_id IS NOT NULL THEN RAISE EXCEPTION 'claimed_by_run_id must be cleared on failure'; END IF;
  IF NEW.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'claimed_at must be cleared on failure'; END IF;
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared on failure'; END IF;
  -- Frozen
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen on failure'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen on failure'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen on failure'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen on failure'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen on failure'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen on failure'; END IF;
  -- evidence: allowed to change (error context)
  RETURN NEW;
END IF;

-- ============================================================
-- D) claimed → failed_terminal
-- Allowlist: status, retry_count, failure_reason,
--            claimed_by_run_id (cleanup), claimed_at (cleanup),
--            claim_expires_at (cleanup), evidence
-- ============================================================
IF OLD.status = 'claimed' AND NEW.status = 'failed_terminal' THEN
  -- Required
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 THEN RAISE EXCEPTION 'failed_terminal must increment retry_count by exactly 1'; END IF;
  IF NEW.retry_count < NEW.max_retries THEN RAISE EXCEPTION 'retry_count < max_retries: use failed_retryable'; END IF;
  IF NEW.failure_reason IS NULL THEN RAISE EXCEPTION 'failed_terminal requires failure_reason'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on failed_terminal'; END IF;
  -- Cleanup
  IF NEW.claimed_by_run_id IS NOT NULL THEN RAISE EXCEPTION 'claimed_by_run_id must be cleared'; END IF;
  IF NEW.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'claimed_at must be cleared'; END IF;
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared'; END IF;
  -- Frozen
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen'; END IF;
  -- evidence: allowed to change (terminal error context)
  RETURN NEW;
END IF;

-- ============================================================
-- E) claimed → pending (claim expiry revert)
-- Allowlist: status, claimed_by_run_id (cleanup), claimed_at (cleanup),
--            claim_expires_at (cleanup)
-- ============================================================
IF OLD.status = 'claimed' AND NEW.status = 'pending' THEN
  -- Precondition: claim must actually be expired
  IF OLD.claim_expires_at > now() THEN RAISE EXCEPTION 'cannot revert to pending: claim has not expired'; END IF;
  -- Cleanup
  IF NEW.claimed_by_run_id IS NOT NULL THEN RAISE EXCEPTION 'claimed_by_run_id must be cleared on expiry'; END IF;
  IF NEW.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'claimed_at must be cleared on expiry'; END IF;
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared on expiry'; END IF;
  -- Frozen (everything else)
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on expiry'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on expiry'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on pending'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen on expiry'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen on expiry'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen on expiry'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen on expiry'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen on expiry'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen on expiry'; END IF;
  IF NEW.evidence IS DISTINCT FROM OLD.evidence THEN RAISE EXCEPTION 'evidence frozen on expiry (no new processing occurred)'; END IF;
  RETURN NEW;
END IF;

-- ============================================================
-- F) failed_retryable → claimed (re-claim)
-- Allowlist: status, claimed_by_run_id, claimed_at, claim_expires_at,
--            next_attempt_at (cleanup)
-- ============================================================
IF OLD.status = 'failed_retryable' AND NEW.status = 'claimed' THEN
  -- Precondition: must be past next_attempt_at
  IF OLD.next_attempt_at > now() THEN RAISE EXCEPTION 'cannot re-claim: next_attempt_at has not been reached'; END IF;
  -- Required
  IF NEW.claimed_by_run_id IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_by_run_id'; END IF;
  IF NEW.claimed_at IS NULL THEN RAISE EXCEPTION 'claimed requires claimed_at'; END IF;
  IF NEW.claim_expires_at IS NULL THEN RAISE EXCEPTION 'claimed requires claim_expires_at'; END IF;
  IF NEW.claim_expires_at <= now() THEN RAISE EXCEPTION 'claim_expires_at must be in the future'; END IF;
  -- Cleanup
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be cleared when claimed'; END IF;
  -- Frozen (everything else)
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on re-claim'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on re-claim (retained for audit)'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen on re-claim'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen on re-claim'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen on re-claim'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen on re-claim'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen on re-claim'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen on re-claim'; END IF;
  IF NEW.evidence IS DISTINCT FROM OLD.evidence THEN RAISE EXCEPTION 'evidence frozen on re-claim (no new processing occurred)'; END IF;
  RETURN NEW;
END IF;

-- ============================================================
-- G) failed_retryable → ignored_approved
-- Allowlist: status, ignored_by, ignored_at, ignore_reason,
--            ignore_evidence, next_attempt_at (cleanup), evidence
-- ============================================================
IF OLD.status = 'failed_retryable' AND NEW.status = 'ignored_approved' THEN
  -- Required
  IF NEW.ignored_by IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_by'; END IF;
  IF NEW.ignored_at IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_at'; END IF;
  IF NEW.ignore_reason IS NULL OR length(NEW.ignore_reason) = 0 THEN RAISE EXCEPTION 'ignored_approved requires non-empty ignore_reason'; END IF;
  -- Cleanup
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be cleared on ignore'; END IF;
  -- Frozen
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on ignore'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on ignore'; END IF;
  IF NEW.claimed_by_run_id IS DISTINCT FROM OLD.claimed_by_run_id THEN RAISE EXCEPTION 'claimed_by_run_id frozen on ignore'; END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'claimed_at frozen on ignore'; END IF;
  IF NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'claim_expires_at frozen on ignore'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen on ignore'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen on ignore'; END IF;
  -- evidence: allowed to change (ignore context)
  RETURN NEW;
END IF;

-- ============================================================
-- H) failed_terminal → ignored_approved
-- Allowlist: status, ignored_by, ignored_at, ignore_reason,
--            ignore_evidence, evidence
-- ============================================================
IF OLD.status = 'failed_terminal' AND NEW.status = 'ignored_approved' THEN
  -- Required
  IF NEW.ignored_by IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_by'; END IF;
  IF NEW.ignored_at IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_at'; END IF;
  IF NEW.ignore_reason IS NULL OR length(NEW.ignore_reason) = 0 THEN RAISE EXCEPTION 'ignored_approved requires non-empty ignore_reason'; END IF;
  -- Frozen
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on ignore'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on ignore'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on ignore'; END IF;
  IF NEW.claimed_by_run_id IS DISTINCT FROM OLD.claimed_by_run_id THEN RAISE EXCEPTION 'claimed_by_run_id frozen on ignore'; END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'claimed_at frozen on ignore'; END IF;
  IF NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN RAISE EXCEPTION 'claim_expires_at frozen on ignore'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.consumed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id frozen on ignore'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN RAISE EXCEPTION 'processed_at frozen on ignore'; END IF;
  -- evidence: allowed to change (ignore context)
  RETURN NEW;
END IF;

-- ============================================================
-- No valid transition matched
-- ============================================================
RAISE EXCEPTION 'invalid status transition: % → %', OLD.status, NEW.status;
```

**Locks:** None (atomic UPDATE is the concurrency gate).

**Invariant:** Every one of the 14 mutable columns is explicitly validated or rejected in every one of the 8 transitions. No RETURN NEW before all frozen columns are checked. No column escapes.

### Allowlist verification matrix

| Column | A (p→c) | B (c→s) | C (c→fr) | D (c→ft) | E (c→p) | F (fr→c) | G (fr→ia) | H (ft→ia) |
|---|---|---|---|---|---|---|---|---|
| status | ✓ allow | ✓ allow | ✓ allow | ✓ allow | ✓ allow | ✓ allow | ✓ allow | ✓ allow |
| claimed_by_run_id | ✓ set | ✗ frozen | ✓ clear | ✓ clear | ✓ clear | ✓ set | ✗ frozen | ✗ frozen |
| claimed_at | ✓ set | ✗ frozen | ✓ clear | ✓ clear | ✓ clear | ✓ set | ✗ frozen | ✗ frozen |
| claim_expires_at | ✓ set>now | ✗ frozen | ✓ clear | ✓ clear | ✓ clear | ✓ set>now | ✗ frozen | ✗ frozen |
| retry_count | ✗ frozen | ✗ frozen | ✓ +1 | ✓ +1 | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen |
| failure_reason | ✗ frozen | ✗ frozen | ✓ set!null | ✓ set!null | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen |
| next_attempt_at | ✗ =NULL | ✗ =NULL | ✓ set>now | ✗ =NULL | ✗ =NULL | ✓ clear | ✓ clear | ✗ =NULL |
| consumed_by_run_id | ✗ frozen | ✓ set!null | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen |
| processed_at | ✗ frozen | ✓ set!null | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen |
| ignored_by | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✓ set!null | ✓ set!null |
| ignored_at | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✓ set!null | ✓ set!null |
| ignore_reason | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✓ set!empty | ✓ set!empty |
| ignore_evidence | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✗ frozen | ✓ allow | ✓ allow |
| evidence | ✓ allow | ✓ allow | ✓ allow | ✓ allow | ✗ frozen | ✗ frozen | ✓ allow | ✓ allow |

Legend: ✓ = in allowlist (validated). ✗ = frozen (rejected if changed). set = must be non-null. set!null = must be non-null. set!empty = must be non-null and non-empty. set>now = must be > now(). clear = must be NULL. +1 = must equal OLD + 1. =NULL = must be NULL. allow = may change freely.

Every cell is explicitly accounted for. No blanks. 14 columns × 8 transitions = 112 decisions, all documented.

---

## Blocker 2 — Watermark Preflight: Locked and Conditioned

Supersedes v1.0.2 Blocker 5B specification.

### Problem

v1.0.2's preflight reads the watermark row, checks legacy state, then applies the correction in a separate step. Between the read and the write, the runtime could advance the cursor (TOCTOU).

### Correction: Single-transaction locked conditional update

The watermark correction must execute as a single atomic operation within the migration transaction:

**Step 1 — Lock the target row.**

Within the migration transaction, acquire an exclusive row lock on the amaia_sync_watermarks row where entity_name = 'alerta'. This prevents any concurrent read or write to this row until the transaction commits or rolls back.

If the row does not exist: abort the migration. The seed data from the original 9.1 migration is missing and requires manual investigation.

**Step 2 — Validate legacy state under lock.**

While holding the lock, verify all of the following conditions simultaneously:

- watermark_type = 'timestamp'
- last_id IS NULL
- last_timestamp = '2025-01-01 00:00:00+00' (exact legacy seed value)
- watermark_expr IS NULL

If any condition is false: abort the migration. The row has been modified since the original seed. Possible causes:
- last_id > 0: a sync engine has already run and advanced the cursor. Never overwrite.
- watermark_type != 'timestamp': already corrected by a previous migration attempt.
- last_timestamp differs: manual modification occurred.
- watermark_expr IS NOT NULL: already corrected.

**Step 3 — Apply correction under lock with exact predicates.**

The correction is expressed as a conditional update that includes all legacy-state predicates in its condition. Conceptually:

- Update the row where entity_name = 'alerta' AND watermark_type = 'timestamp' AND last_id IS NULL AND last_timestamp = '2025-01-01 00:00:00+00' AND watermark_expr IS NULL.
- Set watermark_type = 'id', last_id = 0, last_timestamp = NULL, watermark_expr = 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id'.

**Step 4 — Verify exactly 1 row affected.**

If 0 rows affected: the predicates did not match (state changed between lock and update — should be impossible under the row lock, but defensive). Abort.

If more than 1 row affected: entity_name uniqueness violation (should be impossible given PK). Abort.

If exactly 1 row: success. The correction is committed with the rest of the migration transaction.

**Why the row lock eliminates TOCTOU:**

The exclusive row lock (acquired in Step 1) prevents any concurrent transaction from reading or writing this row until the migration transaction commits. The runtime's watermark advance operation also reads this row (to check the current watermark before advancing). If the runtime attempts this concurrently, it blocks on the lock until the migration commits. After the migration commits, the runtime sees the corrected row (watermark_type = 'id', last_id = 0) and operates on the new semantics.

No window exists between the validation and the update — they execute under the same held lock within the same transaction.

---

## Unchanged from v1.0.2

The following are explicitly confirmed unchanged:

- Trigger #1, #2, #3: append-only and serialize triggers for workset exception ledger
- Trigger #4: manifest phase_column_guard (rewritten in v1.0.2 B1, unchanged here)
- Trigger #6, #7, #8: exclusion investigation/decision/consumption triggers
- Trigger #9: subject_progression_guard
- All table definitions, columns, types, defaults
- All UK, FK, CHECK constraints
- Partial unique index on remediation queue
- All btree and partial indexes
- Seed specification for 12 reconciliation_segments rows
- Preflight 5A (empty-table check for deployed table column additions)
- CHECK inventory (23 on new tables + 5 on deployed = 28)
- Final inventory counts
- Constraint ordering (8 steps)
- RLS policies

---

## Blocker → Resolution

| # | Blocker | Resolution | Cerrado? |
|---|---|---|---|
| B1 | Trigger #5 allows arbitrary field changes in some transitions | Complete rewrite: 8 transitions × 14 mutable columns = 112 explicit decisions. Verification matrix provided. evidence policy defined per transition. Preconditions for expiry (E) and re-claim (F) added. No column escapes. | **Yes** |
| B2 | Watermark preflight has TOCTOU between read and write | Single-transaction locked conditional update. Row lock acquired before validation. Correction uses exact legacy predicates. Exactly-1-row-affected check. No window between validation and update. | **Yes** |

---

## Self-Audit

### 1. claimed → success attempting to alter ignore_reason

Transition B: ignore_reason check → `NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason` → RAISE EXCEPTION 'ignore_reason frozen on success'. **Blocked. ✓**

### 2. failed_retryable → claimed before next_attempt_at

Transition F: precondition → `OLD.next_attempt_at > now()` → RAISE EXCEPTION 'cannot re-claim: next_attempt_at has not been reached'. **Blocked. ✓**

### 3. claimed → pending before claim_expires_at

Transition E: precondition → `OLD.claim_expires_at > now()` → RAISE EXCEPTION 'cannot revert to pending: claim has not expired'. **Blocked. ✓**

### 4. Watermark advanced between read and update

Row lock acquired in Step 1 prevents any concurrent transaction from reading or writing the watermark row. The runtime's watermark advance blocks on the lock. After migration commits, runtime sees corrected state. **No TOCTOU possible. ✓**

### 5. Evidence changed during claim expiry revert (E)

Transition E: `NEW.evidence IS DISTINCT FROM OLD.evidence` → RAISE EXCEPTION 'evidence frozen on expiry'. **Blocked. ✓** (No processing occurred during a mere expiry — evidence should not change.)

### 6. Evidence changed during re-claim (F)

Transition F: `NEW.evidence IS DISTINCT FROM OLD.evidence` → RAISE EXCEPTION 'evidence frozen on re-claim'. **Blocked. ✓** (Re-claim is a scheduling operation, not a processing operation.)

---

**End of document.**
