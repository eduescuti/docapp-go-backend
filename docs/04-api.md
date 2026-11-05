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
| Pública | `GET /api/health`, `POST /api/auth/login`, registro, `GET /api/catalogos/planes`, `GET /api/catalogos/especialidades`, `GET /api/fotos/:archivo` (la URL no se puede adivinar: ver Fotos de perfil) |
| Paciente | `/api/pacientes/yo/...`, reservar y cancelar turnos, archivar lo suyo, ver sus PDF, feedback |
| Profesional | `/api/medicos/yo/...`, confirmar / rechazar sus turnos, crear órdenes y recetas para sus pacientes |
| Admin | `/api/admin/...` |
| Tercero (laboratorio) | `POST /api/integracion/...` con su clave de integración, sin sesión de usuario. **Fuera de este sprint:** los resultados vienen del seed (27/10/2026). |

## Endpoints

### Salud y sesión

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/health` | pública | — | `200 { ok: true }` |
| `POST` | `/api/auth/login` | pública | `{ dni, password }` | `200 { token, expiraEn, sesion }` · `400` DNI que no tiene 7 u 8 dígitos · `401` · `429` |
| `POST` | `/api/auth/logout` | todos | — | `204` (revoca el token) |
| `GET` | `/api/auth/sesion` | todos | — | `200 sesion` (la misma forma que `Sesion` del frontend) |
| `POST` | `/api/auth/registro/dni` | pública | `{ codigo }` (texto del PDF417 del DNI) | `200 { dni, nombre, apellido }` · `400` si no es un código de DNI · `409` si ese DNI (número o ejemplar) ya tiene cuenta. No guarda nada ([06](06-reglas-de-negocio.md#verificación-de-identidad-del-registro)). |
| `POST` | `/api/auth/registro/paciente` | pública | `{ codigoDni, password, planMedicoId }` | `201 { token, expiraEn, sesion }` · `409` si el DNI ya existe. DNI, nombre y apellido salen del código del DNI. |
| `POST` | `/api/auth/registro/profesional/verificar` | pública | `{ dni, matricula, profesion }` | `200 fichaPadron` · `404` si la terna no está en el padrón o la matrícula no está habilitada · `409` si el DNI ya tiene cuenta. Busca primero en la copia local del padrón (ahí están las fichas de prueba) y, si no está, en el buscador nacional REFEPS en línea (6 s como mucho). |
| `POST` | `/api/auth/registro/profesional` | pública | `{ codigoDni, dni, matricula, profesion, password, genero, especialidadId }` | `201 { token, expiraEn, sesion }`. El DNI escaneado tiene que ser `dni` y de la persona del padrón; la especialidad, de su profesión. Género y especialidad los elige en el registro (decidido el 27/10/2026); lugares, coberturas y horarios, después. |
| `PATCH` | `/api/auth/contrasena` | todos | `{ actual, nueva }` | `204` (revoca las otras sesiones) |

### Catálogos

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/catalogos/planes` | pública | Obras sociales con sus planes (el registro elige obra social y después plan). |
| `GET` | `/api/catalogos/especialidades` | pública | Especialidades con su `profesion` y los nombres de sus subespecialidades. |
| `GET` | `/api/catalogos/profesiones` | pública | Profesiones del padrón (selector del registro de profesional). |

### Instituciones (hospitales)

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/instituciones` | paciente | `?tipos=hospital,laboratorio&lat=&lng=&sedes=` | `[{ institucion, sede, distanciaKm?, motivo }]` (`CentroCercano`). Con `sedes`, solo esas sedes (el mapa de la reserva). Solo las que puede usar: públicas + privadas que aceptan **su** plan (el plan sale de la sesión, no de la query). Ordenadas por distancia si hay `lat/lng`. Cada una con `coberturas` y `fuenteCoberturas: { fuente, fuenteUrl?, verificadoEl }` (la de sus filas de cobertura; la tarjeta del mapa la muestra). |
| `GET` | `/api/instituciones/:id` | todos | — | Institución con sedes y coberturas. |
| `GET` | `/api/sedes` | todos | `?ids=a,b` | `[{ sede, institucion }]` en ese orden (lugares de atención). |
| `GET` | `/api/sedes/buscar` | todos | `?q=` | Hasta 30 lugares cuyo nombre o dirección contiene el texto (sin tildes). El profesional elige así dónde atiende: a él solo le aparecen los públicos y los que aceptan alguna de sus coberturas. |
| `POST` | `/api/admin/instituciones` | admin | `{ nombre, tipo, origen, direccion, ciudad, latitud, longitud, telefono?, coberturas, fuente, fuenteUrl?, verificadoEl }` | `201` institución con su sede. Si es pública, `coberturas` puede ir vacío. |
| `GET` | `/api/admin/instituciones` | admin | — | Todas (públicas y privadas) con `coberturas` y `fuenteCoberturas`; primero las que tienen coberturas. Es la lista de Admin → Instituciones (su buscador filtra por nombre en la app). |
| `GET` | `/api/admin/instituciones/:id/coberturas` | admin | — | Sus coberturas con fuente y fecha. |
| `PUT` | `/api/admin/instituciones/:id/coberturas` | admin | `{ coberturas, fuente, fuenteUrl?, verificadoEl }` | `200` (reemplaza la lista). `coberturas` es `{ obraSocialId, planesIds? }[]`: sin `planesIds` = todos los planes ([08](08-coberturas.md#api)). |

### Obras sociales

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/admin/planes` | admin | `{ obraSocial, plan? }` | `201` plan con su obra social. Si la obra social no existe se crea (con el plan "General" si no se indica otro); si existe, el plan se suma · `409` si ya tiene ese plan. Es lo que hace el formulario de Admin → Obras sociales. |

### Profesionales

| Método | Ruta | Rol | Query | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/medicos` | paciente | `?sede=` | Solo los que atienden su cobertura (regla 1: su obra social entera o su plan); con `sede`, solo los que atienden ahí (tarjeta del mapa). No hay buscador de médicos: la reserva los pide todos y el profesional sale de fecha, horario, lugar y especialidad (regla 2). |
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
| `GET` | `/api/pacientes/yo/turnos` | paciente | — | `{ proximos, historial }` con médico, especialidad (con su `profesion` y subespecialidades), sede e institución resueltos (`TurnoConDetalle`). |
| `GET` | `/api/pacientes/yo/turnos/proximo` | paciente | — | El próximo confirmado o pendiente (Inicio), o `null`. |
| `GET` | `/api/pacientes/yo/turnos/todos` | paciente | — | Todos sus turnos (`Turno[]`), también los que sacó del historial: su historial médico y el feedback no cambian. |
| `PATCH` | `/api/turnos/:id` | paciente dueño | `{ estado: "cancelado" }` | `200` · `409` si faltan menos de 24 h, ya pasó o no está activo. |
| `PATCH` | `/api/turnos/:id` | profesional del turno | `{ estado: "confirmado" \| "rechazado" }` | `200` · `409` si ya no está `pendiente`. |
| `PATCH` | `/api/turnos/:id` | paciente dueño | `{ ocultoEnHistorial: true }` | `200` ("Eliminar del historial"). |
| `DELETE` | `/api/pacientes/yo/turnos/historial` | paciente | — | `204` ("Eliminar todo": oculta todo el historial). |
| `GET` | `/api/medicos/yo/agenda` | profesional | — | Todos sus turnos (pasados y futuros) con paciente, sede e institución (`TurnoDeAgenda`). Inicio, Agenda y la ficha del paciente. |
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
integración queda documentado para más adelante. La tabla `claves_integracion` se sacó el 05/11/2026 porque
no se usaba: se crea con una migración cuando se implemente.

### Recetas

| Método | Ruta | Rol | Body / query | Respuesta |
|---|---|---|---|---|
| `POST` | `/api/recetas` | profesional | `{ pacienteId, medicacion, dosis, frecuencia, duracionDias, indicaciones? }` | `201` receta con `vigenteHasta = hoy + duracionDias`. |
| `GET` | `/api/pacientes/yo/recetas` | paciente | — | `{ activas, pasadas, archivadas }` con médico y su especialidad, con `profesion` y subespecialidades (`RecetaConDetalle`; las archivadas en una lista, la app arma las carpetas). Cada receta lleva `estado: "activa" \| "pasada"` **calculado**. |
| `GET` | `/api/pacientes/yo/recetas/todas` | paciente | — | Todas sus recetas, archivadas o no (historial médico). |
| `PATCH` | `/api/recetas/:id` | paciente dueño | `{ archivada: true \| false }` | `200` · `409` si la receta todavía está activa. |

### Feedback y notificaciones

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/pacientes/yo/feedback/pendientes` | paciente | — | Turnos completados sin calificar. |
| `GET` | `/api/pacientes/yo/feedback` | paciente | — | Las calificaciones que ya dejó. |
| `POST` | `/api/turnos/:id/feedback` | paciente dueño | `{ estrellas, criterios?: {…}, comentario? }`: solo `estrellas` es obligatoria; cada criterio que venga, de 1 a 5 | `201` · `409` si ya se calificó · `400` si el turno no está completado. |
| `GET` | `/api/notificaciones` | todos | — | Las del usuario, de la más nueva a la más vieja (hasta 100). |
| `PATCH` | `/api/notificaciones/:id` | dueño | — | `204` (la marca como leída) · `404` si no es suya. |
| `PATCH` | `/api/notificaciones` | todos | — | `204` (marca todas las del usuario). |
| `POST` | `/api/notificaciones/fcm-token` | todos | `{ token }` (el token FCM del teléfono) | `204`. Lo guarda en la sesión del pedido y se lo saca a cualquier otra sesión que lo tuviera: un teléfono recibe solo los push de quien tiene la sesión abierta ahí. `400` si falta el token. La app lo manda cada vez que entra (en web no). |

### Administración

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `GET` | `/api/admin/estadisticas` | admin | `{ uso: { pacientes, profesionales, total }, porObraSocial: [{ obraSocial, cantidad }] }` (Panel; solo obras sociales con pacientes). Sin fotos de pacientes (regla 19). |
| `GET` | `/api/admin/metricas` | admin | `{ turnos, pendientes, valoracionPromedio, turnosPorEstado, turnosPorEspecialidad, turnosPorInstitucion, mejorValorados }` (Métricas). |

## De los services del frontend a la API

Cada función de `frontend/src/services/` que necesita datos del servidor hace su pedido con `api()` (o `apiArchivo()`
para el PDF), de `services/apiClient.ts`: arma la URL con `EXPO_PUBLIC_API_URL`, manda el token y convierte un error
`{ error }` en `ErrorApi`. Las carpetas tienen los mismos temas que `servicios/` del backend. Las funciones que no
están en la tabla resuelven en el teléfono o reusan otra de la tabla (por ejemplo `getTurnoParaCalificar`,
`countFeedbacksPendientes` o `aceptaCobertura`).

| Service del frontend | Endpoint |
|---|---|
| `sesion/authService.iniciarSesion` / `cerrarSesion` | `POST /api/auth/login` · `POST /api/auth/logout` |
| `sesion/authService.restaurarSesion` (al abrir la app y después de la huella) | `GET /api/auth/sesion`. La huella desbloquea el token ya guardado en el teléfono (ver [05](05-sesiones-y-tokens.md#ingreso-con-huella)). |
| `sesion/authService.cambiarPassword` | `PATCH /api/auth/contrasena` |
| `sesion/authService.leerDni` / `registrarPaciente` | `POST /api/auth/registro/dni` · `POST /api/auth/registro/paciente` |
| `sesion/authService.listProfesiones` / `verificarProfesional` / `registrarMedico` | `GET /api/catalogos/profesiones` · `POST /api/auth/registro/profesional/verificar` · `POST /api/auth/registro/profesional` |
| `sesion/authService.getSesionActual` / `olvidarSesion`, `sesion/tokenSesion.*`, `sesion/biometria.*` | **Ninguno**: la sesión en memoria, el token en `expo-secure-store` y la huella, en el teléfono. |
| `catalogos/catalogoService.listObrasSociales` / `listPlanesMedicos` / `getPlanMedico` | `GET /api/catalogos/planes` (obras sociales con sus planes; se pide una vez y los otros dos se arman de esa respuesta) |
| `catalogos/catalogoService.listEspecialidades` / `getEspecialidad` | `GET /api/catalogos/especialidades` (se pide una vez) |
| `catalogos/catalogoService.crearPlanMedico` | `POST /api/admin/planes` |
| `catalogos/catalogoService.listPreguntasFrecuentes` | **Ninguno**: las preguntas de Ayuda están en `src/mocks/`. |
| `catalogos/institucionService.buscarCentros` / `listCentrosPorSedes` | `GET /api/instituciones?tipos=&lat=&lng=` · `GET /api/instituciones?sedes=` |
| `catalogos/institucionService.listInstituciones` / `getInstitucion` | `GET /api/instituciones` (con plan, para el paciente) o `GET /api/admin/instituciones` (sin plan, para el admin) · `GET /api/instituciones/:id` |
| `catalogos/institucionService.crearInstitucion` / `guardarCoberturasInstitucion` | `POST /api/admin/instituciones` · `PUT /api/admin/instituciones/:id/coberturas` |
| `catalogos/institucionService.listLugaresDeAtencion` / `buscarLugares` | `GET /api/sedes?ids=` · `GET /api/sedes/buscar?q=` |
| `usuarios/pacienteService.getPacienteActual` / `cambiarCobertura` | `GET /api/pacientes/yo` (una vez; queda en memoria) · `PATCH /api/pacientes/yo` |
| `usuarios/pacienteService.alternarMedicoFavorito` / `quitarMedicoFavorito` / `alternarInstitucionFavorita` / `quitarInstitucionFavorita` | `PUT` / `DELETE /api/pacientes/yo/favoritos/medicos/:id` y `.../favoritos/instituciones/:id` |
| `usuarios/pacienteService.getPaciente` | Ninguno propio: el paciente de la sesión, o el que el profesional tiene en su agenda (vínculo por turnos). |
| `usuarios/medicoService.searchMedicos` / `getMedico` / `getMedicoActual` | `GET /api/medicos?sede=` · `GET /api/medicos/:id` · `GET /api/medicos/yo` |
| `usuarios/medicoService.guardarMisCoberturas` / `guardarMisLugares` | `PUT /api/medicos/yo/coberturas` · `PUT /api/medicos/yo/lugares` |
| `usuarios/medicoService.listMisFranjas` / `guardarMisFranjas` | `GET` / `PUT /api/medicos/yo/franjas` |
| `usuarios/medicoService.listNotasPaciente` / `crearNotaPaciente` | `GET` / `POST /api/medicos/yo/pacientes/:id/notas` |
| `usuarios/fotoPerfil.guardarFotoPerfil` / `quitarFotoPerfil` | `PUT` / `DELETE /api/usuarios/yo/foto` |
| `usuarios/fotoPerfil.elegirFotoPerfil` | **Ninguno**: abre la cámara o la galería y deja la foto cuadrada de 512 px en JPEG, en el teléfono. |
| `turnos/turnoService.listMisTurnos` / `getProximoTurno` / `listTurnosPaciente` | `GET /api/pacientes/yo/turnos` · `.../turnos/proximo` · `.../turnos/todos` |
| `turnos/turnoService.listHorariosLibres` / `listDiasConTurnos` | `GET /api/turnos/disponibles` · `GET /api/turnos/dias-con-turnos` |
| `turnos/turnoService.crearTurno` / `reprogramarTurno` | `POST /api/turnos` · `POST /api/turnos/:id/reprogramar` |
| `turnos/turnoService.cancelarTurno` / `confirmarTurno` / `rechazarTurno` / `ocultarTurnoDelHistorial` | `PATCH /api/turnos/:id` con el `estado` o con `ocultoEnHistorial` |
| `turnos/turnoService.vaciarHistorialTurnos` | `DELETE /api/pacientes/yo/turnos/historial` |
| `turnos/turnoService.motivoSinCambios` | Ninguno: la app calcula el plazo de 24 h para deshabilitar los botones; el backend lo vuelve a controlar (`409`). |
| `turnos/turnoService.listAgendaMedico` / `listTurnosMedico` / `listPacientesAsignados` | `GET /api/medicos/yo/agenda` · `GET /api/medicos/yo/pacientes` |
| `turnos/feedbackService.listTurnosParaCalificar` / `listFeedbackPaciente` / `crearFeedback` | `GET /api/pacientes/yo/feedback/pendientes` · `GET /api/pacientes/yo/feedback` · `POST /api/turnos/:id/feedback` |
| `historialMedico/estudioService.listOrdenesPaciente` / `listOrdenesArchivadasPaciente` | `GET /api/pacientes/yo/ordenes?archivadas=false` / `?archivadas=true` |
| `historialMedico/estudioService.listResultadosPaciente` / `listArchivadosPaciente` / `listEstudiosPaciente` | `GET /api/pacientes/yo/resultados?archivados=false` / `?archivados=true` / sin filtro |
| `historialMedico/estudioService.archivarOrden` / `desarchivarOrden` / `archivarEstudio` / `desarchivarEstudio` | `PATCH /api/ordenes/:id` · `PATCH /api/resultados/:id` |
| `historialMedico/estudioService.getOrden` / `getResultadoPdf` | `GET /api/ordenes/:id` · `GET /api/resultados/:id/pdf` (con `apiArchivo`, que devuelve el PDF como string binario para el visor) |
| `historialMedico/estudioService.crearOrden` / `listOrdenesEmitidas` | `POST /api/ordenes` · `GET /api/medicos/yo/pacientes/:id/ordenes` |
| `historialMedico/estudioService.listResultadosVistos` / `marcarResultadoVisto` | **Ninguno**: el aviso "Nuevo" de los resultados es solo del frontend (se guarda en el teléfono). |
| `historialMedico/recetaService.listMisRecetas` / `listRecetasPaciente` / `archivarReceta` / `desarchivarReceta` | `GET /api/pacientes/yo/recetas` · `GET /api/pacientes/yo/recetas/todas` · `PATCH /api/recetas/:id` |
| `historialMedico/recetaService.crearReceta` / `listRecetasEmitidas` | `POST /api/recetas` · `GET /api/medicos/yo/pacientes/:id/recetas` |
| `historialMedico/historialService.getHistorialPaciente` | Ninguno propio: junta `listTurnosPaciente`, `listEstudiosPaciente` y `listRecetasPaciente`, en paralelo. |
| `notificaciones/notificacionService.registrarPushToken` | `POST /api/notificaciones/fcm-token` (cada vez que se entra; en web no) |
| `notificaciones/notificacionService.listNotificacionesPaciente` / `marcarNotificacionLeida` / `marcarTodasLeidas` | `GET /api/notificaciones` · `PATCH /api/notificaciones/:id` · `PATCH /api/notificaciones` |
| `admin/estadisticaService.getEstadisticasUso` / `getPacientesPorObraSocial` | `GET /api/admin/estadisticas` |
| `admin/estadisticaService.getMetricasAdmin` | `GET /api/admin/metricas` |

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
