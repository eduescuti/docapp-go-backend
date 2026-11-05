import type { Prisma } from "@prisma/client";

import { prisma } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { aInstitucion, aSede, INCLUIR_INSTITUCION } from "../formato";
import { institucionCompatibleConMedico, institucionVisible, planDelPaciente } from "./cobertura";

export const TIPOS_INSTITUCION = ["hospital", "clinica", "centro_medico", "laboratorio"];
const MAXIMO_LUGARES_BUSCADOS = 30;

const INCLUIR_SEDE = { institucion: { include: INCLUIR_INSTITUCION } } satisfies Prisma.SedeInclude;
type SedeConInstitucion = Prisma.SedeGetPayload<{ include: typeof INCLUIR_SEDE }>;

interface FiltrosCentros {
  pacienteId: string;
  tipos?: string[];
  cerca?: { latitud: number; longitud: number };
  /** Solo esas sedes (p. ej. las que tienen turnos libres en la reserva). */
  sedeIds?: string[];
}

/** Calcula la distancia en km entre dos coordenadas (fórmula de Haversine). */
function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Quita tildes y mayúsculas, para buscar "guemes" y encontrar "Güemes". */
const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Convierte una sede con su institución en `{ sede, institucion }`. */
const aLugar = (s: SedeConInstitucion) => ({ sede: aSede(s), institucion: aInstitucion(s.institucion) });

/** Busca los centros que ve el paciente, por tipo y ordenados por distancia, con su sede más cercana. */
export async function buscarCentros(filtros: FiltrosCentros) {
  const { cerca, sedeIds } = filtros;
  const plan = await planDelPaciente(filtros.pacienteId);

  const where: Prisma.InstitucionWhereInput[] = [institucionVisible(plan)];
  const tipos = filtros.tipos?.filter((t) => TIPOS_INSTITUCION.includes(t));
  if (tipos && tipos.length > 0) where.push({ tipo: { in: tipos } });
  if (sedeIds) where.push({ sedes: { some: { id: { in: sedeIds } } } });

  const instituciones = await prisma.institucion.findMany({ where: { AND: where }, include: INCLUIR_INSTITUCION });

  const centros = instituciones.flatMap((i) => {
    const sedes = (sedeIds ? i.sedes.filter((s) => sedeIds.includes(s.id)) : i.sedes).map((sede) => ({
      sede,
      distanciaKm: cerca ? distanciaKm(cerca.latitud, cerca.longitud, sede.latitud, sede.longitud) : undefined,
    }));
    const elegidas =
      sedeIds || sedes.length === 0 ? sedes : [sedes.reduce((a, b) => ((b.distanciaKm ?? 0) < (a.distanciaKm ?? 0) ? b : a))];
    const institucion = aInstitucion(i);
    const motivo = i.origen === "publico" ? ("publica" as const) : ("cobertura" as const);

    return elegidas.map((c) => ({
      institucion,
      sede: aSede(c.sede),
      ...(c.distanciaKm !== undefined ? { distanciaKm: c.distanciaKm } : {}),
      motivo,
    }));
  });

  return centros.sort((a, b) =>
    a.distanciaKm !== undefined && b.distanciaKm !== undefined
      ? a.distanciaKm - b.distanciaKm
      : a.institucion.nombre.localeCompare(b.institucion.nombre, "es"),
  );
}

/** Obtiene una institución; 404 si no existe. */
export async function obtenerInstitucion(id: string) {
  const institucion = await prisma.institucion.findUnique({ where: { id }, include: INCLUIR_INSTITUCION });
  if (!institucion) throw new ErrorHttp(404, "No existe esa institución.");
  return aInstitucion(institucion);
}

/** Obtiene cada sede con su institución, en el orden pedido (omite las que no existen). */
export async function lugaresDeAtencion(sedeIds: string[]) {
  const sedes = await prisma.sede.findMany({ where: { id: { in: sedeIds } }, include: INCLUIR_SEDE });

  return sedeIds.flatMap((id) => {
    const sede = sedes.find((s) => s.id === id);
    return sede ? [aLugar(sede)] : [];
  });
}

/** Busca sedes por nombre o dirección (hasta 30); a un profesional, solo las compatibles con sus coberturas. */
export async function buscarLugares(texto: string, medicoId?: string) {
  const buscado = normalizar(texto.trim());
  if (buscado.length < 2) return [];

  const coberturas = medicoId ? await prisma.medicoCobertura.findMany({ where: { medicoId } }) : null;
  const sedes = await prisma.sede.findMany({
    where: { institucion: coberturas ? institucionCompatibleConMedico(coberturas) : { activa: true } },
    include: INCLUIR_SEDE,
  });

  return sedes
    .filter((s) => normalizar(s.institucion.nombre).includes(buscado) || normalizar(s.direccion).includes(buscado))
    .slice(0, MAXIMO_LUGARES_BUSCADOS)
    .map(aLugar);
}
