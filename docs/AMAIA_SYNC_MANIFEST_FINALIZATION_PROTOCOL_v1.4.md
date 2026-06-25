# AMAIA-SYNC Manifest Finalization Protocol v1.4

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.3  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.3 established the correct foundation: single orchestrator, finalizer queries destination, runtime cannot fabricate evidence, trigger-enforced phase/role control. v1.4 corrects the remaining structural issues: early fence before any domain write, scheduler singleton enforcement, lock order without inversion (including abandon), trigger security mode declarations, and clean DDL inventory.

---

## 1. Corrected Transaction Model — Early Fence

### Transaction A: Source capture

**The domain lease is the FIRST lock acquired. No domain write occurs before it.**

1. **Lock domain lease FOR UPDATE.** Validate 4-part ownership predicate.
2. Fetch from AMAIA (read — no Supabase lock needed).
3. Upsert to destination (under domain lease protection).
4. Update/insert memberships (under domain lease protection).
5. INSERT manifest (phase='created').
6. INSERT source identity_items.
7. CALL amaia_sync_finalize_source(manifest_id, run_id). Finalizer locks run FOR UPDATE, locks manifest FOR UPDATE (same transaction — no deadlock, domain lease already held at higher priority). Computes hashes. Advances phase.
8. COMMIT.

### Transaction B: Comparison

1. **Lock domain lease FOR UPDATE.** Re-validate (lease may have changed between A and B — single orchestrator makes this rare but the protocol handles it).
2. CALL amaia_sync_finalize_comparison(manifest_id, run_id). Finalizer locks run, manifest. Queries destination. Inserts persisted/missing/extra/excluded items. Computes hashes. Updates manifest. Inserts exclusion consumptions if applicable.
3. If sets_match: advance watermark (CAS within same transaction, domain lease held).
4. COMMIT.

### Transaction C: Provisional (optional)

1. Lock domain lease FOR UPDATE.
2. Process provisional zone (fetch AMAIA, upsert destination, enqueue remediations).
3. CALL amaia_sync_finalize_provisional(manifest_id, run_id, provisional_upper_bound, provisional_id_count, provisional_id_hash).
4. COMMIT.

### Transaction D: Complete

1. Lock domain lease FOR UPDATE.
2. CALL amaia_sync_complete_manifest(manifest_id, run_id).
3. COMMIT.

### Invariant

**No write to any Supabase domain table, membership table, manifest, or identity_items occurs before the domain lease FOR UPDATE is acquired in that transaction.**

---

## 2. Scheduler Singleton Enforcement

### Contract

Before any cycle or domain work:

1. The engine acquires the scheduler lease (entity_name = 'scheduler') via the standard atomic conditional UPDATE.
2. If acquisition fails (lease held by another process): the engine does NOT start a cycle. It waits for the next tick or shuts down.
3. The scheduler lease is held (heartbeated) for the entire cycle duration.
4. If the scheduler lease expires (heartbeat missed): the engine MUST NOT initiate new domain transactions. In-flight domain transactions (already holding a domain lease) may complete.

### Startup sequence

1. Validate current_user is amaia_sync_runtime (not service_role/postgres/admin).
2. Validate all 7 watermark rows + scheduler lease row exist.
3. Acquire scheduler lease.
4. If acquired: close orphan cycles (recovery closure protocol).
5. Create new cycle (fenced: lock scheduler lease, insert cycle).
6. Begin domain processing loop.

### What this enforces

The scheduler lease is the operational singleton mechanism. Combined with the single-process architecture: exactly one engine instance is active and creating cycles at any time. Domain leases provide per-domain exclusion. Together: no concurrent work on any domain.

---

## 3. Lock Order — Total, No Inversion

### Canonical order

```
Position 1: scheduler_lease (entity_name = 'scheduler')
Position 2: cycle_row
Position 3: domain_lease (entity_name = domain)
Position 4: sync_run_row
Position 5: manifest_row
Position 6: exclusion_subjects (ascending identity order)
Position 7: identity_items / other leaf operations
```

### Who acquires what

| Operation | Locks acquired | By whom |
|---|---|---|
| Cycle creation | 1 (scheduler) | Runtime |
| Run creation | 1 (scheduler) + 2 (cycle) + 3 (domain) | Runtime |
| Transaction A (source) | 3 (domain) → then finalizer adds 4 (run) + 5 (manifest) | Runtime + finalizer |
| Transaction B (comparison) | 3 (domain) → then finalizer adds 4 (run) + 5 (manifest) + 6 (subjects) | Runtime + finalizer |
| Cycle closure | 1 (scheduler) + 2 (cycle) | Runtime |
| abandon_manifest | 4 (run) + 5 (manifest) | Recovery via function |

### No inversion exists

- Runtime always acquires position 3 first (domain lease), then calls finalizer which acquires 4, 5, 6.
- Cycle operations acquire 1 then 2.
- No path acquires a higher-position lock before a lower-position lock.
- abandon acquires 4 then 5 (valid: 4 < 5).

### Finalizer lock behavior within caller's transaction

The finalizer executes in the SAME transaction as the caller. The caller holds position 3 (domain lease). The finalizer acquires positions 4, 5 (and optionally 6). Within the same transaction, acquiring additional locks at higher positions is always safe (no cycle in the wait-for graph). Re-locking a row already locked by the same transaction is a no-op in PostgreSQL.

---

## 4. Finalizer APIs — Updated

### Common authorization pattern (all except abandon)

Each finalizer (finalize_source, finalize_comparison, finalize_provisional, complete_manifest):

1. Read manifest.domain_name (plain SELECT — no lock yet).
2. **Lock domain lease FOR UPDATE** (position 3). Validate 4-part ownership. Read owner_identity + lease_token from locked row.
3. **Lock sync_run FOR UPDATE** (position 4). Validate: status='running', owner_identity matches lease, lease_token matches lease, domain_name matches manifest.
4. **Lock manifest FOR UPDATE** (position 5). Validate: expected phase, run_id matches.
5. Proceed with computation.

**Parameters:** manifest_id uuid, run_id uuid. Nothing else. Owner_identity and lease_token read from locked rows, not from parameters.

**The domain lease lock in Step 2 is acquired by the finalizer.** The caller's Transaction A/B/C/D ALSO acquires the domain lease FOR UPDATE as its first step. Within the same transaction, the finalizer's FOR UPDATE on the same row is a no-op (already locked by the same tx). No deadlock. No performance cost.

### 4.1 amaia_sync_finalize_source

Authorization Steps 1-4 (validates phase='created').
5. Read source items. Compute S_raw, count, hash.
6. UPDATE manifest: source_id_count, source_id_hash, phase='source_fetched'.

### 4.2 amaia_sync_finalize_comparison

Authorization Steps 1-4 (validates phase='source_fetched').
5. Read source items → S_raw.
6. Query destination table directly → P_set/P_check.
7. INSERT persisted items (current_user = manifest_owner via SECURITY DEFINER).
8. Derive missing (and extra for non-dedup).
9. For non-dedup exclusions: lock subjects at position 6 (ascending order). Validate current investigation + latest approved decision + hash.
10. INSERT missing/extra/excluded items.
11. Compute persisted_id_count, persisted_id_hash, sets_match.
12. UPDATE manifest: comparison fields, phase='confirmed_compared'.
13. If sets_match AND exclusions consumed: INSERT exclusion consumptions (trigger #8 reads manifest.sets_match = true from same tx).
14. Return sets_match.

### 4.3 amaia_sync_finalize_provisional

Authorization Steps 1-4 (validates phase='confirmed_compared').
5. UPDATE manifest: provisional_upper_bound, provisional_id_count, provisional_id_hash, provisional_verified=false, phase='provisional_persisted'.

Parameters include: provisional_upper_bound, provisional_id_count, provisional_id_hash (runtime-provided, marked unverified).

### 4.4 amaia_sync_complete_manifest

Authorization Steps 1-4 (validates phase IN ('confirmed_compared', 'provisional_persisted')).
5. If raw_max_id > confirmed_upper_bound AND phase='confirmed_compared': set provisional_skipped=true.
6. UPDATE manifest: phase='comparison_complete'.

### 4.5 amaia_sync_abandon_manifest

**Parameters:** manifest_id uuid, abandoned_by text, reason text

**EXECUTE:** Granted only to amaia_sync_recovery_runtime.

**Lock order (corrected from v1.3):**

1. Read manifest.run_id (plain SELECT, no lock).
2. **Lock sync_run FOR UPDATE** (position 4). Validate orphan/recovery condition.
3. **Lock manifest FOR UPDATE** (position 5). Revalidate manifest.run_id = run.id. Validate phase not terminal.
4. UPDATE manifest: phase='abandoned', abandoned_by, abandoned_at=now(), abandoned_reason.

**Orphan condition validation (Step 2):**

The run must be in a recoverable state:
- run.status = 'orphan_recovered': the run was already recovered by domain lease acquisition. The manifest should be abandoned.
- run.status = 'failed': the run failed. The manifest may be incomplete.
- run.status = 'running' AND the recovery process demonstrates it holds the domain lease for this domain AND the run's (owner_identity, lease_token) do NOT match the current domain lease's (owner_identity, lease_token): the original owner is gone. The recovery process owns the domain now.

If none of these conditions is met: raise exception 'run is not in a recoverable state'.

---

## 5. Trigger Security Modes

### Trigger functions: all SECURITY INVOKER

All trigger functions (#1–#16+) are SECURITY INVOKER (the PostgreSQL default for triggers). This means current_user within a trigger reflects the **effective** caller:

- When the runtime (amaia_sync_runtime) INSERTs directly: current_user = 'amaia_sync_runtime'.
- When a SECURITY DEFINER function (owned by manifest_owner) INSERTs: current_user = 'amaia_sync_manifest_owner'.

This is the correct behavior for role-based authorization in triggers.

### Trigger #4 (manifest phase_column_guard) — SECURITY INVOKER

On UPDATE:
- If NEW.phase IS DISTINCT FROM OLD.phase AND current_user IS DISTINCT FROM 'amaia_sync_manifest_owner': raise exception. This blocks direct phase advancement by runtime, service_role, or any non-finalizer caller.

### Trigger #11 (identity_items) — SECURITY INVOKER

On INSERT:
- source items: allowed from any current_user (runtime can insert source).
- persisted/missing/extra/excluded: allowed only if current_user = 'amaia_sync_manifest_owner'.

### Why this works

The runtime calls the SECURITY DEFINER finalizer. Inside the finalizer, current_user = 'amaia_sync_manifest_owner'. When the finalizer INSERTs items, the trigger sees current_user = 'amaia_sync_manifest_owner' → derived roles allowed. When the runtime INSERTs source items directly (not via finalizer), current_user = 'amaia_sync_runtime' → only source role allowed.

---

## 6. Privileges — Complete and Minimal

### amaia_sync_manifest_owner (NOLOGIN)

| Object | Privilege | Reason |
|---|---|---|
| amaia_sync_run_manifests | SELECT, UPDATE | Read and advance manifests |
| amaia_sync_manifest_identity_items | SELECT, INSERT | Read and insert all item roles |
| amaia_sync_runs | SELECT | Read run for validation (FOR UPDATE implicit with SELECT + explicit lock query) |
| amaia_sync_leases | SELECT | Read lease for validation |
| amaia_sync_domain_identity_policies | SELECT | Read policies for coherence checks |
| Destination tables (amaia_beneficiaries, amaia_support_network, amaia_alerts, amaia_call_logs, amaia_alert_logs, amaia_health_conditions, amaia_medications) | SELECT | Query P_set/P_check during finalize_comparison |
| amaia_sync_manifest_exclusion_subjects | SELECT | Read for exclusion processing |
| amaia_sync_manifest_exclusion_investigations | SELECT | Read for exclusion processing |
| amaia_sync_manifest_exclusion_decisions | SELECT | Read latest decisions |
| amaia_sync_manifest_exclusion_consumptions | INSERT | Record exclusion consumptions |
| amaia_sync_watermarks | SELECT | Read for complete_manifest provisional logic |

Note: FOR UPDATE requires only SELECT privilege on the target table in PostgreSQL (the lock is on the row, not a separate privilege).

### amaia_sync_runtime

| Object | Privilege |
|---|---|
| amaia_sync_run_manifests | INSERT, SELECT |
| amaia_sync_manifest_identity_items | INSERT, SELECT |
| finalize_source, finalize_comparison, finalize_provisional, complete_manifest | EXECUTE |
| abandon_manifest | (none) |
| amaia_sync_leases | SELECT, UPDATE (for lease acquire/heartbeat/release) |
| amaia_sync_runs | INSERT, SELECT, UPDATE (run creation/closure) |
| amaia_sync_cycles | INSERT, SELECT, UPDATE (cycle creation/closure) |
| amaia_sync_watermarks | SELECT, UPDATE (CAS advance) |
| Destination tables | INSERT, SELECT, UPDATE (domain upserts) |
| amaia_sync_dedup_identity_memberships | INSERT, SELECT, UPDATE |
| amaia_sync_alert_remediation_queue | INSERT, SELECT, UPDATE |

### amaia_sync_recovery_runtime

| Object | Privilege |
|---|---|
| abandon_manifest | EXECUTE |
| amaia_sync_runs | SELECT, UPDATE (orphan recovery) |
| amaia_sync_leases | SELECT, UPDATE (lease acquisition for recovery) |
| amaia_sync_cycles | SELECT, UPDATE (cycle closure) |
| amaia_sync_run_manifests | SELECT |
| amaia_sync_manifest_identity_items | SELECT |

### PUBLIC

No privileges on: manifests, identity_items, any of the 5 functions. EXECUTE explicitly revoked.

### service_role boundary

- NOT a member of manifest_owner.
- Trigger #4 blocks phase advancement (current_user ≠ manifest_owner).
- Trigger #11 blocks derived items (current_user ≠ manifest_owner).
- Engine startup aborts if current_user is service_role/postgres/supabase_admin.

---

## 7. Exclusion Live-Hash Revalidation

During finalize_comparison for non-dedup domains, for each extra_raw element:

1. Get-or-create subject. Lock subject FOR UPDATE (position 6, ascending order).
2. Read subject.current_investigation_id.
3. Read investigation row. Read investigation.investigation_hash.
4. Read latest decision (MAX decision_seq) for current investigation.
5. Verify decision = 'approved'.
6. **Live hash revalidation:** The investigation_hash was computed when the investigation was created, from the AMAIA lookup evidence at that time. The consumption records investigation_hash_at_consumption = investigation.investigation_hash. This is NOT a re-query of the source row — it is a comparison of the investigation's recorded hash against itself, confirming the investigation has not been superseded by a new one (which would change current_investigation_id and invalidate old hashes).

**What "revalidation" means here:** Verify that the investigation being consumed is still the current investigation (subject.current_investigation_id check) with the expected hash (investigation_hash_at_consumption = investigation.investigation_hash). If a new investigation was created between approval and consumption, the subject's current_investigation_id changed → consumption rejected.

7. INSERT excluded item.
8. After manifest updated with sets_match=true: INSERT consumption.

---

## 8. Membership Episode Serialization

### Guarantee

Membership INSERT/UPDATE occurs within Transaction A (source capture). Transaction A holds the domain lease FOR UPDATE (Step 1). Only one transaction per domain holds the domain lease at a time. Therefore: membership INSERTs for a domain are serialized by the domain lease.

Trigger #14 computes `episode_seq = MAX(episode_seq for this source_amaia_id) + 1` within the INSERT trigger. Since INSERTs are serialized by the domain lease (one transaction at a time per domain), MAX+1 is gap-free and collision-free.

No additional advisory lock or per-source lock table is needed.

---

## 9. Tombstone Append-Only — Concrete Trigger

### New trigger: trg_amaia_sync_tombstone_events_append_only

**Table:** amaia_sync_tombstone_events  
**Event:** BEFORE UPDATE OR DELETE  
**For each:** ROW  
**Function:** Raise exception unconditionally.

This trigger is NOT in the deployed baseline (9.3B migration). It is part of this schema patch's DDL. The deployed 9.3B tombstone_events table has no UPDATE/DELETE protection. This trigger adds it.

---

## 10. Provisional Constraints

### Flag constraints (enforced by Trigger #4 on manifest UPDATE)

| Transition | provisional_verified | provisional_skipped |
|---|---|---|
| → provisional_persisted | Must become false | Must remain NULL |
| → comparison_complete (from confirmed_compared) | Must remain NULL | May become true if applicable |
| → comparison_complete (from provisional_persisted) | Must remain false (frozen) | Must remain NULL (frozen) |
| → abandoned | Frozen at current value | Frozen at current value |

### Mutual exclusion

provisional_verified = false AND provisional_skipped = true cannot coexist. If provisional was processed (provisional_verified = false), it was not skipped. If provisional was skipped (provisional_skipped = true), it was not processed.

CHECK: NOT (provisional_verified IS NOT NULL AND provisional_skipped IS NOT NULL AND provisional_skipped = true)

---

## 11. Security Definer Hardening

All 5 functions:
- Owner: amaia_sync_manifest_owner (NOLOGIN).
- manifest_owner NOT member of: postgres, service_role, supabase_admin, pg_write_all_data.
- SET search_path = 'pg_catalog, public'.
- All references fully qualified (public.amaia_sync_*).
- No dynamic SQL.
- EXECUTE revoked from PUBLIC on all 5.
- EXECUTE grants: finalize_source/comparison/provisional/complete → amaia_sync_runtime. abandon → amaia_sync_recovery_runtime.

---

## 12. DDL Impact Delta — Exact

### Starting from deployed baseline (9.3B: 9 triggers, 11 tables with modifications)

### Plus Schema Patch v1.6 DDL (3 new tables, 11 columns, 3 nullability, 17 CHECKs, 12 indexes, 3 FKs, 7 new triggers, 3 updated triggers = 19 total, 3 RLS, 7 seeds)

### Plus Finalization Protocol v1.4 DDL:

| Category | Item | Count |
|---|---|---|
| New columns on manifests | abandoned_by text NULL, abandoned_at timestamptz NULL, abandoned_reason text NULL, provisional_verified boolean NULL, provisional_skipped boolean NULL | 5 |
| Nullability changes on manifests | source_id_count → NULL, source_id_hash → NULL | 2 |
| CHECK changes on manifests | phase adds 'created', source_id_count allows NULL | 2 modified |
| New CHECKs on manifests | abandoned_reason (NULL or length>0), provisional mutual exclusion | 2 |
| New roles | amaia_sync_manifest_owner (NOLOGIN), amaia_sync_recovery_runtime | 2 |
| New SECURITY DEFINER functions | finalize_source, finalize_comparison, finalize_provisional, complete_manifest, abandon_manifest | 5 |
| New trigger | trg_amaia_sync_tombstone_events_append_only | 1 |
| Updated triggers from v1.6 baseline | #4 (phase created + role check + abandon fields + provisional flags), #11 (current_user + FOR SHARE + phase created), #13 (validate phase='created' on INSERT), #14 (episode_seq sequential + status/vigency) | 4 |
| Privilege grants/revokes | ~25 (per Section 6) | — |

### Grand totals (9.3B + Schema Patch v1.6 + Finalization Protocol v1.4)

| Category | Count |
|---|---|
| New tables (beyond deployed) | 3 (identity_items, domain_identity_policies, memberships) |
| New columns on pre-existing tables | 16 (11 from v1.6 + 5 from finalization) |
| Nullability changes | 5 (3 from v1.6 + 2 from finalization) |
| CHECK constraints (new + modified) | 21 (17 from v1.6 + 4 from finalization) |
| Indexes | 12 (from v1.6) |
| FKs | 3 (from v1.6) |
| Deployed triggers (9.3B) | 9 |
| New triggers (v1.6) | 7 (#10–#16) |
| New triggers (finalization) | 1 (tombstone append-only) |
| Updated triggers | 4 (#4, #11, #13, #14) |
| **Total triggers** | **17** (9 deployed + 7 new v1.6 + 1 new finalization) |
| Functions | 5 (SECURITY DEFINER) |
| Roles | 2 (manifest_owner, recovery_runtime) |
| RLS policies | 3 (from v1.6) |
| Seed rows | 7 (domain policies) + 3 (9.3C separate) |

---

## Invariants

All prior invariants preserved. Key updates:

**70 (FINAL):** Lock order: scheduler_lease → cycle → domain_lease → run → manifest → exclusion_subjects → items. No inversion. Runtime acquires domain_lease first. Finalizer acquires run → manifest within the same tx (higher positions). abandon acquires run → manifest (positions 4 → 5).

**75 (FINAL):** Single serialized orchestrator, enforced by scheduler lease singleton. Engine aborts startup if scheduler lease unavailable.

Added:

79. **No domain write before fence.** Every transaction that writes to domain tables, memberships, manifests, or items acquires the domain lease FOR UPDATE as its first Supabase operation.
80. **Trigger functions are SECURITY INVOKER.** current_user reflects the effective caller: runtime for direct INSERTs, manifest_owner for finalizer-driven INSERTs.
81. **Provisional flags are mutually exclusive.** provisional_verified and provisional_skipped cannot both be non-null with provisional_skipped = true.

---

## Self-Audit

### Early fence: domain write before lease acquisition

Attack: Runtime upserts to destination before acquiring domain lease.

Result: Protocol mandates domain lease FOR UPDATE as Transaction A Step 1. All subsequent writes are under the lease. If a buggy implementation writes before locking: there is no schema-level prevention (the lease is a runtime protocol). However: the single-orchestrator model means no other process is writing concurrently. The protocol violation would be a bug, not a security breach. **Protocol-enforced. Single-orchestrator mitigated.**

### Lock order inversion: abandon locks manifest before run

Attack: abandon_manifest locks manifest first, then run.

Result: v1.4 corrected: abandon reads manifest (no lock), locks run (position 4), locks manifest (position 5). Order: 4 → 5. No inversion. **Corrected.**

### Finalizer re-locks domain lease already held by caller

Result: Same transaction. PostgreSQL FOR UPDATE on an already-locked row in the same tx is a no-op. No deadlock. No performance cost. **Safe.**

### service_role calls finalize_comparison directly

Result: EXECUTE not granted to service_role (only to amaia_sync_runtime). PostgreSQL denies. Even if somehow executed: trigger #11 checks current_user on derived item INSERT. service_role ≠ manifest_owner → rejected. **Double-enforced.**

### Scheduler lease lost, engine tries to start new domain transaction

Result: Engine's work loop checks scheduler lease validity before each domain. If expired: does not initiate new transaction. In-flight transactions (already holding domain lease) may complete. **Protocol-enforced.**

### Exclusion subject locked in wrong order

Result: finalize_comparison processes extra_raw elements in ascending identity order. Subjects locked in that order. No concurrent process locks the same subjects in a different order (single orchestrator). Even if a concurrent operator process locked subjects: the ascending order prevents deadlock (both use same order). **Order-enforced.**

### abandon_manifest called with healthy running run

Result: Function validates run is in recoverable state. status='running' alone is not sufficient — the recovery process must also demonstrate domain lease ownership that supersedes the run's lease credentials. If the run's lease is still valid and matches: the run is NOT orphaned → function rejects. **Condition-enforced.**

### Provisional flags contradict

Attack: manifest has provisional_verified=false AND provisional_skipped=true.

Result: CHECK constraint rejects: NOT (provisional_verified IS NOT NULL AND provisional_skipped IS NOT NULL AND provisional_skipped = true). **Schema-enforced.**

### Tombstone event UPDATE

Result: trg_amaia_sync_tombstone_events_append_only: BEFORE UPDATE → raise exception. **Trigger-enforced.**

---

## Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External. Single orchestrator + safety lag + overlap + reconciliation. |
| Early fence is protocol, not schema | Low | Single orchestrator eliminates concurrent writer risk. Protocol violation = implementation bug, not attack vector. |
| manifest_owner role compromise | Low | NOLOGIN. Not member of broad roles. Acts only via SECURITY DEFINER. |
| Future multi-worker breaks singleton model | N/A (V2) | Documented. Requires authentication redesign. |

---

## Criteria for Approval

1. Domain lease acquired before any domain write (early fence).
2. Scheduler singleton enforced (startup + work loop).
3. Lock order total, no inversion (including abandon: run → manifest).
4. Finalizer acquires locks internally (no ambiguous caller pre-locking).
5. Trigger #4/#11 are SECURITY INVOKER with current_user checks.
6. Privileges minimal and complete.
7. Exclusion consumption after manifest.sets_match = true (trigger #8 compatible).
8. Provisional flags mutually exclusive (CHECK enforced).
9. Tombstone append-only trigger declared concretely.
10. DDL inventory exact, no corrections within document.
11. service_role prohibited and enforced.

---

**End of document.**
