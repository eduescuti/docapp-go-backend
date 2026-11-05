import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { exigirPlanActivo } from "../catalogos/cobertura";
import { aPaciente, INCLUIR_PACIENTE } from "../formato";

// El paciente de la sesión: sus datos, su cobertura y sus favoritos. Todo devuelve el paciente actualizado.

/** Obtiene el paciente con su plan y sus favoritos. */
export async function obtenerPaciente(id: string) {
  return aPaciente(await prisma.paciente.findUniqueOrThrow({ where: { id }, include: INCLUIR_PACIENTE }));
}

/** Cambia el plan del paciente (lo que ve en toda la app). */
export async function cambiarPlan(id: string, usuarioId: string, planMedicoId: string) {
  await exigirPlanActivo(planMedicoId);
  await prisma.paciente.update({ where: { id }, data: { planMedicoId } });
  await registrarAccion({ usuarioId, accion: "cambio_cobertura", entidad: "paciente", entidadId: id, detalle: planMedicoId });
  return obtenerPaciente(id);
}

/** Agrega un profesional a los favoritos del paciente. */
export async function marcarMedicoFavorito(pacienteId: string, medicoId: string) {
  if ((await prisma.medico.count({ where: { id: medicoId } })) === 0) throw new ErrorHttp(404, "No existe ese profesional.");

  await prisma.pacienteMedicoFavorito.upsert({
    where: { pacienteId_medicoId: { pacienteId, medicoId } },
    update: {},
    create: { pacienteId, medicoId },
  });
  return obtenerPaciente(pacienteId);
}

/** Saca un profesional de los favoritos del paciente. */
export async function quitarMedicoFavorito(pacienteId: string, medicoId: string) {
  await prisma.pacienteMedicoFavorito.deleteMany({ where: { pacienteId, medicoId } });
  return obtenerPaciente(pacienteId);
}

/** Agrega una institución a los favoritos del paciente. */
export async function marcarInstitucionFavorita(pacienteId: string, institucionId: string) {
  if ((await prisma.institucion.count({ where: { id: institucionId } })) === 0) throw new ErrorHttp(404, "No existe esa institución.");

  await prisma.pacienteInstitucionFavorita.upsert({
    where: { pacienteId_institucionId: { pacienteId, institucionId } },
    update: {},
    create: { pacienteId, institucionId },
  });
  return obtenerPaciente(pacienteId);
}

/** Saca una institución de los favoritos del paciente. */
export async function quitarInstitucionFavorita(pacienteId: string, institucionId: string) {
  await prisma.pacienteInstitucionFavorita.deleteMany({ where: { pacienteId, institucionId } });
  return obtenerPaciente(pacienteId);
}
