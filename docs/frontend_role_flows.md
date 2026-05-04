# Diseño funcional frontend: Seguimientos Mistatas

## 1. Propósito de la app

Mistatas es una aplicación operacional para gestionar beneficiarios, sus contactos, la asignación de cartera a teleoperadoras, la importación de datos externos y el seguimiento continuo de cada caso.

Desde frontend, la app debe permitir que cada rol vea solo la información que necesita para operar, supervise la calidad de los datos importados y registre acciones manuales de seguimiento sin convertir al cliente en fuente de verdad de negocio.

El objetivo principal de la UI es ordenar el trabajo diario sobre una base canónica ya resguardada en Supabase: padrón de beneficiarios, asignaciones activas, llamadas importadas, eventos de seguimiento y estado consolidado de seguimiento.

## 2. Flujo general del sistema

El flujo general esperado de la aplicación es el siguiente:

1. El usuario inicia sesión y la app identifica su rol.
2. El frontend carga una navegación distinta según `super_admin`, `admin` o `teleoperadora`.
3. Admin y super_admin pueden importar archivos de beneficiarios, asignaciones y llamadas AMAIA.
4. El backend valida, guarda metadata de cada archivo y persiste filas procesadas con trazabilidad.
5. La app presenta resultados de importación, errores y registros creados o actualizados.
6. La cartera activa de cada teleoperadora se define por `beneficiary_assignments`.
7. Las teleoperadoras trabajan sobre beneficiarios asignados: revisan ficha, consultan historial y registran seguimiento manual.
8. El sistema consolida eventos manuales y eventos confirmados por llamadas para mostrar un estado de seguimiento por beneficiario.
9. Admin y super_admin supervisan operación, calidad de datos y cobertura global.

## 3. Navegación por rol

La navegación debe ser clara, corta y centrada en tareas. No debe exponer secciones que el rol no puede usar.

### 3.1 Super_admin

Navegación sugerida:

- Inicio
- Beneficiarios
- Importar beneficiarios
- Importar asignaciones
- Importar llamadas AMAIA
- Interacciones telefónicas
- Seguimientos
- Estado de seguimiento
- Auditoría y reportes
- Usuarios y roles
- Auditoría operativa

En este rol prima la supervisión completa, la revisión transversal y el control de configuración operativa sensible.

### 3.2 Admin

Navegación sugerida:

- Inicio
- Beneficiarios
- Importar beneficiarios
- Importar asignaciones
- Importar llamadas AMAIA
- Interacciones telefónicas
- Seguimientos
- Estado de seguimiento
- Auditoría y reportes

El rol admin comparte casi toda la operación del super_admin, pero sin foco en configuración crítica o administración avanzada de seguridad.

### 3.3 Teleoperadora

Navegación sugerida:

- Inicio
- Mi cartera
- Beneficiarios asignados
- Seguimientos
- Estado de seguimiento
- Historial de interacciones

La navegación de teleoperadora debe estar orientada a ejecución diaria y no a mantenimiento estructural del sistema.

## 4. Pantallas para admin y super_admin

### 4.1 Inicio operacional

Pantalla resumida con indicadores operativos y accesos rápidos a tareas frecuentes.

Contenido sugerido:

- resumen de importaciones recientes,
- cantidad de beneficiarios con seguimiento pendiente, urgente o sin datos,
- accesos directos a cargas pendientes de revisar,
- accesos a búsqueda de beneficiarios.

### 4.2 Beneficiarios

Pantalla de listado general del padrón.

Debe permitir:

- buscar por nombre o RUT,
- filtrar por estado de seguimiento,
- ver teléfonos asociados,
- abrir ficha beneficiario,
- revisar teleoperadora asignada.

### 4.3 Ficha de beneficiario

Vista detallada de cada beneficiario.

Secciones recomendadas:

- identidad y datos base,
- teléfonos y red de apoyo,
- asignación vigente,
- historial de llamadas relacionadas,
- historial de eventos de seguimiento,
- estado consolidado de seguimiento.

### 4.4 Importar beneficiarios

Pantalla específica para subir Excel, revisar resultado de validación y confirmar el estado del proceso.

Debe mostrar:

- nombre del archivo,
- fecha de carga,
- usuario que cargó,
- totales procesados,
- filas válidas,
- filas con error,
- filas insertadas, actualizadas y omitidas,
- detalle navegable por fila.

### 4.5 Importar asignaciones

Pantalla para cargar Excel de asignaciones.

Debe incluir de forma obligatoria la selección previa de la teleoperadora destino cuando el flujo de negocio lo requiera.

Debe mostrar:

- teleoperadora seleccionada,
- modo de importación,
- resultado agregado,
- filas cerradas, insertadas, actualizadas u omitidas,
- errores por fila.

### 4.6 Importar llamadas AMAIA

Pantalla para cargar archivos de llamadas y revisar matching posterior.

Debe mostrar:

- metadata del archivo,
- filas válidas o inválidas,
- llamadas sin match,
- llamadas ambiguas,
- llamadas asociadas a beneficiario o contacto,
- enlace a interacciones generadas.

### 4.7 Interacciones telefónicas

Pantalla de exploración y auditoría de `call_interactions`.

Debe permitir:

- filtrar por fecha,
- filtrar por estado de match,
- filtrar por contacto válido,
- abrir beneficiario relacionado,
- revisar si la interacción cuenta como seguimiento válido.

### 4.8 Seguimientos

Pantalla de exploración de `followup_events`.

Debe permitir:

- filtrar por tipo de evento,
- filtrar por origen,
- ver si requiere soporte,
- ver confirmación por llamada,
- abrir ficha beneficiario,
- revisar autor del evento.

### 4.9 Estado de seguimiento

Pantalla operacional para revisar `beneficiary_followup_status`.

Debe priorizar:

- beneficiarios urgentes,
- beneficiarios pendientes,
- beneficiarios sin datos,
- fecha del último seguimiento válido,
- días desde el último seguimiento válido,
- teleoperadora asignada.

### 4.10 Usuarios y roles

Pantalla exclusiva para super_admin o visible como solo lectura para admin según definición futura.

Debe mostrar:

- usuarios internos,
- rol actual,
- estado activo,
- datos básicos de perfil.

### 4.11 Auditoría operativa

Pantalla prioritaria para super_admin.

Debe centralizar:

- historial de importaciones,
- errores relevantes,
- trazabilidad de cargas,
- revisión de eventos y cambios recientes.

### 4.12 Auditoría y reportes

Pantalla central para supervisión ejecutiva y análisis operacional consolidado.

Debe permitir:

- seleccionar un rango de fechas personalizado,
- ver métricas globales de seguimiento,
- auditar cumplimiento por teleoperadora y por cartera asignada,
- revisar métricas por comuna,
- revisar llamadas AMAIA importadas,
- revisar gestiones manuales,
- analizar beneficiarios al día, pendientes, urgentes y sin datos,
- generar informes ejecutivos en PDF.

Esta pantalla no debe presentar los reportes AMAIA como si reflejaran llamadas realizadas por una teleoperadora específica, porque AMAIA no informa qué teleoperadora originó o atendió la llamada.

Por esa razón, el lenguaje correcto para vistas comparativas por usuaria debe ser:

- cumplimiento de cartera asignada,
- cobertura de beneficiarios asignados,
- estado de seguimiento de cartera.

La UI no debe usar como concepto de reporte:

- llamadas realizadas por la teleoperadora.

En cambio, para los eventos manuales sí se puede usar lenguaje explícito de autoría operativa, por ejemplo:

- gestiones manuales registradas por teleoperadora.

Tipos de informes sugeridos dentro del módulo:

- informe ejecutivo general,
- informe por teleoperadora y cartera,
- informe de cumplimiento por comuna,
- informe de urgentes y pendientes,
- informe de calidad de datos e imports,
- informe de llamadas AMAIA,
- informe de gestiones manuales.

El PDF ejecutivo debe considerar:

- branding Mistatas,
- logo,
- fecha de generación,
- usuario que genera el informe,
- rango de fechas,
- KPIs principales,
- conclusiones o alertas,
- tablas resumen,
- opción de descarga.

## 5. Pantallas para teleoperadora

### 5.1 Inicio personal

Pantalla de entrada orientada a trabajo diario.

Debe mostrar:

- total de beneficiarios asignados,
- cantidad en estado urgente,
- cantidad pendiente,
- cantidad sin datos,
- accesos rápidos a registrar seguimiento,
- listado corto de casos prioritarios.

### 5.2 Mi cartera

Pantalla principal del rol teleoperadora.

Debe permitir:

- ver solo beneficiarios con asignación activa propia,
- buscar por nombre o RUT,
- filtrar por estado de seguimiento,
- ordenar por prioridad,
- abrir ficha beneficiario.

### 5.3 Ficha de beneficiario asignado

Versión operacional de la ficha, limitada a beneficiarios bajo su cartera activa.

Debe incluir:

- datos básicos del beneficiario,
- teléfonos disponibles,
- historial de llamadas asociadas,
- historial de seguimientos,
- estado actual,
- acción visible para registrar seguimiento manual.

### 5.4 Registrar seguimiento manual

Pantalla o modal de captura rápida.

Campos sugeridos:

- beneficiario,
- contacto utilizado,
- tipo de evento,
- fecha y hora,
- notas,
- indicador de seguimiento válido,
- indicador de requiere soporte.

Debe guardar solo eventos manuales y siempre asociados al usuario autenticado como creador.

### 5.5 Historial de interacciones

Pantalla de consulta de llamadas e interacciones asociadas a beneficiarios de su cartera.

Debe ser de lectura y facilitar contexto antes de registrar una gestión manual.

### 5.6 Estado de seguimiento

Pantalla de priorización personal.

Debe listar únicamente beneficiarios con asignación activa para la teleoperadora autenticada y agrupar por:

- urgente,
- pendiente,
- sin datos,
- al día.

## 6. Auditoría y reportes ejecutivos

El módulo de Auditoría y reportes ejecutivos debe ser una pieza central de la aplicación, no una vista secundaria. Su propósito es permitir supervisión fiel del cumplimiento de seguimientos, lectura de métricas operativas y generación de informes para jefatura, gerencia y dirección.

Desde frontend, este módulo debe consolidar información proveniente de importaciones, interacciones telefónicas, seguimientos manuales y estado consolidado por beneficiario dentro de una experiencia única de análisis.

Capacidades esperadas del módulo:

- selección de rango de fechas personalizado,
- visualización de métricas globales de seguimiento,
- auditoría de cumplimiento por teleoperadora y por cartera asignada,
- revisión de métricas por comuna,
- revisión de llamadas AMAIA importadas,
- revisión de gestiones manuales,
- análisis de beneficiarios al día, pendientes, urgentes y sin datos,
- generación de informes ejecutivos en PDF.

La semántica de los reportes debe cuidar la calidad interpretativa del dato:

- los reportes por teleoperadora no deben describirse como llamadas realizadas por la teleoperadora, porque AMAIA no informa autoría individual de llamada,
- los reportes sobre llamadas importadas deben hablar de cumplimiento de cartera asignada, cobertura de cartera o comportamiento de beneficiarios asignados,
- los reportes de eventos manuales sí pueden hablar de gestiones manuales registradas por teleoperadora, porque esos eventos sí tienen autoría operativa trazable.

El módulo debe contemplar como mínimo estos tipos de informe:

- Informe ejecutivo general.
- Informe por teleoperadora/cartera.
- Informe de cumplimiento por comuna.
- Informe de urgentes y pendientes.
- Informe de calidad de datos e imports.
- Informe de llamadas AMAIA.
- Informe de gestiones manuales.

El PDF ejecutivo esperado debe incluir:

- branding Mistatas,
- logo,
- fecha de generación,
- usuario que genera el informe,
- rango de fechas analizado,
- KPIs principales,
- conclusiones o alertas,
- tablas resumen,
- descarga directa desde la interfaz.

## 7. Permisos por rol

### 7.1 Super_admin

- Puede ver toda la operación.
- Puede importar beneficiarios.
- Puede importar asignaciones.
- Puede importar llamadas AMAIA.
- Puede ver interacciones telefónicas y seguimientos de toda la base.
- Puede revisar estado de seguimiento de todos los beneficiarios.
- Tiene acceso completo al módulo de auditoría y reportes ejecutivos.
- Puede supervisar usuarios y roles.

### 7.2 Admin

- Puede ver toda la operación funcional.
- Puede importar beneficiarios.
- Puede importar asignaciones.
- Puede importar llamadas AMAIA.
- Puede revisar beneficiarios, interacciones y seguimientos globales.
- Puede consultar el estado consolidado de seguimiento.
- Tiene acceso completo operativo al módulo de auditoría y reportes ejecutivos.
- No debe operar configuración crítica reservada a super_admin.

### 7.3 Teleoperadora

- Solo puede ver beneficiarios con asignación activa propia.
- Puede consultar llamadas e interacciones relacionadas con su cartera.
- Puede registrar seguimiento manual sobre beneficiarios asignados.
- Puede ver indicadores personales básicos en su dashboard.
- No administra asignaciones.
- No importa beneficiarios.
- No importa asignaciones.
- No importa llamadas AMAIA.
- No ve importaciones administrativas por ahora.
- No tiene acceso al módulo ejecutivo de auditoría y reportes.

## 8. Flujos principales

### 8.1 Importar beneficiarios

1. Admin o super_admin entra a la pantalla de importación.
2. Selecciona el archivo Excel.
3. El sistema crea una corrida de importación.
4. La app muestra estado inicial de carga.
5. El backend valida filas y persiste errores o resultados.
6. El usuario revisa resumen agregado y detalle por fila.
7. El usuario navega a beneficiarios creados o actualizados si necesita revisar casos.

### 8.2 Importar asignaciones

1. Admin o super_admin entra a la pantalla de importación de asignaciones.
2. Selecciona la teleoperadora destino si el flujo lo requiere.
3. Carga el Excel.
4. El sistema valida estructura y crea corrida de importación.
5. La app muestra resultados por fila y resumen agregado.
6. El usuario revisa cierres, actualizaciones, inserciones y errores.
7. La cartera activa se refleja luego en las vistas operacionales.

### 8.3 Importar llamadas AMAIA

1. Admin o super_admin entra a la pantalla de importación de llamadas.
2. Selecciona el archivo Excel global.
3. El sistema registra la corrida y procesa filas crudas.
4. El backend intenta match por teléfono normalizado y otras claves disponibles.
5. La app presenta válidos, inválidos, sin match y ambiguos.
6. El usuario revisa interacciones generadas y su relación con beneficiarios.

### 8.4 Registrar seguimiento manual

1. La teleoperadora abre un beneficiario de su cartera o entra desde la bandeja de trabajo.
2. Selecciona registrar seguimiento manual.
3. Completa tipo de evento, observaciones y banderas operativas.
4. La app valida campos mínimos.
5. El sistema guarda el evento con `source = manual` y `created_by = auth.uid()`.
6. La ficha del beneficiario actualiza el historial de seguimiento.
7. El estado consolidado podrá recalcularse posteriormente desde backend.

### 8.5 Revisar ficha beneficiario

1. El usuario busca o abre un beneficiario desde un listado.
2. La app carga datos base, contactos, asignación, interacciones y seguimientos.
3. El usuario revisa contexto completo del caso.
4. Si el rol lo permite, registra un seguimiento manual.
5. Si el rol es admin o super_admin, puede además revisar trazabilidad importada y calidad de datos.

## 9. Estados de seguimiento

### 9.1 Al día

El beneficiario tiene un seguimiento válido suficientemente reciente según la regla operacional definida por backend.

UI esperada:

- color de baja urgencia,
- fecha visible de último seguimiento válido,
- acceso rápido al historial.

### 9.2 Pendiente

El beneficiario requiere un nuevo contacto, pero todavía no cae en categoría crítica.

UI esperada:

- visibilidad alta en listados,
- filtros rápidos,
- acceso directo a registrar gestión.

### 9.3 Urgente

El beneficiario requiere atención prioritaria por antigüedad o ausencia de seguimiento válido dentro del umbral operativo.

UI esperada:

- prioridad visual máxima,
- presencia destacada en inicio y bandeja,
- orden preferente en listados.

### 9.4 Sin datos

El sistema aún no dispone de información suficiente para afirmar seguimiento válido.

UI esperada:

- etiqueta explícita,
- explicación breve de que falta evidencia operativa,
- acceso a revisión de llamadas y eventos manuales.

## 10. Reglas importantes de negocio para UI

- AMAIA no identifica redes de apoyo, por lo que la UI no debe asumir ese vínculo automáticamente.
- La app debe priorizar matching por teléfono normalizado al presentar conciliación de llamadas.
- Teleoperadora no administra asignaciones ni debe ver herramientas de administración de cartera.
- El Excel de asignaciones requiere seleccionar teleoperadora en el flujo de carga cuando corresponda.
- Un seguimiento válido puede originarse tanto en una llamada importada y confirmada como en una gestión manual.
- Los reportes por teleoperadora deben hablar de cumplimiento de cartera asignada y no de llamadas realizadas por la teleoperadora cuando la fuente sea AMAIA.
- Las gestiones manuales sí pueden reportarse por teleoperadora, porque su autoría queda registrada en el sistema.
- La UI no debe recalcular reglas de seguimiento como fuente de verdad; solo debe representar el estado consolidado entregado por backend.
- Las pantallas de importación deben conservar trazabilidad por archivo y por fila procesada.
- Las pantallas de teleoperadora deben mostrar solo casos pertenecientes a asignaciones activas propias.

## 11. Lineamientos UX para implementación futura

- La página inicial debe cambiar por rol inmediatamente después del login.
- Las acciones principales deben estar visibles sin depender de navegación profunda.
- Las fichas de beneficiario deben concentrar contexto suficiente para decidir una gestión en una sola vista.
- Las tablas de importación deben ofrecer filtros por estado y acceso rápido al detalle por fila.
- Los estados de seguimiento deben ser comprensibles sin leer documentación técnica.
- Los permisos deben reflejarse tanto en navegación como en acciones visibles dentro de cada pantalla.
- El módulo de auditoría y reportes debe priorizar lectura rápida, filtros claros, KPIs visibles y salida directa a PDF ejecutivo.

## 12. Alcance excluido en esta etapa

Este documento no define implementación técnica ni código frontend. Tampoco incorpora:

- dashboards analíticos avanzados,
- funciones RPC,
- automatizaciones de recálculo,
- lógica definitiva de matching,
- reglas visuales finales de diseño,
- componentes concretos de React.

Su propósito es alinear navegación, pantallas y permisos antes de iniciar la implementación de UI.
