import type { NextFunction, Request, Response } from "express";
import { sesionDelToken, type UsuarioDeSesion } from "../servicios/sesion/sesiones";
import { ErrorHttp } from "../utils/errores";

// Importante para que compile correctamente:
// Agregación de los campos de `usuario` y `sesionId` al Request
declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioDeSesion;
      sesionId?: string;
    }
  }
}

/** Verifica el token de sesion si hay y asigna (usuario, sesionId) si hay sesion. 
 * Es para rutas que requieren sesión.
*/
export async function autenticar(req: Request, _res: Response, next: NextFunction): Promise<void> {

  const [tipo, token] = (req.headers.authorization ?? "").split(" ");
  if (tipo !== "Bearer" || !token) {
    throw new ErrorHttp(401, "Iniciá sesión.");
  };

  const sesion = await sesionDelToken(token);
  if (!sesion) throw new ErrorHttp(401, "Tu sesión venció. Iniciá sesión de nuevo.");

  req.usuario = sesion.usuario;
  req.sesionId = sesion.id;
  next();
}

/** Devuelve el usuario de la sesión (solo en rutas que pasaron por `autenticar`). */
export function usuarioDe(req: Request): UsuarioDeSesion {
  if (!req.usuario) throw new ErrorHttp(401, "Iniciá sesión.");
  return req.usuario;
}

/** El id del paciente de la sesión (solo en rutas que pasaron por `requerirRol("paciente")`). */
export function pacienteIdDe(req: Request): string {
  return usuarioDe(req).paciente!.id;
}

/** El id del profesional de la sesión. */
export function medicoIdDe(req: Request): string {
  const medico = usuarioDe(req).medico;
  if (!medico) throw new ErrorHttp(403, "No tenés permiso para esto.");
  return medico.id;
}

type Rol = "paciente" | "doctor" | "admin";

/**
 * Deja pasar solo a los roles indicados; al resto lo corta con 403. Va después de `autenticar`.
 */
export function requerirRol(...rolesPermitidos: Rol[]) {
  return function verificarRol(req: Request, _res: Response, next: NextFunction): void {

    const rol = req.usuario?.rol as Rol | undefined;

    if (!rol || !rolesPermitidos.includes(rol)) {
      throw new ErrorHttp(403, "No tenés permiso para esto.");
    }

    next();
  };
}
