# Fase 4.8 Controlled Dataset Design

## Objetivo

Este documento consolida el diseno tecnico-operacional del dataset controlado de preproduccion para Fase 4.8.

No autoriza seed, SQL, `db push`, commit ni push. Su rol es dejar el marco documental alineado con el manifest canonico y sin drift operativo.

## Fuente canonica

La fuente de verdad tecnica del dataset 4.8 es:

- `docs/phase4_8_manifest_P48_PREPROD_20260601_A.json`
- `docs/phase4_8_seed_runtime_spec.md`

Si este documento diverge del manifest respecto del universo del batch, prevalece el manifest.

Si este documento diverge del spec respecto del lifecycle runtime, preflight, reconciliation o cleanup operacional, prevalece el spec.

## Identidad oficial del batch

- `batch_id`: `P48_PREPROD_20260601_A`
- marker canonico: `[[PP48:P48_PREPROD_20260601_A]]`
- fase: `4.8`
- tipo de dataset: preproduccion controlada sintetica y reversible

## Principios rectores

- no usar datos reales ni mezclarlos con el batch 4.8;
- no depender de una sola senal de identificacion;
- no borrar por heuristicas debiles;
- no recalcular coverage en frontend;
- no duplicar reglas SQL en React;
- todo el lifecycle debe poder resolverse desde el manifest canonico.

La materializacion futura del batch debe gobernarse por el contrato definido en `docs/phase4_8_seed_runtime_spec.md`.

## Estrategia general

La unidad operativa del dataset 4.8 es un batch controlado e irrepetible.

Cada entidad del batch debe quedar identificable por interseccion de senales fuertes:

- `batch_id` oficial;
- marker literal `[[PP48:P48_PREPROD_20260601_A]]` en `notes` o superficie equivalente;
- naming visible con prefijo `[PP48]`;
- `metadata`, `source`, `source_filename`, `source_run_id` o `source_row_id` cuando aplique;
- usuarios temporales bajo dominio `.invalid`;
- RUTs y telefonos sinteticos reservados.

## Naming y marcadores

### Beneficiarios

- prefijo visible: `[PP48]`
- `notes`: debe incluir `[[PP48:P48_PREPROD_20260601_A]]`
- `beneficiary_code`: segun manifest canonico
- RUT namespace oficial: RUTs sinteticos `99.000.001` a `99.000.048` con DV valido

### Contactos

- `contact_name` visible con prefijo `[PP48]` cuando corresponda;
- telefonos sinteticos reservados en el bloque `+5699900xxxx`;
- `notes` o marcador equivalente con `[[PP48:P48_PREPROD_20260601_A]]`.

Labels esperadas para alinear con frontend:

- `primary_phone` => `Telefono principal`
- `family_contact` => `Contacto familiar`
- `emergency_contact` => `Contacto emergencia`
- `other` => `Otro contacto`
- `app_phone` => `Telefono app`

### Usuarios de prueba

- `pp48.superadmin.01+20260601@mistatas.invalid`
- `pp48.admin.01+20260601@mistatas.invalid`
- `pp48.teleop.01+20260601@mistatas.invalid`
- `pp48.teleop.02+20260601@mistatas.invalid`
- `pp48.teleop.03+20260601@mistatas.invalid`
- `pp48.teleop.04+20260601@mistatas.invalid`

## Distribucion oficial

El batch oficial queda fijado asi:

- 48 beneficiarios totales
- 30 `active`
- 6 `future`
- 6 `expired`
- 6 `unassigned`
- `assignments_total = 42`
- 108 contactos totales
- 4 operadoras activas de prueba
- 1 `admin`
- 1 `super_admin`

Distribucion oficial de coverage:

- `al_dia`: 12
- `pendiente`: 12
- `urgente`: 12
- `sin_contacto`: 12

Distribucion activa visible por teleoperadora:

- `T1`: 12
- `T2`: 9
- `T3`: 6
- `T4`: 3

## Casuistica obligatoria

El dataset debe cubrir, como minimo:

- casos activos nominales;
- multiples contactos por beneficiario;
- casos con `future`, `expired` y `unassigned` para validar aislamiento;
- llamadas correlacionadas y ambiguas;
- `followup_events` automaticos y manuales;
- timelines cortos, medios y largos;
- casos con contacto efectivo y sin contacto efectivo;
- casos reservados para QA manual positiva y negativa.

## Reglas de visibilidad

- `teleoperadora` solo ve beneficiarios con asignacion vigente y activa de su cartera;
- `future` no debe aparecer como cartera vigente;
- `expired` no debe aparecer como cartera vigente;
- `unassigned` no debe aparecer para teleoperadoras;
- `admin` y `super_admin` mantienen visibilidad global del batch.

## Follow-up y coverage

- `followup_events` es la fuente operacional del historial de seguimiento;
- `beneficiary_followup_status` es estado derivado y debe permanecer consistente con el universo del batch;
- `coverage_state` debe resolverse desde backend canonico, no desde cliente;
- el timeline debe conservar atribucion, orden cronologico y trazabilidad.

## Cleanup y reversibilidad

El cleanup debe contemplar dos modos:

- `soft retirement`: cierre operacional controlado sin purga inmediata total;
- `hard cleanup`: purga total del batch cuando el lifecycle lo autorice.

### Scope minimo de cleanup

El cleanup del batch debe contemplar explicitamente:

- usuarios temporales del batch;
- beneficiarios del batch;
- contactos del batch;
- asignaciones del batch;
- `followup_events` del batch;
- `beneficiary_followup_status` asociado a beneficiarios del batch;
- `raw_call_logs` del batch;
- `call_correlations` del batch;
- `import_runs` e `import_run_rows` del batch.

### Orden recomendado

1. bloquear usuarios temporales para detener nuevas escrituras;
2. eliminar `followup_events` del batch;
3. limpiar o recalcular `beneficiary_followup_status` del batch;
4. eliminar `call_correlations` del batch;
5. eliminar `raw_call_logs` del batch;
6. eliminar `beneficiary_assignments` del batch;
7. eliminar `beneficiary_contacts` del batch;
8. eliminar beneficiarios del batch;
9. eliminar corridas de importacion del batch;
10. eliminar usuarios de auth solo si ya no quedan dependencias restrictivas.

### Verificaciones post-cleanup

Debe confirmarse explicitamente:

- `0` beneficiarios del batch;
- `0` contactos del batch;
- `0` asignaciones del batch;
- `0` `followup_events` del batch;
- `0` filas en `beneficiary_followup_status` para beneficiarios del batch;
- `0` `raw_call_logs` del batch;
- `0` `call_correlations` del batch;
- `0` `import_runs` del batch;
- `0` usuarios activos del batch.

## QA documental

Toda validacion de Fase 4.8 debe referenciar el manifest canonico antes de seed o ejecucion runtime.

Toda ejecucion runtime futura debe referenciar tambien el spec oficial del runtime 4.8.

Checklist documental minima:

- `batch_id` unico oficial correcto;
- marker canonico correcto;
- distribucion oficial correcta;
- namespace de RUT sintetico correcto;
- labels esperadas de contacto alineadas con frontend;
- cleanup alineado con `beneficiary_followup_status`;
- ausencia de drift entre manifest, QA, readiness y dataset design.