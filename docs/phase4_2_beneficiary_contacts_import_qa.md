# Phase 4.2 - QA beneficiarios/contactos import

## Estado de esta entrega

- Implementacion completada sin avanzar a Fase 4.3.
- No se ejecuto `npx supabase db push` para esta fase, por restriccion explicita de scope.
- Validaciones ejecutadas en esta entrega:
  - `npx supabase db push --dry-run`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- QA runtime de RPCs y persistencia queda pendiente hasta aplicar la migracion `20260518193000_phase4_2_beneficiary_contacts_import.sql` en el entorno objetivo.

## Cobertura implementada

- Importacion solo para `admin` y `super_admin`.
- Validacion estricta de estructura Excel en frontend: columnas exactas `RUT | Nombre | Telefono | Tipo telefono`.
- Bloqueo de archivos con mas de una hoja antes del preview.
- Preview sin persistencia via `public.preview_beneficiary_contacts_import(text, jsonb)`.
- Ejecucion final con trazabilidad en `public.import_runs` y `public.import_run_rows` via `public.execute_beneficiary_contacts_import(text, jsonb)`.
- `import_runs` e `import_run_rows` quedan legibles por RLS, pero no insertables ni editables directamente desde cliente autenticado.
- Normalizacion critica centralizada en DB:
  - `public.normalize_rut(text)`
  - `public.normalize_chilean_phone(text)`
  - `public.normalize_person_name(text)`
  - `public.normalize_import_contact_type(text)`
- Reglas de negocio cubiertas:
  - nuevo beneficiario crea beneficiario + contacto
  - beneficiario existente agrega contacto sin duplicar
  - nombre distinto conserva nombre existente y marca warning
  - telefono invalido marca error
  - RUT invalido marca error
  - tipo invalido marca error
  - nuevo principal reemplaza principal activo anterior y marca warning
  - `red_apoyo` agrega multiples contactos si el telefono no existe ya para ese beneficiario
  - telefono compartido entre beneficiarios permitido con warning
  - duplicado exacto mismo beneficiario + telefono normalizado se marca `skipped`
  - mismo RUT nuevo repetido en el archivo: solo la primera fila valida crea beneficiario; las siguientes agregan contactos adicionales al beneficiario creado en la misma corrida

## QA funcional pendiente de ejecutar tras aplicar migracion

### Preparacion

1. Aplicar la migracion de Fase 4.2:

```powershell
npx supabase db push
```

2. Levantar la aplicacion local si corresponde:

```powershell
npm run dev
```

3. Ingresar con una cuenta `admin` o `super_admin`.

## Casos de QA por contrato

### 1. Beneficiario nuevo

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria Nueva QA | +56 9 1234 5678 | principal |

Esperado:

- Preview con `created`.
- Confirmacion crea 1 beneficiario y 1 contacto.
- `import_runs.created_rows = 1`.

### 2. Beneficiario existente

Precondicion:

- Existe `beneficiaries.rut_normalized = public.normalize_rut('12.345.678-9')`.

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria Existente QA | +56 9 2234 5678 | red_apoyo |

Esperado:

- Preview con `updated` o `warning` segun nombre/telefono compartido.
- No duplica beneficiario.
- Crea solo el contacto nuevo.

### 3. Nombre distinto

Precondicion:

- Beneficiario existente con `full_name = 'Nombre Oficial QA'`.

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Nombre Distinto QA | +56 9 3234 5678 | red_apoyo |

Esperado:

- Preview con `warning`.
- Mensaje indicando que se conserva el nombre ya registrado.
- En persistencia, `beneficiaries.full_name` permanece como `Nombre Oficial QA`.

### 4. Telefono invalido

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | QA Telefono Invalido | 12345 | principal |

Esperado:

- Preview `error`.
- No se persiste nada para esa fila.

### 5. RUT invalido

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| ABC123 | QA RUT Invalido | +56 9 4234 5678 | principal |

Esperado:

- Preview `error`.
- No se persiste nada para esa fila.

### 6. Tipo invalido

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | QA Tipo Invalido | +56 9 5234 5678 | vecino |

Esperado:

- Preview `error`.
- Mensaje indicando uso valido de `principal` o `red_apoyo`.

### 7. Principal reemplazado

Precondicion:

- Beneficiario con principal activo en otro telefono.

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria QA | +56 9 6234 5678 | principal |

Esperado:

- Preview `warning`.
- Mensaje `Principal anterior reemplazado`.
- Tras confirmar:
  - el principal previo queda `is_active = false` e `is_primary = false`
  - el nuevo contacto queda `is_active = true` e `is_primary = true`

### 8. Red de apoyo nueva

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria QA | +56 9 7234 5678 | red_apoyo |

Esperado:

- Preview `updated` o `warning`.
- No toca el principal activo.
- Crea contacto `support_network` nuevo.

### 9. Telefono compartido

Precondicion:

- Existe otro beneficiario con `phone_normalized = '972345678'`.

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria QA | +56 9 7234 5678 | red_apoyo |

Esperado:

- Preview `warning`.
- Se permite confirmar.
- El contacto se crea igual para el beneficiario actual.

### 10. Duplicado exacto

Precondicion:

- El beneficiario ya tiene el telefono normalizado importado.

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria QA | +56 9 7234 5678 | red_apoyo |

Esperado:

- Preview `skipped`.
- Confirmacion no inserta otro contacto.

### 11. Archivo mal estructurado

Variantes:

- encabezado distinto
- columna extra E
- columnas fuera de orden
- multiples hojas

Esperado:

- Bloqueo en frontend antes del preview.
- Mensaje explicando columnas exactas requeridas.
- Si el libro tiene mas de una hoja, mensaje: `El archivo debe contener una sola hoja.`

### 11.1. Mismo RUT nuevo repetido en el mismo archivo

Archivo:

| RUT | Nombre | Telefono | Tipo telefono |
| --- | --- | --- | --- |
| 12.345.678-9 | Beneficiaria QA Repetida | +56 9 1234 5678 | principal |
| 12.345.678-9 | Beneficiaria QA Repetida | +56 9 2234 5678 | red_apoyo |

Esperado:

- Preview fila 1: `created` o `warning` segun aplique.
- Preview fila 2: no debe indicar nueva creacion de beneficiario.
- Preview fila 2: debe describir contacto adicional para beneficiario creado en la misma corrida.
- Execute debe persistir un solo beneficiario operativo.
- `import_run_rows` debe reflejar exactamente esa semantica por fila.

### 12. Teleoperadora intentando importar

Esperado:

- La ruta no aparece en navegacion `teleoperadora`.
- Acceso directo a `/imports/beneficiaries` redirige a no autorizado por `RequireRole`.
- Si intenta invocar la RPC fuera del frontend, la funcion responde error por rol.

### 13. Escritura directa de auditoria bloqueada

Esperado:

- `admin` y `super_admin` pueden leer `import_runs` e `import_run_rows`.
- `admin` y `super_admin` no pueden hacer `insert`, `update` ni `delete` directos sobre esas tablas desde cliente autenticado.
- La unica escritura valida ocurre a traves de las RPC `SECURITY DEFINER`.

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
  updated_rows,
  skipped_rows,
  warning_rows,
  error_rows,
  finished_at
from public.import_runs
where import_type = 'beneficiary_contacts'
order by created_at desc;
```

### Bloqueo de escritura directa en auditoria

```sql
insert into public.import_runs (
  created_by,
  import_type,
  source_filename,
  status,
  total_rows
)
values (
  '<REEMPLAZAR_USER_ID>'::uuid,
  'beneficiary_contacts',
  'forbidden.xlsx',
  'uploaded',
  1
);
```

Esperado:

- Error por RLS o permiso insuficiente para escritura directa.

### Detalle por fila

```sql
select
  row_number,
  result_status,
  message,
  raw_payload,
  normalized_payload,
  beneficiary_id,
  beneficiary_contact_id
from public.import_run_rows
where import_run_id = '<REEMPLAZAR_RUN_ID>'
order by row_number;
```

### Beneficiario y contactos persistidos

```sql
select
  b.id,
  b.rut_normalized,
  b.full_name,
  bc.id as contact_id,
  bc.contact_type,
  bc.phone_normalized,
  bc.is_primary,
  bc.is_active,
  bc.relationship,
  bc.notes
from public.beneficiaries as b
left join public.beneficiary_contacts as bc
  on bc.beneficiary_id = b.id
where b.rut_normalized = public.normalize_rut('12.345.678-9')
order by bc.created_at;
```

## RPC smoke tests sin Excel UI

### Preview directo

```sql
select public.preview_beneficiary_contacts_import(
  'qa_phase4_2_preview.xlsx',
  jsonb_build_array(
    jsonb_build_object(
      'rowNumber', 2,
      'rut', '12.345.678-9',
      'nombre', 'Beneficiaria QA Preview',
      'telefono', '+56 9 1234 5678',
      'tipoTelefono', 'principal'
    )
  )
);
```

### Ejecucion directa

```sql
select public.execute_beneficiary_contacts_import(
  'qa_phase4_2_execute.xlsx',
  jsonb_build_array(
    jsonb_build_object(
      'rowNumber', 2,
      'rut', '12.345.678-9',
      'nombre', 'Beneficiaria QA Execute',
      'telefono', '+56 9 1234 5678',
      'tipoTelefono', 'principal'
    )
  )
);
```