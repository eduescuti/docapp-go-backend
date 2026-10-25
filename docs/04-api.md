# API REST

Todas las rutas empiezan con `/api`, reciben y devuelven JSON y, salvo las marcadas como **pública**,
necesitan el header `Authorization: Bearer <token>` (ver [05-sesiones-y-tokens.md](05-sesiones-y-tokens.md)).
Los status y la forma de los errores están en [02-arquitectura.md](02-arquitectura.md#4-respuestas-y-errores).

## El verbo es parte del significado

Como en la práctica de clase: un recurso, varias intenciones.

| Verbo | Intención | Respuesta típica |
|---|---|---|
| `GET` | Leer. Nunca cambia nada. | `200` |
| `POST` | Crear (un turno, una orden, una sesión). | `201` con lo creado |
| `PATCH` | Cambiar una parte (el estado de un turno, archivar). Solo viajan los campos que cambian. | `200` con lo actualizado |
| `PUT` | Reemplazar una lista completa (los planes que acepta una institución). | `200` |
| `DELETE` | Borrar o cerrar (logout, sacar un favorito). | `204` sin body |

## Quién puede qué

`yo` en la ruta = el usuario del token: un paciente **nunca** manda su propio `pacienteId`, lo saca el
servidor de la sesión. Así nadie puede pedir los turnos de otro cambiando un número.

| Rol | Rutas |
|---|---|
| Pública | `GET /api/health`, `POST /api/auth/login`, registro, `GET /api/planes`, `GET /api/especialidades` |
| Paciente | `/api/pacientes/yo/...`, reservar y cancelar turnos, archivar lo suyo, ver sus PDF, feedback |
| Profesional | `/api/medicos/yo/...`, confirmar / rechazar sus turnos, crear órdenes y recetas para sus pacientes |
| Admin | `/api/admin/...` |
| Tercero (laboratorio) | `POST /api/integracion/...` con su clave de integración, sin sesión de usuario |

## Endpoints

### Salud y sesión

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/health` | pública | — | `200 { ok: true }` |
| `POST` | `/api/auth/login` | pública | `{ dni, password }` | `200 { token, expiraEn, sesion }` · `401` · `429` |
| `POST` | `/api/auth/logout` | todos | — | `204` (revoca el token) |
| `GET` | `/api/sesion` | todos | — | `200 sesion` (la misma forma que `Sesion` del frontend) |
| `POST` | `/api/auth/registro/paciente` | pública | `{ nombre, apellido, dni, password, planMedicoId }` | `201 { token, expiraEn, sesion }` · `409` si el DNI ya existe |
| `POST` | `/api/auth/registro/profesional/verificar` | pública | `{ dni, matricula, profesion }` | `200 fichaPadron` · `404` si la terna no está en el padrón o la matrícula no está habilitada |
| `POST` | `/api/auth/registro/profesional` | pública | `{ dni, matricula, profesion, password }` | `201 { token, expiraEn, sesion }` |
| `PATCH` | `/api/auth/contrasena` | todos | `{ actual, nueva }` | `204` (revoca las otras sesiones) |

### Catálogos

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/planes` | pública | Planes con su obra social (el select del registro). |
| `GET` | `/api/especialidades` | pública | Especialidades con subespecialidades. |

### Instituciones (hospitales)

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/instituciones` | paciente | `?tipos=hospital,laboratorio&lat=&lng=&radioKm=&limite=` | Solo las que puede usar: públicas + privadas que aceptan **su** plan (el plan sale de la sesión, no de la query). Ordenadas por distancia si hay `lat/lng`. |
| `GET` | `/api/instituciones/:id` | todos | — | Institución con sedes. |
| `POST` | `/api/admin/instituciones` | admin | `{ nombre, tipo, origen, direccion, ciudad, latitud, longitud, telefono?, planesAceptadosIds }` | `201` institución con su sede. |
| `PUT` | `/api/admin/instituciones/:id/planes` | admin | `{ planesAceptadosIds, fuenteUrl?, verificadoEl? }` | `200` (reemplaza la lista). |

### Obras sociales

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/admin/obras-sociales` | admin | `{ nombre, registro?, codigoOficial?, planes: ["210", "310"] }` | `201` obra social con sus planes · `409` si ya existe. |
| `POST` | `/api/admin/obras-sociales/:id/planes` | admin | `{ nombre }` | `201` plan. |

### Profesionales

| Método | Ruta | Rol | Query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/medicos` | paciente | `?especialidad=&sede=&q=` | Solo los que aceptan su plan (regla 1) y atienden esa especialidad (regla 2). |
| `GET` | `/api/medicos/:id` | todos | — | Perfil público con valoración calculada. |
| `GET` | `/api/medicos/yo` | profesional | — | Perfil: datos del registro + lugares de atención. **Sin horarios.** |
| `PUT` | `/api/medicos/yo/lugares` | profesional | `{ sedeIds }` | `200` (sus lugares de atención). |

### Paciente

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/pacientes/yo` | paciente | — | Paciente con plan y favoritos. |
| `PATCH` | `/api/pacientes/yo` | paciente | `{ planMedicoId }` | `200` (cambia la cobertura). |
| `PUT` | `/api/pacientes/yo/favoritos/instituciones/:id` | paciente | — | `204` (marca). |
| `DELETE` | `/api/pacientes/yo/favoritos/instituciones/:id` | paciente | — | `204` (desmarca). |
| `PUT` / `DELETE` | `/api/pacientes/yo/favoritos/medicos/:id` | paciente | — | `204` |

### Turnos

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/turnos/disponibles` | paciente | `?fecha=2026-11-02&medicos=id1,id2` | `[{ medicoId, sedeId, hora }]` libres ese día, de los profesionales que aceptan su plan. |
| `GET` | `/api/turnos/dias-con-turnos` | paciente | `?desde=&hasta=&medicos=` | `["2026-11-02", …]` |
| `POST` | `/api/turnos` | paciente | `{ medicoId, sedeId, fecha, hora }` | `201` turno **`pendiente`** · `409` si la combinación ya está tomada · `400` si el médico no atiende ahí o no acepta su plan. |
| `GET` | `/api/pacientes/yo/turnos` | paciente | — | `{ proximos, historial }` con médico, especialidad, sede e institución resueltos (`TurnoConDetalle`). |
| `GET` | `/api/pacientes/yo/turnos/proximo` | paciente | — | El próximo confirmado o pendiente (Inicio), o `null`. |
| `PATCH` | `/api/turnos/:id` | paciente dueño | `{ estado: "cancelado" }` | `200` · `409` si ya pasó o no está activo. |
| `PATCH` | `/api/turnos/:id` | profesional del turno | `{ estado: "confirmado" \| "rechazado" }` | `200` · `409` si ya no está `pendiente`. |
| `PATCH` | `/api/turnos/:id` | paciente dueño | `{ ocultoEnHistorial: true }` | `200` ("Eliminar del historial"). |
| `DELETE` | `/api/pacientes/yo/turnos/historial` | paciente | — | `204` ("Eliminar todo": oculta todo el historial). |
| `GET` | `/api/medicos/yo/agenda` | profesional | `?desde=2026-10-01&hasta=2026-10-31` | Turnos del rango con paciente, sede e institución (`TurnoDeAgenda`). Inicio y Agenda. |

El servidor decide qué cambios de estado acepta según **quién** los pide (tabla de transiciones en
[06-reglas-de-negocio.md](06-reglas-de-negocio.md#turnos)). Un `estado` que no corresponde al rol → `403`.

### Ficha del paciente (profesional)

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/medicos/yo/pacientes` | profesional | Pacientes asignados (con turno próximo con él) y su próximo turno. |
| `GET` | `/api/medicos/yo/pacientes/:pacienteId` | profesional | Ficha: paciente, plan, sus turnos con este profesional, recetas y órdenes que él emitió, notas propias. `404` si no hay vínculo por turnos. |
| `POST` | `/api/medicos/yo/pacientes/:pacienteId/notas` | profesional | `{ texto }` → `201`. |

### Órdenes y resultados

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/ordenes` | profesional | `{ pacienteId, institucionId, estudiosSolicitados: string[], indicaciones }` | `201` orden `pendiente` con fecha de hoy · `403` sin vínculo con el paciente. |
| `GET` | `/api/pacientes/yo/ordenes` | paciente | `?archivadas=false` (pestaña) o `true` (carpeta) | Órdenes con médico, especialidad e institución. |
| `PATCH` | `/api/ordenes/:id` | paciente dueño | `{ archivada: true \| false }` | `200` (pone o saca `archivadoEl`). |
| `GET` | `/api/pacientes/yo/resultados` | paciente | `?archivados=false` / `true` | Resultados con su orden, médico e institución. **Sin estado.** |
| `PATCH` | `/api/resultados/:id` | paciente dueño | `{ archivado: true \| false }` | `200` |
| `GET` | `/api/resultados/:id/pdf` | paciente dueño o médico de la orden | — | `200 application/pdf`. Se registra en `registro_auditoria` (regla 8). |
| `POST` | `/api/integracion/ordenes/:ordenId/resultados` | tercero | Body: el PDF (`Content-Type: application/pdf`, máx. 10 MB). Query: `?tipo=&fecha=`. Header `X-Clave-Integracion`. | `201` resultado. Si la orden estaba `pendiente`, pasa a `listo`. |

El PDF viaja como body crudo (no `multipart/form-data`): sin framework, leer un stream binario con límite
es simple; parsear multipart a mano no.

### Recetas

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/recetas` | profesional | `{ pacienteId, medicacion, dosis, frecuencia, duracionDias, indicaciones? }` | `201` receta con `vigenteHasta = hoy + duracionDias`. |
| `GET` | `/api/pacientes/yo/recetas` | paciente | — | `{ activas, pasadas, archivadas }` con médico y especialidad. Cada receta lleva `estado: "activa" \| "pasada"` **calculado**. |
| `PATCH` | `/api/recetas/:id` | paciente dueño | `{ archivada: true \| false }` | `200` · `409` si la receta todavía está activa. |

### Feedback y notificaciones

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/pacientes/yo/feedback/pendientes` | paciente | — | Turnos completados sin calificar. |
| `POST` | `/api/turnos/:id/feedback` | paciente dueño | `{ estrellas, criterios: {…}, comentario? }` | `201` · `409` si ya se calificó · `400` si el turno no está completado. |
| `GET` | `/api/notificaciones` | todos | — | Las del usuario. |
| `PATCH` | `/api/notificaciones/:id` | dueño | `{ leida: true }` | `200` |
| `PATCH` | `/api/notificaciones` | todos | `{ leida: true }` | `204` (marca todas las del usuario). |

### Administración

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/admin/estadisticas` | admin | `{ pacientes, profesionales, total, porObraSocial: [{ aseguradora, cantidad }] }` (Panel). |
| `GET` | `/api/admin/metricas` | admin | `{ turnos, pendientes, valoracionPromedio, turnosPorEstado, turnosPorEspecialidad, turnosPorInstitucion, mejorValorados }` (Métricas). |

## De los services del frontend a la API

Cada función de `frontend/src/services/` pasa a hacer un `fetch` al endpoint de la derecha, con la misma
firma. Las pantallas no cambian.

| Service del frontend | Endpoint |
|---|---|
| `authService.iniciarSesion` / `cerrarSesion` / `getSesionActual` | `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/sesion` |
| `authService.iniciarSesionBiometrica` | Ninguno: la huella desbloquea el token ya guardado en el teléfono y se valida con `GET /api/sesion` (ver [05](05-sesiones-y-tokens.md#ingreso-con-huella)). |
| `authService.cambiarPassword` | `PATCH /api/auth/contrasena` |
| `authService.registrarPaciente` | `POST /api/auth/registro/paciente` |
| `authService.verificarProfesional` / `registrarMedico` | `POST /api/auth/registro/profesional/verificar` · `POST /api/auth/registro/profesional` |
| `planMedicoService.listPlanesMedicos` / `getPlanMedico` | `GET /api/planes` |
| `planMedicoService.crearPlanMedico` | `POST /api/admin/obras-sociales` (o `.../:id/planes` si la obra social ya existe) |
| `especialidadService.listEspecialidades` | `GET /api/especialidades` |
| `institucionService.buscarCentros` / `listInstituciones` | `GET /api/instituciones` |
| `institucionService.crearInstitucion` | `POST /api/admin/instituciones` |
| `institucionService.listLugaresDeAtencion` | incluido en `GET /api/medicos/yo` |
| `medicoService.searchMedicos` / `getMedico` / `getMedicoActual` | `GET /api/medicos` · `GET /api/medicos/:id` · `GET /api/medicos/yo` |
| `pacienteService.getPacienteActual` / `cambiarCobertura` | `GET /api/pacientes/yo` · `PATCH /api/pacientes/yo` |
| `pacienteService.alternarInstitucionFavorita` / `alternarMedicoFavorito` | `PUT` / `DELETE /api/pacientes/yo/favoritos/...` |
| `pacienteService.listPacientesAsignados` | `GET /api/medicos/yo/pacientes` |
| `turnoService.listMisTurnos` / `getProximoTurno` | `GET /api/pacientes/yo/turnos` · `.../proximo` |
| `turnoService.listHorariosLibres` / `listDiasConTurnos` | `GET /api/turnos/disponibles` · `GET /api/turnos/dias-con-turnos` |
| `turnoService.crearTurno` | `POST /api/turnos` |
| `turnoService.cancelarTurno` / `confirmarTurno` / `rechazarTurno` | `PATCH /api/turnos/:id` con el `estado` |
| `turnoService.ocultarTurnoDelHistorial` / `vaciarHistorialTurnos` | `PATCH /api/turnos/:id` · `DELETE /api/pacientes/yo/turnos/historial` |
| `turnoService.listAgendaMedico` | `GET /api/medicos/yo/agenda` |
| `estudioService.listOrdenesPaciente` / `listOrdenesArchivadasPaciente` | `GET /api/pacientes/yo/ordenes?archivadas=` |
| `estudioService.listResultadosPaciente` / `listArchivadosPaciente` | `GET /api/pacientes/yo/resultados?archivados=` |
| `estudioService.archivarOrden` / `desarchivarOrden` | `PATCH /api/ordenes/:id` |
| `estudioService.archivarEstudio` / `desarchivarEstudio` | `PATCH /api/resultados/:id` |
| `estudioService.getResultadoPdf` | `GET /api/resultados/:id/pdf` |
| `estudioService.crearOrden` / `listOrdenesEmitidas` | `POST /api/ordenes` · ficha del paciente |
| `recetaService.listMisRecetas` / `archivarReceta` / `desarchivarReceta` | `GET /api/pacientes/yo/recetas` · `PATCH /api/recetas/:id` |
| `recetaService.crearReceta` / `listRecetasEmitidas` | `POST /api/recetas` · ficha del paciente |
| `notaService.listNotasPaciente` / `crearNotaPaciente` | ficha del paciente · `POST .../notas` |
| `feedbackService.*` | `GET /api/pacientes/yo/feedback/pendientes` · `POST /api/turnos/:id/feedback` |
| `notificacionService.listNotificacionesPaciente` / `marcarNotificacionLeida` / `marcarTodasLeidas` | `GET /api/notificaciones` · `PATCH /api/notificaciones/:id` · `PATCH /api/notificaciones` |
| `estadisticaService.getEstadisticasUso` / `getPacientesPorObraSocial` | `GET /api/admin/estadisticas` |
| `estadisticaService.getMetricasAdmin` | `GET /api/admin/metricas` |
| `resultadosVistos.*` | **Ninguno**: el aviso "Nuevo" de los resultados es solo del frontend. |

## Ejemplo: reservar un turno

```http
POST /api/turnos
Authorization: Bearer 6f1c…
Content-Type: application/json

{ "medicoId": "med-sosa", "sedeId": "sede-10020012315256", "fecha": "2026-11-02", "hora": "10:30" }
```

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{
  "id": "2b0d…",
  "pacienteId": "pac-sofia",
  "medicoId": "med-sosa",
  "sedeId": "sede-10020012315256",
  "especialidadId": "esp-enfermeria",
  "fecha": "2026-11-02",
  "hora": "10:30",
  "estado": "pendiente"
}
```

`pacienteId`, `especialidadId`, `estado` e `id` no viajan en el request: los pone el servidor (el paciente
sale del token, la especialidad del médico y el estado siempre arranca en `pendiente`).

Si otro paciente tomó el horario un segundo antes:

```http
HTTP/1.1 409 Conflict
{ "error": "Ese horario ya no está disponible." }
```
