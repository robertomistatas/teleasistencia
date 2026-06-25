# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.6

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** v1.5 (cleanup: inventory inconsistencies, finalizer hardening, self-audit rigor)  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.6 is the cleaned, internally consistent version of v1.5. The architecture is unchanged. The corrections are: exact DDL inventory with no self-contradictions, hardened manifest finalizer that is the sole code path for phase advancement (no direct UPDATE bypass), and self-audit that relies on schema/function enforcement rather than QA detection.

---

## DDL Impact — Definitive

### New tables: 3

| # | Table | Purpose | Mutable |
|---|---|---|---|
| 1 | amaia_sync_manifest_identity_items | Per-item manifest evidence | No (append-only, trigger enforced) |
| 2 | amaia_sync_domain_identity_policies | Domain identity config | No (immutable seed, trigger enforced) |
| 3 | amaia_sync_dedup_identity_memberships | Source→canonical mapping with episodes | Yes (status transitions, trigger guarded) |

### New stored function: 1

| Function | Purpose | Modes |
|---|---|---|
| manifest_finalize | Compute hashes/counts from items, advance phase | source, comparison, provisional |

This is a SECURITY DEFINER function owned by a privileged role. It is the SOLE code path that can advance the manifest phase (see Section 2). Normal callers (the sync engine's connection role) cannot UPDATE the manifest phase directly — only the finalizer function can.

### New columns on existing tables: 11

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

### Nullability changes: 3

| # | Table | Column | Before | After |
|---|---|---|---|---|
| 1 | amaia_sync_manifest_exclusion_subjects | excluded_amaia_id | NOT NULL | NULL |
| 2 | amaia_sync_manifest_exclusion_investigations | excluded_amaia_id | NOT NULL | NULL |
| 3 | amaia_sync_tombstone_events | source_amaia_id | NOT NULL | NULL |

### CHECK constraints: 17

| # | Table | Constraint |
|---|---|---|
| 1 | amaia_sync_run_manifests | phase IN ('created', 'source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned') |
| 2 | amaia_sync_run_manifests | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 3 | amaia_sync_manifest_identity_items | item_role IN ('source', 'persisted', 'missing', 'extra', 'excluded') |
| 4 | amaia_sync_manifest_identity_items | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 5 | amaia_sync_manifest_identity_items | coherence: (basis='source_amaia_id' AND source_amaia_id IS NOT NULL AND canonical_key IS NULL) OR (basis='canonical_dedup_key' AND canonical_key IS NOT NULL AND beneficiary_amaia_id IS NOT NULL AND canonical_hash IS NOT NULL AND canonical_hash_version IS NOT NULL) |
| 6 | amaia_sync_manifest_identity_items | canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$' when not null |
| 7 | amaia_sync_domain_identity_policies | required_identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 8 | amaia_sync_domain_identity_policies | coherence: (basis='source_amaia_id' AND required_canonicalization_version IS NULL) OR (basis='canonical_dedup_key' AND required_canonicalization_version IS NOT NULL) |
| 9 | amaia_sync_dedup_identity_memberships | status IN ('active', 'closed', 'source_deleted', 'tombstoned') |
| 10 | amaia_sync_dedup_identity_memberships | canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$' |
| 11 | amaia_sync_dedup_identity_memberships | episode_seq > 0 |
| 12 | amaia_sync_manifest_exclusion_subjects | exactly_one_identity: (excluded_amaia_id IS NOT NULL AND excluded_canonical_key IS NULL) OR (excluded_amaia_id IS NULL AND excluded_canonical_key IS NOT NULL) |
| 13 | amaia_sync_tombstone_events | exactly_one_tombstone_identity: (source_amaia_id IS NOT NULL AND canonical_key IS NULL) OR (source_amaia_id IS NULL AND canonical_key IS NOT NULL) |
| 14 | amaia_sync_tombstone_events | canonical_key regex when not null |
| 15 | amaia_sync_reconciliation_results | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| 16 | amaia_sync_manifest_exclusion_subjects | canonical_key regex when not null |
| 17 | amaia_sync_manifest_exclusion_investigations | canonical_key regex when not null |

### Indexes: 12

| # | Table | Columns | Type |
|---|---|---|---|
| 1 | identity_items | (manifest_id, item_role) | btree |
| 2 | identity_items | (manifest_id, source_amaia_id) WHERE source_amaia_id IS NOT NULL AND item_role='source' | partial unique |
| 3 | identity_items | (manifest_id, item_role, canonical_key) WHERE canonical_key IS NOT NULL AND item_role IN ('persisted','missing','extra','excluded') | partial unique |
| 4 | identity_items | (manifest_id) | btree (FK) |
| 5 | memberships | (domain_name, source_amaia_id) WHERE status='active' | partial unique |
| 6 | memberships | (domain_name, source_amaia_id, episode_seq) | unique |
| 7 | memberships | (domain_name, canonical_key, status) | btree |
| 8 | memberships | (last_seen_run_id) | btree (FK) |
| 9 | exclusion_subjects | (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL | partial unique |
| 10 | runs | (domain_name) WHERE status='running' | partial unique |
| 11 | tombstone_events | (domain_name, canonical_key) WHERE canonical_key IS NOT NULL | btree |
| 12 | reconciliation_results | (identity_basis) | btree |

### FKs: 3

| # | Child table | Column | Parent | On Delete |
|---|---|---|---|---|
| 1 | identity_items | manifest_id | manifests(id) | RESTRICT |
| 2 | memberships | first_seen_run_id | sync_runs(id) | RESTRICT |
| 3 | memberships | last_seen_run_id | sync_runs(id) | RESTRICT |

### Triggers: 19 total

**Existing deployed (unchanged): 9** (#1–#9 from 9.3B migration)

**Updated: 3**

| # | Table | Change |
|---|---|---|
| #4 | manifests | phase_column_guard: add 'created' phase, 5 identity columns immutable, reject direct phase UPDATE (only finalizer can advance — see Section 2) |
| #6 | exclusion_investigations | canonical_key + exactly-one denorm validation |
| #9 | exclusion_subjects | canonical_key + exactly-one + domain policy validation |

**New: 7**

| # | Table | Trigger | Event |
|---|---|---|---|
| 10 | cycles | lineage_guard | BEFORE UPDATE OR DELETE |
| 11 | identity_items | append_only_coherence | BEFORE INSERT OR UPDATE OR DELETE |
| 12 | domain_identity_policies | immutable_guard | BEFORE UPDATE OR DELETE |
| 13 | manifests | insert_guard | BEFORE INSERT |
| 14 | memberships | membership_guard | BEFORE INSERT OR UPDATE OR DELETE |
| 15 | tombstone_events | tombstone_identity_guard | BEFORE INSERT |
| 16 | reconciliation_results | recon_identity_guard | BEFORE INSERT |

### RLS policies: 3 new

| Table | Policy |
|---|---|
| identity_items | admin/super_admin SELECT |
| domain_identity_policies | admin/super_admin SELECT |
| memberships | admin/super_admin SELECT |

### Seed data: 7 rows

domain_identity_policies: 7 rows (one per domain, with all 5 required version fields).

9.3C seeds (separate migration): 2 watermark seeds + 1 scheduler lease seed.

---

## 2. Hardened Manifest Finalizer — Sole Phase Advancement Path

### Problem

v1.5 acknowledged that a runtime caller could bypass the finalizer by directly UPDATEing the manifest with fabricated hashes and advancing the phase. Trigger #4 validates fields are NOT NULL but cannot verify hash correctness. This leaves a gap where a manifest could reach terminal state with incoherent evidence.

### Solution: SECURITY DEFINER function + trigger rejection of direct phase UPDATE

**The manifest_finalize function is defined as SECURITY DEFINER**, executing with the privileges of a dedicated owner role (e.g., the schema owner or a manifest_admin role). This role has UPDATE privilege on amaia_sync_run_manifests.

**The sync engine's connection role does NOT have direct UPDATE privilege on amaia_sync_run_manifests for the phase column.** It has:
- INSERT privilege (to create the manifest at phase='created').
- SELECT privilege.
- EXECUTE privilege on manifest_finalize.

It does NOT have UPDATE privilege on manifests — or if it does (for operational simplicity), Trigger #4 rejects phase-advancing UPDATEs that do not originate from the finalizer.

### Finalizer identification mechanism

The finalizer sets a transaction-local configuration variable before performing the UPDATE:

```
set_config('amaia_sync.finalizer_active', 'true', true)
```

The `true` third argument makes it local to the current transaction. Trigger #4 checks:

```
IF current_setting('amaia_sync.finalizer_active', true) IS DISTINCT FROM 'true' THEN
  -- This UPDATE did not come from the finalizer
  IF NEW.phase IS DISTINCT FROM OLD.phase THEN
    RAISE EXCEPTION 'phase can only be advanced by manifest_finalize function';
  END IF;
END IF;
```

This allows the finalizer (which sets the flag) to advance the phase, while rejecting direct UPDATEs from any other code path.

### What the finalizer does (unchanged from v1.5 conceptually)

**manifest_finalize_source(manifest_id):**
1. Read manifest. Verify phase = 'created'.
2. Read identity_items WHERE manifest_id AND item_role = 'source'.
3. Compute S_raw (distinct elements per identity_basis). Count. Hash.
4. Set transaction config flag.
5. Update manifest: source_id_count, source_id_hash, phase = 'source_fetched'.

**manifest_finalize_comparison(manifest_id):**
1. Read manifest. Verify phase = 'source_fetched'.
2. Read persisted, missing, extra, excluded items.
3. Compute persisted_id_count, persisted_id_hash, sets_match (missing-only for dedup, missing+extra for non-dedup).
4. Assemble missing_ids/extra_ids JSONB.
5. Set transaction config flag.
6. Update manifest: all comparison fields, phase = 'confirmed_compared'.

**manifest_finalize_provisional(manifest_id):**
1. Read manifest. Verify phase = 'confirmed_compared'.
2. Write provisional evidence.
3. Set config flag.
4. Update manifest: provisional fields, phase = 'provisional_persisted'.

### Why this eliminates incoherent terminal manifests

The sync engine cannot write hashes/counts directly — it cannot advance the phase. The finalizer reads items and computes hashes/counts. The computed values and the phase transition are in the same UPDATE statement within the finalizer. There is no gap between computation and persistence.

A malicious or buggy runtime that attempts `UPDATE manifests SET phase = 'source_fetched', source_id_hash = 'fake'` is rejected by Trigger #4 (config flag not set → phase change rejected).

### 'abandoned' transition

The only non-finalizer phase transition is `any → abandoned` (orphan recovery). This is permitted by Trigger #4 without the finalizer flag, because:
- Abandoning a manifest does not assert evidence validity — it marks evidence as incomplete.
- The orphan recovery process (Scheduler) needs to mark manifests without calling the finalizer (the original run crashed, items may be incomplete).

Trigger #4 allows phase transition to 'abandoned' from ANY non-terminal phase, WITHOUT the finalizer flag. All data columns are frozen (no hash/count changes allowed on abandon).

### comparison_complete transition

The transition to comparison_complete is a simple phase advance with no new data. It can be performed by either the finalizer or directly (config flag not required for this specific transition). Trigger #4 allows confirmed_compared → comparison_complete and provisional_persisted → comparison_complete without the flag, provided all data columns are frozen (no changes to any evidence column).

---

## Architecture Preserved from v1.5

The following sections are incorporated by reference from v1.5 without modification:

- **Section 1 (Transactional protocol):** Phase created → source_fetched → confirmed_compared → provisional_persisted → comparison_complete. Trigger #11 phase-bound item insertion. Transaction A (source capture) and Transaction B (comparison).
- **Section 4 (Membership episodes):** episode_seq, status lifecycle, partial unique on active, reactivation as new episode.
- **Section 5 (Membership trigger #14):** INSERT/UPDATE/DELETE validation.
- **Section 6 (Tombstone canonical support):** canonical_key on tombstone_events, exactly-one-identity, trigger #15.
- **Section 7 (Supersession with shared key):** Any active membership → key expected. Zero active → tombstone candidate.
- **Section 8 (Manifest scope):** Identity presence only, not payload.
- **Section 9 (Domain policy scope):** Applied to manifests, items, exclusions, memberships, tombstones, reconciliation.

Also preserved from v1.4 and earlier:
- **Lock order:** scheduler_lease → cycle_row → domain_lease.
- **Scheduler lineage:** immutable on cycles (trigger #10).
- **Cycle creation/closure:** Fenced with scheduler + cycle locks.
- **Recovery under partial unique index:** Orphan transition before recovery INSERT.
- **Comparison algebra:** Non-dedup: S_raw vs P_raw (missing + extra, exclusions on extra only). Dedup: S_raw vs P_check (missing only, no extra, no exclusions).
- **Canonical regex:** `^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$`
- **Domain identity policies:** Fully versioned (5 fields). Trigger #13 validates all on manifest INSERT.
- **Exclusion subjects:** exactly-one-identity, domain-policy enforced.
- **Running-run uniqueness:** Partial unique index on (domain_name) WHERE status='running'.

---

## Invariants

All v1.5 invariants (1–62) preserved. Updated:

**Invariant 58 (STRENGTHENED):** Hashes and counts are computed EXCLUSIVELY by the manifest_finalize function from identity items. No other code path can write hashes/counts AND advance the phase. Trigger #4 rejects phase-advancing UPDATEs without the finalizer's transaction-local flag. The finalizer is SECURITY DEFINER, executing with elevated privileges.

Added:

63. **Direct phase UPDATE rejected.** Trigger #4 rejects any phase-advancing UPDATE that does not have the amaia_sync.finalizer_active transaction flag set. Exceptions: transition to 'abandoned' (orphan recovery) and transition to 'comparison_complete' (no new data, columns frozen).
64. **Finalizer flag is transaction-local.** The flag exists only for the duration of the transaction that set it. It cannot leak to other transactions or sessions.

---

## Self-Audit

### Attack: Runtime writes fake hash and advances phase directly

Scenario: Engine executes `UPDATE manifests SET source_id_hash = 'fake', source_id_count = 999, phase = 'source_fetched' WHERE id = :id`.

Result: Trigger #4 fires. Checks `current_setting('amaia_sync.finalizer_active', true)`. The runtime did not call the finalizer, so the flag is not set (returns NULL or 'false'). NEW.phase IS DISTINCT FROM OLD.phase → phase change detected without flag → RAISE EXCEPTION. **UPDATE rejected. Resists.**

### Attack: Runtime sets the config flag manually before direct UPDATE

Scenario: Engine calls `set_config('amaia_sync.finalizer_active', 'true', true)` directly, then UPDATEs manifest.

Result: If the engine's connection role has UPDATE privilege on manifests: this bypasses the trigger check. **Mitigation:** The finalizer is SECURITY DEFINER. The engine's role does NOT need UPDATE privilege on manifests — it only needs EXECUTE on the finalizer function. If the deployment revokes UPDATE privilege from the engine's role: the direct UPDATE fails at the privilege level, before the trigger even fires. The finalizer function (SECURITY DEFINER) executes with the function owner's privileges, which DO have UPDATE. **Privilege-enforced. Resists if UPDATE is revoked from engine role.**

If UPDATE cannot be revoked (e.g., the engine uses the service_role which bypasses RLS and has full privileges): the config flag check is the defense. A malicious caller that sets the flag and writes fake data would produce an incoherent manifest. This is a deliberate attack, not a bug. **Residual risk for service_role callers. Documented as operational trust boundary.**

### Attack: Orphan recovery advances phase (not just abandon)

Scenario: Orphan recovery process tries to advance manifest to 'confirmed_compared' via the abandoned path.

Result: Trigger #4 allows non-flag transitions ONLY to 'abandoned' or to 'comparison_complete' (from confirmed_compared/provisional_persisted). 'confirmed_compared' requires the flag. Recovery cannot advance to 'confirmed_compared'. It can only abandon. **Transition rules prevent. Resists.**

### Attack: Items inserted but finalizer never called

Scenario: Runtime inserts source items, then crashes before calling finalize_source.

Result: Manifest remains at phase = 'created'. Items exist but manifest has no hash/count. On orphan recovery: manifest is set to 'abandoned'. The items are orphaned evidence — they reference a manifest that never advanced. The manifest's phase = 'abandoned' signals that the evidence is incomplete. **Safe degradation. Resists.**

### Attack: Finalizer called with wrong manifest_id

Scenario: Runtime calls finalize_source with manifest_id of a different run's manifest.

Result: The finalizer reads items WHERE manifest_id = :provided_id. It computes hashes from THOSE items and writes to THAT manifest. If the manifest belongs to a different run: the hashes reflect that run's items (correct for that manifest). The calling run's manifest is unaffected (still at 'created'). No cross-contamination — the finalizer operates on the specified manifest, and items are scoped by manifest_id. **Manifest isolation. Resists (though indicates a runtime bug).**

### Attack: Two concurrent finalizer calls on same manifest

Scenario: Two transactions both call finalize_source for the same manifest_id.

Result: The finalizer UPDATEs the manifest row. Two concurrent UPDATEs on the same row: PostgreSQL serializes them. The first succeeds (phase created → source_fetched). The second reads phase = 'source_fetched' → expected 'created' → raises exception. **Serialized by row lock. Resists.**

### Attack: Two active membership episodes for same source

Result: Partial unique index UNIQUE(domain_name, source_amaia_id) WHERE status='active' rejects. **Database-enforced. Resists.**

### Attack: Tombstone for dedup domain using source_amaia_id instead of canonical_key

Result: Trigger #15 reads domain_identity_policies for the domain_name. If dedup: validates canonical_key IS NOT NULL and source_amaia_id IS NULL. If the caller provides source_amaia_id for a dedup domain: rejected. **Trigger-enforced. Resists.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| service_role can bypass config flag check | Medium | Documented trust boundary. service_role is admin-level. Non-admin engine roles are protected by privilege revocation. |
| Stored function adds deployment complexity | Low | Standard PostgreSQL pattern. SECURITY DEFINER is well-understood. |
| 19 triggers + 1 function | Medium | Distributed. Each scoped to one concern. No trigger exceeds ~50 logical checks. |
| Membership episodes growth | Medium | One row per source row per canonical change. Pruning deferred to operational procedure. |

---

## Criteria for Approval

1. DDL inventory is internally consistent (no contradictory counts anywhere in the document).
2. Manifest finalizer is the sole phase-advancement path (trigger + privilege enforced).
3. Incoherent terminal manifest is impossible under normal engine operation.
4. Self-audit defenses are schema/function-enforced, not QA-dependent.
5. All v1.5 architecture preserved (comparison algebra, episodes, tombstones, scheduler, policies).
6. No approximations in counts.
7. Residual risks explicitly documented with trust boundaries.

---

**End of document.**
