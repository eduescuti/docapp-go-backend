import { prisma } from "../../utils/db";
import { aEspecialidad, INCLUIR_ESPECIALIDAD, sinNulos } from "../formato";

// Catálogos públicos: los usa el registro, sin sesión.

/** Obtiene las obras sociales activas con sus planes, sin los campos vacíos. */
export async function listarPlanes() {
  const obrasSociales = await prisma.obraSocial.findMany({
    where: { activa: true },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      registro: true,
      codigoOficial: true,
      planes: { where: { activo: true }, select: { id: true, obraSocialId: true, nombre: true }, orderBy: { nombre: "asc" } },
    },
  });

  return obrasSociales.map((o) => sinNulos(o));
}

/** Obtiene las especialidades con su profesión y sus subespecialidades. */
export async function listarEspecialidades() {
  const especialidades = await prisma.especialidad.findMany({ orderBy: { nombre: "asc" }, include: INCLUIR_ESPECIALIDAD });
  return especialidades.map(aEspecialidad);
}

/** Obtiene las profesiones del padrón local, para el selector del registro. */
export async function listarProfesiones(): Promise<string[]> {
  const filas = await prisma.profesionalPadron.findMany({ distinct: ["profesion"], select: { profesion: true }, orderBy: { profesion: "asc" } });
  return filas.map((f) => f.profesion);
}
