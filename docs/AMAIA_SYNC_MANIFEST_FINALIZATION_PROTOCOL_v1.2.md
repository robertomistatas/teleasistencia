# AMAIA-SYNC Manifest Finalization Protocol v1.2

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.1 (runtime could fabricate persisted items, session_user misuse, late-item races, lock order gaps, abandon too open)  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.1's core flaw: the runtime inserted persisted items directly, allowing fabrication. v1.2 removes ALL derived-evidence INSERT privilege from the runtime. The runtime inserts only the manifest shell and source items. Everything else — persisted set query, difference derivation, item insertion, hash computation, phase advancement — is done by SECURITY DEFINER finalizer functions that query the destination directly under the domain fence.

---

## Changes from v1.1

| # | Issue | v1.1 | v1.2 |
|---|---|---|---|
| 1 | Persisted items | Runtime inserts | **Finalizer queries destination and inserts** |
| 2 | Trigger #11 caller check | session_user + pg_has_role | **current_user** (correct for SECURITY DEFINER) |
| 3 | Late-item race | Undocumented | **Trigger #11 locks manifest FOR SHARE before phase check** |
| 4 | Lock order | Caller pre-locks, finalizer re-locks | **Finalizer acquires all locks internally in canonical order** |
| 5 | Worker auth | owner_identity/lease_token only | **Decision: single runtime role + lease token is the claim (Option C justified)** |
| 6 | abandon_manifest | Any caller, no evidence | **Restricted to recovery role + evidence columns** |
| 7 | Exclusions | Undefined lock order | **Subject locks in ascending order within finalizer** |
| 8 | Provisional | Runtime-provided, unverified | **Marked unverified; finalizer records flag** |
| 9 | complete_manifest | Simple phase flip | **Validates provisional expectation** |

---

## 1. Privilege Model

### Roles (3)

**amaia_sync_manifest_owner:** NOLOGIN. Owns finalizer functions. Has UPDATE on manifests, INSERT on identity_items (all roles).

**amaia_sync_runtime:** The engine's connection role. Used for normal sync operations.

**amaia_sync_recovery_runtime:** Used by the recovery/scheduler process. Same person/process may use this role for recovery-specific operations.

### Grants

| Object | runtime | recovery_runtime | manifest_owner | PUBLIC |
|---|---|---|---|---|
| manifests | INSERT, SELECT | SELECT | UPDATE | (none) |
| identity_items | INSERT (source role only — trigger enforced), SELECT | SELECT | INSERT (all roles) | (none) |
| finalize_source | EXECUTE | — | (owner) | REVOKE |
| finalize_comparison | EXECUTE | — | (owner) | REVOKE |
| finalize_provisional | EXECUTE | — | (owner) | REVOKE |
| complete_manifest | EXECUTE | — | (owner) | REVOKE |
| abandon_manifest | — | EXECUTE | (owner) | REVOKE |
| Other sync tables | As needed | As needed | — | (none) |

**Key change:** Runtime has INSERT on identity_items but trigger #11 rejects any role except 'source'. The privilege is needed for the INSERT statement to reach the trigger; the trigger is the policy.

**service_role / trust boundary:** If the engine connects via Supabase service_role (which bypasses RLS and has broad privileges), the trigger-based enforcement still applies (triggers fire regardless of role). The INSERT role check via current_user within the trigger is the definitive control. The service_role IS NOT amaia_sync_manifest_owner → derived items rejected. If service_role must be used: it should NOT be made a member of manifest_owner.

---

## 2. Lock Order — Total and Canonical

Every function and transaction acquires locks in this exact order. No exceptions.

```
1. scheduler lease (entity_name='scheduler')     — if cycle operation
2. cycle row                                       — if cycle operation
3. domain lease (entity_name=domain)               — always for domain ops
4. sync_run row                                    — always
5. manifest row                                    — always for manifest ops
6. exclusion subjects (ascending excluded_id)      — if exclusion consumption
7. identity_items operations                       — after all locks held
```

### Runtime's fenced transaction

The runtime acquires the domain lease (Step 3) as part of its fenced transaction. It then calls a finalizer function. The finalizer does NOT re-acquire the domain lease — it validates it. The runtime already holds the lock; the finalizer runs in the same transaction.

**Critical:** The runtime MUST acquire the domain lease BEFORE calling any finalizer. The finalizer validates (reads the locked row) but does not acquire. This avoids double-locking the same row and maintains the canonical order (domain lease before manifest).

### Finalizer internal lock sequence

Each finalizer:
1. Validates the domain lease (already locked by caller — reads and checks without FOR UPDATE).
2. Locks sync_run FOR UPDATE (Step 4).
3. Locks manifest FOR UPDATE (Step 5).
4. Performs computation and mutation.

The finalizer does NOT lock the domain lease FOR UPDATE itself — the caller already holds it. The finalizer reads the lease row to validate ownership. In PostgreSQL, reading a row locked by the same transaction is non-blocking (same transaction holds the lock).

---

## 3. Trigger #11 — Corrected

**Table:** amaia_sync_manifest_identity_items  
**Event:** BEFORE INSERT OR UPDATE OR DELETE

### On UPDATE or DELETE

Raise exception (append-only).

### On INSERT

1. **Lock manifest FOR SHARE:** SELECT ... FROM manifests WHERE id = NEW.manifest_id FOR SHARE. This prevents the finalizer from advancing the phase while items are being inserted. FOR SHARE (not FOR UPDATE) allows concurrent reads but blocks UPDATE (which is what the finalizer does).

   Wait — the finalizer and the item insertion are in the SAME transaction. FOR SHARE within the same transaction that already holds FOR UPDATE is non-blocking (compatible). And if they're in different transactions: FOR SHARE blocks the UPDATE until the SHARE lock is released. This prevents late items.

   **Simplification:** Since source items and finalize_source are always in the same transaction, and the finalizer locks FOR UPDATE within that same transaction, the FOR SHARE within the trigger is compatible. For cross-transaction scenarios (which shouldn't happen for the same manifest): FOR SHARE blocks the finalizer's UPDATE until the item INSERT transaction commits.

2. **Read manifest.phase and manifest.identity_basis.**

3. **Phase-role check:**

| Manifest phase | Allowed roles | Allowed caller |
|---|---|---|
| created | source | Any (runtime) |
| source_fetched | persisted, missing, extra, excluded | manifest_owner only |
| All other phases | (none) | — |

4. **Caller check for non-source roles:** If NEW.item_role != 'source':
   - Verify `current_user = 'amaia_sync_manifest_owner'`. In SECURITY DEFINER functions, current_user reflects the function owner — which IS amaia_sync_manifest_owner. For runtime callers (not inside a SECURITY DEFINER function), current_user is amaia_sync_runtime — check fails, INSERT rejected.

5. **Identity coherence** (canonical_key regex, decomposed fields, identity_basis match manifest — unchanged).

6. RETURN NEW.

### Why current_user, not session_user

In SECURITY DEFINER functions, `current_user` returns the function owner's role. `session_user` returns the original connecting role. We want to check whether the current execution context has manifest_owner authority — `current_user` is correct.

---

## 4. Finalizer APIs — Runtime Inserts ONLY Manifest + Source Items

### What the runtime does (before calling finalizers)

1. INSERT manifest (phase='created', identity columns, raw_max_id).
2. INSERT source identity_items (item_role='source'). One per fetched source row.
3. Call finalize_source.

The runtime does NOT:
- INSERT persisted items.
- INSERT missing/extra/excluded items.
- UPDATE the manifest.
- Compute hashes, counts, or differences.

### 4.1 amaia_sync_finalize_source

**Parameters:** manifest_id uuid, run_id uuid, lease_token bigint

**Authorization (within caller's fenced transaction — domain lease already locked by caller):**

1. Read domain lease for manifest.domain_name. Validate: lease_token = param, owner_identity IS NOT NULL, lease_expires_at > now(). (Read, not FOR UPDATE — caller already holds lock.)
2. SELECT ... FROM sync_runs WHERE id = run_id FOR UPDATE. Validate: status='running', domain_name matches manifest, lease_token matches.
3. SELECT ... FROM manifests WHERE id = manifest_id FOR UPDATE. Validate: phase='created', run_id matches.

**Computation:**

4. Read source items WHERE manifest_id AND item_role='source'.
5. Compute S_raw, source_id_count, source_id_hash per identity_basis.
6. UPDATE manifest: source_id_count, source_id_hash, phase='source_fetched'.

### 4.2 amaia_sync_finalize_comparison

**Parameters:** manifest_id uuid, run_id uuid, lease_token bigint

**Authorization:** Same pattern, validates phase='source_fetched'.

**Computation — the finalizer queries the destination directly:**

4. Read manifest.domain_name, manifest.identity_basis.
5. Read source items → compute S_raw.

**For non-dedup:**

6. Query the destination table directly: SELECT amaia_id FROM public.amaia_{destination} WHERE amaia_id > :lower_bound AND amaia_id <= :upper_bound. This produces P_raw.
7. INSERT persisted identity_items (role='persisted') for each element of P_raw. (current_user = manifest_owner → trigger #11 allows.)
8. Compute missing_raw = S_raw \ P_raw.
9. Compute extra_raw = P_raw \ S_raw.
10. Load approved exclusions: for each extra_raw element, lock subject FOR UPDATE (ascending order), read current investigation, latest decision, verify approved + hash. Compute extras_excluded.
11. Compute extra = extra_raw - extras_excluded.
12. INSERT identity_items for missing, extra, excluded.
13. INSERT exclusion consumptions.
14. persisted_id_hash = hash(P_raw - extras_excluded). persisted_id_count = |P_raw - extras_excluded|.
15. sets_match = missing empty AND extra empty.

**For dedup:**

6. Read source items → S_raw (distinct canonical keys).
7. Query destination: SELECT beneficiary_amaia_id, hash, hash_version FROM public.amaia_health_{table} WHERE (beneficiary_amaia_id, hash, hash_version) IN (values from S_raw canonical key decomposition). This produces P_check.
8. INSERT persisted identity_items (role='persisted') for each P_check element.
9. missing = S_raw \ P_check.
10. INSERT missing items.
11. No extras computed.
12. persisted_id_hash = hash(P_check). persisted_id_count = |P_check|.
13. sets_match = missing empty.

**Update:**

16. Assemble missing_ids/extra_ids JSONB.
17. UPDATE manifest: all comparison fields, phase='confirmed_compared'.
18. Return sets_match.

### 4.3 amaia_sync_finalize_provisional

**Parameters:** manifest_id uuid, run_id uuid, lease_token bigint, provisional_upper_bound bigint

**Authorization:** Same pattern, validates phase='confirmed_compared'.

**Computation:**

4. Read manifest.domain_name, identity_basis.
5. Query AMAIA for provisional zone (provisional_upper_bound, raw_max_id] — wait, the finalizer cannot query AMAIA (it's a PostgreSQL function, AMAIA is MySQL).

**Revised approach for provisional:** The runtime provides provisional_upper_bound. The finalizer does NOT independently verify provisional data (cannot reach AMAIA). Instead:

6. The manifest records: provisional_upper_bound = param, provisional_verified = false (see Section 8).
7. provisional_id_count and provisional_id_hash: the runtime passes these as parameters. The finalizer writes them with the explicit flag provisional_verified = false.
8. UPDATE manifest: provisional fields + flag, phase='provisional_persisted'.

### 4.4 amaia_sync_complete_manifest

**Parameters:** manifest_id uuid, run_id uuid, lease_token bigint

**Authorization:** Same pattern, validates phase IN ('confirmed_compared', 'provisional_persisted').

**Validation:**

4. Read manifest.raw_max_id and the confirmed upper_bound (from sync_run or computed from source_id context).
5. If raw_max_id > confirmed_upper_bound AND manifest.phase = 'confirmed_compared' (no provisional processed):
   - Record in manifest: provisional_skipped = true, provisional_skip_reason = 'not_processed'.
   - This is informational — it does not block completion. The provisional zone will be processed in a future cycle.
6. UPDATE manifest: phase='comparison_complete'.

### 4.5 amaia_sync_abandon_manifest

**Parameters:** manifest_id uuid, run_id uuid, abandoned_by text, reason text

**Authorization (restricted):**

1. Verify current_user IN ('amaia_sync_recovery_runtime', 'amaia_sync_manifest_owner'). If not: raise 'abandon requires recovery authority'.
2. Lock manifest FOR UPDATE. Validate phase not terminal.
3. Validate the referenced run_id exists and is in a terminal or recoverable state (status IN ('running', 'orphan_recovered', 'failed')). This prevents abandoning a manifest for an active, healthy run.

**Update:**

4. UPDATE manifest: phase='abandoned', abandoned_by = param, abandoned_at = now(), abandoned_reason = param.

---

## 5. Worker Authentication — Option C: Lease Token as Claim

### Decision

Each worker uses the same database role (amaia_sync_runtime). The lease_token parameter in finalizer calls serves as the authorization claim: only the process that acquired the lease knows the current token.

### Why this is sufficient

- The lease_token is obtained during lease acquisition (atomic conditional UPDATE). Only the acquirer sees the returned token.
- Another worker observing the token via SELECT can see it, but cannot use it to call the finalizer because: the finalizer validates that the lease row's current token AND owner_identity match the parameters. If another worker passes the observed token but a different owner_identity: mismatch → rejected. If the same owner_identity: the second worker would need the exact same identity string (hostname:pid:engine_id:run_id), which requires being the same process.

### Residual risk

If two processes share the exact same owner_identity (same hostname, same PID — e.g., after process restart with PID reuse before engine_instance_id change): the engine_instance_id component (UUID generated at boot) makes collision practically impossible.

### Why separate connection roles are NOT required

Separate roles per worker would require dynamic role creation/destruction — operationally complex and incompatible with connection pooling. The lease token + owner_identity combination provides equivalent authorization without role management overhead.

---

## 6. Abandon Protocol — Restricted

### Who can abandon

Only `amaia_sync_recovery_runtime` or `amaia_sync_manifest_owner` (via current_user check in the function).

### What abandon validates

1. The manifest is not already terminal.
2. The referenced run exists and is in a recoverable state.
3. The caller provides abandoned_by (identity) and reason (text, non-empty).

### New columns on amaia_sync_run_manifests

| Column | Type | Nullable | Description |
|---|---|---|---|
| abandoned_by | text | NULL | Identity of the process that abandoned. NULL if not abandoned. |
| abandoned_at | timestamptz | NULL | When abandoned. |
| abandoned_reason | text | NULL | Why. CHECK: NULL or length > 0. |

These are populated ONLY by abandon_manifest. They are NULL in all other terminal states.

### Trigger #4 update

On transition to 'abandoned': abandoned_by, abandoned_at, abandoned_reason must become NOT NULL (validated by trigger). On all other transitions: these columns must remain NULL (frozen at NULL).

---

## 7. Exclusion Protocol Within Finalizer

During finalize_comparison for non-dedup domains, the finalizer handles exclusions:

1. Compute extra_raw = P_raw \ S_raw.
2. For each element in extra_raw (in ascending identity order for deterministic locking):
   a. Get-or-create exclusion subject (INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE).
   b. Read subject.current_investigation_id.
   c. If NULL: no investigation → no exclusion available. Element stays in extra.
   d. Read latest decision by MAX(decision_seq).
   e. If not approved: element stays in extra.
   f. Verify investigation hash (live recomputation not applicable for non-dedup — hash is from the investigation record, compared against investigation_hash_at_consumption).
   g. If approved + hash valid: element is excluded. Insert consumption record. Insert excluded item.

**Lock order for subjects:** ascending by excluded_amaia_id (or excluded_canonical_key for dedup reconciliation). This matches the global ordering defined for multi-subject consumption.

**Concurrency with operator decisions:** Both the finalizer (consumption) and the operator (decision insertion) lock the subject. Serialized. If the operator inserts a rejection between the finalizer's decision read and commit: the finalizer already holds the subject lock — the operator's INSERT blocks until the finalizer commits.

---

## 8. Provisional Evidence — Explicitly Unverified

### New column on amaia_sync_run_manifests

| Column | Type | Nullable | Description |
|---|---|---|---|
| provisional_verified | boolean | NULL | NULL = no provisional. false = unverified runtime evidence. true = reserved for future verification. |

### Contract

- finalize_provisional sets provisional_verified = false.
- The manifest records that provisional evidence EXISTS but is NOT independently verified by the finalizer.
- An auditor seeing provisional_verified = false knows: these values were provided by the runtime, not computed from items.
- A future enhancement could add provisional items and a verification step. For V1: unverified is acceptable because provisional data is re-verified when promoted to the confirmed range.

### No fabrication risk

Provisional evidence with provisional_verified = false cannot produce a false terminal manifest. The confirmed comparison (phase = 'confirmed_compared') was verified by the finalizer. The provisional evidence is additive informational context, not a safety assertion.

---

## 9. complete_manifest — Context-Aware

### Validation

1. If raw_max_id is NOT NULL and raw_max_id > confirmed_upper_bound:
   - If phase = 'confirmed_compared' (no provisional): provisional was skipped. Record provisional_skipped = true.
   - If phase = 'provisional_persisted': provisional was processed. OK.
2. If raw_max_id IS NULL or raw_max_id <= confirmed_upper_bound: no provisional expected. OK.

### New column

| Column | Type | Nullable |
|---|---|---|
| provisional_skipped | boolean | NULL |

NULL = not applicable or not evaluated. true = provisional zone existed but was not processed. false = not used (omitted).

---

## 10. SECURITY DEFINER Hardening

Each of the 5 functions:

- **Owner:** amaia_sync_manifest_owner (NOLOGIN).
- **manifest_owner is NOT a member of** superuser, service_role, or any broad admin role.
- **SET search_path = 'public'** (or 'pg_catalog, public' for maximum safety).
- **All table references fully qualified:** public.amaia_sync_run_manifests, public.amaia_sync_manifest_identity_items, etc.
- **No dynamic SQL.** All queries are static with parameterized values.
- **EXECUTE revoked from PUBLIC.**
- **EXECUTE granted only to:** amaia_sync_runtime (for finalize_source/comparison/provisional/complete), amaia_sync_recovery_runtime (for abandon_manifest).
- **Runtime and recovery roles do NOT have UPDATE or DELETE on manifests or identity_items.**
- **PUBLIC has no INSERT, UPDATE, or DELETE on manifests or identity_items.** Only the roles explicitly granted have access.

---

## 11. Privileges Inventory

### amaia_sync_runtime

| Object | Privilege |
|---|---|
| manifests | INSERT, SELECT |
| identity_items | INSERT, SELECT |
| finalize_source | EXECUTE |
| finalize_comparison | EXECUTE |
| finalize_provisional | EXECUTE |
| complete_manifest | EXECUTE |
| abandon_manifest | (none) |
| Other sync tables | INSERT, SELECT, UPDATE as needed for domain processing |

### amaia_sync_recovery_runtime

| Object | Privilege |
|---|---|
| manifests | SELECT |
| identity_items | SELECT |
| abandon_manifest | EXECUTE |
| finalize_source/comparison/provisional/complete | (none) |

### amaia_sync_manifest_owner

| Object | Privilege |
|---|---|
| manifests | UPDATE (for finalizer functions) |
| identity_items | INSERT (all roles, for finalizer-inserted items) |
| Destination tables (health_conditions, medications, etc.) | SELECT (for finalize_comparison destination queries) |
| exclusion subjects/investigations/decisions/consumptions | SELECT, INSERT (for exclusion consumption during finalize_comparison) |

### PUBLIC

| Object | Privilege |
|---|---|
| manifests | (none) |
| identity_items | (none) |
| All 5 functions | (REVOKE EXECUTE) |

### service_role trust boundary

If the engine uses Supabase service_role: triggers still fire (trigger enforcement). current_user for service_role is typically 'postgres' or 'service_role' — NOT 'amaia_sync_manifest_owner'. Derived items (missing/extra/excluded) are rejected by trigger #11's current_user check. Service_role can INSERT source items (trigger allows 'source' from any caller). **Service_role cannot fabricate derived evidence.**

---

## 12. Source Observations Boundary — Honest Declaration

### What the manifest guarantees

The manifest guarantees coherence between:
- Source items recorded (what the runtime declared it fetched).
- Persisted items verified (what the finalizer confirmed exists in the destination).
- Differences derived (missing/extra computed by the finalizer from the above).
- Hashes computed (from items by the finalizer).

### What the manifest does NOT guarantee

- **AMAIA source completeness.** The manifest trusts that the runtime fetched the correct rows from AMAIA. If the runtime fabricated or omitted source rows, the manifest's source items are wrong. This is the external trust boundary.
- **Mitigated by:** Safety lag + overlap (reduces gap probability). Set-identity hash (proves fetched == persisted). Reconciliation (detects drift over time). The manifest cannot close this boundary — it's inherent to any system without CDC/binlog access.

---

## 13. Membership and Tombstone Hardening

### Membership episode_seq

Trigger #14 (membership_guard) on INSERT validates: episode_seq = (SELECT COALESCE(MAX(episode_seq), 0) + 1 FROM memberships WHERE domain_name = NEW.domain_name AND source_amaia_id = NEW.source_amaia_id). This ensures sequential, gap-free episode numbering.

### Status/vigency constraints (Trigger #14)

| Status | active_until_watermark | Constraint |
|---|---|---|
| active | NULL | Must be NULL |
| closed | NOT NULL | Must be NOT NULL |
| source_deleted | NOT NULL | Must be NOT NULL |
| tombstoned | NOT NULL | Must be NOT NULL |

**Transition rules:**
- active → closed (supersession)
- active → source_deleted (reconciliation)
- source_deleted → tombstoned (2-cycle grace confirmed)
- No other transitions. No direct INSERT with status='tombstoned'.

### Tombstone events

Append-only enforced by existing trigger. BEFORE UPDATE OR DELETE → reject.

---

## 14. DDL Impact Delta (relative to Schema Patch v1.6 + Finalization Protocol v1.1)

### New columns on amaia_sync_run_manifests

| Column | Type | Nullable |
|---|---|---|
| abandoned_by | text | NULL |
| abandoned_at | timestamptz | NULL |
| abandoned_reason | text | NULL, CHECK (IS NULL OR length > 0) |
| provisional_verified | boolean | NULL |
| provisional_skipped | boolean | NULL |

### New roles

| Role | Type |
|---|---|
| amaia_sync_manifest_owner | NOLOGIN |
| amaia_sync_recovery_runtime | LOGIN (or NOLOGIN if used via SET ROLE) |

### Stored functions

5 SECURITY DEFINER functions (unchanged count from v1.1, updated APIs).

### Privilege grants/revokes

Comprehensive per Section 11.

### Column nullability (from v1.1, unchanged)

source_id_count: NULL allowed. source_id_hash: NULL allowed.

### CHECK changes (from v1.1, unchanged)

phase default = 'created'. phase CHECK includes 'created'. source_id_count allows NULL.

### Additional CHECK

abandoned_reason: IS NULL OR length > 0.

### Trigger updates

| Trigger | Change from v1.1 |
|---|---|
| #4 (phase_column_guard) | Abandoned transition requires abandoned_by/at/reason NOT NULL. Other transitions require these NULL. provisional_verified/provisional_skipped allowlists per transition. |
| #11 (identity_items) | Lock manifest FOR SHARE on INSERT. current_user check (not session_user). Source items allowed from any caller at 'created'. All other roles only from manifest_owner at 'source_fetched'. |
| #14 (membership_guard) | episode_seq sequential validation. Status/vigency cross-constraints. |

### Summary delta from v1.1

| Category | v1.1 | v1.2 delta | v1.2 total |
|---|---|---|---|
| New manifest columns | 0 | +5 (abandon + provisional flags) | 5 |
| Roles | 1 (manifest_owner) | +1 (recovery_runtime) | 2 |
| Functions | 5 | 0 (updated APIs) | 5 |
| Trigger updates | 3 (#4, #11, #13) | +1 (#14 updated) | 4 updated |
| CHECKs | 2 modified | +1 (abandoned_reason) | 3 |

---

## Invariants

All v1.1 invariants preserved. Updated/added:

**66 (STRENGTHENED):** The finalizer queries the destination table directly and constructs P_set/P_check. The runtime cannot provide or fabricate persisted items. Only the finalizer (as manifest_owner) can INSERT persisted/missing/extra/excluded items.

**69 (STRENGTHENED):** Trigger #11 uses current_user (not session_user) to verify manifest_owner authority for derived item roles.

Added:

70. **Lock order is total.** scheduler_lease → cycle → domain_lease → sync_run → manifest → exclusion_subjects → items. No function or transaction acquires locks in a different order.
71. **Abandon requires recovery authority.** Only recovery_runtime or manifest_owner can abandon. Evidence (abandoned_by, abandoned_at, abandoned_reason) is mandatory.
72. **Provisional evidence is explicitly unverified.** provisional_verified = false is recorded on the manifest. Auditors can distinguish verified (finalizer-computed) from unverified (runtime-provided) evidence.
73. **Trigger #11 locks manifest FOR SHARE on item INSERT.** Prevents late items after finalizer starts computing hashes.
74. **Source items are the external trust boundary.** The manifest guarantees coherence from source items forward. It does not guarantee AMAIA source completeness.

---

## Self-Audit

### Runtime fabricates persisted items

Runtime INSERTs identity_item with role='persisted'. Trigger #11: current_user = 'amaia_sync_runtime' ≠ 'amaia_sync_manifest_owner'. Rejected. **Privilege-enforced.**

### Runtime fabricates missing items

Same check. current_user ≠ manifest_owner. Rejected. **Privilege-enforced.**

### Runtime UPDATEs manifest directly

PostgreSQL denies: UPDATE not granted to runtime. **Privilege-enforced.**

### Late item insertion after finalizer starts

Finalizer locks manifest FOR UPDATE (Step 3 of authorization). Late item INSERT triggers #11 which locks manifest FOR SHARE. FOR SHARE is compatible with FOR UPDATE held by the same transaction (same tx = no conflict). But if in a DIFFERENT transaction: FOR SHARE blocks until FOR UPDATE releases. After finalizer commits: phase has advanced → trigger rejects the late item. **Phase-enforced + lock-serialized.**

### Operator inserts decision during finalize_comparison exclusion processing

Both lock the exclusion subject. Serialized. Finalizer already holds subject lock → operator blocks. **Lock-serialized.**

### Worker B calls finalizer with Worker A's observed token

Finalizer validates: lease row's owner_identity = the identity in the sync_run. Worker B has a different owner_identity (different engine_instance_id). Mismatch. Rejected. **Identity-enforced.**

### abandon_manifest called by runtime (not recovery)

current_user = 'amaia_sync_runtime'. Function checks current_user IN (recovery_runtime, manifest_owner). Runtime not in list. Rejected. **Role-enforced.**

### abandon_manifest without reason

Trigger #4 on phase → 'abandoned': validates abandoned_reason IS NOT NULL and length > 0. Empty reason → rejected. **Trigger-enforced.**

### Concurrent finalize calls on same manifest

Both lock manifest FOR UPDATE (Step 3). Serialized. Second reads wrong phase. Rejected. **Row-lock serialized.**

### complete_manifest when provisional zone exists but wasn't processed

Validation Step 5: raw_max_id > confirmed_upper_bound AND phase = 'confirmed_compared'. Records provisional_skipped = true. Completion proceeds. The skipped provisional is informational — the confirmed comparison passed. **Context-aware.**

---

## Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External to the manifest subsystem. Mitigated by safety lag, overlap, reconciliation. |
| service_role can INSERT source items | Low | Trigger #11 allows source from any caller. Source items are raw observations, not derived evidence. |
| Provisional evidence unverified | Low | Documented. Re-verified on promotion. provisional_verified = false is explicit. |
| manifest_owner role compromise | Low | NOLOGIN. Cannot be used for direct connection. Only acts via SECURITY DEFINER. |
| Recovery role misuse | Low | Restricted to abandon_manifest only. Cannot finalize or complete. |

---

**End of document.**
