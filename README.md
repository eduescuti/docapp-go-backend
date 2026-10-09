# DocApp Go — Backend

API de **DocApp Go**, la app móvil de gestión de turnos y servicios médicos multi-hospital.
Trabajo práctico de **Programación de Apps Móviles (UCA)**.

- **Frontend (app Expo + React Native):** [eduescuti/docapp-go](https://github.com/eduescuti/docapp-go)
- **Backend (este repo):** [eduescuti/docapp-go-backend](https://github.com/eduescuti/docapp-go-backend)

La materia pide el frontend y el backend en **dos repositorios separados**. El contexto completo
del proyecto (dominio, reglas de negocio, roles) está en el `CLAUDE.md` del workspace.

## Estructura

```
backend/   código de la API (todavía vacío)
```

Más adelante se suman carpetas de documentación del backend.

## Estado

Pendiente para los próximos sprints: el stack y la base de datos todavía no están definidos. Hoy
la app usa datos de prueba en el frontend (`src/mocks/`), consumidos por `src/services/` con la
misma interfaz que después va a tener esta API. Notas en [`backend/README.md`](backend/README.md).

## Reglas

- Los commits y pushes los hace el alumno.
- Nunca commitear claves, tokens ni credenciales: van en `.env`, que está en `.gitignore`.
