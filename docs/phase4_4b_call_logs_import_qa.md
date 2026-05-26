# Phase 4.4B - QA importacion Excel de llamadas AMAIA / net2phone

## Estado de esta entrega

- Implementacion propuesta sin aplicar migraciones reales en entorno objetivo.
- Validaciones ejecutadas en esta entrega:
  - `npx supabase db push --dry-run`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- QA runtime queda pendiente hasta aplicar las migraciones de Fase 4.4B en el entorno objetivo.

## Cobertura implementada

- UI nueva en `/imports/calls` solo para `admin` y `super_admin`.
- Validacion estricta de estructura Excel en frontend:
  - una sola hoja
  - columnas exactas y en orden fijo: `id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado`
- Preview sin persistencia via `public.preview_call_logs_import(text, jsonb)`.
- Execute con auditoria via `public.execute_call_logs_import(text, jsonb)`.
- Persistencia integrada con Fase 4.4A:
  - crea `raw_call_logs`
  - ejecuta `public.correlate_raw_call_log(uuid)`
  - registra `import_runs` e `import_run_rows`
- Idempotencia por `(source, external_call_id)` usando `source = 'amaia_net2phone_excel'`.
- `invalid_phone`, `unmatched` y `matched_multiple` no bloquean evidencia: quedan como `warning` con `raw_call_logs` persistida.
- `external_call_id` vacio, fecha invalida o duracion invalida bloquean la fila como `error`.
- `raw_status` se conserva como evidencia textual. En esta fase no participa del matching ni de metricas. Si viene vacio, la fila queda como `warning`, pero no bloquea importacion por si sola.
- Las fechas string se interpretan siempre en formato chileno `DD/MM/YYYY` o `DD-MM-YYYY` cuando no vienen en ISO seguro.
- Si el mismo `external_call_id` aparece dos o mas veces dentro del mismo archivo, solo la primera aparicion se considera para el import.

## Preparacion para QA runtime

1. Aplicar migraciones en el entorno objetivo:

```powershell
npx supabase db push
```

2. Levantar la aplicacion local si corresponde:

```powershell
npm run dev
```

3. Ingresar con una cuenta `admin` o `super_admin`.

4. Tener disponible al menos un fixture de Fase 4.4A con los siguientes escenarios de telefono:

- principal activo con match unico
- secundario activo con match unico
- contacto inactivo con match unico
- telefono compartido entre dos beneficiarios
- telefono valido sin contacto

## Casos minimos por contrato

### Estructura

#### 1. Multiples hojas

Archivo:

- libro con dos hojas

Esperado:

- bloqueo antes del preview
- mensaje: `El archivo debe contener una sola hoja.`

#### 2. Columnas faltantes

Archivo:

- omitir `Observaciones` o `Estado`

Esperado:

- bloqueo antes del preview
- mensaje indicando columnas exactas requeridas

#### 3. Columnas incorrectas

Archivo:

- renombrar `Teléfono` a `Telefono`
- cambiar orden
- agregar novena columna

Esperado:

- bloqueo antes del preview
- mensaje mostrando encabezados detectados

### Parsing

#### 4. Fecha valida ISO sin zona

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-001 | 2026-05-20 11:30 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- preview sin error
- `normalizedPayload.calledAt` con timestamptz normalizado a UTC asumiendo zona Chile

#### 5. Fecha chilena ambigua

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-002 | 05/06/2026 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- preview sin error
- `05/06/2026` se interpreta como 5 de junio de 2026
- no depende de `datestyle` del servidor

#### 6. Fecha chilena con guion

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-003 | 5-6-2026 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- preview sin error
- se interpreta como 5 de junio de 2026 en zona Chile

#### 7. Fecha chilena con año corto

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-004 | 05/06/26 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- preview sin error
- se interpreta como 5 de junio de 2026

#### 8. Fecha chilena con hora

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-005 | 05/06/2026 14:30 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- preview sin error
- se interpreta como 5 de junio de 2026 14:30 en zona Chile y se normaliza a UTC

#### 9. Fecha invalida

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-006 | fecha imposible | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- fila `error`
- mensaje indicando que la fecha no pudo interpretarse

#### 10. Duracion HH:MM:SS

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-007 | 2026-05-20 11:30 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 00:01:05 | Observacion QA | Contestada |

Esperado:

- `normalizedPayload.durationSeconds = 65`

#### 11. Duracion MM:SS

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-008 | 2026-05-20 11:30 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 01:05 | Observacion QA | Contestada |

Esperado:

- `normalizedPayload.durationSeconds = 65`

#### 12. Duracion invalida

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-009 | 2026-05-20 11:30 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 1h5m | Observacion QA | Contestada |

Esperado:

- fila `error`
- mensaje indicando formato valido de duracion

### Correlacion

#### 13. invalid_phone

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-010 | 2026-05-20 11:30 | Beneficiaria QA | 12345 | Saliente | 65 | Observacion QA | Contestada |

Esperado:

- preview `warning`
- execute persiste `raw_call_logs`
- `call_correlations.correlation_status = 'invalid_phone'`

#### 14. unmatched

Archivo con telefono valido sin contacto asociado.

Esperado:

- preview `warning`
- execute persiste `raw_call_logs`
- `call_correlations.correlation_status = 'unmatched'`

#### 15. matched_single principal

Archivo con telefono principal activo unico.

Esperado:

- preview `created`
- execute persiste correlacion con `matched_single`
- `confidence_score = 100`

#### 16. matched_single secundario

Archivo con telefono activo no principal unico.

Esperado:

- preview `warning` o `created` segun otras observaciones; correlacion `matched_single`
- `confidence_score = 95`

#### 17. matched_multiple

Archivo con telefono compartido por dos beneficiarios.

Esperado:

- preview `warning`
- execute persiste `raw_call_logs`
- `call_correlations.correlation_status = 'matched_multiple'`
- no resuelve beneficiario automaticamente

#### 18. raw_status vacio

Archivo:

| id | Fecha | Beneficiario | Teléfono | Tipo de llamada | Duración | Observaciones | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA-CALL-011 | 05/06/2026 14:30 | Beneficiaria QA | +56 9 1111 1111 | Saliente | 65 | Observacion QA | |

Esperado:

- preview `warning`
- execute persiste `raw_call_logs`
- mensaje: `Estado de llamada vacío. Se conserva como evidencia, pero no se usa para matching.`

### Persistencia

#### 19. raw_call_logs creada

Consulta sugerida:

```sql
select id, source, external_call_id, called_at, raw_phone, phone_normalized, raw_payload
from public.raw_call_logs
where source = 'amaia_net2phone_excel'
order by created_at desc;
```

Esperado:

- filas creadas para imports ejecutados sin error bloqueante
- `raw_payload` conserva evidencia de la fila original

#### 20. Correlacion creada

```sql
select raw_call_log_id, correlation_status, beneficiary_id, beneficiary_contact_id, assignment_id_at_call_time, responsible_user_id_at_call_time
from public.call_correlations
where raw_call_log_id in (
  select id
  from public.raw_call_logs
  where source = 'amaia_net2phone_excel'
)
order by created_at desc;
```

Esperado:

- una correlacion por `raw_call_log_id`

#### 21. import_run creada

```sql
select id, created_at, import_type, source_filename, status, total_rows, created_rows, skipped_rows, warning_rows, error_rows, metadata
from public.import_runs
where import_type = 'call_logs_import'
order by created_at desc;
```

Esperado:

- corrida con `import_type = 'call_logs_import'`
- metadata incluye conteos de correlacion

#### 22. import_run_rows creadas

```sql
select row_number, result_status, message, external_call_id, raw_call_log_id, correlation_id, phone_normalized, correlation_status, raw_payload, normalized_payload
from public.import_run_rows
where import_run_id = '<REEMPLAZAR_RUN_ID>'::uuid
order by row_number;
```

Esperado:

- una fila de auditoria por fila del archivo
- columnas nuevas completadas segun corresponda

### Idempotencia

#### 23. Reimportacion del mismo Excel

Accion:

- ejecutar el mismo archivo dos veces

Esperado:

- segunda corrida no duplica `raw_call_logs`
- segunda corrida no duplica `call_correlations`

#### 24. skipped correcto

Esperado:

- filas ya existentes quedan `skipped`
- mensaje explica duplicado por `(source, external_call_id)`

#### 25. Duplicado intra-archivo de external_call_id

Archivo:

- fila 2 y fila 3 comparten el mismo `external_call_id`

Esperado:

- preview y execute muestran la primera aparicion con su resultado normal
- preview y execute muestran la segunda aparicion como `skipped`
- mensaje: `External call id duplicado dentro del archivo. Se considera solo la primera aparición.`
- la fila duplicada no intenta crear `raw_call_logs` ni correlacionar

#### 26. Correlaciones no duplicadas

```sql
select raw_call_log_id, count(*)
from public.call_correlations
group by raw_call_log_id
having count(*) > 1;
```

Esperado:

- cero filas

### Seguridad

#### 27. Teleoperadora bloqueada

Esperado:

- la ruta `/imports/calls` no aparece en navegación de `teleoperadora`
- acceso directo por URL redirige a `unauthorized`
- invocacion manual de RPC falla por rol

#### 28. Admin acceso OK

Esperado:

- puede ver la pantalla
- puede ejecutar preview y execute
- puede leer `raw_call_logs`, `call_correlations`, `import_runs`, `import_run_rows`

#### 29. Super_admin acceso OK

Esperado:

- mismo alcance que `admin`

#### 30. Execute no degrada la tabla

Accion:

- ejecutar preview valido
- confirmar importacion

Esperado:

- la tabla sigue mostrando fecha, telefono, duracion, correlacion y operacion luego de execute
- no se pierden `calledAt`, `rawPhone`, `durationSeconds`, `rawStatus` ni contexto operativo visible

### Integridad

#### 31. No follow_up_events

```sql
select count(*)
from public.followup_events;
```

Esperado:

- el conteo no cambia por ejecutar importaciones 4.4B

#### 32. No cambios dashboard

Esperado:

- la fase no agrega ni modifica rutas ni consultas de auditoría fuera de `/imports/calls`

#### 33. No cambios metricas

Esperado:

- no aparecen nuevos KPIs ni recomputos derivados de la importacion

#### 34. No cambios followup_status

Esperado:

- la importacion no actualiza estado consolidado ni `last_contact_at`
- cualquier superficie de seguimiento existente mantiene sus valores previos