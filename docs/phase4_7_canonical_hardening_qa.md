# Fase 4.7 Canonical Hardening & Legacy Cleanup QA

## Objetivo

Validar el cierre conservador de dos brechas detectadas tras 4.6:

- endurecimiento temporal de RLS en tablas legacy que siguen expuestas a teleoperadora;
- aislamiento del metadata frontend reusable respecto de la capa legacy pre-4.6.

La fase no introduce nuevas vistas, rutas ni cambios de UX operacional.

## Activos de QA

- Migracion backend: `supabase/migrations/20260528120000_phase4_7_canonical_hardening.sql`
- Script QA DB: `supabase/qa_phase4_7_canonical_hardening.sql`
- Metadata extraida: `src/features/teleoperadora/followup-metadata.ts`
- Capa legacy marcada deprecated: `src/features/teleoperadora/data.ts`

## Cobertura del contrato

### 1) RLS temporal homologada

Las policies de teleoperadora en estas superficies deben exigir simultaneamente:

- `ba.assigned_user_id = auth.uid()`
- `ba.status = 'active'`
- `ba.starts_at <= now()`
- `(ba.ends_at is null or ba.ends_at >= now())`

Tablas cubiertas:

- `followup_events`
- `beneficiary_followup_status`
- `call_interactions`

### 2) Visibilidad por ventana temporal

El QA debe demostrar que una `teleoperadora`:

- si ve registros cuando la asignacion esta vigente;
- no ve registros con asignacion futura;
- no ve registros con asignacion expirada;
- no ve registros sin asignacion.

Y que `admin` y `super_admin` mantienen visibilidad global.

### 3) Insercion manual legacy bajo RLS

El QA debe verificar que una `teleoperadora`:

- puede insertar en `followup_events` con asignacion vigente;
- no puede insertar con asignacion futura;
- no puede insertar con asignacion expirada;
- no puede insertar sin asignacion.

### 4) Aislamiento legacy frontend

Debe cumplirse:

- la metadata reusable vive en `followup-metadata.ts`;
- imports visuales reutilizables ya no dependen de `teleoperadora/data.ts`;
- `teleoperadora/data.ts` conserva funciones legacy solo como camino deprecated;
- no se altera la UX activa 4.6 ni sus rutas.

## Ejecucion QA DB

Sin `db push` real, la validacion obligatoria de esta fase queda separada en dos partes:

1. Verificar sintaxis de migracion:

```bash
npx supabase db push --dry-run
```

2. Cuando se autorice aplicar la migracion a una base destino, ejecutar:

```bash
npx supabase db query --linked --file supabase/qa_phase4_7_canonical_hardening.sql
```

3. Confirmar `failed_tests = 0`.

4. Reejecutar compatibilidad 4.6:

```bash
npx supabase db query --linked --file supabase/qa_phase4_6_operational_coverage_workspace.sql
```

5. Confirmar nuevamente `failed_tests = 0`.

## Validacion frontend

Ejecutar:

```bash
npm run typecheck
npm run lint
npm run build
```

Validar ademas que:

- `status-badge`, auditoria y assignments importan metadata desde `followup-metadata.ts`;
- las paginas legacy siguen compilando;
- la ruta activa 4.6 no cambia.

## Criterio de aprobacion

La fase queda aprobada cuando:

- la migracion 4.7 pasa `db push --dry-run`;
- el script SQL 4.7 retorna `failed_tests = 0` una vez aplicada la migracion en la base objetivo;
- el QA 4.6 sigue retornando `failed_tests = 0`;
- `typecheck`, `lint` y `build` pasan;
- la metadata reusable queda aislada del modulo legacy;
- la UX activa 4.6 permanece intacta salvo imports minimos.