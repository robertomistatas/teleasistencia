# Arquitectura PDF para Auditoría y Reportes Ejecutivos

## Objetivo

Definir la arquitectura recomendada para la generación de PDFs formales del módulo Auditoría y Reportes Ejecutivos, alineada al manual de marca Mistatas y preparada para una implementación posterior sin alterar la consistencia funcional del módulo actual.

Este documento no implementa PDF. Su propósito es dejar una guía técnica clara para la siguiente fase.

---

## 1. Motor PDF recomendado

### Recomendación principal

El motor recomendado es `@react-pdf/renderer`.

### Motivos de la recomendación

`@react-pdf/renderer` permite construir documentos estructurados como un informe real, con layout controlado, componentes reutilizables, estilos consistentes y salida estable para lectura en pantalla, descarga e impresión.

Es la opción más adecuada para este módulo porque:

- permite modelar el PDF como documento y no como captura visual de la UI
- facilita portadas, encabezados, pies de página, tablas y secciones repetibles
- reduce dependencia del viewport, zoom del navegador o tamaño de pantalla
- mejora la consistencia entre distintos entornos de generación
- favorece una evolución ordenada hacia plantillas múltiples por tipo de informe

### Lo que no se debe usar como estrategia principal

No se debe usar como fuente principal de generación PDF:

- screenshots del DOM
- `html2canvas`
- `print CSS`

### Por qué no usar esas alternativas

Estas alternativas convierten la UI web en una imagen o en una impresión del navegador, lo que introduce problemas estructurales:

- dependen del viewport y del estado visual del navegador
- degradan legibilidad en tablas extensas o informes de varias páginas
- dificultan branding institucional consistente
- generan documentos frágiles ante cambios del frontend
- producen una salida que se parece a una captura, no a un informe ejecutivo formal

La regla es simple: el PDF debe ser un documento estructurado, estable, formal e imprimible, no una fotografía del dashboard.

---

## 2. Principios de arquitectura

### Principio 1: el PDF no consulta Supabase directamente

La generación PDF no debe acceder a Supabase ni ejecutar consultas propias.

La razón es mantener una sola fuente de preparación de datos, evitar divergencias y asegurar que el contenido del PDF sea exactamente coherente con la lectura del módulo Auditoría.

### Principio 2: el PDF no recalcula métricas

El sistema PDF no debe recalcular KPIs, rankings, cobertura, riesgo ni estados.

Debe recibir datos ya consolidados desde la capa existente de auditoría.

### Principio 3: reutilización conceptual del módulo actual

La salida PDF debe reutilizar los mismos conceptos funcionales ya implementados:

- Resumen ejecutivo
- Teleoperadoras
- Riesgo
- Reportes preview

Esto evita dobles interpretaciones y mantiene continuidad entre la vista web y el informe descargable.

### Principio 4: reproducibilidad y consistencia

Si el mismo payload entra dos veces al generador, el resultado debe ser equivalente.

El PDF debe ser:

- reproducible
- consistente
- trazable
- desacoplado de condiciones visuales del navegador

### Principio 5: separación entre datos, plantilla y render

La arquitectura debe separar claramente:

- obtención y consolidación de datos
- definición del tipo de informe
- composición de secciones
- render final del documento

Esto permite incorporar más templates sin duplicar lógica.

---

## 3. Estructura propuesta de carpetas

La estructura recomendada es:

```text
src/features/auditoria/pdf/
├── components/
├── sections/
├── templates/
├── styles/
├── generators/
└── types/
```

### `components/`

Contendrá piezas visuales pequeñas y reutilizables del documento.

Ejemplos conceptuales:

- chips o badges de estado
- filas de metadata
- celdas y encabezados de tabla
- contenedores de bloques destacados

Responsabilidad:

- resolver unidades visuales simples
- evitar duplicación de primitives PDF
- encapsular reglas básicas de estilo y composición

### `sections/`

Contendrá bloques de documento de nivel medio, con significado editorial.

Ejemplos:

- portada
- resumen ejecutivo
- tablas de teleoperadoras
- bloque de conclusiones

Responsabilidad:

- representar secciones completas de informe
- recibir datos ya listos para mostrar
- mantener consistencia entre templates distintos

### `templates/`

Contendrá las plantillas completas por tipo de informe.

Responsabilidad:

- definir la estructura global del PDF
- decidir qué secciones aparecen y en qué orden
- componer header, footer, páginas y anexo según el tipo de reporte

### `styles/`

Contendrá tokens y utilidades visuales del PDF.

Responsabilidad:

- centralizar paleta, tipografías, espaciados, tamaños y estilos de tablas
- traducir el manual de marca a reglas reutilizables del documento PDF
- evitar estilos dispersos por template

### `generators/`

Contendrá el flujo de orquestación para producir el documento.

Responsabilidad:

- recibir payload consolidado
- seleccionar el template correcto
- aplicar metadata de generación
- preparar descarga, blob o flujo equivalente en fases futuras

Esta carpeta no debe conocer Supabase ni lógica de negocio compleja.

### `types/`

Contendrá contratos formales del sistema PDF cuando llegue la implementación.

Responsabilidad:

- definir payloads
- definir tipos de metadata
- definir variantes de template
- formalizar el contrato entre capa de auditoría y capa PDF

En esta fase el contrato se describe conceptualmente, sin crear TypeScript todavía.

---

## 4. Templates iniciales

Los templates recomendados son:

- `ExecutiveAuditReportPdf`
- `TeleoperatorAuditReportPdf`
- `RiskAuditReportPdf`
- `DataQualityAuditReportPdf`
- `AmaiaCallAuditReportPdf`
- `ManualFollowupAuditReportPdf`

### Orden recomendado de implementación

La primera implementación debe ser:

- `ExecutiveAuditReportPdf`

### Motivo

Es el template con mayor valor transversal porque resume el estado general del módulo y reutiliza elementos de Resumen ejecutivo, Teleoperadoras y Riesgo.

Además, permite validar primero:

- branding
- estructura de páginas
- metadata de informe
- KPI grid
- tablas formales
- conclusiones y alertas

Una vez consolidado ese template, los demás pueden derivar de los mismos bloques base con menor riesgo de retrabajo.

---

## 5. Secciones reutilizables

Las secciones recomendadas para componer los informes son:

- `CoverPage`
- `ReportMetadata`
- `ExecutiveSummary`
- `KpiGrid`
- `TeleoperatorRankingTable`
- `RiskSummaryTable`
- `ConclusionsAndAlerts`
- `Appendix`
- `Header`
- `Footer`

### `CoverPage`

Responsabilidad:

- abrir el informe con presentación institucional
- mostrar identidad Mistatas, título, subtítulo y contexto del reporte

### `ReportMetadata`

Responsabilidad:

- mostrar rango de fechas
- fecha de generación
- usuario que genera
- tipo de informe
- filtros aplicados visibles

### `ExecutiveSummary`

Responsabilidad:

- condensar la lectura ejecutiva central
- introducir el informe con un resumen narrativo breve

### `KpiGrid`

Responsabilidad:

- mostrar KPI principal y secundarios en formato formal
- mantener comparabilidad entre templates

### `TeleoperatorRankingTable`

Responsabilidad:

- mostrar cumplimiento de cartera asignada
- presentar tabla formal legible y consistente para impresión

### `RiskSummaryTable`

Responsabilidad:

- mostrar beneficiarios críticos, concentración de riesgo o agrupaciones relevantes
- sostener la lectura operacional sin copiar el dashboard web

### `ConclusionsAndAlerts`

Responsabilidad:

- cerrar el informe con hallazgos, alertas y acciones sugeridas
- sintetizar la interpretación ejecutiva del contenido

### `Appendix`

Responsabilidad:

- contener detalle ampliado cuando el tipo de informe lo requiera
- hospedar tablas extendidas o notas metodológicas

### `Header`

Responsabilidad:

- reforzar navegación documental y consistencia institucional por página

### `Footer`

Responsabilidad:

- mostrar numeración, marca y referencias mínimas del informe

---

## 6. Branding Mistatas

La referencia de marca debe salir del archivo:

- `media/manualdemarca.pdf`

El logo institucional disponible es:

- `media/logo.png`

### Tokens visuales

#### Colores

- Celeste: `#33A6FA`
- Lila: `#8752E8`
- Rosa: `#E547C9`
- Gris: `#666666`
- Blanco: `#FFFFFF`

### Uso recomendado de color

- usar celeste como acento principal institucional
- usar lila y rosa solo como acentos secundarios o destacados controlados
- usar gris para texto secundario y metadata
- usar blanco como base dominante del documento

El color no debe saturar el PDF. Debe guiar prioridades y reforzar jerarquía, no competir con el contenido.

#### Tipografías

- Orbitron: títulos, destacados, badges, metadata
- DM Sans: cuerpo, tablas, descripciones, notas

### Regla de jerarquía tipográfica

- Orbitron para momentos de identidad, portada, títulos y elementos destacados
- DM Sans para lectura prolongada, tablas y texto funcional

Esto permite mantener tono institucional sin sacrificar legibilidad.

#### Logo

Debe usarse `media/logo.png` respetando las reglas del manual de marca.

Reglas mínimas:

- respetar zona de exclusión
- no deformar
- no cambiar colores
- mantener legibilidad
- tamaño mínimo digital de referencia: 100px de ancho

### Tono editorial

El tono del informe debe ser:

- claro
- cercano
- profesional
- sin tecnicismos innecesarios
- con seguridad, sin alarmismo

La redacción debe sostener una lectura ejecutiva confiable, sin dramatizar ni usar jerga técnica innecesaria.

---

## 7. Layout PDF

La estructura formal recomendada es la siguiente.

### Portada

Debe incluir:

- logo Mistatas
- título del informe
- subtítulo
- rango de fechas
- fecha de generación
- usuario que genera
- tipo de informe

Objetivo:

- presentar el documento como informe institucional
- dejar claro alcance, contexto y autoría de generación

### Página de resumen

Debe incluir:

- KPI principal
- KPIs secundarios
- alertas principales

Objetivo:

- ofrecer una lectura ejecutiva rápida y priorizada

### Página de teleoperadoras

Debe incluir:

- tabla comparativa
- cobertura
- cartera
- pendientes
- urgentes
- sin datos

Objetivo:

- mostrar cumplimiento de cartera asignada en formato formal y comparable

### Página de riesgo

Debe incluir:

- beneficiarios críticos
- agrupaciones relevantes
- alertas

Objetivo:

- visibilizar focos de supervisión con una estructura clara y legible

### Página de conclusiones

Debe incluir:

- resumen ejecutivo
- hallazgos
- acciones sugeridas

Objetivo:

- cerrar el informe con interpretación y orientación operativa

### Anexo opcional

Debe incluir:

- detalle ampliado

Objetivo:

- dejar el cuerpo principal del informe limpio y ejecutivo
- llevar detalle extensivo a una zona secundaria

---

## 8. Reglas de diseño

El diseño del PDF debe seguir estas reglas:

- mucho espacio blanco
- jerarquía limpia
- tablas legibles
- evitar saturación
- usar color solo para acento y prioridad
- mantener look institucional
- priorizar impresión y lectura ejecutiva
- no replicar exactamente la UI web
- el PDF debe parecer informe formal, no captura de pantalla

### Implicancias prácticas

- no trasladar tarjetas, sombras o layouts web de forma literal
- simplificar composiciones para impresión
- evitar densidad excesiva de elementos por página
- priorizar consistencia entre páginas sobre efectos visuales
- mantener bloques respirados y títulos estables

---

## 9. Contrato de datos

Cada PDF debe recibir conceptualmente un objeto `AuditReportPayload`.

En esta fase no se define TypeScript todavía. Se describe solamente el contrato esperado.

### Estructura conceptual

#### `metadata`

Información general del documento.

Debe incluir conceptualmente:

- título del informe
- subtítulo
- fecha de generación
- versión de template
- branding aplicado

#### `executiveSummary`

Resumen de lectura ejecutiva del estado actual.

Debe incluir conceptualmente:

- KPI principal
- KPIs secundarios
- alertas principales
- síntesis narrativa del informe

#### `teleoperatorMetrics`

Bloque de cumplimiento de cartera asignada.

Debe incluir conceptualmente:

- ranking por teleoperadora
- cobertura
- cartera
- pendientes
- urgentes
- sin datos

#### `riskSummary`

Bloque de criticidad operacional.

Debe incluir conceptualmente:

- beneficiarios críticos
- agrupaciones por teleoperadora
- agrupaciones por comuna
- alertas y hallazgos principales

#### `reportType`

Tipo de informe a renderizar.

Debe permitir seleccionar template y secciones activas.

#### `filters`

Resumen explícito de filtros aplicados.

Debe incluir conceptualmente:

- rango seleccionado
- filtros complementarios visibles
- alcance del informe

#### `generatedBy`

Información del usuario que genera el informe.

Debe incluir conceptualmente:

- nombre visible
- email
- rol

### Regla clave del contrato

El payload debe salir de la capa de auditoría existente, ya consolidado, sin cálculos extra dentro del generador PDF.

---

## 10. Futuro

La arquitectura debe quedar preparada conceptualmente para evolucionar hacia:

- descarga directa
- envío por email
- almacenamiento histórico
- reportes programados
- informes municipales
- exportación por cliente/periodo

### Implicancia arquitectónica

Para soportar estas evoluciones, conviene mantener desacoplados:

- template
- payload
- generador
- canal de entrega

Así, el mismo documento podría más adelante:

- descargarse desde la UI
- adjuntarse a un correo
- almacenarse como histórico
- producirse automáticamente por agenda

sin reescribir la composición principal del PDF.

---

## 11. Alcance excluido

Queda explícitamente fuera de esta fase:

- implementar PDF ahora
- instalar dependencias
- escribir componentes
- modificar UI
- crear backend

También queda fuera:

- consultas nuevas a Supabase desde la capa PDF
- recalcular métricas dentro del documento
- replicar visualmente el dashboard web como si fuera plantilla final

---

## Flujo recomendado de implementación futura

Cuando se inicie la siguiente fase, el flujo recomendado es:

1. formalizar `AuditReportPayload` en tipos
2. implementar tokens de estilo y branding PDF
3. construir `CoverPage`, `Header`, `Footer` y `KpiGrid`
4. implementar `ExecutiveAuditReportPdf`
5. validar salida visual e impresión
6. recién después extender a templates específicos

Este orden reduce riesgo, valida primero la base documental y evita dispersión temprana entre múltiples informes.

---

## Decisión arquitectónica final

La generación PDF de Auditoría debe construirse como una capa documental separada, basada en `@react-pdf/renderer`, alimentada por datos consolidados del módulo existente y diseñada bajo reglas de branding Mistatas.

El PDF no debe depender del DOM, del viewport ni de screenshots. Debe comportarse como un informe ejecutivo institucional, reproducible, formal y consistente con la lectura operativa ya implementada en Auditoría.