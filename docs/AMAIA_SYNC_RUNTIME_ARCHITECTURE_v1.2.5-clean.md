# AMAIA-SYNC Runtime Architecture v1.2.5-clean

**Phase:** 9.3 Rev.8  
**Status:** Design — ready for Codex audit  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.5.md (language corrections only, no architectural changes)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Date:** 2026-06-18

---

## Scope

All content from v1.2.4 is incorporated by reference unless explicitly superseded. This revision corrects 3 critical findings (C1–C3) and 5 medium findings (M1–M5) from Codex's rejection of v1.2.4.

**New DDL:** 1 new table (amaia_sync_alert_remediation_queue), 4 new columns on amaia_sync_run_manifests, 3 columns replace 1 on amaia_sync_reconciliation_segments.

---

## C1 — Safety Lag Anti-Starvation with Temporal Promotion and Provisional Processing

### Problem

v1.2.4's `safe_upper_bound = raw_max_id - id_safety_lag` never advances if raw_max_id stops growing. The last id_safety_lag rows remain unprocessable indefinitely.

### Dual-criteria confirmed upper bound

The confirmed upper bound uses two independent safety signals. The higher one wins.

**Signal 1 — ID-based lag (unchanged from v1.2.4):**

```
safe_by_id = max(raw_max_id - id_safety_lag, 0)
```

Effective when AMAIA is active (new IDs arriving). The lag zone shrinks naturally as raw_max_id grows.

**Signal 2 — Temporal stability:**

If raw_max_id has been unchanged across consecutive cycles for at least safety_lag_time (configurable, default 5 minutes), all IDs up to raw_max_id become eligible for confirmed processing under the safety-lag policy. The reasoning: if no new IDs are being assigned, the probability of concurrent transactions holding invisible IDs in the gap zone diminishes below the safety-lag threshold. This does not constitute proof of absence of uncommitted transactions — it is a temporal heuristic calibrated to expected AMAIA transaction duration.

```
safe_by_time = raw_max_id   (if raw_max_id stable for >= safety_lag_time)
safe_by_time = safe_by_id   (otherwise)
```

Stability is determined by querying the manifest history: the earliest successful manifest where raw_max_id equals the current value. If `now() - that_manifest.created_at >= safety_lag_time`, temporal promotion applies.

**Combined:**

```
confirmed_upper_bound = max(safe_by_id, safe_by_time)
```

When AMAIA is active: safe_by_time = safe_by_id (no promotion), confirmed_upper_bound = safe_by_id. Normal lag behavior.

When AMAIA is inactive for >= safety_lag_time: safe_by_time = raw_max_id, confirmed_upper_bound = raw_max_id. The entire range becomes eligible for confirmed processing. The tail is processed. Deterministic starvation is eliminated while the engine is running.

### Provisional processing of the lag zone

When confirmed_upper_bound < raw_max_id, the zone (confirmed_upper_bound, raw_max_id] contains IDs that are probably committed but not yet eligible for confirmed processing under the safety-lag policy. These are processed provisionally.

**Provisional processing contract:**

1. After the confirmed run completes (within [lower_bound, confirmed_upper_bound]), the processor fetches rows from AMAIA for the zone (confirmed_upper_bound, raw_max_id].
2. These rows are upserted to amaia_alert_logs idempotently. The confirmed logestado watermark does NOT advance past confirmed_upper_bound.
3. For each provisional row with a non-null alert_amaia_id: an entry is inserted into amaia_sync_alert_remediation_queue with source_type = 'provisional_logestado'. Both the upsert and the enqueue happen in the same transaction.
4. The manifest records the provisional zone: provisional_upper_bound = raw_max_id, provisional_id_count, provisional_id_hash.
5. The alerta processor picks up remediation entries on its next run, processes the referenced alerts eagerly.

**Provisional→Confirmed promotion:**

In a subsequent cycle, when confirmed_upper_bound advances past previously-provisional IDs (either by new-ID growth or temporal promotion), those IDs enter the confirmed range. They are re-fetched as part of the confirmed run, validated by the manifest, and the watermark advances past them. The earlier provisional upsert is overwritten idempotently.

**Latency reduction:**

Without provisional processing, alert changes in the lag zone are delayed until the lag zone is promoted (up to safety_lag_time). With provisional processing + remediation queue, the alert change is detected within the provisional cycle (immediately after the confirmed cycle) — typically seconds of additional latency rather than minutes.

### Configuration

| Parameter | Default | Description |
|---|---|---|
| id_safety_lag | 100 | IDs subtracted from raw_max_id for safe_by_id |
| id_overlap | 100 | IDs re-read below watermark for HWM gap mitigation |
| safety_lag_time | 5 minutes | Duration of raw_max_id stability required for temporal promotion |

### Manifest columns for provisional zone

New columns on amaia_sync_run_manifests:

| Column | Type | Nullable |
|---|---|---|
| provisional_upper_bound | bigint | yes |
| provisional_id_count | integer | yes |
| provisional_id_hash | text | yes |

These are NULL when no provisional processing occurred (e.g., confirmed_upper_bound == raw_max_id after temporal promotion).

### What this closes

- **Deterministic starvation:** Temporal promotion eliminates the case where the tail remains unprocessable indefinitely due to raw_max_id stagnation, provided the engine is running and AMAIA is reachable. This is not a proof that all IDs in the promoted range are free of uncommitted transactions — it is a policy decision that the temporal stability threshold is sufficient for the expected AMAIA transaction profile.
- **Latency:** Provisional processing + remediation queue delivers alert changes from the lag zone within one cycle, not after safety_lag_time.
- **Correctness:** The confirmed watermark only advances over IDs that have passed the safety-lag eligibility criteria (either ID-based lag or temporal stability). Provisional IDs are validated when they enter the confirmed range.

### What remains SLO

AMAIA↔fetch completeness remains an SLO. The safety lag + overlap + temporal promotion make it extremely unlikely for a committed row to be missed, but a pathological long-running transaction could still create a gap. Reconciliation is the ultimate safety net.

### Schema impact

3 new columns on amaia_sync_run_manifests (provisional_upper_bound, provisional_id_count, provisional_id_hash).

---

## C2 — Alert Remediation Queue with Durable Causal Chain

### Problem

When reconciliation backfills a missed logestado row (one below the confirmed watermark), the alerta trigger cursor has already passed it. The alerta processor never sees it. The alert state change referenced by that logestado entry is silently lost.

v1.2.4 mentions "targeted backfill" but provides no durable mechanism to ensure the alerted alert is actually refetched.

### Solution: amaia_sync_alert_remediation_queue

A new table that records durable obligations for the alerta processor. Every event that introduces logestado data outside the normal trigger cursor flow MUST enqueue a remediation entry.

### Table design

**amaia_sync_alert_remediation_queue**

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| id | uuid | no | PK, default gen_random_uuid() |
| source_type | text | no | CHECK ('logestado_backfill', 'provisional_logestado', 'exception_resolution', 'reconciliation_drift', 'manual') |
| logestado_amaia_id | integer | yes | The logestado row that triggered this remediation (null for manual entries) |
| alert_amaia_id | integer | no | The alert that must be refetched from AMAIA |
| origin_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL |
| origin_reconciliation_result_id | uuid | yes | FK → amaia_sync_reconciliation_results(id) ON DELETE SET NULL |
| status | text | no | CHECK ('pending', 'processing', 'success', 'failed', 'ignored'), default 'pending' |
| consumed_by_run_id | uuid | yes | FK → amaia_sync_runs(id) ON DELETE SET NULL |
| evidence | jsonb | yes | Contextual data: why this remediation was needed, what was found |
| created_at | timestamptz | no | default now() |
| processed_at | timestamptz | yes | |

Unique: (source_type, logestado_amaia_id, alert_amaia_id) WHERE logestado_amaia_id IS NOT NULL. Prevents duplicate remediation for the same source event. Manual entries (logestado_amaia_id IS NULL) can have duplicates for the same alert.

Indexes: (status) WHERE status = 'pending', (alert_amaia_id), (origin_run_id), (consumed_by_run_id).

### Enqueue rules

| Source event | Enqueue trigger | Same transaction as |
|---|---|---|
| Reconciliation backfills a missed logestado row | Insert remediation entry for the alert referenced by the backfilled row | The logestado backfill upsert |
| Provisional logestado processing (C1) | Insert remediation entry for each provisional row's alert | The provisional upsert |
| Operator resolves a workset exception | Insert remediation entry for the alert | The exception resolution update (if applicable) |
| Reconciliation detects alert field drift | Insert remediation entry for the drifted alert | The reconciliation_results insert |
| Manual operator action | Insert remediation entry directly | N/A |

### Alerta processor integration

The alerta processor, on each run, processes TWO sources of work:

**Source 1 — Normal trigger cursor workset:** amaia_alert_logs rows in (N, M] as defined in v1.1 through v1.2.4. Unchanged.

**Source 2 — Remediation queue:** SELECT alert_amaia_id FROM amaia_sync_alert_remediation_queue WHERE status = 'pending'. These are additional alerts that must be refetched.

The alerta processor:
1. Reads both sources.
2. Merges them into a single deduplicated fetch list (UNION of alert_amaia_ids).
3. Fetches all alerts from AMAIA by primary key.
4. Upserts to amaia_alerts.
5. Updates remediation entries: status = 'success', consumed_by_run_id = this run's id, processed_at = now().
6. Advances trigger cursor over the confirmed range (Source 1 only). The remediation queue does not affect the cursor.

If the run fails: remediation entries revert to 'pending' (transaction rollback). They are re-attempted on the next cycle.

### Lease requirements for remediation

When the alerta processor has pending remediation entries, it acquires BOTH the logestado and alerta leases in canonical order (logestado: position 6, alerta: position 7). The logestado lease prevents concurrent logestado sync from modifying amaia_alert_logs rows that the alerta processor is reading for remediation context.

When no remediation entries are pending, the alerta processor acquires only the alerta lease (normal mode).

### Causal chain evidence

For a backfill-driven remediation, the full chain is:

```
reconciliation_result (detected missing logestado)
  → reconciliation_result_id recorded on remediation entry
logestado backfill upsert (row inserted to amaia_alert_logs)
  → logestado_amaia_id recorded on remediation entry
remediation_queue entry
  → alert_amaia_id, source_type = 'logestado_backfill'
alerta remediation run
  → consumed_by_run_id on remediation entry
alert upsert to amaia_alerts
  → records_updated on alerta sync_run
```

Every link is a durable FK or recorded value. An auditor can trace from reconciliation detection to final alert update.

### Schema impact

1 new table. No modifications to existing tables.

---

## C3 — Injective Hash Algorithm (v2)

### Problem

v1.2.4's `logestado_exception_v1` uses pipe-delimited concatenation with `__NULL__` sentinel. This is not injective: a field value containing `|` or `__NULL__` produces the same hash as a structurally different row.

Example collision: row with action = "foo|__NULL__" followed by NULL raw_action produces the same concatenation as action = "foo" followed by raw_action = "__NULL__".

### Correction: Canonical JSON serialization

Replace `logestado_exception_v1` with `logestado_exception_v2`. The new algorithm uses canonical JSON with explicit types, eliminating structural ambiguity.

### Algorithm: logestado_exception_v2

**Step 1 — Construct JSON object.**

The canonical form is a JSON object with exactly two keys at the top level:

```json
{"fields":[...],"schema":"logestado_exception_v2"}
```

The `fields` array contains one entry per column, in the fixed order below. Each entry is a JSON object with exactly three keys: `name`, `type`, `value`.

**Columns (fixed order):**

| Position | name | type | Source column |
|---|---|---|---|
| 0 | amaia_id | integer | amaia_alert_logs.amaia_id |
| 1 | alert_amaia_id | integer | amaia_alert_logs.alert_amaia_id |
| 2 | user_id_amaia | integer | amaia_alert_logs.user_id_amaia |
| 3 | action | text | amaia_alert_logs.action |
| 4 | action_date | timestamptz | amaia_alert_logs.action_date |
| 5 | raw_action | text | amaia_alert_logs.raw_action |
| 6 | action_type | text | amaia_alert_logs.action_type |
| 7 | actor_name | text | amaia_alert_logs.actor_name |

**Value encoding:**

- NULL → JSON `null` (not the string "null")
- Integer → JSON number (e.g., `123`, `-1`, `0`)
- Text → JSON string (e.g., `"foo|bar"` — pipes, quotes, and backslashes are escaped by JSON encoding)
- Timestamptz → JSON string in ISO-8601 UTC with microsecond precision: `"2026-06-18T14:30:00.000000Z"`

**Step 2 — Serialize to canonical JSON.**

Rules for canonical form:
- No whitespace between tokens.
- Object keys sorted lexicographically (ASCII order): `"fields"` before `"schema"`; within each field object: `"name"` before `"type"` before `"value"`.
- No trailing commas.
- Unicode characters: use literal UTF-8, not \uXXXX escapes (except for control characters).

Example:

```json
{"fields":[{"name":"amaia_id","type":"integer","value":500},{"name":"alert_amaia_id","type":"integer","value":99999},{"name":"user_id_amaia","type":"integer","value":null},{"name":"action","type":"text","value":"texto|con|pipes"},{"name":"action_date","type":"timestamptz","value":"2026-06-18T14:30:00.000000Z"},{"name":"raw_action","type":"text","value":null},{"name":"action_type","type":"text","value":"unknown"},{"name":"actor_name","type":"text","value":null}],"schema":"logestado_exception_v2"}
```

**Step 3 — Hash.**

SHA-256 of the UTF-8 byte representation of the canonical JSON string. Output: lowercase hex (64 characters).

### Injectivity proof

Two distinct rows produce the same canonical JSON if and only if every field has the same name, type, and value. Since:
- JSON distinguishes `null` from `"null"` from `"__NULL__"` (type system)
- JSON strings escape special characters (pipes, quotes, backslashes)
- Field order is fixed (not sorted by value)
- Types are explicitly labeled (an integer 123 ≠ a string "123")

No two structurally different rows produce the same canonical JSON. The serialization is injective.

### Migration from v1 to v2

All new exceptions are created with hash_version = 'logestado_exception_v2'. Existing v1 exceptions (if any — currently 0 rows) remain valid with their v1 hash. The UNIQUE constraint includes hash_version, so v1 and v2 hashes for the same row coexist without collision.

An approval for a v1 exception does NOT apply when the engine uses v2 hashing. If the engine upgrades to v2, all pending exceptions must be re-investigated with v2 hashes.

### Schema impact

None beyond v1.2.4 (hash_version column already exists).

---

## M1 — Manifest Column Immutability by Category

### Problem

v1.2.4's phase-transition trigger prevents backward transitions but doesn't prevent modifying source evidence columns (source_id_hash, source_id_count) during a phase transition.

### Correction

Manifest columns are classified into two categories:

**Immutable from INSERT (never modifiable after creation):**
- run_id
- domain_name
- source_id_count
- source_id_hash
- raw_max_id
- created_at

**Completable during phase transition (writable only when advancing phase):**
- persisted_id_count
- persisted_id_hash
- sets_match
- missing_ids
- extra_ids
- verified_at
- phase
- provisional_upper_bound
- provisional_id_count
- provisional_id_hash

**Terminal phases (no further writes):**
- 'comparison_complete': all columns frozen
- 'abandoned': all columns frozen

The phase-transition trigger (v1.2.4 F3) is extended: on UPDATE, if any immutable-from-INSERT column differs from its current value, the trigger raises an exception. This prevents source evidence tampering during phase advancement.

### Schema impact

Trigger logic extended. No new columns or tables.

---

## M2 — Extra IDs Resolution Path

### Problem

If the manifest comparison finds extra IDs in the persisted set (P \ S non-empty), v1.2.4 fails the run but defines no resolution path for the extra rows.

### Resolution taxonomy

| Cause | Detection | Resolution |
|---|---|---|
| **Overlap artifact** | extra_id is within [lower_bound, watermark_before] (the overlap re-read zone) | Not a true discrepancy. See filtering below. |
| **Retroactive AMAIA delete** | extra_id was in AMAIA during a previous run but is now absent | Enters tombstone lifecycle (detected → confirmed → etc.) |
| **Destination contamination** | extra_id was never in AMAIA (never appeared in any manifest source hash) | Operator investigation. Manual deletion or tombstone marking. |

### Overlap artifact filtering

Before computing sets_match, the processor filters the persisted set P: remove any amaia_id that is <= watermark_before (i.e., below the previous watermark, in the overlap zone). These IDs are expected to be in P (persisted by a previous run) but may not be in S (not returned by AMAIA if they fall outside the current fetch window due to overlap mechanics).

Filtered comparison: sets_match = (source_id_hash == hash(P_filtered)) where P_filtered = P minus overlap artifacts.

The manifest records both: persisted_id_hash (full P) and persisted_id_hash_filtered (P minus overlap). The sets_match column reflects the filtered comparison.

### Non-overlap extra IDs

If extra IDs remain after filtering (genuine P \ S discrepancy):
1. Run fails. sets_match = false.
2. extra_ids records the specific amaia_ids.
3. The discrepancy is classified by checking: does the extra_id exist in AMAIA? (primary key lookup)
   - If yes: the AMAIA row exists but wasn't in the fetch range. This suggests a range miscalculation. Logged as anomaly.
   - If no: the AMAIA row was deleted. Enters tombstone lifecycle via reconciliation.
4. The discrepancy does NOT block other domains. Only the logestado watermark is held.

### Convergence

Extra IDs that are retroactive deletes will be detected by weekly reconciliation's id-set comparison and enter the tombstone lifecycle (detected → confirmed → inactive_confirmed). The sync engine does not delete rows from destination — that is exclusively the tombstone process's responsibility.

### Schema impact

1 new column on amaia_sync_run_manifests: `persisted_id_hash_filtered text` (nullable). Populated only when overlap filtering was applied.

---

## M3 — Tier 4 Scheduler-Simulation Alignment

### Problem

v1.2.4's feasibility simulation uses EDF (Earliest Deadline First) ordering, but the segment selection algorithm uses a different ordering (consecutive_failure_count DESC, slo_deadline_at ASC). If simulation and scheduler disagree on ordering, the simulation may declare "feasible" for a schedule the scheduler never executes.

### Correction

Both the feasibility simulation and the actual segment selection use the same priority:

**Unified priority order:**

1. **Primary:** slo_deadline_at ASC NULLS FIRST (earliest deadline first — EDF).
2. **Secondary:** consecutive_failure_count DESC (starving segments break ties).
3. **Tertiary:** segment_id ASC (deterministic tiebreaker).

The feasibility simulation (v1.2.4 F5) already uses deadline order. The segment selection algorithm is aligned to match.

**Starvation handling within EDF:**

A starving segment (consecutive_failure_count >= 5) has its slo_deadline_at in the past (it's breached). EDF naturally prioritizes it because past deadlines sort before future deadlines. If multiple segments are breached, they compete by consecutive_failure_count (secondary sort), ensuring the most persistently failing segment gets priority.

This means starvation is not a separate priority — it's captured by the interaction of past-deadline + high failure count within EDF. No special-case logic.

### Schema impact

None. Behavioral alignment only.

---

## M4 — Multi-Valued Segment Status

### Problem

v1.2.4 stores a single `status` value per segment, but a segment can simultaneously be breached, starving, and irrecoverable. A single value forces ambiguous choices.

### Correction

Replace the single `status` column on amaia_sync_reconciliation_segments with three orthogonal fields:

| Column | Type | Nullable | Description |
|---|---|---|---|
| slo_status | text | no | CHECK ('compliant', 'at_risk', 'breached'). Derived from slo_deadline_at vs now(). |
| is_irrecoverable | boolean | no | default false. Set by the feasibility simulation. |
| is_starving | boolean | no | default false. True when consecutive_failure_count >= 5. |

A segment can be:
- breached + starving + irrecoverable (worst case)
- at_risk + not starving + not irrecoverable (normal degradation)
- compliant + not starving + not irrecoverable (healthy)

Each field is updated independently:
- slo_status: recomputed from slo_deadline_at on each evaluation.
- is_irrecoverable: set by feasibility simulation; cleared when a successful coverage brings the segment back within SLO.
- is_starving: set when consecutive_failure_count reaches threshold; cleared on success (count resets to 0).

### Schema impact

On amaia_sync_reconciliation_segments: remove the proposed `status text` column (from v1.2.3). Replace with `slo_status text NOT NULL`, `is_irrecoverable boolean NOT NULL DEFAULT false`, `is_starving boolean NOT NULL DEFAULT false`. Net change: 3 columns replace 1.

---

## M5 — Manifest Bounds Explicit Mapping

### Problem

v1.2.4 doesn't explicitly document where lower_bound, safe_upper_bound, and raw_max_id live, creating ambiguity about whether the manifest is self-contained.

### Mapping

| Bound | Stored in | Column | Reason |
|---|---|---|---|
| lower_bound | amaia_sync_runs | lower_bound (text) | Run-level parameter, shared with all domain processors. Already exists in deployed schema (9.2 migration 013). |
| confirmed_upper_bound | amaia_sync_runs | upper_bound (text) | Run-level parameter. This IS the safe upper bound — the value the engine actually used. Already exists. |
| raw_max_id | amaia_sync_run_manifests | raw_max_id (bigint) | Manifest-specific: the observed MAX(id) before safety lag. Only meaningful in context of the manifest comparison. Added in v1.2.4. |
| provisional_upper_bound | amaia_sync_run_manifests | provisional_upper_bound (bigint) | Manifest-specific: the upper limit of provisional processing. Added in v1.2.5 C1. |
| id_safety_lag | Configurable parameter | N/A | Not stored per-run. Verifiable: confirmed_upper_bound = raw_max_id - id_safety_lag (or raw_max_id if temporal promotion). |

**The manifest is NOT self-contained for bounds.** It references bounds via its FK to amaia_sync_runs (manifest.run_id → sync_runs.id → sync_runs.lower_bound, sync_runs.upper_bound).

**Audit verification:** Given a manifest M and its associated sync_run R:
- R.lower_bound + R.upper_bound define the confirmed range.
- M.raw_max_id is the observed max before lag.
- R.upper_bound should equal max(M.raw_max_id - id_safety_lag, temporal_promotion_value).
- M.provisional_upper_bound (if not null) should equal M.raw_max_id.
- M.source_id_hash covers IDs in (R.lower_bound, R.upper_bound].
- M.persisted_id_hash covers the same range in amaia_alert_logs.

---

## Convergence Paths

### How the safety lag tail converges

```
Cycle N:  raw_max_id=500, lag=100 → confirmed_upper_bound=400
          Provisional zone: (400, 500]. Rows persisted. Remediation enqueued.
Cycle N+1: raw_max_id=500 (unchanged). Stability < 5min.
          confirmed_upper_bound=400. Same tail.
          Provisional zone: same. Rows re-upserted (idempotent).
Cycle N+2: raw_max_id=500 (unchanged). Stability >= 5min.
          TEMPORAL PROMOTION: confirmed_upper_bound=500.
          Tail enters confirmed range. Manifest validates.
          Watermark advances to 500. Provisional zone: empty.
```

No deterministic starvation while the engine is running. Maximum tail delay: safety_lag_time (5 minutes), subject to engine availability and bounded AMAIA transaction duration.

### How logestado backfill converges to alerta

```
Reconciliation detects: logestado amaia_id=145 missing from amaia_alert_logs.
  → Fetches row 145 from AMAIA. Upserts to amaia_alert_logs.
  → Inserts remediation_queue: alert_amaia_id=72, source_type='logestado_backfill'.
  (Same transaction. Both committed.)

Next alerta cycle:
  → Reads remediation_queue: alert 72 pending.
  → Acquires logestado + alerta leases (canonical order).
  → Fetches alert 72 from AMAIA.
  → Upserts to amaia_alerts.
  → Updates remediation entry: status='success', consumed_by_run_id.
```

No alert left behind. Full causal chain recorded.

### How manifest mismatch converges

```
Manifest sets_match=false. missing_ids=[103]. extra_ids=[].
  → Run fails. Watermark stays.
  → Retry: re-fetches same range. If row 103 is now visible (was uncommitted),
    it appears in both S and P. sets_match=true. Watermark advances.
  → If row 103 is still invisible: retry fails again.
    After max retries: run marked 'failed'. Reconciliation detects on next cycle.
```

### How provisional logestado converges to alerta

```
Provisional processing: logestado row 498 persisted with alert_amaia_id=85.
  → Remediation enqueued: alert 85, source_type='provisional_logestado'.

Next alerta cycle:
  → Reads remediation: alert 85 pending.
  → Fetches alert 85 from AMAIA. Upserts.
  → Remediation: status='success'.

Later cycle: row 498 enters confirmed range via temporal promotion.
  → Re-fetched in confirmed run. Re-upserted (idempotent).
  → Manifest validates. Watermark advances past 498.
  → Alerta processes row 498 again via trigger cursor (alert 85 re-upserted, idempotent).
```

Alert change visible within one cycle of provisional processing. Confirmed validation follows.

---

## Schema Gap Analysis — Delta from v1.2.4

### New table

| Table | Source | Purpose |
|---|---|---|
| amaia_sync_alert_remediation_queue | C2 | Durable obligation queue for alerta remediations triggered by backfill, provisional processing, or drift |

### New columns on existing tables

| Table | Column | Type | Nullable | Source |
|---|---|---|---|---|
| amaia_sync_run_manifests | provisional_upper_bound | bigint | yes | C1 |
| amaia_sync_run_manifests | provisional_id_count | integer | yes | C1 |
| amaia_sync_run_manifests | provisional_id_hash | text | yes | C1 |
| amaia_sync_run_manifests | persisted_id_hash_filtered | text | yes | M2 |

### Modified columns on proposed tables

| Table | Column | v1.2.4 | v1.2.5 | Source |
|---|---|---|---|---|
| amaia_sync_reconciliation_segments | status | text, single-valued | REMOVED | M4 |
| amaia_sync_reconciliation_segments | slo_status | (new) | text NOT NULL CHECK ('compliant', 'at_risk', 'breached') | M4 |
| amaia_sync_reconciliation_segments | is_irrecoverable | (new) | boolean NOT NULL DEFAULT false | M4 |
| amaia_sync_reconciliation_segments | is_starving | (new) | boolean NOT NULL DEFAULT false | M4 |

### Cumulative DDL inventory (v1.2 through v1.2.5)

**New tables: 7**
1. amaia_sync_cycles (v1.2)
2. amaia_sync_run_manifests (v1.2.3)
3. amaia_sync_workset_exceptions (v1.2.3)
4. amaia_sync_workset_exception_decisions (v1.2.3)
5. amaia_sync_workset_exception_consumptions (v1.2.3)
6. amaia_sync_reconciliation_segments (v1.2.3)
7. amaia_sync_alert_remediation_queue (v1.2.5)

**New columns on pre-existing tables (amaia_sync_runs, amaia_sync_reconciliation_results): 7**
- amaia_sync_runs: cycle_id (NOT NULL), upstream_run_id, blocked_entity_name
- amaia_sync_reconciliation_results: cycle_id (NOT NULL), scope_descriptor (NOT NULL), result_status

**Columns on new tables defined across revisions:** includes raw_max_id, decision_seq, hash_version, reconciliation_snapshot, provisional columns, persisted_id_hash_filtered, slo_status/is_irrecoverable/is_starving (all on v1.2.3–v1.2.5 new tables)

**Modified CHECK constraints on pre-existing tables: 4**
- amaia_sync_runs.reason_code + 'WORKSET_INTEGRITY_FAILURE'
- amaia_beneficiaries/support_network/alerts.sync_status + 'reactivation_pending'

**Triggers: 4** (append-only on 3 ledger tables, phase-transition guard on manifests with column immutability enforcement)

**Data corrections:** 1 watermark row update + 12 segment seed rows

---

## C1–C3 + M1–M5 Hallazgo → Resolución v1.2.5

| # | Hallazgo | Severidad | Resolución | DDL delta | Cerrado? |
|---|---|---|---|---|---|
| C1 | Safety lag starvation: tail never processed if raw_max_id stops growing | CRITICAL | Dual-criteria upper bound: max(safe_by_id, safe_by_time). Temporal promotion after safety_lag_time of raw_max_id stability. Provisional processing of lag zone with remediation enqueue. | +3 manifest columns | **Yes** |
| C2 | Backfill logestado doesn't trigger alerta remediation | CRITICAL | amaia_sync_alert_remediation_queue: durable obligation with causal chain. Enqueue atomic with backfill/provisional upsert. Alerta processes pending remediations with dual-lease. | +1 table | **Yes** |
| C3 | Hash algorithm not injective (pipe + __NULL__ collision) | CRITICAL | logestado_exception_v2: canonical JSON with explicit types. null is JSON null. Strings are JSON-escaped. Keys sorted. Injectivity provable from JSON type system. | None (hash_version column exists) | **Yes** |
| M1 | Manifest source evidence modifiable during phase transition | MEDIA | Column classification: immutable-from-INSERT vs completable. Trigger rejects changes to immutable columns. | Trigger logic extended | **Yes** |
| M2 | Extra IDs (P\S) have no resolution path | MEDIA | Overlap artifact filtering + persisted_id_hash_filtered. Non-overlap extras enter tombstone lifecycle or operator investigation. No silent deletion. | +1 manifest column | **Yes** |
| M3 | Tier 4 simulation and scheduler use different ordering | MEDIA | Unified EDF ordering: slo_deadline_at ASC, consecutive_failure_count DESC, segment_id ASC. Both simulation and scheduler use the same. | None | **Yes** |
| M4 | Segment status is single-valued but conditions are orthogonal | MEDIA | Three independent fields: slo_status, is_irrecoverable, is_starving. Updated independently. All combinations valid. | 3 columns replace 1 | **Yes** |
| M5 | Manifest bounds location undocumented | MEDIA | Explicit mapping: lower_bound/upper_bound in sync_runs, raw_max_id/provisional in manifest. Audit verification formula documented. | None | **Yes** |

---

## Guarantees, SLOs, and Honest Limits (updated)

### Absolute guarantees

All v1.2.4 absolute guarantees are preserved. Additionally:

| Guarantee | Mechanism |
|---|---|
| No logestado backfill without alerta remediation obligation | Atomic enqueue in same transaction as backfill upsert |
| No provisional logestado without alerta remediation obligation | Atomic enqueue in same transaction as provisional upsert |
| Injective source row hash | Canonical JSON serialization with explicit types |
| Manifest source evidence immutable | Column-level trigger enforcement |

### Conditional SLOs

All v1.2.4 SLOs are preserved. Additionally:

| SLO | Condition | Mitigation if breached |
|---|---|---|
| No deterministic starvation of safety lag tail | Engine running, AMAIA reachable, AMAIA transaction duration bounded by safety_lag_time | Reconciliation/backfill detects and remediates missed rows |
| Safety lag tail processing within safety_lag_time | Engine completes at least one cycle within safety_lag_time; no AMAIA transaction outlasts the temporal stability window | If engine is down: tail delayed until restart. If AMAIA has pathological transactions: reconciliation is the recovery path |

Note: temporal promotion is a policy-based heuristic, not a proof of AMAIA transaction state. It eliminates deterministic starvation (the tail never grows forever) but does not guarantee that every ID promoted via temporal stability is free of uncommitted transactions. AMAIA↔fetch completeness remains an SLO across ALL mechanisms (safety lag, overlap, temporal promotion). fetch↔persist identity remains the sole absolute guarantee for source-destination correspondence.

### Cannot be guaranteed

All v1.2.4 "cannot be guaranteed" items remain. Additionally, restated for clarity:

| Limitation | Root cause |
|---|---|
| AMAIA↔fetch completeness under any mechanism (safety lag, overlap, temporal promotion) | Without CDC/binlog/commit-timestamp access, uncommitted AMAIA rows are invisible. All three mechanisms are probabilistic mitigations calibrated to expected transaction duration, not proofs of completeness. Reconciliation is the ultimate safety net. |

---

**End of document.**
