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
| Pública | `GET /api/health`, `POST /api/auth/login`, registro, `GET /api/planes`, `GET /api/especialidades`, `GET /api/fotos/:archivo` (la URL no se puede adivinar: ver Fotos de perfil) |
| Paciente | `/api/pacientes/yo/...`, reservar y cancelar turnos, archivar lo suyo, ver sus PDF, feedback |
| Profesional | `/api/medicos/yo/...`, confirmar / rechazar sus turnos, crear órdenes y recetas para sus pacientes |
| Admin | `/api/admin/...` |
| Tercero (laboratorio) | `POST /api/integracion/...` con su clave de integración, sin sesión de usuario. **Fuera de este sprint:** los resultados vienen del seed (27/10/2026). |

## Endpoints

### Salud y sesión

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/health` | pública | — | `200 { ok: true }` |
| `POST` | `/api/auth/login` | pública | `{ dni, password }` | `200 { token, expiraEn, sesion }` · `401` · `429` |
| `POST` | `/api/auth/logout` | todos | — | `204` (revoca el token) |
| `GET` | `/api/sesion` | todos | — | `200 sesion` (la misma forma que `Sesion` del frontend) |
| `POST` | `/api/auth/registro/dni` | pública | `{ codigo }` (texto del PDF417 del DNI) | `200 { dni, nombre, apellido }` · `400` si no es un código de DNI · `409` si ese DNI (número o ejemplar) ya tiene cuenta. No guarda nada ([06](06-reglas-de-negocio.md#verificación-de-identidad-del-registro)). |
| `POST` | `/api/auth/registro/paciente` | pública | `{ codigoDni, password, planMedicoId }` | `201 { token, expiraEn, sesion }` · `409` si el DNI ya existe. DNI, nombre y apellido salen del código del DNI. |
| `POST` | `/api/auth/registro/profesional/verificar` | pública | `{ dni, matricula, profesion }` | `200 fichaPadron` · `404` si la terna no está en el padrón o la matrícula no está habilitada · `409` si el DNI ya tiene cuenta. Busca primero en la copia local del padrón (ahí están las fichas de prueba) y, si no está, en el buscador nacional REFEPS en línea (6 s como mucho). |
| `POST` | `/api/auth/registro/profesional` | pública | `{ codigoDni, dni, matricula, profesion, password, genero, especialidadId }` | `201 { token, expiraEn, sesion }`. El DNI escaneado tiene que ser `dni` y de la persona del padrón; la especialidad, de su profesión. Género y especialidad los elige en el registro (decidido el 27/10/2026); lugares, coberturas y horarios, después. |
| `PATCH` | `/api/auth/contrasena` | todos | `{ actual, nueva }` | `204` (revoca las otras sesiones) |

### Catálogos

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/planes` | pública | Obras sociales con sus planes (el registro elige obra social y después plan). |
| `GET` | `/api/especialidades` | pública | Especialidades con su `profesion` y los nombres de sus subespecialidades. |
| `GET` | `/api/profesiones` | pública | Profesiones del padrón (selector del registro de profesional). |

### Instituciones (hospitales)

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/instituciones` | paciente | `?tipos=hospital,laboratorio&lat=&lng=&radioKm=&limite=&sedes=` | `[{ institucion, sede, distanciaKm?, motivo }]` (`CentroCercano`). Con `sedes`, solo esas sedes (el mapa de la reserva). Solo las que puede usar: públicas + privadas que aceptan **su** plan (el plan sale de la sesión, no de la query). Ordenadas por distancia si hay `lat/lng`. Cada una con `coberturas` y `fuenteCoberturas: { fuente, fuenteUrl?, verificadoEl }` (la de sus filas de cobertura; la tarjeta del mapa la muestra). |
| `GET` | `/api/instituciones/:id` | todos | — | Institución con sedes y coberturas. |
| `GET` | `/api/sedes` | todos | `?ids=a,b` | `[{ sede, institucion }]` en ese orden (lugares de atención). |
| `GET` | `/api/sedes/buscar` | todos | `?q=` | Hasta 30 lugares cuyo nombre o dirección contiene el texto (sin tildes). El profesional elige así dónde atiende: a él solo le aparecen los públicos y los que aceptan alguna de sus coberturas. |
| `POST` | `/api/admin/instituciones` | admin | `{ nombre, tipo, origen, direccion, ciudad, latitud, longitud, telefono?, coberturas, fuente, fuenteUrl?, verificadoEl }` | `201` institución con su sede. Si es pública, `coberturas` puede ir vacío. |
| `GET` | `/api/admin/instituciones` | admin | `?q=` | Todas (públicas y privadas) con `coberturas` y `fuenteCoberturas`, buscando por nombre sin tildes; primero las que tienen coberturas. Es la lista de Admin → Instituciones. |
| `GET` | `/api/admin/instituciones/:id/coberturas` | admin | — | Sus coberturas con fuente y fecha. |
| `PUT` | `/api/admin/instituciones/:id/coberturas` | admin | `{ coberturas, fuente, fuenteUrl?, verificadoEl }` | `200` (reemplaza la lista). `coberturas` es `{ obraSocialId, planesIds? }[]`: sin `planesIds` = todos los planes ([08](08-coberturas.md#api)). |

### Obras sociales

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/admin/planes` | admin | `{ obraSocial, plan? }` | `201` plan con su obra social. Si la obra social no existe se crea (con el plan "General" si no se indica otro); si existe, el plan se suma · `409` si ya tiene ese plan. Es lo que hace el formulario de Admin → Obras sociales. |

### Profesionales

| Método | Ruta | Rol | Query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/medicos` | paciente | `?especialidad=&sede=&q=` | Solo los que atienden su cobertura (regla 1: su obra social entera o su plan) y esa especialidad (regla 2). |
| `GET` | `/api/medicos/:id` | todos | — | Perfil público con valoración calculada. |
| `GET` | `/api/medicos/yo` | profesional | — | Perfil: datos del registro + lugares de atención + coberturas que atiende. **Sin horarios.** |
| `PUT` | `/api/medicos/yo/lugares` | profesional | `{ sedeIds }` | `200` (sus lugares de atención). |
| `PUT` | `/api/medicos/yo/coberturas` | profesional | `{ coberturas: { obraSocialId, planesIds? }[] }` | `200` (reemplaza la lista; sin `planesIds` = todos los planes). |

### Paciente

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/pacientes/yo` | paciente | — | Paciente con plan y favoritos. |
| `PATCH` | `/api/pacientes/yo` | paciente | `{ planMedicoId }` | `200` (cambia la cobertura). |
| `PUT` | `/api/pacientes/yo/favoritos/instituciones/:id` | paciente | — | `204` (marca). |
| `DELETE` | `/api/pacientes/yo/favoritos/instituciones/:id` | paciente | — | `204` (desmarca). |
| `PUT` / `DELETE` | `/api/pacientes/yo/favoritos/medicos/:id` | paciente | — | `204` |

### Fotos de perfil

Del paciente y del profesional (27/10/2026). Las entidades `Medico` y `Paciente` traen `avatarUrl` con la ruta
relativa (`/api/fotos/<uuid>.jpg`) o no la traen si no hay foto; la app le agrega la dirección del servidor
(`urlDeLaApi`). Quién la recibe: [06-reglas-de-negocio.md](06-reglas-de-negocio.md#fotos-de-perfil).

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `PUT` | `/api/usuarios/yo/foto` | paciente, profesional | `{ imagen }`: JPG o PNG en base64 (con o sin `data:image/...;base64,`), hasta 1 MB | `{ avatarUrl }`. Reemplaza la anterior y borra su archivo. `400` si no es JPG/PNG (se mira el contenido, no lo que diga el cliente) · `413` si pasa 1 MB. |
| `DELETE` | `/api/usuarios/yo/foto` | paciente, profesional | — | `204`: vuelven a verse las iniciales. |
| `GET` | `/api/fotos/:archivo` | sin token | — | `200 image/jpeg` o `image/png`, con `Cache-Control: private, max-age=31536000, immutable` (el nombre cambia con cada foto). `404` si el nombre no es `<uuid>.jpg/png`, si ya no es la foto de nadie o si la cuenta está desactivada. |

El body de la foto pesa más que el límite general de 100 kb: `index.ts` monta un `express.json` propio para
`/api/usuarios/yo/foto` antes del general. Cambiar o quitar la foto queda en `registro_auditoria`.

### Turnos

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/turnos/disponibles` | paciente | `?fecha=2026-11-02&medicos=id1,id2` | `[{ medicoId, sedeId, hora }]` libres ese día: turnos de 30 min dentro de las **franjas** del profesional, sin los ya tomados ni los que ya pasaron, y solo donde **la sede y el profesional** le aparecen al paciente por su cobertura (la sede también si es pública). |
| `GET` | `/api/turnos/dias-con-turnos` | paciente | `?desde=&hasta=&medicos=` | `["2026-11-02", …]` |
| `POST` | `/api/turnos` | paciente | `{ fecha, hora, sedeId, especialidadId, medicoId }` (los 5 pasos) | `201` turno **`pendiente`** · `400` si la especialidad no es la del profesional · `409` si la combinación ya está tomada o el médico ya tiene un turno a esa hora · `400` si el horario no está en sus franjas, o si la sede o el profesional no le corresponden por su cobertura. |
| `POST` | `/api/turnos/:id/reprogramar` | paciente dueño | `{ sedeId, fecha, hora }` (mismo profesional) | `201` turno nuevo **`pendiente`** con `reprogramadoDesdeId`; el viejo queda `cancelado`, en una sola transacción · `409` si faltan menos de 24 h o el nuevo horario está tomado. |
| `GET` | `/api/pacientes/yo/turnos` | paciente | — | `{ proximos, historial }` con médico, especialidad, sede e institución resueltos (`TurnoConDetalle`). |
| `GET` | `/api/pacientes/yo/turnos/proximo` | paciente | — | El próximo confirmado o pendiente (Inicio), o `null`. |
| `GET` | `/api/pacientes/yo/turnos/todos` | paciente | — | Todos sus turnos (`Turno[]`), también los que sacó del historial: su historial médico y el feedback no cambian. |
| `PATCH` | `/api/turnos/:id` | paciente dueño | `{ estado: "cancelado" }` | `200` · `409` si faltan menos de 24 h, ya pasó o no está activo. |
| `PATCH` | `/api/turnos/:id` | profesional del turno | `{ estado: "confirmado" \| "rechazado" }` | `200` · `409` si ya no está `pendiente`. |
| `PATCH` | `/api/turnos/:id` | paciente dueño | `{ ocultoEnHistorial: true }` | `200` ("Eliminar del historial"). |
| `DELETE` | `/api/pacientes/yo/turnos/historial` | paciente | — | `204` ("Eliminar todo": oculta todo el historial). |
| `GET` | `/api/medicos/yo/agenda` | profesional | `?desde=2026-10-01&hasta=2026-10-31` | Turnos del rango con paciente, sede e institución (`TurnoDeAgenda`). Inicio y Agenda. |
| `GET` | `/api/medicos/yo/franjas` | profesional | — | Sus franjas `[{ id, sedeId, diaSemana, desde, hasta }]`. |
| `PUT` | `/api/medicos/yo/franjas` | profesional | `{ franjas: [{ sedeId, diaSemana, desde, hasta }] }` | `200` (reemplaza todas) · `400` si una sede no es de sus lugares, si `desde`/`hasta` no son múltiplos de 30 min o si dos franjas del mismo día se pisan. Los turnos ya tomados no se tocan. |

El servidor decide qué cambios de estado acepta según **quién** los pide (tabla de transiciones en
[06-reglas-de-negocio.md](06-reglas-de-negocio.md#turnos)). Un `estado` que no corresponde al rol → `403`.

### Ficha del paciente (profesional)

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/medicos/yo/pacientes` | profesional | Pacientes asignados (con turno próximo con él), con su foto (`avatarUrl`), y su próximo turno. |
| `GET` | `/api/medicos/yo/pacientes/:pacienteId/ordenes` | profesional | Órdenes que él le emitió al paciente. |
| `GET` | `/api/medicos/yo/pacientes/:pacienteId/recetas` | profesional | Recetas que él le emitió. |
| `GET` | `/api/medicos/yo/pacientes/:pacienteId/notas` | profesional | Sus notas privadas sobre el paciente (la más nueva primero). |
| `POST` | `/api/medicos/yo/pacientes/:pacienteId/notas` | profesional | `{ texto }` → `201`. |

La ficha se arma con estos pedidos más la agenda (que trae al paciente con su foto y sus turnos con este
profesional). Todos piden **vínculo por turnos**: si el profesional no tiene ningún turno con ese paciente,
`404` (no se confirma que exista).

### Órdenes y resultados

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/ordenes` | profesional | `{ pacienteId, institucionId, estudiosSolicitados: string[], indicaciones }` | `201` orden `pendiente` con fecha de hoy · `403` sin vínculo con el paciente · `400` si la institución no es uno de sus lugares o no le aparece al paciente por su cobertura. |
| `GET` | `/api/pacientes/yo/ordenes` | paciente | `?archivadas=false` (pestaña), `true` (carpeta) o sin parámetro (todas) | `OrdenLaboratorio[]`, de la más reciente a la más vieja. |
| `GET` | `/api/ordenes/:id` | paciente dueño o profesional que la emitió | — | La orden (`404` si no es suya). |
| `PATCH` | `/api/ordenes/:id` | paciente dueño | `{ archivada: true \| false }` | `200` (pone o saca `archivadoEl`). |
| `GET` | `/api/pacientes/yo/resultados` | paciente | `?archivados=false` / `true` / sin parámetro (todos) | `Estudio[]` (médico y paciente son los de la orden). **Sin estado.** |
| `PATCH` | `/api/resultados/:id` | paciente dueño | `{ archivado: true \| false }` | `200` |
| `GET` | `/api/resultados/:id/pdf` | paciente dueño o médico de la orden | — | `200 application/pdf`. Se registra en `registro_auditoria` (regla 8). |
| `POST` | `/api/integracion/ordenes/:ordenId/resultados` | tercero | Body: el PDF (`Content-Type: application/pdf`, máx. 10 MB, con `express.raw`). Query: `?tipo=&fecha=`. Header `X-Clave-Integracion`. | `201` resultado. Si la orden estaba `pendiente`, pasa a `listo`. **Fuera de este sprint.** |

**En este sprint los resultados vienen solo del seed** (decidido el 27/10/2026): el endpoint de
integración queda documentado para más adelante y la tabla `claves_integracion` ya existe para no tener
que migrar después.

### Recetas

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/recetas` | profesional | `{ pacienteId, medicacion, dosis, frecuencia, duracionDias, indicaciones? }` | `201` receta con `vigenteHasta = hoy + duracionDias`. |
| `GET` | `/api/pacientes/yo/recetas` | paciente | — | `{ activas, pasadas, archivadas }` con médico y especialidad (`RecetaConDetalle`; las archivadas en una lista, la app arma las carpetas). Cada receta lleva `estado: "activa" \| "pasada"` **calculado**. |
| `GET` | `/api/pacientes/yo/recetas/todas` | paciente | — | Todas sus recetas, archivadas o no (historial médico). |
| `PATCH` | `/api/recetas/:id` | paciente dueño | `{ archivada: true \| false }` | `200` · `409` si la receta todavía está activa. |

### Feedback y notificaciones

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/pacientes/yo/feedback/pendientes` | paciente | — | Turnos completados sin calificar. |
| `GET` | `/api/pacientes/yo/feedback` | paciente | — | Las calificaciones que ya dejó. |
| `POST` | `/api/turnos/:id/feedback` | paciente dueño | `{ estrellas, criterios?: {…}, comentario? }`: solo `estrellas` es obligatoria; cada criterio que venga, de 1 a 5 | `201` · `409` si ya se calificó · `400` si el turno no está completado. |
| `GET` | `/api/notificaciones` | todos | — | Las del usuario, de la más nueva a la más vieja (hasta 100). |
| `PATCH` | `/api/notificaciones/:id` | dueño | `{ leida: true }` | `204` |
| `PATCH` | `/api/notificaciones` | todos | `{ leida: true }` | `204` (marca todas las del usuario). |

### Administración

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/admin/estadisticas` | admin | `{ uso: { pacientes, profesionales, total }, porObraSocial: [{ obraSocial, cantidad }] }` (Panel; solo obras sociales con pacientes). Sin fotos de pacientes (regla 19). |
| `GET` | `/api/admin/metricas` | admin | `{ turnos, pendientes, valoracionPromedio, turnosPorEstado, turnosPorEspecialidad, turnosPorInstitucion, mejorValorados }` (Métricas). |

## De los services del frontend a la API

Cada función de `frontend/src/services/` pasa a hacer un `fetch` al endpoint de la derecha, con la misma
firma. Las pantallas no cambian.

| Service del frontend | Endpoint |
|---|---|
| `authService.iniciarSesion` / `cerrarSesion` / `getSesionActual` | `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/sesion` |
| `authService.restaurarSesion` (al abrir la app y después de la huella) | `GET /api/sesion`. Ninguno más: la huella desbloquea el token ya guardado en el teléfono y se valida con `GET /api/sesion` (ver [05](05-sesiones-y-tokens.md#ingreso-con-huella)). |
| `authService.cambiarPassword` | `PATCH /api/auth/contrasena` |
| `authService.registrarPaciente` | `POST /api/auth/registro/paciente` |
| `authService.verificarProfesional` / `registrarMedico` | `POST /api/auth/registro/profesional/verificar` · `POST /api/auth/registro/profesional` |
| `planMedicoService.listObrasSociales` / `listPlanesMedicos` / `getPlanMedico` | `GET /api/planes` (obras sociales con sus planes; los otros dos se arman de esa respuesta) |
| `planMedicoService.crearPlanMedico` | `POST /api/admin/planes` |
| `especialidadService.listEspecialidades` | `GET /api/especialidades` |
| `institucionService.buscarCentros` / `listInstituciones` | `GET /api/instituciones` |
| `institucionService.crearInstitucion` | `POST /api/admin/instituciones` |
| `institucionService.listInstituciones` (admin, sin plan) / `getInstitucion` | `GET /api/admin/instituciones?q=` · `GET /api/instituciones/:id` |
| `institucionService.guardarCoberturasInstitucion` | `PUT /api/admin/instituciones/:id/coberturas` |
| `institucionService.listLugaresDeAtencion` / `getSede` / `buscarLugares` | `GET /api/sedes?ids=` · `GET /api/sedes/buscar?q=` |
| `institucionService.listCentrosPorSedes` | `GET /api/instituciones?sedes=` |
| `medicoService.searchMedicos` / `getMedico` / `getMedicoActual` | `GET /api/medicos` · `GET /api/medicos/:id` · `GET /api/medicos/yo` |
| `medicoService.guardarMisCoberturas` / `guardarMisLugares` | `PUT /api/medicos/yo/coberturas` · `PUT /api/medicos/yo/lugares` |
| `franjaService.listMisFranjas` / `guardarMisFranjas` | `GET` / `PUT /api/medicos/yo/franjas` |
| `pacienteService.getPacienteActual` / `cambiarCobertura` | `GET /api/pacientes/yo` · `PATCH /api/pacientes/yo` |
| `pacienteService.alternarInstitucionFavorita` / `alternarMedicoFavorito` | `PUT` / `DELETE /api/pacientes/yo/favoritos/...` |
| `fotoPerfil.guardarFotoPerfil` / `quitarFotoPerfil` | `PUT` / `DELETE /api/usuarios/yo/foto` |
| `fotoPerfil.elegirFotoPerfil` | **Ninguno**: abre la cámara o la galería y deja la foto cuadrada de 512 px en JPEG, en el teléfono. |
| `turnoService.listPacientesAsignados` | `GET /api/medicos/yo/pacientes` |
| `turnoService.listMisTurnos` / `getProximoTurno` | `GET /api/pacientes/yo/turnos` · `.../proximo` |
| `turnoService.listHorariosLibres` / `listDiasConTurnos` | `GET /api/turnos/disponibles` · `GET /api/turnos/dias-con-turnos` |
| `turnoService.crearTurno` / `reprogramarTurno` | `POST /api/turnos` · `POST /api/turnos/:id/reprogramar` |
| `turnoService.cancelarTurno` / `confirmarTurno` / `rechazarTurno` | `PATCH /api/turnos/:id` con el `estado` |
| `turnoService.motivoSinCambios` | Ninguno: la app calcula el plazo de 24 h para deshabilitar los botones; el backend lo vuelve a controlar (`409`). |
| `turnoService.ocultarTurnoDelHistorial` / `vaciarHistorialTurnos` | `PATCH /api/turnos/:id` · `DELETE /api/pacientes/yo/turnos/historial` |
| `turnoService.listAgendaMedico` / `listTurnosMedico` | `GET /api/medicos/yo/agenda` |
| `turnoService.listTurnosPaciente` | `GET /api/pacientes/yo/turnos/todos` |
| `pacienteService.getPaciente` | Ninguno propio: el paciente de la sesión, o el que el profesional tiene en su agenda (vínculo por turnos). |
| `estudioService.listOrdenesPaciente` / `listOrdenesArchivadasPaciente` | `GET /api/pacientes/yo/ordenes?archivadas=` |
| `estudioService.listResultadosPaciente` / `listArchivadosPaciente` | `GET /api/pacientes/yo/resultados?archivados=` |
| `estudioService.archivarOrden` / `desarchivarOrden` | `PATCH /api/ordenes/:id` |
| `estudioService.archivarEstudio` / `desarchivarEstudio` | `PATCH /api/resultados/:id` |
| `estudioService.getResultadoPdf` | `GET /api/resultados/:id/pdf` (con `apiArchivo`, que devuelve el PDF como string binario para el visor) |
| `estudioService.getOrden` | `GET /api/ordenes/:id` |
| `estudioService.crearOrden` / `listOrdenesEmitidas` | `POST /api/ordenes` · `GET /api/medicos/yo/pacientes/:id/ordenes` |
| `recetaService.listMisRecetas` / `archivarReceta` / `desarchivarReceta` | `GET /api/pacientes/yo/recetas` · `PATCH /api/recetas/:id` |
| `recetaService.crearReceta` / `listRecetasEmitidas` | `POST /api/recetas` · `GET /api/medicos/yo/pacientes/:id/recetas` |
| `recetaService.listRecetasPaciente` | `GET /api/pacientes/yo/recetas/todas` |
| `notaService.listNotasPaciente` / `crearNotaPaciente` | `GET` / `POST /api/medicos/yo/pacientes/:id/notas` |
| `feedbackService.*` | `GET /api/pacientes/yo/feedback/pendientes` · `GET /api/pacientes/yo/feedback` · `POST /api/turnos/:id/feedback` |
| `notificacionService.listNotificacionesPaciente` / `marcarNotificacionLeida` / `marcarTodasLeidas` | `GET /api/notificaciones` · `PATCH /api/notificaciones/:id` · `PATCH /api/notificaciones` |
| `estadisticaService.getEstadisticasUso` / `getPacientesPorObraSocial` | `GET /api/admin/estadisticas` |
| `estadisticaService.getMetricasAdmin` | `GET /api/admin/metricas` |
| `resultadosVistos.*` | **Ninguno**: el aviso "Nuevo" de los resultados es solo del frontend. |

## Ejemplo: reservar un turno

```http
POST /api/turnos
Authorization: Bearer 6f1c…
Content-Type: application/json

{ "fecha": "2026-11-02", "hora": "10:30", "sedeId": "sede-10020012315256", "especialidadId": "esp-enfermeria", "medicoId": "med-sosa" }
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

`pacienteId`, `estado` e `id` no viajan en el request: los pone el servidor (el paciente sale del token y el estado
siempre arranca en `pendiente`). `especialidadId` es el paso 4 de la reserva: el servidor revisa que sea la del
médico (si no, `400`).

Si otro paciente tomó el horario un segundo antes:

```http
HTTP/1.1 409 Conflict
{ "error": "Ese horario ya no está disponible." }
```
