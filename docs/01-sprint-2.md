# Sprint 2 — Entrega obligatoria de base de datos

Qué hay que hacer en el backend este sprint, organizado por rol, y qué quedó decidido. Sale de las
notas de planificación del 22/10/2026 (`Sprint2-Notas-de-planificacion.pdf`) y de las decisiones del
25/10/2026.

> El frontend ya quedó adaptado a todo esto (repo `docapp-go`). Los `services/` del frontend siguen
> leyendo mocks, pero con las mismas reglas y la misma forma de datos que tiene que devolver esta API:
> cuando el backend esté, cada service cambia su implementación interna por un `fetch`, sin tocar las
> pantallas. La equivalencia service → endpoint está en [04-api.md](04-api.md#de-los-services-del-frontend-a-la-api).

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | Node.js + TypeScript con el módulo nativo **`node:http`** (sin Express ni otro framework), **Prisma** como acceso a datos y **SQLite** como base. Ver [02-arquitectura.md](02-arquitectura.md). |
| Sesiones | **Token opaco** aleatorio, guardado hasheado en la tabla `sesiones`, enviado en `Authorization: Bearer`. Ver [05-sesiones-y-tokens.md](05-sesiones-y-tokens.md). |
| Tipo de consulta | **Se eliminó** de toda la app y no existe en la base. |
| Turnos vencidos | **Automático:** al pasar la fecha y hora, `confirmado` → `completado` y `pendiente` → `rechazado`. |
| Turno cancelado o rechazado | **Libera** el horario: la unicidad se aplica solo a los turnos activos. |
| Estado de una orden | `listo` apenas llega **el primer** resultado ("algún resultado", según las notas). |
| Estado de una receta | **Se calcula** (`vigenteHasta >= hoy` → activa), no se guarda. |
| "Listo" de los resultados | **Solo frontend.** Los resultados no tienen estado en la base. |
| Horarios de atención | Se sacan del perfil del profesional. La disponibilidad sale de una grilla fija de turnos y de los turnos ya tomados. |
| Diagrama de la base | Vive en este repo: [`docs/diagrama-base-de-datos.html`](diagrama-base-de-datos.html). |

Lo que todavía hay que confirmar está en [07-pendientes.md](07-pendientes.md).

## Checklist

### General

- [ ] Proyecto `backend/` con TypeScript, `node:http`, Prisma y SQLite ([02-arquitectura.md](02-arquitectura.md)).
- [ ] Router propio con parámetros de ruta (`/api/turnos/:id`), lectura del body JSON con límite de tamaño, CORS con preflight `OPTIONS`, respuestas y errores JSON uniformes.
- [ ] `schema.prisma` con todas las tablas de [03-base-de-datos.md](03-base-de-datos.md) y la migración con los índices parciales.
- [ ] Seed: obras sociales y planes, especialidades, establecimientos del REFES de CABA (el mismo JSON que usa el frontend), padrón de profesionales de ejemplo y los usuarios de prueba.
- [ ] Contraseñas hasheadas con `scrypt` (nada de texto plano como en los mocks del Sprint 1).
- [ ] Tokens de sesión: login, logout, expiración, middleware de autenticación y de rol ([05-sesiones-y-tokens.md](05-sesiones-y-tokens.md)).
- [ ] Registro de acciones importantes (`registro_auditoria`).

### Paciente

- [ ] **Turnos — reservar.** No puede existir otro turno activo con la misma **fecha + horario + hospital + especialidad + médico**. Todo turno nuevo nace `pendiente`.
- [ ] **Turnos — estados.** `pendiente` → `confirmado` / `rechazado` (lo decide el médico); `cancelado` (lo decide el paciente); `completado` y `rechazado` automáticos al pasar la fecha. Detalle en [06-reglas-de-negocio.md](06-reglas-de-negocio.md#turnos).
- [ ] **Turnos — historial.** Los turnos pasados (completados, rechazados, cancelados). "Eliminar del historial" solo oculta (`ocultoEnHistorial`).
- [ ] **Turnos — cancelar.** El paciente puede cancelar sus turnos pendientes o confirmados que todavía no pasaron.
- [ ] **Estudios — archivar.** Órdenes y resultados se archivan y desarchivan (`archivadoEl`).
- [ ] **Órdenes.** Dos estados: `pendiente` y `listo`.
- [ ] **Resultados.** Médico + fecha + hospital + orden + archivo PDF. **Sin estado.** Los PDF los carga un tercero (ver [06-reglas-de-negocio.md](06-reglas-de-negocio.md#resultados-y-carga-de-pdf-por-un-tercero)).
- [ ] **Recetas.** Nombre + dosis + cómo tomarla + duración + indicación + médico + fecha de emisión. Activa / pasada según la vigencia. Se archivan (solo las pasadas).

### Médico

- [ ] **Órdenes.** El médico le asigna una orden al paciente con sus estudios e **indicaciones**; queda vinculada a **hospital + fecha + médico**.
- [ ] **Recetas.** El médico le asigna una receta al paciente.
- [ ] **Confirmar / rechazar** los turnos pendientes de sus pacientes.
- [ ] **Agenda.** Turnos del médico por rango de fechas (calendario del mes).
- [ ] **Perfil.** Todos los datos del registro + **lugares de atención** (hospitales). **Sin horarios de atención.**

### Administrador

- [ ] **Cargar obras sociales** (y sus planes).
- [ ] **Cargar hospitales** (institución + sede con dirección y coordenadas) y qué planes los aceptan.
- [ ] **Métricas.** Turnos por estado, especialidad e institución; profesionales mejor valorados.

### Hospitales

- [ ] **Filtro de hospitales por obra social.** Un público se ve siempre (regla 15); un privado, solo si acepta el plan del paciente.
- [ ] Cada hospital tiene **nombre + dirección + latitud + longitud** (en `instituciones` + `sedes`).

## Orden de trabajo sugerido

1. Esqueleto del servidor: `GET /api/health`, router, body JSON, errores, CORS.
2. `schema.prisma` + migración + seed. Probar con `npx prisma studio`.
3. Autenticación: registro, login, logout, `GET /api/sesion` y el middleware de rol.
4. Lecturas que no cambian nada: planes, especialidades, instituciones filtradas por plan, médicos.
5. Turnos (el núcleo): disponibilidad, reservar, cancelar, confirmar / rechazar, vencimiento.
6. Órdenes, resultados y recetas, con archivado.
7. Admin: alta de obras sociales y hospitales, métricas.
8. Conectar el frontend: cambiar cada service por `fetch` con el token.
