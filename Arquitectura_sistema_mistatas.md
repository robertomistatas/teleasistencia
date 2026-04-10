# Arquitectura del sistema Mistatas

## 1. Visión general del sistema

### 1.1 Propósito del sistema

El sistema Mistatas es una plataforma operacional para teleoperaciones orientada a gestionar beneficiarios, sus teléfonos, sus asignaciones a teleoperadoras, el seguimiento manual de contactos, la importación de llamadas externas y la generación de reportes reproducibles.

Su objetivo principal es consolidar en una única base canónica:

- la identidad persistente del beneficiario,
- su relación con una teleoperadora activa,
- la trazabilidad de las interacciones de seguimiento,
- el cálculo de cobertura operacional,
- y la producción de reportes confiables basados en snapshots inmutables.

El sistema no debe depender del frontend para construir verdad de negocio. La verdad operacional reside en PostgreSQL sobre Supabase, protegida mediante reglas de acceso y respaldada por importaciones auditables.

### 1.2 Tipo de sistema

El sistema es híbrido, con predominio operacional.

- Operacional, porque soporta la gestión diaria de teleoperadoras, asignaciones, seguimientos y carga de archivos.
- Analítico-operacional, porque calcula cobertura, prioridad y carga de trabajo a partir de vistas derivadas sobre datos canónicos.
- Documental, porque produce reportes reproducibles a partir de snapshots persistidos y no de agregaciones volátiles en cliente.

No es un sistema BI generalista ni un data lake. Su núcleo es transaccional, con vistas y snapshots orientados a operación y reporte.

### 1.3 Actores principales

- super_admin: rol con visibilidad total, control de configuración operativa, auditoría completa y capacidad de supervisar importaciones, conflictos y reportes.
- admin: rol administrativo con capacidad de operar cargas, revisar conflictos, monitorear cobertura y administrar la operación diaria. El alcance exacto entre admin y super_admin requiere definición fina si se desea diferenciación adicional.
- teleoperadora: usuaria operacional que trabaja sobre su cartera asignada, registra seguimientos manuales y consulta cobertura y tareas asociadas a beneficiarios bajo su responsabilidad.
- procesos automatizados: importadores, validadores, reconciliadores, generadores de snapshots y generadores de PDF.
- agentes de IA: consumidores del documento y del modelo canónico para asistir implementación, validación, documentación y automatización sin introducir reglas no definidas.

### 1.4 Flujo general de negocio

1. Se mantiene un padrón persistente de beneficiarios identificado por RUT normalizado.
2. Cada beneficiario puede tener múltiples teléfonos, tipificados como principal o red_apoyo.
3. Las teleoperadoras cargan asignaciones desde Excel bajo formato fijo con RUT y nombre.
4. El sistema valida la carga, detecta conflictos y consolida una única asignación activa por beneficiario.
5. La teleoperadora opera sobre su cartera: consulta pendientes, registra seguimientos manuales y gestiona tareas asociadas al beneficiario.
6. Periódicamente se importan llamadas externas desde un Excel global proveniente de AMAIA o Net2Phone.
7. El sistema conserva primero el dato crudo, luego lo reconcilia con beneficiarios y determina qué registros califican como contacto efectivo.
8. A partir de contactos efectivos se calcula la cobertura por beneficiario y la prioridad operacional.
9. Los reportes se construyen desde snapshots persistidos para asegurar reproducibilidad y trazabilidad.

## 2. Stack tecnológico

### 2.1 Frontend

Frontend basado en Next.js con App Router.

Responsabilidades del frontend:

- autenticación y sesión del usuario a través de Supabase Auth,
- renderizado de interfaces operacionales,
- captura de acciones del usuario,
- consulta de datos vía endpoints server-side o clientes tipados hacia Supabase,
- manejo de estado remoto con TanStack Query,
- manejo de estado exclusivamente de interfaz con Zustand.

Librerías y criterios:

- Next.js App Router para rutas, layouts, server components y server actions donde corresponda.
- TanStack Query para caché, sincronización, invalidación y estados de carga de datos remotos.
- Zustand solo para estado efímero de UI, por ejemplo filtros locales, modales, selección temporal o preferencias de interacción no canónicas.
- Validación de formularios y payloads requiere definición de librería concreta. Recomendación arquitectónica: Zod para contratos consistentes entre cliente y servidor.

Regla estructural:

- Ninguna regla crítica de negocio debe existir únicamente en el cliente.
- El frontend no define cobertura, conflicto, contacto efectivo ni datasets de reporte.

### 2.2 Backend

Backend sustentado en Supabase.

Componentes utilizados:

- PostgreSQL como base de datos transaccional y analítica ligera.
- Auth para identidad de usuarios internos.
- Storage para carga y conservación controlada de archivos Excel y artefactos de reportes, si se requiere persistencia binaria.
- RLS para control de acceso por fila.
- SQL, vistas, constraints, índices, funciones y triggers para lógica de integridad y derivación.

Principio rector:

- El modelo canónico vive en PostgreSQL.
- El backend server-side de Next.js actúa como orquestador y capa de aplicación, no como reemplazo del modelo transaccional.

### 2.3 Hosting

Hosting principal en Vercel para la aplicación Next.js.

Uso esperado:

- despliegue del frontend,
- ejecución de lógica server-side del lado de Next.js,
- exposición de endpoints internos para procesos de importación, snapshot y reporte,
- integración segura con Supabase mediante variables de entorno.

Consideración operativa:

- Procesos pesados o de larga duración, como importaciones grandes o generación de PDF complejos, deben diseñarse con límites de ejecución en mente. Si el volumen esperado supera tolerancias de funciones serverless, la estrategia de ejecución exacta requiere definición.

### 2.4 Estado: TanStack Query vs Zustand

Separación obligatoria:

- TanStack Query: estado remoto, cacheable, asincrónico y derivado del backend.
- Zustand: estado local de interacción, nunca fuente de verdad de negocio.

Ejemplos correctos:

- cartera asignada, cobertura, historial de seguimientos, conflictos de importación y estado de reportes: TanStack Query.
- filtros abiertos, pestaña activa, selección temporal de filas, preferencia local de orden visual: Zustand.

Ejemplos incorrectos:

- guardar en Zustand el último contacto efectivo,
- calcular cobertura en cliente y persistirla como verdad,
- construir datasets de reporte en navegador.

### 2.5 Generación de reportes

La generación de reportes debe ser server-side y debe partir de un snapshot persistido.

Arquitectura objetivo:

1. Se calcula un dataset canónico para el reporte.
2. Se persiste un snapshot con metadatos, filtros aplicados, versión del algoritmo y contenido del dataset o referencia estable al mismo.
3. El PDF se genera desde ese snapshot, no desde consultas ad hoc del frontend.
4. El artefacto resultante puede almacenarse en Storage o regenerarse de forma determinista a partir del snapshot.

El motor exacto de render a PDF requiere definición técnica final. La restricción no negociable es que sea server-side y reproducible.

### 2.6 Manejo de archivos Excel

Los archivos Excel participan en dos flujos distintos:

- carga de asignaciones por teleoperadora,
- importación global de llamadas desde AMAIA o Net2Phone.

Principios de manejo:

- el archivo original debe considerarse evidencia operativa,
- cada carga debe generar un registro auditable,
- la transformación del archivo en datos canónicos debe ser determinista y trazable,
- errores de formato, duplicidad o conflicto deben persistirse y no quedar solo en logs efímeros.

La librería exacta para parseo requiere definición. Recomendación arquitectónica: una librería madura con soporte robusto de hojas Excel y control explícito de encabezados.

## 3. Arquitectura general

### 3.1 Flujo de datos completo

El flujo de datos se organiza en cinco capas conceptuales.

#### Capa 1. Captura e ingreso

- interfaz web para acciones manuales,
- carga de archivos Excel,
- autenticación de usuarios internos,
- validación inicial de payloads.

#### Capa 2. Orquestación de aplicación

- route handlers, server actions o servicios server-side de Next.js,
- validación de reglas de entrada,
- control de permisos antes de operaciones sensibles,
- invocación de RPC, SQL o funciones de base de datos,
- encolamiento o secuenciamiento de procesos de importación o reporte si aplica.

#### Capa 3. Núcleo transaccional canónico

- tablas maestras,
- tablas de trazabilidad de importación,
- tablas de eventos de seguimiento,
- tablas de tareas,
- tablas de snapshots y reportes,
- constraints, índices, llaves foráneas y reglas de unicidad.

#### Capa 4. Derivación operacional

- vistas canónicas para cartera vigente, contacto efectivo, última fecha efectiva, cobertura y carga por operadora,
- funciones SQL para validaciones repetibles,
- reconciliación entre datos crudos y entidades canónicas.

#### Capa 5. Consumo y salida

- dashboards operacionales,
- bandeja de trabajo por teleoperadora,
- revisión de conflictos,
- reportes PDF,
- auditoría y trazabilidad.

### 3.2 Separación de responsabilidades

#### Frontend

Debe encargarse de:

- presentar información,
- capturar acciones del usuario,
- gestionar navegación y experiencia de uso,
- solicitar datos y mutaciones al backend,
- ofrecer retroalimentación operacional.

No debe encargarse de:

- decidir contacto efectivo,
- resolver conflictos de asignación,
- calcular cobertura como fuente de verdad,
- generar datasets oficiales de reporte.

#### Backend en Supabase

Debe encargarse de:

- persistencia canónica,
- integridad relacional,
- control de acceso por fila,
- vistas derivadas confiables,
- trazabilidad de importaciones,
- reproducibilidad de snapshots.

#### Funciones server-side

Deben encargarse de:

- validar payloads antes de tocar el modelo canónico,
- coordinar importaciones de Excel,
- invocar procesos de reconciliación,
- consolidar datasets de reportes,
- ejecutar operaciones privilegiadas sin exponer credenciales de servicio al cliente.

### 3.3 Diagrama lógico en texto

```text
Usuarios internos
  -> Next.js App Router UI
  -> Server-side actions / route handlers
  -> Supabase Auth valida identidad
  -> PostgreSQL persiste modelo canónico
  -> Vistas SQL calculan cartera, contacto efectivo, cobertura y carga
  -> TanStack Query consume datos operacionales derivados

Excel de asignaciones
  -> upload controlado
  -> import_runs / assignment_imports
  -> validación de formato y conflictos
  -> beneficiary_assignments
  -> v_current_assignments

Excel global de llamadas
  -> upload controlado
  -> import_runs / calls_raw
  -> reconciliación en call_matches
  -> v_effective_contacts
  -> v_beneficiary_last_effective_contact
  -> v_beneficiary_coverage

Solicitud de reporte
  -> cálculo dataset server-side
  -> report_snapshots
  -> report_runs
  -> render PDF server-side
  -> archivo reproducible
```

## 4. Modelo de datos canónico

Las entidades documentadas a continuación representan el núcleo obligatorio del sistema. Los nombres de tablas responden al modelo canónico proporcionado. La definición exacta de columnas auxiliares puede evolucionar, pero no debe alterar la semántica aquí fijada.

### 4.1 profiles

Propósito:

- representar usuarios autenticados del sistema,
- complementar la identidad técnica de Auth con atributos de negocio y rol.

Relaciones:

- puede relacionarse con un usuario de Supabase Auth en relación uno a uno,
- puede estar vinculado a registros creados por usuario, como manual_followups, import_runs y report_runs,
- puede ser referencia del operador asignado en beneficiary_assignments.

Reglas clave:

- debe existir rol explícito: super_admin, admin o teleoperadora,
- el identificador técnico debe ser estable y alineado con Auth,
- no debe inferirse rol desde el cliente,
- si una teleoperadora deja de operar, su perfil puede desactivarse sin borrar trazabilidad histórica.

Campos mínimos conceptuales:

- id,
- auth_user_id,
- role,
- display_name,
- is_active,
- created_at,
- updated_at.

### 4.2 beneficiaries

Propósito:

- representar la entidad canónica del beneficiario.

Relaciones:

- uno a muchos con beneficiary_phones,
- uno a muchos con beneficiary_assignments,
- uno a muchos con manual_followups,
- uno a muchos con beneficiary_tasks,
- relación derivada con call_matches y vistas de cobertura.

Reglas clave:

- identidad canónica por RUT normalizado,
- nunca se elimina un beneficiario,
- puede archivarse mediante is_active = false,
- la existencia del beneficiario es independiente de tener o no asignación activa,
- la existencia del beneficiario es independiente de tener o no historial de seguimiento.

Campos mínimos conceptuales:

- id,
- rut_normalized,
- full_name,
- is_active,
- archived_at opcional,
- created_at,
- updated_at.

Constraint clave:

- unicidad de rut_normalized.

### 4.3 beneficiary_phones

Propósito:

- almacenar todos los teléfonos asociados al beneficiario diferenciando su tipo.

Relaciones:

- muchos a uno con beneficiaries.

Reglas clave:

- un beneficiario puede tener múltiples teléfonos,
- los tipos permitidos son principal y red_apoyo,
- todos los contactos son válidos y deben conservarse,
- el tipo no invalida el uso operacional del teléfono, pero sí condiciona interpretación y visualización,
- la normalización del número telefónico debe ser consistente para facilitar conciliación de llamadas.

Campos mínimos conceptuales:

- id,
- beneficiary_id,
- phone_normalized,
- phone_raw opcional,
- phone_type,
- is_active,
- created_at,
- updated_at.

Constraint recomendado:

- evitar duplicados exactos del mismo número normalizado para el mismo beneficiario y mismo tipo.

### 4.4 import_runs

Propósito:

- representar cada ejecución de importación como unidad auditable.

Relaciones:

- uno a muchos con assignment_imports,
- uno a muchos con calls_raw,
- uno a muchos con registros de error o advertencia si se modelan en tablas auxiliares,
- muchos a uno con profiles como usuario iniciador.

Reglas clave:

- toda carga de Excel debe tener un import_run,
- el archivo de origen, sus metadatos y el resultado de la importación deben quedar trazados,
- el import_run debe distinguir tipo de proceso, por ejemplo assignment_import o calls_import,
- una importación fallida también debe dejar rastro.

Campos mínimos conceptuales:

- id,
- import_type,
- initiated_by_profile_id,
- source_filename,
- source_storage_path opcional,
- started_at,
- finished_at opcional,
- status,
- total_rows,
- accepted_rows,
- rejected_rows,
- warning_count,
- error_count,
- notes opcional.

Estados conceptuales sugeridos:

- pending,
- processing,
- completed,
- completed_with_warnings,
- failed.

### 4.5 assignment_imports

Propósito:

- persistir el detalle fila a fila de las cargas de asignaciones provenientes de Excel.

Relaciones:

- muchos a uno con import_runs,
- relación potencial con beneficiaries por RUT normalizado una vez resuelta la identidad,
- relación potencial con profiles cuando la asignación se atribuye a una teleoperadora concreta.

Reglas clave:

- el formato fijo mínimo declarado es RUT + nombre,
- cada fila debe conservarse aunque termine en conflicto o rechazo,
- si una fila refiere un beneficiario existente, debe vincularse por RUT normalizado,
- si una fila corresponde a un RUT no existente, el flujo exacto para crear o rechazar beneficiario requiere definición explícita. Mientras no exista definición, el documento no debe asumir creación automática.

Campos mínimos conceptuales:

- id,
- import_run_id,
- row_number,
- rut_normalized,
- imported_name,
- target_profile_id,
- parse_status,
- conflict_code opcional,
- conflict_detail opcional,
- beneficiary_id opcional,
- created_at.

### 4.6 beneficiary_assignments

Propósito:

- representar el historial y el estado de asignación de beneficiarios a teleoperadoras.

Relaciones:

- muchos a uno con beneficiaries,
- muchos a uno con profiles.

Reglas clave:

- un beneficiario solo puede tener una asignación activa,
- la carga desde Excel debe cerrar o invalidar la asignación previa según la política definida por el sistema,
- si el mismo beneficiario aparece en dos Excel y eso genera dos asignaciones activas incompatibles, debe existir conflicto obligatorio,
- el historial de asignaciones no debe perderse.

Campos mínimos conceptuales:

- id,
- beneficiary_id,
- profile_id,
- source_assignment_import_id opcional,
- starts_at,
- ends_at opcional,
- is_active,
- assignment_status opcional,
- conflict_flag,
- created_at,
- updated_at.

Constraint clave:

- unicidad parcial para asegurar solo una asignación activa por beneficiary_id.

Requiere definición:

- política exacta de transición entre asignación activa previa y nueva asignación válida,
- semántica exacta de assignment_status si además de is_active se requiere un estado más rico.

### 4.7 calls_raw

Propósito:

- conservar de forma cruda cada fila importada desde AMAIA o Net2Phone antes de cualquier interpretación canónica.

Relaciones:

- muchos a uno con import_runs,
- uno a muchos o uno a uno con call_matches según estrategia de reconciliación.

Reglas clave:

- el dato crudo no debe sobrescribirse por derivaciones posteriores,
- debe conservar campos suficientes para auditar por qué una llamada fue considerada o no efectiva,
- deben persistirse los valores originales relevantes del archivo.

Campos mínimos conceptuales:

- id,
- import_run_id,
- row_number,
- source_provider,
- raw_payload_json,
- call_timestamp,
- phone_normalized opcional,
- duration_seconds opcional,
- raw_result_code opcional,
- raw_result_text opcional,
- created_at.

Requiere definición:

- mapeo exacto de columnas por proveedor,
- zona horaria canónica de timestamps de llamada.

### 4.8 call_matches

Propósito:

- registrar el resultado de la conciliación entre calls_raw y beneficiarios del sistema.

Relaciones:

- muchos a uno con calls_raw,
- muchos a uno con beneficiaries,
- opcionalmente muchos a uno con beneficiary_phones si se desea trazar el teléfono exacto que produjo el match.

Reglas clave:

- una llamada importada puede quedar sin match, con match único o con match ambiguo,
- la definición de contacto efectivo se basa en la llamada reconciliada y sus atributos,
- el hecho de que una llamada sea efectiva no reemplaza el dato crudo; solo lo interpreta,
- si el criterio de conciliación no permite identificar un beneficiario único, debe persistirse el estado ambiguo y no inventarse asignación.

Campos mínimos conceptuales:

- id,
- call_raw_id,
- beneficiary_id opcional,
- beneficiary_phone_id opcional,
- match_status,
- match_method,
- is_effective_contact,
- effective_contact_reason opcional,
- matched_at,
- reviewed_by_profile_id opcional,
- review_status opcional.

Reglas para is_effective_contact:

- verdadero si duration_seconds > 10,
- o verdadero si existe resultado explícito exitoso,
- falso en cualquier otro caso,
- si faltan datos para evaluar el criterio, el comportamiento exacto requiere definición; no debe asumirse efectividad por defecto.

### 4.9 manual_followups

Propósito:

- registrar seguimientos manuales realizados por teleoperadoras.

Relaciones:

- muchos a uno con beneficiaries,
- muchos a uno con profiles como autora del seguimiento.

Reglas clave:

- todo seguimiento manual está asociado a un beneficiario,
- debe incluir tipificación obligatoria,
- el modelo debe permitir distinguir si constituye o no contacto efectivo, si esa clasificación se define formalmente para seguimientos manuales.

Requiere definición:

- catálogo exacto de tipificaciones,
- si toda tipificación manual implica contacto efectivo o si depende de un subconjunto tipificado,
- si el seguimiento manual puede registrar también teléfono utilizado y observaciones estructuradas.

Campos mínimos conceptuales:

- id,
- beneficiary_id,
- created_by_profile_id,
- followup_at,
- typification_code,
- notes opcional,
- phone_used opcional,
- is_effective_contact opcional hasta definición formal,
- created_at,
- updated_at.

### 4.10 beneficiary_tasks

Propósito:

- registrar gestiones asociadas a beneficiarios.

Relaciones:

- muchos a uno con beneficiaries,
- muchos a uno con profiles como creador o responsable, si el diseño lo requiere.

Reglas clave:

- siempre están asociadas a un beneficiario,
- tipos permitidos: propia y grupal,
- estados permitidos: abierta, en_curso, pendiente, completada, cancelada,
- el historial de cambios de estado requiere definición si se desea auditoría detallada a nivel de transición.

Campos mínimos conceptuales:

- id,
- beneficiary_id,
- task_type,
- status,
- title,
- description opcional,
- assigned_profile_id opcional,
- due_at opcional,
- created_by_profile_id,
- created_at,
- updated_at,
- completed_at opcional,
- cancelled_at opcional.

### 4.11 report_runs

Propósito:

- representar cada ejecución de generación de reporte.

Relaciones:

- muchos a uno con report_snapshots,
- muchos a uno con profiles como usuario solicitante.

Reglas clave:

- toda generación de PDF debe tener un report_run,
- el estado de ejecución debe quedar registrado,
- si falla la generación, el snapshot base debe seguir siendo auditable.

Campos mínimos conceptuales:

- id,
- report_snapshot_id,
- requested_by_profile_id,
- report_type,
- started_at,
- finished_at opcional,
- status,
- output_storage_path opcional,
- error_detail opcional,
- created_at.

### 4.12 report_snapshots

Propósito:

- conservar la imagen lógica del dataset usado para construir un reporte.

Relaciones:

- uno a muchos con report_runs.

Reglas clave:

- el snapshot debe ser inmutable una vez generado,
- debe almacenar filtros, criterios, versión del algoritmo y contenido o referencia estable al contenido,
- el PDF debe poder regenerarse o verificarse a partir del snapshot,
- nunca debe depender de recalcular el reporte con datos vivos del sistema sin preservar la versión original.

Campos mínimos conceptuales:

- id,
- report_type,
- snapshot_generated_at,
- generated_by_profile_id,
- input_filters_json,
- algorithm_version,
- dataset_json o dataset_storage_path,
- row_count,
- checksum opcional,
- created_at.

## 5. Vistas canónicas

Las vistas canónicas son la capa estable de lectura operacional. Deben centralizar lógica derivada repetible y evitar que cada consumidor reconstruya reglas críticas.

### 5.1 v_current_assignments

Qué resuelve:

- ofrece la cartera vigente de beneficiarios por teleoperadora,
- expone una sola asignación activa por beneficiario,
- evita que el frontend reconstruya el estado de asignación leyendo historial bruto.

Cómo se construye conceptualmente:

- parte de beneficiary_assignments,
- filtra asignaciones activas,
- garantiza unicidad de beneficiario,
- incorpora datos básicos de beneficiary y profile para consumo operacional.

Quién la usa:

- bandeja de trabajo de teleoperadora,
- vistas de supervisión,
- cálculo de carga por operadora,
- validación de permisos por pertenencia de cartera.

### 5.2 v_effective_contacts

Qué resuelve:

- unifica eventos de contacto efectivo provenientes de distintas fuentes.

Cómo se construye conceptualmente:

- toma llamadas importadas conciliadas en call_matches con is_effective_contact = true,
- incorpora seguimientos manuales solo si su criterio de efectividad está formalmente definido,
- normaliza estructura mínima común: beneficiary_id, contact_at, source_type, source_record_id, contact_reason.

Quién la usa:

- cálculo de última fecha efectiva,
- cobertura,
- reportes operacionales,
- auditoría de contacto.

Requiere definición:

- inclusión exacta o no de manual_followups como fuente de contacto efectivo si la tipificación no está aún mapeada a efectividad.

### 5.3 v_beneficiary_last_effective_contact

Qué resuelve:

- expone la última fecha de contacto efectivo por beneficiario.

Cómo se construye conceptualmente:

- agrupa v_effective_contacts por beneficiary_id,
- calcula MAX(contact_at),
- puede añadir metadatos de última fuente y referencia al evento originario.

Quién la usa:

- priorización de cartera,
- cálculo de cobertura,
- paneles de detalle del beneficiario,
- datasets de reportes.

### 5.4 v_beneficiary_coverage

Qué resuelve:

- calcula el estado de cobertura y días sin contacto efectivo para cada beneficiario.

Cómo se construye conceptualmente:

- parte de beneficiaries activos o del universo operativo definido,
- left join con v_beneficiary_last_effective_contact,
- si no existe contacto efectivo: estado sin_historial,
- si existe contacto efectivo: calcula días transcurridos respecto de una fecha de corte,
- aplica clasificación:
  - al_dia si dias <= 15,
  - pendiente si dias entre 16 y 30,
  - urgente si dias > 30.

Quién la usa:

- bandeja priorizada de teleoperadora,
- paneles administrativos,
- reportes de cobertura.

Regla adicional:

- la prioridad operacional se ordena por días sin contacto efectivo de mayor a menor.

Requiere definición:

- fecha de corte exacta para procesos batch y reportes, si se desea desacoplarla del now() del sistema.

### 5.5 v_operator_workload

Qué resuelve:

- resume la carga operacional por teleoperadora.

Cómo se construye conceptualmente:

- parte de v_current_assignments,
- agrega métricas por profile_id,
- combina si es necesario con v_beneficiary_coverage para segmentar carga por estado,
- puede incluir conteo de beneficiarios totales, al_dia, pendiente, urgente y sin_historial.

Quién la usa:

- supervisión administrativa,
- balanceo de carga,
- monitoreo de operación.

## 6. Flujos del sistema

### 6.1 Flujo de carga de beneficiarios

Este flujo requiere definición parcial, porque el contexto entregado fija identidad y archivo, pero no explicita el mecanismo oficial de alta de nuevos beneficiarios.

Flujo canónico mínimo:

1. El sistema recibe un alta o actualización de datos de beneficiario desde la interfaz o desde un proceso de carga autorizado.
2. Se normaliza el RUT antes de cualquier lookup o persistencia.
3. Si el RUT ya existe, se actualizan solo los atributos permitidos por política de negocio.
4. Si el RUT no existe, se crea el beneficiario como nueva entidad canónica.
5. Si el beneficiario deja de estar operativo, no se elimina: se archiva con is_active = false.
6. Los teléfonos asociados se gestionan en beneficiary_phones, preservando tipo principal o red_apoyo.

Requiere definición:

- fuente oficial de creación inicial del padrón,
- reglas exactas de actualización de nombre y otros atributos,
- si las cargas de asignaciones pueden crear beneficiarios inexistentes o solo enlazar beneficiarios ya existentes.

### 6.2 Flujo de asignaciones

1. Una teleoperadora o un rol autorizado carga un Excel de asignaciones.
2. El sistema crea un import_run de tipo assignment_import.
3. Se conserva el archivo original y se parsea fila a fila.
4. Cada fila se persiste en assignment_imports con número de fila, RUT normalizado, nombre importado y resultado de parseo.
5. El sistema valida formato mínimo y detecta duplicidades dentro del archivo.
6. Para cada RUT, se identifica el beneficiario canónico.
7. Si el mismo beneficiario aparece en dos cargas que implican dos asignaciones activas incompatibles, se marca conflicto obligatorio.
8. Solo cuando la fila es válida y no conflictiva se crea o actualiza beneficiary_assignments.
9. La vista v_current_assignments expone el resultado operacional vigente.
10. El import_run queda cerrado con métricas de aceptadas, rechazadas y conflictivas.

Requiere definición:

- estrategia exacta de resolución de conflictos,
- si una nueva carga válida reemplaza automáticamente la asignación activa previa o requiere aprobación,
- si existe vigencia explícita por período de carga.

### 6.3 Flujo de operación de teleoperadora

1. La teleoperadora inicia sesión y el sistema resuelve su profile.
2. El frontend consulta v_current_assignments filtrada por permisos.
3. La teleoperadora visualiza su cartera ordenada por prioridad derivada de cobertura.
4. Al abrir un beneficiario, consulta identidad, teléfonos, tareas, historial manual y última evidencia de contacto efectivo.
5. La teleoperadora registra un seguimiento manual con tipificación obligatoria.
6. El backend valida permisos y persiste manual_followups.
7. Si la tipificación manual tiene semántica de contacto efectivo definida, las vistas derivadas se actualizan en consecuencia.
8. La teleoperadora puede crear o actualizar beneficiary_tasks asociadas al beneficiario.
9. La cobertura visible siempre debe provenir de vistas o consultas server-side, nunca de cálculo local.

### 6.4 Flujo de importación de llamadas

1. Un usuario autorizado carga el Excel global de llamadas.
2. El sistema crea un import_run de tipo calls_import.
3. Cada fila se persiste primero en calls_raw con payload crudo y campos relevantes extraídos.
4. Un proceso de reconciliación evalúa si la llamada puede asociarse a un beneficiario.
5. El resultado se registra en call_matches con estado de match y razón.
6. Se determina si la llamada constituye contacto efectivo conforme a la regla:
   - duración mayor a 10 segundos, o
   - resultado explícito exitoso.
7. Las llamadas con match válido y efectividad positiva alimentan v_effective_contacts.
8. Las vistas de última fecha efectiva y cobertura se recalculan al consultar o mediante materialización, si luego se define.
9. El import_run queda auditado con totales, advertencias y errores.

Requiere definición:

- criterio exacto de conciliación por teléfono, RUT u otros identificadores,
- política de revisión manual de matches ambiguos o no resueltos,
- semántica concreta de “resultado explícito exitoso” por proveedor.

### 6.5 Flujo de generación de reportes

1. Un usuario autorizado solicita un reporte indicando tipo y filtros.
2. El backend valida permisos y serializa los filtros efectivos.
3. Se construye el dataset canónico en el servidor usando tablas y vistas oficiales.
4. Se crea un report_snapshot inmutable con filtros, versión de algoritmo y dataset o referencia estable.
5. Se crea un report_run asociado al snapshot.
6. El servidor genera el PDF a partir del snapshot.
7. El resultado se almacena o se entrega al usuario preservando relación con el report_run.
8. Si el render falla, el snapshot sigue disponible para reintento y auditoría.

## 7. Reglas de negocio

### 7.1 Identidad por RUT

- El identificador canónico del beneficiario es el RUT normalizado.
- No pueden existir dos beneficiarios con el mismo RUT normalizado.
- Un beneficiario no se elimina; solo puede archivarse con is_active = false.
- Toda importación o alta debe resolver identidad por RUT antes de crear nuevas entidades relacionadas.

### 7.2 Teléfonos

- Un beneficiario puede tener múltiples teléfonos.
- Los tipos válidos son principal y red_apoyo.
- Todos los contactos telefónicos son válidos; el tipo solo clasifica su naturaleza.
- La normalización de teléfono debe ser consistente para soportar reconciliación de llamadas.

### 7.3 Asignaciones

- Las asignaciones se cargan mediante Excel por teleoperadora.
- El formato mínimo obligatorio declarado es RUT + nombre.
- Un beneficiario solo puede tener una asignación activa.
- El historial de asignaciones debe conservarse.
- Toda asignación activa debe ser trazable a su origen de carga o proceso válido.

### 7.4 Conflictos

- Si un beneficiario aparece en dos Excel generando dos asignaciones activas, el sistema debe marcar conflicto obligatorio.
- El conflicto no debe resolverse silenciosamente.
- Mientras exista conflicto no resuelto, el sistema no debe inventar una verdad operacional contradictoria.

### 7.5 Seguimiento manual

- El seguimiento manual siempre debe estar asociado a un beneficiario.
- Debe incluir tipificación obligatoria.
- La correspondencia entre tipificación y contacto efectivo requiere definición si se desea incorporarla en cobertura.

### 7.6 Contacto efectivo importado

- Una llamada importada cuenta como contacto efectivo si duración > 10 segundos.
- También cuenta como contacto efectivo si el resultado es explícitamente exitoso.
- Si no se cumple ninguna de ambas condiciones, no se considera contacto efectivo.
- La lista exacta de resultados exitosos requiere definición por proveedor si no viene estandarizada.

### 7.7 Cobertura

- al_dia: último contacto efectivo hace 15 días o menos.
- pendiente: último contacto efectivo entre 16 y 30 días.
- urgente: último contacto efectivo hace más de 30 días.
- sin_historial: no existe ningún contacto efectivo registrado.
- La prioridad operacional se ordena por días sin contacto efectivo de mayor a menor.

### 7.8 Gestiones

- Toda gestión está asociada a un beneficiario.
- Los tipos válidos son propia y grupal.
- Los estados válidos son abierta, en_curso, pendiente, completada y cancelada.

### 7.9 Importaciones

- Toda importación debe ser auditada.
- El archivo original y los resultados por fila deben poder rastrearse.
- Los errores de parseo, conflictos y rechazos deben persistirse.
- La importación no puede modificar silenciosamente evidencia cruda ya registrada.

### 7.10 Reportes

- Los reportes deben generarse desde snapshot.
- El frontend no debe construir el dataset oficial del reporte.
- El PDF debe ser reproducible.

## 8. Seguridad y RLS

### 8.1 Principios generales

- Mínimo privilegio por rol.
- El cliente nunca recibe privilegios equivalentes a service role.
- Toda lectura sensible debe respetar RLS o pasar por una capa server-side controlada.
- La información personal de beneficiarios y teléfonos debe limitarse al alcance operativo necesario.

### 8.2 Matriz conceptual de acceso

#### super_admin

Puede ver y gestionar:

- todos los beneficiarios,
- todos los teléfonos,
- todas las asignaciones,
- todas las importaciones y sus errores,
- todas las llamadas crudas y conciliadas,
- todos los seguimientos manuales,
- todas las tareas,
- todos los snapshots y reportes,
- configuración operativa y auditoría completa.

#### admin

Puede ver y gestionar:

- beneficiarios y su operación,
- asignaciones,
- importaciones,
- conflictos,
- cobertura agregada y por beneficiario,
- reportes y snapshots.

Requiere definición:

- si admin puede ver llamadas crudas completas o solo derivaciones operacionales,
- si admin tiene el mismo alcance global que super_admin o un subconjunto funcional.

#### teleoperadora

Puede ver:

- beneficiarios con asignación activa bajo su responsabilidad,
- teléfonos de esos beneficiarios,
- cobertura y últimas evidencias de contacto asociadas a su cartera,
- tareas de sus beneficiarios.

Puede crear o actualizar:

- seguimientos manuales sobre su cartera,
- tareas o actualizaciones permitidas sobre beneficiarios asignados, según política.

No debe poder:

- ver carteras ajenas,
- ver importaciones globales no necesarias para su trabajo,
- alterar snapshots o reportes oficiales fuera de permisos definidos,
- acceder a service role ni a datos sin filtro.

### 8.3 Reglas conceptuales de RLS

- profiles: cada usuario puede leer su propio profile; roles administrativos pueden leer todos.
- beneficiaries: teleoperadora solo lee beneficiarios presentes en v_current_assignments para su profile_id; admin y super_admin leen todos.
- beneficiary_phones: la teleoperadora solo lee teléfonos de beneficiarios de su cartera activa.
- beneficiary_assignments: teleoperadora solo lee asignaciones de su cartera; admin y super_admin leen todas.
- manual_followups: teleoperadora puede leer seguimientos de beneficiarios asignados a su cartera y crear los propios; la edición de seguimientos históricos requiere definición.
- beneficiary_tasks: acceso análogo al beneficiario asociado.
- import_runs, assignment_imports, calls_raw, call_matches: restringidos a roles administrativos salvo que se habilite una vista resumida para teleoperadoras.
- report_snapshots y report_runs: acceso administrativo salvo requerimiento explícito adicional.

### 8.4 Protección de datos

- Evitar exposición innecesaria de teléfonos completos en contextos no operativos.
- Aplicar logging de acceso sensible solo si se define formalmente, cuidando no duplicar datos personales en logs.
- Mantener archivos Excel y PDFs en almacenamiento controlado con rutas no públicas por defecto.
- Cifrado en tránsito y en reposo delegado a la plataforma, complementado por controles de acceso correctos.

## 9. Auditoría y trazabilidad

### 9.1 Importaciones

Cada importación debe dejar trazabilidad de:

- quién la inició,
- cuándo comenzó y terminó,
- qué archivo se utilizó,
- cuántas filas fueron procesadas,
- cuántas fueron aceptadas, rechazadas o conflictivas,
- qué errores se detectaron.

import_runs es la unidad principal de auditoría del proceso.

### 9.2 Llamadas

La trazabilidad de llamadas debe separar:

- dato crudo importado en calls_raw,
- resultado de conciliación en call_matches,
- derivación de contacto efectivo en vistas canónicas.

Esto permite responder:

- qué dijo el archivo original,
- cómo se interpretó,
- por qué una llamada contó o no como contacto efectivo,
- a qué beneficiario quedó vinculada o por qué no pudo vincularse.

### 9.3 Asignaciones

La trazabilidad de asignaciones debe permitir conocer:

- desde qué carga surgió una asignación,
- qué teleoperadora quedó asociada,
- desde cuándo rige,
- cuál era la asignación previa,
- si existió conflicto y cómo se trató.

### 9.4 Reportes

La trazabilidad de reportes debe incluir:

- usuario solicitante,
- filtros efectivos,
- versión del algoritmo,
- snapshot generado,
- estado de la ejecución de PDF,
- ubicación del artefacto final si se almacena.

## 10. Generación de reportes

### 10.1 Construcción del dataset

El dataset del reporte debe construirse en servidor utilizando exclusivamente:

- tablas canónicas,
- vistas canónicas,
- filtros validados,
- fecha de corte explícita o implícita preservada en el snapshot.

No debe depender de:

- estado en navegador,
- cálculos locales no persistidos,
- consultas no versionadas cuya semántica cambie sin registrar algoritmo.

### 10.2 Creación del snapshot

El snapshot debe incluir, como mínimo:

- tipo de reporte,
- filtros aplicados,
- timestamp de generación,
- versión del algoritmo,
- dataset persistido o referencia persistida,
- conteo de filas,
- checksum o mecanismo equivalente si se requiere verificación fuerte.

El snapshot es la pieza que convierte un reporte en un artefacto reproducible y auditable.

### 10.3 Generación del PDF

La generación del PDF debe ser server-side y determinista.

Principios:

- mismo snapshot debe producir mismo contenido lógico,
- el template debe versionarse junto con el proceso o ser inferible desde metadata suficiente,
- fallas de render no deben borrar ni invalidar el snapshot,
- la UI solo dispara la solicitud y consulta el estado del report_run.

### 10.4 Errores del sistema anterior que este diseño corrige

Este diseño corrige explícitamente los siguientes errores de arquitectura frecuentes:

- construir reportes en frontend,
- depender de datos vivos al momento de descargar un PDF,
- recalcular cobertura con reglas duplicadas entre pantallas,
- mezclar dato crudo de llamadas con interpretación efectiva sin trazabilidad,
- perder historial de asignación al actualizar la cartera,
- tratar archivos Excel como insumo efímero sin evidencia persistida,
- acoplar la verdad operacional a cachés de cliente o a stores locales.

## 11. Decisiones de arquitectura

### 11.1 Por qué Supabase

- porque reúne PostgreSQL, Auth, Storage y RLS en una plataforma coherente para un sistema intensivo en datos relacionales,
- porque reduce complejidad operativa respecto a ensamblar múltiples piezas separadas,
- porque permite mantener la lógica de integridad cerca de los datos.

### 11.2 Por qué PostgreSQL

- porque el problema requiere modelo relacional, unicidad, historial, vistas derivadas y constraints fuertes,
- porque cobertura, conflicto, asignación activa y trazabilidad encajan mejor en SQL relacional que en documentos denormalizados,
- porque el sistema necesita una fuente única de verdad consistente y auditable.

### 11.3 Por qué Next.js

- porque permite combinar frontend moderno con lógica server-side cercana a la UI,
- porque App Router facilita segmentar render, carga de datos y acciones de servidor,
- porque se integra de forma natural con despliegue en Vercel.

### 11.4 Por qué TanStack Query y no estado remoto en Zustand

- porque el problema tiene datos remotos, asincrónicos, cacheables e invalidables,
- porque mezclar verdad remota en stores locales degrada consistencia y dificulta sincronización,
- porque Zustand debe reservarse para UI, no para modelo operativo.

### 11.5 Por qué no Firebase

- porque el sistema depende de relaciones fuertes, vistas derivadas, unicidad canónica por RUT, historial transaccional y consultas de cobertura que encajan mejor en PostgreSQL,
- porque no se deben arrastrar patrones de Firestore o Firebase a un dominio que exige integridad relacional,
- porque generar verdad operacional desde documentos dispersos o lógica cliente elevaría ambigüedad y deuda técnica.

### 11.6 Por qué no PDF client-side

- porque no garantiza reproducibilidad,
- porque expone lógica crítica al navegador,
- porque depende del estado visible o disponible en sesión del usuario,
- porque dificulta auditoría y reejecución confiable.

## 12. Riesgos y mitigaciones

### 12.1 Riesgo: ambigüedad en conciliación de llamadas

Problema:

- una llamada puede corresponder a más de un beneficiario o a ninguno.

Mitigación:

- conservar dato crudo,
- modelar match_status explícito,
- no forzar asociación cuando el match no sea único,
- habilitar revisión si el negocio la requiere.

### 12.2 Riesgo: conflicto de asignaciones no resuelto

Problema:

- un mismo beneficiario puede aparecer en cargas incompatibles.

Mitigación:

- conflicto obligatorio persistido,
- bloqueo de consolidación silenciosa,
- vistas operacionales consumen solo asignaciones válidas.

### 12.3 Riesgo: duplicación de lógica de cobertura

Problema:

- distintas pantallas o procesos pueden recalcular cobertura con criterios diferentes.

Mitigación:

- centralizar cálculo en vistas canónicas,
- versionar reglas que impacten reportes,
- evitar lógica crítica en cliente.

### 12.4 Riesgo: importaciones opacas

Problema:

- sin trazabilidad por fila es imposible auditar rechazos o conflictos.

Mitigación:

- usar import_runs y tablas detalle,
- conservar archivo original,
- persistir errores y advertencias.

### 12.5 Riesgo: degradación de rendimiento en vistas complejas

Problema:

- a mayor volumen, vistas derivadas sobre llamadas y cobertura pueden volverse costosas.

Mitigación:

- diseñar índices sobre RUT normalizado, beneficiary_id, profile_id, timestamps y phone_normalized,
- medir antes de materializar,
- materializar solo si el volumen real lo exige y sin romper semántica canónica.

### 12.6 Riesgo: diferencias entre dato vivo y reporte histórico

Problema:

- un reporte regenerado desde datos actuales puede no coincidir con el reporte original.

Mitigación:

- snapshots inmutables,
- versión de algoritmo,
- PDF generado desde snapshot.

### 12.7 Riesgo: exposición indebida de datos personales

Problema:

- teléfonos y datos de beneficiarios podrían filtrarse por políticas de acceso laxas.

Mitigación:

- RLS estricto,
- separación entre roles,
- rutas de almacenamiento privadas,
- no exponer datasets completos al cliente sin necesidad operacional.

## 13. Lineamientos para implementación

### 13.1 Para desarrolladores

- Este documento define la semántica del sistema, no solo una propuesta.
- Toda implementación debe alinearse primero con el modelo canónico aquí descrito.
- Si una regla no está definida, debe marcarse como requiere definición y escalarse; no debe resolverse por intuición local.
- Las tablas, vistas y constraints deben implementarse en Supabase/PostgreSQL antes de construir pantallas dependientes.
- El frontend debe consumir vistas y endpoints canónicos; no debe recrear reglas de negocio críticas.
- Toda importación debe ser auditable desde el día uno.
- Toda decisión que afecte reproducibilidad de reportes debe quedar versionada.

### 13.2 Para agentes de IA

- Este documento es la fuente única de verdad del dominio operativo descrito.
- No se deben inventar reglas faltantes ni completar vacíos con patrones genéricos de CRUD.
- No se deben trasladar patrones de Firebase o Firestore a este diseño.
- Al generar código, priorizar integridad relacional, trazabilidad, RLS y separación entre dato canónico y dato derivado.
- Cuando una parte del dominio esté marcada como requiere definición, el agente debe detener la inferencia y explicitar el vacío.
- Cualquier propuesta de migración, vista, constraint o API debe justificar cómo preserva estas reglas.

### 13.3 Uso operativo del documento

El documento debe utilizarse como base para:

- diseño de base de datos,
- políticas RLS,
- contratos de API y server actions,
- diseño de pantallas operacionales,
- pipelines de importación,
- generación de snapshots y reportes,
- validación de consistencia entre negocio e implementación.

### 13.4 Temas que requieren definición explícita antes de cerrar implementación completa

- fuente oficial de alta inicial de beneficiarios,
- política exacta de creación de beneficiario durante carga de asignaciones,
- catálogo de tipificaciones manuales y su relación con contacto efectivo,
- diccionario de resultados exitosos de AMAIA y Net2Phone,
- criterio exacto de conciliación de llamadas,
- diferencias funcionales exactas entre admin y super_admin,
- motor definitivo de render de PDF en entorno Vercel,
- política exacta de transición entre asignaciones activas.

## Criterio de cierre arquitectónico

La arquitectura se considera coherente si y solo si se cumplen simultáneamente estas condiciones:

- el beneficiario se identifica de forma única por RUT normalizado,
- nunca existe más de una asignación activa válida por beneficiario,
- el contacto efectivo se calcula con criterios canónicos y trazables,
- la cobertura deriva de vistas oficiales y no del cliente,
- toda importación es auditable,
- todo reporte parte de un snapshot reproducible,
- el acceso a datos está restringido por rol y por fila,
- los vacíos de negocio permanecen marcados como requiere definición hasta resolución formal.