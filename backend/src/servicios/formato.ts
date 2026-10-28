import type { Prisma } from "@prisma/client";

import { urlFoto } from "./fotos";

// Convierten filas de Prisma en los objetos que espera el frontend (mismos nombres que src/domain/), así las
// pantallas no cambian al pasar de mocks a la API.

export interface CoberturaAceptada {
  obraSocialId: string;
  /** Omitido = todos los planes de esa obra social. */
  planesIds?: string[];
}

/** Filas de cobertura (una por plan, o una sin plan = todos) → `{ obraSocialId, planesIds? }[]`. */
export function agruparCoberturas(filas: { obraSocialId: string; planMedicoId: string | null }[]): CoberturaAceptada[] {
  const porObraSocial = new Map<string, string[] | null>();
  for (const { obraSocialId, planMedicoId } of filas) {
    const actual = porObraSocial.get(obraSocialId);
    if (planMedicoId === null || actual === null) porObraSocial.set(obraSocialId, null);
    else porObraSocial.set(obraSocialId, [...(actual ?? []), planMedicoId]);
  }
  return [...porObraSocial].map(([obraSocialId, planesIds]) => (planesIds ? { obraSocialId, planesIds } : { obraSocialId }));
}

export const INCLUIR_INSTITUCION = { sedes: { orderBy: { nombre: "asc" } }, coberturas: true } satisfies Prisma.InstitucionInclude;
type InstitucionCompleta = Prisma.InstitucionGetPayload<{ include: typeof INCLUIR_INSTITUCION }>;

const sinNulos = <T extends Record<string, unknown>>(objeto: T) =>
  Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== null)) as { [K in keyof T]: Exclude<T[K], null> };

export function aSede(sede: InstitucionCompleta["sedes"][number]) {
  return sinNulos({
    id: sede.id,
    institucionId: sede.institucionId,
    nombre: sede.nombre,
    direccion: sede.direccion,
    ciudad: sede.ciudad,
    latitud: sede.latitud,
    longitud: sede.longitud,
    telefono: sede.telefono,
    refesId: sede.refesId,
  });
}

/** Como `Institucion` del frontend: sus coberturas agrupadas y una fuente (la de sus filas, decidido el 27/10/2026). */
export function aInstitucion(i: InstitucionCompleta) {
  const fila = i.coberturas[0];
  return {
    ...sinNulos({ id: i.id, nombre: i.nombre, tipo: i.tipo, origen: i.origen, logoUrl: i.logoUrl, sitioWeb: i.sitioWeb }),
    coberturas: agruparCoberturas(i.coberturas),
    ...(fila ? { fuenteCoberturas: sinNulos({ fuente: fila.fuente, fuenteUrl: fila.fuenteUrl, verificadoEl: fila.verificadoEl }) } : {}),
    sedes: i.sedes.map(aSede),
  };
}

export const INCLUIR_MEDICO = {
  usuario: { select: { nombre: true, apellido: true, fotoArchivo: true } },
  subespecialidad: { select: { nombre: true } },
  lugares: { include: { sede: { select: { institucionId: true } } } },
  coberturas: true,
} satisfies Prisma.MedicoInclude;
type MedicoCompleto = Prisma.MedicoGetPayload<{ include: typeof INCLUIR_MEDICO }>;

/** Como `Medico` del frontend. La valoración se calcula de los feedback (no se guarda). Su foto la ven todos. */
export function aMedico(m: MedicoCompleto, valoracion = { promedio: 0, cantidad: 0 }) {
  return {
    ...sinNulos({
      id: m.id,
      nombre: m.usuario.nombre,
      apellido: m.usuario.apellido,
      genero: m.genero,
      matricula: m.matricula,
      profesion: m.profesion,
      especialidadId: m.especialidadId,
      subespecialidad: m.subespecialidad?.nombre ?? null,
      avatarUrl: urlFoto(m.usuario.fotoArchivo),
    }),
    institucionesIds: [...new Set(m.lugares.map((l) => l.sede.institucionId))],
    sedesIds: m.lugares.map((l) => l.sedeId),
    coberturas: agruparCoberturas(m.coberturas),
    valoracion: valoracion.promedio,
    cantidadValoraciones: valoracion.cantidad,
    aniosExperiencia: m.aniosExperiencia ?? 0,
    descripcion: m.descripcion,
  };
}

export const INCLUIR_PACIENTE = {
  usuario: { select: { nombre: true, apellido: true, dni: true, fotoArchivo: true } },
  medicosFavoritos: { select: { medicoId: true } },
  institucionesFavoritas: { select: { institucionId: true } },
} satisfies Prisma.PacienteInclude;
type PacienteCompleto = Prisma.PacienteGetPayload<{ include: typeof INCLUIR_PACIENTE }>;

/**
 * Como `Paciente` del frontend. Lleva su foto: usarlo solo para el propio paciente y para los profesionales que
 * lo tienen asignado por un turno, nunca en respuestas del admin (06-reglas-de-negocio.md, "Fotos de perfil").
 */
export function aPaciente(p: PacienteCompleto) {
  const avatarUrl = urlFoto(p.usuario.fotoArchivo);
  return {
    id: p.id,
    nombre: p.usuario.nombre,
    apellido: p.usuario.apellido,
    dni: p.usuario.dni,
    email: p.email ?? "",
    telefono: p.telefono ?? "",
    planMedicoId: p.planMedicoId,
    numeroAfiliado: p.numeroAfiliado ?? "",
    medicosFavoritosIds: p.medicosFavoritos.map((f) => f.medicoId),
    institucionesFavoritasIds: p.institucionesFavoritas.map((f) => f.institucionId),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}
