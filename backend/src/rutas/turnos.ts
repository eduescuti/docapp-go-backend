import { Router } from "express";

import { autenticar, pacienteIdDe, requerirRol, usuarioDe } from "../middlewares/autenticar";
import * as disponibilidad from "../servicios/turnos/disponibilidad";
import * as feedback from "../servicios/turnos/feedback";
import * as servicio from "../servicios/turnos/turnos";
import { ErrorHttp } from "../utils/errores";
import { esFecha, esHoraDeTurno } from "../utils/tiempo";
import { cuerpo, listaDeQuery, texto, textoOpcional } from "../utils/validacion";

export const turnos = Router();
turnos.use(autenticar);

function fecha(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !esFecha(valor)) throw new ErrorHttp(400, `"${campo}" tiene que ser una fecha (aaaa-mm-dd).`);
  return valor;
}

function hora(valor: unknown): string {
  if (typeof valor !== "string" || !esHoraDeTurno(valor)) throw new ErrorHttp(400, 'La hora tiene que ser en punto o y media ("09:30").');
  return valor;
}

// GET /api/turnos/disponibles?fecha=&medicos= → [{ medicoId, sedeId, hora }] libres ese día.
turnos.get("/disponibles", requerirRol("paciente"), async (req, res) => {
  res.json(await disponibilidad.horariosLibres(pacienteIdDe(req), fecha(req.query.fecha, "fecha"), listaDeQuery(req.query.medicos, 50)));
});

// GET /api/turnos/dias-con-turnos?desde=&hasta=&medicos= → ["2026-11-02", …]
turnos.get("/dias-con-turnos", requerirRol("paciente"), async (req, res) => {
  res.json(
    await disponibilidad.diasConTurnos(pacienteIdDe(req), fecha(req.query.desde, "desde"), fecha(req.query.hasta, "hasta"), listaDeQuery(req.query.medicos, 50)),
  );
});

// POST /api/turnos → 201 turno pendiente (al profesional le llega la solicitud). Dos formas:
//  - Reservar: { fecha, hora, sedeId, especialidadId, medicoId }. Son los 5 pasos de la reserva, en orden: el
//    backend revisa que la combinación entera sea válida.
//  - Reprogramar: { reprogramadoDesdeId, fecha, hora, sedeId }. Crea el turno nuevo con el mismo profesional y
//    cancela el viejo, en una sola operación. No hay ruta propia: reprogramar es crear un turno que viene de otro.
turnos.post("/", requerirRol("paciente"), async (req, res) => {
  const datos = cuerpo(req.body);
  const lugarYHorario = { sedeId: texto(datos, "sedeId", 80), fecha: fecha(datos.fecha, "fecha"), hora: hora(datos.hora) };

  const reprogramadoDesdeId = textoOpcional(datos, "reprogramadoDesdeId", 80);
  const turno = reprogramadoDesdeId
    ? await servicio.reprogramar(pacienteIdDe(req), usuarioDe(req).id, reprogramadoDesdeId, lugarYHorario)
    : await servicio.reservar(pacienteIdDe(req), usuarioDe(req).id, {
        ...lugarYHorario,
        especialidadId: texto(datos, "especialidadId", 80),
        medicoId: texto(datos, "medicoId", 80),
      });
  res.status(201).json(turno);
});

// POST /api/turnos/:id/feedback { estrellas, criterios?: { puntualidad?, atencion?, trato?, claridadExplicacion?,
// experienciaGeneral? }, comentario? }. Solo `estrellas` es obligatoria; cada criterio que venga va de 1 a 5.
turnos.post("/:id/feedback", requerirRol("paciente"), async (req, res) => {
  const datos = cuerpo(req.body);
  const criterios = (typeof datos.criterios === "object" && datos.criterios !== null ? datos.criterios : {}) as Record<string, unknown>;
  if (!feedback.esCalificacion(datos.estrellas)) throw new ErrorHttp(400, "Calificá la consulta, de 1 a 5 estrellas.");
  const presentes = feedback.CRITERIOS_FEEDBACK.filter((c) => criterios[c] !== undefined && criterios[c] !== null);
  if (presentes.some((c) => !feedback.esCalificacion(criterios[c]))) throw new ErrorHttp(400, "Cada criterio va de 1 a 5 estrellas.");
  const comentario = typeof datos.comentario === "string" ? datos.comentario.slice(0, 1000) : undefined;
  const creado = await feedback.calificar(pacienteIdDe(req), usuarioDe(req).id, String(req.params.id), {
    estrellas: datos.estrellas,
    criterios: Object.fromEntries(presentes.map((c) => [c, criterios[c] as number])) as feedback.DatosFeedback["criterios"],
    comentario,
  });
  res.status(201).json(creado);
});

// PATCH /api/turnos/:id { estado } | { ocultoEnHistorial: true } → según quién lo pide.
turnos.patch("/:id", requerirRol("paciente", "doctor"), async (req, res) => {
  const datos = cuerpo(req.body);
  res.json(
    await servicio.cambiarTurno(usuarioDe(req), String(req.params.id), {
      estado: typeof datos.estado === "string" ? datos.estado : undefined,
      ocultoEnHistorial: datos.ocultoEnHistorial === true ? true : undefined,
    }),
  );
});
