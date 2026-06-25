# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.1

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** v1.0 (rejected — forced 0-new-tables constraint broke auditability)  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c, Tag amaia-sync-phase93b-runtime-ddl  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.0 was rejected because it forced "0 new tables" at the cost of auditability. This revision accepts structural DDL impact:

- **1 new table** (amaia_sync_manifest_identity_items) for durable, reconstructible manifest evidence.
- **2 new columns** on amaia_sync_cycles (scheduler lineage).
- **5 new columns** on amaia_sync_run_manifests (identity versioning).
- **1 column made nullable** on amaia_sync_manifest_exclusion_subjects (excluded_amaia_id).
- **1 column made nullable** on amaia_sync_manifest_exclusion_investigations (excluded_amaia_id).
- **1 new column** on each of the above two tables (excluded_canonical_key).
- Trigger updates, constraints, and indexes as enumerated in Section 10.

---

## 1. Fence: Common Serialization for Cycle/Run

### 1.1 Run creation transaction

1. BEGIN.
2. SELECT ... FROM amaia_sync_leases WHERE entity_name = 'scheduler' FOR UPDATE.
3. Validate: token, identity, not null, not expired. If invalid: ROLLBACK.
4. SELECT ... FROM amaia_sync_cycles WHERE id = :cycle_id FOR UPDATE.
5. Validate: status = 'running'. If not: ROLLBACK.
6. INSERT amaia_sync_runs (status = 'running', cycle_id, domain_name, ...).
7. COMMIT.

The scheduler lease lock (Step 2) and cycle row lock (Step 4) are held until COMMIT. No concurrent transaction can close the cycle (which also requires both locks) between Steps 4 and 6. No TOCTOU between "cycle is running" and "run is inserted."

### 1.2 Cycle closure transaction

1. BEGIN.
2. SELECT ... FROM amaia_sync_leases WHERE entity_name = 'scheduler' FOR UPDATE.
3. Validate: token, identity, not null, not expired. If invalid: ROLLBACK.
4. SELECT ... FROM amaia_sync_cycles WHERE id = :cycle_id FOR UPDATE.
5. Validate: status = 'running'. If not: ROLLBACK.
6. Query: SELECT count(*) FROM amaia_sync_runs WHERE cycle_id = :cycle_id AND status = 'running'. If > 0: ROLLBACK (cannot close with live runs).
7. UPDATE amaia_sync_cycles SET status = terminal, finished_at = now() WHERE id = :cycle_id AND status = 'running'.
8. If 0 rows: ROLLBACK (already closed).
9. COMMIT.

Step 4 locks the cycle row. Between Step 6 ("zero running runs") and Step 7 ("close cycle"), the cycle lock prevents any concurrent run creation (which also locks the cycle in Step 4 of 1.1). The race is eliminated.

### 1.3 Why both locks

| Lock | Prevents |
|---|---|
| Scheduler lease FOR UPDATE | Non-owner closing/creating runs. Another scheduler interfering. |
| Cycle row FOR UPDATE | Run creation concurrent with cycle closure. Cycle closure concurrent with run creation. |

Both are required. The scheduler lease proves identity. The cycle lock serializes structural mutations.

---

## 2. Scheduler Lineage on Cycles

### New columns on amaia_sync_cycles

| Column | Type | Nullable | Description |
|---|---|---|---|
| scheduler_owner_identity | text | NOT NULL | The scheduler's owner_identity at cycle creation. Immutable. |
| scheduler_lease_token | bigint | NOT NULL | The scheduler's lease_token at cycle creation. Immutable. |

### Invariants

- Set during cycle creation (Step 6 of 1.1's parent — the INSERT). Never modified after.
- Cycle closure validates: the closer's (owner_identity, lease_token) must match the cycle's (scheduler_owner_identity, scheduler_lease_token). If mismatch: the closer is not the cycle's creator (it's a recovery scheduler). Recovery closure uses a different contract (see Section 3).
- An auditor can trace: cycle → which scheduler instance and lease token created it.

### DDL impact

2 new NOT NULL columns on amaia_sync_cycles. amaia_sync_cycles has 0 rows — safe to add NOT NULL without default.

---

## 3. Loss of Scheduler Ownership

### What the lost-scheduler process MUST NOT do

- Create new sync_runs (run creation requires scheduler lease lock + validation → fails).
- Initiate reconciliation (reconciliation is cycle-scoped, requires valid scheduler).
- Close or modify the cycle.

### What it MAY do

- In-flight domain runs continue under their own domain leases. Domain processors do not check the scheduler lease — they check their own domain lease.

### Orphan cycle closure by recovery scheduler

A new scheduler acquires the scheduler lease and finds 'running' cycles with a different (scheduler_owner_identity, scheduler_lease_token):

1. Lock scheduler lease (already held — just acquired).
2. For each orphan cycle: lock cycle row FOR UPDATE.
3. Check for running runs: SELECT count(*) FROM amaia_sync_runs WHERE cycle_id = :id AND status = 'running'.
4. If > 0: cannot close yet. Domain runs are protected by domain leases. Leave cycle as 'running'. Those runs will be recovered individually via domain lease expiry.
5. If = 0: all runs terminal. Close cycle: status = 'completed_with_failures', finished_at = now(). Conditional WHERE status = 'running'.

The recovery scheduler does NOT need matching (scheduler_owner_identity, scheduler_lease_token) to close an orphan cycle — it is closing someone else's cycle. The proof of authority is holding the scheduler lease (no other scheduler is active).

---

## 4. Manifest Identity Items Table

### Problem

v1.0 stored manifest identity as aggregate hashes only. An auditor could verify equality (hash match) but could not reconstruct the actual sets (which specific IDs or canonical keys). missing_ids and extra_ids as JSONB partially addressed this, but only for the discrepancy, not for the full sets.

For deduplicated domains, the mapping from source_id to canonical_key is essential: an auditor must see "source ID 10 and source ID 11 both mapped to canonical key K" to understand why |source| = 2 but |canonical_set| = 1.

### New table: amaia_sync_manifest_identity_items

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NOT NULL | PK, default gen_random_uuid() |
| manifest_id | uuid | NOT NULL | FK → amaia_sync_run_manifests(id) ON DELETE CASCADE |
| item_role | text | NOT NULL | Which set this item belongs to |
| source_amaia_id | integer | NULL | Source table PK. Always populated for source items. NULL for persisted-only/extra items in dedup domains. |
| identity_basis | text | NOT NULL | 'source_amaia_id' or 'canonical_dedup_key' |
| canonical_key | text | NULL | Serialized canonical dedup key. NULL for source_amaia_id basis. |
| beneficiary_amaia_id | integer | NULL | Decomposed canonical key field. NULL for non-dedup. |
| canonical_hash | text | NULL | Decomposed canonical key field. NULL for non-dedup. |
| canonical_hash_version | text | NULL | Decomposed canonical key field. NULL for non-dedup. |
| created_at | timestamptz | NOT NULL | default now() |

### item_role values

| Value | Meaning |
|---|---|
| 'source' | Item in the source-fetched set (S) |
| 'persisted' | Item in the destination-persisted set (P) |
| 'missing' | Item in S but not in P (S \ P) |
| 'extra' | Item in P but not in S (P \ S) |
| 'excluded' | Item excluded from comparison via approved exclusion |

### CHECK constraints

- item_role CHECK: ('source', 'persisted', 'missing', 'extra', 'excluded').
- identity_basis CHECK: ('source_amaia_id', 'canonical_dedup_key').
- Coherence CHECK: if identity_basis = 'source_amaia_id' THEN source_amaia_id IS NOT NULL AND canonical_key IS NULL. If identity_basis = 'canonical_dedup_key' THEN canonical_key IS NOT NULL.

### Indexes

- (manifest_id, item_role) — primary query path: "show me all source items for this manifest."
- (manifest_id) — FK index.

### RLS

Same pattern as other sync tables: admin/super_admin SELECT.

### Append-only

This table is append-only. INSERT only. No UPDATE, no DELETE. Trigger enforced (same pattern as other ledger tables).

### How it supports reconstruction

**For non-dedup domains:** Each source item has source_amaia_id, item_role = 'source'. Each persisted item has source_amaia_id, item_role = 'persisted'. Missing items: item_role = 'missing'. The full source and persisted sets are reconstructible by querying WHERE manifest_id = :id AND item_role = 'source' (or 'persisted').

**For dedup domains:** Each source item has source_amaia_id (the original AMAIA PK) AND canonical_key + decomposed fields. Multiple source items may share the same canonical_key (collapse). The dedup set is: SELECT DISTINCT canonical_key FROM items WHERE manifest_id = :id AND item_role = 'source'. The persisted set: SELECT DISTINCT canonical_key WHERE item_role = 'persisted'. Missing: WHERE item_role = 'missing'.

**The aggregate hashes on the manifest row (source_id_hash, persisted_id_hash) are still the primary comparison mechanism.** The identity items table is the EVIDENCE — it proves what the hashes were computed from. The hash comparison happens at the aggregate level; the items table enables drill-down and audit.

### Cardinality

For non-dedup domains: |source items| + |persisted items| per manifest. For logestado with safety_lag=100 and a typical page: ~200 items per manifest (100 source + 100 persisted). Over time, this table grows proportionally to the number of manifests × average set size.

For dedup domains: similar scale. Source items include the source_amaia_id → canonical_key mapping, so the count may be slightly higher than the dedup set size.

**Retention:** The items table can be pruned by deleting items for old manifests (manifest_id FK CASCADE). Pruning policy is operational, not architectural.

---

## 5. Canonical Key and Hash — Unified Specification

### 5.1 Official hash definition

The hash stored in amaia_health_conditions.hash and amaia_medications.hash is defined by the 9.2 migration as:

> Deterministic hash of (beneficiary_amaia_id + canonical_text) under hash_version.

This means the hash input includes beneficiary_amaia_id, not just canonical_text. The hash is a function of the PAIR (beneficiary, text), not just the text alone.

### 5.2 Canonical dedup key

The canonical dedup key is the TRIPLE that forms the unique index:

```
(beneficiary_amaia_id, hash, hash_version)
```

Where `hash` is the hash of (beneficiary_amaia_id + canonical_text) under hash_version. This is the identity stored in the destination's unique index and used for ON CONFLICT dedup.

### 5.3 Serialization for manifest comparison

Each canonical dedup key is serialized as a single string for set comparison:

```
{beneficiary_amaia_id}:{hash}:{hash_version}
```

Colon-delimited (not pipe — pipe is used for inter-element delimitation in the set hash). The colon is safe because:
- beneficiary_amaia_id is an integer (no colons).
- hash is a hex string (no colons).
- hash_version is a controlled vocabulary with no colons (e.g., 'canonicalization_v1').

### 5.4 Set hash computation

Given a set of serialized keys:
1. Deduplicate (remove identical strings).
2. Sort lexicographically ascending.
3. Join with pipe delimiter: "key1|key2|key3".
4. SHA-256 of the UTF-8 encoded joined string.

**Empty set:** Hash of the empty string "". SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.

### 5.5 Version identifiers

| Identifier | Meaning |
|---|---|
| identity_basis = 'canonical_dedup_key' | The manifest compares canonical dedup keys, not source IDs. |
| identity_version = 'dedup_key_v1' | Version of the dedup key definition: (beneficiary_amaia_id, hash, hash_version). |
| canonicalization_version = 'canonicalization_v1' | The text canonicalization algorithm (trim, whitespace collapse, case, diacritics). |
| hash_algorithm = 'sha256_colon_delimited_sorted' | Set hash uses colon-within-key, pipe-between-keys, SHA-256. |
| serialization_version = 'canonical_key_colon_v1' | Element serialization: {int}:{hex}:{version}. |

For source_amaia_id domains:

| Identifier | Value |
|---|---|
| identity_basis | 'source_amaia_id' |
| identity_version | 'source_id_v1' |
| canonicalization_version | NULL |
| hash_algorithm | 'sha256_pipe_delimited_sorted' |
| serialization_version | 'integer_decimal_v1' |

---

## 6. Exclusion Subjects — Canonical Key Support

### 6.1 Column changes on amaia_sync_manifest_exclusion_subjects

| Column | Current | New |
|---|---|---|
| excluded_amaia_id | integer NOT NULL | integer **NULL** |
| excluded_canonical_key | (does not exist) | text NULL (NEW) |

### 6.2 CHECK constraint

```
exactly_one_identity: 
  (excluded_amaia_id IS NOT NULL AND excluded_canonical_key IS NULL)
  OR 
  (excluded_amaia_id IS NULL AND excluded_canonical_key IS NOT NULL)
```

### 6.3 Existing UNIQUE (domain_name, excluded_amaia_id)

This UNIQUE remains but now allows NULL excluded_amaia_id. PostgreSQL's unique behavior with NULLs: multiple rows with NULL excluded_amaia_id are allowed by this constraint. The non-null uniqueness is preserved for non-dedup domains.

### 6.4 New partial unique index

(domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL.

This provides uniqueness for dedup domain subjects.

### 6.5 Canonical key grammar

The excluded_canonical_key uses the same serialization as manifest items: `{beneficiary_amaia_id}:{hash}:{hash_version}`. An operator can visually parse it. The engine can split on colons to extract components.

### 6.6 Column changes on amaia_sync_manifest_exclusion_investigations

| Column | Current | New |
|---|---|---|
| excluded_amaia_id | integer NOT NULL | integer **NULL** |
| excluded_canonical_key | (does not exist) | text NULL (NEW) |

Same CHECK-like validation enforced by trigger #6: investigation's identity fields must match subject's.

### 6.7 Trigger updates

**Trigger #9 (subject_progression_guard):**
- INSERT: validate exactly-one-identity CHECK. Add excluded_canonical_key to immutable set.
- UPDATE: excluded_canonical_key immutable (same as excluded_amaia_id).

**Trigger #6 (investigation append_only + denorm validation):**
- INSERT: validate both excluded_amaia_id and excluded_canonical_key match subject.

---

## 7. Manifest Identity Constraints

### 7.1 Coherence rules

The 5 identity columns on amaia_sync_run_manifests must form coherent combinations:

**Rule A (source_amaia_id basis):**
- identity_basis = 'source_amaia_id'
- identity_version = starts with 'source_id_'
- canonicalization_version IS NULL
- serialization_version = starts with 'integer_'

**Rule B (canonical_dedup_key basis):**
- identity_basis = 'canonical_dedup_key'
- identity_version = starts with 'dedup_key_'
- canonicalization_version IS NOT NULL
- serialization_version = starts with 'canonical_key_'

### 7.2 Enforcement

**Via trigger #4 (manifest phase_column_guard):** On INSERT (manifest creation at source_fetched phase), validate coherence rules. The trigger already fires on this path (to set immutable columns). Adding the coherence check is a natural extension.

Not via CHECK constraint — the prefix-matching rules are too complex for CHECK and would require maintaining version string catalogs in the schema. Trigger enforcement is more flexible and consistent with the existing pattern.

### 7.3 Domain → identity_basis mapping

The runtime's domain configuration maps each domain to its identity_basis. This mapping is validated at startup (not at the schema level). If a manifest's identity_basis doesn't match the expected value for its domain_name, it's a runtime bug, not a schema violation. The manifest's self-describing columns allow an auditor to detect and investigate the mismatch.

---

## 8. Empty Incremental with Overlap — Corrected

### 8.1 Contract

When safe_upper_bound <= watermark_before:

1. **Fetch the overlap zone** (watermark_before - overlap, watermark_before] from AMAIA. This may return rows.
2. **Upsert idempotently.** Re-processed rows are overwritten with the same values (no net change, but confirms they're still in sync).
3. **Create manifest.** source set = IDs/keys fetched from overlap zone. persisted set = IDs/keys in destination for the same range.
4. **Compare.** sets_match is computed honestly. If a row disappeared from AMAIA since the last run (retroactive delete): it will be in persisted but not in source → extra_id → sets_match = false. This is a genuine discrepancy, not assumed true.
5. **Do NOT advance watermark.** No monotonic advance possible (safe_upper_bound <= watermark_before).
6. **Do NOT execute CAS.**
7. **Record raw_max_id.** Enables temporal promotion.
8. **Provisional processing:** If raw_max_id > safe_upper_bound, provisional zone exists. Process provisionally. Manifest records provisional evidence. Phase progresses to provisional_persisted before comparison_complete.
9. **Status:** 'success' if sets_match = true. 'failed' if sets_match = false (genuine discrepancy in overlap zone).

### 8.2 Correction from v1.0

v1.0 assumed sets_match = true for overlap-only runs and rows_upserted = 0. Both assumptions are wrong:
- Overlap rows may have changed (late source update within the overlap window).
- A row may have been deleted from AMAIA (retroactive delete → extra in persisted).
- rows_upserted may be > 0 if overlap rows have field-level changes.

The honest contract: compare, don't assume.

---

## 9. Recovery Cardinality

### 9.1 Contract (unchanged from v1.0)

| Count | Meaning | Action |
|---|---|---|
| 0 | No orphan | Normal run |
| 1 | Exactly one orphan | Recover |
| > 1 | Corruption | Hard abort, CRITICAL log |

### 9.2 Can a constraint prevent > 1?

The natural constraint would be: UNIQUE (domain_name, status) WHERE status = 'running'. This would prevent two 'running' runs for the same domain.

**Problem:** During the brief window between run closure (status = 'success') and lease release, if another process races to acquire the lease and create a new run, both runs could be 'running' momentarily if the closure and new creation overlap in different transactions.

**Resolution:** This race is prevented by the domain lease. Only one process holds the domain lease at a time. Run creation requires the lease (via the fenced transaction). Run closure happens within a fenced transaction that also holds the lease. The lease serializes all mutations.

**Decision:** No partial unique index. The domain lease protocol guarantees at most one 'running' run per domain. Adding a partial unique index would be redundant but not harmful. We document the guarantee as protocol-based (lease serialization), not constraint-based.

**Justification:** The fenced transaction for run creation acquires the domain lease (FOR UPDATE) before INSERT. The fenced transaction for run closure acquires the domain lease before UPDATE. These are serialized by the row lock on the domain lease. No two transactions can both hold the domain lease and see the domain as available for a new run.

---

## 10. DDL Impact Summary

### New table

| Table | Purpose | Append-only |
|---|---|---|
| amaia_sync_manifest_identity_items | Durable per-item manifest evidence | Yes (trigger enforced) |

Columns: id (uuid PK), manifest_id (uuid FK NOT NULL), item_role (text NOT NULL), source_amaia_id (integer NULL), identity_basis (text NOT NULL), canonical_key (text NULL), beneficiary_amaia_id (integer NULL), canonical_hash (text NULL), canonical_hash_version (text NULL), created_at (timestamptz NOT NULL).

CHECKs: item_role, identity_basis, coherence (source_amaia_id ↔ identity_basis ↔ canonical_key).

Indexes: (manifest_id, item_role), FK index on manifest_id.

RLS: admin/super_admin SELECT.

Trigger: append_only (BEFORE UPDATE OR DELETE → raise exception).

### New columns on existing tables

| Table | Column | Type | Nullable | Note |
|---|---|---|---|---|
| amaia_sync_cycles | scheduler_owner_identity | text | NOT NULL | 0 rows — safe |
| amaia_sync_cycles | scheduler_lease_token | bigint | NOT NULL | 0 rows — safe |
| amaia_sync_run_manifests | identity_basis | text | NOT NULL | 0 rows — safe |
| amaia_sync_run_manifests | identity_version | text | NOT NULL | 0 rows — safe |
| amaia_sync_run_manifests | canonicalization_version | text | NULL | |
| amaia_sync_run_manifests | hash_algorithm | text | NOT NULL | 0 rows — safe |
| amaia_sync_run_manifests | serialization_version | text | NOT NULL | 0 rows — safe |
| amaia_sync_manifest_exclusion_subjects | excluded_canonical_key | text | NULL | NEW column |
| amaia_sync_manifest_exclusion_investigations | excluded_canonical_key | text | NULL | NEW column |

### Column nullability changes

| Table | Column | Before | After |
|---|---|---|---|
| amaia_sync_manifest_exclusion_subjects | excluded_amaia_id | NOT NULL | **NULL** |
| amaia_sync_manifest_exclusion_investigations | excluded_amaia_id | NOT NULL | **NULL** |

Note: 0 rows in both tables — the change is safe. Existing UNIQUE (domain_name, excluded_amaia_id) continues to work: NULL values are excluded from uniqueness in PostgreSQL.

### New CHECK constraints

| Table | Constraint | Definition |
|---|---|---|
| amaia_sync_run_manifests | identity_basis_check | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| amaia_sync_manifest_exclusion_subjects | exactly_one_identity | (excluded_amaia_id IS NOT NULL AND excluded_canonical_key IS NULL) OR (excluded_amaia_id IS NULL AND excluded_canonical_key IS NOT NULL) |
| amaia_sync_manifest_identity_items | item_role_check | item_role IN ('source', 'persisted', 'missing', 'extra', 'excluded') |
| amaia_sync_manifest_identity_items | identity_basis_check | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| amaia_sync_manifest_identity_items | coherence_check | (identity_basis = 'source_amaia_id' AND source_amaia_id IS NOT NULL AND canonical_key IS NULL) OR (identity_basis = 'canonical_dedup_key' AND canonical_key IS NOT NULL) |

### New indexes

| Table | Index | Columns | Type |
|---|---|---|---|
| amaia_sync_manifest_identity_items | idx_identity_items_manifest_role | (manifest_id, item_role) | btree |
| amaia_sync_manifest_exclusion_subjects | idx_excl_subjects_canonical | (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL | partial unique |

### New FK

| Table | FK | Target |
|---|---|---|
| amaia_sync_manifest_identity_items | manifest_id | amaia_sync_run_manifests(id) ON DELETE CASCADE |

### Trigger changes

| Trigger | Change |
|---|---|
| NEW: identity_items append_only | BEFORE UPDATE OR DELETE → raise exception |
| #4 (manifest phase_column_guard) | Add 5 identity columns to immutable-from-INSERT. Coherence validation on INSERT. |
| #6 (exclusion investigation denorm) | Validate excluded_canonical_key matches subject. Handle NULL excluded_amaia_id. |
| #9 (subject progression_guard) | INSERT: validate exactly-one-identity. UPDATE: excluded_canonical_key immutable. |

### New RLS policies

| Table | Policy |
|---|---|
| amaia_sync_manifest_identity_items | admin/super_admin SELECT (same pattern) |

### Summary

| Category | Count |
|---|---|
| New tables | 1 |
| New columns on existing tables | 9 |
| Nullability changes | 2 |
| New CHECK constraints | 5 |
| New indexes | 2 |
| New FKs | 1 |
| Trigger changes | 4 (1 new + 3 updated) |
| New RLS policies | 1 |

---

## Invariants

All 30 invariants from Implementation Blueprint v1.3 preserved. Added:

31. **Run creation and cycle closure serialize on the same two locks** (scheduler lease + cycle row).
32. **Cycle lineage is durable.** scheduler_owner_identity and scheduler_lease_token on amaia_sync_cycles are immutable from INSERT.
33. **Manifest identity is self-describing and immutable.** The 5 identity columns on manifests enable any auditor to reproduce the comparison without external knowledge.
34. **Manifest identity items are append-only.** The full source, persisted, missing, extra, and excluded sets are durably reconstructible.
35. **Exclusion subject identity is unambiguous.** Exactly one of excluded_amaia_id or excluded_canonical_key is non-null.
36. **Empty incremental compares honestly.** Overlap zone is fetched, compared, and the result (match or mismatch) is recorded. No assumption of sets_match = true.

---

## Self-Audit: Codex Attack Scenarios

### TOCTOU: run created between "zero running runs" check and cycle closure

Attack: Scheduler A checks zero running runs, gets true. Scheduler A proceeds to close. Concurrently, the same scheduler's run-creation path inserts a run.

Result: Both paths lock the cycle row FOR UPDATE. Serialized. If closure locks first and closes: run creation sees status != 'running' → ROLLBACK. If run creation locks first and inserts: closure's count check sees 1 running run → ROLLBACK. **Serialized. Resists.**

### Manifest for dedup domain: auditor cannot determine identity basis

Attack: Auditor examines manifest row for enfermedades. No identity metadata.

Result: identity_basis = 'canonical_dedup_key', identity_version = 'dedup_key_v1', etc. are NOT NULL and immutable. Auditor reads them directly from the row. **Self-describing. Resists.**

### Manifest items: source IDs 10, 11 collapse to 1 canonical key

Attack: source_id_count on manifest says 1 (dedup key count). But there were 2 source rows.

Result: amaia_sync_manifest_identity_items has 2 rows with item_role = 'source', source_amaia_id = 10 and 11, both with the same canonical_key. The auditor sees the full mapping. **Reconstructible. Resists.**

### Exclusion subject with both identity fields

Attack: INSERT subject with excluded_amaia_id = 5 AND excluded_canonical_key = 'key'.

Result: CHECK exactly_one_identity rejects. **Schema-enforced. Resists.**

### Empty incremental assumed match but overlap has discrepancy

Attack: A retroactive AMAIA delete removed a row. Overlap fetch returns 99 rows. Persisted has 100. v1.0 would have assumed true.

Result: v1.1 compares honestly. sets_match = false. extra_id detected. Run fails. **Honest comparison. Resists.**

### Recovery finds 3 running runs for same domain

Attack: Bug left 3 running runs with same credentials.

Result: Count > 1 → CRITICAL, hard abort. **Fail-closed. Resists.**

### Scheduler loses lease, tries to create run

Attack: Scheduler lease expired. Process attempts run creation.

Result: Step 2 of run creation: lock scheduler lease → validate → expired → ROLLBACK. **Fencing prevents. Resists.**

### Recovery scheduler closes cycle with active domain run

Attack: New scheduler acquires scheduler lease. Finds orphan cycle with 1 running run (domain lease still active).

Result: Step 3 of orphan closure: count running runs = 1 → cannot close. Leaves cycle as 'running'. Domain run completes or is recovered later via domain lease. **No premature closure. Resists.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Identity items table growth | Medium | FK CASCADE from manifests. Pruning old manifests deletes associated items. |
| excluded_amaia_id NULL breaks existing queries | Low | 0 rows in exclusion tables. No existing queries to break. |
| Canonical key grammar violation | Low | Controlled by engine, validated by CHECK on items. Serialization is deterministic. |
| Coherence trigger complexity | Low | Trigger #4 already has per-phase validation. Adding coherence check is incremental. |

---

## Criteria for Approval

1. Scheduler fencing eliminates TOCTOU between run creation and cycle closure.
2. Scheduler lineage is durable and immutable.
3. Manifest identity items provide full reconstructibility for all domain types.
4. Canonical key specification is injective, versioned, and auditable.
5. Exclusion subjects support both integer and canonical key identities without ambiguity.
6. Empty incremental compares honestly (no assumed match).
7. Recovery cardinality is fail-closed (> 1 = abort).
8. DDL impact is explicit and justified.
9. No existing invariants are weakened.

---

## Out of Scope

- SQL / DDL / migration authoring.
- Runtime implementation.
- Changes to watermark CAS mechanics.
- Changes to lease acquire/heartbeat/release mechanics.
- Changes to workset exception ledger.
- Changes to remediation queue.
- Changes to reconciliation tier structure.
- Changes to tombstone lifecycle.

---

**End of document.**
