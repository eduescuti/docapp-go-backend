import { createHash, randomBytes } from "node:crypto";

import type { Medico, Paciente, Usuario } from "@prisma/client";

import { prisma } from "../../utils/db";
import { fechaHoraArgentina } from "../../utils/tiempo";

/** El usuario de la sesión, con su perfil de paciente o profesional (lo carga `sesionDelToken`). */
export type UsuarioDeSesion = Usuario & { paciente: Paciente | null; medico: Medico | null };

type OrigenSesion = { ip?: string; dispositivo?: string };

const MS_DIA = 24 * 60 * 60 * 1000;
const DIAS_SESION_INACTIVA = Number(process.env.DIAS_SESION_INACTIVA ?? 90);
const RENOVAR_CADA_MS = 60 * 1000;
const DIAS_HASTA_BORRAR = 30;

/** Calcula el hash SHA-256 del texto, en hexadecimal. */
const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

/** Calcula el vencimiento de una sesión usada en ese momento. */
const vencimientoDesde = (ahora: Date) => new Date(ahora.getTime() + DIAS_SESION_INACTIVA * MS_DIA);

/** Crea una sesión con un token al azar; en la base queda solo su hash. */
async function crearSesion(usuarioId: string, origen: OrigenSesion) {
  const token = randomBytes(32).toString("base64url");
  const ahora = new Date();
  const sesion = await prisma.sesion.create({
    data: { usuarioId, tokenHash: sha256(token), expiraEn: vencimientoDesde(ahora), ultimoUsoEn: ahora, ...origen },
  });
  return { token, sesion };
}

/** Arma la `Sesion` del frontend según el rol de la cuenta. */
function sesionParaLaApp(usuario: UsuarioDeSesion, creadaEn: Date) {
  const base = { dni: usuario.dni, nombreCompleto: `${usuario.nombre} ${usuario.apellido}`, iniciadaEn: fechaHoraArgentina(creadaEn) };
  if (usuario.rol === "paciente" && usuario.paciente) return { ...base, rol: "paciente" as const, pacienteId: usuario.paciente.id };
  if (usuario.rol === "doctor" && usuario.medico) return { ...base, rol: "doctor" as const, medicoId: usuario.medico.id };
  return { ...base, rol: "admin" as const, nombreCompleto: "Administrador" };
}

/** Obtiene la sesión del token si sigue válida (o null) y corre su vencimiento por inactividad. */
export async function sesionDelToken(token: string) {
  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: sha256(token) },
    include: { usuario: { include: { paciente: true, medico: true } } },
  });

  const ahora = new Date();
  if (!sesion || sesion.revocadaEn || sesion.expiraEn <= ahora || !sesion.usuario.activo) return null;

  if (ahora.getTime() - sesion.ultimoUsoEn.getTime() > RENOVAR_CADA_MS) {
    await prisma.sesion.update({ where: { id: sesion.id }, data: { ultimoUsoEn: ahora, expiraEn: vencimientoDesde(ahora) } });
  }
  return sesion;
}

/** Revoca una sesión. */
export async function revocarSesion(sesionId: string): Promise<void> {
  await prisma.sesion.update({ where: { id: sesionId }, data: { revocadaEn: new Date() } });
}

/** Revoca todas las sesiones abiertas del usuario menos esa. */
export async function revocarOtrasSesiones(usuarioId: string, exceptoId: string): Promise<void> {
  await prisma.sesion.updateMany({ where: { usuarioId, id: { not: exceptoId }, revocadaEn: null }, data: { revocadaEn: new Date() } });
}

/** Borra las sesiones vencidas o revocadas hace más de 30 días y devuelve cuántas borró. */
export async function limpiarSesionesViejas(): Promise<number> {
  const limite = new Date(Date.now() - DIAS_HASTA_BORRAR * MS_DIA);
  const { count } = await prisma.sesion.deleteMany({ where: { OR: [{ expiraEn: { lt: limite } }, { revocadaEn: { lt: limite } }] } });
  return count;
}

/** Obtiene la sesión del pedido con la forma de `Sesion` del frontend. */
export async function sesionActual(usuario: UsuarioDeSesion, sesionId: string) {
  const sesion = await prisma.sesion.findUniqueOrThrow({ where: { id: sesionId } });
  return sesionParaLaApp(usuario, sesion.creadaEn);
}

/** Abre una sesión y devuelve `{ token, expiraEn, sesion }` (login y registros). */
export async function respuestaDeIngreso(usuario: UsuarioDeSesion, origen: OrigenSesion) {
  const { token, sesion } = await crearSesion(usuario.id, origen);
  return { token, expiraEn: sesion.expiraEn.toISOString(), sesion: sesionParaLaApp(usuario, sesion.creadaEn) };
}
