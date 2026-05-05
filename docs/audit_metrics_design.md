# Audit Metrics Design — Seguimientos Mistatas

## 1. Objetivo del módulo

El módulo de auditoría y métricas tiene como propósito medir el desempeño operacional de las teleoperadoras y controlar la cobertura real de seguimiento sobre la cartera asignada.

Este módulo debe permitir responder, de forma simple y ejecutiva, preguntas como:

- cuántos beneficiarios están efectivamente al día
- qué teleoperadoras mantienen mejor cobertura de seguimiento
- dónde se concentran los riesgos operacionales
- cómo evoluciona la cobertura en el tiempo
- cuánto del seguimiento proviene de gestión manual y cuánto de llamadas AMAIA

La intención no es reemplazar la lógica de negocio del backend, sino exponerla de forma auditable, comparable y útil para gestión operativa y toma de decisiones.

---

## 2. KPI principal

### % Cobertura

El KPI principal del módulo es el porcentaje de cobertura de seguimiento.

### Definición

Porcentaje de beneficiarios en estado al día sobre el total de la cartera evaluada.

### Fórmula conceptual

- cobertura = beneficiarios al día / total de beneficiarios en cartera

### Interpretación

- un valor alto indica cartera con seguimiento reciente y control operacional estable
- un valor bajo indica deterioro de cobertura y necesidad de priorización operativa

### Consideraciones

- el universo debe construirse desde la cartera activa evaluada en el período o corte correspondiente
- la fuente prioritaria del estado debe ser `beneficiary_followup_status`
- el KPI debe poder verse en modo global y por teleoperadora

---

## 3. Métricas por teleoperadora

Cada teleoperadora debe contar con un bloque de métricas operativas estandarizadas.

### Métricas base

- total_beneficiarios: total de beneficiarios activos asignados en su cartera
- contactados: total de beneficiarios en estado al día
- pendientes: total de beneficiarios en estado pendiente
- urgentes: total de beneficiarios en estado urgente
- sin datos: total de beneficiarios sin información suficiente para determinar cobertura

### Métricas derivadas

- cobertura (%): beneficiarios al día / total_beneficiarios
- tasa pendiente (%): beneficiarios pendientes / total_beneficiarios
- tasa urgente (%): beneficiarios urgentes / total_beneficiarios

### Métricas de actividad

- total seguimientos manuales: cantidad de registros manuales en `followup_events` asociados a beneficiarios de su cartera
- total llamadas AMAIA: cantidad de `call_interactions` asociadas a beneficiarios de su cartera

### Lectura ejecutiva esperada

Estas métricas deben permitir identificar:

- volumen de cartera por teleoperadora
- cobertura efectiva de seguimiento
- acumulación de riesgo por atraso
- intensidad de gestión manual
- volumen de actividad telefónica registrada por AMAIA

### Restricción de interpretación

El total de llamadas AMAIA no debe interpretarse por sí solo como desempeño. El indicador principal de cumplimiento operacional sigue siendo la cobertura de seguimiento.

---

## 4. Definición de estados

La clasificación de estados debe respetar la lógica de negocio central del sistema.

### Estados

- al día: beneficiario con último contacto válido hace 15 días o menos
- pendiente: beneficiario con último contacto válido entre 16 y 30 días
- urgente: beneficiario con último contacto válido hace más de 30 días
- sin datos: no existe evidencia válida suficiente para calcular cobertura

### Observaciones

- estos estados son la base del KPI principal y de casi todas las métricas comparativas
- no deben redefinirse en frontend ni en reportes manuales
- cualquier visualización debe consumir el estado ya calculado por backend

---

## 5. Filtros

El módulo debe permitir distintos niveles de análisis sin alterar la lógica de fondo.

### Filtros obligatorios

- rango de fechas
- teleoperadora
- global

### Uso esperado de cada filtro

#### Rango de fechas

Permite analizar un período específico para métricas de actividad, evolución y comparación temporal.

#### Teleoperadora

Permite aislar el desempeño de una persona específica y revisar su cartera, cobertura y actividad.

#### Global

Permite observar el estado consolidado de toda la operación para seguimiento ejecutivo y comparación entre equipos.

### Consideraciones funcionales

- el filtro global no reemplaza la comparación por teleoperadora; debe convivir con ella
- el rango de fechas debe impactar principalmente actividad y evolución temporal
- el estado actual de cartera debe seguir priorizando el cálculo canónico de backend

---

## 6. Comparaciones

El módulo debe incluir comparaciones que permitan lectura ejecutiva rápida y análisis operacional.

### Ranking de teleoperadoras

Debe ordenar a las teleoperadoras según indicadores de cobertura y riesgo.

#### Variables mínimas del ranking

- cobertura (%)
- total_beneficiarios
- pendientes
- urgentes
- sin datos
- total seguimientos manuales
- total llamadas AMAIA

#### Objetivo del ranking

- identificar mejor y peor cobertura relativa
- detectar carteras con acumulación de urgentes
- facilitar seguimiento de desempeño por persona

### Evolución temporal

Debe mostrar cómo cambian las métricas a lo largo del tiempo.

#### Dimensiones mínimas

- evolución de cobertura
- evolución de pendientes
- evolución de urgentes
- evolución de seguimientos manuales
- evolución de llamadas AMAIA

#### Objetivo de la evolución temporal

- detectar mejoras o deterioros sostenidos
- medir efecto de intervenciones operativas
- evidenciar estabilidad o volatilidad del seguimiento

---

## 7. Estructura de informe PDF

El módulo debe poder alimentar un informe PDF claro, ejecutivo y reutilizable.

### Secciones obligatorias

#### Portada

Debe incluir:

- nombre del informe
- rango de fechas analizado
- fecha de generación
- autor o usuario generador
- contexto organizacional Mistatas

#### KPI principal

Debe destacar visualmente:

- cobertura global (%)
- lectura breve del resultado
- variación o contexto si aplica

#### Tabla resumen

Debe consolidar por teleoperadora:

- total_beneficiarios
- contactados
- pendientes
- urgentes
- sin datos
- cobertura (%)
- tasa pendiente (%)
- tasa urgente (%)
- total seguimientos manuales
- total llamadas AMAIA

#### Ranking

Debe mostrar orden comparativo entre teleoperadoras, priorizando cobertura y riesgo.

#### Riesgos

Debe resumir:

- teleoperadoras con mayor tasa urgente
- carteras con más beneficiarios sin datos
- tendencias negativas de cobertura
- señales de saturación o rezago operacional

#### Conclusiones

Debe cerrar con una lectura ejecutiva breve sobre:

- estado general de la operación
- principales focos de riesgo
- acciones sugeridas o prioridades operativas

---

## 8. Reglas de negocio

El módulo debe respetar las reglas de negocio canónicas del sistema.

### Regla de contacto válido

Se considera contacto válido cuando existe al menos una de estas condiciones:

- `followup_event` válido
- llamada AMAIA con duración mayor o igual a 10 segundos

### Regla de prioridad de fuente

La fuente prioritaria para estado de seguimiento debe ser:

- backend, a través de `beneficiary_followup_status`

### Implicancias

- el frontend no debe recalcular los estados para auditoría como fuente principal
- cualquier fallback visual debe considerarse secundario y no base del módulo de auditoría
- las métricas ejecutivas deben construirse sobre el estado ya resuelto por backend

---

## 9. Dependencias

El módulo depende de las siguientes estructuras de datos:

- `beneficiary_assignments`
- `beneficiary_followup_status`
- `followup_events`
- `call_interactions`

### Rol de cada dependencia

#### beneficiary_assignments

Define la cartera activa y la relación entre beneficiarios y teleoperadoras.

#### beneficiary_followup_status

Es la fuente principal del estado de cobertura de cada beneficiario.

#### followup_events

Aporta evidencia de gestiones manuales y actividad operativa registrada por usuarios.

#### call_interactions

Aporta evidencia de actividad telefónica y contactos válidos provenientes de AMAIA.

---

## 10. Criterios de diseño del módulo

Para que el módulo sea útil a nivel operativo y ejecutivo, debe cumplir estos criterios:

- claridad: lectura rápida de cobertura, riesgo y desempeño
- trazabilidad: consistencia con el estado calculado por backend
- comparabilidad: mismas métricas para todas las teleoperadoras
- auditabilidad: capacidad de revisar resultados por período y fuente
- foco operacional: priorizar cobertura y riesgo por sobre métricas de volumen aisladas

---

## 11. Resultado esperado

El módulo de auditoría y métricas debe transformarse en la vista principal para supervisión operativa, permitiendo medir cobertura, comparar desempeño entre teleoperadoras, detectar riesgo de atraso y generar informes ejecutivos consistentes con la lógica canónica del backend.
