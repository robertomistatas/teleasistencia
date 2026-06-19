# AMAIA-SYNC DDL Blueprint v1.0.4

**Phase:** 9.3A  
**Status:** DDL Blueprint — non-executable, pending Codex audit  
**Supersedes:** AMAIA_SYNC_DDL_BLUEPRINT_v1.0.3.md (2 blockers)  
**Author:** Claude (constructor)  
**Date:** 2026-06-19

**Note:** This document contains NO executable SQL.

---

## Scope

All content from v1.0.3 is incorporated by reference unless explicitly superseded. Only Trigger #5 transition B and the watermark preflight explanation are changed. All other triggers, table definitions, constraints, indexes, seeds, inventories, and preflight conditions are unchanged.

---

## Blocker 1 — Trigger #5 Transition B: claimed → success

Supersedes ONLY transition B in v1.0.3 Trigger #5. All other transitions (A, C, D, E, F, G, H) are unchanged.

### Problem

v1.0.3 freezes claim_expires_at on success, leaving a terminal row with a seemingly active claim expiry timestamp. Additionally, consumed_by_run_id is validated only as NOT NULL, not as equal to the claiming run.

### Corrected transition B

```
-- ============================================================
-- B) claimed → success
-- Allowlist: status, consumed_by_run_id, processed_at,
--            claim_expires_at (cleanup), evidence
-- ============================================================
IF OLD.status = 'claimed' AND NEW.status = 'success' THEN
  -- Required
  IF NEW.consumed_by_run_id IS NULL THEN RAISE EXCEPTION 'success requires consumed_by_run_id'; END IF;
  IF NEW.consumed_by_run_id IS DISTINCT FROM OLD.claimed_by_run_id THEN RAISE EXCEPTION 'consumed_by_run_id must equal claimed_by_run_id (the run that claimed must be the run that fulfills)'; END IF;
  IF NEW.processed_at IS NULL THEN RAISE EXCEPTION 'success requires processed_at'; END IF;
  -- Cleanup
  IF NEW.claim_expires_at IS NOT NULL THEN RAISE EXCEPTION 'claim_expires_at must be cleared on success'; END IF;
  -- Frozen
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN RAISE EXCEPTION 'retry_count frozen on success'; END IF;
  IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN RAISE EXCEPTION 'failure_reason frozen on success'; END IF;
  IF NEW.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION 'next_attempt_at must be NULL on success'; END IF;
  IF NEW.claimed_by_run_id IS DISTINCT FROM OLD.claimed_by_run_id THEN RAISE EXCEPTION 'claimed_by_run_id frozen on success (preserved for audit)'; END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'claimed_at frozen on success (preserved for audit)'; END IF;
  IF NEW.ignored_by IS DISTINCT FROM OLD.ignored_by THEN RAISE EXCEPTION 'ignored_by frozen on success'; END IF;
  IF NEW.ignored_at IS DISTINCT FROM OLD.ignored_at THEN RAISE EXCEPTION 'ignored_at frozen on success'; END IF;
  IF NEW.ignore_reason IS DISTINCT FROM OLD.ignore_reason THEN RAISE EXCEPTION 'ignore_reason frozen on success'; END IF;
  IF NEW.ignore_evidence IS DISTINCT FROM OLD.ignore_evidence THEN RAISE EXCEPTION 'ignore_evidence frozen on success'; END IF;
  -- evidence: allowed to change (processing result context)
  RETURN NEW;
END IF;
```

### What changed from v1.0.3

| Column | v1.0.3 transition B | v1.0.4 transition B | Rationale |
|---|---|---|---|
| claim_expires_at | ✗ frozen | **✓ clear (must be NULL)** | Terminal state must not appear to have an active claim |
| consumed_by_run_id | ✓ set!null | **✓ set = OLD.claimed_by_run_id** | The run that claimed is the run that fulfills. Prevents a different run from recording success. |

All other columns in transition B unchanged.

### Updated allowlist matrix row for transition B

| Column | B (c→s) v1.0.4 |
|---|---|
| status | ✓ allow |
| claimed_by_run_id | ✗ frozen (audit) |
| claimed_at | ✗ frozen (audit) |
| claim_expires_at | **✓ clear** |
| retry_count | ✗ frozen |
| failure_reason | ✗ frozen |
| next_attempt_at | ✗ =NULL |
| consumed_by_run_id | **✓ set=OLD.claimed_by_run_id** |
| processed_at | ✓ set!null |
| ignored_by | ✗ frozen |
| ignored_at | ✗ frozen |
| ignore_reason | ✗ frozen |
| ignore_evidence | ✗ frozen |
| evidence | ✓ allow |

---

## Blocker 2 — Watermark Preflight: Corrected PostgreSQL Guarantees and Runtime Contract

Supersedes v1.0.3 Blocker 2 explanation. The migration steps (lock, validate, conditional update, verify 1 row) are unchanged. Only the explanation of WHY this is safe is corrected.

### What v1.0.3 got wrong

v1.0.3 states: "The exclusive row lock prevents any concurrent transaction from reading or writing this row." This is incorrect under PostgreSQL MVCC:

- SELECT FOR UPDATE blocks concurrent UPDATE, DELETE, and SELECT FOR UPDATE/FOR SHARE on the same row.
- SELECT FOR UPDATE does **NOT** block ordinary SELECT (without FOR UPDATE). A concurrent transaction can read the row's last-committed snapshot.

This means: while the migration holds the lock, a concurrent runtime process CAN read the old watermark state via ordinary SELECT. If that runtime process subsequently attempts to advance the watermark, the TOCTOU gap reopens.

### Corrected two-layer safety model

The watermark correction is protected by two independent mechanisms that together eliminate the TOCTOU:

**Layer 1 — Migration: locked conditional update (unchanged from v1.0.3)**

The migration acquires an exclusive row lock on the watermark row, validates the legacy state, and applies the correction with exact-match predicates — all within a single transaction. This prevents any concurrent watermark UPDATE (the runtime's advance operation) from proceeding until the migration commits.

If the runtime's advance attempts to acquire the same row lock (which it must, per Layer 2), it blocks until the migration releases the lock at commit.

**Layer 2 — Runtime: conditional advance (NEW — architectural runtime contract)**

The runtime's watermark advance operation must itself be a conditional update that includes the expected prior state as predicates. This is not a new architectural requirement — it is already specified in v1.2.9 as part of the Watermark Manager contract (v1.1 Section 1.3: "advance writes the new watermark value only if the new value is strictly greater than the current value") and the ownership predicate (v1.2 Correction 1). This DDL Blueprint makes the relevant conditions explicit for the migration interaction:

**Runtime watermark advance conditions (documented, not new):**

1. Executes within the fenced transaction of the sync run.
2. The advance operation must lock or conditionally update the watermark row, not use a stale snapshot.
3. The conditional update includes:
   - entity_name = expected domain
   - watermark_type = expected type (the runtime knows what type it expects for this domain)
   - Current cursor value matches the watermark_before read at run start (monotonicity check — prevents advancing if another process already advanced)
   - Lease ownership predicate holds
4. Exactly 1 row must be affected by the update. If 0 rows: abort the run transaction. The watermark state does not match expectations — either another process advanced it, or the migration changed it.

**How this closes the TOCTOU for the migration scenario:**

```
Scenario: Runtime reads watermark_type='timestamp' via ordinary SELECT (not blocked by migration lock).
Migration commits: watermark_type now = 'id'.
Runtime attempts conditional advance with watermark_type='timestamp' in its predicate.
→ 0 rows affected (watermark_type is now 'id', not 'timestamp').
→ Runtime aborts its transaction.
→ No stale write occurs.
```

The runtime's conditional advance fails because the migration changed the row's state. The runtime detects the mismatch and aborts. On the next cycle, the runtime reads the corrected state (watermark_type = 'id') and operates on the new semantics.

**What if the runtime doesn't use conditional advance?**

A runtime that reads a snapshot and writes unconditionally would be vulnerable. But this cannot happen in the approved architecture: the Watermark Manager (v1.1 Section 1.3) requires conditional advance, and the ownership predicate (v1.2 Correction 1) requires the advance to occur within a fenced transaction that verifies the lease. Both of these involve reading the current state at write time, not relying on a stale snapshot.

### What the migration lock actually protects

| Concurrent operation | Blocked by migration lock? | Protected by runtime conditional advance? |
|---|---|---|
| Runtime UPDATE (watermark advance) | Yes — UPDATE on same row blocks | Yes — conditional predicates fail post-migration |
| Runtime SELECT FOR UPDATE (watermark read in fenced tx) | Yes — FOR UPDATE on same row blocks | N/A — blocked before reading |
| Runtime ordinary SELECT (snapshot read) | **No** — reads last-committed snapshot | Yes — subsequent conditional advance fails on mismatch |
| Another migration ALTER/UPDATE | Yes — write lock conflict | N/A |

The two layers are complementary:
- Layer 1 (migration lock) prevents concurrent writes during the correction.
- Layer 2 (runtime conditional advance) prevents a runtime that read a stale snapshot from writing a stale advance after the correction commits.

Together, no stale write can occur.

### Corrected statement

v1.0.3's claim "prevents any concurrent transaction from reading or writing" is replaced by:

"The migration's exclusive row lock prevents concurrent UPDATE, DELETE, and SELECT FOR UPDATE on the watermark row. Ordinary SELECT by the runtime is not blocked, but this is safe because the runtime's watermark advance is a conditional update that includes the expected prior state as predicates. If the migration changes the row between the runtime's read and write, the runtime's conditional advance affects 0 rows and the run aborts. No stale write is possible."

---

## Unchanged from v1.0.3

The following are explicitly confirmed unchanged:

- Trigger #5 transitions A, C, D, E, F, G, H (all unchanged)
- Trigger #5 allowlist matrix for all transitions except B (two cells updated)
- Triggers #1, #2, #3, #4, #6, #7, #8, #9 (all unchanged)
- All table definitions, columns, types, defaults
- All UK, FK, CHECK constraints
- Partial unique index on remediation queue
- All btree and partial indexes
- Seed specification for 12 reconciliation_segments rows (with explicit values)
- Preflight 5A (empty-table check for deployed table column additions)
- Watermark preflight steps (lock → validate → conditional update → verify 1 row) — unchanged; only the explanation of WHY is corrected
- CHECK inventory (23 + 5 = 28)
- Final inventory counts
- Constraint ordering (8 steps)
- RLS policies
- Evidence policy per transition (unchanged except transition B claim_expires_at)

---

## Blocker → Resolution

| # | Blocker | Resolution | Cerrado? |
|---|---|---|---|
| B1 | claimed → success preserves claim_expires_at (appears active) and allows arbitrary consumed_by_run_id | claim_expires_at cleared on success. consumed_by_run_id must equal OLD.claimed_by_run_id (same run that claimed must fulfill). Matrix updated. | **Yes** |
| B2 | Watermark preflight claims SELECT FOR UPDATE blocks reads (false under MVCC) and doesn't demonstrate safety against stale-snapshot runtime | Two-layer model: migration lock prevents concurrent writes; runtime conditional advance prevents stale writes from snapshot reads. Explicit scenario walkthrough. Corrected PostgreSQL guarantee description. | **Yes** |

---

## Self-Audit

### 1. claimed → success with claim_expires_at not NULL

Transition B: `NEW.claim_expires_at IS NOT NULL` → RAISE EXCEPTION 'claim_expires_at must be cleared on success'. **Blocked. ✓**

### 2. claimed → success with consumed_by_run_id ≠ OLD.claimed_by_run_id

Transition B: `NEW.consumed_by_run_id IS DISTINCT FROM OLD.claimed_by_run_id` → RAISE EXCEPTION 'consumed_by_run_id must equal claimed_by_run_id'. **Blocked. ✓**

### 3. Runtime reads legacy watermark → migration converts → runtime advances with stale type

Runtime reads watermark_type = 'timestamp' (ordinary SELECT, not blocked by migration lock).
Migration commits: watermark_type = 'id'.
Runtime attempts conditional advance with predicate watermark_type = 'timestamp'.
Predicate does not match (type is now 'id'). 0 rows affected. Runtime aborts. **No stale write. ✓**

### 4. Correct post-migration runtime advances with new type

Runtime reads watermark_type = 'id', last_id = 0 (after migration committed).
Runtime processes logestado, computes new last_id = 100.
Runtime conditional advance: entity_name = 'alerta' AND watermark_type = 'id' AND last_id = 0 AND fencing predicate.
1 row affected. Watermark advanced to 100. **Correct. ✓**

### 5. Complete matrix verification for transition B

14 mutable columns checked:
- status: ✓ allow → 'success'
- claimed_by_run_id: ✗ frozen (audit evidence)
- claimed_at: ✗ frozen (audit evidence)
- claim_expires_at: ✓ clear (must be NULL) — **CHANGED from v1.0.3**
- retry_count: ✗ frozen
- failure_reason: ✗ frozen
- next_attempt_at: ✗ =NULL
- consumed_by_run_id: ✓ set=OLD.claimed_by_run_id — **CHANGED from v1.0.3**
- processed_at: ✓ set!null
- ignored_by: ✗ frozen
- ignored_at: ✗ frozen
- ignore_reason: ✗ frozen
- ignore_evidence: ✗ frozen
- evidence: ✓ allow

14/14 columns accounted for. **Complete. ✓**

---

**End of document.**
