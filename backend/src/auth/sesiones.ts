import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../db";
import type { UsuarioDeSesion } from "../tipos/express";

const MS_DIA = 24 * 60 * 60 * 1000;
/** Días sin usar la app hasta que vence la sesión (decidido el 27/10/2026). */
const DIAS_SESION_INACTIVA = Number(process.env.DIAS_SESION_INACTIVA ?? 90);
/** `ultimoUsoEn` se actualiza como mucho una vez por minuto, no en cada pedido. */
const RENOVAR_CADA_MS = 60 * 1000;

export const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

const vencimientoDesde = (ahora: Date) => new Date(ahora.getTime() + DIAS_SESION_INACTIVA * MS_DIA);

/** Token opaco de 32 bytes. En la base queda solo su hash: si se copia la base, los tokens no sirven. */
export async function crearSesion(usuarioId: string, origen: { ip?: string; dispositivo?: string }) {
  const token = randomBytes(32).toString("base64url");
  const ahora = new Date();
  const sesion = await prisma.sesion.create({
    data: { usuarioId, tokenHash: sha256(token), expiraEn: vencimientoDesde(ahora), ultimoUsoEn: ahora, ...origen },
  });
  return { token, sesion };
}

/** La sesión del token si es válida (no revocada, no vencida, usuario activo), con el usuario y su perfil. */
export async function sesionDelToken(token: string) {
  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: sha256(token) },
    include: { usuario: { include: { paciente: true, medico: true } } },
  });
  const ahora = new Date();
  if (!sesion || sesion.revocadaEn || sesion.expiraEn <= ahora || !sesion.usuario.activo) return null;
  // Vencimiento por inactividad: cada uso corre el vencimiento 90 días.
  if (ahora.getTime() - sesion.ultimoUsoEn.getTime() > RENOVAR_CADA_MS) {
    await prisma.sesion.update({ where: { id: sesion.id }, data: { ultimoUsoEn: ahora, expiraEn: vencimientoDesde(ahora) } });
  }
  return sesion;
}

export async function revocarSesion(sesionId: string): Promise<void> {
  await prisma.sesion.update({ where: { id: sesionId }, data: { revocadaEn: new Date() } });
}

/** Al cambiar la contraseña se cortan todas las otras sesiones del usuario. */
export async function revocarOtrasSesiones(usuarioId: string, exceptoId: string): Promise<void> {
  await prisma.sesion.updateMany({ where: { usuarioId, id: { not: exceptoId }, revocadaEn: null }, data: { revocadaEn: new Date() } });
}

/** Borra sesiones vencidas o revocadas hace más de 30 días (se llama al iniciar el servidor). */
export async function limpiarSesionesViejas(): Promise<number> {
  const hace30 = new Date(Date.now() - 30 * MS_DIA);
  const { count } = await prisma.sesion.deleteMany({ where: { OR: [{ expiraEn: { lt: hace30 } }, { revocadaEn: { lt: hace30 } }] } });
  return count;
}

/** "2026-10-27T14:30" en hora argentina, como `iniciadaEn` del frontend. */
function fechaHoraArgentina(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}

/** La sesión con la forma de `Sesion` del frontend (src/domain/usuario.ts). */
export function sesionParaLaApp(usuario: UsuarioDeSesion, creadaEn: Date) {
  const base = { dni: usuario.dni, nombreCompleto: `${usuario.nombre} ${usuario.apellido}`, iniciadaEn: fechaHoraArgentina(creadaEn) };
  if (usuario.rol === "paciente" && usuario.paciente) return { ...base, rol: "paciente" as const, pacienteId: usuario.paciente.id };
  if (usuario.rol === "doctor" && usuario.medico) return { ...base, rol: "doctor" as const, medicoId: usuario.medico.id };
  return { ...base, rol: "admin" as const, nombreCompleto: "Administrador" };
}

/** Lo que devuelven el login y los registros: `{ token, expiraEn, sesion }`. */
export async function respuestaDeIngreso(usuario: UsuarioDeSesion, origen: { ip?: string; dispositivo?: string }) {
  const { token, sesion } = await crearSesion(usuario.id, origen);
  return { token, expiraEn: sesion.expiraEn.toISOString(), sesion: sesionParaLaApp(usuario, sesion.creadaEn) };
}
