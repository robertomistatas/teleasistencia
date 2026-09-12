# AMAIA-SYNC — POST-R2 AUTONOMOUS PIPELINE ARCHITECTURE v0.1 CANDIDATE

**Status:** CANDIDATE — NOT RATIFIED  
**Program:** POST-R2-PROD-01 — Productionization & Sanitization  
**Scope owner / Final Ratification Authority:** Roberto  
**Architecture owner:** Principal Architect  
**Baseline repository:** `robertomistatas/teleasistencia`  
**Baseline `main` at document creation:** `a92dd43818973eafbde550841e0ff84a60695b32`  
**Primary objective:** autonomous, auditable and recoverable data path `AMAIA → AMAIASQL → Supabase → Seguimientos` with 24/7 source connectivity and no human-operated synchronization step.

---

## 1. Executive intent

R2 has passed operational audit. The next priority is not to add more user-facing functionality; it is to convert the proven R2 data path into a production-grade autonomous service.

The production system SHALL keep the AMAIA connectivity layer available 24/7 on AMAIASQL, SHALL perform incremental synchronization automatically, SHALL publish the resulting canonical operational data to Supabase, and SHALL allow Seguimientos to remain a Supabase-only consumer.

No operator, administrator, developer or auditor SHALL be required to open a shell, upload a spreadsheet, run an ad-hoc SQL script, start an SSH tunnel manually, or manually recalculate follow-up state for normal operation.

The future Net2phone API integration SHALL be represented as an explicit extension point in this architecture, but SHALL NOT block completion of the initial autonomous AMAIA pipeline.

---

## 2. Non-negotiable production outcome

POST-R2-PROD-01 cannot be declared CLOSED until the following demonstration succeeds:

1. A valid source change exists in AMAIA.
2. No human initiates synchronization.
3. AMAIASQL detects/reads the new source data through the permanent connectivity layer.
4. The scheduled sync job processes it incrementally and idempotently.
5. Supabase is updated automatically.
6. Follow-up/correlation state is recalculated as required.
7. Seguimientos, without restart or direct AMAIA access, displays the new operational state on its next normal Supabase query/refresh.
8. The complete run is auditable by run identifier, source range, counts, watermark transition and terminal result.

This is the canonical end-to-end acceptance gate.

---

## 3. Target architecture

```text
                         CURRENT PRIMARY SOURCE
                    ┌────────────────────────────┐
                    │       AMAIA PRODUCTION     │
                    │                            │
                    │ MySQL                      │
                    │ beneficiaries              │
                    │ control_llamadas           │
                    │ phone/device surfaces      │
                    └──────────────┬─────────────┘
                                   │
                                   │ SSH / readonly MySQL
                                   ▼
╔══════════════════════════════════════════════════════════════╗
║                         AMAIASQL                            ║
║                    Ubuntu VM / Docker                      ║
║                                                            ║
║  ┌──────────────────────────────────────────────────────┐  ║
║  │ amaia-tunnel                                         │  ║
║  │                                                      │  ║
║  │ • persistent 24/7                                    │  ║
║  │ • automatically starts after reboot                  │  ║
║  │ • automatically reconnects                           │  ║
║  │ • exposes AMAIA MySQL only to local/internal runtime │  ║
║  │ • readonly source credentials                        │  ║
║  └──────────────────────┬───────────────────────────────┘  ║
║                         │ localhost / protected network     ║
║                         ▼                                   ║
║  ┌──────────────────────────────────────────────────────┐  ║
║  │ amaia-sync                                           │  ║
║  │                                                      │  ║
║  │ • deterministic one-shot sync execution              │  ║
║  │ • incremental extraction                             │  ║
║  │ • durable watermark                                  │  ║
║  │ • normalization                                      │  ║
║  │ • correlation / PI-01D attribution                   │  ║
║  │ • idempotent persistence                             │  ║
║  │ • follow-up/state recomputation                      │  ║
║  │ • run ledger / metrics / diagnostics                 │  ║
║  └──────────────────────┬───────────────────────────────┘  ║
║                         ▲                                   ║
║                         │                                   ║
║  ┌──────────────────────┴───────────────────────────────┐  ║
║  │ host scheduler / systemd                             │  ║
║  │ initial production cadence: 06:00 and 18:00 CLT     │  ║
║  └──────────────────────────────────────────────────────┘  ║
╚═════════════════════════╪════════════════════════════════════╝
                          │ HTTPS / authenticated write path
                          ▼
                 ┌────────────────────────┐
                 │        SUPABASE        │
                 │                        │
                 │ raw source evidence    │
                 │ correlations           │
                 │ followup_events        │
                 │ beneficiary status     │
                 │ operational views      │
                 │ KPI/RPC                │
                 │ run/watermark evidence │
                 └───────────┬────────────┘
                             │
                             │ Supabase API only
                             ▼
                    ┌─────────────────┐
                    │  SEGUIMIENTOS   │
                    │     WebApp      │
                    │                 │
                    │ dashboards      │
                    │ workspaces      │
                    │ audit           │
                    │ management      │
                    └─────────────────┘

        FUTURE INDEPENDENT COMPLETENESS / RECOVERY SOURCE

                 Net2phone CDR API
                         │
                         ▼
              [net2phone-ingestor]
                         │
                         ▼
                 raw source evidence
                         │
                         ▼
               cross-source reconciler
                         │
                         └──────────────► same Supabase truth layer
```

---

## 4. Architectural boundaries

### 4.1 Seguimientos

Seguimientos SHALL consume Supabase only.

It SHALL NOT:
- connect directly to AMAIA MySQL;
- depend on an SSH tunnel;
- require AMAIASQL to be directly reachable from a browser;
- read local files generated by sync jobs;
- contain source credentials;
- implement source extraction logic.

This separation is mandatory.

### 4.2 AMAIASQL

AMAIASQL SHALL be the autonomous integration node.

It SHALL own:
- persistent source connectivity;
- the containerized synchronization runtime;
- scheduling;
- operational logs;
- health state;
- source watermarks/checkpoints;
- recovery execution.

It SHALL NOT become the user-facing database for Seguimientos.

### 4.3 Supabase

Supabase SHALL remain the canonical operational data plane exposed to Seguimientos.

It SHALL contain source lineage sufficient to distinguish at least:
- AMAIA-sourced evidence;
- future Net2phone-sourced evidence;
- reconciled/correlated operational events.

No future Net2phone fallback may masquerade as AMAIA-origin evidence.

---

## 5. Connectivity invariant — 24/7 link

The AMAIA source connectivity layer SHALL remain available 24/7 even when no synchronization job is running.

Required behavior:
- starts automatically after AMAIASQL reboot;
- reconnects after SSH/network interruption;
- uses readonly AMAIA access;
- does not require an interactive shell;
- exposes no public MySQL listener;
- fails closed if authentication or host identity validation fails;
- provides a machine-verifiable health signal;
- produces logs sufficient to diagnose reconnects and prolonged outage.

The persistent link and the sync workload are separate concerns. A healthy link does not imply a successful sync, and a sync failure SHALL NOT require manual recreation of the link.

---

## 6. Synchronization execution model

The preferred production model is:

- `amaia-tunnel`: long-running 24/7 service/container;
- `amaia-sync`: deterministic one-shot workload;
- host-level scheduler: invokes the one-shot workload at controlled times;
- initial cadence: 06:00 and 18:00 CLT;
- manual invocation remains available for controlled operations and incident recovery, but is not part of normal operation.

A long-lived sync process MAY be considered later only if it offers a demonstrated reliability advantage. It is not required for this phase.

---

## 7. Incrementality and watermark invariants

The runtime SHALL use a durable checkpoint/watermark mechanism.

Required properties:

1. A run knows its `watermark_before`.
2. Extraction covers the complete source interval required by that watermark.
3. Persistence and watermark advancement are coupled by a fail-safe settlement rule.
4. The watermark SHALL NOT advance when the batch is not safely settled.
5. Re-executing the same source interval SHALL be safe.
6. Source overlap/re-read SHALL be allowed where needed for recovery.
7. Duplicate source rows SHALL be neutralized by canonical idempotency rules, including source identity.

Target semantic: **at-least-once extraction, idempotent settlement, no silent gap creation**.

---

## 8. Failure and recovery semantics

### 8.1 AMAIA unreachable

- run terminates non-successfully;
- no unsafe watermark advancement;
- error is logged;
- next run retries from the last safe checkpoint.

### 8.2 Supabase unreachable

- source data SHALL NOT be considered settled;
- no unsafe watermark advancement;
- next run may replay safely.

### 8.3 Partial batch failure

Partial success SHALL NOT silently convert into a completed run.

The implementation blueprint MUST define exact transactional and retry boundaries consistent with existing ratified batch semantics.

### 8.4 Container/host restart

After AMAIASQL reboot:
- Docker SHALL become available automatically;
- the persistent AMAIA link SHALL recover automatically;
- the scheduler SHALL remain enabled;
- the next scheduled sync SHALL continue from the last safe checkpoint;
- no operator intervention SHALL be required.

---

## 9. Run evidence and observability

Every sync run SHALL produce durable evidence containing at minimum:

- `run_id`;
- runtime/build version or commit identity;
- start/end time;
- source endpoint identity (non-secret);
- `watermark_before`;
- source range processed;
- source rows read;
- rows accepted/rejected/deduplicated;
- correlation outcome counts;
- follow-up events created/updated;
- beneficiaries recalculated;
- `watermark_after`;
- terminal result (`PASS`, `FAILED`, or explicit governed state);
- diagnostic reason on non-PASS result.

Minimum health signals SHALL include:

- last successful sync time;
- latest source event time observed;
- last run result;
- current watermark;
- persistent tunnel health;
- consecutive failures;
- runtime version.

A future monitoring surface MAY expose this in Seguimientos/supervision, but the health data SHALL exist independently of the UI.

---

## 10. Security invariants

- AMAIA database access SHALL remain readonly.
- Secrets SHALL NOT be committed to Git.
- SSH private keys SHALL remain host-protected and least-privilege.
- Supabase write credentials SHALL exist only in controlled runtime secret configuration.
- The browser SHALL never receive server/source secrets.
- Logs SHALL not print passwords, tokens, private keys or application secrets.
- Container images SHALL not bake production credentials into layers.
- Any future Net2phone secret SHALL be managed independently and rotatable without code changes.

---

## 11. Docker / host responsibility split

### Docker responsibility

Docker SHALL package deterministic application/runtime dependencies.

Expected logical units:
- persistent `amaia-tunnel` service or functionally equivalent managed service;
- `amaia-sync` one-shot workload;
- optional future `net2phone-ingestor` / reconciler components.

### Host responsibility

AMAIASQL host SHALL provide:
- Docker runtime;
- persistent configuration/secrets;
- scheduler (`systemd` preferred for this phase);
- persistent logs/state volumes;
- boot ordering;
- filesystem permissions;
- backup/recovery of configuration and durable local state where applicable.

Implementation details remain blueprint work and are not ratified by this architecture candidate.

---

## 12. Seguimientos freshness model

Seguimientos does not require a push from AMAIASQL.

Normal state propagation is:

```text
AMAIA source change
    ↓
automated scheduled sync
    ↓
Supabase canonical state changes
    ↓
next normal Seguimientos fetch/refresh
    ↓
updated operational UI
```

No application restart is required.

A later phase MAY add Supabase realtime/UI invalidation if operationally useful. Realtime UI delivery is not required to prove end-to-end autonomous synchronization.

---

## 13. Future Net2phone integration extension point

This architecture reserves a separate source adapter for Net2phone CDR/API evidence.

The future adapter SHALL NOT replace AMAIA by default. Its intended roles are:

1. independent completeness validation;
2. recovery of provider CDR absent from AMAIA persistence;
3. source-health measurement;
4. conflict detection;
5. cross-source reconciliation.

Target future source states include concepts equivalent to:
- present in AMAIA and Net2phone;
- AMAIA only;
- Net2phone only / recoverable fallback;
- cross-source conflict / review.

Future Net2phone evidence SHALL preserve its own `source` and provider identity and SHALL pass through governed phone/temporal attribution before affecting beneficiary follow-up state.

The future implementation MUST NOT simply create a second webhook path that shares the same failure mode as the existing event delivery mechanism. Historical/pull recovery capability is a design requirement.

---

## 14. Explicit non-goals of v0.1

This candidate does NOT yet adjudicate:

- exact Docker base images;
- exact compose syntax;
- whether the SSH tunnel is hosted in Docker or a host-native managed unit;
- exact timer unit names;
- final local filesystem paths;
- exact watermark schema/table;
- final batch size;
- retry counts/backoff;
- Net2phone API version or authentication scheme;
- Net2phone production activation;
- replacement of AMAIA as primary business source.

Those require physical inventory and implementation blueprint work.

---

## 15. Required implementation acceptance tests

At minimum, the future implementation SHALL prove:

### AT-AUTO-01 — boot autonomy
Reboot AMAIASQL. Persistent source connectivity returns without interactive intervention.

### AT-AUTO-02 — source reachability
Sync runtime can query AMAIA readonly through the managed connectivity layer.

### AT-AUTO-03 — scheduled autonomous run
A scheduled execution starts without human action.

### AT-AUTO-04 — end-to-end propagation
A known new AMAIA source event reaches Supabase and changes the expected Seguimientos operational result.

### AT-AUTO-05 — idempotent replay
Replay the same interval. No duplicate operational evidence is created.

### AT-AUTO-06 — AMAIA outage recovery
Source unavailable during a scheduled run; watermark remains safe; later execution recovers missed interval.

### AT-AUTO-07 — Supabase outage recovery
Destination unavailable; run does not falsely settle; later replay succeeds safely.

### AT-AUTO-08 — tunnel interruption recovery
Terminate/break the persistent source connection; managed connectivity restores it automatically.

### AT-AUTO-09 — restart recovery
Restart Docker/host components; durable checkpoint survives and next run continues correctly.

### AT-AUTO-10 — evidence completeness
Every production run is traceable by run-id, counts, watermark transition and version.

### AT-AUTO-11 — security
No secrets exist in repository, image history, public logs or browser-delivered configuration.

### AT-AUTO-12 — application isolation
Seguimientos continues to use Supabase only and has no direct dependency on AMAIA/AMAIASQL connectivity.

---

## 16. Program phases following ratification

If this architecture is ratified, the recommended sequence is:

**P0 — Physical inventory / read-only**  
Determine what actually exists today in repository and AMAIASQL: tunnel scripts, runtime, Docker assets, secrets contract, scheduler state, watermark implementation and deployment assumptions.

**P1 — Physical implementation blueprint**  
Translate this architecture into exact files, units, containers, volumes, commands, health checks, gates and rollback procedures.

**P2 — Independent adversarial review**  
Audit failure modes, state loss, duplicate creation, stale tunnel, credential leakage, replay behavior and boot recovery.

**P3 — Constructor implementation**  
Implement only against ratified architecture/blueprint.

**P4 — Pre-production qualification**  
Build, static checks, tests, local Docker qualification, failure injection.

**P5 — AMAIASQL deployment**  
Deploy persistent connectivity and automated schedule.

**P6 — End-to-end autonomous acceptance**  
Prove AT-AUTO suite, including no-human source-to-UI propagation.

**P7 — Production close**  
Close only after evidence package and FRA ratification.

**P8 — Net2phone recovery/reconciliation**  
Separate follow-on program using the reserved extension point.

---

## 17. Ratification boundary

Ratifying this architecture means ratifying the WHAT and the invariants, not yet the exact physical implementation.

The following statements become binding after FRA ratification:

- AMAIASQL is the autonomous integration node.
- AMAIA connectivity is managed and available 24/7.
- Normal sync requires zero human intervention.
- Sync is incremental, durable, idempotent and recoverable.
- Supabase is the operational truth layer consumed by Seguimientos.
- Seguimientos does not connect directly to AMAIA or AMAIASQL.
- Production close requires an unattended AMAIA→Supabase→Seguimientos demonstration.
- Net2phone has a reserved future independent ingestion/reconciliation path.

Exact implementation choices remain subject to a separately reviewed and ratified blueprint.

---

## 18. Candidate disposition

**CANDIDATE — REQUIRES INDEPENDENT REVIEW AND FRA RATIFICATION.**

No implementation authorization is implied by the existence of this document.
