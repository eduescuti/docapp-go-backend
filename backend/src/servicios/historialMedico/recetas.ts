import type { Receta } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { hoyArgentina, sumarDias } from "../../utils/tiempo";
import { aEspecialidad, INCLUIR_ESPECIALIDAD, nombreProfesional, PROFESIONAL_PARA_AVISO } from "../formato";
import { conAviso } from "../notificaciones/notificaciones";
import { buscar as buscarMedicos } from "../usuarios/medicos";
import { exigirVinculo } from "../usuarios/notas";

// Recetas. El estado (activa / pasada) no se guarda: se calcula con vigenteHasta.

const DURACION_MAXIMA_DIAS = 365;

interface DatosNuevaReceta {
  pacienteId: string;
  medicacion: string;
  dosis: string;
  frecuencia: string;
  duracionDias: number;
  indicaciones?: string;
}

/** Convierte una receta al formato `Receta` del frontend: duración como texto ("30 días") y estado según la fecha. */
function aReceta(r: Receta) {
  return {
    id: r.id,
    medicoId: r.medicoId,
    pacienteId: r.pacienteId,
    fecha: r.fecha,
    medicacion: r.medicacion,
    dosis: r.dosis,
    frecuencia: r.frecuencia,
    duracion: `${r.duracionDias} ${r.duracionDias === 1 ? "día" : "días"}`,
    vigenteHasta: r.vigenteHasta,
    estado: r.vigenteHasta >= hoyArgentina() ? ("activa" as const) : ("pasada" as const),
    ...(r.archivadoEl ? { archivadoEl: r.archivadoEl } : {}),
    ...(r.indicaciones ? { indicaciones: r.indicaciones } : {}),
    ...(r.observaciones ? { observaciones: r.observaciones } : {}),
  };
}

/** Completa cada receta con su profesional y la especialidad de él (`RecetaConDetalle`). */
async function conDetalle(recetas: Receta[]) {
  const medicos = await buscarMedicos({ id: { in: [...new Set(recetas.map((r) => r.medicoId))] } });
  const especialidades = await prisma.especialidad.findMany({
    where: { id: { in: [...new Set(medicos.map((m) => m.especialidadId))] } },
    include: INCLUIR_ESPECIALIDAD,
  });

  return recetas.map((r) => {
    const medico = medicos.find((m) => m.id === r.medicoId);
    const especialidad = especialidades.find((e) => e.id === medico?.especialidadId);
    return { receta: aReceta(r), medico, especialidad: especialidad && aEspecialidad(especialidad) };
  });
}

/** Obtiene las recetas del paciente: activas (las que vencen antes primero), pasadas (las más recientes) y archivadas. */
export async function misRecetas(pacienteId: string) {
  const hoy = hoyArgentina();
  const recetas = await prisma.receta.findMany({ where: { pacienteId } });
  const sinArchivar = recetas.filter((r) => !r.archivadoEl);

  const activas = sinArchivar.filter((r) => r.vigenteHasta >= hoy).sort((a, b) => a.vigenteHasta.localeCompare(b.vigenteHasta));
  const pasadas = sinArchivar.filter((r) => r.vigenteHasta < hoy).sort((a, b) => b.vigenteHasta.localeCompare(a.vigenteHasta));
  const archivadas = recetas.filter((r) => r.archivadoEl);

  const detalle = await conDetalle([...activas, ...pasadas, ...archivadas]);
  return {
    activas: detalle.slice(0, activas.length),
    pasadas: detalle.slice(activas.length, activas.length + pasadas.length),
    archivadas: detalle.slice(activas.length + pasadas.length),
  };
}

/** Obtiene todas las recetas del paciente, archivadas o no. */
export async function todasLasRecetas(pacienteId: string) {
  const recetas = await prisma.receta.findMany({ where: { pacienteId }, orderBy: { fecha: "desc" } });
  return recetas.map(aReceta);
}

/** Archiva (con fecha de hoy) o desarchiva una receta pasada del paciente. */
export async function archivarReceta(pacienteId: string, recetaId: string, archivada: boolean) {
  const hoy = hoyArgentina();
  const receta = await prisma.receta.findFirst({ where: { id: recetaId, pacienteId } });
  if (!receta) throw new ErrorHttp(404, "No existe esa receta.");
  if (archivada && receta.vigenteHasta >= hoy) throw new ErrorHttp(409, "Solo se pueden archivar las recetas pasadas.");

  return aReceta(await prisma.receta.update({ where: { id: receta.id }, data: { archivadoEl: archivada ? hoy : null } }));
}

/** Obtiene las recetas que el profesional le emitió al paciente. */
export async function recetasEmitidas(medicoId: string, pacienteId: string) {
  await exigirVinculo(medicoId, pacienteId);
  const recetas = await prisma.receta.findMany({ where: { medicoId, pacienteId }, orderBy: { fecha: "desc" } });
  return recetas.map(aReceta);
}

/** Crea una receta del profesional para el paciente, vigente desde hoy por la duración indicada, y le avisa. */
export async function crearReceta(medicoId: string, usuarioId: string, datos: DatosNuevaReceta) {
  await exigirVinculo(medicoId, datos.pacienteId);
  if (!Number.isInteger(datos.duracionDias) || datos.duracionDias < 1 || datos.duracionDias > DURACION_MAXIMA_DIAS) {
    throw new ErrorHttp(400, `La duración tiene que ser de 1 a ${DURACION_MAXIMA_DIAS} días.`);
  }

  const fecha = hoyArgentina();
  const receta = await conAviso(
    (tx) =>
      tx.receta.create({
        data: { ...datos, medicoId, fecha, vigenteHasta: sumarDias(fecha, datos.duracionDias), indicaciones: datos.indicaciones || null },
        include: { paciente: { select: { usuarioId: true } }, medico: { select: PROFESIONAL_PARA_AVISO } },
      }),
    (r) => ({
      usuarioId: r.paciente.usuarioId,
      tipo: "nueva_receta",
      titulo: "Nueva receta",
      mensaje: `${nombreProfesional(r.medico)} te emitió una receta: ${r.medicacion}.`,
      referenciaTipo: "receta",
      referenciaId: r.id,
    }),
  );
  await registrarAccion({ usuarioId, accion: "alta_receta", entidad: "receta", entidadId: receta.id });

  return aReceta(receta);
}
