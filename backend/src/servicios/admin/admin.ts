import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { filasValidadas } from "../catalogos/cobertura";
import { obtenerInstitucion, TIPOS_INSTITUCION } from "../catalogos/instituciones";
import { aInstitucion, CoberturaAceptada, INCLUIR_INSTITUCION } from "../formato";
import { vencerTurnos } from "../turnos/turnos";
import { buscar as buscarMedicos } from "../usuarios/medicos";

const FUENTES = ["web_institucion", "cartilla_cobertura", "relevamiento_propio"];
/** Nombre del plan de las obras sociales que no publican planes. */
const PLAN_GENERAL = "General";
const CANTIDAD_RANKING = 5;

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Pendientes",
  confirmado: "Confirmados",
  completado: "Completados",
  rechazado: "Rechazados",
  cancelado: "Cancelados",
};

export interface Fuente {
  fuente: string;
  fuenteUrl?: string;
  verificadoEl: string;
}

interface DatosNuevaInstitucion {
  nombre: string;
  tipo: string;
  direccion: string;
  ciudad: string;
  telefono?: string;
  latitud: number;
  longitud: number;
  coberturas: CoberturaAceptada[];
  fuente: Fuente;
}

/** Indica si dos nombres son iguales sin importar mayúsculas. */
const mismoNombre = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Cuenta cuántas veces aparece cada etiqueta, de la más frecuente a la menos. */
function contar(claves: string[]) {
  const conteo = new Map<string, number>();
  for (const c of claves) conteo.set(c, (conteo.get(c) ?? 0) + 1);

  return [...conteo]
    .map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta));
}

/** Valida la fuente de unas coberturas: tipo conocido, URL (salvo relevamiento propio) y fecha de consulta. */
function validarFuente(f: Fuente): { fuente: string; fuenteUrl: string | null; verificadoEl: string } {
  if (!FUENTES.includes(f.fuente)) throw new ErrorHttp(400, "Fuente inválida.");

  const fuenteUrl = f.fuenteUrl?.trim() ?? "";
  if (f.fuente !== "relevamiento_propio" && !/^https?:\/\/\S+\.\S+/.test(fuenteUrl)) {
    throw new ErrorHttp(400, "Pegá la dirección (URL) de la página donde figuran las coberturas.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.verificadoEl)) throw new ErrorHttp(400, "Fecha de verificación inválida.");

  return { fuente: f.fuente, fuenteUrl: f.fuente === "relevamiento_propio" ? null : fuenteUrl, verificadoEl: f.verificadoEl };
}

/** Obtiene las instituciones activas: primero las que tienen coberturas y, dentro de cada grupo, las más nuevas. */
export async function listarInstituciones() {
  const todas = await prisma.institucion.findMany({ where: { activa: true }, include: INCLUIR_INSTITUCION, orderBy: { creadaEn: "desc" } });
  return todas.sort((a, b) => Number(b.coberturas.length > 0) - Number(a.coberturas.length > 0)).map(aInstitucion);
}

/** Reemplaza las coberturas de una institución privada, con su fuente y fecha. */
export async function guardarCoberturasInstitucion(institucionId: string, coberturas: CoberturaAceptada[], fuente: Fuente, usuarioId: string) {
  const institucion = await prisma.institucion.findUnique({ where: { id: institucionId } });
  if (!institucion) throw new ErrorHttp(404, "La institución no existe.");
  if (institucion.origen === "publico") throw new ErrorHttp(400, "Es pública: ya la ven todos los pacientes, sin cargar coberturas.");

  const filas = await filasValidadas(coberturas);
  const datosFuente = filas.length > 0 ? validarFuente(fuente) : undefined;
  const nuevas = datosFuente ? filas.map((f) => ({ ...f, ...datosFuente, institucionId })) : [];

  await prisma.$transaction([
    prisma.institucionCobertura.deleteMany({ where: { institucionId } }),
    prisma.institucionCobertura.createMany({ data: nuevas }),
  ]);
  await registrarAccion({ usuarioId, accion: "coberturas_institucion", entidad: "institucion", entidadId: institucionId });

  return obtenerInstitucion(institucionId);
}

/** Crea una institución privada con su sede principal y sus coberturas. */
export async function crearInstitucion(datos: DatosNuevaInstitucion, usuarioId: string) {
  if (!TIPOS_INSTITUCION.includes(datos.tipo)) throw new ErrorHttp(400, "Tipo de institución inválido.");
  if (Math.abs(datos.latitud) > 90) throw new ErrorHttp(400, "Latitud inválida.");
  if (Math.abs(datos.longitud) > 180) throw new ErrorHttp(400, "Longitud inválida.");
  if (datos.coberturas.length === 0) throw new ErrorHttp(400, "Elegí al menos una obra social aceptada.");

  const filas = await filasValidadas(datos.coberturas);
  const fuente = validarFuente(datos.fuente);

  const institucion = await prisma.institucion.create({
    data: {
      nombre: datos.nombre,
      tipo: datos.tipo,
      origen: "privado",
      sedes: {
        create: {
          nombre: datos.nombre,
          direccion: datos.direccion,
          ciudad: datos.ciudad,
          telefono: datos.telefono || null,
          latitud: datos.latitud,
          longitud: datos.longitud,
        },
      },
      coberturas: { create: filas.map((f) => ({ ...f, ...fuente })) },
    },
    include: INCLUIR_INSTITUCION,
  });
  await registrarAccion({ usuarioId, accion: "alta_institucion", entidad: "institucion", entidadId: institucion.id });

  return aInstitucion(institucion);
}

/** Crea un plan (y su obra social, si no existe) y lo devuelve con su obra social. */
export async function crearPlan(nombreObraSocial: string, nombrePlan: string | undefined, usuarioId: string) {
  const plan = nombrePlan?.trim() || PLAN_GENERAL;
  const obrasSociales = await prisma.obraSocial.findMany();
  let obraSocial = obrasSociales.find((o) => mismoNombre(o.nombre, nombreObraSocial));

  if (obraSocial) {
    const planes = await prisma.planMedico.findMany({ where: { obraSocialId: obraSocial.id }, select: { nombre: true } });
    if (planes.some((p) => mismoNombre(p.nombre, plan))) throw new ErrorHttp(409, `${obraSocial.nombre} ya tiene un plan "${plan}".`);
  } else {
    obraSocial = await prisma.obraSocial.create({ data: { nombre: nombreObraSocial } });
  }

  const { obraSocial: os, ...creado } = await prisma.planMedico.create({
    data: { obraSocialId: obraSocial.id, nombre: plan },
    include: { obraSocial: true },
  });
  await registrarAccion({ usuarioId, accion: "alta_plan", entidad: "plan", entidadId: creado.id });

  return { ...creado, obraSocial: { id: os.id, nombre: os.nombre, ...(os.descripcion ? { descripcion: os.descripcion } : {}) } };
}

// ───────────── Estadísticas y métricas (panel del admin). Nunca incluyen fotos de pacientes. ─────────────

/** Obtiene la cantidad de pacientes y profesionales activos, y los pacientes por obra social. */
export async function estadisticas() {
  const [pacientes, profesionales, porPlan] = await Promise.all([
    prisma.paciente.count({ where: { usuario: { activo: true } } }),
    prisma.medico.count({ where: { usuario: { activo: true } } }),
    prisma.paciente.groupBy({ by: ["planMedicoId"], _count: true, where: { usuario: { activo: true } } }),
  ]);

  const planes = await prisma.planMedico.findMany({
    where: { id: { in: porPlan.map((p) => p.planMedicoId) } },
    select: { id: true, obraSocial: { select: { nombre: true } } },
  });
  const obraSocialDe = new Map(planes.map((p) => [p.id, p.obraSocial.nombre]));

  const conteo = new Map<string, number>();
  for (const p of porPlan) {
    const nombre = obraSocialDe.get(p.planMedicoId) ?? "Otra";
    conteo.set(nombre, (conteo.get(nombre) ?? 0) + p._count);
  }

  return {
    uso: { pacientes, profesionales, total: pacientes + profesionales },
    porObraSocial: [...conteo]
      .map(([obraSocial, cantidad]) => ({ obraSocial, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.obraSocial.localeCompare(b.obraSocial)),
  };
}

/** Obtiene los turnos por estado, especialidad e institución, la valoración promedio y los mejores profesionales. */
export async function metricas() {
  await vencerTurnos();
  const [turnos, medicos, especialidades] = await Promise.all([
    prisma.turno.findMany({
      select: { estado: true, especialidad: { select: { nombre: true } }, sede: { select: { institucion: { select: { nombre: true } } } } },
    }),
    buscarMedicos({ usuario: { activo: true } }),
    prisma.especialidad.findMany({ select: { id: true, nombre: true } }),
  ]);

  const opiniones = medicos.reduce((n, m) => n + m.cantidadValoraciones, 0);
  const puntos = medicos.reduce((n, m) => n + m.valoracion * m.cantidadValoraciones, 0);

  return {
    turnos: turnos.length,
    pendientes: turnos.filter((t) => t.estado === "pendiente").length,
    valoracionPromedio: opiniones > 0 ? puntos / opiniones : 0,
    turnosPorEstado: contar(turnos.map((t) => ETIQUETA_ESTADO[t.estado] ?? t.estado)),
    turnosPorEspecialidad: contar(turnos.map((t) => t.especialidad.nombre)),
    turnosPorInstitucion: contar(turnos.map((t) => t.sede.institucion.nombre)).slice(0, CANTIDAD_RANKING),
    mejorValorados: medicos
      .filter((m) => m.cantidadValoraciones > 0)
      .sort((a, b) => b.valoracion - a.valoracion || b.cantidadValoraciones - a.cantidadValoraciones)
      .slice(0, CANTIDAD_RANKING)
      .map((medico) => ({ medico, especialidad: especialidades.find((e) => e.id === medico.especialidadId)?.nombre })),
  };
}
