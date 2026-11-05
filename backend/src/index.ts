// dotenv carga las variables de backend/.env (PORT, DATABASE_URL, ...).
import "dotenv/config";

import cors from "cors";
import express from "express";

import { limpiarSesionesViejas } from "./auth/sesiones";
import { prisma } from "./db";
import { manejarErrores } from "./middlewares/manejarErrores";
import { rutasAdmin } from "./rutas/admin";
import { rutasAuth } from "./rutas/auth";
import { rutasCatalogos } from "./rutas/catalogos";
import { rutasEstudios } from "./rutas/estudios";
import { parserFoto, rutasFotos } from "./rutas/fotos";
import { rutasInstituciones } from "./rutas/instituciones";
import { rutasMedicos } from "./rutas/medicos";
import { rutasNotificaciones } from "./rutas/notificaciones";
import { rutasPacientes } from "./rutas/pacientes";
import { rutasTurnos } from "./rutas/turnos";

const app = express();
const port = Number(process.env.PORT ?? 3000);

// Primero los middlewares (el orden importa: cors antes de las rutas).
// En el celular (Expo Go) no hay CORS; en web la app llama desde http://localhost:8081.
app.use(cors({ origin: process.env.ORIGEN_PERMITIDO }));

// La foto de perfil pesa más que el límite general: su ruta lee el JSON antes (y el general ya no lo vuelve a leer).
app.use("/api/usuarios/yo/foto", parserFoto);
app.use(express.json({ limit: "100kb" }));

// GET /api/health: confirma que la API está encendida y que llega a la base.
app.get("/api/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use("/api/auth", rutasAuth);
app.use("/api", rutasCatalogos);
app.use("/api/pacientes", rutasPacientes);
app.use("/api/medicos", rutasMedicos);
app.use("/api", rutasInstituciones);
app.use("/api/admin", rutasAdmin);
app.use("/api", rutasFotos);
app.use("/api/turnos", rutasTurnos);
app.use("/api", rutasEstudios);
app.use("/api/notificaciones", rutasNotificaciones);

// Al final: lo que no encontró ruta y los errores.
app.use((_req, res) => {
  res.status(404).json({ error: "No existe esa ruta." });
});
app.use(manejarErrores);

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
  limpiarSesionesViejas().then((n) => n > 0 && console.log(`Se borraron ${n} sesiones vencidas.`));
});
