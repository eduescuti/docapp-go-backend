import type { Feedback, Turno } from "@prisma/client";

import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { aTurno, vencerTurnos } from "./turnos";

// Feedback (regla 6): solo de un turno completado, del paciente dueño, una vez por turno. Solo "¿Cómo fue tu
// consulta?" (estrellas) es obligatoria; los criterios son opcionales (28/10/2026). Todo de 1 a 5. La valoración
// de cada profesional se calcula de las estrellas (sin los ocultos por moderación).

const CRITERIOS = ["puntualidad", "atencion", "trato", "claridadExplicacion", "experienciaGeneral"] as const;
type Criterios = Partial<Record<(typeof CRITERIOS)[number], number>>;

/** Como `Feedback` del frontend. */
function aFeedback(f: Feedback & { turno: Turno }) {
  return {
    id: f.id,
    turnoId: f.turnoId,
    pacienteId: f.turno.pacienteId,
    medicoId: f.turno.medicoId,
    estrellas: f.estrellas,
    ...(f.comentario ? { comentario: f.comentario } : {}),
    // Los criterios que no calificó no viajan (en el frontend son opcionales).
    criterios: Object.fromEntries(CRITERIOS.map((c) => [c, f[c]]).filter(([, v]) => v !== null)) as Criterios,
    fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(f.creadoEn),
  };
}

/** Turnos completados del paciente que todavía no calificó, del más reciente al más viejo. */
export async function pendientes(pacienteId: string) {
  await vencerTurnos();
  const turnos = await prisma.turno.findMany({
    where: { pacienteId, estado: "completado", feedback: null },
    orderBy: [{ fecha: "desc" }, { hora: "desc" }],
  });
  return turnos.map(aTurno);
}

export async function enviados(pacienteId: string) {
  const feedbacks = await prisma.feedback.findMany({ where: { turno: { pacienteId } }, include: { turno: true }, orderBy: { creadoEn: "desc" } });
  return feedbacks.map(aFeedback);
}

export interface DatosFeedback {
  estrellas: number;
  criterios: Criterios;
  comentario?: string;
}

export const esCalificacion = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;
export const CRITERIOS_FEEDBACK = CRITERIOS;

export async function calificar(pacienteId: string, usuarioId: string, turnoId: string, datos: DatosFeedback) {
  await vencerTurnos();
  const turno = await prisma.turno.findFirst({ where: { id: turnoId, pacienteId }, include: { feedback: true } });
  if (!turno) throw new ErrorHttp(404, "No existe ese turno.");
  if (turno.estado !== "completado") throw new ErrorHttp(400, "Solo podés calificar turnos cumplidos.");
  if (turno.feedback) throw new ErrorHttp(409, "Ya calificaste este turno.");
  const feedback = await prisma.feedback.create({
    data: { turnoId, estrellas: datos.estrellas, ...datos.criterios, comentario: datos.comentario?.trim() || null },
    include: { turno: true },
  });
  await registrarAccion({ usuarioId, accion: "feedback", entidad: "turno", entidadId: turnoId });
  return aFeedback(feedback);
}
