# Audit Master Brief — Seguimientos Mistatas

## 1. Objetivo del módulo

El módulo de Auditoría y Reportes Ejecutivos existe para medir el cumplimiento real de seguimiento sobre la cartera asignada, apoyar la supervisión operacional y entregar una lectura clara a gerencia y CEO sobre el estado de la operación.

Desde negocio, su propósito es responder de forma confiable y rápida:

- cuál es la cobertura real de seguimiento
- dónde están los principales riesgos operacionales
- qué teleoperadoras requieren revisión o apoyo
- cómo evoluciona la operación en el tiempo

Dentro del sistema Mistatas, este módulo cumple un rol transversal. No reemplaza la operación diaria de teleoperadoras ni redefine la lógica de negocio del backend. Su función es consolidar, exponer y ordenar la información para auditoría, gestión y reporting ejecutivo.

---

## 2. KPI principal

### Definición

El KPI principal del módulo es el porcentaje de cobertura de seguimiento.

Representa el porcentaje de beneficiarios en estado al día sobre el total de la cartera evaluada.

### Fórmula

- cobertura (%) = beneficiarios al día / total de beneficiarios en cartera

### Interpretación

- un valor alto indica una cartera con seguimiento reciente y control operacional estable
- un valor bajo indica deterioro de cobertura y necesidad de priorización operativa
- este KPI debe poder leerse a nivel global y por teleoperadora

### Consideración clave

La cobertura debe construirse usando el estado consolidado del backend, no reinterpretando eventos desde frontend ni desde reportes manuales.

---

## 3. Modelo de datos utilizado

El módulo se apoya en un conjunto acotado de tablas que cumplen funciones distintas dentro del análisis.

### Tablas involucradas

- `beneficiary_assignments`
- `beneficiary_followup_status`
- `followup_events`
- `call_interactions`
- `beneficiaries`
- `profiles`, cuando se necesite identificar teleoperadora o usuario generador del informe

### Rol de cada tabla

#### beneficiary_assignments

Define la cartera activa y la relación entre beneficiarios y teleoperadoras.

Es la base para saber qué beneficiarios pertenecen a cada cartera y, por lo tanto, sobre qué universo se mide cobertura, riesgo y cumplimiento.

#### beneficiary_followup_status

Es la fuente de verdad del estado de seguimiento.

Desde esta tabla debe salir el estado consolidado de cada beneficiario, incluyendo el corte principal de cobertura y la clasificación en al día, pendiente, urgente o sin datos.

#### followup_events

Aporta evidencia de gestión manual registrada en el sistema.

Se usa para métricas de actividad, trazabilidad y auditoría operativa, pero no debe convertirse en la fuente principal del estado si `beneficiary_followup_status` ya lo resuelve.

#### call_interactions

Aporta evidencia de actividad telefónica proveniente de AMAIA.

Se usa para auditoría de contactos válidos y volumen de actividad telefónica, con la limitación de que no identifica teleoperadora autora de la llamada.

#### beneficiaries

Permite enriquecer análisis de riesgo, tablas de detalle y anexos de informe con identidad y contexto del beneficiario.

#### profiles

Permite mostrar la identidad de teleoperadoras o usuarios relevantes en tablas comparativas, filtros e informes.

### Regla principal del modelo

`beneficiary_followup_status` es la fuente canónica del estado de seguimiento. El módulo no debe recalcular estados por su cuenta.

---

## 4. Reglas de negocio

### Definición de contacto válido

Se considera contacto válido cuando existe al menos una de estas condiciones:

- un `followup_event` válido
- una llamada AMAIA con duración mayor o igual a 10 segundos y clasificada como válida según la lógica canónica del backend

### Definición de estados

- al día: último contacto válido hace 15 días o menos
- pendiente: último contacto válido entre 16 y 30 días
- urgente: último contacto válido hace más de 30 días
- sin datos: no existe evidencia válida suficiente para calcular cobertura

### Prioridad de fuentes

La prioridad de fuentes para el estado es:

1. `beneficiary_followup_status`
2. `followup_events` y `call_interactions` solo como respaldo analítico o actividad, no como reemplazo del estado oficial

### Relación entre followup_events y AMAIA

- `followup_events` representa gestiones manuales o eventos de seguimiento registrados por usuarios
- `call_interactions` representa actividad telefónica importada desde AMAIA
- ambos aportan evidencia de actividad, pero la clasificación final del estado debe salir del backend consolidado

### Limitaciones de AMAIA

AMAIA no identifica teleoperadora autora de la llamada.

Por eso:

- no debe mostrarse una métrica interpretada como llamadas hechas por teleoperadora
- sí puede mostrarse actividad AMAIA asociada a beneficiarios de una cartera
- el lenguaje correcto debe centrarse en cumplimiento de cartera asignada, no en autoría de llamadas

---

## 5. Métricas calculadas

El módulo debe trabajar con un set claro de métricas ejecutivas y operativas.

### Métricas de cobertura

- `total_beneficiarios`: total de beneficiarios activos en cartera
  Unidad: número
- `contactados`: beneficiarios al día
  Unidad: número
- `pendientes`: beneficiarios en estado pendiente
  Unidad: número
- `urgentes`: beneficiarios en estado urgente
  Unidad: número
- `sin_datos`: beneficiarios sin información suficiente o sin estado utilizable
  Unidad: número
- `cobertura_pct`: beneficiarios al día sobre el total de cartera
  Unidad: porcentaje
- `tasa_pendiente_pct`: beneficiarios pendientes sobre el total de cartera
  Unidad: porcentaje
- `tasa_urgente_pct`: beneficiarios urgentes sobre el total de cartera
  Unidad: porcentaje

### Métricas de actividad

- `total_seguimientos_manuales`: cantidad de registros manuales en `followup_events`
  Unidad: número
- `total_llamadas_amaia`: cantidad de `call_interactions` asociadas a la cartera analizada
  Unidad: número
- `contactos_validos_amaia`: llamadas válidas AMAIA que cumplen criterio de contacto válido
  Unidad: número
- `contactos_validos_en_rango`: evidencia válida de contacto registrada en el período seleccionado
  Unidad: número

### Métricas comparativas por teleoperadora

- cobertura %
  Unidad: porcentaje
- contactados
  Unidad: número
- 1 solo contacto
  Unidad: número
- sin contactar
  Unidad: número
- pendientes
  Unidad: número
- urgentes
  Unidad: número
- gestiones manuales
  Unidad: número
- contactos válidos AMAIA
  Unidad: número

### Métricas de riesgo

- beneficiarios urgentes
  Unidad: número
- beneficiarios sin datos
  Unidad: número
- beneficiarios con más de 30 días sin contacto
  Unidad: número
- distribución de riesgo por teleoperadora
  Unidad: número y porcentaje
- distribución de riesgo por comuna
  Unidad: número y porcentaje

### Regla de lectura

Las métricas de actividad no reemplazan las métricas de cumplimiento. El foco principal del módulo sigue siendo cobertura de cartera y riesgo operacional.

---

## 6. Queries lógicas

El módulo se apoya en tres vistas lógicas principales. Estas son definiciones funcionales, no SQL ejecutable.

### teleoperator_metrics

Vista lógica orientada a resumir la cobertura de cartera por teleoperadora.

Debe:

- partir desde `beneficiary_assignments`
- considerar asignaciones activas y vigentes
- unir el estado desde `beneficiary_followup_status`
- agrupar por teleoperadora
- calcular total de cartera, contactados, pendientes, urgentes, sin datos y tasas derivadas

Su propósito es alimentar:

- tabla comparativa de teleoperadoras
- ranking
- KPI por teleoperadora
- resumen ejecutivo consolidado

### teleoperator_activity

Vista lógica orientada a resumir actividad operacional asociada a la cartera de cada teleoperadora.

Debe:

- usar `followup_events` para actividad manual
- usar `call_interactions` para actividad AMAIA
- consolidar conteos por tipo cuando sea útil
- permitir filtro por rango de fechas
- separar claramente gestiones manuales de actividad AMAIA

Su propósito es alimentar:

- indicadores complementarios de intensidad operativa
- comparación de actividad por cartera
- soporte analítico para reportes y detalle expandible

### risk_beneficiaries

Vista lógica orientada a identificar beneficiarios que requieren priorización.

Debe:

- usar `beneficiary_followup_status` como base del riesgo
- enriquecer con beneficiario y teleoperadora desde asignaciones
- priorizar urgentes y sin datos
- permitir agrupación por teleoperadora y por comuna
- facilitar lectura de días sin contacto y último contacto válido

Su propósito es alimentar:

- tab de Riesgo
- alertas principales
- anexos de informe
- tablas de beneficiarios críticos

### Regla transversal

Las tres vistas deben respetar el mismo principio: usar `beneficiary_followup_status` como estado oficial y no recalcular estados localmente.

---

## 7. Diseño UX

### Layout

El módulo debe usar un diseño con resumen ejecutivo arriba y detalle operativo abajo.

La parte superior debe incluir:

- header del módulo
- selector de rango de fechas
- filtros globales
- tabs principales

La parte inferior debe incluir:

- KPIs
- alertas
- ranking
- tablas comparativas
- bloques expandibles
- detalle operativo cuando corresponda

### Tabs

El módulo debe usar cuatro tabs principales:

- Resumen ejecutivo
- Teleoperadoras
- Riesgo
- Reportes

### Jerarquía visual

La experiencia debe priorizar síntesis al inicio y profundidad después.

#### Qué ve primero el CEO

- cobertura global
- total de beneficiarios activos
- beneficiarios al día, pendientes, urgentes y sin datos
- alertas principales
- mini ranking de teleoperadoras

#### Qué ve después el admin o supervisor

- comparación detallada entre teleoperadoras
- distribución de riesgo
- agrupaciones por comuna
- beneficiarios urgentes y sin datos
- actividad manual versus actividad AMAIA
- posibilidad de generar informe formal

### Principio UX central

La interfaz debe ser entendible para dirección, pero permitir bajar al detalle operativo sin cambiar de módulo ni entrar en lenguaje técnico.

---

## 8. Flujo de usuario

El flujo esperado dentro del módulo debe ser simple y consistente.

### Paso 1: entrar al módulo

El usuario accede a Auditoría y Reportes Ejecutivos y aterriza en la tab de Resumen ejecutivo.

### Paso 2: seleccionar rango

El usuario define el período de análisis usando el selector superior.

Puede también aplicar filtros globales, como teleoperadora o vista global.

### Paso 3: interpretar KPI

La UI presenta primero el KPI principal de cobertura y el estado general de la operación.

El usuario debe poder entender rápidamente si la operación está estable, en deterioro o concentrando riesgo.

### Paso 4: bajar a detalle

Desde el resumen, el usuario navega hacia:

- Teleoperadoras, para comparar cumplimiento de cartera
- Riesgo, para revisar beneficiarios críticos, agrupaciones y focos prioritarios

### Paso 5: generar informe

Cuando necesita salida formal, el usuario entra a Reportes, ajusta tipo de informe y filtros, revisa preview y genera el PDF.

### Resultado esperado del flujo

El recorrido completo debe permitir pasar de lectura ejecutiva a evidencia operativa y luego a salida formal sin ambigüedad ni pasos innecesarios.

---

## 9. Reporte PDF

El PDF debe ser un informe formal, no una captura del dashboard.

### Estructura completa

#### Portada

Propósito:

- entregar contexto institucional y trazabilidad del informe

Contenido:

- branding Mistatas
- logo
- título del informe
- rango de fechas
- fecha de generación
- usuario que genera

#### KPI principal

Propósito:

- destacar la lectura ejecutiva central del período o corte evaluado

Contenido:

- cobertura global
- principales cifras resumidas
- señal general de estado

#### Resumen ejecutivo

Propósito:

- ofrecer una interpretación breve para dirección o gerencia

Contenido:

- lectura sintética del estado general
- principales avances, deterioros o alertas

#### Tablas

Propósito:

- respaldar el informe con datos comparables y claros

Contenido:

- tabla resumen por teleoperadora
- métricas principales por cartera

#### Ranking

Propósito:

- comparar desempeño relativo entre teleoperadoras

Contenido:

- cobertura
- urgentes
- pendientes
- indicadores complementarios relevantes

#### Riesgos

Propósito:

- exponer focos críticos que requieren atención prioritaria

Contenido:

- teleoperadoras con mayor riesgo
- beneficiarios urgentes
- beneficiarios sin datos
- concentración territorial si aplica

#### Conclusiones y alertas

Propósito:

- cerrar el documento con interpretación accionable y no técnica

Contenido:

- hallazgos principales
- alertas relevantes
- prioridades de seguimiento sugeridas

#### Anexo opcional

Propósito:

- agregar detalle adicional cuando se requiera profundidad o trazabilidad extendida

Contenido posible:

- listados de beneficiarios críticos
- detalle ampliado por teleoperadora
- observaciones metodológicas

---

## 10. Reglas UX clave

### Lenguaje no técnico

La interfaz y los informes deben evitar nombres de tablas, enums o expresiones internas de implementación.

### Diferencia entre seguimiento y llamadas

Debe quedar explícito que:

- seguimiento manual es gestión registrada en el sistema
- llamadas AMAIA son actividad telefónica importada

Ambas son evidencias distintas y no deben presentarse como equivalentes perfectos.

### Evitar ambigüedad de datos AMAIA

Cuando existan llamadas no identificadas, ambiguas o sin autoría clara, eso debe comunicarse como limitación del dato y no ocultarse.

### Foco en cumplimiento de cartera

La comparación principal debe basarse en cumplimiento de cartera asignada, no en cantidad de llamadas ni en volumen de actividad aislado.

### No saturar a dirección con detalle técnico

La primera capa de lectura debe ser ejecutiva.

### Permitir detalle operativo

La segunda capa debe permitir profundizar cuando un KPI o alerta lo justifique.

---

## 11. Limitaciones del sistema

El diseño del módulo debe reconocer ciertas limitaciones estructurales del sistema y del origen de datos.

### Dependencia de Excel AMAIA

La calidad y completitud de parte de la actividad depende de archivos importados desde AMAIA.

### Falta de identificación de teleoperadora en llamadas

AMAIA no informa quién realizó la llamada.

Esto impide atribuir llamadas a una teleoperadora específica como autora de la gestión.

### Posibles datos incompletos

Pueden existir:

- beneficiarios sin datos suficientes
- llamadas ambiguas o sin match claro
- diferencias temporales entre actividad registrada y estado consolidado disponible

### Implicancia para UX y reporting

Estas limitaciones deben reflejarse con lenguaje claro, sin esconder incertidumbre y sin inducir interpretaciones incorrectas sobre desempeño.

---

## 12. Alcance de implementación

### Qué se construye ahora

En esta etapa se define la base completa para implementar el módulo de Auditoría y Reportes Ejecutivos:

- contrato funcional de métricas
- contrato lógico de queries
- diseño UX del dashboard
- estructura del informe PDF
- reglas de negocio y reglas UX clave

### Qué queda para futuro

Queda fuera del alcance inmediato:

- implementación concreta del PDF
- optimizaciones avanzadas de performance o materialización analítica
- refinamientos visuales de bajo nivel
- nuevas fuentes de datos no contempladas hoy
- ampliaciones más profundas de series históricas si requieren un modelo adicional

### Resultado esperado de esta etapa

El desarrollador debe poder implementar el módulo sin ambigüedad sobre:

- qué medir
- desde qué fuente medir
- cómo organizar la experiencia
- cómo interpretar limitaciones del dato
- cómo estructurar el informe formal

---

## 13. Cierre

Este documento maestro consolida la definición funcional, lógica y UX del módulo de Auditoría y Reportes Ejecutivos de Mistatas. Su propósito es servir como base directa de implementación, manteniendo coherencia con el backend, foco en cobertura de cartera y una experiencia adecuada tanto para supervisión operativa como para lectura ejecutiva.
