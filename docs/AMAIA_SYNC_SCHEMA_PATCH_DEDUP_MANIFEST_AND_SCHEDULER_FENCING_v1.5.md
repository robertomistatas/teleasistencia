# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.5

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** v1.4  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.4 established the correct comparison algebra (P_check = destination ∩ S_raw for dedup). v1.5 resolves the remaining structural problems: transactional ordering compatible with triggers, a manifest finalizer that prevents incoherent terminal states, episode-based memberships, canonical tombstone support, and exact DDL inventory.

**DDL impact:** 4 new tables, 12 new columns on existing tables, 2 nullability changes, 17 CHECK constraints, 12 indexes, 5 FKs, 7 new triggers (total 20), 1 stored function (finalizer), 4 RLS policies, 14 seed rows.

---

## 1. Transactional Protocol — Corrected Phase Progression

### Problem

v1.4's Transaction A inserts manifest and source items in the same transaction, but Trigger #11 (identity items INSERT) reads the parent manifest to validate identity_basis and phase. If the manifest INSERT and items INSERT are in the same statement batch, the trigger can read the just-inserted manifest row (PostgreSQL read-your-own-writes within a transaction). However, the manifest must be at phase = 'source_fetched' for source items, which requires the manifest to be created FIRST.

### New phase: 'created'

A new initial phase is introduced. The manifest lifecycle becomes:

```
created → source_fetched → confirmed_compared → [provisional_persisted] → comparison_complete
                                                                         ↗
                            any non-terminal → abandoned
```

**Phase 'created':** The manifest row is inserted with minimal fields (run_id, domain_name, identity columns). No hash or count fields populated. This is the phase during which source items will be inserted.

**Transition created → source_fetched:** Performed by the **manifest finalizer** (Section 2). The finalizer computes source_id_count and source_id_hash FROM the already-inserted source items, writes them to the manifest, and advances the phase. This guarantees hash/count coherence with items.

### Revised protocol

**Transaction A: Source capture (within domain fenced transaction)**

1. Lock domain lease FOR UPDATE. Validate ownership.
2. Fetch all pages from AMAIA. Canonicalize. Upsert to destination. Update memberships.
3. **INSERT manifest** with phase = 'created', identity columns, raw_max_id. source_id_count = NULL, source_id_hash = NULL.
4. **INSERT identity_items** with item_role = 'source'. Trigger #11 reads parent manifest: phase = 'created', validates identity_basis match.
5. **Call manifest_finalize_source** (stored function). This function:
   a. Reads all identity_items WHERE manifest_id = :id AND item_role = 'source'.
   b. Computes S_raw (distinct identity elements based on identity_basis).
   c. Computes source_id_count and source_id_hash.
   d. Updates manifest: source_id_count, source_id_hash, phase = 'source_fetched'.
   e. Trigger #4 validates the phase transition created → source_fetched and that source_id_count/hash are now NOT NULL.
6. COMMIT.

**Transaction B: Comparison (within domain fenced transaction, same or subsequent)**

1. Lock domain lease FOR UPDATE. Validate ownership.
2. Query destination for P_check (dedup) or P_raw (non-dedup).
3. **INSERT identity_items** for 'persisted', 'missing', 'extra' (if non-dedup), 'excluded' (if non-dedup with exclusions). Trigger #11 validates: manifest phase = 'source_fetched', item_role matches phase expectations.
4. **Call manifest_finalize_comparison** (stored function). This function:
   a. Reads persisted items, computes persisted_id_count and persisted_id_hash.
   b. Computes sets_match (based on domain type: missing-only for dedup, missing+extra for non-dedup).
   c. Updates manifest: persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at, phase = 'confirmed_compared'.
   d. Trigger #4 validates the transition source_fetched → confirmed_compared and that all comparison fields are NOT NULL.
5. If sets_match = true: advance watermark. Insert exclusion consumptions (if non-dedup with exclusions).
6. If provisional zone exists: process provisionally, insert provisional items, call manifest_finalize_provisional (updates provisional columns, advances to 'provisional_persisted').
7. Advance to comparison_complete.
8. COMMIT.

### Phase-bound item insertion rules (Trigger #11)

| Manifest phase | Allowed item_role values |
|---|---|
| created | source |
| source_fetched | persisted, missing, extra, excluded |
| confirmed_compared | (none — comparison items already inserted) |
| provisional_persisted | (none) |
| comparison_complete | (none — terminal) |
| abandoned | (none — terminal) |

---

## 2. Manifest Finalizer Functions

### manifest_finalize_source

A stored function (not a trigger) called explicitly by the runtime within the fenced transaction.

**Inputs:** manifest_id.

**Behavior:**

1. Read manifest row. Verify phase = 'created'. If not: raise exception.
2. Read all identity_items WHERE manifest_id AND item_role = 'source'.
3. If identity_basis = 'source_amaia_id': collect DISTINCT source_amaia_id values. Count. Hash (sorted, pipe-delimited, SHA-256).
4. If identity_basis = 'canonical_dedup_key': collect DISTINCT canonical_key values. Count. Hash (sorted, colon-within-key, pipe-between, SHA-256).
5. Update manifest: source_id_count = computed count, source_id_hash = computed hash, phase = 'source_fetched'.
6. Return success indicator.

### manifest_finalize_comparison

**Inputs:** manifest_id.

**Behavior:**

1. Read manifest row. Verify phase = 'source_fetched'. If not: raise exception.
2. Read persisted items. Compute persisted_id_count and persisted_id_hash (same algorithm as source, applied to persisted identity elements).
3. Read missing items. Count.
4. If identity_basis = 'source_amaia_id': read extra items, excluded items. Compute sets_match = (missing count = 0 AND extra count = 0).
5. If identity_basis = 'canonical_dedup_key': sets_match = (missing count = 0). No extras computed.
6. Assemble missing_ids / extra_ids JSONB arrays from items.
7. Update manifest: persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at = now(), phase = 'confirmed_compared'.
8. Return sets_match.

### manifest_finalize_provisional

**Inputs:** manifest_id.

**Behavior:**

1. Read manifest. Verify phase = 'confirmed_compared'. If not: raise exception.
2. Write provisional_upper_bound, provisional_id_count, provisional_id_hash.
3. Update phase = 'provisional_persisted'.
4. Return.

### Why stored functions, not triggers

Triggers fire on every row event — they cannot aggregate across multiple items (source items are inserted row by row). The finalizer is called ONCE after all items for a phase are inserted. It aggregates, computes, and atomically advances the phase.

The finalizer runs within the same fenced transaction as the items insertion. Both commit or rollback together. No intermediate state is externally visible.

### DDL impact

1 new stored function schema (3 functions, or 1 function with mode parameter). Declared as a PostgreSQL function in the migration. Not a trigger. Called by runtime explicitly.

---

## 3. Manifest Phase CHECK Updated

The phase CHECK on amaia_sync_run_manifests adds 'created':

```
phase IN ('created', 'source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned')
```

### Updated valid transitions (Trigger #4)

| From | To |
|---|---|
| created | source_fetched (via finalizer) |
| created | abandoned |
| source_fetched | confirmed_compared (via finalizer) |
| source_fetched | abandoned |
| confirmed_compared | provisional_persisted (via finalizer) |
| confirmed_compared | comparison_complete |
| confirmed_compared | abandoned |
| provisional_persisted | comparison_complete |
| provisional_persisted | abandoned |

### created → source_fetched requirements

Trigger #4 on this transition validates:
- source_id_count IS NOT NULL AND source_id_count >= 0.
- source_id_hash IS NOT NULL.

---

## 4. Membership Episodes

### Problem

v1.4's membership model used a single active membership per (domain_name, source_amaia_id) with status transitions. A source row that maps to key K, gets superseded, then re-maps to K again would need to reopen the old record (destroying history) or create a duplicate (violating uniqueness).

### Solution: Episode model

Each membership row is an **episode** — a time-bounded period during which a source row mapped to a specific canonical key.

### Revised table: amaia_sync_dedup_identity_memberships

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NOT NULL | PK |
| domain_name | text | NOT NULL | |
| source_amaia_id | integer | NOT NULL | |
| beneficiary_amaia_id | integer | NOT NULL | |
| canonical_key | text | NOT NULL | |
| canonical_hash | text | NOT NULL | |
| canonical_hash_version | text | NOT NULL | |
| episode_seq | integer | NOT NULL | Monotonic per (domain_name, source_amaia_id). 1, 2, 3... |
| first_seen_run_id | uuid | NOT NULL | FK → sync_runs(id) |
| last_seen_run_id | uuid | NOT NULL | FK → sync_runs(id) |
| active_from_watermark | bigint | NOT NULL | |
| active_until_watermark | bigint | NULL | NULL = currently active |
| status | text | NOT NULL | |
| created_at | timestamptz | NOT NULL | default now() |
| updated_at | timestamptz | NOT NULL | default now() |

### Status values

- active: currently valid mapping.
- closed: superseded by a newer episode (active_until_watermark set).
- source_deleted: source row not found by reconciliation.
- tombstoned: confirmed absent after 2-cycle grace.

### Constraints

- CHECK: status IN ('active', 'closed', 'source_deleted', 'tombstoned').
- CHECK: canonical_key regex.
- CHECK: episode_seq > 0.
- UNIQUE (domain_name, source_amaia_id, episode_seq). One episode number per source row per domain. Monotonic.
- UNIQUE (domain_name, source_amaia_id) WHERE status = 'active'. At most one active episode per source row.

### Episode lifecycle

**New source row:** episode_seq = 1, status = 'active'.

**Confirmed on subsequent run (same canonical_key):** UPDATE last_seen_run_id. No new episode.

**Canonical key changed (re-canonicalization):** Close current episode (status = 'closed', active_until_watermark = current run's lower_bound). Create new episode (episode_seq = old + 1, new canonical_key, status = 'active').

**Reappearing with same canonical_key after source_deleted:** Create new episode (episode_seq = old + 1, same canonical_key, status = 'active'). The old episode remains as history.

**Reappearing with different canonical_key:** Same as re-canonicalization.

### No history overwriting

Each episode is a separate row. Closing an episode sets active_until_watermark and status but does not delete or modify the created_at, first_seen_run_id, or canonical_key. The full history of a source row's canonical key evolution is preserved.

---

## 5. Membership Trigger (#14)

**Table:** amaia_sync_dedup_identity_memberships  
**Event:** BEFORE INSERT OR UPDATE OR DELETE  
**For each:** ROW

**On DELETE:** Raise exception (memberships are audit history — never deleted).

**On INSERT:**
1. Validate domain_name is a dedup domain (read domain_identity_policies, verify required_identity_basis = 'canonical_dedup_key').
2. Validate canonical_key regex.
3. Validate decomposed fields: beneficiary_amaia_id, canonical_hash, canonical_hash_version recompose to canonical_key.
4. Validate episode_seq > 0.
5. Validate status IN valid set.
6. If status = 'active': verify no other active episode exists for (domain_name, source_amaia_id). The partial unique index also enforces this, but the trigger provides a clearer error message.

**On UPDATE:**
1. Immutable columns: id, domain_name, source_amaia_id, beneficiary_amaia_id, canonical_key, canonical_hash, canonical_hash_version, episode_seq, first_seen_run_id, active_from_watermark, created_at. All rejected if changed.
2. Mutable columns: last_seen_run_id, active_until_watermark, status, updated_at.
3. Status transitions: active → closed, active → source_deleted, source_deleted → tombstoned. No other transitions. No reverse.
4. If transitioning to 'closed' or 'source_deleted': active_until_watermark must change from NULL to NOT NULL.
5. Set updated_at = now().

---

## 6. Tombstone and Reconciliation — Canonical Support

### Problem

The deployed amaia_sync_tombstone_events table has source_amaia_id (integer NOT NULL) as the identity. For dedup domains, the tombstone identity is a canonical_key, not a source_amaia_id.

### Solution: Extend tombstone_events

**New columns on amaia_sync_tombstone_events:**

| Column | Type | Nullable |
|---|---|---|
| canonical_key | text | NULL |

**Modified column:** source_amaia_id: change from NOT NULL to **NULL** (for dedup domain tombstones, source_amaia_id is not the identity — canonical_key is).

**New CHECK:** exactly_one_tombstone_identity:
(source_amaia_id IS NOT NULL AND canonical_key IS NULL) OR (source_amaia_id IS NULL AND canonical_key IS NOT NULL)

**Canonical_key regex CHECK** (same pattern as everywhere else).

### Reconciliation evidence

**New columns on amaia_sync_reconciliation_results:**

| Column | Type | Nullable |
|---|---|---|
| identity_basis | text | NULL |

When the reconciliation engine produces results for a dedup domain, it records identity_basis = 'canonical_dedup_key'. For non-dedup: 'source_amaia_id'. NULL for legacy rows (backward compat — table may have existing rows from Tier 1/2 reconciliation of non-dedup domains that predates this patch. However, the table currently has 0 rows, so NOT NULL would also be safe. Decision: NOT NULL, same as manifest identity columns.)

**Correction:** identity_basis on reconciliation_results is NOT NULL. 0 rows exist. Safe.

### Reconciliation dedup comparison

Under domain fence (domain lease held):

1. Read all active membership DISTINCT canonical_key values for this domain. This is the "expected" set E_recon.
2. Read all DISTINCT (beneficiary_amaia_id, hash, hash_version) — i.e., canonical_key — from the destination table for this domain. This is the "actual" set A_recon.
3. missing_recon = E_recon \ A_recon (expected but not present).
4. extra_recon = A_recon \ E_recon (present but not expected).
5. Record in reconciliation_results with identity_basis = 'canonical_dedup_key'.
6. Extras enter exclusion/tombstone lifecycle via canonical_key subjects.

### Snapshot consistency

The domain lease is held during reconciliation (established in Runtime Architecture v1.2.9). No incremental sync can run concurrently for the same domain (lease mutual exclusion). Therefore, E_recon and A_recon are read from a stable state — no concurrent writes.

---

## 7. Supersession with Shared Canonical Key

### Problem

Source IDs 10 and 11 both map to canonical_key K. Source ID 10's episode is closed (superseded). Source ID 11's episode is still active. K should NOT be tombstoned — it's still backed by source ID 11.

### Rule

A canonical_key is considered "expected" by reconciliation if ANY active membership maps to it. The reconciliation set E_recon is:

```
DISTINCT canonical_key FROM memberships WHERE domain_name = :domain AND status = 'active'
```

If source ID 10's episode for K is closed but source ID 11's episode for K is active: K is in E_recon. It's expected. Not a tombstone candidate.

K becomes a tombstone candidate only when ALL memberships mapping to K are closed, source_deleted, or tombstoned.

---

## 8. Manifest Scope Limitation

### What the dedup incremental manifest verifies

The manifest verifies **identity presence**: every canonical key derived from the current source fetch exists in the destination table. It does NOT verify:

- **Payload correctness:** The destination row's field values (condition_original, source_id, synced_at, etc.) may be stale from a prior upsert. The manifest only checks that a row with the matching canonical_key (beneficiary_amaia_id, hash, hash_version) exists.
- **Completeness of destination:** Keys from prior runs that should still be in the destination are NOT verified by the incremental manifest (that's reconciliation's job).

### Why this is acceptable

The upsert (ON CONFLICT on the dedup index) writes the latest values. If the canonical key exists, the upsert either updated it or found it already current. The manifest confirms the upsert succeeded (the key is present). Payload verification beyond the key identity is deferred to reconciliation's field-level comparison.

If payload verification is needed at incremental time: a future enhancement could add a payload_hash column to the destination table and include it in the manifest comparison. This is out of scope for V1.

---

## 9. Domain Policy Application Scope

The domain_identity_policies table governs identity validation across ALL schema components:

| Component | Validated by | Policy fields checked |
|---|---|---|
| Manifest INSERT | Trigger #13 | All 5 (identity_basis, identity_version, canonicalization_version, hash_algorithm, serialization_version) |
| Identity items INSERT | Trigger #11 | identity_basis (must match manifest, which was validated against policy) |
| Exclusion subject INSERT | Trigger #9 | required_identity_basis → determines excluded_amaia_id vs excluded_canonical_key |
| Exclusion investigation INSERT | Trigger #6 | Inherits from subject |
| Membership INSERT | Trigger #14 | required_identity_basis must be 'canonical_dedup_key' (memberships only for dedup domains) |
| Tombstone event INSERT | Runtime validation | domain_name determines whether source_amaia_id or canonical_key is used |
| Reconciliation results INSERT | Runtime validation | identity_basis recorded for audit |

---

## 10. DDL Impact — Exact Inventory

### New tables: 4

| # | Table | Purpose | Mutable | Append-only |
|---|---|---|---|---|
| 1 | amaia_sync_manifest_identity_items | Per-item manifest evidence | No | Yes |
| 2 | amaia_sync_domain_identity_policies | Domain identity config | No | Yes (immutable seed) |
| 3 | amaia_sync_dedup_identity_memberships | Source→canonical mapping with episodes | Yes | No |
| 4 | (Stored function: manifest finalizer) | Finalize source/comparison/provisional | N/A | N/A |

Note: The stored function is not a table, but it is a DDL object (CREATE FUNCTION).

### New columns on existing tables: 12

| # | Table | Column | Type | Nullable |
|---|---|---|---|---|
| 1 | amaia_sync_cycles | scheduler_owner_identity | text | NOT NULL |
| 2 | amaia_sync_cycles | scheduler_lease_token | bigint | NOT NULL |
| 3 | amaia_sync_run_manifests | identity_basis | text | NOT NULL |
| 4 | amaia_sync_run_manifests | identity_version | text | NOT NULL |
| 5 | amaia_sync_run_manifests | canonicalization_version | text | NULL |
| 6 | amaia_sync_run_manifests | hash_algorithm | text | NOT NULL |
| 7 | amaia_sync_run_manifests | serialization_version | text | NOT NULL |
| 8 | amaia_sync_manifest_exclusion_subjects | excluded_canonical_key | text | NULL |
| 9 | amaia_sync_manifest_exclusion_investigations | excluded_canonical_key | text | NULL |
| 10 | amaia_sync_tombstone_events | canonical_key | text | NULL |
| 11 | amaia_sync_reconciliation_results | identity_basis | text | NOT NULL |
| 12 | (none — count is 11 actual columns + tombstone change below) | | | |

Correction: 11 new columns. The 12th entry is a nullability change, not a new column.

### Nullability changes: 3

| # | Table | Column | Before | After |
|---|---|---|---|---|
| 1 | amaia_sync_manifest_exclusion_subjects | excluded_amaia_id | NOT NULL | NULL |
| 2 | amaia_sync_manifest_exclusion_investigations | excluded_amaia_id | NOT NULL | NULL |
| 3 | amaia_sync_tombstone_events | source_amaia_id | NOT NULL | NULL |

### CHECK constraints: 17

| # | Table | Constraint |
|---|---|---|
| 1 | manifests | phase IN (..., 'created', ...) — updated |
| 2 | manifests | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 3 | identity_items | item_role IN ('source', 'persisted', 'missing', 'extra', 'excluded') |
| 4 | identity_items | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 5 | identity_items | coherence (basis ↔ fields) |
| 6 | identity_items | canonical_key regex |
| 7 | domain_identity_policies | required_identity_basis IN (...) |
| 8 | domain_identity_policies | coherence (basis ↔ canonicalization_version) |
| 9 | memberships | status IN ('active', 'closed', 'source_deleted', 'tombstoned') |
| 10 | memberships | canonical_key regex |
| 11 | memberships | episode_seq > 0 |
| 12 | exclusion_subjects | exactly_one_identity |
| 13 | tombstone_events | exactly_one_tombstone_identity |
| 14 | tombstone_events | canonical_key regex (when not null) |
| 15 | reconciliation_results | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 16 | exclusion_subjects | canonical_key regex (when not null) |
| 17 | exclusion_investigations | canonical_key regex (when not null) |

### Indexes: 12

| # | Table | Index | Type |
|---|---|---|---|
| 1 | identity_items | (manifest_id, item_role) | btree |
| 2 | identity_items | (manifest_id, source_amaia_id) WHERE source_amaia_id IS NOT NULL AND item_role='source' | partial unique |
| 3 | identity_items | (manifest_id, item_role, canonical_key) WHERE canonical_key IS NOT NULL AND item_role IN ('persisted','missing','extra','excluded') | partial unique |
| 4 | memberships | (domain_name, source_amaia_id) WHERE status='active' | partial unique |
| 5 | memberships | (domain_name, source_amaia_id, episode_seq) | unique |
| 6 | memberships | (domain_name, canonical_key, status) | btree |
| 7 | memberships | (last_seen_run_id) | btree |
| 8 | exclusion_subjects | (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL | partial unique |
| 9 | runs | (domain_name) WHERE status='running' | partial unique |
| 10 | tombstone_events | (domain_name, canonical_key) WHERE canonical_key IS NOT NULL | btree |
| 11 | reconciliation_results | (identity_basis) | btree |
| 12 | identity_items | (manifest_id) | btree (FK index) |

### FKs: 5

| # | Table | FK | Target | On Delete |
|---|---|---|---|---|
| 1 | identity_items | manifest_id | manifests(id) | RESTRICT |
| 2 | memberships | first_seen_run_id | sync_runs(id) | RESTRICT |
| 3 | memberships | last_seen_run_id | sync_runs(id) | RESTRICT |
| 4 | (identity_items has no FK to memberships — they are independent evidence stores) | | | |
| 5 | (tombstone canonical_key has no FK — it's a text value, not a UUID reference) | | | |

Correction: 3 FKs (identity_items + 2 membership FKs). The others listed are "no FK" confirmations.

### Triggers: 20 total (7 new, 4 updated, 9 existing)

**New triggers:**

| # | Table | Trigger | Event |
|---|---|---|---|
| 10 | cycles | lineage_guard | BEFORE UPDATE OR DELETE |
| 11 | identity_items | append_only_coherence | BEFORE INSERT OR UPDATE OR DELETE |
| 12 | domain_identity_policies | immutable_guard | BEFORE UPDATE OR DELETE |
| 13 | manifests | insert_guard | BEFORE INSERT |
| 14 | memberships | membership_guard | BEFORE INSERT OR UPDATE OR DELETE |
| 15 | tombstone_events | exactly_one_identity_guard | BEFORE INSERT (extend existing append-only or separate) |
| 16 | reconciliation_results | identity_basis_guard | BEFORE INSERT (validate identity_basis matches domain policy) |

Note: Triggers 15 and 16 may be implemented as extensions of existing triggers rather than new trigger functions. If the deployed tombstone_events already has a trigger, #15 extends it. If not, it's new. For counting purposes: 7 new trigger functions.

**Updated triggers:**

| # | Table | Change |
|---|---|---|
| #4 | manifests | phase_column_guard: add 'created' phase, 5 identity columns immutable, created→source_fetched transition |
| #6 | exclusion_investigations | canonical_key + exactly-one validation |
| #9 | exclusion_subjects | canonical_key + exactly-one + domain policy validation |
| #4 | manifests | (already counted — same trigger, phase update) |

Correction: 3 updated triggers (#4, #6, #9).

### Stored functions: 1 (with 3 modes)

manifest_finalize(manifest_id, mode) where mode IN ('source', 'comparison', 'provisional').

Or 3 separate functions: manifest_finalize_source, manifest_finalize_comparison, manifest_finalize_provisional.

### RLS policies: 4 new

| Table | Policy |
|---|---|
| identity_items | admin/super_admin SELECT |
| domain_identity_policies | admin/super_admin SELECT |
| memberships | admin/super_admin SELECT |
| (tombstone_events already has RLS) | |

Correction: 3 new RLS policies.

### Seed data: 14 rows

- domain_identity_policies: 7 rows.
- 9.3C (separate migration): 2 watermark seeds + 1 scheduler lease seed + 4 lease rows if domain leases need seeds for enfermedades/medicamentos/scheduler.

Correction: 7 policy seeds in this patch. 9.3C seeds are separate.

### Corrected summary

| Category | Count |
|---|---|
| New tables | 3 (identity_items, domain_identity_policies, memberships) |
| Stored functions | 1 (3 modes or 3 functions) |
| New columns on existing tables | 11 |
| Nullability changes | 3 |
| CHECK constraints | 17 |
| Indexes (including partial unique) | 12 |
| FKs | 3 |
| New triggers | 7 |
| Updated triggers | 3 |
| Total triggers post-patch | 19 (deployed 9 + new 7 + updated 3 counted as same) |
| New RLS policies | 3 |
| Seed rows | 7 (policies) |

---

## Invariants

All v1.4 invariants (1-56) preserved. Added:

57. **Manifest starts at 'created', not 'source_fetched'.** Source items are inserted before the source phase is finalized.
58. **Hashes and counts are computed by the finalizer from identity items.** The runtime does not write hashes directly — the finalizer reads items and computes them.
59. **Membership episodes are append-only for history.** Each episode is a separate row. Closing an episode never modifies its canonical_key, first_seen_run_id, or active_from_watermark.
60. **Tombstone identity is domain-type-aware.** source_amaia_id for non-dedup, canonical_key for dedup. Exactly one is non-null.
61. **Reconciliation dedup uses DISTINCT active canonical_key from memberships.** A canonical_key backed by ANY active membership is expected. Only keys with ZERO active memberships are tombstone candidates.
62. **Manifest scope is identity presence, not payload.** The incremental manifest verifies the canonical key exists in the destination, not that the payload is current.

---

## Self-Audit

### Trigger #11 reads manifest that doesn't exist yet

Attack: Items inserted before manifest.

Result: Manifest is inserted FIRST (phase='created') in Step 3 of Transaction A. Items are inserted in Step 4. Trigger #11 reads the manifest (exists, phase='created') → validates identity_basis. **Order correct. Resists.**

### Finalizer called on wrong phase

Attack: Runtime calls manifest_finalize_comparison while manifest is at 'created'.

Result: Finalizer reads manifest.phase. Expected 'source_fetched'. Found 'created'. Raises exception. **Phase guard. Resists.**

### Manifest at confirmed_compared with wrong hash

Attack: Runtime inserts items, then directly UPDATEs manifest with wrong hash (bypassing finalizer).

Result: The finalizer is the only code path that transitions created→source_fetched and source_fetched→confirmed_compared. If the runtime UPDATEs directly: Trigger #4 validates the transition. But the trigger cannot verify hash correctness (it doesn't recompute). However: the finalizer is a stored function executed within the same transaction. The runtime CANNOT skip the finalizer and still advance the phase — because the phase transition happens INSIDE the finalizer. A direct UPDATE that sets phase='confirmed_compared' without calling the finalizer would need to also set all the hash/count fields. Trigger #4 validates they are NOT NULL. If the runtime writes wrong values: they are committed, but the QA self-check (hash recomputation from items) detects the inconsistency. **Partial: trigger prevents NULL fields, finalizer prevents skipping, QA detects wrong values.**

### Two active memberships for same source_amaia_id

Attack: Bug creates two active episodes for source ID 10.

Result: Partial unique index UNIQUE(domain_name, source_amaia_id) WHERE status='active' rejects the second INSERT. **Database-enforced. Resists.**

### Superseded key still expected by reconciliation

Attack: Source ID 10 maps to K1 (episode 1, closed). Source ID 11 maps to K1 (episode 1, active). Reconciliation checks if K1 is expected.

Result: E_recon = DISTINCT canonical_key WHERE status='active'. K1 is in the set (from source ID 11's active episode). K1 is expected. Not a tombstone candidate. **Correct. Resists.**

### Tombstone for dedup domain with source_amaia_id

Attack: Tombstone event created for dedup domain with source_amaia_id=5 and canonical_key=NULL.

Result: CHECK exactly_one_tombstone_identity requires (source_amaia_id NOT NULL AND canonical_key NULL) OR (source_amaia_id NULL AND canonical_key NOT NULL). For dedup domain: runtime should use canonical_key. If it uses source_amaia_id: the CHECK doesn't prevent it (both branches are valid). **Gap: the CHECK is type-agnostic. Trigger #15 should validate domain policy: dedup domain → canonical_key required. Trigger added.** Resists with trigger.

### Empty incremental with 'created' phase

Attack: Run finds safe_upper_bound <= watermark_before. No source rows to fetch. Manifest created at 'created'. Finalizer called with 0 items.

Result: Finalizer computes source_id_count = 0, source_id_hash = hash(""). Advances to source_fetched. Comparison: P_check = destination keys IN S_raw = empty set → persisted_id_count = 0, sets_match = true. Watermark not advanced (no monotonic progress). **Correct handling. Resists.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Finalizer computed hash inconsistent with manual QA recomputation | Low | Both use the same algorithm. Finalizer is the source of truth. QA validates independently. |
| Membership episodes table growth (one row per source_amaia_id per canonical change) | Medium | Most source rows never change canonical key. Growth ≈ 1 row per source row. Pruning deferred. |
| 19 triggers + 1 stored function | Medium | Each is scoped. Complexity distributed. Stored function is called explicitly, not on every row. |
| Tombstone canonical_key requires trigger validation beyond CHECK | Low | Trigger #15 validates domain policy. |

---

## Criteria for Approval

1. Transactional protocol compatible with triggers (manifest created before items, finalizer advances phase after items).
2. Finalizer computes hashes from items (not from runtime-supplied values).
3. Phase 'created' introduced with correct transition rules.
4. Membership episodes preserve history without overwriting.
5. Tombstone events support canonical_key for dedup domains.
6. Reconciliation dedup uses DISTINCT active canonical_key from memberships.
7. Supersession with shared canonical_key correctly handled (any active membership → expected).
8. Manifest scope explicitly limited to identity presence.
9. Domain policy applied to tombstones and reconciliation evidence.
10. DDL inventory exact (no approximations).
11. No contradictory P definitions anywhere.

---

**End of document.**
