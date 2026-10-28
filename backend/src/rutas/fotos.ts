import express, { Router } from "express";

import { ErrorHttp } from "../errores";
import { autenticar, usuarioDe } from "../middlewares/autenticar";
import { requerirRol } from "../middlewares/requerirRol";
import * as fotos from "../servicios/fotos";
import { cuerpo } from "../validacion";

/** Fotos de perfil. Se montan en /api. */
export const rutasFotos = Router();

/**
 * La foto viaja en base64 dentro del JSON (un tercio más que la imagen) y supera el límite general de 100 kb: su
 * ruta tiene este parser propio, que se monta antes que el general en index.ts.
 */
export const parserFoto = express.json({ limit: Math.ceil((fotos.TAMANO_MAXIMO_FOTO * 4) / 3) + 1024 });

/** La imagen del body: base64, con o sin el prefijo "data:image/...;base64," que arma la versión web. */
function imagenDelCuerpo(datos: Record<string, unknown>): Buffer {
  const valor = datos.imagen;
  if (typeof valor !== "string" || !valor) throw new ErrorHttp(400, 'Falta el campo "imagen".');
  const base64 = valor.replace(/^data:image\/[a-z]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ErrorHttp(400, "La foto no llegó bien. Probá de nuevo.");
  return Buffer.from(base64, "base64");
}

// PUT /api/usuarios/yo/foto { imagen } (JPG o PNG en base64) → { avatarUrl }. Reemplaza la anterior.
rutasFotos.put("/usuarios/yo/foto", autenticar, requerirRol("paciente", "doctor"), async (req, res) => {
  const imagen = imagenDelCuerpo(cuerpo(req.body));
  res.json({ avatarUrl: await fotos.guardarFoto(usuarioDe(req).id, imagen, req.ip ?? "") });
});

// DELETE /api/usuarios/yo/foto → 204 (vuelven a verse las iniciales).
rutasFotos.delete("/usuarios/yo/foto", autenticar, requerirRol("paciente", "doctor"), async (req, res) => {
  await fotos.quitarFoto(usuarioDe(req).id, req.ip ?? "");
  res.status(204).end();
});

// GET /api/fotos/:archivo → la imagen. Sin token: la URL no se puede adivinar y cambia con cada foto, por eso
// se puede guardar en caché para siempre.
rutasFotos.get("/fotos/:archivo", async (req, res) => {
  const { ruta, tipo } = await fotos.archivoDeFoto(req.params.archivo);
  res.set({ "Content-Type": tipo, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  res.sendFile(ruta);
});
