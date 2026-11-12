import { ErrorHttp } from "./errores";

// Que un dato tenga la forma correcta es tarea de la ruta; que tenga sentido, del servicio.

/** Valida que el body esté como un objeto JSON (express.json deja `undefined` si no vino nada). */
export function cuerpo(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ErrorHttp(400, "Faltan los datos del pedido.");
  return body as Record<string, unknown>;
}

/** Valida que el campo del body sea un string válido.
 * 
 * @param datos El objeto JSON que contiene los datos (p. ej. `req.body`).
 * @param campo El nombre del campo a validar.
*/
export function texto(datos: Record<string, unknown>, campo: string, max = 200): string {
  const valor = datos[campo];
  if (typeof valor !== "string" || !valor.trim()) throw new ErrorHttp(400, `Falta el campo "${campo}".`);
  if (valor.length > max) throw new ErrorHttp(400, `El campo "${campo}" es demasiado largo.`);
  return valor.trim();
}

/** Igual que `texto`, pero puede faltar (devuelve `undefined`). */
export function textoOpcional(datos: Record<string, unknown>, campo: string, max = 200): string | undefined {
  return datos[campo] === undefined || datos[campo] === null || datos[campo] === "" ? undefined : texto(datos, campo, max);
}

/** Devuelve un array si el valor es un texto separado por comas. Ej. "a, b, c" → ["a", "b", "c"] */
export function listaDeQuery(valor: unknown, maximo: number): string[] | undefined {
  if (typeof valor !== "string" || !valor.trim()) return undefined;
  return valor.split(",").map((v) => v.trim()).filter(Boolean).slice(0, maximo);
}

/** Devuelve una contraseña tal cual la escribió (sin recortar espacios). */
export function contrasena(datos: Record<string, unknown>, campo: string): string {
  const valor = datos[campo];
  if (typeof valor !== "string" || !valor) throw new ErrorHttp(400, `Falta el campo "${campo}".`);
  if (valor.length > 200) throw new ErrorHttp(400, "La contraseña es demasiado larga.");
  return valor;
}

/** Saca puntos y espacios: "12.345.678" -> "12345678" (como el frontend). */
export const normalizarDni = (dni: string) => dni.replace(/[.\s]/g, "");

/** DNI argentino: 7 u 8 dígitos. */
export const esDniValido = (dni: string) => /^\d{7,8}$/.test(normalizarDni(dni));

/** Regla de contraseña: 8 caracteres, una mayúscula, un número y un carácter especial (igual que `validation.ts` del frontend). */
export function esContrasenaSegura(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-ZÁÉÍÓÚÑ]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ\s]/.test(password)
  );
}
