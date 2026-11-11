import type { Prisma } from "@prisma/client";

import { prisma } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import type { CoberturaAceptada, FilaCobertura } from "../formato";

// Coberturas: qué instituciones y qué profesionales le aparecen a un paciente según su plan. El
// plan sale siempre del paciente de la sesión, nunca de la query.

type Plan = { id: string; obraSocialId: string };

/** Arma el filtro de las filas de cobertura que incluyen el plan: la obra social entera o ese plan. */
const filaQueCubre = (plan: Plan) => ({
  obraSocialId: plan.obraSocialId,
  OR: [{ planMedicoId: null }, { planMedicoId: plan.id }],
});

/** Arma el filtro de las instituciones que ve el paciente: públicas o que aceptan su plan. */
export const institucionVisible = (plan: Plan): Prisma.InstitucionWhereInput => ({
  activa: true,
  OR: [{ origen: "publico" }, { coberturas: { some: filaQueCubre(plan) } }],
});

/** Arma el filtro de los profesionales activos que atienden el plan del paciente. */
export const medicoVisible = (plan: Plan): Prisma.MedicoWhereInput => ({
  usuario: { activo: true },
  coberturas: { some: filaQueCubre(plan) },
});

/** Arma el filtro de los lugares donde puede atender el profesional: públicos o que aceptan alguna de sus coberturas. */
export function institucionCompatibleConMedico(coberturas: FilaCobertura[]): Prisma.InstitucionWhereInput {
  const opciones: Prisma.InstitucionWhereInput[] = [{ origen: "publico" }];

  if (coberturas.length > 0) {
    const algunaCobertura = coberturas.map(({ obraSocialId, planMedicoId }) =>
      planMedicoId === null ? { obraSocialId } : filaQueCubre({ id: planMedicoId, obraSocialId }),
    );
    opciones.push({ coberturas: { some: { OR: algunaCobertura } } });
  }

  return { activa: true, OR: opciones };
}

/** Obtiene el plan del paciente, con su obra social. */
export async function planDelPaciente(pacienteId: string) {
  const { plan } = await prisma.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { plan: true } });
  return plan;
}

/** Obtiene el plan si está activo y su obra social también; si no, responde 400. */
export async function exigirPlanActivo(planMedicoId: string) {
  const plan = await prisma.planMedico.findFirst({ where: { id: planMedicoId, activo: true, obraSocial: { activa: true } } });
  if (!plan) throw new ErrorHttp(400, "Elegí tu obra social y tu plan.");
  return plan;
}

/** Valida las coberturas y devuelve las filas a guardar (una por plan, o una sin plan = todos). */
export async function filasValidadas(coberturas: CoberturaAceptada[]): Promise<FilaCobertura[]> {
  const ids = coberturas.map((c) => c.obraSocialId);
  if (new Set(ids).size !== ids.length) throw new ErrorHttp(400, "Hay una obra social repetida.");

  const obrasSociales = await prisma.obraSocial.findMany({ where: { id: { in: ids } }, include: { planes: { select: { id: true } } } });

  return coberturas.flatMap(({ obraSocialId, planesIds }): FilaCobertura[] => {
    const obraSocial = obrasSociales.find((o) => o.id === obraSocialId);
    if (!obraSocial) throw new ErrorHttp(400, "Una de las obras sociales no existe.");
    if (!planesIds || planesIds.length === 0) return [{ obraSocialId, planMedicoId: null }];

    if (planesIds.some((id) => !obraSocial.planes.some((p) => p.id === id))) {
      throw new ErrorHttp(400, `Uno de los planes elegidos no es de ${obraSocial.nombre}.`);
    }
    return [...new Set(planesIds)].map((planMedicoId) => ({ obraSocialId, planMedicoId }));
  });
}

/** Lee la lista `coberturas` del body: `[{ obraSocialId, planesIds? }]`. */
export function coberturasDelCuerpo(valor: unknown): CoberturaAceptada[] {
  if (!Array.isArray(valor) || valor.length > 100) throw new ErrorHttp(400, 'Falta la lista "coberturas".');

  return valor.map((c: unknown) => {
    const { obraSocialId, planesIds } = (typeof c === "object" && c !== null ? c : {}) as { obraSocialId?: unknown; planesIds?: unknown };
    if (typeof obraSocialId !== "string") throw new ErrorHttp(400, "Cobertura inválida.");

    if (planesIds !== undefined && (!Array.isArray(planesIds) || planesIds.some((p) => typeof p !== "string"))) {
      throw new ErrorHttp(400, "Planes inválidos.");
    }
    return { obraSocialId, planesIds: planesIds as string[] | undefined };
  });
}
