# AMAIA-SYNC Runtime Architecture Patch: Scheduler Ownership & Deduplicated Manifest Identity v1.0

**Type:** Architectural patch on Runtime Architecture v1.2.9  
**Status:** Pending Codex audit  
**Scope:** 2 architectural corrections. No DDL, no SQL, no migrations, no implementation.  
**Prerequisite for:** Phase 9.3C Prerequisites Blueprint  
**Author:** Claude (constructor)  
**Date:** 2026-06-19

---

## Motivation

Codex rejected Phase 9.3C because it introduced two architectural contracts that were not established in Runtime Architecture v1.2.9:

1. **Scheduler lease** — a new coordination primitive with runtime implications (cycle ownership, crash recovery scope) that was defined only in the Implementation Blueprint, not in the approved architecture.
2. **Manifest identity for deduplicated domains** — the approved manifest model uses source amaia_id as the identity basis, which breaks for enfermedades/medicamentos where multiple source IDs collapse to one destination row via canonical hashing.

This patch resolves both gaps at the architecture level, before any implementation or migration proceeds.

---

## 1. Scheduler Ownership Contract

### 1.1 What the scheduler lease IS

The scheduler lease is a coordination row in amaia_sync_leases with entity_name = 'scheduler'. It follows the same acquire/heartbeat/release/expire lifecycle as domain leases. It grants a single privilege:

**The right to create and close cycles in amaia_sync_cycles.**

A process that holds the scheduler lease is the **active scheduler**. Only one active scheduler exists at any point in time.

### 1.2 What the scheduler lease IS NOT

The scheduler lease does NOT grant:

- The right to close sync_runs. Runs are protected by their domain leases.
- The right to modify domain data. Domain processing requires domain leases.
- The right to advance watermarks. Watermark operations require domain leases.
- The right to modify manifests, consumptions, or exception/exclusion ledger entries. All domain-scoped.
- Global authority over another process's domain operations.

**Prohibition:** A process that holds the scheduler lease but NOT a specific domain lease MUST NOT close, modify, or recover any sync_run for that domain.

### 1.3 Scheduler lease lifecycle

**Acquire:** Atomic conditional UPDATE on amaia_sync_leases WHERE entity_name = 'scheduler' AND (owner_identity IS NULL OR lease_expires_at < now()). Same mechanism as domain leases. On success: lease_token incremented, owner_identity set, lease_expires_at set.

**Heartbeat:** Every 2 minutes during the cycle (between domain runs, during reconciliation, during idle). Same mechanism as domain leases.

**Release:** At cycle end, after the cycle is set to terminal status. Same mechanism.

**Expiry:** If the scheduler crashes without releasing, the lease expires after TTL. The next process that acquires the scheduler lease becomes the new active scheduler.

### 1.4 Loss of scheduler ownership

If the scheduler lease expires (heartbeat missed):

1. The current cycle is effectively orphaned — no scheduler is heartbeating it.
2. The scheduler that lost ownership MUST NOT create new cycles, even if it is still running.
3. Domain runs that are in-flight continue under their OWN domain leases. They are NOT affected by scheduler lease loss. A domain processor does not check the scheduler lease — it checks its own domain lease.
4. The orphaned cycle is closed by the NEXT scheduler that acquires the scheduler lease (see 1.6).

### 1.5 Fencing for cycle creation

Before inserting a new amaia_sync_cycles row:

1. The engine verifies it holds the scheduler lease (token + identity match + not expired).
2. If verification fails: do not create the cycle. Attempt to re-acquire or shut down.

This is a runtime-level check, not a database-level constraint. The scheduler lease is a coordination mechanism, not a FK dependency.

### 1.6 Fencing for cycle closure (own cycles)

The scheduler that owns a cycle closes it by updating its status to 'success' or 'completed_with_failures'. This requires the scheduler lease to be held (same identity that created the cycle).

### 1.7 Closure of orphaned cycles

When a new scheduler acquires the scheduler lease, it may find 'running' cycles from a previous scheduler. The closure process:

1. The new scheduler holds the scheduler lease — definitively no other scheduler is active.
2. For each 'running' cycle found: set finished_at = now(), status = 'completed_with_failures'. This is a conditional UPDATE WHERE status = 'running' (idempotent, does not overwrite terminal cycles).
3. **The new scheduler does NOT close runs within those cycles.** Runs are protected by domain leases. If a run's domain lease is still active (not expired), the run may be legitimately in-flight from a domain processor that outlived its scheduler. The domain processor will detect its own lease loss (or succeed) independently.
4. Runs whose domain leases have expired will be recovered by the normal domain-level orphan recovery process (when the new scheduler or another process attempts to acquire that domain's lease).

### 1.8 Relationship between scheduler lease and domain leases

| Aspect | Scheduler lease | Domain lease |
|---|---|---|
| Purpose | Cycle ownership | Domain run ownership |
| Scope | One per engine instance | One per domain per run |
| Held for | Entire cycle duration | Individual run duration |
| Grants write access to | amaia_sync_cycles | Domain destination tables, watermarks, manifests, consumptions |
| Recovery target | Orphaned cycles | Orphaned runs |
| Cross-dependency | None. Losing scheduler lease does NOT invalidate domain leases. | None. Losing domain lease does NOT invalidate scheduler lease. |

**Critical invariant:** Scheduler lease expiry and domain lease expiry are INDEPENDENT events. A scheduler crash may expire the scheduler lease while domain leases are still valid (if domain processors are in separate threads or if the domain processor heartbeated more recently). The architecture must handle all 4 combinations:

| Scheduler lease | Domain lease | Situation |
|---|---|---|
| Valid | Valid | Normal operation |
| Expired | Valid | Scheduler crashed but domain processor is still in-flight. Domain run completes or fails on its own. |
| Valid | Expired | Domain processor crashed but scheduler is alive. Scheduler's next domain acquisition triggers orphan recovery for that domain. |
| Expired | Expired | Full crash. Next startup: acquire scheduler lease → close orphan cycles. Acquire domain leases → recover orphan runs. |

---

## 2. Domain Run Recovery

### 2.1 Principle: domain-scoped recovery

Every sync_run is recovered through its own domain lease, never through the scheduler lease. The scheduler lease only governs cycles (the container). The domain lease governs runs (the content).

### 2.2 Recovery flow

When a process attempts to acquire a domain lease and finds it expired:

1. Acquire the expired domain lease (atomic conditional UPDATE — captures previous_owner_identity and previous_lease_token).
2. Search for the orphan run: WHERE domain_name = :domain AND status = 'running' AND owner_identity = :previous_owner_identity AND lease_token = :previous_lease_token.
3. If found: transition to 'orphan_recovered', create recovery run, abandon manifest — all in one transaction (as defined in Implementation Blueprint v1.2 C3 / v1.3 C2).
4. If not found: proceed as a normal run.

### 2.3 What a scheduler CANNOT do to runs

A process holding only the scheduler lease (but not the domain lease) MUST NOT:

- Set any run to 'orphan_recovered'.
- Set any run to 'failed' or 'abandoned'.
- Modify any run's evidence fields (watermark, manifest, counts).
- Release any domain lease.

These operations require the domain lease. The scheduler lease provides no authority over domain-scoped state.

### 2.4 Orphaned cycle with live domain runs

Scenario: Scheduler A created cycle C1 with runs R1 (beneficiario, completed), R2 (logestado, in-flight). Scheduler A crashes. Scheduler B acquires scheduler lease.

B closes cycle C1 (status = 'completed_with_failures'). R2 is still 'running' under its domain lease (logestado). B does NOT touch R2.

Later in B's own cycle (C2): B attempts to acquire the logestado lease. If R2's lease expired: B acquires it, recovers R2 as orphan, creates recovery run R3 under C2. If R2's lease is still valid: B skips logestado (LEASE_HELD).

R2's run references cycle C1 (which is now closed). This is expected — a closed cycle can contain a run that was recovered in a later cycle. The supersedes_run_id on R3 points to R2, providing the cross-cycle audit trail.

---

## 3. Deduplicated Manifest Identity

### 3.1 Problem

The manifest model (v1.2.3 through v1.2.9) defines set identity as:

```
source_id_hash = SHA-256 of sorted source amaia_id values
persisted_id_hash = SHA-256 of sorted destination amaia_id values
sets_match = (source_id_hash == persisted_id_hash)
```

This works for non-deduplicated domains where the source-to-destination relationship is 1:1 on amaia_id (one source row → one destination row). But for enfermedades and medicamentos, the relationship is many:1:

- Source: beneficiario_enfermedad rows with distinct source IDs (e.g., id=10, id=11).
- Destination: amaia_health_conditions rows deduplicated by (beneficiary_amaia_id, hash, hash_version).
- Source IDs 10 and 11 may produce the same canonical hash for the same beneficiary → they collapse to ONE destination row.

If the manifest compares source IDs against destination amaia_ids, the counts and hashes will never match: |source| = 2, |destination| = 1. sets_match = false on every run. The watermark never advances. The domain is permanently blocked.

### 3.2 Solution: domain-specific manifest identity

The manifest's identity basis is configurable per domain:

**For non-deduplicated domains** (beneficiario, red, control_llamadas, logestado, alerta):

Identity = source amaia_id. The 1:1 correspondence holds. Existing manifest model applies unchanged.

**For deduplicated domains** (enfermedades, medicamentos):

Identity = canonical dedup key: (beneficiary_amaia_id, hash, hash_version).

The manifest compares:

- **Source set:** the set of canonical dedup keys derived from the fetched source rows. Each source row is canonicalized and hashed. Duplicate canonical keys collapse (the set is deduplicated).
- **Persisted set:** the set of canonical dedup keys present in the destination table for the same range.
- **sets_match:** source dedup key set == persisted dedup key set (via SHA-256 hash comparison of sorted canonical representations).

### 3.3 Hash computation for deduplicated manifests

For each source row fetched from AMAIA:

1. Compute canonical_text (trim, whitespace collapse, case normalize, diacritics — per 9.2 contract).
2. Compute hash = SHA-256(beneficiary_amaia_id || canonical_text) under hash_version.
3. The canonical dedup key is the triple: (beneficiary_amaia_id, hash, hash_version).
4. Represent as a string: "{beneficiary_amaia_id}|{hash}|{hash_version}".

The manifest's source_id_hash is computed from the sorted, deduplicated set of these strings (not source amaia_ids).

The persisted set is queried from the destination table: SELECT beneficiary_amaia_id, hash, hash_version FROM amaia_health_conditions WHERE ... (for the range being verified). Same string representation. Same SHA-256 hash.

### 3.4 Why source ID collapse does not block the watermark

Example:

```
Source: id=10 (beneficiary=5, text="Diabetes"), id=11 (beneficiary=5, text="Diabetes")
Canonical: both produce (5, hash_of_diabetes, v1)
Dedup key set: {(5, hash_of_diabetes, v1)}  — 1 element

Destination: amaia_health_conditions has 1 row with (beneficiary_amaia_id=5, hash=hash_of_diabetes, hash_version=v1)
Persisted dedup key set: {(5, hash_of_diabetes, v1)}  — 1 element

sets_match = hash({(5, hash_of_diabetes, v1)}) == hash({(5, hash_of_diabetes, v1)}) → true
```

The watermark advances. The manifest correctly proves that every DISTINCT canonical entry from the source exists in the destination. The fact that two source IDs collapsed to one destination row is expected behavior, not an error.

### 3.5 Manifest raw_max_id for deduplicated domains

raw_max_id still tracks the source table's MAX(id) (e.g., MAX(id) from beneficiario_enfermedad). This is used for safety lag computation. The safety lag operates on source IDs, not dedup keys. The manifest stores both:

- raw_max_id: source-side, for safety lag.
- source_id_hash: dedup-key-based, for set identity.

### 3.6 Impact on existing manifest schema

**No schema changes required.** The manifest table columns (source_id_count, source_id_hash, persisted_id_count, persisted_id_hash, sets_match) are reused with different semantics for deduplicated domains:

| Column | Non-dedup domains | Dedup domains |
|---|---|---|
| source_id_count | Count of source amaia_ids | Count of distinct canonical dedup keys |
| source_id_hash | Hash of sorted source amaia_ids | Hash of sorted dedup keys |
| persisted_id_count | Count of destination amaia_ids | Count of dedup keys in destination |
| persisted_id_hash | Hash of sorted destination amaia_ids | Hash of sorted dedup keys in destination |
| sets_match | amaia_id sets equal | Dedup key sets equal |

The domain_name column on the manifest identifies which identity basis applies. The runtime knows the domain's dedup policy from configuration, not from the manifest schema.

---

## 4. Empty Incremental Contract

### 4.1 Condition

An empty incremental occurs when:

```
safe_upper_bound <= watermark_before
```

This means: the confirmed upper bound (after applying safety lag) has not advanced past the current watermark. There is no confirmed-safe range to process.

### 4.2 Behavior

1. **Status:** 'success'. An empty incremental is NOT an error.
2. **Reason code:** 'SUCCESS'. Finding no new confirmed-safe data is the expected outcome when the source is idle or the safety lag has not been overcome.
3. **Watermark advance:** NONE. The watermark does not advance because there is no confirmed-safe upper bound ahead of it. The CAS is not executed — there is no new value to advance to. Attempting CAS with new_value = current_value would violate monotonicity (not strictly greater) and is prohibited.
4. **Manifest:** A manifest row IS created with source_id_count = 0, source_id_hash = hash of empty set, phase = 'comparison_complete'. This provides evidence that the run executed and found nothing.
5. **raw_max_id:** Recorded in the manifest. This is the observed MAX(id) from AMAIA. It may be greater than the watermark (the safety lag holds back the confirmed boundary). Recording it enables temporal promotion: if raw_max_id remains stable across cycles, the tail is promoted to confirmed.
6. **Provisional processing:** If raw_max_id > safe_upper_bound (safety lag zone exists), provisional processing of the lag zone still occurs. Remediation entries are enqueued for provisional rows. This reduces latency for alert detection even when the confirmed window is empty.

### 4.3 Temporal promotion interaction

The empty incremental records raw_max_id in the manifest. On subsequent cycles, if raw_max_id has not changed for >= safety_lag_time, temporal promotion sets safe_upper_bound = raw_max_id. The next cycle's safe_upper_bound > watermark_before → non-empty incremental → watermark advances.

The empty incremental is the mechanism by which the engine observes stability. Without it, the raw_max_id observation would not be recorded, and temporal promotion could not be computed.

---

## 5. Consequence for Phase 9.3C

### 5.1 Ordering

This architectural patch MUST be approved before Phase 9.3C proceeds. 9.3C's scope is limited to seeds, preflight, startup validation, and QA. It does NOT define scheduler ownership semantics or manifest identity policies — those are defined here.

### 5.2 What 9.3C can now assume

Once this patch is approved:

- The scheduler lease contract exists in the architecture. 9.3C provides the seed row.
- The deduplicated manifest identity exists in the architecture. 9.3C provides the watermark seeds for health domains.
- The empty incremental contract exists in the architecture. 9.3C does not need to define it.

### 5.3 What 9.3C MUST NOT do

- Define scheduler ownership semantics (defined here, Section 1).
- Define manifest identity for deduplicated domains (defined here, Section 3).
- Define empty incremental behavior (defined here, Section 4).
- Introduce new tables, columns, triggers, or constraints.

---

## 6. Out of Scope

This patch does NOT:

- Generate SQL, DDL, or migrations.
- Create new tables, columns, indexes, triggers, or constraints.
- Modify the deployed DDL (commit dc7574c).
- Define runtime implementation (that is Phase 9.4).
- Change the reconciliation tier structure.
- Change the lease acquisition/heartbeat/release mechanics (those are unchanged from v1.2.9).
- Change the watermark CAS mechanics (unchanged).
- Change the exclusion or exception ledger mechanics (unchanged).

### DDL compatibility assessment

**Scheduler lease:** Uses an existing row in amaia_sync_leases. No DDL change. The table already supports arbitrary entity_name values.

**Deduplicated manifest identity:** Reuses existing manifest columns (source_id_count, source_id_hash, etc.) with different semantic content. No DDL change. The column types (integer, text) are agnostic to whether the hash represents amaia_ids or dedup keys.

**Empty incremental:** No DDL change. The manifest and sync_run schemas already support 0-row runs with 'success' status.

**Conclusion: No DDL changes required.** This patch operates entirely within the existing schema.

---

## Self-Audit

### Attack: Scheduler B closes cycle C1 which has an in-flight run R2 with active domain lease

Result: B closes the cycle (status = 'completed_with_failures'). B does NOT touch R2 (no domain lease for R2's domain). R2 continues under its own lease. When R2 completes: its run references the now-closed C1. This is expected — the cycle container can close before all content finalizes. R2's evidence is complete in its own sync_run row. **No data loss. Resists.**

### Attack: Scheduler B closes cycle C1, then R2's domain lease expires, and both B and C try to recover R2

Result: Domain lease acquisition is atomic. Only one (B or C) acquires it. The loser gets 0 rows. The winner creates exactly one recovery run. **Exactly one recovery. Resists.**

### Attack: Manifest for enfermedades with source IDs {10, 11} collapsing to 1 dedup key

Result: source dedup key set = {(5, hash_diabetes, v1)}, count = 1. Persisted dedup key set = {(5, hash_diabetes, v1)}, count = 1. sets_match = true. Watermark advances. **No false mismatch. Resists.**

### Attack: Manifest for enfermedades where source has 3 IDs collapsing to 2 dedup keys, but destination only has 1

Result: source set = {key_A, key_B}, persisted set = {key_A}. sets_match = false. missing = {key_B}. Run fails. Watermark stays. **Correct detection of incomplete sync. Resists.**

### Attack: Empty incremental attempts CAS 0 → 0

Result: The empty incremental contract (4.2) prohibits CAS when safe_upper_bound <= watermark_before. No CAS is executed. The watermark stays at its current value. **No invalid CAS. Resists.**

### Attack: Scheduler loses lease mid-cycle. Domain processors continue.

Result: Domain processors check THEIR OWN domain leases, not the scheduler lease. They continue processing. The orphaned cycle is closed by the next scheduler. Domain runs complete normally under their own leases. **No domain impact from scheduler lease loss. Resists.**

### Attack: Two schedulers try to create concurrent cycles

Result: Both attempt to acquire the scheduler lease. Only one succeeds (atomic conditional UPDATE). The other blocks or gets 0 rows. Only one cycle is created. **No concurrent cycles. Resists.**

---

**End of document.**
