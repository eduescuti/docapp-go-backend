# DocApp Go — Backend

API de **DocApp Go**, la app móvil de gestión de turnos y servicios médicos multi-hospital.
Trabajo práctico de **Programación de Apps Móviles (UCA)**.

- **Frontend (app Expo + React Native):** [eduescuti/docapp-go](https://github.com/eduescuti/docapp-go)
- **Backend (este repo):** [eduescuti/docapp-go-backend](https://github.com/eduescuti/docapp-go-backend)

La materia pide el frontend y el backend en **dos repositorios separados**. El contexto completo
del proyecto (dominio, reglas de negocio, roles) está en el `CLAUDE.md` del workspace.

## Stack

Node.js + TypeScript con el módulo nativo **`node:http`** (sin framework), **Prisma** y **SQLite**.
Router, body JSON, CORS, errores y tokens de sesión se escriben a mano.

## Estructura

```
backend/   código de la API (todavía vacío: se arma en el Sprint 2)
docs/      documentación del backend
```

## Documentación (Sprint 2 — entrega de base de datos)

| | |
|---|---|
| [01 · Sprint 2](docs/01-sprint-2.md) | Qué hay que hacer, por rol, y qué quedó decidido. Empezar por acá. |
| [02 · Arquitectura](docs/02-arquitectura.md) | Stack, capas, carpetas y todo lo que hay que resolver sin framework. |
| [03 · Base de datos](docs/03-base-de-datos.md) | Modelo de 26 tablas, `schema.prisma`, índices y restricciones, seed. |
| [Diagrama de la base](docs/diagrama-base-de-datos.html) | Diagrama entidad–relación interactivo (abrirlo en el navegador). |
| [04 · API](docs/04-api.md) | Endpoints REST por rol y su equivalencia con los services del frontend. |
| [05 · Sesiones y tokens](docs/05-sesiones-y-tokens.md) | Login, tokens de sesión, contraseñas y claves de terceros. |
| [06 · Reglas de negocio](docs/06-reglas-de-negocio.md) | Estados de turnos, órdenes, resultados, recetas, archivado y permisos. |
| [07 · Pendientes](docs/07-pendientes.md) | Decisiones tomadas y puntos a confirmar. |

## Estado

La app todavía usa datos de prueba en el frontend (`src/mocks/`), consumidos por `src/services/` con la
misma interfaz que va a tener esta API. El modelo de datos y los endpoints ya están definidos en `docs/`.

## Reglas

- Los commits y pushes los hace el alumno.
- Nunca commitear claves, tokens ni credenciales: van en `.env`, que está en `.gitignore`.
- Nunca commitear la base (`*.db`) ni los PDF de resultados (`uploads/`): son datos médicos.
