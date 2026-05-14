# Assignment Management Implementation Plan

## 1. Objetivo de implementación

La implementación del módulo de Asignaciones y Carteras es crítica porque introduce ownership operacional explícito dentro de Mistatas y convierte una relación de datos existente en una capacidad institucional real.

No se trata solo de mostrar responsables en interfaz. Se trata de establecer una estructura confiable para definir quién responde por cada beneficiario, cómo se supervisa esa responsabilidad y cómo se preserva la trazabilidad cuando la operación cambia.

Este módulo debe implementarse por fases por cuatro razones principales:

- impacta auditoría, riesgo, dashboard, reportes y lectura ejecutiva
- modifica la forma en que la institución interpreta cobertura y accountability
- requiere validaciones estructurales para evitar inconsistencias difíciles de corregir después
- necesita introducir ownership progresivamente sin romper carteras ni métricas vigentes

Una implementación incorrecta puede producir consecuencias institucionales relevantes:

- ownership ambiguo
- dobles responsables oficiales
- carteras sin responsable visible
- métricas ejecutivas contaminadas
- PDF inconsistentes con la operación real
- pérdida de trazabilidad histórica

Por esta razón, la estrategia debe priorizar control, secuencia y validación antes que velocidad de entrega.

---

## 2. Estrategia general de implementación

La filosofía de implementación debe ser conservadora y progresiva.

### Principios rectores

- implementación progresiva y reversible por etapas
- backend primero en reglas y consistencia de ownership
- ownership antes que automatización
- UX operacional antes que conveniencia de edición
- evitar un CRUD simple de asignaciones
- preservar trazabilidad desde el primer release funcional

### Criterio de secuencia

Primero debe consolidarse la lectura correcta del ownership vigente. Después deben habilitarse movimientos individuales controlados. Luego pueden incorporarse soporte temporal, movimientos masivos e histórico expandido.

La automatización futura solo debe entrar cuando la semántica de ownership, soporte, estados y permisos ya esté estabilizada.

### Qué no debe implementarse todavía

En esta etapa no conviene introducir:

- automatización inteligente de reasignaciones
- balance automático de carga con ejecución autónoma
- reglas predictivas que alteren ownership sin intervención humana
- imports masivos con mutación estructural sin validaciones institucionales previas
- scheduler automático de activación de movimientos futuros sin control administrativo explícito

### Regla estratégica

El primer objetivo no es mover carteras más rápido. El primer objetivo es moverlas correctamente, con ownership claro, lectura ejecutiva estable y trazabilidad completa.

---

## 3. Roadmap por fases

El roadmap debe ejecutarse en una secuencia que reduzca riesgo y permita consolidar cada capa antes de abrir la siguiente.

### Fase 1 — Visualización operacional de carteras

#### Objetivo

Exponer la lectura oficial de ownership vigente sin alterar todavía la estructura operativa mediante movimientos complejos.

#### Alcance

- mostrar cartera vigente por responsable
- mostrar ownership `PRIMARY` como referencia oficial
- mostrar detalle por beneficiario dentro de cada cartera
- habilitar filtros y lectura operacional base
- preparar la semántica visible de tipos y estados de asignación

#### Riesgos

- exponer datos sin semántica clara de ownership
- mezclar soporte futuro con cartera oficial
- mostrar una vista que parezca editable sin tener todavía reglas sólidas

#### Dependencias

- contrato operacional definido
- lectura consistente de perfiles operativos
- interpretación estable de `beneficiary_assignments`

#### Impacto transversal

- establece base para dashboard y supervisión
- prepara consistencia futura con auditoría y PDF
- introduce lenguaje institucional de ownership visible

#### Criterios de finalización

- la cartera oficial puede leerse con claridad por responsable
- `PRIMARY` es visible como ownership ejecutivo oficial
- la vista no induce interpretaciones ambiguas sobre soporte o cambios futuros

### Fase 2 — Movimientos individuales

#### Objetivo

Permitir reasignaciones individuales controladas con trazabilidad completa.

#### Alcance

- mover un beneficiario entre responsables
- cerrar una asignación vigente y abrir la nueva relación correspondiente
- registrar motivo, actor y fecha efectiva
- reflejar el nuevo ownership sin perder historial

#### Riesgos

- sobrescribir asignaciones históricas
- permitir dobles `PRIMARY`
- dejar beneficiarios sin ownership vigente
- contaminar métricas ejecutivas por fechas mal aplicadas

#### Dependencias

- Fase 1 estable
- validaciones de ownership definidas
- permisos mínimos para movimientos críticos

#### Impacto transversal

- auditoría comienza a depender de la historia real de movimientos
- dashboard empieza a reflejar ownership dinámico
- supervisión gana trazabilidad real de cambios individuales

#### Criterios de finalización

- todo movimiento individual conserva historial
- no se generan dobles `PRIMARY`
- el cambio se refleja correctamente en lectura vigente y en historial

### Fase 3 — Soporte temporal

#### Objetivo

Introducir soporte operacional sin alterar el ownership institucional principal.

#### Alcance

- agregar asignaciones `SUPPORT`
- visualizar soporte coexistente con `PRIMARY`
- finalizar soporte sin romper la asignación oficial
- explicitar temporalidad y propósito del apoyo

#### Riesgos

- interpretar soporte como transferencia de cartera
- contaminar métricas ejecutivas con responsables secundarios
- generar confusión en supervisión sobre quién responde oficialmente

#### Dependencias

- Fase 2 estable
- lenguaje de ownership ya comprendido por la plataforma
- reglas de lectura diferenciada entre `PRIMARY` y `SUPPORT`

#### Impacto transversal

- mejora continuidad operativa en contingencias
- fortalece supervisión sin romper lectura ejecutiva
- prepara futuros escenarios de balance y cobertura temporal

#### Criterios de finalización

- soporte puede coexistir sin alterar ownership oficial
- auditoría y dashboard siguen leyendo `PRIMARY` como fuente ejecutiva
- el soporte queda trazado como intervención temporal y no como reemplazo implícito

### Fase 4 — Reasignación masiva

#### Objetivo

Habilitar rotaciones de cartera de mayor escala con control institucional estricto.

#### Alcance

- mover grupos de beneficiarios
- transferir cartera completa cuando corresponda
- mostrar impacto previo a confirmar
- registrar movimientos masivos con motivo y actor responsable

#### Riesgos

- afectar grandes volúmenes con un error de configuración
- desbalancear carga operativa sin visibilidad suficiente
- ejecutar cambios irreversibles sin confirmación adecuada
- romper consistencia entre ownership vigente y métricas del período

#### Dependencias

- Fases 1 a 3 consolidadas
- reglas claras de validación masiva
- permisos reforzados para operaciones de alto impacto

#### Impacto transversal

- modifica lectura de carga por teleoperadora
- afecta ranking, cobertura y supervisión estructural
- introduce necesidad de explicabilidad fuerte ante auditoría y gerencia

#### Criterios de finalización

- el sistema presenta impacto visible antes de ejecutar la rotación
- todo movimiento masivo queda auditable
- no se producen carteras huérfanas ni duplicidad de ownership oficial

### Fase 5 — Auditoría histórica avanzada

#### Objetivo

Expandir la lectura histórica del módulo para supervisión avanzada y análisis institucional.

#### Alcance

- vista histórica de ownership
- historial por beneficiario y por responsable
- lectura de movimientos recientes
- capacidad de reconstruir rotaciones y continuidad operacional

#### Riesgos

- mezclar historia con vigencia actual en la UI
- introducir lecturas difíciles de interpretar por usuarios no técnicos
- mostrar historia incompleta o sin contexto suficiente

#### Dependencias

- historial consistente generado en fases previas
- semántica de tipos, estados y movimientos estabilizada

#### Impacto transversal

- fortalece auditoría institucional
- mejora análisis de riesgo y sobrecarga
- respalda reportes ejecutivos con narrativa histórica confiable

#### Criterios de finalización

- la historia de una cartera puede reconstruirse sin ambigüedad
- supervisión puede explicar cambios estructurales con respaldo del sistema
- la vista histórica no altera la lectura del ownership vigente

### Fase 6 — Automatización futura

#### Objetivo

Dejar preparado el módulo para evolucionar hacia asistencia inteligente y automatización supervisada.

#### Alcance

- puntos de extensión para sugerencias
- preparación conceptual para programación futura de movimientos
- soporte para futuras recomendaciones de balance y carga

#### Riesgos

- automatizar antes de estabilizar reglas institucionales
- degradar accountability humana
- confundir sugerencia con decisión formal

#### Dependencias

- fases anteriores consolidadas
- ownership y trazabilidad totalmente confiables

#### Impacto transversal

- habilita evolución del producto sin rediseño conceptual
- prepara integración con capacidades avanzadas de supervisión

#### Criterios de finalización

- el módulo queda listo para extensiones futuras sin comprometer su contrato base
- toda automatización potencial permanece subordinada a aprobación institucional

---

## 4. Arquitectura frontend esperada

La futura implementación frontend debe organizarse como un feature autónomo y legible, alineado con la estructura ya usada en la aplicación.

### Estructura conceptual sugerida

`src/features/assignments/`

Subestructuras esperadas:

- `pages/`: pantallas principales del módulo
- `components/`: bloques reutilizables de lectura operacional
- `dialogs/`: confirmaciones y flujos críticos de movimiento
- `data.ts`: capa de acceso y transformación de datos del módulo
- `types.ts`: contratos de tipos del feature
- `utils/`: helpers semánticos de ownership, etiquetas, warnings y validaciones de presentación

### Piezas conceptuales esperadas

#### pages/

- vista global de carteras
- vista por teleoperadora
- vista de historial de asignaciones
- vista de movimientos recientes

#### components/

- tabla o lista de cartera
- resumen de ownership actual
- indicadores de carga
- bloque de historial resumido
- badges de tipo y estado de asignación

#### dialogs/

- confirmación de movimiento individual
- confirmación de soporte temporal
- cierre de asignación
- confirmación de reasignación masiva
- programación de movimiento futuro

### Principio de arquitectura

El módulo no debe dispersar su lógica entre múltiples features. La semántica de ownership debe vivir concentrada en una sola área funcional para reducir ambigüedad y duplicación interpretativa.

---

## 5. UX operacional esperada

La UX futura debe diseñarse para operar carteras con claridad institucional, no para editar registros aislados.

### Vistas necesarias

#### Vista global de carteras

Debe permitir entender distribución general, responsables oficiales, carga relativa y estado operacional del universo asignado.

#### Vista por teleoperadora

Debe permitir revisar composición de cartera, ownership `PRIMARY`, presencia de soporte y posibles señales de sobrecarga o desbalance.

#### Vista historial

Debe permitir reconstruir cambios de ownership y soporte sin confundir vigencia actual con historia cerrada.

#### Vista movimientos recientes

Debe permitir supervisar actividad reciente del módulo, especialmente cambios individuales y masivos con su motivo asociado.

#### Vista soporte temporal

Debe permitir distinguir con claridad qué beneficiarios tienen apoyo adicional y cuál sigue siendo la responsable oficial.

### Acciones críticas

- mover beneficiario
- agregar soporte
- finalizar soporte
- programar movimiento
- cerrar asignación

### Confirmaciones indispensables

Toda acción crítica debe mostrar antes de confirmar:

- warnings institucionales relevantes
- impacto visible sobre ownership
- cantidad de afectados cuando aplique
- responsable resultante
- fecha efectiva del cambio
- efecto esperado sobre trazabilidad y lectura ejecutiva

### Principio de interacción

La interfaz debe obligar a comprender el efecto de la acción antes de ejecutarla. En este módulo, la prevención de errores vale más que la rapidez de clics.

---

## 6. Validaciones funcionales

Las validaciones deben distribuirse en varias capas. El frontend puede guiar y advertir, pero la consistencia estructural debe protegerse también en backend y en restricciones de datos futuras.

### Validaciones funcionales globales

- no permitir dobles `PRIMARY` activas para un mismo beneficiario
- evitar beneficiarios huérfanos sin ownership efectivo cuando corresponda continuidad
- validar que la usuaria destino esté activa operacionalmente
- validar impacto de carga antes de movimientos relevantes
- validar fechas de inicio, término y programación
- validar que el ownership resultante sea explícito y no ambiguo

### Validaciones frontend

- impedir confirmación cuando falte motivo en acciones críticas
- advertir cuando un movimiento cierre una `PRIMARY` vigente
- advertir cuando la fecha elegida afecte cartera ya visible en métricas actuales
- mostrar claramente si la acción crea `PRIMARY`, `SUPPORT` o un movimiento programado
- exigir confirmación reforzada en movimientos masivos o de alto impacto

### Validaciones backend esperadas

- rechazar creación de estados incompatibles con ownership vigente
- rechazar movimientos que dejen inconsistencias estructurales
- garantizar actor responsable identificable
- preservar historial en vez de sobrescribir registros operativos previos
- asegurar que la lectura vigente y la histórica permanezcan coherentes

### Restricciones DB futuras

- unicidad efectiva de `PRIMARY` activa por beneficiario
- integridad de fechas entre asignaciones activas, terminadas y programadas
- relación válida con perfiles activos y existentes
- prohibición de eliminación destructiva de historial relevante

### Regla de diseño

La validación no debe depender de una sola capa. Un módulo tan sensible requiere defensa en profundidad.

---

## 7. Impacto transversal esperado

Cada fase del módulo modifica cómo el resto de la plataforma interpreta responsabilidad y cobertura.

### Auditoría

- Fase 1 ordena la lectura de cartera oficial
- Fase 2 incorpora ownership dinámico real
- Fase 5 permite reconstrucción histórica de responsabilidad

La auditoría debe seguir leyendo ownership `PRIMARY` como fuente oficial ejecutiva.

### Riesgo

- mejora responsable visible de cada caso crítico
- permite agrupar riesgo por cartera real y no solo por supuesto operativo
- fortalece priorización de supervisión cuando hay cambios de estructura

### PDF

- refuerza consistencia del responsable institucional mostrado
- permite explicar cambios de cartera entre distintos cortes
- evita reportes ejecutivos basados en ownership ambiguo

### Dashboard

- habilita métricas de carga por cartera con mayor precisión
- mejora comparativas entre responsables
- permite lecturas futuras de balance y distribución sin reinterpretación manual

### Teleoperadora

- mejora visibilidad de su cartera vigente
- aclara cuándo existe soporte sin transferirle o quitarle ownership por error
- evita confusión entre colaboración temporal y responsabilidad formal

### Supervisión

- gana trazabilidad explícita de decisiones operativas
- puede explicar rotaciones, contingencias y redistribuciones
- adquiere una base más sólida para accountability institucional

---

## 8. Estrategia de migración operacional

La transición desde el estado actual hacia ownership operacional completo debe hacerse sin romper la lectura vigente del sistema.

### Principio base

El sistema debe introducir ownership formal progresivamente, manteniendo continuidad en métricas, auditoría, PDF, dashboard y carteras activas.

### Secuencia recomendada de migración

1. consolidar la lectura actual de cartera vigente sin cambiar todavía la lógica operativa visible
2. introducir la semántica explícita de `PRIMARY` como ownership oficial
3. habilitar movimientos individuales controlados y verificar que no alteren métricas ejecutivas de forma inconsistente
4. incorporar `SUPPORT` sin modificar la lectura ejecutiva principal
5. habilitar movimientos masivos solo cuando la trazabilidad individual ya esté estabilizada
6. ampliar lectura histórica cuando ya exista suficiente consistencia operativa en los movimientos reales

### Criterios para no romper operación existente

- mantener `PRIMARY` como fuente oficial ejecutiva desde el momento en que se formalice
- evitar reinterpretaciones retroactivas no auditables
- no introducir soporte como sustituto silencioso de ownership
- no alterar dashboards ni PDF con reglas transitorias poco claras
- asegurar que la cartera visible siga siendo entendible para supervisión en todo momento

### Enfoque de cambio progresivo

La implementación debe introducir capacidades nuevas sin invalidar la lectura actual. Cada fase debe convivir con la operación existente hasta demostrar consistencia suficiente para habilitar la siguiente.

---

## 9. Seguridad y permisos

Los permisos deben crecer junto con la madurez del módulo, no abrirse completamente desde el primer día.

### super_admin

Implementación progresiva sugerida:

- Fase 1: visibilidad total de carteras y ownership
- Fase 2: movimientos individuales completos
- Fase 3: creación y cierre de soporte temporal
- Fase 4: reasignaciones masivas y movimientos críticos
- Fase 5: acceso integral a historial avanzado

### admin

Implementación progresiva sugerida:

- Fase 1: visibilidad operativa amplia
- Fase 2: movimientos individuales dentro de límites definidos
- Fase 3: gestión acotada de soporte temporal si la política lo permite
- Fase 4: participación limitada o supervisada en movimientos masivos
- Fase 5: acceso histórico relevante para supervisión

### teleoperadora

Implementación progresiva sugerida:

- Fase 1: visualización de su cartera vigente
- Fase 2: sin capacidad de reasignar ownership estructural
- Fase 3: eventual visibilidad de soporte asociado a su operación
- Fase 4 en adelante: sin acceso a movimientos masivos ni cambios estructurales

### Regla general

La plataforma debe aplicar el principio de menor privilegio y reservar los cambios estructurales a roles con responsabilidad institucional suficiente.

---

## 10. Riesgos arquitectónicos

La implementación debe reconocer explícitamente los riesgos estructurales del módulo y diseñarse para contenerlos.

### Pérdida de trazabilidad

Riesgo:

- sobrescribir relaciones vigentes en vez de registrar movimientos

Mitigación:

- preservar historia desde el inicio y tratar cada cambio como evento auditable

### Ownership ambiguo

Riesgo:

- no dejar claro quién es la responsable oficial después de un cambio

Mitigación:

- visibilizar siempre el `PRIMARY` resultante y exigir confirmación previa

### Doble PRIMARY

Riesgo:

- generar dos responsables oficiales simultáneas para un mismo beneficiario

Mitigación:

- validar unicidad en frontend, backend y restricciones futuras de datos

### Soporte mal interpretado

Riesgo:

- que `SUPPORT` sea leído como transferencia silenciosa de ownership

Mitigación:

- separar visual y semánticamente soporte de ownership ejecutivo

### Métricas contaminadas

Riesgo:

- alterar dashboards o comparativas con reglas de asignación inconsistentes

Mitigación:

- mantener `PRIMARY` como fuente oficial ejecutiva y evitar mezclar soporte en métricas centrales

### PDF inconsistente

Riesgo:

- que el reporte muestre responsables que no coinciden con ownership institucional del período

Mitigación:

- alinear lectura de reportes con la semántica oficial de ownership y trazabilidad temporal

### Movimientos destructivos

Riesgo:

- ejecutar reasignaciones que borren contexto o rompan continuidad operativa

Mitigación:

- usar cierres y aperturas trazables, no eliminación destructiva

### Carteras huérfanas

Riesgo:

- dejar beneficiarios sin responsable visible durante rotaciones o contingencias

Mitigación:

- validar ownership efectivo antes de confirmar cualquier cierre estructural

---

## 11. Preparación para escalamiento futuro

El módulo debe implementarse de forma que soporte crecimiento posterior sin rediseñar su base institucional.

### IA operacional

Debe poder recibir sugerencias futuras de distribución o apoyo, siempre subordinadas a revisión humana y registro formal.

### Balance automático

Debe poder evolucionar hacia recomendaciones de equilibrio de carga sin alterar por sí solo el ownership oficial.

### Sugerencias inteligentes

Debe poder incorporar señales de sobrecarga, rotación o riesgo para apoyar a supervisión, no para reemplazar su criterio.

### Import masivo

Debe quedar preparado para absorber procesos de actualización amplia con control de trazabilidad y validaciones previas.

### Scheduler

Debe poder soportar en el futuro movimientos programados con ejecución controlada, sin romper el principio de accountability institucional.

### Supervisión avanzada

Debe quedar listo para alimentar lecturas históricas, análisis de rotación, detección de sobrecarga y seguimiento de decisiones operativas.

### Regla de preparación

Escalar no significa automatizar prematuramente. Significa dejar la base preparada para crecer sin comprometer ownership, auditabilidad ni coherencia ejecutiva.

---

## 12. Conclusión estratégica

El módulo de Asignaciones y Carteras debe implementarse como infraestructura operacional central de Mistatas.

Su valor no está en permitir mover beneficiarios más rápido, sino en permitir que la institución sepa con claridad quién responde por cada caso, cómo cambió esa responsabilidad en el tiempo y qué efecto tiene sobre supervisión, cobertura, riesgo y reporting.

Por eso requiere gobernanza fuerte, secuencia gradual y validaciones estructurales desde el primer momento. El ownership institucional debe prevalecer sobre la velocidad de edición y sobre cualquier tentación de resolver el problema con un CRUD genérico.

La implementación correcta será aquella que introduzca poder operativo real sin sacrificar trazabilidad, consistencia ejecutiva ni estabilidad de la operación existente.