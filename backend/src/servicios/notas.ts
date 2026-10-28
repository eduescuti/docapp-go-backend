import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { exigirVinculo } from "./vinculo";

// Notas privadas: solo las ve el profesional que las escribió (reglas 7 y 8).

function fechaHora(fecha: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

const aNota = (n: { id: string; medicoId: string; pacienteId: string; texto: string; creadaEn: Date }) => ({
  id: n.id,
  medicoId: n.medicoId,
  pacienteId: n.pacienteId,
  fecha: fechaHora(n.creadaEn),
  texto: n.texto,
});

export async function notasDelPaciente(medicoId: string, pacienteId: string) {
  await exigirVinculo(medicoId, pacienteId);
  return (await prisma.notaPaciente.findMany({ where: { medicoId, pacienteId }, orderBy: { creadaEn: "desc" } })).map(aNota);
}

export async function crearNota(medicoId: string, pacienteId: string, texto: string) {
  await exigirVinculo(medicoId, pacienteId);
  if (!texto.trim()) throw new ErrorHttp(400, "La nota no puede estar vacía.");
  return aNota(await prisma.notaPaciente.create({ data: { medicoId, pacienteId, texto: texto.trim() } }));
}
