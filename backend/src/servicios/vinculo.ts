import { prisma } from "../db";
import { ErrorHttp } from "../errores";

/**
 * El profesional puede ver la ficha de un paciente, escribirle notas y asignarle órdenes y recetas solo si tiene
 * un turno con él (vínculo por turnos). Si no, 404: no se confirma que ese paciente exista.
 */
export async function exigirVinculo(medicoId: string, pacienteId: string): Promise<void> {
  const turnos = await prisma.turno.count({ where: { medicoId, pacienteId } });
  if (turnos === 0) throw new ErrorHttp(404, "No tenés turnos con ese paciente.");
}
