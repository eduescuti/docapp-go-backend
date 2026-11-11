// Datos iniciales de la base: los mismos que los mocks del frontend, con los mismos ids, para que la app
// muestre lo mismo con backend y sin él mientras se conecta módulo por módulo.
//
// `npm run db:seed` BORRA todo lo que haya en la base y la vuelve a cargar. Es para la base de desarrollo.
import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashearContrasena } from "./servicios/sesion/contrasenas";
import type { FichaPadron } from "./servicios/sesion/refeps";
import { CARPETA_FOTOS } from "./servicios/usuarios/fotos";
import { prisma } from "./utils/db";
import { hoyArgentina, MS_DIA, sumarDias } from "./utils/tiempo";

// ───────────── Forma de prisma/datos/demo.json (exportado de los mocks del frontend) ─────────────

interface Cobertura {
  obraSocialId: string;
  planesIds?: string[];
}

interface DatosDemo {
  generadoEl: string;
  especialidades: { id: string; nombre: string; profesion: string; subespecialidades: string[] }[];
  obrasSociales: { id: string; nombre: string; descripcion?: string; registro?: string; codigoOficial?: string }[];
  planes: { id: string; obraSocialId: string; nombre: string }[];
  instituciones: {
    id: string;
    nombre: string;
    tipo: string;
    origen: string;
    sitioWeb?: string;
    coberturas: Cobertura[];
    fuenteCoberturas?: { fuente: string; fuenteUrl?: string; verificadoEl: string };
    sedes: { id: string; institucionId: string; nombre: string; direccion: string; ciudad: string; latitud: number; longitud: number; telefono?: string; refesId?: string }[];
  }[];
  padron: FichaPadron[];
  medicos: {
    id: string;
    dni: string;
    nombre: string;
    apellido: string;
    genero: string;
    matricula: string;
    profesion: string;
    especialidadId: string;
    subespecialidad?: string;
    sedesIds: string[];
    coberturas: Cobertura[];
    aniosExperiencia: number;
    descripcion: string;
  }[];
  franjas: { id: string; medicoId: string; sedeId: string; diaSemana: number; desde: string; hasta: string }[];
  pacientes: {
    id: string;
    nombre: string;
    apellido: string;
    dni: string;
    email: string;
    telefono: string;
    planMedicoId: string;
    numeroAfiliado: string;
    medicosFavoritosIds: string[];
    institucionesFavoritasIds: string[];
  }[];
  turnos: { id: string; pacienteId: string; medicoId: string; sedeId: string; fecha: string; hora: string; estado: string; ocultoEnHistorial?: boolean }[];
  ordenes: {
    id: string;
    medicoId: string;
    pacienteId: string;
    fecha: string;
    estudiosSolicitados: string[];
    indicaciones: string;
    institucionId: string;
    estado: string;
    archivadoEl?: string;
  }[];
  resultados: {
    id: string;
    ordenId: string;
    tipo: string;
    institucionId: string;
    fecha: string;
    archivadoEl?: string;
    secciones: SeccionPdf[] | null;
  }[];
  recetas: {
    id: string;
    medicoId: string;
    pacienteId: string;
    fecha: string;
    medicacion: string;
    dosis: string;
    frecuencia: string;
    duracion: string;
    vigenteHasta: string;
    indicaciones?: string;
    observaciones?: string;
    archivadoEl?: string;
  }[];
  notificaciones: { id: string; pacienteId: string; tipo: string; titulo: string; mensaje: string; fecha: string; leida: boolean }[];
  notas: { id: string; medicoId: string; pacienteId: string; fecha: string; texto: string }[];
  /** Opiniones de turnos cumplidos: de acá salen la valoración de cada profesional y el ranking del admin. */
  feedbacks: {
    turnoId: string;
    estrellas: number;
    fecha: string;
    criterios?: Partial<Record<"puntualidad" | "atencion" | "trato" | "claridadExplicacion" | "experienciaGeneral", number>>;
    comentario?: string;
  }[];
}

// Datos base del seed: contraseñas, dni admin y path de resultados y fotos
const CONTRASENA = { admin: "Admin123$", paciente: "Paciente123$", doctor: "Medico123$" };
const DNI_ADMIN = "99000001";
const RAIZ = path.resolve(__dirname, "..");
const CARPETA_RESULTADOS = path.join(RAIZ, "uploads", "resultados");
const CARPETA_FOTOS_DEMO = path.join(RAIZ, "prisma", "datos", "fotos");

// ───────────── Fechas: los mocks son relativos a "hoy"; se corren de generadoEl a la fecha del seed ─────────────

function diasEntre(desdeIso: string, hastaIso: string): number {
  return Math.round((Date.parse(`${hastaIso}T00:00:00Z`) - Date.parse(`${desdeIso}T00:00:00Z`)) / MS_DIA);
}

/** Corre "yyyy-MM-dd" (o "yyyy-MM-ddTHH:mm") la cantidad de días indicada, sin tocar la hora. */
function correrFecha(fecha: string, dias: number): string {
  const [dia, hora] = fecha.split("T");
  const corrida = sumarDias(dia, dias);
  return hora ? `${corrida}T${hora}` : corrida;
}

/** "2026-10-27T14:30" en hora argentina (UTC-3, sin horario de verano) → Date. */
const fechaHoraArgentina = (fechaHora: string) => new Date(`${fechaHora}:00-03:00`);

/** "Dra. Elena Ruiz" (como `nombreConTitulo` del frontend). */
const nombreConTitulo = (m: { genero: string; nombre: string; apellido: string }) =>
  `${m.genero === "femenino" ? "Dra." : "Dr."} ${m.nombre} ${m.apellido}`;

const formatoFechaLarga = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

// ───────────── PDF de ejemplo de los resultados ─────────────
// Generador mínimo de PDF de una página (texto y rectángulos, fuentes estándar Helvetica), copia del que tenía el
// frontend. Devuelve un string "binario": cada carácter es un byte (0–255), listo para pdf.js. La API no lo usa:
// solo sirve los PDF que ya están en uploads/resultados/.

type FilaTabla = [string, string, string];

interface SeccionPdf {
  titulo: string;
  tabla?: { encabezado: FilaTabla; filas: FilaTabla[] };
  lineas?: string[];
}

interface DocumentoPdf {
  titulo: string;
  aviso: string;
  campos: [string, string][];
  secciones: SeccionPdf[];
  pie: string;
}

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;

function textoPdf(texto: string): string {
  const latin1 = Array.from(texto)
    .map((c) => (c.charCodeAt(0) <= 0xff ? c : c === "–" || c === "—" ? "-" : "?"))
    .join("");
  return latin1.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function texto(x: number, y: number, contenido: string, tamano: number, negrita = false): string {
  return `BT /${negrita ? "F2" : "F1"} ${tamano} Tf ${x} ${y} Td (${textoPdf(contenido)}) Tj ET\n`;
}

function crearPdfSimple(doc: DocumentoPdf): string {
  let y = ALTO - 40;
  let c = "";

  // Banda superior (azul del tema A).
  c += `0.008 0.518 0.78 rg 0 ${ALTO - 70} ${ANCHO} 70 re f\n1 1 1 rg\n`;
  c += texto(MARGEN, ALTO - 45, "DocApp Go", 20, true);
  c += texto(ANCHO - MARGEN - 150, ALTO - 43, "Resultado de estudio", 12);
  c += "0 0 0 rg\n";
  y = ALTO - 105;

  c += texto(MARGEN, y, doc.titulo, 18, true);
  y -= 20;
  c += "0.75 0.1 0.1 rg\n" + texto(MARGEN, y, doc.aviso, 9) + "0 0 0 rg\n";
  y -= 28;

  for (const [etiqueta, valor] of doc.campos) {
    c += "0.4 0.45 0.55 rg\n" + texto(MARGEN, y, etiqueta, 10) + "0 0 0 rg\n";
    c += texto(MARGEN + 130, y, valor, 11, true);
    y -= 18;
  }
  y -= 12;

  for (const seccion of doc.secciones) {
    c += `0.9 0.93 0.96 rg ${MARGEN} ${y - 6} ${ANCHO - MARGEN * 2} 22 re f\n0 0 0 rg\n`;
    c += texto(MARGEN + 8, y, seccion.titulo, 12, true);
    y -= 28;
    if (seccion.tabla) {
      const columnas = [MARGEN + 8, MARGEN + 230, MARGEN + 360];
      seccion.tabla.encabezado.forEach((t, i) => (c += "0.4 0.45 0.55 rg\n" + texto(columnas[i], y, t, 9, true)));
      c += "0 0 0 rg\n";
      y -= 18;
      for (const fila of seccion.tabla.filas) {
        fila.forEach((t, i) => (c += texto(columnas[i], y, t, 11, i === 1)));
        c += `0.88 0.9 0.93 RG 0.5 w ${MARGEN} ${y - 6} m ${ANCHO - MARGEN} ${y - 6} l S\n`;
        y -= 20;
      }
    }
    for (const linea of seccion.lineas ?? []) {
      c += texto(MARGEN + 8, y, linea, 11);
      y -= 18;
    }
    y -= 14;
  }

  c += "0.4 0.45 0.55 rg\n" + texto(MARGEN, 40, doc.pie, 9);

  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${c.length} >>\nstream\n${c}endstream`,
  ];

  // Cada carácter es un byte, así que las posiciones del índice (xref) son longitudes de string.
  let pdf = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((obj, i) => {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += posiciones.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return pdf;
}

// ───────────── Seed ─────────────

async function borrarTodo(): Promise<void> {
  await prisma.$transaction([
    prisma.feedback.deleteMany(),
    prisma.notificacion.deleteMany(),
    prisma.resultado.deleteMany(),
    prisma.ordenEstudio.deleteMany(),
    prisma.orden.deleteMany(),
    prisma.receta.deleteMany(),
    prisma.turno.deleteMany(),
    prisma.notaPaciente.deleteMany(),
    prisma.pacienteMedicoFavorito.deleteMany(),
    prisma.pacienteInstitucionFavorita.deleteMany(),
    prisma.franjaAtencion.deleteMany(),
    prisma.medicoCobertura.deleteMany(),
    prisma.medicoSede.deleteMany(),
    prisma.medico.deleteMany(),
    prisma.paciente.deleteMany(),
    prisma.profesionalPadron.deleteMany(),
    prisma.subespecialidad.deleteMany(),
    prisma.especialidad.deleteMany(),
    prisma.institucionCobertura.deleteMany(),
    prisma.sede.deleteMany(),
    prisma.institucion.deleteMany(),
    prisma.planMedico.deleteMany(),
    prisma.obraSocial.deleteMany(),
    prisma.sesion.deleteMany(),
    prisma.registroAuditoria.deleteMany(),
    prisma.usuario.deleteMany(),
  ]);
  await rm(CARPETA_RESULTADOS, { recursive: true, force: true });
  await rm(CARPETA_FOTOS, { recursive: true, force: true });
}

/** Copia la foto de ejemplo del profesional a uploads/fotos/ con un nombre al azar, como una subida real. */
async function copiarFotoDemo(medicoId: string): Promise<string | null> {
  const origen = path.join(CARPETA_FOTOS_DEMO, `${medicoId}.jpg`);
  if (!existsSync(origen)) return null;
  const archivo = `${randomUUID()}.jpg`;
  await copyFile(origen, path.join(CARPETA_FOTOS, archivo));
  return archivo;
}

/** Filas de cobertura de una lista `{ obraSocialId, planesIds? }`: una por plan, o una sin plan (= todos). */
function filasDeCobertura(coberturas: Cobertura[]): { obraSocialId: string; planMedicoId: string | null }[] {
  return coberturas.flatMap(({ obraSocialId, planesIds }): { obraSocialId: string; planMedicoId: string | null }[] =>
    planesIds && planesIds.length > 0
      ? planesIds.map((planMedicoId) => ({ obraSocialId, planMedicoId }))
      : [{ obraSocialId, planMedicoId: null }],
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("El seed borra la base: no se corre en producción.");

  const datos = JSON.parse(await readFile(path.join(RAIZ, "prisma", "datos", "demo.json"), "utf8")) as DatosDemo;
  const dias = diasEntre(datos.generadoEl, hoyArgentina());
  const f = (fecha: string) => correrFecha(fecha, dias);
  const fOpc = (fecha?: string) => (fecha ? f(fecha) : null);

  await borrarTodo();

  // Cobertura: catálogo de obras sociales y planes (08-coberturas.md).
  await prisma.obraSocial.createMany({
    data: datos.obrasSociales.map(({ id, nombre, descripcion, registro, codigoOficial }) => ({ id, nombre, descripcion, registro, codigoOficial })),
  });
  await prisma.planMedico.createMany({ data: datos.planes });

  // Especialidades (cada una de una profesión: Res. 1814/2015 y 199/2011) y subespecialidades.
  await prisma.especialidad.createMany({ data: datos.especialidades.map(({ id, nombre, profesion }) => ({ id, nombre, profesion })) });
  const subespecialidades = datos.especialidades.flatMap((e) =>
    e.subespecialidades.map((nombre) => ({ especialidadId: e.id, nombre })),
  );
  await prisma.subespecialidad.createMany({ data: subespecialidades });
  const subPorNombre = new Map(
    (await prisma.subespecialidad.findMany()).map((s) => [`${s.especialidadId}/${s.nombre}`, s.id]),
  );

  // Instituciones del REFES con su sede y las coberturas verificadas (con su fuente).
  await prisma.institucion.createMany({
    data: datos.instituciones.map(({ id, nombre, tipo, origen, sitioWeb }) => ({ id, nombre, tipo, origen, sitioWeb })),
  });
  await prisma.sede.createMany({ data: datos.instituciones.flatMap((i) => i.sedes) });
  await prisma.institucionCobertura.createMany({
    data: datos.instituciones.flatMap((i) =>
      i.fuenteCoberturas
        ? filasDeCobertura(i.coberturas).map((fila) => ({
          institucionId: i.id,
          ...fila,
          fuente: i.fuenteCoberturas!.fuente,
          fuenteUrl: i.fuenteCoberturas!.fuenteUrl ?? null,
          verificadoEl: i.fuenteCoberturas!.verificadoEl,
        }))
        : [],
    ),
  });

  // Padrón de profesionales (contra el que se verifica el registro).
  await prisma.profesionalPadron.createMany({
    data: datos.padron.map((p) => ({ ...p, especializaciones: JSON.stringify(p.especializaciones) })),
  });

  // Usuarios: admin, pacientes y profesionales, con la contraseña hasheada.
  const [hashAdmin, hashPaciente, hashMedico] = await Promise.all([
    hashearContrasena(CONTRASENA.admin),
    hashearContrasena(CONTRASENA.paciente),
    hashearContrasena(CONTRASENA.doctor),
  ]);
  await prisma.usuario.create({ data: { dni: DNI_ADMIN, passwordHash: hashAdmin, rol: "admin", nombre: "Administración", apellido: "DocApp Go" } });

  for (const p of datos.pacientes) {
    await prisma.usuario.create({
      data: {
        dni: p.dni,
        passwordHash: hashPaciente,
        rol: "paciente",
        nombre: p.nombre,
        apellido: p.apellido,
        paciente: {
          create: { id: p.id, planMedicoId: p.planMedicoId, numeroAfiliado: p.numeroAfiliado, email: p.email, telefono: p.telefono },
        },
      },
    });
  }

  const padronPorDni = new Map((await prisma.profesionalPadron.findMany()).map((p) => [`${p.dni}/${p.matricula}`, p.id]));
  await mkdir(CARPETA_FOTOS, { recursive: true });
  for (const m of datos.medicos) {
    await prisma.usuario.create({
      data: {
        dni: m.dni,
        passwordHash: hashMedico,
        rol: "doctor",
        nombre: m.nombre,
        apellido: m.apellido,
        fotoArchivo: await copiarFotoDemo(m.id),
        medico: {
          create: {
            id: m.id,
            padronId: padronPorDni.get(`${m.dni}/${m.matricula}`) ?? null,
            matricula: m.matricula,
            profesion: m.profesion,
            genero: m.genero,
            especialidadId: m.especialidadId,
            subespecialidadId: m.subespecialidad ? (subPorNombre.get(`${m.especialidadId}/${m.subespecialidad}`) ?? null) : null,
            descripcion: m.descripcion,
            aniosExperiencia: m.aniosExperiencia,
            lugares: { create: m.sedesIds.map((sedeId) => ({ sedeId })) },
            coberturas: { create: filasDeCobertura(m.coberturas) },
          },
        },
      },
    });
  }
  await prisma.franjaAtencion.createMany({ data: datos.franjas });

  // Favoritos y notas.
  await prisma.pacienteMedicoFavorito.createMany({
    data: datos.pacientes.flatMap((p) => p.medicosFavoritosIds.map((medicoId) => ({ pacienteId: p.id, medicoId }))),
  });
  await prisma.pacienteInstitucionFavorita.createMany({
    data: datos.pacientes.flatMap((p) => p.institucionesFavoritasIds.map((institucionId) => ({ pacienteId: p.id, institucionId }))),
  });
  await prisma.notaPaciente.createMany({
    data: datos.notas.map((n) => ({ id: n.id, medicoId: n.medicoId, pacienteId: n.pacienteId, texto: n.texto, creadaEn: fechaHoraArgentina(f(n.fecha)) })),
  });

  // Turnos (la especialidad es la del médico al reservar).
  const especialidadDe = new Map(datos.medicos.map((m) => [m.id, m.especialidadId]));
  await prisma.turno.createMany({
    data: datos.turnos.map((t) => ({
      id: t.id,
      pacienteId: t.pacienteId,
      medicoId: t.medicoId,
      sedeId: t.sedeId,
      especialidadId: especialidadDe.get(t.medicoId)!,
      fecha: f(t.fecha),
      hora: t.hora,
      estado: t.estado,
      ocultoEnHistorial: t.ocultoEnHistorial ?? false,
    })),
  });

  // Opiniones de los turnos cumplidos (solo las estrellas son obligatorias; los criterios, opcionales).
  await prisma.feedback.createMany({
    data: datos.feedbacks.map((fb) => ({
      turnoId: fb.turnoId,
      estrellas: fb.estrellas,
      ...fb.criterios,
      comentario: fb.comentario ?? null,
      creadoEn: fechaHoraArgentina(`${f(fb.fecha)}T18:00`),
    })),
  });

  // Órdenes con sus estudios.
  for (const o of datos.ordenes) {
    await prisma.orden.create({
      data: {
        id: o.id,
        medicoId: o.medicoId,
        pacienteId: o.pacienteId,
        institucionId: o.institucionId,
        fecha: f(o.fecha),
        indicaciones: o.indicaciones,
        estado: o.estado,
        archivadoEl: fOpc(o.archivadoEl),
        estudios: { create: o.estudiosSolicitados.map((nombre, posicion) => ({ nombre, posicion })) },
      },
    });
  }

  // Resultados: el PDF de ejemplo se genera y se guarda en uploads/ (nunca en el repo: son datos médicos).
  await mkdir(CARPETA_RESULTADOS, { recursive: true });
  const pacientePorId = new Map(datos.pacientes.map((p) => [p.id, p]));
  const medicoPorId = new Map(datos.medicos.map((m) => [m.id, m]));
  const institucionPorId = new Map(datos.instituciones.map((i) => [i.id, i]));
  for (const r of datos.resultados) {
    const orden = datos.ordenes.find((o) => o.id === r.ordenId)!;
    const paciente = pacientePorId.get(orden.pacienteId)!;
    const medico = medicoPorId.get(orden.medicoId)!;
    const fecha = f(r.fecha);
    const pdf = Buffer.from(
      crearPdfSimple({
        titulo: r.tipo,
        aviso: "Documento de ejemplo con datos ficticios, generado para la demo de DocApp Go.",
        campos: [
          ["Paciente", `${paciente.nombre} ${paciente.apellido} (DNI ${paciente.dni})`],
          ["Médico solicitante", nombreConTitulo(medico)],
          ["Institución", institucionPorId.get(r.institucionId)?.nombre ?? "-"],
          ["Fecha", formatoFechaLarga(fecha)],
        ],
        secciones: r.secciones ?? [{ titulo: "Informe", lineas: ["Sin informe cargado."] }],
        pie: "Este documento no tiene validez médica.",
      }),
      "latin1",
    );
    const archivoRuta = `resultados/${r.id}.pdf`;
    await writeFile(path.join(RAIZ, "uploads", archivoRuta), pdf);
    await prisma.resultado.create({
      data: {
        id: r.id,
        ordenId: r.ordenId,
        institucionId: r.institucionId,
        tipo: r.tipo,
        fecha,
        archivoRuta,
        archivoBytes: pdf.length,
        archivoSha256: createHash("sha256").update(pdf).digest("hex"),
        archivadoEl: fOpc(r.archivadoEl),
      },
    });
  }

  // Recetas: la duración del mock es texto ("30 días").
  await prisma.receta.createMany({
    data: datos.recetas.map((r) => ({
      id: r.id,
      medicoId: r.medicoId,
      pacienteId: r.pacienteId,
      fecha: f(r.fecha),
      medicacion: r.medicacion,
      dosis: r.dosis,
      frecuencia: r.frecuencia,
      duracionDias: Number.parseInt(r.duracion, 10) || diasEntre(r.fecha, r.vigenteHasta),
      vigenteHasta: f(r.vigenteHasta),
      indicaciones: r.indicaciones ?? null,
      observaciones: r.observaciones ?? null,
      archivadoEl: fOpc(r.archivadoEl),
    })),
  });

  // Notificaciones: en la base son del usuario (no del paciente).
  const usuarioDePaciente = new Map(
    (await prisma.paciente.findMany({ select: { id: true, usuarioId: true } })).map((p) => [p.id, p.usuarioId]),
  );
  await prisma.notificacion.createMany({
    data: datos.notificaciones.map((n) => ({
      id: n.id,
      usuarioId: usuarioDePaciente.get(n.pacienteId)!,
      tipo: n.tipo,
      titulo: n.titulo,
      mensaje: n.mensaje,
      leida: n.leida,
      creadaEn: fechaHoraArgentina(f(n.fecha)),
    })),
  });

  const conteo = {
    obrasSociales: await prisma.obraSocial.count(),
    planes: await prisma.planMedico.count(),
    instituciones: await prisma.institucion.count(),
    coberturasDeInstituciones: await prisma.institucionCobertura.count(),
    usuarios: await prisma.usuario.count(),
    medicos: await prisma.medico.count(),
    franjas: await prisma.franjaAtencion.count(),
    turnos: await prisma.turno.count(),
    ordenes: await prisma.orden.count(),
    resultados: await prisma.resultado.count(),
    recetas: await prisma.receta.count(),
    notificaciones: await prisma.notificacion.count(),
    especialidades: await prisma.especialidad.count(),
    feedbacks: await prisma.feedback.count(),
  };
  console.log(`Seed cargado (fechas corridas ${dias} días desde ${datos.generadoEl}):`, conteo);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
