# Reglas de negocio en el backend

Lo que tiene que garantizar cada servicio. Las reglas numeradas son las del §10 del `CLAUDE.md` del
workspace; las del Sprint 2 salen de las notas de planificación. El frontend ya aplica todas estas reglas
en sus services con datos de prueba: el backend las tiene que aplicar **de verdad**, porque la app se
puede saltear llamando a la API directo.

## Turnos

### Estados y quién los cambia

```
                 ┌──────────── médico confirma ───────────▶ CONFIRMADO ── pasa la fecha ──▶ COMPLETADO
                 │                                              │
  paciente   PENDIENTE ─────── médico rechaza ────────▶ RECHAZADO
  reserva ──▶    │  └──────── pasa la fecha sin confirmar ─▶ RECHAZADO
                 │                                              │
                 └──── paciente cancela ───▶ CANCELADO ◀── paciente cancela
```

| Desde | Hacia | Quién | Condición |
|---|---|---|---|
| — | `pendiente` | Paciente (reserva) | El horario está libre y dentro de una franja del médico en esa sede, la sede y el médico le aparecen al paciente por su cobertura, la fecha no pasó. |
| `pendiente` | `confirmado` | Médico del turno | La fecha no pasó. |
| `pendiente` | `rechazado` | Médico del turno | — |
| `pendiente` / `confirmado` | `cancelado` | Paciente dueño | Faltan **24 h o más** para el turno (plazo general, decidido el 27/10/2026). También al reprogramar. |
| `confirmado` | `completado` | **Automático** | Pasó la fecha y hora del turno. |
| `pendiente` | `rechazado` | **Automático** | Pasó la fecha y hora sin que el médico lo confirme. |

Cualquier otra transición → `409` ("Este turno ya no está pendiente de confirmación."). `completado`,
`rechazado` y `cancelado` son finales.

### Combinación única (reservar)

La reserva tiene 5 pasos en orden y **ninguno se saltea** (decidido el 28/10/2026): fecha → horario → hospital →
especialidad → profesional. En la app cada paso se habilita recién con el anterior elegido (sin "Cualquiera" ni
"Todas"; el hospital favorito se propone y cuenta como elegido). `POST /api/turnos` recibe los cinco datos
(`fecha, hora, sedeId, especialidadId, medicoId`) y revisa que la combinación entera sea válida: además de lo de
abajo, que la especialidad sea la del profesional.

No puede haber otro turno **activo** (`pendiente` o `confirmado`) con la misma
**fecha + horario + hospital + especialidad + médico**. Se garantiza en dos lugares:

1. **En el servicio**, dentro de una transacción: verificar y crear.
2. **En la base**, con el índice único parcial `turnos_combinacion_activa`
   ([03-base-de-datos.md](03-base-de-datos.md#sql-extra-de-la-migración)). Si dos pedidos llegan juntos y
   los dos pasan el paso 1, el segundo `INSERT` falla con `P2002` → `409`.

```ts
// src/servicios/turnos.ts (idea)
export async function reservar(paciente: Paciente, datos: { medicoId: string; sedeId: string; fecha: string; hora: string }) {
  return prisma.$transaction(async (tx) => {
    const medico = await tx.medico.findUnique({ where: { id: datos.medicoId }, include: { lugares: true, coberturas: true } });
    if (!medico) throw new ErrorHttp(404, "No existe ese profesional.");
    if (!medico.lugares.some((l) => l.sedeId === datos.sedeId)) throw new ErrorHttp(400, "El profesional no atiende en ese lugar.");
    if (!aceptaPlan(medico.coberturas, paciente.plan)) throw new ErrorHttp(400, "El profesional no atiende tu cobertura."); // regla 1 (08-coberturas.md)
    if (!(await sedeVisible(tx, datos.sedeId, paciente.plan))) throw new ErrorHttp(400, "Ese lugar no atiende tu cobertura."); // pública o acepta la cobertura
    if (!(await enFranja(tx, medico.id, datos.sedeId, datos.fecha, datos.hora))) throw new ErrorHttp(400, "Ese horario no existe.");
    if (`${datos.fecha} ${datos.hora}` <= ahoraArgentina()) throw new ErrorHttp(400, "Ese horario ya pasó.");

    const ocupado = await tx.turno.count({
      where: { ...datos, especialidadId: medico.especialidadId, estado: { in: ["pendiente", "confirmado"] } },
    });
    if (ocupado > 0) throw new ErrorHttp(409, "Ese horario ya no está disponible.");

    return tx.turno.create({ data: { ...datos, pacienteId: paciente.id, especialidadId: medico.especialidadId } }); // nace "pendiente"
  });
}
```

### Reprogramar (decidido el 27/10/2026)

No hay estado `reprogramado`. "Reprogramar" en el detalle del turno abre la reserva con **el mismo
profesional**; al confirmar, `POST /api/turnos/:id/reprogramar` hace en **una sola transacción**: el turno
viejo pasa a `cancelado` y se crea el nuevo (`pendiente`, con `reprogramadoDesdeId`). Si el nuevo horario
está tomado, no se cancela nada. Rige el mismo plazo que para cancelar: **24 h antes**. El profesional ve
el turno nuevo como pendiente y lo confirma o rechaza como cualquier otro.

### Plazo para cancelar o reprogramar

**24 horas antes del turno**, igual para toda la app (constante `HORAS_MINIMAS_CANCELACION`). Reemplaza a
"según las reglas de cada institución" de la regla 5 (decidido el 27/10/2026). Pasado el plazo, la API
responde `409` y la app muestra los botones deshabilitados con un aviso.

### Disponibilidad: franjas de atención (decidido el 27/10/2026)

El perfil del médico no muestra horarios, pero la disponibilidad necesita saber cuándo atiende cada uno.
Por eso el profesional carga sus **franjas de atención** en su **Agenda** (`franjas_atencion`): por cada
lugar de atención, qué días de la semana y de qué hora a qué hora. Es la "gestión de disponibilidad" del
MVP del profesional (CLAUDE.md §12).

- `desde` y `hasta` son múltiplos de 30 min; se ofrecen turnos de **30 minutos** dentro de cada franja.
- Las franjas de un mismo profesional **no se pisan** el mismo día, aunque sean en lugares distintos (no
  puede estar en dos lugares a la vez). Lo valida el servicio al guardar (`PUT /api/medicos/yo/franjas`).
- Cambiar las franjas **no toca los turnos ya tomados**: siguen activos aunque queden fuera.
- Un horario está libre si cae en una franja, no pasó y no hay un turno activo del médico a esa hora.

### Qué turnos le aparecen al paciente (regla 1, decidido el 27/10/2026)

Un turno (profesional + sede + fecha + hora) le aparece al paciente si le aparecen **las dos cosas**:

- **la sede**: es pública (regla 15) o su institución acepta la cobertura del paciente
  (`instituciones_coberturas`);
- **el profesional**: atiende la cobertura del paciente (`medicos_coberturas`). Esto vale también en un
  hospital público.

Ejemplo: un paciente con OSDE 210 y un profesional con OSDE 210 que atiende en el Hospital Italiano (que no
acepta el 210) y en el Fernández (público): le aparecen solo los turnos del Fernández.
`GET /api/turnos/disponibles?fecha=` devuelve `[{ medicoId, sedeId, hora }]` ya filtrado y el frontend arma
los pasos fecha → horario → hospital → especialidad → profesional como hoy.

### Vencimiento automático

Antes de leer turnos (lista del paciente, agenda del médico, ficha, métricas, disponibilidad), el servicio
corre las dos actualizaciones del vencimiento ([consultas clave](03-base-de-datos.md#consultas-clave)):
`confirmado → completado` y `pendiente → rechazado` para los que ya pasaron. Así no depende de que haya un
proceso corriendo a la hora exacta. Opcional: además, un `setInterval` cada 5 minutos en el servidor.

"Ahora" es la hora de Argentina, en formato `"yyyy-MM-dd HH:mm"` para comparar con `fecha || ' ' || hora`.

### Historial del paciente

- **Próximos:** fecha ≥ hoy y estado `pendiente`, `confirmado` o `rechazado` (los rechazados se ven para
  que el paciente sepa que no se aceptaron). Orden: confirmados, pendientes, rechazados; dentro de cada uno,
  por fecha.
- **Historial:** el resto (`completado`, `cancelado`, `rechazado` vencidos), sin los `ocultoEnHistorial`.
- "Eliminar del historial" solo pone `ocultoEnHistorial = true`. El médico los sigue viendo y el feedback no
  cambia.

## Órdenes

- Las crea el **médico** para un paciente con el que tiene un vínculo por turnos (si no, `403`).
- Datos: estudios pedidos (al menos uno, en `orden_estudios`), **indicaciones** (obligatorias), **hospital**
  (`institucionId`: uno de los lugares de atención del médico **que le aparezca al paciente** por su
  cobertura, o público; decidido el 27/10/2026) y **fecha** de emisión (hoy, la pone el servidor). El
  `medicoId` sale del token (regla 7).
- Nace `pendiente`. Pasa a **`listo`** cuando se carga **el primer** resultado de esa orden (en la misma
  transacción que el `INSERT` del resultado). No vuelve a `pendiente`.
- Genera la notificación `nueva_orden` para el paciente.

## Resultados y carga de PDF por un tercero

- Un resultado es **médico + fecha + hospital + orden + archivo PDF**. El médico es el de la orden (no se
  repite en la tabla). **No tiene estado.**
- Los carga **un tercero** (el laboratorio), no el médico ni el admin.
- **En este sprint, solo desde el seed** (decidido el 27/10/2026): el seed genera PDF de ejemplo en
  `uploads/` y crea los resultados (y pasa sus órdenes a `listo`). Lo que sigue es para cuando se haga la
  carga real, con `POST /api/integracion/ordenes/:ordenId/resultados` y su clave de integración
  ([05](05-sesiones-y-tokens.md#terceros-carga-de-pdf-de-resultados)).
- El servidor (más adelante):
  1. Verifica la clave y que la orden sea de **la institución de la clave**.
  2. Lee el body como binario con límite de 10 MB y verifica que empiece con `%PDF-`.
  3. Lo guarda en `uploads/<año>/<id>.pdf` (fuera de git, fuera de cualquier carpeta pública), con su
     tamaño y su SHA-256.
  4. Crea el resultado y pasa la orden a `listo`, en una transacción. Si falla la base, borra el archivo.
  5. Genera la notificación `resultado_disponible` para el paciente.
- **Regla 8:** el PDF solo se descarga con `GET /api/resultados/:id/pdf` por el **paciente dueño** o el
  **médico de la orden**. Cada descarga va a `registro_auditoria`.
- El aviso "Nuevo" que ve el paciente es **solo del frontend** (se guarda en el teléfono). La base no sabe
  si el paciente lo abrió.

## Archivar (órdenes, resultados y recetas)

- Solo el **paciente dueño** archiva o desarchiva. Archivar = `archivadoEl = hoy`; desarchivar = `null`.
- La carpeta año → mes de "Archivados" sale de `archivadoEl`.
- Recetas: **solo las pasadas** se pueden archivar (una activa → `409`). Órdenes y resultados, siempre.
- Archivar no borra nada ni cambia lo que ve el médico.

## Recetas

- Las crea el **médico** para un paciente con vínculo por turnos. Datos: **nombre** (`medicacion`),
  **dosis**, **cómo tomarla** (`frecuencia`), **duración** (`duracionDias`, 1 a 365), **indicación**
  (`indicaciones`), **médico** (del token) y **fecha de emisión** (hoy, la pone el servidor).
- `vigenteHasta = fecha + duracionDias`, fijado al crearla.
- **Estado calculado**, no guardado: `activa` si `vigenteHasta >= hoy`, si no `pasada`. La API lo devuelve
  como campo `estado` para que el frontend sepa en qué pestaña va.
- Genera la notificación `nueva_receta`.

## Hospitales por obra social

- **Reglas 1 y 15:** el paciente ve una institución si es **pública** (`origen = 'publico'`) o si tiene una
  fila en `instituciones_coberturas` para **su obra social**, sin plan (acepta todos) o con **su plan**. El
  plan sale del paciente de la sesión, no de la query. Detalle y seed en [08-coberturas.md](08-coberturas.md).
- Cada hospital tiene **nombre + dirección + latitud + longitud** (`instituciones` + `sedes`).
- Lo mismo vale para los profesionales (`medicos_coberturas`) y para la disponibilidad de turnos.

```ts
/** ¿Alguna de estas coberturas acepta el plan del paciente? Sin plan en la fila = todos los planes. */
function aceptaPlan(coberturas: { obraSocialId: string; planMedicoId: string | null }[], plan: PlanMedico): boolean {
  return coberturas.some((c) => c.obraSocialId === plan.obraSocialId && (c.planMedicoId === null || c.planMedicoId === plan.id));
}
```

## Perfil del profesional

- Tiene todos los **datos del registro** (DNI, nombre y apellido del padrón, matrícula, profesión) más
  especialidad, descripción, **lugares de atención** (`medicos_sedes`) y **coberturas que atiende**
  (`medicos_coberturas`), que **elige el propio profesional** (`PUT /api/medicos/yo/coberturas`).
- **No tiene horarios de atención.**
- **Lugares según sus coberturas** (decidido el 28/10/2026): al buscar dónde atiende (`GET /api/sedes/buscar`) solo
  le aparecen los públicos (regla 15) y los privados que aceptan alguna de sus coberturas: la misma obra social y,
  si los dos la limitan a planes, algún plan en común. `PUT /api/medicos/yo/lugares` rechaza un lugar **nuevo** que
  no cumpla; los que ya tenía se conservan aunque después cambie sus coberturas (sacarlos borraría sus horarios).
  En la app, el Perfil muestra primero "Coberturas que atiendo" y después "Lugares de atención".
- La especialidad la elige en el registro entre las de **su profesión** (`especialidades.profesion`).
- La valoración se calcula: promedio de `feedbacks.estrellas` de sus turnos, sin los `oculto`.

## Fotos de perfil

Decidido el 27/10/2026. El paciente (Menú → Mi perfil) y el profesional (pestaña Perfil) pueden subir, cambiar
o quitar su foto, sacándola con la cámara o eligiéndola de la galería. Es **opcional**: sin foto se ven las
iniciales.

- **Quién la ve.** La del profesional, todos los pacientes: aparece en su perfil, al reservar y en los turnos.
  La del paciente, **él y los profesionales que lo tienen asignado por un turno** (Pacientes, ficha, agenda).
  **El admin no la ve:** las respuestas del admin no llevan `avatarUrl` de pacientes.
- **Cómo se cumple.** La foto se guarda en `uploads/fotos/` con un nombre al azar (UUID v4, 122 bits) que
  cambia con cada foto nueva, y la base guarda solo ese nombre (`usuarios.fotoArchivo`). La URL
  (`/api/fotos/<uuid>.jpg`) solo viaja dentro de las respuestas que ya pasaron el control de rol de arriba, y
  esa URL es la llave: `GET /api/fotos/:archivo` no pide token, porque en la versión web `Image` no puede mandar
  el header `Authorization`. Al cambiar o quitar la foto, la anterior se borra y su URL da `404`; también da
  `404` la de una cuenta desactivada.
- **Qué se acepta.** JPG o PNG (se mira el contenido del archivo, no lo que diga el cliente), hasta 1 MB. La app
  la recorta cuadrada y la achica a 512×512 en JPEG antes de subirla; al volver a codificarla pierde los
  metadatos (EXIF), como la ubicación GPS de donde se sacó.
- **Auditoría.** `foto_perfil_cambiada` y `foto_perfil_quitada` en `registro_auditoria`.

## Administración

- **Cargar obras sociales** con sus planes y **cargar hospitales** (institución + sede con coordenadas +
  coberturas que acepta, con la fuente y la fecha de donde sale el dato).
- **Editar las coberturas** de una institución que ya existe (las del REFES entran sin coberturas). Solo
  el admin carga coberturas de instituciones.
- Métricas: turnos por estado / especialidad / institución, valoración media y ranking de profesionales.
- Moderación: puede ocultar un feedback (`oculto = true`).
- Cada alta queda en `registro_auditoria`.

## Feedback

- Solo de un turno **completado**, del paciente dueño, una vez por turno (regla 6; `turnoId` es `UNIQUE`).
- **Solo "¿Cómo fue tu consulta?" (`estrellas`) es obligatoria** (decidido el 28/10/2026). Los cinco criterios
  (puntualidad, atención, trato, claridad, experiencia general) son opcionales: los que no se califican quedan
  `NULL`. Lo que viene, de 1 a 5 (trigger en la base y validación en el servicio).
- La valoración del profesional sale solo de `estrellas`.

## Verificación de identidad del registro

Decidido el 28/10/2026. El paciente y el profesional escanean con la cámara el **código PDF417 del frente del DNI
tarjeta** (`expo-camera`). El RENAPER imprime ahí número de trámite, apellido, nombres, sexo, DNI, ejemplar y fechas.

| Paso | Qué pasa |
|---|---|
| 1. Escanear | La app manda el texto del código a `POST /api/auth/registro/dni`. El backend lo lee (dos formatos: el del frente, desde 2012, y el del dorso, 2009–2012), revisa que el DNI no tenga cuenta (por número y por ejemplar físico) y devuelve **solo** DNI, nombre y apellido. No guarda nada. |
| 2. Crear la cuenta | El código vuelve a viajar en `codigoDni` y el backend lo lee de nuevo (no confía en lo que diga la app). Paciente: DNI, nombre y apellido **salen del DNI** (no se escriben). Profesional: el DNI escaneado tiene que ser el ingresado y compartir al menos un apellido con la ficha del padrón. |
| 3. Guardar | `usuarios.identidadVerificadaEl` + `usuarios.tramiteHash` = HMAC-SHA256 del número de trámite con `SECRETO_IDENTIDAD` (solo en el `.env` del servidor). Con la base sola no se recupera el trámite (con un SHA-256 común sí: son 10^11 valores posibles). `UNIQUE`: un DNI físico abre una sola cuenta. |

**Qué no se guarda:** ninguna imagen (la cámara solo lee el código), ni el contenido del código, ni el trámite en claro,
ni fecha de nacimiento o sexo.

**Límite (honesto):** asegura que el DNI de la cuenta es el de un documento que la persona tiene (o una foto de él) y
que no se repite. **No** asegura que quien lo sostiene sea el titular, ni que el código no esté armado a mano: eso
solo se confirma contra el RENAPER (SID, Sistema de Identidad Digital), que pide convenio con el Estado o un proveedor
de validación de identidad (con selfie y prueba de vida). Queda como mejora para producción.

Las cuentas del seed y la de admin no tienen la verificación (`NULL`); el login no la exige. Códigos de prueba
ficticios: `frontend/dni-de-prueba.html` del repo del frontend.

## Notificaciones

Las genera el servidor cuando pasa algo, en la misma transacción que el cambio:

| Evento | Para | Tipo |
|---|---|---|
| El médico confirma un turno | Paciente | `turno_confirmado` |
| El médico rechaza un turno (o vence sin confirmar: lo avisa el vencimiento automático) | Paciente | `turno_rechazado` |
| El paciente cancela | Médico | `turno_cancelado` |
| Se crea una orden | Paciente | `nueva_orden` |
| Llega un resultado | Paciente | `resultado_disponible` |
| Se crea una receta | Paciente | `nueva_receta` |

## Quién ve qué (regla 8)

| Dato | Paciente | Profesional | Admin |
|---|---|---|---|
| Sus turnos | Los suyos | Los suyos (como médico) | Solo agregados (métricas) |
| Ficha del paciente | — | Solo si tiene un turno con él | — |
| Órdenes y recetas | Las suyas | Las que él emitió | — |
| PDF de resultados | Los suyos | Los de órdenes que él emitió | No |
| Notas privadas | No | Solo las que escribió | No |
| Foto de perfil de un paciente | La suya | Solo si tiene un turno con él | No |
| Foto de perfil de un profesional | Todas | La suya | Sí |
| Obras sociales, hospitales | Lectura (filtrado por su plan) | Lectura | Alta y edición |
