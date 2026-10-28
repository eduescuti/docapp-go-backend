import { Router } from "express";

import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import * as admin from "../servicios/admin";
import { coberturasDelCuerpo } from "../servicios/cobertura";
import { cuerpo, texto, textoOpcional } from "../validacion";

/** Rutas del administrador general (regla 10). */
export const rutasAdmin = Router();
rutasAdmin.use(autenticar, requerirRol("admin"));

function numero(datos: Record<string, unknown>, campo: string): number {
  const n = typeof datos[campo] === "number" ? (datos[campo] as number) : Number.NaN;
  if (!Number.isFinite(n)) throw new ErrorHttp(400, `"${campo}" tiene que ser un número.`);
  return n;
}

const fuenteDe = (datos: Record<string, unknown>): admin.Fuente => ({
  fuente: texto(datos, "fuente", 40),
  fuenteUrl: textoOpcional(datos, "fuenteUrl", 500),
  verificadoEl: texto(datos, "verificadoEl", 10),
});

// GET /api/admin/instituciones?q= → todas, primero las que tienen coberturas.
rutasAdmin.get("/instituciones", async (req, res) => {
  res.json(await admin.listarInstituciones(typeof req.query.q === "string" ? req.query.q.slice(0, 100) : undefined));
});

// POST /api/admin/instituciones → 201 institución con su sede y sus coberturas.
rutasAdmin.post("/instituciones", async (req, res) => {
  const datos = cuerpo(req.body);
  const institucion = await admin.crearInstitucion(
    {
      nombre: texto(datos, "nombre", 150),
      tipo: texto(datos, "tipo", 30),
      direccion: texto(datos, "direccion", 200),
      ciudad: texto(datos, "ciudad", 80),
      telefono: textoOpcional(datos, "telefono", 40),
      latitud: numero(datos, "latitud"),
      longitud: numero(datos, "longitud"),
      coberturas: coberturasDelCuerpo(datos.coberturas),
      fuente: fuenteDe(datos),
    },
    usuarioDe(req).id,
  );
  res.status(201).json(institucion);
});

// PUT /api/admin/instituciones/:id/coberturas { coberturas, fuente, fuenteUrl?, verificadoEl } → reemplaza la lista.
rutasAdmin.put("/instituciones/:id/coberturas", async (req, res) => {
  const datos = cuerpo(req.body);
  res.json(await admin.guardarCoberturasInstitucion(String(req.params.id), coberturasDelCuerpo(datos.coberturas), fuenteDe(datos), usuarioDe(req).id));
});

// POST /api/admin/planes { obraSocial, plan? } → 201 plan con su obra social (crea la obra social si no existe).
rutasAdmin.post("/planes", async (req, res) => {
  const datos = cuerpo(req.body);
  res.status(201).json(await admin.crearPlan(texto(datos, "obraSocial", 120), textoOpcional(datos, "plan", 80), usuarioDe(req).id));
});

// GET /api/admin/estadisticas → { uso: { pacientes, profesionales, total }, porObraSocial: [{ obraSocial, cantidad }] }
rutasAdmin.get("/estadisticas", async (_req, res) => {
  res.json(await admin.estadisticas());
});

// GET /api/admin/metricas → turnos por estado / especialidad / institución, valoración media y mejor valorados.
rutasAdmin.get("/metricas", async (_req, res) => {
  res.json(await admin.metricas());
});
