# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.4

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** v1.3 (rejected — internal contradiction between P_raw membership-scoped and P_check source-scoped)  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c, Tag amaia-sync-phase93b-runtime-ddl  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.3 contained two contradictory definitions of the persisted set for dedup domains. The initial sections defined P_raw via membership-scoped active keys overlapping the range, while the self-audit section corrected to P_check = destination keys WHERE canonical_key IN S_raw. v1.4 eliminates the contradiction by adopting a single, coherent model throughout:

**For deduplicated domains, incremental sync answers exactly one question: "did I persist everything I processed?" It does NOT detect extras. Extra detection is reconciliation's exclusive responsibility.**

All other v1.3 content (locks, lineage, identity items, policies, memberships, regex, recovery, triggers, atomicity) is preserved unchanged.

---

## 1. Comparison Algebra — Definitive, by Domain Type

### 1.1 Non-deduplicated domains (beneficiario, red, control_llamadas, logestado, alerta)

The source-to-destination relationship is 1:1 on amaia_id. The manifest compares in both directions.

| Symbol | Definition |
|---|---|
| S_raw | Set of amaia_id values from source fetch in (lower_bound, upper_bound] |
| P_raw | Set of amaia_id values in destination table for the same range |
| extras_excluded | Approved exclusions WHERE excluded_amaia_id ∈ (P_raw \ S_raw) |
| S_effective | S_raw (exclusions NEVER reduce source) |
| P_effective | P_raw - extras_excluded |
| missing | S_effective \ P_effective |
| extra | P_effective \ S_effective |
| sets_match | missing is empty AND extra is empty |
| source_id_hash | hash(sorted S_effective) |
| persisted_id_hash | hash(sorted P_effective) |

**Exclusions** apply only to extras. A key in S_raw is never excluded from comparison.

### 1.2 Deduplicated domains (enfermedades, medicamentos)

The source-to-destination relationship is many:1. Multiple source IDs collapse to one canonical key via canonicalization + hashing. The incremental manifest verifies only completeness of the current run's output. It does NOT detect extras.

| Symbol | Definition |
|---|---|
| S_raw | Set of DISTINCT canonical_key values derived from source rows in (lower_bound, upper_bound]. Each source row is canonicalized; duplicates collapse. |
| P_check | Set of canonical_key values present in destination WHERE canonical_key IN (S_raw). Query: for each key in S_raw, does a matching row exist in the destination table? |
| missing | S_raw \ P_check |
| extra | **Not computed.** |
| sets_match | missing is empty |
| source_id_hash | hash(sorted S_raw) |
| persisted_id_hash | hash(sorted P_check) |

**Exclusions do NOT apply to dedup incremental manifests.** There are no extras to exclude. The exclusion ledger is used only during reconciliation for dedup domains (see Section 3).

**Why no extras in dedup incremental:**

The incremental fetch processes source rows in (L, U]. It canonicalizes them, upserts to destination (ON CONFLICT on the dedup index), and verifies persistence. A canonical key from a PRIOR run that exists in the destination for the same beneficiary but outside the current source range is NOT part of this run's audit scope. Including it in P would produce a false extra.

The only legitimate question the incremental manifest can answer for dedup domains is: "for every canonical key I derived from the current source, does it exist in the destination?" If yes: success. If no: failure (the upsert didn't work).

Whether the destination has EXTRA keys that shouldn't be there (retroactive deletes, stale canonicalizations) is a question that requires comparing against the FULL source universe — which is reconciliation's job.

### 1.3 Summary table

| Aspect | Non-dedup incremental | Dedup incremental | Dedup reconciliation |
|---|---|---|---|
| Detects missing | Yes | Yes | Yes |
| Detects extra | Yes | **No** | Yes |
| Uses exclusions | Yes (extras only) | **No** | Yes (extras only) |
| P definition | P_raw = destination amaia_ids in range | P_check = destination keys IN S_raw | P_full = all active memberships vs all destination keys |
| sets_match | missing empty AND extra empty | missing empty | missing empty AND extra empty |

---

## 2. Membership Table Purpose — Scoped Correctly

### What amaia_sync_dedup_identity_memberships IS for

1. **Durable mapping:** source_amaia_id → canonical_key. An auditor can trace which source rows contributed to which destination canonical entries, across all historical runs.

2. **Vigency tracking:** active_from_watermark / active_until_watermark record when a source row entered and exited the sync scope. Status (active/superseded/source_deleted/tombstoned) tracks the lifecycle.

3. **Reconciliation full-universe comparison:** During reconciliation, the engine compares ALL active memberships (the set of canonical keys that SHOULD exist based on all processed source rows) against ALL destination rows. Mismatches are genuine extras or missing keys at the universe level.

4. **Reactivation detection:** If a source row that was source_deleted reappears, the membership is reactivated. The canonical key re-enters S_raw on the next incremental run.

5. **Supersession tracking:** If a source row's canonical_key changes (re-canonicalization), the old membership is superseded and a new one created. Reconciliation detects the stale destination key via the superseded membership.

### What memberships are NOT for

**Memberships are NOT used to scope the persisted set P in incremental manifests.** The incremental P_check is derived solely from S_raw (the current fetch), not from membership history. Memberships are background bookkeeping that reconciliation uses — they do not participate in the incremental comparison algebra.

### Population during incremental sync

During each dedup domain sync run, for each source row fetched:

1. Compute canonical_key.
2. Look up existing active membership for (domain_name, source_amaia_id).
3. If none: INSERT new membership (status='active', first_seen_run_id=this run, active_from_watermark=lower_bound).
4. If exists and canonical_key matches: UPDATE last_seen_run_id.
5. If exists and canonical_key differs: supersede old, create new.

This runs within the fenced transaction alongside the destination upsert. It is bookkeeping, not comparison logic.

---

## 3. Separation of Concerns: Incremental vs Reconciliation vs Exclusion

### 3.1 Incremental manifest (both domain types)

**Goal:** Verify that the current run's processing was complete.

- Non-dedup: S_raw vs P_raw in both directions. Missing AND extra detected.
- Dedup: S_raw vs P_check (one direction only). Missing detected. Extra NOT detected.

**Watermark advances if:** sets_match = true (missing empty, and extra empty for non-dedup).

### 3.2 Reconciliation (both domain types)

**Goal:** Verify the full-universe consistency between source and destination.

**Non-dedup:** Compare full amaia_id sets (source vs destination) via Tier 1 count + id-set. Detect universe-level missing and extra. Tombstone lifecycle for persistent absences.

**Dedup:** Compare ALL active memberships (the complete set of canonical keys from all processed source rows) against ALL destination canonical keys. This is a universe-level comparison:
- Missing: active membership exists, destination key absent → backfill.
- Extra: destination key exists, no active membership → tombstone candidate.

Reconciliation uses the membership table as the source of truth for "what should exist." This is where memberships contribute to comparison logic — at reconciliation time, not at incremental time.

### 3.3 Exclusion and tombstone lifecycle

**Non-dedup incremental:** Exclusions apply to extras detected during incremental comparison. The exclusion ledger (subjects, investigations, decisions, consumptions) operates on integer amaia_ids.

**Dedup incremental:** No exclusions apply (no extras detected). The exclusion ledger is not consulted during dedup incremental runs.

**Dedup reconciliation:** Exclusions apply to extras detected during full-universe reconciliation. The exclusion ledger operates on canonical_key strings (excluded_canonical_key on subjects/investigations).

**Tombstones (both types):** Tombstone lifecycle (detected → confirmed → reverted/ignored) applies to extras found during reconciliation. For dedup domains, tombstone events reference canonical_key strings. For non-dedup, they reference amaia_ids. The deployed tombstone_events table already has source_amaia_id (integer) — for dedup tombstones, source_amaia_id would be NULL and the canonical key would need to be recorded elsewhere. **This is a known gap for dedup tombstone evidence — deferred to reconciliation design, not blocking for incremental sync.**

---

## 4. Manifest Evidence: What Identity Items Record

### Non-dedup domains

| item_role | Identity recorded | Count |
|---|---|---|
| source | source_amaia_id | One per fetched amaia_id |
| persisted | source_amaia_id | One per amaia_id found in destination |
| missing | source_amaia_id | One per amaia_id in S but not P |
| extra | source_amaia_id | One per amaia_id in P but not S (after exclusions) |
| excluded | source_amaia_id | One per applied exclusion |

### Dedup domains

| item_role | Identity recorded | Count |
|---|---|---|
| source | source_amaia_id + canonical_key (the mapping) | One per source row fetched |
| persisted | canonical_key (source_amaia_id NULL) | One per canonical key confirmed in destination |
| missing | canonical_key | One per canonical key in S_raw but not P_check |
| extra | **Not used in incremental.** | 0 |
| excluded | **Not used in incremental.** | 0 |

For dedup reconciliation (future): extra and excluded items would be recorded during reconciliation runs, not incremental runs.

---

## 5. Atomicity: Items → Hashes → Phase

Unchanged from v1.3 Section 5. Source items + source hash in Transaction A. Persisted/missing items + persisted hash + sets_match in Transaction B. Both within fenced transactions. Trigger #4 validates fields populated on phase transition.

For dedup domains: Transaction B does not insert extra or excluded items (none computed). The persisted items are only those confirmed by P_check (keys in S_raw found in destination).

---

## 6. Hash Computation — Dedup Specifics

### source_id_hash (dedup)

Computed from the DISTINCT canonical_key set from source items:
1. Collect canonical_key from all identity_items WHERE manifest_id = :id AND item_role = 'source'.
2. Deduplicate (multiple source rows may produce the same key).
3. Sort lexicographically ascending.
4. Join with pipe delimiter.
5. SHA-256.

### persisted_id_hash (dedup)

Computed from the P_check set:
1. Collect canonical_key from all identity_items WHERE manifest_id = :id AND item_role = 'persisted'.
2. Sort lexicographically ascending (already unique by the partial unique index on items).
3. Join with pipe delimiter.
4. SHA-256.

### sets_match (dedup)

sets_match = (source_id_hash == persisted_id_hash). Since S_raw was deduplicated and P_check only includes keys that exist, this is equivalent to: every key in S_raw was found in the destination.

### Counts (dedup)

- source_id_count = count of DISTINCT canonical_key in source items.
- persisted_id_count = count of persisted items.
- sets_match = true requires source_id_count == persisted_id_count AND source_id_hash == persisted_id_hash.

---

## 7. Everything Preserved from v1.3

The following v1.3 sections are incorporated by reference without modification:

- **Section 1 (Lock order):** scheduler_lease → cycle_row → domain_lease. Total, mandatory, never reversed.
- **Section 2 (Runs only in own-lineage):** Lineage validation on run creation Step 6.
- **Section 3 (Cycle creation):** Fenced with scheduler lease lock.
- **Section 4 (Cycle closure):** Ordinary (lineage matches, zero running runs) and recovery (lineage doesn't match, zero running runs).
- **Section 5 (Lineage immutability):** Trigger #10 on cycles.
- **Section 6 (Identity items coherence):** All uniqueness constraints, role-specific field requirements, phase-bound insertion.
- **Section 7 of v1.3 (Recovery under partial unique):** Steps 1-11, orphan transition before recovery run INSERT.
- **Section 8 of v1.3 (Canonical regex):** `^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$` applied to all canonical_key columns.
- **Section 9 of v1.3 (Decomposed fields):** Mandatory NOT NULL when canonical_key present. Trigger validated.
- **Section 10 of v1.3 (Exclusion subjects/investigations):** Domain policy enforcement, exactly-one-identity.
- **Section 11 of v1.3 (Identity items completeness):** Obligatory items per phase.
- **Domain identity policies (fully versioned):** 7 seed rows. Trigger #13 validates all 5 identity fields.
- **Memberships table:** Structure, lifecycle, population. Purpose corrected in this document (Section 2).
- **All trigger specifications (#10-#14, updates to #4, #6, #9).**

---

## 8. DDL Impact Summary

Unchanged from v1.3. No additional DDL. The corrections in v1.4 are definitional (which algebra applies, what the tables are FOR), not structural.

| Category | Count |
|---|---|
| New tables | 3 (identity_items, domain_identity_policies, dedup_identity_memberships) |
| New columns on existing tables | 9 |
| Nullability changes | 2 |
| CHECK constraints | ~12 |
| Indexes | ~8 |
| FKs | 3 |
| New triggers | 5 |
| Updated triggers | 4 |
| Total triggers post-patch | 18 |
| New RLS policies | 3 |
| Seed rows | 7 (policies) + 3 (9.3C separate) |

---

## 9. Updated Invariants

All v1.3 invariants (1-53) preserved except:

**Invariant 47 (REPLACED):** ~~Persisted set scoped by active memberships.~~ → **Dedup incremental P_check = destination keys WHERE canonical_key IN S_raw. Memberships do not scope incremental P.**

**Invariant 48 (UNCHANGED):** Exclusions apply only to extras. For dedup incremental: no extras, no exclusions.

Added:

54. **Dedup incremental detects missing only.** Extras are reconciliation's exclusive responsibility for dedup domains.
55. **Memberships serve reconciliation, not incremental comparison.** The membership table provides the full-universe source of truth for reconciliation. It does not participate in incremental manifest algebra.
56. **No contradictory P definitions.** For non-dedup: P_raw = destination amaia_ids in range. For dedup: P_check = destination canonical keys IN S_raw. No other definition of P exists anywhere in the architecture.

---

## 10. Self-Audit: Codex Attack Scenarios

### Historical canonical key from same beneficiary outside range

Attack: Beneficiary 5 has "Diabetes" (synced at watermark 50) and "Hipertensión" (in current range 180-250).

Result: S_raw = {Hipertensión_key}. P_check = destination keys WHERE canonical_key IN {Hipertensión_key}. Diabetes_key is NOT queried. P_check = {Hipertensión_key} (if persisted). missing = empty. sets_match = true. **No false extra. Resists.**

### Destination has extra key not in current source

Attack: Destination has Diabetes_key for beneficiary 5 from a prior run. Current run processes watermark 180-250 and doesn't fetch any "Diabetes" source row.

Result: S_raw does not include Diabetes_key. P_check only queries keys IN S_raw. Diabetes_key is not queried. No extra detected in incremental. Diabetes_key's correctness is verified during reconciliation (full-universe comparison of all active memberships vs all destination keys). **Correct separation. Resists.**

### Exclusion applied to dedup incremental

Attack: An approved exclusion exists for canonical_key K. K appears in S_raw during dedup incremental.

Result: Exclusions are not consulted during dedup incremental. K is in S_raw. P_check checks if K is in destination. If yes: not missing. If no: missing → run fails → re-upsert. The exclusion is irrelevant for dedup incremental. It will be used during dedup reconciliation if K shows up as extra in the full-universe comparison. **No silent suppression. Resists.**

### Two contradictory P definitions in the document

Attack: Codex searches for any definition of P_raw that uses memberships for dedup incremental.

Result: This document defines P_check (not P_raw) for dedup incremental. The membership-based P definition appears ONLY in the reconciliation context (Section 3.2). The incremental P_check definition (Section 1.2) is unambiguous and does not reference memberships. A text search for "P_raw" in the dedup incremental context finds zero occurrences. **No contradiction. Resists.**

### Missing canonical key despite successful upsert

Attack: Engine upserts to destination, but P_check query doesn't find the key (race? wrong query?).

Result: The upsert and the P_check query are in the same fenced transaction. The upsert commits the row. P_check (within the same transaction) sees the row via PostgreSQL's read-your-own-writes guarantee. If the row is missing from P_check: the upsert failed silently (e.g., wrong conflict target). The manifest correctly reports missing → run fails. **Detects real failures. Resists.**

### Membership table used to inflate P in incremental

Attack: Future developer reads v1.3's initial sections and uses memberships to scope P.

Result: v1.4 explicitly states (Section 2): "Memberships are NOT used to scope the persisted set P in incremental manifests." Invariant 55 reinforces. Section 1.2 defines P_check without any membership reference. **Clear documentation prevents misuse. Resists.**

### Recovery run violates running-run uniqueness

Attack: Orphan run status='running'. Recovery tries INSERT status='running'.

Result: Recovery transaction (v1.3 Section 7, unchanged): Step 7 transitions orphan to 'orphan_recovered' (exits partial unique index). Step 9 inserts recovery run (enters index). Same transaction. At commit: exactly one 'running'. **Index satisfied. Resists.**

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Dedup extras undetected between reconciliation cycles | Medium | Reconciliation cadence: monthly for health domains. Extras from retroactive deletes are detected within 30 days. |
| Memberships table growth | Medium | One active membership per source row. Superseded/deleted rows are historical. Pruning deferred to operational procedure. |
| Dedup tombstone evidence gap | Low | Deployed tombstone_events has source_amaia_id (integer). Dedup tombstones need canonical_key. Deferred to reconciliation design (not blocking for incremental). |
| 18 triggers | Medium | Distributed across 14 tables. Each trigger is scoped and simple. |

---

## 12. Criteria for Approval

1. **No contradictory P definitions.** P_check for dedup incremental is defined once (Section 1.2) and referenced consistently. No membership-based P in incremental context.
2. **Dedup incremental detects missing only.** No extras. No exclusions. Clear separation from reconciliation.
3. **Memberships serve reconciliation, not incremental.** Explicitly stated with invariant.
4. **Exclusion algebra correct.** S_effective = S_raw always. Exclusions only on extras. For dedup incremental: neither applies.
5. **All v1.3 structural content preserved.** Locks, lineage, items, policies, memberships, regex, recovery, triggers, atomicity.
6. **DDL impact unchanged from v1.3.** No additional tables or columns.
7. **Summary table (Section 1.3) provides authoritative reference** for which operations detect what, per domain type.

---

**End of document.**
