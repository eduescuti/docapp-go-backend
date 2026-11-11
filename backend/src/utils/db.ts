import { PrismaClient } from "@prisma/client";

// Una sola instancia de Prisma para toda la API: cada `new PrismaClient()` abre su propia conexión.
export const prisma = new PrismaClient();

/** Hace una consulta mínima: tira un error si no se llega a la base (lo usa /api/health). */
export async function probarConexion(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

interface Accion {
  usuarioId?: string | null;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: string;
  ip?: string;
}

/**
 * Registro de acciones importantes: logins, cambios de contraseña, altas. Si falla no corta el pedido:
 * se avisa en la consola.
 */
export async function registrarAccion(datos: Accion): Promise<void> {
  try {
    await prisma.registroAuditoria.create({ data: { ...datos, usuarioId: datos.usuarioId ?? null } });
  } catch (e) {
    console.error("No se pudo guardar en registro_auditoria:", e);
  }
}
