import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";

// Fotos de perfil del paciente y del profesional (decidido el 27/10/2026). Cada foto es un archivo en
// uploads/fotos/ (fuera de git, como los PDF) con un nombre al azar que cambia en cada foto nueva; la base
// guarda solo ese nombre (usuarios.fotoArchivo). La URL no se puede adivinar y solo la reciben quienes pueden
// ver a esa persona, así que la imagen se sirve sin token: en web, `Image` no puede mandar el header
// Authorization (06-reglas-de-negocio.md, "Fotos de perfil").

export const CARPETA_FOTOS = path.resolve(__dirname, "..", "..", "..", "uploads", "fotos");

/** La app manda ~50-150 KB (la achica a 512×512 en el teléfono); 1 MB deja margen sin aceptar fotos crudas. */
export const TAMANO_MAXIMO_FOTO = 1024 * 1024;

const TIPOS = { jpg: "image/jpeg", png: "image/png" } as const;
type Extension = keyof typeof TIPOS;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** "<uuid v4>.jpg" o ".png": lo único que se acepta en la URL (así no se puede pedir otro archivo del disco). */
const NOMBRE_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png)$/;

/** Detecta JPG o PNG por los primeros bytes, no por lo que diga el cliente. */
function extensionDe(imagen: Buffer): Extension | null {
  if (imagen.length > 3 && imagen[0] === 0xff && imagen[1] === 0xd8 && imagen[2] === 0xff) return "jpg";
  if (imagen.subarray(0, 8).equals(FIRMA_PNG)) return "png";
  return null;
}

/** Arma la `avatarUrl` de una foto (relativa: la app le agrega la dirección del servidor). */
export const urlFoto = (fotoArchivo: string | null): string | null => (fotoArchivo ? `/api/fotos/${fotoArchivo}` : null);

/** Obtiene el nombre del archivo de la foto actual del usuario, o null. */
async function fotoActual(usuarioId: string): Promise<string | null> {
  const { fotoArchivo } = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { fotoArchivo: true } });
  return fotoArchivo;
}

/** Borra el archivo de una foto (si no existe, no hace nada). */
async function borrarArchivo(archivo: string): Promise<void> {
  await rm(path.join(CARPETA_FOTOS, archivo), { force: true });
}

/** Guarda la foto nueva, borra la anterior y devuelve su `avatarUrl`. */
export async function guardarFoto(usuarioId: string, imagen: Buffer, ip: string): Promise<string> {
  const extension = extensionDe(imagen);
  if (!extension) throw new ErrorHttp(400, "La foto tiene que ser una imagen JPG o PNG.");
  if (imagen.length > TAMANO_MAXIMO_FOTO) throw new ErrorHttp(413, "La foto es demasiado grande (máximo 1 MB).");

  const anterior = await fotoActual(usuarioId);
  const archivo = `${randomUUID()}.${extension}`;
  await mkdir(CARPETA_FOTOS, { recursive: true });
  await writeFile(path.join(CARPETA_FOTOS, archivo), imagen, { flag: "wx" });

  try {
    await prisma.usuario.update({ where: { id: usuarioId }, data: { fotoArchivo: archivo } });
  } catch (e) {
    await borrarArchivo(archivo);
    throw e;
  }

  if (anterior) await borrarArchivo(anterior);
  await registrarAccion({ usuarioId, accion: "foto_perfil_cambiada", entidad: "usuario", entidadId: usuarioId, ip });
  return urlFoto(archivo)!;
}

/** Quita la foto del usuario y borra su archivo. */
export async function quitarFoto(usuarioId: string, ip: string): Promise<void> {
  const fotoArchivo = await fotoActual(usuarioId);
  if (!fotoArchivo) return;

  await prisma.usuario.update({ where: { id: usuarioId }, data: { fotoArchivo: null } });
  await borrarArchivo(fotoArchivo);
  await registrarAccion({ usuarioId, accion: "foto_perfil_quitada", entidad: "usuario", entidadId: usuarioId, ip });
}

/** Obtiene la ruta y el tipo de una foto pedida por URL; 404 si no es válida, no es de nadie o la cuenta está inactiva. */
export async function archivoDeFoto(archivo: string): Promise<{ ruta: string; tipo: string }> {
  const noExiste = new ErrorHttp(404, "No existe esa foto.");
  if (!NOMBRE_VALIDO.test(archivo)) throw noExiste;

  const usuario = await prisma.usuario.findUnique({ where: { fotoArchivo: archivo }, select: { activo: true } });
  if (!usuario?.activo) throw noExiste;

  const ruta = path.join(CARPETA_FOTOS, archivo);
  if (!(await stat(ruta).catch(() => null))?.isFile()) throw noExiste;
  return { ruta, tipo: TIPOS[path.extname(archivo).slice(1) as Extension] };
}
