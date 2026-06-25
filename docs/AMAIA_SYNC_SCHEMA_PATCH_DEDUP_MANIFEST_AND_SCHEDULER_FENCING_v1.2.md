# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.2

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** v1.1 (rejected — missing lock order, lineage enforcement, identity items coherence)  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c, Tag amaia-sync-phase93b-runtime-ddl  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.1 was rejected for insufficient invariant strength on scheduler lineage, lock ordering, and manifest identity items coherence. v1.2 addresses all 16 points with:

- **1 new table** (amaia_sync_manifest_identity_items) — append-only, no CASCADE.
- **1 new table** (amaia_sync_domain_identity_policies) — immutable config.
- **1 new partial unique index** on amaia_sync_runs for running-run uniqueness.
- **9 new columns** on 3 existing tables.
- **2 nullability changes** on 2 existing tables.
- **Trigger count increases** from 9 to 13.
- Explicit lock ordering, lineage enforcement, coherence validation, and phase-bound item insertion.

---

## 1. Total Lock Order for Run Creation

**Canonical transaction (the ONLY valid sequence):**

1. BEGIN.
2. **Lock scheduler lease:** SELECT ... FROM amaia_sync_leases WHERE entity_name = 'scheduler' FOR UPDATE.
3. **Validate scheduler:** token = held, identity = held, identity IS NOT NULL, expires > now(). Fail → ROLLBACK.
4. **Lock cycle:** SELECT ... FROM amaia_sync_cycles WHERE id = :cycle_id FOR UPDATE.
5. **Validate cycle:** status = 'running'. Fail → ROLLBACK.
6. **Validate lineage:** cycle.scheduler_owner_identity = this scheduler's identity AND cycle.scheduler_lease_token = this scheduler's token. Fail → ROLLBACK (this is not our cycle).
7. **Lock domain lease:** SELECT ... FROM amaia_sync_leases WHERE entity_name = :domain FOR UPDATE.
8. **Validate domain:** ownership predicate (4-part). Fail → ROLLBACK.
9. **Insert sync_run.**
10. **COMMIT.**

**Lock acquisition order:** scheduler_lease → cycle_row → domain_lease. This is the ONLY permitted order. Any process that needs multiple locks acquires them in this sequence. Reverse or partial ordering is a bug.

**Why three locks:** Scheduler lease proves scheduler identity. Cycle lock serializes run creation vs cycle closure. Domain lease proves domain ownership. All three are needed.

---

## 2. Runs Only in Own-Lineage Cycles

**Invariant:** A scheduler MUST NOT create ordinary sync_runs in a cycle whose lineage does not match.

Step 6 of the run creation transaction validates:
- cycle.scheduler_owner_identity = this process's scheduler identity.
- cycle.scheduler_lease_token = this process's scheduler lease token.

If mismatch: this cycle belongs to a different scheduler. The current process MUST NOT add runs to it. It must:
- Recover orphan runs via domain lease acquisition (domain-scoped).
- Close the orphan cycle when it has zero running runs (recovery closure).
- Create its OWN cycle for new work.

---

## 3. Cycle Creation — Fenced Transaction

1. BEGIN.
2. Lock scheduler lease FOR UPDATE.
3. Validate scheduler ownership (4-part).
4. INSERT amaia_sync_cycles with:
   - status = 'running'
   - scheduler_owner_identity = this scheduler's identity
   - scheduler_lease_token = this scheduler's lease token
   - started_at = now()
   - owner_identity = this scheduler's identity
   - trigger_type = 'scheduled' | 'manual' | 'recovery'
5. COMMIT.

No cycle lock needed (the row doesn't exist yet). The scheduler lease lock prevents concurrent cycle creation.

---

## 4. Cycle Closure — Ordinary and Recovery

### Ordinary closure (own cycle)

1. BEGIN.
2. Lock scheduler lease FOR UPDATE. Validate ownership.
3. Lock cycle FOR UPDATE.
4. Validate: cycle.status = 'running'.
5. Validate lineage MATCHES: cycle.scheduler_owner_identity = this scheduler's identity, cycle.scheduler_lease_token = this scheduler's token.
6. Count running runs: SELECT count(*) FROM amaia_sync_runs WHERE cycle_id = :id AND status = 'running'. If > 0: ROLLBACK.
7. UPDATE cycle SET status = terminal, finished_at = now(). Conditional WHERE status = 'running'. 0 rows = already closed → ROLLBACK.
8. COMMIT.

### Recovery closure (foreign cycle)

1. BEGIN.
2. Lock scheduler lease FOR UPDATE. Validate ownership (THIS scheduler, not the dead one).
3. Lock orphan cycle FOR UPDATE.
4. Validate: cycle.status = 'running'.
5. Validate lineage DOES NOT MATCH: cycle.scheduler_owner_identity != this scheduler's identity OR cycle.scheduler_lease_token != this scheduler's token. If it matches: this is not an orphan — use ordinary closure. ROLLBACK.
6. Count running runs. If > 0: ROLLBACK (cannot close — runs still active under domain leases).
7. UPDATE cycle SET status = 'completed_with_failures', finished_at = now(). Conditional WHERE status = 'running'.
8. COMMIT.

**"Already held" is never assumed.** Every closure transaction re-validates within the transaction, under locks.

---

## 5. Scheduler Lineage Immutability

### New trigger: amaia_sync_cycles_lineage_guard

**Table:** amaia_sync_cycles  
**Event:** BEFORE UPDATE OR DELETE  
**For each:** ROW

**On DELETE:** Raise exception (cycles are audit records — never deleted in normal operation).

**On UPDATE:**
- If NEW.scheduler_owner_identity IS DISTINCT FROM OLD.scheduler_owner_identity: raise exception 'scheduler_owner_identity is immutable'.
- If NEW.scheduler_lease_token IS DISTINCT FROM OLD.scheduler_lease_token: raise exception 'scheduler_lease_token is immutable'.
- If NEW.started_at IS DISTINCT FROM OLD.started_at: raise exception 'started_at is immutable'.
- If NEW.trigger_type IS DISTINCT FROM OLD.trigger_type: raise exception 'trigger_type is immutable'.
- If NEW.owner_identity IS DISTINCT FROM OLD.owner_identity: raise exception 'owner_identity is immutable'.
- Allow: status, finished_at, reconciliation_snapshot.
- RETURN NEW.

**Trigger count:** +1 (total now 10 from deployed 9, plus identity_items append_only = 11, plus domain_identity_policies immutable = 12, plus this = 13 — see Section 16).

---

## 6. Manifest Identity Items — Coherence Constraints

### 6a. Item identity_basis must match manifest

Every identity item's identity_basis must equal its parent manifest's identity_basis. Enforced by trigger (on INSERT into identity_items): read parent manifest, compare identity_basis. Mismatch → reject.

### 6b. Uniqueness constraints

**For source_amaia_id basis items:**
- UNIQUE (manifest_id, item_role, source_amaia_id) WHERE source_amaia_id IS NOT NULL. One entry per source ID per role per manifest.

**For canonical key items:**
- UNIQUE (manifest_id, item_role, canonical_key) WHERE canonical_key IS NOT NULL AND item_role IN ('persisted', 'missing', 'extra', 'excluded'). At set level, one entry per canonical key per role.
- Source items (role = 'source') are NOT unique by canonical_key — multiple source_amaia_ids may map to the same canonical_key.

### 6c. Source mapping uniqueness

- UNIQUE (manifest_id, source_amaia_id) WHERE source_amaia_id IS NOT NULL AND item_role = 'source'. A source ID appears at most once in the source set of a manifest. If two source rows have the same source_amaia_id (should not happen — amaia_id is unique in source), this constraint catches it.

### 6d. Canonical mapping consistency

A source item with identity_basis = 'canonical_dedup_key' and item_role = 'source' MUST have source_amaia_id NOT NULL (it's a source row with its original ID) AND canonical_key NOT NULL (the dedup key it maps to).

If two source items in the same manifest have the same source_amaia_id but different canonical_key values: that's a canonicalization bug. The UNIQUE on (manifest_id, source_amaia_id) WHERE item_role = 'source' prevents duplicate source IDs, so this is caught by the simpler constraint.

### 6e. Role-specific field requirements

| item_role | identity_basis = source_amaia_id | identity_basis = canonical_dedup_key |
|---|---|---|
| source | source_amaia_id NOT NULL, canonical_key NULL | source_amaia_id NOT NULL, canonical_key NOT NULL, beneficiary_amaia_id NOT NULL, canonical_hash NOT NULL, canonical_hash_version NOT NULL |
| persisted | source_amaia_id NOT NULL, canonical_key NULL | canonical_key NOT NULL, source_amaia_id NULL (no source mapping for persisted set) |
| missing | source_amaia_id NOT NULL, canonical_key NULL | canonical_key NOT NULL |
| extra | source_amaia_id NOT NULL, canonical_key NULL | canonical_key NOT NULL |
| excluded | source_amaia_id NOT NULL, canonical_key NULL | canonical_key NOT NULL |

Enforced by the coherence CHECK on the table (extended from v1.1) combined with the trigger that validates identity_basis matches the manifest.

---

## 7. Persisted Set for Deduplicated Domains

### Formal construction

For a dedup domain run with lower_bound L and upper_bound U:

1. **Source set S:** Fetch from AMAIA WHERE source_id > L AND source_id <= U. Each row is canonicalized → (beneficiary_amaia_id, hash, hash_version). The source set is the DISTINCT set of canonical keys derived from these rows. Recorded as identity_items with item_role = 'source' (one per source row, showing the mapping).

2. **Affected beneficiaries B:** The set of DISTINCT beneficiary_amaia_id values from S.

3. **Persisted set P:** Query destination table WHERE beneficiary_amaia_id IN B. Extract DISTINCT (beneficiary_amaia_id, hash, hash_version). Recorded as identity_items with item_role = 'persisted'.

4. **Why scoped to B:** The run only touched beneficiaries present in the source fetch. Comparing against ALL destination rows would include beneficiaries from prior runs outside this range — producing false extra_ids.

5. **S_dedup:** The DISTINCT canonical key set from S (collapsing many source_amaia_ids to unique keys).

6. **Comparison:** S_dedup vs P. Missing = S_dedup \ P. Extra = P \ S_dedup.

**No separate mapping table needed.** The identity_items table records the full source_id → canonical_key mapping (role = 'source') and the persisted set (role = 'persisted'). Any auditor can reconstruct the comparison from these items. The manifest's aggregate hashes are computed from the items; the items are the ground truth.

---

## 8. Phase-Bound Item Insertion

Items are inserted at specific manifest phases:

| Phase transition | Items inserted |
|---|---|
| source_fetched | role = 'source' items (all fetched rows with their IDs and canonical mappings) |
| confirmed_compared | role = 'persisted' items, role = 'missing' items, role = 'extra' items, role = 'excluded' items |
| provisional_persisted | No additional items (provisional is evidenced by manifest columns, not items) |
| comparison_complete | No additional items (terminal) |

**Enforcement:** The identity_items INSERT trigger validates that the parent manifest is in the correct phase for the item_role being inserted:
- role = 'source': manifest.phase must be 'source_fetched'.
- role IN ('persisted', 'missing', 'extra', 'excluded'): manifest.phase must be 'confirmed_compared'.

If the manifest is in the wrong phase: reject the INSERT. This prevents out-of-order item insertion.

**Completeness check at phase transition:** When manifest advances from source_fetched → confirmed_compared, the runtime must have already inserted all source items. When advancing to comparison_complete, all comparison items must be present. This is a runtime invariant, not a schema constraint (the schema cannot count expected items — only the runtime knows how many were fetched).

---

## 9. Aggregate Hashes vs Items Relationship

### Contract

- source_id_hash on the manifest is computed from the identity_items with item_role = 'source'.
- persisted_id_hash on the manifest is computed from the identity_items with item_role = 'persisted'.
- source_id_count = count of DISTINCT identity elements in source items (amaia_ids for non-dedup, canonical keys for dedup).
- persisted_id_count = count of DISTINCT identity elements in persisted items.

### Verifiability

An auditor can independently:
1. Query identity_items WHERE manifest_id = :id AND item_role = 'source'.
2. Extract the identity elements (source_amaia_id for non-dedup, canonical_key for dedup).
3. Deduplicate, sort, serialize, hash.
4. Compare against manifest.source_id_hash.

If they match: the manifest hash is consistent with the items. If not: the manifest or items have been tampered with (both are append-only / immutable-from-INSERT, so tampering requires trigger bypass).

### Enforcement

Not enforced by schema CHECK (computing a hash across a related table is not possible in a CHECK constraint). Verifiable by QA and runtime self-check. The append-only + immutable guarantees on both tables make post-hoc verification trustworthy.

---

## 10. Append-Only vs Cascade: Resolution

### Decision: Option A — No CASCADE, no DELETE

The identity_items table FK to manifests uses **ON DELETE RESTRICT** (not CASCADE).

Rationale:
- Identity items are append-only audit evidence. Deleting them destroys evidence.
- Manifests are also effectively immutable after comparison_complete (trigger prevents UPDATE/DELETE).
- If a manifest needs to be pruned (retention), a future maintenance procedure can disable the items trigger, delete items, then delete the manifest. This is an admin break-glass operation, not normal runtime.

**Retention is out of scope for this patch.** It will be designed as a separate operational procedure when data volume requires it.

### Consistency

| Table | INSERT | UPDATE | DELETE |
|---|---|---|---|
| identity_items | Yes (append-only trigger allows) | No (trigger rejects) | No (trigger rejects + FK RESTRICT from manifests blocks cascade) |
| manifests | Yes | Yes (phase transitions only, trigger guarded) | No (trigger rejects) |

Both sides are protected. No contradiction.

---

## 11. Canonical Key Grammar

### Formal specification

A valid canonical_key is a string matching:

```
{positive_integer}:{hex64}:{version_string}
```

Where:
- positive_integer: 1 or more decimal digits, no leading zeros (except "0" itself — but beneficiary_amaia_id is always > 0 in practice), no sign character.
- Colon delimiter: exactly the character ':' (U+003A).
- hex64: exactly 64 lowercase hexadecimal characters [0-9a-f]. This is the SHA-256 output.
- Colon delimiter.
- version_string: 1 or more characters from [a-z0-9_], no colons, no pipes, no whitespace.

### Validation

**By CHECK constraint on amaia_sync_manifest_identity_items:**

canonical_key IS NULL OR canonical_key ~ '^[0-9]+:[0-9a-f]{64}:[a-z0-9_]+$'

This regex enforces: positive integer, colon, 64 hex chars, colon, version string.

**Decomposed field consistency:** The trigger on identity_items INSERT validates (when canonical_key IS NOT NULL):
- beneficiary_amaia_id::text matches the first segment of canonical_key (split on ':').
- canonical_hash matches the second segment.
- canonical_hash_version matches the third segment.

This ensures the decomposed fields and the serialized key are always in sync.

---

## 12. Trigger #4 — INSERT Validation

### Problem

The deployed trigger #4 (manifest phase_column_guard) fires on BEFORE UPDATE OR DELETE only. Manifest creation (INSERT) is not validated by this trigger. The new identity columns must be validated at INSERT time.

### Solution: New trigger for manifest INSERT

**New trigger: amaia_sync_manifest_insert_guard**

**Table:** amaia_sync_run_manifests  
**Event:** BEFORE INSERT  
**For each:** ROW

Validates on INSERT:
1. **Identity coherence:** If identity_basis = 'source_amaia_id': canonicalization_version MUST be NULL, serialization_version MUST start with 'integer_'. If identity_basis = 'canonical_dedup_key': canonicalization_version MUST NOT be NULL, serialization_version MUST start with 'canonical_key_'.
2. **Domain policy match:** Read domain_identity_policies for NEW.domain_name. Verify NEW.identity_basis matches the policy's required_identity_basis. If mismatch: reject.
3. RETURN NEW.

The existing trigger #4 (BEFORE UPDATE OR DELETE) is unchanged. The two triggers coexist on the same table, each handling its own event.

**Trigger count:** +1.

---

## 13. Domain Identity Policy Table

### New table: amaia_sync_domain_identity_policies

| Column | Type | Nullable | Description |
|---|---|---|---|
| domain_name | text | NOT NULL | PK. The domain this policy applies to. |
| required_identity_basis | text | NOT NULL | 'source_amaia_id' or 'canonical_dedup_key' |
| required_canonicalization_version | text | NULL | Required for dedup domains. NULL for source_id. |
| created_at | timestamptz | NOT NULL | default now() |

**PK:** (domain_name). One policy per domain.

**CHECK:** required_identity_basis IN ('source_amaia_id', 'canonical_dedup_key').

**Coherence CHECK:** (required_identity_basis = 'source_amaia_id' AND required_canonicalization_version IS NULL) OR (required_identity_basis = 'canonical_dedup_key' AND required_canonicalization_version IS NOT NULL).

**Immutability:** Trigger rejects UPDATE and DELETE. This table is seeded at migration time and never modified during runtime.

**Seed data (7 rows):**

| domain_name | required_identity_basis | required_canonicalization_version |
|---|---|---|
| beneficiario | source_amaia_id | NULL |
| red | source_amaia_id | NULL |
| control_llamadas | source_amaia_id | NULL |
| logestado | source_amaia_id | NULL |
| alerta | source_amaia_id | NULL |
| enfermedades | canonical_dedup_key | canonicalization_v1 |
| medicamentos | canonical_dedup_key | canonicalization_v1 |

**RLS:** admin/super_admin SELECT.

**How it prevents misconfiguration:** The manifest INSERT trigger reads this table and rejects manifests with mismatched identity_basis. An engine that tries to create a source_amaia_id manifest for enfermedades is structurally blocked at the database level.

---

## 14. Set Definitions — Unambiguous

For every manifest comparison:

| Symbol | Definition | Recorded as |
|---|---|---|
| S_raw | Identity elements from source fetch (all, before exclusion) | identity_items role='source'. For dedup: DISTINCT canonical_key from source items. |
| P_raw | Identity elements from destination query (all, before exclusion) | identity_items role='persisted' |
| E | Approved exclusions for this domain | identity_items role='excluded' |
| S_effective | S_raw - E | Computed in memory |
| P_effective | P_raw - E | Computed in memory |
| missing | S_effective - P_effective | identity_items role='missing' |
| extra | P_effective - S_effective | identity_items role='extra' |
| sets_match | hash(S_effective) == hash(P_effective) | manifest.sets_match |

**source_id_hash** = hash of S_effective (after exclusion).
**persisted_id_hash** = hash of P_effective (after exclusion).

This eliminates double interpretation. The hashes always reflect the EFFECTIVE sets (post-exclusion).

---

## 15. Running Runs Uniqueness

### Decision: Partial unique index

**New partial unique index on amaia_sync_runs:**

UNIQUE (domain_name) WHERE status = 'running'

This structurally prevents two 'running' runs for the same domain. The lease protocol (which also serializes run creation via domain lease lock) is the primary mechanism. The partial unique index is a redundant safety net.

### Why the v1.1 rejection of this index was wrong

v1.1 argued that the brief window between run closure and lease release could cause a violation. But:
- Run closure changes status from 'running' to terminal. The unique index on 'running' rows is satisfied as soon as the old run leaves 'running' status.
- The new run's INSERT (which sets status = 'running') occurs in a different transaction, after the old run's closure committed.
- The two transactions are serialized by the domain lease lock. There is no overlap.

**Therefore:** The partial unique index is compatible with the lock protocol. It provides a database-level guarantee that no two runs for the same domain are simultaneously 'running', regardless of application-level bugs.

---

## 16. DDL Impact Summary

### New tables

| Table | Purpose | Rows | Mutable |
|---|---|---|---|
| amaia_sync_manifest_identity_items | Per-item manifest evidence | Grows with manifests | Append-only |
| amaia_sync_domain_identity_policies | Domain → identity_basis mapping | 7 (seeded) | Immutable |

### New columns on existing tables

| Table | Column | Type | Nullable |
|---|---|---|---|
| amaia_sync_cycles | scheduler_owner_identity | text | NOT NULL |
| amaia_sync_cycles | scheduler_lease_token | bigint | NOT NULL |
| amaia_sync_run_manifests | identity_basis | text | NOT NULL |
| amaia_sync_run_manifests | identity_version | text | NOT NULL |
| amaia_sync_run_manifests | canonicalization_version | text | NULL |
| amaia_sync_run_manifests | hash_algorithm | text | NOT NULL |
| amaia_sync_run_manifests | serialization_version | text | NOT NULL |
| amaia_sync_manifest_exclusion_subjects | excluded_canonical_key | text | NULL |
| amaia_sync_manifest_exclusion_investigations | excluded_canonical_key | text | NULL |

### Nullability changes

| Table | Column | Before | After |
|---|---|---|---|
| amaia_sync_manifest_exclusion_subjects | excluded_amaia_id | NOT NULL | NULL |
| amaia_sync_manifest_exclusion_investigations | excluded_amaia_id | NOT NULL | NULL |

### New CHECK constraints

| Table | Constraint |
|---|---|
| amaia_sync_run_manifests | identity_basis IN ('source_amaia_id', 'canonical_dedup_key') |
| amaia_sync_manifest_exclusion_subjects | exactly_one_identity (existing extended) |
| amaia_sync_manifest_identity_items | item_role IN (...) |
| amaia_sync_manifest_identity_items | identity_basis IN (...) |
| amaia_sync_manifest_identity_items | coherence (identity_basis ↔ fields) |
| amaia_sync_manifest_identity_items | canonical_key regex grammar |
| amaia_sync_domain_identity_policies | required_identity_basis IN (...) |
| amaia_sync_domain_identity_policies | coherence (basis ↔ canonicalization_version) |

### New indexes

| Table | Index | Type |
|---|---|---|
| amaia_sync_manifest_identity_items | (manifest_id, item_role) | btree |
| amaia_sync_manifest_identity_items | (manifest_id, source_amaia_id) WHERE source_amaia_id IS NOT NULL AND item_role = 'source' | partial unique |
| amaia_sync_manifest_identity_items | (manifest_id, item_role, canonical_key) WHERE canonical_key IS NOT NULL AND item_role IN ('persisted','missing','extra','excluded') | partial unique |
| amaia_sync_manifest_exclusion_subjects | (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL | partial unique |
| amaia_sync_runs | (domain_name) WHERE status = 'running' | partial unique |

### New FKs

| Table | FK | Target | On Delete |
|---|---|---|---|
| amaia_sync_manifest_identity_items | manifest_id | amaia_sync_run_manifests(id) | RESTRICT |

### New triggers (4 new, 3 updated)

| # | Table | Trigger | Event | Purpose |
|---|---|---|---|---|
| 10 | amaia_sync_cycles | lineage_guard | BEFORE UPDATE OR DELETE | Immutability of lineage + started_at + trigger_type + owner_identity. Delete rejected. |
| 11 | amaia_sync_manifest_identity_items | append_only_coherence | BEFORE INSERT OR UPDATE OR DELETE | INSERT: validate identity_basis matches manifest, validate phase compatibility, validate canonical_key grammar + decomposed fields. UPDATE/DELETE: reject. |
| 12 | amaia_sync_domain_identity_policies | immutable_guard | BEFORE UPDATE OR DELETE | Reject all. Config table is seed-only. |
| 13 | amaia_sync_run_manifests | insert_guard | BEFORE INSERT | Validate identity coherence (basis ↔ version fields) and domain policy match. |

| # | Table | Trigger | Change |
|---|---|---|---|
| #4 | amaia_sync_run_manifests | phase_column_guard | Add 5 identity columns to immutable-from-INSERT set (UPDATE path only — INSERT has its own trigger #13). |
| #6 | amaia_sync_manifest_exclusion_investigations | denorm_guard | Validate excluded_canonical_key + handle NULL excluded_amaia_id. |
| #9 | amaia_sync_manifest_exclusion_subjects | progression_guard | INSERT: validate exactly-one-identity. UPDATE: excluded_canonical_key immutable. |

### New RLS policies

| Table | Policy |
|---|---|
| amaia_sync_manifest_identity_items | admin/super_admin SELECT |
| amaia_sync_domain_identity_policies | admin/super_admin SELECT |

### Seed data

| Table | Rows | Content |
|---|---|---|
| amaia_sync_domain_identity_policies | 7 | One per domain with required_identity_basis |
| (Also: 9.3C seeds for watermarks + scheduler lease — separate migration) | | |

### Summary

| Category | Count |
|---|---|
| New tables | 2 |
| New columns on existing tables | 9 |
| Nullability changes | 2 |
| New CHECK constraints | 8 |
| New indexes (including partial unique) | 5 |
| New FKs | 1 |
| New triggers | 4 |
| Updated triggers | 3 |
| Total triggers post-patch | 13 |
| New RLS policies | 2 |
| Seed rows | 7 (domain policies) |

---

## Invariants

All 36 invariants from v1.1 preserved. Added:

37. **Lock acquisition order is total:** scheduler_lease → cycle_row → domain_lease. Never reversed.
38. **Runs only in own-lineage cycles.** A scheduler cannot add runs to a cycle created by a different scheduler.
39. **Lineage is immutable.** scheduler_owner_identity and scheduler_lease_token on cycles are trigger-enforced immutable.
40. **Identity items match manifest basis.** Every identity item's identity_basis equals its manifest's identity_basis (trigger enforced).
41. **Domain identity policy is structurally enforced.** A manifest's identity_basis must match amaia_sync_domain_identity_policies (trigger enforced at INSERT).
42. **At most one running run per domain.** Partial unique index on (domain_name) WHERE status = 'running'.
43. **Identity items are phase-bound.** Source items inserted at source_fetched. Comparison items at confirmed_compared. Trigger enforced.
44. **Canonical key grammar is schema-validated.** Regex CHECK on canonical_key. Decomposed fields validated by trigger.
45. **Aggregate hashes correspond to identity items.** Verifiable by QA — hash of items must equal manifest hash. Append-only + immutable guarantees make verification trustworthy.
46. **No CASCADE deletion of identity items.** FK is RESTRICT. Evidence is permanent until explicit admin maintenance.

---

## Self-Audit: Codex Attack Scenarios

### Run creation concurrent with cycle closure

Both lock scheduler_lease → cycle_row. Serialized. Winner proceeds, loser's cycle validation fails (status already changed). **Resists.**

### Run creation in foreign cycle

Step 6 validates lineage. Mismatch → ROLLBACK. **Resists.**

### Scheduler lineage modified after creation

Trigger #10 rejects UPDATE to scheduler_owner_identity, scheduler_lease_token. **Resists.**

### Manifest for enfermedades with source_amaia_id basis

Trigger #13 reads domain_identity_policies for 'enfermedades' → required = 'canonical_dedup_key'. Manifest has 'source_amaia_id' → mismatch → INSERT rejected. **Schema-enforced. Resists.**

### Identity item with wrong basis vs manifest

Trigger #11 reads parent manifest's identity_basis. Item has different basis → rejected. **Resists.**

### Source item inserted during confirmed_compared phase

Trigger #11 checks: role = 'source' requires manifest.phase = 'source_fetched'. Manifest is in confirmed_compared → rejected. **Phase-enforced. Resists.**

### Canonical key grammar violation

CHECK regex: '^[0-9]+:[0-9a-f]{64}:[a-z0-9_]+$'. Key '5:WRONGHASH:v1' (uppercase) → fails regex. **Schema-enforced. Resists.**

### Two running runs for same domain

Partial unique index on (domain_name) WHERE status = 'running'. Second INSERT with status = 'running' → unique violation. **Database-enforced. Resists.**

### DELETE identity items via CASCADE

FK is ON DELETE RESTRICT. Deleting manifest with items → FK violation → rejected. **Schema-enforced. Resists.**

### Empty incremental assumes sets_match=true

v1.2 Section 8 (inherited from v1.1): overlap is fetched and compared honestly. No assumption. **Contract-enforced. Resists.**

### Recovery creates run in orphan cycle

Step 6 of run creation: lineage mismatch → ROLLBACK. Recovery scheduler creates its own cycle. **Resists.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Identity items table growth | Medium | FK RESTRICT + future admin retention procedure. CASCADE intentionally excluded. |
| 13 triggers on 11+ tables | Medium | Each trigger is scoped and simple. Complexity is distributed, not concentrated. |
| Canonical key regex may reject valid future hash algorithms | Low | hash_version is extensible. Regex covers SHA-256 (64 hex chars). Future algorithms may require regex update (DDL change). |
| Domain policy table requires migration for new domains | Low | New domains (if any) require a migration anyway (watermark seed + policy row + destination table). |

---

## Criteria for Approval

1. Lock order (scheduler → cycle → domain) is total and mandatory.
2. Lineage on cycles is immutable (trigger enforced).
3. Runs cannot be created in foreign-lineage cycles.
4. Cycle closure validates zero running runs under lock.
5. Identity items are append-only, phase-bound, and coherent with manifest basis.
6. Domain identity policy is structurally enforced at manifest INSERT.
7. Canonical key grammar is schema-validated.
8. Persisted set construction is formally defined and scoped to affected beneficiaries.
9. Set definitions (S_raw, P_raw, E, S_effective, P_effective, missing, extra) are unambiguous.
10. Running-run uniqueness is database-enforced via partial unique index.
11. No CASCADE on identity items.
12. DDL impact is explicit and complete.

---

**End of document.**
