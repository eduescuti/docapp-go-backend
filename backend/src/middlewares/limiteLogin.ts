import { ErrorHttp } from "../errores";

// Fallos de login por DNI y por IP, en memoria: más de 5 en 15 minutos → 429 (05-sesiones-y-tokens.md).
const VENTANA_MS = 15 * 60 * 1000;
const MAXIMO_FALLOS = 5;
const fallos = new Map<string, number[]>();

const recientes = (clave: string, ahora: number) => (fallos.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS);

export function verificarIntentos(dni: string, ip: string): void {
  const ahora = Date.now();
  if (recientes(`dni:${dni}`, ahora).length >= MAXIMO_FALLOS || recientes(`ip:${ip}`, ahora).length >= MAXIMO_FALLOS * 4) {
    throw new ErrorHttp(429, "Demasiados intentos. Probá de nuevo en unos minutos.");
  }
}

export function registrarFallo(dni: string, ip: string): void {
  const ahora = Date.now();
  for (const clave of [`dni:${dni}`, `ip:${ip}`]) fallos.set(clave, [...recientes(clave, ahora), ahora]);
}

/** Un login exitoso borra los fallos de ese DNI. */
export function limpiarFallos(dni: string): void {
  fallos.delete(`dni:${dni}`);
}
