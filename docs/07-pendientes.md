# Decisiones y puntos a confirmar

## Ya decidido (25/10/2026)

| # | Duda (notas de planificación) | Decisión |
|---|---|---|
| 1 | ¿Un turno CANCELADO o RECHAZADO libera la combinación fecha + horario + hospital + especialidad + médico? | **Sí.** La unicidad se aplica solo a los turnos activos (`pendiente`, `confirmado`) con un índice único parcial. |
| 2 | Al llegar la fecha, ¿pasan a RECHAZADO solo los pendientes o también los confirmados? | **Automático:** `pendiente` → `rechazado` y `confirmado` → `completado`. No hace falta que el médico marque asistencia. |
| — | Stack del backend | `node:http` (sin framework) + Prisma + SQLite. |
| — | Tipo de consulta | Eliminado de la app y de la base. |

## Adoptado como propuesta (falta confirmar)

| # | Duda | Lo que se documentó | Por qué importa |
|---|---|---|---|
| 3 | ¿Una orden pasa a LISTO con el primer resultado o cuando están todos? | **Con el primero** (las notas dicen "algún resultado"). | Una orden puede pedir varios estudios que llegan en días distintos. Si tienen que estar todos, hay que relacionar cada resultado con su `orden_estudios`. |
| 4 | El estado de la receta, ¿se guarda o se calcula? | **Se calcula** con `vigenteHasta >= hoy`. | Si se guardara, haría falta un proceso que lo actualice cada día. |
| 5 | ¿Se archivan todas las recetas o solo las pasadas? | **Solo las pasadas**, como hoy en el frontend. | Una activa archivada desaparecería de la pestaña de lo que hay que tomar. |
| 6 | ¿Cómo carga el tercero los PDF? | Endpoint propio con **clave de integración** por institución y el PDF como body binario. | Es un acceso distinto al de pacientes, médicos y admin: tiene que estar protegido con sus propias credenciales. Ver [05](05-sesiones-y-tokens.md#terceros-carga-de-pdf-de-resultados). |

## Nuevos puntos a confirmar

| # | Pregunta | Propuesta | Por qué importa |
|---|---|---|---|
| 7 | **¿Prisma cuenta como "framework"?** | Consultarlo con el docente. Si no se puede usar, el esquema se escribe en SQL (`CREATE TABLE` de [03](03-base-de-datos.md)) y las consultas a mano con `node:sqlite`. | Cambia la capa de datos entera. El modelo de tablas es el mismo en los dos casos. |
| 8 | La combinación de las notas incluye el hospital: con eso, **un médico podría tener dos turnos a la misma hora en dos hospitales distintos**. ¿Se permite? | Agregar además un índice único parcial sobre `(medicoId, fecha, hora)` entre activos. El frontend ya lo aplica así. | Un profesional no puede atender en dos lugares a la vez. |
| 9 | Sin horarios de atención, **¿qué horarios se ofrecen?** | Grilla fija de 30 min (p. ej. 08:00 a 18:00) igual todos los días, en cada lugar de atención. | Si cada profesional tiene que definir sus días y franjas, hace falta una tabla interna de franjas (configuración de turnos, no un dato del perfil). |
| 10 | **Reprogramar** no está entre los estados del Sprint 2. ¿Se hace cancelando y reservando de nuevo? | Sí: cancelar + reservar. El estado `reprogramado` queda fuera de la base. | El frontend todavía tiene `reprogramado` en el tipo `EstadoTurno` (sin ningún flujo que lo use). |
| 11 | ¿Hay **plazo mínimo para cancelar** (regla 5, varía por institución)? | Hoy no: se puede cancelar hasta la hora del turno. | Si hay plazo, va una columna `horasMinimasCancelacion` en `instituciones`. |
| 12 | ¿**Dónde** se hacen los estudios de una orden? | En uno de los **lugares de atención del médico** (así lo hace hoy el formulario de la app). | La alternativa es elegir cualquier laboratorio que acepte el plan del paciente (hace falta un buscador en el formulario). |
| 13 | ¿Dónde guarda la app el token? | `expo-secure-store` (hay que instalarlo: confirmar por la regla de versiones congeladas). | `AsyncStorage` es texto plano. Hoy `biometria.ts` guarda ahí DNI **y contraseña**: hay que sacarlo al pasar a tokens. |
| 14 | ¿Cuánto dura una sesión? | 30 días, y se revoca al cerrar sesión o cambiar la contraseña. | Más corto es más seguro; más largo, más cómodo en el celular. |
| 15 | El registro de un profesional, ¿alcanza con el padrón o lo **aprueba el admin**? | Alcanza con el padrón (regla 13). | Si hay aprobación, `medicos` necesita un estado (`pendiente_aprobacion`). |
| 16 | ¿Puede haber **más de un admin**, o admins por institución (reglas 9 y 10)? | Uno general. | Si hay admins por institución, vuelve una tabla `administradores` con `institucionId`. |
