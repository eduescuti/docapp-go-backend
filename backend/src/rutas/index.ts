import { Router } from "express";

import { probarConexion } from "../utils/db";
import { admin } from "./admin";
import { auth } from "./auth";
import { catalogos } from "./catalogos";
import { ordenes, recetas, resultados } from "./estudios";
import { fotoDePerfil, fotos } from "./fotos";
import { instituciones, sedes } from "./instituciones";
import { medicos } from "./medicos";
import { notificaciones } from "./notificaciones";
import { pacientes } from "./pacientes";
import { turnos } from "./turnos";

/**
 * El mapa de la API. Cada línea es prefijo + router: `api.use("/auth", auth)` junto con `auth.post("/login", ...)`
 * es POST /api/auth/login (el "/api" lo agrega index.ts). Cada router se crea con `Router()` en su archivo.
 */
export const api = Router();

// GET /api/health: confirma que la API está encendida y que llega a la base.
api.get("/health", async (_req, res) => {
  await probarConexion();
  res.json({ ok: true });
});

api.use("/auth", auth);
api.use("/catalogos", catalogos);
api.use("/pacientes", pacientes);
api.use("/medicos", medicos);
api.use("/turnos", turnos);
api.use("/instituciones", instituciones);
api.use("/sedes", sedes);
api.use("/ordenes", ordenes);
api.use("/resultados", resultados);
api.use("/recetas", recetas);
api.use("/usuarios/yo/foto", fotoDePerfil);
api.use("/fotos", fotos);
api.use("/notificaciones", notificaciones);
api.use("/admin", admin);
