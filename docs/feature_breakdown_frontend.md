# Feature Breakdown Frontend v1 — Seguimientos Mistatas

## 1. Propósito

Este documento define los módulos, features y subfeatures del frontend de la app de Seguimientos Mistatas, basados en:

- arquitectura backend ya implementada
- roles operativos reales
- flujos definidos en frontend_role_flows.md
- necesidad crítica de auditoría y reporting ejecutivo

Este documento servirá como base para la implementación UI en React.

---

# 2. Módulos principales

## 2.1 CORE UI

### Objetivo
Base estructural del frontend.

### Features

#### Layout principal
- sidebar dinámico por rol
- header con usuario activo
- breadcrumb simple

#### Routing por rol
- rutas protegidas
- redirección según rol
- fallback de acceso

#### Auth guard
- validación de sesión
- recuperación de perfil desde Supabase
- control de permisos

---

## 2.2 ADMIN / SUPER ADMIN

### 2.2.1 Dashboard operativo

#### Features
- KPIs globales
- resumen de estados de seguimiento
- imports recientes
- accesos rápidos

#### Subfeatures
- tarjetas métricas
- gráficos básicos (opcional v1)
- alertas (urgentes / sin datos)

#### Dependencias
- beneficiary_followup_status
- beneficiary_import_runs
- call_import_runs

#### Prioridad
Alta

---

### 2.2.2 Beneficiarios

#### Features
- listado general
- búsqueda por nombre/RUT
- filtros por estado
- acceso a ficha

#### Subfeatures
- tabla con paginación
- badges de estado
- acciones rápidas

#### Dependencias
- beneficiaries
- beneficiary_contacts
- beneficiary_assignments
- beneficiary_followup_status

#### Prioridad
Alta

---

### 2.2.3 Ficha de beneficiario

#### Features
- vista detallada
- historial completo
- estado actual
- contactos

#### Subfeatures
- sección datos básicos
- teléfonos y red de apoyo
- historial de llamadas
- historial de seguimientos
- botón registrar gestión

#### Dependencias
- beneficiaries
- call_interactions
- followup_events

#### Prioridad
Alta

---

### 2.2.4 Imports

#### Submódulos

##### Importar beneficiarios
- upload archivo
- preview
- validación
- resultado por fila

##### Importar asignaciones
- selección teleoperadora
- upload archivo
- resumen de cambios

##### Importar llamadas AMAIA
- upload archivo
- análisis de match
- llamadas no identificadas

#### Dependencias
- *_import_runs
- *_import_rows

#### Prioridad
Alta

---

### 2.2.5 Interacciones telefónicas

#### Features
- exploración de llamadas
- filtros por match
- filtros por validez

#### Subfeatures
- tabla de llamadas
- filtros avanzados
- acceso a beneficiario

#### Dependencias
- call_interactions

#### Prioridad
Media

---

### 2.2.6 Seguimientos

#### Features
- exploración de eventos
- filtros por tipo
- confirmación AMAIA

#### Subfeatures
- listado de followup_events
- filtros por source
- visualización de notas

#### Dependencias
- followup_events

#### Prioridad
Media

---

## 2.3 TELEOPERADORA

### 2.3.1 Mi cartera

#### Features
- listado de beneficiarios asignados
- filtros por estado
- orden por prioridad

#### Subfeatures
- urgentes primero
- buscador
- acceso rápido a ficha

#### Dependencias
- beneficiary_assignments
- beneficiary_followup_status

#### Prioridad
Alta

---

### 2.3.2 Ficha beneficiario (operativa)

#### Features
- contexto completo
- historial
- acción principal

#### Subfeatures
- datos básicos
- llamadas recientes
- seguimientos previos
- botón registrar seguimiento

#### Prioridad
Alta

---

### 2.3.3 Registrar seguimiento manual

#### Features
- formulario rápido
- tipificación con checkboxes
- notas libres

#### Subfeatures
- selección tipo evento
- flags:
  - contacto válido
  - requiere soporte
- campo texto

#### Dependencias
- followup_events

#### Prioridad
Alta (core del sistema)

---

### 2.3.4 Bandeja priorizada

#### Features
- agrupación por estado
- urgentes
- pendientes
- sin datos

#### Dependencias
- beneficiary_followup_status

#### Prioridad
Alta

---

## 2.4 AUDITORÍA Y REPORTES (MÓDULO CRÍTICO)

### Objetivo
Medir, auditar y reportar cumplimiento operacional.

---

### 2.4.1 Dashboard ejecutivo

#### Features
- KPIs globales
- cobertura de seguimiento
- tendencias

#### Subfeatures
- tarjetas KPI
- métricas por rango de fechas

#### Dependencias
- followup_events
- call_interactions
- beneficiary_followup_status

#### Prioridad
Alta

---

### 2.4.2 Métricas por teleoperadora

#### Features
- cumplimiento de cartera
- beneficiarios al día/pendiente/urgente
- gestiones manuales registradas

#### Importante
NO mostrar "llamadas realizadas por teleoperadora"

#### Prioridad
Alta

---

### 2.4.3 Métricas por comuna

#### Features
- distribución de estados
- cobertura territorial

#### Prioridad
Media

---

### 2.4.4 Auditoría de llamadas AMAIA

#### Features
- total llamadas
- válidas vs inválidas
- match vs no match

#### Prioridad
Alta

---

### 2.4.5 Auditoría de imports

#### Features
- historial de cargas
- errores frecuentes
- calidad de datos

#### Prioridad
Media

---

### 2.4.6 Generador de informes

#### Features
- selección rango fechas
- selección tipo informe
- preview

#### Prioridad
Alta

---

### 2.4.7 Exportación PDF

#### Features
- descarga PDF
- branding Mistatas
- resumen ejecutivo

#### Contenido
- KPIs
- tablas
- alertas
- fecha y autor

#### Prioridad
Alta

---

# 3. Dependencias globales

- Supabase Auth
- RLS activo
- tablas backend ya creadas (M001–M007)
- normalización de datos backend

---

# 4. Prioridades globales

## Fase 1 (crítico)
- CORE UI
- Mi cartera
- Registrar seguimiento
- Beneficiarios
- Imports

## Fase 2 (operación completa)
- Ficha beneficiario completa
- Interacciones
- Seguimientos

## Fase 3 (valor negocio)
- Auditoría completa
- Reportes
- PDF

---

# 5. Notas finales

- El frontend NO es fuente de verdad
- El estado de seguimiento viene del backend
- Las reglas de negocio deben permanecer en backend
- El frontend debe ser rápido, claro y operacional

---

# 6. Siguiente paso

Generar Master Prompt para implementación UI en React usando este documento como contrato.