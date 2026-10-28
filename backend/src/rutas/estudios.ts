import { Router, type Request } from "express";

import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import * as estudios from "../servicios/estudios";
import * as recetas from "../servicios/recetas";
import { cuerpo, texto, textoOpcional } from "../validacion";

/** Órdenes, resultados y recetas. Se monta en /api; cada ruta pide sesión. */
export const rutasEstudios = Router();

const pacienteIdDe = (req: Request) => usuarioDe(req).paciente!.id;
function medicoIdDe(req: Request): string {
  const medico = usuarioDe(req).medico;
  if (!medico) throw new ErrorHttp(403, "No tenés permiso para esto.");
  return medico.id;
}

function booleano(datos: Record<string, unknown>, campo: string): boolean {
  if (typeof datos[campo] !== "boolean") throw new ErrorHttp(400, `"${campo}" tiene que ser true o false.`);
  return datos[campo] as boolean;
}

// POST /api/ordenes { pacienteId, institucionId, estudiosSolicitados, indicaciones } → 201 orden pendiente.
rutasEstudios.post("/ordenes", autenticar, requerirRol("doctor"), async (req, res) => {
  const datos = cuerpo(req.body);
  if (!Array.isArray(datos.estudiosSolicitados) || datos.estudiosSolicitados.some((e) => typeof e !== "string")) {
    throw new ErrorHttp(400, "Indicá al menos un estudio.");
  }
  const orden = await estudios.crearOrden(medicoIdDe(req), usuarioDe(req).id, {
    pacienteId: texto(datos, "pacienteId", 80),
    institucionId: texto(datos, "institucionId", 80),
    estudiosSolicitados: datos.estudiosSolicitados as string[],
    indicaciones: texto(datos, "indicaciones", 600),
  });
  res.status(201).json(orden);
});

// GET /api/ordenes/:id → la ve el paciente dueño o el profesional que la emitió.
rutasEstudios.get("/ordenes/:id", autenticar, async (req, res) => {
  res.json(await estudios.obtenerOrden(usuarioDe(req), String(req.params.id)));
});

// PATCH /api/ordenes/:id { archivada } → el paciente la archiva o la desarchiva.
rutasEstudios.patch("/ordenes/:id", autenticar, requerirRol("paciente"), async (req, res) => {
  res.json(await estudios.archivarOrden(pacienteIdDe(req), String(req.params.id), booleano(cuerpo(req.body), "archivada")));
});

// PATCH /api/resultados/:id { archivado }
rutasEstudios.patch("/resultados/:id", autenticar, requerirRol("paciente"), async (req, res) => {
  res.json(await estudios.archivarResultado(pacienteIdDe(req), String(req.params.id), booleano(cuerpo(req.body), "archivado")));
});

// GET /api/resultados/:id/pdf → el PDF (paciente dueño o médico de la orden; queda registrado).
rutasEstudios.get("/resultados/:id/pdf", autenticar, requerirRol("paciente", "doctor"), async (req, res) => {
  const ruta = await estudios.archivoDelResultado(usuarioDe(req), String(req.params.id), req.ip);
  res.type("application/pdf");
  // Son datos médicos: que ningún intermediario los guarde.
  res.set("Cache-Control", "no-store");
  res.sendFile(ruta);
});

// POST /api/recetas { pacienteId, medicacion, dosis, frecuencia, duracionDias, indicaciones? } → 201.
rutasEstudios.post("/recetas", autenticar, requerirRol("doctor"), async (req, res) => {
  const datos = cuerpo(req.body);
  const receta = await recetas.crearReceta(medicoIdDe(req), usuarioDe(req).id, {
    pacienteId: texto(datos, "pacienteId", 80),
    medicacion: texto(datos, "medicacion", 120),
    dosis: texto(datos, "dosis", 120),
    frecuencia: texto(datos, "frecuencia", 120),
    duracionDias: Number(datos.duracionDias),
    indicaciones: textoOpcional(datos, "indicaciones", 600),
  });
  res.status(201).json(receta);
});

// PATCH /api/recetas/:id { archivada } → solo las pasadas.
rutasEstudios.patch("/recetas/:id", autenticar, requerirRol("paciente"), async (req, res) => {
  res.json(await recetas.archivarReceta(pacienteIdDe(req), String(req.params.id), booleano(cuerpo(req.body), "archivada")));
});
