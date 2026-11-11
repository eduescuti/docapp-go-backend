import type { Prisma, Turno as TurnoDb } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { ahoraArgentina, hoyArgentina, minutosHasta } from "../../utils/tiempo";
import { institucionVisible, medicoVisible } from "../catalogos/cobertura";
import {
  aEspecialidad,
  aInstitucion,
  aPaciente,
  aSede,
  INCLUIR_ESPECIALIDAD,
  INCLUIR_INSTITUCION,
  INCLUIR_PACIENTE,
  nombreProfesional,
  PROFESIONAL_PARA_AVISO,
} from "../formato";
import { conAviso, enviarPush, notificar, type Aviso } from "../notificaciones/notificaciones";
import type { UsuarioDeSesion } from "../sesion/sesiones";
import { buscar as buscarMedicos } from "../usuarios/medicos";
import { ACTIVOS, enFranja } from "./disponibilidad";

const HORAS_MINIMAS_CANCELACION = 24;

/** Prioridad en "Próximos": confirmados arriba de todo, después pendientes y al final rechazados. */
const PRIORIDAD: Record<string, number> = { confirmado: 0, pendiente: 1, rechazado: 2 };

/** Lo que hace falta para escribir el aviso de un turno: quién es quién y de qué especialidad. */
const INCLUIR_PARA_AVISO = {
  paciente: { select: { usuarioId: true, usuario: { select: { nombre: true, apellido: true } } } },
  medico: { select: PROFESIONAL_PARA_AVISO },
  especialidad: { select: { nombre: true } },
} satisfies Prisma.TurnoInclude;
type TurnoParaAviso = Prisma.TurnoGetPayload<{ include: typeof INCLUIR_PARA_AVISO }>;

/** Convierte un turno al formato `Turno` del frontend. */
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

/** Formatea la fecha y hora del turno: "29/10 a las 14:00". */
const diaYHora = (t: { fecha: string; hora: string }) => `${t.fecha.slice(8, 10)}/${t.fecha.slice(5, 7)} a las ${t.hora}`;

/** Compara dos turnos por fecha y hora, para ordenarlos del más viejo al más nuevo. */
const porFecha = (a: TurnoDb, b: TurnoDb) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`);

/** Indica si el turno va en "Próximos": desde hoy, sin cancelados ni completados. */
const esProximo = (t: TurnoDb, hoy: string) => t.fecha >= hoy && t.estado !== "cancelado" && t.estado !== "completado";

/** Junta los valores distintos de ese campo en los turnos. */
const distintos = (turnos: TurnoDb[], campo: "medicoId" | "especialidadId" | "sedeId") => [...new Set(turnos.map((t) => t[campo]))];

/** Arma el aviso al paciente de que su turno venció sin que el profesional lo confirmara. */
const avisoNoConfirmado = (t: TurnoParaAviso): Aviso => ({
  usuarioId: t.paciente.usuarioId,
  tipo: "turno_rechazado",
  titulo: "Turno rechazado",
  mensaje: `${nombreProfesional(t.medico)} no confirmó tu turno de ${t.especialidad.nombre} del ${diaYHora(t)}. Podés pedir otro desde Reservar.`,
  referenciaTipo: "turno",
  referenciaId: t.id,
});

/** Cierra los turnos que ya pasaron: confirmado → completado y pendiente → rechazado (avisando una sola vez). */
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
    const { count } = await tx.turno.updateMany({
      where: { id: { in: pendientes.map((t) => t.id) }, estado: "pendiente" },
      data: { estado: "rechazado" },
    });
    if (count !== pendientes.length) return [];

    const guardados: Aviso[] = [];
    for (const t of pendientes) guardados.push(await notificar(avisoNoConfirmado(t), tx));
    return guardados;
  });

  enviarPush(...avisos);
}

/** Completa cada turno con su profesional, especialidad, sede e institución (`TurnoConDetalle`). */
async function conDetalle(turnos: TurnoDb[]) {
  const [medicos, especialidades, sedes] = await Promise.all([
    buscarMedicos({ id: { in: distintos(turnos, "medicoId") } }),
    prisma.especialidad.findMany({ where: { id: { in: distintos(turnos, "especialidadId") } }, include: INCLUIR_ESPECIALIDAD }),
    prisma.sede.findMany({ where: { id: { in: distintos(turnos, "sedeId") } }, include: { institucion: { include: INCLUIR_INSTITUCION } } }),
  ]);

  return turnos.map((t) => {
    const especialidad = especialidades.find((e) => e.id === t.especialidadId);
    const sede = sedes.find((s) => s.id === t.sedeId);
    return {
      turno: aTurno(t),
      medico: medicos.find((m) => m.id === t.medicoId),
      especialidad: especialidad && aEspecialidad(especialidad),
      sede: sede && aSede(sede),
      institucion: sede && aInstitucion(sede.institucion),
    };
  });
}

/** Obtiene los turnos del paciente: próximos (confirmados primero) e historial (sin ocultos, del más reciente). */
export async function misTurnos(pacienteId: string) {
  await vencerTurnos();
  const hoy = hoyArgentina();
  const turnos = await prisma.turno.findMany({ where: { pacienteId } });

  const proximos = turnos
    .filter((t) => esProximo(t, hoy))
    .sort((a, b) => (PRIORIDAD[a.estado] ?? 9) - (PRIORIDAD[b.estado] ?? 9) || porFecha(a, b));
  const historial = turnos.filter((t) => !esProximo(t, hoy) && !t.ocultoEnHistorial).sort((a, b) => porFecha(b, a));

  const detalle = await conDetalle([...proximos, ...historial]);
  return { proximos: detalle.slice(0, proximos.length), historial: detalle.slice(proximos.length) };
}

/** Obtiene todos los turnos del paciente, también los que sacó del historial. */
export async function todosLosTurnos(pacienteId: string) {
  await vencerTurnos();
  const turnos = await prisma.turno.findMany({ where: { pacienteId }, orderBy: [{ fecha: "asc" }, { hora: "asc" }] });
  return turnos.map(aTurno);
}

/** Obtiene el próximo turno activo del paciente (para el Inicio), o null. */
export async function proximoTurno(pacienteId: string) {
  await vencerTurnos();
  const turno = await prisma.turno.findFirst({
    where: { pacienteId, estado: { in: ACTIVOS }, fecha: { gte: hoyArgentina() } },
    orderBy: [{ fecha: "asc" }, { hora: "asc" }],
  });
  return turno ? (await conDetalle([turno]))[0] : null;
}

/** Oculta todos los turnos que hoy figuran en el historial del paciente. */
export async function vaciarHistorial(pacienteId: string): Promise<void> {
  await vencerTurnos();
  const hoy = hoyArgentina();
  const turnos = await prisma.turno.findMany({ where: { pacienteId, ocultoEnHistorial: false } });
  const ids = turnos.filter((t) => !esProximo(t, hoy)).map((t) => t.id);
  await prisma.turno.updateMany({ where: { id: { in: ids } }, data: { ocultoEnHistorial: true } });
}

// ───────────── Reservar, reprogramar y cambiar de estado ─────────────

interface DatosReserva {
  medicoId: string;
  sedeId: string;
  fecha: string;
  hora: string;
  /** La especialidad elegida en el paso 4 de la reserva; tiene que ser la del profesional (paso 5). */
  especialidadId?: string;
}

interface CambioDeTurno {
  estado?: string;
  ocultoEnHistorial?: boolean;
}

/** Valida la combinación entera de la reserva (profesional, lugar, especialidad, cobertura y horario) y crea el turno. */
async function validarYCrear(tx: Prisma.TransactionClient, pacienteId: string, datos: DatosReserva, reprogramadoDesdeId?: string) {
  const { plan } = await tx.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { plan: true } });
  const medico = await tx.medico.findFirst({ where: { id: datos.medicoId, usuario: { activo: true } }, include: { lugares: true, franjas: true } });

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

  const [ocupado, pacienteOcupado] = await Promise.all([
    tx.turno.count({ where: { medicoId: medico.id, fecha: datos.fecha, hora: datos.hora, estado: { in: ACTIVOS } } }),
    tx.turno.count({ where: { pacienteId, fecha: datos.fecha, hora: datos.hora, estado: { in: ACTIVOS } } }),
  ]);
  if (ocupado > 0) throw new ErrorHttp(409, "Ese horario ya no está disponible.");
  if (pacienteOcupado > 0) throw new ErrorHttp(409, "Ya tenés otro turno ese día a esa hora.");

  return tx.turno.create({
    data: { ...datos, pacienteId, especialidadId: medico.especialidadId, reprogramadoDesdeId },
    include: INCLUIR_PARA_AVISO,
  });
}

/** Formatea el nombre del paciente del turno: "Sofía Martínez". */
const nombrePaciente = (t: TurnoParaAviso) => `${t.paciente.usuario.nombre} ${t.paciente.usuario.apellido}`;

/** Reserva un turno; queda pendiente hasta que el profesional lo confirme, y a él le llega la solicitud. */
export async function reservar(pacienteId: string, usuarioId: string, datos: DatosReserva) {
  const turno = await conAviso(
    (tx) => validarYCrear(tx, pacienteId, datos),
    (t) => ({
      usuarioId: t.medico.usuarioId,
      tipo: "turno_solicitado",
      titulo: "Turno solicitado",
      mensaje: `${nombrePaciente(t)} pidió un turno de ${t.especialidad.nombre} para el ${diaYHora(t)}. Confirmalo o rechazalo desde su ficha.`,
      referenciaTipo: "turno",
      referenciaId: t.id,
    }),
  );
  await registrarAccion({ usuarioId, accion: "reserva_turno", entidad: "turno", entidadId: turno.id });
  return aTurno(turno);
}

/** Devuelve por qué ya no se puede cancelar ni reprogramar el turno, o null si se puede. */
function motivoSinCambios(t: TurnoDb): string | null {
  if (!ACTIVOS.includes(t.estado)) return "Este turno ya no está activo.";
  if (minutosHasta(t.fecha, t.hora) < HORAS_MINIMAS_CANCELACION * 60) {
    return `Faltan menos de ${HORAS_MINIMAS_CANCELACION} h para el turno: ya no se puede cancelar ni reprogramar desde la app.`;
  }
  return null;
}

/** Obtiene un turno del paciente; 404 si no existe o es de otro. */
async function turnoDelPaciente(tx: Prisma.TransactionClient, pacienteId: string, turnoId: string) {
  const turno = await tx.turno.findFirst({ where: { id: turnoId, pacienteId } });
  if (!turno) throw new ErrorHttp(404, "No existe ese turno.");
  return turno;
}

/** Cancela el turno y reserva otro con el mismo profesional en una sola transacción, y se lo avisa al profesional. */
export async function reprogramar(pacienteId: string, usuarioId: string, turnoId: string, datos: Omit<DatosReserva, "medicoId">) {
  await vencerTurnos();

  const { nuevo } = await conAviso(
    async (tx) => {
      const viejo = await turnoDelPaciente(tx, pacienteId, turnoId);
      const motivo = motivoSinCambios(viejo);
      if (motivo) throw new ErrorHttp(409, motivo);

      await tx.turno.update({ where: { id: viejo.id }, data: { estado: "cancelado", canceladoEn: new Date() } });
      return { viejo, nuevo: await validarYCrear(tx, pacienteId, { ...datos, medicoId: viejo.medicoId }, viejo.id) };
    },
    ({ viejo, nuevo: t }) => ({
      usuarioId: t.medico.usuarioId,
      tipo: "turno_reprogramado",
      titulo: "Turno reprogramado",
      mensaje: `${nombrePaciente(t)} pasó su turno del ${diaYHora(viejo)} al ${diaYHora(t)}. Confirmalo o rechazalo desde su ficha.`,
      referenciaTipo: "turno",
      referenciaId: t.id,
    }),
  );
  await registrarAccion({ usuarioId, accion: "reprogramacion_turno", entidad: "turno", entidadId: nuevo.id, detalle: `desde ${turnoId}` });

  return aTurno(nuevo);
}

/** Aplica un cambio sobre un turno según quién lo pide; un turno ajeno da 404. */
export async function cambiarTurno(usuario: UsuarioDeSesion, turnoId: string, cambio: CambioDeTurno) {
  await vencerTurnos();
  if (usuario.paciente) return cambioDelPaciente(usuario.id, usuario.paciente.id, turnoId, cambio);
  if (usuario.medico) return respuestaDelProfesional(usuario.id, usuario.medico.id, turnoId, cambio.estado);
  throw new ErrorHttp(403, "No tenés permiso para esto.");
}

/** Saca el turno del historial del paciente o lo cancela (avisándole al profesional). */
async function cambioDelPaciente(usuarioId: string, pacienteId: string, turnoId: string, cambio: CambioDeTurno) {
  const turno = await turnoDelPaciente(prisma, pacienteId, turnoId);
  if (cambio.ocultoEnHistorial === true) {
    return aTurno(await prisma.turno.update({ where: { id: turno.id }, data: { ocultoEnHistorial: true } }));
  }

  if (cambio.estado !== "cancelado") throw new ErrorHttp(403, "No podés hacer ese cambio en un turno.");
  const motivo = motivoSinCambios(turno);
  if (motivo) throw new ErrorHttp(409, motivo);

  const cancelado = await conAviso(
    (tx) => tx.turno.update({ where: { id: turno.id }, data: { estado: "cancelado", canceladoEn: new Date() }, include: INCLUIR_PARA_AVISO }),
    (t) => ({
      usuarioId: t.medico.usuarioId,
      tipo: "turno_cancelado",
      titulo: "Turno cancelado",
      mensaje: `${t.paciente.usuario.nombre} ${t.paciente.usuario.apellido} canceló su turno del ${diaYHora(t)}. El horario quedó libre.`,
      referenciaTipo: "turno",
      referenciaId: t.id,
    }),
  );
  await registrarAccion({ usuarioId, accion: "cancelacion_turno", entidad: "turno", entidadId: turno.id });

  return aTurno(cancelado);
}

/** Confirma o rechaza un turno pendiente del profesional (avisándole al paciente). */
async function respuestaDelProfesional(usuarioId: string, medicoId: string, turnoId: string, estado?: string) {
  if (estado !== "confirmado" && estado !== "rechazado") throw new ErrorHttp(403, "No podés hacer ese cambio en un turno.");
  const turno = await prisma.turno.findFirst({ where: { id: turnoId, medicoId } });
  if (!turno) throw new ErrorHttp(404, "No existe ese turno.");
  if (turno.estado !== "pendiente") throw new ErrorHttp(409, "Este turno ya no está pendiente de confirmación.");

  const confirmado = estado === "confirmado";
  const respondido = await conAviso(
    (tx) => tx.turno.update({ where: { id: turno.id }, data: { estado, respondidoEn: new Date() }, include: INCLUIR_PARA_AVISO }),
    (t) => ({
      usuarioId: t.paciente.usuarioId,
      tipo: confirmado ? "turno_confirmado" : "turno_rechazado",
      titulo: confirmado ? "Turno confirmado" : "Turno rechazado",
      mensaje: confirmado
        ? `${nombreProfesional(t.medico)} confirmó tu turno de ${t.especialidad.nombre} del ${diaYHora(t)}.`
        : `${nombreProfesional(t.medico)} no pudo aceptar tu turno de ${t.especialidad.nombre} del ${diaYHora(t)}. Podés pedir otro desde Reservar.`,
      referenciaTipo: "turno",
      referenciaId: t.id,
    }),
  );
  await registrarAccion({ usuarioId, accion: `turno_${estado}`, entidad: "turno", entidadId: turno.id });

  return aTurno(respondido);
}

// ───────────── Profesional: agenda y pacientes asignados ─────────────

/** Obtiene todos los turnos del profesional con el paciente (y su foto), la sede y la institución. */
export async function agenda(medicoId: string) {
  await vencerTurnos();
  const turnos = await prisma.turno.findMany({
    where: { medicoId },
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

/** Obtiene los pacientes con un turno próximo (pendiente o confirmado) con el profesional. */
export async function pacientesAsignados(medicoId: string) {
  await vencerTurnos();
  const pacientes = await prisma.paciente.findMany({
    where: { turnos: { some: { medicoId, estado: { in: ACTIVOS }, fecha: { gte: hoyArgentina() } } } },
    include: INCLUIR_PACIENTE,
  });
  return pacientes.map(aPaciente);
}
