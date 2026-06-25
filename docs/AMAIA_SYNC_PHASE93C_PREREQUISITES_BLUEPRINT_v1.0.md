# AMAIA-SYNC Phase 9.3C Prerequisites Blueprint v1.0

**Phase:** 9.3C — Operational Prerequisites  
**Status:** Blueprint — pending Codex audit before migration authoring  
**Blocking:** Fase 9.4A (Runtime Implementation) cannot begin until 9.3C is deployed  
**Source:** Runtime Implementation Blueprint v1.3 (C4), Runtime Architecture v1.2.9  
**Deployed schema:** Commit dc7574c (9.3B), Tag amaia-sync-phase93b-runtime-ddl  
**Author:** Claude (constructor)  
**Date:** 2026-06-19

**Note:** NO code, NO SQL, NO migrations, NO implementation. Blueprint only.

---

## Executive Summary

Fase 9.3C adds exactly 3 seed rows to existing tables. No new tables, columns, triggers, constraints, or indexes. The seeds complete the operational prerequisites for a 7-domain V1 runtime:

1. **Watermark seed for enfermedades** — enables health conditions sync.
2. **Watermark seed for medicamentos** — enables medications sync.
3. **Lease seed for scheduler** — enables scheduler ownership, cycle creation, and crash recovery.

Without these seeds, the runtime cannot start (startup validation aborts on missing prerequisites).

---

## 1. Business Problem

### Why 7 domains, not 5

Runtime Architecture v1.2.9 defines 7 sync domains: beneficiario, red, control_llamadas, logestado, alerta, enfermedades, medicamentos. This was established in Fase 9.1 based on AMAIA's data model and validated empirically in 9.1D. The teleasistencia platform requires health context (conditions and medications) for patient care decisions. A runtime that excludes these domains is operationally incomplete.

### Why enfermedades and medicamentos cannot be deferred

The 9.2 migration created the destination tables (amaia_health_conditions, amaia_medications) with dedup indexes, canonical hash columns, and the full schema required for sync. The 9.3B migration created the manifest, remediation, and exclusion infrastructure that supports all domains. The only missing piece is the watermark seed rows that tell the runtime "start syncing from id=0."

Excluding these domains from V1 would contradict the approved architecture and leave deployed schema unused. Adding the seeds is a 2-row operation — the simplest possible unblock.

### Why the scheduler lease is a prerequisite

Implementation Blueprint v1.3 (C1) established that cycle creation requires a scheduler lease in amaia_sync_leases. The scheduler lease provides:
- **Cycle ownership:** Only the scheduler lease holder can create cycles.
- **Liveness proof:** The scheduler heartbeats the lease during the cycle. Expiry proves the scheduler crashed.
- **Recovery serialization:** A new scheduler acquires the expired scheduler lease before closing orphan cycles. This prevents multiple recovery processes from competing.

Without the scheduler lease seed row, the runtime cannot acquire the lease (the row doesn't exist to UPDATE), cannot create cycles, and cannot process any domain.

### Why 9.4A is blocked

The Runtime Implementation Blueprint v1.3 specifies a startup validation that aborts if any of the 7 watermark rows or the scheduler lease row is missing. This is invariant 25: "Runtime does not start without all 7 watermarks + scheduler lease row present." Fase 9.3C provides the 3 missing rows.

---

## 2. Scheduler Lease Contract

### Seed state

| Column | Value |
|---|---|
| entity_name | 'scheduler' |
| owner_identity | NULL (free) |
| lease_token | 0 (no acquisition yet) |
| lease_expires_at | NULL (not held) |
| heartbeat_at | NULL |
| acquired_at | NULL |

### Lifecycle

**Acquire:** The scheduler acquires this lease at the start of every cycle. Same atomic conditional UPDATE as domain leases: succeeds if owner_identity IS NULL OR lease_expires_at < now(). On success: lease_token incremented, owner_identity set, lease_expires_at set.

**Heartbeat:** Every 2 minutes during the cycle. Same conditional UPDATE as domain leases: requires token + identity + lease vigente. Extends lease_expires_at.

**Release:** At cycle end, after the cycle is closed (terminal status set). Same conditional UPDATE as domain leases.

**Recovery:** On startup, the new scheduler attempts to acquire the scheduler lease. If a previous scheduler crashed (lease expired), the acquisition succeeds. The new scheduler then closes any 'running' cycles (they are definitively orphaned because no other scheduler is active).

### Invariants

1. **At most one scheduler holds the lease at any time.** The atomic conditional UPDATE ensures this.
2. **Cycle creation requires a held scheduler lease.** The runtime verifies it holds the scheduler lease before inserting a new cycle row.
3. **Cycle recovery requires a held scheduler lease.** Closing orphan cycles only happens after acquiring the scheduler lease — proving no other scheduler is alive.
4. **The scheduler lease row must exist before the runtime starts.** Fase 9.3C provides this.

### Relationship to other operations

| Operation | Requires scheduler lease? | Requires domain lease? |
|---|---|---|
| Create cycle | Yes | No |
| Close cycle | Yes | No |
| Close orphan cycles | Yes | No |
| Acquire domain lease | No (scheduler lease already held for cycle context) | Yes (the specific domain) |
| Domain processing | No (implicitly — scheduler lease held for the cycle) | Yes |
| Heartbeat domain lease | No | Yes |
| Release domain lease | No | Yes |
| Reconciliation | No (implicitly — scheduler lease held for the cycle) | Yes (per domain) |

The scheduler lease is held for the entire cycle duration. Domain leases are held per-run within the cycle. They coexist without conflict (different rows in amaia_sync_leases).

---

## 3. Enfermedades Watermark

### Seed state

| Column | Value |
|---|---|
| entity_name | 'enfermedades' |
| source_table | 'beneficiario_enfermedad' |
| watermark_type | 'id' |
| last_id | 0 |
| last_timestamp | NULL (inactive for id-based domain) |

### Bootstrap behavior

On the first sync cycle for enfermedades:

1. The processor reads the watermark: last_id = 0.
2. Computes lower_bound = max(0 - id_overlap, 0) = 0. upper_bound = safe_upper_bound (raw_max_id - id_safety_lag).
3. Fetches all rows from AMAIA's beneficiario_enfermedad table with id > 0 AND id <= upper_bound. This is the initial load.
4. Normalizes: canonicalization + hashing per 9.2 contract (canonical_text, hash, hash_version).
5. Upserts to amaia_health_conditions. Dedup index handles duplicates.
6. Manifest created (mandatory for id-based domains per v1.3).
7. Set-identity verified. Watermark advanced to upper_bound.

### Empty source behavior

If AMAIA's beneficiario_enfermedad table is empty (0 rows): the fetch returns 0 rows. The manifest records source_id_count = 0, source_id_hash = hash of empty string. sets_match = true (empty == empty). Watermark advances to upper_bound (which equals safe_upper_bound, possibly 0 if raw_max_id = 0). This is a valid empty incremental.

### Relationship to reconciliation

Enfermedades participates in reconciliation at the same cadence as other low-frequency domains: monthly full count + id-set comparison. The reconciliation engine uses the same entity_name ('enfermedades') to look up its watermark and compare source vs destination.

### Monotonicity

The watermark (last_id) is monotonically increasing. The source table (beneficiario_enfermedad) is id-based append-only (per 9.1D empirical validation). New rows always have higher IDs. The safety lag + overlap mechanism (id_safety_lag = 50, id_overlap = 50) applies.

---

## 4. Medicamentos Watermark

### Seed state

| Column | Value |
|---|---|
| entity_name | 'medicamentos' |
| source_table | 'beneficiario_medicamento' |
| watermark_type | 'id' |
| last_id | 0 |
| last_timestamp | NULL (inactive for id-based domain) |

### Bootstrap behavior

Identical to enfermedades (Section 3), substituting:
- Source table: beneficiario_medicamento.
- Destination table: amaia_medications.
- Dedup index: (beneficiary_amaia_id, hash, hash_version) on amaia_medications.

### Empty source behavior

Same as enfermedades. Valid empty incremental.

### Relationship to reconciliation

Same cadence as enfermedades: monthly full count + id-set.

### Monotonicity

Same as enfermedades. Source table is id-based append-only. safety_lag = 50, overlap = 50.

### Semantic note

9.1D V-005 confirmed that duplicate source entries exist in AMAIA (same beneficiary, same text, different source_id). The dedup index handles this: the upsert ON CONFLICT on (beneficiary_amaia_id, hash, hash_version) collapses duplicates. rows_upserted may be less than rows_fetched. This is expected behavior, not an error.

---

## 5. Runtime Startup Contract

### Startup validation

On startup, before creating any cycle or processing any domain, the runtime validates:

**Watermark rows (7 required):**

| entity_name | watermark_type | Expected seed source |
|---|---|---|
| beneficiario | timestamp | 9.1 migration (20260615130000) |
| red | timestamp | 9.1 migration (20260615130000) |
| control_llamadas | id | 9.1 migration (20260615130000) |
| logestado | id | 9.1 migration (20260615130000) |
| alerta | id | 9.3B migration (corrected from timestamp) |
| enfermedades | id | **9.3C migration** |
| medicamentos | id | **9.3C migration** |

**Lease row (1 required):**

| entity_name | Expected seed source |
|---|---|
| scheduler | **9.3C migration** |

**Validation logic:**

For each of the 7 watermark entity_names: query amaia_sync_watermarks WHERE entity_name = :name. If not found: abort with error 'Missing watermark seed for {name}. Run Fase 9.3C migration.'

For the scheduler lease: query amaia_sync_leases WHERE entity_name = 'scheduler'. If not found: abort with error 'Missing scheduler lease seed. Run Fase 9.3C migration.'

**Additional validation:**

For each watermark: verify watermark_type matches the expected type for the domain. If mismatch: abort with error 'Watermark type mismatch for {name}: expected {expected}, found {actual}.'

For id-based watermarks: verify last_id IS NOT NULL (invariant 21 from v1.2). If NULL: abort.

For timestamp-based watermarks: verify last_timestamp IS NOT NULL. If NULL: abort.

---

## 6. Migration Preconditions

### Preflight

Before inserting any seed row, the migration verifies:

**For watermark seeds (enfermedades, medicamentos):**

1. Check if a row already exists for the entity_name.
2. If it exists AND last_id > 0: **abort.** A sync engine has already run and advanced the cursor. The seed must not overwrite live state.
3. If it exists AND last_id = 0: **skip** (idempotent — the seed is already present in its initial state). Use ON CONFLICT DO NOTHING.
4. If it does not exist: **insert.**

**For scheduler lease seed:**

1. Check if a row already exists for entity_name = 'scheduler'.
2. If it exists AND owner_identity IS NOT NULL: **abort.** A scheduler is actively holding the lease. The migration must not interfere with a live scheduler.
3. If it exists AND owner_identity IS NULL AND lease_token = 0: **skip** (idempotent).
4. If it exists AND owner_identity IS NULL AND lease_token > 0: **skip** (the lease was used and released — still valid initial state for the next scheduler).
5. If it does not exist: **insert.**

### Idempotency

The migration uses INSERT ON CONFLICT DO NOTHING for all 3 rows. Running the migration multiple times produces the same result: exactly 3 rows exist with correct initial values. No data is overwritten.

### Protection against live state

The migration NEVER updates an existing row. It only inserts if the row doesn't exist. The ON CONFLICT DO NOTHING clause ensures this. If a row already exists (regardless of its current state), the INSERT is a no-op.

The preflight abort conditions (last_id > 0, owner_identity IS NOT NULL) are implemented as validation checks BEFORE the INSERT, providing explicit error messages rather than silent no-ops.

### Rollback

If any preflight check fails: the entire migration transaction rolls back. No partial seeds are left. The migration is all-or-nothing.

---

## 7. QA Blueprint

### Structural tests

**T1 — Scheduler lease exists:**
- Query amaia_sync_leases WHERE entity_name = 'scheduler'.
- Verify: exists, owner_identity IS NULL, lease_token = 0.

**T2 — Enfermedades watermark exists:**
- Query amaia_sync_watermarks WHERE entity_name = 'enfermedades'.
- Verify: exists, watermark_type = 'id', last_id = 0, last_timestamp IS NULL.

**T3 — Medicamentos watermark exists:**
- Query amaia_sync_watermarks WHERE entity_name = 'medicamentos'.
- Verify: exists, watermark_type = 'id', last_id = 0, last_timestamp IS NULL.

### Idempotency test

**T4 — Double execution:**
- Execute the seed operation twice (conceptually: INSERT ON CONFLICT DO NOTHING for all 3 rows, then again).
- Verify: all 3 rows still exist with unchanged values. No errors. No duplicates.

### Protection tests

**T5 — Scheduler lease with active owner:**
- Temporarily set owner_identity = 'test_owner' on the scheduler lease.
- Attempt the seed operation.
- Verify: the operation detects the active lease and aborts (or the ON CONFLICT DO NOTHING leaves it unchanged — the row already exists).
- Clean up: restore owner_identity = NULL.

**T6 — Watermark with advanced cursor:**
- Temporarily set last_id = 100 on one of the health domain watermarks.
- Attempt the seed operation.
- Verify: the operation does NOT overwrite last_id = 100 with last_id = 0.
- Clean up: restore last_id = 0.

### Completeness test

**T7 — All 7 watermarks present:**
- Query amaia_sync_watermarks for all 7 entity_names.
- Verify: all 7 exist.

**T8 — Scheduler lease present:**
- Query amaia_sync_leases WHERE entity_name = 'scheduler'.
- Verify: exists.

### QA is transactional

All tests run within BEGIN/ROLLBACK. No test data persists. Cleanup steps (T5, T6) are within the rollback scope.

---

## 8. Architectural Impact

### Does 9.3C modify Runtime Architecture v1.2.9?

**No.** The architecture already defines 7 domains and references watermark seeds for all of them. 9.3C fulfills what the architecture assumed existed.

### Does 9.3C modify Schema Blueprint v1.0.4?

**No.** No new tables, columns, constraints, or triggers. The seed rows use existing tables (amaia_sync_watermarks, amaia_sync_leases) with existing columns.

### Does 9.3C modify DDL Blueprint v1.0.4?

**No.** The DDL Blueprint defined seeds for reconciliation_segments and watermark corrections. 9.3C adds seeds to the same tables using the same patterns (INSERT ON CONFLICT DO NOTHING). No DDL changes.

### Does 9.3C modify functional scope?

**No.** The 7-domain scope was defined in Runtime Architecture v1.2.9 and approved by Codex. 9.3C does not add or remove domains. It provides the operational prerequisite for domains that were already in scope.

### What 9.3C IS

A **data completeness migration.** It inserts 3 rows into existing tables to fulfill assumptions made by already-approved architecture, schema, and DDL. It is the minimum operation required to unblock Fase 9.4A.

---

## Inventory

### Rows to insert

| # | Table | entity_name | Key columns |
|---|---|---|---|
| 1 | amaia_sync_watermarks | enfermedades | watermark_type='id', last_id=0 |
| 2 | amaia_sync_watermarks | medicamentos | watermark_type='id', last_id=0 |
| 3 | amaia_sync_leases | scheduler | owner_identity=NULL, lease_token=0 |

### Tables modified

None (structurally). Data insertions only.

### New tables

None.

### New columns

None.

### New triggers

None.

### New constraints

None.

### New indexes

None.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Seed applied after engine has already run (cursor > 0) | Low | Preflight aborts if last_id > 0 or owner_identity IS NOT NULL. ON CONFLICT DO NOTHING prevents overwrite. |
| Migration executed during live engine operation | Low | Scheduler lease seed uses INSERT ON CONFLICT DO NOTHING — does not interfere with a held lease. Watermark seeds are for domains not yet processed (last_id = 0). |
| Seed rows deleted accidentally | Low | Runtime startup validation catches missing rows and aborts. The engine cannot silently run without prerequisites. |
| source_table value for health domains incorrect | Low | Values match the AMAIA MySQL table names confirmed in 9.1D empirical validation (beneficiario_enfermedad, beneficiario_medicamento). |

---

## Self-Audit

### Attack: Engine starts without 9.3C migration

Result: Runtime startup validation queries for 'enfermedades' watermark → not found → abort. **Fail-closed. Resists.**

### Attack: 9.3C migration run twice

Result: INSERT ON CONFLICT DO NOTHING. Second execution inserts 0 rows. Existing rows unchanged. **Idempotent. Resists.**

### Attack: 9.3C migration run while engine holds scheduler lease

Result: INSERT ON CONFLICT DO NOTHING for entity_name='scheduler'. Row already exists (held by engine). INSERT is a no-op. Engine continues unaffected. **Non-interfering. Resists.**

### Attack: 9.3C migration tries to overwrite advanced watermark

Result: INSERT ON CONFLICT DO NOTHING. The row with last_id=100 already exists. INSERT is a no-op. Cursor preserved. Preflight validation (if implemented) would also abort. **Protected. Resists.**

### Attack: source_table value mismatch with AMAIA

Result: The source_table column is metadata used by the runtime to construct queries. If incorrect, the runtime would query the wrong table — detected immediately by a MySQL error (table not found). Fixed by correcting the seed value. **Detectable. Low risk.**

### Attack: Scheduler lease row exists but with lease_token > 0

Result: This means the lease was previously used and released. owner_identity IS NULL. This is a valid state — the scheduler can acquire it normally (increments token). The seed's lease_token=0 would conflict with this state, but ON CONFLICT DO NOTHING means the existing row (with token > 0) is preserved. **Correct behavior. Resists.**

---

## Confirmations

- No code generated.
- No SQL generated.
- No migrations generated.
- No implementation generated.
- No scope changes.
- No architectural modifications.
- Fase 9.3C is exclusively a data completeness migration.

---

**End of document.**
