# Sprint 2 — Entrega obligatoria de base de datos

Qué hay que hacer en el backend este sprint, organizado por rol, y qué quedó decidido. Sale de las
notas de planificación del 22/10/2026 (`Sprint2-Notas-de-planificacion.pdf`) y de las decisiones del
25/10/2026.

> **Estado (05/11/2026):** todo lo de esta lista está hecho y la app está conectada entera a la API (desde el
> 28/10/2026): cada service del frontend hace su pedido con `api()` y los mocks de datos se borraron. La
> equivalencia service → endpoint está en [04-api.md](04-api.md#de-los-services-del-frontend-a-la-api). Además se
> sumaron las notificaciones push con Firebase Cloud Messaging (29/10/2026) y el 05/11/2026 se ordenó el backend
> (rutas, servicios en carpetas por tema, `utils/`) y se reescribieron los servicios ([02](02-arquitectura.md#cómo-está-escrito-un-servicio-05112026)).
> Queda afuera, documentado: la carga de PDF por un tercero y la moderación de feedback por el admin.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | Node.js + TypeScript con **Express 5** (estructura de la práctica `Practica17926`), **Prisma 6** con `prisma migrate` y **SQLite**. Decidido el 27/10/2026 (antes `node:http`). Ver [02-arquitectura.md](02-arquitectura.md). |
| Sesiones | **Token opaco** aleatorio, guardado hasheado en la tabla `sesiones`, enviado en `Authorization: Bearer`. Ver [05-sesiones-y-tokens.md](05-sesiones-y-tokens.md). |
| Tipo de consulta | **Se eliminó** de toda la app y no existe en la base. |
| Turnos vencidos | **Automático:** al pasar la fecha y hora, `confirmado` → `completado` y `pendiente` → `rechazado`. |
| Turno cancelado o rechazado | **Libera** el horario: la unicidad se aplica solo a los turnos activos. |
| Estado de una orden | `listo` apenas llega **el primer** resultado ("algún resultado", según las notas). |
| Estado de una receta | **Se calcula** (`vigenteHasta >= hoy` → activa), no se guarda. |
| "Listo" de los resultados | **Solo frontend.** Los resultados no tienen estado en la base. |
| Horarios de atención | Se sacan del perfil. El profesional carga sus **franjas de atención** por lugar y día en su Agenda; se ofrecen turnos de 30 min dentro de ellas, menos los ya tomados (27/10/2026). |
| Sesión | Token opaco en la base, **vence a los 90 días sin usar la app** (queda iniciada mientras se use). En el teléfono, `expo-secure-store`. |
| Coberturas | Obra social con planes opcionales; las de instituciones las carga el admin, las del profesional él mismo. Ver [08-coberturas.md](08-coberturas.md). |
| Diagrama de la base | Vive en este repo: [`docs/diagrama-base-de-datos.html`](diagrama-base-de-datos.html). |

Lo que todavía hay que confirmar está en [07-pendientes.md](07-pendientes.md).

## Checklist

### General

- [x] Proyecto `backend/` con TypeScript, Express 5, Prisma y SQLite, armado como `Practica17926` ([02-arquitectura.md](02-arquitectura.md)).
- [x] Un `express.Router()` por recurso, validación de la entrada en cada ruta, `express.json` con límite, CORS y un manejador de errores que responde siempre `{ error }`.
- [x] `schema.prisma` con todas las tablas de [03-base-de-datos.md](03-base-de-datos.md) y la migración con los índices parciales.
- [x] Seed: catálogo de obras sociales y planes y coberturas verificadas ([08-coberturas.md](08-coberturas.md)), especialidades, establecimientos del REFES de CABA (en `prisma/datos/demo.json`), padrón de profesionales de ejemplo, franjas de atención, usuarios de prueba y resultados con PDF de ejemplo.
- [x] Contraseñas hasheadas con `scrypt` (nada de texto plano como en los mocks del Sprint 1).
- [x] Tokens de sesión: login, logout, expiración, middleware de autenticación y de rol ([05-sesiones-y-tokens.md](05-sesiones-y-tokens.md)).
- [x] Registro de acciones importantes (`registro_auditoria`).

### Paciente

- [x] **Turnos — reservar.** No puede existir otro turno activo con la misma **fecha + horario + hospital + especialidad + médico**, ni dos turnos activos del mismo médico a la misma fecha y hora. Solo se ofrece si la sede y el profesional le aparecen al paciente por su cobertura (la sede también si es pública). Todo turno nuevo nace `pendiente`.
- [x] **Turnos — estados.** `pendiente` → `confirmado` / `rechazado` (lo decide el médico); `cancelado` (lo decide el paciente); `completado` y `rechazado` automáticos al pasar la fecha. Detalle en [06-reglas-de-negocio.md](06-reglas-de-negocio.md#turnos).
- [x] **Turnos — historial.** Los turnos pasados (completados, rechazados, cancelados). "Eliminar del historial" solo oculta (`ocultoEnHistorial`).
- [x] **Turnos — cancelar y reprogramar.** El paciente puede cancelar o reprogramar sus turnos pendientes o confirmados **hasta 24 h antes**. Reprogramar = cancelar el viejo y reservar uno nuevo con el mismo profesional, en una sola operación.
- [x] **Estudios — archivar.** Órdenes y resultados se archivan y desarchivan (`archivadoEl`).
- [x] **Órdenes.** Dos estados: `pendiente` y `listo`.
- [x] **Resultados.** Médico + fecha + hospital + orden + archivo PDF. **Sin estado.** En este sprint los PDF vienen **solo del seed**; la carga por un tercero queda para después (ver [06-reglas-de-negocio.md](06-reglas-de-negocio.md#resultados-y-carga-de-pdf-por-un-tercero)).
- [x] **Recetas.** Nombre + dosis + cómo tomarla + duración + indicación + médico + fecha de emisión. Activa / pasada según la vigencia. Se archivan (solo las pasadas).

### Médico

- [x] **Órdenes.** El médico le asigna una orden al paciente con sus estudios e **indicaciones**; queda vinculada a **hospital + fecha + médico**. El lugar es uno de los suyos que le aparezca al paciente por su cobertura.
- [x] **Recetas.** El médico le asigna una receta al paciente.
- [x] **Confirmar / rechazar** los turnos pendientes de sus pacientes.
- [x] **Agenda.** Todos los turnos del médico (la app arma el calendario del mes) y sus **franjas de atención** por lugar y día.
- [x] **Perfil.** Todos los datos del registro + **lugares de atención** (hospitales) + **coberturas que atiende** (las elige él). **Sin horarios de atención.**

### Administrador

- [x] **Cargar obras sociales** (y sus planes).
- [x] **Cargar hospitales** (institución + sede con dirección y coordenadas) y **editar** qué coberturas aceptan, con fuente y fecha.
- [x] **Métricas.** Turnos por estado, especialidad e institución; profesionales mejor valorados.

### Hospitales

- [x] **Filtro de hospitales por obra social.** Un público se ve siempre (regla 15); un privado, solo si acepta la obra social del paciente (entera o su plan).
- [x] Cada hospital tiene **nombre + dirección + latitud + longitud** (en `instituciones` + `sedes`).

## Orden de trabajo sugerido

1. Esqueleto del servidor como `Practica17926`: `GET /api/health`, `cors`, `express.json`, manejador de errores.
2. `schema.prisma` + migración + seed. Probar con `npx prisma studio`.
3. Autenticación: registro, login, logout, `GET /api/auth/sesion` y el middleware de rol.
4. Lecturas que no cambian nada: planes, especialidades, instituciones filtradas por plan, médicos.
5. Turnos (el núcleo): disponibilidad, reservar, cancelar, confirmar / rechazar, vencimiento.
6. Órdenes, resultados y recetas, con archivado.
7. Admin: alta de obras sociales y hospitales, métricas.
8. Conectar el frontend: cambiar cada service por `fetch` con el token (hecho el 27 y el 28/10/2026).
