import type { Feedback, Turno } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { fechaArgentina } from "../../utils/tiempo";
import { aTurno, vencerTurnos } from "./turnos";

// Feedback: solo de un turno completado, del paciente dueño, una vez por turno. Solo "¿Cómo fue tu
// consulta?" (estrellas) es obligatoria; los criterios son opcionales (28/10/2026). Todo de 1 a 5. La valoración
// de cada profesional se calcula de las estrellas (sin los ocultos por moderación).

export const CRITERIOS_FEEDBACK = ["puntualidad", "atencion", "trato", "claridadExplicacion", "experienciaGeneral"] as const;
type Criterios = Partial<Record<(typeof CRITERIOS_FEEDBACK)[number], number>>;

export interface DatosFeedback {
  estrellas: number;
  criterios: Criterios;
  comentario?: string;
}

/** Indica si es un entero de 1 a 5. */
export const esCalificacion = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;

/** Convierte un feedback al formato `Feedback` del frontend, sin los criterios que no calificó. */
function aFeedback(f: Feedback & { turno: Turno }) {
  return {
    id: f.id,
    turnoId: f.turnoId,
    pacienteId: f.turno.pacienteId,
    medicoId: f.turno.medicoId,
    estrellas: f.estrellas,
    ...(f.comentario ? { comentario: f.comentario } : {}),
    criterios: Object.fromEntries(CRITERIOS_FEEDBACK.map((c) => [c, f[c]]).filter(([, v]) => v !== null)) as Criterios,
    fecha: fechaArgentina(f.creadoEn),
  };
}

/** Obtiene los turnos completados del paciente que todavía no calificó, del más reciente al más viejo. */
export async function pendientes(pacienteId: string) {
  await vencerTurnos();
  const turnos = await prisma.turno.findMany({
    where: { pacienteId, estado: "completado", feedback: null },
    orderBy: [{ fecha: "desc" }, { hora: "desc" }],
  });
  return turnos.map(aTurno);
}

/** Obtiene las opiniones que dejó el paciente, de la más nueva a la más vieja. */
export async function enviados(pacienteId: string) {
  const feedbacks = await prisma.feedback.findMany({ where: { turno: { pacienteId } }, include: { turno: true }, orderBy: { creadoEn: "desc" } });
  return feedbacks.map(aFeedback);
}

/** Califica un turno completado del paciente, una sola vez. */
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
