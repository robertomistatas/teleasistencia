# Fase 4.8 Seed Runtime Specification

## Objetivo

Este documento define la especificacion oficial del runtime de seed de preproduccion controlada para Fase 4.8.

Su objetivo es fijar el contrato formal de `seed_preproduction_runtime` antes de cualquier implementacion.

Este documento no implementa codigo, no crea SQL, no ejecuta seed, no ejecuta `db push`, no hace commit y no hace push.

## Alcance y precedencia documental

El runtime 4.8 debe tratar el seed como una materializacion institucional controlada de batch, no como un script lineal de inserciones.

Documentos relacionados:

- `docs/phase4_8_manifest_P48_PREPROD_20260601_A.json`
- `docs/phase4_8_controlled_dataset_design.md`
- `docs/phase4_8_controlled_preproduction_qa.md`
- `docs/phase4_8_readiness_report_template.md`

Precedencia:

1. el manifest canonico fija el universo esperado del batch;
2. este spec fija el contrato del runtime que materializa, valida y reconcilia ese universo;
3. QA y readiness consumen ambos como fuentes normativas.

## 1. Contrato formal de `seed_preproduction_runtime`

`seed_preproduction_runtime` es el runtime institucional responsable de planificar, sembrar, reanudar, validar y en el futuro previsualizar cleanup del batch controlado de preproduccion.

No debe operar como un script best-effort. Debe ejecutar por fases, con lock exclusivo, checkpoints, journal obligatorio, preflight bloqueante y reconciliation report posterior.

### Responsabilidades obligatorias

- cargar y validar el manifest canonico;
- validar entorno y guardrails antes de cualquier write;
- prevenir duplicados y contaminacion cross-batch;
- materializar el universo del batch en orden de dependencias seguro;
- reconciliar conteos y estado derivado contra el manifest;
- decidir formalmente si el batch puede activarse a `seeded`;
- emitir evidencia suficiente para resume, QA, retiro y cleanup futuro.

### Restricciones operativas

- no debe sembrar sin manifest valido;
- no debe sembrar en entorno no autorizado;
- no debe continuar si el preflight retorna `fail`;
- no debe activar a `seeded` si el reconciliation report no retorna `pass`;
- no debe hacer rollback ciego de eventos operativos una vez que existen dependencias cruzadas no triviales.

## 2. Entrypoint y argumentos

### Entrypoint canonico

```text
seed_preproduction_runtime(manifest_path, mode, target_environment, options)
```

### Argumentos obligatorios

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `manifest_path` | string | Ruta del manifest canonico que gobierna el batch. |
| `mode` | enum | Modo de ejecucion permitido del runtime. |
| `target_environment` | enum | Entorno objetivo. En 4.8 debe resolver `preproduction_controlled`. |
| `requested_by` | string | Identidad operativa que dispara el runtime. |
| `approval_context` | object | Evidencia de aprobaciones aplicables segun lifecycle. |

### Argumentos opcionales

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `run_id` | string | Obligatorio para `resume`; opcional si el runtime lo genera en otros modos. |
| `force_lock_recovery` | boolean | Recupera lock huerfano solo con auditoria explicita. |
| `strict_mode` | boolean | Promueve warnings configurables a `fail`. |
| `qa_scope` | array | Seleccion explicita de hooks QA en modo `validate`. |
| `dry_run` | boolean | Permitido en `plan` y reservado para `cleanup-preview`. |

## 3. Modos permitidos

| Modo | Proposito | Puede escribir | Resultado esperado |
| --- | --- | --- | --- |
| `plan` | Resolver manifest, validar estructura y construir plan de materializacion | No | Plan de dependencias, expected counts, preflight report |
| `seed` | Ejecutar la materializacion completa del batch | Si | `seeded`, `seeded_partial`, `failed` o `aborted` |
| `resume` | Reanudar un run parcial o interrumpido | Si | Reanudacion segura o bloqueo con evidencia |
| `validate` | Ejecutar reconciliation y QA sobre batch ya materializado | No writes de seed; cambios de estado solo si la policy lo autoriza | `validated`, `qa_blocked` o `failed` |
| `cleanup-preview` futuro | Resolver universo de cleanup e impacto esperado | No | Scope de cleanup, conflictos, orden de borrado, warnings |

## 4. Inputs y outputs formales

### Inputs formales

| Input | Fuente |
| --- | --- |
| Manifest canonico del batch | JSON oficial controlado |
| Lifecycle actual del batch | Manifest persistido o registro runtime asociado |
| Estado actual de la base objetivo | Backend canonico |
| Policy de entorno permitido | Configuracion runtime |
| Reglas de conteo y ownership | Manifest canonico |
| Catalogo de hooks QA | Manifest y runtime |

### Outputs formales

| Output | Descripcion |
| --- | --- |
| `execution_journal` | Evidencia fase a fase, decisiones, warnings, errores y bloqueos |
| `preflight_report` | Resultado de chequeos previos a writes |
| `reconciliation_report` | Comparacion formal manifest vs realidad materializada |
| `activation_decision` | Decision final de activacion o bloqueo |
| `final_status` | Estado terminal del run |
| `next_action` | `none`, `resume`, `manual_intervention`, `validate` o `cleanup_recommended` |

## 5. Estados del runtime

| Estado | Significado |
| --- | --- |
| `initialized` | Entrada recibida, sin procesamiento aun |
| `manifest_loaded` | Manifest cargado y parseado |
| `manifest_validated` | Manifest estructural y semanticamente valido |
| `preflight_passed` | Entorno y universo habilitados para continuar |
| `locked` | Lock exclusivo de batch adquirido |
| `seeding` | Materializacion en curso |
| `seeded_partial` | Materializacion incompleta con residuos o incertidumbre controlada |
| `seeded` | Materializacion completa y reconciliada |
| `qa_running` | QA runtime en ejecucion |
| `validated` | Batch operativo validado |
| `qa_blocked` | Seed completo pero bloqueado por QA o reconciliacion final |
| `failed` | Falla terminal |
| `aborted` | Abortado por guardrail o politica |
| `cleanup_preview_ready` | Estado reservado para `cleanup-preview` futuro |

## 6. Codigos de error

| Codigo | Significado |
| --- | --- |
| `MANIFEST_PARSE_ERROR` | El manifest no puede parsearse |
| `MANIFEST_SCHEMA_ERROR` | El schema no es soportado |
| `MANIFEST_SEMANTIC_ERROR` | Conteos, unicidad, lifecycle o dependencias no cierran |
| `ENVIRONMENT_MISMATCH` | El entorno objetivo no es permitido |
| `BATCH_DUPLICATE_DETECTED` | Ya existe un batch incompatible con el mismo `batch_id` |
| `MARKER_CONFLICT_DETECTED` | El marker del batch ya esta en uso o contaminado |
| `IDENTITY_CONFLICT_DETECTED` | Existe colision de email, auth user o profile |
| `NAMESPACE_CONFLICT_DETECTED` | Existe colision de RUT, telefono, `beneficiary_code` o prefijo operativo |
| `INCOMPLETE_CLEANUP_DETECTED` | Existe cleanup previo incompleto o residuos activos |
| `LOCK_ACQUISITION_FAILED` | No fue posible adquirir o recuperar el lock de forma segura |
| `PARTIAL_RUN_INCONSISTENT` | Existe run parcial pero no es reanudable con seguridad |
| `ENTITY_WRITE_FAILED` | Fallo una escritura de entidades |
| `DERIVED_STATE_RECONCILIATION_FAILED` | El estado derivado no converge con la realidad esperada |
| `QA_HOOK_FAILED` | Una QA critica fallo |
| `ACTIVATION_BLOCKED` | El batch no cumple reglas para transicionar a `seeded` |

## 7. Estructura del execution journal

El journal debe ser la evidencia primaria del run. Debe registrar entradas estructuradas por fase y conservar informacion suficiente para `resume`, auditoria, troubleshooting y cleanup futuro.

### Estructura minima

```json
{
  "run_id": "string",
  "batch_id": "string",
  "mode": "plan|seed|resume|validate|cleanup-preview",
  "target_environment": "string",
  "requested_by": "string",
  "started_at": "timestamp",
  "completed_at": "timestamp|null",
  "runtime_status": "string",
  "manifest_fingerprint": "string",
  "lock": {
    "acquired": true,
    "lock_id": "string",
    "heartbeat_until": "timestamp|null"
  },
  "phase_history": [
    {
      "phase": "string",
      "status": "started|completed|failed|skipped|blocked",
      "started_at": "timestamp",
      "completed_at": "timestamp|null",
      "duration_ms": 0,
      "expected_counts": {},
      "actual_counts": {},
      "entity_scope": {},
      "warnings": [],
      "errors": [],
      "evidence_refs": [],
      "manual_action_required": false,
      "seeded_partial": false
    }
  ],
  "final_decision": {
    "status": "seeded|seeded_partial|validated|failed|aborted|qa_blocked",
    "continue_blocked": true,
    "next_action": "string"
  }
}
```

### Reglas del journal

- cada fase debe registrar inicio y cierre;
- toda decision de bloqueo debe quedar serializada;
- todo rollback intentado debe dejar evidencia de alcance y resultado;
- si el runtime genero IDs o resolvio entidades existentes, debe dejar trazabilidad suficiente;
- si se marca `seeded_partial`, el journal debe explicar por que y que sigue.

## 8. Estructura del preflight report

El preflight report debe emitirse siempre antes de cualquier write en modos `seed` y `resume`. En `plan` debe emitirse como simulacion formal del gating previo.

### Estructura minima

```json
{
  "run_id": "string",
  "batch_id": "string",
  "mode": "string",
  "generated_at": "timestamp",
  "result": "pass|warning|fail",
  "checks": [
    {
      "name": "duplicate_batch",
      "result": "pass|warning|fail",
      "severity": "warning|blocking",
      "message": "string",
      "expected": {},
      "actual": {},
      "evidence_refs": []
    }
  ],
  "counts_snapshot": {
    "expected": {},
    "actual_conflicts": {}
  },
  "blocking_issues": [],
  "warnings": [],
  "resume_recommendation": "none|resume|manual_intervention"
}
```

## 9. Estructura del reconciliation report

El reconciliation report debe emitirse despues de la materializacion o en modo `validate`, y debe decidir si el batch puede activarse o queda bloqueado.

### Estructura minima

```json
{
  "run_id": "string",
  "batch_id": "string",
  "manifest_version": "string",
  "generated_at": "timestamp",
  "result": "pass|warning|fail",
  "summary": {
    "activation_eligible": false,
    "blocking_issues": 0,
    "warnings": 0
  },
  "entity_counts": [
    {
      "entity": "beneficiaries",
      "expected": 48,
      "actual": 48,
      "result": "pass"
    }
  ],
  "distribution_checks": {
    "assignment_state": {},
    "coverage": {},
    "ownership": {},
    "visibility": {}
  },
  "namespace_checks": {
    "marker_conflict": "pass|warning|fail",
    "email_conflict": "pass|warning|fail",
    "rut_conflict": "pass|warning|fail",
    "phone_conflict": "pass|warning|fail"
  },
  "derived_state_checks": {
    "beneficiary_followup_status": "pass|warning|fail"
  },
  "issues": [
    {
      "severity": "warning|fail",
      "code": "string",
      "message": "string",
      "evidence_refs": []
    }
  ]
}
```

## 10. Reglas de activacion a `seeded`

El runtime solo puede mover el batch a `seeded` si se cumplen simultaneamente todas estas condiciones:

1. el manifest cargado coincide con el fingerprint esperado del run;
2. el preflight termina en `pass`;
3. el lock exclusivo fue adquirido y mantenido;
4. `seed_identities`, `seed_domain_entities` y `seed_operational_events` cierran en `completed`;
5. `reconcile_derived_state` cierra en `completed`;
6. los conteos reales coinciden exactamente con el manifest;
7. no existen conflictos abiertos de marker, email, RUT, telefono o namespace del batch;
8. no existen errores bloqueantes abiertos en el journal;
9. el reconciliation report termina en `pass`;
10. el lifecycle y las aprobaciones requeridas permiten la transicion.

Si existe cualquier divergencia bloqueante, el runtime no puede activar a `seeded`.

Si existe un seed completo pero con validacion operativa insuficiente, el estado permitido es `qa_blocked`, no `seeded` ni `validated`.

## 11. Preflight checks obligatorios

El preflight debe ejecutarse antes de cualquier write y debe fallar en modo cerrado.

### Chequeos obligatorios

| Chequeo | Que valida | Resultado bloqueante |
| --- | --- | --- |
| Acceso al manifest | El archivo existe y es legible | Si |
| Parse del manifest | El JSON es valido | Si |
| Schema soportado | La version y estructura son conocidas | Si |
| Semantica valida | Conteos, claves, lifecycle y dependencias cierran | Si |
| Entorno permitido | No es produccion y coincide con `preproduction_controlled` | Si |
| Duplicado de batch | No existe otro universo incompatible del mismo `batch_id` | Si |
| Marker conflict | El marker oficial no esta reutilizado ni contaminado | Si |
| User and email conflict | No existen emails ya usados fuera de un run resoluble | Si |
| RUT conflict | No existen RUTs reservados ya usados fuera de un run resoluble | Si |
| Telefono conflict | No existen telefonos o prefijos reservados ya usados | Si |
| Beneficiary namespace conflict | No existen `beneficiary_code` ni claves sinteticas duplicadas | Si |
| Cleanup incompleto | No existen residuos de cleanup o retiro previo | Si |
| Partial run consistency | Si existe run parcial, debe ser reanudable con seguridad | Si |
| QA hooks disponibles | Los hooks declarados existen y son resolubles | Si |

### Politica de resultado del preflight

| Resultado | Regla |
| --- | --- |
| `pass` | No hay conflictos, drift ni residuos que comprometan la corrida |
| `warning` | Existe una condicion explicable no bloqueante, solo aceptable si la policy lo permite |
| `fail` | Existe conflicto de identidad, namespace, marker, cleanup o conteo; no se escribe nada |

### Reglas especificas de deteccion

#### Deteccion de batch duplicado

Debe resolverse por combinacion de senales:

- `batch_id` en journal previo;
- marker oficial del batch en entidades del universo;
- `beneficiary_code` o metadata del batch ya presentes;
- prefijos operativos ya usados;
- conteos parciales compatibles con corrida previa no limpiada.

Si cualquiera de estas senales existe fuera de un `resume` explicitamente resoluble, el preflight debe retornar `fail`.

#### Deteccion de marker conflict

Debe fallar si:

- el marker exacto aparece en filas que no pertenecen al run esperado;
- multiples runs reclaman el mismo marker;
- el marker convive con lifecycle incompatible;
- el marker existe parcialmente y no puede atribuirse con certeza.

#### Deteccion de users and emails existentes

| Escenario | Resultado |
| --- | --- |
| El email no existe | `pass` |
| El email existe y pertenece al mismo run reanudable | `warning` |
| El email existe y pertenece a identidad ajena o no resoluble | `fail` |

#### Deteccion de RUT y telefono existente

Debe aplicar la misma politica que emails, pero con severidad operativa maxima si existe colision externa no resoluble.

#### Deteccion de cleanup incompleto

Debe buscar al menos:

- journal previo en `cleanup_running`;
- batch en `retired` con residuos operativos;
- `auth.users` o `profiles` huerfanos del batch;
- marker del batch presente en tablas del cleanup scope;
- conteos no nulos despues de un cleanup declarado como completo.

## 12. Reconciliation checks obligatorios

El reconciliation report debe responder cuatro preguntas obligatorias:

1. si se creo exactamente el universo del manifest;
2. si las distribuciones declaradas coinciden con la realidad;
3. si el estado derivado converge;
4. si el batch es activable sin drift.

### Chequeos obligatorios

| Superficie | Validacion |
| --- | --- |
| Entidades base | Conteos esperados vs reales por tabla del batch |
| Assignment state | Distribucion 30 `active`, 6 `future`, 6 `expired`, 6 `unassigned` |
| Coverage | Distribucion 12 `al_dia`, 12 `pendiente`, 12 `urgente`, 12 `sin_contacto` |
| Ownership | Cartera activa visible por operadora segun manifest |
| Visibility | `teleoperadora`, `admin` y `super_admin` coinciden con el contrato documental |
| Namespace integrity | Marker, emails, RUTs, telefonos y prefijos siguen siendo exclusivos |
| Derived state | `beneficiary_followup_status` es coherente con el universo del batch |
| Cross-batch isolation | No existe contaminacion con datos ajenos al batch |

### Conteos minimos a reconciliar

| Superficie | Esperado |
| --- | --- |
| Beneficiarios | 48 |
| Activos | 30 |
| Futuros | 6 |
| Expirados | 6 |
| Sin asignacion | 6 |
| Assignments totales | 42 |
| Coverage | 12 / 12 / 12 / 12 |
| Usuarios del batch | 6 |
| Contactos totales | 108 |

### Politica de resultado del reconciliation report

| Resultado | Regla |
| --- | --- |
| `pass` | El universo materializado coincide con el manifest y es activable |
| `warning` | Existe desviacion no bloqueante o pendiente de QA adicional |
| `fail` | Existe mismatch de conteo, ownership, visibilidad, namespace o estado derivado |

## 13. Matriz rollback/manual intervention por fase

La politica general es esta:

- rollback automatico solo si el runtime puede probar exactamente que creo y que aun no existe dependencia cruzada peligrosa;
- si la fase falla despues de writes no reversibles con seguridad, el estado obligatorio es `seeded_partial`;
- ninguna fase posterior puede ejecutarse si la anterior termina en `failed`, `aborted` o `seeded_partial`, salvo `resume` explicito y preflight de recuperacion.

| Fase | Que puede fallar | Rollback automatico | Puede quedar `seeded_partial` | Cuando requiere intervencion manual | Evidencia obligatoria | Que bloquea continuar |
| --- | --- | --- | --- | --- | --- | --- |
| `load_manifest` | archivo inexistente, ilegible, JSON roto | No aplica | No | Cuando el insumo documental es invalido o inconsistente de origen | error de lectura, path, fingerprint nulo | cualquier error de carga |
| `validate_manifest` | schema invalido, conteos incoherentes, claves duplicadas, lifecycle inconsistente | No aplica | No | Cuando el manifest requiere correccion documental | lista exacta de violaciones y claves afectadas | cualquier error semantico o estructural |
| `preflight` | batch duplicado, marker conflict, email conflict, RUT conflict, cleanup incompleto, entorno invalido | No | No | Cuando existe conflicto real o residuo que el runtime no puede resolver solo | reporte completo de conflictos y namespaces afectados | cualquier check bloqueante en `fail` |
| `acquire_batch_lock` | lock activo, lock huerfano, heartbeat inconsistente | No | No | Cuando el lock no es recuperable sin decision auditada | lock id, owner, timestamp, heartbeat | lock no adquirible de forma segura |
| `seed_identities` | fallo en `auth.users`, `profiles`, permisos, conflicto tardio de identidad | Si, solo sobre identidades creadas en el mismo intento y trazadas en journal | Si | Cuando hay `auth.users` huerfanos, perfiles incompletos o propiedad incierta | IDs creados, revertidos y huerfanos, error exacto | cualquier identidad inconsistente o no reversible |
| `seed_domain_entities` | fallo al crear beneficiarios, contactos o assignments; incoherencia temporal | Si, solo para filas trazadas y aun sin dependencias posteriores | Si | Cuando existen beneficiarios o contactos validos pero assignments divergentes | conteos por tabla, IDs creados, subset revertido, casos afectados | entidades base incompletas o fuera del manifest |
| `seed_operational_events` | fallo al crear logs, correlations o followups; correlacion parcial; prefijos duplicados | Parcial; no debe haber rollback ciego si el universo ya quedo mezclado | Si | Cuando existen eventos emitidos, correlaciones parciales o followups inconsistentes | conteos esperados vs reales, external IDs afectados, casos no correlacionados | divergencia operativa o correlacion no cerrada |
| `reconcile_derived_state` | `beneficiary_followup_status` no converge, triggers o RPC no reflejan realidad | No recomendado; preferir bloqueo y remediacion | Si | Cuando el backend canonico no converge y requiere investigacion | diff de estado esperado vs derivado, casos impactados | cualquier mismatch derivado bloqueante |
| `run_qa_hooks` | QA SQL falla, QA funcional falla, ownership drift, visibility drift | No | No adicional; puede quedar `qa_blocked` | Cuando la QA falla por drift real o comportamiento no explicable | resultado por hook, evidencia SQL o funcional, casos fallidos | cualquier hook critico en `fail` |
| `activate_batch` | reconciliation no elegible, approvals ausentes, lifecycle incompatible | No | No nuevo; conserva el estado previo | Cuando falta aprobacion o decision operativa excepcional | activation decision report, gating checks, approvals faltantes | falta de elegibilidad formal para `seeded` |

## 14. Relacion con cleanup futuro

El runtime de seed debe nacer preparado para cleanup futuro aunque `cleanup-preview` permanezca como modo futuro.

### Reglas de acoplamiento minimo

- el seed journal debe conservar evidencia suficiente para resolver el universo materializado;
- el cleanup runtime futuro debe poder usar ese journal como ayuda, pero nunca como unica fuente;
- el manifest sigue siendo la fuente canonica del universo del batch;
- el mismo algoritmo de resolucion de universo debe servir para seed, reconciliation y cleanup;
- la relacion recomendada es `soft retirement` primero y `hard cleanup` despues;
- `beneficiary_followup_status` debe tratarse como superficie derivada del universo del batch y no como tabla aislada.

### Salidas que deben sobrevivir para cleanup

- `run_id`;
- `batch_id`;
- fingerprint del manifest;
- entity scope por fase;
- conflictos, warnings y residuos conocidos;
- activation decision final.

## 15. Riesgos conocidos

### Riesgos criticos

- corrupcion de FK si el orden de materializacion o cleanup viola dependencias;
- `auth.users` huerfanos si falla la fase de identidades;
- drift runtime si la materializacion produce un universo distinto al manifest;
- contaminacion cross-batch si markers o namespaces reservados colisionan;
- `seeded_partial` no remediado que deje el entorno ambiguo;
- activacion prematura a `seeded` sin reconciliation formal;
- visibilidad cruzada indebida si ownership o vigencia temporal quedan mal resueltos.

### Riesgos del repositorio actual que el runtime debe respetar

- `beneficiary_assignments` depende de `starts_at` y `ends_at` como semantica temporal canonica;
- `public.profiles` y superficies asociadas tienen restricciones de seguridad y dependencia no triviales;
- operaciones administrativas sensibles pueden requerir contexto privilegiado o RPC de backend, no writes directos indiscriminados;
- `beneficiary_followup_status` es derivado y no debe tratarse como verdad primaria.

## Cierre

Este documento deja definido el contrato oficial del runtime 4.8 sin implementar nada.

La implementacion futura debe alinearse estrictamente con este spec, el manifest canonico y los documentos QA y readiness asociados.