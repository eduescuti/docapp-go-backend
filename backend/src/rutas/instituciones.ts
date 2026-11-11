import { Router } from "express";

import { autenticar, pacienteIdDe, requerirRol, usuarioDe } from "../middlewares/autenticar";
import * as servicio from "../servicios/catalogos/instituciones";
import { ErrorHttp } from "../utils/errores";
import { listaDeQuery } from "../utils/validacion";

/** Dos recursos del mismo tema, cada uno con su prefijo; cada ruta pide sesión. */
export const instituciones = Router();
export const sedes = Router();

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
      tipos: listaDeQuery(req.query.tipos, 200),
      cerca: lat !== undefined && lng !== undefined ? { latitud: lat, longitud: lng } : undefined,
      sedeIds: listaDeQuery(req.query.sedes, 200),
    }),
  );
});

// GET /api/instituciones/:id → institución con sedes y coberturas.
instituciones.get("/:id", autenticar, async (req, res) => {
  res.json(await servicio.obtenerInstitucion(String(req.params.id)));
});

// GET /api/sedes → cada sede con su institución. Buscar es filtrar el listado, así que no hay ruta "/buscar":
//  - ?q=texto → por nombre o dirección (el profesional elige dónde atiende: solo los públicos y los que aceptan
//    alguna de sus coberturas).
//  - ?ids=a,b → esas sedes, en ese orden (lugares de atención de un profesional).
sedes.get("/", autenticar, async (req, res) => {
  if (typeof req.query.q === "string") {
    res.json(await servicio.buscarLugares(req.query.q.slice(0, 100), usuarioDe(req).medico?.id));
    return;
  }
  res.json(await servicio.lugaresDeAtencion(listaDeQuery(req.query.ids, 200) ?? []));
});
