import { Router } from "express";

import { autenticar, usuarioDe } from "../middlewares/autenticar";
import * as notificaciones from "../servicios/notificaciones";

/** Las notificaciones del usuario de la sesión (paciente o profesional). */
export const rutasNotificaciones = Router();
rutasNotificaciones.use(autenticar);

// GET /api/notificaciones → las del usuario, de la más nueva a la más vieja.
rutasNotificaciones.get("/", async (req, res) => {
  const usuario = usuarioDe(req);
  res.json(await notificaciones.listar(usuario.id, usuario.paciente?.id));
});

// PATCH /api/notificaciones → 204 (marca todas como leídas).
rutasNotificaciones.patch("/", async (req, res) => {
  await notificaciones.marcarTodas(usuarioDe(req).id);
  res.status(204).end();
});

// PATCH /api/notificaciones/:id → 204 (la marca como leída).
rutasNotificaciones.patch("/:id", async (req, res) => {
  await notificaciones.marcarLeida(usuarioDe(req).id, String(req.params.id));
  res.status(204).end();
});
