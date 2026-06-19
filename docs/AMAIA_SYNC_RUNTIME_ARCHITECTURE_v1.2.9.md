# AMAIA-SYNC Runtime Architecture v1.2.9

**Phase:** 9.3 Rev.12  
**Status:** Design — pending Codex audit  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.8.md (2 corrections: C1, C2)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Date:** 2026-06-18

---

## Scope

All content from v1.2.8 is incorporated by reference unless explicitly superseded. This revision corrects 2 critical blockers localized in the exclusion subject entity. All other modules (remediation queue, manifests, Tier 4, leases, backfill, exception ledger, hash algorithm, safety lag, provisional processing) are unchanged and explicitly approved by Codex.

---

## C1 — Decision Insertion Serialized at Subject Level

### Problem

v1.2.8 states that the subject row serializes all operations, but the decision insertion trigger (inherited from v1.2.7) acquires FOR UPDATE only on the investigation row, not the subject row. This creates a serialization gap:

```
T=0  Consumption: locks subject (FOR UPDATE). Reads current_investigation_id = I1.
     Reads latest decision for I1 = D1 (approved).
T=1  Operator: INSERT decision D2 (rejected) for I1.
     Locks investigation I1 (FOR UPDATE) — succeeds (different row than subject).
     D2 committed.
T=2  Consumption: still holds subject lock. Uses D1 (approved).
     Inserts consumption. Advances watermark. Commits.
```

Result: watermark advanced using an exclusion whose latest decision at commit time was rejected.

### Correction: Subject lock required for all three operations

Every operation that reads or modifies the exclusion state for a given (domain, excluded_amaia_id) MUST acquire FOR UPDATE on the subject row as its first database operation. No operation may proceed without holding this lock.

### Definitive lock protocol

**Single lock target: the subject row.** The investigation row is NOT locked separately. The subject lock serializes everything. This eliminates any question of lock ordering between subject and investigation — there is only one lock.

### Flow 1: New investigation creation

```
1. Get-or-create subject (see C2 below).
2. SELECT * FROM amaia_sync_manifest_exclusion_subjects
   WHERE id = :subject_id FOR UPDATE;
3. Compute investigation_seq = subject.current_investigation_seq + 1.
4. INSERT INTO amaia_sync_manifest_exclusion_investigations
   (subject_id, investigation_seq, investigation_hash, ...).
5. UPDATE amaia_sync_manifest_exclusion_subjects
   SET current_investigation_id = new_investigation.id,
       current_investigation_seq = investigation_seq.
6. COMMIT → releases subject lock.
```

### Flow 2: New decision insertion

```
1. Read investigation_id from the decision being inserted.
2. Read subject_id from the investigation row (plain SELECT, no lock).
3. SELECT * FROM amaia_sync_manifest_exclusion_subjects
   WHERE id = :subject_id FOR UPDATE;
4. VERIFY: subject.current_investigation_id = investigation_id.
   If NOT equal: REJECT. The investigation is no longer current.
   The operator must create a new investigation if they want to
   re-evaluate this excluded_amaia_id.
5. Compute decision_seq = MAX(decision_seq for this investigation_id) + 1.
6. INSERT INTO amaia_sync_manifest_exclusion_decisions
   (investigation_id, decision_seq, decision, decided_by, ...).
7. COMMIT → releases subject lock.
```

**Step 4 is the critical addition.** It prevents decisions on non-current investigations. An operator cannot approve an old investigation that has been superseded by a newer one. This closes the "old approval still valid" vector that the subject entity was designed to prevent.

### Flow 3: Exclusion consumption (during manifest comparison)

```
1. For each extra_id in P \ S:
   a. SELECT * FROM amaia_sync_manifest_exclusion_subjects
      WHERE domain_name = :domain AND excluded_amaia_id = :extra_id
      FOR UPDATE;
   b. Read subject.current_investigation_id.
      If NULL: unresolved. Skip.
   c. Read latest decision for current_investigation_id
      (MAX decision_seq).
      If != 'approved': unresolved. Skip.
   d. Verify investigation_hash. If mismatch: unresolved. Skip.
   e. Add to resolved_exclusions list (in memory).
2. Compute S_effective, P_effective, sets_match.
3. If sets_match = true:
   - Batch INSERT consumptions.
   - Update manifest.
   - Advance watermark.
   - COMMIT → releases ALL subject locks.
4. If sets_match = false:
   - Update manifest (no consumptions).
   - COMMIT → releases ALL subject locks.
```

All subject locks are held until the transaction commits. No concurrent decision insertion or investigation creation can proceed for any of the locked subjects during the manifest comparison.

### Why this eliminates the interleaving attack

The attack from the problem statement:

```
T=0  Consumption: locks subject (FOR UPDATE).
T=1  Operator: tries to INSERT decision for I1.
     Step 3 of Flow 2: SELECT ... subject ... FOR UPDATE → BLOCKS.
     Operator waits for consumption to commit.
T=2  Consumption: commits (with or without watermark advance).
     Subject lock released.
T=3  Operator: acquires subject lock. Proceeds with decision insertion.
```

The operator's decision cannot be inserted while the consumption holds the subject lock. When the consumption commits, the decision is inserted — but it's too late to affect the already-committed consumption. The next consumption (in a future cycle) will see the new decision.

This is the correct behavior: the consumption used the state that was current at the time it held the lock. The operator's subsequent decision applies to future consumptions.

### Trigger changes

The decision insertion trigger (on amaia_sync_manifest_exclusion_decisions) is updated:

**Old behavior (v1.2.7):** BEFORE INSERT → SELECT ... FROM investigations WHERE id = NEW.investigation_id FOR UPDATE.

**New behavior (v1.2.9):** BEFORE INSERT →
1. Read subject_id from investigation row.
2. SELECT ... FROM amaia_sync_manifest_exclusion_subjects WHERE id = subject_id FOR UPDATE.
3. Verify subject.current_investigation_id = NEW.investigation_id. If not: raise exception 'Cannot add decision to non-current investigation'.

The investigation-level lock is removed. Only the subject-level lock exists.

### Schema impact

No new tables or columns. Trigger logic updated on amaia_sync_manifest_exclusion_decisions.

---

## C2 — Safe Get-or-Create for Subject Entity

### Problem

v1.2.8's subject creation flow:

```
SELECT ... FOR UPDATE WHERE domain_name = :d AND excluded_amaia_id = :a;
If not found: INSERT ...;
```

Under READ COMMITTED, SELECT FOR UPDATE on a non-existent row returns nothing and acquires no lock. Two concurrent transactions both see "not found," both attempt INSERT, one fails with UNIQUE violation. The failing transaction may have already created an investigation row that references a subject_id that doesn't exist (orphaned investigation).

### Correction: INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE

The get-or-create is a two-step atomic pattern:

```
-- Step 1: Ensure subject exists (idempotent)
INSERT INTO amaia_sync_manifest_exclusion_subjects
  (domain_name, excluded_amaia_id, current_investigation_seq)
VALUES (:domain, :excluded_amaia_id, 0)
ON CONFLICT (domain_name, excluded_amaia_id)
DO NOTHING;

-- Step 2: Acquire lock on the (now guaranteed to exist) row
SELECT *
FROM amaia_sync_manifest_exclusion_subjects
WHERE domain_name = :domain
  AND excluded_amaia_id = :excluded_amaia_id
FOR UPDATE;
```

**Why this is safe:**

- Step 1 is idempotent. If the row exists, DO NOTHING. If it doesn't, INSERT. If two transactions race, one succeeds and the other does nothing (no error).
- Step 2 always finds the row (it was just created or already existed). FOR UPDATE acquires an exclusive row lock. Only one transaction proceeds past this point.
- After Step 2, the caller holds the subject lock and can safely read/modify subject state.

**All three flows (investigation creation, decision insertion, consumption) begin with this get-or-create pattern** for the relevant subject. The subsequent steps (documented in C1 above) execute under the acquired lock.

### Retry contract for transient failures

The following transient failures may occur and MUST be retried:

| Failure | Cause | Retry behavior |
|---|---|---|
| Serialization failure (40001) | Concurrent modification under SERIALIZABLE (if used) | Retry entire transaction from Step 1. Max 3 retries. |
| Deadlock detected (40P01) | Two transactions locked subjects in different order | Cannot happen under the single-lock protocol (only one lock target per subject). If it occurs despite this, retry entire transaction. Max 3 retries. |
| Lock timeout | Subject lock held by a long-running transaction | Retry after backoff. If persistent, investigate the blocking transaction. |
| Unique violation on subject INSERT (unexpected) | Should not occur with ON CONFLICT DO NOTHING. If it occurs, it indicates a concurrent DROP+recreate or a driver-level bug. | Log anomaly. Retry once. If persistent, fail the operation. |

**If retry fails:** The calling operation (investigation creation, decision insertion, or consumption) fails. For investigation creation: no orphaned investigation is created (the INSERT is after the lock acquisition). For consumption: the manifest comparison fails (sets_match = false by default when an exclusion cannot be resolved). For decision insertion: the operator's decision is not recorded; the operator retries.

### Ordering guarantee

Because all three flows lock the same subject row, and each flow holds only one lock (the subject), there is no possibility of deadlock between flows operating on the same subject. Deadlock between flows operating on DIFFERENT subjects is also impossible because each transaction locks subjects in a deterministic order: the manifest comparison locks subjects in ascending excluded_amaia_id order (the extra_ids set is sorted before processing). Investigation and decision flows lock a single subject.

For the manifest comparison locking multiple subjects: the sorted order prevents deadlock between two concurrent manifest comparisons that both need to lock overlapping sets of subjects.

### Schema impact

No new tables or columns. Behavioral specification for the get-or-create pattern.

---

## Definitive Lock Protocol Summary

| Operation | Lock acquired | Lock target | Held until |
|---|---|---|---|
| New investigation | FOR UPDATE on subject | amaia_sync_manifest_exclusion_subjects WHERE id = :subject_id | Transaction COMMIT |
| New decision | FOR UPDATE on subject (via trigger) | amaia_sync_manifest_exclusion_subjects WHERE id = :subject_id (looked up from investigation) | Transaction COMMIT |
| Exclusion consumption | FOR UPDATE on each subject | amaia_sync_manifest_exclusion_subjects for each extra_id, locked in ascending excluded_amaia_id order | Transaction COMMIT (entire manifest comparison) |

**Single lock type.** No investigation-level locks. No decision-level locks. The subject row is the sole serialization point.

**Lock ordering for multi-subject consumption:** ascending excluded_amaia_id. Prevents deadlock between concurrent transactions that lock overlapping subject sets.

---

## Modules Confirmed Unchanged

The following modules are explicitly NOT modified by this revision and retain their v1.2.8 (or earlier) definitions:

- Manifest lifecycle and phase progression (v1.2.6 C2)
- Manifest set-identity comparison (v1.2.6 C1)
- Remediation queue state machine (v1.2.6 C3, updated v1.2.7 B2, v1.2.8 C2)
- Workset exception ledger — 3 tables (v1.2.3, v1.2.4)
- Safety lag and temporal promotion (v1.2.5 C1)
- Provisional processing (v1.2.5 C1)
- Alert remediation queue and backfill convergence (v1.2.5 C2)
- Injective hash algorithm v2 (v1.2.5 C3)
- Tier 4 SLO, segments, and feasibility simulation (v1.2.3, v1.2.4, v1.2.5)
- Lease ownership predicate (v1.2 C1)
- Transactional fencing (v1.1 C2, v1.2 C1)
- Global lease ordering (v1.2.1 C)
- Tombstone resurrection (v1.2 C4, v1.2.1 B)
- Logestado zero-skip rule (v1.2.2 B1)
- Cycle traceability (v1.2 C7)
- Reconciliation as lease participant (v1.2 C3)
- Deferred consumption insert (v1.2.8 C3)

---

## C1–C2 Hallazgo → Resolución v1.2.9

| # | Hallazgo Codex | Resolución | DDL delta vs v1.2.8 | Cerrado? |
|---|---|---|---|---|
| C1 | Decision insertion locks investigation, not subject. Operator can insert rejected decision concurrent with consumption. | All three operations (investigation, decision, consumption) lock the subject row exclusively. Decision trigger updated to lock subject and verify current_investigation_id. Investigation-level lock removed. Single lock target eliminates ordering ambiguity. | None (trigger logic only) | **Yes** |
| C2 | SELECT FOR UPDATE on non-existent subject acquires no lock. Concurrent get-or-create races produce UNIQUE violation and potential orphaned investigations. | INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE. Idempotent creation + guaranteed lock acquisition. Retry contract for serialization failure, deadlock, lock timeout. Multi-subject consumption locks in ascending excluded_amaia_id order. | None (behavioral spec) | **Yes** |

---

## Cumulative DDL Inventory (v1.2 through v1.2.9)

Unchanged from v1.2.8:

**New tables: 11.** No table added or removed in this revision.

**New columns on pre-existing deployed tables: 7.** Unchanged.

**Modified CHECK constraints on pre-existing deployed tables: 4.** Unchanged.

**Triggers: 9.** Decision trigger logic updated (subject lock instead of investigation lock). Count unchanged.

**Data corrections:** 1 watermark row update + 12 segment seed rows. Unchanged.

---

**End of document.**
