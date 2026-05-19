# Phase 4.3 - QA importacion masiva de asignaciones

## Estado de esta entrega

- Implementacion completada reutilizando la logica operacional de Fase 3.
- Validaciones ejecutadas en esta entrega:
  - `npx supabase db push --dry-run`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- QA runtime de RPCs y persistencia queda pendiente hasta aplicar la migracion `20260519110000_phase4_3_assignment_import.sql` en el entorno objetivo.

## Cobertura implementada

- Importacion solo para `admin` y `super_admin`.
- Bloqueo de UI y ruta para `teleoperadora`.
- Validacion estricta de estructura Excel en frontend: una sola hoja y columnas exactas `RUT | Nombre`.
- Seleccion explicita y obligatoria de teleoperadora destino antes de preview o execute.
- Match canonicamente centralizado en DB por `public.normalize_rut(...)` + `beneficiaries.rut_normalized`.
- El nombre del archivo no participa del match.
- Nombre distinto se registra como `warning` sin actualizar datos del beneficiario.
- Preview sin persistencia via `public.preview_assignment_import(text, uuid, jsonb)`.
- Ejecucion final con trazabilidad en `public.import_runs` y `public.import_run_rows` via `public.execute_assignment_import(text, uuid, jsonb)`.
- `import_type = 'assignment_import'`.
- `import_run_rows` registra `raw_payload`, `normalized_payload`, `result_status`, `message`, `beneficiary_id`, `beneficiary_assignment_id` y timestamps.
- Reutilizacion obligatoria de Fase 3:
  - reasignaciones via `public.reassign_beneficiary_primary_assignment(...)`
  - creacion inicial de primary via helper canonicamente validado `public.create_beneficiary_primary_assignment(...)`
- Caso bloqueante cubierto: si la teleoperadora destino ya figura como `support` activa del beneficiario, la fila responde `error` y no promueve support a primary.
- Duplicados de RUT dentro del archivo:
  - primera aparicion valida procesa normalmente
  - siguientes quedan en `warning` con mensaje de duplicado y no reprocesan
- El estado por fila se reinicia explicitamente en cada iteracion de evaluacion, por lo que una fila invalida no contamina las siguientes.
- Si execute detecta una realidad distinta a la evaluada inicialmente, persiste `normalized_payload` efectivo con la operacion real auditada.
- La UI inicia sin teleoperadora preseleccionada y exige seleccion manual antes de preview o execute.
- Execute devuelve filas con el mismo contexto operacional visible que preview para no degradar la tabla tras confirmar.
- Idempotencia operacional:
  - si ya existe `primary` activa para la misma teleoperadora, la fila tiende a `skipped`
  - no se recrea historial innecesario
- Execute reevalua el archivo contra el estado real, por lo que no depende ciegamente del preview y deja visible cualquier cambio concurrente.

## QA funcional pendiente de ejecutar tras aplicar migracion

### Preparacion

1. Aplicar migraciones en el entorno objetivo:

```powershell
npx supabase db push
```

2. Levantar la aplicacion local si corresponde:

```powershell
npm run dev
```

3. Ingresar con una cuenta `admin` o `super_admin`.

## Casos de QA por contrato

### 1. Beneficiario sin primary activa

Precondicion:

- Existe beneficiario por RUT y no tiene `primary` activa.

Archivo:

| RUT | Nombre |
| --- | --- |
| 12.345.678-9 | Beneficiaria QA Sin Primary |

Esperado:

- Preview `created` o `warning` si hay observacion adicional.
- Execute crea una nueva `primary` para la teleoperadora destino.
- `beneficiary_assignments.source = 'import'`.

### 2. Beneficiario ya asignado a la misma teleoperadora

Precondicion:

- Existe `primary` activa para la misma teleoperadora seleccionada.

Archivo:

| RUT | Nombre |
| --- | --- |
| 12.345.678-9 | Beneficiaria QA Misma Operadora |

Esperado:

- Preview `skipped` o `warning` si hay observacion adicional.
- Execute no cierra ni recrea historial.

### 3. Beneficiario asignado a otra teleoperadora

Precondicion:

- Existe `primary` activa para otra teleoperadora.

Archivo:

| RUT | Nombre |
| --- | --- |
| 12.345.678-9 | Beneficiaria QA Reasignacion |

Esperado:

- Preview `reassigned` o `warning` si hay observacion adicional.
- Execute usa la RPC de reasignacion de Fase 3.
- La asignacion anterior queda cerrada y la nueva queda activa.

### 4. Support conflictivo con la teleoperadora destino

Precondicion:

- La teleoperadora destino ya figura como `support` activa del beneficiario.

Archivo:

| RUT | Nombre |
| --- | --- |
| 12.345.678-9 | Beneficiaria QA Support Conflictivo |

Esperado:

- Preview `error`.
- Mensaje: `La teleoperadora destino figura como apoyo temporal activo. Cierre el apoyo antes de reasignar.`
- Execute no persiste cambios.

### 5. Beneficiario inexistente

Archivo:

| RUT | Nombre |
| --- | --- |
| 22.222.222-2 | Beneficiaria Inexistente QA |

Esperado:

- Preview `error`.
- Mensaje: `Beneficiario no encontrado.`

### 6. RUT invalido

Archivo:

| RUT | Nombre |
| --- | --- |
| ABC123 | Beneficiaria QA RUT Invalido |

Esperado:

- Preview `error`.
- Execute no persiste esa fila.

### 7. Nombre distinto

Precondicion:

- El beneficiario existe con nombre oficial distinto.

Archivo:

| RUT | Nombre |
| --- | --- |
| 12.345.678-9 | Nombre Distinto QA |

Esperado:

- Preview `warning`.
- Mensaje indicando que se usa el beneficiario existente por RUT.
- No se actualiza el nombre persistido.

### 8. RUT repetido en archivo

Archivo:

| RUT | Nombre |
| --- | --- |
| 12.345.678-9 | Beneficiaria QA Duplicada |
| 12.345.678-9 | Beneficiaria QA Duplicada |

Esperado:

- Primera fila valida procesa normalmente.
- Segunda fila queda en `warning`.
- Mensaje: `RUT repetido en archivo. Se considera solo la primera aparicion valida.`

### 9. Archivo invalido

Variantes:

- columnas faltantes
- columnas extra
- columnas fuera de orden
- archivo con datos fuera de A-B

Esperado:

- Bloqueo en frontend antes del preview.
- Mensaje: `El archivo debe contener una sola hoja con columnas exactas: RUT | Nombre`

### 10. Multiples hojas

Esperado:

- Bloqueo en frontend antes del preview.
- Mensaje: `El archivo debe contener una sola hoja con columnas exactas: RUT | Nombre`

### 11. Teleoperadora bloqueada o invalida

Variantes:

- perfil inexistente
- perfil inactivo
- rol distinto de `teleoperadora`

Esperado:

- Preview y execute fallan con error bloqueante de archivo.

### 12. Fila invalida seguida de fila valida

Archivo:

| RUT | Nombre |
| --- | --- |
| ABC123 | Beneficiaria QA RUT Invalido |
| 12.345.678-9 | Beneficiaria QA Valida |

Esperado:

- Fila 1: `error`.
- Fila 2: se evalua de forma independiente y conserva su resultado real (`created`, `reassigned`, `skipped` o `warning`).
- La fila 1 no contamina el resultado de la fila 2.

### 13. Operacion real distinta a evaluacion inicial

Precondicion:

- Generar preview con resultado `reassigned` o `created`.
- Antes de confirmar, cambiar concurrentemente la realidad operacional para forzar otro resultado real.

Esperado:

- Execute refleja el resultado real (`created`, `skipped` o `error`, segun corresponda).
- `import_run_rows.normalized_payload.operation` coincide con la operacion efectivamente ejecutada u omitida.
- `result_status`, `message` y `beneficiary_assignment_id` no contradicen el payload auditado.

### 14. UI sin teleoperadora seleccionada

Esperado:

- La pantalla carga con placeholder y sin teleoperadora preseleccionada.
- Preview y execute permanecen bloqueados hasta seleccion manual.

### 15. Target user invalido en execute

Variantes:

- `NULL`
- usuario inexistente
- usuario inactivo
- usuario con rol distinto de `teleoperadora`

Esperado:

- `execute_assignment_import` falla antes de crear `import_run`.
- No se genera corrida parcial para destino invalido.

### 16. Execute no degrada la tabla

Esperado:

- Despues de confirmar, la tabla mantiene contexto operacional visible.
- Siguen visibles RUT normalizado, beneficiario usado, primary activa actual, accion, estado y mensaje.

### 17. Idempotencia

Precondicion:

- Ejecutar el mismo archivo dos veces contra la misma teleoperadora.

Esperado:

- Segunda corrida tiende a `skipped` para filas ya aplicadas.
- No duplica `primary` ni recrea historial.

### 18. Historial correcto tras reassignment

Esperado:

- La asignacion previa queda `inactive` con `ended_by` y `ended_reason`.
- La nueva asignacion queda `active` con `reason = 'Importacion masiva de asignaciones'` o equivalente.

### 19. Preview consistente con execute

Esperado:

- Sin concurrencia, execute refleja la misma realidad del preview.
- Con concurrencia, execute refleja el resultado real sin ocultar diferencias.

### 20. Teleoperadora intentando importar

Esperado:

- La ruta no aparece en navegacion `teleoperadora`.
- Acceso directo a `/imports/assignments` redirige a no autorizado por `RequireRole`.
- Si intenta invocar la RPC fuera del frontend, la funcion responde error por rol.

## Consultas SQL de verificacion post-import

### Resumen de corridas

```sql
select
  id,
  created_at,
  source_filename,
  status,
  total_rows,
  created_rows,
  reassigned_rows,
  skipped_rows,
  warning_rows,
  error_rows,
  metadata,
  finished_at
from public.import_runs
where import_type = 'assignment_import'
order by created_at desc;
```

### Detalle por fila

```sql
select
  row_number,
  result_status,
  message,
  raw_payload,
  normalized_payload,
  beneficiary_id,
  beneficiary_assignment_id
from public.import_run_rows
where import_run_id = '<REEMPLAZAR_RUN_ID>'
order by row_number;
```

### Historial de asignaciones afectadas

```sql
select
  ba.id,
  ba.beneficiary_id,
  ba.assigned_user_id,
  ba.assignment_type,
  ba.status,
  ba.starts_at,
  ba.ends_at,
  ba.reason,
  ba.ended_reason,
  ba.created_by,
  ba.ended_by,
  ba.source,
  ba.source_run_id,
  ba.source_row_id
from public.beneficiary_assignments as ba
where ba.beneficiary_id = '<REEMPLAZAR_BENEFICIARY_ID>'::uuid
order by ba.starts_at, ba.created_at;
```

## RPC smoke tests sin Excel UI

### Preview directo

```sql
select public.preview_assignment_import(
  'qa_phase4_3_preview.xlsx',
  '<REEMPLAZAR_TELEOPERADORA_ID>'::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'rowNumber', 2,
      'rut', '12.345.678-9',
      'nombre', 'Beneficiaria QA Preview'
    )
  )
);
```

### Ejecucion directa

```sql
select public.execute_assignment_import(
  'qa_phase4_3_execute.xlsx',
  '<REEMPLAZAR_TELEOPERADORA_ID>'::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'rowNumber', 2,
      'rut', '12.345.678-9',
      'nombre', 'Beneficiaria QA Execute'
    )
  )
);
```