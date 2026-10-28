import { Router } from "express";

import { prisma } from "../db";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { sesionParaLaApp } from "../auth/sesiones";
import { listarProfesiones } from "../servicios/auth";

/** Rutas públicas de catálogos (las usa el registro) y la sesión actual. Se montan en /api. */
export const rutasCatalogos = Router();

// GET /api/sesion → la sesión con la forma de `Sesion` del frontend (valida el token guardado en el teléfono).
rutasCatalogos.get("/sesion", autenticar, async (req, res) => {
  const sesion = await prisma.sesion.findUniqueOrThrow({ where: { id: req.sesionId! } });
  res.json(sesionParaLaApp(usuarioDe(req), sesion.creadaEn));
});

// GET /api/planes → obras sociales activas con sus planes (el registro elige obra social y después plan).
rutasCatalogos.get("/planes", async (_req, res) => {
  const obrasSociales = await prisma.obraSocial.findMany({
    where: { activa: true },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      registro: true,
      codigoOficial: true,
      planes: { where: { activo: true }, select: { id: true, obraSocialId: true, nombre: true }, orderBy: { nombre: "asc" } },
    },
  });
  // Los opcionales vacíos no viajan (en el frontend son `?:`, no `null`).
  res.json(obrasSociales.map((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null))));
});

// GET /api/especialidades → con su profesión y los nombres de sus subespecialidades (como `Especialidad` del frontend).
rutasCatalogos.get("/especialidades", async (_req, res) => {
  const especialidades = await prisma.especialidad.findMany({
    orderBy: { nombre: "asc" },
    include: { subespecialidades: { select: { nombre: true }, orderBy: { nombre: "asc" } } },
  });
  res.json(
    especialidades.map((e) => ({ id: e.id, nombre: e.nombre, profesion: e.profesion, subespecialidades: e.subespecialidades.map((s) => s.nombre) })),
  );
});

// GET /api/profesiones → profesiones del padrón, para el selector del registro de profesional.
rutasCatalogos.get("/profesiones", async (_req, res) => {
  res.json(await listarProfesiones());
});
