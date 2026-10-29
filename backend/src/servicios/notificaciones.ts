import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { fcm } from "../firebase";

// Notificaciones (06-reglas-de-negocio.md#notificaciones): las genera el servidor cuando pasa algo, en la misma
// transacción que el cambio. Son del usuario (paciente o profesional).

export type TipoNotificacion =
  | "turno_confirmado"
  | "turno_rechazado"
  | "turno_cancelado"
  | "turno_reprogramado"
  | "recordatorio_turno"
  | "resultado_disponible"
  | "nueva_receta"
  | "nueva_orden";

interface Aviso {
  usuarioId: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  referenciaTipo?: "turno" | "orden" | "resultado" | "receta";
  referenciaId?: string;
}

/** 
 * Crea una notificación en la BD y despacha el Push FCM si el usuario tiene token registrado.
 */
export async function notificar(aviso: Aviso, tx: Prisma.TransactionClient = prisma): Promise<void> {
  // 1. Guarda la notificación en la BD
  await tx.notificacion.create({ data: aviso });

  // 2. Busca los tokens de las sesiones activas del usuario
  try {
    const sesiones = await prisma.sesion.findMany({
      where: {
        usuarioId: aviso.usuarioId,
        revocadaEn: null,
        expiraEn: { gt: new Date() },
        fcmToken: { not: null },
      },
      select: { fcmToken: true },
    });

    // Filtra tokens válidos y elimina duplicados usando Set
    const tokensUnicos = Array.from(
      new Set(
        sesiones
          .map((s) => s.fcmToken)
          .filter((t): t is string => typeof t === "string" && t.length > 0)
      )
    );

    // Despacha un único push por cada dispositivo físico registrado
    for (const token of tokensUnicos) {
      await fcm.send({
        token,
        notification: {
          title: aviso.titulo,
          body: aviso.mensaje,
        },
        data: {
          tipo: aviso.tipo,
          referenciaTipo: aviso.referenciaTipo ?? "",
          referenciaId: aviso.referenciaId ?? "",
        },
      });
      console.log(`📲 Push FCM enviado al token ${token.slice(0, 10)}...`);
    }
  } catch (error) {
    console.error("Error al despachar push FCM:", error);
  }
}

/** "2026-10-27T14:30" en hora argentina, como `fecha` de la notificación del frontend. */
function fechaHora(fecha: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/** Las del usuario, de la más nueva a la más vieja (como `Notificacion` del frontend). */
export async function listar(usuarioId: string, pacienteId?: string) {
  const notificaciones = await prisma.notificacion.findMany({ 
    where: { usuarioId }, 
    orderBy: { creadaEn: "desc" }, 
    take: 100 
  });
  
  return notificaciones.map((n) => ({
    id: n.id,
    ...(pacienteId ? { pacienteId } : {}),
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    fecha: fechaHora(n.creadaEn),
    leida: n.leida,
  }));
}

export async function marcarLeida(usuarioId: string, id: string): Promise<void> {
  const { count } = await prisma.notificacion.updateMany({ 
    where: { id, usuarioId }, 
    data: { leida: true } 
  });
  if (count === 0) throw new ErrorHttp(404, "No existe esa notificación.");
}

export async function marcarTodas(usuarioId: string): Promise<void> {
  await prisma.notificacion.updateMany({ 
    where: { usuarioId, leida: false }, 
    data: { leida: true } 
  });
}

export async function guardarFcmToken(usuarioId: string, token: string): Promise<void> {
  // 1. Busca la sesión activa más reciente del usuario
  const sesionActiva = await prisma.sesion.findFirst({
    where: {
      usuarioId,
      revocadaEn: null,
      expiraEn: { gt: new Date() },
    },
    orderBy: { ultimoUsoEn: "desc" },
  });

  if (sesionActiva) {
    // 2. Limpia este token de cualquier otra sesión del mismo usuario para evitar duplicaciones
    await prisma.sesion.updateMany({
      where: {
        usuarioId,
        fcmToken: token,
        id: { not: sesionActiva.id },
      },
      data: { fcmToken: null },
    });

    // 3. Asigna el token a la sesión activa actual
    await prisma.sesion.update({
      where: { id: sesionActiva.id },
      data: { fcmToken: token },
    });
  }
}