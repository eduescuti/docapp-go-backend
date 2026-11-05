import { Router } from "express";

import * as servicio from "../servicios/catalogos/catalogos";

/** Catálogos públicos: los usa el registro, sin sesión. */
export const catalogos = Router();

// GET /api/catalogos/planes → obras sociales activas con sus planes (el registro elige obra social y después plan).
catalogos.get("/planes", async (_req, res) => {
  res.json(await servicio.listarPlanes());
});

// GET /api/catalogos/especialidades → con su profesión y los nombres de sus subespecialidades (como `Especialidad` del frontend).
catalogos.get("/especialidades", async (_req, res) => {
  res.json(await servicio.listarEspecialidades());
});

// GET /api/catalogos/profesiones → profesiones del padrón, para el selector del registro de profesional.
catalogos.get("/profesiones", async (_req, res) => {
  res.json(await servicio.listarProfesiones());
});
