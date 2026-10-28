import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { distanciaKm } from "../utils/geo";
import { institucionCompatibleConMedico, institucionVisible, planDelPaciente } from "./cobertura";
import { aInstitucion, aSede, INCLUIR_INSTITUCION } from "./formato";

const TIPOS = ["hospital", "clinica", "centro_medico", "laboratorio"];

export interface FiltrosCentros {
  pacienteId: string;
  tipos?: string[];
  cerca?: { latitud: number; longitud: number };
  radioKm?: number;
  limite?: number;
  /** Solo esas sedes (p. ej. las que tienen turnos libres en la reserva). */
  sedeIds?: string[];
}

/**
 * Centros que el paciente puede usar, para el mapa, la lista y "Mi plan": cobertura (reglas 1 y 15) → tipos →
 * radio → orden por distancia → límite. Cada uno con su sede más cercana y por qué lo ve.
 */
export async function buscarCentros(filtros: FiltrosCentros) {
  const plan = await planDelPaciente(filtros.pacienteId);
  const where: Prisma.InstitucionWhereInput[] = [institucionVisible(plan)];
  const tipos = filtros.tipos?.filter((t) => TIPOS.includes(t));
  if (tipos && tipos.length > 0) where.push({ tipo: { in: tipos } });
  if (filtros.sedeIds) where.push({ sedes: { some: { id: { in: filtros.sedeIds } } } });
  const instituciones = await prisma.institucion.findMany({ where: { AND: where }, include: INCLUIR_INSTITUCION });

  const { cerca } = filtros;
  const centros = instituciones.flatMap((i) => {
    const sedes = filtros.sedeIds ? i.sedes.filter((s) => filtros.sedeIds!.includes(s.id)) : i.sedes;
    const conDistancia = sedes.map((sede) => ({
      sede,
      distanciaKm: cerca ? distanciaKm(cerca.latitud, cerca.longitud, sede.latitud, sede.longitud) : undefined,
    }));
    // Para elegir entre sedes puntuales van todas; si no, la más cercana de cada institución.
    const elegidas = filtros.sedeIds
      ? conDistancia
      : conDistancia.length > 0
        ? [conDistancia.reduce((a, b) => ((b.distanciaKm ?? 0) < (a.distanciaKm ?? 0) ? b : a))]
        : [];
    return elegidas
      .filter((c) => filtros.radioKm === undefined || c.distanciaKm === undefined || c.distanciaKm <= filtros.radioKm)
      .map((c) => ({
        institucion: aInstitucion(i),
        sede: aSede(c.sede),
        ...(c.distanciaKm !== undefined ? { distanciaKm: c.distanciaKm } : {}),
        motivo: i.origen === "publico" ? ("publica" as const) : ("cobertura" as const),
      }));
  });
  centros.sort((a, b) =>
    a.distanciaKm !== undefined && b.distanciaKm !== undefined
      ? a.distanciaKm - b.distanciaKm
      : a.institucion.nombre.localeCompare(b.institucion.nombre, "es"),
  );
  return filtros.limite ? centros.slice(0, filtros.limite) : centros;
}

export async function obtenerInstitucion(id: string) {
  const institucion = await prisma.institucion.findUnique({ where: { id }, include: INCLUIR_INSTITUCION });
  if (!institucion) throw new ErrorHttp(404, "No existe esa institución.");
  return aInstitucion(institucion);
}

/** Lugares de atención: cada sede con su institución, en el orden pedido (las que no existen se omiten). */
export async function lugaresDeAtencion(sedeIds: string[]) {
  const sedes = await prisma.sede.findMany({ where: { id: { in: sedeIds } }, include: { institucion: { include: INCLUIR_INSTITUCION } } });
  return sedeIds.flatMap((id) => {
    const sede = sedes.find((s) => s.id === id);
    return sede ? [{ sede: aSede(sede), institucion: aInstitucion(sede.institucion) }] : [];
  });
}

/** Sin tildes ni mayúsculas, para buscar "guemes" y encontrar "Güemes". */
const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Búsqueda de lugares por nombre de la institución, para que el profesional elija dónde atiende. Devuelve como
 * mucho 30 (son ~1.000 establecimientos).
 */
export async function buscarLugares(texto: string, medicoId?: string) {
  const buscado = normalizar(texto.trim());
  if (buscado.length < 2) return [];
  // A un profesional solo le aparecen los lugares compatibles con sus coberturas.
  const coberturas = medicoId ? await prisma.medicoCobertura.findMany({ where: { medicoId } }) : null;
  const sedes = await prisma.sede.findMany({
    where: { institucion: coberturas ? institucionCompatibleConMedico(coberturas) : { activa: true } },
    include: { institucion: { include: INCLUIR_INSTITUCION } },
  });
  return sedes
    .filter((s) => normalizar(s.institucion.nombre).includes(buscado) || normalizar(s.direccion).includes(buscado))
    .slice(0, 30)
    .map((s) => ({ sede: aSede(s), institucion: aInstitucion(s.institucion) }));
}
