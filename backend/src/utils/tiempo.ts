// "Hoy" y "ahora" se calculan en la zona de Argentina, no en UTC: un turno de las 22:00 no puede vencer a las
// 19:00 (02-arquitectura.md, "Fechas y horas"). Las fechas de negocio son texto ISO ("2026-10-27", "14:30").

const FORMATO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partes(fecha: Date) {
  const p = FORMATO.formatToParts(fecha);
  const valor = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? "";
  return { dia: `${valor("year")}-${valor("month")}-${valor("day")}`, hora: `${valor("hour")}:${valor("minute")}` };
}

/** "2026-10-27" */
export const hoyArgentina = (): string => partes(new Date()).dia;

/** "2026-10-27 14:30", para comparar con `${fecha} ${hora}` de un turno. */
export function ahoraArgentina(): string {
  const { dia, hora } = partes(new Date());
  return `${dia} ${hora}`;
}

/** Minutos que faltan desde ahora hasta esa fecha y hora argentinas (negativo si ya pasó). Argentina es UTC-3. */
export function minutosHasta(fecha: string, hora: string): number {
  return (Date.parse(`${fecha}T${hora}:00-03:00`) - Date.now()) / 60000;
}

/** 0 = domingo … 6 = sábado, del día "yyyy-MM-dd". */
export const diaDeLaSemana = (fecha: string): number => new Date(`${fecha}T12:00:00Z`).getUTCDay();

/** El día siguiente, "yyyy-MM-dd". */
export const diaSiguiente = (fecha: string): string =>
  new Date(Date.parse(`${fecha}T12:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** "yyyy-MM-dd" válido. */
export const esFecha = (texto: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(Date.parse(`${texto}T00:00:00Z`));

/** "HH:mm" en punto o y media (los turnos son de 30 min). */
export const esHoraDeTurno = (texto: string): boolean => /^([01]\d|2[0-3]):(00|30)$/.test(texto);
