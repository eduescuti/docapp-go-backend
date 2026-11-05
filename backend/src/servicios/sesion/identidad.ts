import { createHmac } from "node:crypto";

import { prisma } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";

// Se escanea el PDF417 del DNI para que un documento no abra dos cuentas (no prueba que sea
// el titular: eso pide el RENAPER). Se guarda solo la fecha y un HMAC del número de trámite con SECRETO_IDENTIDAD.

interface DatosDni {
  dni: string;
  apellido: string;
  nombre: string;
  sexo: "M" | "F" | "X";
  nacimiento: string;
  tramite: string;
}

const ERROR_LECTURA = "No pudimos leer tu DNI. Escaneá el código de barras del frente de tu DNI tarjeta (el que tiene tu foto).";
const LARGO_MAXIMO_CODIGO = 1000;

/** Indica si el texto es una fecha "dd/mm/aaaa". */
const esFecha = (texto: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(texto);

/** Indica si el texto es un nombre o apellido válido. */
const esNombre = (texto: string) => /^[\p{L} '\-.]{1,80}$/u.test(texto);

/** Pone en mayúscula la inicial de cada palabra: "PÉREZ GARCÍA" → "Pérez García". */
const conMayusculaInicial = (texto: string) =>
  texto
    .trim()
    .toLocaleLowerCase("es-AR")
    .replace(/(^|[\s'-])(\p{L})/gu, (_, separador: string, letra: string) => separador + letra.toLocaleUpperCase("es-AR"));

/**
 * Lee y valida el texto del código PDF417 del DNI. Hay dos formatos:
 *  - DNI tarjeta (desde 2012, código en el frente):
 *    `trámite@APELLIDO@NOMBRES@sexo@DNI@ejemplar@nacimiento@emisión@...`
 *  - DNI tarjeta 2009–2012 (código en el dorso, empieza con @):
 *    `@DNI@ejemplar@...@APELLIDO@NOMBRES@nacionalidad@nacimiento@sexo@emisión@trámite@...`
 */
export function leerCodigoDni(codigo: string): DatosDni {
  const texto = codigo.trim();
  if (!texto || texto.length > LARGO_MAXIMO_CODIGO) throw new ErrorHttp(400, ERROR_LECTURA);

  const p = texto.split("@").map((parte) => parte.trim());
  let datos: { tramite: string; apellido: string; nombres: string; sexo: string; dni: string; nacimiento: string };
  if (texto.startsWith("@") && p.length >= 11) {
    datos = { dni: p[1], apellido: p[4], nombres: p[5], nacimiento: p[7], sexo: p[8], tramite: p[10] };
  } else if (p.length >= 8) {
    datos = { tramite: p[0], apellido: p[1], nombres: p[2], sexo: p[3], dni: p[4], nacimiento: p[6] };
  } else {
    throw new ErrorHttp(400, ERROR_LECTURA);
  }

  const sexo = datos.sexo.toUpperCase();
  if (
    !/^\d{7,8}$/.test(datos.dni) ||
    !/^\d{9,15}$/.test(datos.tramite) ||
    !esNombre(datos.apellido) ||
    !esNombre(datos.nombres) ||
    !esFecha(datos.nacimiento) ||
    (sexo !== "M" && sexo !== "F" && sexo !== "X")
  ) {
    throw new ErrorHttp(400, ERROR_LECTURA);
  }

  return {
    dni: datos.dni,
    apellido: conMayusculaInicial(datos.apellido),
    nombre: conMayusculaInicial(datos.nombres),
    sexo,
    nacimiento: datos.nacimiento,
    tramite: datos.tramite,
  };
}

/** Calcula el HMAC del número de trámite con el secreto del servidor. */
function hashTramite(tramite: string): string {
  const secreto = process.env.SECRETO_IDENTIDAD ?? "";
  if (secreto.length < 32) throw new ErrorHttp(500, "El servidor no tiene configurada la verificación de identidad.");
  return createHmac("sha256", secreto).update(`tramite:${tramite}`).digest("hex");
}

/** Exige que el DNI escaneado no tenga cuenta y devuelve los datos de identidad que se guardan en `usuarios`. */
export async function identidadDisponible(datos: DatosDni): Promise<{ identidadVerificadaEl: Date; tramiteHash: string }> {
  const tramiteHash = hashTramite(datos.tramite);
  const existente = await prisma.usuario.findFirst({ where: { OR: [{ dni: datos.dni }, { tramiteHash }] }, select: { id: true } });
  if (existente) throw new ErrorHttp(409, "Ya existe una cuenta con ese DNI. Iniciá sesión.");
  return { identidadVerificadaEl: new Date(), tramiteHash };
}

/** Elige los datos que vuelven a la app al escanear: lo justo para completar el formulario. */
export const datosPublicos = (datos: DatosDni) => ({ dni: datos.dni, nombre: datos.nombre, apellido: datos.apellido });
