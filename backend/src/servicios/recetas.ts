import type { Receta } from "@prisma/client";

import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { diaSiguiente, hoyArgentina } from "../utils/tiempo";
import { buscar as buscarMedicos } from "./medicos";
import { notificar } from "./notificaciones";
import { exigirVinculo } from "./vinculo";

// Recetas (06-reglas-de-negocio.md#recetas). El estado (activa / pasada) no se guarda: se calcula con vigenteHasta.

/** Como `Receta` del frontend (la duración viaja como texto, "30 días"). */
export function aReceta(r: Receta) {
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

/** Recetas con el profesional y su especialidad (`RecetaConDetalle`). */
async function conDetalle(recetas: Receta[]) {
  const medicos = await buscarMedicos({ id: { in: [...new Set(recetas.map((r) => r.medicoId))] } });
  const especialidades = await prisma.especialidad.findMany({ include: { subespecialidades: { select: { nombre: true } } } });
  return recetas.map((r) => {
    const medico = medicos.find((m) => m.id === r.medicoId);
    const especialidad = especialidades.find((e) => e.id === medico?.especialidadId);
    return {
      receta: aReceta(r),
      medico,
      especialidad: especialidad && { id: especialidad.id, nombre: especialidad.nombre, subespecialidades: especialidad.subespecialidades.map((s) => s.nombre) },
    };
  });
}

/** Pestaña Recetas: activas (las que vencen antes primero), pasadas (las más recientes primero) y archivadas. */
export async function misRecetas(pacienteId: string) {
  const hoy = hoyArgentina();
  const recetas = await prisma.receta.findMany({ where: { pacienteId } });
  const activas = recetas.filter((r) => r.vigenteHasta >= hoy && !r.archivadoEl).sort((a, b) => a.vigenteHasta.localeCompare(b.vigenteHasta));
  const pasadas = recetas.filter((r) => r.vigenteHasta < hoy && !r.archivadoEl).sort((a, b) => b.vigenteHasta.localeCompare(a.vigenteHasta));
  const archivadas = recetas.filter((r) => r.archivadoEl);
  const detalle = await conDetalle([...activas, ...pasadas, ...archivadas]);
  return {
    activas: detalle.slice(0, activas.length),
    pasadas: detalle.slice(activas.length, activas.length + pasadas.length),
    archivadas: detalle.slice(activas.length + pasadas.length),
  };
}

/** Todas las recetas del paciente, archivadas o no (historial médico). */
export async function todasLasRecetas(pacienteId: string) {
  return (await prisma.receta.findMany({ where: { pacienteId }, orderBy: { fecha: "desc" } })).map(aReceta);
}

/** Solo las pasadas se archivan (una activa → 409). Archivar = hoy; desarchivar = null. */
export async function archivarReceta(pacienteId: string, recetaId: string, archivada: boolean) {
  const receta = await prisma.receta.findFirst({ where: { id: recetaId, pacienteId } });
  if (!receta) throw new ErrorHttp(404, "No existe esa receta.");
  if (archivada && receta.vigenteHasta >= hoyArgentina()) throw new ErrorHttp(409, "Solo se pueden archivar las recetas pasadas.");
  return aReceta(await prisma.receta.update({ where: { id: receta.id }, data: { archivadoEl: archivada ? hoyArgentina() : null } }));
}

export async function recetasEmitidas(medicoId: string, pacienteId: string) {
  await exigirVinculo(medicoId, pacienteId);
  return (await prisma.receta.findMany({ where: { medicoId, pacienteId }, orderBy: { fecha: "desc" } })).map(aReceta);
}

export interface DatosNuevaReceta {
  pacienteId: string;
  medicacion: string;
  dosis: string;
  frecuencia: string;
  duracionDias: number;
  indicaciones?: string;
}

/** El profesional le emite una receta al paciente, con la fecha de hoy; es activa hasta hoy + duración. */
export async function crearReceta(medicoId: string, usuarioId: string, datos: DatosNuevaReceta) {
  await exigirVinculo(medicoId, datos.pacienteId);
  if (!Number.isInteger(datos.duracionDias) || datos.duracionDias < 1 || datos.duracionDias > 365) {
    throw new ErrorHttp(400, "La duración tiene que ser de 1 a 365 días.");
  }
  const fecha = hoyArgentina();
  let vigenteHasta = fecha;
  for (let i = 0; i < datos.duracionDias; i++) vigenteHasta = diaSiguiente(vigenteHasta);
  const receta = await prisma.$transaction(async (tx) => {
    const creada = await tx.receta.create({
      data: { ...datos, medicoId, fecha, vigenteHasta, indicaciones: datos.indicaciones || null },
      include: { paciente: { select: { usuarioId: true } }, medico: { select: { genero: true, usuario: { select: { nombre: true, apellido: true } } } } },
    });
    const { medico } = creada;
    await notificar(
      {
        usuarioId: creada.paciente.usuarioId,
        tipo: "nueva_receta",
        titulo: "Nueva receta",
        mensaje: `${medico.genero === "femenino" ? "La Dra." : "El Dr."} ${medico.usuario.nombre} ${medico.usuario.apellido} te emitió una receta: ${creada.medicacion}.`,
        referenciaTipo: "receta",
        referenciaId: creada.id,
      },
      tx,
    );
    return creada;
  });
  await registrarAccion({ usuarioId, accion: "alta_receta", entidad: "receta", entidadId: receta.id });
  return aReceta(receta);
}
