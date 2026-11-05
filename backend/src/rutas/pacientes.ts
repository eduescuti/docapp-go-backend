import { Router } from "express";

import { autenticar, pacienteIdDe, requerirRol, usuarioDe } from "../middlewares/autenticar";
import * as estudios from "../servicios/historialMedico/estudios";
import * as recetas from "../servicios/historialMedico/recetas";
import * as feedback from "../servicios/turnos/feedback";
import * as turnos from "../servicios/turnos/turnos";
import * as servicio from "../servicios/usuarios/pacientes";
import { cuerpo, texto } from "../utils/validacion";

/** El paciente de la sesión: siempre sale del token, nunca de la URL (`/yo`). */
export const pacientes = Router();
pacientes.use(autenticar, requerirRol("paciente"));


// GET /api/pacientes/yo → con su plan y sus favoritos.
pacientes.get("/yo", async (req, res) => {
  res.json(await servicio.obtenerPaciente(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/turnos → { proximos, historial } con profesional, especialidad, sede e institución.
pacientes.get("/yo/turnos", async (req, res) => {
  res.json(await turnos.misTurnos(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/turnos/proximo → el próximo activo (Inicio) o null.
pacientes.get("/yo/turnos/proximo", async (req, res) => {
  res.json(await turnos.proximoTurno(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/turnos/todos → todos sus turnos, también los que sacó del historial (historial médico).
pacientes.get("/yo/turnos/todos", async (req, res) => {
  res.json(await turnos.todosLosTurnos(pacienteIdDe(req)));
});

// DELETE /api/pacientes/yo/turnos/historial → 204 ("Eliminar todo": oculta el historial; no borra nada).
pacientes.delete("/yo/turnos/historial", async (req, res) => {
  await turnos.vaciarHistorial(pacienteIdDe(req));
  res.status(204).end();
});

/** "?archivadas=true|false" → true/false; sin el parámetro, todas (historial médico). */
const filtroArchivo = (valor: unknown) => (valor === "true" ? true : valor === "false" ? false : undefined);

// GET /api/pacientes/yo/ordenes?archivadas= → sus órdenes (pestaña, carpeta o todas).
pacientes.get("/yo/ordenes", async (req, res) => {
  res.json(await estudios.ordenesDelPaciente(pacienteIdDe(req), filtroArchivo(req.query.archivadas)));
});

// GET /api/pacientes/yo/resultados?archivados= → sus resultados (sin estado).
pacientes.get("/yo/resultados", async (req, res) => {
  res.json(await estudios.resultadosDelPaciente(pacienteIdDe(req), filtroArchivo(req.query.archivados)));
});

// GET /api/pacientes/yo/recetas → { activas, pasadas, archivadas } con profesional y especialidad.
pacientes.get("/yo/recetas", async (req, res) => {
  res.json(await recetas.misRecetas(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/recetas/todas → todas, archivadas o no (historial médico).
pacientes.get("/yo/recetas/todas", async (req, res) => {
  res.json(await recetas.todasLasRecetas(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/feedback/pendientes → turnos completados sin calificar.
pacientes.get("/yo/feedback/pendientes", async (req, res) => {
  res.json(await feedback.pendientes(pacienteIdDe(req)));
});

// GET /api/pacientes/yo/feedback → las calificaciones que ya dejó.
pacientes.get("/yo/feedback", async (req, res) => {
  res.json(await feedback.enviados(pacienteIdDe(req)));
});

// PATCH /api/pacientes/yo { planMedicoId } → cambia de obra social / plan (lo que ve en toda la app).
pacientes.patch("/yo", async (req, res) => {
  const planMedicoId = texto(cuerpo(req.body), "planMedicoId", 80);
  res.json(await servicio.cambiarPlan(pacienteIdDe(req), usuarioDe(req).id, planMedicoId));
});

// PUT /api/pacientes/yo/favoritos/medicos/:id · DELETE ... → marca o desmarca un profesional favorito.
pacientes.put("/yo/favoritos/medicos/:medicoId", async (req, res) => {
  res.json(await servicio.marcarMedicoFavorito(pacienteIdDe(req), req.params.medicoId));
});
pacientes.delete("/yo/favoritos/medicos/:medicoId", async (req, res) => {
  res.json(await servicio.quitarMedicoFavorito(pacienteIdDe(req), req.params.medicoId));
});

// PUT /api/pacientes/yo/favoritos/instituciones/:id · DELETE ... → marca o desmarca una institución favorita.
pacientes.put("/yo/favoritos/instituciones/:institucionId", async (req, res) => {
  res.json(await servicio.marcarInstitucionFavorita(pacienteIdDe(req), req.params.institucionId));
});
pacientes.delete("/yo/favoritos/instituciones/:institucionId", async (req, res) => {
  res.json(await servicio.quitarInstitucionFavorita(pacienteIdDe(req), req.params.institucionId));
});
