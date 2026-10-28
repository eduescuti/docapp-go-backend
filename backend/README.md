# backend/

API de DocApp Go: **Express 5 + TypeScript + Prisma 6 + SQLite**, con la estructura de la práctica de la
cátedra (`Practica17926`). La documentación está en [`../docs/`](../docs/).

## Cómo levantarla

```bash
cd backend
cp .env.example .env      # una sola vez; .env no se commitea. Completá SECRETO_IDENTIDAD (ver abajo)
npm install               # también genera el cliente de Prisma
npm run db:migrate        # crea prisma/dev.db con todas las tablas, índices y triggers
npm run db:seed           # carga los datos de prueba (BORRA lo que haya en la base)
npm run dev               # http://localhost:3000
curl http://localhost:3000/api/health   # { "ok": true }
```

Después, la app (`DocApp Go/frontend`) con `EXPO_PUBLIC_API_URL` en su `.env` apuntando a esta API (ver su
README). Las cuentas de prueba están en `frontend/USUARIOS-DE-PRUEBA.md`.

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática (`ts-node-dev`). |
| `npm run typecheck` | `tsc --noEmit`: correlo antes de cada commit. |
| `npm run build` / `npm start` | Compila a `dist/` y lo corre. |
| `npm run db:migrate` | Aplica las migraciones (`prisma migrate dev`). |
| `npm run db:seed` | Borra la base y carga los datos de prueba (`src/seed.ts` + `prisma/datos/demo.json`). |
| `npm run db:studio` | Abre Prisma Studio para mirar la base. |

## Estado

La app está **conectada entera** (28/10/2026): cada service del frontend llama a la API y los mocks de datos se
borraron. Lo único que queda en el teléfono es lo que no es de la base: el aviso "Nuevo" de los resultados, el
tema claro / oscuro, la huella y las preguntas frecuentes de Ayuda.

Queda fuera de este sprint, documentado: la carga de PDF por un tercero (`POST /api/integracion/...`) y la
moderación de feedback por el admin.

| Módulo | Backend | App conectada |
|---|---|---|
| Base: schema, migraciones, seed | ✅ | — |
| Login, sesiones (token, 90 días sin uso), logout, cambio de contraseña, registro de paciente y de profesional | ✅ | ✅ |
| Catálogos: obras sociales y planes, especialidades, profesiones | ✅ | ✅ |
| Paciente de la sesión: datos, cambio de plan, favoritos | ✅ | ✅ |
| Instituciones y sedes (mapa, Mi plan, lugares de atención) | ✅ | ✅ |
| Profesionales: búsqueda, perfil, coberturas y lugares del profesional | ✅ | ✅ |
| Admin: alta de obras sociales y planes, alta y coberturas de instituciones | ✅ | ✅ |
| Fotos de perfil del paciente y del profesional (subir, cambiar, quitar; archivos en `uploads/fotos/`) | ✅ | ✅ |
| Turnos y franjas de atención (disponibilidad, reservar, reprogramar, cancelar, confirmar, agenda, pacientes asignados) | ✅ | ✅ |
| Órdenes, resultados (PDF, con descarga registrada) y recetas | ✅ | ✅ |
| Ficha del paciente para el profesional y notas | ✅ | ✅ |
| Feedback (la valoración de cada profesional sale de acá) y notificaciones | ✅ | ✅ |
| Admin: métricas y estadísticas | ✅ | ✅ |
| Verificación de identidad del registro con el código PDF417 del DNI (28/10/2026) | ✅ | ✅ |

`SECRETO_IDENTIDAD` es la clave del HMAC con que se guarda el número de trámite del DNI (verificación de
identidad del registro, [06](../docs/06-reglas-de-negocio.md#verificación-de-identidad-del-registro)). Sin ella el
registro responde 500. Generala una vez con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` y no la compartas: si cambia, los DNI ya
usados dejan de reconocerse como repetidos.

> Si una migración futura cambia una tabla con triggers o índices parciales (p. ej. `turnos`), Prisma la
> recrea en SQLite y se pierden: revisá la migración generada y volvé a agregarlos (ver
> [03-base-de-datos.md](../docs/03-base-de-datos.md#sql-extra-de-la-migración)).
