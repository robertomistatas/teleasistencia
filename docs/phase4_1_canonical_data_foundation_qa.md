# Phase 4.1 Canonical Data Foundation QA

## Objetivo

Validar la base canónica de datos creada para Fase 4.1 sin tocar UI, importadores ni dashboards.

## 1. normalize_rut

```sql
select
  public.normalize_rut('12.345.678-9') as rut_1,
  public.normalize_rut(' 12.345.678-k ') as rut_2,
  public.normalize_rut('12345678K') as rut_3,
  public.normalize_rut('12.345.678-*') as rut_4,
  public.normalize_rut('abc123456789') as rut_5,
  public.normalize_rut('123K45678') as rut_6,
  public.normalize_rut('12 345 678 k') as rut_7,
  public.normalize_rut('') as rut_8,
  public.normalize_rut(null) as rut_9;
```

Resultado esperado:

```text
rut_1 = 123456789
rut_2 = 12345678K
rut_3 = 12345678K
rut_4 = NULL
rut_5 = NULL
rut_6 = NULL
rut_7 = 12345678K
rut_8 = NULL
rut_9 = NULL
```

## 2. normalize_chilean_phone

```sql
select
  public.normalize_chilean_phone('+56 9 1234 5678') as phone_1,
  public.normalize_chilean_phone('56912345678') as phone_2,
  public.normalize_chilean_phone('9 1234 5678') as phone_3,
  public.normalize_chilean_phone('912345678') as phone_4,
  public.normalize_chilean_phone('(+56) 9 1234 5678') as phone_5,
  public.normalize_chilean_phone('( +56 ) 9 1234 5678') as phone_6,
  public.normalize_chilean_phone('9-1234-5678') as phone_7,
  public.normalize_chilean_phone('9.1234.5678') as phone_8,
  public.normalize_chilean_phone('12345678') as phone_9,
  public.normalize_chilean_phone('12345') as phone_10,
  public.normalize_chilean_phone('9123456789') as phone_11,
  public.normalize_chilean_phone('+1 912345678') as phone_12,
  public.normalize_chilean_phone('abc912345678xyz') as phone_13,
  public.normalize_chilean_phone('') as phone_14,
  public.normalize_chilean_phone(null) as phone_15;
```

Resultado esperado:

```text
phone_1 = 912345678
phone_2 = 912345678
phone_3 = 912345678
phone_4 = 912345678
phone_5 = NULL
phone_6 = NULL
phone_7 = 912345678
phone_8 = 912345678
phone_9 = NULL
phone_10 = NULL
phone_11 = NULL
phone_12 = NULL
phone_13 = NULL
phone_14 = NULL
phone_15 = NULL
```

## 3. calculate_followup_status

Nota: esta función reutiliza el enum existente `public.followup_status`, por lo que los equivalentes canónicos son:

- `sin_contacto` -> `no_data`
- `al_dia` -> `up_to_date`
- `pendiente` -> `pending`
- `urgente` -> `urgent`

```sql
select
  public.calculate_followup_status(null, '2026-05-18 12:00:00+00') as status_1,
  public.calculate_followup_status('2026-05-18 11:59:00+00', '2026-05-18 12:00:00+00') as status_2,
  public.calculate_followup_status('2026-05-03 12:00:00+00', '2026-05-18 12:00:00+00') as status_3,
  public.calculate_followup_status('2026-05-02 12:00:00+00', '2026-05-18 12:00:00+00') as status_4,
  public.calculate_followup_status('2026-04-18 12:00:00+00', '2026-05-18 12:00:00+00') as status_5,
  public.calculate_followup_status('2026-04-17 12:00:00+00', '2026-05-18 12:00:00+00') as status_6,
  public.calculate_followup_status('2026-05-19 12:00:00+00', '2026-05-18 12:00:00+00') as status_7,
  public.calculate_followup_status('2026-05-02 23:59:00+00', '2026-05-18 00:01:00+00') as status_8,
  public.calculate_followup_status('2026-04-18 23:59:00+00', '2026-05-18 00:01:00+00') as status_9;
```

Resultado esperado:

```text
status_1 = no_data
status_2 = up_to_date
status_3 = up_to_date
status_4 = pending
status_5 = pending
status_6 = urgent
status_7 = up_to_date
status_8 = pending
status_9 = pending
```

## 4. is_effective_contact

```sql
select
  public.is_effective_contact('contacto_efectivo') as outcome_1,
  public.is_effective_contact(' Contacto_Efectivo ') as outcome_2,
  public.is_effective_contact('CONTACTO_EFECTIVO') as outcome_3,
  public.is_effective_contact('no_responde') as outcome_4,
  public.is_effective_contact('contestada') as outcome_5,
  public.is_effective_contact('') as outcome_6,
  public.is_effective_contact('texto libre') as outcome_7,
  public.is_effective_contact(null) as outcome_8;
```

Resultado esperado:

```text
outcome_1 = true
outcome_2 = true
outcome_3 = true
outcome_4 = false
outcome_5 = false
outcome_6 = false
outcome_7 = false
outcome_8 = false
```

## 5. Recalculation Canonical Check

```sql
select pg_get_functiondef('public.recalculate_beneficiary_followup_status_internal(uuid)'::regprocedure);
```

Verificación esperada:

```text
La definición debe invocar public.calculate_followup_status(...)
```
