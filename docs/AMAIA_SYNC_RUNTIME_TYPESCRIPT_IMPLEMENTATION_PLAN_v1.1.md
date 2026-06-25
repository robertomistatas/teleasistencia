# AMAIA-SYNC Runtime TypeScript Implementation Plan v1.1

**Type:** Implementation plan  
**Phase:** 9.4C  
**Status:** Pending Codex re-audit  
**Supersedes:** v1.0 (rejected — 3 critical, sprint reorder, QA/MVP/governance corrections)  
**Parent architecture:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**Parent blueprint:** AMAIA_SYNC_RUNTIME_IMPLEMENTATION_BLUEPRINT_v1.6.1 (Codex approved with observations)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## Changes from v1.0

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | Recovery in Sprint 8, but R28 requires startup+cycle-start recovery before any cycle | Recovery moved to Sprint 4 (before manifest/domain sprints). |
| C2 | Critical | Operational Failure Channel in Sprint 8, but blueprint requires it in post-release state machine | operational-error-service moved to Sprint 4. |
| C3 | Critical | MVP promises "data visible in Seguimientos" but UI is a non-goal | MVP redefined as Technical MVP at Sprint 7. No UI references. |
| — | Major | QA used test count as metric | Replaced with mandatory scenario matrices tied to invariants. |
| — | Major | No Definition of Done | Added Section 18. |
| — | Major | CI/CD was recommendation, not requirement | Made obligatory. Pipeline defined. |
| — | Major | No AMAIA early validation | Added AMAIA Readonly Smoke Probe to Sprint 1. |
| — | Minor | Simulated fixtures vs "no dead code" unclear | Clarified: fixtures are test infrastructure, not dead application code. |
| — | Minor | "MVP demo → Commit" as gate | Removed. Demo never replaces reproducible technical evidence. |

---

## 1. Business Problem

Mistatas needs a functioning AMAIA-SYNC daemon to keep Supabase current with AMAIA data for dashboards, SLA monitoring, and institutional reporting. Management and CEO require demonstrable progress. The construction must be incremental, auditable, and production-safe — maximum velocity compatible with correct architecture.

## 2. Goals

1. Deliver a working daemon that synchronizes control_llamadas and logestado from AMAIA to Supabase.
2. Produce cryptographic manifest evidence for every sync operation.
3. Demonstrate Technical MVP (control_llamadas end-to-end) at Sprint 7.
4. Validate architectural reuse when adding logestado in Sprint 8.
5. Achieve production readiness by Sprint 8 closure.
6. Maintain audit trail: every sprint audited by Codex before proceeding.

## 3. Non-Goals

| Item | Reason | Deferred to |
|---|---|---|
| Reconciliation | Out of V1 scope | Phase 9.5 |
| Delete synchronization | Append-only domains only | Phase 9.5 |
| Mutable domains (enfermedades, medicamentos) | Require mutation detection | Phase 9.5 |
| Timestamp domains (beneficiario, red, alerta) | Require timestamp CAS | Phase 9.5 |
| Multi-worker / HA | V1 is single-threaded | Phase 9.5+ |
| UI dashboard integration | Headless daemon | Separate workstream |
| SOS Mujer | Excluded from application | N/A |
| Provisional finalization | Dormant DB capability | Future |

## 4. Construction Philosophy

**Build Small.** Each sprint produces a minimal, testable increment.

**Validate Early.** Automated QA at sprint boundary. No accumulation of untested code.

**Audit Frequently.** Every sprint blueprint goes through Codex hostile audit before implementation begins.

**Never Skip Hostile Review.** No implementation without prior audit approval.

**One Vertical Slice At A Time.** Each sprint adds one layer or capability.

### Sprint lifecycle

```
Sprint Blueprint → Codex Audit → Re-architecture (if rejected) → Implementation → Automated QA → CI Pipeline Green → Commit
```

No sprint may begin implementation before its blueprint is Codex-approved.

### Simulated dependencies

Sprints 2–5 use test-scoped database state and fixture data to validate layer contracts before upstream layers exist. These fixtures are **test infrastructure** (test files, setup helpers), not dead application code. They are replaced by real integrations when upstream layers are built.

## 5. Runtime Layer Model

| Layer | Responsibility | Key files |
|---|---|---|
| Configuration | Environment loading, validation, domain registry, append-only gate | config.ts, domain-registry.ts |
| Infrastructure | PostgreSQL connectivity, PoolClient lifecycle, transaction management | pg-client.ts |
| Persistence | Repository layer: runs, cycles, leases, watermarks, manifests, destinations, operational errors | *-repository.ts |
| Lease | Scheduler lease, domain lease acquire/release/heartbeat/validate | lease-manager.ts, scheduler.ts |
| Run Lifecycle | Pre-run creation, bind-to-lease, terminal status, lock contention closure | run-service.ts |
| Recovery | Stale detection, manifest abandonment, orphan classification, operational failure channel | recovery-service.ts, operational-error-service.ts |
| Manifest | Create manifest, insert source items, call finalizers, Guarded Terminalization | manifest-service.ts |
| MySQL Adapter | Read-only AMAIA connection, batched fetch, domain queries | mysql-client.ts, amaia-fetcher.ts, domain-queries.ts |
| Domain | Per-domain orchestration: fenced transaction, post-release state machine | domain-runner.ts |
| Engine | Daemon loop, cycle creation, domain iteration, authority failure handling | engine.ts, cycle-runner.ts |

## 6. Dependency Graph

```
Sprint 0: Skeleton
    │
    ▼
Sprint 1: PostgreSQL Infrastructure + AMAIA Smoke Probe
    │
    ▼
Sprint 2: Lease Subsystem
    │
    ▼
Sprint 3: Run Lifecycle
    │
    ▼
Sprint 4: Recovery Core + Operational Failure Channel
    │
    ▼
Sprint 5: Manifest Lifecycle
    │
    ▼
Sprint 6: MySQL Read Adapter
    │
    ▼
Sprint 7: control_llamadas Technical MVP ← MVP
    │
    ▼
Sprint 8: logestado + Hardening + Observability
```

Each sprint depends on the previous. No sprint may be implemented out of order.

## 7. Construction Strategy

**Vertical Slice Incremental Strategy.**

Each sprint adds one functional layer. Integration testing grows cumulatively.

---

## 8. Sprint 0 — Runtime Skeleton

### Objective

Daemon executable without business logic.

### Entregables

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point: bootstrap → daemon loop → shutdown |
| `src/config/config.ts` | Load + validate environment variables |
| `src/config/domain-registry.ts` | Domain definitions, append-only gate (R26) |
| `src/observability/logger.ts` | Structured JSON logger to stdout |
| `src/observability/metrics.ts` | Prometheus metrics registry + HTTP endpoint |
| `src/errors/error-types.ts` | Error taxonomy classes |
| `package.json`, `tsconfig.json`, `Dockerfile` | Build infrastructure |
| CI pipeline configuration | lint, typecheck, test, build |

### Behavior

- Engine starts, validates config, logs `engine.start`.
- Daemon loop ticks at `SYNC_CYCLE_INTERVAL_MS` (no business logic).
- SIGTERM/SIGINT → graceful shutdown.
- Missing required env var → startup failure.
- Zero valid domains → startup failure (R26).

### QA

| Test | Validates |
|---|---|
| Startup with valid config | engine.start logged, metrics responds |
| Missing required var | Configuration error exit |
| Zero valid domains | Configuration error exit |
| SIGTERM during idle | Clean shutdown |
| Metrics endpoint | Prometheus format |

### Definition of Done

Per Section 18.

---

## 9. Sprint 1 — PostgreSQL Infrastructure + AMAIA Smoke Probe

### Objective

Transactional PostgreSQL connectivity. Early AMAIA schema validation.

### Entregables

| File | Purpose |
|---|---|
| `src/repositories/pg-client.ts` | pg.Pool (max=1), connect(), SSL |
| AMAIA smoke probe script | Connectivity + schema validation |

### PostgreSQL behavior

- PoolClient lifecycle: connect, BEGIN, COMMIT, ROLLBACK.
- SET LOCAL ROLE amaia_sync_runtime.
- Rollback failure → client.release(true).
- Connection retry with backoff.

### AMAIA Readonly Smoke Probe

Validates early, before the MySQL adapter is built:

- Connect with readonly user.
- Verify expected tables exist (control_llamadas, logestado).
- Verify schema metadata (columns, types).
- Execute MAX(id) queries.
- Capture baseline schema assumptions.
- Log results. No data sync.

This probe reduces risk: schema mismatches discovered at Sprint 1, not Sprint 6.

### QA

| Test | Validates |
|---|---|
| PG connect + BEGIN + COMMIT | Transaction completes |
| PG connect + BEGIN + ROLLBACK | Transaction reverts |
| SET LOCAL ROLE | current_user verified |
| Rollback failure | client.release(true), fresh client next |
| Connection retry | Backoff applied |
| AMAIA probe: connectivity | Connection established |
| AMAIA probe: tables exist | control_llamadas, logestado found |
| AMAIA probe: MAX(id) | Returns valid integer |

### Definition of Done

Per Section 18.

---

## 10. Sprint 2 — Lease Subsystem

### Objective

Scheduler lease and domain lease.

### Entregables

| File | Purpose |
|---|---|
| `src/core/scheduler.ts` | Scheduler lease lifecycle |
| `src/services/lease-manager.ts` | Domain lease acquire/release/validate |
| `src/repositories/lease-repository.ts` | amaia_sync_leases CRUD |

### QA

| Test | Validates |
|---|---|
| Scheduler acquire available | Acquired |
| Scheduler acquire held | Returns false |
| Scheduler heartbeat | Lease extended |
| Scheduler release | Cleared |
| Domain lease acquire (fenced) | SELECT FOR UPDATE |
| Domain lease contention | DomainLeaseContentionError |
| Domain lease release (best-effort) | Non-fatal on failure |
| Lease expiry detection | Stale |
| Token/owner mismatch | Detected |

### Definition of Done

Per Section 18.

---

## 11. Sprint 3 — Run Lifecycle

### Objective

Complete run orchestration.

### Entregables

| File | Purpose |
|---|---|
| `src/services/run-service.ts` | Run lifecycle operations |
| `src/repositories/run-repository.ts` | amaia_sync_runs CRUD |
| `src/repositories/cycle-repository.ts` | amaia_sync_cycles INSERT |

### QA

| Test | Validates |
|---|---|
| Pre-run NULL credentials | R22 |
| Bind-to-lease | Atomic |
| Bind failure | Error |
| Terminal status success | Set |
| Terminal status discrepancy | Set |
| Lock contention closure | skipped_lock_contention |
| Cycle creation | Immutable lineage |

### Definition of Done

Per Section 18.

---

## 12. Sprint 4 — Recovery Core + Operational Failure Channel

### Objective

Recovery minimum viable layer. Required before any domain execution (R28).

### Entregables

| File | Purpose |
|---|---|
| `src/services/recovery-service.ts` | Stale detection + abandon + classification |
| `src/services/operational-error-service.ts` | Durable failure evidence write + read |
| `src/repositories/operational-error-repository.ts` | Error table CRUD |

### Recovery behavior

- **Startup recovery:** Execute before first cycle.
- **Cycle-start recovery:** Execute after scheduler lease acquisition, before domain iteration (R28).
- **Bound stale detection:** Domain lease predicate with `clock_timestamp()`.
- **Unbound stale detection:** Run-local age, no lease JOIN (R34).
- **Manifest abandonment:** `amaia_sync_abandon_manifest` for bound runs with non-terminal manifests.
- **Healthy run protection:** No abandon if credentials match + lease valid (R8).
- **Orphan classification:** Without durable evidence → `orphan_recovered`. With evidence → `failed`.
- **Idempotent:** Repeated recovery calls are no-ops on already-terminal runs.

### Operational Failure Channel behavior

- Write durable unrecoverable error evidence **outside** any fenced transaction (after rollback + client.release).
- Read during recovery to classify `failed` vs `orphan_recovered`.
- Same pgPool (max=1). No write while fenced PoolClient checked out.
- Sole source of truth for `failed` classification.

### QA

| Test | Validates |
|---|---|
| Startup recovery cleans stale runs | R28 |
| Cycle-start recovery cleans stale runs | R28 |
| Bound stale with manifest | Abandoned, orphan_recovered |
| Bound stale without manifest | orphan_recovered |
| Unbound stale pre-run | orphan_recovered (R34) |
| Healthy run protection | Not abandoned (R8) |
| Durable evidence → failed | Classification correct |
| No evidence → orphan_recovered | Default classification |
| Repeated recovery (idempotent) | No-op on second call |
| Crash after abandon before run update | Next call completes |
| Operational error recording | Survives rollback |
| Operational error record failure | Original error preserved |
| No write while PoolClient checked out | No deadlock |

### Definition of Done

Per Section 18.

---

## 13. Sprint 5 — Manifest Lifecycle

### Objective

Full Manifest Finalization Protocol v1.6.4. Simulated datasets.

### Entregables

| File | Purpose |
|---|---|
| `src/services/manifest-service.ts` | All manifest operations including Guarded Terminalization |
| `src/services/watermark-service.ts` | Watermark read, compute bounds, hard revalidation |
| `src/repositories/manifest-repository.ts` | Manifests + identity items INSERT |
| `src/repositories/watermark-repository.ts` | Watermarks SELECT |

### QA (simulated datasets)

| Test | Validates |
|---|---|
| Empty incremental lifecycle | count=0, sets_match=true, no CAS |
| Non-empty lifecycle (simulated) | Source → finalize → CAS → complete |
| Guarded Term: success | guard=1, complete=1, updated=1 |
| Guarded Term: expired lease | guard=0 → rollback |
| Guarded Term: wrong phase | guard=0 → rollback |
| Guarded Term: complete_count=0 | updated=0 → rollback |
| Hard watermark revalidation failure | Rollback |
| CAS success | Watermark advanced |
| CAS failure | Rollback, watermark unchanged |
| Discrepancy detection | sets_match=false, no CAS |

### Definition of Done

Per Section 18.

---

## 14. Sprint 6 — MySQL Read Adapter

### Objective

Read-only AMAIA connectivity. Batched fetch.

### Entregables

| File | Purpose |
|---|---|
| `src/repositories/mysql-client.ts` | MySQL connection pool (read-only) |
| `src/extraction/amaia-fetcher.ts` | Batched row fetcher |
| `src/extraction/domain-queries.ts` | Per-domain SELECT + MAX(id) queries |

### QA

| Test | Validates |
|---|---|
| Connect to AMAIA | Established |
| Fetch known data | Correct rows, order |
| Fetch empty range | Zero rows |
| Batched fetch (multi-page) | All pages combined |
| MAX(id) computation | Correct |
| Connection failure + retry | Backoff |
| Invalid credentials | Clear error |
| Timeout handling | AmaiaFetchError |

### Definition of Done

Per Section 18.

---

## 15. Sprint 7 — control_llamadas Technical MVP

### Objective

End-to-end synchronization of control_llamadas. **This is the Technical MVP.**

### Entregables

| File | Purpose |
|---|---|
| `src/core/domain-runner.ts` | Complete fenced transaction orchestration |
| `src/core/cycle-runner.ts` | Cycle creation + domain iteration |
| `src/core/engine.ts` | Daemon loop integration |
| `src/repositories/destination-repository.ts` | Domain-specific upsert |

### Behavior

Complete per-domain flow from blueprint Section 8: pre-fence → fenced transaction (12 steps) → post-release state machine.

### QA

| Test | Validates |
|---|---|
| Full cycle with real AMAIA data | Rows synced, manifest, watermark |
| Empty incremental | No CAS, success |
| Discrepancy (manual setup) | completed_with_discrepancy |
| Lock contention | skipped_lock_contention |
| Scheduler heartbeat between domains | Lease extended |
| Authority failure (scheduler expired) | Cycle aborted |
| Graceful shutdown mid-cycle | Current domain completes |
| Pool ordering | close/record/release after client.release() |
| Recovery before cycle | Stale runs cleaned |

### Technical MVP acceptance criteria

- Daemon runs continuously on AMAIASQL.
- Recovery operational (startup + cycle-start).
- control_llamadas rows sync from AMAIA to Supabase.
- Manifests auditable (sets_match, hashes, counts).
- Watermarks advance correctly.
- Rows observable in Supabase destination tables (manual SQL verification).
- Operational errors durably recorded.

### Definition of Done

Per Section 18.

---

## 16. Sprint 8 — logestado + Hardening + Observability

### Objective

Second domain. Production readiness.

### Entregables

| File | Changes |
|---|---|
| `src/config/domain-registry.ts` | logestado added |
| `src/extraction/domain-queries.ts` | logestado query added |
| `src/repositories/destination-repository.ts` | logestado upsert added |

Plus hardening:

- Retry policies finalized.
- All metrics operational.
- Alert thresholds configured.
- Long-run stability validation.

### QA

| Test | Validates |
|---|---|
| Both domains in one cycle | Both sync, both produce manifests |
| logestado-specific data | Correct rows, hashes |
| Domain isolation | Failure in one ≠ failure in other |
| Both domains within TTL | Timing validated |
| Multi-hour stability run | No leaks, no drift |
| All Prometheus metrics emitting | Verified |

### Reuse metric

Adding logestado requires **no changes** to core engine, lease, run, manifest, or recovery layers.

### Definition of Done

Per Section 18.

---

## 17. Incremental QA Strategy

### Mandatory Scenario Matrices

QA is measured by **invariant coverage**, not test count.

| Matrix | Covers | Sprints |
|---|---|---|
| R1–R35 Invariant Matrix | Every architectural invariant has at least one test | Cumulative across all sprints |
| Manifest Protocol v1.6.4 Matrix | Phase transitions, hash verification, sets_match, exclusion evidence | Sprint 5+ |
| Lease Matrix | Acquire, release, expiry, contention, heartbeat, token/owner mismatch | Sprint 2+ |
| Recovery Matrix | Bound stale, unbound stale, manifest abandon, healthy protection, idempotency | Sprint 4+ |
| Authority Failure Matrix | Scheduler expired, PG connection lost, AMAIA connection lost | Sprint 2+ |
| Rollback Matrix | Fenced rollback, poisoned client, bind revert | Sprint 1+ |
| Poisoned Client Matrix | Rollback failure → destroy, fresh client on next connect | Sprint 1+ |
| Operational Failure Matrix | Record after release, record failure → original preserved, no deadlock | Sprint 4+ |
| Crash Recovery Matrix | Crash after pre-run, crash after bind, crash after abandon | Sprint 4+ |
| Watermark Matrix | CAS success, CAS failure, hard revalidation, empty no-advance | Sprint 5+ |

### Per-sprint QA discipline

1. Sprint's own scenario matrix green.
2. All previous sprint matrices still green (no regression).
3. CI pipeline green (lint, typecheck, unit, integration, build).

## 18. Definition of Done

Each sprint may only be closed when **all** of the following are satisfied:

| # | Criterion |
|---|---|
| 1 | Sprint blueprint Codex-approved. |
| 2 | Implementation completed. |
| 3 | QA scenario matrix green. |
| 4 | No critical defects. |
| 5 | CI pipeline green (lint, typecheck, unit, integration, docker build, startup verification). |
| 6 | Documentation updated (sprint changelog, any architecture delta). |
| 7 | Git commit created. |
| 8 | Reproducible build generated (docker image or npm build). |
| 9 | Evidence artifacts stored (QA results, CI logs). |

A demo to stakeholders **never replaces** reproducible technical evidence.

## 19. CI/CD Pipeline (Mandatory)

Every sprint must pass the following pipeline before commit:

```
1. lint        → eslint strict
2. typecheck   → tsc --noEmit
3. unit tests  → vitest/jest
4. integration → Docker Compose (local PG + local MySQL)
5. docker build → Dockerfile builds successfully
6. startup verify → container starts and logs engine.start
7. migration verify → supabase db push --dry-run
8. artifact    → tagged docker image or dist archive
```

Pipeline failure blocks commit.

## 20. Technical MVP Definition

**Technical MVP = Sprint 7 closure.**

| Criterion | Required |
|---|---|
| Daemon running continuously | Yes |
| Recovery operational (startup + cycle-start) | Yes |
| control_llamadas synchronized | Yes |
| Manifest evidence generated | Yes |
| Watermarks advancing | Yes |
| Rows observable in Supabase destination tables | Yes (manual SQL) |
| Operational errors durably recorded | Yes |
| logestado syncing | No (Sprint 8) |
| Full observability (alerts, dashboards) | No (Sprint 8) |

No UI integration references. Data observability is via direct SQL query on Supabase tables.

## 21. Production Readiness Gates

| Gate | Requirement |
|---|---|
| PG1 | All sprints (0–8) implemented and committed. |
| PG2 | All QA scenario matrices green. |
| PG3 | Codex final audit: APPROVED on Sprint 8 deliverables. |
| PG4 | Recovery validated (startup + cycle-start + all stale paths). |
| PG5 | No critical or major open defects. |
| PG6 | Multi-hour stability run without leaks or drift. |
| PG7 | Operational runbook documented. |
| PG8 | Secrets validated (env vars, permissions, file ownership). |
| PG9 | Runtime roles/RLS validated against Supabase production. |
| PG10 | AMAIASQL connectivity validated (network, firewall, credentials). |
| PG11 | Observability alerts validated (Prometheus, thresholds). |
| PG12 | Clock skew assumptions validated (AMAIASQL vs Supabase). |
| PG13 | Deployment rollback validated (systemd stop → restart → recovery). |
| PG14 | Production dry-run completed (one full cycle on production data). |

All gates must be satisfied before production deployment.

## 22. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| AMAIA schema differs from assumptions | Medium | High | Sprint 1 smoke probe. Early discovery. |
| Lease TTL too short for large batches | Low | Medium | max_incremental_window (R17). Configurable TTL. |
| Supabase session pooler instability | Low | Medium | Retry + poisoned client destruction. |
| Codex rejects sprint blueprint | Medium | Low | Expected. Re-architecture budgeted. |
| AMAIA network latency | Low | Low | Single connection, batched fetch, safety lag. |
| Append-only assumption violated | Low | Critical | Deployment gate (R26). Immediate exclusion. |
| Management pressure to skip audits | Medium | Critical | Non-negotiable. Technical MVP at Sprint 7. |

## 23. Deliverables Matrix

| Sprint | Key deliverable | Recovery available | Audit required | MVP? |
|---|---|---|---|---|
| 0 | Executable daemon skeleton | No | Yes | No |
| 1 | PostgreSQL infrastructure + AMAIA smoke probe | No | Yes | No |
| 2 | Lease subsystem | No | Yes | No |
| 3 | Run lifecycle | No | Yes | No |
| 4 | **Recovery core + Operational Failure Channel** | **Yes** | Yes | No |
| 5 | Manifest lifecycle | Yes | Yes | No |
| 6 | MySQL read adapter | Yes | Yes | No |
| 7 | **control_llamadas end-to-end** | **Yes** | **Yes** | **YES — Technical MVP** |
| 8 | logestado + hardening + observability | Yes | Yes | No |

---

READY FOR CODEX RE-AUDIT
