# AMAIA-SYNC Schema Blueprint v1.0.2

**Phase:** 9.3-schema  
**Status:** Blueprint — pending Codex audit before DDL  
**Supersedes:** AMAIA_SYNC_SCHEMA_BLUEPRINT_v1.0.1.md (3 blockers, 4 observations)  
**Author:** Claude (constructor)  
**Date:** 2026-06-18

---

## Scope

All content from v1.0.1 is incorporated by reference unless explicitly superseded. This revision corrects 3 critical blockers and incorporates 4 non-blocking observations. No architectural changes. No changes to lifecycle state machines, lock protocols, or runtime contracts.

---

## Blocker 1: Composite FKs to Prevent Cross-Parent Linking

### Problem

In both ledgers, consumption rows have independent FKs to decision and parent (exception or investigation). Nothing structurally prevents linking a decision from parent A with a consumption for parent B. Similarly, consumed_by_manifest_id and consumed_by_run_id are independent — a manifest from run X could be paired with run Y.

### Correction: Composite FK targets

**Principle:** Every child-to-grandchild relationship must be constrained through a composite FK that includes the shared parent identifier. This makes cross-parent linking structurally impossible.

### 1a. Workset exception ledger

**amaia_sync_workset_exception_decisions — new UK:**

| Constraint | Columns |
|---|---|
| UK (new) | (id, exception_id) |

This UK enables the composite FK from consumptions. The existing UK (exception_id, decision_seq) is preserved.

**amaia_sync_workset_exception_consumptions — composite FK:**

| FK | Source columns | Target table | Target columns | Replaces |
|---|---|---|---|---|
| Composite (new) | (decision_id, exception_id) | amaia_sync_workset_exception_decisions | (id, exception_id) | Simple FK decision_id → decisions(id) |

The simple FK `decision_id → decisions(id)` is removed. The composite FK enforces: the referenced decision must belong to the same exception as the consumption. Cross-exception linking is structurally impossible.

The existing simple FK `exception_id → exceptions(id)` is preserved (it provides the direct parent link).

### 1b. Manifest exclusion ledger

**amaia_sync_manifest_exclusion_decisions — new UK:**

| Constraint | Columns |
|---|---|
| UK (new) | (id, investigation_id) |

**amaia_sync_manifest_exclusion_consumptions — composite FKs:**

| FK | Source columns | Target table | Target columns | Replaces |
|---|---|---|---|---|
| Composite (new) | (decision_id, investigation_id) | amaia_sync_manifest_exclusion_decisions | (id, investigation_id) | Simple FK decision_id → decisions(id) |

The simple FK `decision_id → decisions(id)` is removed. The existing simple FK `investigation_id → investigations(id)` is preserved.

### 1c. Manifest-to-run consistency

**amaia_sync_run_manifests — new UK:**

| Constraint | Columns |
|---|---|
| UK (new) | (id, run_id) |

Note: run_id already has a UK of its own. The new UK (id, run_id) is technically redundant for uniqueness (id is PK) but is structurally required as a composite FK target.

**amaia_sync_manifest_exclusion_consumptions — composite FK:**

| FK | Source columns | Target table | Target columns | Replaces |
|---|---|---|---|---|
| Composite (new) | (consumed_by_manifest_id, consumed_by_run_id) | amaia_sync_run_manifests | (id, run_id) | Simple FKs consumed_by_manifest_id → manifests(id) and consumed_by_run_id → sync_runs(id) independently |

The simple FK `consumed_by_manifest_id → manifests(id)` is removed (subsumed by the composite). The simple FK `consumed_by_run_id → sync_runs(id)` is preserved (it provides the direct run link independent of the manifest).

---

## Blocker 2: Subject-Investigation Ownership Constraint

### Problem

subjects.current_investigation_id is a simple FK to investigations(id). Nothing prevents subject A from pointing to an investigation that belongs to subject B.

### Correction: Composite FK + denormalization enforcement

### 2a. Composite FK on subjects

**amaia_sync_manifest_exclusion_investigations — new UK:**

| Constraint | Columns |
|---|---|
| UK (new) | (id, subject_id) |

**amaia_sync_manifest_exclusion_subjects — composite FK:**

| FK | Source columns | Target table | Target columns | Replaces |
|---|---|---|---|---|
| Composite (new) | (current_investigation_id, id) | amaia_sync_manifest_exclusion_investigations | (id, subject_id) | Simple FK current_investigation_id → investigations(id) |

This reads: "the investigation pointed to by current_investigation_id must have subject_id equal to this subject's id." Cross-subject linking is structurally impossible.

The composite FK is nullable (current_investigation_id is nullable). When current_investigation_id is NULL, the FK is not enforced. This is correct: a subject with no investigation yet has current_investigation_id = NULL.

### 2b. Denormalized column enforcement

Investigation rows contain denormalized domain_name and excluded_amaia_id copied from the subject. These must match the subject's values.

**Enforcement:** The existing trigger #6 (append_only on investigations) is extended for BEFORE INSERT to validate:

1. Read subject row for NEW.subject_id.
2. Verify NEW.domain_name = subject.domain_name.
3. Verify NEW.excluded_amaia_id = subject.excluded_amaia_id.
4. If mismatch: raise exception.

This runs under the subject lock (the inserter holds FOR UPDATE on the subject per the v1.2.9 protocol). No additional lock acquisition needed in the trigger.

The trigger remains a single trigger (BEFORE INSERT OR UPDATE OR DELETE) with branched logic:
- INSERT: validate denormalized columns against subject.
- UPDATE: raise exception (append-only).
- DELETE: raise exception (append-only).

---

## Blocker 3: Consumption INSERT Validation at Schema Level

### Problem

Trigger #8 (exclusion consumptions) only rejects UPDATE/DELETE. A direct INSERT could register a structurally valid but semantically invalid consumption (wrong investigation, stale decision, unapproved, hash mismatch, manifest without sets_match=true).

### Correction: Extended trigger with INSERT validation

Trigger #8 becomes a BEFORE INSERT OR UPDATE OR DELETE trigger with branched logic:

**On UPDATE:** raise exception (append-only).

**On DELETE:** raise exception (append-only).

**On INSERT — validation sequence:**

1. **Read investigation.** SELECT * FROM amaia_sync_manifest_exclusion_investigations WHERE id = NEW.investigation_id.
2. **Lock subject.** SELECT * FROM amaia_sync_manifest_exclusion_subjects WHERE id = investigation.subject_id FOR UPDATE.
3. **Vigency check.** Verify subject.current_investigation_id = NEW.investigation_id. If not: raise exception 'Investigation is not current for this subject'.
4. **Decision parentage.** Covered structurally by composite FK (decision_id, investigation_id) from Blocker 1. No trigger check needed — the FK constraint fires before trigger or at commit.
5. **Latest decision.** Read MAX(decision_seq) FROM amaia_sync_manifest_exclusion_decisions WHERE investigation_id = NEW.investigation_id. Read that decision row. Verify decision.id = NEW.decision_id. If not: raise exception 'Decision is not the latest for this investigation'.
6. **Approval check.** Verify decision.decision = 'approved'. If not: raise exception 'Latest decision is not approved'.
7. **Hash freshness.** Verify NEW.investigation_hash_at_consumption = investigation.investigation_hash. If not: raise exception 'Investigation hash mismatch at consumption time'.
8. **Manifest-run consistency.** Covered structurally by composite FK (consumed_by_manifest_id, consumed_by_run_id) from Blocker 1. No trigger check needed.
9. **Manifest success.** Read manifest.sets_match FROM amaia_sync_run_manifests WHERE id = NEW.consumed_by_manifest_id. Verify sets_match = true. If not: raise exception 'Manifest sets_match is not true'.

**Step 2 provides serialization.** The subject lock held by the trigger serializes this INSERT with concurrent decision insertions (which also lock the subject via trigger #7) and concurrent investigation creations (which also lock the subject per v1.2.9 Flow 1).

### Equivalent validation for workset exception consumptions

Trigger #3 is similarly extended for BEFORE INSERT:

1. **Lock parent exception.** SELECT * FROM amaia_sync_workset_exceptions WHERE id = NEW.exception_id FOR UPDATE.
2. **Latest decision.** Read MAX(decision_seq) FROM amaia_sync_workset_exception_decisions WHERE exception_id = NEW.exception_id. Read that decision row. Verify decision.id = NEW.decision_id. If not: raise exception.
3. **Approval check.** Verify decision.decision = 'approved'. If not: raise exception.
4. **Hash freshness.** Verify NEW.source_row_hash_at_consumption = exception.source_row_hash. If not: raise exception.
5. **Decision parentage.** Covered by composite FK from Blocker 1.

No manifest validation needed for workset consumptions (they are linked to a run, not a manifest).

**On UPDATE/DELETE:** raise exception (append-only). Unchanged.

### Trigger count

Still 9 triggers. Triggers #3 and #8 are expanded from "append-only" to "validate-on-insert + append-only." No triggers added or removed.

---

## Non-Blocking Observation 1: decision_seq Assigned by Trigger

### Problem

v1.0.1 requires the inserter to compute decision_seq before insertion. This requires the inserter to independently query MAX(decision_seq) and hold the lock — logic that duplicates what the trigger already does.

### Correction

decision_seq is computed by the INSERT trigger, not by the inserter. The inserter omits or provides a placeholder value; the trigger overwrites it.

**Trigger #2 (workset exception decisions) — BEFORE INSERT, extended:**

Existing behavior: lock parent exception FOR UPDATE.
Added: compute NEW.decision_seq = COALESCE(MAX(decision_seq) FROM decisions WHERE exception_id = NEW.exception_id, 0) + 1.

**Trigger #7 (exclusion decisions) — BEFORE INSERT, extended:**

Existing behavior: lock subject FOR UPDATE, verify current_investigation_id.
Added: compute NEW.decision_seq = COALESCE(MAX(decision_seq) FROM decisions WHERE investigation_id = NEW.investigation_id, 0) + 1.

The inserter provides: exception_id/investigation_id, decision, decided_by, comment/reason. The trigger assigns decision_seq under the serialization lock. This eliminates the possibility of incorrect seq values from application bugs.

**Column change:** decision_seq on both decision tables gains DEFAULT 0 (placeholder that the trigger overwrites). The CHECK (decision_seq > 0) still applies — the trigger always produces a value > 0. If the trigger somehow fails to fire, the default 0 violates the CHECK and the INSERT fails safely.

---

## Non-Blocking Observation 2: failed_terminal Terminology Clarification

### Problem

"Terminal" suggests no transitions out. But failed_terminal → ignored_approved is a valid transition (administrative override).

### Clarification (no rename)

The state name `failed_terminal` is retained to avoid cascading schema changes. Its semantics are clarified:

**failed_terminal** means: "not automatically retryable by the engine." The retry budget is exhausted. The entry will not appear in the processor's selection query. It requires operator attention.

The transition failed_terminal → ignored_approved is an **administrative override**, not an automatic retry. It represents an explicit human decision to acknowledge and dismiss the obligation with recorded rationale.

The state is "terminal from the engine's perspective." The operator has override authority that the engine does not.

This clarification applies to the remediation queue documentation (v1.0 section 5.1). No schema change.

---

## Non-Blocking Observation 3: Complete ON DELETE Matrix

All FKs across all 11 new tables and 2 modified deployed tables, with definitive ON DELETE actions.

### Principle

| Column nullable | ON DELETE action | Rationale |
|---|---|---|
| NOT NULL + audit-critical | RESTRICT | Prevents deletion of referenced rows. Audit trail preserved. |
| NOT NULL + cascadable | CASCADE | Child row has no meaning without parent. |
| Nullable + evidence | SET NULL | Row survives but loses the optional reference. Evidence is self-contained. |

### Matrix

| Child table | Child column(s) | Parent table | ON DELETE | Rationale |
|---|---|---|---|---|
| **amaia_sync_runs** | cycle_id | amaia_sync_cycles | RESTRICT | Cycle is audit root. Not deletable while referenced. |
| **amaia_sync_runs** | upstream_run_id | amaia_sync_runs | SET NULL | Nullable. Run survives without upstream link. |
| **amaia_sync_reconciliation_results** | cycle_id | amaia_sync_cycles | RESTRICT | Same as sync_runs.cycle_id. |
| **amaia_sync_run_manifests** | run_id | amaia_sync_runs | CASCADE | Manifest has no meaning without its run. |
| **amaia_sync_workset_exceptions** | detection_run_id | amaia_sync_runs | SET NULL | Nullable. Investigation survives without run link. |
| **amaia_sync_workset_exception_decisions** | exception_id | amaia_sync_workset_exceptions | CASCADE | Decision has no meaning without its investigation. |
| **amaia_sync_workset_exception_consumptions** | (decision_id, exception_id) | amaia_sync_workset_exception_decisions (id, exception_id) | CASCADE | Consumption meaningless without its decision. |
| **amaia_sync_workset_exception_consumptions** | exception_id | amaia_sync_workset_exceptions | CASCADE | Consumption meaningless without its investigation. |
| **amaia_sync_workset_exception_consumptions** | consumed_by_run_id | amaia_sync_runs | RESTRICT | NOT NULL. Run must not be deleted while consumption references it. |
| **amaia_sync_manifest_exclusion_subjects** | (current_investigation_id, id) | amaia_sync_manifest_exclusion_investigations (id, subject_id) | SET NULL | Nullable. Subject reverts to "no current investigation" if investigation is deleted. |
| **amaia_sync_manifest_exclusion_investigations** | subject_id | amaia_sync_manifest_exclusion_subjects | CASCADE | Investigation meaningless without subject. |
| **amaia_sync_manifest_exclusion_investigations** | detection_run_id | amaia_sync_runs | SET NULL | Nullable. |
| **amaia_sync_manifest_exclusion_investigations** | detection_manifest_id | amaia_sync_run_manifests | SET NULL | Nullable. |
| **amaia_sync_manifest_exclusion_decisions** | investigation_id | amaia_sync_manifest_exclusion_investigations | CASCADE | Decision meaningless without investigation. |
| **amaia_sync_manifest_exclusion_consumptions** | (decision_id, investigation_id) | amaia_sync_manifest_exclusion_decisions (id, investigation_id) | CASCADE | Consumption meaningless without decision. |
| **amaia_sync_manifest_exclusion_consumptions** | investigation_id | amaia_sync_manifest_exclusion_investigations | CASCADE | Consumption meaningless without investigation. |
| **amaia_sync_manifest_exclusion_consumptions** | consumed_by_run_id | amaia_sync_runs | RESTRICT | NOT NULL. |
| **amaia_sync_manifest_exclusion_consumptions** | (consumed_by_manifest_id, consumed_by_run_id) | amaia_sync_run_manifests (id, run_id) | RESTRICT | NOT NULL pair. Run/manifest must not be deleted while consumption exists. |
| **amaia_sync_alert_remediation_queue** | origin_run_id | amaia_sync_runs | SET NULL | Nullable. |
| **amaia_sync_alert_remediation_queue** | origin_reconciliation_result_id | amaia_sync_reconciliation_results | SET NULL | Nullable. |
| **amaia_sync_alert_remediation_queue** | claimed_by_run_id | amaia_sync_runs | SET NULL | Nullable. |
| **amaia_sync_alert_remediation_queue** | consumed_by_run_id | amaia_sync_runs | SET NULL | Nullable. |

---

## Updated Inventories

### New UKs (delta from v1.0.1)

| Table | UK columns | Purpose |
|---|---|---|
| amaia_sync_workset_exception_decisions | (id, exception_id) | Composite FK target for consumptions |
| amaia_sync_manifest_exclusion_decisions | (id, investigation_id) | Composite FK target for consumptions |
| amaia_sync_manifest_exclusion_investigations | (id, subject_id) | Composite FK target for subjects |
| amaia_sync_run_manifests | (id, run_id) | Composite FK target for exclusion consumptions |

### Modified FKs (delta from v1.0.1)

| Table | Old FK | New FK |
|---|---|---|
| workset_exception_consumptions | decision_id → decisions(id) | (decision_id, exception_id) → decisions(id, exception_id) |
| exclusion_consumptions | decision_id → decisions(id) | (decision_id, investigation_id) → decisions(id, investigation_id) |
| exclusion_consumptions | consumed_by_manifest_id → manifests(id) | (consumed_by_manifest_id, consumed_by_run_id) → manifests(id, run_id) |
| exclusion_subjects | current_investigation_id → investigations(id) | (current_investigation_id, id) → investigations(id, subject_id) |

### Trigger inventory (updated)

| # | Table | Trigger | BEFORE INSERT | BEFORE UPDATE | BEFORE DELETE |
|---|---|---|---|---|---|
| 1 | workset_exceptions | append_only | — | Reject | Reject |
| 2 | workset_exception_decisions | append_only_serialize_assign_seq | Lock exception FOR UPDATE; compute decision_seq | Reject | Reject |
| 3 | workset_exception_consumptions | validate_and_append_only | Lock exception FOR UPDATE; validate latest decision = approved + hash match | Reject | Reject |
| 4 | run_manifests | phase_column_guard | — | Enforce phase transitions, per-phase column writes, immutable-from-INSERT columns | Reject |
| 5 | remediation_queue | state_machine_guard | — | Enforce state machine, conditional fields, immutable identity columns | — |
| 6 | exclusion_investigations | validate_denorm_and_append_only | Validate domain_name and excluded_amaia_id match subject | Reject | Reject |
| 7 | exclusion_decisions | append_only_serialize_assign_seq | Lock subject FOR UPDATE; verify current_investigation_id; compute decision_seq | Reject | Reject |
| 8 | exclusion_consumptions | validate_and_append_only | Lock subject FOR UPDATE; validate vigency + latest decision approved + hash + manifest sets_match | Reject | Reject |
| 9 | exclusion_subjects | subject_identity_guard | — | Reject changes to domain_name/excluded_amaia_id/created_at; set updated_at | — |

Total: 9 triggers. Count unchanged from v1.0.1.

### Cumulative counts (v1.0 through v1.0.2)

| Category | v1.0 | v1.0.1 | v1.0.2 |
|---|---|---|---|
| New tables | 11 | 11 | 11 |
| New columns on deployed tables | 7 | 7 | 7 |
| Modified CHECKs on deployed tables | 4 | 4 | 4 |
| UKs | 9 | 9 | **13** (+4 composite FK targets) |
| FKs | 22 | 22 | **22** (4 replaced by composite equivalents, net same) |
| Triggers | 9 | 9 | 9 (expanded logic, same count) |
| Indexes | ~20 | ~20 | ~24 (UKs create implicit indexes) |

---

## Self-Audit: Attempting to Break These 3 Corrections

### Attack: Insert consumption linking decision from wrong exception

```
INSERT INTO workset_exception_consumptions
  (exception_id = A, decision_id = D_from_B, ...)
```

**Result:** Composite FK (decision_id, exception_id) → decisions(id, exception_id) requires that the decision row has exception_id = A. Decision D_from_B has exception_id = B. FK violation. INSERT rejected. **Resists.**

### Attack: Subject points to investigation of another subject

```
UPDATE subjects SET current_investigation_id = inv_from_subject_B WHERE id = subject_A
```

**Result:** Composite FK (current_investigation_id, id) → investigations(id, subject_id) requires that the investigation has subject_id = subject_A.id. Investigation from subject B has subject_id = subject_B.id. FK violation. UPDATE rejected. **Resists.**

### Attack: Insert consumption for non-current investigation

```
INSERT INTO exclusion_consumptions (investigation_id = old_I1, ...)
```

**Result:** Trigger #8 BEFORE INSERT: locks subject, reads subject.current_investigation_id. If current is I2, not I1: raise exception. INSERT rejected. **Resists.**

### Attack: Insert consumption with non-latest decision

```
INSERT INTO exclusion_consumptions (decision_id = D1, ...)
-- but D2 exists with higher decision_seq
```

**Result:** Trigger #8 BEFORE INSERT: reads MAX(decision_seq) for the investigation. D2 has higher seq. D1 is not latest. Raise exception. INSERT rejected. **Resists.**

### Attack: Insert consumption when latest decision is rejected

**Result:** Trigger #8 step 6: reads decision.decision. If 'rejected': raise exception. **Resists.**

### Attack: Insert consumption with stale investigation hash

**Result:** Trigger #8 step 7: compares investigation_hash_at_consumption with investigation.investigation_hash. Mismatch: raise exception. **Resists.**

### Attack: Insert consumption for manifest with sets_match=false

**Result:** Trigger #8 step 9: reads manifest.sets_match. If not true: raise exception. **Resists.**

### Attack: Insert exclusion consumption with mismatched manifest/run

```
consumed_by_manifest_id = manifest_from_run_X, consumed_by_run_id = run_Y
```

**Result:** Composite FK (consumed_by_manifest_id, consumed_by_run_id) → manifests(id, run_id). Manifest has run_id = run_X, not run_Y. FK violation. **Resists.**

### Attack: Insert investigation with wrong denormalized domain_name

```
INSERT INTO exclusion_investigations (subject_id = S, domain_name = 'wrong', ...)
```

**Result:** Trigger #6 BEFORE INSERT: reads subject. subject.domain_name != 'wrong'. Raise exception. **Resists.**

### Attack: Concurrent decision insertion while consumption INSERT runs trigger

**Result:** Both lock the same subject row (FOR UPDATE). Serialized. The second waits. After the first commits, the second sees updated state. **Resists.**

### Attack: decision_seq collision from concurrent inserts

**Result:** Both decision inserts lock the parent (exception or subject). Serialized. The trigger computes seq under the lock. No collision possible. **Resists.**

---

## Blocker → Resolution

| # | Blocker | Resolution | Schema change | Cerrado? |
|---|---|---|---|---|
| B1 | Consumptions can link decisions from wrong parent | 4 new UKs as composite FK targets. 4 simple FKs replaced by composite FKs. Cross-parent linking structurally impossible. | +4 UKs, 4 FK replacements | **Yes** |
| B2 | Subject can point to investigation of wrong subject | UK (id, subject_id) on investigations. Composite FK from subjects. Denormalized columns validated by trigger #6 on INSERT. | +1 UK, 1 FK replacement, trigger #6 expanded | **Yes** |
| B3 | Consumption INSERT not validated at schema level | Triggers #3 and #8 expanded: BEFORE INSERT validates vigency, latest decision, approval status, hash freshness, manifest success. All under serialization lock. | Trigger logic expanded (no new triggers) | **Yes** |
| O1 | decision_seq assigned by inserter, not trigger | Triggers #2 and #7 compute decision_seq under lock. Inserter omits or provides placeholder. | DEFAULT 0 on decision_seq columns | **Yes** |
| O2 | failed_terminal misleading name | Clarified: "not automatically retryable." Administrative override (→ ignored_approved) is distinct from automatic retry. Name retained. | None (documentation) | **Yes** |
| O3 | ON DELETE matrix missing | Complete matrix for all 22 FKs with rationale. | None (documentation) | **Yes** |
| O4 | Inventories stale | UKs, FKs, triggers, counts updated. | None (documentation) | **Yes** |

---

## Modules NOT modified

Cycles, manifests (beyond new UK), reconciliation segments, remediation queue (beyond terminology clarification), lease/fencing, deployed table modifications (beyond cycle_id FK action from v1.0.1), safety lag, provisional processing, watermark contracts, lock protocols.

---

**End of document.**
