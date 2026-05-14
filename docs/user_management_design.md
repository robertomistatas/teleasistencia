# User Management Design

## 1. Propósito del módulo

El módulo de Gestión de Usuarios debe entenderse como infraestructura operacional de la app Seguimientos Mistatas, no como un simple CRUD visible en UI.

Los usuarios no solo representan cuentas de acceso. También representan identidad operativa, permisos, trazabilidad, consistencia visual entre módulos y referencia humana en reportes, auditoría, carteras y documentos PDF.

Un diseño débil de usuarios termina afectando directamente:

- la seguridad de acceso
- la consistencia de roles
- la asignación de cartera
- la legibilidad de auditoría y reporting
- la confianza institucional del producto

Por esta razón, el módulo debe diseñarse como una pieza transversal de arquitectura, con reglas claras de fuente de verdad, permisos, activación, desactivación y nombre visible oficial.

---

## 2. Problemas aprendidos de la app anterior

La app anterior dejó evidencia de varios riesgos que este diseño debe prevenir explícitamente:

- usuarios duplicados entre autenticación y perfil operacional
- inconsistencias entre `auth.users` y `public.profiles`
- uso de email como nombre visible en módulos operativos y reportes
- cambios de rol mal sincronizados
- perfiles incompletos o sin `full_name`
- usuarios visibles en algunos módulos y ausentes o inconsistentes en otros
- creación de usuarios desde UI sin controles suficientes
- pérdida de seriedad institucional en rankings, auditoría y PDFs cuando no existe identidad humana consistente

Estos problemas no son solo de UX. También son problemas de gobernanza operacional y de calidad de datos.

---

## 3. Fuente de verdad

La arquitectura actual ya separa dos responsabilidades y conviene formalizar esa separación.

### Autenticación

- `auth.users` es la fuente de verdad para autenticación
- su responsabilidad principal es acceso, credenciales, sesión e identidad técnica del usuario autenticado

### Identidad operacional

- `public.profiles` es la fuente de verdad para identidad operacional
- su responsabilidad principal es exponer el usuario dentro del negocio y de la UI operativa

### Regla de diseño

- `auth.users.id` y `public.profiles.id` deben representar la misma persona operativa
- `profiles.full_name` es el nombre visible oficial dentro del producto
- `profiles.email` es dato de acceso y contacto, no el nombre principal

La app debe tratar `profiles` como la entidad visible de usuario para operación, asignaciones, auditoría, tablas y reporting.

---

## 4. Regla global de nombre visible

La regla técnica de lectura puede seguir siendo:

`displayName = full_name ?? email`

Sin embargo, esa regla debe entenderse como una protección de fallback y no como comportamiento deseado de negocio.

### Definición operativa

- `full_name` debe ser el identificador visible principal en toda la app
- `email` solo debe usarse como fallback técnico cuando todavía existe deuda de datos
- todo usuario operativo activo debe tener `full_name`

### Implicación

Si un usuario aparece con email en vez de nombre, eso debe interpretarse como una inconsistencia a corregir, no como un resultado normal del sistema.

---

## 5. Modelo de usuario operacional

### Campos requeridos conceptuales

- `id`
- `email`
- `full_name`
- `role`
- `is_active`
- `created_at`
- `updated_at`

### Significado operativo

- `id`: identidad estable y vinculada a autenticación
- `email`: credencial de acceso y medio de contacto
- `full_name`: nombre visible oficial en todos los módulos
- `role`: permiso y alcance operativo dentro del sistema
- `is_active`: habilitación operacional del usuario sin perder historial
- `created_at` y `updated_at`: trazabilidad mínima base

### Campos futuros posibles

- `phone`
- `avatar_url`
- `job_title`
- `team`
- `notes`
- `last_login_at`
- `invited_at`
- `deactivated_at`

Estos campos no son necesarios para v1, pero conviene contemplarlos desde el diseño para evitar rediseños posteriores.

---

## 6. Permisos por rol

### super_admin

Debe tener control completo del módulo de gestión de usuarios.

Permisos esperados:

- crear usuarios
- editar `full_name`
- editar `email` si la estrategia final lo permite
- cambiar roles
- activar y desactivar usuarios
- ver todos los usuarios
- administrar usuarios críticos

### admin

Debe tener visibilidad operativa, pero no control total sobre identidad y seguridad.

Permisos esperados:

- ver usuarios operativos
- eventualmente editar datos no críticos
- no crear `super_admin`
- no cambiar roles críticos sin diseño adicional
- no modificar la estructura de permisos sensibles

### teleoperadora

No debe tener acceso al módulo de gestión de usuarios como feature operativa.

Permisos esperados:

- sin acceso a administración de usuarios
- eventualmente acceso solo a su propio perfil en una futura vista de cuenta

### Principio general

El módulo debe operar bajo el criterio de menor privilegio posible.

---

## 7. Flujo de creación de usuario

El flujo ideal de creación debe ser explícito y seguro.

### Flujo recomendado

1. un `super_admin` inicia la creación desde UI
2. ingresa `email`
3. ingresa `full_name` obligatorio
4. selecciona `role`
5. el sistema crea el usuario en Auth de forma segura
6. el sistema crea o actualiza el `profile` correspondiente
7. el usuario queda activo operacionalmente
8. opcionalmente se envía invitación, correo o mecanismo de activación

### Restricción crítica

La creación de `auth user` no debe hacerse solo desde frontend con `anon key`.

Debe existir un componente seguro con privilegios elevados, por ejemplo:

- una Supabase Edge Function con `service role`
- un endpoint server-side futuro
- otro backend seguro equivalente

### Resultado esperado

La creación debe dejar ambas capas sincronizadas: autenticación e identidad operacional.

---

## 8. Flujo de edición

La edición de usuarios debe ser conservadora y orientada a integridad operativa.

### Debe permitir

- editar `full_name`
- cambiar `role` con restricciones claras
- activar y desactivar usuarios
- actualizar metadatos operativos futuros

### No debe permitir sin diseño adicional

- eliminar usuarios físicamente
- romper historial asociado al usuario
- borrar perfiles que ya tienen asignaciones, seguimientos o trazabilidad vinculada

### Principio general

Editar un usuario no debe comprometer ni la seguridad ni el historial de operación.

---

## 9. Desactivación vs eliminación

El diseño recomendado es desactivar, no borrar.

### Regla principal

- no borrar usuarios operativos
- usar `is_active = false`

### Motivos

- preservar historial
- preservar asignaciones pasadas
- preservar followups y trazabilidad
- evitar referencias rotas en auditoría y reportes

### Comportamiento esperado

- usuarios inactivos deben ocultarse o despriorizarse en selects operativos
- usuarios inactivos no deben aparecer como candidatos principales para nuevas acciones
- el historial asociado debe mantenerse visible cuando sea necesario

---

## 10. Cambio de roles

El cambio de roles debe tratarse como una operación sensible.

### Reglas recomendadas

- solo `super_admin` puede cambiar roles
- debe evitarse que un `super_admin` se quite su propio rol si es el único `super_admin` vigente
- el cambio debe reflejarse de forma consistente en UI, permisos y RLS
- a futuro debe existir audit log específico de este evento

### Criterio de seguridad

Un cambio de rol no es un campo decorativo. Es una alteración de superficie de acceso y de poder operativo.

---

## 11. Relación con carteras y asignaciones

La gestión de usuarios impacta directamente la operación de cartera.

### Reglas operativas

- teleoperadoras inactivas no deben recibir nuevas asignaciones
- si una teleoperadora se desactiva, su cartera debe quedar marcada para reasignación
- las asignaciones históricas no deben borrarse
- la reasignación debe resolverse dentro del módulo de carteras o asignaciones, no destruyendo historial de usuarios

### Principio general

Desactivar un usuario no debe borrar evidencia histórica, pero sí debe cortar su participación operativa futura.

---

## 12. Impacto en Auditoría y PDF

Este módulo tiene impacto directo en Auditoría y en reporting institucional.

### Reglas de presentación

- los reportes deben usar `full_name`
- el email debe aparecer solo como subtítulo o fallback técnico cuando corresponda
- el ranking de teleoperadoras debe mostrar nombre humano
- el PDF no debe depender visualmente del email como identificador principal

### Motivo

Cuando un documento ejecutivo muestra emails como si fueran nombre visible, la percepción institucional cae inmediatamente y se hace evidente una debilidad de gobernanza del sistema.

---

## 13. Reglas anti-duplicados

La prevención de duplicados debe ser explícita desde el diseño.

### Reglas base

- un `auth.user` debe corresponder a un único `profile`
- el email debe ser único
- el `id` de `auth.users` debe ser el mismo `id` en `profiles`
- no debe crearse un `profile` manual sin `auth user`, salvo procesos de backfill controlados
- la creación debe ser transaccional o tener una estrategia clara de compensación si una de las dos capas falla

### Objetivo

Evitar duplicados lógicos, duplicados visuales y divergencias entre acceso y operación.

---

## 14. Estrategia técnica recomendada

### Opción A

Supabase Edge Function con `service role`.

Ventajas:

- alineado con stack actual
- permite creación segura de usuarios
- permite validaciones centralizadas
- evita exponer privilegios en frontend

### Opción B

Endpoint server-side futuro, por ejemplo en Vercel.

Ventajas:

- control total del flujo
- posibilidad de encapsular reglas de negocio adicionales
- buena opción si la app evoluciona hacia backend más propio

### Opción C

Proceso manual temporal desde Supabase.

Uso recomendado:

- solo como medida transitoria
- útil para MVP controlado
- no debe considerarse solución final de producto

### Recomendación

Para producción, la recomendación es usar una Edge Function o un endpoint server-side seguro.

Como estrategia temporal de MVP:

- administrar creación Auth desde Supabase manualmente
- permitir en UI solo edición de `profiles` ya existentes

Esto permite avanzar sin comprometer seguridad ni introducir un flujo débil de alta de usuarios.

---

## 15. Fases de implementación recomendadas

### Fase 1

- listado UI de usuarios
- edición de `full_name`
- edición de `role` con restricciones
- activar y desactivar `profiles` existentes
- no crear `auth user` desde UI todavía

### Fase 2

- creación segura de usuarios con Edge Function o endpoint server-side
- invitación o contraseña temporal
- validaciones anti-duplicados
- sincronización robusta Auth/Profile

### Fase 3

- audit log de cambios de usuarios
- historial de cambios de rol
- últimos accesos
- equipos, supervisores u otras estructuras organizacionales

Esta secuencia permite madurar el módulo sin introducir riesgos prematuros.

---

## 16. Reglas UX

La experiencia de gestión de usuarios debe ser clara y operacional, no técnica.

### Reglas recomendadas

- usar lenguaje claro
- distinguir explícitamente entre nombre visible y correo de acceso
- mostrar advertencias antes de desactivar un usuario
- mostrar impacto potencial sobre carteras y asignaciones
- no exponer detalles internos de Supabase al operador

### Criterio de producto

La UI debe ayudar a administrar personas operativas, no tablas técnicas.

---

## 17. Alcance excluido

Este documento no propone implementar ahora:

- nuevas funciones backend
- Edge Functions concretas
- migraciones nuevas
- invitaciones resueltas end-to-end
- eliminación física de usuarios
- historial detallado de cambios todavía

Tampoco redefine la arquitectura actual. Su propósito es dejar una base de diseño robusta para implementar el módulo de forma segura y consistente con la plataforma existente.

---

## Cierre

La Gestión de Usuarios debe tratarse como un módulo de confianza institucional.

Si este módulo está bien diseñado:

- mejora la seguridad
- mejora la consistencia visual y operativa
- mejora la calidad de auditoría y reporting
- evita duplicados
- evita deuda estructural entre autenticación y operación

Si este módulo se implementa de forma débil:

- reaparecen duplicados
- reaparecen perfiles incompletos
- reaparece el email como nombre visible
- vuelven las inconsistencias entre módulos
- se erosiona la credibilidad del sistema

La recomendación para Mistatas es avanzar por fases, mantener `profiles` como identidad operacional, exigir `full_name` como norma y reservar la creación de usuarios para un flujo seguro con privilegios elevados.