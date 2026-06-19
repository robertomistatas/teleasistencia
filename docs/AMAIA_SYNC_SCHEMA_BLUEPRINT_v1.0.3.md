# AMAIA-SYNC Schema Blueprint v1.0.3

**Phase:** 9.3-schema  
**Status:** Blueprint — pending Codex audit before DDL  
**Supersedes:** AMAIA_SYNC_SCHEMA_BLUEPRINT_v1.0.2.md (3 blockers, 4 observations)  
**Author:** Claude (constructor)  
**Date:** 2026-06-18

---

## Scope

All content from v1.0.2 is incorporated by reference unless explicitly superseded. This revision corrects 3 critical blockers and incorporates 4 non-blocking observations. No architectural changes beyond clarifying the transactional ordering required for trigger #8 viability.

---

## Blocker 1 — Subject Progression Guard

### Problem

The composite FK ensures current_investigation_id belongs to the same subject, but nothing prevents:
- Decrementing current_investigation_seq.
- Pointing back to an older investigation of the same subject.
- Setting current_investigation_seq to a value that doesn't match the pointed investigation's investigation_seq.

### Correction: Trigger #9 expanded to subject_progression_guard

Trigger #9 (BEFORE UPDATE on amaia_sync_manifest_exclusion_subjects) is expanded from identity-only enforcement to full progression enforcement.

**Validation rules on BEFORE UPDATE:**

**Rule 1 — Identity immutability (unchanged from v1.0.1):**
- OLD.domain_name != NEW.domain_name → raise exception.
- OLD.excluded_amaia_id != NEW.excluded_amaia_id → raise exception.
- OLD.created_at != NEW.created_at → raise exception.

**Rule 2 — current_investigation_id cannot regress to NULL:**
- If OLD.current_investigation_id IS NOT NULL AND NEW.current_investigation_id IS NULL → raise exception 'current_investigation_id cannot be cleared once set'.

Note: The initial transition from NULL to NOT NULL (first investigation) is permitted.

**Rule 3 — current_investigation_seq cannot decrease:**
- If NEW.current_investigation_seq < OLD.current_investigation_seq → raise exception 'current_investigation_seq cannot decrease'.

**Rule 4 — If current_investigation_id changes, strict progression required:**
- If NEW.current_investigation_id != OLD.current_investigation_id (or OLD is NULL and NEW is NOT NULL):
  - NEW.current_investigation_seq MUST equal OLD.current_investigation_seq + 1. If not → raise exception 'investigation_seq must increment by exactly 1'.
  - Read the investigation row: SELECT investigation_seq FROM amaia_sync_manifest_exclusion_investigations WHERE id = NEW.current_investigation_id AND subject_id = NEW.id. (The composite FK guarantees subject ownership, but the trigger additionally verifies investigation_seq alignment.)
  - investigation.investigation_seq MUST equal NEW.current_investigation_seq. If not → raise exception 'investigation_seq mismatch between subject and investigation'.

**Rule 5 — If current_investigation_id does NOT change:**
- NEW.current_investigation_seq MUST equal OLD.current_investigation_seq. If not → raise exception 'cannot change seq without changing investigation'.

**Rule 6 — Set updated_at:**
- NEW.updated_at = now().

### What this prevents

| Attack | Rule | Result |
|---|---|---|
| Decrement current_investigation_seq | Rule 3 | Rejected |
| Point to older investigation (lower seq) | Rule 4 (seq must be OLD + 1) | Rejected |
| Skip investigation_seq values | Rule 4 (must increment by exactly 1) | Rejected |
| Clear current_investigation_id after first set | Rule 2 | Rejected |
| Change seq without changing investigation | Rule 5 | Rejected |
| Set investigation pointer to correct subject but wrong seq | Rule 4 (investigation.investigation_seq must match) | Rejected |

---

## Blocker 2 — Subject→Investigation FK: ON DELETE RESTRICT

### Problem

v1.0.2 specifies ON DELETE SET NULL on the composite FK (current_investigation_id, id) → investigations(id, subject_id). SET NULL attempts to nullify both columns of the composite, including subjects.id (the PK). This is invalid — PostgreSQL cannot set a PK column to NULL.

### Correction: ON DELETE RESTRICT

| FK | v1.0.2 | v1.0.3 |
|---|---|---|
| subjects.(current_investigation_id, id) → investigations.(id, subject_id) | ON DELETE SET NULL | **ON DELETE RESTRICT** |

**Rationale:** Investigations are append-only audit records. They must not be deleted while referenced as the current investigation of a subject. This is consistent with the append-only design: trigger #6 already rejects DELETE on investigations. Even if the trigger were bypassed (ALTER TABLE DISABLE TRIGGER), the RESTRICT FK prevents the deletion.

**Cascade interaction:** Deleting a subject (CASCADE from subject to investigations) would delete investigations. But deleting an investigation that is the current_investigation_id of its parent subject is blocked by RESTRICT. Resolution: to delete a subject, first set current_investigation_id to NULL — but Rule 2 of Blocker 1 prevents that once set. Therefore: a subject with any investigation cannot be deleted through normal operations. This is correct — subjects with audit history are permanent. Administrative cleanup requires DISABLE TRIGGER + explicit SQL, which is logged.

---

## Blocker 3 — Transactional Ordering for Consumption Validation

### Problem

v1.0.2's trigger #8 validates manifest.sets_match = true on consumption INSERT. But the previously documented runtime ordering was: insert consumptions → update manifest → advance watermark. Under this ordering, sets_match is not yet true when consumptions are inserted.

### Correction: Definitive transactional ordering

The runtime ordering within the fenced manifest comparison transaction is updated. This is a clarification of the v1.2.8 C3 deferred-insert contract, made explicit for trigger compatibility.

**Definitive step ordering within a single fenced transaction:**

```
Step 1: Compute S and P. Identify extra_ids.
Step 2: For each extra_id, resolve exclusion (lock subjects, read decisions).
         Assemble resolved_exclusions list in memory.
Step 3: Compute S_effective, P_effective, sets_match in memory.
Step 4: IF sets_match = false:
          Update manifest → confirmed_compared with sets_match=false, extra_ids.
          COMMIT. No consumptions. No watermark advance.
Step 5: IF sets_match = true:
          Update manifest → confirmed_compared with sets_match=true, evidence.
          (manifest.sets_match is now true in the database within this transaction)
Step 6:   INSERT consumptions (trigger #8 reads manifest.sets_match = true ✓).
Step 7:   Advance watermark.
Step 8:   COMMIT.
```

**Why this ordering is safe:**

- Steps 5-8 are within the same transaction. If any step fails, the entire transaction rolls back: no manifest update, no consumptions, no watermark advance.
- Trigger #8 executes at Step 6. It reads manifest.sets_match from the row updated in Step 5. Within the same transaction (READ COMMITTED or higher), the trigger sees the uncommitted-but-written value from Step 5. PostgreSQL's MVCC guarantees that a transaction can read its own uncommitted writes.
- External observers cannot see the manifest update (Step 5) until COMMIT (Step 8). If the transaction rolls back, the manifest reverts to its pre-Step-5 state.

**Invariant preserved:** A consumption exists in the database if and only if the manifest has sets_match = true AND the watermark was advanced, all committed atomically.

---

## Non-Blocking Observation 1: Column count correction

v1.0.2 states "7 new columns on deployed tables." The correct count is **6**:

| Table | Column | Count |
|---|---|---|
| amaia_sync_runs | cycle_id | 1 |
| amaia_sync_runs | upstream_run_id | 2 |
| amaia_sync_runs | blocked_entity_name | 3 |
| amaia_sync_reconciliation_results | cycle_id | 4 |
| amaia_sync_reconciliation_results | scope_descriptor | 5 |
| amaia_sync_reconciliation_results | result_status | 6 |

Total: **6 columns** on 2 pre-existing deployed tables.

---

## Non-Blocking Observation 2: UK count correction

v1.0.2 states 13 UKs. The correct cumulative count is **15**:

| # | Table | UK columns | Source |
|---|---|---|---|
| 1 | amaia_sync_run_manifests | (run_id) | v1.0 |
| 2 | amaia_sync_run_manifests | (id, run_id) | v1.0.2 B1c |
| 3 | amaia_sync_workset_exceptions | (domain_name, source_amaia_id, source_row_hash, hash_version) | v1.0 |
| 4 | amaia_sync_workset_exception_decisions | (exception_id, decision_seq) | v1.0 |
| 5 | amaia_sync_workset_exception_decisions | (id, exception_id) | v1.0.2 B1a |
| 6 | amaia_sync_workset_exception_consumptions | (exception_id, consumed_by_run_id) | v1.0 |
| 7 | amaia_sync_reconciliation_segments | (domain_name, tier, segment_id) | v1.0 |
| 8 | amaia_sync_alert_remediation_queue | (source_type, logestado_amaia_id, alert_amaia_id) WHERE ... | v1.0 |
| 9 | amaia_sync_manifest_exclusion_subjects | (domain_name, excluded_amaia_id) | v1.0 |
| 10 | amaia_sync_manifest_exclusion_investigations | (subject_id, investigation_seq) | v1.0 |
| 11 | amaia_sync_manifest_exclusion_investigations | (subject_id, investigation_hash) | v1.0 |
| 12 | amaia_sync_manifest_exclusion_investigations | (id, subject_id) | v1.0.2 B2 |
| 13 | amaia_sync_manifest_exclusion_decisions | (investigation_id, decision_seq) | v1.0 |
| 14 | amaia_sync_manifest_exclusion_decisions | (id, investigation_id) | v1.0.2 B1b |
| 15 | amaia_sync_manifest_exclusion_consumptions | (investigation_id, consumed_by_run_id) | v1.0 |

Total: **15 UKs**.

---

## Non-Blocking Observation 3: Trigger vs FK execution order

v1.0.2 states "FK fires before trigger." This is incorrect in PostgreSQL. The actual order for INSERT is:

1. BEFORE INSERT trigger fires (can modify NEW, can reject).
2. Row is inserted into the table.
3. FK constraints are checked (at statement end or deferred to transaction end).

Therefore: trigger #8's BEFORE INSERT validation runs before FK constraint checking. The trigger can reject invalid rows before the FK is even evaluated. This is correct behavior — the trigger is the first line of defense, the FK is a structural safety net.

v1.0.2's statement is corrected to: "BEFORE INSERT trigger executes first; FK constraints are validated after the row is written. Both must pass for the INSERT to succeed."

---

## Non-Blocking Observation 4: CASCADE vs append-only trigger interaction

Several FKs use ON DELETE CASCADE pointing to append-only tables (e.g., decisions CASCADE from investigations, consumptions CASCADE from investigations). If a parent row in an append-only table is deleted, CASCADE attempts to delete child rows in other append-only tables. The child table's DELETE trigger rejects the deletion.

**Net effect:** CASCADE on append-only tables is effectively RESTRICT. The parent cannot be deleted because the cascaded child deletions fail. This is the desired behavior — append-only tables form an indestructible audit chain where deleting any node is blocked.

**Documentation clarification:** FKs that specify ON DELETE CASCADE between append-only tables behave as ON DELETE RESTRICT in practice due to the DELETE-rejection triggers on all append-only tables. The CASCADE declaration is technically accurate (it describes what PostgreSQL attempts) but operationally equivalent to RESTRICT (the attempt always fails if children exist).

---

## Updated Trigger Inventory

| # | Table | Trigger | BEFORE INSERT | BEFORE UPDATE | BEFORE DELETE |
|---|---|---|---|---|---|
| 1 | workset_exceptions | append_only | — | Reject | Reject |
| 2 | workset_exception_decisions | append_only_serialize_assign_seq | Lock exception FOR UPDATE; compute decision_seq | Reject | Reject |
| 3 | workset_exception_consumptions | validate_and_append_only | Lock exception FOR UPDATE; validate latest decision approved + hash match | Reject | Reject |
| 4 | run_manifests | phase_column_guard | — | Phase transitions, per-phase column writes, immutable-from-INSERT | Reject |
| 5 | remediation_queue | state_machine_guard | — | State machine, conditional fields, immutable identity columns | — |
| 6 | exclusion_investigations | validate_denorm_and_append_only | Validate domain_name/excluded_amaia_id match subject | Reject | Reject |
| 7 | exclusion_decisions | append_only_serialize_assign_seq | Lock subject FOR UPDATE; verify current_investigation_id; compute decision_seq | Reject | Reject |
| 8 | exclusion_consumptions | validate_and_append_only | Lock subject FOR UPDATE; validate vigency + latest decision approved + hash + manifest sets_match=true | Reject | Reject |
| 9 | exclusion_subjects | **subject_progression_guard** | — | Rules 1-6: identity immutability + investigation progression + seq alignment + updated_at | — |

Total: 9 triggers. Count unchanged.

---

## Cumulative Counts (v1.0 through v1.0.3)

| Category | Count |
|---|---|
| New tables | 11 |
| New columns on deployed tables | **6** (corrected from 7) |
| Modified CHECKs on deployed tables | 4 |
| UKs | **15** (corrected from 13) |
| FKs | 22 |
| Triggers | 9 |
| Indexes | ~26 (15 UK-implicit + ~11 btree/partial) |
| Data corrections | 1 watermark row + 12 segment seed rows |

---

## Blocker → Resolution

| # | Blocker | Resolution | Schema change | Cerrado? |
|---|---|---|---|---|
| B1 | Subject can regress to older investigation | Trigger #9 expanded: seq must increment by exactly 1, investigation.investigation_seq must match, cannot clear current_investigation_id, cannot change seq without changing investigation. | Trigger logic expanded | **Yes** |
| B2 | ON DELETE SET NULL on composite FK attempts to nullify PK | Changed to ON DELETE RESTRICT. Investigations cannot be deleted while referenced as current. Consistent with append-only design. | FK action change | **Yes** |
| B3 | Trigger #8 requires sets_match=true but consumption INSERT preceded manifest update | Transactional ordering clarified: manifest updated (Step 5) BEFORE consumptions inserted (Step 6), within same transaction. Trigger reads own-transaction write. PostgreSQL MVCC guarantees visibility. | Runtime ordering clarification | **Yes** |
| O1 | Column count on deployed tables was 7, should be 6 | Corrected to 6. | Documentation | **Yes** |
| O2 | UK count was 13, should be 15 | Corrected to 15 with full enumeration. | Documentation | **Yes** |
| O3 | "FK fires before trigger" is incorrect | Corrected: BEFORE INSERT trigger fires first, FK checked after row write. | Documentation | **Yes** |
| O4 | CASCADE on append-only tables behavior undocumented | Documented: CASCADE is operationally RESTRICT due to DELETE-rejection triggers on children. | Documentation | **Yes** |

---

## Self-Audit: Attacking the 3 Corrections

### a) Retroceso de current_investigation

**Attack:** UPDATE subjects SET current_investigation_id = old_I1, current_investigation_seq = 1 WHERE current_investigation_seq = 3.

**Result:** Rule 3: NEW.seq (1) < OLD.seq (3) → rejected. **Resists.**

**Attack:** UPDATE subjects SET current_investigation_id = old_I2, current_investigation_seq = 4 WHERE current_investigation_seq = 3. (I2 has investigation_seq = 2, not 4.)

**Result:** Rule 4: reads investigation.investigation_seq for old_I2 = 2. NEW.current_investigation_seq (4) != investigation.investigation_seq (2) → rejected. **Resists.**

**Attack:** UPDATE subjects SET current_investigation_id = NULL, current_investigation_seq = 0 WHERE current_investigation_seq = 3.

**Result:** Rule 2: OLD.current_investigation_id IS NOT NULL, NEW is NULL → rejected. **Resists.**

### b) Borrado de investigation current

**Attack:** DELETE FROM amaia_sync_manifest_exclusion_investigations WHERE id = current_investigation_of_subject_A.

**Result:** Trigger #6 BEFORE DELETE → raise exception (append-only). Even if trigger bypassed: FK RESTRICT from subjects.current_investigation_id → blocked. Two independent protections. **Resists.**

### c) Consumption before manifest.sets_match=true

**Attack:** INSERT consumption before updating manifest.

**Result:** Trigger #8 Step 9: reads manifest.sets_match. If manifest hasn't been updated yet, sets_match is NULL (or false from a previous failed comparison). NULL != true → raise exception. INSERT rejected. **Resists.**

**Attack:** INSERT consumption after manifest update but manifest update has sets_match=false.

**Result:** Trigger #8 Step 9: reads sets_match = false → raise exception. **Resists.**

### d) Transaction failure between manifest update and watermark advance

**Scenario:** Step 5 (manifest update) succeeds, Step 6 (consumptions) succeeds, Step 7 (watermark advance) fails (e.g., ownership predicate failure).

**Result:** Transaction rolls back. Manifest reverts to pre-Step-5 state (sets_match not committed). Consumptions reverted. Watermark unchanged. All-or-nothing. **Resists.**

**Scenario:** Step 5 succeeds, Step 6 fails (trigger #8 rejects a consumption).

**Result:** Transaction rolls back. Manifest reverts. No consumptions. No watermark advance. **Resists.**

---

## Modules NOT modified

All modules unchanged from v1.0.2 except:
- Trigger #9 logic expanded (Blocker 1)
- One FK ON DELETE action changed (Blocker 2)
- Transactional ordering clarified for runtime (Blocker 3)
- Inventories corrected (Observations 1-4)

No changes to: cycles, manifests (structure), workset exception ledger (structure), exclusion ledger (structure beyond trigger #9 and FK action), remediation queue, reconciliation segments, deployed table modifications (structure), lease/fencing.

---

**End of document.**
