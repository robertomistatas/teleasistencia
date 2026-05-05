# Audit Queries Design — Seguimientos Mistatas

## 1. Objetivo

Este documento define el diseño lógico de las queries necesarias para alimentar el módulo de auditoría y métricas.

El objetivo es establecer una base clara para consultas analíticas y operativas sin introducir lógica nueva de negocio, sin recalcular estados en frontend y sin convertir este documento en SQL ejecutable.

La intención del diseño es responder tres necesidades principales:

- medir cobertura por teleoperadora y a nivel global
- medir actividad operacional registrada en seguimiento manual y llamadas AMAIA
- identificar beneficiarios en riesgo para priorización y auditoría

---

## 2. Principios de diseño

### Fuente de verdad

La fuente principal del estado de seguimiento debe ser `beneficiary_followup_status`.

### No recalcular estados

Las queries del módulo no deben reconstruir ni recalcular la clasificación de estados. Deben consumir el estado ya calculado por backend.

### Separación conceptual

El diseño se divide en tres vistas lógicas:

- `teleoperator_metrics`: resumen de cartera y cobertura por teleoperadora
- `teleoperator_activity`: actividad operacional por teleoperadora
- `risk_beneficiaries`: universo de beneficiarios con mayor exposición operativa

### Uso esperado

Estas vistas lógicas pueden implementarse más adelante como views, RPCs, queries agregadas o consultas compuestas según convenga a arquitectura, performance y permisos.

---

## 3. Vista lógica: teleoperator_metrics

### Objetivo

Consolidar las métricas principales de cartera y cobertura por teleoperadora.

### Fuente base

La base lógica de esta vista debe construirse desde `beneficiary_assignments`, considerando únicamente asignaciones activas que definan la cartera vigente de cada teleoperadora.

### Tablas principales involucradas

- `beneficiary_assignments`
- `beneficiary_followup_status`
- `profiles` o tabla equivalente de usuarios, si se requiere identificación nominal de teleoperadora

### Reglas de construcción

- cada beneficiario debe quedar asociado a la teleoperadora activa correspondiente
- el estado del beneficiario debe obtenerse desde `beneficiary_followup_status`
- la agregación debe realizarse por teleoperadora
- el total de cartera debe representar beneficiarios activos efectivamente asignados

### Métricas requeridas

- `total_beneficiarios`
- `contactados`
- `pendientes`
- `urgentes`
- `sin_datos`
- `cobertura_pct`
- `tasa_pendiente_pct`
- `tasa_urgente_pct`

### Definición conceptual de métricas

- `total_beneficiarios`: total de beneficiarios en cartera activa
- `contactados`: beneficiarios cuyo estado en `beneficiary_followup_status` es equivalente a al día
- `pendientes`: beneficiarios en estado pendiente
- `urgentes`: beneficiarios en estado urgente
- `sin_datos`: beneficiarios en estado sin datos o sin fila utilizable de estado
- `cobertura_pct`: contactados / total_beneficiarios
- `tasa_pendiente_pct`: pendientes / total_beneficiarios
- `tasa_urgente_pct`: urgentes / total_beneficiarios

### Pseudocode SQL

```sql
VIEW LOGICA teleoperator_metrics AS
SELECT
  assignment.assigned_user_id AS teleoperator_id,
  user_profile.display_name AS teleoperator_name,
  COUNT(DISTINCT assignment.beneficiary_id) AS total_beneficiarios,
  COUNT(DISTINCT CASE WHEN status.status = 'up_to_date' THEN assignment.beneficiary_id END) AS contactados,
  COUNT(DISTINCT CASE WHEN status.status = 'pending' THEN assignment.beneficiary_id END) AS pendientes,
  COUNT(DISTINCT CASE WHEN status.status = 'urgent' THEN assignment.beneficiary_id END) AS urgentes,
  COUNT(DISTINCT CASE WHEN status.status = 'no_data' OR status.status IS NULL THEN assignment.beneficiary_id END) AS sin_datos,
  SAFE_DIVIDE(contactados, total_beneficiarios) AS cobertura_pct,
  SAFE_DIVIDE(pendientes, total_beneficiarios) AS tasa_pendiente_pct,
  SAFE_DIVIDE(urgentes, total_beneficiarios) AS tasa_urgente_pct
FROM beneficiary_assignments assignment
LEFT JOIN beneficiary_followup_status status
  ON status.beneficiary_id = assignment.beneficiary_id
LEFT JOIN profiles user_profile
  ON user_profile.id = assignment.assigned_user_id
WHERE assignment.status = 'active'
  AND assignment.assignment_type = 'primary'
GROUP BY teleoperator_id, teleoperator_name
```

### Observaciones

- conviene usar `COUNT(DISTINCT beneficiary_id)` para evitar duplicaciones por joins secundarios
- si existieran múltiples asignaciones activas por error, la query debe protegerse contra sobreconteo
- si la implementación requiere corte temporal, el universo de asignaciones deberá ajustarse con reglas explícitas de vigencia

---

## 4. Vista lógica: teleoperator_activity

### Objetivo

Medir la actividad operacional de cada teleoperadora a partir de seguimientos manuales y llamadas AMAIA.

### Fuentes principales

- `followup_events`
- `call_interactions`
- `beneficiary_assignments`

### Lógica conceptual

Esta vista debe consolidar actividad asociada a beneficiarios de la cartera de cada teleoperadora, permitiendo conteos totales y por tipo.

### Métricas mínimas

- total de seguimientos manuales
- total de llamadas AMAIA
- conteos de `followup_events` por tipo de evento
- conteos de `call_interactions` por tipo o por clasificación relevante, si el dato existe

### Consideraciones de interpretación

- esta vista mide actividad, no cobertura
- no debe reemplazar la lectura del KPI principal
- su propósito es complementar análisis de intensidad operativa y trazabilidad

### Pseudocode SQL para seguimientos manuales

```sql
VIEW LOGICA teleoperator_manual_activity AS
SELECT
  assignment.assigned_user_id AS teleoperator_id,
  COUNT(event.id) AS total_seguimientos_manuales,
  COUNT(CASE WHEN event.event_type = 'contact_beneficiary' THEN 1 END) AS total_contacto_beneficiario,
  COUNT(CASE WHEN event.event_type = 'contact_support_network' THEN 1 END) AS total_contacto_red_apoyo,
  COUNT(CASE WHEN event.event_type = 'requests_help' THEN 1 END) AS total_requiere_ayuda,
  COUNT(CASE WHEN event.event_type = 'support_referral' THEN 1 END) AS total_derivaciones,
  COUNT(CASE WHEN event.event_type = 'no_answer' THEN 1 END) AS total_sin_respuesta,
  COUNT(CASE WHEN event.event_type = 'wrong_number' THEN 1 END) AS total_numero_erroneo,
  COUNT(CASE WHEN event.event_type = 'phone_off' THEN 1 END) AS total_telefono_apagado
FROM beneficiary_assignments assignment
JOIN followup_events event
  ON event.beneficiary_id = assignment.beneficiary_id
WHERE assignment.status = 'active'
  AND assignment.assignment_type = 'primary'
  AND event.source = 'manual'
  AND event.occurred_at BETWEEN :fecha_inicio AND :fecha_fin
GROUP BY teleoperator_id
```

### Pseudocode SQL para llamadas AMAIA

```sql
VIEW LOGICA teleoperator_call_activity AS
SELECT
  assignment.assigned_user_id AS teleoperator_id,
  COUNT(call.id) AS total_llamadas_amaia,
  COUNT(CASE WHEN call.matched_status = 'matched' THEN 1 END) AS total_llamadas_match,
  COUNT(CASE WHEN call.counts_as_valid_followup = true THEN 1 END) AS total_llamadas_validas,
  COUNT(CASE WHEN call.duration_seconds >= 10 THEN 1 END) AS total_llamadas_10s_o_mas
FROM beneficiary_assignments assignment
JOIN call_interactions call
  ON call.beneficiary_id = assignment.beneficiary_id
WHERE assignment.status = 'active'
  AND assignment.assignment_type = 'primary'
  AND call.call_date BETWEEN :fecha_inicio AND :fecha_fin
GROUP BY teleoperator_id
```

### Vista lógica consolidada

A nivel de diseño, `teleoperator_activity` puede surgir de unir ambas agregaciones por `teleoperator_id`.

### Pseudocode SQL consolidado

```sql
VIEW LOGICA teleoperator_activity AS
SELECT
  metrics.teleoperator_id,
  metrics.total_seguimientos_manuales,
  calls.total_llamadas_amaia,
  metrics.total_contacto_beneficiario,
  metrics.total_contacto_red_apoyo,
  metrics.total_requiere_ayuda,
  metrics.total_derivaciones,
  metrics.total_sin_respuesta,
  metrics.total_numero_erroneo,
  metrics.total_telefono_apagado,
  calls.total_llamadas_match,
  calls.total_llamadas_validas,
  calls.total_llamadas_10s_o_mas
FROM teleoperator_manual_activity metrics
FULL OUTER JOIN teleoperator_call_activity calls
  ON calls.teleoperator_id = metrics.teleoperator_id
```

---

## 5. Vista lógica: risk_beneficiaries

### Objetivo

Construir el listado de beneficiarios que requieren priorización operacional por mayor riesgo de atraso o falta de contacto.

### Datos requeridos

- beneficiario
- teleoperadora responsable
- estado actual
- días sin contacto válido
- fecha de último seguimiento válido, si existe

### Fuente principal

- `beneficiary_followup_status`

### Fuentes complementarias

- `beneficiary_assignments`
- `beneficiaries`
- `profiles`, si se requiere nombre de teleoperadora

### Universo esperado

Debe centrarse al menos en:

- beneficiarios urgentes
- beneficiarios sin datos
- opcionalmente beneficiarios pendientes si la vista también se usa como bandeja ampliada de riesgo

### Pseudocode SQL

```sql
VIEW LOGICA risk_beneficiaries AS
SELECT
  beneficiary.id AS beneficiary_id,
  beneficiary.full_name,
  beneficiary.rut_normalized,
  assignment.assigned_user_id AS teleoperator_id,
  user_profile.display_name AS teleoperator_name,
  status.status AS followup_status,
  status.days_since_last_valid_followup,
  status.last_valid_followup_at
FROM beneficiary_assignments assignment
JOIN beneficiaries beneficiary
  ON beneficiary.id = assignment.beneficiary_id
LEFT JOIN beneficiary_followup_status status
  ON status.beneficiary_id = beneficiary.id
LEFT JOIN profiles user_profile
  ON user_profile.id = assignment.assigned_user_id
WHERE assignment.status = 'active'
  AND assignment.assignment_type = 'primary'
  AND (
    status.status IN ('urgent', 'no_data')
    OR status.status IS NULL
  )
ORDER BY
  CASE
    WHEN status.status = 'urgent' THEN 1
    WHEN status.status = 'no_data' THEN 2
    ELSE 3
  END,
  status.days_since_last_valid_followup DESC NULLS LAST
```

### Uso esperado

Esta vista lógica debe alimentar:

- tablas de riesgo
- bloques de alertas ejecutivas
- anexos del informe PDF
- priorización de revisión operativa

---

## 6. Filtros

Las queries del módulo deben soportar filtros transversales sin alterar la fuente principal del estado.

### Filtros obligatorios

- rango de fechas
- teleoperadora
- global

### Regla de aplicación por tipo de vista

#### teleoperator_metrics

- filtro teleoperadora: restringe una o varias teleoperadoras
- filtro global: consolida todas las teleoperadoras
- rango de fechas: aplicar con cautela; el estado actual no debe recalcularse desde actividad del período

#### teleoperator_activity

- rango de fechas: obligatorio para análisis útil
- teleoperadora: restringe actividad de una persona o subconjunto
- global: consolida toda la actividad del período

#### risk_beneficiaries

- teleoperadora: permite ver el riesgo de una cartera específica
- global: permite ver el riesgo consolidado
- rango de fechas: opcional, y normalmente menos relevante que el estado actual salvo si se diseñan cortes históricos

### Pseudocode SQL de filtro genérico

```sql
WHERE
  (:teleoperator_id IS NULL OR teleoperator_id = :teleoperator_id)
  AND (
    :modo_global = true
    OR :teleoperator_id IS NOT NULL
  )
  AND (
    :fecha_inicio IS NULL OR activity_date >= :fecha_inicio
  )
  AND (
    :fecha_fin IS NULL OR activity_date <= :fecha_fin
  )
```

### Nota

El filtro de fechas en métricas de cobertura no debe forzar recálculos alternativos del estado. Si se necesita evolución histórica real, eso debe diseñarse explícitamente como serie temporal y no como reinterpretación del estado actual.

---

## 7. Reglas

### Regla principal

Usar `beneficiary_followup_status` como fuente canónica de estado.

### Regla de no recalcular

Las queries del módulo no deben deducir estados desde `followup_events` ni desde `call_interactions` para reemplazar el valor oficial del backend.

### Regla de actividad

`followup_events` y `call_interactions` deben utilizarse para:

- conteos de actividad
- clasificación operativa
- análisis comparativo
- trazabilidad y auditoría

No deben utilizarse como fuente principal para redefinir cobertura vigente dentro del módulo.

### Regla de cartera

La relación entre beneficiario y teleoperadora debe salir de `beneficiary_assignments`, idealmente usando asignación activa primaria como criterio canónico.

---

## 8. Ejemplos de query en pseudocode SQL

### Ejemplo A: resumen global de cobertura

```sql
SELECT
  COUNT(*) AS total_beneficiarios,
  COUNT(CASE WHEN status = 'up_to_date' THEN 1 END) AS contactados,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pendientes,
  COUNT(CASE WHEN status = 'urgent' THEN 1 END) AS urgentes,
  COUNT(CASE WHEN status = 'no_data' THEN 1 END) AS sin_datos,
  SAFE_DIVIDE(COUNT(CASE WHEN status = 'up_to_date' THEN 1 END), COUNT(*)) AS cobertura_pct
FROM teleoperator_metrics_base
```

### Ejemplo B: ranking de teleoperadoras

```sql
SELECT
  teleoperator_name,
  total_beneficiarios,
  contactados,
  pendientes,
  urgentes,
  sin_datos,
  cobertura_pct,
  tasa_urgente_pct
FROM teleoperator_metrics
ORDER BY cobertura_pct DESC, urgentes ASC, total_beneficiarios DESC
```

### Ejemplo C: actividad por teleoperadora en período

```sql
SELECT
  teleoperator_id,
  total_seguimientos_manuales,
  total_llamadas_amaia,
  total_contacto_beneficiario,
  total_derivaciones,
  total_llamadas_validas
FROM teleoperator_activity
WHERE periodo = :periodo
ORDER BY total_seguimientos_manuales DESC
```

### Ejemplo D: beneficiarios urgentes por teleoperadora

```sql
SELECT
  teleoperator_name,
  beneficiary_id,
  full_name,
  days_since_last_valid_followup
FROM risk_beneficiaries
WHERE followup_status = 'urgent'
ORDER BY teleoperator_name, days_since_last_valid_followup DESC
```

---

## 9. Consideraciones de performance

El módulo de auditoría puede crecer rápido en costo si mezcla agregaciones amplias, joins de cartera y filtros temporales sobre tablas de eventos. Por eso el diseño debe considerar performance desde el inicio.

### Recomendaciones principales

- agregar desde universos reducidos y bien definidos
- evitar recalcular agregaciones complejas repetidamente en tiempo real si el volumen crece
- protegerse contra duplicación de filas en joins entre asignaciones y eventos
- separar claramente queries de estado actual y queries de actividad histórica

### Riesgos comunes

- sobreconteo por múltiples asignaciones del mismo beneficiario
- joins directos entre `followup_events` y `call_interactions` sin agregación previa
- filtros temporales aplicados sobre tablas grandes sin estrategia de indexación
- intentos de reconstruir cobertura desde eventos históricos en cada consulta

### Estrategias recomendadas

- preagregar actividad por teleoperadora y período cuando el volumen lo exija
- usar agregaciones intermedias antes de unir fuentes heterogéneas
- indexar campos de join y filtro frecuentes
- revisar cardinalidad real de asignaciones activas
- considerar materialización futura si el dashboard ejecutivo requiere baja latencia

### Campos que probablemente requerirán buena indexación

- `beneficiary_assignments.beneficiary_id`
- `beneficiary_assignments.assigned_user_id`
- `beneficiary_assignments.status`
- `beneficiary_followup_status.beneficiary_id`
- `beneficiary_followup_status.status`
- `followup_events.beneficiary_id`
- `followup_events.occurred_at`
- `call_interactions.beneficiary_id`
- `call_interactions.call_date`

### Criterio de escalabilidad

Si el módulo pasa de uso operativo puntual a consumo ejecutivo frecuente, convendrá evolucionar desde queries lógicas directas a una capa analítica más estable, pero manteniendo intacta la regla central: el estado se lee desde backend, no se recalcula fuera de su fuente canónica.

---

## 10. Resultado esperado

Este diseño debe servir como contrato funcional para implementar más adelante las consultas del módulo de auditoría, asegurando consistencia con la lógica de negocio del sistema, claridad en la medición por teleoperadora y una base sólida para dashboard, ranking, reportes y PDF.
