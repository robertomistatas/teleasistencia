# Phase 4.8D Runtime Validation

## Objetivo

Validar el comportamiento real de la arquitectura 4.x en la base enlazada, con foco en tres ejes: permisos runtime sobre RPCs sensibles, preservacion de correlacion y diagnosticos del import de call logs, y observabilidad e idempotencia de `public.execute_call_logs_import()`.

## Resumen Ejecutivo

Se confirmo un bug critico real: cuando `public.get_user_role(uid)` devolvia `NULL` para perfiles inactivos o inexistentes, varias RPCs `SECURITY DEFINER` protegidas con `if v_requester_role not in (...) then` quedaban fail-open. En PL/pgSQL, `NULL NOT IN (...)` no produce `true`, por lo que la excepcion no se ejecutaba.

La correccion final quedo desplegada en el proyecto enlazado mediante esta secuencia:

1. `20260602213000_gate_inactive_profiles_in_auth.sql`: `public.get_user_role(uid)` deja de resolver rol para perfiles inactivos.
2. `20260602223000_fix_null_role_admin_guards.sql`: baseline funcional completa para `execute_call_logs_import()` y endurecimiento inicial del slice 4.8D.
3. `20260602232000_harden_null_role_operational_guards.sql`: hardening fail-closed de funciones operacionales.
4. `20260602233000_harden_null_role_import_guards.sql`: hardening fail-closed de funciones de importacion y correlacion.
5. `20260602234000_harden_null_role_execute_call_logs_import.sql`: version final local de `execute_call_logs_import()` restaurada sin recortar funcionalidad y con guard `coalesce(v_requester_role::text, '') not in ('admin', 'super_admin')`.
6. `20260603001000_restore_execute_call_logs_import_observability.sql`: migracion adicional necesaria para corregir el entorno remoto, porque `20260602234000...` ya habia sido aplicada previamente y editarla localmente no modificaba el estado desplegado.

Resultado final: el patron fail-open por rol `NULL` quedo cerrado en las funciones auditadas, y la definicion efectiva remota de `execute_call_logs_import()` conserva la observabilidad, el manejo de diagnosticos y la idempotencia validados en 4.8C/2230.

## Causa Raiz

### Bug 1: perfiles inactivos seguian resolviendo autorizacion util

Mientras `public.get_user_role(uid)` siguiera devolviendo un rol para `profiles.is_active = false`, un usuario autenticado con perfil deshabilitado podia seguir atravesando guardas que dependian solamente del rol.

Fix aplicado: `20260602213000_gate_inactive_profiles_in_auth.sql` obliga a que `public.get_user_role(uid)` filtre `profiles.is_active = true`.

### Bug 2: guardas `NOT IN` fallaban abiertas con rol `NULL`

En varias funciones, la proteccion estaba escrita como `if v_requester_role not in (...) then`. Si el rol resolvia `NULL`, la condicion no disparaba la excepcion y la funcion seguia ejecutando.

Fix aplicado: en las funciones auditadas, la validacion quedo expresada como `coalesce(v_requester_role::text, '') not in (...)`, forzando comportamiento fail-closed para rol `NULL` sin alterar la semantica de autorizacion para roles validos.

## Alcance Auditado

Se auditó el conjunto de funciones sensibles vigentes que dependian de guardas `NOT IN` con rol potencialmente `NULL`.

Funciones corregidas en el estado final:

1. `public.execute_call_logs_import`
2. `public.get_call_import_monitoring_summary`
3. `public.get_call_import_detail`
4. `public.get_call_import_correlation_issues`
5. `public.preview_call_log_correlation`
6. `public.evaluate_call_logs_import_rows`
7. `public.correlate_raw_call_log`
8. `public.evaluate_beneficiary_contacts_import_rows`
9. `public.execute_beneficiary_contacts_import`
10. `public.evaluate_assignment_import_rows`
11. `public.execute_assignment_import`
12. `public.create_beneficiary_primary_assignment`
13. `public.recalculate_all_beneficiary_followup_statuses`
14. `public.reassign_beneficiary_primary_assignment`
15. `public.add_support_assignment`
16. `public.end_support_assignment`
17. `public.get_assignment_history`
18. `public.create_manual_follow_up_event`

Nota de alcance: esta fase valida el cierre del patron de autorizacion `NULL-role fail-open` y la preservacion de la semantica operacional de `execute_call_logs_import()`. No reabre decisiones funcionales previas del pipeline 4.x.

## Regresion de 20260602234000 y Correccion Final

Durante la reauditoria se detecto que una version intermedia de `20260602234000_harden_null_role_execute_call_logs_import.sql` habia simplificado indebidamente `public.execute_call_logs_import()`, perdiendo parte de la observabilidad y de la persistencia diagnostica que estaban presentes en `20260602223000_fix_null_role_admin_guards.sql`.

La correccion final se hizo con este criterio de no regresion:

1. Tomar `20260602223000...` como baseline funcional confiable de la funcion completa.
2. Restaurar desde ese baseline los bloques observacionales y operacionales completos, incluyendo `unique_violation`, `import_job_errors`, `call_log_correlation_issues`, metricas resumidas y metadata de corrida.
3. Agregar solamente el hardening fail-closed del guard de rol `NULL` mediante `coalesce(v_requester_role::text, '') not in ('admin', 'super_admin')`.
4. Emitir `20260603001000_restore_execute_call_logs_import_observability.sql` para reparar tambien el entorno remoto ya migrado.

Chequeos locales de preservacion frente a `2230`:

1. Se confirmo presencia de `when unique_violation then` para mantener idempotencia por reimport.
2. Se confirmo persistencia de `public.import_job_errors`.
3. Se confirmo persistencia de `public.call_log_correlation_issues`.
4. Se confirmo inclusion de `matchedMultipleRows`, `skippedRows`, `sourceType` y `startedAt` en el payload resumido.
5. El unico cambio deliberado de control de acceso respecto de la baseline fue el guard fail-closed para rol `NULL`.

## Validacion Runtime Remota

### Seguridad de permisos

Probes ejecutados sobre la base enlazada:

1. `supabase/qa_phase4_8d_inactive_admin_probe.sql`
2. `supabase/qa_phase4_8d_nonexistent_user_probe.sql`
3. `supabase/qa_phase4_8d_admin_probe.sql`

Resultado obtenido:

1. Perfil admin inactivo: denegado con `Solo admin y super_admin pueden consultar monitoreo de imports`.
2. Usuario autenticado sin perfil asociado: denegado con el mismo mensaje, confirmando cierre fail-closed para rol `NULL`.
3. Probe de admin: el entorno no expuso admins activos; la consulta devolvio solo perfiles `admin` con `is_active = false`.

Limitacion de entorno: en el estado actual del proyecto enlazado no hay evidencia de un `admin` activo para repetir en esta pasada la ruta permitida de admin. La autorizacion positiva de `super_admin` ya habia sido validada previamente durante la fase 4.8D y no fue afectada por esta correccion, que solo endurece el caso `NULL`.

### Correlacion y diagnosticos

La corrida transaccional principal (`supabase/qa_phase4_8d_runtime_validation.sql`) devolvio dos payloads consecutivos:

1. Primera corrida: `processedRows=6`, `validRows=6`, `invalidRows=0`, `correlatedRows=3`, `uncorrelatedRows=3`, `createdRows=3`, `skippedRows=0`, `warningRows=3`, `invalidPhoneRows=1`, `matchedSingleRows=3`, `matchedMultipleRows=1`, `unmatchedRows=1`, `errorRows=0`.
2. Segunda corrida sobre el mismo set: `processedRows=6`, `validRows=6`, `invalidRows=0`, `correlatedRows=3`, `uncorrelatedRows=3`, `createdRows=0`, `skippedRows=6`, `warningRows=0`, `invalidPhoneRows=1`, `matchedSingleRows=3`, `matchedMultipleRows=1`, `unmatchedRows=1`, `errorRows=0`.

Diagnosticos observados en runtime:

1. Se mantiene la clasificacion de filas correlacionadas y no correlacionadas en el resumen por corrida.
2. Se mantienen warnings esperados para casos `matched_multiple` y `unmatched`.
3. Se siguen registrando issues de correlacion consultables por `supabase/qa_phase4_8d_assignment_inactive_probe.sql`, con evidencia remota actual de `assignment_not_found`.

Clasificacion corregida: la evidencia remota sigue sosteniendo que el problema observado en esta pasada es `assignment_not_found`; la variante `assignment_inactive` no pudo demostrarse en este entorno concreto y se mantiene como gap de datos, no como regresion funcional del import.

### Observabilidad, follow-up e idempotencia

Se mantuvo validado en remoto:

1. Observabilidad por corrida con payload resumido completo y metadata de origen.
2. Preservacion de la semantica de importacion exitosa: la primera corrida crea 3 registros; la reimportacion equivalente no duplica y marca `skippedRows=6`.
3. Persistencia de diagnosticos y errores esperados del pipeline, sin recortar `import_job_errors` ni `call_log_correlation_issues`.

## QA Ejecutada

Comandos ejecutados:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. `npx supabase db push --dry-run`
5. `npx supabase db push`
6. `npx supabase db query --linked --file supabase/qa_phase4_8d_admin_probe.sql`
7. `npx supabase db query --linked --file supabase/qa_phase4_8d_inactive_admin_probe.sql`
8. `npx supabase db query --linked --file supabase/qa_phase4_8d_nonexistent_user_probe.sql`
9. `npx supabase db query --linked --file supabase/qa_phase4_8d_runtime_validation.sql`
10. `npx supabase db query --linked --file supabase/qa_phase4_8d_assignment_inactive_probe.sql`

Resultados:

1. `typecheck`: OK.
2. `lint`: OK.
3. `build`: OK.
4. `db push --dry-run`: detecto correctamente la migracion pendiente `20260603001000_restore_execute_call_logs_import_observability.sql`.
5. `db push`: OK; la migracion correctiva quedo aplicada al remoto.
6. Probes de permisos: inactivo y usuario inexistente quedaron denegados correctamente.
7. Probe runtime: mantuvo resumen, diagnosticos e idempotencia esperados.

Observacion no bloqueante: el build sigue emitiendo warning por chunks grandes de Vite, sin relacion con esta fase.

## Estado Final

Estado: aprobado con hardening aplicado y validado en remoto para el patron `NULL-role fail-open` en las funciones sensibles auditadas, incluida la restauracion efectiva de `execute_call_logs_import()` en el entorno enlazado.

Validado satisfactoriamente:

1. Cierre fail-closed para perfiles inactivos y sujetos autenticados sin perfil.
2. Preservacion de observabilidad y diagnosticos de `execute_call_logs_import()` respecto de la baseline 4.8C/2230.
3. Preservacion de idempotencia en reimportacion exitosa.
4. Aplicacion remota de la migracion correctiva adicional `20260603001000_restore_execute_call_logs_import_observability.sql`.

Pendiente o no demostrable por entorno:

1. Ruta positiva de `admin` activo en esta pasada, porque el entorno no expone ninguno.
2. Evidencia runtime especifica de `assignment_inactive`; el entorno observado continua mostrando `assignment_not_found`.

## Archivos Modificados

1. `docs/phase4_8d_runtime_validation.md`
2. `supabase/migrations/20260602213000_gate_inactive_profiles_in_auth.sql`
3. `supabase/migrations/20260602223000_fix_null_role_admin_guards.sql`
4. `supabase/migrations/20260602232000_harden_null_role_operational_guards.sql`
5. `supabase/migrations/20260602233000_harden_null_role_import_guards.sql`
6. `supabase/migrations/20260602234000_harden_null_role_execute_call_logs_import.sql`
7. `supabase/migrations/20260603001000_restore_execute_call_logs_import_observability.sql`
8. `supabase/qa_phase4_8d_admin_probe.sql`
9. `supabase/qa_phase4_8d_assignment_inactive_probe.sql`
10. `supabase/qa_phase4_8d_inactive_admin_probe.sql`
11. `supabase/qa_phase4_8d_nonexistent_user_probe.sql`
12. `supabase/qa_phase4_8d_runtime_discovery.sql`
13. `supabase/qa_phase4_8d_runtime_validation.sql`
14. `src/features/auth/sign-in-page.tsx`
15. `src/features/core/components/route-guards.tsx`

## Git Status

Salida de `git status --short` al cierre:

```text
 M src/features/auth/sign-in-page.tsx
 M src/features/core/components/route-guards.tsx
?? docs/phase4_8d_runtime_validation.md
?? supabase/migrations/20260602213000_gate_inactive_profiles_in_auth.sql
?? supabase/migrations/20260602223000_fix_null_role_admin_guards.sql
?? supabase/migrations/20260602232000_harden_null_role_operational_guards.sql
?? supabase/migrations/20260602233000_harden_null_role_import_guards.sql
?? supabase/migrations/20260602234000_harden_null_role_execute_call_logs_import.sql
?? supabase/migrations/20260603001000_restore_execute_call_logs_import_observability.sql
?? supabase/qa_phase4_8d_admin_probe.sql
?? supabase/qa_phase4_8d_assignment_inactive_probe.sql
?? supabase/qa_phase4_8d_inactive_admin_probe.sql
?? supabase/qa_phase4_8d_nonexistent_user_probe.sql
?? supabase/qa_phase4_8d_runtime_discovery.sql
?? supabase/qa_phase4_8d_runtime_validation.sql
```

## Git Diff Stat

Salida de `git diff --stat` al cierre:

```text
 src/features/auth/sign-in-page.tsx            |  2 +-
 src/features/core/components/route-guards.tsx | 17 +++++++++++++++++
 2 files changed, 18 insertions(+), 1 deletion(-)
```

Observacion: `git diff --stat` no lista archivos no trackeados; la incorporacion de las nuevas migraciones, probes y documento queda reflejada en `git status --short`.

