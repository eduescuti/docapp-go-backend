import { Router } from "express";

import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import * as feedback from "../servicios/feedback";
import * as turnos from "../servicios/turnos";
import { esFecha, esHoraDeTurno } from "../utils/tiempo";
import { cuerpo, texto } from "../validacion";

export const rutasTurnos = Router();
rutasTurnos.use(autenticar);

function fecha(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !esFecha(valor)) throw new ErrorHttp(400, `"${campo}" tiene que ser una fecha (aaaa-mm-dd).`);
  return valor;
}

function hora(valor: unknown): string {
  if (typeof valor !== "string" || !esHoraDeTurno(valor)) throw new ErrorHttp(400, 'La hora tiene que ser en punto o y media ("09:30").');
  return valor;
}

/** "?medicos=a,b" → ["a","b"] (sin el parámetro: todos los que le aparecen al paciente). */
const medicos = (valor: unknown) => (typeof valor === "string" && valor ? valor.split(",").slice(0, 50) : undefined);

const pacienteIdDe = (req: Parameters<typeof usuarioDe>[0]) => usuarioDe(req).paciente!.id;

// GET /api/turnos/disponibles?fecha=&medicos= → [{ medicoId, sedeId, hora }] libres ese día.
rutasTurnos.get("/disponibles", requerirRol("paciente"), async (req, res) => {
  res.json(await turnos.horariosLibres(pacienteIdDe(req), fecha(req.query.fecha, "fecha"), medicos(req.query.medicos)));
});

// GET /api/turnos/dias-con-turnos?desde=&hasta=&medicos= → ["2026-11-02", …]
rutasTurnos.get("/dias-con-turnos", requerirRol("paciente"), async (req, res) => {
  res.json(
    await turnos.diasConTurnos(pacienteIdDe(req), fecha(req.query.desde, "desde"), fecha(req.query.hasta, "hasta"), medicos(req.query.medicos)),
  );
});

// POST /api/turnos { fecha, hora, sedeId, especialidadId, medicoId } → 201 turno pendiente. Son los 5 pasos de la
// reserva, en orden: el backend revisa que la combinación entera sea válida.
rutasTurnos.post("/", requerirRol("paciente"), async (req, res) => {
  const datos = cuerpo(req.body);
  const turno = await turnos.reservar(pacienteIdDe(req), usuarioDe(req).id, {
    especialidadId: texto(datos, "especialidadId", 80),
    medicoId: texto(datos, "medicoId", 80),
    sedeId: texto(datos, "sedeId", 80),
    fecha: fecha(datos.fecha, "fecha"),
    hora: hora(datos.hora),
  });
  res.status(201).json(turno);
});

// POST /api/turnos/:id/reprogramar { sedeId, fecha, hora } → 201 turno nuevo (el viejo queda cancelado).
rutasTurnos.post("/:id/reprogramar", requerirRol("paciente"), async (req, res) => {
  const datos = cuerpo(req.body);
  const turno = await turnos.reprogramar(pacienteIdDe(req), usuarioDe(req).id, String(req.params.id), {
    sedeId: texto(datos, "sedeId", 80),
    fecha: fecha(datos.fecha, "fecha"),
    hora: hora(datos.hora),
  });
  res.status(201).json(turno);
});

// POST /api/turnos/:id/feedback { estrellas, criterios?: { puntualidad?, atencion?, trato?, claridadExplicacion?,
// experienciaGeneral? }, comentario? }. Solo `estrellas` es obligatoria; cada criterio que venga va de 1 a 5.
rutasTurnos.post("/:id/feedback", requerirRol("paciente"), async (req, res) => {
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
rutasTurnos.patch("/:id", requerirRol("paciente", "doctor"), async (req, res) => {
  const datos = cuerpo(req.body);
  res.json(
    await turnos.cambiarTurno(usuarioDe(req), String(req.params.id), {
      estado: typeof datos.estado === "string" ? datos.estado : undefined,
      ocultoEnHistorial: datos.ocultoEnHistorial === true ? true : undefined,
    }),
  );
});
