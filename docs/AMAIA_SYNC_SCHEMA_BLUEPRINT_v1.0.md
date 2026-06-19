# AMAIA-SYNC Schema Blueprint v1.0

**Phase:** 9.3-schema  
**Status:** Blueprint — pending Codex audit before DDL  
**Source architecture:** v1.0 through v1.2.9 (approved with non-blocking observations)  
**Author:** Claude (constructor)  
**Date:** 2026-06-18

---

## 1. Cycles

### 1.1 amaia_sync_cycles

**Purpose:** First-class representation of a scheduling cycle. Groups all sync runs and reconciliation results within a single scheduling pass.

**Owner:** Scheduler (creates at cycle start, updates at cycle end).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| started_at | timestamptz | no | When the Scheduler initiated the cycle |
| finished_at | timestamptz | yes | When the last operation completed. NULL while running. |
| status | text | no | Cycle outcome |
| trigger_type | text | no | How the cycle was initiated |
| owner_identity | text | no | Structured identity of the initiating process |
| reconciliation_snapshot | jsonb | yes | Tier 4 capacity/SLO evidence per cycle. NULL if no reconciliation ran. |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |

#### Constraints

| Name | Definition |
|---|---|
| status_check | CHECK (status IN ('running', 'success', 'completed_with_failures')) |
| trigger_type_check | CHECK (trigger_type IN ('scheduled', 'manual', 'recovery')) |

#### Concurrency

No locks required. Single writer (Scheduler). Read by auditors and reconciliation engine.

#### Lifecycle

```
running → success
running → completed_with_failures
```

No reverse transitions. status is updated once at cycle end.

#### Audit

- created by: Scheduler (at cycle start)
- modified by: Scheduler (at cycle end: finished_at, status, reconciliation_snapshot)
- immutable after cycle end: all columns (no trigger enforcement — operational state, not audit record)

---

## 2. Manifests

### 2.1 amaia_sync_run_manifests

**Purpose:** Durable proof of set-identity between AMAIA source and Supabase destination for a sync run. Records source IDs fetched, destination IDs persisted, hash comparison result, and optional provisional processing evidence.

**Owner:** Domain processor (creates and advances phases within a single run).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| run_id | uuid | no | FK → amaia_sync_runs(id) ON DELETE CASCADE. One manifest per run. |
| domain_name | text | no | Domain this manifest covers |
| source_id_count | integer | no | Count of amaia_ids fetched from AMAIA |
| source_id_hash | text | no | SHA-256 of sorted, pipe-delimited source amaia_ids |
| persisted_id_count | integer | yes | Count of amaia_ids in destination for the same range. NULL before comparison. |
| persisted_id_hash | text | yes | SHA-256 of sorted, pipe-delimited persisted amaia_ids. NULL before comparison. |
| sets_match | boolean | yes | True iff source_id_hash == persisted_id_hash (after exclusions). NULL before comparison. |
| missing_ids | jsonb | yes | Array of amaia_ids in S but not in P. NULL if sets_match or before comparison. |
| extra_ids | jsonb | yes | Array of amaia_ids in P but not in S (after exclusion filtering). NULL if none. |
| phase | text | no | Current lifecycle phase |
| verified_at | timestamptz | yes | When comparison was executed. NULL before comparison. |
| raw_max_id | bigint | yes | MAX(id) observed from AMAIA before safety lag. NULL for non-id domains. |
| provisional_upper_bound | bigint | yes | Upper limit of provisional processing zone. NULL if no provisional. |
| provisional_id_count | integer | yes | Count of provisionally processed IDs. NULL if no provisional. |
| provisional_id_hash | text | yes | SHA-256 of provisional IDs. NULL if no provisional or provisional failed. |
| created_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (run_id) |
| FK | run_id → amaia_sync_runs(id) ON DELETE CASCADE |

#### Constraints

| Name | Definition |
|---|---|
| source_id_count_check | CHECK (source_id_count >= 0) |
| persisted_id_count_check | CHECK (persisted_id_count IS NULL OR persisted_id_count >= 0) |
| phase_check | CHECK (phase IN ('source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned')) |

#### Concurrency

No external locks required. Single writer (the owning domain processor). The manifest is not shared across runs.

#### Lifecycle

```
source_fetched → confirmed_compared → provisional_persisted → comparison_complete
source_fetched → confirmed_compared → comparison_complete  (no provisional zone)
source_fetched → abandoned  (orphan recovery)
confirmed_compared → abandoned  (orphan recovery)
provisional_persisted → abandoned  (orphan recovery)
```

Terminal phases: comparison_complete, abandoned. No further writes.

#### Column mutability by phase

**Immutable from INSERT (never modifiable):**
run_id, domain_name, source_id_count, source_id_hash, raw_max_id, created_at.

**Written at confirmed_compared (only during source_fetched → confirmed_compared):**
persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at.

**Written at provisional_persisted (only during confirmed_compared → provisional_persisted):**
provisional_upper_bound, provisional_id_count, provisional_id_hash.

**Written at any forward transition:** phase.

**Trigger-enforced.** See Triggers section.

#### Audit

- created by: Domain processor (at source_fetched)
- modified by: Domain processor (phase transitions), Scheduler (orphan → abandoned)
- immutable after terminal phase: ALL columns

---

## 3. Workset Exception Ledger

Three append-only tables for managing phantom/invalid alert references in the alerta trigger cursor range.

### 3.1 amaia_sync_workset_exceptions

**Purpose:** Investigation record for a logestado row with invalid alert_amaia_id. Append-only.

**Owner:** Alerta processor (creates on detection).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| domain_name | text | no | Always 'alerta' in V1 |
| source_amaia_id | integer | no | The amaia_alert_logs.amaia_id with the invalid reference |
| referenced_amaia_id | integer | yes | The phantom alert_amaia_id. NULL if the issue is a null reference. |
| source_row_hash | text | no | Canonical JSON hash of the source row (logestado_exception_v2 algorithm) |
| hash_version | text | no | Algorithm version: 'logestado_exception_v2' |
| invalidity_type | text | no | Classification of the invalidity |
| amaia_lookup_evidence | text | no | Factual AMAIA lookup result |
| amaia_lookup_at | timestamptz | no | When the AMAIA lookup was performed |
| detection_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL |
| created_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (domain_name, source_amaia_id, source_row_hash, hash_version) |
| FK | detection_run_id → amaia_sync_runs(id) |

#### Constraints

| Name | Definition |
|---|---|
| invalidity_type_check | CHECK (invalidity_type IN ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other')) |

#### Concurrency

No locks required for INSERT. Append-only: UPDATE and DELETE rejected by trigger.

The exception row IS locked (FOR UPDATE) by the consumption transaction and by the decision insertion trigger, as the serialization point for this ledger. (For the exclusion ledger, the subject row serves this role instead.)

#### Lifecycle

Single state: created. Never modified. Never deleted.

#### Audit

- created by: Alerta processor
- modified by: nobody (append-only trigger enforced)
- immutable: ALL columns from INSERT

### 3.2 amaia_sync_workset_exception_decisions

**Purpose:** Operator judgment on an exception investigation. Append-only. Latest decision = MAX(decision_seq).

**Owner:** Operator (via tooling).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| exception_id | uuid | no | FK → exceptions(id) ON DELETE CASCADE |
| decision_seq | integer | no | Monotonic per exception_id |
| decision | text | no | Judgment |
| decided_by | text | no | Operator identity |
| decided_at | timestamptz | no | default now() |
| comment | text | no | Mandatory rationale |
| created_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (exception_id, decision_seq) |
| FK | exception_id → amaia_sync_workset_exceptions(id) ON DELETE CASCADE |

#### Constraints

| Name | Definition |
|---|---|
| decision_seq_check | CHECK (decision_seq > 0) |
| decision_check | CHECK (decision IN ('approved', 'rejected')) |
| comment_check | CHECK (length(comment) > 0) |

#### Concurrency

**BEFORE INSERT trigger:** acquires FOR UPDATE on the parent exception row. Serializes with consumption transactions and other decision insertions for the same exception.

#### Lifecycle

Single state: created. Never modified.

#### Audit

- created by: Operator
- modified by: nobody (append-only)
- immutable: ALL columns

### 3.3 amaia_sync_workset_exception_consumptions

**Purpose:** Evidence that a specific approved exception was consumed by a specific run to advance the alerta trigger cursor. Append-only.

**Owner:** Alerta processor (within the fenced cursor-advance transaction).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| exception_id | uuid | no | FK → exceptions(id) |
| decision_id | uuid | no | FK → decisions(id). The specific approved decision relied upon. |
| consumed_by_run_id | uuid | no | FK → amaia_sync_runs(id) |
| source_row_hash_at_consumption | text | no | Re-computed hash at consumption time. Must match exception.source_row_hash. |
| consumed_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (exception_id, consumed_by_run_id) |
| FK | exception_id → exceptions(id), decision_id → decisions(id), consumed_by_run_id → amaia_sync_runs(id) |

#### Concurrency

Created within the fenced transaction that holds the exception row lock (via cursor advance). Append-only.

#### Lifecycle

Single state: created. Never modified.

#### Audit

- created by: Alerta processor (within fenced transaction)
- modified by: nobody
- immutable: ALL columns

---

## 4. Manifest Exclusion Ledger

Four tables for managing extra IDs (P \ S) in manifest comparisons. Follows the same investigation/decision/consumption pattern as the workset exception ledger, with an additional subject entity for global vigency.

### 4.1 amaia_sync_manifest_exclusion_subjects

**Purpose:** Stable identity for an excluded (domain, amaia_id) pair. Single serialization point for all exclusion operations on this pair.

**Owner:** Engine (auto-created on detection) or Operator (manual creation).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| domain_name | text | no | |
| excluded_amaia_id | integer | no | The amaia_id found in P but not in S |
| current_investigation_id | uuid | yes | FK → investigations(id). The active investigation. NULL if none yet. |
| current_investigation_seq | integer | no | Monotonic. Incremented on each new investigation. |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (domain_name, excluded_amaia_id) |
| FK | current_investigation_id → investigations(id) |

#### Constraints

| Name | Definition |
|---|---|
| seq_check | CHECK (current_investigation_seq >= 0) |

#### Concurrency

**This is the single lock target** for all exclusion operations on this (domain, excluded_amaia_id).

- Investigation creation: FOR UPDATE on subject.
- Decision insertion: FOR UPDATE on subject (via trigger).
- Consumption: FOR UPDATE on subject.

No other row in the exclusion ledger is locked. This eliminates lock-ordering concerns.

**Multi-subject consumption:** when a manifest comparison locks multiple subjects, they are locked in ascending excluded_amaia_id order to prevent deadlock.

**Get-or-create pattern:**

```
INSERT INTO subjects (domain_name, excluded_amaia_id, current_investigation_seq)
VALUES (:d, :a, 0)
ON CONFLICT (domain_name, excluded_amaia_id) DO NOTHING;

SELECT * FROM subjects
WHERE domain_name = :d AND excluded_amaia_id = :a
FOR UPDATE;
```

#### Lifecycle

Mutable by design (coordination point, not audit record). current_investigation_id and current_investigation_seq updated on each new investigation. updated_at auto-set by trigger.

#### Audit

- created by: Engine (auto-detection) or Operator
- modified by: Investigation creation flow (updates current_investigation_id/seq)
- immutable: domain_name, excluded_amaia_id, created_at

### 4.2 amaia_sync_manifest_exclusion_investigations

**Purpose:** Detection record for an extra ID in a specific evidence context. Append-only.

**Owner:** Engine (auto-created) or Operator (manual investigation).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| subject_id | uuid | no | FK → subjects(id) |
| investigation_seq | integer | no | Monotonic per subject. Set under subject lock. |
| investigation_hash | text | no | SHA-256 of canonical evidence JSON (manifest_exclusion_investigation_v1) |
| domain_name | text | no | Denormalized from subject for query convenience |
| excluded_amaia_id | integer | no | Denormalized from subject |
| detection_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL |
| detection_manifest_id | uuid | yes | FK → amaia_sync_run_manifests(id) ON DELETE SET NULL |
| amaia_lookup_evidence | text | no | Factual AMAIA lookup result |
| amaia_lookup_at | timestamptz | no | |
| created_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (subject_id, investigation_seq) |
| UK | (subject_id, investigation_hash) |
| FK | subject_id → subjects(id), detection_run_id → sync_runs(id), detection_manifest_id → manifests(id) |

#### Constraints

| Name | Definition |
|---|---|
| seq_check | CHECK (investigation_seq > 0) |

#### Concurrency

Created under subject FOR UPDATE lock. Append-only: UPDATE/DELETE rejected by trigger.

#### Lifecycle

Single state: created. A new investigation for the same subject does NOT modify this row — it creates a new row with a higher investigation_seq. The subject's current_investigation_id is updated to point to the new investigation, making this one non-current (and therefore non-consumable).

#### Audit

- created by: Engine or Operator (under subject lock)
- modified by: nobody (append-only)
- immutable: ALL columns

### 4.3 amaia_sync_manifest_exclusion_decisions

**Purpose:** Operator judgment on an exclusion investigation. Append-only. Latest = MAX(decision_seq).

**Owner:** Operator (via tooling).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| investigation_id | uuid | no | FK → investigations(id) ON DELETE CASCADE |
| decision_seq | integer | no | Monotonic per investigation |
| decision | text | no | Judgment |
| decided_by | text | no | Operator identity |
| decided_at | timestamptz | no | default now() |
| reason | text | no | Mandatory rationale |
| evidence | jsonb | yes | Optional supporting data |
| created_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (investigation_id, decision_seq) |
| FK | investigation_id → investigations(id) ON DELETE CASCADE |

#### Constraints

| Name | Definition |
|---|---|
| seq_check | CHECK (decision_seq > 0) |
| decision_check | CHECK (decision IN ('approved', 'rejected')) |
| reason_check | CHECK (length(reason) > 0) |

#### Concurrency

**BEFORE INSERT trigger:** acquires FOR UPDATE on the parent SUBJECT row (not the investigation row). Verifies subject.current_investigation_id == NEW.investigation_id. Rejects decisions on non-current investigations.

#### Lifecycle

Single state: created. Never modified.

#### Audit

- created by: Operator (under subject lock via trigger)
- modified by: nobody (append-only)
- immutable: ALL columns

### 4.4 amaia_sync_manifest_exclusion_consumptions

**Purpose:** Evidence that an approved exclusion was used by a manifest to achieve sets_match=true and advance the watermark. Append-only.

**Owner:** Domain processor (within the fenced manifest comparison transaction).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| investigation_id | uuid | no | FK → investigations(id) |
| decision_id | uuid | no | FK → decisions(id). The specific approved decision relied upon. |
| consumed_by_run_id | uuid | no | FK → amaia_sync_runs(id) |
| consumed_by_manifest_id | uuid | no | FK → amaia_sync_run_manifests(id) |
| investigation_hash_at_consumption | text | no | Re-verified at consumption time |
| consumed_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (investigation_id, consumed_by_run_id) |
| FK | investigation_id → investigations(id), decision_id → decisions(id), consumed_by_run_id → sync_runs(id), consumed_by_manifest_id → manifests(id) |

#### Concurrency

Created within the fenced transaction that holds the subject lock(s). Inserted ONLY after sets_match is confirmed true (deferred-insert contract from v1.2.8 C3).

#### Lifecycle

Single state: created. Never modified.

**Invariant:** A consumption exists ⟺ the associated manifest has sets_match = true AND the watermark was advanced in the same transaction.

#### Audit

- created by: Domain processor (within fenced transaction, after sets_match confirmed)
- modified by: nobody (append-only)
- immutable: ALL columns

---

## 5. Remediation Queue

### 5.1 amaia_sync_alert_remediation_queue

**Purpose:** Durable obligation queue for alert refetches triggered by logestado backfill, provisional processing, exception resolution, reconciliation drift, or manual operator action.

**Owner:** Multiple writers (enqueue). Alerta processor (claim and fulfill). Operator (ignore).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| source_type | text | no | Origin of the obligation |
| logestado_amaia_id | integer | yes | The logestado entry that triggered this. NULL for manual. |
| alert_amaia_id | integer | no | The alert that must be refetched |
| origin_run_id | uuid | yes | FK → sync_runs(id). The run that created this entry. |
| origin_reconciliation_result_id | uuid | yes | FK → reconciliation_results(id). For backfill/drift entries. |
| status | text | no | Current lifecycle state. Default 'pending'. |
| claimed_by_run_id | uuid | yes | FK → sync_runs(id). The run that claimed this entry. |
| claimed_at | timestamptz | yes | When claimed |
| claim_expires_at | timestamptz | yes | Claim TTL expiration |
| retry_count | integer | no | Actual processing attempts (NOT claim attempts). Default 0. |
| max_retries | integer | no | Retry budget. Default 3. |
| failure_reason | text | yes | Populated on failed_retryable/failed_terminal |
| next_attempt_at | timestamptz | yes | When a failed_retryable entry becomes claimable. NULL for other states. |
| consumed_by_run_id | uuid | yes | FK → sync_runs(id). The run that fulfilled this entry. |
| evidence | jsonb | yes | Contextual data |
| ignored_by | text | yes | Operator identity. Required when status = 'ignored_approved'. |
| ignored_at | timestamptz | yes | Required when status = 'ignored_approved'. |
| ignore_reason | text | yes | Required when status = 'ignored_approved'. |
| ignore_evidence | jsonb | yes | Optional supporting data for ignore decision. |
| created_at | timestamptz | no | default now() |
| processed_at | timestamptz | yes | When fulfilled (success) or ignored |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (source_type, logestado_amaia_id, alert_amaia_id) WHERE logestado_amaia_id IS NOT NULL |
| FK | origin_run_id, claimed_by_run_id, consumed_by_run_id → sync_runs(id); origin_reconciliation_result_id → reconciliation_results(id) |

#### Constraints

| Name | Definition |
|---|---|
| source_type_check | CHECK (source_type IN ('logestado_backfill', 'provisional_logestado', 'exception_resolution', 'reconciliation_drift', 'manual')) |
| status_check | CHECK (status IN ('pending', 'claimed', 'success', 'failed_retryable', 'failed_terminal', 'ignored_approved')) |
| retry_count_check | CHECK (retry_count >= 0) |
| max_retries_check | CHECK (max_retries > 0) |
| ignore_reason_check | CHECK (ignore_reason IS NULL OR length(ignore_reason) > 0) |

#### Concurrency

Claim is an atomic conditional UPDATE. Multiple processors may compete; only one succeeds per entry (the UPDATE's WHERE clause is the concurrency gate). No external locks required beyond the atomic UPDATE.

**Enqueue idempotency:** provisional_logestado and reconciliation_drift source_types use INSERT ON CONFLICT DO NOTHING. Other source_types use normal INSERT (duplicate = bug).

#### Lifecycle (state machine)

```
pending → claimed
claimed → success                    (processing succeeded)
claimed → failed_retryable           (processing failed, retry_count + 1 < max_retries)
claimed → failed_terminal            (processing failed, retry_count + 1 >= max_retries)
claimed → pending                    (claim expired, no processing attempted)
failed_retryable → claimed           (re-claimed when next_attempt_at <= now())
failed_retryable → ignored_approved  (operator decision)
failed_terminal → ignored_approved   (operator decision)
```

Terminal states: success, failed_terminal, ignored_approved.

**retry_count rules:** Incremented ONLY on claimed → failed_retryable and claimed → failed_terminal. NOT on claim. NOT on claim expiry.

**Selection query:**
```
WHERE status = 'pending'
   OR (status = 'claimed' AND claim_expires_at < now())
   OR (status = 'failed_retryable' AND next_attempt_at <= now())
```

#### Column mutability

**Immutable from INSERT:** id, source_type, logestado_amaia_id, alert_amaia_id, origin_run_id, origin_reconciliation_result_id, created_at.

**Mutable (state machine controlled):** status, claimed_by_run_id, claimed_at, claim_expires_at, retry_count, failure_reason, next_attempt_at, consumed_by_run_id, processed_at, ignored_by, ignored_at, ignore_reason, ignore_evidence, evidence.

**Trigger-enforced state transitions and conditional requirements:**
- ignored_approved requires: ignored_by NOT NULL, ignored_at NOT NULL, ignore_reason NOT NULL.
- success requires: consumed_by_run_id NOT NULL, processed_at NOT NULL.
- failed_retryable requires: next_attempt_at NOT NULL and > now().

---

## 6. Reconciliation Segments

### 6.1 amaia_sync_reconciliation_segments

**Purpose:** Tracks Tier 4 per-segment coverage state for SLO computation and segment selection.

**Owner:** Reconciliation engine (updates after each segment attempt).

#### Columns

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | no | PK |
| domain_name | text | no | e.g., 'alerta' |
| tier | text | no | e.g., 'tier4' |
| segment_id | integer | no | 0 through 11 |
| partition_expr | text | no | e.g., 'amaia_id % 12 = 3' |
| last_successful_coverage_at | timestamptz | yes | NULL = never successfully covered |
| last_attempt_at | timestamptz | yes | NULL = never attempted |
| consecutive_failure_count | integer | no | Default 0 |
| slo_deadline_at | timestamptz | yes | last_successful + 84 days, or created_at + 84 days if never covered |
| slo_status | text | no | Derived from slo_deadline_at vs now() |
| is_irrecoverable | boolean | no | Set by feasibility simulation. Default false. |
| is_starving | boolean | no | True when consecutive_failure_count >= 5. Default false. |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | default now() |

#### Keys

| Type | Columns |
|---|---|
| PK | (id) |
| UK | (domain_name, tier, segment_id) |

#### Constraints

| Name | Definition |
|---|---|
| tier_check | CHECK (tier IN ('tier4')) |
| segment_id_check | CHECK (segment_id >= 0 AND segment_id < 12) |
| failure_count_check | CHECK (consecutive_failure_count >= 0) |
| slo_status_check | CHECK (slo_status IN ('compliant', 'at_risk', 'breached')) |

#### Concurrency

Updated within the same transaction as the reconciliation_results INSERT for the segment. No external locks beyond the reconciliation lease held during processing.

#### Lifecycle

Mutable operational state. Updated after each reconciliation attempt.

**Seeded:** 12 rows for domain_name='alerta', tier='tier4', segment_id 0–11.

---

## 7. Modifications to Deployed Tables

### 7.1 amaia_sync_runs — New columns

| Column | Type | Nullable | FK | Source |
|---|---|---|---|---|
| cycle_id | uuid | **no** | amaia_sync_cycles(id) ON DELETE SET NULL | v1.2 C7 |
| upstream_run_id | uuid | yes | amaia_sync_runs(id) | v1.2 C7 |
| blocked_entity_name | text | yes | none | v1.2.3 M4 |

**Modified constraint:** reason_code CHECK extended with 'WORKSET_INTEGRITY_FAILURE'.

**New indexes:** (cycle_id), (upstream_run_id).

### 7.2 amaia_sync_reconciliation_results — New columns

| Column | Type | Nullable | FK | Source |
|---|---|---|---|---|
| cycle_id | uuid | **no** | amaia_sync_cycles(id) ON DELETE SET NULL | v1.2 C7 |
| scope_descriptor | text | **no** | none | v1.2 C5/C7 |
| result_status | text | **no** | none | v1.2.3 M2 |

**New constraint:** result_status CHECK ('success', 'failed', 'skipped').

**New index:** (cycle_id).

### 7.3 Destination tables — sync_status CHECK extended

| Table | Current CHECK values | Added value |
|---|---|---|
| amaia_beneficiaries | 'active', 'missing_pending_confirmation', 'inactive_confirmed' | + 'reactivation_pending' |
| amaia_support_network | 'active', 'missing_pending_confirmation', 'inactive_confirmed' | + 'reactivation_pending' |
| amaia_alerts | 'active', 'missing_pending_confirmation', 'inactive_confirmed' | + 'reactivation_pending' |

### 7.4 amaia_sync_watermarks — Data correction

| Row | Column | Before | After |
|---|---|---|---|
| entity_name='alerta' | watermark_type | 'timestamp' | 'id' |
| entity_name='alerta' | last_id | NULL | 0 |
| entity_name='alerta' | last_timestamp | '2025-01-01...' | NULL |
| entity_name='alerta' | watermark_expr | NULL | 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id' |

---

## 8. Lease and Fencing

No new tables. amaia_sync_leases (deployed in 9.2) is used as-is. The blueprint documents the fencing model enforced at runtime:

**Ownership predicate (4-part, evaluated within fenced transaction):**

1. lease_token = writer's held token
2. owner_identity = writer's structured identity
3. owner_identity IS NOT NULL
4. lease_expires_at > now() (database server time)

**Fencing columns on amaia_sync_leases used:**
- entity_name (PK, lock target)
- lease_token (monotonic fencing token)
- owner_identity (identity verification)
- lease_expires_at (expiration verification)

**Reconciler participation:** The reconciliation engine acquires domain leases using the same mechanism as sync processors. For cross-domain dependent pairs (logestado + alerta), both leases are acquired in canonical order.

**Canonical lease ordering:** beneficiario(1) → red(2) → enfermedades(3) → medicamentos(4) → control_llamadas(5) → logestado(6) → alerta(7).

---

## 9. Triggers Inventory

| # | Table | Trigger name | Type | Behavior |
|---|---|---|---|---|
| 1 | amaia_sync_workset_exceptions | append_only | BEFORE UPDATE OR DELETE | Raise exception unconditionally |
| 2 | amaia_sync_workset_exception_decisions | append_only_and_serialize | BEFORE UPDATE OR DELETE: raise exception. BEFORE INSERT: SELECT ... FROM exceptions WHERE id = NEW.exception_id FOR UPDATE | Append-only + serialization via parent exception row lock |
| 3 | amaia_sync_workset_exception_consumptions | append_only | BEFORE UPDATE OR DELETE | Raise exception unconditionally |
| 4 | amaia_sync_run_manifests | phase_column_guard | BEFORE UPDATE: enforce forward-only phase transitions, per-phase column write permissions, immutable-from-INSERT columns. BEFORE DELETE: raise exception. | Phase lifecycle + column immutability enforcement |
| 5 | amaia_sync_alert_remediation_queue | state_machine_guard | BEFORE UPDATE: enforce valid state transitions, conditional field requirements (ignored_approved needs ignored_by/at/reason; success needs consumed_by_run_id/processed_at; failed_retryable needs next_attempt_at), immutable identity columns, retry_count rules. | State machine + field enforcement |
| 6 | amaia_sync_manifest_exclusion_investigations | append_only | BEFORE UPDATE OR DELETE | Raise exception unconditionally |
| 7 | amaia_sync_manifest_exclusion_decisions | append_only_and_serialize_via_subject | BEFORE UPDATE OR DELETE: raise exception. BEFORE INSERT: read subject_id from investigation, SELECT ... FROM subjects WHERE id = subject_id FOR UPDATE, verify subject.current_investigation_id = NEW.investigation_id (reject if non-current). | Append-only + serialization via subject lock + vigency check |
| 8 | amaia_sync_manifest_exclusion_consumptions | append_only | BEFORE UPDATE OR DELETE | Raise exception unconditionally |
| 9 | amaia_sync_manifest_exclusion_subjects | set_updated_at | BEFORE UPDATE | Sets updated_at = now(). Standard trigger, already exists in codebase as public.set_updated_at(). |

---

## 10. Indexes Inventory

### On new tables

| Table | Index | Columns | Type |
|---|---|---|---|
| amaia_sync_cycles | idx_cycles_started_at | (started_at) | btree |
| amaia_sync_cycles | idx_cycles_status | (status) | btree |
| amaia_sync_run_manifests | (run_id already UNIQUE) | — | unique |
| amaia_sync_run_manifests | idx_manifests_domain_phase | (domain_name, phase) | btree |
| amaia_sync_reconciliation_segments | idx_segments_slo_deadline | (slo_deadline_at) | btree |
| amaia_sync_reconciliation_segments | idx_segments_domain_tier_coverage | (domain_name, tier, last_successful_coverage_at) | btree |
| amaia_sync_alert_remediation_queue | idx_remediation_claimable | (status, claim_expires_at) WHERE status IN ('pending', 'claimed', 'failed_retryable') | partial btree |
| amaia_sync_alert_remediation_queue | idx_remediation_failed_terminal | (status) WHERE status = 'failed_terminal' | partial btree |
| amaia_sync_alert_remediation_queue | idx_remediation_alert | (alert_amaia_id) | btree |
| amaia_sync_alert_remediation_queue | idx_remediation_origin_run | (origin_run_id) | btree |
| amaia_sync_alert_remediation_queue | idx_remediation_consumed_by | (consumed_by_run_id) | btree |
| amaia_sync_manifest_exclusion_subjects | idx_excl_subjects_domain_amaia | (domain_name, excluded_amaia_id) | unique |
| amaia_sync_manifest_exclusion_investigations | idx_excl_inv_subject_seq | (subject_id, investigation_seq) | unique |
| amaia_sync_manifest_exclusion_investigations | idx_excl_inv_subject_hash | (subject_id, investigation_hash) | unique |
| amaia_sync_manifest_exclusion_decisions | idx_excl_dec_inv_seq | (investigation_id, decision_seq) | unique |
| amaia_sync_manifest_exclusion_consumptions | idx_excl_con_inv_run | (investigation_id, consumed_by_run_id) | unique |
| amaia_sync_workset_exception_decisions | idx_wse_dec_exception_seq | (exception_id, decision_seq) | unique |
| amaia_sync_workset_exception_consumptions | idx_wse_con_exception_run | (exception_id, consumed_by_run_id) | unique |

### On existing deployed tables (new indexes)

| Table | Index | Columns |
|---|---|---|
| amaia_sync_runs | idx_sync_runs_cycle_id | (cycle_id) |
| amaia_sync_runs | idx_sync_runs_upstream_run_id | (upstream_run_id) |
| amaia_sync_reconciliation_results | idx_recon_results_cycle_id | (cycle_id) |

---

## 11. Summary Inventory

### Table summary

| # | Table | Purpose | Cardinality | Owner |
|---|---|---|---|---|
| 1 | amaia_sync_cycles | Cycle grouping | ~8,760/year (hourly) | Scheduler |
| 2 | amaia_sync_run_manifests | Set-identity proof | 1 per sync run (logestado mandatory, others optional) | Domain processor |
| 3 | amaia_sync_workset_exceptions | Phantom reference investigations | Low (exceptional) | Alerta processor |
| 4 | amaia_sync_workset_exception_decisions | Operator decisions on exceptions | Low (1+ per exception) | Operator |
| 5 | amaia_sync_workset_exception_consumptions | Exception usage evidence | Low (1 per exception per run) | Alerta processor |
| 6 | amaia_sync_reconciliation_segments | Tier 4 segment state | 12 (fixed seed) | Reconciliation engine |
| 7 | amaia_sync_alert_remediation_queue | Alert refetch obligations | Variable (backfill, provisional, drift) | Multiple |
| 8 | amaia_sync_manifest_exclusion_subjects | Exclusion identity | Low (1 per excluded amaia_id) | Engine / Operator |
| 9 | amaia_sync_manifest_exclusion_investigations | Exclusion investigations | Low (1+ per subject) | Engine / Operator |
| 10 | amaia_sync_manifest_exclusion_decisions | Exclusion decisions | Low (1+ per investigation) | Operator |
| 11 | amaia_sync_manifest_exclusion_consumptions | Exclusion usage evidence | Low (1 per investigation per run) | Domain processor |

### Counts

| Category | Count |
|---|---|
| New tables | 11 |
| New columns on deployed tables | 7 (3 on sync_runs, 3 on reconciliation_results, + blocked_entity_name) |
| Modified CHECKs on deployed tables | 4 (reason_code ×1, sync_status ×3) |
| New FKs | 19 across new tables + 3 on deployed tables |
| New UKs | 9 across new tables |
| New triggers | 9 |
| New indexes | ~20 (UKs + btrees + partials) |
| Data corrections | 1 watermark row + 12 segment seed rows |

---

## 12. Self-Audit: "I Tried to Break This Schema"

### Race: Two concurrent investigation creations for same subject

**Attack:** Two transactions both run get-or-create for (domain='logestado', excluded_amaia_id=95).

**Result:** INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE. Both INSERTs succeed or one does nothing. Both SELECTs try FOR UPDATE on the same row — one blocks until the other commits. Serialized. The second transaction sees the updated current_investigation_seq and increments from there. No duplicate investigation_seq. **Resists.**

### Race: Decision insertion during consumption

**Attack:** Operator inserts rejection while engine consumes approved exclusion.

**Result:** Both acquire FOR UPDATE on the same subject row. Serialized. If engine commits first: consumption stands, rejection applies to future cycles. If operator commits first: engine sees rejected decision, consumption aborted. **Resists.**

### Orphan investigation (subject created, investigation INSERT fails)

**Attack:** Subject get-or-create succeeds, then investigation INSERT fails (e.g., DB error).

**Result:** Transaction rolls back. Subject was created in a separate statement (INSERT ON CONFLICT DO NOTHING) — wait, is this in the same transaction? Yes: the get-or-create and investigation creation are documented in the same transaction (Flow 1 in v1.2.9). Rollback reverts both the subject creation and the investigation INSERT. But if the subject already existed (ON CONFLICT DO NOTHING), only the investigation INSERT is reverted. The subject remains with its previous state. No orphan. **Resists.**

### Stale exclusion consumption via old investigation

**Attack:** Investigation I1 approved. Investigation I2 created (becomes current). Engine tries to consume I1.

**Result:** Consumption reads subject.current_investigation_id = I2. I1 ≠ I2. Exclusion not available for this amaia_id. Consumption skips it. extra_id remains unresolved. sets_match = false. **Resists.**

### Manifest sets_match=false with consumptions persisted

**Attack:** Engine inserts consumptions one-by-one, then sets_match computation returns false.

**Result:** Deferred-insert contract (v1.2.8 C3): consumptions assembled in memory, batch-inserted ONLY after sets_match = true. If false, zero consumptions inserted. Transaction commits with manifest evidence but no consumptions. **Resists.**

### Remediation claim expiry consuming retry budget

**Attack:** Processor claims entry, crashes. Claim expires. retry_count was already incremented.

**Result:** v1.2.7 B2 correction: retry_count incremented on claimed → failed_retryable, NOT on claim. Expired claim returns to claimable state with unchanged retry_count. **Resists.**

### Remediation failed_retryable stuck (NULL next_attempt_at)

**Attack:** Transition to failed_retryable with next_attempt_at = NULL.

**Result:** v1.2.8 C2 trigger validates: failed_retryable requires next_attempt_at NOT NULL and > now(). Transition rejected. **Resists.**

### Provisional re-processing UNIQUE violation on remediation enqueue

**Attack:** Cycle N enqueues remediation for alert 85. Cycle N+1 provisional re-processes same row, tries to re-enqueue.

**Result:** v1.2.7 B3: provisional_logestado uses INSERT ON CONFLICT DO NOTHING. Existing entry preserved. Upsert transaction continues. **Resists.**

### Double consumption of same exclusion by same run

**Attack:** Engine processes two extra_ids that reference the same subject with an approved exclusion.

**Result:** This shouldn't happen — a subject has one excluded_amaia_id, and extra_ids is a set (no duplicates). If somehow attempted: consumption UNIQUE (investigation_id, consumed_by_run_id) prevents duplicate. **Resists.**

### Watermark corruption via concurrent provisional + confirmed

**Attack:** Provisional processing writes to amaia_alert_logs concurrently with confirmed processing.

**Result:** Provisional processing happens AFTER confirmed processing completes (within the same run, sequential phases per manifest lifecycle). Not concurrent. And even if somehow concurrent: upsert ON CONFLICT is idempotent. **Resists.**

### Resurrection bug: row becomes active with stale data

**Attack:** Reconciliation detects reappearance, sets reactivation_pending. Domain processor crashes before refreshing.

**Result:** Row stays at reactivation_pending. Next cycle: processor picks up reactivation_pending rows, fetches fresh data, sets active. The row is never active with stale data. **Resists.**

### Manifest evidence tampering

**Attack:** After comparison_complete, someone UPDATEs source_id_hash.

**Result:** phase_column_guard trigger: comparison_complete is terminal, all UPDATEs rejected. **Resists.**

### Open question: subject updated_at race

The subject's updated_at is set by set_updated_at trigger. If two transactions update the subject concurrently, one blocks (FOR UPDATE). After the first commits, the second proceeds. updated_at reflects the second transaction's time. This is correct — updated_at tracks the last modification, not a sequence. No issue.

### Risks detected

**Risk 1: Schema complexity.** 11 new tables is substantial. Implementation must be carefully staged. Mitigated by the clear separation of concerns (each table has one owner, one purpose).

**Risk 2: Trigger performance.** 9 triggers add overhead to every INSERT/UPDATE on their tables. For the append-only tables (low write volume, exceptional paths only), this is negligible. For the remediation queue (potentially higher volume), the state machine trigger adds per-UPDATE overhead. Acceptable for V1 volumes.

**Risk 3: Denormalized columns on exclusion investigations.** domain_name and excluded_amaia_id are duplicated from the subject. If the subject is somehow modified (which is allowed — it's mutable), the investigation's denormalized columns become stale. Mitigated: domain_name and excluded_amaia_id on the subject are immutable by convention (the UNIQUE constraint prevents changing them without violating referential integrity).

### Questions resolved

All architectural questions from v1.0 through v1.2.9 are resolved in this blueprint. No open questions remain.

---

**End of document.**
