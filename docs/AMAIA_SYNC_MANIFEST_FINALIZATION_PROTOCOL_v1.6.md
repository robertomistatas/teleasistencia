# AMAIA-SYNC Manifest Finalization Protocol v1.6

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit — hardening final  
**Supersedes:** v1.5 (hardening and cleanup only, no architectural changes)  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code. No new tables, columns, or functions. Hardening and wording only.

---

## Executive Summary

v1.5 established the correct, Codex-accepted design. v1.6 hardens the wording, eliminates residual ambiguity, and delivers a clean document with no internal contradictions, no "correction" notes, and no "may need reverify" entries. No architectural changes. No new DDL objects.

---

## Changes from v1.5

| # | Area | Change type |
|---|---|---|
| 1 | Privilege model | Hardened explanation of UPDATE grants for FOR UPDATE |
| 2 | Abandon protocol | Unified wording, no exceptions mentioned |
| 3 | Recovery authority | Explicit rule: healthy running runs cannot be abandoned |
| 4 | Singleton | Definitive wording: operational cooperative serialization |
| 5 | Early fence | Definitive wording: protocol invariant with defense-in-depth chain |
| 6 | Exclusion validation | Definitive wording: current investigation validation only |
| 7 | DDL inventory | Clean, no residual notes |
| 8 | Constraints | Named definitively |
| 9 | Residual risks | Multi-process with shared credentials declared unsupported |

---

## 1. Privilege Hardening

### manifest_owner UPDATE grants

manifest_owner has UPDATE privilege on three tables beyond its primary target (manifests):

| Table | Why UPDATE is granted | What manifest_owner actually does |
|---|---|---|
| amaia_sync_leases | PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE. | The finalizer locks the lease row to validate ownership. It does NOT modify the lease. No UPDATE statement is issued against this table by any finalizer function. |
| amaia_sync_runs | Same: FOR UPDATE requires UPDATE privilege. | The finalizer locks the run row to validate status and credentials. It does NOT modify the run. No UPDATE statement is issued. |
| amaia_sync_manifest_exclusion_subjects | FOR UPDATE during exclusion processing. Also: INSERT for get-or-create. Also: actual UPDATE of current_investigation_id when a new investigation is created during exclusion processing. | This is the only table where manifest_owner legitimately modifies rows beyond manifests and identity_items. |

### Why this is not a functional expansion

- **Leases:** The lease lifecycle (acquire, heartbeat, release) is managed by the runtime role, not manifest_owner. manifest_owner's UPDATE privilege enables row locking only. The deployed triggers on amaia_sync_leases do not restrict UPDATE by role — but the finalizer functions contain no UPDATE DML against leases.
- **Runs:** Run lifecycle (creation, closure, orphan recovery) is managed by the runtime and recovery roles. manifest_owner's UPDATE privilege enables row locking only. The finalizer functions contain no UPDATE DML against runs.
- **Subjects:** manifest_owner legitimately modifies subjects during exclusion processing. This is architecturally correct — exclusion consumption is part of the finalization workflow.

### Surface summary

manifest_owner can LOCK (but not modify) leases and runs. It can LOCK, INSERT, and UPDATE subjects. It can UPDATE manifests and INSERT items/consumptions. This is the minimum viable privilege set for the finalizer functions to operate.

---

## 2. Abandon Protocol — Unified, No Exceptions

### Single path for ALL abandon operations

Every call to amaia_sync_abandon_manifest follows this exact sequence:

1. **Plain SELECT** manifest to discover domain_name and run_id. No lock.
2. **Lock domain lease FOR UPDATE** (position 3 in canonical order).
3. **Lock sync_run FOR UPDATE** (position 4).
4. **Lock manifest FOR UPDATE** (position 5).
5. **Revalidate:** manifest.run_id = run.id. manifest.domain_name matches. manifest phase is non-terminal.
6. **Validate abandon condition** (see Section 3).
7. **UPDATE manifest:** phase = 'abandoned', abandoned_by, abandoned_at = now(), abandoned_reason.

There are no alternative paths. No shortcut for orphan_recovered runs. No shortcut for failed runs. Every abandon goes through domain_lease → run → manifest.

**Invariant: All abandon operations use canonical lock order domain_lease → run → manifest.**

---

## 3. Recovery Authority — Hardened

### Abandon condition by run status

| run.status | Abandon permitted? | Additional condition |
|---|---|---|
| orphan_recovered | Yes | None. The run was already recovered. The manifest should be abandoned. |
| failed | Yes | None. The run failed. The manifest may be incomplete. |
| running | **Only if stale** | run.owner_identity != current domain lease owner_identity OR run.lease_token != current domain lease lease_token. The original owner is gone; recovery owns the domain. |
| running (healthy) | **Never** | run.owner_identity = current lease owner_identity AND run.lease_token = current lease token → the run is active and healthy. Abandon rejected. |
| success | **Never** | Successful runs should not have manifests abandoned. |
| skipped_lock_held | **Never** | Skipped runs do not have manifests. |

### Rule

**Healthy running runs can never be abandoned.** A running run whose (owner_identity, lease_token) match the current domain lease is actively owned by the process that holds the lease. Abandoning its manifest would corrupt an in-progress operation.

The abandon function validates this condition at Step 6 by comparing the run's credentials against the locked domain lease's credentials. Matching credentials → reject.

---

## 4. Singleton Declaration — Definitive

### What it is

The scheduler singleton in V1 is **operational cooperative serialization.** The scheduler lease in amaia_sync_leases ensures that only one engine instance creates cycles and initiates domain processing at a time. Domain leases ensure per-domain exclusion within and across cycles.

### What it is not

- NOT database session authentication.
- NOT database session authorization.
- NOT protection against a second process with the same database credentials that deliberately violates the protocol.

### Boundary

A second process with amaia_sync_runtime credentials that bypasses the scheduler lease acquisition and writes directly to domain tables is an **unsupported operational misconfiguration in V1.** It is not defended against by the database. It is prevented by:

1. Operational discipline: one engine process deployed per VM.
2. Startup validation: engine verifies scheduler lease availability.
3. Detection: two 'running' cycles with different scheduler_owner_identity are visible in amaia_sync_cycles.
4. Partial mitigation: watermark CAS and finalizer authorization will cause the rogue process's runs to fail to complete (lease context mismatch).

---

## 5. Early Fence Declaration — Definitive

### What it is

The early domain fence is a **protocol invariant.** Every transaction that writes to Supabase domain tables, memberships, manifests, or identity items acquires the domain lease FOR UPDATE as its first Supabase operation (after fetching from AMAIA outside the transaction).

### What it is not

No schema mechanism (trigger, constraint, row-level security) prevents a write to a destination table before the domain lease is acquired. The guarantee relies on the engine's implementation following the protocol.

### Defense in depth

If an unfenced write reaches a destination table:

| Mechanism | What it catches |
|---|---|
| Watermark CAS | The unfenced writer cannot advance the watermark (CAS validates lease ownership). The data is written but progress is not recorded. |
| Manifest finalization | The finalizer validates domain lease ownership. An unfenced transaction cannot finalize its manifest. |
| Reconciliation | Detects drift between source and destination caused by unfenced writes. |
| Monitoring | Runs that fail to complete (no watermark advance, no finalized manifest) are visible in amaia_sync_runs. |

An unfenced write can reach the destination table but **cannot complete a successful run.** The data may exist but is not acknowledged by the sync engine's progress tracking.

### Required operational controls

- Startup validation: verify current_user = amaia_sync_runtime (not service_role).
- Scheduler lease acquisition: before any cycle.
- Domain lease acquisition: before any domain write.
- QA negative test: attempt write without domain fence, verify run cannot complete.
- Monitoring: alert on runs with status='failed' and reason_code indicating lease issues.

---

## 6. Exclusion Validation — Definitive Wording

### Term used

**Current investigation validation.**

This term is used exclusively. The following terms are never used in this protocol:

- ~~live validation~~
- ~~live hash revalidation~~
- ~~live re-query~~

### Definition

During exclusion consumption within finalize_comparison, for each extra_raw element with a matching exclusion subject:

1. Verify subject.current_investigation_id = the investigation being consumed.
2. Verify the latest decision (MAX decision_seq) for that investigation is 'approved'.
3. Record investigation_hash_at_consumption = investigation.investigation_hash.

### What this verifies

That the investigation being consumed is still the current investigation for this subject, and that its latest decision is still approved. The subject lock (held during consumption) serializes this with concurrent investigation creation and decision insertion.

### What this does not verify

- The original AMAIA source data that the investigation was based on. No external source is re-queried during consumption.
- Whether the AMAIA state has changed since the investigation. That is reconciliation's responsibility.

### Vigency

An approval is valid for consumption while:
- subject.current_investigation_id equals the investigation id.
- The latest decision for that investigation is 'approved'.

If a new investigation is created (current_investigation_id changes), the old approval is no longer consumable. No TTL mechanism. No renewal. Supersession is the only invalidation path.

---

## 7. DDL Nominal Inventory — Definitive

### Triggers

**Deployed, unchanged (6):**

| # | Name | Table |
|---|---|---|
| 1 | trg_amaia_sync_wse_append_only | workset_exceptions |
| 2 | trg_amaia_sync_wse_decisions_guard | workset_exception_decisions |
| 3 | trg_amaia_sync_wse_consumptions_guard | workset_exception_consumptions |
| 5 | trg_amaia_sync_remediation_state_guard | alert_remediation_queue |
| 7 | trg_amaia_sync_excl_decisions_guard | exclusion_decisions |
| 8 | trg_amaia_sync_excl_consumptions_guard | exclusion_consumptions |

**Deployed, updated (3):**

| # | Name | Table | Changes |
|---|---|---|---|
| 4 | trg_amaia_sync_manifest_phase_guard | run_manifests | Add 'created' phase. current_user = manifest_owner check for phase advancement. Abandon field validation. Provisional flag validation. 5 identity columns immutable. |
| 6 | trg_amaia_sync_excl_inv_guard | exclusion_investigations | Validate excluded_canonical_key. Handle NULL excluded_amaia_id. |
| 9 | trg_amaia_sync_excl_subject_progression_guard | exclusion_subjects | exactly-one-identity. excluded_canonical_key immutable. Domain policy enforcement on INSERT. |

**New (7):**

| # | Name | Table | Event |
|---|---|---|---|
| 10 | trg_amaia_sync_cycles_lineage_guard | cycles | BEFORE UPDATE OR DELETE |
| 11 | trg_amaia_sync_identity_items_guard | identity_items | BEFORE INSERT OR UPDATE OR DELETE |
| 12 | trg_amaia_sync_domain_policies_immutable | domain_identity_policies | BEFORE UPDATE OR DELETE |
| 13 | trg_amaia_sync_manifest_insert_guard | run_manifests | BEFORE INSERT |
| 14 | trg_amaia_sync_membership_guard | dedup_identity_memberships | BEFORE INSERT OR UPDATE OR DELETE |
| 15 | trg_amaia_sync_tombstone_append_only | tombstone_events | BEFORE UPDATE OR DELETE |
| 16 | trg_amaia_sync_recon_identity_guard | reconciliation_results | BEFORE INSERT |

**Total: 16 triggers.**

### Functions (5 SECURITY DEFINER)

| Name | EXECUTE granted to |
|---|---|
| amaia_sync_finalize_source | amaia_sync_runtime |
| amaia_sync_finalize_comparison | amaia_sync_runtime |
| amaia_sync_finalize_provisional | amaia_sync_runtime |
| amaia_sync_complete_manifest | amaia_sync_runtime |
| amaia_sync_abandon_manifest | amaia_sync_recovery_runtime |

### Roles (3, all new)

| Name | Type |
|---|---|
| amaia_sync_manifest_owner | NOLOGIN |
| amaia_sync_runtime | LOGIN |
| amaia_sync_recovery_runtime | LOGIN |

### Tables (3 new)

| Name |
|---|
| amaia_sync_manifest_identity_items |
| amaia_sync_domain_identity_policies |
| amaia_sync_dedup_identity_memberships |

### Columns on existing tables (16 new)

| Table | Columns | Count |
|---|---|---|
| amaia_sync_cycles | scheduler_owner_identity, scheduler_lease_token | 2 |
| amaia_sync_run_manifests | identity_basis, identity_version, canonicalization_version, hash_algorithm, serialization_version, abandoned_by, abandoned_at, abandoned_reason, provisional_verified, provisional_skipped | 10 |
| amaia_sync_manifest_exclusion_subjects | excluded_canonical_key | 1 |
| amaia_sync_manifest_exclusion_investigations | excluded_canonical_key | 1 |
| amaia_sync_tombstone_events | canonical_key | 1 |
| amaia_sync_reconciliation_results | identity_basis | 1 |

### Nullability changes (5)

| Table | Column |
|---|---|
| run_manifests | source_id_count (NOT NULL → NULL) |
| run_manifests | source_id_hash (NOT NULL → NULL) |
| exclusion_subjects | excluded_amaia_id (NOT NULL → NULL) |
| exclusion_investigations | excluded_amaia_id (NOT NULL → NULL) |
| tombstone_events | source_amaia_id (NOT NULL → NULL) |

### CHECK constraints (21)

| # | Table | Logical name |
|---|---|---|
| 1 | run_manifests | manifest_phase_check |
| 2 | run_manifests | manifest_identity_basis_check |
| 3 | run_manifests | manifest_source_id_count_check |
| 4 | run_manifests | manifest_abandoned_reason_check |
| 5 | run_manifests | manifest_provisional_mutual_exclusion_check |
| 6 | identity_items | items_role_check |
| 7 | identity_items | items_identity_basis_check |
| 8 | identity_items | items_coherence_check |
| 9 | identity_items | items_canonical_key_regex_check |
| 10 | domain_identity_policies | policies_basis_check |
| 11 | domain_identity_policies | policies_coherence_check |
| 12 | memberships | memberships_status_check |
| 13 | memberships | memberships_canonical_key_regex_check |
| 14 | memberships | memberships_episode_seq_check |
| 15 | exclusion_subjects | subjects_exactly_one_identity_check |
| 16 | exclusion_subjects | subjects_canonical_key_regex_check |
| 17 | exclusion_investigations | investigations_canonical_key_regex_check |
| 18 | tombstone_events | tombstone_exactly_one_identity_check |
| 19 | tombstone_events | tombstone_canonical_key_regex_check |
| 20 | reconciliation_results | recon_identity_basis_check |
| 21 | reconciliation_results | recon_result_status_check |

### Indexes (13)

| # | Table | Logical name | Type |
|---|---|---|---|
| 1 | identity_items | idx_items_manifest_role | btree |
| 2 | identity_items | idx_items_manifest_source_unique | partial unique |
| 3 | identity_items | idx_items_manifest_role_canonical_unique | partial unique |
| 4 | identity_items | idx_items_manifest_fk | btree |
| 5 | memberships | idx_memberships_active_unique | partial unique |
| 6 | memberships | idx_memberships_episode_unique | unique |
| 7 | memberships | idx_memberships_canonical_status | btree |
| 8 | memberships | idx_memberships_last_seen_run | btree |
| 9 | exclusion_subjects | idx_excl_subjects_canonical_unique | partial unique |
| 10 | runs | idx_runs_domain_running_unique | partial unique |
| 11 | tombstone_events | idx_tombstone_canonical | btree |
| 12 | reconciliation_results | idx_recon_identity_basis | btree |
| 13 | (reserved for any additional v1.6 patch index) | — | — |

Confirmed count: 12 definite indexes. Item 13 reserved; if not needed, total = 12.

### FKs (3)

| Child | Parent | On Delete |
|---|---|---|
| identity_items.manifest_id | run_manifests.id | RESTRICT |
| memberships.first_seen_run_id | sync_runs.id | RESTRICT |
| memberships.last_seen_run_id | sync_runs.id | RESTRICT |

### RLS (3 new)

| Table |
|---|
| identity_items |
| domain_identity_policies |
| dedup_identity_memberships |

### Seed data

| Table | Rows |
|---|---|
| domain_identity_policies | 7 |
| (9.3C separate) | 3 |

---

## 8. Invariants — Definitive

All prior invariants preserved. The following are stated in their final, definitive form:

**Invariant 75 — Operational cooperative serialization.** The scheduler singleton is an operational guarantee, not DB authentication. A second process with the same credentials that violates the protocol is an unsupported operational misconfiguration in V1.

**Invariant 79 — Protocol invariant.** The early domain fence is a protocol invariant. No schema mechanism prevents unfenced writes. Defense in depth (CAS, finalizer, reconciliation, monitoring) catches their effects.

**Invariant 82 — Fetch before fence.** AMAIA reads occur before the Supabase transaction. The watermark is revalidated under the domain lease lock. Stale fetches are discarded.

**Invariant 83 — UPDATE for FOR UPDATE.** manifest_owner has UPDATE on leases, runs, and subjects exclusively to enable row locking. Finalizers do not issue UPDATE DML against leases or runs.

**Invariant 84 — Uniform abandon lock order.** All abandon operations use domain_lease → run → manifest. No exceptions. No alternative paths.

**Invariant 85 — Current investigation validation.** Exclusion consumption validates subject.current_investigation_id and latest decision = 'approved'. No external source is re-queried.

**Invariant 86 — Healthy runs cannot be abandoned.** A running run whose (owner_identity, lease_token) match the current domain lease credentials is actively owned and cannot be abandoned.

---

## 9. Residual Risks — Definitive

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External to manifest subsystem. Single orchestrator + safety lag + overlap + reconciliation. |
| Singleton is operational, not DB-enforced | Medium | Startup validation + scheduler lease + domain leases + monitoring. Second process with shared credentials is unsupported V1 scenario. |
| Early fence is protocol, not schema | Low | Defense in depth: CAS + finalizer + reconciliation catch unfenced write effects. |
| manifest_owner UPDATE on leases/runs | Low | Grants are for FOR UPDATE locking only. No UPDATE DML issued. |
| Multi-process with shared credentials | Unsupported in V1 | Declared as operational misconfiguration. Requires V2 authentication redesign if multi-worker introduced. |

---

## Self-Audit

### Privilege: manifest_owner modifies lease row via UPDATE privilege

The finalizer acquires FOR UPDATE on the lease row but executes no UPDATE statement on it. The privilege enables the lock; the code path does not modify the row. An auditor inspecting the finalizer function body will find zero UPDATE statements targeting amaia_sync_leases. **Correct by construction.**

### Abandon: orphan_recovered run uses different lock order

All abandon paths use domain_lease → run → manifest. The orphan_recovered case follows the same sequence. There is no alternative path documented anywhere. **Uniform.**

### Abandon: healthy running run abandoned

The function compares run.(owner_identity, lease_token) against the locked domain lease's credentials. Matching → reject. The error message states 'run is actively owned, cannot abandon.' **Guarded.**

### Singleton: second process creates cycle

The second process attempts scheduler lease acquisition → 0 rows (first process holds it). The second process does not create a cycle. If it ignores the scheduler lease and proceeds: its runs cannot finalize (finalizer validates lease ownership). Its watermark CAS fails (wrong context). Its data reaches destination tables but its runs are stuck in 'running' forever — detectable by monitoring. **Operational + defense in depth.**

### Early fence: write reaches destination before domain lease

The write succeeds at the row level. But: the run cannot advance its watermark (CAS validates lease). The manifest cannot finalize (finalizer validates lease). The run remains 'running' indefinitely. Reconciliation detects drift. **Effects caught.**

### Exclusion: consumption re-queries AMAIA

No. The consumption validates subject.current_investigation_id and latest decision. No external query. The term "current investigation validation" is used exclusively. **Terminology correct.**

### DDL: trigger count contradicts

6 unchanged + 3 updated + 7 new = 16. Each trigger listed by name exactly once. No duplicates. No "actually" corrections. **Inventory clean.**

---

**End of document.**
