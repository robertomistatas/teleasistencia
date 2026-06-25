# AMAIA-SYNC Runtime Engine

Single-process synchronization daemon — AMAIA MySQL (read-only) to Supabase PostgreSQL.

**Sprint 1 — PostgreSQL access layer operational.**

Sprint 0 delivered: bootstrap, configuration, observability, daemon lifecycle, graceful shutdown. Sprint 1 adds: PostgreSQL connectivity via `pg.Pool` (max=1), Pool Occupancy State Machine (8 states), Connection Initialization Barrier, coordinated shutdown, startup probe with retry, and PostgreSQL/Supabase smoke probe. Synchronization logic (leases, runs, manifests, watermarks, recovery) is implemented in Sprints 2–8.

## Prerequisites

- Node.js >= 20.0.0
- Docker (optional, for container deployment)

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_DB_URL` | Yes | — | PostgreSQL connection URL (`postgresql://user@host/db`) |
| `AMAIA_MYSQL_HOST` | Yes | — | AMAIA MySQL host |
| `AMAIA_MYSQL_USER` | Yes | — | AMAIA MySQL readonly user |
| `AMAIA_MYSQL_PASSWORD` | Yes | — | AMAIA MySQL password |
| `AMAIA_MYSQL_DATABASE` | Yes | — | AMAIA MySQL database name |
| `AMAIA_MYSQL_PORT` | No | 3306 | AMAIA MySQL port |
| `SYNC_CYCLE_INTERVAL_MS` | No | 60000 | Idle loop interval in ms |
| `SYNC_SAFETY_LAG_ID` | No | 100 | Safety lag for watermark computation |
| `SYNC_LEASE_TTL_SECONDS` | No | 300 | Lease TTL in seconds |
| `SYNC_BATCH_SIZE` | No | 1000 | Rows per fetch batch |
| `SYNC_MAX_WINDOW` | No | 10000 | Maximum incremental window |
| `SYNC_PRE_RUN_STALE_TTL_SECONDS` | No | 600 | Pre-run stale detection threshold |
| `SYNC_LOG_LEVEL` | No | info | Log level: info, warn, error |
| `METRICS_PORT` | No | 9090 | Prometheus metrics HTTP port |
| `ENABLE_IDLE_TICK_LOGS` | No | false | Emit engine.tick log each cycle |

`SUPABASE_DB_URL` is structurally validated at startup (scheme, host, database, username). Privileged users (`postgres`, `supabase_admin`, `service_role`) are blocked. Secrets are never logged.

Sprint 1 connects to Supabase PostgreSQL at startup (probe) and validates the connection. The PostgreSQL smoke probe is a standalone script that validates connectivity and runtime assumptions (version, user, search_path, statement_timeout).

## Build

```bash
npm ci
npm run build
```

## Run locally

```bash
# Copy and edit environment variables
cp .env.example .env

# Run compiled
npm start

# Run in development (ts directly)
npm run dev
```

## Run with Docker

```bash
# Build image
docker build -t amaia-sync-runtime:sprint0 .

# Run with default metrics port (9090)
docker run --rm \
  -e SUPABASE_DB_URL=postgresql://amaia_sync_runtime:pass@host:5432/postgres \
  -e AMAIA_MYSQL_HOST=amaiasql \
  -e AMAIA_MYSQL_USER=amaia_sync_reader \
  -e AMAIA_MYSQL_PASSWORD=pass \
  -e AMAIA_MYSQL_DATABASE=amaia \
  -p 9090:9090 \
  amaia-sync-runtime:sprint0
```

**METRICS_PORT and Docker port mapping:** The Dockerfile `EXPOSE 9090` documents the default metrics port. If you set `METRICS_PORT` to a different value, you must align the Docker port mapping:

```bash
# Example: metrics on port 9100
docker run --rm \
  -e METRICS_PORT=9100 \
  -e SUPABASE_DB_URL=postgresql://amaia_sync_runtime:pass@host:5432/postgres \
  -e AMAIA_MYSQL_HOST=amaiasql \
  -e AMAIA_MYSQL_USER=amaia_sync_reader \
  -e AMAIA_MYSQL_PASSWORD=pass \
  -e AMAIA_MYSQL_DATABASE=amaia \
  -p 9100:9100 \
  amaia-sync-runtime:sprint0
```

## Verify

```bash
# Check health endpoint
curl http://localhost:9090/health

# Expected response:
# {"status":"ok","engine_instance_id":"<uuid>","uptime_seconds":123}

# Check Prometheus metrics
curl http://localhost:9090/metrics

# Expected: amaia_sync_engine_info, amaia_sync_engine_uptime_seconds,
#           amaia_sync_cycles_total, process_* metrics
```

## Docker HEALTHCHECK

The Dockerfile includes a built-in HEALTHCHECK that polls `GET /health` every 30s. After the 15s start-period grace, `docker ps` will show the container as `healthy`.

The HEALTHCHECK respects `METRICS_PORT` — if you set a custom port, the check automatically targets `http://localhost:${METRICS_PORT}/health`. Alpine's built-in `busybox wget` is used (no additional packages required).

```bash
# Verify container health status
docker ps
# CONTAINER ID  IMAGE                       STATUS                  PORTS
# abc123        amaia-sync-runtime:sprint0   Up 45s (healthy)        0.0.0.0:9090->9090/tcp
```

## Pool Occupancy State Machine

The PostgreSQL pool tracks 8 states: `IDLE`, `ACQUIRING`, `CHECKED_OUT`, `QUERYING`, `DRAINING`, `DESTROYING`, `DONE`, `POISONED`.

- `connect()` and `query()` only proceed from `IDLE`. All other states → immediate `SupabaseConnectionError`.
- Shutdown waits for active operations (ACQUIRING, CHECKED_OUT, QUERYING) to complete before calling `pool.end()`.
- `POISONED` = release failure corrupted pool → controlled exit with code 1 → systemd restarts.

## Health endpoint semantics

```bash
curl http://localhost:9090/health

# Normal: 200 {"status":"ok","engine_instance_id":"...","uptime_seconds":...,"pool_state":"IDLE"}
# Poisoned: 503 {"status":"poisoned","engine_instance_id":"...","restart_required":true,"pool_state":"POISONED"}
```

## PostgreSQL/Supabase Smoke Probe

Standalone script to validate Supabase PostgreSQL connectivity and runtime assumptions:

```bash
# Requires SUPABASE_DB_URL (and other env vars for config loading)
npm run smoke:pg
```

Validates: `SELECT 1`, `version()`, `current_user`, `search_path`, `statement_timeout` (must equal `30s`). Does NOT modify data or schema.

## Test

```bash
npm test
```

## Lint and typecheck

```bash
npm run lint
npm run typecheck
```

## Architecture

Normative documents in `/docs`:

- `AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2`
- `AMAIA_SYNC_RUNTIME_IMPLEMENTATION_BLUEPRINT_v1.6.1`
- `AMAIA_SYNC_MANIFEST_FINALIZATION_PROTOCOL_v1.6.4`
- `AMAIA_SYNC_RUNTIME_TYPESCRIPT_IMPLEMENTATION_PLAN_v1.1`
- `AMAIA_SYNC_SPRINT0_RUNTIME_SKELETON_BLUEPRINT_v1.1`
- `AMAIA_SYNC_SPRINT1_POSTGRESQL_ACCESS_BLUEPRINT_v1.5`
