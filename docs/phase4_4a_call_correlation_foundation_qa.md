# Phase 4.4A - QA base operacional de llamadas y correlacion

## Estado de esta entrega

- Implementacion completada en la migracion `20260525110000_phase4_4a_call_correlation_foundation.sql`.
- Validacion ejecutada en esta entrega:
  - `npx supabase db push --dry-run`
- Validaciones de frontend y build pendientes de esta misma entrega:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`

## Alcance validado

- Tabla `public.raw_call_logs` para evidencia cruda.
- Tabla `public.call_correlations` para resultado operacional auditable e idempotente.
- Trigger `public.sync_raw_call_log_phone_normalized()` para asegurar `phone_normalized` desde `public.normalize_chilean_phone(...)`.
- RPC `public.correlate_raw_call_log(uuid)` con estados:
  - `matched_single`
  - `matched_multiple`
  - `unmatched`
  - `invalid_phone`
- Resolucion historica de `primary` vigente segun `beneficiary_assignments.starts_at` y `beneficiary_assignments.ends_at`.
- RLS directa solo para lectura de `admin` y `super_admin`.

## Preparacion

### 1. Aplicar migraciones en el entorno objetivo

```powershell
npx supabase db push
```

### 2. Resolver IDs de usuarios de prueba

Reemplazar los placeholders `<ADMIN_ID>`, `<SUPER_ADMIN_ID>`, `<TELEOPERADORA_1_ID>` y `<TELEOPERADORA_2_ID>` con IDs reales obtenidos desde:

```sql
select id, email, role, is_active
from public.profiles
where role in ('admin', 'super_admin', 'teleoperadora')
order by role, created_at, email;
```

### 3. Limpiar fixtures previos de QA

```sql
delete from public.call_correlations
where raw_call_log_id in (
  'aaaaaaa1-0000-0000-0000-000000000001',
  'aaaaaaa2-0000-0000-0000-000000000002',
  'aaaaaaa3-0000-0000-0000-000000000003',
  'aaaaaaa4-0000-0000-0000-000000000004',
  'aaaaaaa5-0000-0000-0000-000000000005',
  'aaaaaaa6-0000-0000-0000-000000000006',
  'aaaaaaa9-0000-0000-0000-000000000009',
  'aaaaaa10-0000-0000-0000-000000000010'
);

delete from public.raw_call_logs
where id in (
  'aaaaaaa1-0000-0000-0000-000000000001',
  'aaaaaaa2-0000-0000-0000-000000000002',
  'aaaaaaa3-0000-0000-0000-000000000003',
  'aaaaaaa4-0000-0000-0000-000000000004',
  'aaaaaaa5-0000-0000-0000-000000000005',
  'aaaaaaa6-0000-0000-0000-000000000006',
  'aaaaaaa7-0000-0000-0000-000000000007',
  'aaaaaaa8-0000-0000-0000-000000000008',
  'aaaaaaa9-0000-0000-0000-000000000009',
  'aaaaaa10-0000-0000-0000-000000000010'
);

delete from public.beneficiary_assignments
where id in (
  'bbbbbbb1-0000-0000-0000-000000000001',
  'bbbbbbb2-0000-0000-0000-000000000002'
)
or beneficiary_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);

delete from public.beneficiary_contacts
where id in (
  'ccccccc1-0000-0000-0000-000000000001',
  'ccccccc2-0000-0000-0000-000000000002',
  'ccccccc3-0000-0000-0000-000000000003',
  'ccccccc4-0000-0000-0000-000000000004',
  'ccccccc5-0000-0000-0000-000000000005',
  'ccccccc6-0000-0000-0000-000000000006'
)
or beneficiary_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);

delete from public.beneficiaries
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
```

### 4. Crear fixture base

```sql
insert into public.beneficiaries (
  id,
  rut_raw,
  rut_normalized,
  first_name,
  last_name,
  status,
  created_by,
  updated_by
)
values
  ('11111111-1111-1111-1111-111111111111', '98.700.001-1', public.normalize_rut('98.700.001-1'), 'QA', 'Beneficiaria Activa', 'active', '<ADMIN_ID>', '<ADMIN_ID>'),
  ('22222222-2222-2222-2222-222222222222', '98.700.002-2', public.normalize_rut('98.700.002-2'), 'QA', 'Beneficiaria Multiple A', 'active', '<ADMIN_ID>', '<ADMIN_ID>'),
  ('33333333-3333-3333-3333-333333333333', '98.700.003-3', public.normalize_rut('98.700.003-3'), 'QA', 'Beneficiaria Multiple B', 'active', '<ADMIN_ID>', '<ADMIN_ID>'),
  ('44444444-4444-4444-4444-444444444444', '98.700.004-4', public.normalize_rut('98.700.004-4'), 'QA', 'Beneficiaria Sin Assignment', 'active', '<ADMIN_ID>', '<ADMIN_ID>')
on conflict (id) do update
set
  rut_raw = excluded.rut_raw,
  rut_normalized = excluded.rut_normalized,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  status = excluded.status,
  updated_by = excluded.updated_by,
  updated_at = now();

insert into public.beneficiary_contacts (
  id,
  beneficiary_id,
  contact_type,
  contact_name,
  phone_raw,
  phone_normalized,
  is_primary,
  is_active
)
values
  ('ccccccc1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'primary_phone', 'QA Principal Activo', '+56 9 1111 1111', public.normalize_chilean_phone('+56 9 1111 1111'), true, true),
  ('ccccccc2-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'family_contact', 'QA Red Apoyo Activa', '+56 9 2222 2222', public.normalize_chilean_phone('+56 9 2222 2222'), false, true),
  ('ccccccc3-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'other', 'QA Historico Inactivo', '+56 9 3333 3333', public.normalize_chilean_phone('+56 9 3333 3333'), false, false),
  ('ccccccc4-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'primary_phone', 'QA Multiple A', '+56 9 4444 4444', public.normalize_chilean_phone('+56 9 4444 4444'), true, true),
  ('ccccccc5-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'family_contact', 'QA Multiple B', '+56 9 4444 4444', public.normalize_chilean_phone('+56 9 4444 4444'), false, true),
  ('ccccccc6-0000-0000-0000-000000000006', '44444444-4444-4444-4444-444444444444', 'primary_phone', 'QA Sin Assignment', '+56 9 6666 6666', public.normalize_chilean_phone('+56 9 6666 6666'), true, true)
on conflict (id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  contact_type = excluded.contact_type,
  contact_name = excluded.contact_name,
  phone_raw = excluded.phone_raw,
  phone_normalized = excluded.phone_normalized,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.beneficiary_assignments (
  id,
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  starts_at,
  ends_at,
  source,
  created_by,
  updated_by,
  reason,
  ended_reason
)
values
  ('bbbbbbb1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '<TELEOPERADORA_1_ID>', 'primary', 'inactive', '2026-05-01 00:00:00+00', '2026-05-14 23:59:59+00', 'manual', '<ADMIN_ID>', '<ADMIN_ID>', 'QA Fase 4.4A historica', 'QA Fase 4.4A cierre historico'),
  ('bbbbbbb2-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '<TELEOPERADORA_2_ID>', 'primary', 'active', '2026-05-15 00:00:00+00', null, 'manual', '<ADMIN_ID>', '<ADMIN_ID>', 'QA Fase 4.4A vigente', null)
on conflict (id) do update
set
  beneficiary_id = excluded.beneficiary_id,
  assigned_user_id = excluded.assigned_user_id,
  assignment_type = excluded.assignment_type,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  source = excluded.source,
  updated_by = excluded.updated_by,
  reason = excluded.reason,
  ended_reason = excluded.ended_reason,
  updated_at = now();
```

## Casos minimos por contrato

### 1. Telefono invalido

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa1-0000-0000-0000-000000000001',
  'qa_phase4_4a',
  'QA-4.4A-01',
  '2026-05-20 10:00:00+00',
  '12345',
  jsonb_build_object('case', 'invalid_phone'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa1-0000-0000-0000-000000000001');

select correlation_status, match_method, confidence_score, beneficiary_id, beneficiary_contact_id, matched_phone
from public.call_correlations
where raw_call_log_id = 'aaaaaaa1-0000-0000-0000-000000000001';
```

Esperado:

- `correlation_status = invalid_phone`
- `match_method = invalid_phone`
- `confidence_score = 0`
- `beneficiary_id is null`
- `beneficiary_contact_id is null`
- `matched_phone is null`

### 2. Telefono valido sin contacto

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa2-0000-0000-0000-000000000002',
  'qa_phase4_4a',
  'QA-4.4A-02',
  '2026-05-20 10:05:00+00',
  '+56 9 5555 5555',
  jsonb_build_object('case', 'unmatched'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa2-0000-0000-0000-000000000002');

select correlation_status, match_method, confidence_score, beneficiary_id, beneficiary_contact_id, matched_phone
from public.call_correlations
where raw_call_log_id = 'aaaaaaa2-0000-0000-0000-000000000002';
```

Esperado:

- `correlation_status = unmatched`
- `match_method = no_contact_match`
- `confidence_score = 0`
- `matched_phone = 955555555`
- `beneficiary_id is null`
- `beneficiary_contact_id is null`

### 3. Match unico principal activo

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa3-0000-0000-0000-000000000003',
  'qa_phase4_4a',
  'QA-4.4A-03',
  '2026-05-20 10:10:00+00',
  '+56 9 1111 1111',
  jsonb_build_object('case', 'matched_single_primary_active'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa3-0000-0000-0000-000000000003');

select correlation_status, beneficiary_id, beneficiary_contact_id, contact_type, match_method, confidence_score
from public.call_correlations
where raw_call_log_id = 'aaaaaaa3-0000-0000-0000-000000000003';
```

Esperado:

- `correlation_status = matched_single`
- `beneficiary_id = 11111111-1111-1111-1111-111111111111`
- `beneficiary_contact_id = ccccccc1-0000-0000-0000-000000000001`
- `contact_type = primary_phone`
- `match_method = phone_exact_active_contact`
- `confidence_score = 100`

### 4. Match unico red de apoyo activa

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa4-0000-0000-0000-000000000004',
  'qa_phase4_4a',
  'QA-4.4A-04',
  '2026-05-20 10:15:00+00',
  '+56 9 2222 2222',
  jsonb_build_object('case', 'matched_single_support_active'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa4-0000-0000-0000-000000000004');

select correlation_status, beneficiary_id, beneficiary_contact_id, contact_type, match_method, confidence_score
from public.call_correlations
where raw_call_log_id = 'aaaaaaa4-0000-0000-0000-000000000004';
```

Esperado:

- `correlation_status = matched_single`
- `beneficiary_id = 11111111-1111-1111-1111-111111111111`
- `beneficiary_contact_id = ccccccc2-0000-0000-0000-000000000002`
- `contact_type = family_contact`
- `match_method = phone_exact_active_contact`
- `confidence_score = 95`

### 5. Match unico contacto inactivo

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa5-0000-0000-0000-000000000005',
  'qa_phase4_4a',
  'QA-4.4A-05',
  '2026-05-20 10:20:00+00',
  '+56 9 3333 3333',
  jsonb_build_object('case', 'matched_single_inactive'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa5-0000-0000-0000-000000000005');

select correlation_status, beneficiary_id, beneficiary_contact_id, contact_type, match_method, confidence_score
from public.call_correlations
where raw_call_log_id = 'aaaaaaa5-0000-0000-0000-000000000005';
```

Esperado:

- `correlation_status = matched_single`
- `beneficiary_id = 11111111-1111-1111-1111-111111111111`
- `beneficiary_contact_id = ccccccc3-0000-0000-0000-000000000003`
- `match_method = phone_exact_inactive_contact`
- `confidence_score = 80`

### 6. Match multiple

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa6-0000-0000-0000-000000000006',
  'qa_phase4_4a',
  'QA-4.4A-06',
  '2026-05-20 10:25:00+00',
  '+56 9 4444 4444',
  jsonb_build_object('case', 'matched_multiple'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa6-0000-0000-0000-000000000006');

select correlation_status, beneficiary_id, beneficiary_contact_id, match_method, confidence_score, reason
from public.call_correlations
where raw_call_log_id = 'aaaaaaa6-0000-0000-0000-000000000006';
```

Esperado:

- `correlation_status = matched_multiple`
- `match_method = phone_exact_multiple_contacts`
- `confidence_score = 40`
- `beneficiary_id is null`
- `beneficiary_contact_id is null`
- `reason` explica que el telefono aparece en mas de un beneficiario

### 7. Llamada con external_call_id duplicado

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa7-0000-0000-0000-000000000007',
  'qa_phase4_4a',
  'QA-4.4A-DUP',
  '2026-05-20 10:30:00+00',
  '+56 9 1111 1111',
  jsonb_build_object('case', 'duplicate_external_call_id_first'),
  '<ADMIN_ID>'
);

insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa8-0000-0000-0000-000000000008',
  'qa_phase4_4a',
  'QA-4.4A-DUP',
  '2026-05-20 10:31:00+00',
  '+56 9 2222 2222',
  jsonb_build_object('case', 'duplicate_external_call_id_second'),
  '<ADMIN_ID>'
);
```

Esperado:

- La segunda insercion falla por el indice unico parcial `(source, external_call_id)`.

### 8. Correlacion idempotente

```sql
select *
from public.correlate_raw_call_log('aaaaaaa3-0000-0000-0000-000000000003');

select *
from public.correlate_raw_call_log('aaaaaaa3-0000-0000-0000-000000000003');

select raw_call_log_id, count(*) as correlation_rows, min(created_at) as first_created_at, max(updated_at) as last_updated_at
from public.call_correlations
where raw_call_log_id = 'aaaaaaa3-0000-0000-0000-000000000003'
group by raw_call_log_id;
```

Esperado:

- `correlation_rows = 1`
- la segunda ejecucion actualiza o reafirma la misma fila
- `last_updated_at >= first_created_at`

### 9. Assignment vigente al momento de la llamada

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaaa9-0000-0000-0000-000000000009',
  'qa_phase4_4a',
  'QA-4.4A-09',
  '2026-05-20 11:00:00+00',
  '+56 9 1111 1111',
  jsonb_build_object('case', 'assignment_at_call_time'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaaa9-0000-0000-0000-000000000009');

select assignment_id_at_call_time, responsible_user_id_at_call_time
from public.call_correlations
where raw_call_log_id = 'aaaaaaa9-0000-0000-0000-000000000009';
```

Esperado:

- `assignment_id_at_call_time = bbbbbbb2-0000-0000-0000-000000000002`
- `responsible_user_id_at_call_time = <TELEOPERADORA_2_ID>`

### 10. Beneficiario sin assignment vigente

```sql
insert into public.raw_call_logs (
  id,
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'aaaaaa10-0000-0000-0000-000000000010',
  'qa_phase4_4a',
  'QA-4.4A-10',
  '2026-05-20 11:05:00+00',
  '+56 9 6666 6666',
  jsonb_build_object('case', 'matched_without_assignment'),
  '<ADMIN_ID>'
);

select *
from public.correlate_raw_call_log('aaaaaa10-0000-0000-0000-000000000010');

select correlation_status, beneficiary_id, assignment_id_at_call_time, responsible_user_id_at_call_time, reason
from public.call_correlations
where raw_call_log_id = 'aaaaaa10-0000-0000-0000-000000000010';
```

Esperado:

- `correlation_status = matched_single`
- `beneficiary_id = 44444444-4444-4444-4444-444444444444`
- `assignment_id_at_call_time is null`
- `responsible_user_id_at_call_time is null`
- `reason` indica que no se encontro `primary` vigente

### 11. Teleoperadora sin acceso directo

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<TELEOPERADORA_1_ID>', true);

select id, source, external_call_id
from public.raw_call_logs
where source = 'qa_phase4_4a'
order by called_at;

select id, raw_call_log_id, correlation_status
from public.call_correlations
order by created_at;

insert into public.raw_call_logs (
  source,
  external_call_id,
  called_at,
  raw_phone,
  raw_payload,
  created_by
)
values (
  'qa_phase4_4a',
  'QA-4.4A-RLS-TELE',
  now(),
  '+56 9 7777 7777',
  jsonb_build_object('case', 'teleoperadora_insert_blocked'),
  '<TELEOPERADORA_1_ID>'
);

rollback;
```

Esperado:

- Los `select` no devuelven filas.
- El `insert` falla por RLS al no existir policy de escritura directa para `teleoperadora`.

### 12. Admin y super_admin con lectura

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<ADMIN_ID>', true);

select id, source, external_call_id, phone_normalized
from public.raw_call_logs
where source = 'qa_phase4_4a'
order by called_at;

select raw_call_log_id, correlation_status, beneficiary_id, confidence_score
from public.call_correlations
order by created_at;

rollback;
```

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<SUPER_ADMIN_ID>', true);

select id, source, external_call_id, phone_normalized
from public.raw_call_logs
where source = 'qa_phase4_4a'
order by called_at;

select raw_call_log_id, correlation_status, beneficiary_id, confidence_score
from public.call_correlations
order by created_at;

rollback;
```

Esperado:

- `admin` y `super_admin` leen filas de ambas tablas.
- `teleoperadora` no obtiene acceso equivalente.

## Limpieza opcional al finalizar QA

```sql
delete from public.call_correlations
where raw_call_log_id in (
  'aaaaaaa1-0000-0000-0000-000000000001',
  'aaaaaaa2-0000-0000-0000-000000000002',
  'aaaaaaa3-0000-0000-0000-000000000003',
  'aaaaaaa4-0000-0000-0000-000000000004',
  'aaaaaaa5-0000-0000-0000-000000000005',
  'aaaaaaa6-0000-0000-0000-000000000006',
  'aaaaaaa9-0000-0000-0000-000000000009',
  'aaaaaa10-0000-0000-0000-000000000010'
);

delete from public.raw_call_logs
where id in (
  'aaaaaaa1-0000-0000-0000-000000000001',
  'aaaaaaa2-0000-0000-0000-000000000002',
  'aaaaaaa3-0000-0000-0000-000000000003',
  'aaaaaaa4-0000-0000-0000-000000000004',
  'aaaaaaa5-0000-0000-0000-000000000005',
  'aaaaaaa6-0000-0000-0000-000000000006',
  'aaaaaaa7-0000-0000-0000-000000000007',
  'aaaaaaa8-0000-0000-0000-000000000008',
  'aaaaaaa9-0000-0000-0000-000000000009',
  'aaaaaa10-0000-0000-0000-000000000010'
);

delete from public.beneficiary_assignments
where id in (
  'bbbbbbb1-0000-0000-0000-000000000001',
  'bbbbbbb2-0000-0000-0000-000000000002'
);

delete from public.beneficiary_contacts
where id in (
  'ccccccc1-0000-0000-0000-000000000001',
  'ccccccc2-0000-0000-0000-000000000002',
  'ccccccc3-0000-0000-0000-000000000003',
  'ccccccc4-0000-0000-0000-000000000004',
  'ccccccc5-0000-0000-0000-000000000005',
  'ccccccc6-0000-0000-0000-000000000006'
);

delete from public.beneficiaries
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
```