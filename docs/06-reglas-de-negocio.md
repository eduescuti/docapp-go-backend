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
| — | `pendiente` | Paciente (reserva) | El horario está libre, el médico atiende en esa sede y acepta el plan del paciente, la fecha no pasó. |
| `pendiente` | `confirmado` | Médico del turno | La fecha no pasó. |
| `pendiente` | `rechazado` | Médico del turno | — |
| `pendiente` / `confirmado` | `cancelado` | Paciente dueño | La fecha y hora no pasaron. (Regla 5: cada institución podría poner un plazo mínimo; hoy no hay.) |
| `confirmado` | `completado` | **Automático** | Pasó la fecha y hora del turno. |
| `pendiente` | `rechazado` | **Automático** | Pasó la fecha y hora sin que el médico lo confirme. |

Cualquier otra transición → `409` ("Este turno ya no está pendiente de confirmación."). `completado`,
`rechazado` y `cancelado` son finales.

### Combinación única (reservar)

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
    const medico = await tx.medico.findUnique({ where: { id: datos.medicoId }, include: { lugares: true, planes: true } });
    if (!medico) throw new ErrorHttp(404, "No existe ese profesional.");
    if (!medico.lugares.some((l) => l.sedeId === datos.sedeId)) throw new ErrorHttp(400, "El profesional no atiende en ese lugar.");
    if (!medico.planes.some((p) => p.planMedicoId === paciente.planMedicoId)) throw new ErrorHttp(400, "El profesional no atiende tu cobertura."); // regla 1
    if (`${datos.fecha} ${datos.hora}` <= ahoraArgentina()) throw new ErrorHttp(400, "Ese horario ya pasó.");
    if (!esHorarioDeLaGrilla(datos.hora)) throw new ErrorHttp(400, "Ese horario no existe.");

    const ocupado = await tx.turno.count({
      where: { ...datos, especialidadId: medico.especialidadId, estado: { in: ["pendiente", "confirmado"] } },
    });
    if (ocupado > 0) throw new ErrorHttp(409, "Ese horario ya no está disponible.");

    return tx.turno.create({ data: { ...datos, pacienteId: paciente.id, especialidadId: medico.especialidadId } }); // nace "pendiente"
  });
}
```

### Disponibilidad (sin horarios de atención)

El perfil del médico ya no tiene horarios de atención: "eso lo resuelven los turnos". Hasta que se defina
otra cosa ([07-pendientes.md](07-pendientes.md)), la disponibilidad se arma así:

- Una **grilla fija** de turnos de 30 minutos, igual para todos los días y todos los profesionales
  (constantes en el código, p. ej. de 08:00 a 18:00). Es lo mismo que hace hoy el frontend.
- Para cada médico que acepta el plan del paciente y cada uno de sus **lugares de atención**
  (`medicos_sedes`), un horario de la grilla está libre si no hay un turno activo del médico a esa hora.
- `GET /api/turnos/disponibles?fecha=` devuelve `[{ medicoId, sedeId, hora }]` y el frontend arma los pasos
  fecha → horario → hospital → especialidad → profesional como hoy.

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
  (`institucionId`: uno de los lugares de atención del médico) y **fecha** de emisión (hoy, la pone el
  servidor). El `medicoId` sale del token (regla 7).
- Nace `pendiente`. Pasa a **`listo`** cuando se carga **el primer** resultado de esa orden (en la misma
  transacción que el `INSERT` del resultado). No vuelve a `pendiente`.
- Genera la notificación `nueva_orden` para el paciente.

## Resultados y carga de PDF por un tercero

- Un resultado es **médico + fecha + hospital + orden + archivo PDF**. El médico es el de la orden (no se
  repite en la tabla). **No tiene estado.**
- Los carga **un tercero** (el laboratorio), no el médico ni el admin: `POST /api/integracion/ordenes/:ordenId/resultados`
  con su clave de integración ([05](05-sesiones-y-tokens.md#terceros-carga-de-pdf-de-resultados)).
- El servidor:
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

- **Reglas 1 y 15:** el paciente ve una institución si es **pública** (`origen = 'publico'`) o si su plan
  está en `instituciones_planes`. El plan sale del paciente de la sesión, no de la query.
- Cada hospital tiene **nombre + dirección + latitud + longitud** (`instituciones` + `sedes`).
- Lo mismo vale para los profesionales (`medicos_planes`) y para la disponibilidad de turnos.

## Perfil del profesional

- Tiene todos los **datos del registro** (DNI, nombre y apellido del padrón, matrícula, profesión) más
  especialidad, descripción y **lugares de atención** (`medicos_sedes`).
- **No tiene horarios de atención.**
- La valoración se calcula: promedio de `feedbacks.estrellas` de sus turnos, sin los `oculto`.

## Administración

- **Cargar obras sociales** con sus planes y **cargar hospitales** (institución + sede con coordenadas +
  planes que lo aceptan, con la cartilla de donde sale el dato).
- Métricas: turnos por estado / especialidad / institución, valoración media y ranking de profesionales.
- Moderación: puede ocultar un feedback (`oculto = true`).
- Cada alta queda en `registro_auditoria`.

## Feedback

- Solo de un turno **completado**, del paciente dueño, una vez por turno (regla 6; `turnoId` es `UNIQUE`).
- Todas las calificaciones de 1 a 5 (trigger en la base y validación en el servicio).

## Notificaciones

Las genera el servidor cuando pasa algo, en la misma transacción que el cambio:

| Evento | Para | Tipo |
|---|---|---|
| El médico confirma un turno | Paciente | `turno_confirmado` |
| El médico rechaza un turno (o vence sin confirmar) | Paciente | `turno_rechazado` |
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
| Obras sociales, hospitales | Lectura (filtrado por su plan) | Lectura | Alta y edición |
