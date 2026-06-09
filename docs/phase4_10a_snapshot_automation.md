# Phase 4.10A Snapshot Automation

## Objetivo

Transformar la captura KPI desde un proceso manual/on-demand hacia una capa institucional:

1. programable
2. reproducible
3. auditable
4. idempotente
5. trazable

La fase no implementa PDF, email ni frontend nuevo. Su foco es backend, registro persistente de ejecuciones y base para futuras cadencias de reporting.

## Arquitectura

La arquitectura agrega una capa de automatizacion sobre `capture_kpi_daily_snapshot(...)`, sin reemplazar su semantica KPI.

### Fuente canonica que se mantiene

1. `capture_kpi_daily_snapshot(...)` sigue siendo la rutina que materializa snapshots.
2. `kpi_daily_snapshots` sigue siendo el historico persistido oficial.
3. `v_kpi_daily_snapshot_history` sigue siendo la capa de lectura historica.
4. `get_executive_metrics_summary(...)` y `get_executive_metrics_history(...)` mantienen su contrato actual.

### Capa nueva 4.10A

1. `snapshot_jobs`
2. `snapshot_job_runs`
3. `create_snapshot_job(...)`
4. `run_snapshot_job(...)`
5. `run_daily_snapshot_now(...)`
6. `get_snapshot_job_history(...)`
7. `get_snapshot_job_status(...)`

## Tablas

### `public.snapshot_jobs`

Registro persistente de jobs institucionales de snapshot.

Campos principales:

1. `job_key`
2. `job_name`
3. `cadence`
4. `scope`
5. `target_date_offset_days`
6. `default_window_days`
7. `schedule_config`
8. `metadata`
9. `is_enabled`
10. `created_by`
11. `created_at`

Semantica:

1. `cadence` define la base de programacion futura: `on_demand`, `daily`, `weekly`, `monthly`.
2. `scope` queda acotado a `institutional` en 4.10A, porque el job ejecuta la captura institucional completa que ya incluye snapshot global y snapshots por operadora.
3. `target_date_offset_days` deja preparada la ejecucion relativa, por ejemplo `0` para capturar hoy.
4. `schedule_config` deja espacio para futura integracion con scheduler real sin fijar todavia un motor externo.

### `public.snapshot_job_runs`

Registro auditable de cada ejecucion real.

Campos principales:

1. `job_id`
2. `run_type`
3. `scope`
4. `target_date`
5. `window_days`
6. `status`
7. `started_at`
8. `finished_at`
9. `duration_ms`
10. `snapshots_created`
11. `snapshots_updated`
12. `error_message`
13. `metadata`
14. `executed_by`
15. `created_at`

Semantica:

1. `run_type` distingue `manual`, `scheduled` y `backfill`.
2. `status` registra `running`, `succeeded` o `failed`.
3. `metadata` conserva request, metadata pedida por quien ejecuta y resultado consolidado.
4. `snapshots_created` y `snapshots_updated` permiten medir el efecto de una ejecucion sin reinterpretar el historico.

## RPCs

### `create_snapshot_job(...)`

Uso:

1. crea un job persistente
2. valida admin/super_admin
3. valida `window_days > 0`
4. valida `schedule_config` y `metadata` como `jsonb` objeto

### `run_snapshot_job(...)`

Uso:

1. ejecuta un job persistente o ad hoc
2. registra un row en `snapshot_job_runs`
3. llama internamente a `capture_kpi_daily_snapshot(...)`
4. calcula `snapshots_created` y `snapshots_updated`
5. deja registro de exito o falla sin perder trazabilidad

Semantica:

1. si `job_id` existe, toma defaults desde `snapshot_jobs`
2. si `job_id` es `null`, permite corrida manual o backfill
3. si la ejecucion falla despues de abrir el run, el run queda en `failed` con `error_message`
4. si el parametro es invalido, no se corrige silenciosamente; la falla queda registrada

### `run_daily_snapshot_now(...)`

Wrapper de conveniencia para ejecucion manual o backfill sin job persistente.

### `get_snapshot_job_history(...)`

Devuelve historial ordenado por ejecucion mas reciente.

### `get_snapshot_job_status(...)`

Devuelve estado actual de cada job persistente usando su ultima corrida registrada.

## Idempotencia

La idempotencia se apoya en dos capas.

### Capa 1: snapshots unicos

`kpi_daily_snapshots` ya trae unicidad por:

1. `snapshot_date + scope_type` para global
2. `snapshot_date + scope_type + operator_profile_id` para operator

La captura subyacente hace `upsert`, no `insert` ciego.

### Capa 2: ejecucion auditable

Cada corrida queda registrada aunque reejecute la misma fecha objetivo.

Consecuencias:

1. no hay duplicacion silenciosa de snapshots
2. si un job se relanza para la misma fecha, queda evidencia del rerun
3. `snapshots_created` puede ir a `0` en reejecuciones consistentes
4. `snapshots_updated` permite ver que hubo un upsert sobre claves ya existentes

La fase no borra snapshots historicos ni intenta reconstruir pasado no capturado.

## Seguridad

Todas las RPCs nuevas:

1. usan `SECURITY DEFINER`
2. fijan `search_path = public`
3. aplican fail-closed sobre `NULL-role`

Regla de acceso:

1. `admin` y `super_admin` pueden crear jobs, correr jobs y consultar historia/estado
2. `teleoperadora` queda denegada
3. usuario inexistente o con rol no permitido queda denegado

Las tablas nuevas tienen RLS habilitado y politica select solo para `admin` y `super_admin`.

## Ejecucion manual

### Crear un job

```sql
select public.create_snapshot_job(
  'daily-institutional-snapshot',
  'Daily institutional snapshot',
  'daily',
  30,
  0,
  '{"timezone":"America/Santiago","hour":6}'::jsonb,
  '{"owner":"operations"}'::jsonb,
  true
);
```

### Ejecutar un job persistente

```sql
select public.run_snapshot_job(
  'JOB_UUID_AQUI'::uuid,
  current_date,
  30,
  'scheduled',
  '{"trigger":"manual verification"}'::jsonb
);
```

### Ejecutar snapshot manual sin job

```sql
select public.run_daily_snapshot_now(
  current_date,
  30,
  'manual',
  '{"trigger":"on-demand"}'::jsonb
);
```

### Consultar historial

```sql
select *
from public.get_snapshot_job_history(null, 20);
```

### Consultar estado actual

```sql
select *
from public.get_snapshot_job_status(null);
```

## Reporting cadence foundation

4.10A deja lista la base para:

1. snapshots diarios
2. snapshots semanales
3. snapshots mensuales
4. jobs de backfill controlado
5. orquestacion futura de reportes municipales o institucionales

Lo que queda preparado para 4.10B / 4.10C:

1. scheduler real externo o triggerado
2. report jobs que partan desde snapshot ya registrado
3. render PDF/export
4. entrega automatica de artefactos
5. dashboards de monitoreo de jobs

## Observaciones

1. `run_snapshot_job(...)` registra fallas controladas en vez de corregir parametros invalidos en silencio.
2. `run_daily_snapshot_now(...)` no crea un job persistente; deja trazabilidad de corrida manual en `snapshot_job_runs`.
3. `get_snapshot_job_status(...)` resume jobs persistentes; las corridas manuales ad hoc viven en `get_snapshot_job_history(...)`.
