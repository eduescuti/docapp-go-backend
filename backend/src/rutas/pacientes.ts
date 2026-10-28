import { Router, type Request } from "express";

import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import { aPaciente, INCLUIR_PACIENTE } from "../servicios/formato";
import * as estudios from "../servicios/estudios";
import * as feedback from "../servicios/feedback";
import * as recetas from "../servicios/recetas";
import * as turnos from "../servicios/turnos";
import { cuerpo, texto } from "../validacion";

/** El paciente de la sesión: siempre sale del token, nunca de la URL (`/yo`). */
export const rutasPacientes = Router();
rutasPacientes.use(autenticar, requerirRol("paciente"));

const pacienteIdDe = (req: Request) => usuarioDe(req).paciente!.id;
const leer = async (id: string) => aPaciente(await prisma.paciente.findUniqueOrThrow({ where: { id }, include: INCLUIR_PACIENTE }));

// GET /api/pacientes/yo → con su plan y sus favoritos.
rutasPacientes.get("/yo", async (req, res) => {
  res.json(await leer(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/turnos → { proximos, historial } con profesional, especialidad, sede e institución.
rutasPacientes.get("/yo/turnos", async (req, res) => {
  res.json(await turnos.misTurnos(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/turnos/proximo → el próximo activo (Inicio) o null.
rutasPacientes.get("/yo/turnos/proximo", async (req, res) => {
  res.json(await turnos.proximoTurno(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/turnos/todos → todos sus turnos, también los que sacó del historial (historial médico).
rutasPacientes.get("/yo/turnos/todos", async (req, res) => {
  res.json(await turnos.todosLosTurnos(pacienteIdDe(req)));
});

// DELETE /api/pacientes/yo/turnos/historial → 204 ("Eliminar todo": oculta el historial; no borra nada).
rutasPacientes.delete("/yo/turnos/historial", async (req, res) => {
  await turnos.vaciarHistorial(pacienteIdDe(req));
  res.status(204).end();
});

/** "?archivadas=true|false" → true/false; sin el parámetro, todas (historial médico). */
const filtroArchivo = (valor: unknown) => (valor === "true" ? true : valor === "false" ? false : undefined);

// GET /api/pacientes/yo/ordenes?archivadas= → sus órdenes (pestaña, carpeta o todas).
rutasPacientes.get("/yo/ordenes", async (req, res) => {
  res.json(await estudios.ordenesDelPaciente(pacienteIdDe(req), filtroArchivo(req.query.archivadas)));
});

// GET /api/pacientes/yo/resultados?archivados= → sus resultados (sin estado).
rutasPacientes.get("/yo/resultados", async (req, res) => {
  res.json(await estudios.resultadosDelPaciente(pacienteIdDe(req), filtroArchivo(req.query.archivados)));
});

// GET /api/pacientes/yo/recetas → { activas, pasadas, archivadas } con profesional y especialidad.
rutasPacientes.get("/yo/recetas", async (req, res) => {
  res.json(await recetas.misRecetas(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/recetas/todas → todas, archivadas o no (historial médico).
rutasPacientes.get("/yo/recetas/todas", async (req, res) => {
  res.json(await recetas.todasLasRecetas(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/feedback/pendientes → turnos completados sin calificar.
rutasPacientes.get("/yo/feedback/pendientes", async (req, res) => {
  res.json(await feedback.pendientes(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/feedback → las calificaciones que ya dejó.
rutasPacientes.get("/yo/feedback", async (req, res) => {
  res.json(await feedback.enviados(pacienteIdDe(req)));
});

// PATCH /api/pacientes/yo { planMedicoId } → cambia de obra social / plan (lo que ve en toda la app).
rutasPacientes.patch("/yo", async (req, res) => {
  const planMedicoId = texto(cuerpo(req.body), "planMedicoId", 80);
  const plan = await prisma.planMedico.findFirst({ where: { id: planMedicoId, activo: true, obraSocial: { activa: true } } });
  if (!plan) throw new ErrorHttp(400, "Elegí tu obra social y tu plan.");
  const id = pacienteIdDe(req);
  await prisma.paciente.update({ where: { id }, data: { planMedicoId } });
  await registrarAccion({ usuarioId: usuarioDe(req).id, accion: "cambio_cobertura", entidad: "paciente", entidadId: id, detalle: planMedicoId });
  res.json(await leer(id));
});

// PUT /api/pacientes/yo/favoritos/medicos/:id · DELETE ... → marca o desmarca un profesional favorito.
rutasPacientes.put("/yo/favoritos/medicos/:medicoId", async (req, res) => {
  const pacienteId = pacienteIdDe(req);
  const { medicoId } = req.params;
  if (!(await prisma.medico.findUnique({ where: { id: medicoId } }))) throw new ErrorHttp(404, "No existe ese profesional.");
  await prisma.pacienteMedicoFavorito.upsert({ where: { pacienteId_medicoId: { pacienteId, medicoId } }, update: {}, create: { pacienteId, medicoId } });
  res.json(await leer(pacienteId));
});
rutasPacientes.delete("/yo/favoritos/medicos/:medicoId", async (req, res) => {
  const pacienteId = pacienteIdDe(req);
  await prisma.pacienteMedicoFavorito.deleteMany({ where: { pacienteId, medicoId: req.params.medicoId } });
  res.json(await leer(pacienteId));
});

// PUT /api/pacientes/yo/favoritos/instituciones/:id · DELETE ... → marca o desmarca una institución favorita.
rutasPacientes.put("/yo/favoritos/instituciones/:institucionId", async (req, res) => {
  const pacienteId = pacienteIdDe(req);
  const { institucionId } = req.params;
  if (!(await prisma.institucion.findUnique({ where: { id: institucionId } }))) throw new ErrorHttp(404, "No existe esa institución.");
  await prisma.pacienteInstitucionFavorita.upsert({
    where: { pacienteId_institucionId: { pacienteId, institucionId } },
    update: {},
    create: { pacienteId, institucionId },
  });
  res.json(await leer(pacienteId));
});
rutasPacientes.delete("/yo/favoritos/instituciones/:institucionId", async (req, res) => {
  const pacienteId = pacienteIdDe(req);
  await prisma.pacienteInstitucionFavorita.deleteMany({ where: { pacienteId, institucionId: req.params.institucionId } });
  res.json(await leer(pacienteId));
});
