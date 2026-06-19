# AMAIA-SYNC DDL Blueprint v1.0

**Phase:** 9.3A  
**Status:** DDL Blueprint — pending Codex audit before migration authoring  
**Source schema:** AMAIA_SYNC_SCHEMA_BLUEPRINT v1.0 through v1.0.4 (approved)  
**Source architecture:** AMAIA_SYNC_RUNTIME_ARCHITECTURE v1.0 through v1.2.9 (approved)  
**Author:** Claude (constructor)  
**Date:** 2026-06-18

---

## Part 1: New Table Definitions

### Table 1: amaia_sync_cycles

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| started_at | timestamptz | NOT NULL | now() | |
| finished_at | timestamptz | NULL | | |
| status | text | NOT NULL | 'running' | |
| trigger_type | text | NOT NULL | | |
| owner_identity | text | NOT NULL | | |
| reconciliation_snapshot | jsonb | NULL | | Tier 4 capacity/SLO evidence |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| amaia_sync_cycles_status_check | CHECK | status IN ('running', 'success', 'completed_with_failures') |
| amaia_sync_cycles_trigger_type_check | CHECK | trigger_type IN ('scheduled', 'manual', 'recovery') |

No FKs. Root table.

---

### Table 2: amaia_sync_run_manifests

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| run_id | uuid | NOT NULL | | One manifest per run |
| domain_name | text | NOT NULL | | |
| source_id_count | integer | NOT NULL | | |
| source_id_hash | text | NOT NULL | | SHA-256 of sorted source amaia_ids |
| persisted_id_count | integer | NULL | | Filled at confirmed_compared |
| persisted_id_hash | text | NULL | | |
| sets_match | boolean | NULL | | |
| missing_ids | jsonb | NULL | | S \ P on mismatch |
| extra_ids | jsonb | NULL | | P \ S on mismatch |
| phase | text | NOT NULL | 'source_fetched' | |
| verified_at | timestamptz | NULL | | |
| raw_max_id | bigint | NULL | | MAX(id) from AMAIA before safety lag |
| provisional_upper_bound | bigint | NULL | | |
| provisional_id_count | integer | NULL | | |
| provisional_id_hash | text | NULL | | |
| created_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK run_id | UNIQUE | (run_id) |
| UK id_run_id | UNIQUE | (id, run_id) — composite FK target for exclusion consumptions |
| FK run_id | FOREIGN KEY | run_id → amaia_sync_runs(id) ON DELETE CASCADE ON UPDATE NO ACTION |
| source_id_count_check | CHECK | source_id_count >= 0 |
| persisted_id_count_check | CHECK | persisted_id_count IS NULL OR persisted_id_count >= 0 |
| phase_check | CHECK | phase IN ('source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned') |

---

### Table 3: amaia_sync_workset_exceptions

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| domain_name | text | NOT NULL | | |
| source_amaia_id | integer | NOT NULL | | amaia_alert_logs.amaia_id |
| referenced_amaia_id | integer | NULL | | Phantom alert_amaia_id. NULL = null reference. |
| source_row_hash | text | NOT NULL | | Canonical JSON hash v2 |
| hash_version | text | NOT NULL | | e.g., 'logestado_exception_v2' |
| invalidity_type | text | NOT NULL | | |
| amaia_lookup_evidence | text | NOT NULL | | |
| amaia_lookup_at | timestamptz | NOT NULL | | |
| detection_run_id | uuid | NULL | | |
| created_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK domain_source_hash_ver | UNIQUE | (domain_name, source_amaia_id, source_row_hash, hash_version) |
| FK detection_run_id | FOREIGN KEY | detection_run_id → amaia_sync_runs(id) ON DELETE SET NULL ON UPDATE NO ACTION |
| invalidity_type_check | CHECK | invalidity_type IN ('null_reference', 'non_positive_reference', 'phantom_not_in_amaia', 'phantom_sync_failed', 'other') |

---

### Table 4: amaia_sync_workset_exception_decisions

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| exception_id | uuid | NOT NULL | | |
| decision_seq | integer | NOT NULL | 0 | Placeholder; trigger #2 overwrites with computed value |
| decision | text | NOT NULL | | |
| decided_by | text | NOT NULL | | |
| decided_at | timestamptz | NOT NULL | now() | |
| comment | text | NOT NULL | | |
| created_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK exception_seq | UNIQUE | (exception_id, decision_seq) |
| UK id_exception | UNIQUE | (id, exception_id) — composite FK target for consumptions |
| FK exception_id | FOREIGN KEY | exception_id → amaia_sync_workset_exceptions(id) ON DELETE CASCADE ON UPDATE NO ACTION |
| decision_seq_check | CHECK | decision_seq > 0 |
| decision_check | CHECK | decision IN ('approved', 'rejected') |
| comment_check | CHECK | length(comment) > 0 |

Note: default 0 for decision_seq will be overwritten by trigger #2 to MAX+1. The CHECK (> 0) catches any INSERT that bypasses the trigger.

---

### Table 5: amaia_sync_workset_exception_consumptions

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| exception_id | uuid | NOT NULL | | |
| decision_id | uuid | NOT NULL | | |
| consumed_by_run_id | uuid | NOT NULL | | |
| source_row_hash_at_consumption | text | NOT NULL | | Re-verified hash |
| consumed_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK exception_run | UNIQUE | (exception_id, consumed_by_run_id) |
| FK exception_id | FOREIGN KEY | exception_id → amaia_sync_workset_exceptions(id) ON DELETE CASCADE ON UPDATE NO ACTION |
| FK decision_exception (composite) | FOREIGN KEY | (decision_id, exception_id) → amaia_sync_workset_exception_decisions(id, exception_id) ON DELETE CASCADE ON UPDATE NO ACTION |
| FK consumed_by_run_id | FOREIGN KEY | consumed_by_run_id → amaia_sync_runs(id) ON DELETE RESTRICT ON UPDATE NO ACTION |

---

### Table 6: amaia_sync_reconciliation_segments

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| domain_name | text | NOT NULL | | |
| tier | text | NOT NULL | | |
| segment_id | integer | NOT NULL | | 0–11 |
| partition_expr | text | NOT NULL | | e.g., 'amaia_id % 12 = 3' |
| last_successful_coverage_at | timestamptz | NULL | | NULL = never covered |
| last_attempt_at | timestamptz | NULL | | |
| consecutive_failure_count | integer | NOT NULL | 0 | |
| slo_deadline_at | timestamptz | NULL | | |
| slo_status | text | NOT NULL | 'compliant' | |
| is_irrecoverable | boolean | NOT NULL | false | |
| is_starving | boolean | NOT NULL | false | |
| created_at | timestamptz | NOT NULL | now() | |
| updated_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK domain_tier_segment | UNIQUE | (domain_name, tier, segment_id) |
| tier_check | CHECK | tier IN ('tier4') |
| segment_id_check | CHECK | segment_id >= 0 AND segment_id < 12 |
| failure_count_check | CHECK | consecutive_failure_count >= 0 |
| slo_status_check | CHECK | slo_status IN ('compliant', 'at_risk', 'breached') |

No FKs. Standalone operational state table.

---

### Table 7: amaia_sync_alert_remediation_queue

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| source_type | text | NOT NULL | | |
| logestado_amaia_id | integer | NULL | | NULL for manual |
| alert_amaia_id | integer | NOT NULL | | |
| origin_run_id | uuid | NULL | | |
| origin_reconciliation_result_id | uuid | NULL | | |
| status | text | NOT NULL | 'pending' | |
| claimed_by_run_id | uuid | NULL | | |
| claimed_at | timestamptz | NULL | | |
| claim_expires_at | timestamptz | NULL | | |
| retry_count | integer | NOT NULL | 0 | Incremented on failure, NOT on claim |
| max_retries | integer | NOT NULL | 3 | |
| failure_reason | text | NULL | | |
| next_attempt_at | timestamptz | NULL | | Backoff for failed_retryable |
| consumed_by_run_id | uuid | NULL | | |
| evidence | jsonb | NULL | | |
| ignored_by | text | NULL | | Required when ignored_approved |
| ignored_at | timestamptz | NULL | | |
| ignore_reason | text | NULL | | |
| ignore_evidence | jsonb | NULL | | |
| created_at | timestamptz | NOT NULL | now() | |
| processed_at | timestamptz | NULL | | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK source_logestado_alert (partial) | UNIQUE | (source_type, logestado_amaia_id, alert_amaia_id) WHERE logestado_amaia_id IS NOT NULL |
| FK origin_run_id | FOREIGN KEY | origin_run_id → amaia_sync_runs(id) ON DELETE SET NULL |
| FK origin_recon_result_id | FOREIGN KEY | origin_reconciliation_result_id → amaia_sync_reconciliation_results(id) ON DELETE SET NULL |
| FK claimed_by_run_id | FOREIGN KEY | claimed_by_run_id → amaia_sync_runs(id) ON DELETE SET NULL |
| FK consumed_by_run_id | FOREIGN KEY | consumed_by_run_id → amaia_sync_runs(id) ON DELETE SET NULL |
| source_type_check | CHECK | source_type IN ('logestado_backfill', 'provisional_logestado', 'exception_resolution', 'reconciliation_drift', 'manual') |
| status_check | CHECK | status IN ('pending', 'claimed', 'success', 'failed_retryable', 'failed_terminal', 'ignored_approved') |
| retry_count_check | CHECK | retry_count >= 0 |
| max_retries_check | CHECK | max_retries > 0 |
| ignore_reason_check | CHECK | ignore_reason IS NULL OR length(ignore_reason) > 0 |

---

### Table 8: amaia_sync_manifest_exclusion_subjects

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| domain_name | text | NOT NULL | | Immutable (trigger enforced) |
| excluded_amaia_id | integer | NOT NULL | | Immutable (trigger enforced) |
| current_investigation_id | uuid | NULL | | FK added via ALTER TABLE (Step 4) |
| current_investigation_seq | integer | NOT NULL | 0 | |
| created_at | timestamptz | NOT NULL | now() | Immutable (trigger enforced) |
| updated_at | timestamptz | NOT NULL | now() | Auto-set by trigger |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK domain_amaia_id | UNIQUE | (domain_name, excluded_amaia_id) |
| seq_check | CHECK | current_investigation_seq >= 0 |

FK for current_investigation_id is a composite FK added in Step 4 (see Constraint Ordering).

---

### Table 9: amaia_sync_manifest_exclusion_investigations

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| subject_id | uuid | NOT NULL | | |
| investigation_seq | integer | NOT NULL | | Assigned under subject lock |
| investigation_hash | text | NOT NULL | | SHA-256 canonical JSON (manifest_exclusion_investigation_v1) |
| domain_name | text | NOT NULL | | Denormalized from subject, validated by trigger #6 |
| excluded_amaia_id | integer | NOT NULL | | Denormalized from subject, validated by trigger #6 |
| detection_run_id | uuid | NULL | | |
| detection_manifest_id | uuid | NULL | | |
| amaia_lookup_evidence | text | NOT NULL | | |
| amaia_lookup_at | timestamptz | NOT NULL | | |
| created_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK subject_seq | UNIQUE | (subject_id, investigation_seq) |
| UK subject_hash | UNIQUE | (subject_id, investigation_hash) |
| UK id_subject | UNIQUE | (id, subject_id) — composite FK targets for subjects and consumptions |
| FK subject_id | FOREIGN KEY | subject_id → amaia_sync_manifest_exclusion_subjects(id) ON DELETE CASCADE ON UPDATE NO ACTION |
| FK detection_run_id | FOREIGN KEY | detection_run_id → amaia_sync_runs(id) ON DELETE SET NULL |
| FK detection_manifest_id | FOREIGN KEY | detection_manifest_id → amaia_sync_run_manifests(id) ON DELETE SET NULL |
| investigation_seq_check | CHECK | investigation_seq > 0 |

---

### Table 10: amaia_sync_manifest_exclusion_decisions

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| investigation_id | uuid | NOT NULL | | |
| decision_seq | integer | NOT NULL | 0 | Placeholder; trigger #7 overwrites |
| decision | text | NOT NULL | | |
| decided_by | text | NOT NULL | | |
| decided_at | timestamptz | NOT NULL | now() | |
| reason | text | NOT NULL | | |
| evidence | jsonb | NULL | | |
| created_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK investigation_seq | UNIQUE | (investigation_id, decision_seq) |
| UK id_investigation | UNIQUE | (id, investigation_id) — composite FK target for consumptions |
| FK investigation_id | FOREIGN KEY | investigation_id → amaia_sync_manifest_exclusion_investigations(id) ON DELETE CASCADE ON UPDATE NO ACTION |
| decision_seq_check | CHECK | decision_seq > 0 |
| decision_check | CHECK | decision IN ('approved', 'rejected') |
| reason_check | CHECK | length(reason) > 0 |

---

### Table 11: amaia_sync_manifest_exclusion_consumptions

| Column | PG Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() | PK |
| investigation_id | uuid | NOT NULL | | |
| decision_id | uuid | NOT NULL | | |
| consumed_by_run_id | uuid | NOT NULL | | |
| consumed_by_manifest_id | uuid | NOT NULL | | |
| investigation_hash_at_consumption | text | NOT NULL | | Re-verified at consumption time |
| consumed_at | timestamptz | NOT NULL | now() | |

| Constraint | Type | Definition |
|---|---|---|
| PK | PRIMARY KEY | (id) |
| UK investigation_run | UNIQUE | (investigation_id, consumed_by_run_id) |
| FK investigation_id | FOREIGN KEY | investigation_id → amaia_sync_manifest_exclusion_investigations(id) ON DELETE CASCADE ON UPDATE NO ACTION |
| FK decision_investigation (composite) | FOREIGN KEY | (decision_id, investigation_id) → amaia_sync_manifest_exclusion_decisions(id, investigation_id) ON DELETE CASCADE ON UPDATE NO ACTION |
| FK consumed_by_run_id | FOREIGN KEY | consumed_by_run_id → amaia_sync_runs(id) ON DELETE RESTRICT ON UPDATE NO ACTION |
| FK manifest_run (composite) | FOREIGN KEY | (consumed_by_manifest_id, consumed_by_run_id) → amaia_sync_run_manifests(id, run_id) ON DELETE RESTRICT ON UPDATE NO ACTION |

---

## Part 2: Deployed Table Modifications

### amaia_sync_runs — ADD COLUMN

| Column | PG Type | Nullable | Default | FK |
|---|---|---|---|---|
| cycle_id | uuid | NOT NULL | | → amaia_sync_cycles(id) ON DELETE RESTRICT |
| upstream_run_id | uuid | NULL | | → amaia_sync_runs(id) ON DELETE SET NULL |
| blocked_entity_name | text | NULL | | none |

### amaia_sync_runs — MODIFY CHECK

Drop `amaia_sync_runs_reason_code_check`. Re-create with added value: 'WORKSET_INTEGRITY_FAILURE' (14 values total).

### amaia_sync_reconciliation_results — ADD COLUMN

| Column | PG Type | Nullable | Default | FK |
|---|---|---|---|---|
| cycle_id | uuid | NOT NULL | | → amaia_sync_cycles(id) ON DELETE RESTRICT |
| scope_descriptor | text | NOT NULL | | none |
| result_status | text | NOT NULL | | none |

### amaia_sync_reconciliation_results — ADD CHECK

result_status_check: CHECK (result_status IN ('success', 'failed', 'skipped'))

### Destination tables — MODIFY CHECK

Drop and re-create sync_status CHECK on each:

| Table | Constraint name | New values |
|---|---|---|
| amaia_beneficiaries | amaia_beneficiaries_sync_status_check | 'active', 'missing_pending_confirmation', 'inactive_confirmed', 'reactivation_pending' |
| amaia_support_network | amaia_support_network_sync_status_check | same 4 values |
| amaia_alerts | amaia_alerts_sync_status_check | same 4 values |

---

## Part 3: Constraint Ordering

Circular reference: subjects ↔ investigations. Resolution requires deferred FK.

### Step 1 — Tables without circular FKs

Create in dependency order:

1. amaia_sync_cycles (no FK)
2. amaia_sync_reconciliation_segments (no FK)
3. amaia_sync_manifest_exclusion_subjects (WITHOUT the composite FK to investigations — added in Step 4)
4. amaia_sync_run_manifests (FK → sync_runs only)
5. amaia_sync_workset_exceptions (FK → sync_runs only)
6. amaia_sync_manifest_exclusion_investigations (FK → subjects, sync_runs, manifests)
7. amaia_sync_workset_exception_decisions (FK → exceptions)
8. amaia_sync_manifest_exclusion_decisions (FK → investigations)
9. amaia_sync_workset_exception_consumptions (composite FK → decisions; FK → exceptions, sync_runs)
10. amaia_sync_manifest_exclusion_consumptions (composite FKs → decisions, manifests; FK → investigations, sync_runs)
11. amaia_sync_alert_remediation_queue (FK → sync_runs, reconciliation_results)

### Step 2 — Simple FKs

All simple FKs are declared inline in Step 1's CREATE TABLE statements.

### Step 3 — Composite UK prerequisites

The following UKs must exist before their composite FKs can reference them. They are declared in Step 1's CREATE TABLE:

- decisions(id, exception_id) on workset exception decisions
- decisions(id, investigation_id) on exclusion decisions
- investigations(id, subject_id) on exclusion investigations
- manifests(id, run_id) on manifests

### Step 4 — Circular composite FK via ALTER TABLE

After both subjects and investigations exist:

ALTER TABLE amaia_sync_manifest_exclusion_subjects ADD CONSTRAINT fk_current_investigation FOREIGN KEY (current_investigation_id, id) REFERENCES amaia_sync_manifest_exclusion_investigations(id, subject_id) ON DELETE RESTRICT ON UPDATE NO ACTION;

This is the sole ALTER TABLE ADD CONSTRAINT operation. All other FKs are inline.

### Step 5 — Triggers

Create 9 trigger functions + attach 9 triggers. Order: any order (triggers reference tables that already exist from Steps 1–4).

### Step 6 — Deployed table modifications

ALTER TABLE amaia_sync_runs ADD COLUMN cycle_id, upstream_run_id, blocked_entity_name. DROP/ADD reason_code CHECK. ADD indexes.

ALTER TABLE amaia_sync_reconciliation_results ADD COLUMN cycle_id, scope_descriptor, result_status. ADD result_status CHECK. ADD index.

ALTER TABLE amaia_beneficiaries/support_network/alerts DROP/ADD sync_status CHECK.

### Step 7 — Seeds and data corrections

INSERT 12 reconciliation_segments rows. UPDATE amaia_sync_watermarks for entity_name='alerta'.

### Step 8 — RLS and policies

Enable RLS on all 11 new tables. Create admin/super_admin SELECT policies (same pattern as deployed sync tables).

---

## Part 4: Trigger Specifications

### Trigger #1 — workset_exceptions: append_only

**Table:** amaia_sync_workset_exceptions  
**Event:** BEFORE UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'amaia_sync_workset_exceptions is append-only: UPDATE not permitted';
END IF;
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'amaia_sync_workset_exceptions is append-only: DELETE not permitted';
END IF;
```

**Locks:** None.  
**Invariant:** Investigation records are immutable once created.

---

### Trigger #2 — workset_exception_decisions: append_only_serialize_assign_seq

**Table:** amaia_sync_workset_exception_decisions  
**Event:** BEFORE INSERT OR UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'append-only: UPDATE not permitted';
END IF;
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'append-only: DELETE not permitted';
END IF;
IF TG_OP = 'INSERT' THEN
  -- Serialize: lock parent exception row
  PERFORM 1 FROM amaia_sync_workset_exceptions
    WHERE id = NEW.exception_id FOR UPDATE;

  -- Compute decision_seq under lock
  SELECT COALESCE(MAX(decision_seq), 0) + 1
    INTO NEW.decision_seq
    FROM amaia_sync_workset_exception_decisions
    WHERE exception_id = NEW.exception_id;

  RETURN NEW;
END IF;
```

**Locks:** FOR UPDATE on parent exception row.  
**Invariant:** Decisions are monotonically sequenced per exception. Serialized with consumptions (which also lock the exception row).

---

### Trigger #3 — workset_exception_consumptions: validate_and_append_only

**Table:** amaia_sync_workset_exception_consumptions  
**Event:** BEFORE INSERT OR UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'append-only: UPDATE not permitted';
END IF;
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'append-only: DELETE not permitted';
END IF;
IF TG_OP = 'INSERT' THEN
  -- Lock parent exception (serializes with decision insertion)
  SELECT source_row_hash INTO v_exception_hash
    FROM amaia_sync_workset_exceptions
    WHERE id = NEW.exception_id FOR UPDATE;

  -- Validate latest decision is the one referenced
  SELECT id, decision INTO v_latest_id, v_latest_decision
    FROM amaia_sync_workset_exception_decisions
    WHERE exception_id = NEW.exception_id
    ORDER BY decision_seq DESC LIMIT 1;

  IF v_latest_id IS DISTINCT FROM NEW.decision_id THEN
    RAISE EXCEPTION 'decision_id is not the latest decision for this exception';
  END IF;

  IF v_latest_decision IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'latest decision is not approved';
  END IF;

  -- Hash freshness
  IF NEW.source_row_hash_at_consumption IS DISTINCT FROM v_exception_hash THEN
    RAISE EXCEPTION 'source_row_hash mismatch at consumption time';
  END IF;

  RETURN NEW;
END IF;
```

**Locks:** FOR UPDATE on parent exception row.  
**Invariant:** Consumption only possible for the latest approved decision with matching hash.

---

### Trigger #4 — run_manifests: phase_column_guard

**Table:** amaia_sync_run_manifests  
**Event:** BEFORE UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'manifests cannot be deleted';
END IF;

IF TG_OP = 'UPDATE' THEN
  -- Terminal phases: no writes
  IF OLD.phase IN ('comparison_complete', 'abandoned') THEN
    RAISE EXCEPTION 'manifest is in terminal phase: no updates permitted';
  END IF;

  -- Immutable-from-INSERT columns (use IS DISTINCT FROM for null safety)
  IF NEW.run_id IS DISTINCT FROM OLD.run_id THEN RAISE EXCEPTION 'run_id is immutable'; END IF;
  IF NEW.domain_name IS DISTINCT FROM OLD.domain_name THEN RAISE EXCEPTION 'domain_name is immutable'; END IF;
  IF NEW.source_id_count IS DISTINCT FROM OLD.source_id_count THEN RAISE EXCEPTION 'source_id_count is immutable'; END IF;
  IF NEW.source_id_hash IS DISTINCT FROM OLD.source_id_hash THEN RAISE EXCEPTION 'source_id_hash is immutable'; END IF;
  IF NEW.raw_max_id IS DISTINCT FROM OLD.raw_max_id THEN RAISE EXCEPTION 'raw_max_id is immutable'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at is immutable'; END IF;

  -- Valid phase transitions
  IF OLD.phase = 'source_fetched' AND NEW.phase NOT IN ('confirmed_compared', 'abandoned') THEN
    RAISE EXCEPTION 'invalid phase transition from source_fetched to %', NEW.phase;
  END IF;
  IF OLD.phase = 'confirmed_compared' AND NEW.phase NOT IN ('provisional_persisted', 'comparison_complete', 'abandoned') THEN
    RAISE EXCEPTION 'invalid phase transition from confirmed_compared to %', NEW.phase;
  END IF;
  IF OLD.phase = 'provisional_persisted' AND NEW.phase NOT IN ('comparison_complete', 'abandoned') THEN
    RAISE EXCEPTION 'invalid phase transition from provisional_persisted to %', NEW.phase;
  END IF;

  -- Per-phase column write gates
  IF NEW.phase = 'confirmed_compared' AND OLD.phase = 'source_fetched' THEN
    -- Phase 2 columns become writable: persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at
    NULL; -- allowed
  ELSIF NEW.phase = 'provisional_persisted' AND OLD.phase = 'confirmed_compared' THEN
    -- Phase 3 columns become writable: provisional_upper_bound, provisional_id_count, provisional_id_hash
    -- Phase 2 columns must not change
    IF NEW.persisted_id_count IS DISTINCT FROM OLD.persisted_id_count THEN RAISE EXCEPTION 'persisted_id_count frozen after confirmed_compared'; END IF;
    IF NEW.persisted_id_hash IS DISTINCT FROM OLD.persisted_id_hash THEN RAISE EXCEPTION 'persisted_id_hash frozen'; END IF;
    IF NEW.sets_match IS DISTINCT FROM OLD.sets_match THEN RAISE EXCEPTION 'sets_match frozen'; END IF;
    IF NEW.missing_ids IS DISTINCT FROM OLD.missing_ids THEN RAISE EXCEPTION 'missing_ids frozen'; END IF;
    IF NEW.extra_ids IS DISTINCT FROM OLD.extra_ids THEN RAISE EXCEPTION 'extra_ids frozen'; END IF;
    IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'verified_at frozen'; END IF;
  ELSIF NEW.phase IN ('comparison_complete', 'abandoned') THEN
    -- Only phase column changes; all others frozen after this
    NULL; -- allowed (transition to terminal)
  ELSE
    RAISE EXCEPTION 'unexpected phase transition state';
  END IF;

  RETURN NEW;
END IF;
```

**Locks:** None (single writer per manifest).  
**Invariant:** Forward-only phases. Source evidence immutable. Per-phase column gating. Terminal phases freeze all.

---

### Trigger #5 — remediation_queue: state_machine_guard

**Table:** amaia_sync_alert_remediation_queue  
**Event:** BEFORE UPDATE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  -- Immutable identity columns
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'id immutable'; END IF;
  IF NEW.source_type IS DISTINCT FROM OLD.source_type THEN RAISE EXCEPTION 'source_type immutable'; END IF;
  IF NEW.logestado_amaia_id IS DISTINCT FROM OLD.logestado_amaia_id THEN RAISE EXCEPTION 'logestado_amaia_id immutable'; END IF;
  IF NEW.alert_amaia_id IS DISTINCT FROM OLD.alert_amaia_id THEN RAISE EXCEPTION 'alert_amaia_id immutable'; END IF;
  IF NEW.origin_run_id IS DISTINCT FROM OLD.origin_run_id THEN RAISE EXCEPTION 'origin_run_id immutable'; END IF;
  IF NEW.origin_reconciliation_result_id IS DISTINCT FROM OLD.origin_reconciliation_result_id THEN RAISE EXCEPTION 'origin_reconciliation_result_id immutable'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at immutable'; END IF;

  -- Valid transitions
  v_valid := false;
  IF OLD.status = 'pending' AND NEW.status = 'claimed' THEN v_valid := true; END IF;
  IF OLD.status = 'claimed' AND NEW.status IN ('success', 'failed_retryable', 'failed_terminal', 'pending') THEN v_valid := true; END IF;
  IF OLD.status = 'failed_retryable' AND NEW.status IN ('claimed', 'ignored_approved') THEN v_valid := true; END IF;
  IF OLD.status = 'failed_terminal' AND NEW.status = 'ignored_approved' THEN v_valid := true; END IF;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid status transition: % → %', OLD.status, NEW.status;
  END IF;

  -- Conditional field requirements
  IF NEW.status = 'success' THEN
    IF NEW.consumed_by_run_id IS NULL THEN RAISE EXCEPTION 'success requires consumed_by_run_id'; END IF;
    IF NEW.processed_at IS NULL THEN RAISE EXCEPTION 'success requires processed_at'; END IF;
  END IF;
  IF NEW.status = 'failed_retryable' THEN
    IF NEW.next_attempt_at IS NULL THEN RAISE EXCEPTION 'failed_retryable requires next_attempt_at'; END IF;
    IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 THEN RAISE EXCEPTION 'failed_retryable must increment retry_count by 1'; END IF;
  END IF;
  IF NEW.status = 'failed_terminal' THEN
    IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 THEN RAISE EXCEPTION 'failed_terminal must increment retry_count by 1'; END IF;
  END IF;
  IF NEW.status = 'ignored_approved' THEN
    IF NEW.ignored_by IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_by'; END IF;
    IF NEW.ignored_at IS NULL THEN RAISE EXCEPTION 'ignored_approved requires ignored_at'; END IF;
    IF NEW.ignore_reason IS NULL OR length(NEW.ignore_reason) = 0 THEN RAISE EXCEPTION 'ignored_approved requires non-empty ignore_reason'; END IF;
  END IF;

  -- retry_count must NOT change on claim transitions
  IF NEW.status = 'claimed' AND NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN
    RAISE EXCEPTION 'retry_count must not change on claim';
  END IF;
  IF OLD.status = 'claimed' AND NEW.status = 'pending' AND NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN
    RAISE EXCEPTION 'retry_count must not change on claim expiry revert';
  END IF;
  IF NEW.status = 'success' AND NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN
    RAISE EXCEPTION 'retry_count must not change on success';
  END IF;

  RETURN NEW;
END IF;
```

**Locks:** None (atomic UPDATE is the concurrency gate).  
**Invariant:** State machine transitions. retry_count incremented only on actual failure. Terminal states require evidence.

---

### Trigger #6 — exclusion_investigations: validate_denorm_and_append_only

**Table:** amaia_sync_manifest_exclusion_investigations  
**Event:** BEFORE INSERT OR UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'append-only: UPDATE not permitted';
END IF;
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'append-only: DELETE not permitted';
END IF;
IF TG_OP = 'INSERT' THEN
  -- Validate denormalized columns against subject
  SELECT domain_name, excluded_amaia_id
    INTO v_domain, v_amaia_id
    FROM amaia_sync_manifest_exclusion_subjects
    WHERE id = NEW.subject_id;

  IF v_domain IS DISTINCT FROM NEW.domain_name THEN
    RAISE EXCEPTION 'investigation.domain_name (%) does not match subject.domain_name (%)', NEW.domain_name, v_domain;
  END IF;
  IF v_amaia_id IS DISTINCT FROM NEW.excluded_amaia_id THEN
    RAISE EXCEPTION 'investigation.excluded_amaia_id (%) does not match subject (%)', NEW.excluded_amaia_id, v_amaia_id;
  END IF;

  RETURN NEW;
END IF;
```

**Locks:** None in trigger. The caller holds the subject FOR UPDATE per v1.2.9 protocol.  
**Invariant:** Denormalized columns match subject. Append-only.

---

### Trigger #7 — exclusion_decisions: append_only_serialize_assign_seq

**Table:** amaia_sync_manifest_exclusion_decisions  
**Event:** BEFORE INSERT OR UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'append-only: UPDATE not permitted';
END IF;
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'append-only: DELETE not permitted';
END IF;
IF TG_OP = 'INSERT' THEN
  -- Read subject_id from investigation
  SELECT subject_id INTO v_subject_id
    FROM amaia_sync_manifest_exclusion_investigations
    WHERE id = NEW.investigation_id;

  -- Lock subject (serializes with consumptions and other decisions)
  SELECT current_investigation_id INTO v_current_inv
    FROM amaia_sync_manifest_exclusion_subjects
    WHERE id = v_subject_id FOR UPDATE;

  -- Vigency check: only current investigation accepts decisions
  IF v_current_inv IS DISTINCT FROM NEW.investigation_id THEN
    RAISE EXCEPTION 'cannot add decision to non-current investigation (current: %, attempted: %)', v_current_inv, NEW.investigation_id;
  END IF;

  -- Compute decision_seq under lock
  SELECT COALESCE(MAX(decision_seq), 0) + 1
    INTO NEW.decision_seq
    FROM amaia_sync_manifest_exclusion_decisions
    WHERE investigation_id = NEW.investigation_id;

  RETURN NEW;
END IF;
```

**Locks:** FOR UPDATE on subject row (serialization point).  
**Invariant:** Decisions only on current investigation. Monotonic seq. Append-only. Serialized.

---

### Trigger #8 — exclusion_consumptions: validate_and_append_only

**Table:** amaia_sync_manifest_exclusion_consumptions  
**Event:** BEFORE INSERT OR UPDATE OR DELETE  
**For each:** ROW

```
IF TG_OP = 'UPDATE' THEN
  RAISE EXCEPTION 'append-only: UPDATE not permitted';
END IF;
IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'append-only: DELETE not permitted';
END IF;
IF TG_OP = 'INSERT' THEN
  -- 1. Read investigation
  SELECT subject_id, investigation_hash
    INTO v_subject_id, v_inv_hash
    FROM amaia_sync_manifest_exclusion_investigations
    WHERE id = NEW.investigation_id;

  -- 2. Lock subject (serializes with decisions and other consumptions)
  SELECT current_investigation_id
    INTO v_current_inv
    FROM amaia_sync_manifest_exclusion_subjects
    WHERE id = v_subject_id FOR UPDATE;

  -- 3. Vigency check
  IF v_current_inv IS DISTINCT FROM NEW.investigation_id THEN
    RAISE EXCEPTION 'investigation is not current for this subject';
  END IF;

  -- 4. Decision parentage: covered by composite FK (decision_id, investigation_id)

  -- 5. Latest decision check
  SELECT id, decision
    INTO v_latest_dec_id, v_latest_decision
    FROM amaia_sync_manifest_exclusion_decisions
    WHERE investigation_id = NEW.investigation_id
    ORDER BY decision_seq DESC LIMIT 1;

  IF v_latest_dec_id IS DISTINCT FROM NEW.decision_id THEN
    RAISE EXCEPTION 'decision_id is not the latest decision for this investigation';
  END IF;

  -- 6. Approval check
  IF v_latest_decision IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'latest decision is not approved';
  END IF;

  -- 7. Hash freshness
  IF NEW.investigation_hash_at_consumption IS DISTINCT FROM v_inv_hash THEN
    RAISE EXCEPTION 'investigation hash mismatch at consumption time';
  END IF;

  -- 8. Manifest-run consistency: covered by composite FK (consumed_by_manifest_id, consumed_by_run_id)

  -- 9. Manifest success check
  SELECT sets_match INTO v_sets_match
    FROM amaia_sync_run_manifests
    WHERE id = NEW.consumed_by_manifest_id;

  IF v_sets_match IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'manifest sets_match is not true';
  END IF;

  RETURN NEW;
END IF;
```

**Locks:** FOR UPDATE on subject row.  
**Invariant:** Consumption only for current investigation, latest approved decision, matching hash, successful manifest. Serialized.

---

### Trigger #9 — exclusion_subjects: subject_progression_guard

**Table:** amaia_sync_manifest_exclusion_subjects  
**Event:** BEFORE INSERT OR UPDATE  
**For each:** ROW

```
IF TG_OP = 'INSERT' THEN
  -- Initial state validation
  IF NEW.current_investigation_id IS NOT NULL THEN
    RAISE EXCEPTION 'subject must be created without current investigation';
  END IF;
  IF NEW.current_investigation_seq IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'subject must be created with investigation_seq = 0';
  END IF;
  RETURN NEW;
END IF;

IF TG_OP = 'UPDATE' THEN
  -- Rule 1: Identity immutability
  IF NEW.domain_name IS DISTINCT FROM OLD.domain_name THEN RAISE EXCEPTION 'domain_name is immutable'; END IF;
  IF NEW.excluded_amaia_id IS DISTINCT FROM OLD.excluded_amaia_id THEN RAISE EXCEPTION 'excluded_amaia_id is immutable'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at is immutable'; END IF;

  -- Rule 2: Cannot clear current_investigation_id once set
  IF OLD.current_investigation_id IS NOT NULL AND NEW.current_investigation_id IS NULL THEN
    RAISE EXCEPTION 'current_investigation_id cannot be cleared once set';
  END IF;

  -- Rule 3: Seq cannot decrease
  IF NEW.current_investigation_seq < OLD.current_investigation_seq THEN
    RAISE EXCEPTION 'current_investigation_seq cannot decrease';
  END IF;

  -- Rule 4: If investigation changes, strict +1 progression
  IF NEW.current_investigation_id IS DISTINCT FROM OLD.current_investigation_id THEN
    IF NEW.current_investigation_seq IS DISTINCT FROM OLD.current_investigation_seq + 1 THEN
      RAISE EXCEPTION 'investigation_seq must increment by exactly 1';
    END IF;
    -- Verify pointed investigation's seq matches
    SELECT investigation_seq INTO v_inv_seq
      FROM amaia_sync_manifest_exclusion_investigations
      WHERE id = NEW.current_investigation_id AND subject_id = NEW.id;
    IF v_inv_seq IS NULL THEN
      RAISE EXCEPTION 'investigation not found for this subject';
    END IF;
    IF v_inv_seq IS DISTINCT FROM NEW.current_investigation_seq THEN
      RAISE EXCEPTION 'investigation.investigation_seq (%) does not match subject seq (%)', v_inv_seq, NEW.current_investigation_seq;
    END IF;
  END IF;

  -- Rule 5: If investigation unchanged, seq unchanged
  IF NOT (NEW.current_investigation_id IS DISTINCT FROM OLD.current_investigation_id) THEN
    IF NEW.current_investigation_seq IS DISTINCT FROM OLD.current_investigation_seq THEN
      RAISE EXCEPTION 'cannot change seq without changing investigation';
    END IF;
  END IF;

  -- Rule 6: Auto-set updated_at
  NEW.updated_at := now();

  RETURN NEW;
END IF;
```

**Locks:** None in trigger. Caller holds FOR UPDATE on this row per v1.2.9 protocol.  
**Invariant:** Birth at (NULL, 0). Strict +1 progression. No regression. No gap. No identity change.

---

## Part 5: Indexes

### On new tables

| # | Table | Index name | Columns | Type | Notes |
|---|---|---|---|---|---|
| 1 | amaia_sync_cycles | idx_cycles_started_at | (started_at) | btree | |
| 2 | amaia_sync_cycles | idx_cycles_status | (status) | btree | |
| 3 | amaia_sync_run_manifests | idx_manifests_domain_phase | (domain_name, phase) | btree | |
| 4 | amaia_sync_reconciliation_segments | idx_segments_slo_deadline | (slo_deadline_at) | btree | |
| 5 | amaia_sync_reconciliation_segments | idx_segments_domain_tier_coverage | (domain_name, tier, last_successful_coverage_at) | btree | |
| 6 | amaia_sync_alert_remediation_queue | idx_remediation_claimable | (status, claim_expires_at) WHERE status IN ('pending','claimed','failed_retryable') | partial | |
| 7 | amaia_sync_alert_remediation_queue | idx_remediation_failed_terminal | (status) WHERE status = 'failed_terminal' | partial | |
| 8 | amaia_sync_alert_remediation_queue | idx_remediation_alert | (alert_amaia_id) | btree | |
| 9 | amaia_sync_alert_remediation_queue | idx_remediation_origin_run | (origin_run_id) | btree | |
| 10 | amaia_sync_alert_remediation_queue | idx_remediation_consumed_by | (consumed_by_run_id) | btree | |

### On deployed tables (new)

| # | Table | Index name | Columns |
|---|---|---|---|
| 11 | amaia_sync_runs | idx_sync_runs_cycle_id | (cycle_id) |
| 12 | amaia_sync_runs | idx_sync_runs_upstream_run_id | (upstream_run_id) |
| 13 | amaia_sync_reconciliation_results | idx_recon_results_cycle_id | (cycle_id) |

Note: UK constraints create implicit unique indexes (15 UKs = 15 implicit indexes, not listed separately).

Total explicit indexes: 13. Total UK-implicit indexes: 15. Grand total: 28.

---

## Part 6: Seeds and Data Corrections

### Seed: reconciliation_segments (12 rows)

| domain_name | tier | segment_id | partition_expr | slo_status | current_investigation_seq |
|---|---|---|---|---|---|
| alerta | tier4 | 0 | amaia_id % 12 = 0 | compliant | — |
| alerta | tier4 | 1 | amaia_id % 12 = 1 | compliant | — |
| ... | ... | ... | ... | ... | — |
| alerta | tier4 | 11 | amaia_id % 12 = 11 | compliant | — |

All other columns at defaults (last_successful_coverage_at = NULL, consecutive_failure_count = 0, is_irrecoverable = false, is_starving = false, slo_deadline_at = created_at + interval '84 days').

### Data correction: amaia_sync_watermarks

UPDATE amaia_sync_watermarks SET watermark_type = 'id', last_id = 0, last_timestamp = NULL, watermark_expr = 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id' WHERE entity_name = 'alerta'.

---

## Part 7: DDL Self-Audit

### Subject lifecycle attacks

| Attack | Blocked by | Step |
|---|---|---|
| INSERT subject with seq=5 | Trigger #9 BEFORE INSERT: seq must be 0 | Rejected |
| INSERT subject with investigation not null | Trigger #9 BEFORE INSERT: must be NULL | Rejected |
| UPDATE subject seq backward (3→1) | Trigger #9 Rule 3: seq cannot decrease | Rejected |
| UPDATE subject to older investigation | Trigger #9 Rule 4: seq must be OLD+1, investigation.seq must match | Rejected |
| UPDATE subject clearing investigation to NULL | Trigger #9 Rule 2: cannot clear once set | Rejected |
| UPDATE subject seq without changing investigation | Trigger #9 Rule 5: seq unchanged if investigation unchanged | Rejected |

### Consumption attacks

| Attack | Blocked by |
|---|---|
| Consumption with decision from wrong exception | Composite FK (decision_id, exception_id) |
| Consumption with decision from wrong investigation | Composite FK (decision_id, investigation_id) |
| Consumption with non-latest decision | Trigger #3/#8: MAX(decision_seq) check |
| Consumption with rejected latest decision | Trigger #3/#8: decision must be 'approved' |
| Consumption with stale hash | Trigger #3/#8: hash match check |
| Consumption with manifest sets_match=false | Trigger #8 step 9: must be true |
| Consumption with mismatched manifest/run | Composite FK (consumed_by_manifest_id, consumed_by_run_id) |
| Consumption for non-current investigation | Trigger #8 step 3: vigency check |

### Manifest attacks

| Attack | Blocked by |
|---|---|
| Backward phase transition | Trigger #4: valid transition check |
| Modify source_id_hash after INSERT | Trigger #4: immutable-from-INSERT |
| Write to terminal phase | Trigger #4: terminal phase block |
| Modify Phase 2 columns during Phase 3 transition | Trigger #4: per-phase column gating |
| DELETE manifest | Trigger #4: DELETE always rejected |

### Remediation attacks

| Attack | Blocked by |
|---|---|
| Invalid transition (pending→success) | Trigger #5: state machine |
| retry_count increment on claim | Trigger #5: retry_count must not change on claim |
| ignored_approved without operator fields | Trigger #5: conditional field check |
| Modify identity columns | Trigger #5: immutable identity columns |

### Transactional ordering

| Scenario | Result |
|---|---|
| Consumption INSERT before manifest.sets_match=true | Trigger #8 reads sets_match=NULL/false → rejects |
| Manifest update (sets_match=true) then consumption INSERT in same tx | Trigger #8 reads own-tx write (PostgreSQL MVCC) → accepts |
| Crash between manifest update and watermark advance | Transaction rolls back: manifest reverts, no consumptions, no watermark |

---

## Part 8: Final Inventory

| Category | Count |
|---|---|
| New tables | 11 |
| New columns on deployed tables | 6 |
| Modified CHECKs on deployed tables | 4 (reason_code ×1, sync_status ×3) |
| UKs (across all new tables) | 15 |
| FKs (across all new tables + deployed mods) | 22 |
| CHECKs (across all new tables) | 17 |
| Triggers | 9 |
| Explicit indexes | 13 |
| UK-implicit indexes | 15 |
| Total indexes | 28 |
| RLS policies | 11 (one per new table) |
| Seed rows | 12 (reconciliation segments) |
| Data corrections | 1 (watermark alerta) |
| Constraint ordering steps | 8 |

### Complete ON DELETE matrix

| Child FK | ON DELETE | Rationale |
|---|---|---|
| sync_runs.cycle_id → cycles | RESTRICT | Audit root |
| sync_runs.upstream_run_id → sync_runs | SET NULL | Nullable |
| recon_results.cycle_id → cycles | RESTRICT | Audit root |
| manifests.run_id → sync_runs | CASCADE | Manifest meaningless without run |
| wse_exceptions.detection_run_id → sync_runs | SET NULL | Nullable |
| wse_decisions.exception_id → wse_exceptions | CASCADE | Decision meaningless without investigation |
| wse_consumptions.exception_id → wse_exceptions | CASCADE | But blocked by trigger #1 on exception DELETE |
| wse_consumptions.(decision_id, exception_id) → wse_decisions | CASCADE | But blocked by trigger #2 on decision DELETE |
| wse_consumptions.consumed_by_run_id → sync_runs | RESTRICT | Audit evidence |
| excl_subjects.(current_investigation_id, id) → excl_investigations | RESTRICT | Cannot delete current investigation |
| excl_investigations.subject_id → excl_subjects | CASCADE | Investigation meaningless without subject |
| excl_investigations.detection_run_id → sync_runs | SET NULL | Nullable |
| excl_investigations.detection_manifest_id → manifests | SET NULL | Nullable |
| excl_decisions.investigation_id → excl_investigations | CASCADE | But blocked by trigger #6 on investigation DELETE |
| excl_consumptions.investigation_id → excl_investigations | CASCADE | But blocked by trigger #6 |
| excl_consumptions.(decision_id, investigation_id) → excl_decisions | CASCADE | But blocked by trigger #7 |
| excl_consumptions.consumed_by_run_id → sync_runs | RESTRICT | Audit evidence |
| excl_consumptions.(consumed_by_manifest_id, consumed_by_run_id) → manifests | RESTRICT | Audit evidence |
| remediation.origin_run_id → sync_runs | SET NULL | Nullable |
| remediation.origin_recon_result_id → recon_results | SET NULL | Nullable |
| remediation.claimed_by_run_id → sync_runs | SET NULL | Nullable |
| remediation.consumed_by_run_id → sync_runs | SET NULL | Nullable |

Note: CASCADE FKs targeting append-only tables are effectively RESTRICT because the DELETE triggers on child tables reject the cascaded deletions.

---

**End of document.**
