# AMAIA-SYNC Runtime Architecture v1.2.8

**Phase:** 9.3 Rev.11  
**Status:** Design — pending internal review  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.7.md (3 corrections: C1, C2, C3)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Date:** 2026-06-18

---

## Scope

All content from v1.2.7 is incorporated by reference unless explicitly superseded. This revision corrects 3 critical blockers from Codex's rejection of v1.2.7. No macro-architectural changes.

- **C1:** Exclusion investigations now reference a stable subject entity. Consumption is serialized at the subject level, ensuring a newer investigation invalidates all older investigations for the same (domain, amaia_id) pair.
- **C2:** Remediation failed_retryable entries use a dedicated next_attempt_at column for backoff scheduling, fixing the NULL comparison bug.
- **C3:** Exclusion consumptions are inserted only after sets_match is confirmed true, within the same fenced transaction as watermark advance. No premature consumption evidence.

---

## C1 — Exclusion Subject Entity with Global Vigency

### Problem

v1.2.7's exclusion ledger locks individual investigation rows during consumption. But an older approved investigation for (domain, excluded_amaia_id) remains consumable even after a newer investigation exists for the same pair (possibly with a rejected decision). The lock on investigation A does not prevent consumption of investigation A when investigation B (newer, rejected) exists.

Attack:

```
Investigation I1 for amaia_id=95: approved (decision D1).
New evidence emerges → Investigation I2 for amaia_id=95: rejected (decision D2).
Engine consumes I1 (still approved) → cursor advances.
But the latest knowledge (I2, rejected) says the exclusion is NOT valid.
```

### Correction: Stable subject entity

A new table represents the stable identity of an exclusion subject — the (domain, excluded_amaia_id) pair. All investigations, decisions, and consumptions are anchored to this subject. The subject row is the single serialization point for all operations on a given (domain, excluded_amaia_id).

### Table: amaia_sync_manifest_exclusion_subjects

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| domain_name | text | no | |
| excluded_amaia_id | integer | no | |
| current_investigation_id | uuid | yes | FK → amaia_sync_manifest_exclusion_investigations(id). The active investigation. NULL if no investigation exists yet. |
| current_investigation_seq | integer | no | default 0, CHECK >= 0. Monotonically increasing. |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | default now() |

**UNIQUE:** (domain_name, excluded_amaia_id). One subject per excluded ID per domain.

**Mutability contract:** This table IS mutable (current_investigation_id and current_investigation_seq change when a new investigation is created). It is NOT append-only. The subject is a coordination point, not an audit record. Audit records live in the append-only investigation/decision/consumption tables.

### Modified: amaia_sync_manifest_exclusion_investigations

Add columns:

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| subject_id | uuid | no | FK → amaia_sync_manifest_exclusion_subjects(id) |
| investigation_seq | integer | no | CHECK > 0. Monotonic per subject. |

**UNIQUE (revised):** (subject_id, investigation_seq) AND (subject_id, investigation_hash). Both enforced. The first ensures ordering. The second prevents duplicate evidence for the same subject.

The previous UNIQUE (domain_name, excluded_amaia_id, investigation_hash) is replaced by (subject_id, investigation_hash) since subject_id already encodes the (domain, excluded_amaia_id) pair.

### New investigation creation flow

Within a single transaction:

1. SELECT ... FROM amaia_sync_manifest_exclusion_subjects WHERE domain_name = :domain AND excluded_amaia_id = :amaia_id **FOR UPDATE**.
2. If no subject exists: INSERT subject with current_investigation_seq = 0, current_investigation_id = NULL.
3. INSERT investigation with subject_id, investigation_seq = subject.current_investigation_seq + 1, investigation_hash, evidence.
4. UPDATE subject: current_investigation_id = new investigation's id, current_investigation_seq = investigation_seq.
5. COMMIT.

The FOR UPDATE on the subject serializes all investigation creation for the same (domain, amaia_id). Two concurrent new-investigation attempts are serialized.

### Consumption vigency rule

**Only the subject's current_investigation_id is consumable.** An older investigation, even if approved, is not eligible for consumption once a newer investigation exists.

Consumption flow (within the manifest comparison fenced transaction):

1. For each extra amaia_id: SELECT ... FROM amaia_sync_manifest_exclusion_subjects WHERE domain_name = :domain AND excluded_amaia_id = :amaia_id **FOR UPDATE**.
2. Read subject.current_investigation_id.
3. If NULL: no investigation exists. Exclusion not available.
4. Read the latest decision for current_investigation_id (MAX decision_seq).
5. If latest decision != 'approved': exclusion not available.
6. Verify investigation_hash_at_consumption matches the current investigation's investigation_hash.
7. If all checks pass: insert consumption record referencing the current investigation and its approved decision.
8. (Continue with S_effective/P_effective computation and watermark advance — see C3.)

Because both consumption and new-investigation-creation lock the same subject row with FOR UPDATE, they are fully serialized. If a new investigation is being created concurrently, the consumption blocks until it completes. After the new investigation is committed, the consumption sees the updated current_investigation_id and evaluates the new (possibly unapproved) investigation — not the old one.

### Why fresh AMAIA lookup at consumption time is NOT required

The investigation record contains amaia_lookup_evidence and amaia_lookup_at from the time of investigation. The operator reviewed this evidence and approved the exclusion. A fresh AMAIA lookup at consumption time could produce different results (the row might have reappeared in AMAIA), which would invalidate the exclusion.

However, this is already handled by the normal sync flow: if the row reappears in AMAIA, the next fetch includes it in S. It appears in both S and P (or only in S if it was deleted from destination). Either way, it is no longer an extra_id in P \ S. The exclusion is not needed. The engine simply doesn't query exclusions for amaia_ids that are not in the extra_ids set.

Therefore: a fresh AMAIA lookup at consumption time adds latency without safety benefit. The investigation evidence is sufficient.

### Schema impact

1 new table (subjects). 2 new columns on investigations (subject_id, investigation_seq). UNIQUE constraints revised on investigations. Subject trigger: updated_at auto-set, no append-only (mutable by design).

---

## C2 — Remediation Retryable Selection with next_attempt_at

### Problem

v1.2.7 transitions claimed → failed_retryable with:

```
claimed_by_run_id = NULL
claim_expires_at = NULL
```

But the selection query includes:

```
status = 'failed_retryable' AND claim_expires_at < now()
```

In PostgreSQL, `NULL < now()` evaluates to NULL (not true). The entry is never selected. It is permanently stuck in failed_retryable.

### Correction: next_attempt_at column

New column on amaia_sync_alert_remediation_queue:

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| next_attempt_at | timestamptz | yes | NULL for terminal states and pending (immediately claimable) |

### Revised selection query

```
WHERE status = 'pending'
   OR (status = 'claimed' AND claim_expires_at < now())
   OR (status = 'failed_retryable' AND next_attempt_at <= now())
```

Each clause uses a non-null comparison for its specific state.

### Revised state transitions

**pending → claimed:**

```
status = 'claimed'
claimed_by_run_id = :run_id
claimed_at = now()
claim_expires_at = now() + :claim_ttl
next_attempt_at = NULL  (not applicable while claimed)
```

**claimed → success:**

```
status = 'success'
consumed_by_run_id = :run_id
processed_at = now()
claimed_by_run_id preserved (audit: who processed it)
claim_expires_at = NULL
next_attempt_at = NULL
```

**claimed → failed_retryable** (retry_count + 1 < max_retries):

```
status = 'failed_retryable'
retry_count = retry_count + 1
failure_reason = :reason
next_attempt_at = now() + (:base_backoff * 2^(retry_count))   -- exponential backoff
claimed_by_run_id = NULL
claim_expires_at = NULL
```

The backoff formula: base_backoff (default 30 seconds) * 2^retry_count. After retry 1: 60s. After retry 2: 120s. After retry 3: 240s. Capped at max_backoff (default 30 minutes).

**claimed → failed_terminal** (retry_count + 1 >= max_retries):

```
status = 'failed_terminal'
retry_count = retry_count + 1
failure_reason = :reason
next_attempt_at = NULL  (not claimable)
claimed_by_run_id = NULL
claim_expires_at = NULL
```

**failed_retryable → claimed** (re-claim when next_attempt_at <= now()):

```
status = 'claimed'
claimed_by_run_id = :run_id
claimed_at = now()
claim_expires_at = now() + :claim_ttl
next_attempt_at = NULL  (not applicable while claimed)
```

### Trigger update

The state machine trigger validates:
- If new status = 'failed_retryable': next_attempt_at must be NOT NULL and > now().
- If new status IN ('pending', 'claimed', 'success', 'failed_terminal', 'ignored_approved'): next_attempt_at must be NULL.
- retry_count rules unchanged from v1.2.7 B2.

### Schema impact

1 new column (next_attempt_at) on amaia_sync_alert_remediation_queue. Trigger logic updated.

---

## C3 — Consumption Only on Confirmed Watermark Advance

### Problem

v1.2.7's consumption transaction inserts exclusion consumption records as part of the comparison evaluation. If the comparison ultimately produces sets_match = false (e.g., extra_ids exist that have no approved exclusion), the transaction rolls back — which correctly prevents the consumptions from persisting. However, the document's step ordering is ambiguous: it lists consumption insertion (step f in the loop) before the final sets_match computation. A literal implementation could insert consumptions one-by-one during the loop and then fail at the sets_match check, relying on rollback for cleanup.

Codex's concern: if the transaction structure is misimplemented (e.g., consumptions inserted in a sub-transaction or savepoint that commits independently), false consumption evidence could persist.

### Correction: Explicit deferred-insert contract

Consumption records are assembled in memory during the evaluation loop but NOT inserted into the database until after sets_match is confirmed true.

### Revised manifest comparison transaction

Within a single fenced transaction (ownership predicate verified):

**Phase A — Evaluation (read-only database operations + in-memory assembly):**

1. Compute S (source set) and P (persisted set) over (lower_bound, upper_bound].
2. Compute extra_ids = P \ S.
3. If extra_ids is empty: skip to Phase B with E = empty set.
4. For each extra_id in extra_ids:
   a. SELECT ... FROM amaia_sync_manifest_exclusion_subjects WHERE domain_name = :domain AND excluded_amaia_id = :extra_id **FOR UPDATE**.
   b. Read subject.current_investigation_id.
   c. If NULL or no approved latest decision: mark this extra_id as **unresolved**. Continue to next extra_id.
   d. If approved: verify investigation_hash_at_consumption matches. If mismatch: mark as **unresolved**.
   e. If verified: add to **resolved_exclusions** list (in memory): {investigation_id, decision_id, investigation_hash}.
5. After all extra_ids evaluated:
   - unresolved_ids = extra_ids that could not be resolved.
   - E = set of excluded_amaia_ids from resolved_exclusions.

**Phase B — Comparison:**

6. Compute S_effective = S - E, P_effective = P - E.
7. sets_match = (hash(S_effective) == hash(P_effective)) AND (|S_effective| == |P_effective|).

**Phase C — Conditional commit (database writes):**

8. If sets_match = false:
   - Update manifest to `confirmed_compared` with sets_match = false, extra_ids = unresolved_ids.
   - Do NOT insert any consumption records.
   - Do NOT advance watermark.
   - COMMIT. (Manifest evidence is persisted. No consumption evidence. No watermark change.)

9. If sets_match = true:
   - Insert ALL consumption records from resolved_exclusions list (batch INSERT).
   - Update manifest to `confirmed_compared` with sets_match = true.
   - Advance watermark to confirmed_upper_bound.
   - COMMIT. (Manifest + consumptions + watermark advance all atomic.)

### Invariant

**A consumption record exists in amaia_sync_manifest_exclusion_consumptions if and only if the associated manifest has sets_match = true AND the watermark was advanced in the same transaction.**

This is verifiable: for any consumption C, join to its consumed_by_manifest_id → check sets_match = true. If sets_match is false, no consumption should exist. A discrepancy indicates a bug.

### What about evaluated-but-not-consumed exclusions?

When sets_match = false and some exclusions were resolved but others were not, the resolved exclusions are NOT recorded as consumptions (they weren't used to advance the watermark). If an auditor needs to know "which exclusions were evaluated during this failed comparison," that information is derivable from the manifest's extra_ids field combined with the subject/investigation state at the time. It is not explicitly recorded because recording it would create false evidence of consumption.

If explicit evaluation tracking is needed in a future version, a separate `amaia_sync_manifest_exclusion_evaluations` table could record evaluation attempts without implying consumption. This is deferred to V2.

### Schema impact

No new columns or tables. Behavioral specification for the transaction ordering.

---

## Schema Gap Analysis — Delta from v1.2.7

### New table

| Table | Source |
|---|---|
| amaia_sync_manifest_exclusion_subjects | C1 |

### New columns on tables defined in v1.2.7

| Table | Column | Type | Nullable | Source |
|---|---|---|---|---|
| amaia_sync_manifest_exclusion_investigations | subject_id | uuid | no | C1 |
| amaia_sync_manifest_exclusion_investigations | investigation_seq | integer | no | C1 |
| amaia_sync_alert_remediation_queue | next_attempt_at | timestamptz | yes | C2 |

### Modified UNIQUE constraints

| Table | v1.2.7 | v1.2.8 | Source |
|---|---|---|---|
| amaia_sync_manifest_exclusion_investigations | (domain_name, excluded_amaia_id, investigation_hash) | (subject_id, investigation_seq) AND (subject_id, investigation_hash) | C1 |

### Cumulative DDL inventory (v1.2 through v1.2.8)

**New tables: 11**
1. amaia_sync_cycles (v1.2)
2. amaia_sync_run_manifests (v1.2.3)
3. amaia_sync_workset_exceptions (v1.2.3)
4. amaia_sync_workset_exception_decisions (v1.2.3)
5. amaia_sync_workset_exception_consumptions (v1.2.3)
6. amaia_sync_reconciliation_segments (v1.2.3)
7. amaia_sync_alert_remediation_queue (v1.2.5, expanded v1.2.6/v1.2.8)
8. amaia_sync_manifest_exclusion_subjects (v1.2.8)
9. amaia_sync_manifest_exclusion_investigations (v1.2.7, expanded v1.2.8)
10. amaia_sync_manifest_exclusion_decisions (v1.2.7)
11. amaia_sync_manifest_exclusion_consumptions (v1.2.7)

**New columns on pre-existing deployed tables: 7**
- amaia_sync_runs: cycle_id (NOT NULL), upstream_run_id, blocked_entity_name
- amaia_sync_reconciliation_results: cycle_id (NOT NULL), scope_descriptor (NOT NULL), result_status

**Modified CHECK constraints on pre-existing deployed tables: 4**
- amaia_sync_runs.reason_code + 'WORKSET_INTEGRITY_FAILURE'
- amaia_beneficiaries/support_network/alerts.sync_status + 'reactivation_pending'

**Triggers: 9**
- 3 append-only on workset exception ledger (v1.2.4)
- 3 append-only on manifest exclusion ledger — investigations, decisions, consumptions (v1.2.7)
- 1 manifest phase/column guard (v1.2.6)
- 1 remediation state machine guard (v1.2.6, updated v1.2.7/v1.2.8)
- 1 serialization on workset exception decisions INSERT (v1.2.4)

Note: exclusion decisions INSERT serialization is handled within the append_only_and_serialize trigger (already counted). Subject table uses an updated_at trigger (standard set_updated_at, already exists in the codebase).

**Data corrections:** 1 watermark row update + 12 segment seed rows

---

## C1–C3 Hallazgo → Resolución v1.2.8

| # | Hallazgo Codex | Resolución | DDL delta vs v1.2.7 | Cerrado? |
|---|---|---|---|---|
| C1 | Older approved investigation consumable despite newer rejected investigation for same (domain, amaia_id) | Subject entity (domain, excluded_amaia_id) with current_investigation_id. FOR UPDATE on subject serializes all operations. Only current_investigation_id is consumable. New investigation automatically invalidates all prior investigations. | +1 table, +2 columns on investigations, UNIQUE revised | **Yes** |
| C2 | failed_retryable with NULL claim_expires_at is never selected (NULL < now() = NULL) | next_attempt_at column with exponential backoff. Selection uses next_attempt_at <= now() for failed_retryable. NULL semantics explicit per state. | +1 column on remediation queue | **Yes** |
| C3 | Consumption records inserted before sets_match confirmed, creating false evidence on rollback-dependent cleanup | Deferred-insert contract: consumptions assembled in memory during evaluation, inserted to DB only after sets_match = true, within the same fenced transaction as watermark advance. sets_match = false → zero consumptions persisted. | None (behavioral spec) | **Yes** |

---

**End of document.**
