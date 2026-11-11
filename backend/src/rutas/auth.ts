import { Router, type Request } from "express";

import { autenticar, usuarioDe } from "../middlewares/autenticar";
import * as servicio from "../servicios/sesion/auth";
import { datosPublicos, identidadDisponible, leerCodigoDni } from "../servicios/sesion/identidad";
import { sesionActual } from "../servicios/sesion/sesiones";
import { ErrorHttp } from "../utils/errores";
import { contrasena, cuerpo, texto } from "../utils/validacion";

export const auth = Router();

/** IP y dispositivo del pedido, para la sesión y el registro de auditoría. */
const origenDe = (req: Request): servicio.Origen => ({ ip: req.ip ?? "", dispositivo: req.get("user-agent")?.slice(0, 200) });

// POST /api/auth/login { dni, password } → { token, expiraEn, sesion }
auth.post("/login", async (req, res) => {
  const datos = cuerpo(req.body);
  res.json(await servicio.iniciarSesion(texto(datos, "dni", 20), contrasena(datos, "password"), origenDe(req)));
});

// GET /api/auth/sesion → la sesión con la forma de `Sesion` del frontend (valida el token guardado en el teléfono).
auth.get("/sesion", autenticar, async (req, res) => {
  res.json(await sesionActual(usuarioDe(req), req.sesionId!));
});

// POST /api/auth/logout → 204 (revoca el token)
auth.post("/logout", autenticar, async (req, res) => {
  await servicio.cerrarSesion(req.sesionId!, usuarioDe(req).id, req.ip);
  res.status(204).end();
});

// PATCH /api/auth/contrasena { actual, nueva } → 204 (corta las otras sesiones)
auth.patch("/contrasena", autenticar, async (req, res) => {
  const datos = cuerpo(req.body);
  await servicio.cambiarContrasena(usuarioDe(req).id, req.sesionId!, contrasena(datos, "actual"), contrasena(datos, "nueva"), req.ip ?? "");
  res.status(204).end();
});

// POST /api/auth/registro/dni { codigo } → { dni, nombre, apellido }. Lee el código PDF417 del DNI escaneado
// en el registro y avisa si ya tiene cuenta. No guarda nada: el código se vuelve a mandar al crear la cuenta.
auth.post("/registro/dni", async (req, res) => {
  const documento = leerCodigoDni(texto(cuerpo(req.body), "codigo", 1000));
  await identidadDisponible(documento);
  res.json(datosPublicos(documento));
});

// POST /api/auth/registro/paciente { codigoDni, password, planMedicoId } → 201 { token, expiraEn, sesion }
// (DNI, nombre y apellido salen del código del DNI).
auth.post("/registro/paciente", async (req, res) => {
  const datos = cuerpo(req.body);
  const respuesta = await servicio.registrarPaciente(
    {
      codigoDni: texto(datos, "codigoDni", 1000),
      password: contrasena(datos, "password"),
      planMedicoId: texto(datos, "planMedicoId", 80),
    },
    origenDe(req),
  );
  res.status(201).json(respuesta);
});

const datosVerificacion = (datos: Record<string, unknown>): servicio.DatosVerificacion => ({
  dni: texto(datos, "dni", 20),
  matricula: texto(datos, "matricula", 30),
  profesion: texto(datos, "profesion", 80),
});

// POST /api/auth/registro/profesional/verificacion { dni, matricula, profesion } → ficha del padrón. Es POST y no
// GET para que el DNI y la matrícula viajen en el cuerpo y no queden en la URL (ni en los registros del servidor).
auth.post("/registro/profesional/verificacion", async (req, res) => {
  res.json(await servicio.verificarProfesional(datosVerificacion(cuerpo(req.body))));
});

// POST /api/auth/registro/profesional { codigoDni, dni, matricula, profesion, password, genero, especialidadId } → 201
auth.post("/registro/profesional", async (req, res) => {
  const datos = cuerpo(req.body);
  const genero = texto(datos, "genero", 20);
  if (genero !== "femenino" && genero !== "masculino") throw new ErrorHttp(400, "Elegí tu género.");
  const respuesta = await servicio.registrarProfesional(
    {
      ...datosVerificacion(datos),
      codigoDni: texto(datos, "codigoDni", 1000),
      password: contrasena(datos, "password"),
      genero,
      especialidadId: texto(datos, "especialidadId", 80),
    },
    origenDe(req),
  );
  res.status(201).json(respuesta);
});
