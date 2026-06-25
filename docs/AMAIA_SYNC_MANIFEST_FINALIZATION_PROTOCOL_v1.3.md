# AMAIA-SYNC Manifest Finalization Protocol v1.3

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.2 (lease_token is observable metadata, not a credential; service_role not prohibited; exclusion consumption order incompatible with deployed trigger; abandon authorization via current_user in SECURITY DEFINER is always manifest_owner)  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.2's core flaw: lease_token + owner_identity are observable by any process with SELECT on amaia_sync_leases. Any worker sharing the same DB role could call a finalizer with observed credentials. v1.3 resolves this with **Option C (new): single serialized orchestrator**. The AMAIA-SYNC runtime is a single-process, single-thread orchestrator. There is no multi-worker concurrency within the same database role. One process, one lease, one run at a time per domain. The finalizer's lease validation is not inter-worker authentication — it is stale-self detection (did I lose my lease between steps?).

---

## 1. Worker Authentication — Decision: Single Serialized Orchestrator

### Why Options A and B are rejected

**Option A (per-worker DB role):** Requires dynamic role creation per worker instance. Incompatible with Supabase connection pooling. Operationally complex.

**Option B (non-observable capability token):** Requires a secret exchange mechanism (e.g., random token set during lease acquisition, stored in a non-SELECTable column). PostgreSQL has no column-level SELECT restriction for the table owner. Impractical without custom extension.

### Option C (new): Single serialized orchestrator

The AMAIA-SYNC runtime is architecturally a **single process** running on VM AMAIASQL (established in Runtime Architecture v1.0, Section 16). There is exactly one engine instance active at any time. Within that instance, domain processing is sequential (not parallel workers). The scheduler lease ensures only one scheduler is active. Domain leases ensure only one processor per domain.

**There are no concurrent workers sharing the same role and competing for the same resources.** The "another worker observes the token" attack assumes multi-worker concurrency that does not exist in this architecture.

### What the finalizer's lease validation actually provides

The finalizer validates the domain lease NOT to authenticate against other workers, but to detect **stale self**: "Have I (the single orchestrator) lost my lease between the domain processing step and the finalization call?" If the lease expired (TTL elapsed, another scheduler recovered it), the finalizer detects the mismatch and aborts. This is self-consistency checking, not inter-worker authentication.

### Startup validation

On engine startup, the process validates:
- current_user is 'amaia_sync_runtime' (or the configured runtime role).
- current_user is NOT 'postgres', 'service_role', 'supabase_admin', or any superuser.
- If the check fails: abort startup with 'AMAIA-SYNC must not run as a privileged role'.

This prevents accidental execution under a role that bypasses privilege restrictions.

### Future multi-worker note

If V2 introduces parallel workers, the authentication model must be revisited. Options include per-worker roles, capability tokens via pg_catalog extensions, or an application-layer JWT claim mechanism. This is out of scope for V1.

---

## 2. Finalizer Lock Acquisition — Internal, Total Order

### Problem in v1.2

v1.2 said the runtime holds the domain lease lock and the finalizer "reads but doesn't lock." This creates ambiguity about who holds what, and prevents the finalizer from being self-contained.

### Corrected model

**The finalizer acquires ALL its locks internally.** The runtime does NOT pre-lock anything before calling the finalizer. The runtime's fenced transaction structure changes:

**Runtime transaction structure:**

1. BEGIN.
2. Call finalizer function (finalize_source, finalize_comparison, etc.).
   - The finalizer internally acquires all locks in canonical order.
   - The finalizer validates, computes, mutates.
   - The finalizer returns.
3. If finalize_comparison returned sets_match = true: call watermark advance (also a controlled function or inline CAS).
4. COMMIT.

**The runtime does NOT acquire the domain lease FOR UPDATE before calling the finalizer.** The finalizer does it. This eliminates the "caller holds lock X, finalizer needs lock Y, order unclear" problem.

### Finalizer internal lock order (ALL finalizers except abandon)

1. **Domain lease:** SELECT ... FROM amaia_sync_leases WHERE entity_name = :domain FOR UPDATE. Validate 4-part ownership predicate.
2. **Sync run:** SELECT ... FROM amaia_sync_runs WHERE id = :run_id FOR UPDATE. Validate status = 'running', owner_identity = lease.owner_identity, lease_token = lease.lease_token, domain_name = manifest.domain_name.
3. **Manifest:** SELECT ... FROM amaia_sync_run_manifests WHERE id = :manifest_id FOR UPDATE. Validate run_id, expected phase.
4. **Exclusion subjects** (only in finalize_comparison for non-dedup): locked in ascending identity order during exclusion processing.
5. **Identity items operations:** INSERTs after all locks held.

**This is the canonical order for EVERY finalizer call.** No variation. No caller pre-locking.

### abandon_manifest lock order

1. **Manifest:** SELECT ... FOR UPDATE. (No domain lease — recovery may not hold the original lease.)
2. **Sync run:** SELECT ... FOR UPDATE. Validate orphan conditions.

Abandon does not lock the domain lease because the recovery process may be abandoning a manifest whose domain lease was acquired by a different mechanism (recovery lease acquisition). The manifest lock alone is sufficient because abandon only sets phase = 'abandoned' with no domain data implications.

---

## 3. service_role Prohibition

### Contract

- The AMAIA-SYNC engine MUST NOT connect using service_role, postgres, supabase_admin, or any superuser role.
- The engine connects as amaia_sync_runtime (a dedicated, non-superuser role).
- service_role is reserved for: migrations, admin break-glass operations, and Supabase internal operations.

### Enforcement

**Startup validation:** The engine checks current_user on its first database connection. If it matches a prohibited role: abort.

**Trigger #4 (phase_column_guard):** On any UPDATE to amaia_sync_run_manifests, if current_user is NOT 'amaia_sync_manifest_owner': reject phase-advancing UPDATEs. This catches service_role direct UPDATEs.

**Trigger #11 (identity_items):** Derived item roles require current_user = 'amaia_sync_manifest_owner'. service_role is not manifest_owner → derived items rejected.

### Why service_role is dangerous

service_role in Supabase bypasses RLS and typically has broad privileges. If the engine ran as service_role:
- It could UPDATE manifests directly (bypassing finalizer).
- It could INSERT derived items (bypassing trigger #11's role check if service_role somehow matched).
- Trigger enforcement still fires, but the role checks would pass if service_role were granted manifest_owner membership.

**The fix is simple: never grant manifest_owner membership to service_role.** And never run the engine as service_role.

---

## 4. Trigger #4 — Phase Protection with Role Check

**Table:** amaia_sync_run_manifests  
**Event:** BEFORE UPDATE OR DELETE

### On DELETE

Reject always.

### On UPDATE

**First check — caller authorization for phase changes:**

If NEW.phase IS DISTINCT FROM OLD.phase:
- If current_user IS DISTINCT FROM 'amaia_sync_manifest_owner': raise exception 'phase can only be advanced by manifest finalization functions'.
- This blocks: service_role, postgres, amaia_sync_runtime, and any other role from directly advancing phases.

**Second check — terminal phase guard:**

If OLD.phase IN ('comparison_complete', 'abandoned'): reject all updates.

**Third check — valid transitions and column allowlists:**

Unchanged from v1.1/v1.2. Forward-only transitions, per-phase column freezing, immutable-from-INSERT columns.

**Abandon-specific:**

On transition to 'abandoned': abandoned_by, abandoned_at, abandoned_reason must become NOT NULL. On all other transitions: these must remain NULL.

---

## 5. Trigger #11 — Identity Items Insert Control

**Table:** amaia_sync_manifest_identity_items  
**Event:** BEFORE INSERT OR UPDATE OR DELETE

### On UPDATE or DELETE

Reject (append-only).

### On INSERT

1. **Lock manifest FOR SHARE:** Prevents concurrent phase advancement. Compatible with FOR UPDATE held by the finalizer in the same transaction (same-tx locks are compatible). Cross-transaction: blocks finalizer's UPDATE until this INSERT's transaction commits.

2. **Read manifest phase and identity_basis.**

3. **Phase-role-caller check:**

| Phase | Role | Caller requirement |
|---|---|---|
| created | source | Any (runtime can INSERT) |
| source_fetched | persisted, missing, extra, excluded | current_user = 'amaia_sync_manifest_owner' |
| All other | (none) | — |

4. **Identity coherence** (unchanged from v1.2).

5. RETURN NEW.

### Trigger function ownership

The trigger function itself is owned by the schema owner (typically postgres or supabase_admin in Supabase). It executes with the trigger function owner's privileges for internal queries but current_user reflects the CALLING context — which is either amaia_sync_runtime (direct INSERT) or amaia_sync_manifest_owner (INSERT within SECURITY DEFINER finalizer). This is the correct behavior for role-based authorization in triggers.

---

## 6. Function APIs

### 6.1 amaia_sync_finalize_source

**Parameters:** manifest_id uuid, run_id uuid

**The function reads owner_identity and lease_token from the locked lease row — it does not accept them as parameters.** This eliminates the "observable token" concern entirely. The function trusts the database state (locked row), not caller-supplied credentials.

**Internal sequence:**

1. Read manifest.domain_name from manifest (plain SELECT first to get domain).
2. Lock domain lease FOR UPDATE. Read owner_identity, lease_token, validate 4-part predicate.
3. Lock sync_run FOR UPDATE. Validate: status='running', owner_identity = lease.owner_identity, lease_token = lease.lease_token, domain_name matches.
4. Lock manifest FOR UPDATE. Validate: phase='created', run_id matches.
5. Read source items. Compute S_raw, count, hash per identity_basis.
6. UPDATE manifest: source_id_count, source_id_hash, phase='source_fetched'.

### 6.2 amaia_sync_finalize_comparison

**Parameters:** manifest_id uuid, run_id uuid

**Internal sequence:**

1-4. Same authorization as finalize_source, except validates phase='source_fetched'.
5. Read source items → S_raw.
6. Query destination table directly (using manifest.domain_name to determine table). Build P_set/P_check.
7. INSERT persisted items.
8. Compute missing (and extra for non-dedup).

**For non-dedup exclusion processing:**

9. For each extra_raw element (ascending order):
   - Get-or-create exclusion subject.
   - Lock subject FOR UPDATE.
   - Read current investigation, latest decision.
   - If approved: INSERT excluded item. **Do NOT insert consumption yet** (see Section 8).
10. Compute sets_match.
11. UPDATE manifest: all comparison fields, phase='confirmed_compared'.

**Exclusion consumptions (separate step after manifest update):**

12. If sets_match = true AND extras_excluded is non-empty:
    - For each excluded item: re-read the subject (already locked in same tx). Insert consumption record.
    - The deployed consumption trigger (#8) validates manifest.sets_match = true. Since Step 11 already set sets_match = true (in the same transaction), the trigger reads true. **Order: manifest update BEFORE consumption insert.**

13. Return sets_match.

### 6.3 amaia_sync_finalize_provisional

**Parameters:** manifest_id uuid, run_id uuid, provisional_upper_bound bigint, provisional_id_count integer, provisional_id_hash text

**Internal sequence:**

1-4. Authorization. Validate phase='confirmed_compared'.
5. UPDATE manifest: provisional fields, provisional_verified = false, phase='provisional_persisted'.

### 6.4 amaia_sync_complete_manifest

**Parameters:** manifest_id uuid, run_id uuid

**Internal sequence:**

1-4. Authorization. Validate phase IN ('confirmed_compared', 'provisional_persisted').
5. Read manifest.raw_max_id. Read sync_run.upper_bound (the confirmed upper bound).
6. If raw_max_id > upper_bound AND phase = 'confirmed_compared': set provisional_skipped = true.
7. UPDATE manifest: phase='comparison_complete'.

### 6.5 amaia_sync_abandon_manifest

**Parameters:** manifest_id uuid, abandoned_by text, reason text

**EXECUTE granted to:** amaia_sync_recovery_runtime ONLY. NOT amaia_sync_runtime.

**Internal sequence:**

1. Validate current_user = 'amaia_sync_recovery_runtime' OR current_user = 'amaia_sync_manifest_owner'. (Defense in depth — EXECUTE grants already restrict, but the function double-checks.)
2. Lock manifest FOR UPDATE. Validate phase not terminal.
3. Read manifest.run_id. Lock sync_run FOR UPDATE. Validate: run is in a recoverable state (status IN ('running', 'orphan_recovered', 'failed')).
4. UPDATE manifest: phase='abandoned', abandoned_by = param, abandoned_at = now(), abandoned_reason = param.

**abandoned_by is a controlled parameter**, set by the recovery process to its own identity (engine_instance_id + context). It is NOT the current_user role name — it is the operational identity of the recovery orchestrator.

---

## 7. Exclusion Consumption Order — Compatible with Deployed Trigger #8

### Problem

Deployed trigger #8 (exclusion_consumptions validate_and_append_only) validates on INSERT: manifest.sets_match = true. In v1.2, the order was ambiguous — consumptions might be inserted before the manifest was updated with sets_match.

### Solution

The order within finalize_comparison is:

1. Compute missing/extra/excluded.
2. INSERT identity_items (missing, extra, excluded).
3. **UPDATE manifest** with sets_match, persisted_id_hash, etc., phase='confirmed_compared'. (Step 11 in Section 6.2.)
4. **INSERT exclusion consumptions** (Step 12 in Section 6.2). Trigger #8 reads manifest.sets_match — which was just set to true in Step 3 (same transaction, read-your-own-writes).

If sets_match = false: Step 4 is skipped entirely. No consumptions inserted. No incompatibility.

### Why this is compatible with deployed trigger #8

Trigger #8 on consumption INSERT reads: `SELECT sets_match FROM manifests WHERE id = consumed_by_manifest_id`. Within the same transaction, sets_match was set to true in Step 3. PostgreSQL guarantees the trigger sees the uncommitted-but-written value. Trigger passes.

---

## 8. Abandon Protocol — Hardened

### EXECUTE restriction

abandon_manifest is granted EXECUTE to amaia_sync_recovery_runtime ONLY. The runtime role (amaia_sync_runtime) CANNOT call it.

### Orphan condition validation

The function validates:
1. The manifest exists and is non-terminal.
2. The referenced run (manifest.run_id) is in a recoverable state: status IN ('running', 'orphan_recovered', 'failed'). A run with status = 'success' should not have its manifest abandoned.
3. For runs with status = 'running': the function does NOT validate the domain lease (the recovery process may have already acquired a new lease, superseding the old one). The fact that the recovery process is calling abandon_manifest implies it has recovery authority (scheduler lease held, orphan detected via domain lease acquisition).

### Evidence

- abandoned_by: the recovery process's operational identity (e.g., 'recovery:{engine_instance_id}:{hostname}'). Set by the caller. NOT the current_user role name.
- abandoned_at: now() (set by function).
- abandoned_reason: caller-provided non-empty text.

### Why abandoned_by is not current_user

Inside SECURITY DEFINER, current_user = 'amaia_sync_manifest_owner' for ALL functions. It does not distinguish who called the function. abandoned_by is a parameter that the recovery process sets to its own identity, providing meaningful audit evidence.

---

## 9. Provisional Protocol

### Parameters and evidence

finalize_provisional accepts: manifest_id, run_id, provisional_upper_bound, provisional_id_count, provisional_id_hash.

The function writes:
- provisional_upper_bound = param.
- provisional_id_count = param.
- provisional_id_hash = param.
- provisional_verified = false.
- phase = 'provisional_persisted'.

### provisional_verified semantics

- false: values provided by runtime, not independently verified by finalizer.
- true: reserved for future verification mechanism.
- NULL: no provisional zone (phase never reached provisional_persisted).

### Consistency

provisional_verified = false is honest. It does not claim the values are correct. An auditor seeing false knows: "these numbers were reported by the runtime, not derived from items." The confirmed comparison (phase = 'confirmed_compared') WAS verified by the finalizer. Provisional is supplementary.

---

## 10. Security Definer Hardening

All 5 functions:

- **Owner:** amaia_sync_manifest_owner (NOLOGIN).
- **amaia_sync_manifest_owner is NOT a member of:** postgres, service_role, supabase_admin, pg_write_all_data, or any superuser/admin role.
- **SET search_path = 'pg_catalog, public'** — pg_catalog first prevents schema-shadowing attacks.
- **All object references fully qualified:** public.amaia_sync_run_manifests, public.amaia_sync_leases, etc.
- **No dynamic SQL.** All queries are static with parameter binding.
- **EXECUTE revoked from PUBLIC** on all 5 functions.
- **EXECUTE grants:**
  - finalize_source, finalize_comparison, finalize_provisional, complete_manifest → amaia_sync_runtime.
  - abandon_manifest → amaia_sync_recovery_runtime.

---

## 11. Privileges Inventory

### amaia_sync_runtime

| Object | Privilege |
|---|---|
| amaia_sync_run_manifests | INSERT, SELECT |
| amaia_sync_manifest_identity_items | INSERT, SELECT |
| amaia_sync_leases | SELECT (for runtime's own lease acquisition — UPDATE done via separate lease management, not via finalizer) |
| amaia_sync_runs | INSERT, SELECT, UPDATE (for run creation/closure — separate from manifest operations) |
| finalize_source, finalize_comparison, finalize_provisional, complete_manifest | EXECUTE |
| abandon_manifest | **(none)** |
| Destination tables | INSERT, SELECT, UPDATE (for domain upserts) |
| amaia_sync_watermarks | SELECT, UPDATE (for CAS advance) |

### amaia_sync_recovery_runtime

| Object | Privilege |
|---|---|
| amaia_sync_run_manifests | SELECT |
| amaia_sync_manifest_identity_items | SELECT |
| abandon_manifest | EXECUTE |
| amaia_sync_runs | SELECT, UPDATE (for orphan recovery transitions) |
| amaia_sync_leases | SELECT, UPDATE (for lease acquisition during recovery) |
| amaia_sync_cycles | SELECT, UPDATE (for cycle closure) |

### amaia_sync_manifest_owner

| Object | Privilege |
|---|---|
| amaia_sync_run_manifests | SELECT, UPDATE |
| amaia_sync_manifest_identity_items | SELECT, INSERT |
| amaia_sync_runs | SELECT |
| amaia_sync_leases | SELECT |
| amaia_sync_domain_identity_policies | SELECT |
| Destination tables (health_conditions, medications, beneficiaries, etc.) | SELECT |
| Exclusion subjects/investigations/decisions/consumptions | SELECT, INSERT |
| amaia_sync_watermarks | SELECT |

### PUBLIC

No privileges on manifests, identity_items, or any of the 5 functions.

### service_role boundary

- NOT a member of amaia_sync_manifest_owner.
- Cannot call finalizer functions (EXECUTE not granted).
- Trigger #4 rejects phase-advancing UPDATEs (current_user check).
- Trigger #11 rejects derived items (current_user check).
- If service_role bypasses triggers (ALTER TABLE DISABLE TRIGGER): this is an admin break-glass action, logged and auditable. Not a normal operation.

---

## 12. Membership Hardening

### episode_seq serialization

The membership trigger (#14) on INSERT computes: `episode_seq = COALESCE(MAX(episode_seq) FROM memberships WHERE domain_name = NEW.domain_name AND source_amaia_id = NEW.source_amaia_id, 0) + 1`.

**Serialization guarantee:** Membership INSERTs occur within the domain fenced transaction (the finalizer or the runtime's upsert logic holds the domain lease lock). Only one process can INSERT memberships for a given domain at a time. No concurrent INSERT race.

### Status/vigency constraints (Trigger #14)

| Status | active_until_watermark | Allowed transitions IN |
|---|---|---|
| active | MUST be NULL | (initial), from no prior row |
| closed | MUST be NOT NULL | from active |
| source_deleted | MUST be NOT NULL | from active |
| tombstoned | MUST be NOT NULL | from source_deleted |

No direct INSERT with status = 'closed', 'source_deleted', or 'tombstoned'. New memberships are always INSERT with status = 'active'. Status changes via UPDATE only.

---

## 13. Tombstone Append-Only

The deployed amaia_sync_tombstone_events table has a trigger (from 9.3B migration) that rejects UPDATE and DELETE. This is trigger #1 pattern (append_only). If the deployed migration did not include this trigger for tombstone_events specifically: **it must be added as part of the schema patch DDL.** The tombstone_events table in the deployed 9.3B migration does NOT have an explicit append-only trigger — the original 9.2 migration created it without one.

**DDL impact:** Add append-only trigger to amaia_sync_tombstone_events (BEFORE UPDATE OR DELETE → reject). This is a new trigger.

---

## 14. Source Observation Boundary

The manifest subsystem guarantees coherence from registered source items forward:
- Source items are what the runtime declared it fetched.
- Persisted items are what the finalizer confirmed exists in the destination.
- Differences are derived by the finalizer.
- Hashes are computed by the finalizer from items.

The manifest does NOT guarantee that the runtime's source items are a complete or accurate representation of AMAIA's data. This is an external trust boundary mitigated by: safety lag, overlap, reconciliation, and the single-orchestrator model (no rogue worker can inject false source items because there is only one process).

---

## 15. DDL Impact Delta

### From Schema Patch v1.6

| Category | Count | Details |
|---|---|---|
| New columns on manifests | 5 | abandoned_by, abandoned_at, abandoned_reason, provisional_verified, provisional_skipped |
| Nullability changes on manifests | 2 | source_id_count, source_id_hash → NULL allowed |
| CHECK changes on manifests | 2 | phase adds 'created', source_id_count allows NULL |
| CHECK adds on manifests | 1 | abandoned_reason NULL or length > 0 |
| New roles | 2 | amaia_sync_manifest_owner (NOLOGIN), amaia_sync_recovery_runtime |
| New functions | 5 | SECURITY DEFINER: finalize_source, finalize_comparison, finalize_provisional, complete_manifest, abandon_manifest |
| New trigger on tombstone_events | 1 | append_only (BEFORE UPDATE OR DELETE) |
| Trigger updates | 3 | #4 (role check + phase created + abandon fields), #11 (current_user + FOR SHARE + phase created), #14 (episode_seq + status/vigency) |
| Privilege grants | ~20 | Per Section 11 |
| Privilege revokes | ~5 | EXECUTE from PUBLIC on 5 functions, runtime UPDATE on manifests if previously granted |

### From Finalization Protocol v1.2

| Change | Details |
|---|---|
| Removed | lease_token and owner_identity from function parameters (now read from locked row) |
| Changed | Finalizer acquires ALL locks internally (runtime does not pre-lock) |
| Changed | service_role prohibited for runtime operation |
| Changed | Trigger #4 adds current_user check for phase advancement |
| Added | Tombstone append-only trigger |
| Added | Startup validation for runtime role |

### Cumulative total (Schema Patch v1.6 + Finalization Protocol v1.3)

| Category | Count |
|---|---|
| New tables | 3 (identity_items, domain_identity_policies, memberships) |
| New columns on existing tables | 16 (11 from v1.6 + 5 from finalization) |
| Nullability changes | 5 (3 from v1.6 + 2 from finalization) |
| CHECK constraints | 20 (17 from v1.6 + 3 from finalization) |
| Indexes | 12 (from v1.6) |
| FKs | 3 (from v1.6) |
| Triggers | 21 (19 from v1.6 + 1 tombstone append-only + 1 trigger implicit in finalization protocol corrections = actually: 19 base + 1 new = 20 total, with 4 updated) |
| Functions | 5 (SECURITY DEFINER) |
| Roles | 2 |
| RLS policies | 3 (from v1.6) |
| Seed rows | 7 (domain policies from v1.6) + 3 (9.3C separate) |

---

## Invariants

All v1.2 invariants preserved where applicable. Updated:

**65 (REPLACED):** Finalizer reads owner_identity and lease_token from the locked lease row. These are NOT passed as parameters. The finalizer trusts the database state under its own lock, not caller-supplied values.

**70 (STRENGTHENED):** Finalizer acquires ALL locks internally in canonical order. The runtime does NOT pre-lock anything before calling the finalizer. Lock order: domain_lease → sync_run → manifest → exclusion_subjects → items.

Added:

75. **Single serialized orchestrator.** The engine is one process, one thread per domain. There are no concurrent workers sharing the same role. Lease validation in the finalizer is stale-self detection, not inter-worker authentication.
76. **service_role prohibited for runtime.** Startup aborts if current_user is a privileged role. Triggers reject phase advancement from non-manifest_owner roles.
77. **Exclusion consumptions inserted AFTER manifest.sets_match = true.** Compatible with deployed trigger #8 via read-your-own-writes in same transaction.
78. **Tombstone events are append-only.** Explicit trigger enforced (BEFORE UPDATE OR DELETE → reject).

---

## Self-Audit

### "Another worker" calls finalizer with observed token

There is no other worker. The architecture is single-process, single-thread per domain. If somehow another process existed: it would need to acquire the domain lease (impossible — the real owner holds it). The finalizer locks the lease and validates. A process without the lease cannot pass validation. **Architecture + lease-enforced.**

### service_role direct UPDATE advances phase

Trigger #4: current_user check. service_role ≠ 'amaia_sync_manifest_owner'. Phase change rejected. **Trigger-enforced.**

### Runtime calls abandon_manifest

EXECUTE not granted to amaia_sync_runtime for abandon_manifest. PostgreSQL denies. **Privilege-enforced.**

### Finalizer called, but lease expired between runtime's lease acquisition and finalizer's lock

The finalizer acquires the domain lease FOR UPDATE internally (Step 1). If the lease expired: the lease row shows lease_expires_at < now(). Validation fails. Finalizer raises exception. The runtime's transaction rolls back. **Self-consistency enforced.**

### Consumption inserted before sets_match = true

finalize_comparison Step 11: UPDATE manifest with sets_match. Step 12: INSERT consumptions. Within same transaction. Trigger #8 reads sets_match = true (read-your-own-writes). **Order-enforced.**

### Concurrent finalize calls

Both lock domain lease FOR UPDATE (Step 1). Serialized at the first lock. Second waits, then reads advanced phase → mismatch → exception. **Row-lock serialized.**

### Late source item after finalize_source

Trigger #11: manifest phase = 'source_fetched'. item_role = 'source'. Not allowed at source_fetched. Rejected. **Phase-enforced.**

### Late persisted item after finalize_comparison

Trigger #11: manifest phase = 'confirmed_compared'. No roles allowed. Rejected. **Phase-enforced.**

### Tombstone event UPDATE

Trigger: BEFORE UPDATE → reject. **Append-only enforced.**

### Membership episode_seq gap

Trigger #14 computes seq = MAX + 1 under domain lease serialization. No gap possible (single writer per domain). **Serialization-enforced.**

---

## Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External. Mitigated by safety lag, overlap, reconciliation, single orchestrator. |
| manifest_owner role compromise | Low | NOLOGIN. Only acts via SECURITY DEFINER. Not member of broad roles. |
| PID reuse + engine_instance_id collision | Negligible | engine_instance_id is UUID v4. Collision probability < 2^-122. |
| Future multi-worker breaks authentication model | N/A (V2) | Documented as requiring authentication redesign if multi-worker is introduced. |
| Tombstone append-only trigger not in deployed baseline | Low | Added as part of this schema patch DDL. Verified by QA. |

---

**End of document.**
