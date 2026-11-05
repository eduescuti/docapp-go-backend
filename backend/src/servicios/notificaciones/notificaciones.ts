import path from "node:path";

import type { Prisma } from "@prisma/client";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import { prisma } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { fechaHoraArgentina } from "../../utils/tiempo";

// Firebase Cloud Messaging (FCM) entrega los push a los teléfonos. Las credenciales son un JSON en la raíz del backend (fuera de git).
const CREDENCIALES_FIREBASE = path.resolve(__dirname, "..", "..", "..", "notificaciondocapp-firebase-adminsdk-fbsvc-0c178745ac.json");
const fcm = getMessaging(getApps().length === 0 ? initializeApp({ credential: cert(CREDENCIALES_FIREBASE) }) : getApps()[0]);

// Notificaciones: las genera el servidor cuando pasa algo, en la misma
// transacción que el cambio. Son del usuario (paciente o profesional).

const MAXIMO_LISTADO = 100;

type TipoNotificacion =
  | "turno_confirmado"
  | "turno_rechazado"
  | "turno_cancelado"
  | "turno_reprogramado"
  | "recordatorio_turno"
  | "resultado_disponible"
  | "nueva_receta"
  | "nueva_orden";

export interface Aviso {
  usuarioId: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  referenciaTipo?: "turno" | "orden" | "resultado" | "receta";
  referenciaId?: string;
}

/** Guarda el aviso en la base (dentro de la transacción del cambio) y lo devuelve para `enviarPush`. */
export async function notificar(aviso: Aviso, tx: Prisma.TransactionClient = prisma): Promise<Aviso> {
  await tx.notificacion.create({ data: aviso });
  return aviso;
}

/** Hace el cambio y guarda su aviso en una misma transacción; si sale bien, manda el push. */
export async function conAviso<T>(cambio: (tx: Prisma.TransactionClient) => Promise<T>, armarAviso: (resultado: T) => Aviso): Promise<T> {
  const [resultado, aviso] = await prisma.$transaction(async (tx) => {
    const hecho = await cambio(tx);
    return [hecho, await notificar(armarAviso(hecho), tx)] as const;
  });

  enviarPush(aviso);
  return resultado;
}

/** Manda los push después del commit y sin esperarlos: la respuesta al pedido no depende de FCM. */
export function enviarPush(...avisos: Aviso[]): void {
  for (const aviso of avisos) void despacharPush(aviso);
}

/** Manda el push a un teléfono; si falla, lo deja en la consola. */
async function mandarAlTelefono(token: string, aviso: Aviso): Promise<void> {
  try {
    await fcm.send({
      token,
      notification: { title: aviso.titulo, body: aviso.mensaje },
      data: { tipo: aviso.tipo, referenciaTipo: aviso.referenciaTipo ?? "", referenciaId: aviso.referenciaId ?? "" },
    });
    console.log(`📲 Push FCM enviado al token ${token.slice(0, 10)}...`);
  } catch (error) {
    console.error(`Error al mandar el push FCM al token ${token.slice(0, 10)}...:`, error);
  }
}

/** Manda el push a cada teléfono (sin repetir) con una sesión abierta del usuario. */
async function despacharPush(aviso: Aviso): Promise<void> {
  try {
    const sesiones = await prisma.sesion.findMany({
      where: { usuarioId: aviso.usuarioId, revocadaEn: null, expiraEn: { gt: new Date() }, fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    const tokens = new Set(sesiones.map((s) => s.fcmToken).filter((t): t is string => !!t));

    await Promise.all([...tokens].map((token) => mandarAlTelefono(token, aviso)));
  } catch (error) {
    console.error("Error al despachar push FCM:", error);
  }
}

/** Obtiene las notificaciones del usuario, de la más nueva a la más vieja (como `Notificacion` del frontend). */
export async function listar(usuarioId: string, pacienteId?: string) {
  const notificaciones = await prisma.notificacion.findMany({ where: { usuarioId }, orderBy: { creadaEn: "desc" }, take: MAXIMO_LISTADO });

  return notificaciones.map((n) => ({
    id: n.id,
    ...(pacienteId ? { pacienteId } : {}),
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    fecha: fechaHoraArgentina(n.creadaEn),
    leida: n.leida,
  }));
}

/** Marca como leída una notificación del usuario; 404 si no es suya. */
export async function marcarLeida(usuarioId: string, id: string): Promise<void> {
  const { count } = await prisma.notificacion.updateMany({ where: { id, usuarioId }, data: { leida: true } });
  if (count === 0) throw new ErrorHttp(404, "No existe esa notificación.");
}

/** Marca como leídas todas las notificaciones del usuario. */
export async function marcarTodas(usuarioId: string): Promise<void> {
  await prisma.notificacion.updateMany({ where: { usuarioId, leida: false }, data: { leida: true } });
}

/** Asocia el token FCM a la sesión y se lo saca a cualquier otra que lo tuviera (cada teléfono, un solo usuario). */
export async function guardarFcmToken(sesionId: string, token: string): Promise<void> {
  await prisma.$transaction([
    prisma.sesion.updateMany({ where: { fcmToken: token, id: { not: sesionId } }, data: { fcmToken: null } }),
    prisma.sesion.update({ where: { id: sesionId }, data: { fcmToken: token } }),
  ]);
}
