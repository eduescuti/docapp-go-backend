import type { Prisma } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { ahoraArgentina, diaDeLaSemana, sumarDias } from "../../utils/tiempo";
import { institucionVisible, medicoVisible, planDelPaciente } from "../catalogos/cobertura";

// Disponibilidad: qué horarios libres hay según las franjas de atención de cada
// profesional, y la carga de esas franjas.

/** Los estados que ocupan el horario. */
export const ACTIVOS = ["pendiente", "confirmado"];
const DURACION_TURNO_MIN = 30;
const DIAS_MAXIMOS_CONSULTA = 92;

type Franja = { sedeId: string; diaSemana: number; desde: string; hasta: string };

/** Convierte "HH:mm" en minutos desde las 00:00. */
const aMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** Convierte minutos desde las 00:00 en "HH:mm". */
const aHora = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

/** Calcula los horarios de inicio de turno dentro de la franja: "09:00", "09:30", … */
function horasDeFranja(desde: string, hasta: string): string[] {
  const horas: string[] = [];
  const fin = aMinutos(hasta);
  for (let m = aMinutos(desde); m + DURACION_TURNO_MIN <= fin; m += DURACION_TURNO_MIN) horas.push(aHora(m));
  return horas;
}

/** Indica si la fecha y hora caen en alguna franja del profesional en esa sede. */
export function enFranja(franjas: Franja[], sedeId: string, fecha: string, hora: string): boolean {
  const dia = diaDeLaSemana(fecha);
  return franjas.some((f) => f.sedeId === sedeId && f.diaSemana === dia && horasDeFranja(f.desde, f.hasta).includes(hora));
}

/** Obtiene los profesionales que ve el paciente (o solo `medicoIds`) con sus franjas, y las sedes que ve. */
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

/** Lo que ya está tomado: turnos activos de los profesionales ("medicoId fecha hora") y del paciente ("fecha hora"). */
type Ocupados = { deMedicos: Set<string>; delPaciente: Set<string> };

/**
 * Calcula los horarios libres de un día; si dos franjas de un profesional se pisan, queda la primera. No ofrece los
 * horarios en que el paciente ya tiene otro turno.
 */
function libresDelDia(ctx: Contexto, fecha: string, ocupados: Ocupados, ahora: string) {
  const dia = diaDeLaSemana(fecha);

  return ctx.medicos.flatMap((medico) => {
    const tomadas = new Set<string>();
    return medico.franjas
      .filter((f) => f.diaSemana === dia && ctx.sedesVisibles.has(f.sedeId))
      .flatMap((f) =>
        horasDeFranja(f.desde, f.hasta).flatMap((hora) => {
          const momento = `${fecha} ${hora}`;
          if (tomadas.has(hora) || ocupados.deMedicos.has(`${medico.id} ${momento}`) || ocupados.delPaciente.has(momento) || momento <= ahora) {
            return [];
          }
          tomadas.add(hora);
          return [{ medicoId: medico.id, sedeId: f.sedeId, hora }];
        }),
      );
  });
}

/** Obtiene los turnos activos entre dos fechas de esos profesionales y del paciente. */
async function ocupadosEntre(pacienteId: string, medicoIds: string[], desde: string, hasta: string): Promise<Ocupados> {
  const turnos = await prisma.turno.findMany({
    where: { OR: [{ medicoId: { in: medicoIds } }, { pacienteId }], estado: { in: ACTIVOS }, fecha: { gte: desde, lte: hasta } },
    select: { medicoId: true, pacienteId: true, fecha: true, hora: true },
  });
  return {
    deMedicos: new Set(turnos.map((t) => `${t.medicoId} ${t.fecha} ${t.hora}`)),
    delPaciente: new Set(turnos.filter((t) => t.pacienteId === pacienteId).map((t) => `${t.fecha} ${t.hora}`)),
  };
}

/** Obtiene los horarios libres de ese día para el paciente: `[{ medicoId, sedeId, hora }]`. */
export async function horariosLibres(pacienteId: string, fecha: string, medicoIds?: string[]) {
  const ctx = await contextoDisponibilidad(pacienteId, medicoIds);
  const ocupados = await ocupadosEntre(pacienteId, ctx.medicos.map((m) => m.id), fecha, fecha);
  return libresDelDia(ctx, fecha, ocupados, ahoraArgentina());
}

/** Obtiene los días del rango `[desde, hasta]` con algún horario libre para el paciente. */
export async function diasConTurnos(pacienteId: string, desde: string, hasta: string, medicoIds?: string[]) {
  const ctx = await contextoDisponibilidad(pacienteId, medicoIds);
  const ocupados = await ocupadosEntre(pacienteId, ctx.medicos.map((m) => m.id), desde, hasta);
  const ahora = ahoraArgentina();

  const dias: string[] = [];
  for (let fecha = desde, n = 0; fecha <= hasta && n < DIAS_MAXIMOS_CONSULTA; fecha = sumarDias(fecha, 1), n++) {
    if (libresDelDia(ctx, fecha, ocupados, ahora).length > 0) dias.push(fecha);
  }
  return dias;
}

// ───────────── Franjas del profesional ─────────────

/** Obtiene las franjas del profesional, por día y hora. */
export async function misFranjas(medicoId: string) {
  return prisma.franjaAtencion.findMany({
    where: { medicoId },
    select: { id: true, medicoId: true, sedeId: true, diaSemana: true, desde: true, hasta: true },
    orderBy: [{ diaSemana: "asc" }, { desde: "asc" }],
  });
}

/** Reemplaza las franjas del profesional: cada una en uno de sus lugares y sin pisarse con otra del mismo día. */
export async function guardarFranjas(medicoId: string, usuarioId: string, franjas: Franja[]) {
  const lugares = await prisma.medicoSede.findMany({ where: { medicoId }, select: { sedeId: true } });
  const susLugares = new Set(lugares.map((l) => l.sedeId));
  for (const f of franjas) {
    if (!susLugares.has(f.sedeId)) throw new ErrorHttp(400, "Elegí uno de tus lugares de atención.");
    if (f.desde >= f.hasta) throw new ErrorHttp(400, "La hora de fin tiene que ser posterior a la de inicio.");
  }

  const ordenadas = [...franjas].sort((a, b) => a.diaSemana - b.diaSemana || a.desde.localeCompare(b.desde));
  const anterior = (i: number) => ordenadas[i - 1];
  if (ordenadas.some((f, i) => i > 0 && f.diaSemana === anterior(i).diaSemana && f.desde < anterior(i).hasta)) {
    throw new ErrorHttp(400, "Ese horario se pisa con otro del mismo día. No podés atender en dos lugares a la vez.");
  }

  await prisma.$transaction([
    prisma.franjaAtencion.deleteMany({ where: { medicoId } }),
    prisma.franjaAtencion.createMany({ data: franjas.map((f) => ({ ...f, medicoId })) }),
  ]);
  await registrarAccion({ usuarioId, accion: "franjas_profesional", entidad: "medico", entidadId: medicoId });

  return misFranjas(medicoId);
}
