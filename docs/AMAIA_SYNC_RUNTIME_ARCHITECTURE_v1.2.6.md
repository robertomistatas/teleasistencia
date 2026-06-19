# AMAIA-SYNC Runtime Architecture v1.2.6

**Phase:** 9.3 Rev.9  
**Status:** Design — pending internal review  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.5-clean.md  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Date:** 2026-06-18

---

## Scope

All content from v1.2.5-clean is incorporated by reference unless explicitly superseded. This revision corrects 4 critical blockers from Codex's rejection.

**Superseded v1.2.5 sections:** M2 (Extra IDs Resolution Path — replaced by C4 below), manifest phase CHECK (replaced by C2), remediation queue status CHECK (replaced by C3).

**Removed from v1.2.5:** The `persisted_id_hash_filtered` column on manifests (was M2) is eliminated. It was based on asymmetric filtering that C1 now corrects.

---

## C1 — Symmetric Manifest Comparison over Identical Universe

### Problem

v1.2.5 filters the persisted set P to exclude overlap artifacts but compares against the full source set S. This produces false mismatches on normal overlap cases:

```
lower_bound = 90 (watermark_before=100, overlap=10)
upper_bound = 120
S = {90,91,...,120}  (fetched from AMAIA for (90, 120])
P = {90,91,...,120}  (in amaia_alert_logs for same range)
P_filtered = {101,...,120}  (overlap artifacts removed)
hash(S) != hash(P_filtered)  → FALSE MISMATCH
```

### Correction: Option A — No filtering, symmetric comparison

Both S and P are computed over the identical range (lower_bound, upper_bound]. No filtering is applied to either set. The comparison is:

```
sets_match = (source_id_hash == persisted_id_hash) AND (source_id_count == persisted_id_count)
```

where both hashes are computed over the same range.

### Why overlap does not produce false extra_ids

The overlap zone is [lower_bound, watermark_before]. Both S and P include this zone:

- **S** includes overlap IDs because the AMAIA fetch covers (lower_bound, upper_bound], which includes the overlap zone.
- **P** includes overlap IDs because they were persisted by previous runs and the query covers the same range.

Since both sets include the overlap zone, overlap IDs appear in both S and P. They are not extra. The only way an ID appears in P but not S is if it was deleted from AMAIA since the previous run — a genuine retroactive delete, not an artifact.

### What this changes from v1.2.5

- **Removed:** `persisted_id_hash_filtered` column on amaia_sync_run_manifests. No longer needed.
- **Removed:** Overlap artifact filtering logic from M2.
- **Simplified:** Manifest records only `source_id_hash`, `persisted_id_hash`, `sets_match`. No filtered variants.
- **Extra IDs resolution:** Moved entirely to C4 (manifest exclusions ledger) for genuine discrepancies only.

### Schema impact

Remove 1 column (persisted_id_hash_filtered) from v1.2.5's manifest design. Net manifest columns: raw_max_id, provisional_upper_bound, provisional_id_count, provisional_id_hash (4 columns added across v1.2.4–v1.2.5, minus the 1 removed here = 4 total).

---

## C2 — Implementable Manifest Lifecycle with Provisional Phases

### Problem

v1.2.5 says: (1) confirmed run completes, (2) manifest reaches `comparison_complete` (terminal, frozen), (3) then provisional processing happens. Step 3 cannot write to a frozen manifest.

### Correction: Expanded phase progression

A single manifest per run with 5 phases in strict forward-only order:

```
source_fetched → confirmed_compared → provisional_persisted → comparison_complete → abandoned
```

Not all phases are required. A run without provisional zone skips `provisional_persisted` and goes directly from `confirmed_compared` to `comparison_complete`.

### Phase definitions and write permissions

**Phase 1: `source_fetched`**

- **Trigger:** Confirmed source IDs accumulated, source_id_hash computed.
- **Writes committed:** source_id_count, source_id_hash, raw_max_id.
- **Immutable from this point:** run_id, domain_name, source_id_count, source_id_hash, raw_max_id, created_at.

**Phase 2: `confirmed_compared`**

- **Trigger:** Confirmed set comparison completed.
- **Writes committed:** persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at.
- **Decision point:** If sets_match = true, the watermark advance proceeds (in the same fenced transaction). If false, the run fails — no provisional processing, manifest goes to `comparison_complete`.

**Phase 3: `provisional_persisted`** (optional — only if confirmed_upper_bound < raw_max_id)

- **Trigger:** Provisional zone fetched, upserted, remediation enqueued.
- **Writes committed:** provisional_upper_bound, provisional_id_count, provisional_id_hash.
- **Provisional failure policy:** If provisional upsert fails, the manifest records what was attempted (provisional_upper_bound set, provisional_id_count = 0 or partial, provisional_id_hash = NULL) and proceeds to `comparison_complete`. The confirmed watermark ALREADY advanced (in Phase 2). Provisional failure does NOT roll back the confirmed advance. The un-processed provisional IDs will be retried on the next cycle (they remain in the lag zone or are promoted temporally).

**Phase 4: `comparison_complete`** (terminal)

- **Trigger:** All processing for this run is finished.
- **Writes committed:** phase = 'comparison_complete'. All columns frozen.
- **No further writes permitted.**

**Phase 5: `abandoned`** (terminal)

- **Trigger:** Orphan recovery detects an incomplete manifest.
- **Reachable from:** any non-terminal phase.
- **All columns frozen after transition.**

### Valid phase transitions

| From | To | Condition |
|---|---|---|
| source_fetched | confirmed_compared | Confirmed comparison executed |
| source_fetched | abandoned | Orphan recovery |
| confirmed_compared | provisional_persisted | Provisional zone exists and sets_match = true |
| confirmed_compared | comparison_complete | No provisional zone, or sets_match = false |
| confirmed_compared | abandoned | Orphan recovery |
| provisional_persisted | comparison_complete | Provisional processing finished (success or failure) |
| provisional_persisted | abandoned | Orphan recovery |

### Watermark advance timing

The confirmed watermark advances during the `confirmed_compared` → `provisional_persisted` or `confirmed_compared` → `comparison_complete` transition, within the fenced transaction. It is conditional on sets_match = true for the confirmed zone only. Provisional processing is decoupled from watermark advance.

### Column classification (supersedes v1.2.5 M1)

**Immutable from INSERT:**
- run_id, domain_name, source_id_count, source_id_hash, raw_max_id, created_at

**Written at confirmed_compared:**
- persisted_id_count, persisted_id_hash, sets_match, missing_ids, extra_ids, verified_at

**Written at provisional_persisted:**
- provisional_upper_bound, provisional_id_count, provisional_id_hash

**Written at any transition:**
- phase (forward-only)

**Trigger enforcement:**
- Immutable-from-INSERT columns: reject any change.
- Phase 2 columns: writable only during source_fetched → confirmed_compared transition.
- Phase 3 columns: writable only during confirmed_compared → provisional_persisted transition.
- Terminal phases: reject all UPDATEs.
- DELETE: always rejected.

### Schema impact

Manifest phase CHECK updated: ('source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned'). Replaces previous CHECK. Trigger logic updated for per-phase column write permissions.

---

## C3 — Remediation Queue Fail-Closed State Machine

### Problem

v1.2.5's remediation queue has `processing`, `failed`, `ignored` states that become invisible once the processor selects only `pending`. A failed remediation entry can fall off the radar permanently.

### Correction: Formal state machine with claim semantics and audit

### States

| State | Description | Selectable by processor? |
|---|---|---|
| `pending` | Awaiting processing | Yes |
| `claimed` | A processor has claimed this entry and is working on it | No (owned by claimant) |
| `success` | Alert successfully refetched and upserted | No (terminal) |
| `failed_retryable` | Processing failed, retry budget remaining | Yes (when claim_expires_at < now()) |
| `failed_terminal` | Retry budget exhausted or unrecoverable error | No (requires operator attention) |
| `ignored_approved` | Operator explicitly approved skipping this remediation | No (terminal) |

### Valid transitions

```
pending → claimed (processor claims)
claimed → success (processor completes)
claimed → failed_retryable (processor fails, retry_count < max_retries)
claimed → failed_terminal (processor fails, retry_count >= max_retries)
claimed → pending (claim expired, unclaimed by Scheduler)
failed_retryable → claimed (processor re-claims after claim expiry)
failed_retryable → ignored_approved (operator approves ignoring)
failed_terminal → ignored_approved (operator approves ignoring)
```

No other transitions are valid. A trigger enforces the state machine.

### Claim semantics

The processor selects claimable entries:

```
WHERE status = 'pending'
   OR (status = 'claimed' AND claim_expires_at < now())
   OR (status = 'failed_retryable' AND claim_expires_at < now())
```

Claim is atomic: UPDATE ... SET status = 'claimed', claimed_by_run_id = :run_id, claimed_at = now(), claim_expires_at = now() + :claim_ttl, retry_count = retry_count + 1 WHERE id = :id AND (status IN ('pending', 'failed_retryable') OR (status = 'claimed' AND claim_expires_at < now())).

If the UPDATE affects 0 rows, the entry was claimed by another process. Move on.

### Success contract

The transition from `claimed` to `success` MUST occur in the same fenced transaction as the alert upsert to amaia_alerts. This is the same transaction that holds the alerta lease and verifies the ownership predicate. If the transaction rolls back, the claim reverts (the row was not committed as 'success').

On success: consumed_by_run_id = this run's id, processed_at = now().

### Failure handling

On failure within a claimed entry:
- If retry_count < max_retries: status = 'failed_retryable'. The entry becomes claimable again after claim_expires_at.
- If retry_count >= max_retries: status = 'failed_terminal'. The entry requires operator attention.

`failed_terminal` entries are visible in operational dashboards. They represent obligations that the system cannot fulfill automatically.

### Ignore approval

To transition to `ignored_approved`, the operator provides:
- ignored_by: text NOT NULL (operator identity)
- ignored_at: timestamptz NOT NULL
- ignore_reason: text NOT NULL (CHECK length > 0)
- ignore_evidence: jsonb (optional supporting data)

This is a direct UPDATE to the remediation row (not a separate decisions table — the remediation lifecycle is simpler than the exception lifecycle and doesn't need multi-decision versioning).

A trigger validates: if new status = 'ignored_approved', then ignored_by, ignored_at, and ignore_reason must all be non-null.

### New/modified columns on amaia_sync_alert_remediation_queue

| Column | Type | Nullable | New/Modified |
|---|---|---|---|
| status | text | no | CHECK updated: ('pending', 'claimed', 'success', 'failed_retryable', 'failed_terminal', 'ignored_approved') |
| claimed_by_run_id | uuid | yes | NEW. FK → amaia_sync_runs(id) ON DELETE SET NULL |
| claimed_at | timestamptz | yes | NEW |
| claim_expires_at | timestamptz | yes | NEW |
| retry_count | integer | no | NEW. DEFAULT 0, CHECK >= 0 |
| max_retries | integer | no | NEW. DEFAULT 3, CHECK > 0 |
| failure_reason | text | yes | NEW. Populated on failed_retryable/failed_terminal |
| ignored_by | text | yes | NEW. Required when status = 'ignored_approved' |
| ignored_at | timestamptz | yes | NEW. Required when status = 'ignored_approved' |
| ignore_reason | text | yes | NEW. Required when status = 'ignored_approved', CHECK (null or length > 0) |
| ignore_evidence | jsonb | yes | NEW. Optional |

### Indexes (additional)

- (status, claim_expires_at) WHERE status IN ('pending', 'claimed', 'failed_retryable') — claimable query
- (status) WHERE status = 'failed_terminal' — operational visibility

### Trigger

BEFORE UPDATE trigger enforces:
1. State transitions follow the valid transition graph.
2. If new status = 'ignored_approved': ignored_by, ignored_at, ignore_reason must be non-null.
3. If new status = 'success': consumed_by_run_id and processed_at must be non-null.
4. Immutable columns (id, source_type, logestado_amaia_id, alert_amaia_id, origin_run_id, origin_reconciliation_result_id, created_at) cannot change.

### Schema impact

11 new columns on amaia_sync_alert_remediation_queue. Modified status CHECK. 1 new trigger. 2 new indexes.

---

## C4 — Extra IDs Convergence via Manifest Exclusions Ledger

### Problem

If a genuine extra ID (P \ S, after C1's symmetric comparison) exists in amaia_alert_logs, every retry produces the same sets_match = false. The logestado watermark is permanently blocked until the extra ID is resolved. There is no auditable mechanism to resolve it.

### Correction: Option B — Manifest exclusions ledger

A new table records operator-approved exclusions for specific amaia_ids that may be excluded from the persisted set during manifest comparison. This unblocks retries while maintaining full auditability.

### Table: amaia_sync_manifest_exclusions

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| domain_name | text | no | |
| excluded_amaia_id | integer | no | The amaia_id to exclude from P during comparison |
| exclusion_type | text | no | CHECK ('retroactive_amaia_delete', 'destination_contamination', 'range_miscalculation', 'other') |
| detection_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL. The run whose manifest first reported this as extra. |
| detection_manifest_id | uuid | yes | FK → amaia_sync_run_manifests(id) ON DELETE SET NULL |
| amaia_lookup_evidence | text | no | Factual result of AMAIA primary-key lookup at investigation time |
| amaia_lookup_at | timestamptz | no | |
| status | text | no | CHECK ('pending_review', 'approved', 'rejected'), DEFAULT 'pending_review' |
| approved_by | text | yes | Required when status = 'approved' |
| approved_at | timestamptz | yes | Required when status = 'approved' |
| reason | text | no | CHECK (length(reason) > 0). Explanation of why this ID is excluded |
| created_at | timestamptz | no | default now() |

Unique: (domain_name, excluded_amaia_id). One exclusion per ID per domain. If rejected, a new investigation creates a new row (requires deleting or updating the old one — or using a versioned approach like the exception ledger).

Indexes: (domain_name, status), (detection_run_id).

### Comparison with exclusions

The manifest comparison is modified:

1. Compute S (source set) and P (persisted set) as before, over (lower_bound, upper_bound].
2. Load E: the set of excluded_amaia_id values from amaia_sync_manifest_exclusions WHERE domain_name = this domain AND status = 'approved'.
3. Compute P_effective = P minus E.
4. Compute S_effective = S minus E (for symmetry — an excluded ID should not appear in either set's hash).
5. sets_match = (hash(S_effective) == hash(P_effective)) AND (|S_effective| == |P_effective|).

If an approved exclusion removes the extra ID from P_effective, the comparison can pass. The excluded ID is not silently deleted from amaia_alert_logs — it remains in the table but is excluded from the manifest comparison.

### Exclusion lifecycle

**Detection:** When a manifest reports extra_ids, the engine automatically creates `pending_review` exclusion entries for each extra ID (in the same transaction as the manifest update to `confirmed_compared`).

**Investigation:** The operator checks each exclusion:
- Queries AMAIA for the excluded_amaia_id by primary key.
- If not found in AMAIA: retroactive delete. Approves exclusion. The ID will enter the tombstone lifecycle via reconciliation.
- If found in AMAIA: range miscalculation or timing issue. Investigates further.

**Approval:** Operator sets status = 'approved', approved_by, approved_at.

**Effect on retry:** The next logestado run reads the approved exclusions. P_effective excludes the approved IDs. If S also doesn't contain them (because AMAIA deleted them), S_effective == P_effective. sets_match = true. Watermark advances.

### Convergence path

```
Cycle N: Manifest detects extra_id=95 (in P, not in S).
  → sets_match = false. Watermark blocked.
  → Exclusion entry created: excluded_amaia_id=95, status='pending_review'.

Operator investigates: AMAIA lookup for id=95 → 0 rows (deleted from AMAIA).
  → Approves exclusion: status='approved', exclusion_type='retroactive_amaia_delete'.

Cycle N+1: Retry with same range.
  → P includes 95. S does not include 95. E = {95}.
  → P_effective = P - {95}. S_effective = S - {95} = S (95 wasn't in S anyway).
  → hash(S_effective) == hash(P_effective). sets_match = true.
  → Watermark advances.

Weekly reconciliation: id-set comparison finds 95 in amaia_alert_logs but not in AMAIA.
  → Tombstone lifecycle: detected → confirmed → inactive_confirmed.
```

The extra ID is resolved through two complementary paths: exclusion unblocks the watermark; tombstone lifecycle handles the stale destination row.

### Interaction with C1 (symmetric comparison)

After C1 removes filtering, the only source of extra_ids is genuine discrepancies. The exclusions ledger handles these exclusively. No overlap artifacts need excluding.

### Schema impact

1 new table (amaia_sync_manifest_exclusions). 1 trigger for status transition validation (approved requires non-null approved_by/approved_at).

---

## Schema Gap Analysis — Delta from v1.2.5

### New tables

| Table | Source |
|---|---|
| amaia_sync_manifest_exclusions | C4 |

### Removed columns (from v1.2.5 design)

| Table | Column | Reason |
|---|---|---|
| amaia_sync_run_manifests | persisted_id_hash_filtered | C1: asymmetric filtering removed |

### New columns on existing tables

| Table | Column | Type | Nullable | Source |
|---|---|---|---|---|
| amaia_sync_alert_remediation_queue | claimed_by_run_id | uuid | yes | C3 |
| amaia_sync_alert_remediation_queue | claimed_at | timestamptz | yes | C3 |
| amaia_sync_alert_remediation_queue | claim_expires_at | timestamptz | yes | C3 |
| amaia_sync_alert_remediation_queue | retry_count | integer | no (default 0) | C3 |
| amaia_sync_alert_remediation_queue | max_retries | integer | no (default 3) | C3 |
| amaia_sync_alert_remediation_queue | failure_reason | text | yes | C3 |
| amaia_sync_alert_remediation_queue | ignored_by | text | yes | C3 |
| amaia_sync_alert_remediation_queue | ignored_at | timestamptz | yes | C3 |
| amaia_sync_alert_remediation_queue | ignore_reason | text | yes | C3 |
| amaia_sync_alert_remediation_queue | ignore_evidence | jsonb | yes | C3 |

Note: `amaia_sync_alert_remediation_queue` was proposed in v1.2.5 C2 (not yet deployed). These columns are added to its design, not to a deployed table.

### Modified CHECK constraints

| Table | Constraint | Change | Source |
|---|---|---|---|
| amaia_sync_run_manifests | phase | Replace ('source_fetched', 'destination_verified', 'comparison_complete', 'abandoned') with ('source_fetched', 'confirmed_compared', 'provisional_persisted', 'comparison_complete', 'abandoned') | C2 |
| amaia_sync_alert_remediation_queue | status | Replace ('pending', 'processing', 'success', 'failed', 'ignored') with ('pending', 'claimed', 'success', 'failed_retryable', 'failed_terminal', 'ignored_approved') | C3 |

### New triggers

| Table | Trigger | Source |
|---|---|---|
| amaia_sync_alert_remediation_queue | state_machine_guard | C3 |
| amaia_sync_manifest_exclusions | status_transition_guard | C4 |
| amaia_sync_run_manifests | phase_column_guard (updated) | C2 (replaces v1.2.5 M1 trigger) |

### Cumulative DDL inventory (v1.2 through v1.2.6)

**New tables: 8**
1. amaia_sync_cycles (v1.2)
2. amaia_sync_run_manifests (v1.2.3)
3. amaia_sync_workset_exceptions (v1.2.3)
4. amaia_sync_workset_exception_decisions (v1.2.3)
5. amaia_sync_workset_exception_consumptions (v1.2.3)
6. amaia_sync_reconciliation_segments (v1.2.3)
7. amaia_sync_alert_remediation_queue (v1.2.5, expanded in v1.2.6)
8. amaia_sync_manifest_exclusions (v1.2.6)

**New columns on pre-existing deployed tables: 7**
- amaia_sync_runs: cycle_id (NOT NULL), upstream_run_id, blocked_entity_name
- amaia_sync_reconciliation_results: cycle_id (NOT NULL), scope_descriptor (NOT NULL), result_status

**Modified CHECK constraints on pre-existing deployed tables: 4**
- amaia_sync_runs.reason_code + 'WORKSET_INTEGRITY_FAILURE'
- amaia_beneficiaries/support_network/alerts.sync_status + 'reactivation_pending'

**Triggers: 6**
- 3 append-only triggers on exception ledger tables (v1.2.4)
- 1 manifest phase/column guard (v1.2.6 C2, replaces v1.2.4/v1.2.5 versions)
- 1 remediation state machine guard (v1.2.6 C3)
- 1 exclusion status guard (v1.2.6 C4)

**Data corrections:** 1 watermark row update + 12 segment seed rows

---

## C1–C4 Hallazgo → Resolución v1.2.6

| # | Hallazgo Codex | Resolución | DDL delta | Cerrado? |
|---|---|---|---|---|
| C1 | Manifest compares full S against filtered P — asymmetric, breaks on normal overlap | Option A: no filtering. Both S and P computed over identical range (lower_bound, upper_bound]. Overlap IDs appear in both sets. Only genuine discrepancies produce extra_ids. persisted_id_hash_filtered removed. | -1 column | **Yes** |
| C2 | Provisional evidence cannot be written after comparison_complete terminal phase | Expanded phase progression: source_fetched → confirmed_compared → provisional_persisted → comparison_complete. Per-phase column write permissions. Watermark advances at confirmed_compared if sets_match=true. Provisional failure does not roll back confirmed advance. | Phase CHECK updated, trigger rewritten | **Yes** |
| C3 | Remediation failed/ignored entries become invisible; no claim semantics | Full state machine: pending → claimed → success/failed_retryable/failed_terminal. Claim with TTL and retry budget. ignored_approved requires operator identity + reason. Trigger-enforced transitions. | +10 columns, status CHECK updated, +1 trigger, +2 indexes | **Yes** |
| C4 | Extra IDs in P block all retries with no auditable resolution | amaia_sync_manifest_exclusions ledger: operator-approved exclusions with evidence. Comparison uses P_effective = P - approved_exclusions. Excluded IDs enter tombstone lifecycle via reconciliation. | +1 table, +1 trigger | **Yes** |

---

## Invariants and Critical Transactions

### Manifest comparison (confirmed zone)

Within a single fenced transaction (ownership predicate verified):
1. Read S_effective = S - E, P_effective = P - E (where E = approved exclusions for this domain).
2. Compute hashes.
3. If sets_match = true: advance watermark to confirmed_upper_bound.
4. Update manifest to `confirmed_compared` with all evidence.
5. COMMIT.

### Manifest provisional processing

After confirmed_compared (separate transaction, but within same run):
1. Fetch provisional zone from AMAIA.
2. Upsert to amaia_alert_logs.
3. Enqueue remediation entries.
4. Update manifest to `provisional_persisted`.
5. COMMIT.

If this transaction fails: confirmed watermark already advanced (committed). Provisional data retried next cycle.

### Remediation claim + processing

Within a single fenced transaction (ownership predicate on alerta lease verified):
1. Claim entries (atomic UPDATE).
2. Fetch alerts from AMAIA.
3. Upsert to amaia_alerts.
4. Update entries to 'success' with consumed_by_run_id and processed_at.
5. COMMIT.

If transaction fails: claim expires after TTL. Entry becomes claimable again.

---

**End of document.**
