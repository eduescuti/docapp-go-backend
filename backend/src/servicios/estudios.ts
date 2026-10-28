import path from "node:path";

import type { Orden, OrdenEstudio, Resultado } from "@prisma/client";

import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import type { UsuarioDeSesion } from "../tipos/express";
import { hoyArgentina } from "../utils/tiempo";
import { institucionVisible } from "./cobertura";
import { notificar } from "./notificaciones";
import { exigirVinculo } from "./vinculo";

// Órdenes y resultados (06-reglas-de-negocio.md#órdenes). Los resultados vienen solo del seed este sprint.

const CARPETA_UPLOADS = path.resolve(__dirname, "..", "..", "uploads");

/** Como `OrdenLaboratorio` del frontend. */
function aOrden(o: Orden & { estudios: OrdenEstudio[] }) {
  return {
    id: o.id,
    medicoId: o.medicoId,
    pacienteId: o.pacienteId,
    fecha: o.fecha,
    estudiosSolicitados: [...o.estudios].sort((a, b) => a.posicion - b.posicion).map((e) => e.nombre),
    indicaciones: o.indicaciones,
    institucionId: o.institucionId,
    estado: o.estado,
    ...(o.archivadoEl ? { archivadoEl: o.archivadoEl } : {}),
  };
}

/** Como `Estudio` (resultado) del frontend: el médico y el paciente son los de la orden. */
function aEstudio(r: Resultado & { orden: Orden }) {
  return {
    id: r.id,
    ordenId: r.ordenId,
    pacienteId: r.orden.pacienteId,
    tipo: r.tipo,
    institucionId: r.institucionId,
    medicoSolicitanteId: r.orden.medicoId,
    fecha: r.fecha,
    ...(r.archivadoEl ? { archivadoEl: r.archivadoEl } : {}),
  };
}

/** `archivadas`: true (carpeta), false (pestaña) o undefined (todas: historial médico). */
export async function ordenesDelPaciente(pacienteId: string, archivadas?: boolean) {
  const ordenes = await prisma.orden.findMany({
    where: { pacienteId, ...(archivadas === undefined ? {} : { archivadoEl: archivadas ? { not: null } : null }) },
    include: { estudios: true },
    orderBy: { fecha: "desc" },
  });
  return ordenes.map(aOrden);
}

export async function resultadosDelPaciente(pacienteId: string, archivados?: boolean) {
  const resultados = await prisma.resultado.findMany({
    where: { orden: { pacienteId }, ...(archivados === undefined ? {} : { archivadoEl: archivados ? { not: null } : null }) },
    include: { orden: true },
    orderBy: { fecha: "desc" },
  });
  return resultados.map(aEstudio);
}

/** Una orden: la ve el paciente dueño o el profesional que la emitió (regla 8). */
export async function obtenerOrden(usuario: UsuarioDeSesion, ordenId: string) {
  const orden = await prisma.orden.findUnique({ where: { id: ordenId }, include: { estudios: true } });
  const puede = orden && (orden.pacienteId === usuario.paciente?.id || orden.medicoId === usuario.medico?.id);
  if (!orden || !puede) throw new ErrorHttp(404, "No existe esa orden.");
  return aOrden(orden);
}

/** Órdenes que el profesional le asignó a un paciente (regla 7: siempre asociadas a quien las emitió). */
export async function ordenesEmitidas(medicoId: string, pacienteId: string) {
  await exigirVinculo(medicoId, pacienteId);
  const ordenes = await prisma.orden.findMany({ where: { medicoId, pacienteId }, include: { estudios: true }, orderBy: { fecha: "desc" } });
  return ordenes.map(aOrden);
}

export interface DatosNuevaOrden {
  pacienteId: string;
  institucionId: string;
  estudiosSolicitados: string[];
  indicaciones: string;
}

/**
 * El profesional le asigna una orden al paciente: en uno de sus lugares que le aparezca al paciente (público o que
 * acepte su cobertura). Fecha de hoy, nace pendiente y se le avisa al paciente.
 */
export async function crearOrden(medicoId: string, usuarioId: string, datos: DatosNuevaOrden) {
  await exigirVinculo(medicoId, datos.pacienteId);
  const estudios = datos.estudiosSolicitados.map((e) => e.trim()).filter(Boolean);
  if (estudios.length === 0) throw new ErrorHttp(400, "Indicá al menos un estudio.");
  if (estudios.length > 30) throw new ErrorHttp(400, "Son demasiados estudios para una orden.");
  const { plan, usuarioId: usuarioPaciente } = await prisma.paciente.findUniqueOrThrow({ where: { id: datos.pacienteId }, select: { plan: true, usuarioId: true } });
  const enSusLugares = await prisma.medicoSede.count({ where: { medicoId, sede: { institucionId: datos.institucionId } } });
  if (enSusLugares === 0) throw new ErrorHttp(400, "Elegí uno de tus lugares de atención.");
  if ((await prisma.institucion.count({ where: { id: datos.institucionId, ...institucionVisible(plan) } })) === 0) {
    throw new ErrorHttp(400, "Ese lugar no atiende la cobertura del paciente.");
  }
  const orden = await prisma.$transaction(async (tx) => {
    const creada = await tx.orden.create({
      data: {
        medicoId,
        pacienteId: datos.pacienteId,
        institucionId: datos.institucionId,
        fecha: hoyArgentina(),
        indicaciones: datos.indicaciones,
        estudios: { create: estudios.map((nombre, posicion) => ({ nombre: nombre.slice(0, 200), posicion })) },
      },
      include: { estudios: true, medico: { select: { genero: true, usuario: { select: { nombre: true, apellido: true } } } } },
    });
    const { medico } = creada;
    await notificar(
      {
        usuarioId: usuarioPaciente,
        tipo: "nueva_orden",
        titulo: "Nueva orden",
        mensaje: `${medico.genero === "femenino" ? "La Dra." : "El Dr."} ${medico.usuario.nombre} ${medico.usuario.apellido} te asignó una orden: ${estudios.join(", ")}.`,
        referenciaTipo: "orden",
        referenciaId: creada.id,
      },
      tx,
    );
    return creada;
  });
  await registrarAccion({ usuarioId, accion: "alta_orden", entidad: "orden", entidadId: orden.id });
  return aOrden(orden);
}

/** Archivar = `archivadoEl` hoy; desarchivar = null. Solo el paciente dueño; no cambia lo que ve el médico. */
export async function archivarOrden(pacienteId: string, ordenId: string, archivada: boolean) {
  const { count } = await prisma.orden.updateMany({ where: { id: ordenId, pacienteId }, data: { archivadoEl: archivada ? hoyArgentina() : null } });
  if (count === 0) throw new ErrorHttp(404, "No existe esa orden.");
  return aOrden(await prisma.orden.findUniqueOrThrow({ where: { id: ordenId }, include: { estudios: true } }));
}

export async function archivarResultado(pacienteId: string, resultadoId: string, archivado: boolean) {
  const { count } = await prisma.resultado.updateMany({ where: { id: resultadoId, orden: { pacienteId } }, data: { archivadoEl: archivado ? hoyArgentina() : null } });
  if (count === 0) throw new ErrorHttp(404, "No existe ese resultado.");
  return aEstudio(await prisma.resultado.findUniqueOrThrow({ where: { id: resultadoId }, include: { orden: true } }));
}

/**
 * Regla 8: el PDF lo descarga solo el paciente dueño o el médico de la orden, y cada descarga queda registrada.
 * Devuelve la ruta del archivo para mandarlo.
 */
export async function archivoDelResultado(usuario: UsuarioDeSesion, resultadoId: string, ip?: string): Promise<string> {
  const resultado = await prisma.resultado.findUnique({ where: { id: resultadoId }, include: { orden: true } });
  const puede = resultado && (resultado.orden.pacienteId === usuario.paciente?.id || resultado.orden.medicoId === usuario.medico?.id);
  if (!resultado || !puede) throw new ErrorHttp(404, "No existe ese resultado.");
  const ruta = path.resolve(CARPETA_UPLOADS, resultado.archivoRuta);
  // La ruta sale de la base, pero igual se verifica que no se vaya de uploads/.
  if (!ruta.startsWith(CARPETA_UPLOADS + path.sep)) throw new ErrorHttp(404, "No existe ese resultado.");
  await registrarAccion({ usuarioId: usuario.id, accion: "descarga_resultado", entidad: "resultado", entidadId: resultado.id, ip });
  return ruta;
}
