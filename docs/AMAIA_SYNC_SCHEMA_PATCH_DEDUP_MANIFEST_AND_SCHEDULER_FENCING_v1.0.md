# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.0

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_PATCH_SCHEDULER_AND_DEDUP_MANIFEST_v1.0 (rejected)  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c, Tag amaia-sync-phase93b-runtime-ddl  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-19

**Note:** NO SQL, NO migrations, NO runtime code. Architecture + schema blueprint only.

---

## Executive Summary

Codex rejected the previous "no DDL" patch because two problems cannot be solved cleanly within the deployed schema:

1. **Manifest identity** is hardcoded to source amaia_id. Deduplicated domains (enfermedades, medicamentos) require a canonical dedup key as identity. The manifest must durably record WHICH identity basis it used, or an auditor cannot distinguish "source_id manifest" from "dedup_key manifest."

2. **Scheduler fencing** requires a transactional contract where cycle creation and closure are protected by the scheduler lease lock. The contract must be formally specified at the architecture level, not invented in implementation.

This patch accepts DDL impact and declares it explicitly. It proposes minimal schema additions: 5 new columns on 1 existing table, 1 new column on 1 existing table, and 0 new tables.

---

## Motivation

The previous patch attempted to resolve deduplicated manifest identity by reusing existing columns with "different semantics per domain." Codex rejected this because:

- An auditor examining a manifest row cannot determine whether source_id_hash represents amaia_ids or dedup keys without external knowledge of the domain's policy.
- The persisted set for dedup domains cannot be reproduced without knowing the identity_basis, canonicalization_version, and hash_algorithm used.
- The exclusion ledger's subject entity (excluded_amaia_id integer) cannot represent a canonical dedup key.

These are schema-level gaps that require schema-level solutions.

---

## 1. Scheduler Fencing — Transactional Contract

### 1.1 Cycle creation

Within a single transaction:

1. SELECT ... FROM amaia_sync_leases WHERE entity_name = 'scheduler' FOR UPDATE.
2. Validate: lease_token = held token, owner_identity = held identity, owner_identity IS NOT NULL, lease_expires_at > now().
3. If invalid: ROLLBACK. Do not create cycle.
4. INSERT amaia_sync_cycles row.
5. COMMIT.

The scheduler lease lock is held from Step 1 through Step 5. No TOCTOU.

### 1.2 Cycle closure

Within a single transaction:

1. SELECT ... FROM amaia_sync_leases WHERE entity_name = 'scheduler' FOR UPDATE.
2. Validate ownership predicate.
3. If invalid: ROLLBACK. The cycle cannot be closed by a process that lost scheduler ownership.
4. Verify: no sync_runs with status = 'running' exist for this cycle_id. If any exist: ROLLBACK. A cycle cannot close while runs are in-flight.
5. UPDATE amaia_sync_cycles SET status = terminal, finished_at = now() WHERE id = :cycle_id AND status = 'running'.
6. If 0 rows: already closed. ROLLBACK (idempotent).
7. COMMIT.

### 1.3 Loss of scheduler ownership

If the scheduler lease expires or is superseded:

- The process MUST NOT create new cycles.
- The process MUST NOT create new sync_runs (creating a run requires a cycle, which requires a valid scheduler lease).
- The process MUST NOT initiate reconciliation (reconciliation is cycle-scoped).
- The process MUST NOT close or modify cycles.
- In-flight domain runs continue under their OWN domain leases until they complete, fail, or their domain leases also expire.

### 1.4 Orphan cycle closure by new scheduler

A new scheduler acquires the scheduler lease and finds 'running' cycles from a previous scheduler:

1. Hold scheduler lease (proven by acquisition).
2. For each 'running' cycle: check if ANY sync_run within it has status = 'running'.
3. If YES: the cycle cannot be closed yet. Those runs are protected by their domain leases. They will be recovered individually through domain lease acquisition. The new scheduler marks the cycle as needing attention but does NOT force-close it.
4. If NO (all runs terminal or recovered): close the cycle. UPDATE WHERE status = 'running'. Idempotent.

**No new cycle states needed.** The 'running' status with an expired scheduler lease IS the orphan indicator. The new scheduler checks run states within it before closing. No DDL needed for this contract.

### 1.5 DDL impact

**None.** The scheduler fencing contract uses existing amaia_sync_leases rows and amaia_sync_cycles columns. The transactional pattern (lock lease → validate → mutate cycle → commit) requires no schema changes. The cycle closure precondition (no running runs) is a runtime check, not a constraint.

---

## 2. Manifest Identity — Versioned and Self-Describing

### 2.1 Problem

A manifest row must be self-describing: an auditor must determine from the row itself what identity basis was used, how the hash was computed, and how to reproduce the comparison.

### 2.2 New columns on amaia_sync_run_manifests

| Column | Type | Nullable | Description |
|---|---|---|---|
| identity_basis | text | NOT NULL | What the hash represents. Values: 'source_amaia_id', 'canonical_dedup_key'. |
| identity_version | text | NOT NULL | Version of the identity strategy. e.g., 'source_id_v1', 'dedup_key_v1'. |
| canonicalization_version | text | NULL | Canonicalization algorithm version. NULL for source_amaia_id basis. e.g., 'canonicalization_v1' for dedup. |
| hash_algorithm | text | NOT NULL | e.g., 'sha256_pipe_delimited_sorted'. |
| serialization_version | text | NOT NULL | How individual elements are serialized before hashing. e.g., 'integer_decimal_v1', 'canonical_key_pipe_v1'. |

### 2.3 Values per domain type

**Non-deduplicated (beneficiario, red, control_llamadas, logestado, alerta):**

| Column | Value |
|---|---|
| identity_basis | 'source_amaia_id' |
| identity_version | 'source_id_v1' |
| canonicalization_version | NULL |
| hash_algorithm | 'sha256_pipe_delimited_sorted' |
| serialization_version | 'integer_decimal_v1' |

**Deduplicated (enfermedades, medicamentos):**

| Column | Value |
|---|---|
| identity_basis | 'canonical_dedup_key' |
| identity_version | 'dedup_key_v1' |
| canonicalization_version | 'canonicalization_v1' |
| hash_algorithm | 'sha256_pipe_delimited_sorted' |
| serialization_version | 'canonical_key_pipe_v1' |

### 2.4 Immutability

These 5 columns are **immutable from INSERT** — added to the manifest trigger's immutable-from-INSERT allowlist. They are set when the manifest is created (phase = 'source_fetched') and never modified.

### 2.5 CHECK constraint

identity_basis CHECK: ('source_amaia_id', 'canonical_dedup_key').

No CHECK on the version strings — they are extensible without DDL changes.

### 2.6 DDL impact

**5 new columns on amaia_sync_run_manifests.** 1 new CHECK constraint. Manifest trigger #4 logic updated to include these columns in the immutable-from-INSERT set.

---

## 3. Canonical Dedup Key Specification

### 3.1 Key composition

For enfermedades and medicamentos, the canonical dedup key is:

```
beneficiary_amaia_id + normalized_text_hash + hash_version
```

Where:
- beneficiary_amaia_id: integer, the AMAIA beneficiary PK.
- normalized_text_hash: the SHA-256 hash of the canonicalized text (per 9.2 contract — trim, whitespace collapse, case normalize, diacritics). This is the same hash stored in the destination table's `hash` column.
- hash_version: text, the version tag of the canonicalization algorithm (e.g., 'canonicalization_v1').

### 3.2 Serialization for manifest hashing

Each canonical dedup key is serialized as:

```
{beneficiary_amaia_id}|{normalized_text_hash}|{hash_version}
```

Example: `5|a1b2c3d4e5f6...|canonicalization_v1`

The set of serialized keys is sorted lexicographically, deduplicated (set semantics), and pipe-concatenated for the manifest hash.

### 3.3 Inyectivity

The serialization is injective because:
- beneficiary_amaia_id is an integer (no pipe characters).
- normalized_text_hash is a hex string (no pipe characters).
- hash_version is a controlled vocabulary (no pipe characters by convention — enforced by application).
- The three fields are separated by pipe (`|`) and the triple is unique per dedup key.

### 3.4 Persisted set construction

To build the persisted dedup key set for a given range:

1. Query the destination table (amaia_health_conditions or amaia_medications) for rows WHERE the source range is covered. Since dedup domains use source id-based watermarks, the range is defined by the source IDs that contributed to these rows.
2. The destination table does NOT directly store source_id in the dedup key. The persisted set is: SELECT DISTINCT beneficiary_amaia_id, hash, hash_version FROM amaia_health_conditions WHERE beneficiary_amaia_id IN (SELECT DISTINCT beneficiary_amaia_id FROM source rows in range) — or equivalently, all rows that could have been touched by the current run.
3. The comparison range for dedup domains is: all destination rows with beneficiary_amaia_id values present in the source fetch. This ensures the comparison covers the same population.

### 3.5 Associating canonical keys with source range

When multiple source IDs collapse to one canonical key, the manifest's source_id_count reflects the count of DISTINCT canonical keys (not source IDs). The source_id_hash reflects the hash of the canonical key set (not source ID set). The raw_max_id remains the source table MAX(id) — for safety lag purposes.

The association is: source ID → canonicalization → canonical key. Many source IDs may map to one canonical key. The manifest proves that every canonical key derived from the source is present in the destination.

---

## 4. Discrepancy Model for Deduplicated Domains

### 4.1 Missing canonical key

A canonical key exists in the source-derived set but NOT in the destination. This means the upsert failed or the row was not canonicalized correctly. The run fails. The watermark does not advance.

### 4.2 Extra canonical key

A canonical key exists in the destination but NOT in the source-derived set for this range. Possible causes:
- The destination row was created by a previous run for a different beneficiary_amaia_id range.
- The source row was deleted from AMAIA.

Extra canonical keys for dedup domains enter the same exclusion ledger flow as extra amaia_ids for non-dedup domains. However, the exclusion subject identity is different (see Section 5).

### 4.3 Excluded canonical keys

Handled by the exclusion ledger. For dedup domains, the exclusion subject's identity is a canonical key (not an integer amaia_id). See Section 5.

### 4.4 Tombstones

Tombstone detection for dedup domains uses the same lifecycle (detected → confirmed → reverted/ignored) but compares canonical keys instead of amaia_ids during reconciliation.

### 4.5 Convergence

Missing keys converge via retry (same range, re-canonicalize, re-upsert). Extra keys converge via exclusion approval (for watermark) + tombstone lifecycle (for destination cleanup).

---

## 5. Exclusion Subject Generalized

### 5.1 Problem

The deployed exclusion subject table (amaia_sync_manifest_exclusion_subjects) has:
- excluded_amaia_id integer NOT NULL
- UNIQUE (domain_name, excluded_amaia_id)

This cannot represent a canonical dedup key (which is a composite of beneficiary_amaia_id + hash + hash_version — three fields, not one integer).

### 5.2 Solution: Add canonical key columns

Add columns to amaia_sync_manifest_exclusion_subjects:

| Column | Type | Nullable | Description |
|---|---|---|---|
| excluded_canonical_key | text | NULL | Serialized canonical dedup key (e.g., '5\|a1b2c3...\|canonicalization_v1'). NULL for source_amaia_id subjects. |

**Identity rule:**

- For non-dedup domains: excluded_amaia_id IS NOT NULL, excluded_canonical_key IS NULL. UNIQUE (domain_name, excluded_amaia_id) applies (existing).
- For dedup domains: excluded_amaia_id IS NULL, excluded_canonical_key IS NOT NULL.

**New UNIQUE constraint:** (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL. This is a partial unique index (same pattern as the remediation queue).

**CHECK constraint:** Exactly one of excluded_amaia_id or excluded_canonical_key must be non-null:
CHECK ((excluded_amaia_id IS NOT NULL AND excluded_canonical_key IS NULL) OR (excluded_amaia_id IS NULL AND excluded_canonical_key IS NOT NULL)).

### 5.3 Impact on existing UNIQUE

The existing UNIQUE (domain_name, excluded_amaia_id) remains. For dedup domain subjects, excluded_amaia_id is NULL — NULLs are excluded from the unique constraint in PostgreSQL. The new partial unique index on (domain_name, excluded_canonical_key) covers the dedup case.

### 5.4 Impact on trigger #9 (subject_progression_guard)

The trigger's INSERT validation adds: verify the CHECK constraint (exactly one identity field). The trigger's UPDATE validation adds excluded_canonical_key to the immutable-from-INSERT set.

### 5.5 Impact on investigations

The investigation table's denormalized excluded_amaia_id may be NULL for dedup subjects. The trigger #6 validation must also check excluded_canonical_key matches the subject's value.

Add column to amaia_sync_manifest_exclusion_investigations:

| Column | Type | Nullable |
|---|---|---|
| excluded_canonical_key | text | NULL |

Trigger #6 extended: if subject has excluded_canonical_key, investigation must match it.

### 5.6 Human-readable and machine-readable

The excluded_canonical_key is both:
- Machine-readable: the serialized key can be parsed to extract beneficiary_amaia_id, hash, hash_version.
- Human-readable: an operator can see the full key in the exclusion investigation.

### 5.7 DDL impact

- 1 new column on amaia_sync_manifest_exclusion_subjects (excluded_canonical_key text).
- 1 new partial unique index on subjects.
- 1 new CHECK constraint on subjects.
- 1 new column on amaia_sync_manifest_exclusion_investigations (excluded_canonical_key text).
- Trigger #6 and #9 logic updated.

---

## 6. Empty Incremental and Overlap

### 6.1 When safe_upper_bound <= watermark_before

This does NOT mean zero fetch. The overlap zone (watermark_before - overlap, watermark_before] may contain rows that need re-processing (idempotent upsert to catch late-committed source rows).

**Contract:**

1. Fetch the overlap zone from AMAIA. Upsert idempotently. This is a re-read, not new data.
2. Do NOT advance watermark (no monotonic advance possible).
3. Do NOT execute CAS (new value would equal or be less than current — not strictly greater).
4. Record raw_max_id in manifest. This enables temporal promotion.
5. Manifest progresses: source_fetched → confirmed_compared (sets_match = true for overlap-only, since all overlap rows should already be persisted) → comparison_complete.
6. If provisional zone exists (raw_max_id > safe_upper_bound): proceed to provisional_persisted before comparison_complete.
7. Status = 'success', reason_code = 'SUCCESS'. rows_fetched = overlap rows count. rows_upserted = 0 net new.

### 6.2 Manifest phase contract

The phase progression is always respected:

```
source_fetched → confirmed_compared → [provisional_persisted] → comparison_complete
```

No phase can be skipped except provisional_persisted (when no provisional zone exists). comparison_complete is never reached before provisional evidence is recorded (if provisional processing occurred).

---

## 7. Recovery Cardinality

### 7.1 Contract

After acquiring an expired domain lease and capturing previous_owner_identity + previous_lease_token:

Query for orphan runs WHERE domain_name = :domain AND status = 'running' AND owner_identity = :previous_owner_identity AND lease_token = :previous_lease_token.

| Result count | Meaning | Action |
|---|---|---|
| 0 | No orphan matching these credentials | Normal run. No recovery. Log 'expired lease without matching run'. |
| 1 | Exactly one orphan | Recovery: transition to orphan_recovered, create recovery run, abandon manifest. |
| > 1 | Multiple running runs with same credentials | **Corruption.** This should never happen (invariant: one run per lease acquisition). ABORT. Do not recover. Log CRITICAL. Require manual investigation. |

The > 1 case is a hard abort, not a best-effort recovery. The data integrity is questionable and automated recovery could make it worse.

---

## 8. DDL Impact Summary

### New columns on existing tables

| Table | Column | Type | Nullable | Purpose |
|---|---|---|---|---|
| amaia_sync_run_manifests | identity_basis | text | NOT NULL | 'source_amaia_id' or 'canonical_dedup_key' |
| amaia_sync_run_manifests | identity_version | text | NOT NULL | Strategy version |
| amaia_sync_run_manifests | canonicalization_version | text | NULL | Canonicalization algorithm version |
| amaia_sync_run_manifests | hash_algorithm | text | NOT NULL | Hash function identifier |
| amaia_sync_run_manifests | serialization_version | text | NOT NULL | Element serialization version |
| amaia_sync_manifest_exclusion_subjects | excluded_canonical_key | text | NULL | Serialized dedup key for dedup subjects |
| amaia_sync_manifest_exclusion_investigations | excluded_canonical_key | text | NULL | Denormalized from subject |

### New constraints

| Table | Constraint | Type |
|---|---|---|
| amaia_sync_run_manifests | identity_basis_check | CHECK (identity_basis IN ('source_amaia_id', 'canonical_dedup_key')) |
| amaia_sync_manifest_exclusion_subjects | exactly_one_identity_check | CHECK ((excluded_amaia_id IS NOT NULL AND excluded_canonical_key IS NULL) OR (excluded_amaia_id IS NULL AND excluded_canonical_key IS NOT NULL)) |

### New indexes

| Table | Index | Columns | Type |
|---|---|---|---|
| amaia_sync_manifest_exclusion_subjects | idx_excl_subjects_canonical | (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL | Partial unique |

### Modified triggers

| Trigger | Change |
|---|---|
| #4 (manifest phase_column_guard) | Add 5 identity columns to immutable-from-INSERT set |
| #6 (exclusion investigations) | Validate excluded_canonical_key matches subject |
| #9 (subject progression_guard) | Validate exactly-one-identity on INSERT. Add excluded_canonical_key to immutable set on UPDATE. |

### New tables

**None.**

### New RLS policies

**None.** Existing policies on manifests and exclusion tables cover the new columns.

### Total DDL delta

- 7 new columns (5 on manifests, 1 on exclusion subjects, 1 on exclusion investigations)
- 2 new CHECK constraints
- 1 new partial unique index
- 3 trigger logic updates
- 0 new tables
- 0 new RLS policies

---

## Invariants

All existing invariants (1–25 from Implementation Blueprint v1.3) preserved. Added:

26. **Manifest is self-describing.** identity_basis, identity_version, hash_algorithm, serialization_version are immutable-from-INSERT and sufficient to reproduce the comparison.
27. **Exclusion subject identity is unambiguous.** Exactly one of excluded_amaia_id or excluded_canonical_key is non-null per subject.
28. **Cycle closure requires zero running runs.** A cycle cannot transition to terminal status while any sync_run within it has status = 'running'.
29. **Scheduler lease loss does not affect domain runs.** Domain runs are protected by their own domain leases, independent of scheduler lease state.
30. **Recovery cardinality > 1 is corruption.** Hard abort, no automated recovery.

---

## Self-Audit: Codex Attack Scenarios

### Manifest row without identity_basis

Attack: A manifest is created without identity_basis (old code or bug).

Result: identity_basis is NOT NULL. The INSERT fails at the database level. **Schema-enforced. Resists.**

### Manifest for dedup domain with source_amaia_id basis

Attack: Engine creates a manifest for enfermedades with identity_basis = 'source_amaia_id'.

Result: The runtime's domain configuration maps enfermedades to 'canonical_dedup_key'. A mismatch between configuration and manifest is detectable by auditors. However, the database does not enforce this mapping — it's a runtime contract. **Risk: engine misconfiguration. Mitigation: startup validation verifies domain→identity_basis mapping matches configuration.**

### Exclusion subject with both amaia_id and canonical_key

Attack: INSERT with excluded_amaia_id = 5 AND excluded_canonical_key = 'some_key'.

Result: CHECK constraint rejects: exactly one must be non-null. **Schema-enforced. Resists.**

### Exclusion subject with neither

Attack: INSERT with excluded_amaia_id = NULL AND excluded_canonical_key = NULL.

Result: CHECK constraint rejects. **Schema-enforced. Resists.**

### Cycle closed while run is still running

Attack: Scheduler closes cycle with a running run for beneficiario.

Result: Runtime contract (Section 1.2 Step 4): verify no running runs for this cycle_id. If found: ROLLBACK. **Runtime-enforced. Resists.**

### Scheduler lease lost, process tries to create cycle

Attack: Scheduler lease expired. Process attempts cycle creation.

Result: Fenced transaction (Section 1.1): lock scheduler lease → validate ownership → lease_expires_at < now() → ROLLBACK. **Fencing-enforced. Resists.**

### Two source IDs collapse to one dedup key, manifest comparison

Attack: Source IDs 10, 11 → canonical key K. Destination has 1 row with K. Manifest expects 1 key (deduplicated). Persisted has 1 key.

Result: sets_match = true. Watermark advances. **Correct behavior. Resists.**

### Empty incremental with overlap

Attack: safe_upper_bound = 100 = watermark_before. Overlap = 50. Overlap zone (50, 100].

Result: Engine fetches overlap zone. Re-upserts idempotently. Does NOT advance watermark (no monotonic advance). Records raw_max_id. Manifest reaches comparison_complete. Status = 'success'. **Correct. Resists.**

### Recovery finds 2 running runs with same credentials

Attack: Bug or corruption left 2 running runs with identical owner_identity and lease_token.

Result: Query returns > 1 rows. Engine aborts with CRITICAL error. No automated recovery. Manual investigation required. **Fail-closed. Resists.**

---

## Out of Scope

- SQL generation.
- Migration authoring.
- Runtime implementation.
- Changes to watermark CAS mechanics.
- Changes to lease acquire/heartbeat/release mechanics.
- Changes to workset exception ledger structure (exception ≠ exclusion; exceptions use source_amaia_id only, which is always an integer for logestado).
- Changes to remediation queue.
- Changes to reconciliation tier structure.
- Changes to tombstone lifecycle.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 5 new NOT NULL columns on manifests require empty table or default | Low | amaia_sync_run_manifests has 0 rows (no manifests created yet). Safe to add NOT NULL without default. If rows existed: migration must backfill. |
| excluded_canonical_key text length unbounded | Low | The canonical key is ~100 chars (integer + 64-char hash + version string). No practical length issue. |
| Engine misconfiguration: wrong identity_basis for domain | Medium | Startup validation compares domain config against expected identity_basis mapping. Mismatch = abort. |
| Existing exclusion subjects (excluded_amaia_id NOT NULL) need migration for new CHECK | Low | 0 rows exist. New CHECK applies cleanly. If rows existed: all have excluded_amaia_id NOT NULL and excluded_canonical_key NULL (new column defaults to NULL) — CHECK passes. |

---

## Criteria for Approval

This patch is ready for DDL Blueprint authoring when Codex confirms:

1. Scheduler fencing contract is architecturally sound.
2. Manifest identity versioning covers all V1 domains.
3. Canonical dedup key specification is injective and reproducible.
4. Exclusion subject generalization handles both integer and canonical key identities without ambiguity.
5. Empty incremental + overlap contract is consistent with approved watermark mechanics.
6. Recovery cardinality handling is fail-closed.
7. DDL impact is minimal and justified.
8. No new tables required.

---

**End of document.**
