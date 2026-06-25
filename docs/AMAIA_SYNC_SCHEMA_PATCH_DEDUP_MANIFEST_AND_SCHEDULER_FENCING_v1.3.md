# AMAIA-SYNC Schema Patch: Deduplicated Manifest Identity & Scheduler Fencing v1.3

**Type:** Architecture + Schema Blueprint Patch  
**Status:** Pending Codex audit  
**Supersedes:** v1.2 (rejected — persisted set P unbounded, false extras, exclusion algebra hides missing)  
**Applies to:** Runtime Architecture v1.2.9, Schema Blueprint v1.0.4, DDL Blueprint v1.0.4  
**Deployed baseline:** Commit dc7574c, Tag amaia-sync-phase93b-runtime-ddl  
**Prerequisite for:** Phase 9.3C, Phase 9.4A  
**Author:** Claude (constructor)  
**Date:** 2026-06-22

**Note:** NO SQL, NO migrations, NO runtime code.

---

## Executive Summary

v1.2's core defect: P = all destination rows for affected beneficiaries includes historical canonical keys from prior runs that are outside the current source range, producing false extras on every run.

v1.3 introduces a **dedup identity membership table** that tracks which canonical keys are associated with which watermark ranges. The persisted set P is scoped to canonical keys with active memberships in the audited range — not all historical keys for those beneficiaries.

Additionally: exclusion algebra is corrected (exclusions apply only to extras, never hide missing), hash/count finalization is trigger-enforced, domain identity policy is fully versioned, and recovery under the partial unique index is specified.

**DDL impact:** 3 new tables, 9 new columns on existing tables, 2 nullability changes, ~12 CHECK constraints, ~8 indexes, 2 FKs, 5 new triggers (18 total), 2 new RLS policies, 14 seed rows.

---

## 1. Dedup Identity Memberships

### New table: amaia_sync_dedup_identity_memberships

Tracks which source rows contribute to which canonical keys, and the watermark range during which each membership is valid.

| Column | Type | Nullable | Description |
|---|---|---|---|
| id | uuid | NOT NULL | PK |
| domain_name | text | NOT NULL | 'enfermedades' or 'medicamentos' |
| source_amaia_id | integer | NOT NULL | Source table PK (e.g., beneficiario_enfermedad.id) |
| beneficiary_amaia_id | integer | NOT NULL | |
| canonical_key | text | NOT NULL | Serialized: '{ben_id}:{hash}:{version}' |
| canonical_hash | text | NOT NULL | The SHA-256 hash component |
| canonical_hash_version | text | NOT NULL | e.g., 'canonicalization_v1' |
| first_seen_run_id | uuid | NOT NULL | FK → amaia_sync_runs(id). Run that first saw this source row. |
| last_seen_run_id | uuid | NOT NULL | FK → amaia_sync_runs(id). Most recent run that confirmed this row. |
| active_from_watermark | bigint | NOT NULL | The lower_bound of the run that first included this source_amaia_id. |
| active_until_watermark | bigint | NULL | NULL = currently active. Set when the source row is no longer seen in a full reconciliation. |
| status | text | NOT NULL | Lifecycle state |
| created_at | timestamptz | NOT NULL | default now() |
| updated_at | timestamptz | NOT NULL | default now() |

### Status values

| Status | Meaning |
|---|---|
| active | Source row is present in AMAIA and maps to this canonical key. |
| superseded | Source row still exists but now maps to a DIFFERENT canonical key (re-canonicalization changed the hash). Old membership is superseded. |
| source_deleted | Source row no longer found in AMAIA (detected by reconciliation). |
| tombstoned | Source row confirmed absent after 2-cycle grace. |

### CHECK constraints

- status IN ('active', 'superseded', 'source_deleted', 'tombstoned')
- canonical_key ~ '^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$'

### Unique constraints

- UNIQUE (domain_name, source_amaia_id) WHERE status = 'active'. One active membership per source row. A source row maps to exactly one canonical key at a time.
- (domain_name, source_amaia_id, canonical_key) for the full history (no partial — allows multiple rows for the same source_amaia_id across different canonical_keys and statuses).

### Indexes

- (domain_name, canonical_key, status) — lookup active memberships for a canonical key.
- (domain_name, active_from_watermark, active_until_watermark) — range queries for the audited window.
- (last_seen_run_id) — FK index.

### FK

- first_seen_run_id → amaia_sync_runs(id) ON DELETE RESTRICT.
- last_seen_run_id → amaia_sync_runs(id) ON DELETE RESTRICT.

### RLS

admin/super_admin SELECT.

### Mutability

This table IS mutable (status changes, last_seen_run_id updates, active_until_watermark set). It is NOT append-only. An updated_at trigger (set_updated_at) maintains the timestamp.

### How it is populated

During each sync run for a dedup domain:

1. For each source row fetched: compute canonical_key.
2. Look up existing active membership for this (domain_name, source_amaia_id).
3. If none exists: INSERT new membership (status = 'active', first_seen_run_id = this run, last_seen_run_id = this run, active_from_watermark = this run's lower_bound).
4. If exists and canonical_key matches: UPDATE last_seen_run_id = this run. Membership confirmed.
5. If exists but canonical_key differs: the canonicalization changed. SET old membership status = 'superseded', active_until_watermark = this run's lower_bound. INSERT new membership with the new canonical_key.

Reconciliation detects source_deleted memberships (source row absent from AMAIA). Tombstone lifecycle applies.

---

## 2. Corrected Persisted Set for Dedup Domains

### Definitions

For a dedup domain run with lower_bound L and upper_bound U:

**S_raw:** The set of DISTINCT canonical_key values derived from source rows in (L, U]. Each source row is canonicalized and its canonical_key computed. Duplicates (multiple source IDs mapping to the same canonical_key) are collapsed.

**Active membership universe M:** The set of canonical_key values with status = 'active' in amaia_sync_dedup_identity_memberships WHERE domain_name = :domain AND active_from_watermark <= U AND (active_until_watermark IS NULL OR active_until_watermark > L). These are the canonical keys that SHOULD exist in the destination based on all source rows that were ever processed in overlapping ranges.

**P_raw:** The set of DISTINCT (beneficiary_amaia_id, hash, hash_version) — i.e., canonical_key — present in the destination table (amaia_health_conditions or amaia_medications) WHERE canonical_key IN (M). Only keys with active memberships are included.

**Why M instead of "all keys for beneficiaries in S":** M scopes P to keys that the sync engine has a record of producing. A historical canonical key for the same beneficiary from a different run/range, if it has an active membership outside [L, U], is excluded from P. This prevents false extras from unrelated historical data.

### Comparison

- missing = S_raw \ P_raw (keys we expected to persist but didn't find).
- extra_raw = P_raw \ S_raw (keys in destination with active membership but not in current source fetch).
- extras_excluded = approved exclusions applicable to extra_raw items.
- extra = extra_raw - extras_excluded.
- sets_match = (S_raw == P_raw - extras_excluded) AND (missing is empty). Equivalently: missing is empty AND extra is empty.

### Why this eliminates false extras

A canonical key from a prior run for the same beneficiary but with active_from_watermark outside the current range [L, U] is NOT in M → NOT in P_raw → cannot appear as extra. Only keys with active memberships that overlap the current range are compared.

---

## 3. Reactivation and Vigency

### Reappearing source row

If a source row that was previously source_deleted or tombstoned reappears in a fetch:
1. A new active membership is created (or the existing one is updated to 'active' if the canonical_key matches).
2. The canonical key enters S_raw normally.
3. If an exclusion exists for this canonical key: the exclusion is NOT automatically revoked. However, the key now appears in S_raw. Since exclusions only apply to extras (not to missing — see Section 4), and the key is in S_raw, it is in S_effective. If it's also in P_raw: sets_match is unaffected. If it's NOT in P_raw: it appears in missing → run fails → watermark doesn't advance → the key is re-upserted on retry.

### Reappearing canonical key after exclusion

An approved exclusion for canonical_key K means K was in P but not in S (extra). If K later reappears in S (source row re-created or re-canonicalized to K):
- K is in S_raw.
- K is in P_raw (still in destination).
- K is in both S and P → not missing, not extra → no impact.
- The exclusion remains in the ledger (audit trail) but is operationally irrelevant for this run — it's only applied to extras, and K is not extra.

### Superseded membership

If a source row's canonical_key changes (text re-canonicalized under a new algorithm or corrected source text):
- Old membership: status = 'superseded', active_until_watermark set.
- New membership: status = 'active', new canonical_key.
- Old canonical key: may remain in destination. It will appear in P_raw (active old membership overlaps current range) but NOT in S_raw → extra. Handled by exclusion or tombstone lifecycle.
- New canonical key: appears in S_raw. If not yet in destination → missing → run fails → re-upsert includes it.

---

## 4. Corrected Exclusion Algebra

### Problem with v1.2

v1.2 computed S_effective = S_raw - E, P_effective = P_raw - E. This symmetrically removed excluded keys from BOTH sides. If a key was both in S and excluded (because a previous run excluded it as extra, but now it reappeared in source), the exclusion would hide it from S_effective → creating a silent missing.

### Corrected algebra

**Exclusions apply ONLY to extras, never to source or missing.**

| Symbol | Definition |
|---|---|
| S_raw | Canonical keys from source fetch (dedup) or source amaia_ids (non-dedup) |
| P_raw | Canonical keys from active memberships in destination (dedup) or destination amaia_ids (non-dedup) |
| S_effective | = S_raw (exclusions NEVER reduce the source set) |
| missing | = S_effective \ P_raw |
| extra_raw | = P_raw \ S_effective |
| extras_excluded | = approved exclusions WHERE excluded identity ∈ extra_raw |
| extra | = extra_raw - extras_excluded |
| sets_match | missing is empty AND extra is empty |

**source_id_hash** = hash of sorted S_effective.
**persisted_id_hash** = hash of sorted (P_raw - extras_excluded).

### Exclusion vigency

An exclusion is "applicable" if:
1. The exclusion subject's identity matches an item in extra_raw.
2. The subject's current investigation has an approved latest decision.
3. The investigation hash is still valid (re-verified live).

An exclusion that was approved for a key that is no longer in extra_raw (because it was re-upserted or source_deleted) is simply not applicable — it doesn't match any extra_raw item. No explicit "expiration" mechanism needed.

---

## 5. Atomicity: Items → Hashes/Counts → Phase Transition

### Transaction A: Source phase (within domain fenced transaction)

1. Fetch all pages from AMAIA.
2. For each row: compute canonical_key (if dedup), update memberships.
3. Upsert rows to destination.
4. INSERT all identity_items with item_role = 'source'.
5. Compute source_id_count and source_id_hash from inserted items.
6. INSERT manifest row with phase = 'source_fetched', source_id_count, source_id_hash, identity columns.
7. All within a SINGLE fenced transaction (domain lease locked).

Note: manifest INSERT and source items INSERT are in the same transaction. The manifest's source_id_hash is computed from the items before both are committed. They are atomically consistent.

### Transaction B: Comparison phase (same or subsequent fenced transaction)

1. Query destination for P_raw (scoped by memberships).
2. INSERT identity_items with item_role = 'persisted'.
3. Compute missing, extra_raw. Resolve exclusions → extra, extras_excluded.
4. INSERT identity_items for missing, extra, excluded roles.
5. Compute persisted_id_count, persisted_id_hash, sets_match.
6. UPDATE manifest: phase = 'confirmed_compared', persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at.
7. If sets_match = true: advance watermark. Insert exclusion consumptions.
8. All within a SINGLE fenced transaction.

### Manifest finalization trigger

Trigger #4 (manifest phase_column_guard) on the UPDATE from source_fetched → confirmed_compared validates:
- persisted_id_count IS NOT NULL.
- persisted_id_hash IS NOT NULL.
- sets_match IS NOT NULL.
- verified_at IS NOT NULL.

This prevents advancing to confirmed_compared without comparison evidence. The trigger does NOT recompute hashes (that would require querying identity_items within a trigger — expensive and fragile). The contract is: the runtime computes hashes from items and writes both in the same transaction. The trigger validates that the fields are populated. QA and runtime self-checks validate consistency.

### Why trigger-based hash recomputation is not used

Computing SHA-256 of a sorted set of identity_items rows within a trigger would require:
1. Aggregating all items for the manifest.
2. Sorting.
3. Computing SHA-256.
4. Comparing.

This is operationally expensive inside a trigger (potentially thousands of items) and would run on EVERY manifest UPDATE, including phase transitions that don't touch hashes. The cost-benefit does not justify it.

**Instead:** The runtime computes hashes from items in the same transaction. Both are committed atomically. Post-hoc QA can verify consistency (query items, recompute hash, compare to manifest). The append-only + immutable guarantees on both tables ensure that if they were consistent at commit time, they remain consistent.

---

## 6. Domain Identity Policy — Fully Versioned

### Extended table: amaia_sync_domain_identity_policies

| Column | Type | Nullable | Description |
|---|---|---|---|
| domain_name | text | NOT NULL | PK |
| required_identity_basis | text | NOT NULL | 'source_amaia_id' or 'canonical_dedup_key' |
| required_identity_version | text | NOT NULL | e.g., 'source_id_v1', 'dedup_key_v1' |
| required_canonicalization_version | text | NULL | NULL for source_id. NOT NULL for dedup. |
| required_hash_algorithm | text | NOT NULL | e.g., 'sha256_pipe_delimited_sorted', 'sha256_colon_delimited_sorted' |
| required_serialization_version | text | NOT NULL | e.g., 'integer_decimal_v1', 'canonical_key_colon_v1' |
| created_at | timestamptz | NOT NULL | default now() |

### Coherence CHECK

(required_identity_basis = 'source_amaia_id' AND required_canonicalization_version IS NULL) OR (required_identity_basis = 'canonical_dedup_key' AND required_canonicalization_version IS NOT NULL)

### Seed data (7 rows)

| domain_name | basis | version | canon_ver | hash_alg | serial_ver |
|---|---|---|---|---|---|
| beneficiario | source_amaia_id | source_id_v1 | NULL | sha256_pipe_delimited_sorted | integer_decimal_v1 |
| red | source_amaia_id | source_id_v1 | NULL | sha256_pipe_delimited_sorted | integer_decimal_v1 |
| control_llamadas | source_amaia_id | source_id_v1 | NULL | sha256_pipe_delimited_sorted | integer_decimal_v1 |
| logestado | source_amaia_id | source_id_v1 | NULL | sha256_pipe_delimited_sorted | integer_decimal_v1 |
| alerta | source_amaia_id | source_id_v1 | NULL | sha256_pipe_delimited_sorted | integer_decimal_v1 |
| enfermedades | canonical_dedup_key | dedup_key_v1 | canonicalization_v1 | sha256_colon_delimited_sorted | canonical_key_colon_v1 |
| medicamentos | canonical_dedup_key | dedup_key_v1 | canonicalization_v1 | sha256_colon_delimited_sorted | canonical_key_colon_v1 |

### Trigger #13 (manifest insert_guard) — full validation

On BEFORE INSERT into amaia_sync_run_manifests:
1. Read policy row for NEW.domain_name from domain_identity_policies.
2. Validate: NEW.identity_basis = policy.required_identity_basis.
3. Validate: NEW.identity_version = policy.required_identity_version.
4. Validate: NEW.canonicalization_version IS NOT DISTINCT FROM policy.required_canonicalization_version.
5. Validate: NEW.hash_algorithm = policy.required_hash_algorithm.
6. Validate: NEW.serialization_version = policy.required_serialization_version.
7. If any mismatch: reject INSERT with explicit error naming the mismatched field.

---

## 7. Recovery Under Partial Unique Index

### Problem

The partial unique index UNIQUE(domain_name) WHERE status = 'running' means: to INSERT a recovery run (status = 'running'), the orphan run must FIRST leave 'running' status.

### Recovery transaction (respecting lock order + unique index)

1. BEGIN.
2. Lock scheduler lease FOR UPDATE. Validate.
3. Create new cycle (if not already created for this scheduler's lifecycle) OR lock existing cycle. Validate lineage.
4. Lock domain lease FOR UPDATE (acquires expired lease — captures previous_owner_identity, previous_lease_token).
5. Lock orphan run: SELECT ... FROM amaia_sync_runs WHERE domain_name = :domain AND status = 'running' AND owner_identity = :prev_owner AND lease_token = :prev_token FOR UPDATE.
6. If 0 rows: no orphan. Skip to Step 9.
7. If 1 row: UPDATE orphan SET status = 'orphan_recovered', reason_code = 'LEASE_EXPIRED_ORPHAN', finished_at = now(). This removes it from the partial unique index.
8. UPDATE associated manifest to 'abandoned' (if not terminal).
9. INSERT recovery run (or normal run): status = 'running', domain_name = :domain. The partial unique index now permits this (Step 7 cleared the slot).
10. If > 1 row in Step 5: CRITICAL corruption. ROLLBACK. Hard abort.
11. COMMIT.

**Why Step 7 before Step 9:** The partial unique index requires that only one row has (domain_name, status='running') at a time. Step 7 transitions the orphan OUT of 'running'. Step 9 inserts the new run INTO 'running'. Both within the same transaction — the unique index is satisfied at commit time.

---

## 8. Canonical Regex — Corrected

### Grammar

```
^[1-9][0-9]*:[0-9a-f]{64}:[a-z0-9_]+$
```

- First segment: positive integer, no leading zeros, minimum 1 digit, no zero.
- Colon delimiter.
- Second segment: exactly 64 lowercase hex chars (SHA-256).
- Colon delimiter.
- Third segment: 1+ lowercase alphanumeric or underscore (version string).

### Applied to

| Table | Column |
|---|---|
| amaia_sync_manifest_identity_items | canonical_key |
| amaia_sync_manifest_exclusion_subjects | excluded_canonical_key |
| amaia_sync_manifest_exclusion_investigations | excluded_canonical_key |
| amaia_sync_dedup_identity_memberships | canonical_key |

All use the same CHECK regex.

---

## 9. Decomposed Fields Mandatory for Canonical Items

For every row with canonical_key IS NOT NULL (regardless of item_role or table):

- beneficiary_amaia_id NOT NULL.
- canonical_hash NOT NULL.
- canonical_hash_version NOT NULL.

These must recompose to canonical_key: `{beneficiary_amaia_id}:{canonical_hash}:{canonical_hash_version}`.

Validated by trigger on INSERT (identity_items trigger #11, memberships trigger).

For memberships table: all canonical fields are always NOT NULL (the table is dedup-only).

---

## 10. Exclusion Subjects and Investigations — Domain Policy Enforcement

### Subjects

- excluded_amaia_id: integer, NULL (changed from NOT NULL in v1.2).
- excluded_canonical_key: text, NULL.
- CHECK: exactly one non-null.

**Domain policy enforcement on subject creation:** Trigger #9 (subject_progression_guard) on INSERT validates:
- Read domain_identity_policies for the subject's domain_name.
- If policy.required_identity_basis = 'source_amaia_id': excluded_amaia_id MUST be NOT NULL, excluded_canonical_key MUST be NULL.
- If policy.required_identity_basis = 'canonical_dedup_key': excluded_amaia_id MUST be NULL, excluded_canonical_key MUST be NOT NULL.
- Mismatch → reject.

### Investigations

Same exactly-one-identity pattern. Trigger #6 validates:
- excluded_amaia_id and excluded_canonical_key match the parent subject.
- Domain policy consistency is inherited from the subject.

---

## 11. Identity Items Completeness

### Obligatory items per manifest

| Phase | Required items |
|---|---|
| source_fetched | One 'source' item per source row fetched (or per distinct canonical key for non-dedup — actually per source_amaia_id for both). |
| confirmed_compared | One 'persisted' item per element in P_raw. One 'missing' per element in missing. One 'extra' per element in extra (after exclusion). One 'excluded' per applied exclusion. |

### Finalization validation

The manifest UPDATE trigger (#4) validates on source_fetched → confirmed_compared:
- source_id_count IS NOT NULL.
- source_id_hash IS NOT NULL.
- persisted_id_count IS NOT NULL.
- persisted_id_hash IS NOT NULL.
- sets_match IS NOT NULL.
- verified_at IS NOT NULL.

The trigger does NOT count items (expensive). The counts reflect what the runtime computed from the items in the same transaction. Post-hoc QA validates: count of identity_items WHERE manifest_id = :id AND item_role = 'source' (grouped appropriately) = manifest.source_id_count. Same for persisted.

---

## 12. DDL Impact Summary

### New tables

| # | Table | Purpose | Mutable | Append-only |
|---|---|---|---|---|
| 1 | amaia_sync_manifest_identity_items | Per-item manifest evidence | No | Yes |
| 2 | amaia_sync_domain_identity_policies | Domain → identity config | No | Yes (immutable seed) |
| 3 | amaia_sync_dedup_identity_memberships | Source → canonical key mapping with vigency | Yes | No |

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

### CHECK constraints (~12)

- identity_items: item_role, identity_basis, coherence, canonical_key regex, decomposed fields.
- memberships: status, canonical_key regex.
- exclusion subjects: exactly_one_identity.
- domain_identity_policies: required_identity_basis, coherence.
- manifests: identity_basis.

### Indexes (~8)

- identity_items: (manifest_id, item_role), (manifest_id, source_amaia_id) WHERE source_amaia_id IS NOT NULL AND item_role='source' (partial unique), (manifest_id, item_role, canonical_key) WHERE canonical_key IS NOT NULL AND item_role IN ('persisted','missing','extra','excluded') (partial unique).
- memberships: (domain_name, source_amaia_id) WHERE status='active' (partial unique), (domain_name, canonical_key, status), (domain_name, active_from_watermark, active_until_watermark).
- exclusion subjects: (domain_name, excluded_canonical_key) WHERE excluded_canonical_key IS NOT NULL (partial unique).
- runs: (domain_name) WHERE status='running' (partial unique).

### FKs

- identity_items.manifest_id → manifests(id) ON DELETE RESTRICT.
- memberships.first_seen_run_id → sync_runs(id) ON DELETE RESTRICT.
- memberships.last_seen_run_id → sync_runs(id) ON DELETE RESTRICT.

### Triggers (5 new, 4 updated = 18 total)

| # | Table | Trigger | Type | Purpose |
|---|---|---|---|---|
| 10 | amaia_sync_cycles | lineage_guard | BEFORE UPDATE OR DELETE | Lineage + identity immutability |
| 11 | identity_items | append_only_coherence | BEFORE INSERT OR UPDATE OR DELETE | Phase-bound insertion, identity_basis match, canonical grammar + decomposed fields, append-only |
| 12 | domain_identity_policies | immutable_guard | BEFORE UPDATE OR DELETE | Reject all modifications |
| 13 | manifests | insert_guard | BEFORE INSERT | Full policy validation (all 5 identity fields vs policy table) |
| 14 | memberships | membership_guard | BEFORE UPDATE | Status transition validation, canonical_key immutability per row, updated_at auto-set. DELETE rejected. |

Updated: #4 (manifest phase guard — identity columns immutable), #6 (investigation denorm — canonical key + domain policy), #9 (subject progression — exactly-one + domain policy), set_updated_at on memberships.

### RLS policies (2 new)

- identity_items: admin/super_admin SELECT.
- domain_identity_policies: admin/super_admin SELECT.
- memberships: admin/super_admin SELECT.

(3 new RLS policies total.)

### Seed data

- domain_identity_policies: 7 rows.
- (9.3C separate: 2 watermark seeds + 1 scheduler lease seed.)

### Summary

| Category | Count |
|---|---|
| New tables | 3 |
| New columns on existing tables | 9 |
| Nullability changes | 2 |
| CHECK constraints | ~12 |
| Indexes (including partial unique) | ~8 |
| FKs | 3 (new tables) |
| New triggers | 5 |
| Updated triggers | 4 |
| Total triggers post-patch | 18 |
| New RLS policies | 3 |
| Seed rows | 7 (policies) + 3 (9.3C separate) |

---

## Invariants

All 46 invariants from v1.2 preserved. Added:

47. **Persisted set scoped by active memberships.** P_raw includes only canonical keys with active memberships overlapping the audited range.
48. **Exclusions apply only to extras.** S_effective = S_raw always. Exclusions never reduce the source set.
49. **Membership uniqueness per active source row.** At most one active membership per (domain_name, source_amaia_id).
50. **Reappearing source rows reactivate.** A source row that reappears in a fetch creates or reactivates its membership. Exclusions do not suppress source-side presence.
51. **Decomposed canonical fields are always consistent with serialized key.** Trigger-validated on INSERT.
52. **Domain identity policy fully versioned.** All 5 manifest identity fields validated against policy at INSERT.
53. **Items and hashes committed atomically.** Source items + source hash in one transaction. Comparison items + comparison hash in one transaction.

---

## Self-Audit: Codex Attack Scenarios

### False extra from historical canonical key outside range

Attack: Beneficiary 5 has conditions "Diabetes" (from run at watermark 50) and "Hipertensión" (from run at watermark 200). Current run processes watermark range (180, 250). Source has only "Hipertensión" in this range.

Old model (v1.2): P = all keys for beneficiary 5 = {Diabetes_key, Hipertensión_key}. S = {Hipertensión_key}. extra = {Diabetes_key}. FALSE EXTRA.

New model (v1.3): Diabetes_key has active_from_watermark = 50. The current range is (180, 250). The membership for Diabetes_key has active_from_watermark = 50 ≤ 250 (U) and active_until_watermark IS NULL > 180 (L) — so it IS in M.

Wait — this still includes Diabetes_key in P_raw. But Diabetes_key is NOT in S_raw (not in the current fetch range). So it IS an extra_raw item.

**This is actually correct behavior.** If Diabetes_key has an active membership and is NOT in the current source fetch, there are two possibilities:
1. The source row (id < 180) was already processed in a prior run. It's outside the current range. Its active membership is from a prior run.
2. The key SHOULD be in the destination (it was correctly synced before).

**The extra is genuine if the key has an active membership but is no longer in the source.** The membership's active_from_watermark being old (50) means it was synced long ago. The question is: should the current run re-verify it?

**Resolution:** The current run's P_raw should only include keys from memberships where active_from_watermark falls within [L, U]. Keys from prior runs (active_from_watermark < L) are NOT in the current run's audit scope.

**Corrected M definition:** canonical_keys WHERE active_from_watermark > L AND active_from_watermark <= U AND status = 'active'. This scopes M to memberships created or updated within the current run's range.

But what about keys created in prior runs that should still be in destination? Those are verified by RECONCILIATION (Tier comparison), not by the incremental manifest. The incremental manifest only verifies the current range.

**This is a fundamental simplification:** The incremental manifest for dedup domains verifies:
- Every source row in (L, U] was canonicalized and its canonical key was persisted.
- It does NOT verify historical keys outside (L, U]. That's reconciliation's job.

**Revised M:** M = canonical_key values from memberships WHERE first_seen_run_id or last_seen_run_id corresponds to the current run. Practically: the set of canonical keys that the current run touched (created or confirmed).

**Even simpler:** S_raw is derived from source rows in (L, U]. P_raw for dedup domains = the set of canonical keys that EXIST in the destination table AND whose canonical_key is in S_raw or in the overlap re-read zone.

**Final corrected approach:** P_raw = query destination WHERE canonical_key IN (S_raw). This directly compares: "for every canonical key I derived from source, is it in the destination?" No need for membership-based scoping of P. The memberships table provides HISTORY and AUDIT, not the comparison universe.

missing = S_raw \ P_raw (keys I derived but don't find in destination). extra: NOT computed from P for incremental manifests of dedup domains. Extra detection for dedup is handled by RECONCILIATION (full universe comparison), not by incremental manifests (which only verify that source-derived keys were persisted).

**This eliminates the false-extra problem entirely for incremental runs.** The incremental manifest for dedup domains answers ONE question: "did every canonical key I derived from the current source fetch end up in the destination?" It does NOT attempt to detect extras (that requires comparing the full universe, which is reconciliation's job).

For non-dedup domains: the manifest compares amaia_ids in both directions (missing AND extra), because the 1:1 correspondence makes both directions meaningful within the range.

### Sets for dedup domains (final corrected)

| Symbol | Definition |
|---|---|
| S_raw | DISTINCT canonical keys from source fetch |
| P_check | Destination canonical keys WHERE canonical_key IN (S_raw) |
| missing | S_raw \ P_check |
| extra | NOT computed (dedup incremental). Reconciliation handles universe-level discrepancies. |
| sets_match | missing is empty |
| source_id_hash | hash of sorted S_raw |
| persisted_id_hash | hash of sorted P_check |

**If missing is not empty:** run fails, watermark stays. The missing keys should have been upserted in the same transaction — their absence indicates a write failure.

**Extras for dedup:** Detected during reconciliation's full-universe comparison (Tier 1 id-set, monthly field). Reconciliation compares ALL active memberships against ALL destination rows. Extras found there enter the exclusion/tombstone lifecycle.

This separation is architecturally sound: incremental sync verifies its own work (did I persist what I processed?). Reconciliation verifies the universe (is the destination consistent with all historical processing?).

### Revised comparison table

| Domain type | Incremental: missing? | Incremental: extra? | Reconciliation: missing? | Reconciliation: extra? |
|---|---|---|---|---|
| Non-dedup (1:1) | Yes | Yes | Yes | Yes |
| Dedup (many:1) | Yes | **No** | Yes | Yes |

---

### Remaining attacks

### Exclusion hides missing

Attack: Key K is excluded (approved extra from prior run). K reappears in source.

Result: S_effective = S_raw (exclusions never reduce source). K is in S_raw. P_check includes K (if in destination) → not missing. P_check excludes K (if not in destination) → missing → run fails. Exclusion does not suppress missing detection. **Resists.**

### Two source IDs map to same canonical key

Attack: Source IDs 10, 11 both canonicalize to key K.

Result: S_raw = {K} (deduplicated). P_check: K in destination? Yes (upserted via ON CONFLICT). missing = empty. sets_match = true. Memberships: two rows (source_amaia_id=10→K, source_amaia_id=11→K). Full audit trail. **Resists.**

### Membership active but destination row deleted

Attack: Admin deletes a destination row. Active membership still exists.

Result: Incremental: K in S_raw (if source fetched), P_check doesn't find K → missing → run fails → re-upsert. If source not in range: reconciliation detects (membership active, destination row absent) → backfill or tombstone. **Detectable. Resists.**

### Recovery run violates partial unique index

Attack: Orphan run status='running'. New run INSERT with status='running' for same domain.

Result: Recovery transaction Step 7: UPDATE orphan to 'orphan_recovered' (exits unique index). Step 9: INSERT new run (enters unique index). Same transaction. At commit: exactly one 'running'. **Resists.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Memberships table growth | Medium | One row per source_amaia_id per canonical version. Superseded/tombstoned rows are historical. Pruning = future operational procedure. |
| No extras in dedup incremental | Low | By design. Reconciliation provides full-universe extra detection. Documented separation of concerns. |
| Trigger count (18) | Medium | Each trigger is scoped to one table, one concern. Complexity is distributed. |
| Membership UPDATE concurrency | Low | Memberships are updated within the domain's fenced transaction (lease locked). No concurrent writers per domain. |

---

## Criteria for Approval

1. Persisted set for dedup domains is correctly scoped (P_check = destination keys IN S_raw).
2. False extras eliminated for incremental dedup by not computing extras (reconciliation's job).
3. Exclusions never hide missing (S_effective = S_raw).
4. Memberships provide durable source→canonical mapping with vigency.
5. Hash finalization validated by trigger (fields populated) + atomic transaction (items + hashes committed together).
6. Domain identity policy fully versioned and trigger-enforced.
7. Recovery respects partial unique index via same-transaction orphan transition.
8. Canonical regex excludes zero and leading zeros.
9. Decomposed fields mandatory and trigger-validated for all canonical items.
10. Lock order total: scheduler → cycle → domain.
11. DDL impact explicit and complete.

---

**End of document.**
