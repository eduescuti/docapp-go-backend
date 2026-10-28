import type { NextFunction, Request, Response } from "express";

import { ErrorHttp } from "../errores";

export type Rol = "paciente" | "doctor" | "admin";

/** Corta con 403 si el rol de la sesión no es uno de los indicados. Va después de `autenticar`. */
export const requerirRol =
  (...roles: Rol[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.usuario || !roles.includes(req.usuario.rol as Rol)) throw new ErrorHttp(403, "No tenés permiso para esto.");
    next();
  };
