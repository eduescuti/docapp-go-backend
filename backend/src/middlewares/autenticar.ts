import type { NextFunction, Request, Response } from "express";

import { sesionDelToken } from "../auth/sesiones";
import { ErrorHttp } from "../errores";
import type { UsuarioDeSesion } from "../tipos/express";

/** `Authorization: Bearer <token>` → `req.usuario`. Va en todas las rutas no públicas. */
export async function autenticar(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const [tipo, token] = (req.headers.authorization ?? "").split(" ");
  if (tipo !== "Bearer" || !token) throw new ErrorHttp(401, "Iniciá sesión.");
  const sesion = await sesionDelToken(token);
  if (!sesion) throw new ErrorHttp(401, "Tu sesión venció. Iniciá sesión de nuevo.");
  req.usuario = sesion.usuario;
  req.sesionId = sesion.id;
  next();
}

/** El usuario de la sesión (solo en rutas que pasaron por `autenticar`). */
export function usuarioDe(req: Request): UsuarioDeSesion {
  if (!req.usuario) throw new ErrorHttp(401, "Iniciá sesión.");
  return req.usuario;
}
