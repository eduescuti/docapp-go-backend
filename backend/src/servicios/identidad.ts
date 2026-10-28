import { createHmac } from "node:crypto";

import { prisma } from "../db";
import { ErrorHttp } from "../errores";

// Verificación de identidad del registro (decidido el 28/10/2026): el paciente y el profesional escanean con la
// cámara el código PDF417 de su DNI. El código lo imprime el RENAPER y trae número de trámite, apellido, nombres,
// sexo, DNI, ejemplar y fechas.
//
// Qué asegura: que el DNI de la cuenta es el de un documento que la persona tiene en la mano (o una foto de él), y
// que un mismo documento no abre dos cuentas. Qué NO asegura: que quien lo sostiene sea el titular, ni que el
// código no esté armado a mano (eso solo se puede confirmar contra el RENAPER, que pide convenio con el Estado o un
// proveedor de validación de identidad).
//
// Qué se guarda: solo la fecha de verificación y un HMAC-SHA256 del número de trámite (con SECRETO_IDENTIDAD, que
// vive solo en el .env del servidor). Ni la imagen, ni el contenido del código, ni el trámite en claro: con la base
// sola no se puede recuperar el trámite (con un SHA-256 común sí, probando los 10^11 posibles).

export interface DatosDni {
  dni: string;
  /** Como en el DNI, con mayúsculas iniciales ("Pérez García"). */
  apellido: string;
  nombre: string;
  sexo: "M" | "F" | "X";
  /** "dd/mm/aaaa" */
  nacimiento: string;
  /** Número de trámite: identifica al ejemplar físico del DNI. Nunca sale del servidor ni se guarda en claro. */
  tramite: string;
}

const ERROR_LECTURA = "No pudimos leer tu DNI. Escaneá el código de barras del frente de tu DNI tarjeta (el que tiene tu foto).";
const LARGO_MAXIMO_CODIGO = 1000;

const esFecha = (texto: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(texto);
const esNombre = (texto: string) => /^[\p{L} '\-.]{1,80}$/u.test(texto);

/** "PÉREZ GARCÍA" → "Pérez García". */
const conMayusculaInicial = (texto: string) =>
  texto
    .trim()
    .toLocaleLowerCase("es-AR")
    .replace(/(^|[\s'-])(\p{L})/gu, (_, separador: string, letra: string) => separador + letra.toLocaleUpperCase("es-AR"));

/**
 * Lee el texto del código PDF417 del DNI. Hay dos formatos:
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

/** HMAC del número de trámite con el secreto del servidor. */
function hashTramite(tramite: string): string {
  const secreto = process.env.SECRETO_IDENTIDAD ?? "";
  if (secreto.length < 32) throw new ErrorHttp(500, "El servidor no tiene configurada la verificación de identidad.");
  return createHmac("sha256", secreto).update(`tramite:${tramite}`).digest("hex");
}

/**
 * Revisa que el DNI escaneado no tenga cuenta (ni por el número de DNI ni por el ejemplar físico) y devuelve los
 * campos que se guardan en `usuarios`.
 */
export async function identidadDisponible(datos: DatosDni): Promise<{ identidadVerificadaEl: Date; tramiteHash: string }> {
  const tramiteHash = hashTramite(datos.tramite);
  const existente = await prisma.usuario.findFirst({ where: { OR: [{ dni: datos.dni }, { tramiteHash }] }, select: { id: true } });
  if (existente) throw new ErrorHttp(409, "Ya existe una cuenta con ese DNI. Iniciá sesión.");
  return { identidadVerificadaEl: new Date(), tramiteHash };
}

/** Lo que vuelve a la app al escanear: lo justo para completar el formulario (sin trámite ni fechas). */
export const datosPublicos = (datos: DatosDni) => ({ dni: datos.dni, nombre: datos.nombre, apellido: datos.apellido });
