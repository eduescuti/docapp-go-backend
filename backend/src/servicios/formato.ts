import type { Prisma } from "@prisma/client";

import { urlFoto } from "./usuarios/fotos";

// Convierten filas de Prisma en los objetos que espera el frontend (mismos nombres que src/domain/).

export interface CoberturaAceptada {
  obraSocialId: string;
  planesIds?: string[];
}

export interface FilaCobertura {
  obraSocialId: string;
  planMedicoId: string | null;
}

export const INCLUIR_INSTITUCION = { sedes: { orderBy: { nombre: "asc" } }, coberturas: true } satisfies Prisma.InstitucionInclude;
type InstitucionCompleta = Prisma.InstitucionGetPayload<{ include: typeof INCLUIR_INSTITUCION }>;

export const INCLUIR_MEDICO = {
  usuario: { select: { nombre: true, apellido: true, fotoArchivo: true } },
  subespecialidad: { select: { nombre: true } },
  lugares: { include: { sede: { select: { institucionId: true } } } },
  coberturas: true,
} satisfies Prisma.MedicoInclude;
type MedicoCompleto = Prisma.MedicoGetPayload<{ include: typeof INCLUIR_MEDICO }>;

export const INCLUIR_PACIENTE = {
  usuario: { select: { nombre: true, apellido: true, dni: true, fotoArchivo: true } },
  medicosFavoritos: { select: { medicoId: true } },
  institucionesFavoritas: { select: { institucionId: true } },
} satisfies Prisma.PacienteInclude;
type PacienteCompleto = Prisma.PacienteGetPayload<{ include: typeof INCLUIR_PACIENTE }>;

export const INCLUIR_ESPECIALIDAD = {
  subespecialidades: { select: { nombre: true }, orderBy: { nombre: "asc" } },
} satisfies Prisma.EspecialidadInclude;
type EspecialidadCompleta = Prisma.EspecialidadGetPayload<{ include: typeof INCLUIR_ESPECIALIDAD }>;

export const PROFESIONAL_PARA_AVISO = {
  usuarioId: true,
  genero: true,
  usuario: { select: { nombre: true, apellido: true } },
} satisfies Prisma.MedicoSelect;

/** Copia el objeto sin los campos `null`. */
export const sinNulos = <T extends Record<string, unknown>>(objeto: T) =>
  Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== null)) as { [K in keyof T]: Exclude<T[K], null> };

/** Arma el nombre del profesional con su título: "La Dra. Ana Pérez" o "El Dr. Juan Gómez". */
export const nombreProfesional = (m: { genero: string; usuario: { nombre: string; apellido: string } }) =>
  `${m.genero === "femenino" ? "La Dra." : "El Dr."} ${m.usuario.nombre} ${m.usuario.apellido}`;

/** Agrupa las filas de cobertura por obra social: `{ obraSocialId, planesIds? }[]`. */
function agruparCoberturas(filas: FilaCobertura[]): CoberturaAceptada[] {
  const porObraSocial = new Map<string, string[] | null>();

  for (const { obraSocialId, planMedicoId } of filas) {
    const actual = porObraSocial.get(obraSocialId);
    if (planMedicoId === null || actual === null) porObraSocial.set(obraSocialId, null);
    else porObraSocial.set(obraSocialId, [...(actual ?? []), planMedicoId]);
  }

  return [...porObraSocial].map(([obraSocialId, planesIds]) => (planesIds ? { obraSocialId, planesIds } : { obraSocialId }));
}

/** Convierte una sede al formato `Sede` del frontend. */
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

/** Convierte una institución al formato `Institucion` del frontend, con sedes, coberturas y su fuente. */
export function aInstitucion(i: InstitucionCompleta) {
  const fila = i.coberturas[0];

  return {
    ...sinNulos({ id: i.id, nombre: i.nombre, tipo: i.tipo, origen: i.origen, logoUrl: i.logoUrl, sitioWeb: i.sitioWeb }),
    coberturas: agruparCoberturas(i.coberturas),
    ...(fila ? { fuenteCoberturas: sinNulos({ fuente: fila.fuente, fuenteUrl: fila.fuenteUrl, verificadoEl: fila.verificadoEl }) } : {}),
    sedes: i.sedes.map(aSede),
  };
}

/** Convierte un profesional al formato `Medico` del frontend, con su valoración y su foto. */
export function aMedico(m: MedicoCompleto, valoracion: { promedio: number; cantidad: number }) {
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

/** Convierte un paciente al formato `Paciente` del frontend, con su foto (nunca usarlo en respuestas del admin). */
export function aPaciente(p: PacienteCompleto) {
  const avatarUrl = urlFoto(p.usuario.fotoArchivo);

  return {
    id: p.id,
    nombre: p.usuario.nombre,
    apellido: p.usuario.apellido,
    dni: p.usuario.dni,
    planMedicoId: p.planMedicoId,
    medicosFavoritosIds: p.medicosFavoritos.map((f) => f.medicoId),
    institucionesFavoritasIds: p.institucionesFavoritas.map((f) => f.institucionId),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/** Convierte una especialidad al formato `Especialidad` del frontend, con sus subespecialidades. */
export function aEspecialidad(e: EspecialidadCompleta) {
  return { id: e.id, nombre: e.nombre, profesion: e.profesion, subespecialidades: e.subespecialidades.map((s) => s.nombre) };
}
