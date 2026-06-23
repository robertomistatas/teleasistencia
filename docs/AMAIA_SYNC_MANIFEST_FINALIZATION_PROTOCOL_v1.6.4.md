# AMAIA-SYNC Manifest Finalization Protocol v1.6.4

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.6.3  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code. Zero new DDL objects beyond the parent patch.

---

## Changelog v1.6.3 → v1.6.4

| # | ID | Area | Change |
|---|---|---|---|
| 1 | C1 | complete_manifest | Full 4-part lease revalidation under lock, matching all other finalizers. |
| 2 | C2 | provisional_verified | finalize_provisional computes/validates evidence and sets provisional_verified=true. complete_manifest rejects comparison_complete from provisional_persisted unless provisional_verified=true. No unverified evidence in terminal manifests. |
| 3 | M1 | Source evidence wording | "Source items must exist" → "Source evidence must be finalized. Zero source items are valid." |
| 4 | M2 | Multi-subject order | ORDER BY (identity_basis, canonical_identity) for total order across mixed dedup/non-dedup. |
| 5 | M3 | Invariant 87 | Discovery reads (get-or-create lookup, immutable investigation→subject resolution) permitted before lock. State-dependent reads/mutations require lock. investigation.subject_id declared immutable. |
| 6 | M4 | Watermark CAS atomicity | Normatively declared: CAS within the same transaction as manifest evidence + exclusion consumption + phase advancement. |
| 7 | M5 | abandoned_by | Declared as operational evidence from recovery_runtime trust boundary, not schema-authenticated. |

---

## Corrected Finalizer Contracts

All contracts from v1.6.3 Section 3 are preserved except where explicitly corrected below.

### 3.4 amaia_sync_complete_manifest (CORRECTED — C1)

| Aspect | Specification |
|---|---|
| **Origin phase** | confirmed_compared OR provisional_persisted |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE |
| **Revalidations under lock** | **Lease:** lease_token = run.lease_token, owner_identity = run.owner_identity, owner_identity IS NOT NULL, lease_expires_at > now(). **Run:** status = 'running', owner_identity = lease.owner_identity, lease_token = lease.lease_token, domain_name = manifest.domain_name. **Manifest:** phase IN ('confirmed_compared', 'provisional_persisted'), run_id = param run_id. |
| **Provisional gate** | If manifest.phase = 'provisional_persisted': verify provisional_verified = true. If false or NULL: raise exception 'provisional evidence not verified, cannot complete'. |
| **Evidence computed** | provisional_skipped: set to true if raw_max_id > confirmed upper_bound AND phase = 'confirmed_compared'. |
| **Atomic write** | provisional_skipped (if applicable) + phase = 'comparison_complete'. All other columns frozen. |
| **Target phase** | comparison_complete (terminal) |
| **Idempotency** | NOT idempotent. Second call on terminal rejected by Trigger #4. |

The revalidation block is now identical to all other finalizers. No finalizer has a weaker authorization path.

### 3.3 amaia_sync_finalize_provisional (CORRECTED — C2)

| Aspect | Specification |
|---|---|
| **Origin phase** | confirmed_compared |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE |
| **Revalidations under lock** | Same 4-part lease predicate + run + manifest validation as all other finalizers. Manifest phase = 'confirmed_compared'. |
| **Evidence computed** | The finalizer receives provisional_upper_bound from the runtime. It then: (a) queries the destination table for IDs/keys in the provisional zone (confirmed_upper_bound, provisional_upper_bound], (b) computes provisional_id_count and provisional_id_hash from the query result using the same algorithm as finalize_source (identity-basis-aware hash of the set). |
| **Atomic write** | provisional_upper_bound + provisional_id_count + provisional_id_hash + **provisional_verified = true** + phase = 'provisional_persisted'. |
| **Target phase** | provisional_persisted |
| **Idempotency** | NOT idempotent. |
| **Note** | The finalizer independently verifies provisional evidence by querying the destination. The runtime provides only the provisional_upper_bound (the range limit); the finalizer computes count and hash from the actual persisted data. This eliminates the unverified-evidence gap. |

### What changed from v1.6.3

v1.6.3: finalize_provisional accepted runtime-provided count/hash and set provisional_verified=false.

v1.6.4: finalize_provisional accepts only provisional_upper_bound from the runtime. It queries the destination and computes count/hash independently. It sets provisional_verified=true. The runtime cannot fabricate provisional evidence.

### Impact on function signature

| Parameter | v1.6.3 | v1.6.4 |
|---|---|---|
| manifest_id | uuid | uuid (unchanged) |
| run_id | uuid | uuid (unchanged) |
| provisional_upper_bound | bigint | bigint (unchanged) |
| provisional_id_count | integer | **REMOVED** (computed by finalizer) |
| provisional_id_hash | text | **REMOVED** (computed by finalizer) |

### Impact on provisional_verified column

v1.6.3: provisional_verified could be false (unverified) in a terminal manifest.
v1.6.4: provisional_verified is always true when provisional_persisted is reached. complete_manifest rejects comparison_complete from provisional_persisted if provisional_verified != true.

**No manifest can reach comparison_complete with unverified provisional evidence.**

### Impact on provisional consumers

v1.6.3 required consumers to treat provisional_verified=false as unverified.
v1.6.4: provisional_verified is always true by the time the manifest is terminal. Consumers can trust provisional evidence in terminal manifests. The consumer caveat is removed.

### DDL impact

**Zero.** The provisional_verified column already exists (from finalization addendum). Its semantics change (always true in terminal manifests), but the column type, nullability, and CHECK constraint are unchanged. The function signature change (fewer parameters) is a function definition change, not a new DDL object.

---

## M1 — Source Evidence Wording (Corrected)

### finalize_source contract, "Items required" row

v1.6.3: "At least 0 source items (empty incremental is valid)."

v1.6.4: **"Source evidence must be finalized. Zero source items are valid (empty incremental produces source_id_count=0, source_id_hash=hash of empty set)."**

The requirement is that finalize_source has been called and committed — not that source items exist. An empty incremental with zero fetched rows produces zero source items and a deterministic empty-set hash. This is valid and expected when safe_upper_bound <= watermark_before.

### finalize_comparison contract, "Items required" row

v1.6.3: "Source items must exist (from prior finalize_source)."

v1.6.4: **"Source evidence must be finalized (finalize_source must have been called and committed, producing source_id_count and source_id_hash). Zero source items are valid."**

---

## M2 — Multi-Subject Total Order (Corrected)

### Ordering comparator

When finalize_comparison must lock multiple exclusion subjects:

```
ORDER BY (identity_basis ASC, canonical_identity ASC)
```

Where:
- identity_basis: 'canonical_dedup_key' sorts before 'source_amaia_id' (lexicographic).
- canonical_identity: the excluded_amaia_id (cast to text with zero-padded prefix for numeric sort stability) for source_amaia_id basis, or excluded_canonical_key for canonical_dedup_key basis.

### Total order guarantee

This comparator produces a total order even for mixed sets where some subjects use excluded_amaia_id and others use excluded_canonical_key. The identity_basis field partitions the set; within each partition, the canonical_identity provides a deterministic sort.

### In practice for V1

V1 has exactly one non-dedup domain that uses exclusions in incremental manifests (non-dedup domains with extra detection). Dedup domains do not compute extras in incremental manifests (extras are reconciliation's responsibility). Therefore, in V1, all subjects in a single finalize_comparison call share the same identity_basis. The cross-basis ordering is a forward-compatible safeguard.

---

## M3 — Invariant 87 (Corrected)

**Invariant 87 — Exclusion state mutation serialization.**

All reads or mutations that depend on the **current mutable state** of an exclusion subject (current_investigation_id, current_investigation_seq, latest decision) MUST occur after acquiring the subject row FOR UPDATE.

The following operations are permitted **before** acquiring the subject lock, because they read only immutable data:

| Operation | Why permitted before lock |
|---|---|
| Get-or-create subject lookup (INSERT ON CONFLICT DO NOTHING) | The INSERT is idempotent. If the subject already exists, DO NOTHING. The subsequent SELECT FOR UPDATE establishes the lock. |
| Read investigation.subject_id to resolve which subject to lock | investigation.subject_id is immutable from INSERT (Trigger #6 enforces). It cannot change after the investigation is created. |

**investigation.subject_id is immutable.** Declared explicitly. Once an investigation is created with a subject_id, that field can never be modified (enforced by the append-only trigger on investigations).

---

## M4 — Watermark CAS Transactional Atomicity (Normative)

### Contract

The watermark CAS (conditional advance) MUST execute within the **same database transaction** that:

1. Writes manifest evidence (persisted_id_count, persisted_id_hash, sets_match, etc.).
2. Advances manifest phase to confirmed_compared.
3. Records exclusion consumptions (if applicable).

If sets_match = true, the watermark CAS is the **last write** before COMMIT. If the CAS fails (0 rows affected — wrong cursor, wrong type, wrong lease), the entire transaction rolls back: manifest reverts to source_fetched, no consumptions persist, no evidence is committed.

### Why this matters

Without transactional atomicity, a manifest could record sets_match=true and exclusion consumptions, but the watermark might fail to advance. The manifest would claim success, but the watermark would not have moved — the next run would re-process the same range. With atomicity: either everything commits (evidence + watermark) or nothing does.

### Where in the protocol this occurs

Transaction B (from Section 1 of the parent protocol):

1. Lock domain lease FOR UPDATE.
2. CALL amaia_sync_finalize_comparison (locks run, manifest; queries destination; inserts items; computes evidence; updates manifest; inserts consumptions).
3. If sets_match = true: execute watermark CAS.
4. COMMIT.

Steps 2 and 3 are in the same transaction. COMMIT is atomic.

---

## M5 — abandoned_by as Operational Evidence

### Declaration

The abandoned_by field on amaia_sync_run_manifests is **operational evidence** provided by the amaia_sync_recovery_runtime role. It records the identity of the recovery process that abandoned the manifest.

### What it is

- A text field set by the abandon_manifest function from the abandoned_by parameter.
- Populated by the recovery process with its operational identity (e.g., 'recovery:{engine_instance_id}:{hostname}').

### What it is not

- NOT independently authenticated by the database schema. The schema cannot verify that the text accurately represents the caller's identity.
- NOT equivalent to current_user or session_user. It is a runtime-provided string.

### Trust boundary

The trustworthiness of abandoned_by depends on:
- EXECUTE on abandon_manifest being granted only to amaia_sync_recovery_runtime.
- The recovery_runtime role being used only by legitimate recovery processes.
- Operational discipline ensuring the recovery process provides accurate identity.

This is an **operational trust boundary**, consistent with the same classification applied to other runtime-provided evidence (source items, provisional_upper_bound).

---

## Sections Preserved from v1.6.3

All sections not explicitly corrected above are incorporated by reference:

- Section 1 (Exclusion TOCTOU closure).
- Section 2 (Multi-subject deterministic ordering — ordering comparator updated in M2, architecture unchanged).
- Section 4 (Recovery authority — unchanged, including corrected healthy-run definition).
- Section 5 (Invariant 83 — unchanged, exclusion_subjects UPDATE is functional).
- Section 6 (DDL inventory framing — zero new DDL, source mapping unchanged).
- Section 7 (RLS inventory — 3 tables, 3 named policies).
- Section 8 (Trust boundary declaration consistency).
- All preserved sections from v1.6.2 (singleton, early fence, exclusion terminology, trigger/function/role/table/column/constraint/index/FK inventories).

---

## Invariants — Updates

**83 (UNCHANGED):** Leases/runs UPDATE for locking (trust boundary). Subjects UPDATE/INSERT for functional lifecycle.

**86 (UNCHANGED):** Healthy = credentials match AND lease not expired.

**87 (CORRECTED):** Exclusion state-dependent reads/mutations require subject FOR UPDATE. Immutable-data reads (investigation.subject_id, get-or-create idempotent INSERT) are permitted before lock.

**88 (UNCHANGED):** Multi-subject locking in ascending (identity_basis, canonical_identity) order.

Added:

**89.** complete_manifest performs the same 4-part lease revalidation as all other finalizers. No finalizer has a weaker authorization path.

**90.** No terminal manifest contains unverified provisional evidence. finalize_provisional computes evidence from the destination. complete_manifest rejects completion from provisional_persisted unless provisional_verified = true.

**91.** Watermark CAS executes within the same transaction as manifest evidence write, phase advancement, and exclusion consumption recording. All commit or all rollback.

**92.** abandoned_by is operational evidence from the recovery_runtime trust boundary, not schema-authenticated identity.

---

## Residual Risks

Unchanged from v1.6.3. The provisional_verified risk is removed (evidence is now always verified by the finalizer before the manifest can reach terminal state).

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External. Single orchestrator + safety lag + overlap + reconciliation. |
| Singleton is operational, not DB-enforced | Medium | Startup + scheduler lease + domain leases + monitoring. |
| Early fence is protocol, not schema | Low | Defense in depth: CAS + finalizer + reconciliation. |
| manifest_owner UPDATE on leases/runs (locking only) | Low | NOLOGIN + SECURITY DEFINER + no UPDATE DML + code review. Operational trust boundary. |
| abandoned_by not schema-authenticated | Low | EXECUTE restriction to recovery_runtime + operational discipline. Operational trust boundary. |

---

## Self-Audit

### C1: complete_manifest called without valid lease

complete_manifest locks domain_lease FOR UPDATE, validates 4-part predicate including lease_expires_at > now(). Expired → raises exception. **Revalidation parity with all finalizers.**

### C2: Terminal manifest with provisional_verified=false

finalize_provisional queries destination and computes evidence independently. Sets provisional_verified=true. complete_manifest checks: if phase='provisional_persisted' then provisional_verified must be true. false → rejection. **No unverified terminal manifest.**

### C2: Runtime fabricates provisional count/hash

finalize_provisional no longer accepts provisional_id_count or provisional_id_hash as parameters. It computes them from the destination query. The runtime provides only provisional_upper_bound (the range limit). **Fabrication eliminated.**

### M1: Empty incremental with zero source items

finalize_source with zero items produces source_id_count=0, source_id_hash=hash(""). finalize_comparison reads zero source items → S_raw is empty → P_check is empty → missing is empty → sets_match=true. **Valid empty incremental.**

### M2: Mixed dedup/non-dedup subjects in one finalize call

V1: all subjects in a single finalize_comparison share the same identity_basis (non-dedup domains use excluded_amaia_id, dedup domains don't compute extras in incremental). The cross-basis comparator (identity_basis, canonical_identity) handles the mixed case for future-proofing. **Total order guaranteed.**

### M3: Discovery read of investigation.subject_id before lock

investigation.subject_id is immutable (Trigger #6 append-only + denorm validation). Reading it before lock returns the same value as reading it after lock. The resolved subject_id is used to acquire the correct subject lock. **Safe: immutable field.**

### M4: Watermark CAS fails after manifest evidence committed

CAS and manifest evidence are in the same transaction. CAS failure → transaction rollback → manifest evidence reverted to source_fetched → no consumptions → no watermark advance. **Atomic.**

### M5: Recovery process lies about abandoned_by

abandoned_by is a text parameter. The schema does not verify it. EXECUTE is restricted to recovery_runtime. **Operational trust boundary. Declared honestly.**

---

## Document Controller Certification

| Category | Result |
|---|---|
| Inventory consistency | **PASS** — zero new DDL objects. Function signature change (fewer params) is a definition update, not a new object. |
| Cross references | **PASS** — all counts match v1.6.3 (no count changes in this revision). |
| Lock order consistency | **PASS** — complete_manifest now follows same lock order as all finalizers. |
| Privilege consistency | **PASS** — finalize_provisional destination query uses manifest_owner's SELECT on destination tables (already granted). |
| State machines | **PASS** — provisional_verified gate prevents unverified terminal. All phases reachable. No orphaned state. |
| Internal contradictions | **PASS** — no section claims provisional evidence is unverified in terminal manifests (v1.6.3 consumer caveat removed). |

**All 6 phases PASS.**

**READY FOR CODEX AUDIT.**

---

**End of document.**
