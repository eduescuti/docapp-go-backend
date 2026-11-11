# DocApp Go — Backend

API de **DocApp Go**, la app móvil de gestión de turnos y servicios médicos multi-hospital.
Trabajo práctico de **Programación de Apps Móviles (UCA)**.

- **Frontend (app Expo + React Native):** [eduescuti/docapp-go](https://github.com/eduescuti/docapp-go)
- **Backend (este repo):** [eduescuti/docapp-go-backend](https://github.com/eduescuti/docapp-go-backend)

La materia pide el frontend y el backend en **dos repositorios separados**. El contexto completo
del proyecto (dominio, reglas de negocio, roles) está en docs del workspace.

## Stack

Node.js + TypeScript con **Express 5**, **Prisma 6** y **SQLite**, con la misma estructura que la práctica de la cátedra (`Practica17926`). Sesiones, roles, validación y reglas de negocio se escriben a mano (decidido el 27/10/2026; antes era `node:http` sin framework).

## Estructura

```
backend/   código de la API (Express + Prisma; ver backend/README.md)
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
| [05 · Sesiones y tokens](docs/05-sesiones-y-tokens.md) | Login, tokens de sesión, contraseñas, huella, push y claves de terceros (a futuro). |
| [06 · Reglas de negocio](docs/06-reglas-de-negocio.md) | Estados de turnos, órdenes, resultados, recetas, archivado y permisos. |
| [07 · Pendientes](docs/07-pendientes.md) | Decisiones tomadas y puntos a confirmar. |
| [08 · Coberturas](docs/08-coberturas.md) | Obras sociales ↔ instituciones y profesionales: quién las carga, modelo, catálogo y seed verificado. |
| [Cómo funciona el backend](docs/como-funciona-el-backend.html) | Explicación visual e interactiva: el viaje de un pedido, las capas, la sesión, todas las rutas y las notificaciones (abrirlo en el navegador). |

## Estado

La API está completa y la app está **conectada entera** (28/10/2026): cada service del frontend le pide los datos a
esta API y los mocks de datos se borraron. Las notificaciones también llegan como push con Firebase Cloud Messaging
(29/10/2026). El 05/11/2026 se ordenó el código (rutas con su mapa en `rutas/index.ts`, servicios en carpetas por
tema, `utils/`) y se reescribieron los servicios para que se lean más fácil
([02 · Arquitectura](docs/02-arquitectura.md#cómo-está-escrito-un-servicio-05112026)). El estado
por módulo está en [`backend/README.md`](backend/README.md).

Queda fuera de este sprint, documentado: la carga de PDF por un tercero y la moderación de feedback por el admin.

## Reglas

- Los commits y pushes los hace el alumno.
- Nunca commitear claves, tokens ni credenciales: van en `.env`, que está en `.gitignore`. Lo mismo el JSON de
  credenciales de Firebase de `backend/`.
- Nunca commitear la base (`*.db`) ni los PDF de resultados (`uploads/`): son datos médicos.
