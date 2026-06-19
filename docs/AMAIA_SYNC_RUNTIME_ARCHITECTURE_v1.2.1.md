# AMAIA-SYNC Runtime Architecture v1.2.1

**Phase:** 9.3 Rev.4  
**Status:** Design — no implementation  
**Supersedes:** AMAIA_SYNC_RUNTIME_ARCHITECTURE_v1.2.md (surgical revision, 3 corrections)  
**Prerequisite phases:** 9.1D (closed), 9.2 (deployed, commit f5cd978)  
**Author:** Claude (cirujano principal)  
**Auditor:** Codex (auditor forense)  
**Date:** 2026-06-18

---

## Scope of this revision

This document is a surgical revision of v1.2. All content from v1.2 is incorporated by reference unless explicitly superseded below. Specifically:

- v1.2 Corrections 1, 5, 6, 7: **unchanged**.
- v1.2 Schema Gap Analysis: **unchanged** (no new DDL beyond what v1.2 already declared).
- v1.2 Open Risks 1-4: **unchanged**.

Three observations are addressed:

| ID | Observation | Affected v1.2 section |
|---|---|---|
| A | Workset integrity validation covers only NULL, not unresolvable references | Correction 2 |
| B | Resurrection contract contains a self-contradiction between the formal rule and Path A | Correction 4 |
| C | Multi-lease acquisition lacks a global ordering rule (deadlock vector) | Correction 3 |

---

## Correction A: Expanded Workset Integrity Validation

**Supersedes:** v1.2 Correction 2 sections "Invariant" and "Pre-validation scan". All other subsections of Correction 2 (Consequences of failure, Why fail-closed is correct, Interaction with retry, Interaction with orphan recovery, Schema impact) remain unchanged.

### Problem

v1.2 defined the fail-closed invariant as:

> The alerta trigger cursor MUST NOT advance past any amaia_alert_logs.amaia_id within its consumption range for which alert_amaia_id is NULL.

This covers only one failure mode. A row with alert_amaia_id = 99999999 — a non-null integer that references no existing alert in amaia_alerts — passes the NULL check but produces a workset entry that cannot be materialized. The alerta processor would attempt to fetch alert 99999999 from AMAIA, receive no result, and either skip it silently (fail-open) or fail the entire batch (fail-closed but for the wrong reason, with no pre-validation signal).

### Revised definition: What constitutes an invalid alert_amaia_id

An alert_amaia_id value within the consumption range (N, M] is **invalid** if any of the following are true:

1. **NULL.** The logestado entry has no alert reference. The row cannot contribute to the workset.

2. **Negative or zero.** AMAIA alert primary keys are positive integers. A non-positive value is outside the domain of valid identifiers.

3. **Unresolvable against amaia_alerts.** The alert_amaia_id does not exist as an amaia_id in the amaia_alerts table in Supabase. This means either: (a) the alert has not yet been synced (ordering issue — the alert should exist if logestado references it, per the 9.1D finding that logestado entries correspond to existing alerts), or (b) the alert_amaia_id is a phantom reference (data corruption or AMAIA-side referential integrity issue).

### Revised invariant

**The alerta trigger cursor MUST NOT advance past any amaia_alert_logs.amaia_id within its consumption range (N, M] for which alert_amaia_id is invalid, where invalid means NULL, non-positive, or unresolvable against amaia_alerts.amaia_id.**

### Revised pre-validation scan

The pre-validation scan is a two-phase check executed before workset derivation:

**Phase 1: Structural validity.** Count rows in amaia_alert_logs where amaia_id > N AND amaia_id <= M AND (alert_amaia_id IS NULL OR alert_amaia_id <= 0).

If count > 0: immediate failure. reason_code = 'WORKSET_INTEGRITY_FAILURE'. Anomalous rows recorded in amaia_correlation_issues with issue_type = 'dato_inconsistente' and details documenting the specific amaia_alert_logs.amaia_id values and the nature of the invalidity.

**Phase 2: Referential validity.** Derive the candidate workset: SELECT DISTINCT alert_amaia_id FROM amaia_alert_logs WHERE amaia_id > N AND amaia_id <= M AND alert_amaia_id > 0. Then verify every alert_amaia_id in this set exists in amaia_alerts: check that the count of alert_amaia_id values NOT IN (SELECT amaia_id FROM amaia_alerts WHERE amaia_id IN (...candidate set...)) is zero.

If count > 0: immediate failure. reason_code = 'WORKSET_INTEGRITY_FAILURE'. The unresolvable alert_amaia_id values are recorded in amaia_correlation_issues. The trigger cursor does NOT advance.

**If both phases pass:** The workset is the validated candidate set. Processing proceeds.

### Interaction with ordering

Phase 2 failure may occur legitimately if:
- A new alert appeared in AMAIA and generated a logestado entry.
- The logestado entry was synced (amaia_alert_logs now has it).
- But the alert itself has not been synced yet to amaia_alerts (because the alerta domain's sync cycle hasn't run yet for this alert — this is the indirect detection mechanism).

This is a timing issue, not a data corruption issue. The alerta processor encounters a logestado entry referencing an alert that the sync engine hasn't yet fetched from AMAIA.

**Resolution:** The fail-closed behavior is still correct. The workset is rejected. On the next cycle, the ordering constraint (logestado runs before alerta) combined with the normal incremental processing means the alert will likely have been fetched via a previous cycle's workset, or it's a genuinely new alert that hasn't been synced yet.

However, this creates a potential livelock: the unresolvable alert blocks the cursor, but the cursor must advance past the logestado entry for the alert to appear in a future workset. This circular dependency is broken by the following rule:

**First-cycle exception for new alerts.** When Phase 2 detects unresolvable alert_amaia_id values, the alerta processor distinguishes between two cases:

**(a) The alert_amaia_id exists in AMAIA (verifiable by a direct primary-key lookup against AMAIA MySQL).** This is a timing issue. The alert exists in AMAIA but has not yet been synced to Supabase. The processor fetches it directly from AMAIA, upserts it to amaia_alerts, and re-runs the Phase 2 check. If the alert now resolves, processing proceeds. If it still fails (e.g., the AMAIA lookup itself failed), the run fails with WORKSET_INTEGRITY_FAILURE.

**(b) The alert_amaia_id does NOT exist in AMAIA.** This is a genuine phantom reference. The logestado entry references an alert that never existed. The run fails with WORKSET_INTEGRITY_FAILURE. The anomaly is recorded in amaia_correlation_issues.

This distinction preserves fail-closed semantics for genuine data issues while handling the legitimate timing case of new alerts appearing via logestado before their first direct sync.

### Schema impact

No additional DDL beyond what v1.2 already declared (reason_code CHECK extension to include 'WORKSET_INTEGRITY_FAILURE').

---

## Correction B: Consistent Resurrection Contract

**Supersedes:** v1.2 Correction 4 sections "Architectural correction", "State machine", and "Resurrection lifecycle (Path A)". All other subsections of Correction 4 (Resurrection lifecycle Path B, Refresh phase, Visibility contract, Maximum staleness window, Schema impact) remain unchanged.

### Problem

v1.2 states:

> No row transitions directly from any inactive state to 'active'. The transition to 'active' occurs only as part of an upsert that carries fresh AMAIA data.

Then defines Path A as:

> The upsert writes fresh AMAIA field data AND sets sync_status = 'active' in the same transaction. [...] There is no intermediate state.

These two statements are formally contradictory. The first sentence says "no direct transition." Path A performs a direct transition (inactive_confirmed → active). The fact that the transition is accompanied by fresh data does not change the fact that it is direct — there is no intermediate reactivation_pending state in Path A.

The behavior described in Path A is correct. The formal rule is wrong.

### Revised formal rule

**The prohibition is not on the state transition path. The prohibition is on the data condition at the moment of activation.**

Restated:

**A row MUST NOT have sync_status = 'active' unless its domain field data reflects a confirmed AMAIA source fetch. The mechanism that enforces this guarantee differs by detection path, but the invariant is the same: active implies fresh.**

### Revised state machine (supersedes v1.2 state machine)

Destination row sync_status values: `active`, `missing_pending_confirmation`, `inactive_confirmed`, `reactivation_pending`.

Tombstone event transitions: `detected`, `confirmed`, `reverted`, `ignored` (unchanged from deployed schema).

**Normal lifecycle:** unchanged from v1.2.

**Resurrection — formal invariant:**

The following transitions to `active` are permitted:

| From state | Condition | Intermediate state required? | Justification |
|---|---|---|---|
| missing_pending_confirmation | Upsert with fresh AMAIA data in the same transaction | No | The upsert IS the evidence of fresh data. The write is atomic: field data and status change commit together. |
| inactive_confirmed | Upsert with fresh AMAIA data in the same transaction | No | Same as above. |
| reactivation_pending | Upsert with fresh AMAIA data in the same transaction | No (reactivation_pending is already the intermediate state from a prior detection) | The row was already flagged; now it's being refreshed. |

The following transitions to `active` are **prohibited**:

| From state | Condition | Why prohibited |
|---|---|---|
| missing_pending_confirmation | Without upsert of fresh AMAIA data | Row would be active with data from before deactivation. |
| inactive_confirmed | Without upsert of fresh AMAIA data | Same. |
| reactivation_pending | Without upsert of fresh AMAIA data | Row was already flagged as needing refresh; activating without refresh defeats the purpose. |

**The discriminator is not "which state did the row come from" but "does the activating operation include a confirmed upsert of fresh AMAIA source data."**

### Revised Path A (detected by incremental sync)

When a domain processor fetches a row from AMAIA whose amaia_id exists in Supabase with sync_status ∈ {missing_pending_confirmation, inactive_confirmed, reactivation_pending}:

1. The processor already holds fresh AMAIA data (it was just fetched as part of the incremental window or the reactivation_pending secondary query).
2. The upsert writes the fresh field data AND sets sync_status = 'active' in the same transaction.
3. A tombstone_events row with transition = 'reverted' is recorded.
4. No intermediate reactivation_pending state is needed because the fresh data and the status change are atomic. The invariant "active implies fresh" is satisfied by the transaction itself.

### Revised Path B (detected by reconciliation)

Unchanged from v1.2. Reconciliation cannot provide fresh AMAIA field data (it does not write domain data). Therefore:

1. Reconciliation sets sync_status = 'reactivation_pending'. This is the intermediate state.
2. A tombstone_events row with transition = 'reverted' is recorded.
3. The domain processor refreshes the row on the next sync cycle, setting sync_status = 'active' with fresh data.

### When is reactivation_pending used?

**Exclusively when the detecting process cannot provide fresh AMAIA field data in the same operation.** In the current architecture, this means:

- Reconciliation Engine: detects reappearance but does not write domain data → uses reactivation_pending.
- Domain Processor: detects reappearance and simultaneously upserts fresh data → does NOT use reactivation_pending, goes directly to active.

If a future process detects reappearance without access to fresh AMAIA data, it MUST use reactivation_pending. This is a general rule, not specific to reconciliation.

### Summary of the correction

The contradiction in v1.2 was between a path-based rule ("no direct transition") and a data-based reality ("the upsert carries fresh data"). v1.2.1 replaces the path-based rule with a data-based invariant: **active implies fresh, enforced at the point of transition, regardless of which state the row came from.** The reactivation_pending state exists to bridge the gap when detection and refresh are separated in time — it is not a mandatory waypoint for all resurrection paths.

### Schema impact

None beyond what v1.2 already declared. The reactivation_pending value in the sync_status CHECK constraint is still required (for Path B). No additional DDL.

---

## Correction C: Global Lease Ordering Rule

**Supersedes:** v1.2 Correction 3 subsection "Processing order for multi-domain reconciliation". All other subsections of Correction 3 (Finding, Architectural correction, Acquisition, Heartbeat, Release, Mutual exclusion guarantee, Impact on sync throughput, Schema impact) remain unchanged.

### Problem

v1.2 specifies that the Reconciliation Engine acquires logestado lease first, then alerta lease, when reconciling the dependent pair. But no global ordering rule is defined. If a future process (e.g., a manual intervention tool, a V2 cross-domain processor, or a recovery workflow) acquires alerta first, then logestado, and the Reconciliation Engine simultaneously acquires logestado first, then alerta, a deadlock occurs:

- Process X holds alerta, waits for logestado.
- Reconciliation holds logestado, waits for alerta.
- Neither can proceed.

This is a classic dining-philosophers deadlock. The v1.2 document's specific ordering for reconciliation is correct but insufficient — it must be generalized.

### Global Lease Ordering Rule

**Any process that must hold more than one domain lease simultaneously MUST acquire them in the canonical order defined below. No exceptions. This rule applies to all current and future components: sync, reconciliation, recovery, manual intervention, and any V2 additions.**

### Canonical order

Leases are acquired in the following fixed order, from first to last:

| Position | entity_name | Rationale |
|---|---|---|
| 1 | beneficiario | Root entity. Referenced by all dependent domains. |
| 2 | red | Depends on beneficiario. |
| 3 | enfermedades | Depends on beneficiario. |
| 4 | medicamentos | Depends on beneficiario. |
| 5 | control_llamadas | Independent domain. Positioned by convention. |
| 6 | logestado | Feeds alerta. Must be locked before alerta. |
| 7 | alerta | Depends on logestado. Terminal position. |

The ordering is derived from the domain dependency graph (Appendix B of v1.0). Domains with no mutual dependency are ordered by convention to ensure a single deterministic sequence. The specific order of positions 2-4 and position 5 is arbitrary but fixed — what matters is that it is universal and immutable.

### Formal invariant

**If a process holds lease L_i and needs to acquire lease L_j, it MUST be the case that position(L_j) > position(L_i). If position(L_j) < position(L_i), the process MUST release L_i (and any other held leases with position > position(L_j)) before acquiring L_j, then re-acquire in canonical order.**

This invariant makes deadlock structurally impossible: all processes acquire in the same direction, so no cycle can form in the wait-for graph.

### Application to reconciliation

The Reconciliation Engine's multi-lease acquisition for dependent pairs now follows the global rule:

- Reconciling alerta (dependent on logestado): acquire logestado (position 6), then alerta (position 7). This is canonical order. Correct.
- Reconciling red (dependent on beneficiario): acquire beneficiario (position 1), then red (position 2). Canonical order. Correct.
- Reconciling enfermedades: acquire beneficiario (position 1), then enfermedades (position 3). Canonical order. Correct.

### Application to sync

The Scheduler processes domains sequentially and holds at most one lease at a time (per v1.0 Section 1.1). The ordering rule is trivially satisfied when only one lease is held. If a future V2 Scheduler processes domains in parallel and needs to hold multiple leases, it must follow the canonical order.

### Application to recovery

Orphan recovery acquires a single domain lease at a time. The ordering rule is trivially satisfied. If a future recovery process needs to coordinate across domains (e.g., recovering an orphaned alerta run that also requires logestado state inspection), it must acquire logestado (6) before alerta (7).

### Application to manual intervention

Any operator tool or ad-hoc process that acquires leases must follow the canonical order. The operational runbook must document this requirement. A tool that acquires leases in an arbitrary order is a bug.

### Extending the ordering

If a new domain is added to AMAIA-SYNC in V2:
1. Determine its position in the dependency graph.
2. Assign it a position number that preserves the topological order (insert between existing positions or append at the end).
3. Update the canonical order table.
4. All existing processes automatically respect the new domain's position because they follow the rule.

### Schema impact

None. The ordering rule is an application-layer invariant. It does not require schema changes. It is enforced by the Lease Manager's acquisition API: a process declares which leases it needs, and the Lease Manager acquires them in canonical order, returning an error if the request would violate the ordering.

---

## Updated Traceability Table

This table extends the v1.2 Hallazgo Codex table with the three v1.2.1 observations.

| # | Hallazgo | Source | Severidad | Resolución | Schema impact | Closed? |
|---|---|---|---|---|---|---|
| 1 | Lease ownership validates only lease_token | Codex v1.1 audit | Critical | 4-part ownership predicate (v1.2 C1, unchanged) | None | Yes |
| 2 | Alerta workset vulnerable to silent loss | Codex v1.1 audit | Critical | Fail-closed pre-validation (v1.2 C2, **extended in v1.2.1 Correction A**) | DDL: reason_code CHECK | Yes |
| 3 | Reconciliation TOCTOU | Codex v1.1 audit | Critical | Lease participant (v1.2 C3, **ordering added in v1.2.1 Correction C**) | None | Yes |
| 4 | Tombstone resurrection exposes stale data | Codex v1.1 audit | Critical | Source-wins resurrection (v1.2 C4, **contract reformulated in v1.2.1 Correction B**) | DDL: sync_status CHECK ×3 | Yes |
| 5 | Tier 4 sampling not deterministic | Codex v1.1 audit | Critical | Rotating 12-segment window (v1.2 C5, unchanged) | DDL: scope_descriptor column | Yes |
| 6 | Alerta backlog blocked by current-cycle failure | Codex v1.1 audit | Critical | Persisted watermark as upper bound (v1.2 C6, unchanged) | None | Yes |
| 7 | No durable cycle/upstream/tier traceability | Codex v1.1 audit | Critical | amaia_sync_cycles + cycle_id + upstream_run_id + scope_descriptor (v1.2 C7, unchanged) | DDL: 1 table, 4 cols, 5 idx | Yes |
| A | Workset validation covers only NULL, not unresolvable references | Internal review v1.2 | Medium | Two-phase validation: structural (NULL/non-positive) + referential (exists in amaia_alerts). First-cycle exception for timing-related unresolvable alerts (AMAIA lookup + on-demand sync). | None (within v1.2 DDL) | Yes |
| B | Resurrection contract self-contradiction (Path A vs formal rule) | Internal review v1.2 | Medium | Formal rule reformulated from path-based to data-based: "active implies fresh." Path A is direct (no intermediate state) because the upsert carries fresh data. reactivation_pending is required only when detection and refresh are separated. | None (within v1.2 DDL) | Yes |
| C | Multi-lease acquisition lacks global ordering (deadlock vector) | Internal review v1.2 | Medium | Universal canonical lease ordering: beneficiario(1) → red(2) → enfermedades(3) → medicamentos(4) → control_llamadas(5) → logestado(6) → alerta(7). Structurally prevents deadlock. Applies to all processes, current and future. | None | Yes |

---

## Impact assessment

### What changed from v1.2

| Area | v1.2 | v1.2.1 |
|---|---|---|
| Workset pre-validation | Single-phase: NULL check only | Two-phase: structural validity (NULL + non-positive) + referential validity (exists in amaia_alerts). First-cycle AMAIA lookup for timing-related unresolvable references. |
| Resurrection formal rule | "No direct transition from inactive to active" | "Active implies fresh: sync_status = 'active' requires a confirmed upsert of fresh AMAIA data in the same transaction, regardless of origin state." |
| Path A behavior | Same as v1.2.1 (direct transition with fresh data) | Unchanged behavior, but now consistent with the formal rule. |
| reactivation_pending usage | Implied mandatory for all resurrection | Explicit: required only when detection and refresh are separated (Path B). Not required when the detecting operation itself provides fresh data (Path A). |
| Multi-lease ordering | Specific to reconciliation of logestado+alerta pair | Universal canonical ordering for all processes, all domains. Derived from dependency graph. |

### What did NOT change from v1.2

- Ownership predicate (Correction 1)
- Deterministic historical coverage (Correction 5)
- Durable backlog semantics (Correction 6)
- Cycle traceability schema (Correction 7)
- Schema Gap Analysis (all DDL declarations)
- Open Risks 1-4
- All v1.0/v1.1 inherited architecture

### Additional DDL required beyond v1.2

**None.** All three corrections in v1.2.1 operate within the DDL envelope already declared in v1.2. The two-phase workset validation uses the same WORKSET_INTEGRITY_FAILURE reason_code. The resurrection reformulation uses the same reactivation_pending sync_status value. The global lease ordering is an application-layer invariant with no schema footprint.

---

**End of document.**
