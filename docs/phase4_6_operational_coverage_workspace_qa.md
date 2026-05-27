# Fase 4.6 Operational Coverage Workspace QA

## Objetivo

Validar la primera consola operacional real de Seguimientos Telefonicos Mistatas.

La fase debe consumir exclusivamente:

- `followup_events`
- `beneficiary_followup_status`
- `coverage_state`

Sin recalcular cobertura en React ni reconstruir reglas del motor 4.5.

## Activos de QA

- Migracion backend: `supabase/migrations/20260527173000_phase4_6_operational_coverage_workspace.sql`
- Script QA DB: `supabase/qa_phase4_6_operational_coverage_workspace.sql`
- UI operativa:
  - `teleoperadora`: `/teleoperadora/inicio` y `/teleoperadora/cartera`
  - `admin`: `/admin/inicio` y `/admin/beneficiarios`
  - `super_admin`: `/super-admin/inicio` y `/super-admin/beneficiarios`

## Cobertura del contrato

### 1) Workspace operacional

Debe mostrar por fila:

- beneficiario
- RUT
- `coverage_state`
- dias sin contacto
- ultimo contacto efectivo
- teleoperadora asignada
- ultimo outcome
- tipo de contacto
- prioridad visual

### 2) Orden operacional

Orden natural obligatorio:

1. `urgente`
2. `pendiente`
3. `sin_contacto`
4. `al_dia`

Luego:

- `days_since_effective_followup` DESC
- `last_effective_followup_at` ASC

### 3) Filtros permitidos

- `coverage_state`
- teleoperadora asignada
- busqueda por nombre
- busqueda por RUT
- rango de dias sin contacto

### 4) Seguridad / RLS

Debe cumplirse:

- teleoperadora solo ve beneficiarios asignados activamente
- teleoperadora solo ve contactos de beneficiarios asignados activamente
- admin y super_admin mantienen visibilidad operacional global
- la vista operacional usa `security_invoker = true`

### 5) Drill-down

El detalle debe mostrar:

- datos del beneficiario
- cobertura actual
- contactos activos
- timeline de `followup_events`
- registro manual de seguimiento usando la RPC canonica `create_manual_follow_up_event(...)`

El timeline no debe depender de `call_logs` ni de `call_interactions` para la lectura principal.

## Ejecucion QA DB

1. Aplicar migracion 4.6 en la base destino.
2. Ejecutar:

```bash
npx supabase db query --linked --file supabase/qa_phase4_6_operational_coverage_workspace.sql
```

3. Confirmar `failed_tests = 0`.

## Ejecucion QA UI

1. Levantar la app:

```bash
npm run dev
```

2. Validar con una cuenta `teleoperadora`:

- la cola solo contiene beneficiarios asignados a esa operadora
- el orden visual sigue `urgente -> pendiente -> sin_contacto -> al_dia`
- el detalle abre correctamente
- el timeline lista `followup_events` en orden cronologico descendente
- registrar seguimiento manual refresca cobertura y timeline sin recalculo cliente

3. Validar con una cuenta `admin` o `super_admin`:

- la vista muestra universo operacional global
- el filtro por teleoperadora funciona server-side
- la busqueda por nombre y RUT funciona server-side

## Criterio de aprobacion

La fase queda aprobada cuando:

- la migracion aplica sin errores,
- el script SQL retorna `failed_tests = 0`,
- `typecheck`, `lint` y `build` pasan,
- teleoperadora solo ve cartera asignada,
- admin/super_admin ven cola global,
- el detalle consume `followup_events` como timeline canonico,
- el registro manual actualiza `followup_events` y `beneficiary_followup_status` via backend.