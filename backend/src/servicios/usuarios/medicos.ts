import type { Prisma } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { filasValidadas, institucionCompatibleConMedico, medicoVisible, planDelPaciente } from "../catalogos/cobertura";
import { aMedico, CoberturaAceptada, INCLUIR_MEDICO } from "../formato";

const MAXIMO_LUGARES = 30;

interface FiltrosMedico {
  sedeId?: string;
  pacienteId?: string;
}

/** Calcula el promedio de estrellas (un decimal) y la cantidad de opiniones de cada profesional, sin las ocultas. */
async function valoraciones(medicoIds: string[]) {
  const filas = await prisma.feedback.findMany({
    where: { oculto: false, turno: { medicoId: { in: medicoIds } } },
    select: { estrellas: true, turno: { select: { medicoId: true } } },
  });

  const porMedico = new Map<string, { suma: number; cantidad: number }>();
  for (const { estrellas, turno } of filas) {
    const total = porMedico.get(turno.medicoId) ?? { suma: 0, cantidad: 0 };
    porMedico.set(turno.medicoId, { suma: total.suma + estrellas, cantidad: total.cantidad + 1 });
  }

  return (id: string) => {
    const { suma, cantidad } = porMedico.get(id) ?? { suma: 0, cantidad: 0 };
    return { promedio: cantidad > 0 ? Math.round((suma / cantidad) * 10) / 10 : 0, cantidad };
  };
}

/** Obtiene los profesionales que cumplen el filtro, por apellido y con su valoración. */
export async function buscar(where: Prisma.MedicoWhereInput) {
  const medicos = await prisma.medico.findMany({ where, include: INCLUIR_MEDICO, orderBy: { usuario: { apellido: "asc" } } });
  const valoracionDe = await valoraciones(medicos.map((m) => m.id));
  return medicos.map((m) => aMedico(m, valoracionDe(m.id)));
}

/** Busca los profesionales activos; a un paciente solo le muestra los que atienden su cobertura. */
export async function buscarMedicos(filtros: FiltrosMedico) {
  const where: Prisma.MedicoWhereInput[] = [{ usuario: { activo: true } }];
  if (filtros.pacienteId) where.push(medicoVisible(await planDelPaciente(filtros.pacienteId)));
  if (filtros.sedeId) where.push({ lugares: { some: { sedeId: filtros.sedeId } } });
  return buscar({ AND: where });
}

/** Obtiene un profesional; 404 si no existe. */
export async function obtenerMedico(id: string) {
  const [medico] = await buscar({ id });
  if (!medico) throw new ErrorHttp(404, "No existe ese profesional.");
  return medico;
}

/** Reemplaza las coberturas que atiende el profesional. */
export async function guardarCoberturas(medicoId: string, usuarioId: string, coberturas: CoberturaAceptada[]) {
  const filas = await filasValidadas(coberturas);

  await prisma.$transaction([
    prisma.medicoCobertura.deleteMany({ where: { medicoId } }),
    prisma.medicoCobertura.createMany({ data: filas.map((f) => ({ ...f, medicoId })) }),
  ]);
  await registrarAccion({ usuarioId, accion: "coberturas_profesional", entidad: "medico", entidadId: medicoId });

  return obtenerMedico(medicoId);
}

/**
 * Reemplaza los lugares del profesional: los nuevos tienen que ser compatibles con sus coberturas y los que saca
 * pierden sus franjas.
 */
export async function guardarLugares(medicoId: string, usuarioId: string, sedeIds: string[]) {
  const unicas = [...new Set(sedeIds)];
  if (unicas.length > MAXIMO_LUGARES) throw new ErrorHttp(400, "Son demasiados lugares.");

  const [existentes, actuales] = await Promise.all([
    prisma.sede.count({ where: { id: { in: unicas }, institucion: { activa: true } } }),
    prisma.medicoSede.findMany({ where: { medicoId }, select: { sedeId: true } }),
  ]);
  if (existentes !== unicas.length) throw new ErrorHttp(400, "Uno de los lugares no existe.");

  const yaTenia = new Set(actuales.map((a) => a.sedeId));
  const nuevas = unicas.filter((id) => !yaTenia.has(id));
  if (nuevas.length > 0) {
    const coberturas = await prisma.medicoCobertura.findMany({ where: { medicoId } });
    const compatibles = await prisma.sede.count({ where: { id: { in: nuevas }, institucion: institucionCompatibleConMedico(coberturas) } });
    if (compatibles !== nuevas.length) {
      throw new ErrorHttp(400, "Uno de los lugares no acepta ninguna de tus coberturas. Elegí uno público o que acepte alguna.");
    }
  }

  await prisma.$transaction([
    prisma.franjaAtencion.deleteMany({ where: { medicoId, sedeId: { notIn: unicas } } }),
    prisma.medicoSede.deleteMany({ where: { medicoId } }),
    prisma.medicoSede.createMany({ data: unicas.map((sedeId) => ({ medicoId, sedeId })) }),
  ]);
  await registrarAccion({ usuarioId, accion: "lugares_profesional", entidad: "medico", entidadId: medicoId });

  return obtenerMedico(medicoId);
}
