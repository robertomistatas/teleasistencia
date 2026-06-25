# AMAIA-SYNC Manifest Finalization Protocol v1.0

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Scope:** Manifest lifecycle, identity items, finalizer functions, privileges, phase transitions  
**Parent patch:** Schema Patch v1.6 (all non-manifest content incorporated by reference)  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

This document specifies the complete manifest finalization subsystem: how manifests are created, populated with evidence items, finalized with computed hashes, and advanced through phases. It replaces the GUC-flag mechanism from v1.6 with a privilege-based model where the runtime role cannot UPDATE manifests at all — all mutations after INSERT go through SECURITY DEFINER finalizer functions that internally validate domain lease ownership, compute hashes from items, derive missing/extra sets, and advance phases.

---

## Scope

**In scope:**
- Manifest table schema adjustments (nullability for phase compatibility).
- Identity items table (unchanged from v1.6 structurally).
- 5 finalizer functions (API, authorization, computation, phase transitions).
- Privilege model (roles, grants, SECURITY DEFINER).
- Phase-bound item insertion rules.
- Difference derivation (missing/extra computed by finalizer, not runtime).
- Concurrency (serialization between items insertion and finalization).
- Provisional evidence handling.

**Out of scope:**
- Scheduler fencing (defined in schema patch v1.6, unchanged).
- Membership episodes (defined in schema patch v1.6, unchanged).
- Exclusion/exception ledger mechanics (unchanged).
- Reconciliation/tombstone design (canonical support declared in v1.6, not redesigned here).
- Watermark CAS mechanics (unchanged).
- Domain identity policies (unchanged).

---

## 1. Schema Adjustments for Phase Compatibility

### Manifest column nullability by phase

With phase = 'created' as the initial state, several columns that were NOT NULL must become NULLABLE (they are populated by the finalizer at later phases).

| Column | Current (deployed) | New | Populated at phase |
|---|---|---|---|
| source_id_count | NOT NULL (CHECK >= 0) | **NULL** allowed | source_fetched (by finalizer) |
| source_id_hash | NOT NULL | **NULL** allowed | source_fetched (by finalizer) |
| persisted_id_count | NULL allowed | NULL allowed (unchanged) | confirmed_compared (by finalizer) |
| persisted_id_hash | NULL allowed | NULL allowed (unchanged) | confirmed_compared (by finalizer) |
| sets_match | NULL allowed | NULL allowed (unchanged) | confirmed_compared (by finalizer) |
| verified_at | NULL allowed | NULL allowed (unchanged) | confirmed_compared (by finalizer) |
| missing_ids | NULL allowed | NULL allowed (unchanged) | confirmed_compared (by finalizer) |
| extra_ids | NULL allowed | NULL allowed (unchanged) | confirmed_compared (by finalizer) |
| phase | NOT NULL, default 'source_fetched' | NOT NULL, default **'created'** | INSERT |

**Deployed CHECK change:** source_id_count CHECK changes from `source_id_count >= 0` to `source_id_count IS NULL OR source_id_count >= 0`.

**New identity columns (from v1.6):** identity_basis, identity_version, hash_algorithm, serialization_version are NOT NULL (set at INSERT). canonicalization_version is NULL allowed (NULL for source_amaia_id domains).

### Phase-conditional field requirements (enforced by finalizer, not by CHECK)

The finalizer functions validate field completeness at each transition. The database CHECK constraints allow NULLs broadly — the finalizer provides the phase-specific guarantees:

| Phase | Required non-null fields |
|---|---|
| created | run_id, domain_name, identity_basis, identity_version, hash_algorithm, serialization_version |
| source_fetched | above + source_id_count, source_id_hash |
| confirmed_compared | above + persisted_id_count, persisted_id_hash, sets_match, verified_at |
| provisional_persisted | above + provisional_upper_bound, provisional_id_count, provisional_id_hash |
| comparison_complete | all of confirmed_compared (or provisional_persisted if applicable) |
| abandoned | whatever was populated when the manifest was abandoned |

---

## 2. Privilege Model

### Roles

**amaia_sync_manifest_owner:** A NOLOGIN role that owns the finalizer functions and has UPDATE privilege on amaia_sync_run_manifests. This role is never used for direct connections.

**amaia_sync_runtime:** The role used by the sync engine's database connection. Grants:

| Object | Privilege |
|---|---|
| amaia_sync_run_manifests | INSERT, SELECT |
| amaia_sync_run_manifests | **NO UPDATE** (explicitly revoked or never granted) |
| amaia_sync_manifest_identity_items | INSERT, SELECT |
| amaia_sync_manifest_identity_items | NO UPDATE, NO DELETE |
| Finalizer functions (5) | EXECUTE |
| All other sync tables | As needed for domain processing |

**Why no GUC flag:** The GUC flag from v1.6 was a soft boundary — any caller with UPDATE privilege could set it. With UPDATE revoked from the runtime role, the boundary is hard: the runtime physically cannot UPDATE the manifest. Only the SECURITY DEFINER functions can, because they execute as amaia_sync_manifest_owner.

### SECURITY DEFINER function safety

Each finalizer function:
- Is owned by amaia_sync_manifest_owner.
- Declared with SECURITY DEFINER (executes with owner's privileges).
- Has `SET search_path = 'public'` (prevents search_path manipulation attacks).
- Uses fully qualified table references (public.amaia_sync_run_manifests, etc.).
- EXECUTE privilege is revoked from PUBLIC and granted only to amaia_sync_runtime.

---

## 3. Finalizer Function APIs

### 3.1 amaia_sync_finalize_source

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint

**Returns:** void (raises exception on failure)

**Authorization sequence:**

1. SELECT ... FROM public.amaia_sync_run_manifests WHERE id = manifest_id FOR UPDATE. If not found: raise 'manifest not found'.
2. Validate manifest.phase = 'created'. If not: raise 'expected phase created, found %'.
3. Validate manifest.run_id = run_id. If not: raise 'run_id mismatch'.
4. SELECT ... FROM public.amaia_sync_runs WHERE id = run_id FOR UPDATE. Validate: status = 'running', owner_identity = param owner_identity, lease_token = param lease_token, domain_name = manifest.domain_name. Any mismatch: raise.
5. SELECT ... FROM public.amaia_sync_leases WHERE entity_name = manifest.domain_name FOR UPDATE. Validate: lease_token = param lease_token, owner_identity = param owner_identity, owner_identity IS NOT NULL, lease_expires_at > now(). Any mismatch: raise 'domain lease ownership invalid'.

**Computation:**

6. Read all identity_items WHERE manifest_id = param manifest_id AND item_role = 'source'.
7. Determine identity_basis from manifest.
8. If 'source_amaia_id': collect DISTINCT source_amaia_id values. Count. Sort ascending. Pipe-delimit. SHA-256.
9. If 'canonical_dedup_key': collect DISTINCT canonical_key values. Count. Sort ascending. Pipe-delimit. SHA-256.
10. UPDATE manifest: source_id_count = computed, source_id_hash = computed, phase = 'source_fetched'.

### 3.2 amaia_sync_finalize_comparison

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint

**Returns:** boolean (sets_match)

**Authorization:** Same Steps 1-5 as finalize_source, except Step 2 validates phase = 'source_fetched'.

**Computation:**

6. Read source items (role = 'source'). Compute S_raw (distinct identity elements per basis).
7. Read persisted items (role = 'persisted'). Compute P_set (distinct identity elements per basis).
8. Read manifest.identity_basis.

**For non-dedup (identity_basis = 'source_amaia_id'):**

9. Compute missing_raw = S_raw \ P_set.
10. Compute extra_raw = P_set \ S_raw.
11. Read approved exclusions for this domain from exclusion ledger (subjects with current approved investigation). Compute extras_excluded = extra_raw ∩ approved_exclusion_identities.
12. Compute extra = extra_raw - extras_excluded.
13. Insert exclusion consumptions for each extras_excluded item (within this function's transaction — the function has UPDATE privilege via owner role if needed, or INSERT privilege on consumptions).
14. Compute sets_match = (missing_raw is empty AND extra is empty).
15. Insert identity_items for missing (role='missing'), extra (role='extra'), excluded (role='excluded'). The function executes as manifest_owner; identity_items INSERT trigger (#11) validates phase = 'source_fetched' — correct.
16. Compute persisted_id_hash from P_set - extras_excluded. persisted_id_count = |P_set - extras_excluded|.
17. Assemble missing_ids / extra_ids JSONB arrays.

**For dedup (identity_basis = 'canonical_dedup_key'):**

9. Compute missing = S_raw \ P_set.
10. Extra: not computed.
11. Compute sets_match = missing is empty.
12. Insert identity_items for missing (role='missing'). No extra/excluded items.
13. Compute persisted_id_hash from P_set. persisted_id_count = |P_set|.
14. missing_ids = JSONB array of missing canonical keys. extra_ids = NULL.

**Update:**

18. UPDATE manifest: persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at = now(), phase = 'confirmed_compared'.
19. Return sets_match.

### 3.3 amaia_sync_finalize_provisional

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint, provisional_upper_bound bigint, provisional_id_count integer, provisional_id_hash text

**Returns:** void

**Authorization:** Same Steps 1-5, except Step 2 validates phase = 'confirmed_compared'.

**Note:** Provisional evidence (upper bound, count, hash) is computed by the RUNTIME and passed as parameters. The finalizer does NOT independently verify provisional hashes (provisional processing is best-effort — the confirmed watermark already advanced based on the confirmed comparison). The finalizer writes the provided values.

**Update:**

6. UPDATE manifest: provisional_upper_bound, provisional_id_count, provisional_id_hash, phase = 'provisional_persisted'.

### 3.4 amaia_sync_complete_manifest

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint

**Returns:** void

**Authorization:** Same Steps 1-5, except Step 2 validates phase IN ('confirmed_compared', 'provisional_persisted').

**Update:**

6. UPDATE manifest: phase = 'comparison_complete'. No data columns change (all frozen at this point).

### 3.5 amaia_sync_abandon_manifest

**Parameters:** manifest_id uuid, reason text

**Returns:** void

**Authorization (relaxed):**

1. SELECT ... FROM public.amaia_sync_run_manifests WHERE id = manifest_id FOR UPDATE.
2. Validate phase NOT IN ('comparison_complete', 'abandoned'). If terminal: raise 'manifest already terminal'.
3. No run/lease validation required. Abandon is used during recovery when the original owner's credentials are no longer valid.

**Update:**

4. UPDATE manifest: phase = 'abandoned'. No data columns change.

---

## 4. Identity Items Insertion and Finalization Order

### Compatible sequence

| Step | Actor | Operation | Manifest phase |
|---|---|---|---|
| 1 | Runtime | INSERT manifest (phase='created', identity columns) | → created |
| 2 | Runtime | INSERT identity_items (role='source') | created |
| 3 | Runtime | CALL finalize_source(manifest_id, run_id, ...) | created → source_fetched |
| 4 | Runtime | INSERT identity_items (role='persisted') | source_fetched |
| 5 | Runtime | CALL finalize_comparison(manifest_id, run_id, ...) | source_fetched → confirmed_compared |
| 5a | Finalizer | INSERT identity_items (role='missing', 'extra', 'excluded') | source_fetched (within finalizer tx) |
| 6 | Runtime | [optional] CALL finalize_provisional(...) | confirmed_compared → provisional_persisted |
| 7 | Runtime | CALL complete_manifest(manifest_id, run_id, ...) | → comparison_complete |

### Trigger #11 phase rules (identity_items INSERT)

| Manifest phase | Allowed item_role |
|---|---|
| created | source |
| source_fetched | persisted (by runtime), missing/extra/excluded (by finalizer in same tx) |
| confirmed_compared | none |
| provisional_persisted | none |
| comparison_complete | none |
| abandoned | none |

**Key detail for Step 5a:** The finalizer inserts missing/extra/excluded items DURING finalize_comparison, before advancing the phase to confirmed_compared. At the moment of insertion, the manifest phase is still 'source_fetched' — trigger #11 allows these roles at this phase. The phase advances to 'confirmed_compared' in the same function call, AFTER the items are inserted.

### Who inserts what

| item_role | Inserted by | At phase |
|---|---|---|
| source | Runtime (direct INSERT) | created |
| persisted | Runtime (direct INSERT) | source_fetched |
| missing | Finalizer (inside finalize_comparison) | source_fetched |
| extra | Finalizer (inside finalize_comparison) | source_fetched |
| excluded | Finalizer (inside finalize_comparison) | source_fetched |

The runtime provides the raw data (source rows, persisted rows). The finalizer derives the differences (missing, extra, excluded) and inserts them. The runtime is not trusted to provide correct missing/extra sets.

---

## 5. Difference Derivation — Finalizer Responsibility

### Non-dedup domains

The finalizer:
1. Reads source items → extracts DISTINCT source_amaia_id → S_raw.
2. Reads persisted items → extracts DISTINCT source_amaia_id → P_raw.
3. Computes missing_raw = S_raw \ P_raw.
4. Computes extra_raw = P_raw \ S_raw.
5. Reads exclusion ledger for approved exclusions applicable to extra_raw.
6. Computes extra = extra_raw - approved.
7. Inserts missing items, extra items, excluded items.
8. Computes persisted_id_hash from (P_raw - approved exclusions).

**The runtime does NOT provide missing or extra.** It provides only: source items (what it fetched) and persisted items (what it found in destination). The finalizer computes the rest.

### Dedup domains

The finalizer:
1. Reads source items → extracts DISTINCT canonical_key → S_raw.
2. Reads persisted items → extracts DISTINCT canonical_key → P_check.
3. Computes missing = S_raw \ P_check.
4. Extra: not computed (dedup incremental).
5. Inserts missing items.
6. Computes persisted_id_hash from P_check.

---

## 6. Hashes and Counts — Computed Exclusively by Finalizer

### finalize_source computes

- source_id_count: count of DISTINCT identity elements from source items.
- source_id_hash: SHA-256 of sorted, pipe-delimited identity elements.

### finalize_comparison computes

- persisted_id_count: count of DISTINCT identity elements from persisted items (after exclusion for non-dedup).
- persisted_id_hash: SHA-256 of sorted, pipe-delimited identity elements (after exclusion).
- sets_match: derived from missing/extra computation.
- missing_ids: JSONB array of missing identity elements.
- extra_ids: JSONB array of extra identity elements (NULL for dedup).
- verified_at: now().

### Runtime cannot write these fields

The runtime role lacks UPDATE on manifests. These fields are NULL after INSERT (phase='created'). They are populated only by the finalizer functions. No other code path can set them.

---

## 7. Phase Transitions — Complete Rules

| From | To | Function | Authorization |
|---|---|---|---|
| created | source_fetched | finalize_source | Full (manifest + run + lease) |
| source_fetched | confirmed_compared | finalize_comparison | Full |
| confirmed_compared | provisional_persisted | finalize_provisional | Full |
| confirmed_compared | comparison_complete | complete_manifest | Full |
| provisional_persisted | comparison_complete | complete_manifest | Full |
| any non-terminal | abandoned | abandon_manifest | Relaxed (manifest only) |

**No direct UPDATE path exists.** The runtime role cannot UPDATE the manifest. Trigger #4 enforces valid transitions as a second layer of defense (in case a privileged user or admin attempts a direct UPDATE).

### Trigger #4 updated rules

Trigger #4 (BEFORE UPDATE on manifests) still validates:
- Forward-only transitions (no backward).
- Terminal phases reject all updates.
- Immutable-from-INSERT columns (identity columns, run_id, domain_name, created_at).
- Per-phase column allowlists.

The GUC flag check from v1.6 is REMOVED. The privilege model makes it unnecessary.

---

## 8. Provisional Evidence

### Source of provisional data

Provisional processing occurs AFTER the confirmed comparison succeeds. The runtime:
1. Fetches the provisional zone (confirmed_upper_bound, raw_max_id] from AMAIA.
2. Upserts provisionally.
3. Computes provisional_id_count and provisional_id_hash from the provisional fetch.
4. Calls finalize_provisional with these values as parameters.

### Why the finalizer accepts runtime-provided provisional values

The provisional zone is best-effort: the confirmed watermark already advanced based on the confirmed comparison. Provisional data will be re-validated when the provisional IDs enter the confirmed range on a future cycle. The finalizer trusts the runtime's provisional values because:
- The confirmed comparison (which IS finalizer-verified) already passed.
- Provisional evidence is informational, not safety-critical.
- Re-deriving provisional hashes from items would require a separate set of provisional identity_items — adding complexity without safety benefit since the data is re-verified on promotion.

### No provisional identity_items

Provisional processing does NOT insert identity_items. The provisional evidence (upper_bound, count, hash) is recorded directly on the manifest via finalize_provisional. This is the only case where the finalizer writes runtime-provided values rather than computing from items. It is acceptable because provisional evidence does not affect watermark advancement (that was decided at confirmed_compared).

---

## 9. Concurrency Proof

### Items cannot be inserted after finalization starts

**Scenario:** Runtime inserts source items. Finalizer starts (locks manifest FOR UPDATE). Concurrently, runtime inserts more source items.

**Analysis:** Both the finalizer and the identity_items INSERT trigger read the manifest row. The finalizer locks it FOR UPDATE. The trigger's SELECT on the manifest (to check phase) reads the latest committed version. Since the finalizer is within the same transaction as the runtime (called by the runtime), the manifest lock is held by the same transaction — no contention.

**Wait — are they in the same transaction?** YES. The runtime calls the finalizer function within its fenced transaction. The function executes in the SAME transaction (PostgreSQL functions execute in the caller's transaction context, even SECURITY DEFINER ones). So:

1. Transaction begins (runtime).
2. Runtime inserts manifest (phase='created').
3. Runtime inserts source items (trigger reads manifest in same tx — phase='created' ✓).
4. Runtime calls finalize_source (same tx). Finalizer locks manifest FOR UPDATE (same tx — no self-deadlock, already part of tx). Reads items. Computes. Updates manifest to 'source_fetched'.
5. Runtime inserts persisted items (trigger reads manifest in same tx — phase='source_fetched' ✓).
6. Runtime calls finalize_comparison (same tx). Finalizer reads all items. Computes. Inserts missing/extra/excluded items. Updates manifest to 'confirmed_compared'.
7. Runtime advances watermark (if sets_match).
8. COMMIT.

**All within one transaction.** No concurrency between items and finalizer — they are sequential steps in the same transaction. Items inserted after finalize_source's phase advance would need the trigger to see phase='source_fetched' (which it does, because it's the same tx).

**Cross-transaction scenario:** Another transaction (different connection) tries to insert items for the same manifest. The identity_items trigger reads the manifest. If the first transaction committed: the phase has advanced. If the inserter tries to add 'source' items but phase is now 'source_fetched': trigger rejects. If the first transaction hasn't committed: the second transaction sees the manifest at its pre-tx state (phase='created' for a new manifest, or whatever it was before the first tx). PostgreSQL MVCC ensures the second transaction does NOT see uncommitted changes.

**Guarantee:** Items can only be inserted in the correct phase. The phase is advanced by the finalizer. The finalizer and item insertion are in the same transaction. No race is possible.

---

## 10. DDL Impact Delta (relative to Schema Patch v1.6)

### Changed columns

| Table | Column | v1.6 | This protocol |
|---|---|---|---|
| manifests | source_id_count | NOT NULL CHECK >= 0 | **NULL** allowed, CHECK (IS NULL OR >= 0) |
| manifests | source_id_hash | NOT NULL | **NULL** allowed |
| manifests | phase default | 'source_fetched' | **'created'** |

### Changed CHECK

| Table | Constraint | Change |
|---|---|---|
| manifests | phase_check | Add 'created' to allowed values |
| manifests | source_id_count_check | Allow NULL |

### New objects

| Object | Type | Count |
|---|---|---|
| amaia_sync_manifest_owner | NOLOGIN role | 1 |
| amaia_sync_finalize_source | SECURITY DEFINER function | 1 |
| amaia_sync_finalize_comparison | SECURITY DEFINER function | 1 |
| amaia_sync_finalize_provisional | SECURITY DEFINER function | 1 |
| amaia_sync_complete_manifest | SECURITY DEFINER function | 1 |
| amaia_sync_abandon_manifest | SECURITY DEFINER function | 1 |

### Privilege changes

| Object | Runtime role | Manifest owner role |
|---|---|---|
| manifests | INSERT, SELECT (UPDATE revoked) | UPDATE (for finalizer functions) |
| identity_items | INSERT, SELECT | INSERT, SELECT |
| Finalizer functions | EXECUTE | (owner) |
| PUBLIC | EXECUTE revoked on all 5 functions | |

### Trigger changes

| # | Trigger | Change |
|---|---|---|
| #4 | manifest phase_column_guard | Remove GUC flag check. Add 'created' as valid initial phase. Transition rules unchanged. |
| #11 | identity_items append_only_coherence | Allow item_role='source' when manifest phase='created'. Allow persisted/missing/extra/excluded when phase='source_fetched'. |
| #13 | manifest insert_guard | Validate identity coherence + domain policy. Validate phase='created' on INSERT. |

### Summary delta

| Category | v1.6 total | This protocol delta | New total |
|---|---|---|---|
| Tables | 3 new | 0 | 3 |
| Stored functions | 1 (3 modes) | +4 (5 explicit functions replace 1 multi-mode) | 5 |
| Roles | 0 new | +1 (NOLOGIN manifest_owner) | 1 |
| Columns | 11 new | 0 new (2 nullability changes on existing new columns) | 11 |
| Nullability changes | 3 | +2 (source_id_count, source_id_hash) | 5 |
| CHECKs | 17 | 1 modified (source_id_count), 1 modified (phase) | 17 |
| Indexes | 12 | 0 | 12 |
| FKs | 3 | 0 | 3 |
| Triggers | 19 | 0 new, 3 updated (#4, #11, #13) | 19 |
| RLS | 3 new | 0 | 3 |
| Seeds | 7 | 0 | 7 |

---

## Invariants

All v1.6 invariants preserved. Invariant 58 superseded. Invariants 63-64 (GUC flag) removed (replaced by privilege model).

**Invariant 58 (REPLACED):** Hashes and counts are computed exclusively by SECURITY DEFINER finalizer functions. The runtime role cannot UPDATE the manifest table. Phase advancement is possible only through finalizer functions. No GUC flag — privilege revocation is the boundary.

**Invariant 63 (REPLACED):** Direct manifest UPDATE by runtime is rejected by PostgreSQL privilege enforcement (UPDATE not granted to runtime role). Trigger #4 is a secondary defense for privileged callers.

**Invariant 64 (REMOVED):** GUC flag mechanism no longer exists.

Added:

65. **Finalizer validates run and lease ownership.** Every finalizer call (except abandon) locks the manifest, run, and domain lease, and validates credentials before any mutation.
66. **Difference derivation is finalizer's responsibility.** Missing and extra sets are computed by the finalizer from source and persisted items. The runtime provides raw items only. The runtime cannot inject false missing/extra.
67. **Provisional evidence is runtime-provided.** The finalizer trusts provisional values because they do not affect watermark advancement (confirmed comparison already passed).
68. **Items and finalizer execute in the same transaction.** No cross-transaction race between item insertion and hash computation. Phase transitions and item insertions are sequentially ordered within one transaction.

---

## Self-Audit

### Runtime attempts direct UPDATE on manifest

Result: PostgreSQL denies (UPDATE not granted to runtime role). Error before any trigger fires. **Privilege-enforced. Resists.**

### Runtime inserts items after finalize_source

Scenario: Runtime calls finalize_source (manifest now at 'source_fetched'). Runtime inserts more 'source' items.

Result: Trigger #11: manifest phase = 'source_fetched', item_role = 'source' not allowed at this phase. INSERT rejected. **Phase-enforced. Resists.**

### Finalizer called with stale credentials

Scenario: Runtime's lease expired. It calls finalize_source with old credentials.

Result: Finalizer Step 5: locks domain lease FOR UPDATE, validates lease_expires_at > now(). Expired → raises exception. Manifest stays at 'created'. **Authorization-enforced. Resists.**

### Finalizer called with wrong run_id

Result: Finalizer Step 3: manifest.run_id != param run_id → raises exception. **Cross-manifest prevention. Resists.**

### Missing items fabricated by runtime

Scenario: Runtime inserts identity_items with role='missing' before calling finalize_comparison.

Result: Trigger #11: phase = 'source_fetched', role = 'missing'. Trigger allows this role at source_fetched phase. BUT: finalize_comparison will independently compute missing from source and persisted items. If the runtime's 'missing' items don't match the finalizer's computation, the finalizer's INSERT of the correct missing items will conflict with the fabricated ones (partial unique index on manifest_id + item_role + identity). The conflict causes finalize_comparison to fail.

**Correction needed:** The trigger should NOT allow role='missing' from the runtime. Only the finalizer should insert missing/extra/excluded items.

**Solution:** Trigger #11 distinguishes callers: missing/extra/excluded items can only be inserted when the current session is executing a finalizer function. Detection: check `current_setting('amaia_sync.finalizer_active', true)` — wait, we removed GUC flags.

**Alternative solution:** The finalizer inserts missing/extra/excluded items. The runtime never inserts these roles. Trigger #11 enforces: role IN ('missing', 'extra', 'excluded') requires that the caller has the manifest_owner role (checked via `pg_has_role(current_user, 'amaia_sync_manifest_owner', 'MEMBER')`). The runtime role is NOT a member. The finalizer function (SECURITY DEFINER as manifest_owner) IS the effective user during execution.

**Updated trigger #11 rule:** INSERT of item_role IN ('missing', 'extra', 'excluded') is allowed ONLY if the current effective user is amaia_sync_manifest_owner. Runtime role → rejected. Finalizer → accepted.

This is a clean privilege-based boundary with no GUC flags.

### Concurrent finalize calls on same manifest

Result: Both lock manifest FOR UPDATE. First caller wins (row-level lock). Second blocks until first commits. After first commits: phase has advanced. Second reads new phase → expected phase mismatch → raises exception. **Serialized. Resists.**

### Abandon called on terminal manifest

Result: Finalizer Step 2: phase IN ('comparison_complete', 'abandoned') → raises 'already terminal'. **Phase guard. Resists.**

### Abandon called by recovery process without lease

Result: abandon_manifest has relaxed authorization (no run/lease validation). This is by design: the recovery process may not have the original owner's credentials. Abandon only sets phase = 'abandoned' with no data column changes — it does not assert evidence validity. **Correct design. Acceptable.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| SECURITY DEFINER adds deployment complexity | Low | Standard PostgreSQL pattern. Well-documented in PostgreSQL security best practices. |
| Runtime role might be granted UPDATE accidentally | Low | Migration DDL explicitly revokes UPDATE. Startup validation can check grants. |
| Finalizer function performance (reads all items, computes hash) | Medium | Items per manifest are bounded by page size × pages. SHA-256 of ~1000 items is sub-millisecond. |
| Provisional evidence not independently verified | Low | By design: provisional is best-effort, re-verified on promotion. |

---

## Criteria for Approval

1. Privilege model prevents runtime from writing hashes/counts or advancing phases.
2. Finalizer functions are the sole phase advancement path (privilege + trigger enforced).
3. Difference derivation (missing/extra) is computed by the finalizer, not the runtime.
4. Phase = 'created' is compatible with FK/trigger ordering (manifest exists before items).
5. Finalization and items are in the same transaction (no race).
6. Provisional evidence is explicitly documented as runtime-provided (acceptable tradeoff).
7. Missing/extra/excluded items can only be inserted by the finalizer (role-checked).
8. No GUC flags. Privilege revocation is the sole authorization boundary.
9. DDL impact delta is exact and additive to v1.6.

---

**End of document.**
