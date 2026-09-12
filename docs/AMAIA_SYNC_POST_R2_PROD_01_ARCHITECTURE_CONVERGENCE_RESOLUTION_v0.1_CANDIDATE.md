# AMAIA-SYNC — POST-R2-PROD-01
## ARCHITECTURE CONVERGENCE RESOLUTION v0.1 CANDIDATE

**Status:** CANDIDATE — NOT RATIFIED  
**Purpose:** preserve the review/convergence record that produced `AUTONOMOUS_PIPELINE_ARCHITECTURE_v0.2_CANDIDATE` from v0.1.  
**FRA:** Roberto  
**Architecture owner/adjudicator:** Principal Architect  
**Reviewed architecture:** `AMAIA_SYNC_POST_R2_AUTONOMOUS_PIPELINE_ARCHITECTURE_v0.1_CANDIDATE.md`  
**v0.1 commit:** `110741d500bc932b73e1a5d0c58aedbd87be79c0`  
**Consolidated successor candidate:** `AMAIA_SYNC_POST_R2_AUTONOMOUS_PIPELINE_ARCHITECTURE_v0.2_CANDIDATE.md`

---

## 1. Review inputs

v0.1 was subjected to four independent/relevant review tracks before consolidation:

| Reviewer | Role | Result |
|---|---|---|
| Codex | Physical repository/runtime inventory | `PHYSICAL_INVENTORY_PARTIAL` |
| Kimi K3 | Forensic engineer / adversarial technical reviewer | `SOUND_WITH_REQUIRED_AMENDMENTS` |
| Max | Independent hostile architecture auditor | `REJECT_REQUIRES_ARCHITECTURE_REVISION` |
| Claude | Contract / architecture specification reviewer | `REQUIRES_ARCHITECTURE_AMENDMENTS` / `READY_FOR_CONVERGENCE` |

The results differ in severity threshold but converge materially on the same load-bearing gaps. No review authorized implementation. v0.1 remained unmodified.

---

## 2. Physical facts established by Codex

The following facts materially constrain the successor architecture:

1. The local HPSoporte checkout is not a clean representation of `origin/main`; it contains divergent local history plus modified/untracked runtime work and must be preserved/inventoried before destructive Git actions.
2. Existing `amaia-sync-runtime` contains substantial runtime components, including AMAIA reader/client, domain hook, DomainRunner, runtime orchestration and authority/lease-related machinery, but the physically executable entrypoint does not currently wire an end-to-end AMAIA → Supabase → Seguimientos path.
3. Existing runtime persistence targets include an `amaia_call_logs` path, while the R2 application pipeline that was operationally audited uses `raw_call_logs → call_correlations → followup_events → beneficiary status/workspace`. These paths are not demonstrated equivalent.
4. Watermark/run-control schema exists physically but is not demonstrated as a fully wired production settlement ledger.
5. A Dockerfile exists, but no production compose/systemd/timer deployment is demonstrated in the inspected Windows checkout.
6. AMAIASQL host state, actual tunnel, listener 3307, systemd state and remote Supabase grants were not physically inspected in that review and therefore remain P0 facts to verify, not assumptions.

Resolution effect: v0.2 explicitly treats existing runtime as predecessor/substrate, `raw_call_logs` as canonical operational raw gateway candidate, and splits P0 into repository, AMAIASQL and Supabase physical inventories.

---

## 3. Technical hazards established by Kimi K3

Kimi's review identified the following architecture-level hazards requiring amendment:

1. A simple `id > watermark` source cursor is not sufficient proof of no silent gaps because MySQL/InnoDB visibility/commit order can differ from id allocation order.
2. Late/backfilled/updated source rows need overlap and anti-entropy behavior beyond a one-way frontier.
3. Existing lease/fencing machinery must be reconciled with the proposed one-shot execution model rather than silently discarded.
4. Watermark persistence requires single-writer fencing and monotonic protection.
5. Required derived-state recomputation cannot be allowed to remain silently incomplete after raw persistence/watermark settlement.
6. Timestamp-driven domains require deterministic tie-breaks and explicit timezone normalization.
7. Page/batch size cannot become an accidental per-run backlog ceiling.
8. Manual and scheduled invocation need a shared authority/concurrency contract.
9. Acceptance testing must prove replay convergence, out-of-order recovery, split-settlement recovery, dual-runner rejection, backlog drain and DST correctness.
10. Future Net2phone ingestion must participate in the same reconciliation/derived-state writer discipline.

Resolution effect: all points above are incorporated into v0.2 as explicit architecture invariants or acceptance tests.

---

## 4. Hostile operational hazards established by Max

Max added/strengthened these requirements:

1. Scheduler silence is itself a failure mode; autonomy requires a dead-man mechanism external to the missing run.
2. Tunnel/process liveness is insufficient; health must prove a real bounded source query succeeds.
3. Disk/log growth must be bounded and monitored; unattended evidence generation cannot be allowed to exhaust the node.
4. At-most-one writer is a blocker-level requirement covering scheduled/manual/duplicate/stale runners.
5. Late/out-of-order source data is a blocker-level threat to the no-silent-gap claim.
6. Durable time semantics must distinguish UTC persistence/comparison from America/Santiago business scheduling/source interpretation.
7. Seguimientos must expose meaningful data freshness rather than silently presenting indefinitely stale data.
8. Correction/replay semantics must preserve source history while allowing derived truth to be rebuilt/superseded.
9. A point-in-time demo is insufficient to prove autonomy; sustained unattended soak and injected-failure alerting are required.
10. AMAIASQL is a single integration-node dependency; this is acceptable only if explicitly acknowledged and reconstructible rather than silently presented as HA.

Resolution effect: v0.2 includes dead-man monitoring, real source probe, storage hygiene, freshness, historical correction, unattended soak, alerting, and explicit accepted single-node dependency/reconstruction semantics.

---

## 5. Contract/security gaps established by Claude

Claude established three blocker-class omissions and related contract gaps:

1. v0.1 failed to explicitly reconcile the new one-shot architecture with the already-existing runtime/lease/authority lifecycle.
2. v0.1 lacked an explicit at-most-one-writer invariant despite scheduled + manual execution being permitted.
3. Existing legacy destination RPCs can require authenticated human admin identity, which an unattended service worker cannot legitimately supply; the architecture must define a dedicated server-to-server least-privilege write identity/path.
4. A blanket Supabase `service_role` key is inconsistent with the program's narrow PI-01D role/grant discipline as an ordinary runtime identity.
5. Normative cross-references to "existing ratified batch semantics" must identify exact authority rather than rely on institutional memory.
6. Run terminal-state vocabulary must be closed and governed, but beneficiary PA-GRACE state vocabulary must not be confused with runtime terminal state.
7. Settlement granularity/obligations need architecture-level definition.
8. systemd/cadence choices should either be architectural decisions or fully deferred; the mixed wording in v0.1 was inconsistent.
9. Alerting/staleness obligations are required for unattended operation.
10. PI-01D lineage/conflict mechanisms should be reused rather than creating parallel taxonomies/gates.
11. Unexpected source/schema drift requires fail-closed semantics.
12. UTC/timezone handling must be explicit.

Resolution effect: v0.2 adopts systemd as a binding host scheduling/connectivity-supervision architecture choice, mandates a dedicated least-privilege unattended Supabase identity, forbids ordinary human-admin or blanket service-role dependency, requires exact authority references in the blueprint, reuses PI-01D lineage/conflict discipline, and adds schema-drift fail-closed behavior.

---

## 6. Principal Architect convergence adjudications

The following candidate adjudications were incorporated into v0.2. They remain subject to FRA ratification as part of that architecture.

### PA-CNV-01 — Canonical raw gateway

`raw_call_logs` is the canonical multi-source raw call-evidence gateway for the operational path. Existing `amaia_call_logs` SHALL NOT become a second parallel operational truth without explicit adjudication.

### PA-CNV-02 — Runtime preservation

Existing U4–U8 / lease / AVLM / fencing / heartbeat / shutdown work is predecessor/substrate work and SHALL be reconciled rather than replaced gratuitously.

### PA-CNV-03 — Execution envelope

Production sync is a one-shot Docker workload. systemd owns invocation timing. Existing runtime safety machinery owns governed execution/authority.

### PA-CNV-04 — Persistent source link

AMAIA source connectivity is host-native, systemd-managed and independent of Docker. Exact `ssh`/equivalent command mechanics remain blueprint work.

### PA-CNV-05 — Real source health

A live process/socket is insufficient. Healthy source connectivity requires a real bounded readonly AMAIA query.

### PA-CNV-06 — Single-writer authority

At most one scheduled/manual/recovery/stale execution may hold write authority over a governed source domain/watermark.

### PA-CNV-07 — Fencing + monotonic watermark

Settlement must be fenced. Persistence must prevent watermark regression even under stale-writer attempts.

### PA-CNV-08 — Cursor humility

AMAIA ids/timestamps SHALL NOT be assumed commit-order-safe. Incremental extraction must include overlap plus periodic anti-entropy/reconciliation.

### PA-CNV-09 — Time contract

Durable run/settlement/watermark/comparison instants are UTC. AMAIA timezone-less local DATETIME values are interpreted under the governed America/Santiago source-time contract unless physical evidence proves otherwise.

### PA-CNV-10 — Backlog drain

Page/batch size controls transaction/resource shape; it does not silently cap per-run progress. Remaining backlog must be drained or durably visible when a governed runtime bound is reached.

### PA-CNV-11 — Derived-state completion

A source interval is not operationally complete if required derived-state work can be forgotten. Derived work must settle atomically or be represented by a durable automatic repair obligation.

### PA-CNV-12 — Unattended Supabase identity

The worker uses a narrowly scoped server-side identity/write path consistent with PI-01D least-privilege discipline. No human-admin impersonation and no blanket `service_role` key as the ordinary runtime identity.

### PA-CNV-13 — Run ledger

Every run has durable run-id/version/authority/source/count/watermark/terminal evidence. Logs/metrics alone are insufficient.

### PA-CNV-14 — Closed runtime states

Runtime terminal-state vocabulary must be closed and reconciled against existing ratified runtime semantics. Beneficiary PA-GRACE states are not runtime terminal states.

### PA-CNV-15 — Dead-man autonomy

Expected runs that never occur must be detectable independently of the missing run itself.

### PA-CNV-16 — Storage hygiene

Host logs are bounded/rotated and disk pressure is part of health/degraded-state detection.

### PA-CNV-17 — Schema drift

Unexpected governed source shape fails closed; required evidence is not silently coerced away while watermark advances.

### PA-CNV-18 — Historical integrity

Canonical raw/source evidence preserves lineage; semantic corrections rebuild/supersede derived truth rather than deleting/reinventing historical evidence.

### PA-CNV-19 — UI freshness

Seguimientos remains Supabase-only and exposes a reliable last-success/data-freshness reference; indefinite stale-as-current presentation is not acceptable.

### PA-CNV-20 — Accepted AMAIASQL dependency

AMAIASQL remains a single integration node for this phase. Active-active HA is out of scope, but the node must be reconstructible and catch-up capable from governed artifacts + durable source/Supabase state.

### PA-CNV-21 — Future Net2phone path

Net2phone remains a future independent historical/pull completeness and recovery source using the same canonical raw layer, PI-01D lineage/authority/conflict discipline, and derived-state convergence rules.

---

## 7. Review points explicitly NOT over-adjudicated

The convergence intentionally does not choose physical values that require P0 evidence or blueprint analysis, including:

- OpenSSH vs autossh exact mechanism;
- exact overlap size `K` or time window;
- anti-entropy cadence/window;
- exact page size/max runtime;
- exact run-ledger DDL;
- exact closed runtime terminal-state labels before mechanical reconciliation with U5–U8;
- exact Supabase function/RPC signatures and grants before remote authority inventory;
- exact disk thresholds/log retention;
- exact alert destination;
- exact AMAIASQL reconstruction RTO;
- Net2phone API version/authentication.

These are not omissions from architecture; they are deliberately constrained blueprint/inventory questions.

---

## 8. Supersession semantics

v0.1 SHALL remain byte-identical as historical evidence.

v0.2 is a successor **candidate**, not yet authoritative.

Until FRA ratifies v0.2:

- v0.1 is not retroactively changed;
- v0.2 is not production authority;
- implementation remains STOP;
- no review result itself authorizes code, database, Docker, systemd or host mutation.

If FRA ratifies v0.2, v0.2 supersedes v0.1 architecturally while preserving the complete review/convergence record.

---

## 9. Required next gate

Before FRA ratification is requested, v0.2 SHOULD receive a short differential review focused on whether the blocker/major findings above are actually closed without introducing contradictory new semantics.

Recommended reviewers:

- Max — hostile differential audit;
- Kimi K3 — technical/failure-mode differential audit;
- Claude — contract-completeness differential audit.

No reviewer approves its own authored implementation; FRA remains Roberto.

---

## 10. Candidate disposition

**CONVERGENCE COMPLETE — v0.2 MATERIALIZED — DIFFERENTIAL REVIEW REQUIRED — NOT RATIFIED — IMPLEMENTATION STOP.**
