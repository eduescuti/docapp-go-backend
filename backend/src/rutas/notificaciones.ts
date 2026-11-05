import { Router } from "express";

import { autenticar, usuarioDe } from "../middlewares/autenticar";
import * as servicio from "../servicios/notificaciones/notificaciones";

/** Las notificaciones del usuario de la sesión (paciente o profesional). */
export const notificaciones = Router();
notificaciones.use(autenticar);

// POST /api/notificaciones/fcm-token → asocia el token FCM a la sesión activa del usuario
notificaciones.post("/fcm-token", async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Token FCM inválido o ausente." });
      return;
    }

    usuarioDe(req);
    await servicio.guardarFcmToken(req.sesionId!, token);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// GET /api/notificaciones → las del usuario, de la más nueva a la más vieja.
notificaciones.get("/", async (req, res) => {
  const usuario = usuarioDe(req);
  res.json(await servicio.listar(usuario.id, usuario.paciente?.id));
});

// PATCH /api/notificaciones → 204 (marca todas como leídas).
notificaciones.patch("/", async (req, res) => {
  await servicio.marcarTodas(usuarioDe(req).id);
  res.status(204).end();
});

// PATCH /api/notificaciones/:id → 204 (la marca como leída).
notificaciones.patch("/:id", async (req, res) => {
  await servicio.marcarLeida(usuarioDe(req).id, String(req.params.id));
  res.status(204).end();
});