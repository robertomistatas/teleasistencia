# AMAIA-SYNC Runtime TypeScript Implementation Plan v1.0

**Type:** Implementation plan  
**Phase:** 9.4C  
**Status:** Pending Codex audit  
**Parent architecture:** AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 (Codex approved)  
**Parent blueprint:** AMAIA_SYNC_RUNTIME_IMPLEMENTATION_BLUEPRINT_v1.6.1 (Codex approved with observations)  
**DB baseline:** Commit bd93634 (Phase 9.3C closed)  
**Author:** Claude (constructor)  
**Date:** 2026-06-24

---

## 1. Business Problem

Mistatas needs a functioning AMAIA-SYNC daemon to keep Supabase current with AMAIA data for dashboards, SLA monitoring, and institutional reporting. Management and CEO require demonstrable progress. The construction must be incremental, auditable, and production-safe — maximum velocity compatible with correct architecture.

## 2. Goals

1. Deliver a working daemon that synchronizes control_llamadas and logestado from AMAIA to Supabase.
2. Produce cryptographic manifest evidence for every sync operation.
3. Demonstrate MVP (control_llamadas end-to-end) as early as Sprint 6.
4. Validate architectural reuse when adding logestado in Sprint 7.
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

**One Vertical Slice At A Time.** Each sprint adds one layer or capability. No horizontal "build everything then integrate."

### Sprint lifecycle

```
Sprint Blueprint → Codex Audit → Re-architecture (if rejected) → Implementation → Automated QA → Commit
```

No sprint may begin implementation before its blueprint is Codex-approved.

## 5. Runtime Layer Model

| Layer | Responsibility | Key files |
|---|---|---|
| Configuration | Environment loading, validation, domain registry, append-only gate | config.ts, domain-registry.ts |
| Infrastructure | PostgreSQL connectivity, PoolClient lifecycle, transaction management | pg-client.ts |
| Persistence | Repository layer: runs, cycles, leases, watermarks, manifests, destinations, operational errors | *-repository.ts |
| Lease | Scheduler lease, domain lease acquire/release/heartbeat/validate | lease-manager.ts, scheduler.ts |
| Run Lifecycle | Pre-run creation, bind-to-lease, terminal status, lock contention closure | run-service.ts |
| Manifest | Create manifest, insert source items, call finalizers, Guarded Terminalization | manifest-service.ts |
| MySQL Adapter | Read-only AMAIA connection, batched fetch, domain queries | mysql-client.ts, amaia-fetcher.ts, domain-queries.ts |
| Domain | Per-domain orchestration: fenced transaction, post-release state machine | domain-runner.ts |
| Engine | Daemon loop, cycle creation, domain iteration, authority failure handling | engine.ts, cycle-runner.ts |
| Recovery | Stale detection (bound/unbound), manifest abandonment, orphan classification | recovery-service.ts |

## 6. Dependency Graph

```
Sprint 0: Skeleton
    │
    ▼
Sprint 1: PostgreSQL Infrastructure
    │
    ▼
Sprint 2: Lease Subsystem
    │
    ▼
Sprint 3: Run Lifecycle
    │
    ▼
Sprint 4: Manifest Lifecycle
    │
    ▼
Sprint 5: MySQL Adapter
    │
    ▼
Sprint 6: First Domain (control_llamadas) ← MVP
    │
    ▼
Sprint 7: Second Domain (logestado)
    │
    ▼
Sprint 8: Recovery & Hardening
```

Each sprint depends on the previous. No sprint may be implemented out of order.

## 7. Construction Strategy

**Vertical Slice Incremental Strategy.**

Each sprint adds one functional layer that builds on the previous. Integration testing grows cumulatively — Sprint N tests include Sprint N-1 scenarios plus new ones.

**Simulated dependencies:** Sprints 2–4 use in-memory fixtures or test-scoped database state to simulate layers not yet built. Sprint 6 is the first full integration with real AMAIA data.

**No dead code:** Every sprint produces runnable, testable code. No scaffolding that "will be used later."

---

## 8. Sprint 0 — Runtime Skeleton

### Objective

Daemon executable without business logic. Proves the runtime can start, log, and shut down cleanly.

### Entregables

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point: bootstrap → daemon loop → shutdown |
| `src/config/config.ts` | Load + validate environment variables |
| `src/config/domain-registry.ts` | Domain definitions, append-only gate (R26) |
| `src/observability/logger.ts` | Structured JSON logger to stdout |
| `src/observability/metrics.ts` | Prometheus metrics registry + HTTP endpoint |
| `src/errors/error-types.ts` | Error taxonomy classes |
| `package.json` | Dependencies: pg, mysql2, prom-client, dotenv |
| `tsconfig.json` | Strict TypeScript configuration |
| `Dockerfile` | Containerized build |

### Behavior

- Engine starts, validates config, logs `engine.start`.
- Daemon loop ticks at `SYNC_CYCLE_INTERVAL_MS` (does nothing yet).
- SIGTERM/SIGINT → graceful shutdown, logs `engine.shutdown`.
- Missing required env var → startup failure with clear error.
- Zero valid domains after append-only gate → startup failure (R26).

### QA

| Test | Validates |
|---|---|
| Startup with valid config | Logs engine.start, metrics endpoint responds |
| Startup with missing required var | Exits with configuration error |
| Startup with zero valid domains | Exits with configuration error |
| SIGTERM during idle loop | Clean shutdown, logs engine.shutdown |
| Metrics endpoint | Responds with Prometheus format |

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 9. Sprint 1 — PostgreSQL Infrastructure Layer

### Objective

Transactional PostgreSQL connectivity. PoolClient lifecycle. SET LOCAL ROLE.

### Entregables

| File | Purpose |
|---|---|
| `src/repositories/pg-client.ts` | pg.Pool (max=1), connect(), session pooler, SSL |

### Behavior

- `pgPool.connect()` returns PoolClient.
- `client.query('BEGIN')` / `'COMMIT'` / `'ROLLBACK'`.
- `SET LOCAL ROLE amaia_sync_runtime` on PoolClient.
- Rollback failure → `client.release(true)` (destroy poisoned client).
- Healthy path → `client.release()`.
- Connection retry with exponential backoff.

### QA

| Test | Validates |
|---|---|
| Connect + BEGIN + COMMIT | Transaction completes |
| Connect + BEGIN + ROLLBACK | Transaction reverts |
| SET LOCAL ROLE | current_user = amaia_sync_runtime inside tx |
| Rollback failure simulation | client.release(true) called, next connect() fresh |
| Connection failure + retry | Backoff applied, eventual success or authority error |
| Transaction pooler rejected | Connection fails appropriately |

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 10. Sprint 2 — Lease Subsystem

### Objective

Scheduler lease and domain lease acquire/release/heartbeat.

### Entregables

| File | Purpose |
|---|---|
| `src/core/scheduler.ts` | Scheduler lease lifecycle |
| `src/services/lease-manager.ts` | Domain lease acquire/release/validate |
| `src/repositories/lease-repository.ts` | amaia_sync_leases CRUD |

### Behavior

- Scheduler lease: acquire, heartbeat between domains, release, validity check.
- Domain lease: acquire inside fenced tx (PoolClient), release post-commit (pool, best-effort).
- Lease expiry detection.
- Token/owner validation.

### QA

| Test | Validates |
|---|---|
| Scheduler acquire when available | Lease acquired, credentials set |
| Scheduler acquire when held | Returns false |
| Scheduler heartbeat | lease_expires_at extended |
| Scheduler release | owner_identity cleared |
| Domain lease acquire (fenced) | SELECT FOR UPDATE, credentials set |
| Domain lease contention | Raises DomainLeaseContentionError |
| Domain lease release (best-effort) | Non-fatal on failure |
| Lease expiry detection | Expired lease → stale |
| Token mismatch | Detected correctly |
| Owner mismatch | Detected correctly |

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 11. Sprint 3 — Run Lifecycle

### Objective

Complete run orchestration: pre-run, bind, terminal status, lock contention closure.

### Entregables

| File | Purpose |
|---|---|
| `src/services/run-service.ts` | Run lifecycle operations |
| `src/repositories/run-repository.ts` | amaia_sync_runs CRUD |
| `src/repositories/cycle-repository.ts` | amaia_sync_cycles INSERT |

### Behavior

- Pre-run creation with NULL credentials (R22, R29).
- Bind-run-to-lease inside fenced tx (R23).
- Terminal status: success, completed_with_discrepancy.
- Lock contention closure: skipped_lock_contention (post-release).
- Cycle creation with scheduler lineage.

### QA

| Test | Validates |
|---|---|
| Pre-run NULL credentials | owner_identity=NULL, lease_token=NULL |
| Bind-to-lease | Credentials set atomically |
| Bind failure (already bound) | Raises error |
| Terminal status success | status='success', finished_at set |
| Terminal status discrepancy | status='completed_with_discrepancy' |
| Lock contention closure | status='skipped_lock_contention' |
| Cycle creation | Immutable lineage columns |

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 12. Sprint 4 — Manifest Lifecycle

### Objective

Full Manifest Finalization Protocol v1.6.4 implementation. Simulated datasets (no real AMAIA yet).

### Entregables

| File | Purpose |
|---|---|
| `src/services/manifest-service.ts` | All manifest operations including Guarded Terminalization |
| `src/services/watermark-service.ts` | Watermark read, compute bounds, hard revalidation |
| `src/repositories/manifest-repository.ts` | Manifests + identity items INSERT |
| `src/repositories/watermark-repository.ts` | Watermarks SELECT |

### Behavior

- Create manifest (phase=created).
- Insert source items (batch).
- Call finalize_source, finalize_comparison via RPC.
- Call advance_watermark_cas (conditional).
- Guarded Terminalization: CTE with clock_timestamp(), guard → complete → updated, three count assertions.
- Hard watermark revalidation (R24).
- Bounds computation with safety lag and max_incremental_window (R17).

### QA (simulated datasets)

| Test | Validates |
|---|---|
| Empty incremental lifecycle | count=0, sets_match=true, no CAS |
| Non-empty lifecycle (simulated) | Source items → finalize → CAS → complete |
| Guarded Term: success | guard=1, complete=1, updated=1 |
| Guarded Term: expired lease | guard=0 → rollback |
| Guarded Term: wrong phase | guard=0 → rollback |
| Guarded Term: complete_count=0 | updated=0 → rollback |
| Hard watermark revalidation failure | Rollback |
| CAS success | Watermark advanced |
| CAS failure | Rollback, watermark unchanged |
| Discrepancy detection | sets_match=false, no CAS |

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 13. Sprint 5 — MySQL Read Adapter

### Objective

Read-only AMAIA connectivity. Batched fetch. Domain query definitions.

### Entregables

| File | Purpose |
|---|---|
| `src/repositories/mysql-client.ts` | MySQL connection pool (read-only) |
| `src/extraction/amaia-fetcher.ts` | Batched row fetcher |
| `src/extraction/domain-queries.ts` | Per-domain SELECT + MAX(id) queries |

### Behavior

- Single read-only MySQL connection.
- Batched fetch: `SELECT * FROM :table WHERE id > ? AND id <= ? ORDER BY id LIMIT ?`.
- MAX(id) for safe upper bound.
- Connection retry with backoff.
- No writes, no procedures, no temp tables (R3).

### QA

| Test | Validates |
|---|---|
| Connect to AMAIA | Connection established |
| Fetch with known data | Correct rows returned, correct order |
| Fetch empty range | Zero rows, no error |
| Batched fetch (multiple pages) | All pages combined correctly |
| MAX(id) computation | Correct value |
| Connection failure + retry | Backoff applied |
| Invalid credentials | Clear error |
| Timeout handling | Query timeout → AmaiaFetchError |

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 14. Sprint 6 — First Domain: control_llamadas (MVP)

### Objective

End-to-end synchronization of control_llamadas. This is the **MVP**.

### Entregables

| File | Purpose |
|---|---|
| `src/core/domain-runner.ts` | Complete fenced transaction orchestration |
| `src/core/cycle-runner.ts` | Cycle creation + domain iteration |
| `src/core/engine.ts` | Daemon loop integration |
| `src/repositories/destination-repository.ts` | Domain-specific upsert |

### Behavior

Complete per-domain flow from blueprint Section 8:

1. Pre-fence: read watermark, compute bounds, fetch AMAIA, create pre-run.
2. Fenced transaction: BEGIN, SET LOCAL ROLE, acquire lease, bind, revalidate, create manifest, insert source, upsert destination, finalize_source, finalize_comparison, CAS (conditional), Guarded Terminalization, COMMIT.
3. Post-release: closeLockContention, recordUnrecoverableError, throw originalError, releaseDomainLease.
4. Identical state machine for empty incremental.

### QA

| Test | Validates |
|---|---|
| Full cycle with real AMAIA data | Rows synced, manifest complete, watermark advanced |
| Empty incremental | No CAS, success, watermark unchanged |
| Discrepancy (manual data setup) | completed_with_discrepancy |
| Lock contention | skipped_lock_contention |
| Scheduler heartbeat between domains | Lease extended |
| Authority failure (scheduler expired) | Cycle aborted |
| Graceful shutdown mid-cycle | Current domain completes |
| Pool ordering verified | close/record/release all after client.release() |
| Data visible in Seguimientos | Destination table populated |

### MVP acceptance criteria

- Daemon runs continuously on AMAIASQL.
- control_llamadas rows sync from AMAIA to Supabase.
- Manifests are auditable (sets_match, hashes, counts).
- Watermarks advance correctly.
- Data is visible in the Seguimientos dashboard.

### Audit gate

Blueprint → Codex → Implementation → QA → MVP demo → Commit.

---

## 15. Sprint 7 — Second Domain: logestado

### Objective

Add logestado. Validate architectural reuse.

### Entregables

| File | Changes |
|---|---|
| `src/config/domain-registry.ts` | logestado configuration added |
| `src/extraction/domain-queries.ts` | logestado query added |
| `src/repositories/destination-repository.ts` | logestado upsert added |

### Behavior

Identical to control_llamadas. Domain-runner processes both in fixed order. No structural changes to engine, lease, run, or manifest layers.

### QA

| Test | Validates |
|---|---|
| Full cycle, both domains | Both sync, both produce manifests |
| logestado-specific data | Correct rows, correct hashes |
| Domain isolation | Failure in one does not affect other |
| Cycle timing | Both domains within one lease TTL |

### Success metric

Adding logestado requires **no changes** to core engine, lease, run, or manifest layers — only configuration and domain-specific queries/upserts.

### Audit gate

Blueprint → Codex → Implementation → QA → Commit.

---

## 16. Sprint 8 — Recovery & Hardening

### Objective

Production-ready daemon.

### Entregables

| File | Purpose |
|---|---|
| `src/services/recovery-service.ts` | Stale detection + abandon + classification |
| `src/services/operational-error-service.ts` | Durable failure evidence |
| `src/repositories/operational-error-repository.ts` | Error table CRUD |

### Behavior

- Recovery at startup AND before every cycle (R28).
- Bound stale detection (domain lease predicate, clock_timestamp).
- Unbound stale detection (run-local age, R34).
- Manifest abandonment via amaia_sync_abandon_manifest.
- Operational Failure Channel: write after rollback+release, sole source for `failed`.
- Retry policies hardened.
- All metrics and alerts operational.

### QA

| Test | Validates |
|---|---|
| Recovery: bound stale + manifest | Abandoned, orphan_recovered |
| Recovery: bound stale no manifest | orphan_recovered |
| Recovery: unbound stale | orphan_recovered |
| Recovery: durable evidence | failed |
| Recovery: repeated call (idempotent) | No-op |
| Recovery: crash after abandon | Next call completes |
| Operational error recording | Survives rollback |
| Operational error record failure | Original error preserved |
| Full production simulation | Multi-hour run, no leaks, no drift |

### Audit gate

Blueprint → Codex → Implementation → QA → Production readiness review → Commit.

---

## 17. Incremental QA Strategy

### Per-sprint QA

Each sprint produces:

1. **Unit tests** for the sprint's modules.
2. **Integration tests** that include all previous sprints' scenarios.
3. **No regression:** previous sprint tests must still pass.

### QA tooling

| Tool | Purpose |
|---|---|
| vitest or jest | Unit + integration test runner |
| Docker Compose | Local MySQL + local Supabase for integration |
| GitHub Actions | CI pipeline |

### Cumulative test matrix

| Sprint | Cumulative test count (approximate) |
|---|---|
| 0 | 5 |
| 1 | 11 |
| 2 | 21 |
| 3 | 28 |
| 4 | 38 |
| 5 | 46 |
| 6 | 55 |
| 7 | 59 |
| 8 | 68+ |

## 18. MVP Definition

**MVP = Sprint 6 closure.**

| Criterion | Required |
|---|---|
| Daemon runs continuously | Yes |
| Scheduler lease operational | Yes |
| Domain lease operational | Yes |
| control_llamadas syncing real data | Yes |
| Manifests auditable | Yes |
| Watermarks advancing | Yes |
| Data visible in Seguimientos | Yes |
| Recovery operational | No (Sprint 8) |
| logestado syncing | No (Sprint 7) |
| Production hardening | No (Sprint 8) |

MVP is demonstrable to management. Full production readiness follows in Sprints 7–8.

## 19. Production Readiness Gates

| Gate | Requirement |
|---|---|
| PG1 | All sprints (0–8) implemented and committed. |
| PG2 | Full QA suite passing (68+ tests). |
| PG3 | Codex final audit: APPROVED on Sprint 8 deliverables. |
| PG4 | Recovery validated: stale runs detected and classified correctly. |
| PG5 | No critical or major open defects. |
| PG6 | Multi-hour stability run on AMAIASQL without leaks or drift. |
| PG7 | Operational runbook documented: startup, shutdown, monitoring, troubleshooting. |

All gates must be satisfied before production deployment.

## 20. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| AMAIA schema differs from assumptions | Medium | High | Sprint 5 validates real schema. Early discovery. |
| Lease TTL too short for large batches | Low | Medium | max_incremental_window (R17) bounds execution. Configurable TTL. |
| Supabase session pooler instability | Low | Medium | Retry with backoff. Poisoned client destruction. |
| Codex rejects sprint blueprint | Medium | Low | Expected workflow. Re-architecture is budgeted. |
| AMAIA network latency from AMAIASQL | Low | Low | Single connection, batched fetch, safety lag. |
| append-only assumption violated | Low | Critical | Deployment gate (R26). Immediate domain exclusion. |
| Management pressure to skip audits | Medium | Critical | Non-negotiable methodology. MVP at Sprint 6 demonstrates progress. |

## 21. Deliverables Matrix

| Sprint | Key deliverable | Audit required | MVP? |
|---|---|---|---|
| 0 | Executable daemon skeleton | Yes | No |
| 1 | PostgreSQL transactional infrastructure | Yes | No |
| 2 | Lease subsystem (scheduler + domain) | Yes | No |
| 3 | Run lifecycle (pre-run, bind, terminal) | Yes | No |
| 4 | Manifest lifecycle (finalization protocol) | Yes | No |
| 5 | MySQL read adapter (AMAIA connectivity) | Yes | No |
| 6 | **control_llamadas end-to-end** | **Yes** | **YES — MVP** |
| 7 | logestado (architectural reuse validation) | Yes | No |
| 8 | Recovery + hardening (production-ready) | Yes | No |

---

READY FOR CODEX AUDIT
