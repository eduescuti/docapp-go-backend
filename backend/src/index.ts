// dotenv carga las variables de backend/.env (PORT, DATABASE_URL, ...).
import "dotenv/config";
import cors from "cors";
import express from "express";
import { api } from "./rutas";
import { parserFoto } from "./rutas/fotos";
import { limpiarSesionesViejas } from "./servicios/sesion/sesiones";
import { manejarErrores } from "./utils/errores";

const app = express();
const port = Number(process.env.PORT ?? 3000);

// Esto es solo para poder usarlo en web (en mobile no necesita cors porque lo uso en Expo Go).
app.use(cors({ origin: process.env.ORIGEN_PERMITIDO }));

// La foto de perfil pesa más que el límite general: su ruta lee el JSON antes (y el general ya no lo vuelve a leer).
app.use("/api/usuarios/yo/foto", parserFoto);
app.use(express.json({ limit: "100kb" }));

// Todas las rutas: el mapa está en rutas/index.ts.
app.use("/api", api);

// Al final: lo que no encontró ruta y los errores.
app.use((_req, res) => {
  res.status(404).json({ error: "No existe esa ruta." });
});
app.use(manejarErrores);

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
  limpiarSesionesViejas().then((n) => n > 0 && console.log(`Se borraron ${n} sesiones vencidas.`));
});
