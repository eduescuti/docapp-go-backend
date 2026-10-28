import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// scrypt es lento a propósito: probar millones de contraseñas cuesta caro (05-sesiones-y-tokens.md).
const scrypt = promisify(scryptCb) as (pass: string, salt: Buffer, largo: number) => Promise<Buffer>;

/** "salt:hash" en hexadecimal. Nunca se guarda la contraseña en texto plano. */
export async function hashearContrasena(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verificarContrasena(password: string, guardado: string): Promise<boolean> {
  const [saltHex, hashHex] = guardado.split(":");
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const hash = await scrypt(password, Buffer.from(saltHex, "hex"), esperado.length);
  return timingSafeEqual(hash, esperado); // compara sin filtrar por cuánto tarda
}
