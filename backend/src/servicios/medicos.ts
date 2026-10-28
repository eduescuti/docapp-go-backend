import type { Prisma } from "@prisma/client";

import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { filasValidadas, institucionCompatibleConMedico, medicoVisible, planDelPaciente } from "./cobertura";
import { aMedico, CoberturaAceptada, INCLUIR_MEDICO } from "./formato";

/** Promedio de estrellas y cantidad de feedback (sin los ocultos por moderación), por profesional. */
async function valoraciones(medicoIds: string[]) {
  const filas = await prisma.feedback.findMany({
    where: { oculto: false, turno: { medicoId: { in: medicoIds } } },
    select: { estrellas: true, turno: { select: { medicoId: true } } },
  });
  const porMedico = new Map<string, number[]>();
  for (const f of filas) porMedico.set(f.turno.medicoId, [...(porMedico.get(f.turno.medicoId) ?? []), f.estrellas]);
  return (id: string) => {
    const estrellas = porMedico.get(id) ?? [];
    const promedio = estrellas.length ? estrellas.reduce((a, b) => a + b, 0) / estrellas.length : 0;
    return { promedio: Math.round(promedio * 10) / 10, cantidad: estrellas.length };
  };
}

/** Profesionales con la forma del frontend y su valoración calculada. */
export async function buscar(where: Prisma.MedicoWhereInput) {
  const medicos = await prisma.medico.findMany({ where, include: INCLUIR_MEDICO, orderBy: { usuario: { apellido: "asc" } } });
  const valoracionDe = await valoraciones(medicos.map((m) => m.id));
  return medicos.map((m) => aMedico(m, valoracionDe(m.id)));
}

export interface FiltrosMedico {
  especialidadId?: string;
  sedeId?: string;
  q?: string;
  /** Si busca un paciente: solo los que atienden su cobertura (regla 18). */
  pacienteId?: string;
}

/** Reglas 1 y 2: el profesional aparece si atiende la especialidad buscada y la cobertura del paciente. */
export async function buscarMedicos(filtros: FiltrosMedico) {
  const where: Prisma.MedicoWhereInput[] = [{ usuario: { activo: true } }];
  if (filtros.pacienteId) where.push(medicoVisible(await planDelPaciente(filtros.pacienteId)));
  if (filtros.especialidadId) where.push({ especialidadId: filtros.especialidadId });
  if (filtros.sedeId) where.push({ lugares: { some: { sedeId: filtros.sedeId } } });
  if (filtros.q) where.push({ usuario: { OR: [{ nombre: { contains: filtros.q } }, { apellido: { contains: filtros.q } }] } });
  return buscar({ AND: where });
}

export async function obtenerMedico(id: string) {
  const [medico] = await buscar({ id });
  if (!medico) throw new ErrorHttp(404, "No existe ese profesional.");
  return medico;
}

/** El profesional elige qué coberturas atiende (regla 17). Reemplaza la lista entera; los turnos tomados no cambian. */
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
 * El profesional elige en qué lugares atiende (decidido el 27/10/2026). Si saca uno, sus franjas de ese lugar se
 * borran (no puede atender donde no está); los turnos ya tomados no cambian.
 */
export async function guardarLugares(medicoId: string, usuarioId: string, sedeIds: string[]) {
  const unicas = [...new Set(sedeIds)];
  if (unicas.length > 30) throw new ErrorHttp(400, "Son demasiados lugares.");
  const existentes = await prisma.sede.count({ where: { id: { in: unicas }, institucion: { activa: true } } });
  if (existentes !== unicas.length) throw new ErrorHttp(400, "Uno de los lugares no existe.");
  // Los lugares nuevos tienen que ser compatibles con sus coberturas. Los que ya tenía se pueden conservar aunque
  // después haya cambiado de coberturas (sacarlos borraría sus horarios de ahí).
  const actuales = await prisma.medicoSede.findMany({ where: { medicoId }, select: { sedeId: true } });
  const nuevas = unicas.filter((id) => !actuales.some((a) => a.sedeId === id));
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
