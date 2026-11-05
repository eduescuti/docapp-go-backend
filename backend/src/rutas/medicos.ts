import { Router } from "express";

import { autenticar, medicoIdDe, requerirRol, usuarioDe } from "../middlewares/autenticar";
import { coberturasDelCuerpo } from "../servicios/catalogos/cobertura";
import * as estudios from "../servicios/historialMedico/estudios";
import * as recetas from "../servicios/historialMedico/recetas";
import * as disponibilidad from "../servicios/turnos/disponibilidad";
import * as turnos from "../servicios/turnos/turnos";
import * as servicio from "../servicios/usuarios/medicos";
import * as notas from "../servicios/usuarios/notas";
import { ErrorHttp } from "../utils/errores";
import { esHoraDeTurno } from "../utils/tiempo";
import { cuerpo, texto } from "../utils/validacion";

export const medicos = Router();
medicos.use(autenticar);

const parametro = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 100) : undefined);

// GET /api/medicos?sede= → a un paciente solo los que atienden su cobertura; con `sede`, solo los que atienden ahí.
medicos.get("/", async (req, res) => {
  res.json(await servicio.buscarMedicos({ sedeId: parametro(req.query.sede), pacienteId: usuarioDe(req).paciente?.id }));
});

// GET /api/medicos/yo → el perfil del profesional de la sesión.
medicos.get("/yo", requerirRol("doctor"), async (req, res) => {
  res.json(await servicio.obtenerMedico(medicoIdDe(req)));
});

// PUT /api/medicos/yo/coberturas { coberturas: [{ obraSocialId, planesIds? }] } → reemplaza la lista.
medicos.put("/yo/coberturas", requerirRol("doctor"), async (req, res) => {
  const datos = cuerpo(req.body);
  res.json(await servicio.guardarCoberturas(medicoIdDe(req), usuarioDe(req).id, coberturasDelCuerpo(datos.coberturas)));
});

// PUT /api/medicos/yo/lugares { sedeIds } → sus lugares de atención.
medicos.put("/yo/lugares", requerirRol("doctor"), async (req, res) => {
  const { sedeIds } = cuerpo(req.body);
  if (!Array.isArray(sedeIds) || sedeIds.some((id) => typeof id !== "string")) throw new ErrorHttp(400, 'Falta la lista "sedeIds".');
  res.json(await servicio.guardarLugares(medicoIdDe(req), usuarioDe(req).id, sedeIds as string[]));
});

// GET /api/medicos/yo/agenda → todos sus turnos (pasados y futuros) con paciente (y su foto), sede e institución.
medicos.get("/yo/agenda", requerirRol("doctor"), async (req, res) => {
  res.json(await turnos.agenda(medicoIdDe(req)));
});

// GET /api/medicos/yo/pacientes → pacientes asignados (con un turno próximo con él), con su foto.
medicos.get("/yo/pacientes", requerirRol("doctor"), async (req, res) => {
  res.json(await turnos.pacientesAsignados(medicoIdDe(req)));
});

// Ficha del paciente (vínculo por turnos; si no hay, 404): órdenes y recetas que él emitió y sus notas privadas.
medicos.get("/yo/pacientes/:pacienteId/ordenes", requerirRol("doctor"), async (req, res) => {
  res.json(await estudios.ordenesEmitidas(medicoIdDe(req), String(req.params.pacienteId)));
});
medicos.get("/yo/pacientes/:pacienteId/recetas", requerirRol("doctor"), async (req, res) => {
  res.json(await recetas.recetasEmitidas(medicoIdDe(req), String(req.params.pacienteId)));
});
medicos.get("/yo/pacientes/:pacienteId/notas", requerirRol("doctor"), async (req, res) => {
  res.json(await notas.notasDelPaciente(medicoIdDe(req), String(req.params.pacienteId)));
});
// POST /api/medicos/yo/pacientes/:pacienteId/notas { texto } → 201.
medicos.post("/yo/pacientes/:pacienteId/notas", requerirRol("doctor"), async (req, res) => {
  res.status(201).json(await notas.crearNota(medicoIdDe(req), String(req.params.pacienteId), texto(cuerpo(req.body), "texto", 2000)));
});

// GET /api/medicos/yo/franjas → sus franjas de atención.
medicos.get("/yo/franjas", requerirRol("doctor"), async (req, res) => {
  res.json(await disponibilidad.misFranjas(medicoIdDe(req)));
});

// PUT /api/medicos/yo/franjas { franjas: [{ sedeId, diaSemana, desde, hasta }] } → reemplaza todas.
medicos.put("/yo/franjas", requerirRol("doctor"), async (req, res) => {
  const { franjas } = cuerpo(req.body);
  if (!Array.isArray(franjas) || franjas.length > 100) throw new ErrorHttp(400, 'Falta la lista "franjas".');
  const lista = franjas.map((f: unknown) => {
    const { sedeId, diaSemana, desde, hasta } = (typeof f === "object" && f !== null ? f : {}) as Record<string, unknown>;
    if (typeof sedeId !== "string" || !Number.isInteger(diaSemana) || (diaSemana as number) < 0 || (diaSemana as number) > 6) {
      throw new ErrorHttp(400, "Franja inválida.");
    }
    if (typeof desde !== "string" || typeof hasta !== "string" || !esHoraDeTurno(desde) || !esHoraDeTurno(hasta)) {
      throw new ErrorHttp(400, "Los horarios van en punto o y media (p. ej. 09:00 o 09:30).");
    }
    return { sedeId, diaSemana: diaSemana as number, desde, hasta };
  });
  res.json(await disponibilidad.guardarFranjas(medicoIdDe(req), usuarioDe(req).id, lista));
});

// GET /api/medicos/:id → perfil público.
medicos.get("/:id", async (req, res) => {
  res.json(await servicio.obtenerMedico(req.params.id));
});
