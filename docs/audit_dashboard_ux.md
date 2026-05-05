# Audit Dashboard UX — Seguimientos Mistatas

## 1. Propósito del módulo

El módulo Auditoría y Reportes Ejecutivos tiene como propósito apoyar la auditoría operacional, entregar métricas claras a gerencia y CEO, y respaldar el cumplimiento real de seguimientos sobre la cartera asignada.

Este módulo no debe comportarse como una pantalla técnica de base de datos ni como una consola de operación diaria pura. Su valor está en combinar una lectura ejecutiva rápida con la capacidad de bajar al detalle operativo cuando se detectan riesgos, caídas de cobertura o diferencias relevantes entre teleoperadoras.

El objetivo UX central es responder tres preguntas sin fricción:

- cómo está la cobertura global de seguimiento hoy
- dónde están los principales riesgos operacionales
- qué teleoperadoras requieren revisión más profunda

---

## 2. Layout general

El módulo debe usar un layout claro, jerárquico y orientado a lectura rápida.

### Estructura general

#### Header del módulo

Debe incluir:

- título del módulo
- bajada breve explicando que se trata de auditoría operacional y reportes ejecutivos
- referencia clara a que el estado de seguimiento es consolidado desde backend

### Selector de rango de fechas

Debe ubicarse en la zona superior, visible desde cualquier tab del módulo.

Debe permitir:

- selección rápida de períodos comunes
- rango personalizado
- lectura inmediata del período activo

### Filtros globales

Deben ubicarse junto al selector de fechas o inmediatamente debajo del header.

Filtros esperados:

- teleoperadora
- vista global
- comuna, si la vista activa lo soporta
- tipo de análisis o tipo de informe, en la tab de reportes

### Tabs principales

La navegación interna del módulo debe usar tabs persistentes y fáciles de entender.

Tabs definidas:

- Resumen ejecutivo
- Teleoperadoras
- Riesgo
- Reportes

### Principio de jerarquía visual

La parte superior del módulo debe priorizar síntesis ejecutiva.

La parte inferior debe abrir espacio a:

- tablas
- ranking
- alertas
- bloques expandibles
- desagregación operativa

El diseño general debe seguir el criterio de resumen arriba y detalle abajo.

---

## 3. Tabs del módulo

## 3.1 Resumen ejecutivo

### Objetivo UX

Entregar una vista inmediata del estado general de la operación sin exigir lectura técnica ni recorrido profundo.

Esta tab debe ser la puerta de entrada del módulo y la más orientada a gerencia o CEO.

### Bloques principales

#### KPI principal: cobertura global

Debe ubicarse en la posición más visible de la pantalla.

Debe mostrar:

- porcentaje de cobertura global
- breve interpretación textual
- señal visual de estado general

#### KPIs operativos principales

Debe incluir como tarjetas o bloque resumido:

- total beneficiarios activos
- beneficiarios al día
- pendientes
- urgentes
- sin datos
- contactos válidos en rango

### Alertas principales

Debe existir un bloque de alertas visibles que resuma riesgos operacionales.

Ejemplos de alertas que debe priorizar:

- aumento de urgentes
- aumento de beneficiarios sin datos
- caída de cobertura respecto del período anterior, si esa comparación está disponible
- concentración de riesgo en una o pocas teleoperadoras

### Mini ranking de teleoperadoras

Debe aparecer en la misma tab como resumen comparativo breve.

Debe mostrar al menos:

- nombre de teleoperadora
- cobertura
- urgentes
- señal de riesgo relativa

El mini ranking no reemplaza la tab dedicada de teleoperadoras. Solo sirve como entrada a análisis más profundo.

### Comportamiento esperado

Esta tab debe permitir que una persona no técnica entienda el estado general de la operación en pocos segundos.

No debe saturarse con tablas extensas, criterios complejos ni detalle de eventos individuales.

---

## 3.2 Teleoperadoras

### Objetivo UX

Permitir comparar el cumplimiento de cartera asignada entre teleoperadoras de forma clara, justa y útil para supervisión operacional.

### Regla de lenguaje

El lenguaje debe centrarse en cumplimiento de cartera asignada.

No debe usarse un framing como llamadas hechas por teleoperadora, porque AMAIA no identifica autor de llamada y esa lectura induciría conclusiones incorrectas.

### Tabla comparativa principal

Debe incluir por teleoperadora:

- cobertura %
- contactados
- 1 solo contacto
- sin contactar
- pendientes
- urgentes
- gestiones manuales
- contactos válidos AMAIA

### Sentido UX de cada indicador

- cobertura %: mide cumplimiento general de cartera
- contactados: beneficiarios al día
- 1 solo contacto: señal operativa de seguimiento frágil o de cobertura mínima
- sin contactar: universo más expuesto dentro de la cartera
- pendientes: casos con deterioro moderado
- urgentes: casos con mayor riesgo
- gestiones manuales: intensidad de registro manual
- contactos válidos AMAIA: actividad útil detectada desde llamadas

### Ordenamiento

La tabla debe permitir ordenar al menos por:

- mayor riesgo
- menor cobertura
- mayor cantidad de urgentes
- mayor cantidad de sin contactar
- tamaño de cartera

### Detalle expandible por teleoperadora

Cada fila debe poder expandirse para mostrar un resumen más operativo.

Contenido recomendado del detalle expandible:

- composición de cartera
- tendencia reciente de cobertura
- distribución de estados
- beneficiarios urgentes más críticos
- diferencia entre gestiones manuales y contactos válidos AMAIA
- alertas puntuales de esa cartera

### Lectura esperada

Esta tab debe ayudar a supervisión y jefatura a identificar:

- quién tiene mejor cumplimiento relativo
- dónde se acumula mayor riesgo
- qué carteras muestran rezago
- qué teleoperadoras requieren seguimiento o apoyo

---

## 3.3 Riesgo

### Objetivo UX

Concentrar los casos que requieren atención inmediata o revisión prioritaria.

### Bloques obligatorios

#### Beneficiarios urgentes

Debe mostrar el subconjunto de mayor prioridad operacional.

#### Beneficiarios sin datos

Debe destacar beneficiarios sin evidencia suficiente para determinar estado de seguimiento.

#### Beneficiarios con más de 30 días sin contacto

Debe explicitar de forma visible este grupo, incluso si coincide con urgentes, porque es una lectura crítica para supervisión.

### Agrupaciones requeridas

#### Agrupación por teleoperadora

Debe permitir ver qué carteras concentran más riesgo.

#### Agrupación por comuna

Debe permitir detectar acumulación territorial de casos críticos.

### Acciones sugeridas

La tab debe incluir un bloque de acciones sugeridas con lenguaje simple.

Ejemplos:

- priorizar revisión de cartera con más urgentes
- revisar beneficiarios sin datos persistentes
- reforzar seguimiento en comunas con mayor deterioro
- auditar casos ambiguos o no identificados si impactan cobertura

### Principio UX

La tab de riesgo debe facilitar priorización. No debe ser una lista neutra ni meramente descriptiva.

Debe orientar la toma de decisiones y ayudar a contestar qué revisar primero.

---

## 3.4 Reportes

### Objetivo UX

Permitir generar informes formales y ejecutivos a partir del mismo módulo, sin depender de capturas manuales del dashboard.

### Componentes obligatorios

#### Selector de tipo de informe

Debe ofrecer opciones comprensibles para negocio.

Ejemplos:

- informe ejecutivo global
- informe por teleoperadora
- informe de riesgo
- informe comparativo de período

#### Rango de fechas

Debe ser visible y editable desde esta tab.

#### Filtros

Debe permitir ajustar:

- teleoperadora
- global
- comuna, si aplica
- foco del informe

#### Preview

Debe existir una vista previa estructural del informe antes de generarlo.

La preview no necesita replicar el PDF final al detalle, pero sí anticipar:

- secciones incluidas
- KPIs principales
- tablas incluidas
- alcance del informe

#### Generación PDF

Debe existir una acción clara y principal para generar el PDF.

#### Descarga

Debe existir una acción posterior de descarga visible y consistente.

### Principio UX

Esta tab debe sentirse como una herramienta de generación de informe formal, no como una extensión improvisada del dashboard visual.

---

## 4. PDF ejecutivo formal

El PDF debe ser un informe formal y no una captura de pantalla del dashboard.

Su diseño debe priorizar lectura institucional, claridad narrativa y utilidad ejecutiva.

### Contenido obligatorio

#### Portada con branding Mistatas

Debe incluir:

- branding Mistatas
- logo
- título del informe
- rango de fechas
- fecha de generación
- usuario que genera

#### KPIs principales

Debe resumir los indicadores más importantes del período o corte seleccionado.

#### Resumen ejecutivo

Debe contener una lectura breve y clara del estado general de la operación.

#### Tablas

Debe incluir tablas consolidadas y fáciles de leer.

#### Ranking

Debe mostrar la comparación principal entre teleoperadoras.

#### Riesgos

Debe resumir riesgos críticos, focos de deterioro y acumulaciones relevantes.

#### Conclusiones y alertas

Debe cerrar con interpretación breve, accionable y no técnica.

#### Anexo opcional

Debe existir la posibilidad de agregar anexos más detallados cuando se requiera profundidad adicional.

### Criterio de tono

El PDF debe sentirse institucional, claro y apto para revisión por dirección, jefatura o auditoría.

No debe verse como export de una tabla cruda ni como screenshot de UI.

---

## 5. Estados visuales

El módulo debe usar una codificación visual simple, consistente y estable.

### Colores de estado

- verde: al día
- amarillo: pendiente
- rojo: urgente
- gris: sin datos

### Regla de uso

Estos colores deben repetirse de manera consistente en:

- tarjetas KPI
- badges
- ranking
- tablas
- alertas
- preview de reportes

### Criterio de claridad

El color debe reforzar la lectura, pero nunca ser la única señal. Cada estado debe acompañarse de texto explícito.

---

## 6. Reglas UX

### No saturar al CEO con detalle técnico

La primera lectura debe ser ejecutiva, breve y clara.

### Permitir bajar al detalle operativo

El módulo debe ofrecer caminos claros para profundizar cuando un indicador o alerta lo justifique.

### Usar lenguaje no técnico

Evitar nombres de tablas, enums o términos internos de implementación.

### Diferenciar datos AMAIA vs gestiones manuales

La UI debe dejar claro qué parte de la evidencia viene de gestión manual y cuál proviene de llamadas AMAIA.

### Indicar llamadas no identificadas o ambiguas

Cuando ese dato exista y sea relevante, debe mostrarse como señal de calidad o limitación de cobertura, no como ruido técnico.

### Mantener coherencia con backend

El módulo debe comunicar que el estado viene consolidado desde backend y no desde interpretación local de la UI.

### Evitar confusión entre volumen y cumplimiento

Más actividad no significa necesariamente mejor desempeño. La cobertura de cartera debe seguir siendo el indicador principal.

---

## 7. Relación entre resumen ejecutivo y detalle operativo

La experiencia del módulo debe seguir una progresión clara:

1. primero mostrar estado general
2. luego permitir comparar desempeño
3. después exponer riesgo puntual
4. finalmente habilitar salida formal en PDF

Este orden ayuda a mantener foco ejecutivo sin perder capacidad de auditoría.

### Lectura recomendada del módulo

- arriba: KPIs, alertas, síntesis y ranking corto
- abajo: tablas comparativas, agrupaciones, beneficiarios críticos y detalle expandible

### Resultado UX esperado

Una persona ejecutiva puede quedarse con la capa superior.

Una persona de supervisión puede profundizar hasta identificar carteras, comunas o beneficiarios que requieren intervención.

---

## 8. Alcance excluido

Este documento no define:

- código
- implementación de PDF en esta etapa
- queries SQL ejecutables
- componentes React

Tampoco define decisiones visuales de bajo nivel como sistema de diseño final, espaciados exactos, nombres de componentes o librerías de gráficos.

---

## 9. Resultado esperado

El módulo Auditoría y Reportes Ejecutivos debe ofrecer una experiencia clara, ejecutiva y operacional a la vez: suficiente síntesis para gerencia y CEO, suficiente profundidad para auditoría y supervisión, y una salida formal en PDF coherente con el estándar institucional de Mistatas.
