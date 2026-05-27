# Fase 4.5 Follow-Up Event Engine QA

## Objetivo

Validar el motor canonico:

raw_call_logs + call_correlations -> followup_events -> coverage_state

La cobertura operativa solo se calcula desde `followup_events.is_effective_contact = true`.

## Activos de QA

- Migracion backend: `supabase/migrations/20260527120000_phase4_5_follow_up_event_engine.sql`
- Script QA SQL transaccional: `supabase/qa_phase4_5_follow_up_event_engine.sql`

Ubicacion oficial del QA runtime en esta fase: carpeta `supabase/`.

## Cobertura del contrato

### 1) Entidades y campos canonicos

Validar en `followup_events`:

- `call_log_id`
- `correlation_id`
- `assignment_id`
- `operator_profile_id`
- `event_timestamp`
- `event_outcome`
- `is_effective_contact`
- `contact_phone`
- `contact_type`

### 2) Outcomes iniciales y contacto efectivo

Outcomes esperados:

- `contacto_efectivo`
- `no_responde`
- `ocupado`
- `mensaje_dejado`
- `numero_invalido`
- `rechaza_llamada`
- `sin_clasificar`

Regla obligatoria:

- `contacto_efectivo` -> `is_effective_contact = true`
- resto -> `false`

Debe validarse ademas que NO exista ningun registro con:

- `event_outcome <> contacto_efectivo` y `is_effective_contact = true`
- `event_outcome = contacto_efectivo` y `is_effective_contact = false`

### 3) Cobertura operacional

Estados esperados (`follow_up_coverage_state`):

- `al_dia` (0-15 dias)
- `pendiente` (16-30 dias)
- `urgente` (31+ dias)
- `sin_contacto` (sin eventos efectivos)

### 4) Dedupe

Validar que no existan multiples `followup_events` para el mismo `call_log_id`.

### 5) Trazabilidad

Cada evento generado desde llamadas debe responder:

- llamada origen (`call_log_id`)
- operador responsable (`operator_profile_id`)
- momento del evento (`event_timestamp`)
- outcome (`event_outcome`)
- contacto efectivo (`is_effective_contact`)

### 6) Vistas operacionales

`v_follow_up_coverage_by_beneficiary` debe exponer:

- ultimo contacto efectivo
- dias sin contacto
- cobertura
- operador responsable
- assignment activa

`v_follow_up_operational_summary` debe exponer:

- conteo por cobertura
- totales de eventos
- totales de eventos efectivos

Seguridad obligatoria de vistas:

- Las vistas operacionales deben ejecutarse como `security_invoker = true`.
- El acceso `authenticated` no debe permitir bypass de RLS.

## Ejecucion QA DB

1. Aplicar migracion 4.5 en la base destino.
2. Ejecutar:

```bash
npx supabase db query --linked --file supabase/qa_phase4_5_follow_up_event_engine.sql
```

3. Revisar salida de `qa_results` y conteo final (`failed_tests = 0`).

## Criterio de aprobacion

La fase queda aprobada cuando:

- la migracion aplica sin errores,
- el script QA retorna `failed_tests = 0`,
- la cobertura por beneficiario coincide con escenarios `al_dia/pendiente/urgente/sin_contacto`,
- se confirma dedupe por `call_log_id`,
- se confirma invariante canonico `event_outcome <-> is_effective_contact`,
- se confirma `security_invoker = true` en vistas operacionales,
- la trazabilidad es completa y auditable.
