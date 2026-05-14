# Assignment Management Design

## 1. Objetivo del módulo

El módulo de Asignaciones y Carteras debe entenderse como el núcleo de ownership operacional de Mistatas, no como un simple CRUD de vínculos entre beneficiarios y usuarias.

La cartera representa responsabilidad formal sobre seguimiento, continuidad, visibilidad de riesgo, lectura ejecutiva y capacidad de supervisión. En términos institucionales, asignar una cartera equivale a definir quién responde operativamente por ese universo de beneficiarios y bajo qué marco de control se evalúa su cumplimiento.

Por esta razón, el módulo impacta de forma directa:

- la responsabilidad operacional diaria
- la supervisión de jefaturas y administración
- la trazabilidad de cambios de cartera
- la lectura de cobertura y riesgo
- la consistencia del dashboard ejecutivo
- la legitimidad institucional de reportes y PDF

El sistema debe soportar rotaciones reales, reemplazos, contingencias, redistribuciones y cambios de estructura sin pérdida histórica ni ambigüedad sobre quién fue responsable en cada período.

---

## 2. Definición formal de asignación

Una asignación es el vínculo operacional formal entre un beneficiario y una usuaria del sistema dentro de un período determinado y bajo un tipo de responsabilidad definido.

No representa solo una relación de visualización en interfaz. Representa una decisión institucional sobre ownership, cobertura y accountability.

### Qué representa operacionalmente

- define quién es la responsable visible de un beneficiario
- determina a qué cartera pertenece un caso en cada momento
- establece sobre quién recaen métricas, alertas y supervisión
- permite reconstruir históricamente la evolución de una cartera

### Ownership versus soporte

No toda participación sobre un beneficiario implica ownership.

- ownership: responsabilidad oficial e institucional sobre el beneficiario
- soporte: participación complementaria o temporal sin transferencia del ownership principal

Esta distinción es crítica porque la plataforma no solo debe mostrar quién puede intervenir, sino quién responde formalmente ante supervisión, auditoría y reporting ejecutivo.

### Impacto institucional

Cada asignación modifica la forma en que la institución interpreta cobertura, riesgo, continuidad operativa y carga de trabajo. Por lo tanto, no debe modelarse como un dato accesorio, sino como infraestructura de supervisión.

---

## 3. Tipos de asignación

El diseño conceptual del módulo debe distinguir con claridad entre tipos de asignación, porque cada uno expresa un nivel distinto de responsabilidad y debe producir efectos distintos sobre métricas, supervisión y trazabilidad.

### PRIMARY

La asignación `PRIMARY` representa la responsable oficial del beneficiario.

Reglas operacionales:

- solo puede existir una `PRIMARY` activa por beneficiario
- define el ownership institucional vigente
- es la asignación usada para lectura ejecutiva y métricas principales
- determina la cartera formal sobre la cual se mide cobertura y riesgo

Implicancias operacionales:

- es la referencia principal para dashboard y PDF ejecutivo
- es la base de accountability visible ante supervisión
- es la asignación que debe preservarse con máxima consistencia histórica

### SUPPORT

La asignación `SUPPORT` representa apoyo operacional temporal, parcial o complementario.

Reglas operacionales:

- puede coexistir con una `PRIMARY`
- no reemplaza el ownership principal
- no debe reinterpretarse como transferencia formal de cartera
- se usa para cobertura temporal, apoyo en contingencia o colaboración puntual

Implicancias operacionales:

- permite continuidad sin alterar la lectura institucional del responsable oficial
- habilita apoyo operativo en sobrecarga, vacaciones, licencias o contingencias
- no debe contaminar métricas ejecutivas de ownership principal

### FUTURE / SCHEDULED

La asignación `FUTURE` o `SCHEDULED` representa una relación preparada para entrar en vigencia más adelante.

Su uso conceptual debe contemplar:

- onboarding progresivo de cartera
- cambios programados de estructura
- rotaciones futuras ya aprobadas
- transiciones planificadas entre responsables

Implicancias operacionales:

- permite preparar movimientos sin ejecutarlos de inmediato
- facilita coordinación entre supervisión y operación
- reduce improvisación en cambios de cartera
- exige reglas claras de activación futura para no generar dobles ownership efectivos antes de tiempo

---

## 4. Estados de asignación

Además del tipo, cada asignación debe tener un estado conceptual que describa su vigencia operacional.

### active

La asignación está vigente y produce efectos operacionales actuales.

Cuándo aplica:

- cuando la asignación ya inició su vigencia
- cuando la relación debe considerarse para supervisión, lectura de cartera y trazabilidad activa

Impacto:

- participa en vistas operativas según su tipo
- si es `PRIMARY`, impacta métricas ejecutivas, ownership y agrupación de cartera
- si es `SUPPORT`, impacta visibilidad operativa secundaria, pero no ownership principal

### ended

La asignación finalizó su vigencia operativa.

Cuándo aplica:

- cuando termina una reasignación permanente o temporal
- cuando se cierra formalmente una etapa de ownership o soporte
- cuando una cartera se transfiere de forma efectiva a otra responsable

Impacto:

- deja de afectar métricas vigentes
- conserva valor histórico completo
- sigue siendo crítica para auditoría, PDF histórico y reconstrucción de continuidad operacional

### scheduled

La asignación existe, pero su efecto aún no comienza.

Cuándo aplica:

- cuando hay una reasignación futura aprobada
- cuando se prepara onboarding de cartera
- cuando se programa una rotación con fecha de inicio posterior

Impacto:

- no debe alterar métricas actuales ni ownership vigente
- sí debe ser visible para planificación y control administrativo según permisos
- exige mecanismos de confirmación para activarse correctamente cuando corresponda

### suspended

La asignación se encuentra temporalmente detenida o en pausa operacional.

Cuándo aplica:

- cuando existe una interrupción temporal sin cierre definitivo
- cuando una responsable sale transitoriamente de operación y el vínculo requiere congelamiento formal
- cuando hay una contingencia que obliga a pausar temporalmente la asignación sin borrarla ni cerrarla como definitiva

Impacto:

- la asignación no debe considerarse activa para efectos corrientes mientras permanezca suspendida
- su existencia debe seguir siendo visible para supervisión y trazabilidad
- requiere criterio institucional claro para evitar beneficiarios en limbo operacional

### Quién puede modificarlos

- `super_admin`: puede crear, activar, programar, suspender y cerrar asignaciones, incluyendo movimientos críticos y masivos
- `admin`: puede ejecutar cambios operacionales dentro de límites definidos por política institucional
- `teleoperadora`: no debe modificar estados estructurales de asignación

### Principio rector

Un cambio de estado no es un detalle técnico. Es una decisión que redefine responsabilidad vigente, lectura de cartera y supervisión institucional.

---

## 5. Historial y trazabilidad

La trazabilidad del módulo es crítica y no negociable.

Toda asignación debe concebirse como un hecho histórico auditable. Por diseño institucional:

- nunca se eliminan asignaciones históricas
- nunca se sobrescriben asignaciones previas para simular el presente
- todo movimiento debe quedar trazado como evento operativo real

### Datos mínimos de trazabilidad

Cada movimiento o asignación debe preservar como mínimo:

- fecha de inicio
- fecha de término, cuando aplique
- actor responsable del cambio
- motivo del cambio
- tipo de movimiento realizado

### Tipos de movimiento esperables

- creación inicial de ownership
- reasignación permanente
- reasignación temporal
- activación de soporte
- cierre de soporte
- suspensión
- reactivación
- programación futura
- ejecución de rotación masiva

### Por qué es crítico

#### Auditoría

Permite reconstruir quién fue responsable de cada cartera en cada período y evita lecturas engañosas sobre cumplimiento pasado.

#### PDF y reporting ejecutivo

Permite sostener reportes formales con respaldo institucional, especialmente cuando la gerencia revisa períodos anteriores o cambios relevantes de estructura.

#### Supervisión

Permite explicar desviaciones, quiebres de continuidad, contingencias y redistribuciones sin depender de memoria informal del equipo.

#### Análisis histórico

Permite identificar rotaciones frecuentes, sobrecargas recurrentes, patrones de riesgo y efectos de cambios organizacionales sobre la cobertura.

#### Continuidad operacional

Evita pérdida de contexto cuando una teleoperadora sale, cambia de rol o deja la operación. La institución conserva la historia completa de ownership y soporte.

---

## 6. Reasignaciones operacionales

Las reasignaciones deben tratarse como operaciones de alto impacto institucional, porque alteran ownership, métricas, carga de trabajo y lectura de riesgo.

### Reasignación individual

Corresponde al movimiento de un beneficiario específico entre responsables.

Casos típicos:

- cambio permanente de responsable oficial
- apoyo temporal con mantención de ownership original
- reemplazo por licencia, vacaciones o contingencia puntual

Consideraciones operacionales:

- debe quedar claro si el cambio transfiere ownership o solo agrega soporte
- debe existir motivo institucional explícito
- debe validarse que el beneficiario no quede sin `PRIMARY` activa cuando el caso requiera ownership continuo

### Reasignación masiva

Corresponde a movimientos sobre grupos amplios de beneficiarios o carteras completas.

Casos típicos:

- rotación completa de cartera
- salida de una teleoperadora
- balance de carga entre responsables
- contingencias operacionales extraordinarias

### Riesgos asociados

- pérdida accidental de ownership vigente
- distorsión de métricas ejecutivas por cambios mal fechados
- beneficiarios huérfanos operacionalmente
- quiebres de continuidad en seguimiento
- sobrecarga no detectada en responsables receptoras
- pérdida de trazabilidad si se intenta sobrescribir en lugar de registrar movimiento

### Validaciones mínimas

- verificar que la responsable destino esté activa y habilitada operacionalmente
- verificar impacto sobre carga de cartera antes de confirmar
- verificar que no se generen dos `PRIMARY` activas simultáneas para un mismo beneficiario
- verificar que movimientos temporales no se registren como transferencias permanentes por error
- verificar período efectivo del cambio

### Confirmaciones críticas

Los movimientos de alto impacto deben exigir confirmación explícita sobre:

- cantidad de beneficiarios afectados
- tipo de transferencia realizada
- responsable saliente y entrante
- fecha efectiva del cambio
- efecto esperado sobre ownership y métricas

### Impacto institucional

Toda reasignación altera la lectura de responsabilidad, por lo que debe poder ser explicada ex post ante supervisión, auditoría o gerencia sin ambigüedad funcional.

---

## 7. Impacto transversal del módulo

El módulo de asignaciones no opera aislado. Define la estructura base desde la cual otros módulos interpretan la operación.

### Auditoría

Las asignaciones determinan:

- sobre qué cartera se mide cobertura
- a quién se atribuye ownership del universo auditado
- cómo se construyen rankings y comparativas por teleoperadora

La auditoría debe leer la cartera vigente desde ownership formal, no desde interpretaciones manuales o supuestos de UI.

### Riesgo

Las asignaciones determinan:

- quién aparece como responsable visible del beneficiario en riesgo
- cómo se agrupan casos críticos por cartera
- qué jefatura o supervisión debe intervenir cuando una cartera se deteriora

Sin un modelo claro de asignación, el riesgo pierde responsable institucional visible.

### PDF

Las asignaciones determinan:

- quién figura como responsable institucional en reportes
- cómo se explica la composición de cartera analizada
- cómo se sostienen cambios de ownership entre distintos cortes de tiempo

### Dashboard

Las asignaciones determinan:

- métricas por cartera
- balance de carga por teleoperadora
- comparativas de cumplimiento
- lecturas de concentración o sobrecarga operacional

### Supervisión

Las asignaciones determinan:

- accountability formal
- trazabilidad de movimientos
- criterios de seguimiento y escalamiento
- capacidad de explicar cambios estructurales en la operación

---

## 8. Reglas institucionales

El contrato del módulo debe dejar explícitas reglas no ambiguas.

- un beneficiario no puede tener más de una `PRIMARY` activa al mismo tiempo
- una asignación `SUPPORT` no reemplaza una `PRIMARY`
- las métricas ejecutivas deben construirse usando ownership `PRIMARY`
- el soporte temporal no transfiere ownership institucional
- los beneficiarios no deben quedar huérfanos operacionalmente sin una responsable visible cuando el proceso requiera continuidad activa
- los cambios masivos deben ser auditables de extremo a extremo
- una asignación histórica no debe eliminarse para corregir operación actual
- los movimientos deben preservar fechas efectivas reales y no solo fechas de registro
- la visibilidad operativa puede ampliarse con soporte, pero la responsabilidad oficial debe permanecer explícita
- un cambio estructural de cartera debe poder justificarse institucionalmente mediante motivo registrado

Estas reglas deben tratarse como principios de gobernanza del dato, no como simples validaciones de pantalla.

---

## 9. UX conceptual

La futura experiencia de usuario no debe diseñarse solo para editar registros, sino para operar carteras con seguridad institucional.

Sin definir UI concreta todavía, el módulo deberá contemplar necesidades como:

- vista de cartera para entender composición, ownership y carga
- vista por teleoperadora para supervisar distribución y balance operativo
- capacidad de mover cartera o beneficiarios con claridad sobre impacto
- gestión explícita de soporte temporal sin confundirlo con transferencia de ownership
- filtros por responsable, estado, tipo de asignación, vigencia y contexto operacional
- búsqueda rápida de beneficiarios y responsables
- lectura de balance operacional para detectar concentraciones o sobrecarga
- confirmaciones críticas antes de ejecutar movimientos estructurales
- warnings institucionales cuando una acción compromete continuidad, ownership o consistencia histórica

### Principio de UX

La UX futura debe ayudar a tomar decisiones seguras y explicables, no solo a completar formularios. En este módulo, claridad institucional vale más que velocidad ciega de edición.

---

## 10. Seguridad y permisos

El módulo debe operar con un esquema de permisos acorde a su impacto estructural.

### super_admin

Debe tener control total sobre la estructura de asignaciones.

Alcance esperado:

- crear movimientos individuales y masivos
- programar cambios futuros
- activar, suspender y cerrar asignaciones
- ejecutar reasignaciones críticas
- supervisar historial completo

### admin

Debe tener capacidad de supervisión operacional y de ejecutar movimientos dentro de límites definidos.

Alcance esperado:

- visualizar carteras y ownership vigente
- ejecutar movimientos operativos limitados según política institucional
- revisar historial y trazabilidad relevante
- no redefinir libremente movimientos críticos reservados a `super_admin`

### teleoperadora

Debe tener visibilidad acotada a su operación.

Alcance esperado:

- visualizar su propia cartera y su contexto operativo
- entender si existe soporte asociado a sus beneficiarios cuando corresponda
- no ejecutar movimientos estructurales ni reasignaciones de ownership

### Impacto esperado sobre RLS

El modelo de permisos futuro debe proteger que:

- cada rol vea solo lo que le corresponde operacionalmente
- una teleoperadora no pueda alterar ownership ni estructura de cartera
- los movimientos masivos o críticos requieran privilegios acordes a su impacto
- la lectura histórica sensible quede protegida según necesidad institucional

### Protección contra inconsistencias

El esquema de seguridad debe prevenir:

- dobles `PRIMARY` activas por error
- movimientos sin actor responsable identificable
- cambios sin motivo en operaciones críticas
- beneficiarios sin ownership formal cuando el flujo requiere continuidad
- ejecución de cambios por usuarios sin permiso estructural

---

## 11. Integraciones futuras

El diseño del módulo debe quedar preparado para evolucionar sin cambiar su contrato operacional base.

### Imports Excel

Debe poder absorber cargas masivas o actualizaciones de cartera desde fuentes externas sin romper historial ni ownership vigente por error.

### Asignación masiva asistida

Debe poder soportar procesos institucionales de redistribución amplia con reglas explícitas, validaciones previas y trazabilidad completa.

### Sugerencias IA

En el futuro, el sistema podría sugerir redistribuciones o apoyos temporales, pero esas sugerencias no deben reemplazar la decisión institucional ni el registro formal del movimiento.

### Balance automático de carga

El sistema podría evolucionar hacia recomendaciones o automatismos de balance, siempre subordinados a reglas de ownership, permisos y auditabilidad.

### Predicción de sobrecarga operacional

El histórico de asignaciones puede transformarse en insumo para detectar carteras con riesgo de deterioro, rotación excesiva o distribución inestable.

### Principio rector

Las futuras integraciones deben extender la capacidad del módulo, no relativizar sus reglas institucionales.

---

## 12. Conclusión operacional

El módulo de asignaciones no debe concebirse como una herramienta administrativa para editar relaciones entre tablas.

Dentro de Mistatas, constituye el núcleo operacional de ownership, responsabilidad visible, continuidad de cartera y supervisión institucional.

Su diseño debe asegurar que toda cartera tenga responsable formal, que toda rotación pueda explicarse históricamente, que toda lectura ejecutiva descanse sobre ownership real y que ningún cambio estructural ocurra sin trazabilidad suficiente.

En consecuencia, la futura implementación del módulo debe respetar este contrato como base de gobernanza operacional. La plataforma no solo necesita saber quién puede ver un beneficiario. Necesita saber quién responde por él, desde cuándo, bajo qué tipo de vínculo y con qué impacto sobre la operación completa.