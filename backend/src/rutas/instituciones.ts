import { Router } from "express";

import { autenticar, pacienteIdDe, requerirRol, usuarioDe } from "../middlewares/autenticar";
import * as servicio from "../servicios/catalogos/instituciones";
import { ErrorHttp } from "../utils/errores";

/** Dos recursos del mismo tema, cada uno con su prefijo; cada ruta pide sesión. */
export const instituciones = Router();
export const sedes = Router();

/** "a,b,c" → ["a","b","c"] (como mucho 200). */
const lista = (valor: unknown) =>
  typeof valor === "string" && valor.trim() ? valor.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 200) : undefined;

function numero(valor: unknown, campo: string): number | undefined {
  if (valor === undefined || valor === "") return undefined;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new ErrorHttp(400, `"${campo}" tiene que ser un número.`);
  return n;
}

// GET /api/instituciones?tipos=&lat=&lng=&sedes= → los centros que puede usar el paciente.
instituciones.get("/", autenticar, requerirRol("paciente"), async (req, res) => {
  const lat = numero(req.query.lat, "lat");
  const lng = numero(req.query.lng, "lng");
  res.json(
    await servicio.buscarCentros({
      pacienteId: pacienteIdDe(req),
      tipos: lista(req.query.tipos),
      cerca: lat !== undefined && lng !== undefined ? { latitud: lat, longitud: lng } : undefined,
      sedeIds: lista(req.query.sedes),
    }),
  );
});

// GET /api/instituciones/:id → institución con sedes y coberturas.
instituciones.get("/:id", autenticar, async (req, res) => {
  res.json(await servicio.obtenerInstitucion(String(req.params.id)));
});

// GET /api/sedes/buscar?q= → lugares por nombre (el profesional elige dónde atiende: solo los públicos y los que
// aceptan alguna de sus coberturas).
sedes.get("/buscar", autenticar, async (req, res) => {
  res.json(
    await servicio.buscarLugares(typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "", usuarioDe(req).medico?.id),
  );
});

// GET /api/sedes?ids= → cada sede con su institución (lugares de atención de un profesional).
sedes.get("/", autenticar, async (req, res) => {
  res.json(await servicio.lugaresDeAtencion(lista(req.query.ids) ?? []));
});
