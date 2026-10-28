import { prisma } from "./db";

interface Accion {
  usuarioId?: string | null;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: string;
  ip?: string;
}

/**
 * Registro de acciones importantes (§11): logins, cambios de contraseña, altas. Si falla no corta el pedido:
 * se avisa en la consola.
 */
export async function registrarAccion(datos: Accion): Promise<void> {
  try {
    await prisma.registroAuditoria.create({ data: { ...datos, usuarioId: datos.usuarioId ?? null } });
  } catch (e) {
    console.error("No se pudo guardar en registro_auditoria:", e);
  }
}
