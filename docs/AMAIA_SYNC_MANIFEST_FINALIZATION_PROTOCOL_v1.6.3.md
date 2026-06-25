# AMAIA-SYNC Manifest Finalization Protocol v1.6.3

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.6.2  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code. Zero new DDL objects beyond the parent patch.

---

## Changelog v1.6.2 → v1.6.3

| # | Area | Change |
|---|---|---|
| 1 | Exclusion TOCTOU | Normative: subject lock required for investigation creation, decision insertion, and consumption. Serializes all three paths. |
| 2 | Multi-subject ordering | Normative: ascending canonical identity sort before locking. No non-deterministic iteration. |
| 3 | Finalizer contracts | Normative table per function: origin phase, locks, revalidations, evidence, atomicity, target phase, idempotency. |
| 4 | Invariant 83 | Corrected: exclusion_subjects UPDATE is functional (investigation pointer lifecycle), not locking-only. |
| 5 | DDL inventory framing | Clarified: no DDL introduced by this protocol beyond parent patch v1.6. Inventory distinguishes source of each object. |
| 6 | RLS inventory | Separated: RLS-enabled tables vs named policies. |
| 7 | Observations | Trust boundary declaration: consistent across sections (not "only Section 1"). Healthy run: requires credentials match AND lease not expired. |

---

## 1. Exclusion TOCTOU Closure

### Problem

v1.6.2 stated that subjects are locked during consumption but did not normatively require the lock for investigation creation or decision insertion. A decision could be inserted between a consumption's subject read and its commit.

### Normative contract

**Every operation that reads or modifies exclusion state for a given (domain, excluded identity) MUST acquire FOR UPDATE on the exclusion subject row before proceeding.**

| Operation | Lock required | Lock target | Serialized with |
|---|---|---|---|
| New investigation creation | Subject FOR UPDATE | The subject row for this (domain, identity) | Decisions, consumptions |
| New decision insertion | Subject FOR UPDATE (via Trigger #7 for workset, Trigger #9 for manifest exclusions) | The subject row | Investigations, consumptions |
| Exclusion consumption | Subject FOR UPDATE (within finalize_comparison) | The subject row | Investigations, decisions |

### Sequence: investigation creation (under subject lock)

1. Get-or-create subject (INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE).
2. Under lock: compute investigation_seq = current_investigation_seq + 1.
3. INSERT investigation.
4. UPDATE subject: current_investigation_id, current_investigation_seq.
5. COMMIT releases lock.

### Sequence: decision insertion (under subject lock)

1. Trigger reads investigation_id from NEW.
2. Trigger reads subject_id from investigation.
3. Trigger acquires subject FOR UPDATE.
4. Trigger verifies subject.current_investigation_id = NEW.investigation_id (vigency check).
5. Trigger computes decision_seq = MAX(seq) + 1.
6. Trigger allows INSERT to proceed.
7. COMMIT releases lock.

### Sequence: consumption (under subject lock, within finalize_comparison)

1. Finalizer acquires subject FOR UPDATE (within the fenced transaction that already holds domain lease + run + manifest locks).
2. Reads subject.current_investigation_id.
3. Reads latest decision by MAX(decision_seq) for that investigation.
4. Verifies decision = 'approved'.
5. Records investigation_hash_at_consumption = investigation.investigation_hash.
6. Inserts consumption record.
7. All atomic with manifest update and watermark advance.

### Why this eliminates TOCTOU

All three paths lock the same subject row. PostgreSQL FOR UPDATE serializes them. No two of these operations can interleave for the same subject. The consumption's read of "current investigation" and "latest decision" is stable from lock acquisition through commit.

---

## 2. Multi-Subject Deterministic Ordering

### Normative rule

When finalize_comparison processes multiple extra_raw elements (non-dedup) or multiple exclusion subjects:

1. Collect all subject identities to be locked.
2. **Sort ascending by canonical identity** (excluded_amaia_id for non-dedup, excluded_canonical_key for dedup — lexicographic).
3. Lock subjects in that sorted order.
4. Process each subject under its lock.

### Prohibited iteration orders

- Order of appearance in extra_raw computation.
- Order of arrival from runtime.
- JSON array order.
- Hash order.
- Random or non-deterministic order.

### Why ascending canonical identity

This is the same ordering used throughout the architecture for multi-lock scenarios (established in Schema Patch v1.2.1, Correction C — Global Lease Ordering). Using a stable, deterministic sort prevents deadlock if two concurrent transactions (in a future multi-worker scenario) need overlapping subject sets.

---

## 3. Normative Finalizer Contracts

### 3.1 amaia_sync_finalize_source

| Aspect | Specification |
|---|---|
| **Origin phase** | created |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE |
| **Revalidations under lock** | Lease: 4-part ownership predicate. Run: status='running', owner_identity=lease.owner_identity, lease_token=lease.lease_token, domain_name=manifest.domain_name. Manifest: phase='created', run_id=param. |
| **Evidence computed** | source_id_count: count of DISTINCT identity elements from source items. source_id_hash: SHA-256 of sorted elements. |
| **Items required** | At least 0 source items (empty incremental is valid). |
| **Atomic write** | source_id_count + source_id_hash + phase='source_fetched' in a single UPDATE. |
| **Target phase** | source_fetched |
| **Idempotency** | NOT idempotent. A second call on the same manifest in phase='source_fetched' is rejected (wrong origin phase). |
| **Late evidence rejection** | After this function commits, Trigger #11 rejects source items (role='source' not allowed at phase='source_fetched'). |

### 3.2 amaia_sync_finalize_comparison

| Aspect | Specification |
|---|---|
| **Origin phase** | source_fetched |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE → exclusion_subjects FOR UPDATE (ascending identity, only if exclusions apply) |
| **Revalidations under lock** | Same as finalize_source, except manifest phase='source_fetched'. |
| **Evidence computed** | P_set/P_check from destination query. missing/extra derived from S_raw vs P. persisted_id_count, persisted_id_hash. sets_match. missing_ids/extra_ids JSONB. verified_at. |
| **Items required** | Source items must exist (from prior finalize_source). Finalizer inserts: persisted, missing, extra (non-dedup), excluded (non-dedup with exclusions). |
| **Exclusion processing** | For each extra_raw element (ascending identity order): lock subject → read current investigation → read latest decision → validate approved → record consumption (only after manifest UPDATE with sets_match=true). |
| **Atomic write** | persisted_id_count + persisted_id_hash + sets_match + missing_ids + extra_ids + verified_at + phase='confirmed_compared' in a single UPDATE. Exclusion consumptions inserted after this UPDATE (trigger #8 reads sets_match=true from same transaction). |
| **Target phase** | confirmed_compared |
| **Idempotency** | NOT idempotent. Second call rejected (wrong origin phase). |
| **Late evidence rejection** | After commit, Trigger #11 rejects persisted/missing/extra/excluded items (no roles allowed at confirmed_compared). |
| **comparison_complete eligibility** | Only after this function returns. complete_manifest validates phase IN ('confirmed_compared', 'provisional_persisted'). |

### 3.3 amaia_sync_finalize_provisional

| Aspect | Specification |
|---|---|
| **Origin phase** | confirmed_compared |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE |
| **Revalidations under lock** | Same pattern. Manifest phase='confirmed_compared'. |
| **Evidence computed** | None computed by finalizer. provisional_upper_bound, provisional_id_count, provisional_id_hash are runtime-provided parameters. |
| **Items required** | None (provisional evidence is parameter-based, not item-based). |
| **Atomic write** | provisional_upper_bound + provisional_id_count + provisional_id_hash + provisional_verified=false + phase='provisional_persisted'. |
| **Target phase** | provisional_persisted |
| **Idempotency** | NOT idempotent. |
| **Late evidence** | N/A (no items for provisional). |
| **Note** | provisional_verified=false marks evidence as unverified (runtime-provided). |

### 3.4 amaia_sync_complete_manifest

| Aspect | Specification |
|---|---|
| **Origin phase** | confirmed_compared OR provisional_persisted |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE |
| **Revalidations under lock** | Manifest phase IN ('confirmed_compared', 'provisional_persisted'). |
| **Evidence computed** | provisional_skipped: set to true if raw_max_id > confirmed upper_bound AND phase='confirmed_compared' (provisional zone existed but was not processed). |
| **Atomic write** | provisional_skipped (if applicable) + phase='comparison_complete'. All other columns frozen. |
| **Target phase** | comparison_complete (terminal) |
| **Idempotency** | NOT idempotent. Second call on terminal phase rejected by Trigger #4. |
| **Conditions for comparison_complete** | phase must be confirmed_compared or provisional_persisted. No other precondition. The function does NOT validate sets_match — a manifest with sets_match=false can be completed (it records the failure). |

### 3.5 amaia_sync_abandon_manifest

| Aspect | Specification |
|---|---|
| **Origin phase** | Any non-terminal (created, source_fetched, confirmed_compared, provisional_persisted) |
| **Locks (in order)** | domain_lease FOR UPDATE → sync_run FOR UPDATE → manifest FOR UPDATE |
| **Revalidations under lock** | Manifest phase not terminal. manifest.run_id = run.id. Run in recoverable state (see Section 4). |
| **Evidence required** | abandoned_by (text, non-empty): recovery process operational identity. abandoned_reason (text, non-empty): why. abandoned_at: set by function to now(). |
| **Atomic write** | abandoned_by + abandoned_at + abandoned_reason + phase='abandoned'. All other columns frozen. |
| **Target phase** | abandoned (terminal) |
| **Idempotency** | NOT idempotent. Second call on terminal rejected. |
| **EXECUTE** | Granted only to amaia_sync_recovery_runtime. |

---

## 4. Recovery Authority (unchanged from v1.6.2, with lease expiry clarification)

### Healthy run definition (corrected)

A run is healthy if and only if ALL of the following are true:
- run.owner_identity = current domain lease owner_identity.
- run.lease_token = current domain lease lease_token.
- **Current domain lease lease_expires_at > now()** (the lease is temporally valid).

If the lease has expired (lease_expires_at <= now()) but credentials still match: the run is NOT healthy. It is stale. Abandon is permitted because the lease expiry means the original owner stopped heartbeating — it is effectively orphaned even if credentials match.

### Abandon condition table (corrected)

| run.status | Abandon permitted? | Condition |
|---|---|---|
| orphan_recovered | Yes | None. |
| failed | Yes | None. |
| running | Only if stale | run credentials != current lease credentials, OR current lease expired (lease_expires_at <= now()). |
| running (healthy) | Never | Credentials match AND lease not expired. |
| success | Never | — |
| skipped_lock_held | Never | — |

---

## 5. Invariant 83 (Corrected)

**Invariant 83 — UPDATE privileges on leases, runs, and subjects.**

- **amaia_sync_leases:** manifest_owner has UPDATE exclusively to enable FOR UPDATE row locking. Finalizers do NOT issue UPDATE DML against leases. This is an operational trust boundary.
- **amaia_sync_runs:** Same as leases. Finalizers do NOT issue UPDATE DML against runs. Operational trust boundary.
- **amaia_sync_manifest_exclusion_subjects:** manifest_owner has UPDATE for **functional purposes**: updating current_investigation_id and current_investigation_seq during investigation creation and exclusion processing. This is NOT locking-only — it is a legitimate lifecycle operation. Additionally, INSERT is granted for the get-or-create pattern.

---

## 6. DDL Inventory Framing

### What this protocol introduces

**Zero new DDL objects.** All tables, columns, triggers, functions, roles, constraints, indexes, and RLS policies enumerated below were introduced by the parent patch (Schema Patch v1.6 and its finalization protocol addendum). This protocol (v1.6.3) documents and norms their behavior. It does not create anything new.

### Inventory source mapping

| Object category | Introduced by | Documented/normed by |
|---|---|---|
| 3 new tables | Schema Patch v1.6 | This protocol |
| 16 new columns on existing tables | Schema Patch v1.6 + finalization addendum | This protocol |
| 5 nullability changes | Schema Patch v1.6 + finalization addendum | This protocol |
| 21 CHECK constraints | Schema Patch v1.6 + finalization addendum | This protocol |
| 12 indexes | Schema Patch v1.6 | This protocol |
| 3 FKs | Schema Patch v1.6 | This protocol |
| 7 new triggers (#10–#16) | Schema Patch v1.6 | This protocol |
| 3 updated triggers (#4, #6, #9) | Schema Patch v1.6 + finalization addendum | This protocol |
| 5 SECURITY DEFINER functions | Finalization protocol addendum | This protocol |
| 3 roles | Finalization protocol addendum | This protocol |
| 3 RLS-enabled tables with policies | Schema Patch v1.6 | This protocol |

---

## 7. RLS Inventory (Corrected)

### RLS-enabled tables (3)

| Table | RLS enabled |
|---|---|
| amaia_sync_manifest_identity_items | Yes |
| amaia_sync_domain_identity_policies | Yes |
| amaia_sync_dedup_identity_memberships | Yes |

### Named RLS policies (3)

Each table receives one policy following the established project pattern:

| Table | Policy name (logical) | cmd | roles | qual pattern |
|---|---|---|---|---|
| identity_items | identity_items_select_admin | SELECT | {authenticated} | get_user_role() IN ('admin', 'super_admin') |
| domain_identity_policies | domain_policies_select_admin | SELECT | {authenticated} | get_user_role() IN ('admin', 'super_admin') |
| dedup_identity_memberships | memberships_select_admin | SELECT | {authenticated} | get_user_role() IN ('admin', 'super_admin') |

Each policy is a single SELECT policy restricted to admin/super_admin, matching the pattern deployed in 9.3B for all other sync tables.

---

## 8. Trust Boundary Declaration (Corrected)

### Where the operational trust boundary is declared

The statement "manifest_owner UPDATE privilege on leases/runs is an operational trust boundary, not schema enforcement" appears in:

- **Section 5 (Invariant 83):** As part of the privilege characterization.
- **Residual risks table:** As a risk with mitigation.
- **Self-audit:** As an explicitly tested scenario.

All three references are consistent. No section claims schema enforcement for this boundary.

---

## Sections Preserved from v1.6.2

The following sections are incorporated by reference without modification:

- Section 2 (Abandon protocol — unified lock order).
- Section 4 (Singleton declaration).
- Section 5 (Early fence declaration).
- Section 6 (Exclusion validation terminology — "current investigation validation" only).
- Triggers inventory (16 total: 6 unchanged, 3 updated, 7 new — all by name).
- Functions inventory (5 SECURITY DEFINER — all by name).
- Roles inventory (3, all new — by name).
- Tables inventory (3 new).
- Columns inventory (16 on existing tables).
- Nullability changes (5).
- CHECK constraints (21 by logical name).
- Indexes (12 by logical name).
- FKs (3).
- Seed data (7 + 3 separate).

---

## Invariants — Definitive

All prior invariants preserved. Corrections:

**83 (CORRECTED):** manifest_owner has UPDATE on leases and runs for FOR UPDATE row locking (operational trust boundary — finalizers contain no UPDATE DML against these tables). manifest_owner has UPDATE and INSERT on exclusion_subjects for functional lifecycle operations (investigation pointer advancement, get-or-create). These are legitimate modifications, not locking-only.

**84 (UNCHANGED):** Uniform abandon lock order: domain_lease → run → manifest.

**85 (UNCHANGED):** Current investigation validation. No external re-query.

**86 (CORRECTED):** Healthy runs cannot be abandoned. A healthy run requires: credentials match current lease AND lease_expires_at > now(). An expired lease with matching credentials = stale, not healthy. Abandon permitted.

Added:

**87.** All exclusion state mutations (investigation creation, decision insertion, consumption) serialize on the exclusion subject row via FOR UPDATE. No exclusion operation proceeds without the subject lock.

**88.** Multi-subject locking uses ascending canonical identity order. Non-deterministic iteration orders are prohibited.

---

## Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External to manifest subsystem. Single orchestrator + safety lag + overlap + reconciliation. |
| Singleton is operational, not DB-enforced | Medium | Startup validation + scheduler lease + domain leases + monitoring. Multi-process with shared credentials is unsupported V1 scenario. |
| Early fence is protocol, not schema | Low | Defense in depth: CAS + finalizer + reconciliation catch unfenced write effects. |
| manifest_owner UPDATE on leases/runs is operationally constrained, not schema-enforced | Low | NOLOGIN owner + SECURITY DEFINER + reviewed function bodies contain no UPDATE DML against leases/runs + code review + operational audit. Operational trust boundary. |
| manifest_owner UPDATE on exclusion_subjects is functional | Accepted | Legitimate lifecycle operation (investigation pointer). Part of the approved architecture. |

---

## Self-Audit

### Exclusion TOCTOU: decision inserted between consumption's subject read and commit

Attack: Consumption locks subject, reads approved decision D1. Concurrently, operator inserts decision D2 (rejected).

Result: Decision insertion trigger acquires subject FOR UPDATE → blocks (consumption holds the lock). Operator waits. Consumption commits with D1 (valid at time of lock). D2 is inserted after consumption releases. Next consumption cycle reads D2 → rejected → no consumption. **Serialized by subject lock.**

### Multi-subject deadlock: two finalizers lock subjects in different order

Attack: Finalizer A needs subjects {5, 10}. Finalizer B needs subjects {10, 5}. A locks 5, B locks 10. Deadlock.

Result: Both sort ascending: {5, 10}. A locks 5, B waits for 5. A locks 10, processes, commits. B proceeds. **Deterministic order prevents deadlock.**

### Finalizer called twice on same manifest

Attack: finalize_source called, manifest advances to source_fetched. finalize_source called again.

Result: Origin phase check: expects 'created', finds 'source_fetched'. Raises exception. **NOT idempotent by design.**

### Late source items after finalize_source

Attack: Runtime inserts source item after manifest is at source_fetched.

Result: Trigger #11: role='source' not allowed at phase='source_fetched'. Rejected. **Phase-enforced.**

### Manifest completed with sets_match=false

Attack: finalize_comparison sets sets_match=false. complete_manifest called.

Result: complete_manifest does NOT validate sets_match. A manifest recording a failed comparison CAN be completed. This is correct: the manifest records the failure, not asserts success. The watermark was NOT advanced (sets_match=false prevents that in the runtime's transaction). **By design.**

### Abandon of run with expired but matching credentials

Attack: Run has owner_identity='X', lease_token=5. Current lease has owner_identity='X', lease_token=5, but lease_expires_at is in the past.

Result: Invariant 86 (corrected): healthy requires credentials match AND lease not expired. Lease expired → not healthy → abandon permitted. The original owner stopped heartbeating. **Corrected in v1.6.3.**

### manifest_owner issues UPDATE against lease

Result: Operationally constrained. NOLOGIN + SECURITY DEFINER + reviewed static function bodies + no dynamic SQL. **Operational trust boundary. Declared honestly.**

### Trust boundary appears in multiple sections

Result: Appears in Section 5 (Invariant 83), residual risks, and self-audit. All consistent. No section claims schema enforcement. **Consistent across document.**

### Trigger count

6 unchanged + 3 updated + 7 new = 16. All listed by name. **Verified.**

### Index count

12 indexes listed by name. Heading says "(12)". Total says "12." **Consistent.**

---

## Document Controller Certification

| Category | Result |
|---|---|
| Inventory consistency | **PASS** — all counts verified per v1.6.2 certification + corrections applied |
| Cross references | **PASS** — no count contradicts another |
| Lock order consistency | **PASS** — all sections follow canonical order; exclusion subjects locked in ascending identity |
| Privilege consistency | **PASS** — Invariant 83 corrected to distinguish locking-only (leases/runs) from functional (subjects) |
| State machines | **PASS** — manifest phases complete; abandon conditions cover all 6 run statuses including expired-but-matching |
| Internal contradictions | **PASS** — trust boundary declaration consistent across 3 sections; no section claims schema enforcement |

**All 6 phases PASS.**

**READY FOR CODEX AUDIT.**

---

**End of document.**
