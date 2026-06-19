# AMAIA-SYNC Runtime Architecture v1.2.7

**Phase:** 9.3 Rev.10  
**Status:** Design — pending internal review  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.6.md (3 corrections: B1, B2, B3)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Date:** 2026-06-18

---

## Scope

All content from v1.2.6 is incorporated by reference unless explicitly superseded. This revision corrects 3 findings from the internal adversarial audit of v1.2.6. No macro-architectural changes. The corrections are:

- **B1:** Manifest exclusions ledger redesigned from 1 mutable table to 3 append-only tables following the investigation/decision/consumption standard established for the workset exception ledger.
- **B2:** Remediation retry_count incremented on processing failure, not on claim.
- **B3:** Provisional remediation enqueue specified as idempotent (ON CONFLICT DO NOTHING).

**Superseded v1.2.6 sections:** C4 (Extra IDs Convergence) is fully replaced by B1 below. C3 claim semantics are adjusted by B2.

---

## B1 — Manifest Exclusions: Investigation / Decision / Consumption

### What v1.2.6 got wrong

v1.2.6's `amaia_sync_manifest_exclusions` was a single mutable table with UNIQUE(domain_name, excluded_amaia_id) and in-place status transitions. This repeats three errors Codex already rejected in the workset exception ledger:

1. UNIQUE without versioning blocks re-investigation after rejection.
2. No consumption tracking — cannot prove which manifest relied on which exclusion.
3. Investigation and decision mixed in one mutable row — no append-only audit trail.

### Correction: 3-table pattern

The single `amaia_sync_manifest_exclusions` table from v1.2.6 is replaced by three append-only tables that mirror the workset exception ledger's approved design pattern.

---

### Table 1: amaia_sync_manifest_exclusion_investigations

Records the detection of an extra ID in a manifest comparison. Append-only: rows are inserted on detection, never updated or deleted.

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| domain_name | text | no | |
| excluded_amaia_id | integer | no | The amaia_id found in P but not in S |
| investigation_hash | text | no | SHA-256 of canonical evidence snapshot (see below) |
| detection_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL |
| detection_manifest_id | uuid | yes | FK → amaia_sync_run_manifests(id) ON DELETE SET NULL |
| amaia_lookup_evidence | text | no | Factual result of AMAIA primary-key lookup |
| amaia_lookup_at | timestamptz | no | When the AMAIA lookup was performed |
| created_at | timestamptz | no | default now() |

**UNIQUE:** (domain_name, excluded_amaia_id, investigation_hash).

One investigation per distinct evidence snapshot for a given amaia_id. If the operator rejects an investigation and new evidence emerges (e.g., a new AMAIA lookup at a different time returns different results), the new investigation has a different investigation_hash and creates a new row. The rejected investigation remains in the table as historical record.

**investigation_hash algorithm:**

Canonical JSON (same pattern as logestado_exception_v2):

```json
{"amaia_lookup_at":"2026-06-18T14:30:00.000000Z","amaia_lookup_evidence":"SELECT count: 0 rows for id=95","domain_name":"logestado","excluded_amaia_id":95,"schema":"manifest_exclusion_investigation_v1"}
```

Keys sorted lexicographically. SHA-256 of UTF-8 bytes. This ensures: same evidence at same time for same ID = same hash (no duplicate investigation). Different evidence or different time = different hash (new investigation allowed).

**Append-only enforcement:** BEFORE UPDATE OR DELETE trigger raises exception.

---

### Table 2: amaia_sync_manifest_exclusion_decisions

Records operator judgments on investigations. Append-only: each decision is a new row. The latest decision for an investigation is the one with MAX(decision_seq).

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| investigation_id | uuid | no | FK → amaia_sync_manifest_exclusion_investigations(id) ON DELETE CASCADE |
| decision_seq | integer | no | CHECK (decision_seq > 0) |
| decision | text | no | CHECK ('approved', 'rejected') |
| decided_by | text | no | Operator identity |
| decided_at | timestamptz | no | default now() |
| reason | text | no | CHECK (length(reason) > 0) |
| evidence | jsonb | yes | Optional supporting data |
| created_at | timestamptz | no | default now() |

**UNIQUE:** (investigation_id, decision_seq). Monotonic per investigation.

**Serialization:** On INSERT, the trigger acquires an exclusive row lock on the parent investigation row (SELECT ... FOR UPDATE on amaia_sync_manifest_exclusion_investigations WHERE id = :investigation_id). This serializes decision insertion with exclusion consumption (same lock target).

**Append-only enforcement:** BEFORE UPDATE OR DELETE trigger raises exception.

---

### Table 3: amaia_sync_manifest_exclusion_consumptions

Records when and by which manifest/run an approved exclusion was consumed. Append-only.

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| investigation_id | uuid | no | FK → amaia_sync_manifest_exclusion_investigations(id) |
| decision_id | uuid | no | FK → amaia_sync_manifest_exclusion_decisions(id) |
| consumed_by_run_id | uuid | no | FK → amaia_sync_runs(id) |
| consumed_by_manifest_id | uuid | no | FK → amaia_sync_run_manifests(id) |
| investigation_hash_at_consumption | text | no | Re-verified at consumption time |
| consumed_at | timestamptz | no | default now() |

**UNIQUE:** (investigation_id, consumed_by_run_id). One consumption per investigation per run.

**Append-only enforcement:** BEFORE UPDATE OR DELETE trigger raises exception.

---

### Exclusion consumption — transactional contract

Within the manifest comparison fenced transaction (ownership predicate verified):

1. Compute S and P over (lower_bound, upper_bound].
2. If P \ S is non-empty (extra_ids exist):
   a. For each extra amaia_id: query amaia_sync_manifest_exclusion_investigations for matching (domain_name, excluded_amaia_id).
   b. For each matching investigation: SELECT ... FROM amaia_sync_manifest_exclusion_investigations WHERE id = :investigation_id **FOR UPDATE** (serializes with concurrent decision insertion).
   c. Read latest decision by MAX(decision_seq) for this investigation.
   d. If latest decision != 'approved': exclusion not available for this amaia_id.
   e. If approved: verify investigation_hash_at_consumption matches the investigation's investigation_hash (ensures the evidence hasn't been superseded by a newer investigation).
   f. If verified: insert consumption record into amaia_sync_manifest_exclusion_consumptions.
3. Compute E = set of excluded_amaia_ids with valid, consumed exclusions.
4. Compute S_effective = S - E, P_effective = P - E.
5. sets_match = (hash(S_effective) == hash(P_effective)).
6. If sets_match = true: advance watermark. Update manifest to confirmed_compared.
7. COMMIT.

If any extra_id lacks a valid approved exclusion, sets_match = false and the watermark does not advance.

### Audit query

"Did manifest M advance the watermark using exclusions?"

```
SELECT c.*, d.decision, d.decided_by, d.reason, i.excluded_amaia_id
FROM amaia_sync_manifest_exclusion_consumptions c
JOIN amaia_sync_manifest_exclusion_decisions d ON c.decision_id = d.id
JOIN amaia_sync_manifest_exclusion_investigations i ON c.investigation_id = i.id
WHERE c.consumed_by_manifest_id = :manifest_id
```

Returns: every exclusion used, who approved it, why, and the evidence.

### Auto-detection of extra_ids

When a manifest comparison finds extra_ids and no matching investigation exists, the engine automatically creates investigation rows (in the same transaction as the manifest update to confirmed_compared). These start with no decisions — they require operator action before they can be consumed.

### Schema impact

3 new tables replace the 1 table from v1.2.6. 3 append-only triggers (one per table) + 1 serialization trigger on decisions INSERT. Net: +2 tables over v1.2.6 (removed amaia_sync_manifest_exclusions, added 3 new tables).

---

## B2 — retry_count Incremented on Failure, Not on Claim

### What v1.2.6 got wrong

v1.2.6 increments retry_count in the claim UPDATE (pending → claimed). A crash before processing consumes a retry without any work attempted. After max_retries crashes, the entry reaches failed_terminal — the operator sees "exhausted retries" for an entry that was never actually processed.

### Correction

**Claim does NOT increment retry_count:**

```
pending/failed_retryable → claimed:
  SET status = 'claimed',
      claimed_by_run_id = :run_id,
      claimed_at = now(),
      claim_expires_at = now() + :claim_ttl
  -- retry_count is NOT incremented here
```

**Processing failure DOES increment retry_count:**

```
claimed → failed_retryable:
  SET status = 'failed_retryable',
      retry_count = retry_count + 1,
      failure_reason = :reason,
      claimed_by_run_id = NULL,
      claim_expires_at = NULL
  -- retry_count incremented here because actual work was attempted and failed

claimed → failed_terminal:
  SET status = 'failed_terminal',
      retry_count = retry_count + 1,
      failure_reason = :reason
  -- only reached when retry_count + 1 >= max_retries
```

**Claim expiry (no processing attempted):**

When a claim expires (claim_expires_at < now()) without the processor transitioning to success/failed:
- The entry is re-selectable.
- retry_count is unchanged.
- The Scheduler's selection query picks it up: `WHERE (status = 'claimed' AND claim_expires_at < now())`.
- The new claim sets claimed_by_run_id, claimed_at, claim_expires_at. retry_count stays the same.

**Terminal transition condition:**

```
failed_terminal is reached when:
  retry_count + 1 >= max_retries
  (checked at the moment of claimed → failed transition)
```

This ensures retry_count reflects actual processing attempts, not claim attempts. Infrastructure crashes don't consume the retry budget.

### Updated state machine trigger

The BEFORE UPDATE trigger on amaia_sync_alert_remediation_queue is updated:

- Transition pending → claimed: retry_count must NOT change.
- Transition claimed → claimed (re-claim after expiry): retry_count must NOT change.
- Transition failed_retryable → claimed: retry_count must NOT change.
- Transition claimed → failed_retryable: retry_count must equal OLD.retry_count + 1.
- Transition claimed → failed_terminal: retry_count must equal OLD.retry_count + 1.
- Transition claimed → success: retry_count must NOT change.

### Schema impact

No new columns or tables. Behavioral change to the claim query and state machine trigger.

---

## B3 — Idempotent Provisional Remediation Enqueue

### What v1.2.6 got wrong

Provisional re-processing in cycle N+1 attempts to INSERT a remediation entry that already exists from cycle N. The UNIQUE constraint (source_type, logestado_amaia_id, alert_amaia_id) WHERE logestado_amaia_id IS NOT NULL causes a violation. The entire provisional transaction rolls back, including the idempotent upsert to amaia_alert_logs.

### Correction

All remediation enqueue operations during provisional processing use conflict-tolerant insertion:

```
INSERT INTO amaia_sync_alert_remediation_queue (...)
VALUES (...)
ON CONFLICT (source_type, logestado_amaia_id, alert_amaia_id)
WHERE logestado_amaia_id IS NOT NULL
DO NOTHING
```

**Behavior when the remediation already exists:**

- The INSERT is a no-op.
- The existing remediation row is preserved unchanged (original evidence, original origin_run_id, original status).
- The provisional upsert to amaia_alert_logs continues within the same transaction.
- The transaction commits normally.

**When to use DO NOTHING vs normal INSERT:**

| Context | Behavior | Rationale |
|---|---|---|
| Provisional logestado processing | ON CONFLICT DO NOTHING | Provisional zone is re-processed idempotently each cycle until confirmed. Re-enqueue is expected. |
| Reconciliation backfill | Normal INSERT (no ON CONFLICT) | Backfill remediation is a one-time event for a specific missing row. A duplicate would indicate a bug. |
| Exception resolution | Normal INSERT | One-time event. Duplicate would indicate a bug. |
| Reconciliation drift | ON CONFLICT DO NOTHING | Drift may be re-detected across consecutive reconciliation cycles for the same alert. |
| Manual operator | Normal INSERT | Operator explicitly creates a new obligation. |

This table is the definitive reference for enqueue semantics per source_type.

### Schema impact

No new columns or tables. Behavioral specification for INSERT operations.

---

## Schema Gap Analysis — Delta from v1.2.6

### Removed tables

| Table | Reason |
|---|---|
| amaia_sync_manifest_exclusions | Replaced by 3-table pattern (B1) |

### New tables

| Table | Source | Append-only? |
|---|---|---|
| amaia_sync_manifest_exclusion_investigations | B1 | Yes (trigger enforced) |
| amaia_sync_manifest_exclusion_decisions | B1 | Yes (trigger enforced) |
| amaia_sync_manifest_exclusion_consumptions | B1 | Yes (trigger enforced) |

### New triggers

| Table | Trigger | Behavior | Source |
|---|---|---|---|
| amaia_sync_manifest_exclusion_investigations | append_only | Reject UPDATE and DELETE | B1 |
| amaia_sync_manifest_exclusion_decisions | append_only_and_serialize | Reject UPDATE and DELETE; on INSERT acquire exclusive lock on parent investigation | B1 |
| amaia_sync_manifest_exclusion_consumptions | append_only | Reject UPDATE and DELETE | B1 |

Note: the single `status_transition_guard` trigger on `amaia_sync_manifest_exclusions` from v1.2.6 is removed (table no longer exists).

### Modified triggers

| Table | Trigger | Change | Source |
|---|---|---|---|
| amaia_sync_alert_remediation_queue | state_machine_guard | retry_count transition rules updated | B2 |

### Cumulative DDL inventory (v1.2 through v1.2.7)

**New tables: 10**
1. amaia_sync_cycles (v1.2)
2. amaia_sync_run_manifests (v1.2.3)
3. amaia_sync_workset_exceptions (v1.2.3)
4. amaia_sync_workset_exception_decisions (v1.2.3)
5. amaia_sync_workset_exception_consumptions (v1.2.3)
6. amaia_sync_reconciliation_segments (v1.2.3)
7. amaia_sync_alert_remediation_queue (v1.2.5, expanded v1.2.6)
8. amaia_sync_manifest_exclusion_investigations (v1.2.7)
9. amaia_sync_manifest_exclusion_decisions (v1.2.7)
10. amaia_sync_manifest_exclusion_consumptions (v1.2.7)

**New columns on pre-existing deployed tables: 7**
- amaia_sync_runs: cycle_id (NOT NULL), upstream_run_id, blocked_entity_name
- amaia_sync_reconciliation_results: cycle_id (NOT NULL), scope_descriptor (NOT NULL), result_status

**Modified CHECK constraints on pre-existing deployed tables: 4**
- amaia_sync_runs.reason_code + 'WORKSET_INTEGRITY_FAILURE'
- amaia_beneficiaries/support_network/alerts.sync_status + 'reactivation_pending'

**Triggers: 9**
- 3 append-only on workset exception ledger (v1.2.4)
- 3 append-only on manifest exclusion ledger (v1.2.7 B1)
- 1 manifest phase/column guard (v1.2.6 C2)
- 1 remediation state machine guard (v1.2.6 C3, updated v1.2.7 B2)
- 1 serialization on workset exception decisions INSERT (v1.2.4 F2)

Note: the exclusion decisions table also has serialization behavior in its append_only_and_serialize trigger, counted above.

**Data corrections:** 1 watermark row update + 12 segment seed rows

---

## B1–B3 Hallazgo → Resolución v1.2.7

| # | Hallazgo | Severidad | Resolución | DDL delta vs v1.2.6 | Cerrado? |
|---|---|---|---|---|---|
| B1 | Exclusion ledger: single mutable table, UNIQUE blocks re-investigation, no consumption tracking, no investigation/decision separation | ALTO | 3-table append-only pattern: investigations (versioned by investigation_hash), decisions (monotonic decision_seq, serialized), consumptions (links to manifest/run). Full audit trail. Consistent with exception ledger standard. | -1 table, +3 tables, +3 append-only triggers, +1 serialization trigger | **Yes** |
| B2 | retry_count incremented on claim, not on processing failure. Crashes consume budget. | MEDIO | retry_count incremented only on claimed→failed_retryable and claimed→failed_terminal transitions. Claims and claim expiries do not affect retry_count. | Trigger logic updated | **Yes** |
| B3 | Provisional remediation INSERT violates UNIQUE on re-processing | MEDIO | ON CONFLICT DO NOTHING for provisional and reconciliation-drift enqueues. Normal INSERT for backfill, exception resolution, and manual. Per-source_type enqueue semantics defined. | None (behavioral spec) | **Yes** |

---

## Verification: Architectural Consistency

This section confirms that the exclusion ledger (B1) follows the same design pattern as the workset exception ledger, addressing the specific errors Codex previously identified.

| Design aspect | Workset exception ledger | Manifest exclusion ledger (v1.2.7) | Consistent? |
|---|---|---|---|
| Investigation records | amaia_sync_workset_exceptions (append-only) | amaia_sync_manifest_exclusion_investigations (append-only) | Yes |
| UNIQUE supports re-investigation | (domain, source_amaia_id, source_row_hash, hash_version) | (domain, excluded_amaia_id, investigation_hash) | Yes |
| Decision records | amaia_sync_workset_exception_decisions (append-only, decision_seq) | amaia_sync_manifest_exclusion_decisions (append-only, decision_seq) | Yes |
| Latest decision | MAX(decision_seq) | MAX(decision_seq) | Yes |
| Serialization | FOR UPDATE on parent exception during consumption and decision INSERT | FOR UPDATE on parent investigation during consumption and decision INSERT | Yes |
| Consumption records | amaia_sync_workset_exception_consumptions (append-only) | amaia_sync_manifest_exclusion_consumptions (append-only) | Yes |
| Consumption links to run | consumed_by_run_id | consumed_by_run_id + consumed_by_manifest_id | Yes (extended) |
| Hash re-verification | source_row_hash_at_consumption | investigation_hash_at_consumption | Yes |
| Append-only enforcement | BEFORE UPDATE/DELETE triggers | BEFORE UPDATE/DELETE triggers | Yes |

Every design aspect that Codex required for the exception ledger is replicated in the exclusion ledger. No structural shortcuts.

---

**End of document.**
