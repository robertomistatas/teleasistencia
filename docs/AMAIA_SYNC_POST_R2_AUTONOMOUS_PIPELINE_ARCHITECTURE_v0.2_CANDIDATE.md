# AMAIA-SYNC — POST-R2 AUTONOMOUS PIPELINE ARCHITECTURE v0.2 CANDIDATE

**Status:** CANDIDATE — NOT RATIFIED  
**Program:** POST-R2-PROD-01 — Productionization & Sanitization  
**Final Ratification Authority (FRA):** Roberto  
**Architecture owner:** Principal Architect  
**Predecessor:** `AMAIA_SYNC_POST_R2_AUTONOMOUS_PIPELINE_ARCHITECTURE_v0.1_CANDIDATE.md`  
**v0.1 commit:** `110741d500bc932b73e1a5d0c58aedbd87be79c0`  
**Baseline `origin/main` referenced by v0.1:** `a92dd43818973eafbde550841e0ff84a60695b32`  
**Primary objective:** autonomous, auditable, recoverable and unattended data path `AMAIA → AMAIASQL → Supabase → Seguimientos`, with 24/7 AMAIA connectivity and an explicit future Net2phone recovery/reconciliation extension point.

---

## 1. Executive intent

R2 has passed operational audit. POST-R2-PROD-01 converts the proven operational behavior into a production-grade autonomous service.

The production system SHALL:

- keep the AMAIA source-connectivity layer available 24/7 on AMAIASQL;
- perform synchronization automatically without human-triggered normal operation;
- extract incrementally while protecting against late/out-of-order source visibility;
- settle evidence idempotently and under single-writer authority;
- publish canonical operational evidence to Supabase;
- cause derived follow-up state to converge automatically;
- expose sufficient durable evidence to prove every run and detect the absence of expected runs;
- keep Seguimientos as a Supabase-only consumer;
- preserve an explicit future independent path for Net2phone CDR/API ingestion and reconciliation.

Normal operation SHALL NOT require any person to open a shell, start an SSH tunnel, upload a spreadsheet, run an ad-hoc SQL command, start a container manually, recalculate follow-up state manually, or impersonate a human administrator.

---

## 2. Non-negotiable production acceptance outcome

POST-R2-PROD-01 cannot be declared CLOSED until the following end-to-end demonstration succeeds:

1. A valid new governed source event exists in AMAIA.
2. No human initiates synchronization.
3. AMAIASQL maintains/recovers the source connection automatically.
4. The scheduled one-shot sync starts automatically.
5. The run obtains exclusive write authority for the governed domain/watermark.
6. Source evidence is extracted under the governed incremental + overlap/anti-entropy rules.
7. Canonical source evidence is persisted idempotently in Supabase.
8. Correlation / attribution / follow-up generation / operational-state recomputation complete, or a durable repair obligation is atomically recorded so the system must finish automatically later.
9. The governed watermark advances only after the settlement contract permits it.
10. Seguimientos, without direct AMAIA/AMAIASQL access and without application restart, exposes the updated operational result on its normal refresh/fetch path.
11. A durable run record proves source range, counts, authority, settlement, watermark transition, version and terminal state.
12. The system remains capable of detecting missed schedules, stale source connectivity, disk pressure and repeated failures without relying on an operator watching a terminal.

This is the canonical end-to-end acceptance gate.

---

## 3. Target architecture

```text
                         PRIMARY BUSINESS SOURCE
                    ┌────────────────────────────┐
                    │       AMAIA PRODUCTION     │
                    │                            │
                    │ MySQL                      │
                    │ control_llamadas           │
                    │ beneficiary/device data    │
                    └──────────────┬─────────────┘
                                   │
                                   │ SSH forward / readonly MySQL
                                   ▼
╔══════════════════════════════════════════════════════════════════╗
║                           AMAIASQL                              ║
║                      Ubuntu integration node                   ║
║                                                                ║
║  HOST / SYSTEMD                                                ║
║  ┌──────────────────────────────────────────────────────────┐  ║
║  │ AMAIA CONNECTIVITY SERVICE                              │  ║
║  │ • host-native managed SSH link                          │  ║
║  │ • available 24/7                                       │  ║
║  │ • starts after reboot/network readiness                 │  ║
║  │ • reconnects automatically                              │  ║
║  │ • readonly source access                                │  ║
║  │ • source-query health probe (not PID-only health)       │  ║
║  └──────────────────────────┬───────────────────────────────┘  ║
║                             │ protected local endpoint          ║
║                             ▼                                   ║
║  HOST / SYSTEMD                                                ║
║  ┌──────────────────────────────────────────────────────────┐  ║
║  │ SCHEDULER + DEAD-MAN HEALTH                             │  ║
║  │ • initial cadence: 06:00 / 18:00 America/Santiago      │  ║
║  │ • owns WHEN execution occurs                            │  ║
║  │ • detects when an expected run did not occur            │  ║
║  └──────────────────────────┬───────────────────────────────┘  ║
║                             │                                   ║
║                             ▼                                   ║
║  DOCKER                                                        ║
║  ┌──────────────────────────────────────────────────────────┐  ║
║  │ amaia-sync — ONE-SHOT                                  │  ║
║  │ • reuses/reconciles existing runtime substrate U4–U8   │  ║
║  │ • run-scope authority / lease / fencing                │  ║
║  │ • incremental + overlap source reads                    │  ║
║  │ • canonical raw persistence                             │  ║
║  │ • correlation / PI-01D attribution                      │  ║
║  │ • follow-up generation / state convergence              │  ║
║  │ • durable run evidence                                  │  ║
║  │ • exits after caught-up or governed runtime bound       │  ║
║  └──────────────────────────┬───────────────────────────────┘  ║
╚═════════════════════════════╪════════════════════════════════════╝
                              │ authenticated least-privilege
                              │ server-to-server write path
                              ▼
                    ┌───────────────────────────┐
                    │          SUPABASE         │
                    │                           │
                    │ raw_call_logs             │
                    │ source lineage            │
                    │ correlations              │
                    │ followup_events           │
                    │ beneficiary status        │
                    │ operational views         │
                    │ run ledger / watermarks   │
                    │ health evidence           │
                    └────────────┬──────────────┘
                                 │ Supabase API
                                 ▼
                        ┌──────────────────┐
                        │  SEGUIMIENTOS    │
                        │     WebApp       │
                        │                  │
                        │ dashboard        │
                        │ operators        │
                        │ audit            │
                        │ management       │
                        └──────────────────┘

          FUTURE INDEPENDENT COMPLETENESS / RECOVERY PATH

                         Net2phone CDR API
                                 │
                                 ▼
                      net2phone-ingestor
                                 │
                                 ▼
                       canonical raw evidence
                                 │
                                 ▼
                    cross-source reconciliation
                                 │
                                 └──────────────► same governed truth layer
```

---

## 4. Existing runtime disposition

The existing `amaia-sync-runtime` is a predecessor / implementation substrate for POST-R2-PROD-01. It SHALL NOT be discarded or replaced merely because this architecture uses a one-shot execution envelope.

Existing safety/runtime work, including the U4–U8 line and the lease/authority/fencing/heartbeat/shutdown machinery, SHALL be inventoried and mechanically reconciled before blueprint implementation.

Binding principle:

> **systemd owns WHEN; the governed runtime owns HOW a sync executes safely.**

The one-shot execution model SHALL reuse compatible existing domain-runner and authority/fencing semantics. Any component proposed for removal or supersession requires explicit blueprint justification and independent review.

The current repository divergence and dirty worktree SHALL be treated as preservation-sensitive forensic state. No `git clean`, destructive reset, or incidental rewrite is authorized by this architecture.

---

## 5. Architectural boundaries

### 5.1 Seguimientos

Seguimientos SHALL consume Supabase only.

It SHALL NOT:

- connect directly to AMAIA MySQL;
- connect directly to AMAIASQL;
- depend on the SSH tunnel;
- execute source extraction;
- contain source/database server credentials;
- require local files emitted by sync jobs;
- impersonate an unattended integration worker.

### 5.2 AMAIASQL

AMAIASQL SHALL be the autonomous integration node.

It SHALL own:

- host-native 24/7 AMAIA connectivity;
- the Dockerized one-shot sync execution environment;
- systemd scheduling;
- dead-man schedule monitoring;
- local operational logging/rotation;
- health probing;
- runtime configuration/secrets;
- recovery execution.

AMAIASQL SHALL NOT become the user-facing database for Seguimientos.

### 5.3 Supabase

Supabase SHALL remain the canonical operational data plane exposed to Seguimientos.

`raw_call_logs` SHALL be the canonical multi-source raw call-evidence gateway for the operational pipeline.

Any existing `amaia_call_logs` path SHALL NOT become a second parallel operational truth without explicit adjudication. It may be retained as legacy/staging/audit infrastructure only if the blueprint proves a clear governed purpose and non-divergence from the canonical path.

Source lineage SHALL reuse the ratified PI-01D lineage model/taxonomy rather than introducing a parallel source ontology.

Future Net2phone evidence SHALL preserve distinct provider/source lineage and SHALL NOT masquerade as AMAIA-origin evidence.

---

## 6. 24/7 connectivity invariant

The AMAIA source-connectivity service SHALL be managed at the AMAIASQL host level by systemd and SHALL remain independent of the Docker sync workload.

The exact SSH implementation (`ssh` vs another host-managed equivalent) remains blueprint work, but the following are binding:

- starts automatically after reboot and network readiness;
- reconnects automatically after network/SSH interruption;
- uses readonly AMAIA credentials;
- uses verified host identity / fail-closed SSH trust behavior;
- exposes no public MySQL listener;
- does not require an interactive shell;
- secrets/private keys remain host-protected and are not baked into Docker images;
- health is based on a bounded real readonly query round-trip to AMAIA, not merely process/socket liveness;
- prolonged failure is observable and participates in the alerting contract.

A healthy tunnel process with a failed AMAIA query is NOT healthy.

---

## 7. Execution and scheduling model

### 7.1 One-shot workload

`amaia-sync` SHALL execute as a deterministic one-shot workload invoked by the host scheduler.

Normal production cadence is initially:

- 06:00 America/Santiago;
- 18:00 America/Santiago.

This cadence is chosen because Seguimientos does not require realtime source ingestion and the initial business freshness target is approximately **≤12 hours plus processing/recovery latency under normal conditions**.

The cadence may later change without redefining the architecture if the same safety invariants remain true.

### 7.2 Scheduling ownership

systemd SHALL own scheduled invocation for this phase.

Exact unit names, commands and timeout values are blueprint details.

### 7.3 Manual invocation

Manual/incident invocation MAY exist, but SHALL pass through the identical run-authority mechanism used by scheduled runs. There is no bypass/manual super-mode.

---

## 8. Single-writer authority, lease and fencing

At most one execution SHALL hold write authority for a given governed source domain/watermark at any time.

This applies to:

- scheduled vs scheduled;
- scheduled vs manual;
- manual vs manual;
- stale container vs current container;
- duplicated/leftover scheduler configuration;
- recovery execution vs normal execution.

The blueprint SHALL reconcile this requirement with the existing lease/authority-verifying/fencing runtime. Existing compatible fencing SHALL be retained unless a replacement is separately justified and proven superior.

A second execution SHALL be rejected, deferred or otherwise prevented from concurrently settling the same governed domain.

Watermark update SHALL be fenced and SHALL also be monotonic at the persistence layer; a stale writer SHALL NOT be able to regress a watermark.

---

## 9. Source-read integrity: incrementality, overlap and anti-entropy

A source `id` or timestamp cursor SHALL NOT be assumed to represent MySQL commit order merely because it is monotonic in value.

The architecture SHALL defend against:

- out-of-order commit visibility;
- late inserts;
- source-side backfills;
- updates/corrections to previously visible records;
- equal timestamp ties;
- transient missed reads.

Each normal incremental extraction SHALL therefore include a governed overlap/re-read strategy sufficient to revisit a bounded prior source region and absorb duplicates through idempotency.

In addition, a periodic anti-entropy/reconciliation scan SHALL revisit a wider historical window so that source evidence that becomes visible after the primary cursor frontier can converge into canonical storage.

The exact overlap size/window and anti-entropy cadence SHALL be determined from physical AMAIA behavior in the blueprint/qualification phase; the existence of both mechanisms is architectural and mandatory.

For timestamp-driven source domains, cursor semantics SHALL include a deterministic tie-break (e.g. timestamp + stable source identity) and SHALL NOT rely on timestamp alone.

---

## 10. Time semantics

All durable run, settlement, watermark and comparison instants in the target system SHALL be normalized to UTC.

Where AMAIA exposes timezone-less/local DATETIME values, the source-time interpretation contract SHALL explicitly define `America/Santiago` as the business/source timezone unless physical evidence proves a different source convention.

Flow:

```text
AMAIA local DATETIME
        ↓ interpret under governed source-time contract
absolute instant
        ↓ normalize
UTC / timestamptz
```

America/Santiago SHALL be used for human/business scheduling and presentation; durable comparison semantics SHALL be UTC.

DST boundary behavior SHALL be qualification-tested.

---

## 11. Canonical ingestion and idempotency

Canonical raw call evidence SHALL settle into `raw_call_logs` (or a successor explicitly ratified as its canonical replacement), with provider/source lineage and stable external identity.

The architecture targets **at-least-once extraction + idempotent settlement + convergence**.

Re-executing an already-read source region SHALL be safe.

Idempotency SHALL cover:

- raw evidence duplication;
- repeated correlation/attribution work;
- repeated follow-up generation;
- repeated status recomputation;
- overlap/anti-entropy reads;
- crash/replay scenarios.

Replay correctness means not merely "no duplicate rows" but convergence to the same correct operational state.

---

## 12. Settlement and derived-state convergence

The governed settlement unit is batch/page oriented, consistent with existing AMAIA-SYNC batch work, while preserving row-level source idempotency.

The exact transaction partition may be one transaction or a durable multi-stage workflow, but the following invariant is binding:

> **A source interval SHALL NOT be considered operationally settled while required derived-state work can be silently forgotten.**

A valid implementation SHALL choose one of these safe classes:

1. persistence + watermark + required derived-state transformation settle atomically where feasible; or
2. source persistence/watermark settlement records a durable, automatically recoverable downstream obligation whose incomplete states are machine-visible and automatically resumed.

A crash after raw persistence but before correlation/follow-up/status recomputation SHALL NOT permanently leave Seguimientos stale while the source watermark claims completion.

The blueprint SHALL name the exact ratified batch/settlement authorities it reuses; vague references to "existing ratified semantics" are not sufficient.

---

## 13. Backlog drain and bounded execution

Batch/page size SHALL be a memory/transaction-control mechanism, not a silent per-run progress ceiling.

A run SHALL continue draining pages until one of these governed conditions occurs:

- source frontier is caught up;
- a configured maximum run time/resource bound is reached and remaining backlog is durably/observably pending;
- authority is lost;
- a governed terminal/retryable failure occurs.

Normal operation SHALL NOT accumulate permanent lag merely because source volume exceeds one page/window.

---

## 14. Supabase unattended write identity and security

The unattended worker SHALL use a dedicated least-privilege server-side identity consistent with the ratified PI-01D role/grant discipline.

It SHALL NOT depend on:

- a human `auth.uid()`;
- an interactive `admin`/`super_admin` session;
- browser credentials;
- a blanket Supabase `service_role` key as the ordinary write identity.

Where existing legacy RPCs require authenticated human-admin context, they SHALL NOT be assumed usable by the unattended worker.

The blueprint SHALL identify the exact server-to-server write path. Preferred governed shape is narrowly granted database/RPC execution, including `SECURITY DEFINER` functions where appropriate, with controlled owner, fixed `search_path`, least privilege and explicit grants.

Existing PI-01D functions/grants MAY satisfy parts of this path, but coverage SHALL be mechanically verified before claiming the legacy gateway identity blocker closed.

Additional security invariants:

- source MySQL credentials remain readonly;
- secrets SHALL NOT be committed to Git;
- private keys and Supabase credentials SHALL NOT be baked into image layers;
- logs SHALL redact secrets and avoid unnecessary beneficiary PII;
- credential rotation SHALL not require source-code changes;
- browser-delivered configuration SHALL never contain server/source secrets.

---

## 15. Run ledger and terminal-state contract

Every run SHALL have a durable `run_id` and durable ledger evidence.

At minimum the ledger SHALL support:

- run identity;
- runtime/build/commit identity;
- start/end UTC timestamps;
- governed source/domain identity;
- authority/lease/fence identity sufficient for forensic reconstruction;
- watermark before;
- source range/frontier processed;
- rows read;
- rows inserted/updated/deduplicated/rejected;
- correlation/attribution outcome counts;
- follow-up/state-recompute counts;
- durable downstream obligations created/completed, if applicable;
- watermark after;
- error/diagnostic class;
- terminal state.

The terminal-state vocabulary SHALL be closed and constrained. v0.2 does not reuse beneficiary PA-GRACE operational states for runtime execution. Exact names SHALL be reconciled in the blueprint against existing ratified U5–U8 runtime terminal semantics; arbitrary free-text terminal states are forbidden.

Stdout, journald or Prometheus metrics alone do not satisfy durable run-ledger evidence.

---

## 16. Health, dead-man monitoring and storage hygiene

Autonomy requires detecting both active failure and the absence of expected activity.

Minimum health evidence SHALL include:

- source-query health and latency;
- last expected scheduled run;
- last started run;
- last successful run;
- next expected run;
- current watermark/frontier;
- latest source event observed;
- consecutive failures;
- pending downstream repair obligations;
- runtime version;
- disk/free-space state;
- log-rotation/retention health.

A dead-man condition SHALL exist so that an expected run that never starts is detectable independently of that run's own logging path.

Repeated run failures, prolonged source unreachability, missed-run conditions and unsafe disk pressure SHALL create an operator-visible degraded/alert state.

Exact numeric thresholds and notification transport are blueprint/operations decisions, but the alerting obligation is architectural.

Logs SHALL have bounded retention/rotation. Durable SQL audit evidence MAY have a different retention policy, but no host-local evidence stream may grow without bound.

---

## 17. Failure and recovery semantics

### 17.1 AMAIA unreachable

- run does not settle the unavailable interval;
- watermark does not advance unsafely;
- failure is durably/operationally visible;
- later run retries from the last safe state.

### 17.2 Supabase unavailable

- source data is not falsely marked settled;
- watermark does not advance unsafely;
- later replay remains safe.

### 17.3 Unexpected source/schema shape

If governed fields cannot be interpreted safely because of source/schema drift, the affected settlement unit SHALL fail closed. It SHALL NOT silently coerce/drop required values and advance the watermark.

### 17.4 Authority loss

A runner that loses governed authority/fence SHALL stop write settlement according to the existing ratified runtime authority semantics. It SHALL NOT continue because its process is still alive.

### 17.5 Docker failure without host reboot

Docker/runtime unavailability SHALL be externally detectable by the host health/dead-man path. Recovery SHALL not depend solely on a future host reboot.

### 17.6 Host reboot

After AMAIASQL reboot:

- network readiness is respected;
- source connectivity returns automatically;
- Docker/runtime becomes available automatically or health becomes degraded/alerting;
- scheduler remains enabled;
- durable checkpoints survive;
- the next safe run resumes without human reconstruction.

### 17.7 Complete AMAIASQL node loss

AMAIASQL is an accepted single integration-node dependency for this phase; active-active HA is out of scope.

The node SHALL nonetheless be reconstructible from governed repository artifacts, protected configuration/secrets and durable Supabase/source state.

No canonical source evidence SHALL rely exclusively on ephemeral AMAIASQL local disk after successful settlement.

The blueprint SHALL define recovery procedure and RTO target. Source-side retention plus durable watermarks/reconciliation should permit deterministic catch-up; this architecture does not claim zero-RTO availability.

---

## 18. Correction, replay and historical integrity

Raw/provider evidence SHALL be preserved with immutable lineage to the extent permitted by the source contract.

A later correction of correlation/business logic SHALL NOT require pretending the original source evidence never existed.

Derived state SHALL be recomputable/convergent under corrected logic, with corrections/supersession/adjudication auditable.

The implementation SHALL define how a previously successful but semantically wrong derivation is superseded/rebuilt without destructive rewriting of source history.

---

## 19. Seguimientos freshness model

Normal propagation is:

```text
AMAIA source change
    ↓
scheduled autonomous sync
    ↓
Supabase canonical + derived state
    ↓
Seguimientos normal fetch/refresh
    ↓
updated operator view
```

Supabase Realtime is not required for this phase.

The WebApp SHALL NOT present indefinite stale data without an operator-visible freshness reference. It SHALL expose, directly or through its data contract, the timestamp/status of the latest successful synchronization relevant to the workspace.

Initial source freshness target under healthy normal operation is approximately ≤12 hours plus processing latency, corresponding to the 06:00/18:00 schedule.

UI refresh behavior and exact maximum active-session refresh interval are blueprint/frontend decisions, but "refresh only if an operator guesses data is stale" is not an acceptable autonomous contract.

---

## 20. Future Net2phone extension point

Net2phone integration remains a separate follow-on phase and SHALL NOT block initial autonomous AMAIA productionization.

Its intended roles are:

1. independent completeness validation;
2. recovery of provider CDR absent from AMAIA persistence;
3. source-health measurement;
4. cross-source conflict detection;
5. governed recovery/reconciliation.

The future adapter SHALL:

- use a historical/pull-capable CDR path, not merely duplicate the existing webhook failure domain;
- settle into the same canonical raw-evidence layer with distinct source lineage;
- reuse PI-01D source/authority/conflict semantics;
- route authority conflicts through the existing PI-01D review/adjudication gates rather than inventing a parallel conflict system;
- participate in the same derived-state single-writer/convergence rules;
- use its own governed watermark/window semantics appropriate to the provider API.

No Net2phone record may masquerade as AMAIA-origin evidence.

---

## 21. Explicit non-goals of v0.2

This architecture does NOT yet adjudicate:

- exact OpenSSH/autossh command line;
- systemd unit/timer names;
- exact filesystem paths/ownership modes;
- Docker base image and compose syntax;
- exact lease table/schema changes;
- exact run-ledger DDL;
- exact overlap size / anti-entropy interval;
- exact page size / maximum run time;
- exact alert thresholds/destinations;
- exact log-retention durations;
- exact Supabase RPC/function signatures for the unattended write path;
- exact RTO for full AMAIASQL node reconstruction;
- Net2phone API version/authentication/production activation;
- active-active AMAIASQL high availability.

These are blueprint/qualification decisions constrained by the binding invariants above.

---

## 22. Required acceptance tests

The eventual implementation SHALL include at minimum:

### AT-AUTO-01 — Boot autonomy
Reboot AMAIASQL; source connectivity returns without interactive intervention.

### AT-AUTO-02 — Real source health
Health is PASS only when a real bounded readonly query through the managed link succeeds.

### AT-AUTO-03 — Scheduled autonomous run
A scheduled one-shot execution starts without human action.

### AT-AUTO-04 — End-to-end propagation
A known new AMAIA source event reaches canonical Supabase evidence and produces the expected Seguimientos operational result.

### AT-AUTO-05 — Replay convergence
Replay the same governed source region; no duplicate canonical evidence is created and derived state converges to the same correct result.

### AT-AUTO-06 — AMAIA outage recovery
Source unavailable during scheduled run; watermark remains safe; later execution recovers.

### AT-AUTO-07 — Supabase outage recovery
Destination unavailable; run does not falsely settle; later replay succeeds.

### AT-AUTO-08 — Tunnel interruption recovery
Break the source link; the host-managed service restores it automatically and real-query health recovers.

### AT-AUTO-09 — Restart recovery
Restart Docker/host components; checkpoints survive and next run continues safely.

### AT-AUTO-10 — Evidence completeness
Every run is reconstructible by run-id, authority, counts, source range, version and watermark transition.

### AT-AUTO-11 — Security
No runtime secrets exist in repository, image history, browser config or unredacted logs; worker does not depend on human-admin identity or blanket service-role access.

### AT-AUTO-12 — Application isolation
Seguimientos operates through Supabase only.

### AT-AUTO-13 — Out-of-order source visibility
Simulate/qualify source rows becoming visible out of primary cursor order; no permanent omission occurs.

### AT-AUTO-14 — Overlap / anti-entropy recovery
A late/backfilled source record is recovered by governed re-read/anti-entropy.

### AT-AUTO-15 — Derived-state deterministic convergence
Repeated valid replay yields equivalent operational state, not merely duplicate-free raw rows.

### AT-AUTO-16 — Split-settlement crash
Crash after an intermediate durable step; next run automatically completes/repairs required downstream work.

### AT-AUTO-17 — Watermark monotonicity
A stale/concurrent writer cannot move the watermark backward.

### AT-AUTO-18 — Dual-runner poison test
Two candidate executions attempt the same domain; only one obtains write authority.

### AT-AUTO-19 — Backlog drain
Source backlog exceeds one page/window; run drains pages or durably exposes bounded remaining work without silent permanent lag.

### AT-AUTO-20 — Chile DST boundary
Source-time interpretation and UTC settlement remain complete/correct across an America/Santiago DST transition.

### AT-AUTO-21 — Manual vs scheduled concurrency
Manual invocation cannot bypass the same authority/fence used by scheduled execution.

### AT-AUTO-22 — Missed-schedule dead-man
Disable/break the scheduler; absence of the expected run becomes externally visible without relying on the missing run itself.

### AT-AUTO-23 — Zombie-tunnel detection
Keep a process/socket apparently alive while source queries fail; health becomes degraded.

### AT-AUTO-24 — Disk-space degradation
Drive available disk below governed threshold; the system alerts/fails safely before evidence loss/corruption.

### AT-AUTO-25 — Log-rotation endurance
Sustained operation does not permit unbounded local log growth.

### AT-AUTO-26 — Unattended soak
Multiple consecutive scheduled cycles, including an unattended weekend-equivalent interval, complete with zero human intervention and monotonic evidence.

### AT-AUTO-27 — Failure alerting without active observer
Inject a governed failure and prove an operator-visible degraded/alert state appears without someone watching a terminal/dashboard at the moment of failure.

### AT-AUTO-28 — Derived-state correction/rebuild
Apply a controlled logic correction and rebuild derived state without destroying canonical raw source history.

### AT-AUTO-29 — UI freshness indication
Seguimientos exposes a reliable last-success/data-freshness reference and does not indefinitely present stale state as current.

### AT-AUTO-30 — Schema-drift fail-closed
Introduce an incompatible governed source shape; affected settlement stops safely and watermark does not advance past unprocessed governed evidence.

---

## 23. Governance and program sequence

Following FRA ratification of this architecture, work SHALL proceed under the project's no-self-approval rule.

Recommended sequence:

**P0-A — Repository/worktree forensic preservation**  
Classify/preserve the dirty local runtime corpus and reconcile local-vs-origin history.

**P0-B — AMAIASQL physical inventory / read-only**  
Verify `/opt/amaia-sync`, existing SSH assets, Docker, systemd/timers/cron, listener 3307, permissions, logs, disk and actual runtime state without mutation.

**P0-C — Supabase physical authority inventory / read-only**  
Verify remote tables, roles, grants, RLS, PI-01D callable surfaces, watermarks and whether the unattended server identity/write path physically exists.

**P1 — Physical implementation blueprint**  
Translate this ratified architecture into exact files, units, containers, roles, functions, schemas, health checks, migration steps, rollback and tests.

**P2 — Independent adversarial blueprint review**  
Constructor/author does not approve own work; Principal Architect verifies; independent hostile reviewer audits; FRA ratifies.

**P3 — Constructor implementation**  
Implement only against ratified architecture + blueprint.

**P4 — Qualification**  
Build, type/lint/tests, local Docker, authority/failure injection, security and replay tests.

**P5 — AMAIASQL deployment**  
Deploy host connectivity, one-shot Docker execution, scheduler, health/dead-man and protected secrets.

**P6 — End-to-end autonomous acceptance**  
Run the AT-AUTO suite including unattended soak.

**P7 — FRA production close**  
Close only on evidence package and FRA ratification.

**P8 — Net2phone recovery/reconciliation**  
Separate follow-on program using the reserved extension point.

No actor may approve its own authored/constructed artifact.

---

## 24. Binding architecture decisions proposed by v0.2

Ratification of v0.2 would make the following binding:

1. AMAIASQL is the autonomous integration node.
2. AMAIA connectivity is host-native/systemd-managed and available 24/7.
3. Link health requires a real AMAIA readonly query.
4. Docker packages the sync workload but does not own the persistent link.
5. `amaia-sync` runs as one-shot work.
6. systemd owns scheduled invocation; initial cadence is 06:00/18:00 America/Santiago.
7. Existing U4–U8 / lease / AVLM / fencing runtime work is preserved and reconciled.
8. Single-writer authority is mandatory for every manual or scheduled run.
9. Settlement is fenced; watermark persistence is monotonic.
10. `raw_call_logs` is the canonical multi-source raw call gateway.
11. `amaia_call_logs` cannot become parallel operational truth without explicit adjudication.
12. AMAIA cursor values are not assumed commit-order-safe.
13. Every incremental path uses governed overlap and periodic anti-entropy.
14. Backlog drains by pages; page size is not the per-run progress ceiling.
15. Required derived state must converge or be protected by a durable automatic repair obligation.
16. The unattended Supabase writer uses a dedicated least-privilege server identity, not human auth or blanket service-role access.
17. Durable timestamps/watermarks/comparisons use UTC; AMAIA timezone-less local times are interpreted under the governed America/Santiago source-time contract.
18. Dead-man schedule detection, source-query health, bounded logs and disk-health alerting are part of autonomy.
19. Raw source evidence remains lineage-preserving; semantic corrections rebuild/supersede derived truth rather than erasing history.
20. Seguimientos consumes Supabase only and exposes data freshness.
21. AMAIASQL is an accepted single integration node for this phase, but must be reconstructible and catch-up capable.
22. Future Net2phone uses an independent historical/pull reconciliation path, the same canonical evidence layer and PI-01D authority semantics.

---

## 25. Ratification boundary

Ratifying v0.2 ratifies the architecture WHAT and its safety invariants. It does NOT authorize implementation and does NOT ratify unverified physical assumptions.

Implementation remains STOP until:

- FRA ratifies this architecture;
- P0 inventories close required physical facts;
- a physical implementation blueprint is authored, independently reviewed and FRA-ratified.

---

## 26. Candidate disposition

**CANDIDATE — REQUIRES DIFFERENTIAL INDEPENDENT REVIEW AND FRA RATIFICATION.**

v0.1 remains historical and SHALL remain byte-identical. v0.2 supersedes v0.1 only if and when FRA ratifies v0.2.
