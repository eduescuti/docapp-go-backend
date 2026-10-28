import type { Medico, Paciente, Usuario } from "@prisma/client";

/** El usuario de la sesión, con su perfil de paciente o profesional (lo pone el middleware `autenticar`). */
export type UsuarioDeSesion = Usuario & { paciente: Paciente | null; medico: Medico | null };

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioDeSesion;
      sesionId?: string;
    }
  }
}
