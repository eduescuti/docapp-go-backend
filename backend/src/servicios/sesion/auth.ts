import type { ProfesionalPadron } from "@prisma/client";

import { prisma, registrarAccion } from "../../utils/db";
import { ErrorHttp } from "../../utils/errores";
import { esContrasenaSegura, esDniValido, normalizarDni } from "../../utils/validacion";
import { exigirPlanActivo } from "../catalogos/cobertura";
import { hashearContrasena, verificarContrasena } from "./contrasenas";
import { identidadDisponible, leerCodigoDni } from "./identidad";
import { buscarEnRefeps, coincideProfesion, FichaPadron } from "./refeps";
import { respuestaDeIngreso, revocarOtrasSesiones, revocarSesion } from "./sesiones";

export interface Origen {
  ip: string;
  dispositivo?: string;
}

export interface DatosVerificacion {
  dni: string;
  matricula: string;
  profesion: string;
}

interface DatosRegistroPaciente {
  /** Texto del código PDF417 del DNI: de ahí salen el DNI, el nombre y el apellido (no se escriben a mano). */
  codigoDni: string;
  password: string;
  planMedicoId: string;
}

interface DatosRegistroProfesional extends DatosVerificacion {
  /** Texto del código PDF417 del DNI: tiene que ser de la misma persona que la ficha del padrón. */
  codigoDni: string;
  password: string;
  genero: "femenino" | "masculino";
  especialidadId: string;
}

const INCLUIR_PERFIL = { paciente: true, medico: true } as const;
const ERROR_CREDENCIALES = "DNI o contraseña incorrectos.";
const ERROR_DNI = "Ingresá un DNI válido (7 u 8 dígitos).";
const ERROR_CUENTA_EXISTENTE = "Ya existe una cuenta con ese DNI. Iniciá sesión.";
const ERROR_CONTRASENA = "La contraseña no cumple los requisitos de seguridad.";

// Fallos de login por DNI y por IP, en memoria: más de 5 en 15 minutos → 429 (05-sesiones-y-tokens.md).
const VENTANA_MS = 15 * 60 * 1000;
const MAXIMO_FALLOS = 5;
const fallos = new Map<string, number[]>();

/** Filtra los fallos de esa clave que siguen dentro de la ventana de tiempo. */
const recientes = (clave: string, ahora: number) => (fallos.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS);

/** Bloquea con 429 si el DNI o la IP superaron el máximo de fallos. */
function verificarIntentos(dni: string, ip: string): void {
  const ahora = Date.now();
  if (recientes(`dni:${dni}`, ahora).length >= MAXIMO_FALLOS || recientes(`ip:${ip}`, ahora).length >= MAXIMO_FALLOS * 4) {
    throw new ErrorHttp(429, "Demasiados intentos. Probá de nuevo en unos minutos.");
  }
}

/** Suma un fallo al DNI y a la IP. */
function registrarFallo(dni: string, ip: string): void {
  const ahora = Date.now();
  for (const clave of [`dni:${dni}`, `ip:${ip}`]) fallos.set(clave, [...recientes(clave, ahora), ahora]);
}

/** Borra los fallos del DNI (tras un login exitoso). */
function limpiarFallos(dni: string): void {
  fallos.delete(`dni:${dni}`);
}

/** Separa un apellido en palabras, sin tildes ni mayúsculas. */
const palabras = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s-]+/).filter(Boolean);

/** Indica si los dos apellidos comparten alguna palabra. */
const mismoApellido = (a: string, b: string) => palabras(a).some((p) => palabras(b).includes(p));

/** Convierte una fila del padrón local en ficha, con las especializaciones como lista. */
function aFicha({ id: _id, especializaciones, ...resto }: ProfesionalPadron): FichaPadron {
  return { ...resto, especializaciones: JSON.parse(especializaciones) as string[] };
}

/** Exige que no haya una cuenta con ese DNI; si la hay, responde 409. */
async function dniLibre(dni: string): Promise<void> {
  if (await prisma.usuario.findUnique({ where: { dni } })) throw new ErrorHttp(409, ERROR_CUENTA_EXISTENTE);
}

/** Inicia sesión con DNI y contraseña; el rol lo determina la cuenta. */
export async function iniciarSesion(dniIngresado: string, password: string, origen: Origen) {
  const dni = normalizarDni(dniIngresado);
  if (!esDniValido(dni)) throw new ErrorHttp(400, ERROR_DNI);
  verificarIntentos(dni, origen.ip);

  const usuario = await prisma.usuario.findUnique({ where: { dni }, include: INCLUIR_PERFIL });
  if (!usuario || !usuario.activo || !(await verificarContrasena(password, usuario.passwordHash))) {
    registrarFallo(dni, origen.ip);
    await registrarAccion({ usuarioId: usuario?.id, accion: "login_fallido", detalle: `dni ${dni}`, ip: origen.ip });
    throw new ErrorHttp(401, ERROR_CREDENCIALES);
  }

  limpiarFallos(dni);
  await registrarAccion({ usuarioId: usuario.id, accion: "login", ip: origen.ip });
  return respuestaDeIngreso(usuario, origen);
}

/** Crea la cuenta del paciente con los datos del DNI escaneado y su plan, y entra directo. */
export async function registrarPaciente(datos: DatosRegistroPaciente, origen: Origen) {
  const documento = leerCodigoDni(datos.codigoDni);
  if (!esContrasenaSegura(datos.password)) throw new ErrorHttp(400, ERROR_CONTRASENA);
  const plan = await exigirPlanActivo(datos.planMedicoId);
  const identidad = await identidadDisponible(documento);

  const usuario = await prisma.usuario.create({
    data: {
      dni: documento.dni,
      passwordHash: await hashearContrasena(datos.password),
      rol: "paciente",
      nombre: documento.nombre,
      apellido: documento.apellido,
      ...identidad,
      paciente: { create: { planMedicoId: plan.id } },
    },
    include: INCLUIR_PERFIL,
  });
  await registrarAccion({ usuarioId: usuario.id, accion: "registro_paciente", detalle: "identidad verificada con el DNI", ip: origen.ip });

  return respuestaDeIngreso(usuario, origen);
}

/** Busca al profesional en el padrón local o en el REFEPS y exige matrícula habilitada de ese DNI y profesión. */
export async function verificarProfesional(datos: DatosVerificacion): Promise<FichaPadron> {
  const dni = normalizarDni(datos.dni);
  const matricula = datos.matricula.trim();
  if (!esDniValido(dni)) throw new ErrorHttp(400, ERROR_DNI);
  await dniLibre(dni);

  const local = await prisma.profesionalPadron.findMany({ where: { dni, matricula } });
  const fila = local.find((p) => p.profesion.toLowerCase() === datos.profesion.toLowerCase());
  const ficha = fila ? aFicha(fila) : await buscarEnRefeps(dni, matricula, datos.profesion);

  if (!ficha) throw new ErrorHttp(404, "No encontramos un profesional con ese DNI, matrícula y profesión en el padrón nacional.");
  if (!coincideProfesion(ficha.profesion, datos.profesion)) {
    throw new ErrorHttp(404, `La matrícula ${matricula} figura registrada como "${ficha.profesion}", no como "${datos.profesion}".`);
  }
  if (normalizarDni(ficha.dni) !== dni) {
    throw new ErrorHttp(404, `La matrícula ${matricula} para la profesión "${ficha.profesion}" no pertenece al DNI ingresado.`);
  }
  if (!ficha.activo || !ficha.estadoMatricula.toLowerCase().startsWith("habilitada")) {
    throw new ErrorHttp(404, `La matrícula figura como "${ficha.estadoMatricula}". No se puede crear la cuenta.`);
  }
  return ficha;
}

/** Crea la cuenta del profesional con los datos del padrón (y guarda la ficha si vino del REFEPS), y entra directo. */
export async function registrarProfesional(datos: DatosRegistroProfesional, origen: Origen) {
  if (!esContrasenaSegura(datos.password)) throw new ErrorHttp(400, ERROR_CONTRASENA);
  const especialidad = await prisma.especialidad.findUnique({ where: { id: datos.especialidadId } });
  if (!especialidad) throw new ErrorHttp(400, "Elegí tu especialidad.");

  const documento = leerCodigoDni(datos.codigoDni);
  if (documento.dni !== normalizarDni(datos.dni)) throw new ErrorHttp(400, "El DNI escaneado no coincide con el que ingresaste.");
  const ficha = await verificarProfesional(datos);
  if (!mismoApellido(ficha.apellido, documento.apellido)) throw new ErrorHttp(400, "El DNI escaneado no es de la persona registrada en el padrón.");

  const identidad = await identidadDisponible(documento);
  if (!coincideProfesion(especialidad.profesion, ficha.profesion)) {
    throw new ErrorHttp(400, `"${especialidad.nombre}" no es una especialidad de tu profesión (${ficha.profesion}).`);
  }

  const dni = normalizarDni(ficha.dni);
  const passwordHash = await hashearContrasena(datos.password);

  const usuario = await prisma.$transaction(async (tx) => {
    const padron = await tx.profesionalPadron.upsert({
      where: { dni_matricula_profesion: { dni, matricula: ficha.matricula, profesion: ficha.profesion } },
      update: {},
      create: { ...ficha, dni, especializaciones: JSON.stringify(ficha.especializaciones) },
    });
    return tx.usuario.create({
      data: {
        dni,
        passwordHash,
        rol: "doctor",
        nombre: ficha.nombre,
        apellido: ficha.apellido,
        ...identidad,
        medico: {
          create: {
            padronId: padron.id,
            matricula: ficha.matricula,
            profesion: ficha.profesion,
            genero: datos.genero,
            especialidadId: datos.especialidadId,
          },
        },
      },
      include: INCLUIR_PERFIL,
    });
  });
  await registrarAccion({ usuarioId: usuario.id, accion: "registro_profesional", detalle: "identidad verificada con el DNI", ip: origen.ip });

  return respuestaDeIngreso(usuario, origen);
}

/** Cambia la contraseña y cierra las otras sesiones del usuario. */
export async function cambiarContrasena(usuarioId: string, sesionId: string, actual: string, nueva: string, ip: string): Promise<void> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!(await verificarContrasena(actual, usuario.passwordHash))) throw new ErrorHttp(400, "La contraseña actual no es correcta.");
  if (!esContrasenaSegura(nueva)) throw new ErrorHttp(400, "La nueva contraseña no cumple los requisitos de seguridad.");
  if (nueva === actual) throw new ErrorHttp(400, "La nueva contraseña tiene que ser distinta de la actual.");

  await prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash: await hashearContrasena(nueva) } });
  await revocarOtrasSesiones(usuarioId, sesionId);
  await registrarAccion({ usuarioId, accion: "cambio_contrasena", ip });
}

/** Cierra la sesión (la revoca) y lo registra. */
export async function cerrarSesion(sesionId: string, usuarioId: string, ip?: string): Promise<void> {
  await revocarSesion(sesionId);
  await registrarAccion({ usuarioId, accion: "logout", ip });
}
