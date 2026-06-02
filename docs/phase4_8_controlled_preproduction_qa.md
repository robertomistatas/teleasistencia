# Fase 4.8 Controlled Pre-Production QA

## Objetivo

Validar la operabilidad real de Seguimientos Telefonicos Mistatas en un entorno de pre-produccion controlada.

La fase debe demostrar, end-to-end, que la plataforma puede sostener una operacion diaria semi-real sin romper:

- el backend canonico;
- el aislamiento multirol;
- la trazabilidad de seguimiento;
- la UX operacional activa.

La fase NO introduce nuevas features principales ni habilita produccion real.

## Activos de QA

- Manifest canonico obligatorio del batch 4.8:
  - `docs/phase4_8_manifest_P48_PREPROD_20260601_A.json`
- QA DB previo ya aprobado en fases 4.5, 4.6 y 4.7:
  - `supabase/qa_phase4_5_follow_up_event_engine.sql`
  - `supabase/qa_phase4_6_operational_coverage_workspace.sql`
  - `supabase/qa_phase4_7_canonical_hardening.sql`
- Frontend operacional activo:
  - `teleoperadora`: `/teleoperadora/inicio` y `/teleoperadora/cartera`
  - `admin`: `/admin/inicio` y `/admin/beneficiarios`
  - `super_admin`: `/super-admin/inicio` y `/super-admin/beneficiarios`
- Diseno del dataset controlado:
  - `docs/phase4_8_controlled_dataset_design.md`
- Spec oficial del runtime de seed 4.8:
  - `docs/phase4_8_seed_runtime_spec.md`
- Documento de salida obligatorio: `docs/phase4_8_readiness_report_template.md`

Ubicacion oficial del QA runtime de pre-produccion:

- definicion canonica del dataset en `docs/phase4_8_manifest_P48_PREPROD_20260601_A.json`;
- contrato formal del runtime en `docs/phase4_8_seed_runtime_spec.md`;
- scripts SQL canonicos existentes en `supabase/`;
- validacion runtime UI y multirol ejecutada sobre dataset controlado.

## Parametros oficiales del batch 4.8

- `batch_id`: `P48_PREPROD_20260601_A`
- marker oficial: `[[PP48:P48_PREPROD_20260601_A]]`
- distribucion oficial: 48 beneficiarios, 30 `active`, 6 `future`, 6 `expired`, 6 `unassigned`
- `assignments_total = 42`
- namespace oficial de RUT: `99.000.001` a `99.000.048` con DV valido

Toda ejecucion QA debe rechazar drift documental o operativo respecto de estos parametros.

## Cobertura del contrato

### 1) Dataset operacional controlado

Debe existir un dataset semi-realista, anonimo o sintetico, que cubra simultaneamente:

- multiples beneficiarios;
- multiples teleoperadoras;
- multiples asignaciones activas;
- asignaciones futuras y expiradas para validar aislamiento;
- llamadas correlacionadas y no correlacionadas;
- `followup_events` automaticos y manuales;
- estados de cobertura variados:
  - `al_dia`
  - `pendiente`
  - `urgente`
  - `sin_contacto`
- batch oficial con distribucion 12 / 12 / 12 / 12 por coverage;
- labels de contacto alineadas con frontend:
  - `Telefono principal`
  - `Contacto familiar`
  - `Contacto emergencia`
  - `Otro contacto`
  - `Telefono app`
- timelines con outcomes efectivos y no efectivos;
- casos con red de apoyo y contactos alternativos.

Restriccion obligatoria:

- no usar datos reales sensibles definitivos.

### 2) Validacion end-to-end canonica

Debe poder validarse el flujo completo:

1. importacion
2. normalizacion
3. correlacion
4. generacion de `followup_events`
5. recalculo canonico de cobertura
6. exposicion en workspace operacional
7. seguimiento manual
8. reflejo en timeline

No se permite:

- recalcular cobertura en frontend;
- reconstruir cobertura desde `call_logs`;
- duplicar reglas SQL en React.

### 3) Follow-up engine

Debe confirmarse que:

- `event_outcome` e `is_effective_contact` conservan la invariante canonica de 4.5;
- cada evento mantiene `assignment_id` y `operator_profile_id` correctos;
- los eventos manuales usan el backend canonico y quedan auditables;
- el timeline refleja origen, momento, outcome y atribucion sin ambiguedad.

### 4) Coverage engine

Debe verificarse que:

- `beneficiary_followup_status` y `coverage_state` se actualizan sin logica cliente;
- las transiciones `al_dia`, `pendiente`, `urgente` y `sin_contacto` son correctas;
- el ultimo contacto efectivo coincide con la realidad del timeline;
- los casos sin contacto efectivo no quedan clasificados erradamente.

Ademas, toda validacion runtime debe asumir que el manifest canonico es la fuente de verdad del universo esperado del batch.

La orquestacion futura de seed, preflight, reconciliation y activacion debe evaluarse contra el spec oficial del runtime 4.8.

### 5) Workspace operacional

Debe validarse, con datos de volumen controlado pero realista:

- filtros operacionales;
- orden de prioridad;
- paginacion;
- navegacion lista -> detalle -> retorno;
- lectura rapida de columnas utiles;
- tiempos de respuesta razonables;
- ausencia de bloqueos UX en flujos diarios.

### 6) Seguimiento manual y timeline

Debe validarse que un seguimiento manual:

- persiste correctamente;
- queda atribuido al operador correcto;
- usa la asignacion vigente correcta;
- refresca cobertura y timeline sin recarga inconsistente;
- aparece en orden cronologico correcto.

### 7) Seguridad y multirol

Debe cumplirse:

- `teleoperadora` solo ve su cartera vigente asignada;
- `teleoperadora` no tiene visibilidad cruzada de otras carteras;
- `admin` mantiene visibilidad operacional global;
- `super_admin` mantiene visibilidad global y herramientas administrativas;
- no existe bypass RLS en vistas ni rutas activas.

### 8) UX operacional

Debe revisarse explicitamente:

- cantidad de clicks para tareas frecuentes;
- claridad visual de prioridad y cobertura;
- ergonomia de lectura en cola y detalle;
- fricciones de navegacion;
- utilidad real de columnas y filtros;
- estabilidad visual durante refrescos.

### 9) Performance basica

Debe observarse en runtime:

- vistas lentas;
- queries pesadas;
- joins costosos;
- payloads excesivos;
- paginacion ineficiente;
- chunks frontend desproporcionados;
- posibles cuellos de botella antes de produccion.

### 10) Restricciones arquitectonicas

Continua prohibido:

- calcular cobertura en frontend;
- calcular cobertura desde `call_logs`;
- romper backend canonico;
- duplicar reglas SQL en React;
- introducir bypass RLS;
- mezclar legacy con rutas activas.

La capa legacy endurecida en 4.7 debe mantenerse deprecated, encapsulada y sin reutilizacion nueva.

## Ejecucion obligatoria

### 1) Validacion DB

Ejecutar:

```bash
npx supabase db push --dry-run
```

Reejecutar QA canonico previo sobre la base objetivo:

```bash
npx supabase db query --linked --file supabase/qa_phase4_5_follow_up_event_engine.sql
npx supabase db query --linked --file supabase/qa_phase4_6_operational_coverage_workspace.sql
npx supabase db query --linked --file supabase/qa_phase4_7_canonical_hardening.sql
```

Resultado esperado:

- todos los scripts retornan `failed_tests = 0`.

### 2) Validacion frontend obligatoria

Ejecutar:

```bash
npm run typecheck
npm run lint
npm run build
```

### 3) QA runtime completo 4.8

Con dataset controlado y usuarios de prueba por rol, validar:

1. importacion y correlacion sin inconsistencias visibles;
2. generacion correcta de `followup_events`;
3. transicion correcta de cobertura;
4. workspace operativo usable para `teleoperadora`;
5. visibilidad global correcta para `admin` y `super_admin`;
6. aislamiento RLS real en teleoperadora;
7. registro manual persistente con atribucion correcta;
8. timeline cronologico, trazable y consistente;
9. navegacion diaria sin fricciones criticas;
10. identificacion de riesgos de performance y escalabilidad.

## Criterio de aprobacion

La fase queda aprobada cuando:

- existe dataset controlado suficientemente variado para cubrir escenarios operacionales reales;
- `db push --dry-run` pasa sin errores;
- los QA SQL 4.5, 4.6 y 4.7 siguen retornando `failed_tests = 0`;
- `typecheck`, `lint` y `build` pasan;
- el flujo importacion -> correlacion -> followup -> coverage -> workspace -> seguimiento manual -> timeline funciona end-to-end;
- `teleoperadora` solo ve cartera vigente y no existe visibilidad cruzada;
- `admin` y `super_admin` mantienen visibilidad global correcta;
- no se detectan bloqueadores criticos de UX, seguridad o consistencia canonica;
- se emite el readiness report final con riesgos, pendientes y recomendacion de avance o no avance.

## Salida obligatoria

Al cierre de la fase debe completarse el readiness report usando la plantilla oficial en:

- `docs/phase4_8_readiness_report_template.md`

La salida final debe declarar explicitamente:

- referencia al manifest canonico validado;
- referencia al spec oficial del runtime validado documentalmente;
- listo para;
- no listo para;
- riesgos;
- pendientes;
- recomendaciones de corto plazo;
- recomendaciones de mediano plazo;
- condiciones previas a produccion real.