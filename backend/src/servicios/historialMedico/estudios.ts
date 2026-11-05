import path from "node:path";

import type { Orden, OrdenEstudio, Prisma, Resultado } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { hoyArgentina } from "../../utils/tiempo";
import { institucionVisible } from "../catalogos/cobertura";
import { nombreProfesional, PROFESIONAL_PARA_AVISO } from "../formato";
import { conAviso } from "../notificaciones/notificaciones";
import type { UsuarioDeSesion } from "../sesion/sesiones";
import { exigirVinculo } from "../usuarios/notas";

// Órdenes y resultados (06-reglas-de-negocio.md#órdenes). Los resultados vienen solo del seed este sprint.

const CARPETA_UPLOADS = path.resolve(__dirname, "..", "..", "..", "uploads");
const MAXIMO_ESTUDIOS = 30;
const INCLUIR_ORDEN = { estudios: true } satisfies Prisma.OrdenInclude;

interface DatosNuevaOrden {
  pacienteId: string;
  institucionId: string;
  estudiosSolicitados: string[];
  indicaciones: string;
}

/** Convierte una orden al formato `OrdenLaboratorio` del frontend, con los estudios en el orden pedido. */
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

/** Convierte un resultado al formato `Estudio` del frontend: el médico y el paciente son los de la orden. */
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

/** Arma el filtro por archivado: `true` solo archivados, `false` solo sin archivar, `undefined` todos. */
const filtroArchivado = (archivado?: boolean) => (archivado === undefined ? {} : { archivadoEl: archivado ? { not: null } : null });

/** Indica si el usuario es el paciente o el profesional de la orden. */
const esDeLaOrden = (usuario: UsuarioDeSesion, orden: { pacienteId: string; medicoId: string }) =>
  orden.pacienteId === usuario.paciente?.id || orden.medicoId === usuario.medico?.id;

/** Obtiene las órdenes del paciente, de la más nueva a la más vieja: archivadas, sin archivar o todas. */
export async function ordenesDelPaciente(pacienteId: string, archivadas?: boolean) {
  const ordenes = await prisma.orden.findMany({
    where: { pacienteId, ...filtroArchivado(archivadas) },
    include: INCLUIR_ORDEN,
    orderBy: { fecha: "desc" },
  });
  return ordenes.map(aOrden);
}

/** Obtiene los resultados del paciente, del más nuevo al más viejo: archivados, sin archivar o todos. */
export async function resultadosDelPaciente(pacienteId: string, archivados?: boolean) {
  const resultados = await prisma.resultado.findMany({
    where: { orden: { pacienteId }, ...filtroArchivado(archivados) },
    include: { orden: true },
    orderBy: { fecha: "desc" },
  });
  return resultados.map(aEstudio);
}

/** Obtiene una orden; solo la ven el paciente dueño y el profesional que la emitió. */
export async function obtenerOrden(usuario: UsuarioDeSesion, ordenId: string) {
  const orden = await prisma.orden.findUnique({ where: { id: ordenId }, include: INCLUIR_ORDEN });
  if (!orden || !esDeLaOrden(usuario, orden)) throw new ErrorHttp(404, "No existe esa orden.");
  return aOrden(orden);
}

/** Obtiene las órdenes que el profesional le asignó al paciente. */
export async function ordenesEmitidas(medicoId: string, pacienteId: string) {
  await exigirVinculo(medicoId, pacienteId);
  const ordenes = await prisma.orden.findMany({ where: { medicoId, pacienteId }, include: INCLUIR_ORDEN, orderBy: { fecha: "desc" } });
  return ordenes.map(aOrden);
}

/** Crea una orden del profesional para el paciente, en uno de sus lugares que el paciente vea, y le avisa. */
export async function crearOrden(medicoId: string, usuarioId: string, datos: DatosNuevaOrden) {
  await exigirVinculo(medicoId, datos.pacienteId);
  const estudios = datos.estudiosSolicitados.map((e) => e.trim()).filter(Boolean);
  if (estudios.length === 0) throw new ErrorHttp(400, "Indicá al menos un estudio.");
  if (estudios.length > MAXIMO_ESTUDIOS) throw new ErrorHttp(400, "Son demasiados estudios para una orden.");

  const [paciente, enSusLugares] = await Promise.all([
    prisma.paciente.findUniqueOrThrow({ where: { id: datos.pacienteId }, select: { plan: true, usuarioId: true } }),
    prisma.medicoSede.count({ where: { medicoId, sede: { institucionId: datos.institucionId } } }),
  ]);
  if (enSusLugares === 0) throw new ErrorHttp(400, "Elegí uno de tus lugares de atención.");
  if ((await prisma.institucion.count({ where: { id: datos.institucionId, ...institucionVisible(paciente.plan) } })) === 0) {
    throw new ErrorHttp(400, "Ese lugar no atiende la cobertura del paciente.");
  }

  const orden = await conAviso(
    (tx) =>
      tx.orden.create({
        data: {
          medicoId,
          pacienteId: datos.pacienteId,
          institucionId: datos.institucionId,
          fecha: hoyArgentina(),
          indicaciones: datos.indicaciones,
          estudios: { create: estudios.map((nombre, posicion) => ({ nombre: nombre.slice(0, 200), posicion })) },
        },
        include: { ...INCLUIR_ORDEN, medico: { select: PROFESIONAL_PARA_AVISO } },
      }),
    (o) => ({
      usuarioId: paciente.usuarioId,
      tipo: "nueva_orden",
      titulo: "Nueva orden",
      mensaje: `${nombreProfesional(o.medico)} te asignó una orden: ${estudios.join(", ")}.`,
      referenciaTipo: "orden",
      referenciaId: o.id,
    }),
  );
  await registrarAccion({ usuarioId, accion: "alta_orden", entidad: "orden", entidadId: orden.id });

  return aOrden(orden);
}

/** Archiva (con fecha de hoy) o desarchiva una orden del paciente. */
export async function archivarOrden(pacienteId: string, ordenId: string, archivada: boolean) {
  const { count } = await prisma.orden.updateMany({
    where: { id: ordenId, pacienteId },
    data: { archivadoEl: archivada ? hoyArgentina() : null },
  });
  if (count === 0) throw new ErrorHttp(404, "No existe esa orden.");

  return aOrden(await prisma.orden.findUniqueOrThrow({ where: { id: ordenId }, include: INCLUIR_ORDEN }));
}

/** Archiva (con fecha de hoy) o desarchiva un resultado del paciente. */
export async function archivarResultado(pacienteId: string, resultadoId: string, archivado: boolean) {
  const { count } = await prisma.resultado.updateMany({
    where: { id: resultadoId, orden: { pacienteId } },
    data: { archivadoEl: archivado ? hoyArgentina() : null },
  });
  if (count === 0) throw new ErrorHttp(404, "No existe ese resultado.");

  return aEstudio(await prisma.resultado.findUniqueOrThrow({ where: { id: resultadoId }, include: { orden: true } }));
}

/** Obtiene la ruta del PDF de un resultado (solo para el paciente o el profesional de la orden) y registra la descarga. */
export async function archivoDelResultado(usuario: UsuarioDeSesion, resultadoId: string, ip?: string): Promise<string> {
  const resultado = await prisma.resultado.findUnique({ where: { id: resultadoId }, include: { orden: true } });
  if (!resultado || !esDeLaOrden(usuario, resultado.orden)) throw new ErrorHttp(404, "No existe ese resultado.");

  const ruta = path.resolve(CARPETA_UPLOADS, resultado.archivoRuta);
  if (!ruta.startsWith(CARPETA_UPLOADS + path.sep)) throw new ErrorHttp(404, "No existe ese resultado.");

  await registrarAccion({ usuarioId: usuario.id, accion: "descarga_resultado", entidad: "resultado", entidadId: resultado.id, ip });
  return ruta;
}
