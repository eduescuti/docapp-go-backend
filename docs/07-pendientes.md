# Decisiones y puntos a confirmar

Todos los puntos abiertos de las notas del Sprint 2 y de la planificación del backend quedaron decididos el
25/10/2026 y el 27/10/2026. Lo único que queda por hacer fuera del equipo está al final.

## Decidido el 25/10/2026

| # | Duda (notas de planificación) | Decisión |
|---|---|---|
| 1 | ¿Un turno CANCELADO o RECHAZADO libera la combinación fecha + horario + hospital + especialidad + médico? | **Sí.** La unicidad se aplica solo a los turnos activos (`pendiente`, `confirmado`) con un índice único parcial. |
| 2 | Al llegar la fecha, ¿pasan a RECHAZADO solo los pendientes o también los confirmados? | **Automático:** `pendiente` → `rechazado` y `confirmado` → `completado`. No hace falta que el médico marque asistencia. |
| — | Tipo de consulta | Eliminado de la app y de la base. |

## Decidido el 27/10/2026

### Stack y seguridad

| # | Duda | Decisión |
|---|---|---|
| 7 | ¿Con qué se hace el servidor? ¿Se puede usar Prisma? | **Express 5 + TypeScript + Prisma 6 + SQLite**, con la estructura de la práctica de la cátedra (`Practica17926`). Las tablas se crean con **`prisma migrate`**. Reemplaza a `node:http` sin framework ([02](02-arquitectura.md)). |
| 13 | ¿Dónde guarda el teléfono su copia del token? | **`expo-secure-store`** (cifrado por el sistema operativo). La sesión vive en nuestra base; se saca el DNI + contraseña que hoy guarda `biometria.ts` en `AsyncStorage`. |
| 14 | ¿Cuánto dura una sesión? | **Queda iniciada hasta que el usuario la cierre**, con vencimiento por inactividad: **90 días sin usar la app**. Cada uso lo renueva. Se corta además al cerrar sesión, cambiar la contraseña o si el admin desactiva la cuenta ([05](05-sesiones-y-tokens.md)). |
| 15 | ¿El registro de un profesional lo aprueba el admin? | **No: alcanza con el padrón** (regla 13). El admin puede desactivar la cuenta después. |
| 16 | ¿Cuántos admins hay? | **Uno general** (regla 10). |

### Turnos

| # | Duda | Decisión |
|---|---|---|
| 8 | ¿Un profesional puede tener dos turnos activos a la misma hora en dos lugares? | **No.** Índice único parcial `turnos_medico_activo` sobre `(medicoId, fecha, hora)` entre activos. |
| 9 | Sin horarios en el perfil, ¿qué horarios se ofrecen? | **Franjas de atención** que el profesional carga en su **Agenda** (por lugar, día de la semana, desde y hasta). Turnos de 30 min dentro de cada franja. Tabla nueva `franjas_atencion`. Las franjas de un médico no se pisan entre lugares; cambiarlas no toca los turnos ya tomados. |
| 10 | ¿Cómo se reprograma? | **Botón "Reprogramar"** que abre la reserva con el mismo profesional y, en una transacción, cancela el viejo y crea el nuevo (`pendiente`, con `reprogramadoDesdeId`). **Se elimina el estado `reprogramado`.** |
| 11 | ¿Plazo para cancelar o reprogramar? | **24 h antes del turno, igual para toda la app** (`HORAS_MINIMAS_CANCELACION`). Reemplaza a "según cada institución" de la regla 5. |
| 17 | ¿Qué turnos le aparecen al paciente? | Los de una **sede que le aparece** (pública o que acepta su cobertura) **con un profesional que le aparece** (atiende su cobertura, también en un hospital público). |

### Órdenes, resultados y recetas

| # | Duda | Decisión |
|---|---|---|
| 3 | ¿Una orden pasa a LISTO con el primer resultado o cuando están todos? | **Con el primero** ("algún resultado", como dicen las notas). |
| 4 | El estado de la receta, ¿se guarda o se calcula? | **Se calcula** con `vigenteHasta >= hoy`. |
| 5 | ¿Qué recetas se pueden archivar? | **Solo las pasadas.** |
| 6 | ¿Cómo carga el tercero los PDF? | **En este sprint, solo desde el seed** (PDF de ejemplo). El endpoint con clave de integración queda documentado para más adelante; la tabla `claves_integracion` se crea igual. |
| 12 | ¿Dónde se hacen los estudios de una orden? | En uno de los **lugares de atención del profesional que le aparezca al paciente** por su cobertura (o público). |

### Coberturas

Detalle completo en [08-coberturas.md](08-coberturas.md).

| Tema | Decisión |
|---|---|
| Canal de carga | Lo oficial (REFES, catálogo) por seed; la relación cobertura ↔ prestador desde la app, más un seed verificado. |
| Coberturas de instituciones | Solo el admin, con fuente y fecha. |
| Coberturas de profesionales | Las elige el propio profesional en su Perfil. |
| Nivel | Obra social con planes opcionales (sin plan = todos los planes). Reemplaza a `instituciones_planes` y `medicos_planes`. |
| Catálogo | 26 obras sociales: las 4 de los mocks + las del relevamiento del equipo que se pudieron identificar (se sacaron OSPE, UTS y Pasteleros). |
| Seed | Relevamiento del equipo ∩ web oficial de cada institución, con los planes que publica. Anchorena, Los Arcos y Suizo Argentina como `relevamiento_propio`. Solo el establecimiento principal de cada hospital. |
| 18 · Güemes "planes básicos" | Se cargan **todos los planes** de OSDE y Galeno: la web oficial no detalla planes. |
| 19 · Datos faltantes | Planes de Sancor Salud completos (los 11 que publica el Italiano) y OSDOP = Obra Social de Docentes Particulares. |

## Queda por hacer

| Qué | Cuándo |
|---|---|
| Completar los códigos del RNAS del catálogo (el 27/10/2026 el sitio de la SSSalud estaba en mantenimiento). | Al armar el seed. |
