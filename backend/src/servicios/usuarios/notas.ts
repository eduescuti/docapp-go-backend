import type { NotaPaciente } from "@prisma/client";

import { prisma } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { fechaHoraArgentina } from "../../utils/tiempo";

// Notas privadas: solo las ve el profesional que las escribió.

/** Convierte una nota al formato `NotaPaciente` del frontend. */
const aNota = (n: NotaPaciente) => ({
  id: n.id,
  medicoId: n.medicoId,
  pacienteId: n.pacienteId,
  fecha: fechaHoraArgentina(n.creadaEn),
  texto: n.texto,
});

/** Exige que el profesional tenga algún turno con el paciente; si no, 404 (no revela que el paciente exista). */
export async function exigirVinculo(medicoId: string, pacienteId: string): Promise<void> {
  const turnos = await prisma.turno.count({ where: { medicoId, pacienteId } });
  if (turnos === 0) throw new ErrorHttp(404, "No tenés turnos con ese paciente.");
}

/** Obtiene las notas del profesional sobre el paciente, de la más nueva a la más vieja. */
export async function notasDelPaciente(medicoId: string, pacienteId: string) {
  await exigirVinculo(medicoId, pacienteId);
  const notas = await prisma.notaPaciente.findMany({ where: { medicoId, pacienteId }, orderBy: { creadaEn: "desc" } });
  return notas.map(aNota);
}

/** Guarda una nota nueva del profesional sobre el paciente. */
export async function crearNota(medicoId: string, pacienteId: string, texto: string) {
  await exigirVinculo(medicoId, pacienteId);
  const limpio = texto.trim();
  if (!limpio) throw new ErrorHttp(400, "La nota no puede estar vacía.");
  return aNota(await prisma.notaPaciente.create({ data: { medicoId, pacienteId, texto: limpio } }));
}
