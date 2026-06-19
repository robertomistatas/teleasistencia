# AMAIA-SYNC Runtime Architecture v1.2.4

**Phase:** 9.3 Rev.7  
**Status:** Design — pending internal review before Codex submission  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.3.md (not submitted to Codex)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Internal review:** Autoauditoría adversarial sobre v1.2.3  
**Date:** 2026-06-18

---

## Scope

All content from v1.2.3 is incorporated by reference unless explicitly superseded. This revision corrects 1 critical finding (F1) and 9 medium findings (F2–F10) discovered during internal adversarial self-audit of v1.2.3. v1.2.3 was not submitted to Codex.

**Critical correction:** v1.2.3's zero-skip proves fetch↔persist identity but does not prove AMAIA↔fetch completeness. The InnoDB high-water-mark gap problem can silently lose a logestado row. This is corrected by introducing a mandatory safety lag and overlap for id-based append-only domains.

---

## F1 — Source-Boundary Safety Lag (CRITICAL)

### What v1.2.3 got wrong

v1.2.3 Blocker 1 proves that the set of IDs fetched from AMAIA equals the set of IDs persisted to Supabase (fetch↔persist). It does NOT prove that the set fetched from AMAIA equals all committed rows in AMAIA (AMAIA↔fetch).

The gap: InnoDB auto-increment assigns IDs before transaction commit. With concurrent transactions:

```
T=0  TxA: INSERT → assigned id=145, not yet committed
T=1  TxB: INSERT → assigned id=146, COMMIT
T=2  Sync: SELECT MAX(id) → 146. Fetch WHERE id > watermark AND id <= 146.
     Result includes 146 but NOT 145 (TxA uncommitted, invisible).
     sets_match = true (fetched == persisted, both miss 145).
     Watermark advances to 146.
T=5  TxA: COMMIT. id=145 now visible but below watermark.
     145 is never read. Lost permanently.
```

This breaks the entire logestado→alerta chain. A lost logestado row means an invisible alert state change.

### Two-layer mitigation

v1.2.3's Set-Identity Manifest is preserved (it guarantees fetch↔persist). On top of it, two additional mechanisms mitigate the AMAIA↔fetch boundary:

**Layer 1: ID safety lag on upper_bound.**

For id-based append-only domains (logestado, control_llamadas), the upper_bound is NOT MAX(id). It is:

```
safe_upper_bound = raw_max_id - id_safety_lag
```

where raw_max_id is the current MAX(id) observed from AMAIA, and id_safety_lag is a configurable parameter (default: 100 for logestado, 100 for control_llamadas).

This means the engine never processes the most recent id_safety_lag rows. Any InnoDB transaction that committed its row but where the row's id is within the safety lag window will become visible by the next run.

**Layer 2: ID overlap on lower_bound.**

For id-based append-only domains, overlap is no longer zero. It is:

```
lower_bound = max(watermark_before - id_overlap, 0)
```

where id_overlap is a configurable parameter (default: 100 for logestado, 100 for control_llamadas).

This means each run re-reads the last id_overlap rows from the previous run's range. Any row that was invisible during the previous run (due to uncommitted transaction) but has since committed will be picked up in this overlap window. The upsert is idempotent (ON CONFLICT amaia_id DO UPDATE), so re-reading already-persisted rows is harmless.

**Combined effect:**

The safety lag prevents advancing the watermark into the "danger zone" of recent IDs where uncommitted transactions may lurk. The overlap re-reads the boundary area from the previous run, catching any rows that committed after the previous run's fetch but within the overlap window.

A row is lost only if its transaction remains uncommitted for longer than BOTH: (a) the time it takes for id_safety_lag new IDs to be assigned, AND (b) the time it takes for id_overlap new IDs to be assigned after the next run starts. In practice, for a transaction to remain open through both windows, it would need to survive multiple sync cycles — which in AMAIA (a user-facing application where transactions are typically sub-second) is extremely unlikely.

### Updated v1.0 Appendix configuration (supersedes overlap=0 for id domains)

| Domain | Watermark type | id_safety_lag | id_overlap | v1.0 overlap |
|---|---|---|---|---|
| logestado | id | 100 | 100 | was 0 |
| control_llamadas | id | 100 | 100 | was 0 |
| beneficiario | timestamp | N/A | 15 min | unchanged |
| red | timestamp | N/A | 15 min | unchanged |
| alerta | derived (trigger cursor) | N/A | N/A | N/A |
| enfermedades | id | 50 | 50 | was 0 |
| medicamentos | id | 50 | 50 | was 0 |

### Impact on manifest

The Set-Identity Manifest (v1.2.3 Blocker 1) continues to operate on the safe window [lower_bound, safe_upper_bound]. It proves that everything fetched within this window was persisted. The safety lag and overlap extend the window's boundaries but do not change the manifest mechanism.

The manifest now records:
- lower_bound (includes overlap)
- safe_upper_bound (excludes safety lag zone)
- raw_max_id (the actual MAX(id) observed, for evidence)

A new column `raw_max_id bigint` is added to amaia_sync_run_manifests for auditability. An auditor can verify: safe_upper_bound = raw_max_id - id_safety_lag.

### Impact on latency

New logestado entries are not processed until they are at least id_safety_lag entries behind the frontier. At typical AMAIA volumes (hundreds to thousands of logestado entries per day), this introduces a delay of minutes to low hours. This is acceptable: the architecture trades real-time processing for correctness.

### What this guarantees (absolute)

**fetch↔persist identity:** The manifest hash proves the fetched set equals the persisted set. Unconditional.

### What this mitigates (SLO, not guarantee)

**AMAIA↔fetch completeness:** The safety lag + overlap makes it extremely unlikely that a committed AMAIA row falls outside the fetch window. The residual risk is bounded by:

- A single transaction remaining uncommitted for longer than (id_safety_lag / insertion_rate) time.
- That same row also not being caught by the overlap on the next run.

This residual risk is a conditional SLO, not an absolute guarantee. It is further mitigated by reconciliation (daily count for logestado, weekly id-set comparison).

### What CANNOT be guaranteed (honest declaration)

**Without CDC, commit timestamps, or source-side locking, the engine cannot know whether an ID exists but is invisible due to an uncommitted transaction.** The safety lag is a probabilistic mitigation calibrated to the expected maximum transaction duration in AMAIA. If AMAIA has pathological long-running transactions (e.g., a blocked lock held for hours), a row could still be missed. Reconciliation is the ultimate safety net for this residual risk.

### How reconciliation detects residual drift

The daily count comparison for logestado (Tier 1 equivalent) and the weekly id-set comparison will detect a missed row: the AMAIA source count or id set will include the missed ID, while the Supabase destination will not. The drift signal is visible in amaia_sync_reconciliation_results.drift. The missed ID appears in the id-set symmetric difference.

Upon detection, the engine can perform a targeted backfill: fetch the specific missing amaia_id from AMAIA by primary key and upsert it. This is a reconciliation-driven correction, not an incremental sync correction.

### Schema impact

New column on amaia_sync_run_manifests: `raw_max_id bigint` (nullable — populated only for id-based domains).

---

## F2 — Decision Ordering and Operator/Engine Serialization

### Problem

v1.2.3 determines "latest decision" by timestamp. Timestamps can tie. Concurrent operator decision insertion and engine consumption can race.

### Correction

**1. Monotonic decision sequence.**

New column on amaia_sync_workset_exception_decisions:

| Column | Type | Nullable | Constraint |
|---|---|---|---|
| decision_seq | integer | no | CHECK (decision_seq > 0) |

UNIQUE constraint: (exception_id, decision_seq). The latest decision for an exception is the one with MAX(decision_seq) for that exception_id. Not timestamp-based.

The inserting party (operator tool or engine) sets decision_seq to the next value. The UNIQUE constraint prevents duplicates. The append-only trigger (F3) prevents modification.

**2. Serialization via exception row lock.**

Both consumption and decision insertion acquire an exclusive row lock on the parent exception row before proceeding:

**Consumption path (engine):** Within the fenced transaction: SELECT ... FROM amaia_sync_workset_exceptions WHERE id = :exception_id FOR UPDATE → read latest decision by MAX(decision_seq) → verify approved → verify hash → insert consumption → advance cursor → COMMIT.

**Decision insertion path (operator):** The operator tool's transaction: SELECT ... FROM amaia_sync_workset_exceptions WHERE id = :exception_id FOR UPDATE → insert decision row → COMMIT.

Because both paths lock the same exception row, they are serialized. If the engine holds the lock, the operator's decision blocks until the engine commits. If the operator holds the lock, the engine's consumption blocks until the operator commits.

**Result:** After the engine acquires the lock and reads the latest decision, no new decision can be inserted until the engine's transaction completes. The "latest decision" is stable for the duration of the consumption transaction. The race identified in F2 is eliminated.

### Schema impact

New column: decision_seq integer NOT NULL on amaia_sync_workset_exception_decisions. New UNIQUE constraint: (exception_id, decision_seq).

---

## F3 — Append-Only Enforcement

### Problem

Tables declared "append-only" or "immutable" are not physically enforced. The sync engine's service role can UPDATE or DELETE.

### Correction

**Database-level enforcement via triggers.** The following tables receive BEFORE UPDATE OR DELETE triggers that raise an exception unconditionally, preventing any modification or deletion of existing rows:

| Table | Trigger behavior |
|---|---|
| amaia_sync_workset_exceptions | Reject all UPDATE and DELETE |
| amaia_sync_workset_exception_decisions | Reject all UPDATE and DELETE |
| amaia_sync_workset_exception_consumptions | Reject all UPDATE and DELETE |

**Manifest immutability with valid phase transitions.** amaia_sync_run_manifests requires UPDATE (to advance phase from 'source_fetched' to 'comparison_complete'). A BEFORE UPDATE trigger enforces:
- Only the following phase transitions are allowed: 'source_fetched' → 'destination_verified', 'source_fetched' → 'comparison_complete', 'destination_verified' → 'comparison_complete', any phase → 'abandoned' (F6).
- No backward transition (e.g., 'comparison_complete' → 'source_fetched') is permitted.
- Once phase = 'comparison_complete' or 'abandoned', no further UPDATE is allowed on any column.
- DELETE is always rejected.

**Compatibility with service role:** Triggers fire regardless of the caller's role (including service role and superuser in standard PostgreSQL). The only bypass is `ALTER TABLE DISABLE TRIGGER`, which requires DDL privilege and is logged. This is sufficient enforcement for V1.

### Schema impact

4 trigger functions + 4 triggers. No new tables or columns. Declared in migration DDL.

---

## F4 — Canonical Source Row Hash Algorithm

### Problem

v1.2.3 hashes only amaia_id, alert_amaia_id, and action_date. A row could change in other fields without invalidating the approval.

### Correction

The source_row_hash covers all non-engine-managed columns of the amaia_alert_logs row. The algorithm is deterministic, versioned, and documented.

### Canonical hash algorithm: `logestado_exception_v1`

**Columns included, in this exact order:**

1. amaia_id (integer, NOT NULL)
2. alert_amaia_id (integer, nullable)
3. user_id_amaia (integer, nullable)
4. action (text, nullable)
5. action_date (timestamptz, NOT NULL)
6. raw_action (text, nullable)
7. action_type (text, NOT NULL)
8. actor_name (text, nullable)

**Excluded columns:** id (engine-generated UUID), alert_id (engine-managed FK), synced_at, created_at (engine timestamps).

**Encoding rules:**

- NULL values: literal string `__NULL__`
- Integers: decimal string with no leading zeros (e.g., `12345`, `-1`)
- Timestamps: ISO-8601 UTC with microsecond precision (e.g., `2026-06-18T14:30:00.000000Z`)
- Text: UTF-8, preserved as-is (no trimming, no case normalization, no diacritic normalization — the hash must detect any change)

**Concatenation:** pipe-delimited, no escaping: `field1|field2|...|field8`

**Hash function:** SHA-256 of UTF-8 encoded concatenated string.

**Output:** lowercase hex string (64 characters).

**hash_version:** `logestado_exception_v1`

The hash_version is recorded alongside the hash in amaia_sync_workset_exceptions.source_row_hash. If the algorithm changes in the future (e.g., adding new columns), a new version (v2) produces different hashes that do not collide with v1. Old approvals (v1 hash) do not apply to rows hashed with v2 — re-investigation is required.

### New column on amaia_sync_workset_exceptions

| Column | Type | Nullable |
|---|---|---|
| hash_version | text | no |

### Schema impact

New column: hash_version text NOT NULL on amaia_sync_workset_exceptions. Added to the UNIQUE constraint: (domain_name, source_amaia_id, source_row_hash, hash_version).

---

## F5 — Computable SLO Feasibility

### Problem

v1.2.3's `irrecoverable` classification uses a formula (`overdue_segments > max_segments_per_cycle * remaining_weeks_before_all_deadlines`) that is mathematically ambiguous and not operationally computable.

### Correction: Per-deadline feasibility simulation

Replace the formula with an algorithm that answers: "Given current capacity C segments per cycle and one cycle per week, can every overdue/due segment be covered before its individual deadline?"

**Algorithm (evaluated at each reconciliation cycle start):**

1. Collect all segments where slo_deadline_at <= now() + 84 days (due within one SLO period) ordered by slo_deadline_at ASC.
2. current_week = 0. capacity_remaining = max_segments_per_cycle.
3. For each segment in deadline order:
   a. weeks_until_deadline = floor((slo_deadline_at - now()) / 7 days). If negative → already breached.
   b. If weeks_until_deadline < current_week → **irrecoverable**. This segment's deadline passes before a slot is available.
   c. If weeks_until_deadline >= current_week AND capacity_remaining > 0: assign this segment to current_week. capacity_remaining -= 1.
   d. If capacity_remaining == 0: current_week += 1. capacity_remaining = max_segments_per_cycle. Re-evaluate step b.
4. If all segments are assigned a slot before their deadline → **not irrecoverable** (compliant, at_risk, or breached depending on current state).

**SLO status (revised, supersedes v1.2.3):**

| Status | Condition | Deterministic? |
|---|---|---|
| **compliant** | All segments: slo_deadline_at > now() | Yes |
| **at_risk** | Any segment: slo_deadline_at <= now() + 14 days AND slo_deadline_at > now() | Yes |
| **breached** | Any segment: slo_deadline_at <= now() | Yes |
| **irrecoverable** | Per-deadline simulation (above) determines at least one segment cannot be covered before its deadline with current capacity | Yes |
| **starvation** | Any segment: consecutive_failure_count >= 5 | Yes |

All statuses are now mathematically deterministic and computable from the segment state table + max_segments_per_cycle.

### Capacity snapshot

A new nullable jsonb column on amaia_sync_cycles records reconciliation capacity per cycle:

| Column | Type | Nullable |
|---|---|---|
| reconciliation_snapshot | jsonb | yes |

Contents (populated by the Reconciliation Engine at cycle end):
```
{
  "max_segments_per_cycle": 3,
  "segments_selected": [2, 5, 9],
  "segments_attempted": [2, 5, 9],
  "segments_succeeded": [2, 9],
  "segments_failed": [5],
  "slo_status_before": "at_risk",
  "slo_status_after": "at_risk",
  "evaluated_at": "2026-06-18T14:30:00Z"
}
```

This enables post-hoc analysis of why the SLO was or wasn't met. An auditor can trace: "In cycle X, capacity was 3, but only 2 succeeded, and the SLO degraded from at_risk to breached."

### Schema impact

New column: reconciliation_snapshot jsonb (nullable) on amaia_sync_cycles.

---

## F6 — Manifest Abandoned Phase

### Problem

A manifest stuck at phase = 'source_fetched' indefinitely (process crash after manifest creation, before upsert) is indistinguishable from a manifest for an actively running process.

### Correction

Add 'abandoned' to the manifest phase CHECK constraint.

**Phase values (revised):** 'source_fetched', 'destination_verified', 'comparison_complete', 'abandoned'.

**Transition rules:** When orphan recovery detects a run with status = 'running' that is being recovered (changed to 'orphan_recovered'), the Scheduler checks for an associated manifest. If a manifest exists with phase != 'comparison_complete', it is updated to phase = 'abandoned'. The recovery run creates its own new manifest.

An auditor can distinguish:
- 'source_fetched': actively running (or about to be abandoned).
- 'abandoned': the owning run crashed; manifest reflects planned but unexecuted work.
- 'comparison_complete': the comparison was performed and the result is final.

### Schema impact

Extended CHECK on amaia_sync_run_manifests.phase: + 'abandoned'.

---

## F7 — Consumption Uniqueness

### Problem

Without a uniqueness constraint, the same approved exception could be consumed multiple times by different runs (e.g., after a manual cursor reset).

### Correction

Add UNIQUE constraint on amaia_sync_workset_exception_consumptions: (exception_id, consumed_by_run_id).

**Semantics:** One exception can be consumed at most once per run. If the cursor is manually reset and the same exception is encountered again in a future run, a new consumption row is created (different consumed_by_run_id). This is intentional — the new run independently verified the exception's validity (hash check, latest decision check) at its own point in time.

An exception CAN be consumed by multiple runs over time (manual reset scenario). It CANNOT be consumed twice by the same run.

### Schema impact

New UNIQUE constraint on amaia_sync_workset_exception_consumptions: (exception_id, consumed_by_run_id).

---

## F8 — records_processed Semantics for Alerta

### Problem

records_processed on alerta runs is ambiguous: could mean logestado rows consumed, alert_amaia_id values in workset, or alerts successfully upserted.

### Correction

**Explicit definition:**

For alerta domain runs:
- **records_processed** = number of distinct alert_amaia_id values in the derived workset (after excluding excepted source_amaia_ids). This is the planned work.
- **records_inserted** = number of alerts fetched from AMAIA and upserted for the first time.
- **records_updated** = number of alerts fetched from AMAIA and upserted over existing rows.
- records_inserted + records_updated should equal records_processed on success.

The number of logestado rows consumed (amaia_alert_logs rows in the trigger cursor range) is derivable from the alerta run's watermark_before_id and upper_bound: query amaia_alert_logs for COUNT WHERE amaia_id > N AND amaia_id <= M. This does not need a dedicated column — it is a function of the recorded bounds.

### Schema impact

None. Semantic clarification only. Uses existing columns.

---

## F9 — Segment State Update Atomicity

### Problem

The update to amaia_sync_reconciliation_segments (last_successful_coverage_at, consecutive_failure_count) and the insert into amaia_sync_reconciliation_results must be atomic. If they are separate transactions, the segment state could diverge from the reconciliation history.

### Correction

**Invariant:** The INSERT into amaia_sync_reconciliation_results and the UPDATE of amaia_sync_reconciliation_segments for the same domain/segment MUST execute within a single database transaction.

On success: both the result row (result_status = 'success') and the segment update (last_successful_coverage_at = now(), consecutive_failure_count = 0) commit together.

On failure: both the result row (result_status = 'failed') and the segment update (consecutive_failure_count += 1, last_attempt_at = now()) commit together.

If the transaction fails (e.g., database error during commit): neither is persisted. The segment state reflects the pre-attempt state. The next cycle will re-attempt.

### Schema impact

None. Behavioral contract only.

---

## F10 — Capacity Snapshot

Resolved by F5. The reconciliation_snapshot jsonb column on amaia_sync_cycles records all capacity information per cycle: max_segments_per_cycle, segments selected/attempted/succeeded/failed, SLO status before and after. See F5 for details.

---

## Schema Gap Analysis — Delta from v1.2.3

### New columns on existing tables

| Table | Column | Type | Nullable | Source |
|---|---|---|---|---|
| amaia_sync_run_manifests | raw_max_id | bigint | yes | F1 |
| amaia_sync_workset_exception_decisions | decision_seq | integer | no | F2 |
| amaia_sync_workset_exceptions | hash_version | text | no | F4 |
| amaia_sync_cycles | reconciliation_snapshot | jsonb | yes | F5/F10 |

### Modified CHECK constraints

| Table | Constraint | Change | Source |
|---|---|---|---|
| amaia_sync_run_manifests | phase | + 'abandoned' | F6 |

### New UNIQUE constraints

| Table | Columns | Source |
|---|---|---|
| amaia_sync_workset_exception_decisions | (exception_id, decision_seq) | F2 |
| amaia_sync_workset_exception_consumptions | (exception_id, consumed_by_run_id) | F7 |

### Modified UNIQUE constraints

| Table | Old | New | Source |
|---|---|---|---|
| amaia_sync_workset_exceptions | (domain_name, source_amaia_id, source_row_hash) | (domain_name, source_amaia_id, source_row_hash, hash_version) | F4 |

### New triggers

| Table | Trigger | Behavior | Source |
|---|---|---|---|
| amaia_sync_workset_exceptions | append_only | Reject UPDATE and DELETE | F3 |
| amaia_sync_workset_exception_decisions | append_only_and_serialize | Reject UPDATE and DELETE; on INSERT acquire exclusive lock on parent exception row | F2, F3 |
| amaia_sync_workset_exception_consumptions | append_only | Reject UPDATE and DELETE | F3 |
| amaia_sync_run_manifests | phase_transition_guard | Reject DELETE always; reject UPDATE if current phase is 'comparison_complete' or 'abandoned'; reject backward phase transitions | F3 |

### Cumulative DDL inventory (v1.2 through v1.2.4)

**New tables:** 6 (unchanged from v1.2.3)
1. amaia_sync_cycles
2. amaia_sync_run_manifests
3. amaia_sync_workset_exceptions
4. amaia_sync_workset_exception_decisions
5. amaia_sync_workset_exception_consumptions
6. amaia_sync_reconciliation_segments

**New columns on existing tables:** 10 (v1.2.3: 6, v1.2.4: +4)
- amaia_sync_runs: cycle_id, upstream_run_id, blocked_entity_name
- amaia_sync_reconciliation_results: cycle_id, scope_descriptor, result_status
- amaia_sync_run_manifests: raw_max_id
- amaia_sync_workset_exception_decisions: decision_seq
- amaia_sync_workset_exceptions: hash_version
- amaia_sync_cycles: reconciliation_snapshot

**Modified CHECK constraints:** 5 (v1.2.3: 4, v1.2.4: +1)

**New UNIQUE constraints:** 2 (v1.2.4)

**New indexes:** 11 (unchanged from v1.2.3)

**Triggers:** 4 (v1.2.4)

**Data corrections:** 1 watermark update + 12 segment seed rows (unchanged from v1.2.3)

---

## Guarantees vs SLOs — Revised Honest Assessment

### Absolute guarantees (provable by architecture)

| Guarantee | Mechanism | Evidence | Adversarial scenario tested |
|---|---|---|---|
| fetch↔persist set identity | SHA-256 hash comparison in manifest | amaia_sync_run_manifests.sets_match | {101,103} vs {101,102}: hash differs, detected |
| No watermark advance without set-identity proof | Watermark conditional on sets_match=true | manifest + sync_runs | Crash before comparison: watermark stays |
| No phantom reference silently consumed | Exception ledger with versioned, serialized decisions | exception_consumptions + decision_seq | Hash mismatch on row change: rollback |
| No stale writer | 4-part ownership predicate in fenced transaction | amaia_sync_leases within transaction | Expired lease + new acquirer: 4 conditions fail |
| No tombstone resurrection without fresh data | Resurrection atomicity rule | tombstone_events + destination in same tx | Crash mid-resurrection: tx rolls back |
| No multi-lease deadlock | Global canonical ordering | Application-layer invariant | Reverse-order acquisition: rejected by rule |
| Immutability of audit trail | BEFORE UPDATE/DELETE triggers on ledger + manifest tables | Database-enforced, bypass requires DDL privilege | UPDATE attempt: trigger raises exception |
| Consumption-decision serialization | Exclusive row lock on exception during both paths | FOR UPDATE within fenced transaction | Concurrent operator decision: blocks until engine commits |

### Conditional SLOs (depend on external factors)

| SLO | Condition | Breach trigger | Mitigation |
|---|---|---|---|
| AMAIA↔fetch completeness for id-based domains | AMAIA transaction duration < time for id_safety_lag IDs to be assigned | Row committed after safety lag window closes AND missed by overlap on next run | Reconciliation (daily count, weekly id-set). Targeted backfill on drift detection. |
| SLO-TIER4-84 | System availability for ≥10/12 weekly cycles AND max_segments_per_cycle sufficient for catch-up | Per-deadline feasibility simulation returns irrecoverable | Increase max_segments_per_cycle. Investigate starvation segments. |
| Alert state change detection latency | AMAIA availability + logestado sync cadence + id_safety_lag | Latency exceeds configured threshold | Configurable safety_lag. Operator manual cycle. |

### Cannot be guaranteed (honest declaration)

| Limitation | Root cause | Why no architecture can fix it |
|---|---|---|
| AMAIA↔fetch completeness under pathological transactions | InnoDB auto-increment gap with long-running transactions | Without CDC/binlog/commit-timestamp access, uncommitted rows are invisible. Safety lag is probabilistic mitigation, not proof. |
| Zero data loss under retroactive AMAIA deletes | Read-only access, no change-data-capture | Engine sees only point-in-time snapshots. Reconciliation detects drift after the fact. |
| SLO compliance under sustained system outage | Mathematical limit on catch-up capacity | Architecture detects and reports irrecoverability; cannot prevent it. |
| Correctness of operator-approved exceptions | Human judgment | Ledger provides accountability; organizational process provides correctness. |

---

## F1–F10 Hallazgo → Resolución v1.2.4

| # | Hallazgo | Severidad | Resolución | DDL delta | Cerrado? |
|---|---|---|---|---|---|
| F1 | Zero-skip proves fetch↔persist but not AMAIA↔fetch (HWM gap) | CRITICAL | safety_lag + id_overlap for all id-based domains. Logestado overlap changed from 0 to 100. upper_bound = MAX(id) - safety_lag. Honest reclassification: fetch↔persist = guarantee, AMAIA↔fetch = SLO mitigated by safety_lag + overlap + reconciliation. | +1 column (raw_max_id) | **Yes** — residual risk honestly declared as SLO |
| F2 | Decision ordering race + no total order | MEDIA-ALTA | decision_seq integer NOT NULL per exception. Latest = MAX(seq). SELECT FOR UPDATE on exception row serializes consumption and decision insertion. | +1 column, +1 UNIQUE | **Yes** |
| F3 | Append-only not enforced | MEDIA | BEFORE UPDATE/DELETE triggers on 3 ledger tables. Phase-transition guard on manifests. | +4 triggers | **Yes** |
| F4 | source_row_hash covers 3 fields, not full row | MEDIA | Canonical hash over 8 non-engine columns. Versioned algorithm (logestado_exception_v1). Any field change invalidates approval. | +1 column (hash_version), UNIQUE extended | **Yes** |
| F5 | irrecoverable formula not computable | MEDIA | Per-deadline feasibility simulation. Deterministic algorithm. capacity_snapshot on amaia_sync_cycles. | +1 column (reconciliation_snapshot) | **Yes** |
| F6 | Manifest 'source_fetched' orphan indistinguishable | BAJA | Phase 'abandoned' added. Orphan recovery marks incomplete manifests. | CHECK extended | **Yes** |
| F7 | No double-consumption guard | BAJA-MEDIA | UNIQUE(exception_id, consumed_by_run_id). Same exception consumable by different runs (manual reset), not by same run twice. | +1 UNIQUE | **Yes** |
| F8 | records_processed ambiguous for alerta | BAJA | Defined: distinct alert_amaia_id in workset. Logestado row count derivable from bounds. | None | **Yes** |
| F9 | Segment state update not atomic with results | BAJA | Same transaction for reconciliation_results INSERT and segment UPDATE. | None | **Yes** |
| F10 | No capacity snapshot for SLO forensics | BAJA | reconciliation_snapshot jsonb on amaia_sync_cycles. Records selected/attempted/succeeded/failed segments + SLO status before/after. | Merged with F5 | **Yes** |

---

## Adversarial Scenarios Verified

| Scenario | Result | Mechanism |
|---|---|---|
| AMAIA HWM gap: TxA(id=145) uncommitted, TxB(id=146) committed | **Mitigated** | safety_lag excludes recent IDs; overlap re-reads boundary on next run |
| Manifest source {101,103}, persisted {101,102} | **Detected** | Hash mismatch. missing_ids=[103], extra_ids=[102] |
| Crash after manifest source_fetched, before upsert | **Safe** | Watermark never advanced. Orphan recovery marks manifest 'abandoned' |
| Crash after upsert, before comparison_complete | **Safe** | Watermark never advanced (requires sets_match=true). Recovery re-compares |
| Operator inserts rejection during engine consumption | **Serialized** | Both paths lock exception row. Concurrent decision blocks until engine commits |
| Exception consumed with stale hash | **Rejected** | source_row_hash_at_consumption re-verified within fenced transaction |
| Tier 4 segment fails 5 consecutive times | **Detected** | consecutive_failure_count = 5 → starvation status. Still attempted, shares capacity |
| Tier 4: 6 weeks of reconciliation lost | **Computed** | Per-deadline simulation determines which segments are irrecoverable at current capacity |
| UPDATE on historical decision row | **Blocked** | BEFORE UPDATE trigger raises exception |
| Same exception consumed twice by same run | **Blocked** | UNIQUE(exception_id, consumed_by_run_id) |
| AMAIA pathological transaction (hours-long) | **NOT mitigated by safety_lag** | Declared as residual SLO risk. Reconciliation detects drift. |

---

**End of document.**
