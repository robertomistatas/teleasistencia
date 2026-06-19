# AMAIA-SYNC Runtime Architecture v1.2

**Phase:** 9.3 Rev.3  
**Status:** Design — no implementation  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.1.md  
**Prerequisite phases:** 9.1D (empirical validation, closed), 9.2 (schema deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Auditor:** Codex (auditor forense)  
**Date:** 2026-06-18

---

## Executive Summary

v1.1 was audited by Codex. The architectural direction was accepted but Codex identified 7 findings (5 critical, 2 medium-reclassified-to-critical in this revision) that block authorization for Phase 9.4. This revision addresses all 7 findings. Unlike v1.1's "no DDL" constraint, this revision explicitly identifies and declares schema changes required to close the findings. The priority is correctness, not schema minimalism.

**Findings resolved:**

1. **Lease ownership predicate** expanded from token-only to a 4-part conjunction: lease_token match, owner_identity match, owner_identity not null, lease_expires_at not expired. All checked atomically within the same transactional fencing mechanism from v1.1.
2. **Alerta workset** converted to fail-closed: the trigger cursor cannot advance past any logestado row with null or invalid alert_amaia_id. The entire batch is rejected on integrity failure. New reason_code 'WORKSET_INTEGRITY_FAILURE' required (DDL: CHECK constraint extension).
3. **Reconciliation** elevated to formal lease participant. Reconciliation acquires the domain lease before processing, using the same mechanism as sync. Eliminates the TOCTOU observation race.
4. **Tombstone resurrection** redesigned as source-wins with a new intermediate state 'reactivation_pending'. No row becomes 'active' until the domain processor upserts fresh AMAIA data. DDL required: sync_status CHECK constraint extension on 3 destination tables.
5. **Historical alert reconciliation** redesigned as deterministic rotating window with 100% coverage SLA within 84 days. No sampling. Requires a new scope_descriptor column on reconciliation_results (DDL).
6. **Alerta backlog** semantics corrected: the trigger cursor's upper bound is always the persisted logestado watermark, not the current cycle's logestado outcome. Alerta can consume durable backlog from prior cycles even when the current logestado run fails.
7. **Cycle traceability** requires new schema: amaia_sync_cycles table, cycle_id columns on sync_runs and reconciliation_results, upstream_run_id on sync_runs. This is the most significant DDL addition and is justified as the sole mechanism for proving causal chains across domains and tiers.

**Schema impact:** This revision requires DDL changes. These are enumerated in the Schema Gap Analysis section. No existing data is altered or deleted. All changes are additive (new table, new nullable columns, expanded CHECK constraints) except CHECK constraint replacements, which are safe on 0-row or low-activity tables.

---

## Changes from v1.1

All references are to v1.1 sections unless stated otherwise.

1. **Critical Correction 2 (Transactional Fencing):** The exclusive row lock mechanism is preserved. The predicate evaluated within the lock is expanded from lease_token-only to the 4-part ownership conjunction. See Correction 1 below.
2. **Critical Correction 1 (Durable Alert Workset):** The trigger cursor mechanism is preserved. A pre-validation scan is added: the cursor cannot advance if any row in the range has null alert_amaia_id. The run fails immediately on integrity violation. See Correction 2 below.
3. **Medium Correction 1 (Sync-Reconciliation Barriers):** Replaced entirely. Observation-based barriers are replaced by lease acquisition. See Correction 3 below.
4. **Critical Correction 4 (Tombstone Resurrection):** The 'reverted' transition is preserved. The direct inactive_confirmed → active transition is replaced by inactive_confirmed → reactivation_pending → active, where the second transition requires a confirmed upsert of fresh AMAIA data. See Correction 4 below.
5. **Critical Correction 5 (Alert Reconciliation Coverage):** Tier 4 (quarterly 10% sample) is replaced by a deterministic rotating window with bounded coverage SLA. See Correction 5 below.
6. **Medium Correction 2 (Logestado-Alerta Handoff):** The success criterion is corrected. The alerta upper bound is the persisted logestado watermark, independent of the current cycle's logestado outcome. See Correction 6 below.
7. **[NEW] Durable Cycle Traceability:** New schema elements introduced to make cycle boundaries, upstream dependencies, and reconciliation scope durable and auditable. See Correction 7 below.

---

## Correction 1: Complete Lease Ownership Predicate

### Finding

Codex: Transactional fencing in v1.1 validates only lease_token. A writer must prove full ownership: token, identity, non-null identity, and unexpired lease.

### Invariant

**A writer holds a valid lease if and only if all four of the following conditions are true simultaneously, evaluated within the same database transaction under an exclusive row lock on the lease entry:**

1. **lease_token = writer's held token.** Proves no other process has acquired the lease since this writer did. The token is monotonically increasing and incremented only on acquisition.
2. **owner_identity = writer's structured identity.** Proves the writer is the same process that acquired the lease, not a different process that happens to know the token value. Defense in depth against token leakage or reuse.
3. **owner_identity IS NOT NULL.** Proves the lease has not been explicitly released. On release, owner_identity is set to NULL. A NULL owner_identity with a matching token would indicate a released lease that has not yet been re-acquired — the writer must not proceed.
4. **lease_expires_at > now() (at database server time).** Proves the lease has not expired. An expired lease is eligible for acquisition by another process. Even if the token and identity match, an expired lease is not valid — another process may be in the process of acquiring it.

### Formal rule

No write operation (batch upsert, watermark advance, tombstone status change) may proceed unless all four conditions are true within the same transaction that performs the write. This is the **ownership predicate**. It replaces the token-only check from v1.1.

### Interaction with transactional fencing

The mechanism from v1.1 is unchanged: each batch write executes within a transaction that acquires an exclusive row lock on the lease entry. The change is what is evaluated after the lock is acquired. v1.1 evaluated only lease_token. v1.2 evaluates the full 4-part predicate.

If any of the four conditions fails, the transaction rolls back immediately. No data is written.

### Interaction with heartbeat

The heartbeat extends lease_expires_at. Its purpose is to keep condition 4 true. Without regular heartbeats, lease_expires_at falls behind now() and the ownership predicate fails even though conditions 1-3 are still true. The heartbeat interval (< half the TTL) ensures a healthy writer never encounters an expired-lease check failure.

### Interaction with orphan recovery

When a lease expires and is acquired by a new process, the new process sets a new lease_token, a new owner_identity, and a new lease_expires_at. The orphaned writer's next ownership predicate check will fail on condition 1 (token mismatch) and condition 2 (identity mismatch). Both failures independently prevent the stale write. The 4-part conjunction provides redundant safety.

### Schema impact

None. All four columns (lease_token, owner_identity, lease_expires_at) already exist on amaia_sync_leases. The change is purely to the architectural contract.

---

## Correction 2: Fail-Closed Alerta Workset

### Finding

Codex: A logestado row synced to amaia_alert_logs with null or invalid alert_amaia_id would be skipped by the workset derivation query but consumed by the trigger cursor advance. The alert change is silently lost.

### Invariant

**The alerta trigger cursor MUST NOT advance past any amaia_alert_logs.amaia_id within its consumption range for which alert_amaia_id is NULL.**

This is a fail-closed invariant: the system halts alert processing rather than silently dropping work.

### Pre-validation scan

Before deriving the workset, the alerta processor executes a validation scan on amaia_alert_logs for all rows with amaia_id in (N, M] (where N is the current trigger cursor and M is the logestado watermark).

The scan counts rows where alert_amaia_id IS NULL within this range.

**If count = 0:** Validation passes. The workset is derived normally (SELECT DISTINCT alert_amaia_id FROM amaia_alert_logs WHERE amaia_id > N AND amaia_id <= M). Processing proceeds.

**If count > 0:** Validation fails. The run is recorded as 'failed' with reason_code = 'WORKSET_INTEGRITY_FAILURE'. The trigger cursor does NOT advance. No alerts are processed. The anomalous rows are recorded in amaia_correlation_issues with a new issue_type that covers this case (or via the existing details jsonb field with the 'dato_inconsistente' type).

### Consequences of failure

1. The trigger cursor stays at N. The entire range (N, M] is pending.
2. The gap between logestado watermark (M) and alerta trigger cursor (N) grows on each successive cycle where logestado succeeds but alerta remains blocked.
3. This growing gap is a visible, durable, auditable signal of a problem. It does not self-resolve.
4. Operator intervention is required: either fix the null alert_amaia_id in amaia_alert_logs (data correction), or add an exception mechanism (future, not designed in V1).
5. All other domains continue to sync normally. The failure is isolated to alerta.

### Why fail-closed is correct

The alternative (skip null rows, advance cursor past them) is fail-open. It trades operational availability for data correctness. In a teleasistencia system monitoring elderly patients, a silently lost alert state change is worse than a visibly blocked alert sync. The operator is notified; the data is not lost.

### Interaction with retry

If the pre-validation scan fails, the run is not retried automatically. Retrying would produce the same result — the null rows are in Supabase and won't change without intervention. The Scheduler records the failure and moves to the next domain.

### Interaction with orphan recovery

If the process crashes during alerta processing (after validation passed but before cursor advance), orphan recovery re-derives the workset from the same (N, M] range. The validation scan runs again. If the null rows appeared due to a concurrent logestado sync (unlikely but possible), they are caught on the recovery run.

### Schema impact

**DDL required:** The amaia_sync_runs reason_code CHECK constraint must be extended to include 'WORKSET_INTEGRITY_FAILURE'. This requires dropping and re-adding the constraint (the constraint name amaia_sync_runs_reason_code_check is known from migration 013). The constraint has 13 current values; the new value brings it to 14.

---

## Correction 3: Reconciliation as Formal Lease Participant

### Finding

Codex: Reconciliation observes lease state (owner_identity, lease_expires_at) but does not participate in the lease mechanism. Between the observation and the start of reconciliation work, a sync run could acquire the lease. This is a TOCTOU race.

### Architectural correction

Reconciliation is no longer an observer of leases. It is a full participant. Before processing any domain, the Reconciliation Engine acquires the domain lease using the same mechanism as sync processors.

### Acquisition

The Reconciliation Engine calls the Lease Manager's acquire(entity_name) operation. The acquisition follows the same atomic conditional UPDATE: succeeds only if the lease is free or expired. On success, lease_token is incremented, owner_identity is set to the reconciliation process's structured identity (format: `{hostname}:{pid}:reconciliation:{run_id}`), acquired_at and lease_expires_at are set.

If the lease is held by a sync processor, the acquisition fails. Reconciliation for that domain is deferred to the next reconciliation cycle. The deferral is recorded with reason_code = 'LEASE_HELD'.

### Heartbeat

Reconciliation holds the lease for the duration of domain processing. For small domains (beneficiario: 2,237 rows), this may be seconds. For large domains with field comparison (alerta: 58,031 rows), this may be minutes. The Reconciliation Engine heartbeats at the same interval as sync processors (every 2 minutes per v1.0 Appendix C).

### Release

After completing reconciliation for a domain, the lease is explicitly released. The lease_token is preserved (never decremented). The domain is immediately available for sync on the next Scheduler tick.

### Mutual exclusion guarantee

With reconciliation as a lease participant, the following operations are mutually exclusive on any single domain at any point in time:

- Incremental sync
- Reconciliation
- Orphan recovery (which is a form of sync acquisition)

No two of these can hold the lease simultaneously. The fencing token prevents stale writes from any of them. The ownership predicate (Correction 1) prevents writes from any process whose lease has been superseded.

### Processing order for multi-domain reconciliation

The Reconciliation Engine processes domains sequentially, acquiring and releasing the lease for each domain individually. This minimizes lock contention: while reconciliation processes domain A, sync can proceed on domains B through G.

For domains with ordering dependencies (logestado → alerta), the Reconciliation Engine must acquire and hold BOTH leases during the reconciliation of the dependent pair. Specifically: when reconciling alerta, the engine first acquires the logestado lease, then acquires the alerta lease, reconciles alerta (which reads logestado data), releases the alerta lease, then releases the logestado lease. This prevents a concurrent logestado sync from modifying data that the alerta reconciliation is comparing.

### Impact on sync throughput

Reconciliation blocks sync for the duration of its domain processing. At the cadences defined in v1.0/v1.1 (daily count, weekly id-set, monthly/quarterly field comparison), the total lock time per week is bounded:

- Daily count reconciliation: ~seconds per domain (two COUNT queries).
- Weekly id-set reconciliation: ~seconds to low minutes per domain.
- Monthly/quarterly field comparison: ~minutes for large domains.

These are negligible relative to the 24-hour sync cadence. The design accepts this tradeoff: correctness of reconciliation results is worth the brief sync delay.

### Schema impact

None. The lease mechanism already supports arbitrary owner_identity values. The 'reconciliation' worker_id in the identity string is a convention, not a schema change.

---

## Correction 4: Source-Wins Resurrection with Intermediate State

### Finding

Codex: v1.1 allows a tombstoned row to return to 'active' before its field data is refreshed from AMAIA. This means a row could be visible as 'active' with data from the time it was deactivated, which may be arbitrarily stale.

### Architectural correction

Resurrection is a two-phase process. A new intermediate state 'reactivation_pending' is introduced. No row transitions directly from any inactive state to 'active'. The transition to 'active' occurs only as part of an upsert that carries fresh AMAIA data.

### State machine (complete, supersedes all prior versions)

Destination row sync_status values: `active`, `missing_pending_confirmation`, `inactive_confirmed`, `reactivation_pending`.

Tombstone event transitions: `detected`, `confirmed`, `reverted`, `ignored` (unchanged from deployed schema).

**Normal lifecycle:**
- active (initial state for all synced rows)
- active → missing_pending_confirmation (reconciliation detects absence in AMAIA for first cycle; tombstone_events: 'detected', then 'confirmed')
- missing_pending_confirmation → inactive_confirmed (operator confirms removal)
- missing_pending_confirmation → active (operator or auto-ignore; tombstone_events: 'ignored')

**Resurrection lifecycle (Path A — detected by incremental sync):**
When a domain processor fetches a row from AMAIA whose amaia_id exists in Supabase with sync_status ∈ {missing_pending_confirmation, inactive_confirmed}:

1. The upsert writes fresh AMAIA field data AND sets sync_status = 'active' in the same transaction.
2. A tombstone_events row with transition = 'reverted' is recorded.
3. There is no intermediate state — the upsert carries current data, so the row is immediately safe to expose as 'active'.

**Resurrection lifecycle (Path B — detected by reconciliation):**
When reconciliation's id-set comparison finds an amaia_id present in AMAIA and present in Supabase with sync_status ∈ {missing_pending_confirmation, inactive_confirmed}:

1. Reconciliation sets sync_status = 'reactivation_pending'. Field data is NOT updated (reconciliation does not write domain data — this invariant from v1.1 is preserved).
2. A tombstone_events row with transition = 'reverted' is recorded.
3. The row is now flagged for refresh by the domain processor.

**Refresh phase (Path B continuation):**
On the next sync cycle, the domain processor's fetch logic includes a secondary query: for the processor's domain table, select all amaia_id values where sync_status = 'reactivation_pending'. These amaia_ids are added to the fetch list alongside the normal watermark-based incremental window.

1. The processor fetches these rows from AMAIA by primary key.
2. The upsert writes fresh field data AND sets sync_status = 'active' in the same transaction.
3. If the fetch from AMAIA fails for a specific amaia_id (e.g., the row actually doesn't exist — false resurrection signal), sync_status is reverted to 'inactive_confirmed' and a tombstone_events row with transition = 'detected' is recorded (restarting the tombstone lifecycle).

### Visibility contract

- `active`: row has current AMAIA data. Safe for all downstream consumers.
- `reactivation_pending`: row exists in AMAIA but field data in Supabase may be stale. Downstream consumers MUST exclude this status from operational queries. This status is transient — it resolves on the next sync cycle.
- `missing_pending_confirmation`: row was absent from AMAIA for 2+ reconciliation cycles. Awaiting operator review.
- `inactive_confirmed`: row confirmed removed by operator. Not visible to operational queries.

### Maximum staleness window for Path B

The time between reconciliation detection (reactivation_pending) and sync refresh (active) is bounded by the sync cadence for the domain. For high-frequency domains (control_llamadas, logestado), this is minutes. For medium-frequency domains (beneficiario, red), this is hours. For low-frequency domains (enfermedades, medicamentos), this is up to 24 hours.

### Schema impact

**DDL required:** The sync_status CHECK constraint on three destination tables must be extended to include 'reactivation_pending':
- amaia_beneficiaries: DROP/ADD amaia_beneficiaries_sync_status_check
- amaia_support_network: DROP/ADD amaia_support_network_sync_status_check
- amaia_alerts: DROP/ADD amaia_alerts_sync_status_check

Each constraint currently allows ('active', 'missing_pending_confirmation', 'inactive_confirmed'). The new value brings each to 4 values. All three tables have 0 rows at this time, making the constraint replacement safe.

---

## Correction 5: Deterministic Historical Alert Coverage

### Finding

Codex: Tier 4 (quarterly 10% sample of historical closed alerts) does not guarantee that every alert is ever compared. A specific alert could remain in the unsampled 90% indefinitely.

### Architectural correction

Sampling is eliminated. All tiers use deterministic, bounded-time coverage.

### Tier structure (replaces v1.1 tiers entirely)

**Tier 1: Population integrity (weekly, all alerts, all statuses)**
- Full count comparison: source vs destination.
- Full id-set comparison: symmetric difference of amaia_id values.
- Scope: every alert, regardless of alert_status_id or sync_status.
- SLA: 100% of the alert population is verified for existence every 7 days.
- scope_descriptor: 'tier1:count_id_set:all_statuses'

**Tier 2: Active alert field fidelity (weekly, status 0-2)**
- Row-level field comparison for all alerts with alert_status_id in (0, 1, 2).
- Scope: ~52,000 alerts (9.1D V-003 distribution).
- SLA: 100% of active alerts have full field comparison every 7 days.
- scope_descriptor: 'tier2:field_compare:active:status_0_1_2'

**Tier 3: Recently closed alert field fidelity (monthly, status 3-5, closed < 90 days)**
- Row-level field comparison for closed alerts whose most recent logestado entry is within the last 90 days.
- Scope: variable, estimated 1,000-3,000 alerts.
- SLA: 100% of recently closed alerts have full field comparison every 30 days.
- scope_descriptor: 'tier3:field_compare:recent_closed:status_3_4_5:closed_lt_90d'

**Tier 4: Historical closed alert field fidelity (rotating weekly segment, status 3-5, closed >= 90 days)**
- The historical closed alert population is partitioned into 12 deterministic segments by amaia_id range.
- Each weekly reconciliation cycle processes exactly one segment.
- After 12 weeks (84 days), every historical alert has been field-compared exactly once.
- The rotation is sequential: segment 1 in week 1, segment 2 in week 2, ..., segment 12 in week 12, segment 1 in week 13, and so on.
- Scope per segment: ~460 alerts (5,539 / 12).
- SLA: 100% of historical closed alerts have full field comparison at least once every 84 days.
- scope_descriptor: 'tier4:field_compare:historical:segment_{N}_of_12:amaia_id_range_{low}_{high}'

### Coverage SLA summary

| Alert population | Field comparison frequency | Coverage guarantee |
|---|---|---|
| All alerts (existence) | Weekly | 100% every 7 days |
| Active (status 0-2) | Weekly | 100% every 7 days |
| Recently closed (status 3-5, <90d) | Monthly | 100% every 30 days |
| Historical closed (status 3-5, >=90d) | Rotating weekly segment | 100% every 84 days |

**Total coverage SLA: Every alert in the system, regardless of status, receives at least one row-level field comparison within 84 days.** This is deterministic, auditable, and verifiable by querying reconciliation_results for scope_descriptor patterns.

### Treatment of alerts without logestado

The 33 historical alerts without logestado entries (9.1D V-006) are present in the alert population and covered by Tier 1 (existence check) and the appropriate field comparison tier based on their alert_status_id. They are not excluded from any tier. Additionally, they are permanently tracked in amaia_correlation_issues, ensuring they remain visible as known anomalies.

### Auditability

For any given alert amaia_id, an auditor can determine:
1. When it was last existence-checked: most recent Tier 1 reconciliation_results for domain_name = 'alerta'.
2. When it was last field-compared: most recent Tier 2/3/4 reconciliation_results whose scope_descriptor covers the alert's status and amaia_id range.
3. Whether the field comparison found drift: late_update_count on the reconciliation_results row.

The scope_descriptor column on reconciliation_results makes this possible without parsing timestamps or inferring tier membership.

### Schema impact

**DDL required:** A new nullable column scope_descriptor text on amaia_sync_reconciliation_results. No CHECK constraint (values are domain-specific and evolve with reconciliation strategy). No default value.

---

## Correction 6: Durable Alerta Backlog Semantics

### Finding

Codex: v1.1's success criterion states "A failed logestado run does not block alerta processing — it simply means alerta has nothing new to process." This is incorrect when a backlog exists from prior successful logestado runs. If logestado succeeded in cycle N (advancing to M=150) but alerta failed in cycle N (cursor stays at 100), and logestado fails in cycle N+1, alerta should still process the range (100, 150] — that backlog is confirmed and durable.

### Corrected semantics

**Definition: Confirmed backlog** is the range (trigger_cursor, logestado_watermark] where trigger_cursor is the alerta trigger cursor's current value (last_id in amaia_sync_watermarks for entity_name = 'alerta') and logestado_watermark is the logestado domain's current watermark value (last_id in amaia_sync_watermarks for entity_name = 'logestado'). Both values are persisted in Supabase and reflect only successful advances.

**When trigger_cursor < logestado_watermark:** Confirmed backlog exists. The amaia_alert_logs rows in this range were persisted by one or more prior successful logestado runs. They are durable and available for workset derivation regardless of the current cycle's logestado outcome.

**When trigger_cursor == logestado_watermark:** No backlog. The alerta processor has consumed all available logestado data. An empty incremental results.

### Corrected handoff criteria

The three criteria from v1.1 Medium Correction 2 are revised:

**Completeness criterion (revised):** The Scheduler must verify that logestado has been ATTEMPTED in the current cycle before starting alerta. "Attempted" means an amaia_sync_runs row exists for domain_name = 'logestado' within the current cycle with a terminal status. The specific terminal status (success, failed, skipped_lock_held) is irrelevant to this gate — only the attempt matters.

**Upper bound criterion (replaces "success criterion"):** The alerta processor's upper bound M is ALWAYS the current persisted value of amaia_sync_watermarks.last_id WHERE entity_name = 'logestado'. This value reflects the latest successful logestado advance, regardless of when it occurred. It is not tied to the current cycle's logestado run.

Consequences:
- If logestado succeeded in this cycle: M is the freshly-advanced value. Alerta processes new + any prior backlog.
- If logestado failed in this cycle: M is the value from the last successful advance (could be from this cycle or any prior cycle). Alerta processes whatever backlog remains from prior cycles.
- If logestado was skipped (lock held): same as failed — M is unchanged, backlog is processed.

**Blocking criterion (unchanged):** Logestado must have been attempted in the current cycle. This prevents a Scheduler bug from bypassing logestado entirely.

### Why this is correct

The alerta trigger cursor and the logestado watermark are both durable, committed values in amaia_sync_watermarks. The gap between them (if any) represents confirmed, persistent, already-committed logestado data that has not yet been consumed by alerta. This gap does not depend on any current-cycle operation — it exists as a fact of committed state.

Blocking alerta when this gap exists (because the current logestado run happened to fail) would unnecessarily delay alert state change detection. The data is already in amaia_alert_logs. The pre-validation scan (Correction 2) ensures its integrity. There is no safety reason to defer processing.

### Schema impact

None. This is a semantic correction to the operational contract.

---

## Correction 7: Durable Cycle Traceability

### Finding

Codex: The current schema cannot durably prove: (a) which runs belong to the same scheduling cycle, (b) which upstream run caused a downstream run, (c) which reconciliation tier was applied, (d) the causal link between a logestado run and the alerta run that consumed its output.

### Analysis: Is the current schema sufficient?

**No.** The current schema is insufficient for the following reasons:

**(a) Cycle grouping.** amaia_sync_runs has started_at, but correlating runs by timestamp proximity is fragile and non-deterministic. Two runs that start within the same second could belong to different cycles (if cycles are fast) or the same cycle (if domains are slow). There is no formal cycle identifier.

**(b) Upstream causation.** amaia_sync_runs has previous_attempt_run_id (retry chain) and supersedes_run_id (orphan recovery chain), but neither captures the logestado→alerta relationship. The alerta run's watermark_before_id and the logestado run's watermark_after_id share the same value, but this is a correlatable coincidence, not an explicit link. An auditor must know the relationship exists and derive it — it is not self-evident from the schema.

**(c) Reconciliation tier.** amaia_sync_reconciliation_results has reconciliation_level ('daily', 'weekly', 'full'), which captures frequency but not scope. A 'weekly' reconciliation of active alerts (Tier 2) and a 'weekly' reconciliation of all alerts for id-set comparison (Tier 1) both have reconciliation_level = 'weekly'. They are indistinguishable in the current schema.

**(d) Causal logestado→alerta link.** As noted in (b), this is inferable but not explicit.

### Schema changes required

**New table: amaia_sync_cycles**

A first-class representation of a scheduling cycle.

Columns:
- id: uuid, primary key.
- started_at: timestamptz, not null. When the Scheduler initiated the cycle.
- finished_at: timestamptz, nullable. When the last operation in the cycle completed.
- status: text, not null. CHECK constraint: ('running', 'success', 'completed_with_failures'). 'success' means all domain runs and reconciliation operations in the cycle completed without failure. 'completed_with_failures' means at least one domain run failed or was skipped.
- trigger_type: text, not null. CHECK constraint: ('scheduled', 'manual', 'recovery'). How the cycle was initiated.
- owner_identity: text, not null. Structured identity of the process that initiated the cycle.

Indexes: (started_at), (status).

RLS: same pattern as other sync tables (admin/super_admin select).

**New column on amaia_sync_runs: cycle_id**

- Type: uuid, nullable.
- References: amaia_sync_cycles(id) ON DELETE SET NULL.
- Purpose: links every sync run to the cycle that initiated it.
- Index: idx_amaia_sync_runs_cycle_id on (cycle_id).

**New column on amaia_sync_runs: upstream_run_id**

- Type: uuid, nullable.
- References: amaia_sync_runs(id) (self-referencing FK).
- Purpose: for alerta runs, explicitly records the logestado run whose watermark output was consumed. For all other domains, NULL.
- Semantics: distinct from previous_attempt_run_id (retry) and supersedes_run_id (orphan recovery). upstream_run_id captures cross-domain causal dependency.
- Index: idx_amaia_sync_runs_upstream_run_id on (upstream_run_id).

**New column on amaia_sync_reconciliation_results: cycle_id**

- Type: uuid, nullable.
- References: amaia_sync_cycles(id) ON DELETE SET NULL.
- Purpose: links reconciliation results to the cycle in which they were produced.
- Index: idx_amaia_sync_reconciliation_results_cycle_id on (cycle_id).

**New column on amaia_sync_reconciliation_results: scope_descriptor**

- Type: text, nullable.
- No CHECK constraint (values are domain-specific, evolve with strategy).
- Purpose: machine-readable description of the reconciliation scope. Examples:
  - 'tier1:count_id_set:all_statuses'
  - 'tier2:field_compare:active:status_0_1_2'
  - 'tier3:field_compare:recent_closed:status_3_4_5:closed_lt_90d'
  - 'tier4:field_compare:historical:segment_3_of_12:amaia_id_range_30000_40000'
- Enables an auditor to determine exactly what was compared, at what granularity, for which population segment.

### Traceability queries enabled

With these schema additions, the following audit queries become trivially expressible:

1. **"What happened in cycle X?"** — Join amaia_sync_cycles to amaia_sync_runs and amaia_sync_reconciliation_results on cycle_id. All runs and reconciliation results for the cycle appear.

2. **"Which logestado run produced the alerta workset for this alerta run?"** — Read upstream_run_id from the alerta run's amaia_sync_runs row. Follow the FK to the logestado run. Verify watermark continuity: the logestado run's watermark_after_id should equal the alerta run's upper_bound.

3. **"Which reconciliation tier was applied to this result?"** — Read scope_descriptor from the amaia_sync_reconciliation_results row. Parse the tier, scope, and segment identifiers.

4. **"Has every historical alert been field-compared within 84 days?"** — Query amaia_sync_reconciliation_results for scope_descriptor LIKE 'tier4:field_compare:historical:segment_%'. Verify that all 12 segments have been executed within the last 84 days.

5. **"Was reconciliation run before or after sync in this cycle?"** — Join cycle_id to both amaia_sync_runs and amaia_sync_reconciliation_results. Compare started_at / executed_at timestamps within the same cycle.

### Schema impact

**DDL required:**
- 1 new table (amaia_sync_cycles)
- 2 new columns on amaia_sync_runs (cycle_id, upstream_run_id)
- 2 new columns on amaia_sync_reconciliation_results (cycle_id, scope_descriptor)
- 3 new indexes (on cycle_id columns and upstream_run_id)

---

## Schema Gap Analysis vs Fase 9.2

### Assessment: Schema changes ARE required

v1.2 cannot be implemented on the Fase 9.2 schema without modification. The following changes are necessary.

### New table

| Table | Justification | Finding |
|---|---|---|
| amaia_sync_cycles | First-class cycle entity for durable traceability. No existing table can represent cycle boundaries. | Correction 7 |

Columns: id (uuid pk), started_at (timestamptz not null), finished_at (timestamptz), status (text not null, CHECK), trigger_type (text not null, CHECK), owner_identity (text not null). Indexes: (started_at), (status). RLS: admin/super_admin select.

### New columns on existing tables

| Table | Column | Type | Nullable | FK | Justification | Finding |
|---|---|---|---|---|---|---|
| amaia_sync_runs | cycle_id | uuid | yes | amaia_sync_cycles(id) | Cycle membership | Correction 7 |
| amaia_sync_runs | upstream_run_id | uuid | yes | amaia_sync_runs(id) | Cross-domain causal link | Correction 7 |
| amaia_sync_reconciliation_results | cycle_id | uuid | yes | amaia_sync_cycles(id) | Cycle membership for reconciliation | Correction 7 |
| amaia_sync_reconciliation_results | scope_descriptor | text | yes | none | Reconciliation tier/scope traceability | Corrections 5, 7 |

### Modified CHECK constraints

| Table | Constraint | Current values | Added values | Justification | Finding |
|---|---|---|---|---|---|
| amaia_sync_runs | amaia_sync_runs_reason_code_check | 13 values | + 'WORKSET_INTEGRITY_FAILURE' | Fail-closed alerta workset | Correction 2 |
| amaia_beneficiaries | amaia_beneficiaries_sync_status_check | 'active', 'missing_pending_confirmation', 'inactive_confirmed' | + 'reactivation_pending' | Source-wins resurrection intermediate state | Correction 4 |
| amaia_support_network | amaia_support_network_sync_status_check | 'active', 'missing_pending_confirmation', 'inactive_confirmed' | + 'reactivation_pending' | Source-wins resurrection intermediate state | Correction 4 |
| amaia_alerts | amaia_alerts_sync_status_check | 'active', 'missing_pending_confirmation', 'inactive_confirmed' | + 'reactivation_pending' | Source-wins resurrection intermediate state | Correction 4 |

### New indexes

| Table | Index | Columns | Justification |
|---|---|---|---|
| amaia_sync_runs | idx_amaia_sync_runs_cycle_id | (cycle_id) | Cycle-based audit queries |
| amaia_sync_runs | idx_amaia_sync_runs_upstream_run_id | (upstream_run_id) | Upstream causation queries |
| amaia_sync_reconciliation_results | idx_amaia_sync_reconciliation_results_cycle_id | (cycle_id) | Cycle-based reconciliation queries |
| amaia_sync_cycles | idx_amaia_sync_cycles_started_at | (started_at) | Time-based cycle lookup |
| amaia_sync_cycles | idx_amaia_sync_cycles_status | (status) | Status-based cycle filtering |

### Data corrections (no DDL)

| Table | Row | Change | Justification | Finding |
|---|---|---|---|---|
| amaia_sync_watermarks | entity_name = 'alerta' | watermark_type: 'timestamp' → 'id', last_id: NULL → 0, last_timestamp: value → NULL, watermark_expr: NULL → 'derived:logestado.amaia_id→amaia_alert_logs.alert_amaia_id' | Alerta trigger cursor (v1.1 Correction 1, unchanged) | v1.1 C1 |

### Summary

- 1 new table
- 4 new columns on 2 existing tables
- 4 modified CHECK constraints on 3 existing tables
- 5 new indexes
- 1 data correction

All changes are additive. No existing columns are removed, renamed, or have their types changed. CHECK constraint modifications are DROP/ADD operations on constraints whose names are known from the migration files. All destination tables have 0 rows at this time, making constraint replacement safe.

These changes will be authored as migration files in a dedicated Fase 9.3 schema migration step, separate from the Fase 9.2 commit.

---

## Hallazgo Codex → Resolución v1.2

| # | Hallazgo Codex | Severidad | Resolución v1.2 | Schema impact | Closed? |
|---|---|---|---|---|---|
| 1 | Lease ownership validates only lease_token | Critical | 4-part ownership predicate: token + identity + not-null + not-expired. Evaluated atomically within transactional fencing. | None (columns exist) | Yes |
| 2 | Alerta workset vulnerable to silent loss on null alert_amaia_id | Critical | Fail-closed pre-validation scan. Trigger cursor cannot advance past any row with null alert_amaia_id. Run fails with WORKSET_INTEGRITY_FAILURE. | DDL: reason_code CHECK extended | Yes |
| 3 | Reconciliation observes leases without participating (TOCTOU) | Critical | Reconciliation acquires domain lease before processing. Full lease lifecycle: acquire, heartbeat, release. Cross-domain pairs (logestado+alerta) hold both leases during dependent reconciliation. | None (lease table supports it) | Yes |
| 4 | Tombstone resurrection exposes stale data as active | Critical | Two-phase resurrection: reactivation_pending (flag only, no data update) → active (upsert with fresh AMAIA data). No direct transition to active without field refresh. | DDL: sync_status CHECK extended ×3 | Yes |
| 5 | Tier 4 sampling does not guarantee 100% coverage | Critical | Deterministic rotating window: 12 segments, 1 per week, 100% coverage within 84 days. No sampling. scope_descriptor on reconciliation_results enables audit. | DDL: scope_descriptor column added | Yes |
| 6 | Alerta cannot consume durable backlog when current logestado fails | Critical (upgraded from medium) | Upper bound is always the persisted logestado watermark, independent of current-cycle logestado outcome. Confirmed backlog (trigger_cursor < logestado_watermark) is always processable. | None (semantic correction) | Yes |
| 7 | No durable proof of cycle, upstream causation, or reconciliation tier | Critical (upgraded from medium) | New amaia_sync_cycles table. cycle_id on sync_runs and reconciliation_results. upstream_run_id on sync_runs for cross-domain causal links. scope_descriptor for tier traceability. | DDL: 1 table, 4 columns, 5 indexes | Yes |

---

## Open Risks

### Risk 1: Ownership predicate clock skew

Condition 4 of the ownership predicate (lease_expires_at > now()) relies on the database server's clock. If the database server's clock drifts significantly from the writer's clock, the predicate could produce false positives (expired lease appears valid) or false negatives (valid lease appears expired).

**Mitigation:** The lease TTL (5 minutes) is orders of magnitude larger than expected NTP drift on a cloud-hosted PostgreSQL instance. For the writer's local clock, the predicate is evaluated on the database side (now() is PostgreSQL server time), not on the application side. Both writer and reconciliation engine interact with the same database server, so relative clock skew between participants is zero.

**Residual risk:** Negligible for V1 deployment architecture (single database server, single VM client).

### Risk 2: Fail-closed alerta blocking on persistent null alert_amaia_id

If a logestado row is synced with null alert_amaia_id and the underlying AMAIA data genuinely lacks the alert reference, the alerta processor is blocked permanently until operator intervention.

**Mitigation:** This is by design — fail-closed means accepting operational interruption over silent data loss. The operator is alerted by the growing gap between logestado watermark and alerta trigger cursor, the 'WORKSET_INTEGRITY_FAILURE' reason_code in sync_runs, and the correlation issue record. The operational runbook must include a procedure for this scenario: investigate the null rows, determine if they are genuine (system-level logestado entries without alert context) or errors, and either correct the data or extend the architecture with a known-exception mechanism in V2.

### Risk 3: Reconciliation lease contention during high-frequency domains

Reconciliation acquires the domain lease, blocking sync for the processing duration. For high-frequency domains (control_llamadas, logestado with cadence measured in minutes), a long reconciliation (especially full field comparison) could cause multiple sync cycles to be skipped.

**Mitigation:** Full field comparison for high-volume domains uses time-bounded processing windows. The Reconciliation Engine enforces a configurable maximum processing time per domain per cycle. If the maximum is reached, reconciliation releases the lease with partial results recorded (noting the scope processed in scope_descriptor) and resumes from the stopping point in the next cycle. This bounds the maximum sync delay.

### Risk 4: amaia_sync_cycles table growth

A new cycle_id row is created for every scheduling cycle. At one cycle per hour (configurable), this produces ~8,760 rows per year. With all joined data (runs, reconciliation_results), this is a manageable volume.

**Mitigation:** No immediate concern. A retention policy (archive cycles older than 1 year) can be added in V2 if needed.

---

## Final Architectural Decision

This revision addresses all 7 findings from Codex's audit of v1.1. The corrections are:

1. **Complete ownership predicate.** Four conditions checked atomically. No single-field validation. No gap between identity check and token check.

2. **Fail-closed alerta workset.** Pre-validation scan rejects the entire batch on any null alert_amaia_id. Cursor does not advance. Problem is visible, durable, and requires explicit resolution.

3. **Reconciliation as lease participant.** Same mechanism as sync. No observation-based barriers. Mutual exclusion is formally guaranteed by the fencing token for all three operation types (sync, reconciliation, recovery).

4. **Source-wins resurrection.** Two-phase: reactivation_pending (flagged, stale data acknowledged) → active (fresh data confirmed). No row is ever 'active' with unrefreshed data.

5. **Deterministic historical coverage.** 12 rotating segments, 100% within 84 days. SLA is explicit, auditable via scope_descriptor. Alerts without logestado are covered by all tiers and tracked in correlation_issues.

6. **Durable backlog.** Upper bound is the persisted watermark, not the current cycle's outcome. Backlog from prior successful logestado runs is always available for consumption.

7. **Cycle traceability.** First-class cycle entity, causal upstream links, reconciliation scope descriptors. Every audit question (which cycle, which upstream, which tier, which scope) has a single-query answer.

Schema changes are required and explicitly declared. One new table, four new columns, four modified constraints, five new indexes, one data correction. All additive. All safe on the current 0-row state of destination tables.

The document is ready for re-audit. If Codex approves, the next step is Fase 9.3-schema: authoring the migration files for the declared DDL changes, followed by Fase 9.4 authorization.

---

**End of document.**
