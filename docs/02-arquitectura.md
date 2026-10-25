# Arquitectura del backend (sin framework)

## Stack

| Capa | Con qué | Por qué |
|---|---|---|
| Servidor HTTP | `node:http` (módulo nativo de Node.js) | La consigna es no usar framework: el router, los middlewares, el body JSON y CORS los escribimos nosotros. |
| Lenguaje | TypeScript (`strict: true`) | Igual que el frontend. Los tipos de la API salen de los mismos nombres que `src/domain/`. |
| Acceso a datos | Prisma ORM | Es lo que vimos en la práctica de clase: schema tipado, cliente generado y migraciones. No es un framework web: solo habla con la base. |
| Base de datos | SQLite (un archivo `.db`) | Sin servidor aparte, alcanza para el TP. Si después se pasa a PostgreSQL, cambia el `provider` del schema y no la app. |
| Criptografía | `node:crypto` | `scrypt` para contraseñas, `randomBytes` para tokens, `createHash` para guardarlos hasheados. Sin librerías extra. |

Dependencias: `prisma`, `@prisma/client`, `typescript`, `tsx` (para correr TS en desarrollo) y
`@types/node`. Nada más. **No** `express`, `cors`, `body-parser`, `jsonwebtoken` ni `bcrypt`: cada una
resuelve algo que la consigna pide hacer a mano.

## Capas

Igual que en la práctica de Prisma, cada capa sabe lo mínimo de la siguiente:

```
App (Expo)  ──HTTP + JSON──▶  Servidor (node:http)  ──▶  Rutas  ──▶  Servicios  ──▶  Prisma  ──▶  SQLite
 fetch()                       body, CORS, errores        validan      reglas de       consultas    archivo
                               token, rol                 la entrada   negocio         tipadas      .db
```

- **El celular nunca toca la base.** Pide datos a la API; la API decide.
- **Rutas** (`rutas/*.ts`): leen parámetros y body, validan la forma, llaman a un servicio y responden.
  No tienen reglas de negocio.
- **Servicios** (`servicios/*.ts`): las reglas del dominio (unicidad de turnos, quién puede confirmar,
  vencimiento, filtro por obra social). No saben nada de HTTP.
- **Prisma**: consultas. Las reglas que la base puede garantizar sola (claves foráneas, `UNIQUE`,
  `CHECK`) van en la base además de en el código.

## Estructura de carpetas propuesta

```
backend/
  package.json
  tsconfig.json
  .env.example              # PORT, DATABASE_URL, DURACION_SESION_HORAS (el .env real no se commitea)
  prisma/
    schema.prisma           # el modelo de 03-base-de-datos.md
    migrations/             # generadas por prisma migrate (incluyen los índices parciales a mano)
    seed.ts                 # datos iniciales: planes, especialidades, REFES, padrón, usuarios de prueba
  src/
    index.ts                # crea el servidor y escucha en PORT
    http/
      router.ts             # tabla de rutas: método + patrón ("/api/turnos/:id") + handler
      body.ts               # lee el body JSON con límite de tamaño
      respuestas.ts         # enviarJson(res, status, datos), enviarError(res, error)
      errores.ts            # clase ErrorHttp(status, mensaje) y su traducción a respuesta
      cors.ts               # cabeceras CORS y respuesta al preflight OPTIONS
    auth/
      contrasenas.ts        # hashear / verificar con scrypt
      sesiones.ts           # crear token, validarlo, revocarlo
      middleware.ts         # autenticar(req) y requerirRol(...)
    rutas/                  # una por recurso: auth, turnos, ordenes, resultados, recetas, ...
    servicios/              # reglas de negocio por módulo
    db.ts                   # una sola instancia de PrismaClient
  uploads/                  # PDF de resultados (fuera de git: son datos médicos)
```

## Lo que un framework haría y acá hay que resolver a mano

### 1. Servidor y router

`node:http` entrega cada pedido a una sola función. El router es una lista de rutas que se recorre
hasta encontrar la que coincide en método y patrón. Los parámetros (`:id`) se sacan con una expresión
regular armada a partir del patrón.

```ts
// src/http/router.ts (idea, no código final)
type Handler = (ctx: Contexto) => Promise<void>;
interface Ruta { metodo: string; patron: RegExp; claves: string[]; handler: Handler }

const rutas: Ruta[] = [];

export function ruta(metodo: string, camino: string, handler: Handler) {
  const claves: string[] = [];
  const patron = new RegExp(
    "^" + camino.replace(/:([a-zA-Z]+)/g, (_, clave) => { claves.push(clave); return "([^/]+)"; }) + "$",
  );
  rutas.push({ metodo, patron, claves, handler });
}

export function resolver(metodo: string, pathname: string) {
  for (const r of rutas) {
    const m = r.patron.exec(pathname);
    if (r.metodo === metodo && m) {
      return { handler: r.handler, params: Object.fromEntries(r.claves.map((c, i) => [c, decodeURIComponent(m[i + 1])])) };
    }
  }
  return null; // → 404, o 405 si el camino existe con otro método
}
```

La query (`?desde=2026-10-01`) se lee con `new URL(req.url, "http://localhost").searchParams`.

### 2. Body JSON

`req` es un stream: hay que juntar los pedazos, cortar si pasa un límite (para que nadie mande 1 GB) y
recién ahí hacer `JSON.parse` dentro de un `try`.

```ts
// src/http/body.ts (idea)
const LIMITE_BYTES = 100_000;

export async function leerJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new ErrorHttp(415, "El body tiene que ser JSON.");
  let total = 0;
  const partes: Buffer[] = [];
  for await (const parte of req) {
    total += parte.length;
    if (total > LIMITE_BYTES) throw new ErrorHttp(413, "El body es demasiado grande.");
    partes.push(parte);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    throw new ErrorHttp(400, "El JSON no es válido.");
  }
}
```

Después del parseo, **cada ruta toma solo los campos que espera** (como el `pick` de la práctica) y
valida tipos y formatos: fechas `yyyy-MM-dd`, horas `HH:mm`, ids no vacíos, textos con largo máximo.

### 3. CORS

La app en web (`npx expo start --web`, `http://localhost:8081`) llama a la API desde otro origen. El
navegador manda primero un `OPTIONS` (preflight) cuando hay `Authorization` o `Content-Type: application/json`.

- Responder `OPTIONS` con `204` y las cabeceras `Access-Control-Allow-Origin` (el origen permitido, no `*`
  en producción), `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE` y
  `Access-Control-Allow-Headers: Content-Type, Authorization`.
- Poner `Access-Control-Allow-Origin` también en las respuestas normales.
- En Expo Go (celular) no hay CORS: es una app nativa, no un navegador.

### 4. Respuestas y errores

- Siempre JSON con `Content-Type: application/json; charset=utf-8`, salvo `204 No Content` (sin body) y
  la descarga de PDF (`application/pdf`).
- Errores con la forma `{ "error": "mensaje para mostrar" }`, como en la práctica de clase. El frontend
  ya muestra `e.message` en sus pantallas.
- Un `try/catch` global en el handler del servidor: lo que no se previó responde `500` con un mensaje
  genérico y se loguea completo en la consola. **Nunca** se manda el stack ni el error de Prisma al cliente.
- Errores de Prisma que se traducen: `P2002` (violó un `UNIQUE`) → `409 Conflict`, `P2025` (no existe) →
  `404`, `P2003` (FK inválida) → `400`.

| Status | Cuándo |
|---|---|
| `200 OK` | Lectura o cambio exitoso con body. |
| `201 Created` | Se creó algo (turno, orden, receta, sesión). |
| `204 No Content` | Se borró o se cerró sesión; sin body. |
| `400 Bad Request` | Faltan datos o tienen mal formato. |
| `401 Unauthorized` | No hay token, venció o fue revocado. |
| `403 Forbidden` | Hay sesión pero el rol o el dueño no corresponde. |
| `404 Not Found` | El recurso no existe **o no es tuyo** (para no revelar que existe). |
| `409 Conflict` | Choca con el estado: horario ya tomado, turno que ya no está pendiente. |
| `413` / `415` | Body demasiado grande / no es JSON. |
| `429 Too Many Requests` | Demasiados intentos de login. |
| `500` | Error nuestro, no previsto. |

### 5. Configuración

Variables en `.env` (está en `.gitignore`), con un `.env.example` versionado sin valores reales:

```
PORT=3000
DATABASE_URL="file:./dev.db"
DURACION_SESION_HORAS=720
ORIGEN_PERMITIDO=http://localhost:8081
```

`node --env-file=.env` (Node 20.6+) las carga sin librerías.

### 6. Fechas y horas

- Las fechas de negocio se guardan como **texto ISO**: `fecha` = `"2026-10-25"`, `hora` = `"14:30"`, igual
  que en el frontend. Comparar strings ISO ordena bien y evita corrimientos de zona horaria.
- Los timestamps técnicos (`creadoEn`, `expiraEn`) son `DateTime` de Prisma, en UTC.
- "Hoy" y "ahora" se calculan en la zona de Argentina (`America/Argentina/Buenos_Aires`), no en UTC: un
  turno de las 22:00 no puede vencer a las 19:00.

### 7. SQLite

- Activar las claves foráneas: Prisma lo hace solo en SQLite, pero si se usa SQL a mano, `PRAGMA foreign_keys = ON`.
- Las escrituras en SQLite son de a una: reservar un turno dentro de una transacción
  (`prisma.$transaction`) alcanza para que dos pedidos simultáneos no tomen el mismo horario, y el
  índice único parcial lo garantiza igual si algo se escapa.

## Scripts

```json
{
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio"
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
# { "token": "…", "expiraEn": "…", "sesion": { "rol": "paciente", … } }

curl -s http://localhost:3000/api/pacientes/yo/turnos -H "Authorization: Bearer <token>"
```

Desde el celular con Expo Go, la app no puede usar `localhost`: hay que apuntar a la IP de la
computadora en la red (`http://192.168.x.x:3000`), con los dos en la misma red. La URL va en una
variable de entorno del frontend (`EXPO_PUBLIC_API_URL`), no escrita en el código.
