import { Router } from "express";

import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import * as instituciones from "../servicios/instituciones";

/** Se monta en /api (son dos recursos: instituciones y sedes); cada ruta pide sesión. */
export const rutasInstituciones = Router();

/** "a,b,c" → ["a","b","c"] (como mucho 200). */
const lista = (valor: unknown) =>
  typeof valor === "string" && valor.trim() ? valor.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 200) : undefined;

function numero(valor: unknown, campo: string): number | undefined {
  if (valor === undefined || valor === "") return undefined;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new ErrorHttp(400, `"${campo}" tiene que ser un número.`);
  return n;
}

// GET /api/instituciones?tipos=&lat=&lng=&radioKm=&limite=&sedes= → los centros que puede usar el paciente.
rutasInstituciones.get("/instituciones", autenticar, requerirRol("paciente"), async (req, res) => {
  const lat = numero(req.query.lat, "lat");
  const lng = numero(req.query.lng, "lng");
  res.json(
    await instituciones.buscarCentros({
      pacienteId: usuarioDe(req).paciente!.id,
      tipos: lista(req.query.tipos),
      cerca: lat !== undefined && lng !== undefined ? { latitud: lat, longitud: lng } : undefined,
      radioKm: numero(req.query.radioKm, "radioKm"),
      limite: numero(req.query.limite, "limite"),
      sedeIds: lista(req.query.sedes),
    }),
  );
});

// GET /api/instituciones/:id → institución con sedes y coberturas.
rutasInstituciones.get("/instituciones/:id", autenticar, async (req, res) => {
  res.json(await instituciones.obtenerInstitucion(String(req.params.id)));
});

// GET /api/sedes/buscar?q= → lugares por nombre (el profesional elige dónde atiende: solo los públicos y los que
// aceptan alguna de sus coberturas).
rutasInstituciones.get("/sedes/buscar", autenticar, async (req, res) => {
  res.json(
    await instituciones.buscarLugares(typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "", usuarioDe(req).medico?.id),
  );
});

// GET /api/sedes?ids= → cada sede con su institución (lugares de atención de un profesional).
rutasInstituciones.get("/sedes", autenticar, async (req, res) => {
  res.json(await instituciones.lugaresDeAtencion(lista(req.query.ids) ?? []));
});
