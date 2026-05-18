# Assignment Management — Fase 3 — QA funcional final

## 1. Preparación del entorno

- [ ] Ejecutar dependencias y validaciones base:

```bash
npm install
npx supabase db push --dry-run
npx supabase db push
npm run typecheck
npm run lint
npm run build
npm run dev
```

- [ ] Confirmar que la migración pendiente a aplicar en ambiente QA es:

```text
supabase/migrations/20260514140000_phase3_assignment_management.sql
```

- [ ] Confirmar usuarios y roles requeridos:
Admin A: rol `admin`, activo.
Super Admin S: rol `super_admin`, activo.
Teleoperadora T1: rol `teleoperadora`, activa, dueña oficial inicial del beneficiario de prueba B1.
Teleoperadora T2: rol `teleoperadora`, activa, receptora de reasignación y también dueña oficial inicial del beneficiario B2.
Teleoperadora T3: rol `teleoperadora`, activa, disponible para apoyo temporal.

- [ ] Obtener IDs reales de prueba:

```sql
select id, full_name, email, role, is_active
from public.profiles
where role in ('admin', 'super_admin', 'teleoperadora')
order by role, full_name nulls last, email;
```

- [ ] Confirmar datos mínimos de prueba:
B1 debe tener exactamente una asignación `primary` activa con T1 y ningún `support` activo.
B2 debe tener exactamente una asignación `primary` activa con T2 y ningún `support` activo.

```sql
select
  ba.beneficiary_id,
  b.full_name as beneficiary_name,
  ba.id as assignment_id,
  ba.assignment_type,
  ba.status,
  ba.assigned_user_id,
  p.full_name as assigned_user_name,
  p.email as assigned_user_email,
  ba.reason,
  ba.ended_reason,
  ba.starts_at,
  ba.ends_at
from public.beneficiary_assignments ba
join public.beneficiaries b on b.id = ba.beneficiary_id
join public.profiles p on p.id = ba.assigned_user_id
where ba.status = 'active'
order by ba.beneficiary_id, ba.assignment_type, p.full_name nulls last, p.email;
```

- [ ] Estado esperado previo:
No debe existir doble `primary` activa por beneficiario.
No debe existir `support` activo duplicado para la misma combinación `beneficiary_id + assigned_user_id + assignment_type`.
Las teleoperadoras deben existir como perfiles activos.
El módulo `/assignments` debe ser visible para `admin` y `super_admin`, y no visible para `teleoperadora`.

---

## 2. QA — Admin

- [ ] Reasignar responsable principal.
Acción exacta: iniciar sesión como Admin A, abrir `/assignments`, entrar a vista por teleoperadora, ubicar B1 bajo T1, abrir `Cambiar responsable`, seleccionar T2, ingresar motivo explícito y confirmar.
Resultado esperado UI: B1 deja de aparecer como `Responsable oficial` bajo T1 y pasa a T2 sin recargar la página; aparece banner de feedback exitoso; el selector de teleoperadora queda posicionado en T2; KPI y conteos se actualizan.
Resultado esperado DB:

```sql
select
  id,
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  reason,
  ended_reason,
  created_by,
  ended_by,
  starts_at,
  ends_at
from public.beneficiary_assignments
where beneficiary_id = '<B1_ID>'
order by starts_at asc, created_at asc;
```

Debe existir una fila `primary + inactive` para T1 con `ended_reason` informado y `ended_by = <ADMIN_A_ID>`, y una nueva fila `primary + active` para T2 con `reason` informado y `created_by = <ADMIN_A_ID>`.
Resultado esperado RLS: la operación ocurre solo vía RPC `public.reassign_beneficiary_primary_assignment`; no hay necesidad de acceso directo del cliente a filas ajenas fuera de las policies administrativas.

- [ ] Agregar soporte temporal.
Acción exacta: como Admin A, sobre B1 ahora asignado oficialmente a T2, abrir `Agregar apoyo temporal`, seleccionar T3, ingresar motivo y confirmar.
Resultado esperado UI: B1 sigue visible bajo T2 como `Responsable oficial`; aparece además un apoyo temporal asociado a T3; el banner de feedback indica que no hubo reemplazo del responsable oficial.
Resultado esperado DB:

```sql
select
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  reason,
  created_by,
  starts_at,
  ends_at
from public.beneficiary_assignments
where beneficiary_id = '<B1_ID>'
order by assignment_type, starts_at asc;
```

Debe existir una nueva fila `support + active` para T3 con `reason` informado y `created_by = <ADMIN_A_ID>`. La fila `primary + active` de T2 no debe cambiar de `status`.
Resultado esperado RLS: la operación ocurre solo vía RPC `public.add_support_assignment`; un `insert` manual desde cliente no privilegiado debe seguir bloqueado por policy.

- [ ] Cerrar soporte temporal.
Acción exacta: como Admin A, ubicar el apoyo temporal activo de T3 sobre B1, abrir `Finalizar apoyo`, ingresar motivo y confirmar.
Resultado esperado UI: T3 deja de figurar como apoyo temporal; T2 permanece como responsable oficial; aparece banner de feedback exitoso; el historial sigue disponible.
Resultado esperado DB:

```sql
select
  id,
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  reason,
  ended_reason,
  created_by,
  ended_by,
  starts_at,
  ends_at
from public.beneficiary_assignments
where beneficiary_id = '<B1_ID>'
order by starts_at asc, created_at asc;
```

La fila `support` de T3 debe pasar a `inactive`, conservar `reason`, completar `ended_reason`, `ended_by = <ADMIN_A_ID>` y `ends_at` no nulo.
Resultado esperado RLS: la operación ocurre solo vía RPC `public.end_support_assignment`; el cierre no requiere `delete` físico.

- [ ] Ver historial trazable.
Acción exacta: como Admin A, abrir `Ver historial` para B1 después de reasignar, agregar apoyo y cerrarlo.
Resultado esperado UI: el diálogo muestra cronología completa con filas `primary` y `support`, estados `active` o `inactive`, motivo de inicio, motivo de cierre, actor creador y actor de cierre cuando aplique.
Resultado esperado DB:

```sql
select *
from public.get_assignment_history('<B1_ID>');
```

El resultado debe incluir todas las filas históricas de B1 en orden cronológico y los nombres de `assigned_user`, `created_by` y `ended_by` cuando existan.
Resultado esperado RLS: Admin A puede ejecutar la RPC de historial sin error por tener rol permitido.

- [ ] Refresco y reactividad UI después de mutaciones.
Acción exacta: ejecutar en secuencia reasignación, alta de apoyo y cierre de apoyo sin recargar manualmente la pestaña.
Resultado esperado UI: los listados, badges, contadores y tarjetas se actualizan automáticamente; no aparece `alert()` del navegador; no hay salto de página completa; el feedback aparece como banner inline cerrable.
Resultado esperado DB: cada mutación deja estado consistente inmediatamente verificable con consultas `select`.
Resultado esperado RLS: ninguna reactividad del cliente debe requerir permisos fuera del rol `admin` ya otorgado por RLS y por RPCs `SECURITY DEFINER`.

- [ ] Intento inválido: reasignar a la misma teleoperadora actual.
Acción exacta: sobre un beneficiario con responsable oficial vigente, abrir `Cambiar responsable`, intentar seleccionar la misma teleoperadora actual si el UI lo permite; si el selector la excluye, ejecutar la prueba SQL de integridad del punto 5.
Resultado esperado UI: la teleoperadora actual no debería aparecer como opción; si aparece por error, la operación debe fallar con error controlado.
Resultado esperado DB: no debe crearse ninguna fila nueva ni modificarse la vigente.
Resultado esperado RLS: la RPC debe rechazar la operación con excepción `La nueva responsable debe ser distinta a la actual`.

- [ ] Intento inválido: reasignar sin motivo.
Acción exacta: abrir `Cambiar responsable`, dejar motivo vacío y confirmar.
Resultado esperado UI: el diálogo debe impedir confirmar o mostrar error controlado; no debe cerrarse como éxito.
Resultado esperado DB: sin cambios.
Resultado esperado RLS: la RPC debe rechazar la operación con excepción `El motivo del cambio es obligatorio`.

- [ ] Intento inválido: agregar apoyo igual al responsable oficial.
Acción exacta: abrir `Agregar apoyo temporal` e intentar seleccionar a la misma teleoperadora oficial; si el UI la excluye, ejecutar la prueba SQL del punto 5.
Resultado esperado UI: la responsable oficial no debe aparecer como candidata de apoyo; si apareciera por error, la operación debe fallar de forma controlada.
Resultado esperado DB: sin cambios.
Resultado esperado RLS: la RPC debe rechazar la operación con excepción `La teleoperadora de apoyo debe ser distinta a la responsable oficial`.

- [ ] Intento inválido: cerrar apoyo inexistente o ya cerrado.
Acción exacta: intentar volver a cerrar el mismo apoyo después de haberlo finalizado.
Resultado esperado UI: error controlado sin romper la pantalla.
Resultado esperado DB: sin cambios adicionales sobre la fila ya inactiva.
Resultado esperado RLS: la RPC debe rechazar la operación con excepción `No existe un apoyo temporal activo para cerrar`.

---

## 3. QA — Super Admin

- [ ] Acceso total al módulo.
Acción exacta: iniciar sesión como Super Admin S y abrir `/assignments`.
Resultado esperado UI: acceso completo a vista global y vista por teleoperadora, con botones `Cambiar responsable`, `Agregar apoyo temporal`, `Finalizar apoyo` y `Ver historial` visibles.
Resultado esperado DB: ninguna escritura solo por entrar; únicamente lecturas permitidas.
Resultado esperado RLS: `super_admin` debe poder leer y ejecutar las RPCs administrativas sin restricciones incorrectas.

- [ ] Repetir una reasignación principal completa.
Acción exacta: ejecutar el mismo flujo de reasignación sobre B2 o sobre un beneficiario equivalente de prueba.
Resultado esperado UI: mismo comportamiento exitoso que `admin`, sin diferencias de capacidad.
Resultado esperado DB: mismas huellas de trazabilidad con `created_by` y `ended_by = <SUPER_ADMIN_S_ID>`.
Resultado esperado RLS: la RPC debe aceptar a `super_admin` exactamente igual que a `admin`.

- [ ] Repetir alta y cierre de apoyo temporal.
Acción exacta: agregar apoyo temporal y luego cerrarlo con Super Admin S.
Resultado esperado UI: mismos resultados visibles que con `admin`.
Resultado esperado DB: filas `support` creadas y cerradas correctamente con trazabilidad del actor `super_admin`.
Resultado esperado RLS: sin bloqueos extra ni diferencia funcional respecto de `admin`.

- [ ] Validar ausencia de restricciones incorrectas.
Acción exacta: abrir historial, cambiar tabs, aplicar filtros, operar diálogos y volver a consultar el beneficiario intervenido.
Resultado esperado UI: ningún control administrativo debe quedar oculto o deshabilitado por error para `super_admin`.
Resultado esperado DB: sólo las mutaciones explícitamente confirmadas deben persistir.
Resultado esperado RLS: no deben aparecer errores de permisos en RPC ni en lecturas del módulo.

---

## 4. QA — Teleoperadora

- [ ] Solo ve cartera autorizada.
Acción exacta: iniciar sesión como T2 y abrir `/teleoperadora/cartera`.
Resultado esperado UI: sólo deben verse beneficiarios con asignaciones activas donde `assigned_user_id = <T2_ID>` y `assignment_type in ('primary', 'support')`; no deben aparecer beneficiarios de T1 ni T3 fuera de apoyos propios.
Resultado esperado DB:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<T2_ID>', true);

select beneficiary_id, assigned_user_id, assignment_type, status
from public.beneficiary_assignments
order by beneficiary_id, assignment_type;

rollback;
```

El resultado debe devolver solo filas activas propias de T2 y nunca filas de otras teleoperadoras.
Resultado esperado RLS: la policy `beneficiary_assignments_select_teleoperadora_own` debe aislar completamente cartera ajena.

- [ ] Distingue `primary` y `support`.
Acción exacta: con T2, abrir su cartera cuando tenga al menos un beneficiario oficial y al menos un apoyo temporal propio.
Resultado esperado UI: cada tarjeta debe mostrar badge `Responsable oficial` o `Apoyo temporal`; si el item es `support`, debe verse además `Responsable oficial: <nombre>`.
Resultado esperado DB: las filas visibles deben corresponder al `assignment_type` real de cada asignación activa.
Resultado esperado RLS: la lectura sigue limitada a filas propias; la UI sólo interpreta la semántica permitida por esas filas.

- [ ] No puede administrar.
Acción exacta: revisar visualmente la cartera propia y la ficha de un beneficiario.
Resultado esperado UI: no deben existir botones ni diálogos para reasignar, agregar apoyo, cerrar apoyo ni abrir historial administrativo desde la experiencia de teleoperadora.
Resultado esperado DB: sin cambios por navegación.
Resultado esperado RLS: al no existir acciones administrativas en UI, no se debe exponer capacidad mutante; si se intenta por fuera de UI, debe bloquearse en RPC o policy.

- [ ] No puede acceder por URL directa al módulo administrativo.
Acción exacta: navegar manualmente a `/assignments` autenticada como teleoperadora.
Resultado esperado UI: acceso denegado o redirección a pantalla no autorizada; nunca debe renderizar el módulo administrativo.
Resultado esperado DB: sin cambios.
Resultado esperado RLS: aunque conociera la URL, no debe obtener lectura o mutación administrativa adicional.

- [ ] No puede abrir ficha ajena por URL directa.
Acción exacta: autenticada como T2, abrir `/teleoperadora/beneficiarios/<B1_ID>` cuando B1 no pertenezca a su cartera activa.
Resultado esperado UI: la ficha debe fallar con mensaje controlado equivalente a `La cartera activa no contiene este beneficiario` o pantalla de error similar.
Resultado esperado DB: sin cambios.
Resultado esperado RLS: la consulta de detalle debe quedar vacía por el filtro de asignación propia activa.

- [ ] No puede ejecutar RPCs administrativas.
Acción exacta: ejecutar el bloque SQL del punto 7 simulando T2 e invocando las RPCs administrativas.
Resultado esperado UI: no aplica.
Resultado esperado DB: sin cambios.
Resultado esperado RLS: las RPCs `reassign_beneficiary_primary_assignment`, `add_support_assignment`, `end_support_assignment` y `get_assignment_history` deben devolver excepciones de autorización para `teleoperadora`.

---

## 5. QA — Integridad DB

- [ ] Validar índices únicos parciales presentes.

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'beneficiary_assignments'
  and indexname in (
    'idx_beneficiary_assignments_active_primary_unique',
    'idx_beneficiary_assignments_active_exact_unique'
  )
order by indexname;
```

Resultado esperado: deben existir exactamente ambos índices con condición `where status = 'active'` y el primero además con `assignment_type = 'primary'`.

- [ ] Probar doble `primary` activa manual.

```sql
begin;

insert into public.beneficiary_assignments (
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  starts_at,
  source,
  created_by,
  updated_by,
  reason
) values (
  '<B1_ID>',
  '<T3_ID>',
  'primary',
  'active',
  now(),
  'manual',
  '<ADMIN_A_ID>',
  '<ADMIN_A_ID>',
  'Prueba QA duplicado primary'
);

rollback;
```

Resultado esperado: error por violación del índice `idx_beneficiary_assignments_active_primary_unique`.

- [ ] Probar soporte duplicado manual.

```sql
begin;

insert into public.beneficiary_assignments (
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  starts_at,
  source,
  created_by,
  updated_by,
  reason
) values (
  '<B1_ID>',
  '<T3_ID>',
  'support',
  'active',
  now(),
  'manual',
  '<ADMIN_A_ID>',
  '<ADMIN_A_ID>',
  'Prueba QA soporte duplicado'
);

insert into public.beneficiary_assignments (
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  starts_at,
  source,
  created_by,
  updated_by,
  reason
) values (
  '<B1_ID>',
  '<T3_ID>',
  'support',
  'active',
  now(),
  'manual',
  '<ADMIN_A_ID>',
  '<ADMIN_A_ID>',
  'Prueba QA soporte duplicado 2'
);

rollback;
```

Resultado esperado: la segunda inserción debe fallar por el índice `idx_beneficiary_assignments_active_exact_unique`.

- [ ] Probar reasignación hacia la misma teleoperadora vía RPC.

```sql
select *
from public.reassign_beneficiary_primary_assignment(
  '<B1_ID>',
  '<T1_ID>',
  'Intento QA misma teleoperadora'
);
```

Resultado esperado: excepción `La nueva responsable debe ser distinta a la actual`.

- [ ] Probar reasignación sin motivo vía RPC.

```sql
select *
from public.reassign_beneficiary_primary_assignment(
  '<B1_ID>',
  '<T2_ID>',
  '   '
);
```

Resultado esperado: excepción `El motivo del cambio es obligatorio`.

- [ ] Probar agregar apoyo temporal con misma teleoperadora oficial.

```sql
select *
from public.add_support_assignment(
  '<B1_ID>',
  '<T1_ID>',
  'Intento QA apoyo invalido'
);
```

Resultado esperado: excepción `La teleoperadora de apoyo debe ser distinta a la responsable oficial`.

- [ ] Probar cierre inválido de apoyo inexistente.

```sql
select *
from public.end_support_assignment(
  '00000000-0000-0000-0000-000000000000',
  'Intento QA cierre inexistente'
);
```

Resultado esperado: excepción `No existe un apoyo temporal activo para cerrar`.

- [ ] Probar inserción manual inválida por `ends_at < starts_at`.

```sql
begin;

insert into public.beneficiary_assignments (
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  starts_at,
  ends_at,
  source,
  created_by,
  updated_by,
  reason
) values (
  '<B1_ID>',
  '<T3_ID>',
  'support',
  'inactive',
  now(),
  now() - interval '1 day',
  'manual',
  '<ADMIN_A_ID>',
  '<ADMIN_A_ID>',
  'Prueba QA ends_at invalido'
);

rollback;
```

Resultado esperado: error por check `beneficiary_assignments_ends_at_check`.

---

## 6. QA — Historial y Trazabilidad

- [ ] Validar `created_by`, `ended_by`, `reason`, `ended_reason`, timestamps y persistencia histórica después de un ciclo completo de pruebas.

```sql
select
  ba.id,
  ba.beneficiary_id,
  ba.assignment_type,
  ba.status,
  ba.assigned_user_id,
  ba.created_by,
  ba.ended_by,
  ba.reason,
  ba.ended_reason,
  ba.starts_at,
  ba.ends_at,
  ba.created_at,
  ba.updated_at
from public.beneficiary_assignments ba
where ba.beneficiary_id = '<B1_ID>'
order by ba.starts_at asc, ba.created_at asc;
```

Resultado esperado: toda fila creada por una acción administrativa nueva debe tener `created_by` informado; toda fila cerrada por reasignación o cierre de apoyo debe tener `ended_by`, `ended_reason` y `ends_at` informados; ninguna fila histórica debe ser borrada.

- [ ] Validar enriquecimiento con nombres de actor en historial.

```sql
select *
from public.get_assignment_history('<B1_ID>');
```

Resultado esperado: deben poblarse `assigned_user_name`, `assigned_user_email`, `created_by_name` y `ended_by_name` cuando existan perfiles asociados.

- [ ] Validar persistencia histórica después de una nueva reasignación adicional.

```sql
select
  count(*) as total_rows,
  count(*) filter (where assignment_type = 'primary') as total_primary_rows,
  count(*) filter (where assignment_type = 'support') as total_support_rows,
  count(*) filter (where status = 'active') as total_active_rows,
  count(*) filter (where status = 'inactive') as total_inactive_rows
from public.beneficiary_assignments
where beneficiary_id = '<B1_ID>';
```

Resultado esperado: el total de filas debe crecer o mantenerse, nunca disminuir por operaciones de fase 3; debe existir exactamente una `primary + active` al final y las anteriores quedar `inactive`.

---

## 7. QA — Seguridad / RLS

- [ ] Validar aislamiento de teleoperadora en lectura directa.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<T2_ID>', true);

select auth.uid() as simulated_uid, public.get_user_role(auth.uid()) as simulated_role;

select beneficiary_id, assigned_user_id, assignment_type, status
from public.beneficiary_assignments
order by beneficiary_id, assignment_type;

rollback;
```

Resultado esperado: solo filas activas con `assigned_user_id = <T2_ID>` y `assignment_type in ('primary', 'support')`.

- [ ] Validar lectura amplia de `admin` o `super_admin`.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<ADMIN_A_ID>', true);

select auth.uid() as simulated_uid, public.get_user_role(auth.uid()) as simulated_role;

select beneficiary_id, assigned_user_id, assignment_type, status
from public.beneficiary_assignments
order by beneficiary_id, assignment_type;

rollback;
```

Resultado esperado: el `admin` debe poder leer el conjunto administrativo permitido por la policy de selección.

- [ ] Validar bloqueo de `insert` directo para teleoperadora.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<T2_ID>', true);

insert into public.beneficiary_assignments (
  beneficiary_id,
  assigned_user_id,
  assignment_type,
  status,
  source,
  reason
) values (
  '<B1_ID>',
  '<T2_ID>',
  'support',
  'active',
  'manual',
  'Intento QA insert directo teleoperadora'
);

rollback;
```

Resultado esperado: error por RLS en `insert`.

- [ ] Validar bloqueo de `update` directo para teleoperadora.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<T2_ID>', true);

update public.beneficiary_assignments
set notes = 'Intento QA update directo teleoperadora'
where beneficiary_id = '<B1_ID>';

rollback;
```

Resultado esperado: error por RLS en `update`.

- [ ] Validar comportamiento esperado de RPCs `SECURITY DEFINER` para `admin`.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<ADMIN_A_ID>', true);

select *
from public.get_assignment_history('<B1_ID>');

rollback;
```

Resultado esperado: la RPC debe ejecutarse correctamente para `admin` aunque consulte múltiples perfiles y asignaciones fuera del alcance de una lectura simple del cliente.

- [ ] Validar bloqueo de RPCs `SECURITY DEFINER` para teleoperadora.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<T2_ID>', true);

select * from public.reassign_beneficiary_primary_assignment('<B1_ID>', '<T3_ID>', 'Intento QA teleoperadora');
select * from public.add_support_assignment('<B1_ID>', '<T3_ID>', 'Intento QA teleoperadora');
select * from public.end_support_assignment('00000000-0000-0000-0000-000000000000', 'Intento QA teleoperadora');
select * from public.get_assignment_history('<B1_ID>');

rollback;
```

Resultado esperado: todas las llamadas deben fallar por validación explícita de rol dentro de la RPC.

---

## 8. QA — UI / UX

- [ ] Loading states.
Acción exacta: abrir `/assignments`, `/teleoperadora/cartera` y una ficha de beneficiario con red lenta o recarga limpia.
Resultado esperado: deben mostrarse estados de carga con copy contextual y no pantallas en blanco.

- [ ] Diálogos administrativos.
Acción exacta: abrir y cerrar `Cambiar responsable`, `Agregar apoyo temporal`, `Finalizar apoyo` y `Ver historial`.
Resultado esperado: cada diálogo debe cargar opciones o historial cuando corresponda, permitir cancelar sin efectos laterales y bloquear confirmación cuando faltan datos obligatorios.

- [ ] Feedback equivalente a toast.
Acción exacta: completar una reasignación, un alta de apoyo y un cierre de apoyo.
Resultado esperado: no existe toast global; el feedback visible debe aparecer como banner inline superior con opción `Ocultar` y copy correcto de éxito.

- [ ] Errores controlados.
Acción exacta: provocar un caso inválido de motivo vacío o cierre de apoyo inexistente.
Resultado esperado: el usuario debe ver mensaje controlado dentro del flujo; no debe romperse la pantalla ni quedar el diálogo en estado inconsistente.

- [ ] Ausencia de `alert()`.
Acción exacta: ejecutar búsqueda técnica.

```bash
rg "alert\\s*\\(" src
```

Resultado esperado: sin resultados.

- [ ] Ausencia de `reload()` manual.
Acción exacta: ejecutar búsqueda técnica.

```bash
rg "location\\.reload|window\\.location\\.reload|reload\\s*\\(" src/features
```

Resultado esperado: sin resultados.

- [ ] Estados vacíos.
Acción exacta: aplicar filtros en `/assignments` y `/teleoperadora/cartera` hasta no tener coincidencias; abrir ficha de beneficiario sin contactos o sin llamadas si existe un caso real.
Resultado esperado: deben verse estados vacíos con copy explícito, no tablas rotas ni contenedores colapsados.

- [ ] Mobile básico.
Acción exacta: validar en ancho aproximado 390px tanto `/assignments` como `/teleoperadora/cartera` y la ficha de beneficiario.
Resultado esperado: tarjetas, badges, banners y diálogos deben seguir siendo legibles; no deben quedar acciones clave fuera de pantalla sin scroll natural.

---

## 9. Criterios de cierre de Fase 3

- [ ] Condiciones exactas para considerar Fase 3 cerrada:
La migración `20260514140000_phase3_assignment_management.sql` quedó aplicada en ambiente QA sin errores.
`npm run typecheck`, `npm run lint` y `npm run build` terminan en verde.
Admin y Super Admin pueden reasignar responsable oficial, agregar apoyo temporal, cerrar apoyo temporal y consultar historial.
Teleoperadora solo ve cartera propia activa y distingue correctamente `Responsable oficial` vs `Apoyo temporal`.
Teleoperadora no puede administrar ni por UI ni por URL directa ni por RPC.
Las RPCs escriben `reason`, `ended_reason`, `created_by`, `ended_by`, `starts_at`, `ends_at` cuando corresponde.
No existen dobles `primary` activas.
No existen `support` activos duplicados para la misma teleoperadora y beneficiario.
El historial persiste y puede reconstruirse cronológicamente por beneficiario.
La UI se refresca sin `reload()` manual y sin `alert()`.
El feedback exitoso aparece de forma consistente como banner inline.

- [ ] Blockers críticos:
Cualquier posibilidad de doble `primary` activa.
Cualquier posibilidad de que `teleoperadora` ejecute RPCs administrativas.
Cualquier reasignación o cierre de apoyo que no deje trazabilidad completa en DB.
Cualquier acceso de teleoperadora a cartera ajena por UI o por URL directa.
Cualquier operación administrativa que requiera recarga manual para reflejar el estado correcto.
Cualquier divergencia entre historial UI y datos reales de `beneficiary_assignments`.

- [ ] Observaciones menores tolerables:
Copy mejorable en banners o diálogos sin afectar semántica operativa.
Orden visual de tarjetas o badges si la data y permisos son correctos.
Warnings de chunk grande en build si no afectan funcionalidad, seguridad ni trazabilidad.
Pequeños ajustes responsive de espaciado siempre que no bloqueen lectura o acción principal.