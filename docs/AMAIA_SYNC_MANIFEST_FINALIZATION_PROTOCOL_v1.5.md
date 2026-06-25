# AMAIA-SYNC Manifest Finalization Protocol v1.5

**Type:** Subsystem protocol blueprint  
**Status:** Pending Codex audit  
**Supersedes:** v1.4  
**Parent patch:** Schema Patch v1.6  
**Deployed baseline:** Commit dc7574c  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.4 established the approved core: early domain fence, scheduler singleton, finalizer queries destination, runtime cannot fabricate evidence, lock order without inversion, trigger-enforced role separation. v1.5 corrects the remaining issues: SELECT FOR UPDATE privilege requirements, abandon lock order for running runs, honest singleton declaration, fetch-before-fence strategy, exclusion terminology, and a nominal DDL inventory with no arithmetic contradictions.

---

## Changes from v1.4

| # | Issue | Resolution |
|---|---|---|
| 1 | manifest_owner needs UPDATE for FOR UPDATE | Grant UPDATE on leases/runs/subjects to manifest_owner (minimal surface) |
| 2 | Abandon of running run inverts lock order | Uniform lock order for ALL abandon cases: domain_lease → run → manifest |
| 3 | Singleton sold as DB enforcement | Declared as operational cooperative guarantee, not DB authentication |
| 4 | Early fence not enforceable by schema | Declared as protocol invariant with startup/QA validation |
| 5 | Fetch AMAIA under domain lock = long tx | Option A: fetch before lock, write after lock |
| 6 | "Live hash revalidation" is misleading | Renamed to "current investigation validation" |
| 7 | DDL inventory contradictory counts | Nominal inventory by name, no arithmetic |
| 8 | amaia_sync_runtime role status unclear | Declared as new role created by the patch |
| 9 | Provisional consumers | Maintained: unverified, no report may treat as verified |
| 10 | DDL delta | Updated with all corrections |

---

## 1. Privilege Model — FOR UPDATE Requires UPDATE Privilege

### Problem

In PostgreSQL, SELECT ... FOR UPDATE requires the caller to have both SELECT and UPDATE privilege on the target table. v1.4 granted manifest_owner only SELECT on leases, runs, and exclusion subjects — but the finalizer uses FOR UPDATE on these tables.

### Corrected grants for manifest_owner

| Table | Privilege | Reason |
|---|---|---|
| amaia_sync_leases | SELECT, **UPDATE** | FOR UPDATE in finalizer authorization |
| amaia_sync_runs | SELECT, **UPDATE** | FOR UPDATE in finalizer authorization |
| amaia_sync_manifest_exclusion_subjects | SELECT, **UPDATE**, **INSERT** | FOR UPDATE for exclusion processing. INSERT for get-or-create. |
| amaia_sync_run_manifests | SELECT, UPDATE | Unchanged (phase advancement) |
| amaia_sync_manifest_identity_items | SELECT, INSERT | Unchanged |
| amaia_sync_domain_identity_policies | SELECT | Unchanged |
| Destination tables | SELECT | Unchanged (read-only P_check query) |
| amaia_sync_manifest_exclusion_investigations | SELECT | Unchanged |
| amaia_sync_manifest_exclusion_decisions | SELECT | Unchanged |
| amaia_sync_manifest_exclusion_consumptions | INSERT | Unchanged |
| amaia_sync_watermarks | SELECT | Unchanged |

### Surface analysis

The UPDATE grants on leases, runs, and subjects are necessary for FOR UPDATE. The finalizer does NOT actually UPDATE these rows (it only locks them for validation). The UPDATE privilege enables the lock; the finalizer's code path does not issue UPDATE statements on these tables.

**Exception:** amaia_sync_manifest_exclusion_subjects may be UPDATEd by the finalizer during get-or-create (the subject's current_investigation_id is updated when a new investigation is created). This happens during exclusion processing, not during finalization itself — but the finalizer MAY trigger auto-creation of exclusion investigation subjects when extra_ids are detected. The UPDATE privilege is legitimately needed.

The INSERT on exclusion subjects is needed for the get-or-create pattern (INSERT ON CONFLICT DO NOTHING + SELECT FOR UPDATE).

### Minimal surface justification

manifest_owner has UPDATE on 3 tables (leases, runs, subjects) beyond what v1.4 specified. This is the minimum required by PostgreSQL's FOR UPDATE semantics. The finalizer does not modify lease rows or run rows — it only reads them under lock. The UPDATE privilege enables the lock acquisition, not data modification.

---

## 2. Abandon Lock Order — Uniform for All Cases

### Problem

v1.4 used run → manifest (positions 4 → 5) for abandon of orphan_recovered/failed runs, but needed domain_lease → run → manifest (positions 3 → 4 → 5) for abandon of running runs. Two code paths with different lock orders.

### Decision: Uniform order for ALL abandon cases

**abandon_manifest always acquires: domain_lease → run → manifest (positions 3 → 4 → 5).**

This is the same order as normal finalizer operations. No special case. No inversion risk.

### Updated amaia_sync_abandon_manifest internal sequence

1. Read manifest.domain_name and manifest.run_id (plain SELECT, no lock).
2. **Lock domain lease FOR UPDATE** (position 3). Read current owner_identity and lease_token from the lease.
3. **Lock sync_run FOR UPDATE** (position 4). Read run's status, owner_identity, lease_token.
4. **Lock manifest FOR UPDATE** (position 5). Revalidate manifest.run_id = run.id. Validate phase not terminal.

**Orphan condition validation (at Step 3):**

| run.status | Condition | Abandon allowed? |
|---|---|---|
| orphan_recovered | Always | Yes — the run was already recovered. Manifest should be abandoned. |
| failed | Always | Yes — the run failed. Manifest may be incomplete. |
| running | run.(owner_identity, lease_token) do NOT match current domain lease.(owner_identity, lease_token) | Yes — the original owner is gone, recovery process owns the domain. |
| running | run.(owner_identity, lease_token) DO match current lease | **No** — the run is healthy and active. Reject. |
| success | Never | **No** — successful runs should not have their manifest abandoned. |
| skipped_lock_held | Never | **No** — skipped runs have no manifest. |

5. UPDATE manifest: phase='abandoned', abandoned_by, abandoned_at=now(), abandoned_reason.

### Why uniform order is safe

Even for orphan_recovered/failed runs where the domain lease might be held by the recovery process: the recovery process IS the one calling abandon_manifest. It holds the scheduler lease and (for domain recovery) the domain lease. Locking the domain lease first is natural — the recovery process already acquired it during orphan recovery.

### Privilege for abandon_manifest

The function is SECURITY DEFINER owned by manifest_owner. manifest_owner has UPDATE on leases (for FOR UPDATE). EXECUTE granted only to amaia_sync_recovery_runtime.

---

## 3. Scheduler Singleton — Honest Operational Declaration

### What the scheduler singleton IS

The scheduler singleton is an **operational cooperative guarantee** for V1. The scheduler lease in amaia_sync_leases ensures that only one engine instance creates cycles and initiates domain processing at a time. Combined with the single-process architecture, this means: one process, one thread per domain, sequential execution.

### What the scheduler singleton IS NOT

- It is NOT a database-level authentication mechanism. Two processes with the same DB credentials (amaia_sync_runtime) could both run. The scheduler lease prevents them from creating concurrent cycles — the second process's lease acquisition fails (0 rows). But if the second process ignores the lease and writes directly (skipping the protocol), the DB does not block it (the process has INSERT/UPDATE privileges on domain tables).
- It is NOT a defense against a malicious or buggy second process that violates the protocol.

### What makes it work in V1

1. **Startup validation:** The engine verifies it can acquire the scheduler lease. If not: it does not start work.
2. **Scheduler lease:** Only the lease holder creates cycles. The second process cannot acquire (0 rows → no cycle → no work).
3. **Domain leases:** Even if a second process somehow started, domain leases serialize per-domain access. Two processes cannot hold the same domain lease simultaneously.
4. **Operational discipline:** Only one engine process is deployed on VM AMAIASQL. This is an operational requirement, not a DB constraint.
5. **QA validation:** Negative test: a second connection attempting domain writes without proper lease should fail by protocol (the writes themselves succeed at DB level, but the watermark CAS + manifest finalization fail without proper lease context).

### Residual risk

A second process with amaia_sync_runtime credentials that bypasses the scheduler lease protocol can write to domain tables. This is mitigated by: operational discipline (one process per VM), startup validation, and monitoring (two 'running' cycles with different scheduler_owner_identity would be detectable).

---

## 4. Early Fence — Protocol Invariant, Not Schema Enforcement

### Declaration

**The early domain fence is a runtime protocol invariant.** No schema mechanism (trigger, constraint) prevents a write to a destination table before the domain lease is acquired. The guarantee relies on:

1. The engine's implementation following the protocol.
2. Startup validation confirming proper role and scheduler lease.
3. The single-process operational model (no rogue concurrent writer).

### Enforcement mechanisms

| Mechanism | Type | What it catches |
|---|---|---|
| Startup role validation | Runtime | Wrong role (service_role, postgres) → abort |
| Scheduler lease acquisition | Runtime | Another engine instance → no work |
| Domain lease acquisition | Runtime | Another process on same domain → skip |
| Watermark CAS | Schema | Stale watermark advance → 0 rows → abort |
| Manifest finalization | Schema | Finalizer validates lease ownership → stale writer rejected |
| QA negative test | Test | Attempt write without domain lease → protocol violation detectable |

The chain provides defense in depth. A protocol violation (write without fence) is not prevented at the schema level, but its EFFECTS are caught: the watermark cannot advance without a valid lease (CAS validates), and the manifest cannot finalize without lease ownership. An unfenced write may succeed at the row level, but the run cannot complete successfully.

---

## 5. Fetch AMAIA Strategy — Option A: Fetch Before Lock

### Decision

**Fetch from AMAIA occurs BEFORE acquiring the domain lease.** Writes to Supabase occur AFTER.

### Transaction A revised sequence

1. **Read watermark** (SELECT — no lock, read committed snapshot).
2. **Compute safe window** (lower_bound, upper_bound, safety lag).
3. **Fetch from AMAIA** (MySQL query — external, no Supabase lock). Accumulate rows in memory.
4. **BEGIN Supabase transaction.**
5. **Lock domain lease FOR UPDATE.** Validate 4-part ownership.
6. **Revalidate watermark:** Read watermark again under the domain lease lock. If watermark_before has changed since Step 1 (another process advanced it between our read and our lock): ROLLBACK. Our fetched data may be stale or redundant. Retry from Step 1.
7. **Upsert to destination** (rows fetched in Step 3).
8. **Update memberships** (if dedup domain).
9. **INSERT manifest** (phase='created').
10. **INSERT source items.**
11. **CALL finalize_source.**
12. **COMMIT.**

### Why this is safe

- No Supabase write occurs before Step 5 (domain lease lock). The early fence invariant is maintained.
- The AMAIA fetch (Step 3) is a read-only operation against an external system. It does not modify any state.
- The watermark revalidation (Step 6) catches races: if someone advanced the watermark between our fetch and our lock, we abort and retry. The fetched data is discarded.
- The domain lease lock duration covers only Steps 5-12 (Supabase writes), not the AMAIA fetch. This keeps transactions short.

### Impact on existing protocol

No change to finalizer APIs, trigger behavior, or lock order. The change is to the RUNTIME's transaction structure: fetch AMAIA outside the transaction, write inside. The finalizer still acquires run → manifest locks within the same transaction.

---

## 6. Exclusion Terminology — Current Investigation Validation

### Corrected terminology

The process performed during finalize_comparison for exclusions is **current investigation validation**, not "live hash revalidation."

### What is validated

For each extra_raw element with a matching exclusion subject:

1. **Subject vigency:** subject.current_investigation_id points to the investigation being consumed.
2. **Decision currency:** The latest decision (MAX decision_seq) for the current investigation is 'approved'.
3. **Investigation identity:** investigation_hash_at_consumption = investigation.investigation_hash. This confirms the consumption references the correct investigation version — not that the underlying data was re-queried from any external source.

### What is NOT validated

- The original AMAIA lookup that produced the investigation's evidence is NOT re-executed. The investigation records what was found at investigation time. The consumption confirms it is using THAT investigation's hash, not a newer or different one.
- If the AMAIA source state changed since the investigation: this is not detected by the consumption. It would be detected by a future reconciliation that produces a new investigation (superseding the current one).

### Vigency definition

An approval is valid for consumption if and only if:
1. The subject's current_investigation_id equals the investigation being consumed.
2. The latest decision for that investigation is 'approved'.

If a new investigation is created (subject.current_investigation_id changes): old approvals are no longer consumable — the subject lock serializes investigation creation with consumption.

No TTL or renewal mechanism. Approvals are valid until superseded by a new investigation.

---

## 7. DDL Nominal Inventory

### Deployed triggers (9, from 9.3B migration, unchanged)

| # | Name | Table |
|---|---|---|
| 1 | trg_amaia_sync_wse_append_only | workset_exceptions |
| 2 | trg_amaia_sync_wse_decisions_guard | workset_exception_decisions |
| 3 | trg_amaia_sync_wse_consumptions_guard | workset_exception_consumptions |
| 4 | trg_amaia_sync_manifest_phase_guard | run_manifests |
| 5 | trg_amaia_sync_remediation_state_guard | alert_remediation_queue |
| 6 | trg_amaia_sync_excl_inv_guard | exclusion_investigations |
| 7 | trg_amaia_sync_excl_decisions_guard | exclusion_decisions |
| 8 | trg_amaia_sync_excl_consumptions_guard | exclusion_consumptions |
| 9 | trg_amaia_sync_excl_subject_progression_guard | exclusion_subjects |

### New triggers (from Schema Patch v1.6, 8 total)

| # | Name | Table | Event |
|---|---|---|---|
| 10 | trg_amaia_sync_cycles_lineage_guard | cycles | BEFORE UPDATE OR DELETE |
| 11 | trg_amaia_sync_identity_items_guard | identity_items | BEFORE INSERT OR UPDATE OR DELETE |
| 12 | trg_amaia_sync_domain_policies_immutable | domain_identity_policies | BEFORE UPDATE OR DELETE |
| 13 | trg_amaia_sync_manifest_insert_guard | run_manifests | BEFORE INSERT |
| 14 | trg_amaia_sync_membership_guard | dedup_identity_memberships | BEFORE INSERT OR UPDATE OR DELETE |
| 15 | trg_amaia_sync_tombstone_append_only | tombstone_events | BEFORE UPDATE OR DELETE |
| 16 | trg_amaia_sync_recon_identity_guard | reconciliation_results | BEFORE INSERT |
| 17 | trg_amaia_sync_runs_unique_running | runs | (partial unique index — not a trigger, see indexes) |

Note: Item 17 is an INDEX, not a trigger. Corrected below. New triggers: 7 (#10–#16).

### Updated triggers (modifications to deployed triggers, 4 total)

| # | Name | Change |
|---|---|---|
| 4 | trg_amaia_sync_manifest_phase_guard | Add 'created' phase. current_user check for phase advancement. Abandon field validation. Provisional flag validation. 5 identity columns immutable. |
| 6 | trg_amaia_sync_excl_inv_guard | Validate excluded_canonical_key. Handle NULL excluded_amaia_id. |
| 9 | trg_amaia_sync_excl_subject_progression_guard | exactly-one-identity. excluded_canonical_key immutable. Domain policy enforcement. |
| 11 | trg_amaia_sync_identity_items_guard | (New, but listed here for completeness — its logic includes FOR SHARE on manifest, current_user check, phase-bound roles.) |

Correction: #11 is new, not updated. Updated deployed triggers: #4, #6, #9 (3 triggers).

### Trigger totals

- Deployed unchanged: 6 (#1, #2, #3, #5, #7, #8)
- Deployed updated: 3 (#4, #6, #9)
- New: 7 (#10, #11, #12, #13, #14, #15, #16)
- **Grand total: 16 triggers**

### Stored functions (5 SECURITY DEFINER)

| Name | EXECUTE granted to |
|---|---|
| amaia_sync_finalize_source | amaia_sync_runtime |
| amaia_sync_finalize_comparison | amaia_sync_runtime |
| amaia_sync_finalize_provisional | amaia_sync_runtime |
| amaia_sync_complete_manifest | amaia_sync_runtime |
| amaia_sync_abandon_manifest | amaia_sync_recovery_runtime |

### Roles

| Role | Status | Type |
|---|---|---|
| amaia_sync_manifest_owner | **New** (this patch) | NOLOGIN |
| amaia_sync_runtime | **New** (this patch) | LOGIN |
| amaia_sync_recovery_runtime | **New** (this patch) | LOGIN (or NOLOGIN if used via SET ROLE) |

None of these roles exist in the deployed baseline. All 3 are created by the patch migration.

### New tables (from Schema Patch v1.6, 3 total)

| Name |
|---|
| amaia_sync_manifest_identity_items |
| amaia_sync_domain_identity_policies |
| amaia_sync_dedup_identity_memberships |

### New columns on existing tables (16 total)

| Table | Column | Count |
|---|---|---|
| amaia_sync_cycles | scheduler_owner_identity, scheduler_lease_token | 2 |
| amaia_sync_run_manifests | identity_basis, identity_version, canonicalization_version, hash_algorithm, serialization_version, abandoned_by, abandoned_at, abandoned_reason, provisional_verified, provisional_skipped | 10 |
| amaia_sync_manifest_exclusion_subjects | excluded_canonical_key | 1 |
| amaia_sync_manifest_exclusion_investigations | excluded_canonical_key | 1 |
| amaia_sync_tombstone_events | canonical_key | 1 |
| amaia_sync_reconciliation_results | identity_basis | 1 |

### Nullability changes (5 total)

| Table | Column |
|---|---|
| amaia_sync_run_manifests | source_id_count (NOT NULL → NULL) |
| amaia_sync_run_manifests | source_id_hash (NOT NULL → NULL) |
| amaia_sync_manifest_exclusion_subjects | excluded_amaia_id (NOT NULL → NULL) |
| amaia_sync_manifest_exclusion_investigations | excluded_amaia_id (NOT NULL → NULL) |
| amaia_sync_tombstone_events | source_amaia_id (NOT NULL → NULL) |

### CHECK constraints (21 total, by logical name)

| # | Table | Logical name |
|---|---|---|
| 1 | run_manifests | phase_check (add 'created') |
| 2 | run_manifests | identity_basis_check |
| 3 | run_manifests | source_id_count_check (allow NULL) |
| 4 | run_manifests | abandoned_reason_check |
| 5 | run_manifests | provisional_mutual_exclusion_check |
| 6 | identity_items | item_role_check |
| 7 | identity_items | identity_basis_check |
| 8 | identity_items | coherence_check |
| 9 | identity_items | canonical_key_regex_check |
| 10 | domain_identity_policies | required_identity_basis_check |
| 11 | domain_identity_policies | coherence_check |
| 12 | dedup_identity_memberships | status_check |
| 13 | dedup_identity_memberships | canonical_key_regex_check |
| 14 | dedup_identity_memberships | episode_seq_check |
| 15 | exclusion_subjects | exactly_one_identity_check |
| 16 | exclusion_subjects | canonical_key_regex_check |
| 17 | exclusion_investigations | canonical_key_regex_check |
| 18 | tombstone_events | exactly_one_tombstone_identity_check |
| 19 | tombstone_events | canonical_key_regex_check |
| 20 | reconciliation_results | identity_basis_check |
| 21 | reconciliation_results | result_status_check (from 9.3B, may need re-verify) |

### Indexes (13 total, by logical name)

| # | Table | Name | Type |
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
| 13 | (cycle indexes from v1.6 already covered in Schema Patch) | | |

Note: Indexes from the deployed 9.3B migration are not counted again. Only new indexes from the patch.

### FKs (3, from Schema Patch v1.6)

| Child | Parent | On Delete |
|---|---|---|
| identity_items.manifest_id | run_manifests.id | RESTRICT |
| memberships.first_seen_run_id | sync_runs.id | RESTRICT |
| memberships.last_seen_run_id | sync_runs.id | RESTRICT |

### RLS policies (3 new)

| Table |
|---|
| identity_items |
| domain_identity_policies |
| dedup_identity_memberships |

### Seed data

| Table | Rows |
|---|---|
| domain_identity_policies | 7 |
| (9.3C separate: watermarks + scheduler lease) | 3 |

---

## 8. amaia_sync_runtime Role

This role does NOT exist in the deployed baseline. It is **created by the patch migration** as a LOGIN role. The engine must connect as this role.

Startup preflight validates:
1. Current role is amaia_sync_runtime.
2. Current role is NOT service_role, postgres, or supabase_admin.
3. All 7 watermark rows exist.
4. Scheduler lease row exists.
5. All 7 domain_identity_policies rows exist.

If any check fails: abort startup.

---

## 9. Provisional Consumers

### Contract

- provisional_verified = false means: values provided by runtime, not independently verified by finalizer.
- **No reporting module, QA assertion, or dashboard may treat provisional_persisted evidence as verified.**
- Provisional data is informational: it indicates that processing occurred in the lag zone, not that the data was validated.
- Verified status (provisional_verified = true) is reserved for a future enhancement that would independently compute provisional hashes from items.

### Constraint (from v1.4, unchanged)

provisional_verified and provisional_skipped are mutually exclusive: CHECK NOT (provisional_verified IS NOT NULL AND provisional_skipped IS NOT NULL AND provisional_skipped = true).

---

## Invariants

All v1.4 invariants (1-81) preserved. Updated:

**Invariant 75 (CLARIFIED):** The scheduler singleton is an operational cooperative guarantee. It prevents concurrent cycle creation via lease contention. It does NOT authenticate DB sessions. A second process with the same DB credentials that bypasses the scheduler lease protocol is not blocked by the database — it is prevented by operational discipline and detectable by monitoring.

**Invariant 79 (CLARIFIED):** The early domain fence is a protocol invariant, not a schema constraint. No schema mechanism prevents a write before the domain lease is acquired. The guarantee relies on correct engine implementation, startup validation, and the defense-in-depth chain (watermark CAS, finalizer lease validation).

Added:

82. **AMAIA fetch occurs before the Supabase fence.** The MySQL read is outside the Supabase transaction. The watermark is revalidated after acquiring the domain lease. If the watermark changed: rollback and retry.
83. **manifest_owner has UPDATE on leases, runs, and exclusion subjects** for FOR UPDATE lock acquisition. These grants are the minimum required by PostgreSQL semantics.
84. **Abandon always uses domain_lease → run → manifest lock order.** No special case for orphan_recovered/failed runs. Uniform order for all abandon paths.
85. **Exclusion validation is current-investigation validation**, not live source re-query. Vigency = subject.current_investigation_id points to the consumed investigation. No TTL.

---

## Self-Audit

### manifest_owner calls FOR UPDATE on leases without UPDATE privilege

v1.4 bug. v1.5 grants UPDATE on amaia_sync_leases to manifest_owner. FOR UPDATE succeeds. **Fixed.**

### Abandon of running run inverts lock order (run before domain)

v1.4 bug for running-run case. v1.5: ALL abandon paths use domain_lease → run → manifest. No inversion. **Fixed.**

### Second engine process bypasses scheduler lease and writes directly

Scheduler singleton is operational, not DB-enforced. The second process can write. But: its watermark CAS fails (wrong lease context in the CAS predicate), and its manifest finalization fails (finalizer validates lease ownership). The writes reach the destination table but the run cannot complete successfully. Reconciliation detects the anomaly. **Declared honestly as operational guarantee.**

### AMAIA fetch under domain lock causes 30+ second transaction

v1.5: fetch AMAIA BEFORE domain lock. Transaction covers only Supabase writes (Steps 5-12). Fetch time does not extend the transaction. Watermark revalidation (Step 6) catches stale fetches. **Resolved.**

### "Live hash revalidation" suggests re-querying AMAIA during consumption

v1.5: renamed to "current investigation validation." Explicitly states: no external source is re-queried. Only the investigation record's identity is confirmed. **Terminology corrected.**

### Trigger count says 19 but list has 17

v1.5: nominal list: 6 deployed unchanged + 3 deployed updated + 7 new = 16 total. Each listed by name. No arithmetic contradiction. **Inventory clean.**

### amaia_sync_runtime role doesn't exist in baseline

v1.5: declared as new role. Startup preflight validates current_user = amaia_sync_runtime. **Counted as new.**

### Provisional evidence treated as verified by downstream

v1.5: explicit contract: provisional_verified = false → no consumer may treat as verified. **Declared.**

---

## Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source items trust boundary | Medium | External. Single orchestrator + safety lag + overlap + reconciliation. |
| Singleton is operational, not DB-enforced | Medium | Startup validation + scheduler lease + domain leases + monitoring. |
| Early fence is protocol, not schema | Low | Defense in depth: CAS + finalizer validation catch unfenced writes. |
| manifest_owner UPDATE on leases/runs/subjects | Low | Necessary for FOR UPDATE. Finalizer does not modify these rows (except subjects during get-or-create). |
| Future multi-worker | N/A (V2) | Documented. Requires authentication redesign. |

---

## Criteria for Approval

1. Privilege model accounts for FOR UPDATE requiring UPDATE privilege.
2. Abandon lock order is uniform (domain → run → manifest) for all cases.
3. Singleton is honestly declared as operational guarantee.
4. Early fence is honestly declared as protocol invariant with defense-in-depth.
5. AMAIA fetch before Supabase lock eliminates long transactions.
6. Exclusion terminology is accurate (current investigation validation, not live re-query).
7. DDL inventory is nominal (by name, no arithmetic contradictions).
8. All roles declared as new (none exist in baseline).
9. Provisional consumers warned: unverified evidence.
10. Total triggers: 16 (6 unchanged + 3 updated + 7 new), each named.

---

**End of document.**
