# Audit Implementation Checklist

## Fase 1 — Base del módulo

### Objetivo

Crear navegación, pantalla base, layout, tabs y filtros globales.

### Checklist

- agregar ruta protegida para admin y super_admin
- agregar item de navegación `Auditoría y reportes`
- crear pantalla base del módulo
- crear tabs:
  - Resumen ejecutivo
  - Teleoperadoras
  - Riesgo
  - Reportes
- crear selector de rango de fechas
- crear estado local de filtros
- definir layout con resumen arriba y detalle abajo
- dejar preparada la estructura del módulo sin implementar PDF aún

### Validaciones

- typecheck
- lint
- build
- verificar acceso solo para admin y super_admin
- verificar que teleoperadora no vea el módulo

---

## Fase 2 — Resumen ejecutivo

### Objetivo

Mostrar KPIs globales.

### Checklist

- mostrar cobertura global
- mostrar total beneficiarios activos
- mostrar beneficiarios al día
- mostrar beneficiarios pendientes
- mostrar beneficiarios urgentes
- mostrar beneficiarios sin datos
- mostrar contactos válidos en rango
- mostrar llamadas AMAIA en rango
- mostrar gestiones manuales en rango
- mostrar mini ranking de teleoperadoras
- mostrar alertas principales
- diseñar estados vacíos
- diseñar estados de carga y error

### Validaciones

- verificar consistencia de KPIs con datos backend
- verificar lectura clara del KPI principal
- verificar que el resumen no exponga lenguaje técnico
- validar typecheck
- validar lint
- validar build

---

## Fase 3 — Métricas por teleoperadora

### Objetivo

Comparar cumplimiento de cartera asignada.

### Checklist

- crear tabla por teleoperadora
- mostrar total cartera
- mostrar contactados
- mostrar pendientes
- mostrar urgentes
- mostrar sin datos
- mostrar cobertura %
- mostrar gestiones manuales
- mostrar contactos válidos AMAIA
- mostrar métrica de 1 solo contacto
- mostrar métrica de sin contactar
- permitir orden por riesgo
- permitir orden por cobertura
- crear detalle expandible por teleoperadora
- mostrar composición de cartera en el detalle
- mostrar diferencias entre gestiones manuales y contactos válidos AMAIA

### Regla crítica

- no mostrar `llamadas hechas por teleoperadora`
- usar `cumplimiento de cartera asignada`

### Validaciones

- verificar que la tabla compare cobertura y no autoría de llamadas
- verificar ordenamiento correcto por riesgo y cobertura
- verificar que el detalle expandible no rompa la lectura ejecutiva
- validar typecheck
- validar lint
- validar build

---

## Fase 4 — Riesgo

### Objetivo

Identificar beneficiarios críticos.

### Checklist

- mostrar beneficiarios urgentes
- mostrar beneficiarios sin datos
- mostrar beneficiarios con más de 30 días sin contacto
- crear agrupación por teleoperadora
- crear agrupación por comuna
- mostrar acciones sugeridas
- habilitar acceso a ficha beneficiario
- priorizar orden visual de mayor riesgo a menor riesgo
- contemplar estados vacíos y ausencia de riesgo relevante

### Validaciones

- verificar que urgentes y sin datos estén claramente diferenciados
- verificar que la agrupación por teleoperadora sea consistente con cartera activa
- verificar que la agrupación por comuna sea comprensible para supervisión
- verificar acceso correcto a ficha beneficiario
- validar typecheck
- validar lint
- validar build

---

## Fase 5 — Reportes

### Objetivo

Preparar generación de informes.

### Checklist

- crear selector de tipo de informe
- crear filtros de rango
- crear filtros complementarios necesarios
- crear preview del informe
- definir estructura visual del informe
- preparar datos para PDF
- diseñar salida formal de reporte sin generarlo todavía si no está listo
- mostrar claramente el alcance del informe antes de generarlo

### Validaciones

- verificar que la preview represente el contenido esperado del informe
- verificar que filtros e informe estén alineados
- verificar consistencia entre módulo y preview
- validar typecheck
- validar lint
- validar build

---

## Fase 6 — PDF ejecutivo

### Objetivo

Generar descarga formal.

### Checklist

- aplicar branding Mistatas
- crear portada
- incluir rango de fechas
- incluir usuario que genera
- incluir KPIs principales
- incluir tablas resumen
- incluir ranking
- incluir riesgos
- incluir conclusiones y alertas
- habilitar descarga PDF
- verificar estructura formal y no tipo screenshot

### Validaciones

- verificar legibilidad del PDF
- verificar consistencia del contenido con filtros activos
- verificar branding y formato institucional
- verificar que el PDF sea un informe formal y no una captura del dashboard
- validar generación y descarga correcta

---

## Fase 7 — Pulido y validación

### Checklist

- revisar lenguaje no técnico
- revisar estados visuales correctos
- revisar rendimiento aceptable
- validar con datos reales
- realizar revisión ejecutiva
- realizar pruebas por rol
- revisar consistencia entre tabs
- revisar mensajes vacíos, errores y edge cases
- revisar que AMAIA y gestiones manuales estén diferenciados de forma clara

### Validaciones finales

- typecheck
- lint
- build
- validación visual integral
- validación funcional integral
- validación de permisos por rol

---

## Reglas globales

- `beneficiary_followup_status` es fuente de verdad
- no recalcular estados en UI
- diferenciar AMAIA versus gestiones manuales
- respetar RLS
- no exponer auditoría a teleoperadora
- priorizar lenguaje de cumplimiento de cartera por sobre lenguaje técnico
- no inferir autoría de llamada desde datos AMAIA

---

## Orden recomendado de implementación

1. Fase 1
2. Fase 2
3. Fase 3
4. Fase 4
5. Fase 5
6. Fase 6
7. Fase 7

---

## Resultado esperado

Al completar este checklist, el módulo de Auditoría y Reportes Ejecutivos debe quedar implementado como una experiencia usable por admin y super_admin, con lectura ejecutiva clara, profundidad operativa suficiente, consistencia con backend y capacidad de evolucionar hacia reporting formal sin ambigüedad funcional.
