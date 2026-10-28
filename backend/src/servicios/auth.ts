import { hashearContrasena, verificarContrasena } from "../auth/contrasenas";
import { respuestaDeIngreso, revocarOtrasSesiones } from "../auth/sesiones";
import { registrarAccion } from "../auditoria";
import { prisma } from "../db";
import { ErrorHttp } from "../errores";
import { limpiarFallos, registrarFallo, verificarIntentos } from "../middlewares/limiteLogin";
import { esContrasenaSegura, esDniValido, normalizarDni } from "../validacion";
import { identidadDisponible, leerCodigoDni } from "./identidad";
import { buscarEnRefeps, FichaPadron } from "./refeps";

export interface Origen {
  ip: string;
  dispositivo?: string;
}

const INCLUIR_PERFIL = { paciente: true, medico: true } as const;
const ERROR_CREDENCIALES = "DNI o contraseña incorrectos.";
const ERROR_CUENTA_EXISTENTE = "Ya existe una cuenta con ese DNI. Iniciá sesión.";
const ERROR_CONTRASENA = "La contraseña no cumple los requisitos de seguridad.";

/** Regla 11: login único con DNI + contraseña; el rol lo determina la cuenta. */
export async function iniciarSesion(dniIngresado: string, password: string, origen: Origen) {
  // "admin" no es un DNI: solo se le sacan puntos y espacios a los números.
  const dni = dniIngresado.trim() === "admin" ? "admin" : normalizarDni(dniIngresado);
  verificarIntentos(dni, origen.ip);
  const usuario = await prisma.usuario.findUnique({ where: { dni }, include: INCLUIR_PERFIL });
  // Mismo mensaje para DNI inexistente, contraseña errónea o cuenta desactivada: no revela qué cuentas existen.
  if (!usuario || !usuario.activo || !(await verificarContrasena(password, usuario.passwordHash))) {
    registrarFallo(dni, origen.ip);
    await registrarAccion({ usuarioId: usuario?.id, accion: "login_fallido", detalle: `dni ${dni}`, ip: origen.ip });
    throw new ErrorHttp(401, ERROR_CREDENCIALES);
  }
  limpiarFallos(dni);
  await registrarAccion({ usuarioId: usuario.id, accion: "login", ip: origen.ip });
  return respuestaDeIngreso(usuario, origen);
}

async function dniLibre(dni: string): Promise<void> {
  if (await prisma.usuario.findUnique({ where: { dni } })) throw new ErrorHttp(409, ERROR_CUENTA_EXISTENTE);
}

export interface DatosRegistroPaciente {
  /** Texto del código PDF417 del DNI: de ahí salen el DNI, el nombre y el apellido (no se escriben a mano). */
  codigoDni: string;
  password: string;
  planMedicoId: string;
}

/**
 * Regla 12: DNI (verificado con el código del documento, 28/10/2026), contraseña y plan de una obra social de la
 * app. Nombre y apellido salen del DNI. Entra directo.
 */
export async function registrarPaciente(datos: DatosRegistroPaciente, origen: Origen) {
  const documento = leerCodigoDni(datos.codigoDni);
  if (!esContrasenaSegura(datos.password)) throw new ErrorHttp(400, ERROR_CONTRASENA);
  const plan = await prisma.planMedico.findFirst({ where: { id: datos.planMedicoId, activo: true, obraSocial: { activa: true } } });
  if (!plan) throw new ErrorHttp(400, "Elegí tu obra social y tu plan.");
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

/** Profesiones para el selector del registro: las del padrón local. */
export async function listarProfesiones(): Promise<string[]> {
  const filas = await prisma.profesionalPadron.findMany({ distinct: ["profesion"], select: { profesion: true }, orderBy: { profesion: "asc" } });
  return filas.map((f) => f.profesion);
}

export interface DatosVerificacion {
  dni: string;
  matricula: string;
  profesion: string;
}

const coincideProfesion = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

/**
 * Regla 13: la terna DNI + matrícula + profesión tiene que existir en el padrón nacional con matrícula
 * habilitada. Primero la copia local del padrón (ahí están las fichas de prueba, cuyas matrículas en el REFEPS
 * real son de otras personas); si no está, el REFEPS en línea.
 */
export async function verificarProfesional(datos: DatosVerificacion): Promise<FichaPadron> {
  const dni = normalizarDni(datos.dni);
  const matricula = datos.matricula.trim();
  if (!esDniValido(dni)) throw new ErrorHttp(400, "Ingresá un DNI válido (7 u 8 dígitos).");
  await dniLibre(dni);

  const local = await prisma.profesionalPadron.findMany({ where: { dni, matricula } });
  const fila = local.find((p) => p.profesion.toLowerCase() === datos.profesion.toLowerCase());
  const ficha: FichaPadron | null = fila
    ? (({ id: _id, ...resto }) => ({ ...resto, especializaciones: JSON.parse(resto.especializaciones) as string[] }))(fila)
    : await buscarEnRefeps(dni, matricula, datos.profesion);

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

export interface DatosRegistroProfesional extends DatosVerificacion {
  /** Texto del código PDF417 del DNI: tiene que ser de la misma persona que la ficha del padrón. */
  codigoDni: string;
  password: string;
  genero: "femenino" | "masculino";
  especialidadId: string;
}

/**
 * Crea la cuenta del profesional con los datos del padrón (decidido el 27/10/2026: alcanza con el padrón, sin
 * aprobación del admin). Género y especialidad los elige en el registro; lugares, coberturas y horarios, después.
 */
export async function registrarProfesional(datos: DatosRegistroProfesional, origen: Origen) {
  if (!esContrasenaSegura(datos.password)) throw new ErrorHttp(400, ERROR_CONTRASENA);
  const especialidad = await prisma.especialidad.findUnique({ where: { id: datos.especialidadId } });
  if (!especialidad) throw new ErrorHttp(400, "Elegí tu especialidad.");
  const documento = leerCodigoDni(datos.codigoDni);
  if (documento.dni !== normalizarDni(datos.dni)) throw new ErrorHttp(400, "El DNI escaneado no coincide con el que ingresaste.");
  const ficha = await verificarProfesional(datos);
  // El documento tiene que ser de la persona del padrón: al menos un apellido en común (el padrón y el DNI pueden
  // diferir en tildes o en un segundo apellido).
  const palabras = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (!palabras(ficha.apellido).some((p) => palabras(documento.apellido).includes(p))) {
    throw new ErrorHttp(400, "El DNI escaneado no es de la persona registrada en el padrón.");
  }
  const identidad = await identidadDisponible(documento);
  // Cada especialidad es de una profesión (Res. 1814/2015 y 199/2011): un kinesiólogo no elige "Cardiología".
  if (!coincideProfesion(especialidad.profesion, ficha.profesion)) {
    throw new ErrorHttp(400, `"${especialidad.nombre}" no es una especialidad de tu profesión (${ficha.profesion}).`);
  }
  const dni = normalizarDni(ficha.dni);

  const usuario = await prisma.$transaction(async (tx) => {
    // La ficha queda en la copia local del padrón (si vino del REFEPS en línea todavía no estaba).
    const padron = await tx.profesionalPadron.upsert({
      where: { dni_matricula_profesion: { dni, matricula: ficha.matricula, profesion: ficha.profesion } },
      update: {},
      create: { ...ficha, dni, especializaciones: JSON.stringify(ficha.especializaciones) },
    });
    return tx.usuario.create({
      data: {
        dni,
        passwordHash: await hashearContrasena(datos.password),
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

/** Cambia la contraseña y corta las otras sesiones del usuario (un teléfono perdido deja de entrar). */
export async function cambiarContrasena(usuarioId: string, sesionId: string, actual: string, nueva: string, ip: string): Promise<void> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!(await verificarContrasena(actual, usuario.passwordHash))) throw new ErrorHttp(400, "La contraseña actual no es correcta.");
  if (!esContrasenaSegura(nueva)) throw new ErrorHttp(400, "La nueva contraseña no cumple los requisitos de seguridad.");
  if (nueva === actual) throw new ErrorHttp(400, "La nueva contraseña tiene que ser distinta de la actual.");
  await prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash: await hashearContrasena(nueva) } });
  await revocarOtrasSesiones(usuarioId, sesionId);
  await registrarAccion({ usuarioId, accion: "cambio_contrasena", ip });
}
