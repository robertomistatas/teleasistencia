# AMAIA-SYNC Manifest Finalization Protocol v1.1

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.0 (cleanup: eliminated internal contradictions, trigger #11 defined correctly from start)  
**Parent patch:** Schema Patch v1.6 (all non-manifest content incorporated by reference)  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

This document specifies the manifest finalization subsystem. The runtime role cannot UPDATE manifests or insert derived evidence items (missing/extra/excluded). All post-INSERT mutations go through SECURITY DEFINER finalizer functions that validate domain lease ownership, compute hashes from items, derive differences, and advance phases.

---

## 1. Privilege Model

### Roles

**amaia_sync_manifest_owner:** NOLOGIN role. Owns the 5 finalizer functions. Has UPDATE on amaia_sync_run_manifests and INSERT on amaia_sync_manifest_identity_items.

**amaia_sync_runtime:** The engine's connection role.

| Object | amaia_sync_runtime | amaia_sync_manifest_owner |
|---|---|---|
| amaia_sync_run_manifests | INSERT, SELECT | UPDATE |
| amaia_sync_manifest_identity_items | INSERT (source, persisted roles only — enforced by trigger #11), SELECT | INSERT (all roles — trigger #11 allows derived roles from this caller) |
| Finalizer functions (5) | EXECUTE | Owner |
| PUBLIC | EXECUTE revoked on all 5 functions | |

### SECURITY DEFINER function hardening

Each of the 5 finalizer functions:
- Owned by amaia_sync_manifest_owner.
- Declared SECURITY DEFINER.
- SET search_path = 'public' (fixed, prevents manipulation).
- Uses fully qualified table names (public.amaia_sync_run_manifests, etc.).
- EXECUTE revoked from PUBLIC.
- EXECUTE granted only to amaia_sync_runtime.

### No GUC flags

Authorization is enforced by PostgreSQL privilege system. No transaction-local configuration variables.

---

## 2. Trigger #11 — Identity Items Insert Control

**Table:** amaia_sync_manifest_identity_items  
**Event:** BEFORE INSERT OR UPDATE OR DELETE

### On UPDATE or DELETE

Raise exception (append-only).

### On INSERT

1. Read parent manifest: SELECT phase, identity_basis FROM amaia_sync_run_manifests WHERE id = NEW.manifest_id.
2. Validate NEW.identity_basis = manifest.identity_basis. Mismatch → reject.
3. **Phase-bound role validation:**

| Manifest phase | Allowed item_role values | Who may insert |
|---|---|---|
| created | source | Runtime (any caller) |
| source_fetched | persisted | Runtime (any caller) |
| source_fetched | missing, extra, excluded | **Only amaia_sync_manifest_owner** |
| confirmed_compared | (none) | — |
| provisional_persisted | (none) | — |
| comparison_complete | (none) | — |
| abandoned | (none) | — |

4. **Caller check for derived roles:** If NEW.item_role IN ('missing', 'extra', 'excluded'):
   - Verify the effective current user is amaia_sync_manifest_owner: `pg_has_role(session_user, 'amaia_sync_manifest_owner', 'MEMBER')` returns true for SECURITY DEFINER functions owned by manifest_owner (because session_user reflects the function's definer role during execution).
   - If not: raise exception 'missing/extra/excluded items can only be inserted by finalizer functions'.

5. **Validate coherence constraints** (identity_basis ↔ fields, canonical_key regex, decomposed fields — unchanged from v1.6).

6. RETURN NEW.

### Why this is correct

- Runtime inserts source items (at 'created') and persisted items (at 'source_fetched'). These are raw observations.
- The finalizer functions (executing as manifest_owner) insert missing/extra/excluded items during finalize_comparison. These are derived differences.
- The runtime cannot fabricate missing/extra/excluded items because the caller check rejects them.
- The phase check prevents any item insertion after confirmed_compared.

---

## 3. Schema Adjustments

### Manifest column nullability

| Column | Deployed | After this protocol |
|---|---|---|
| source_id_count | NOT NULL CHECK >= 0 | **NULL allowed**, CHECK (IS NULL OR >= 0) |
| source_id_hash | NOT NULL | **NULL allowed** |
| phase default | 'source_fetched' | **'created'** |

All other columns unchanged from v1.6.

### Phase CHECK

phase IN ('created', 'source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned')

### Phase-conditional field requirements (enforced by finalizer, not CHECK)

| Phase | Fields guaranteed non-null after entering this phase |
|---|---|
| created | run_id, domain_name, identity_basis, identity_version, hash_algorithm, serialization_version |
| source_fetched | above + source_id_count, source_id_hash |
| confirmed_compared | above + persisted_id_count, persisted_id_hash, sets_match, verified_at |
| provisional_persisted | above + provisional_upper_bound, provisional_id_count, provisional_id_hash |
| comparison_complete | all of the above (whichever path was taken) |
| abandoned | whatever was populated at time of abandonment |

---

## 4. Finalizer Function APIs

### 4.1 amaia_sync_finalize_source

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint

**Returns:** void

**Authorization:**

1. Lock manifest FOR UPDATE. Validate phase = 'created', run_id matches.
2. Lock sync_run FOR UPDATE. Validate status = 'running', owner_identity matches, lease_token matches, domain_name matches manifest.
3. Lock domain lease FOR UPDATE. Validate 4-part ownership predicate (token, identity, not null, not expired).

**Computation:**

4. Read identity_items WHERE manifest_id AND item_role = 'source'.
5. Per identity_basis: collect DISTINCT identity elements, count, sort, hash (SHA-256).
6. UPDATE manifest: source_id_count, source_id_hash, phase = 'source_fetched'.

### 4.2 amaia_sync_finalize_comparison

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint

**Returns:** boolean (sets_match)

**Authorization:** Same as finalize_source, except validates phase = 'source_fetched'.

**Computation:**

4. Read source items → S_raw (DISTINCT identity elements).
5. Read persisted items → P_set (DISTINCT identity elements).
6. Read manifest.identity_basis.

**For non-dedup (source_amaia_id):**

7. missing_raw = S_raw \ P_set.
8. extra_raw = P_set \ S_raw.
9. Read approved exclusions. extras_excluded = extra_raw ∩ approved.
10. extra = extra_raw - extras_excluded.
11. sets_match = missing_raw is empty AND extra is empty.
12. INSERT identity_items for missing (role='missing'), extra (role='extra'), excluded (role='excluded'). These INSERTs succeed because the function executes as manifest_owner (trigger #11 allows).
13. Insert exclusion consumptions for extras_excluded (if applicable).
14. persisted_id_hash = hash(P_set - extras_excluded). persisted_id_count = |P_set - extras_excluded|.
15. Assemble missing_ids / extra_ids JSONB.

**For dedup (canonical_dedup_key):**

7. missing = S_raw \ P_set.
8. Extra: not computed.
9. sets_match = missing is empty.
10. INSERT identity_items for missing (role='missing').
11. persisted_id_hash = hash(P_set). persisted_id_count = |P_set|.
12. missing_ids = JSONB of missing keys. extra_ids = NULL.

**Update:**

16. UPDATE manifest: persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at = now(), phase = 'confirmed_compared'.
17. Return sets_match.

### 4.3 amaia_sync_finalize_provisional

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint, provisional_upper_bound bigint, provisional_id_count integer, provisional_id_hash text

**Returns:** void

**Authorization:** Same pattern, validates phase = 'confirmed_compared'.

**Note:** Provisional evidence (count, hash, upper_bound) is provided by the runtime as parameters. The finalizer writes them without independent verification. This is acceptable because provisional data is best-effort and will be re-verified when promoted to the confirmed range on a future cycle.

**Update:**

4. UPDATE manifest: provisional_upper_bound, provisional_id_count, provisional_id_hash, phase = 'provisional_persisted'.

### 4.4 amaia_sync_complete_manifest

**Parameters:** manifest_id uuid, run_id uuid, owner_identity text, lease_token bigint

**Returns:** void

**Authorization:** Same pattern, validates phase IN ('confirmed_compared', 'provisional_persisted').

**Update:**

4. UPDATE manifest: phase = 'comparison_complete'. No data columns change.

### 4.5 amaia_sync_abandon_manifest

**Parameters:** manifest_id uuid, reason text

**Returns:** void

**Authorization (relaxed):**

1. Lock manifest FOR UPDATE.
2. Validate phase NOT IN ('comparison_complete', 'abandoned').
3. No run/lease validation (used during recovery when original credentials are invalid).

**Update:**

4. UPDATE manifest: phase = 'abandoned'. No data columns change.

---

## 5. Transaction Model

### Transactions may be separate

The protocol does NOT require all steps to be in a single transaction. The fenced transaction model (from Runtime Architecture v1.2.9) allows:

**Transaction A — Source capture:**
1. Lock domain lease. Validate ownership.
2. Fetch from AMAIA. Upsert to destination. Update memberships (if dedup).
3. INSERT manifest (phase = 'created').
4. INSERT source identity_items.
5. CALL amaia_sync_finalize_source(manifest_id, run_id, owner_identity, lease_token).
6. COMMIT.

**Transaction B — Comparison:**
1. Lock domain lease. Validate ownership (re-verify — lease may have changed between transactions).
2. Query destination for P_set.
3. INSERT persisted identity_items.
4. CALL amaia_sync_finalize_comparison(manifest_id, run_id, owner_identity, lease_token).
5. If sets_match = true: advance watermark. Insert exclusion consumptions (done inside finalize_comparison).
6. COMMIT.

**Transaction C — Provisional (optional):**
1. Lock domain lease.
2. Process provisional zone.
3. CALL amaia_sync_finalize_provisional(...).
4. COMMIT.

**Transaction D — Complete:**
1. Lock domain lease.
2. CALL amaia_sync_complete_manifest(...).
3. COMMIT.

### What MUST be in the same transaction

| Items | Finalizer | Same transaction? | Why |
|---|---|---|---|
| Source items INSERT | finalize_source | **Yes** | Hashes computed from items. If items rollback but finalize committed: incoherent. |
| Persisted items INSERT | finalize_comparison | **Yes** | Same reason. Plus: missing/extra items are derived and inserted by the finalizer in this tx. |
| finalize_comparison | watermark advance | **Yes** | Watermark advances only if sets_match=true. Both must commit or rollback together. |
| finalize_provisional | provisional upserts/remediations | **Recommended** | Provisional is best-effort. Separate tx is tolerable. |
| complete_manifest | (nothing else) | Standalone OK | Just a phase flag. |
| abandon_manifest | orphan recovery | **Yes** | Manifest abandonment is part of the recovery transaction. |

### What MUST NOT be in the same transaction

No specific prohibition. The constraints above allow flexible transaction boundaries as long as the "must be same" pairs are respected.

---

## 6. Concurrency Proof

### Case 1: Transactions A and B are separate

**Between A's commit and B's start:** The manifest is at 'source_fetched'. Source items are committed. Another process could theoretically:

a) **Insert more source items:** Trigger #11 rejects (phase = 'source_fetched', role = 'source' not allowed). **Blocked.**

b) **Insert persisted items:** Allowed (phase = 'source_fetched', role = 'persisted'). But: finalize_comparison validates the domain lease. Only the lease holder can call it. If another process somehow inserts persisted items for this manifest: finalize_comparison (called by the legitimate owner) reads ALL persisted items and computes hashes correctly, including the extra rows. The extra items would cause a hash mismatch if unexpected. **Safe: hash computation is authoritative regardless of who inserted the items.**

c) **Call finalize_comparison:** Requires valid run_id + owner_identity + lease_token. Another process with different credentials is rejected. **Authorization prevents.**

### Case 2: Late item insertion after finalization

**After finalize_source committed (manifest at 'source_fetched'):**

- Source items: trigger rejects (wrong phase for source role). **Blocked.**
- Persisted items: trigger allows (correct phase). These are expected — Transaction B inserts them before calling finalize_comparison. **Correct.**

**After finalize_comparison committed (manifest at 'confirmed_compared'):**

- Any items: trigger rejects (no roles allowed at confirmed_compared). **Blocked.**

### Case 3: Concurrent finalize calls

Two calls to finalize_comparison on the same manifest: both lock manifest FOR UPDATE. First succeeds, advances to 'confirmed_compared'. Second reads phase = 'confirmed_compared', expected 'source_fetched' → raises exception. **Serialized.**

---

## 7. Trigger #4 — Updated Phase Rules

Trigger #4 (BEFORE UPDATE OR DELETE on manifests) is the secondary defense. Since the runtime cannot UPDATE manifests (privilege revoked), trigger #4 primarily guards against:
- Admin users making direct UPDATEs.
- Bugs in finalizer functions (defense in depth).

### Rules

**On DELETE:** Reject always.

**On UPDATE:**

- Terminal phases ('comparison_complete', 'abandoned'): reject all updates.
- Immutable-from-INSERT columns: reject changes to run_id, domain_name, identity_basis, identity_version, canonicalization_version, hash_algorithm, serialization_version, raw_max_id, created_at.
- Valid transitions: created → source_fetched, source_fetched → confirmed_compared, confirmed_compared → provisional_persisted, confirmed_compared → comparison_complete, provisional_persisted → comparison_complete, any non-terminal → abandoned.
- Per-transition column allowlists (unchanged from v1.6 except 'created' phase added).

---

## 8. Phase Transitions — Complete Reference

| From | To | Function | Authorization level |
|---|---|---|---|
| created | source_fetched | finalize_source | Full (manifest + run + domain lease) |
| source_fetched | confirmed_compared | finalize_comparison | Full |
| confirmed_compared | provisional_persisted | finalize_provisional | Full |
| confirmed_compared | comparison_complete | complete_manifest | Full |
| provisional_persisted | comparison_complete | complete_manifest | Full |
| any non-terminal | abandoned | abandon_manifest | Relaxed (manifest only) |

No other transitions are valid. Trigger #4 enforces as secondary defense.

---

## 9. DDL Impact Delta (relative to Schema Patch v1.6)

| Category | Change |
|---|---|
| Stored functions | 5 (SECURITY DEFINER): finalize_source, finalize_comparison, finalize_provisional, complete_manifest, abandon_manifest |
| Roles | +1 NOLOGIN: amaia_sync_manifest_owner |
| Privilege grants | UPDATE on manifests to manifest_owner. INSERT on identity_items to manifest_owner. EXECUTE on 5 functions to runtime. REVOKE EXECUTE on 5 functions from PUBLIC. |
| Nullability changes | source_id_count: NOT NULL → NULL allowed. source_id_hash: NOT NULL → NULL allowed. |
| CHECK changes | source_id_count: `>= 0` → `IS NULL OR >= 0`. phase default: 'source_fetched' → 'created'. phase CHECK: add 'created'. |
| Trigger updates | #4: add 'created' phase, transition rules. #11: role-based INSERT control (pg_has_role for derived items). #13: validate phase='created' on manifest INSERT. |
| New triggers | 0 |
| New tables | 0 |
| New columns | 0 |
| New indexes | 0 |
| New FKs | 0 |
| New RLS | 0 |

**Summary:** This protocol adds 5 functions, 1 role, privilege configuration, 2 nullability changes, 2 CHECK modifications, and 3 trigger logic updates. No structural schema additions beyond v1.6.

---

## Invariants

All v1.6 invariants preserved except 63 and 64 (GUC-based, removed). Invariant 58 replaced.

**58 (REPLACED):** Hashes, counts, and derived items (missing/extra/excluded) are computed exclusively by SECURITY DEFINER finalizer functions. The runtime role cannot UPDATE manifests or INSERT derived items. Privilege revocation is the authorization boundary.

**65.** Finalizer validates run and lease ownership (manifest + run + domain lease locked and verified).

**66.** Difference derivation (missing/extra/excluded) is the finalizer's exclusive responsibility. The runtime provides only source and persisted items.

**67.** Provisional evidence is runtime-provided parameters (acceptable: not safety-critical, re-verified on promotion).

**68.** Source items + finalize_source are in the same transaction. Persisted items + finalize_comparison + watermark advance are in the same transaction. Other boundaries are flexible.

**69.** Derived item roles (missing/extra/excluded) can only be inserted by the manifest_owner effective user. Trigger #11 verifies with pg_has_role.

---

## Self-Audit

### Runtime attempts direct UPDATE on manifest

PostgreSQL denies: UPDATE not granted to amaia_sync_runtime. **Privilege-enforced.**

### Runtime inserts 'missing' item directly

Trigger #11: item_role = 'missing', checks pg_has_role(session_user, 'amaia_sync_manifest_owner'). Runtime is not a member. INSERT rejected. **Role-enforced.**

### Runtime inserts 'source' item after finalize_source

Trigger #11: manifest phase = 'source_fetched', item_role = 'source'. 'source' not allowed at 'source_fetched'. Rejected. **Phase-enforced.**

### Runtime inserts 'persisted' item after finalize_comparison

Trigger #11: manifest phase = 'confirmed_compared', item_role = 'persisted'. No roles allowed at 'confirmed_compared'. Rejected. **Phase-enforced.**

### Finalizer called with stale lease credentials

finalize_source Step 3: locks domain lease FOR UPDATE, validates lease_expires_at > now(). Expired → exception. Manifest stays at 'created'. **Authorization-enforced.**

### Finalizer called with wrong run_id

finalize_source Step 1: manifest.run_id != param run_id → exception. **Cross-manifest prevention.**

### Two concurrent finalize_comparison calls

Both lock manifest FOR UPDATE. First wins, advances phase. Second reads wrong phase → exception. **Row-lock serialized.**

### Items inserted between Transaction A commit and Transaction B start (by another process)

Persisted items: allowed at 'source_fetched' (correct). These items will be included in finalize_comparison's hash computation. If the items are from an unauthorized process: finalize_comparison still validates run/lease ownership. The unauthorized process could not call finalize_comparison (wrong credentials). The items exist but the manifest cannot be finalized by the wrong caller. The legitimate caller's finalize_comparison reads ALL persisted items (including unauthorized ones), computes hashes, and if unexpected items are present, the hash mismatch will make sets_match reflect reality. **No false positive sets_match.**

### Abandon called by recovery on manifest at 'created'

abandon_manifest: validates phase not terminal. 'created' is non-terminal. Sets phase = 'abandoned'. No evidence asserted. **Correct for incomplete manifests.**

### Provisional values fabricated by runtime

finalize_provisional accepts runtime-provided values. If fabricated: provisional evidence is misleading but does NOT affect watermark advancement (already decided at confirmed_compared). Provisional data is re-verified on promotion in a future cycle. **Acceptable tradeoff, documented.**

---

**End of document.**
