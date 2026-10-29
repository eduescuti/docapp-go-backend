import type { Prisma, Turno as TurnoDb } from "@prisma/client";

import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import type { UsuarioDeSesion } from "../tipos/express";
import { ahoraArgentina, diaDeLaSemana, diaSiguiente, hoyArgentina, minutosHasta } from "../utils/tiempo";
import { institucionVisible, medicoVisible, planDelPaciente } from "./cobertura";
import { aInstitucion, aPaciente, aSede, INCLUIR_INSTITUCION, INCLUIR_PACIENTE } from "./formato";
import { buscar as buscarMedicos } from "./medicos";
import { enviarPush, notificar, type Aviso } from "./notificaciones";

// Turnos (06-reglas-de-negocio.md#turnos). Un turno activo (pendiente o confirmado) ocupa el horario; uno
// cancelado o rechazado lo libera. Todo turno nuevo nace pendiente.

const ACTIVOS = ["pendiente", "confirmado"];
/** Hasta cuántas horas antes del turno se puede cancelar o reprogramar (regla 5, igual para toda la app). */
export const HORAS_MINIMAS_CANCELACION = 24;
const DURACION_TURNO_MIN = 30;
/** Cuántos días hacia adelante se puede consultar la disponibilidad (la reserva muestra 90). */
const DIAS_MAXIMOS_CONSULTA = 92;

/** Turno con la forma de `Turno` del frontend. */
export function aTurno(t: TurnoDb) {
  return {
    id: t.id,
    pacienteId: t.pacienteId,
    medicoId: t.medicoId,
    sedeId: t.sedeId,
    fecha: t.fecha,
    hora: t.hora,
    estado: t.estado,
    ...(t.ocultoEnHistorial ? { ocultoEnHistorial: true } : {}),
    ...(t.reprogramadoDesdeId ? { reprogramadoDesdeId: t.reprogramadoDesdeId } : {}),
  };
}

/**
 * Vencimiento automático: los que ya pasaron se cierran solos (confirmado → completado, pendiente → rechazado).
 * Se corre antes de leer turnos, así no depende de un proceso a la hora exacta.
 */
export async function vencerTurnos(): Promise<void> {
  const ahora = ahoraArgentina();
  const candidatos = await prisma.turno.findMany({
    where: { estado: { in: ACTIVOS }, fecha: { lte: ahora.slice(0, 10) } },
    include: INCLUIR_PARA_AVISO,
  });
  const vencidos = candidatos.filter((t) => `${t.fecha} ${t.hora}` < ahora);
  if (vencidos.length === 0) return;
  const confirmados = vencidos.filter((t) => t.estado === "confirmado").map((t) => t.id);
  const pendientes = vencidos.filter((t) => t.estado === "pendiente");
  const avisos = await prisma.$transaction(async (tx) => {
    await tx.turno.updateMany({ where: { id: { in: confirmados }, estado: "confirmado" }, data: { estado: "completado" } });
    const { count } = await tx.turno.updateMany({ where: { id: { in: pendientes.map((t) => t.id) }, estado: "pendiente" }, data: { estado: "rechazado" } });
    const avisos: Aviso[] = [];
    // Si otro pedido ya los venció a la vez, no se avisa dos veces.
    if (count === pendientes.length) {
      for (const t of pendientes) {
        const aviso = await notificar(
          {
            usuarioId: t.paciente.usuarioId,
            tipo: "turno_rechazado",
            titulo: "Turno no confirmado",
            mensaje: `${nombreProfesional(t.medico)} no confirmó tu turno de ${t.especialidad.nombre} del ${diaYHora(t)}. Podés pedir otro desde Reservar.`,
            referenciaTipo: "turno",
            referenciaId: t.id,
          },
          tx,
        );
        avisos.push(aviso);
      }
    }
    return avisos;
  });
  enviarPush(...avisos);
}

/** Lo que hace falta para escribir el aviso de un turno: quién es quién y de qué especialidad. */
const INCLUIR_PARA_AVISO = {
  paciente: { select: { usuarioId: true, usuario: { select: { nombre: true, apellido: true } } } },
  medico: { select: { usuarioId: true, genero: true, usuario: { select: { nombre: true, apellido: true } } } },
  especialidad: { select: { nombre: true } },
} satisfies Prisma.TurnoInclude;

const nombreProfesional = (m: { genero: string; usuario: { nombre: string; apellido: string } }) =>
  `${m.genero === "femenino" ? "La Dra." : "El Dr."} ${m.usuario.nombre} ${m.usuario.apellido}`;

/** "29/10 a las 14:00" */
const diaYHora = (t: { fecha: string; hora: string }) => `${t.fecha.slice(8, 10)}/${t.fecha.slice(5, 7)} a las ${t.hora}`;

/** Turnos con profesional, especialidad, sede e institución resueltos (`TurnoConDetalle`), en pocas consultas. */
async function conDetalle(turnos: TurnoDb[]) {
  const medicos = await buscarMedicos({ id: { in: [...new Set(turnos.map((t) => t.medicoId))] } });
  const especialidades = await prisma.especialidad.findMany({
    where: { id: { in: [...new Set(turnos.map((t) => t.especialidadId))] } },
    include: { subespecialidades: { select: { nombre: true } } },
  });
  const sedes = await prisma.sede.findMany({
    where: { id: { in: [...new Set(turnos.map((t) => t.sedeId))] } },
    include: { institucion: { include: INCLUIR_INSTITUCION } },
  });
  return turnos.map((t) => {
    const especialidad = especialidades.find((e) => e.id === t.especialidadId);
    const sede = sedes.find((s) => s.id === t.sedeId);
    return {
      turno: aTurno(t),
      medico: medicos.find((m) => m.id === t.medicoId),
      especialidad: especialidad && { id: especialidad.id, nombre: especialidad.nombre, subespecialidades: especialidad.subespecialidades.map((s) => s.nombre) },
      sede: sede && aSede(sede),
      institucion: sede && aInstitucion(sede.institucion),
    };
  });
}

const orden = (a: TurnoDb, b: TurnoDb) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`);
/** Prioridad en "Próximos": confirmados arriba de todo, después pendientes y al final rechazados. */
const PRIORIDAD: Record<string, number> = { confirmado: 0, pendiente: 1, rechazado: 2 };

/** Próximos: desde hoy, sin cancelados ni completados (los rechazados se ven para que sepa que no se aceptaron). */
const esProximo = (t: TurnoDb, hoy: string) => t.fecha >= hoy && t.estado !== "cancelado" && t.estado !== "completado";

/** "Mis turnos": próximos (confirmados primero) e historial (el resto, sin los que sacó; del más reciente al más viejo). */
export async function misTurnos(pacienteId: string) {
  await vencerTurnos();
  const hoy = hoyArgentina();
  const turnos = await prisma.turno.findMany({ where: { pacienteId } });
  const proximos = turnos.filter((t) => esProximo(t, hoy)).sort((a, b) => (PRIORIDAD[a.estado] ?? 9) - (PRIORIDAD[b.estado] ?? 9) || orden(a, b));
  const historial = turnos.filter((t) => !esProximo(t, hoy) && !t.ocultoEnHistorial).sort((a, b) => orden(b, a));
  const detalle = await conDetalle([...proximos, ...historial]);
  return { proximos: detalle.slice(0, proximos.length), historial: detalle.slice(proximos.length) };
}

/** Todos los turnos del paciente, también los que sacó del historial (su historial médico no cambia). */
export async function todosLosTurnos(pacienteId: string) {
  await vencerTurnos();
  return (await prisma.turno.findMany({ where: { pacienteId }, orderBy: [{ fecha: "asc" }, { hora: "asc" }] })).map(aTurno);
}

/** El próximo turno activo (Inicio), o null. */
export async function proximoTurno(pacienteId: string) {
  await vencerTurnos();
  const turno = await prisma.turno.findFirst({
    where: { pacienteId, estado: { in: ACTIVOS }, fecha: { gte: hoyArgentina() } },
    orderBy: [{ fecha: "asc" }, { hora: "asc" }],
  });
  return turno ? (await conDetalle([turno]))[0] : null;
}

/** "Eliminar todo" del historial: oculta todos los turnos que hoy figuran en él. */
export async function vaciarHistorial(pacienteId: string): Promise<void> {
  await vencerTurnos();
  const hoy = hoyArgentina();
  const turnos = await prisma.turno.findMany({ where: { pacienteId, ocultoEnHistorial: false } });
  const ids = turnos.filter((t) => !esProximo(t, hoy)).map((t) => t.id);
  await prisma.turno.updateMany({ where: { id: { in: ids } }, data: { ocultoEnHistorial: true } });
}

// ───────────── Disponibilidad (franjas de atención) ─────────────

/** "09:00", "09:30", … dentro de la franja (el último empieza 30 min antes de `hasta`). */
function horasDeFranja(desde: string, hasta: string): string[] {
  const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const horas: string[] = [];
  for (let m = minutos(desde); m + DURACION_TURNO_MIN <= minutos(hasta); m += DURACION_TURNO_MIN) {
    horas.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return horas;
}

type Franja = { sedeId: string; diaSemana: number; desde: string; hasta: string };

const enFranja = (franjas: Franja[], sedeId: string, fecha: string, hora: string) =>
  franjas.some((f) => f.sedeId === sedeId && f.diaSemana === diaDeLaSemana(fecha) && horasDeFranja(f.desde, f.hasta).includes(hora));

/** Profesionales que le aparecen al paciente (y, si se indica, solo esos) con sus franjas, y las sedes que ve. */
async function contextoDisponibilidad(pacienteId: string, medicoIds?: string[]) {
  const plan = await planDelPaciente(pacienteId);
  const where: Prisma.MedicoWhereInput[] = [medicoVisible(plan)];
  if (medicoIds) where.push({ id: { in: medicoIds } });
  const medicos = await prisma.medico.findMany({ where: { AND: where }, select: { id: true, franjas: { orderBy: { desde: "asc" } } } });
  const sedes = await prisma.sede.findMany({
    where: { institucion: institucionVisible(plan), franjas: { some: { medicoId: { in: medicos.map((m) => m.id) } } } },
    select: { id: true },
  });
  return { medicos, sedesVisibles: new Set(sedes.map((s) => s.id)) };
}

type Contexto = Awaited<ReturnType<typeof contextoDisponibilidad>>;

/** Los horarios libres de un día: en una franja, en una sede que le aparece, sin turno activo del médico y sin pasar. */
function libresDelDia(ctx: Contexto, fecha: string, ocupados: Set<string>, ahora: string) {
  const dia = diaDeLaSemana(fecha);
  return ctx.medicos.flatMap((medico) => {
    // Un profesional no puede estar en dos sedes a la misma hora: si sus franjas se pisan, queda la primera.
    const tomadas = new Set<string>();
    return medico.franjas
      .filter((f) => f.diaSemana === dia && ctx.sedesVisibles.has(f.sedeId))
      .flatMap((f) =>
        horasDeFranja(f.desde, f.hasta).flatMap((hora) => {
          if (tomadas.has(hora) || ocupados.has(`${medico.id} ${fecha} ${hora}`) || `${fecha} ${hora}` <= ahora) return [];
          tomadas.add(hora);
          return [{ medicoId: medico.id, sedeId: f.sedeId, hora }];
        }),
      );
  });
}

async function ocupadosEntre(medicoIds: string[], desde: string, hasta: string): Promise<Set<string>> {
  const turnos = await prisma.turno.findMany({
    where: { medicoId: { in: medicoIds }, estado: { in: ACTIVOS }, fecha: { gte: desde, lte: hasta } },
    select: { medicoId: true, fecha: true, hora: true },
  });
  return new Set(turnos.map((t) => `${t.medicoId} ${t.fecha} ${t.hora}`));
}

/** `[{ medicoId, sedeId, hora }]` libres ese día para el paciente (reglas 3, 4 y 18). */
export async function horariosLibres(pacienteId: string, fecha: string, medicoIds?: string[]) {
  const ctx = await contextoDisponibilidad(pacienteId, medicoIds);
  const ocupados = await ocupadosEntre(ctx.medicos.map((m) => m.id), fecha, fecha);
  return libresDelDia(ctx, fecha, ocupados, ahoraArgentina());
}

/** Días del rango `[desde, hasta]` con algún horario libre para el paciente. */
export async function diasConTurnos(pacienteId: string, desde: string, hasta: string, medicoIds?: string[]) {
  const ctx = await contextoDisponibilidad(pacienteId, medicoIds);
  const ocupados = await ocupadosEntre(ctx.medicos.map((m) => m.id), desde, hasta);
  const ahora = ahoraArgentina();
  const dias: string[] = [];
  for (let fecha = desde, n = 0; fecha <= hasta && n < DIAS_MAXIMOS_CONSULTA; fecha = diaSiguiente(fecha), n++) {
    if (libresDelDia(ctx, fecha, ocupados, ahora).length > 0) dias.push(fecha);
  }
  return dias;
}

// ───────────── Reservar, reprogramar y cambiar de estado ─────────────

export interface DatosReserva {
  medicoId: string;
  sedeId: string;
  fecha: string;
  hora: string;
  /** La especialidad elegida en el paso 4 de la reserva; tiene que ser la del profesional (paso 5). */
  especialidadId?: string;
}

/**
 * Lo que se revisa al reservar (06-reglas-de-negocio.md#combinación-única-reservar), dentro de la transacción: la
 * combinación entera de los 5 pasos de la reserva (fecha, horario, lugar, especialidad y profesional) es
 * coherente: el profesional atiende ahí, esa especialidad y la cobertura del paciente, la sede le aparece, el
 * horario está en sus franjas, no pasó y nadie lo tomó. Si dos pedidos llegan juntos, el índice único de la base frena al segundo (409).
 */
async function validarYCrear(tx: Prisma.TransactionClient, pacienteId: string, datos: DatosReserva, reprogramadoDesdeId?: string) {
  const { plan } = await tx.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { plan: true } });
  const medico = await tx.medico.findFirst({
    where: { id: datos.medicoId, usuario: { activo: true } },
    include: { lugares: true, franjas: true },
  });
  if (!medico) throw new ErrorHttp(404, "No existe ese profesional.");
  if (!medico.lugares.some((l) => l.sedeId === datos.sedeId)) throw new ErrorHttp(400, "El profesional no atiende en ese lugar.");
  if (datos.especialidadId && datos.especialidadId !== medico.especialidadId) {
    throw new ErrorHttp(400, "El profesional no atiende esa especialidad.");
  }
  if ((await tx.medico.count({ where: { AND: [{ id: medico.id }, medicoVisible(plan)] } })) === 0) {
    throw new ErrorHttp(400, "El profesional no atiende tu cobertura.");
  }
  if ((await tx.sede.count({ where: { id: datos.sedeId, institucion: institucionVisible(plan) } })) === 0) {
    throw new ErrorHttp(400, "Ese lugar no atiende tu cobertura.");
  }
  if (!enFranja(medico.franjas, datos.sedeId, datos.fecha, datos.hora)) throw new ErrorHttp(400, "Ese horario no está entre los del profesional.");
  if (`${datos.fecha} ${datos.hora}` <= ahoraArgentina()) throw new ErrorHttp(400, "Ese horario ya pasó.");
  const ocupado = await tx.turno.count({ where: { medicoId: medico.id, fecha: datos.fecha, hora: datos.hora, estado: { in: ACTIVOS } } });
  if (ocupado > 0) throw new ErrorHttp(409, "Ese horario ya no está disponible.");
  return tx.turno.create({
    data: { ...datos, pacienteId, especialidadId: medico.especialidadId, reprogramadoDesdeId }, // nace "pendiente"
  });
}

/** Regla 4: una reserva bloquea el horario. El turno nace pendiente hasta que el profesional lo confirme. */
export async function reservar(pacienteId: string, usuarioId: string, datos: DatosReserva) {
  const turno = await prisma.$transaction((tx) => validarYCrear(tx, pacienteId, datos));
  await registrarAccion({ usuarioId, accion: "reserva_turno", entidad: "turno", entidadId: turno.id });
  return aTurno(turno);
}

/** Por qué ya no se puede cancelar ni reprogramar (regla 5), o null si se puede. */
function motivoSinCambios(t: TurnoDb): string | null {
  if (!ACTIVOS.includes(t.estado)) return "Este turno ya no está activo.";
  if (minutosHasta(t.fecha, t.hora) < HORAS_MINIMAS_CANCELACION * 60) {
    return `Faltan menos de ${HORAS_MINIMAS_CANCELACION} h para el turno: ya no se puede cancelar ni reprogramar desde la app.`;
  }
  return null;
}

async function turnoDelPaciente(tx: Prisma.TransactionClient, pacienteId: string, turnoId: string) {
  const turno = await tx.turno.findFirst({ where: { id: turnoId, pacienteId } });
  if (!turno) throw new ErrorHttp(404, "No existe ese turno.");
  return turno;
}

/**
 * Reprogramar = cancelar el turno y reservar otro con el mismo profesional, en una sola transacción: si el nuevo
 * horario no se puede reservar, el viejo queda como estaba. El nuevo nace pendiente y guarda de cuál viene.
 */
export async function reprogramar(pacienteId: string, usuarioId: string, turnoId: string, datos: Omit<DatosReserva, "medicoId">) {
  await vencerTurnos();
  const nuevo = await prisma.$transaction(async (tx) => {
    const viejo = await turnoDelPaciente(tx, pacienteId, turnoId);
    const motivo = motivoSinCambios(viejo);
    if (motivo) throw new ErrorHttp(409, motivo);
    await tx.turno.update({ where: { id: viejo.id }, data: { estado: "cancelado", canceladoEn: new Date() } });
    return validarYCrear(tx, pacienteId, { ...datos, medicoId: viejo.medicoId }, viejo.id);
  });
  await registrarAccion({ usuarioId, accion: "reprogramacion_turno", entidad: "turno", entidadId: nuevo.id, detalle: `desde ${turnoId}` });
  return aTurno(nuevo);
}

export interface CambioDeTurno {
  estado?: string;
  ocultoEnHistorial?: boolean;
}

/**
 * Cambios sobre un turno existente, según quién los pide (tabla de 06-reglas-de-negocio.md#estados-y-quién-los-cambia):
 * el paciente cancela (hasta 24 h antes) o lo saca de su historial; el profesional confirma o rechaza uno pendiente.
 * Un turno ajeno responde 404, para no revelar que existe.
 */
export async function cambiarTurno(usuario: UsuarioDeSesion, turnoId: string, cambio: CambioDeTurno) {
  await vencerTurnos();
  if (usuario.paciente) {
    const turno = await turnoDelPaciente(prisma, usuario.paciente.id, turnoId);
    if (cambio.ocultoEnHistorial === true) {
      return aTurno(await prisma.turno.update({ where: { id: turno.id }, data: { ocultoEnHistorial: true } }));
    }
    if (cambio.estado !== "cancelado") throw new ErrorHttp(403, "No podés hacer ese cambio en un turno.");
    const motivo = motivoSinCambios(turno);
    if (motivo) throw new ErrorHttp(409, motivo);
    const [cancelado, aviso] = await prisma.$transaction(async (tx) => {
      const t = await tx.turno.update({ where: { id: turno.id }, data: { estado: "cancelado", canceladoEn: new Date() }, include: INCLUIR_PARA_AVISO });
      const aviso = await notificar(
        {
          usuarioId: t.medico.usuarioId,
          tipo: "turno_cancelado",
          titulo: "Turno cancelado",
          mensaje: `${t.paciente.usuario.nombre} ${t.paciente.usuario.apellido} canceló su turno del ${diaYHora(t)}. El horario quedó libre.`,
          referenciaTipo: "turno",
          referenciaId: t.id,
        },
        tx,
      );
      return [t, aviso] as const;
    });
    enviarPush(aviso);
    await registrarAccion({ usuarioId: usuario.id, accion: "cancelacion_turno", entidad: "turno", entidadId: turno.id });
    return aTurno(cancelado);
  }
  if (usuario.medico) {
    if (cambio.estado !== "confirmado" && cambio.estado !== "rechazado") throw new ErrorHttp(403, "No podés hacer ese cambio en un turno.");
    const turno = await prisma.turno.findFirst({ where: { id: turnoId, medicoId: usuario.medico.id } });
    if (!turno) throw new ErrorHttp(404, "No existe ese turno.");
    if (turno.estado !== "pendiente") throw new ErrorHttp(409, "Este turno ya no está pendiente de confirmación.");
    const estado = cambio.estado;
    const [respondido, aviso] = await prisma.$transaction(async (tx) => {
      const t = await tx.turno.update({ where: { id: turno.id }, data: { estado, respondidoEn: new Date() }, include: INCLUIR_PARA_AVISO });
      const confirmado = estado === "confirmado";
      const aviso = await notificar(
        {
          usuarioId: t.paciente.usuarioId,
          tipo: confirmado ? "turno_confirmado" : "turno_rechazado",
          titulo: confirmado ? "Turno confirmado" : "Turno rechazado",
          mensaje: confirmado
            ? `${nombreProfesional(t.medico)} confirmó tu turno de ${t.especialidad.nombre} del ${diaYHora(t)}.`
            : `${nombreProfesional(t.medico)} no pudo aceptar tu turno de ${t.especialidad.nombre} del ${diaYHora(t)}. Podés pedir otro desde Reservar.`,
          referenciaTipo: "turno",
          referenciaId: t.id,
        },
        tx,
      );
      return [t, aviso] as const;
    });
    enviarPush(aviso);
    await registrarAccion({ usuarioId: usuario.id, accion: `turno_${cambio.estado}`, entidad: "turno", entidadId: turno.id });
    return aTurno(respondido);
  }
  throw new ErrorHttp(403, "No tenés permiso para esto.");
}

// ───────────── Profesional: agenda, pacientes asignados y franjas ─────────────

/**
 * Turnos del profesional (pasados y futuros, opcionalmente en un rango), con el paciente (y su foto: lo tiene
 * asignado por un turno), la sede y la institución (`TurnoDeAgenda`). Para Inicio, Agenda y la ficha.
 */
export async function agenda(medicoId: string, desde?: string, hasta?: string) {
  await vencerTurnos();
  const turnos = await prisma.turno.findMany({
    where: { medicoId, fecha: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } },
    orderBy: [{ fecha: "asc" }, { hora: "asc" }],
    include: { paciente: { include: INCLUIR_PACIENTE }, sede: { include: { institucion: { include: INCLUIR_INSTITUCION } } } },
  });
  return turnos.map(({ paciente, sede, ...turno }) => ({
    turno: aTurno(turno),
    paciente: aPaciente(paciente),
    sede: aSede(sede),
    institucion: aInstitucion(sede.institucion),
  }));
}

/** Pacientes asignados: los que tienen un turno próximo (pendiente o confirmado) con él, con su foto. */
export async function pacientesAsignados(medicoId: string) {
  await vencerTurnos();
  const pacientes = await prisma.paciente.findMany({
    where: { turnos: { some: { medicoId, estado: { in: ACTIVOS }, fecha: { gte: hoyArgentina() } } } },
    include: INCLUIR_PACIENTE,
  });
  return pacientes.map(aPaciente);
}

export async function misFranjas(medicoId: string) {
  const franjas = await prisma.franjaAtencion.findMany({ where: { medicoId }, orderBy: [{ diaSemana: "asc" }, { desde: "asc" }] });
  return franjas.map(({ id, medicoId: medico, sedeId, diaSemana, desde, hasta }) => ({ id, medicoId: medico, sedeId, diaSemana, desde, hasta }));
}

/**
 * Reemplaza todas las franjas del profesional. Cada una en uno de sus lugares, en horas en punto o y media, y
 * las de un mismo día no se pisan aunque sean en lugares distintos. Los turnos ya tomados no se tocan.
 */
export async function guardarFranjas(medicoId: string, usuarioId: string, franjas: Franja[]) {
  const lugares = new Set((await prisma.medicoSede.findMany({ where: { medicoId }, select: { sedeId: true } })).map((l) => l.sedeId));
  for (const f of franjas) {
    if (!lugares.has(f.sedeId)) throw new ErrorHttp(400, "Elegí uno de tus lugares de atención.");
    if (f.desde >= f.hasta) throw new ErrorHttp(400, "La hora de fin tiene que ser posterior a la de inicio.");
  }
  for (let dia = 0; dia <= 6; dia++) {
    const delDia = franjas.filter((f) => f.diaSemana === dia).sort((a, b) => a.desde.localeCompare(b.desde));
    if (delDia.some((f, i) => i > 0 && f.desde < delDia[i - 1].hasta)) {
      throw new ErrorHttp(400, "Ese horario se pisa con otro del mismo día. No podés atender en dos lugares a la vez.");
    }
  }
  await prisma.$transaction([
    prisma.franjaAtencion.deleteMany({ where: { medicoId } }),
    prisma.franjaAtencion.createMany({ data: franjas.map((f) => ({ ...f, medicoId })) }),
  ]);
  await registrarAccion({ usuarioId, accion: "franjas_profesional", entidad: "medico", entidadId: medicoId });
  return misFranjas(medicoId);
}
