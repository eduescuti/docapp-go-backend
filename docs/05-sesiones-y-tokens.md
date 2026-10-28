# Sesiones y tokens

## Por qué hacen falta

HTTP no tiene memoria: cada pedido (`GET`, `POST`, `PATCH`, `DELETE`) llega solo, y el servidor no sabe
quién lo manda. Sin algo que lo identifique, cualquiera podría pedir `GET /api/pacientes/yo/turnos` o
`GET /api/resultados/:id/pdf` y leer datos médicos ajenos.

El **token de sesión** es esa identificación: el servidor lo entrega una vez, cuando el usuario demuestra
quién es (DNI + contraseña), y la app lo manda en **todos** los pedidos siguientes, en el header:

```http
GET /api/pacientes/yo/turnos
Authorization: Bearer q3Zb8kT1…
```

Con el token, el servidor sabe **quién** pide (y por lo tanto qué rol tiene y qué datos son suyos) sin
volver a pedir la contraseña. Es lo que protege el acceso a la base: ninguna ruta toca datos sin pasar
antes por la validación del token.

## Decisión: token opaco guardado en la base

| | Token opaco (elegido) | JWT |
|---|---|---|
| Qué es | Un número aleatorio largo, sin significado. El servidor busca en la tabla `sesiones` a quién pertenece. | Un texto firmado que lleva adentro el usuario y el vencimiento. El servidor verifica la firma sin consultar la base. |
| Cerrar sesión / revocar | Inmediato: se marca `revocadaEn` y el token deja de valer. | Difícil: el token vale hasta que vence, salvo que se arme una lista negra (que es volver a la base). |
| Sin librerías | `crypto.randomBytes` + `createHash`. | Hay que implementar firma HMAC, base64url y validación de campos a mano. |
| Costo | Una consulta por pedido (con índice único, es inmediata en SQLite). | Ninguna consulta. |

Para una app médica importa más poder **cortar una sesión ya** (teléfono perdido, cambio de contraseña)
que ahorrarse una consulta. Por eso: token opaco.

## Cómo funciona

### Login

```
App                                  Servidor                                    Base
 │  POST /api/auth/login {dni, pass}    │                                          │
 │ ───────────────────────────────────▶ │  ¿demasiados intentos? → 429             │
 │                                      │  busca usuario por DNI ────────────────▶ │
 │                                      │  scrypt(pass, salt) == passwordHash ?    │
 │                                      │  token = randomBytes(32)                 │
 │                                      │  guarda sha256(token), expiraEn ───────▶ │ sesiones
 │  200 { token, expiraEn, sesion }     │                                          │
 │ ◀─────────────────────────────────── │                                          │
```

- El **token original** solo existe en la respuesta del login y en el teléfono. La base guarda su
  **hash SHA-256**: si alguien copia la base, no puede usar los tokens.
- Si el DNI no existe o la contraseña no coincide, la respuesta es la misma (`401 "DNI o contraseña
  incorrectos."`): no se revela si el DNI está registrado.

### Cada pedido

```ts
// src/middlewares/autenticar.ts (idea)
import type { NextFunction, Request, Response } from "express";

export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  const [tipo, token] = (req.headers.authorization ?? "").split(" ");
  if (tipo !== "Bearer" || !token) throw new ErrorHttp(401, "Iniciá sesión.");

  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: sha256(token) },
    include: { usuario: { include: { paciente: true, medico: true } } },
  });
  const ahora = new Date();
  if (!sesion || sesion.revocadaEn || sesion.expiraEn <= ahora || !sesion.usuario.activo) {
    throw new ErrorHttp(401, "Tu sesión venció. Iniciá sesión de nuevo.");
  }
  await renovarSiCorresponde(sesion, ahora); // vencimiento por inactividad (abajo)
  req.usuario = sesion.usuario;              // tipado con declaration merging de Express
  next();
}

export const requerirRol = (...roles: Rol[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!roles.includes(req.usuario.rol as Rol)) throw new ErrorHttp(403, "No tenés permiso para esto.");
  next();
};
```

Cada router no público usa `autenticar` (por ejemplo `rutasTurnos.use(autenticar)`) y cada ruta declara
los roles que acepta con `requerirRol("paciente")`. Express 5 manda al manejador de errores lo que tire
un middleware `async`. Después, el **servicio** verifica que el dato sea del usuario
(el turno es suyo, el paciente tiene un turno con este médico): si no lo es, responde `404` y no `403`,
para no confirmar que ese id existe.

### Cerrar sesión, vencimiento y cambio de contraseña

| Evento | Qué pasa |
|---|---|
| Logout (`POST /api/auth/logout`) | `revocadaEn = ahora` para ese token. `204`. |
| Pasan **90 días sin usar la app** (`DIAS_SESION_INACTIVA`) | El token deja de valer (`401`) y la app vuelve al login. Mientras se use, no vence nunca (ver abajo). |
| Cambio de contraseña | Se revocan **todas** las otras sesiones del usuario. |
| Usuario desactivado por el admin | `activo = false`: sus tokens dejan de valer en el próximo pedido. |
| Limpieza | Al iniciar el servidor (o una vez por día), borrar sesiones vencidas o revocadas hace más de 30 días. |

### Sesión iniciada hasta que el usuario la cierre (decidido el 27/10/2026)

Como en cualquier app del celular, la sesión queda iniciada: el usuario decide cuándo cerrarla. Para que
un teléfono perdido o abandonado no quede con una sesión abierta para siempre, el vencimiento es **por
inactividad**: `expiraEn = último uso + 90 días`. Cada pedido válido corre el vencimiento
(`renovarSiCorresponde`); quien abre la app aunque sea una vez cada tres meses no tiene que volver a
ingresar nunca.

`ultimoUsoEn` y `expiraEn` se actualizan como mucho una vez por minuto por sesión (no en cada pedido) para
no escribir en la base todo el tiempo.

Lo que protege una sesión larga:

- El token es aleatorio (32 bytes) y en la base está solo su hash.
- Se corta al instante: cerrar sesión, cambiar la contraseña (corta todas las otras) o que el admin
  desactive la cuenta.
- En el teléfono queda cifrado (`expo-secure-store`) y, si está activada la huella, la app la pide al
  abrirse antes de usar el token.
- En producción viaja siempre por HTTPS.

## Contraseñas

Nunca en texto plano (los mocks del Sprint 1 las tienen así porque no había backend). `node:crypto` trae
`scrypt`, pensado para contraseñas: es lento a propósito, así probar millones de contraseñas cuesta caro.

```ts
// src/auth/contrasenas.ts (idea)
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb) as (pass: string, salt: Buffer, largo: number) => Promise<Buffer>;

export async function hashear(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verificar(password: string, guardado: string): Promise<boolean> {
  const [saltHex, hashHex] = guardado.split(":");
  const esperado = Buffer.from(hashHex, "hex");
  const hash = await scrypt(password, Buffer.from(saltHex, "hex"), esperado.length);
  return timingSafeEqual(hash, esperado); // compara sin filtrar por cuánto tarda
}
```

La regla de contraseña segura (regla 14: 8+ caracteres, mayúscula, número y carácter especial) se valida
**también en el servidor**: lo que valida la app se puede saltear llamando a la API directo.

## Intentos de login

Para frenar a quien prueba contraseñas: un `Map` en memoria con los fallos por DNI y por IP. Más de 5
fallos en 15 minutos → `429 "Demasiados intentos. Probá de nuevo en unos minutos."`. Cada fallo y cada
login exitoso se guarda en `registro_auditoria`.

## En la app (frontend)

- **Dónde guarda el teléfono su copia del token:** en `expo-secure-store` (cifrado por el sistema
  operativo: Keychain en iOS, Keystore en Android), no en `AsyncStorage` (texto plano). Decidido el
  27/10/2026: se instala con `npx expo install expo-secure-store`, que elige la versión del SDK 57 sin
  tocar RN ni Expo. La sesión en sí vive en nuestra base (`sesiones`); el teléfono solo guarda la llave.
  En web no existe: ahí el token vive solo en memoria y se pide login al recargar.
- **Un solo lugar que hace los `fetch`:** `src/services/apiClient.ts` agrega `Authorization: Bearer` a
  cada pedido y, si la respuesta es `401`, borra la sesión y manda al login.
- **Hoy `src/services/biometria.ts` guarda el DNI y la contraseña en `AsyncStorage`** para el ingreso con
  huella. Con tokens eso deja de hacer falta y **hay que sacarlo**: la contraseña no se guarda nunca en el
  teléfono.

### Ingreso con huella

La huella no reemplaza al token: lo **desbloquea**. Después del primer login con contraseña, el token queda
en `expo-secure-store`; al abrir la app se pide la huella, se lee el token y se valida con `GET /api/sesion`.
Si venció (`401`), se vuelve a pedir DNI y contraseña.

## Terceros: carga de PDF de resultados

El laboratorio que carga los PDF no es un usuario de la app. Tiene una **clave de integración** propia:

- La genera el admin para una institución (`claves_integracion`), se muestra **una sola vez** y se guarda
  solo su hash (igual que los tokens).
- Se manda en el header `X-Clave-Integracion` y solo sirve para `POST /api/integracion/...`.
- Solo puede cargar resultados de órdenes de **su** institución. Se puede desactivar (`activa = false`).

## Checklist de seguridad del backend

- [ ] Contraseñas con `scrypt` y comparación con `timingSafeEqual`.
- [ ] Tokens aleatorios de 32 bytes; en la base, solo el hash.
- [ ] `autenticar` en todas las rutas no públicas; `requerirRol` en cada handler.
- [ ] El paciente sale del token, nunca del body ni de la URL (`/yo`).
- [ ] Verificación de dueño en cada lectura o cambio (un turno ajeno → `404`).
- [ ] Límite de tamaño del body (JSON 100 KB, PDF 10 MB).
- [ ] Mensajes de error sin detalles internos (ni stack ni errores de Prisma).
- [ ] Intentos de login limitados y registrados.
- [ ] Descargas de resultados registradas en `registro_auditoria` (regla 8).
- [ ] `.env` fuera de git; en producción, HTTPS (el token viaja en cada pedido y no puede ir en texto plano por internet).
