import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import type { CoberturaAceptada } from "./formato";

// Reglas 1, 15 y 18 (08-coberturas.md): qué instituciones y qué profesionales le aparecen a un paciente según su
// plan. El plan sale siempre del paciente de la sesión, nunca de la query.

/** Una fila de cobertura que incluye el plan: la obra social entera (sin plan) o ese plan puntual. */
const filaQueCubre = (plan: { id: string; obraSocialId: string }) => ({
  obraSocialId: plan.obraSocialId,
  OR: [{ planMedicoId: null }, { planMedicoId: plan.id }],
});

/** Públicas (regla 15) o que aceptan la obra social del paciente, entera o su plan. */
export const institucionVisible = (plan: { id: string; obraSocialId: string }): Prisma.InstitucionWhereInput => ({
  activa: true,
  OR: [{ origen: "publico" }, { coberturas: { some: filaQueCubre(plan) } }],
});

/** El profesional atiende la cobertura del paciente (también en un hospital público). */
export const medicoVisible = (plan: { id: string; obraSocialId: string }): Prisma.MedicoWhereInput => ({
  usuario: { activo: true },
  coberturas: { some: filaQueCubre(plan) },
});

/**
 * Dónde puede atender un profesional según sus coberturas (decidido el 28/10/2026): los públicos siempre (regla 15)
 * y los privados que aceptan alguna de sus coberturas: la misma obra social y, si los dos la limitan a planes,
 * algún plan en común. Sin coberturas, solo los públicos.
 */
export const institucionCompatibleConMedico = (
  coberturas: { obraSocialId: string; planMedicoId: string | null }[],
): Prisma.InstitucionWhereInput => ({
  activa: true,
  OR: [
    { origen: "publico" },
    ...(coberturas.length > 0
      ? [
          {
            coberturas: {
              some: {
                OR: coberturas.map((c) =>
                  c.planMedicoId === null
                    ? { obraSocialId: c.obraSocialId }
                    : { obraSocialId: c.obraSocialId, OR: [{ planMedicoId: null }, { planMedicoId: c.planMedicoId }] },
                ),
              },
            },
          },
        ]
      : []),
  ],
});

/** El plan del paciente de la sesión (con su obra social). */
export async function planDelPaciente(pacienteId: string) {
  const paciente = await prisma.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { plan: true } });
  return paciente.plan;
}

/**
 * Valida un conjunto de coberturas antes de guardarlo: cada obra social existe y aparece una sola vez, y sus
 * planes son de ella. Devuelve las filas a insertar (una por plan, o una sin plan = todos).
 */
export async function filasValidadas(coberturas: CoberturaAceptada[]): Promise<{ obraSocialId: string; planMedicoId: string | null }[]> {
  const ids = coberturas.map((c) => c.obraSocialId);
  if (new Set(ids).size !== ids.length) throw new ErrorHttp(400, "Hay una obra social repetida.");
  const obrasSociales = await prisma.obraSocial.findMany({ where: { id: { in: ids } }, include: { planes: { select: { id: true } } } });
  return coberturas.flatMap(({ obraSocialId, planesIds }): { obraSocialId: string; planMedicoId: string | null }[] => {
    const obraSocial = obrasSociales.find((o) => o.id === obraSocialId);
    if (!obraSocial) throw new ErrorHttp(400, "Una de las obras sociales no existe.");
    if (!planesIds || planesIds.length === 0) return [{ obraSocialId, planMedicoId: null }];
    if (planesIds.some((id) => !obraSocial.planes.some((p) => p.id === id))) {
      throw new ErrorHttp(400, `Uno de los planes elegidos no es de ${obraSocial.nombre}.`);
    }
    return [...new Set(planesIds)].map((planMedicoId) => ({ obraSocialId, planMedicoId }));
  });
}

/** Lee `coberturas` del body: `[{ obraSocialId, planesIds? }]`. */
export function coberturasDelCuerpo(valor: unknown): CoberturaAceptada[] {
  if (!Array.isArray(valor) || valor.length > 100) throw new ErrorHttp(400, 'Falta la lista "coberturas".');
  return valor.map((c: unknown) => {
    if (typeof c !== "object" || c === null || typeof (c as { obraSocialId?: unknown }).obraSocialId !== "string") {
      throw new ErrorHttp(400, "Cobertura inválida.");
    }
    const { obraSocialId, planesIds } = c as { obraSocialId: string; planesIds?: unknown };
    if (planesIds !== undefined && (!Array.isArray(planesIds) || planesIds.some((p) => typeof p !== "string"))) {
      throw new ErrorHttp(400, "Planes inválidos.");
    }
    return { obraSocialId, planesIds: planesIds as string[] | undefined };
  });
}
