import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { filasValidadas } from "./cobertura";
import { aInstitucion, CoberturaAceptada, INCLUIR_INSTITUCION } from "./formato";
import { buscar as buscarMedicos } from "./medicos";
import { vencerTurnos } from "./turnos";

const TIPOS = ["hospital", "clinica", "centro_medico", "laboratorio"];
const FUENTES = ["web_institucion", "cartilla_cobertura", "relevamiento_propio"];
/** Nombre del plan de las obras sociales que no publican planes. */
const PLAN_GENERAL = "General";

/** Sin tildes ni mayúsculas, para buscar "guemes" y encontrar "Güemes". */
const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lista de Admin → Instituciones: todas, primero las que tienen coberturas, filtradas por nombre. */
export async function listarInstituciones(q?: string) {
  const todas = await prisma.institucion.findMany({ where: { activa: true }, include: INCLUIR_INSTITUCION, orderBy: { creadaEn: "desc" } });
  const buscada = q ? normalizar(q) : "";
  return todas
    .filter((i) => !buscada || normalizar(i.nombre).includes(buscada))
    .sort((a, b) => Number(b.coberturas.length > 0) - Number(a.coberturas.length > 0))
    .map(aInstitucion);
}

export interface Fuente {
  fuente: string;
  fuenteUrl?: string;
  verificadoEl: string;
}

/** La fuente es obligatoria (regla 17): con URL salvo un relevamiento propio, y con la fecha de consulta. */
function validarFuente(f: Fuente): { fuente: string; fuenteUrl: string | null; verificadoEl: string } {
  if (!FUENTES.includes(f.fuente)) throw new ErrorHttp(400, "Fuente inválida.");
  const fuenteUrl = f.fuenteUrl?.trim() ?? "";
  if (f.fuente !== "relevamiento_propio" && !/^https?:\/\/\S+\.\S+/.test(fuenteUrl)) {
    throw new ErrorHttp(400, "Pegá la dirección (URL) de la página donde figuran las coberturas.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.verificadoEl)) throw new ErrorHttp(400, "Fecha de verificación inválida.");
  return { fuente: f.fuente, fuenteUrl: f.fuente === "relevamiento_propio" ? null : fuenteUrl, verificadoEl: f.verificadoEl };
}

/** El admin reemplaza las coberturas de una institución con su fuente y fecha (regla 17). Las públicas no tienen. */
export async function guardarCoberturasInstitucion(institucionId: string, coberturas: CoberturaAceptada[], fuente: Fuente, usuarioId: string) {
  const institucion = await prisma.institucion.findUnique({ where: { id: institucionId } });
  if (!institucion) throw new ErrorHttp(404, "La institución no existe.");
  if (institucion.origen === "publico") throw new ErrorHttp(400, "Es pública: ya la ven todos los pacientes, sin cargar coberturas.");
  const filas = await filasValidadas(coberturas);
  const datosFuente = filas.length > 0 ? validarFuente(fuente) : null;
  await prisma.$transaction([
    prisma.institucionCobertura.deleteMany({ where: { institucionId } }),
    prisma.institucionCobertura.createMany({ data: filas.map((f) => ({ ...f, institucionId, ...datosFuente! })) }),
  ]);
  await registrarAccion({ usuarioId, accion: "coberturas_institucion", entidad: "institucion", entidadId: institucionId });
  return aInstitucion(await prisma.institucion.findUniqueOrThrow({ where: { id: institucionId }, include: INCLUIR_INSTITUCION }));
}

export interface DatosNuevaInstitucion {
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

/** Alta de institución con su sede principal. Las altas del admin son privadas (se ven solo para sus coberturas). */
export async function crearInstitucion(datos: DatosNuevaInstitucion, usuarioId: string) {
  if (!TIPOS.includes(datos.tipo)) throw new ErrorHttp(400, "Tipo de institución inválido.");
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

/**
 * Alta de un plan. Si la obra social no existe se crea (con el plan "General" si no se indica otro); si existe,
 * el plan se suma a ella. Devuelve el plan con su obra social.
 */
export async function crearPlan(nombreObraSocial: string, nombrePlan: string | undefined, usuarioId: string) {
  const todas = await prisma.obraSocial.findMany();
  let obraSocial = todas.find((o) => o.nombre.toLowerCase() === nombreObraSocial.toLowerCase());
  const plan = nombrePlan?.trim() || PLAN_GENERAL;
  if (obraSocial) {
    const planes = await prisma.planMedico.findMany({ where: { obraSocialId: obraSocial.id }, select: { nombre: true } });
    if (planes.some((p) => p.nombre.toLowerCase() === plan.toLowerCase())) throw new ErrorHttp(409, `${obraSocial.nombre} ya tiene un plan "${plan}".`);
  } else {
    obraSocial = await prisma.obraSocial.create({ data: { nombre: nombreObraSocial } });
  }
  const creado = await prisma.planMedico.create({ data: { obraSocialId: obraSocial.id, nombre: plan }, include: { obraSocial: true } });
  await registrarAccion({ usuarioId, accion: "alta_plan", entidad: "plan", entidadId: creado.id });
  const { obraSocial: os, ...resto } = creado;
  return { ...resto, obraSocial: { id: os.id, nombre: os.nombre, ...(os.descripcion ? { descripcion: os.descripcion } : {}) } };
}

// ───────────── Estadísticas y métricas (panel del admin). Nunca incluyen fotos de pacientes (regla 19). ─────────────

/** Panel: cantidad de personas y pacientes por obra social (solo las que tienen pacientes). */
export async function estadisticas() {
  const [pacientes, profesionales, planes] = await Promise.all([
    prisma.paciente.count({ where: { usuario: { activo: true } } }),
    prisma.medico.count({ where: { usuario: { activo: true } } }),
    prisma.paciente.groupBy({ by: ["planMedicoId"], _count: true, where: { usuario: { activo: true } } }),
  ]);
  const obraSocialDe = new Map(
    (await prisma.planMedico.findMany({ where: { id: { in: planes.map((p) => p.planMedicoId) } }, include: { obraSocial: true } })).map((p) => [
      p.id,
      p.obraSocial.nombre,
    ]),
  );
  const conteo = new Map<string, number>();
  for (const p of planes) {
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

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Pendientes",
  confirmado: "Confirmados",
  completado: "Completados",
  rechazado: "Rechazados",
  cancelado: "Cancelados",
};

function contar(claves: string[]) {
  const conteo = new Map<string, number>();
  for (const c of claves) conteo.set(c, (conteo.get(c) ?? 0) + 1);
  return [...conteo].map(([etiqueta, cantidad]) => ({ etiqueta, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta));
}

/** Pestaña Métricas, en un solo pedido: turnos por estado, especialidad e institución; valoraciones y ranking. */
export async function metricas() {
  await vencerTurnos();
  const turnos = await prisma.turno.findMany({
    select: { estado: true, especialidad: { select: { nombre: true } }, sede: { select: { institucion: { select: { nombre: true } } } } },
  });
  const medicos = await buscarMedicos({ usuario: { activo: true } });
  const especialidades = await prisma.especialidad.findMany();
  const opiniones = medicos.reduce((n, m) => n + m.cantidadValoraciones, 0);
  const puntos = medicos.reduce((n, m) => n + m.valoracion * m.cantidadValoraciones, 0);
  return {
    turnos: turnos.length,
    pendientes: turnos.filter((t) => t.estado === "pendiente").length,
    valoracionPromedio: opiniones > 0 ? puntos / opiniones : 0,
    turnosPorEstado: contar(turnos.map((t) => ETIQUETA_ESTADO[t.estado] ?? t.estado)),
    turnosPorEspecialidad: contar(turnos.map((t) => t.especialidad.nombre)),
    turnosPorInstitucion: contar(turnos.map((t) => t.sede.institucion.nombre)).slice(0, 5),
    mejorValorados: [...medicos]
      .filter((m) => m.cantidadValoraciones > 0)
      .sort((a, b) => b.valoracion - a.valoracion || b.cantidadValoraciones - a.cantidadValoraciones)
      .slice(0, 5)
      .map((medico) => ({ medico, especialidad: especialidades.find((e) => e.id === medico.especialidadId)?.nombre })),
  };
}
