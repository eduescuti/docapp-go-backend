import { Router, type Request } from "express";

import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import { coberturasDelCuerpo } from "../servicios/cobertura";
import * as estudios from "../servicios/estudios";
import * as medicos from "../servicios/medicos";
import * as notas from "../servicios/notas";
import * as recetas from "../servicios/recetas";
import * as turnos from "../servicios/turnos";
import { esFecha, esHoraDeTurno } from "../utils/tiempo";
import { cuerpo, texto } from "../validacion";

export const rutasMedicos = Router();
rutasMedicos.use(autenticar);

const parametro = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 100) : undefined);

/** El id del profesional de la sesión. */
function medicoIdDe(req: Request): string {
  const medico = usuarioDe(req).medico;
  if (!medico) throw new ErrorHttp(403, "No tenés permiso para esto.");
  return medico.id;
}

// GET /api/medicos?especialidad=&sede=&q= → a un paciente solo los que atienden su cobertura.
rutasMedicos.get("/", async (req, res) => {
  const paciente = usuarioDe(req).paciente;
  res.json(
    await medicos.buscarMedicos({
      especialidadId: parametro(req.query.especialidad),
      sedeId: parametro(req.query.sede),
      q: parametro(req.query.q),
      pacienteId: paciente?.id,
    }),
  );
});

// GET /api/medicos/yo → el perfil del profesional de la sesión.
rutasMedicos.get("/yo", requerirRol("doctor"), async (req, res) => {
  res.json(await medicos.obtenerMedico(medicoIdDe(req)));
});

// PUT /api/medicos/yo/coberturas { coberturas: [{ obraSocialId, planesIds? }] } → reemplaza la lista.
rutasMedicos.put("/yo/coberturas", requerirRol("doctor"), async (req, res) => {
  const datos = cuerpo(req.body);
  res.json(await medicos.guardarCoberturas(medicoIdDe(req), usuarioDe(req).id, coberturasDelCuerpo(datos.coberturas)));
});

// PUT /api/medicos/yo/lugares { sedeIds } → sus lugares de atención.
rutasMedicos.put("/yo/lugares", requerirRol("doctor"), async (req, res) => {
  const { sedeIds } = cuerpo(req.body);
  if (!Array.isArray(sedeIds) || sedeIds.some((id) => typeof id !== "string")) throw new ErrorHttp(400, 'Falta la lista "sedeIds".');
  res.json(await medicos.guardarLugares(medicoIdDe(req), usuarioDe(req).id, sedeIds as string[]));
});

const fechaOpcional = (valor: unknown) => (typeof valor === "string" && esFecha(valor) ? valor : undefined);

// GET /api/medicos/yo/agenda?desde=&hasta= → sus turnos con paciente (y su foto), sede e institución.
rutasMedicos.get("/yo/agenda", requerirRol("doctor"), async (req, res) => {
  res.json(await turnos.agenda(medicoIdDe(req), fechaOpcional(req.query.desde), fechaOpcional(req.query.hasta)));
});

// GET /api/medicos/yo/pacientes → pacientes asignados (con un turno próximo con él), con su foto.
rutasMedicos.get("/yo/pacientes", requerirRol("doctor"), async (req, res) => {
  res.json(await turnos.pacientesAsignados(medicoIdDe(req)));
});

// Ficha del paciente (vínculo por turnos; si no hay, 404): órdenes y recetas que él emitió y sus notas privadas.
rutasMedicos.get("/yo/pacientes/:pacienteId/ordenes", requerirRol("doctor"), async (req, res) => {
  res.json(await estudios.ordenesEmitidas(medicoIdDe(req), String(req.params.pacienteId)));
});
rutasMedicos.get("/yo/pacientes/:pacienteId/recetas", requerirRol("doctor"), async (req, res) => {
  res.json(await recetas.recetasEmitidas(medicoIdDe(req), String(req.params.pacienteId)));
});
rutasMedicos.get("/yo/pacientes/:pacienteId/notas", requerirRol("doctor"), async (req, res) => {
  res.json(await notas.notasDelPaciente(medicoIdDe(req), String(req.params.pacienteId)));
});
// POST /api/medicos/yo/pacientes/:pacienteId/notas { texto } → 201.
rutasMedicos.post("/yo/pacientes/:pacienteId/notas", requerirRol("doctor"), async (req, res) => {
  res.status(201).json(await notas.crearNota(medicoIdDe(req), String(req.params.pacienteId), texto(cuerpo(req.body), "texto", 2000)));
});

// GET /api/medicos/yo/franjas → sus franjas de atención.
rutasMedicos.get("/yo/franjas", requerirRol("doctor"), async (req, res) => {
  res.json(await turnos.misFranjas(medicoIdDe(req)));
});

// PUT /api/medicos/yo/franjas { franjas: [{ sedeId, diaSemana, desde, hasta }] } → reemplaza todas.
rutasMedicos.put("/yo/franjas", requerirRol("doctor"), async (req, res) => {
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
  res.json(await turnos.guardarFranjas(medicoIdDe(req), usuarioDe(req).id, lista));
});

// GET /api/medicos/:id → perfil público.
rutasMedicos.get("/:id", async (req, res) => {
  res.json(await medicos.obtenerMedico(req.params.id));
});
