# Arquitectura del backend

> **27/10/2026:** el servidor pasa de `node:http` a **Express**, con la misma estructura que la práctica
> de la cátedra (`Practica17926` y el PDF *Práctica Prisma — Express + Prisma + SQLite + Expo*). Las notas
> del Sprint 2 dicen "backend propio, sin framework": se interpreta como que el backend lo hace el equipo
> (sin servicios armados tipo Firebase o Supabase) y que todo lo que Express no trae (sesiones, roles,
> validación, reglas de negocio) se resuelve a mano. Express está en la teoría de la cátedra: **uso confirmado**.

## Stack

| Capa | Con qué | Por qué |
|---|---|---|
| Servidor HTTP | **Express 5** | Es lo que usa la práctica de la cátedra. Resuelve el router, el body JSON y los middlewares; lo demás es nuestro. Express 5 manda solo al manejador de errores lo que tira una ruta `async`. |
| Lenguaje | TypeScript (`strict: true`) | Igual que el frontend. Los tipos de la API salen de los mismos nombres que `src/domain/`. |
| Acceso a datos | **Prisma 6** (`prisma` + `@prisma/client`, la misma versión que la práctica) | Schema tipado y cliente generado. Las tablas se crean con `prisma migrate` (no con un `initDb` a mano como en la práctica: son 26 tablas y no se mantienen dos veces). |
| Base de datos | SQLite (`prisma/dev.db`) | Sin servidor aparte, alcanza para el TP. Si después se pasa a PostgreSQL, cambia el `provider` del schema y no la app. |
| CORS y `.env` | `cors`, `dotenv` | Como en la práctica. |
| Criptografía | `node:crypto` | `scrypt` para contraseñas, `randomBytes` para tokens, `createHash` para guardarlos hasheados. Sin `bcrypt` ni `jsonwebtoken`. |

Dependencias: `express`, `cors`, `dotenv`, `@prisma/client`; de desarrollo `prisma`, `typescript`,
`ts-node`, `ts-node-dev`, `@types/express`, `@types/cors`, `@types/node`. Las mismas que la práctica,
menos `sqlite3` (Prisma ya trae su motor y las tablas no se crean a mano).

## Capas

Igual que en la práctica: cada capa sabe lo mínimo de la siguiente.

```
App (Expo)  ──HTTP + JSON──▶  Express  ──▶  Rutas  ──▶  Servicios  ──▶  Prisma  ──▶  SQLite
 fetch()                      cors, json,   validan     reglas de       consultas    dev.db
                              sesión, rol   la entrada  negocio         tipadas
```

- **El celular nunca toca la base.** Pide datos a la API; la API decide.
- **Middlewares** (`middlewares/*.ts`): `autenticar` (token → `req.usuario`), `requerirRol(...)`, límite
  de intentos de login y el manejador de errores al final de todo.
- **Rutas** (`rutas/*.ts`, un `express.Router()` por recurso): leen parámetros y body, toman solo los
  campos que esperan (como el `pick` de la práctica), validan formato, llaman a un servicio y responden.
  No tienen reglas de negocio.
- **Servicios** (`servicios/*.ts`): las reglas del dominio (unicidad de turnos, franjas, cobertura, quién
  puede confirmar, vencimiento). No saben nada de HTTP: tiran `ErrorHttp` y el manejador de errores lo
  traduce.
- **Prisma**: consultas. Lo que la base puede garantizar sola (claves foráneas, `UNIQUE`, índices
  parciales, triggers) va en la base además de en el código.

## Estructura de carpetas

```
backend/
  package.json
  tsconfig.json             # el de la práctica (ES2022, NodeNext, strict, outDir dist, rootDir src)
  .env.example              # PORT, DATABASE_URL, DIAS_SESION_INACTIVA, ORIGEN_PERMITIDO (el .env no se commitea)
  prisma/
    schema.prisma           # el modelo de 03-base-de-datos.md
    migrations/             # generadas por prisma migrate (la primera suma a mano los índices parciales y triggers)
    datos/demo.json         # datos iniciales, exportados de los mocks del frontend (mismos ids)
    datos/fotos/            # fotos de perfil de ejemplo del seed (<medicoId>.jpg)
    dev.db                  # la base (fuera de git)
  src/
    index.ts                # crea la app: cors, express.json, rutas, manejador de errores, listen(PORT)
    db.ts                   # una sola instancia de PrismaClient
    errores.ts              # clase ErrorHttp(status, mensaje)
    middlewares/
      autenticar.ts         # Authorization: Bearer → req.usuario (y renueva el vencimiento)
      requerirRol.ts
      limiteLogin.ts        # intentos fallidos por DNI e IP
      manejarErrores.ts     # ErrorHttp y errores de Prisma → { error }, el resto → 500
    auth/
      contrasenas.ts        # hashear / verificar con scrypt
      sesiones.ts           # crear token, validarlo, revocarlo
    rutas/                  # auth, planes, instituciones, medicos, pacientes, turnos, ordenes, resultados, recetas, admin
    servicios/              # reglas de negocio por módulo
  uploads/                  # fuera de git
    resultados/             # PDF de resultados (datos médicos: solo por GET autorizado)
    fotos/                  # fotos de perfil (<uuid>.jpg; ver 06-reglas-de-negocio.md, "Fotos de perfil")
```

## `src/index.ts`

```ts
// src/index.ts (idea, no código final)
import "dotenv/config";
import cors from "cors";
import express from "express";

import { manejarErrores } from "./middlewares/manejarErrores";
import { rutasAuth } from "./rutas/auth";
import { rutasTurnos } from "./rutas/turnos";
// ...el resto de las rutas

const app = express();
const port = Number(process.env.PORT ?? 3000);

// Primero los middlewares (el orden importa: cors antes de las rutas).
app.use(cors({ origin: process.env.ORIGEN_PERMITIDO }));
// La foto de perfil va en base64 y pesa más de 100 kb: su ruta lee el JSON antes, con su propio límite.
app.use("/api/usuarios/yo/foto", parserFoto);
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/auth", rutasAuth);
app.use("/api/turnos", rutasTurnos);
// ...

// Al final: lo que no encontró ruta y los errores.
app.use((_req, res) => {
  res.status(404).json({ error: "No existe esa ruta." });
});
app.use(manejarErrores);

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
```

## Lo que Express no trae y hay que resolver a mano

### 1. Validar la entrada

`express.json()` solo convierte el texto en objeto. Cada ruta toma **solo** los campos que espera y
valida tipos y formatos: fechas `yyyy-MM-dd`, horas `HH:mm`, ids no vacíos, textos con largo máximo. Que
un dato tenga forma correcta es tarea de la ruta; que tenga sentido (el horario está libre, el turno es
tuyo) es tarea del servicio.

### 2. Sesión y rol

Middleware `autenticar` en todas las rutas no públicas y `requerirRol(...)` en cada router o ruta. El
detalle está en [05-sesiones-y-tokens.md](05-sesiones-y-tokens.md).

### 3. Respuestas y errores

- Siempre JSON, salvo `204 No Content` (sin body: `res.status(204).end()`) y la descarga de PDF
  (`application/pdf`).
- Errores con la forma `{ "error": "mensaje para mostrar" }`, como en la práctica. El frontend ya muestra
  `e.message` en sus pantallas.
- Un solo manejador de errores al final (`manejarErrores`): un `ErrorHttp` responde su status y mensaje; lo
  no previsto responde `500` con un mensaje genérico y se loguea completo en la consola. **Nunca** se manda
  el stack ni el error de Prisma al cliente.
- Errores de Prisma que se traducen: `P2002` (violó un `UNIQUE`) → `409 Conflict`, `P2025` (no existe) →
  `404`, `P2003` (FK inválida) → `400`. **Ojo:** en SQLite, cuando un trigger de validación rechaza un dato
  (`RAISE(ABORT, ...)`), Prisma lo informa también como `P2003` ("Foreign key constraint violated") y sin el
  mensaje del trigger. Por eso los servicios validan antes y dan el mensaje claro; la base es la última barrera.

| Status | Cuándo |
|---|---|
| `200 OK` | Lectura o cambio exitoso con body. |
| `201 Created` | Se creó algo (turno, orden, receta, sesión). |
| `204 No Content` | Se borró o se cerró sesión; sin body. |
| `400 Bad Request` | Faltan datos o tienen mal formato. |
| `401 Unauthorized` | No hay token, venció o fue revocado. |
| `403 Forbidden` | Hay sesión pero el rol no corresponde. |
| `404 Not Found` | El recurso no existe **o no es tuyo** (para no revelar que existe). |
| `409 Conflict` | Choca con el estado: horario ya tomado, turno que ya no está pendiente, fuera de plazo. |
| `413` | Body demasiado grande (lo responde `express.json` con el límite). |
| `429 Too Many Requests` | Demasiados intentos de login. |
| `500` | Error nuestro, no previsto. |

### 4. CORS

`cors({ origin: ORIGEN_PERMITIDO })` antes de las rutas: la app en web (`http://localhost:8081`) llama
desde otro origen. En Expo Go (celular) no hay CORS: es una app nativa, no un navegador.

### 5. Configuración

Variables en `.env` (en `.gitignore`), con un `.env.example` versionado sin valores reales:

```
PORT=3000
DATABASE_URL="file:./dev.db"
DIAS_SESION_INACTIVA=90
ORIGEN_PERMITIDO=http://localhost:8081
```

### 6. Fechas y horas

- Las fechas de negocio se guardan como **texto ISO**: `fecha` = `"2026-10-25"`, `hora` = `"14:30"`, igual
  que en el frontend. Comparar strings ISO ordena bien y evita corrimientos de zona horaria.
- Los timestamps técnicos (`creadoEn`, `expiraEn`) son `DateTime` de Prisma, en UTC.
- "Hoy" y "ahora" se calculan en la zona de Argentina (`America/Argentina/Buenos_Aires`), no en UTC: un
  turno de las 22:00 no puede vencer a las 19:00.

### 7. SQLite

- Prisma activa las claves foráneas solo en SQLite.
- Las escrituras en SQLite son de a una: reservar un turno dentro de `prisma.$transaction` alcanza para
  que dos pedidos simultáneos no tomen el mismo horario, y los índices únicos parciales lo garantizan igual
  si algo se escapa.

## Scripts

Los de la práctica, con migraciones y seed en lugar de `db:init`:

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "prisma:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:seed": "ts-node src/seed.ts",
    "db:studio": "prisma studio",
    "postinstall": "prisma generate"
  }
}
```

## Cómo se prueba

```bash
curl -s http://localhost:3000/api/health
# { "ok": true }

curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"dni":"12345678","password":"Paciente123$"}'
# { "token": "…", "sesion": { "rol": "paciente", … } }

curl -s http://localhost:3000/api/pacientes/yo/turnos -H "Authorization: Bearer <token>"
```

Desde el celular con Expo Go, la app no puede usar `localhost`: hay que apuntar a la IP de la
computadora en la red (`http://192.168.x.x:3000`), con los dos en la misma red. La URL va en una
variable de entorno del frontend (`EXPO_PUBLIC_API_URL`), no escrita en el código. Antes de tocar nada
cuando algo no anda: probar `/api/health` (los cinco errores de siempre están en la diapositiva 19 de la
práctica).
