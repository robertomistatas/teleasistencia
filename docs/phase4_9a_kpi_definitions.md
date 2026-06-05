# Phase 4.9A KPI Definitions

## Objetivo

Definir la semantica canonica de KPIs operacionales para que los futuros dashboards consuman backend SQL, RPCs, views y snapshots sin recalcular logica en frontend.

Esta fase no construye dashboards ejecutivos finales. Su alcance es:

1. semantica KPI
2. agregacion canonica
3. runtime views reutilizables
4. estrategia snapshot e historico

## Principios obligatorios

1. El frontend no calcula KPIs.
2. El source of truth siempre es backend SQL/RPC/view.
3. `raw_call_logs` no es fuente directa de KPIs operacionales.
4. La cobertura vigente se deriva de `followup_events` y `beneficiary_followup_status`.
5. La operacion viva se apoya en `v_operational_follow_up_workspace`.
6. La calidad de importacion se calcula desde `import_runs`, `import_job_errors` y `call_log_correlation_issues`.
7. La lectura institucional debe excluir operadores inactivos de comparativos y rankings.

## Scope y seguridad

### Teleoperadora

1. Solo puede consultar su cartera visible y sus metricas.
2. Los RPCs de cartera vencida y resumen operacional deben limitarse a beneficiarios con asignacion activa hacia esa teleoperadora.
3. Los comparativos por operadora deben devolver solo su propia fila cuando la solicitante es teleoperadora.

### Admin y super_admin

1. Pueden consultar universo global.
2. Pueden consultar comparativos por operadora.
3. Pueden capturar snapshots y refrescar caches administrativos.

## Source of truth canonico

### Cobertura y SLA

1. `public.followup_events`
2. `public.beneficiary_followup_status`
3. `public.v_operational_follow_up_workspace`
4. `public.v_operational_kpi_beneficiary_runtime`

### Actividad operacional

1. `public.followup_events`
2. `public.v_operator_kpi_summary_runtime`
3. `public.get_operational_kpi_summary(...)`
4. `public.get_operator_kpi_summary(...)`

### Calidad de importacion

1. `public.import_runs`
2. `public.import_job_errors`
3. `public.call_log_correlation_issues`
4. `public.v_import_quality_kpi_runtime`
5. `public.get_import_quality_kpis(...)`

### Historico

1. `public.kpi_daily_snapshots`
2. `public.capture_kpi_daily_snapshot(...)`
3. `public.v_kpi_daily_snapshot_history`

## Universo canonico evaluado

### Universo de cobertura

Beneficiarios activos presentes en `v_operational_follow_up_workspace`.

### Universo de comparativo por operadora

Beneficiarios activos cuya responsable visible vigente en `v_operational_kpi_beneficiary_runtime` corresponde a una `teleoperadora` activa.

### Universo de actividad

Eventos de `followup_events` con actor operativo identificable por `coalesce(operator_profile_id, created_by, assigned_user_id)` y `event_type <> 'internal_note'`.

### Universo de calidad de importacion

Corridas `import_runs.import_type = 'call_logs_import'`.

## KPI Definitions

## Coverage KPIs

### effective_coverage

1. Definicion: porcentaje de beneficiarios activos evaluados cuyo `coverage_state = 'al_dia'`.
2. Formula oficial: `beneficiarios con coverage_state = 'al_dia' / total_beneficiarios_evaluados * 100`.
3. Source of truth: `v_operational_kpi_beneficiary_runtime.effective_coverage`.
4. Exclusiones: no excluye beneficiarios sin ultimo contacto; esos casos cuentan en el denominador y no en el numerador.
5. Edge cases: si el denominador es 0, el KPI retorna `0.00` y no `NULL`.
6. Semantica operacional: representa cobertura efectiva vigente de cartera, no actividad acumulada.

### pending_coverage

1. Definicion: porcentaje de beneficiarios activos evaluados cuyo `coverage_state = 'pendiente'`.
2. Formula oficial: `beneficiarios con coverage_state = 'pendiente' / total_beneficiarios_evaluados * 100`.
3. Source of truth: `v_operational_kpi_beneficiary_runtime.pending_coverage`.
4. Exclusiones: no excluye casos `sin_contacto`; esos casos quedan fuera del numerador.
5. Edge cases: si el denominador es 0, retorna `0.00`.
6. Semantica operacional: mide cartera en riesgo proximo, no incumplimiento severo.

### overdue_coverage

1. Definicion: porcentaje de beneficiarios activos evaluados considerados vencidos para gestion operacional.
2. Formula oficial: `beneficiarios con coverage_state in ('urgente', 'sin_contacto') / total_beneficiarios_evaluados * 100`.
3. Source of truth: `v_operational_kpi_beneficiary_runtime.overdue_coverage`.
4. Exclusiones: no incluye `pendiente` ni `al_dia`.
5. Edge cases: `sin_contacto` se considera vencido porque no existe evidencia efectiva suficiente para sostener cobertura vigente.
6. Semantica operacional: este KPI concentra la deuda operativa total, incluyendo urgentes y casos sin contacto efectivo historico.

### urgent_coverage

1. Definicion: porcentaje de beneficiarios activos evaluados cuyo `coverage_state = 'urgente'`.
2. Formula oficial: `beneficiarios con coverage_state = 'urgente' / total_beneficiarios_evaluados * 100`.
3. Source of truth: `v_operational_kpi_beneficiary_runtime.urgent_coverage`.
4. Exclusiones: `sin_contacto` no entra en este KPI aunque si en `overdue_coverage`.
5. Edge cases: si no hay cartera visible, retorna `0.00`.
6. Semantica operacional: mide atraso severo con ultimo contacto efectivo conocido fuera del umbral vigente.

## Operational KPIs

### effective_contact_rate

1. Definicion: porcentaje de eventos operacionales con contacto efectivo dentro de la ventana evaluada.
2. Formula oficial: `successful_followups / (successful_followups + failed_followups) * 100`.
3. Source of truth: `followup_events` agregados por `get_operational_kpi_summary(...)` y `v_operator_kpi_summary_runtime`.
4. Exclusiones: `event_type = 'internal_note'` queda fuera; notas internas no cuentan como gestion de contacto.
5. Edge cases: si no existen eventos elegibles en ventana, retorna `0.00`.
6. Semantica operacional: mide efectividad de intentos o gestiones operativas registradas, no solo volumen.

### successful_followups

1. Definicion: total de `followup_events` con `is_effective_contact = true` en la ventana evaluada.
2. Formula oficial: `count(*) filter (where is_effective_contact = true and event_type <> 'internal_note')`.
3. Source of truth: `followup_events`.
4. Exclusiones: notas internas y eventos no atribuibles a actor operativo.
5. Edge cases: eventos AMAIA y manuales se cuentan por igual si dejaron contacto efectivo canonico.
6. Semantica operacional: expresa volumen efectivo de seguimiento concluido con contacto real.

### failed_followups

1. Definicion: total de `followup_events` no efectivos dentro de la ventana evaluada.
2. Formula oficial: `count(*) filter (where is_effective_contact = false and event_type <> 'internal_note')`.
3. Source of truth: `followup_events`.
4. Exclusiones: notas internas.
5. Edge cases: incluye outcomes como `no_responde`, `ocupado`, `numero_invalido`, `rechaza_llamada` y otros no efectivos.
6. Semantica operacional: representa intentos o gestiones sin contacto efectivo; no equivale por si solo a mal desempeno si la cartera es mas compleja.

### operator_effectiveness_rate

1. Definicion: tasa de efectividad por operadora sobre sus eventos operacionales atribuibles.
2. Formula oficial: `successful_followups_operadora / (successful_followups_operadora + failed_followups_operadora) * 100`.
3. Source of truth: `v_operator_kpi_summary_runtime` y `get_operator_kpi_summary(...)`.
4. Exclusiones: notas internas y perfiles no `teleoperadora`.
5. Edge cases: si una operadora no tiene eventos elegibles en ventana, retorna `0.00`.
6. Semantica operacional: mide efectividad de ejecucion por actor, no cobertura de cartera.

## Import Quality KPIs

### correlation_rate

1. Definicion: porcentaje de filas validas de `call_logs_import` que terminaron correlacionadas satisfactoriamente.
2. Formula oficial: `sum(correlated_rows) / sum(valid_rows) * 100`.
3. Source of truth: `import_runs`.
4. Exclusiones: otros `import_type` y filas invalidas fuera de `valid_rows`.
5. Edge cases: si `valid_rows = 0`, retorna `0.00`.
6. Semantica operacional: mide calidad de correlacion canonica del pipeline, no calidad del archivo crudo.

### unmatched_rate

1. Definicion: porcentaje de filas validas de `call_logs_import` que quedaron como `unmatched`.
2. Formula oficial: `sum(metadata.unmatchedRows) / sum(valid_rows) * 100`.
3. Source of truth: `import_runs.metadata` y `v_import_quality_kpi_runtime`.
4. Exclusiones: `matched_multiple`, `invalidPhoneRows` y duplicates no entran en este KPI.
5. Edge cases: si una corrida previa no poblara `metadata.unmatchedRows`, se interpreta como `0`.
6. Semantica operacional: mide ausencia de match univoco, no problemas de idempotencia.

### duplicate_rate

1. Definicion: porcentaje de filas procesadas que ya existian y fueron clasificadas como duplicadas.
2. Formula oficial: `duplicate_rows / processed_rows * 100`.
3. Source of truth: `call_log_correlation_issues.issue_type = 'duplicate_call'` agregado por import job.
4. Exclusiones: warnings y errores que no correspondan a duplicado.
5. Edge cases: si `processed_rows = 0`, retorna `0.00`.
6. Semantica operacional: mide idempotencia y repeticion de insumos, no degradacion de correlacion exitosa.

### warning_rate

1. Definicion: porcentaje de filas procesadas que generaron advertencias en la corrida.
2. Formula oficial: `sum(warning_rows) / sum(processed_rows) * 100`.
3. Source of truth: `import_runs.warning_rows`.
4. Exclusiones: errores severos y duplicados ya contabilizados por otra metrica.
5. Edge cases: si `processed_rows = 0`, retorna `0.00`.
6. Semantica operacional: mide friccion operacional del import sin confundir warnings con fallas duras.

## SLA KPIs

### aging_days

1. Definicion: dias calendario desde el ultimo contacto efectivo canonico del beneficiario.
2. Formula oficial: `v_operational_follow_up_workspace.days_since_effective_followup`.
3. Source of truth: `beneficiary_followup_status.days_since_last_valid_followup` expuesto por `v_operational_follow_up_workspace`.
4. Exclusiones: beneficiarios sin contacto efectivo previo no reciben valor imputado; el KPI queda `NULL`.
5. Edge cases: si no existe contacto efectivo, no se fuerza `0` ni un numero artificial.
6. Semantica operacional: expresa envejecimiento real de seguimiento efectivo.

### overdue_days

1. Definicion: dias por encima del umbral severo de 30 dias desde el ultimo contacto efectivo.
2. Formula oficial: `greatest(aging_days - 30, 0)`.
3. Source of truth: `v_operational_kpi_beneficiary_runtime.overdue_days`.
4. Exclusiones: beneficiarios con `aging_days is null` conservan `overdue_days = NULL`.
5. Edge cases: `sin_contacto` no inventa atraso numerico; queda sin dias imputados aunque se considere vencido en `stale_beneficiary`.
6. Semantica operacional: mide severidad de atraso sobre casos con ultimo contacto efectivo conocido.

### stale_beneficiary

1. Definicion: bandera booleana para beneficiarios que requieren atencion inmediata por atraso severo o ausencia de contacto efectivo historico.
2. Formula oficial: `coverage_state in ('urgente', 'sin_contacto')`.
3. Source of truth: `v_operational_kpi_beneficiary_runtime.stale_beneficiary`.
4. Exclusiones: `pendiente` no se considera stale.
5. Edge cases: `sin_contacto` se marca `true` aunque `aging_days` y `overdue_days` sean `NULL`.
6. Semantica operacional: KPI de priorizacion para listas de trabajo vencidas.

## Exclusiones y no-objetivos

1. No usar `raw_call_logs` para KPIs finales de negocio.
2. No recalcular coverage states en React.
3. No usar `call_interactions` como fuente principal de cumplimiento operacional.
4. No mezclar cartera oficial con activity volume sin declarar la formula.
5. No tratar `warning_rate` o `duplicate_rate` como sustituto de `correlation_rate`.

## Backend esperado 4.9A

### Views runtime

1. `public.v_operational_kpi_beneficiary_runtime`
2. `public.v_operational_kpi_summary_runtime`
3. `public.v_operator_kpi_summary_runtime`
4. `public.v_import_quality_kpi_runtime`
5. `public.v_kpi_daily_snapshot_history`

### RPCs

1. `public.get_operational_kpi_summary(...)`
2. `public.get_operator_kpi_summary(...)`
3. `public.get_import_quality_kpis(...)`
4. `public.get_overdue_beneficiaries(...)`
5. `public.capture_kpi_daily_snapshot(...)`
6. `public.refresh_operational_metrics_cache()`

### Materialized view

1. `public.operational_metrics_cache`

## Snapshot strategy

Estrategia hibrida obligatoria:

1. Runtime views para operacion viva y drill-down.
2. `kpi_daily_snapshots` para historico de tendencias.
3. `operational_metrics_cache` como cache administrativa refrescable para futuras vistas institucionales.

### Regla operacional

1. Runtime es la fuente de verdad del estado actual.
2. Snapshot captura cortes diarios prospectivos y auditables.
3. Snapshot no intenta reconstruir retrospectivamente estados anteriores a su captura.

## Observaciones abiertas

1. El comparativo por operadora usa la responsable visible vigente de cartera y excluye operadoras inactivas.
2. Los eventos de actividad se atribuyen al actor operativo del `followup_event`, no al responsable actual de cartera.
3. `sin_contacto` cuenta como vencido para `overdue_coverage` y `stale_beneficiary`, pero no inventa `aging_days` ni `overdue_days` numericos.