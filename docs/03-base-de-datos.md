# Base de datos

Modelo relacional de DocApp Go para el Sprint 2 (entrega obligatoria de BDD). Motor: **SQLite** con
**Prisma**. El diagrama interactivo está en [`diagrama-base-de-datos.html`](diagrama-base-de-datos.html)
(abrilo en el navegador).

> El `schema.prisma` y el SQL de esta página se validaron el 25/10/2026: `prisma validate` lo da por
> válido, `prisma migrate diff` genera las 26 tablas y el SQL extra se probó en SQLite (bloquea la doble
> reserva, un turno cancelado libera el horario y se rechazan los estados inválidos).
>
> **27/10/2026:** `instituciones_planes` y `medicos_planes` se reemplazaron por `instituciones_coberturas` y
> `medicos_coberturas` ([08-coberturas.md](08-coberturas.md)); se sumaron `franjas_atencion`,
> `turnos.reprogramadoDesdeId` y el índice `turnos_medico_activo` ([07-pendientes.md](07-pendientes.md)).
> Validado de nuevo el 27/10/2026 al crear `backend/`: `prisma validate` lo da por válido, la migración
> `inicial` crea las 27 tablas con el SQL extra y una prueba sobre la base confirmó cada regla (doble
> reserva, médico en dos sedes a la misma hora, coberturas con plan de otra obra social, franjas y estados
> inválidos). La segunda migración (`franjas_media_hora`) suma al trigger de franjas que las horas sean en
> punto o y media.
>
> **Migraciones posteriores:** `obras_sociales_descripcion` y `fotos_perfil` (27/10/2026),
> `feedback_especialidades_identidad` (28/10/2026), `agregar_fcm_token_sesion` (29/10/2026: `sesiones.fcmToken`
> para los push) y `quitar_claves_integracion` (05/11/2026: se sacaron `claves_integracion` y
> `resultados.claveIntegracionId`, que estaban vacías; vuelven con una migración nueva si se implementa la carga de
> PDF por un tercero). Hoy son **26 tablas**.

## Convenciones

- **Tablas** en snake_case plural (`turnos`, `planes_medicos`), con `@@map` en Prisma.
- **Columnas** con el mismo nombre que los campos del frontend (`pacienteId`, `vigenteHasta`,
  `archivadoEl`): el JSON de la API coincide con los tipos de `src/domain/` sin traducir nada.
- **Ids** `TEXT` con UUID (`@default(uuid())`). Los establecimientos del REFES pueden usar el id que ya
  tienen en el frontend (`refes-<código>`) para que los mocks y la base coincidan.
- **Fechas de negocio** como texto ISO: `fecha` `"2026-10-25"`, `hora` `"14:30"`, `archivadoEl`,
  `vigenteHasta`. **Timestamps técnicos** (`creadoEn`, `expiraEn`) como `DateTime`, en UTC.
- **Estados y tipos** como `TEXT`: SQLite no tiene `ENUM`. Se restringen con triggers en la base (ver
  [SQL extra](#sql-extra-de-la-migración)) y con uniones de tipos en TypeScript.
- **Borrado:** los datos médicos (turnos, órdenes, resultados, recetas) **no se borran**: se cambian de
  estado o se archivan. Las tablas de relación (favoritos, planes, lugares) sí se borran en cascada.

## Módulos y tablas

26 tablas en 8 módulos.

| Módulo | Tablas | Para qué |
|---|---|---|
| Identidad y seguridad | `usuarios`, `sesiones`, `registro_auditoria` | Login único por DNI, tokens de sesión y trazabilidad. |
| Cobertura | `obras_sociales`, `planes_medicos`, `instituciones_coberturas` | Obras sociales y planes (los carga el admin) y qué coberturas acepta cada institución privada. Ver [08-coberturas.md](08-coberturas.md). |
| Instituciones | `instituciones`, `sedes` | Hospitales, clínicas, centros y laboratorios: nombre + dirección + latitud + longitud. |
| Pacientes | `pacientes`, `pacientes_medicos_favoritos`, `pacientes_instituciones_favoritas` | Datos del paciente, su plan y sus favoritos. |
| Profesionales | `profesionales_padron`, `medicos`, `especialidades`, `subespecialidades`, `medicos_sedes`, `franjas_atencion`, `medicos_coberturas`, `notas_paciente` | Padrón para validar el registro, perfil, lugares de atención, franjas de atención, coberturas que atiende y notas privadas. |
| Turnos | `turnos` | El núcleo: estado, unicidad, historial. |
| Estudios | `ordenes`, `orden_estudios`, `resultados` | Órdenes con indicaciones, los estudios pedidos y los resultados con su PDF. |
| Recetas, feedback y avisos | `recetas`, `feedbacks`, `notificaciones` | Recetas, calificación de turnos cumplidos y notificaciones. |

### Relaciones principales

| Relación | Cardinalidad | Cómo |
|---|---|---|
| Usuario → Paciente / Médico | 1 : 0..1 | `pacientes.usuarioId` y `medicos.usuarioId` son `UNIQUE`. El admin es un usuario sin fila en ninguna de las dos. |
| Usuario → Sesión | 1 : N | Un usuario puede tener varias sesiones (celular y web). |
| Obra social → Plan | 1 : N | "OSDE" → "OSDE 210", "OSDE 310". |
| Plan → Paciente | 1 : N | Cada paciente tiene un plan (filtro transversal de la app). |
| Institución ↔ Obra social (↔ Plan) | N : M | `instituciones_coberturas`: obra social con plan opcional (sin plan = todos sus planes). Solo para privadas y de seguridad social: las públicas se ven siempre (regla 15). |
| Institución → Sede | 1 : N | Hoy, una sede por institución (las del REFES). |
| Médico ↔ Sede | N : M | `medicos_sedes` = **lugares de atención** del perfil. |
| Médico + Sede → Franja | 1 : N | `franjas_atencion`: qué días y de qué hora a qué hora atiende en cada lugar. |
| Turno → Turno | 0..1 : 0..1 | `turnos.reprogramadoDesdeId`: el turno nuevo apunta al que reemplazó al reprogramar. |
| Médico ↔ Obra social (↔ Plan) | N : M | `medicos_coberturas`, misma lógica. Las elige el profesional en su Perfil. |
| Especialidad → Médico | 1 : N | Cada médico tiene una especialidad (y opcionalmente una subespecialidad). |
| Paciente / Médico / Sede / Especialidad → Turno | 1 : N | Un turno es de un paciente, con un médico, en una sede, de una especialidad. |
| Turno → Feedback | 1 : 0..1 | `feedbacks.turnoId` `UNIQUE`: un feedback por turno. |
| Médico / Paciente / Institución → Orden | 1 : N | Hospital + fecha + médico (notas del sprint). |
| Orden → Estudio pedido | 1 : N | `orden_estudios`, uno por renglón de la orden. |
| Orden → Resultado | 1 : N | Una orden puede tener varios resultados que llegan en momentos distintos. |
| Médico / Paciente → Receta | 1 : N | La receta queda siempre asociada a quien la emitió (regla 7). |

## Cómo se traduce cada regla en la base

| Regla | En la base |
|---|---|
| **Turnos: combinación única** (notas del sprint, regla 4) | Índice único **parcial** `turnos_combinacion_activa` sobre `(fecha, hora, sedeId, especialidadId, medicoId)` solo para `estado IN ('pendiente','confirmado')`. Un turno cancelado, rechazado o completado no cuenta: el horario queda libre. |
| **Turnos: estados** | `estado` con trigger: `pendiente`, `confirmado`, `rechazado`, `cancelado`, `completado`. Default `pendiente`. |
| **Turnos: historial** | Son los turnos con fecha pasada o cerrados. `ocultoEnHistorial` solo los saca de la lista del paciente. |
| **Órdenes: dos estados** | `ordenes.estado` con trigger: `pendiente` / `listo`. |
| **Resultados sin estado** | `resultados` no tiene columna de estado. El "Nuevo" del frontend no se guarda en la base. |
| **Todo se archiva** | `archivadoEl` (fecha, null = no archivado) en `ordenes`, `resultados` y `recetas`. La carpeta año → mes sale de esa fecha. |
| **Recetas: activa / pasada** | No se guarda: se calcula con `vigenteHasta >= hoy`. `vigenteHasta` se fija al crearla (`fecha + duracionDias`). |
| **Perfil del médico sin horarios** | El perfil no muestra horarios. Los lugares de atención son `medicos_sedes`; la disponibilidad sale de `franjas_atencion`, que el profesional carga en su Agenda (27/10/2026). |
| **Un médico no está en dos lugares a la vez** | Índice único parcial `turnos_medico_activo` sobre `(medicoId, fecha, hora)` entre activos. Las franjas de un mismo médico no se pisan entre lugares (lo valida el servicio). |
| **Reprogramar** | No hay estado `reprogramado`: el turno viejo queda `cancelado` y el nuevo nace `pendiente` con `reprogramadoDesdeId`, en una transacción. |
| **Hospitales por obra social** (reglas 1 y 15) | `instituciones.origen = 'publico'` o existe fila en `instituciones_coberturas` para la obra social del paciente, sin plan o con su plan. |
| **Feedback solo de turnos cumplidos** (regla 6) | `feedbacks.turnoId` obligatorio y `UNIQUE`; el servicio verifica que el turno esté `completado` y sea del paciente. |
| **Órdenes y recetas del médico que las emitió** (regla 7) | `medicoId` `NOT NULL` con FK, sin cascada. |
| **Contraseñas y tokens** (§11) | `usuarios.passwordHash` (scrypt) y `sesiones.tokenHash` (SHA-256). Nunca el valor original. |
| **Verificación de identidad** (28/10/2026) | `usuarios.identidadVerificadaEl` y `usuarios.tramiteHash` (`UNIQUE`, HMAC-SHA256 del número de trámite del DNI con `SECRETO_IDENTIDAD`, 64 caracteres hexadecimales: trigger). Ni imagen ni contenido del código. Un mismo DNI físico no abre dos cuentas. Detalle: [06](06-reglas-de-negocio.md#verificación-de-identidad-del-registro). |
| **Especialidad por profesión** (28/10/2026) | `especialidades.profesion`: el registro de un kinesiólogo no ofrece "Cardiología". 70 médicas (Res. 1814/2015), 7 de enfermería (Res. 199/2011) y "Kinesiología y Fisioterapia" (no hay listado nacional de especialidades de kinesiología). |
| **Feedback con criterios opcionales** (28/10/2026) | `feedbacks.estrellas` obligatoria; los 5 criterios, `NULL` si no se calificaron. El trigger de 1 a 5 deja pasar los `NULL`. |
| **Fotos de perfil** (27/10/2026) | `usuarios.fotoArchivo` (`UNIQUE`, null = sin foto): solo el nombre del archivo, al azar (`<uuid>.jpg`) y nuevo en cada foto. La imagen está en `backend/uploads/fotos/`, no en la base. Va en `usuarios` porque la tienen pacientes y profesionales. Quién la ve: [06](06-reglas-de-negocio.md#fotos-de-perfil). |

## Consultas clave

Las escribe Prisma, pero así se ven en SQL (sirve para entender los índices).

```sql
-- Hospitales que ve un paciente con el plan :plan (reglas 1 y 15)
SELECT i.*, s.*
FROM instituciones i
JOIN sedes s ON s.institucionId = i.id
WHERE i.activa = 1
  AND (i.origen = 'publico'
       OR EXISTS (SELECT 1 FROM instituciones_coberturas ic
                  WHERE ic.institucionId = i.id AND ic.obraSocialId = :obraSocial
                    AND (ic.planMedicoId IS NULL OR ic.planMedicoId = :plan)));

-- ¿Está libre el horario? (lo mismo que garantiza el índice parcial)
SELECT COUNT(*) FROM turnos
WHERE fecha = :fecha AND hora = :hora AND sedeId = :sede
  AND especialidadId = :especialidad AND medicoId = :medico
  AND estado IN ('pendiente', 'confirmado');

-- Vencimiento automático (se corre antes de leer turnos; ver 06-reglas-de-negocio.md)
UPDATE turnos SET estado = 'completado'
WHERE estado = 'confirmado' AND (fecha || ' ' || hora) < :ahora;
UPDATE turnos SET estado = 'rechazado'
WHERE estado = 'pendiente'  AND (fecha || ' ' || hora) < :ahora;

-- Recetas activas del paciente (pestaña Activas)
SELECT * FROM recetas
WHERE pacienteId = :paciente AND archivadoEl IS NULL AND vigenteHasta >= :hoy
ORDER BY vigenteHasta;

-- Una orden pasa a "listo" con el primer resultado (en la misma transacción que el INSERT del resultado)
UPDATE ordenes SET estado = 'listo' WHERE id = :orden AND estado = 'pendiente';
```

## `schema.prisma`

Se puede copiar tal cual a `backend/prisma/schema.prisma`.

```prisma
// DocApp Go — modelo de datos del Sprint 2 (Prisma + SQLite).
// Tablas en snake_case plural (@@map); columnas con el mismo nombre que los campos del frontend
// (src/domain/), así el JSON de la API coincide con los tipos sin traducir.
// SQLite no tiene ENUM: los estados son String y se restringen con CHECK en la migración
// (ver "SQL extra de la migración") y con uniones de tipos en TypeScript.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ───────────── Identidad y seguridad ─────────────

model Usuario {
  id            String   @id @default(uuid())
  /// DNI del login único (regla 11): 7 u 8 dígitos en todas las cuentas, también en la de administración.
  dni           String   @unique
  /// scrypt: "salt:hash" en hexadecimal. Nunca la contraseña en texto plano.
  passwordHash  String
  /// 'paciente' | 'doctor' | 'admin'. Lo determina la cuenta, no se elige al entrar.
  rol           String
  nombre        String
  apellido      String
  /// Foto de perfil (paciente o profesional): nombre del archivo en uploads/fotos/ ("<uuid>.jpg"), al azar y
  /// nuevo en cada foto. La API la sirve en /api/fotos/<fotoArchivo>. Null = sin foto (se ven las iniciales).
  fotoArchivo   String?  @unique
  /// Verificación de identidad del registro (28/10/2026): se escaneó el código PDF417 del DNI y coincidió con el
  /// DNI y el nombre de la cuenta. No se guarda la imagen ni el contenido del código: solo cuándo se verificó y un
  /// HMAC-SHA256 del número de trámite (con SECRETO_IDENTIDAD), para que un mismo DNI físico no abra dos cuentas.
  /// Null en las cuentas del seed y en la de admin.
  identidadVerificadaEl DateTime?
  tramiteHash   String?  @unique
  activo        Boolean  @default(true)
  creadoEn      DateTime @default(now())
  actualizadoEn DateTime @updatedAt

  paciente       Paciente?
  medico         Medico?
  sesiones       Sesion[]
  notificaciones Notificacion[]
  auditoria      RegistroAuditoria[]

  @@map("usuarios")
}

/// Token de sesión opaco. Se guarda solo su hash SHA-256: si se filtra la base, los tokens no sirven.
model Sesion {
  id          String    @id @default(uuid())
  usuarioId   String
  tokenHash   String    @unique
  creadaEn    DateTime  @default(now())
  expiraEn    DateTime
  ultimoUsoEn DateTime  @default(now())
  /// Logout o cierre forzado. Una sesión revocada no vuelve a valer aunque no haya vencido.
  revocadaEn  DateTime?
  dispositivo String?
  ip          String?
  /// Token FCM del teléfono de esta sesión, para los push. Un mismo token queda en una sola sesión.
  fcmToken    String?

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId])
  @@map("sesiones")
}

/// Registro de acciones importantes (§11): logins, cancelaciones, descargas de resultados, altas del admin.
model RegistroAuditoria {
  id        String   @id @default(uuid())
  usuarioId String?
  accion    String
  entidad   String?
  entidadId String?
  detalle   String?
  ip        String?
  creadoEn  DateTime @default(now())

  usuario Usuario? @relation(fields: [usuarioId], references: [id], onDelete: SetNull)

  @@index([usuarioId, creadoEn])
  @@map("registro_auditoria")
}

// ───────────── Cobertura ─────────────

/// Obra social o prepaga ("OSDE"). La carga el admin.
model ObraSocial {
  id            String  @id @default(uuid())
  nombre        String  @unique
  /// Nombre largo o aclaración ("Obra Social del Poder Judicial de la Nación"). Se muestra en los selectores.
  descripcion   String?
  /// 'RNAS' (obras sociales) | 'RNEMP' (prepagas) | 'otro'
  registro      String?
  codigoOficial String?
  activa        Boolean @default(true)

  planes        PlanMedico[]
  instituciones InstitucionCobertura[]
  medicos       MedicoCobertura[]

  @@map("obras_sociales")
}

/// Plan de una obra social ("OSDE 210"). Es el filtro transversal de la app (§5).
model PlanMedico {
  id           String  @id @default(uuid())
  obraSocialId String
  nombre       String
  activo       Boolean @default(true)

  obraSocial    ObraSocial        @relation(fields: [obraSocialId], references: [id])
  pacientes     Paciente[]
  instituciones InstitucionCobertura[]
  medicos       MedicoCobertura[]

  @@unique([obraSocialId, nombre])
  @@map("planes_medicos")
}

/// Qué coberturas acepta una institución privada o de seguridad social (reglas 1 y 15). Las públicas no
/// necesitan filas. planMedicoId null = todos los planes de esa obra social. Ver 08-coberturas.md.
model InstitucionCobertura {
  id            String  @id @default(uuid())
  institucionId String
  obraSocialId  String
  planMedicoId  String?
  /// 'web_institucion' | 'cartilla_cobertura' | 'relevamiento_propio'
  fuente        String
  /// Página consultada. Null solo con 'relevamiento_propio'.
  fuenteUrl     String?
  /// "yyyy-MM-dd" en que se verificó.
  verificadoEl  String

  institucion Institucion @relation(fields: [institucionId], references: [id], onDelete: Cascade)
  obraSocial  ObraSocial  @relation(fields: [obraSocialId], references: [id], onDelete: Cascade)
  plan        PlanMedico? @relation(fields: [planMedicoId], references: [id], onDelete: Cascade)

  @@unique([institucionId, obraSocialId, planMedicoId])
  @@index([obraSocialId])
  @@map("instituciones_coberturas")
}

// ───────────── Instituciones y geografía ─────────────

/// Hospital, clínica, centro médico o laboratorio.
model Institucion {
  id       String   @id @default(uuid())
  nombre   String
  /// 'hospital' | 'clinica' | 'centro_medico' | 'laboratorio'
  tipo     String
  /// 'publico' | 'privado' | 'seguridad_social' (REFES). Decide la regla 15.
  origen   String
  logoUrl  String?
  sitioWeb String?
  activa   Boolean  @default(true)
  creadaEn DateTime @default(now())

  sedes      Sede[]
  coberturas InstitucionCobertura[]
  favoritaDe PacienteInstitucionFavorita[]
  ordenes    Orden[]
  resultados Resultado[]

  @@index([origen])
  @@map("instituciones")
}

/// Ubicación física: nombre + dirección + latitud + longitud. Hoy, una por institución (REFES).
model Sede {
  id            String  @id @default(uuid())
  institucionId String
  nombre        String
  direccion     String
  ciudad        String
  latitud       Float
  longitud      Float
  telefono      String?
  /// establecimiento_id del REFES (14 dígitos). No lo tienen las altas del admin.
  refesId       String? @unique

  institucion Institucion      @relation(fields: [institucionId], references: [id], onDelete: Cascade)
  medicos     MedicoSede[]
  franjas     FranjaAtencion[]
  turnos      Turno[]

  @@index([institucionId])
  @@map("sedes")
}

// ───────────── Pacientes ─────────────

model Paciente {
  id             String  @id @default(uuid())
  usuarioId      String  @unique
  planMedicoId   String
  /// Reservados (§5): existen pero hoy no se piden ni se muestran.
  numeroAfiliado String?
  email          String?
  telefono       String?

  usuario                Usuario                       @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  plan                   PlanMedico                    @relation(fields: [planMedicoId], references: [id])
  medicosFavoritos       PacienteMedicoFavorito[]
  institucionesFavoritas PacienteInstitucionFavorita[]
  notas                  NotaPaciente[]
  turnos                 Turno[]
  ordenes                Orden[]
  recetas                Receta[]

  @@index([planMedicoId])
  @@map("pacientes")
}

model PacienteMedicoFavorito {
  pacienteId String
  medicoId   String

  paciente Paciente @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  medico   Medico   @relation(fields: [medicoId], references: [id], onDelete: Cascade)

  @@id([pacienteId, medicoId])
  @@map("pacientes_medicos_favoritos")
}

model PacienteInstitucionFavorita {
  pacienteId    String
  institucionId String

  paciente    Paciente    @relation(fields: [pacienteId], references: [id], onDelete: Cascade)
  institucion Institucion @relation(fields: [institucionId], references: [id], onDelete: Cascade)

  @@id([pacienteId, institucionId])
  @@map("pacientes_instituciones_favoritas")
}

// ───────────── Profesionales ─────────────

/// Copia del padrón nacional de profesionales. El registro valida la terna DNI + matrícula + profesión acá.
model ProfesionalPadron {
  id                String  @id @default(uuid())
  codigoProfesional String  @unique
  dni               String
  nombre            String
  apellido          String
  profesion         String
  /// SQLite no tiene listas: JSON con los nombres, p. ej. ["Cardiología"].
  especializaciones String  @default("[]")
  emisor            String
  provincia         String
  matricula         String
  estadoMatricula   String
  activo            Boolean

  medico Medico?

  @@unique([dni, matricula, profesion])
  @@map("profesionales_padron")
}

/// Perfil profesional: los datos del registro + lugares de atención. Sin horarios de atención (Sprint 2).
model Medico {
  id                String  @id @default(uuid())
  usuarioId         String  @unique
  padronId          String? @unique
  matricula         String
  /// "Médico", "Enfermero", ... (sale del padrón).
  profesion         String
  /// 'femenino' | 'masculino' — define "Dra." / "Dr.".
  genero            String
  especialidadId    String
  subespecialidadId String?
  descripcion       String  @default("")
  aniosExperiencia  Int?

  usuario         Usuario                  @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  padron          ProfesionalPadron?       @relation(fields: [padronId], references: [id])
  especialidad    Especialidad             @relation(fields: [especialidadId], references: [id])
  subespecialidad Subespecialidad?         @relation(fields: [subespecialidadId], references: [id])
  lugares         MedicoSede[]
  coberturas      MedicoCobertura[]
  franjas         FranjaAtencion[]
  favoritoDe      PacienteMedicoFavorito[]
  notas           NotaPaciente[]
  turnos          Turno[]
  ordenes         Orden[]
  recetas         Receta[]

  @@unique([matricula, profesion])
  @@index([especialidadId])
  @@map("medicos")
}

model Especialidad {
  id     String @id @default(uuid())
  nombre String @unique
  /// Profesión del padrón a la que pertenece ("Médico", "Enfermero", "Kinesiólogo"): el registro solo ofrece las
  /// de la profesión del profesional. Médicas: Res. 1814/2015; enfermería: Res. 199/2011 (Ministerio de Salud).
  profesion String @default("Médico")

  subespecialidades Subespecialidad[]
  medicos           Medico[]
  turnos            Turno[]

  @@map("especialidades")
}

model Subespecialidad {
  id             String @id @default(uuid())
  especialidadId String
  nombre         String

  especialidad Especialidad @relation(fields: [especialidadId], references: [id], onDelete: Cascade)
  medicos      Medico[]

  @@unique([especialidadId, nombre])
  @@map("subespecialidades")
}

/// Lugares de atención: en qué sedes (hospitales) atiende cada profesional.
model MedicoSede {
  medicoId String
  sedeId   String

  medico Medico @relation(fields: [medicoId], references: [id], onDelete: Cascade)
  sede   Sede   @relation(fields: [sedeId], references: [id], onDelete: Cascade)

  @@id([medicoId, sedeId])
  @@index([sedeId])
  @@map("medicos_sedes")
}

/// Franjas de atención: qué días y de qué hora a qué hora atiende el profesional en cada lugar. Las carga él
/// en su Agenda (no se muestran en el perfil). Se ofrecen turnos de 30 min dentro de cada franja.
model FranjaAtencion {
  id         String @id @default(uuid())
  medicoId   String
  sedeId     String
  /// 0 = domingo … 6 = sábado
  diaSemana  Int
  /// "HH:mm", múltiplo de 30 min
  desde      String
  /// "HH:mm", mayor que desde
  hasta      String

  medico Medico @relation(fields: [medicoId], references: [id], onDelete: Cascade)
  sede   Sede   @relation(fields: [sedeId], references: [id], onDelete: Cascade)

  @@index([medicoId, diaSemana])
  @@index([sedeId])
  @@map("franjas_atencion")
}

/// Coberturas que atiende cada profesional (regla 1). Las elige él en su Perfil. Misma lógica de plan opcional.
model MedicoCobertura {
  id           String  @id @default(uuid())
  medicoId     String
  obraSocialId String
  planMedicoId String?

  medico     Medico      @relation(fields: [medicoId], references: [id], onDelete: Cascade)
  obraSocial ObraSocial  @relation(fields: [obraSocialId], references: [id], onDelete: Cascade)
  plan       PlanMedico? @relation(fields: [planMedicoId], references: [id], onDelete: Cascade)

  @@unique([medicoId, obraSocialId, planMedicoId])
  @@index([obraSocialId])
  @@map("medicos_coberturas")
}

/// Nota privada de un profesional sobre un paciente: solo la ve quien la escribió.
model NotaPaciente {
  id         String   @id @default(uuid())
  medicoId   String
  pacienteId String
  texto      String
  creadaEn   DateTime @default(now())

  medico   Medico   @relation(fields: [medicoId], references: [id], onDelete: Cascade)
  paciente Paciente @relation(fields: [pacienteId], references: [id], onDelete: Cascade)

  @@index([medicoId, pacienteId])
  @@map("notas_paciente")
}

// ───────────── Turnos ─────────────

/// Fecha + hora + hospital (sede) + especialidad + médico: única entre los turnos activos (índice parcial).
/// Además, un médico no tiene dos turnos activos a la misma fecha y hora (turnos_medico_activo).
model Turno {
  id                String    @id @default(uuid())
  pacienteId        String
  medicoId          String
  sedeId            String
  /// La del médico al reservar. Se guarda porque es parte de la combinación única de las notas.
  especialidadId    String
  /// "yyyy-MM-dd"
  fecha             String
  /// "HH:mm"
  hora              String
  /// 'pendiente' | 'confirmado' | 'rechazado' | 'cancelado' | 'completado'
  estado            String    @default("pendiente")
  /// El paciente lo sacó de su historial. Solo se oculta en esa lista.
  ocultoEnHistorial Boolean   @default(false)
  creadoEn          DateTime  @default(now())
  actualizadoEn     DateTime  @updatedAt
  /// Cuándo el médico lo confirmó o rechazó.
  respondidoEn      DateTime?
  canceladoEn       DateTime?
  /// Al reprogramar: el turno (cancelado) que este reemplaza.
  reprogramadoDesdeId String? @unique

  paciente          Paciente     @relation(fields: [pacienteId], references: [id])
  medico            Medico       @relation(fields: [medicoId], references: [id])
  sede              Sede         @relation(fields: [sedeId], references: [id])
  especialidad      Especialidad @relation(fields: [especialidadId], references: [id])
  feedback          Feedback?
  reprogramadoDesde Turno?       @relation("Reprogramacion", fields: [reprogramadoDesdeId], references: [id])
  reprogramadoEn    Turno?       @relation("Reprogramacion")

  @@index([pacienteId, fecha])
  @@index([medicoId, fecha])
  @@index([estado, fecha])
  @@map("turnos")
}

// ───────────── Estudios: órdenes y resultados ─────────────

/// Orden que el médico le asigna al paciente, con indicaciones. Hospital + fecha + médico.
model Orden {
  id            String   @id @default(uuid())
  medicoId      String
  pacienteId    String
  /// Dónde hacer los estudios.
  institucionId String
  /// Fecha de emisión "yyyy-MM-dd".
  fecha         String
  indicaciones  String
  /// 'pendiente' | 'listo' (pasa a listo con el primer resultado)
  estado        String   @default("pendiente")
  /// "yyyy-MM-dd" en que el paciente la archivó; null = no archivada.
  archivadoEl   String?
  creadaEn      DateTime @default(now())

  medico      Medico         @relation(fields: [medicoId], references: [id])
  paciente    Paciente       @relation(fields: [pacienteId], references: [id])
  institucion Institucion    @relation(fields: [institucionId], references: [id])
  estudios    OrdenEstudio[]
  resultados  Resultado[]

  @@index([pacienteId, archivadoEl])
  @@index([medicoId, pacienteId])
  @@map("ordenes")
}

/// Cada estudio pedido en una orden ("Hemograma completo").
model OrdenEstudio {
  id       String @id @default(uuid())
  ordenId  String
  nombre   String
  posicion Int

  orden Orden @relation(fields: [ordenId], references: [id], onDelete: Cascade)

  @@unique([ordenId, posicion])
  @@map("orden_estudios")
}

/// Resultado: médico (el de la orden) + fecha + hospital + orden + archivo PDF. Sin estado.
model Resultado {
  id            String   @id @default(uuid())
  ordenId       String
  /// Dónde se hizo (puede no ser el sugerido en la orden).
  institucionId String
  /// Nombre del estudio ("Análisis de sangre completo").
  tipo          String
  /// Fecha del estudio "yyyy-MM-dd".
  fecha         String
  /// Ruta dentro de uploads/. Nunca se sirve como archivo estático: solo por GET autorizado.
  archivoRuta   String   @unique
  archivoBytes  Int
  archivoSha256 String
  /// "yyyy-MM-dd" en que el paciente lo archivó; null = no archivado.
  archivadoEl   String?
  cargadoEn     DateTime @default(now())

  orden       Orden       @relation(fields: [ordenId], references: [id])
  institucion Institucion @relation(fields: [institucionId], references: [id])

  @@index([ordenId])
  @@map("resultados")
}

// ───────────── Recetas ─────────────

/// Nombre (medicacion) + dosis + cómo tomarla (frecuencia) + duración + indicación + médico + fecha de emisión.
model Receta {
  id            String   @id @default(uuid())
  medicoId      String
  pacienteId    String
  /// Fecha de emisión "yyyy-MM-dd".
  fecha         String
  medicacion    String
  dosis         String
  frecuencia    String
  duracionDias  Int
  /// fecha + duracionDias. Activa mientras vigenteHasta >= hoy; después, pasada. El estado no se guarda.
  vigenteHasta  String
  indicaciones  String?
  observaciones String?
  /// "yyyy-MM-dd" en que el paciente la archivó (solo pasadas); null = no archivada.
  archivadoEl   String?
  creadaEn      DateTime @default(now())

  medico   Medico   @relation(fields: [medicoId], references: [id])
  paciente Paciente @relation(fields: [pacienteId], references: [id])

  @@index([pacienteId, vigenteHasta])
  @@index([medicoId, pacienteId])
  @@map("recetas")
}

// ───────────── Feedback y notificaciones ─────────────

/// Un feedback por turno completado (regla 6). El médico sale del turno.
model Feedback {
  id                  String   @id @default(uuid())
  turnoId             String   @unique
  /// "¿Cómo fue tu consulta?": la única calificación obligatoria (28/10/2026). Es la que da la valoración.
  estrellas           Int
  /// Criterios opcionales: null = el paciente no lo calificó.
  puntualidad         Int?
  atencion            Int?
  trato               Int?
  claridadExplicacion Int?
  experienciaGeneral  Int?
  comentario          String?
  /// Moderación del admin: oculto no cuenta en la valoración ni se muestra.
  oculto              Boolean  @default(false)
  creadoEn            DateTime @default(now())

  turno Turno @relation(fields: [turnoId], references: [id])

  @@map("feedbacks")
}

model Notificacion {
  id             String   @id @default(uuid())
  usuarioId      String
  /// 'recordatorio_turno' | 'turno_confirmado' | 'turno_rechazado' | 'turno_cancelado' |
  /// 'resultado_disponible' | 'nueva_receta' | 'nueva_orden'
  tipo           String
  titulo         String
  mensaje        String
  leida          Boolean  @default(false)
  /// A qué apunta: 'turno' | 'orden' | 'resultado' | 'receta' + su id.
  referenciaTipo String?
  referenciaId   String?
  creadaEn       DateTime @default(now())

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId, leida])
  @@map("notificaciones")
}
```

## SQL extra de la migración

Prisma no sabe declarar índices parciales ni restricciones de valores en SQLite. Se agregan a mano en la
primera migración:

1. `npx prisma migrate dev --name inicial --create-only` (crea el archivo de migración **sin** aplicarlo).
2. Pegar este SQL al final de `prisma/migrations/<fecha>_inicial/migration.sql`.
3. `npx prisma migrate dev` (la aplica).

> **Ojo:** si una migración futura cambia la tabla `turnos` (u otra de las que tienen triggers), Prisma en
> SQLite la recrea y se pierden el índice parcial y los triggers de esa tabla. Después de cada migración,
> revisar con `sqlite3 prisma/dev.db ".schema turnos"` y, si faltan, volver a agregarlos en esa misma
> migración. Por eso el servicio de turnos **también** verifica la disponibilidad dentro de la transacción:
> la base es la última barrera, no la única.

```sql
-- Regla 4: fecha + hora + hospital + especialidad + médico, única entre los turnos activos.
-- Un turno cancelado o rechazado (o ya completado) deja de contar y libera el horario.
CREATE UNIQUE INDEX "turnos_combinacion_activa"
  ON "turnos" ("fecha", "hora", "sedeId", "especialidadId", "medicoId")
  WHERE "estado" IN ('pendiente', 'confirmado');

-- Un profesional no puede tener dos turnos activos a la misma fecha y hora, aunque sea en otro lugar.
CREATE UNIQUE INDEX "turnos_medico_activo"
  ON "turnos" ("medicoId", "fecha", "hora")
  WHERE "estado" IN ('pendiente', 'confirmado');

-- Franjas: día de la semana válido y desde < hasta (formato "HH:mm", se compara como texto).
CREATE TRIGGER "franjas_validas_ins" BEFORE INSERT ON "franjas_atencion"
WHEN NEW."diaSemana" NOT BETWEEN 0 AND 6 OR NEW."desde" >= NEW."hasta"
  OR NEW."desde" NOT GLOB '[0-2][0-9]:[03]0' OR NEW."hasta" NOT GLOB '[0-2][0-9]:[03]0'
BEGIN SELECT RAISE(ABORT, 'franja inválida'); END;

-- Coberturas (08-coberturas.md): en SQLite los NULL no chocan en un UNIQUE, así que la fila
-- "todos los planes" (planMedicoId NULL) necesita su propio índice parcial.
CREATE UNIQUE INDEX "instituciones_coberturas_todos_los_planes"
  ON "instituciones_coberturas" ("institucionId", "obraSocialId") WHERE "planMedicoId" IS NULL;
CREATE UNIQUE INDEX "medicos_coberturas_todos_los_planes"
  ON "medicos_coberturas" ("medicoId", "obraSocialId") WHERE "planMedicoId" IS NULL;

-- El plan de una cobertura tiene que ser de esa obra social.
CREATE TRIGGER "instituciones_coberturas_plan_de_la_obra_social" BEFORE INSERT ON "instituciones_coberturas"
WHEN NEW."planMedicoId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "planes_medicos" p WHERE p."id" = NEW."planMedicoId" AND p."obraSocialId" = NEW."obraSocialId")
BEGIN SELECT RAISE(ABORT, 'el plan no es de esa obra social'); END;

CREATE TRIGGER "medicos_coberturas_plan_de_la_obra_social" BEFORE INSERT ON "medicos_coberturas"
WHEN NEW."planMedicoId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "planes_medicos" p WHERE p."id" = NEW."planMedicoId" AND p."obraSocialId" = NEW."obraSocialId")
BEGIN SELECT RAISE(ABORT, 'el plan no es de esa obra social'); END;

CREATE TRIGGER "instituciones_coberturas_fuente_valida" BEFORE INSERT ON "instituciones_coberturas"
WHEN NEW."fuente" NOT IN ('web_institucion', 'cartilla_cobertura', 'relevamiento_propio')
BEGIN SELECT RAISE(ABORT, 'fuente inválida'); END;

-- Valores permitidos. SQLite no tiene ENUM ni permite agregar CHECK con ALTER TABLE, así que se usan
-- triggers que abortan el INSERT o el UPDATE (hacen lo mismo que un CHECK).

CREATE TRIGGER "usuarios_rol_valido_ins" BEFORE INSERT ON "usuarios"
WHEN NEW."rol" NOT IN ('paciente', 'doctor', 'admin')
BEGIN SELECT RAISE(ABORT, 'rol inválido'); END;

CREATE TRIGGER "usuarios_rol_valido_upd" BEFORE UPDATE OF "rol" ON "usuarios"
WHEN NEW."rol" NOT IN ('paciente', 'doctor', 'admin')
BEGIN SELECT RAISE(ABORT, 'rol inválido'); END;

CREATE TRIGGER "instituciones_tipo_valido_ins" BEFORE INSERT ON "instituciones"
WHEN NEW."tipo" NOT IN ('hospital', 'clinica', 'centro_medico', 'laboratorio')
BEGIN SELECT RAISE(ABORT, 'tipo de institución inválido'); END;

CREATE TRIGGER "instituciones_tipo_valido_upd" BEFORE UPDATE OF "tipo" ON "instituciones"
WHEN NEW."tipo" NOT IN ('hospital', 'clinica', 'centro_medico', 'laboratorio')
BEGIN SELECT RAISE(ABORT, 'tipo de institución inválido'); END;

CREATE TRIGGER "instituciones_origen_valido_ins" BEFORE INSERT ON "instituciones"
WHEN NEW."origen" NOT IN ('publico', 'privado', 'seguridad_social')
BEGIN SELECT RAISE(ABORT, 'origen inválido'); END;

CREATE TRIGGER "instituciones_origen_valido_upd" BEFORE UPDATE OF "origen" ON "instituciones"
WHEN NEW."origen" NOT IN ('publico', 'privado', 'seguridad_social')
BEGIN SELECT RAISE(ABORT, 'origen inválido'); END;

CREATE TRIGGER "medicos_genero_valido_ins" BEFORE INSERT ON "medicos"
WHEN NEW."genero" NOT IN ('femenino', 'masculino')
BEGIN SELECT RAISE(ABORT, 'género inválido'); END;

CREATE TRIGGER "medicos_genero_valido_upd" BEFORE UPDATE OF "genero" ON "medicos"
WHEN NEW."genero" NOT IN ('femenino', 'masculino')
BEGIN SELECT RAISE(ABORT, 'género inválido'); END;

CREATE TRIGGER "turnos_estado_valido_ins" BEFORE INSERT ON "turnos"
WHEN NEW."estado" NOT IN ('pendiente', 'confirmado', 'rechazado', 'cancelado', 'completado')
BEGIN SELECT RAISE(ABORT, 'estado de turno inválido'); END;

CREATE TRIGGER "turnos_estado_valido_upd" BEFORE UPDATE OF "estado" ON "turnos"
WHEN NEW."estado" NOT IN ('pendiente', 'confirmado', 'rechazado', 'cancelado', 'completado')
BEGIN SELECT RAISE(ABORT, 'estado de turno inválido'); END;

CREATE TRIGGER "turnos_fecha_valido_ins" BEFORE INSERT ON "turnos"
WHEN NEW."fecha" NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' OR NEW."hora" NOT GLOB '[0-2][0-9]:[0-5][0-9]'
BEGIN SELECT RAISE(ABORT, 'fecha u hora con formato inválido'); END;

CREATE TRIGGER "turnos_fecha_valido_upd" BEFORE UPDATE OF "fecha", "hora" ON "turnos"
WHEN NEW."fecha" NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' OR NEW."hora" NOT GLOB '[0-2][0-9]:[0-5][0-9]'
BEGIN SELECT RAISE(ABORT, 'fecha u hora con formato inválido'); END;

CREATE TRIGGER "ordenes_estado_valido_ins" BEFORE INSERT ON "ordenes"
WHEN NEW."estado" NOT IN ('pendiente', 'listo')
BEGIN SELECT RAISE(ABORT, 'estado de orden inválido'); END;

CREATE TRIGGER "ordenes_estado_valido_upd" BEFORE UPDATE OF "estado" ON "ordenes"
WHEN NEW."estado" NOT IN ('pendiente', 'listo')
BEGIN SELECT RAISE(ABORT, 'estado de orden inválido'); END;

CREATE TRIGGER "recetas_duracionDias_valido_ins" BEFORE INSERT ON "recetas"
WHEN NEW."duracionDias" NOT BETWEEN 1 AND 365
BEGIN SELECT RAISE(ABORT, 'la duración tiene que ser de 1 a 365 días'); END;

CREATE TRIGGER "recetas_duracionDias_valido_upd" BEFORE UPDATE OF "duracionDias" ON "recetas"
WHEN NEW."duracionDias" NOT BETWEEN 1 AND 365
BEGIN SELECT RAISE(ABORT, 'la duración tiene que ser de 1 a 365 días'); END;

CREATE TRIGGER "feedbacks_estrellas_valido_ins" BEFORE INSERT ON "feedbacks"
WHEN NEW."estrellas" NOT BETWEEN 1 AND 5 OR NEW."puntualidad" NOT BETWEEN 1 AND 5 OR NEW."atencion" NOT BETWEEN 1 AND 5 OR NEW."trato" NOT BETWEEN 1 AND 5 OR NEW."claridadExplicacion" NOT BETWEEN 1 AND 5 OR NEW."experienciaGeneral" NOT BETWEEN 1 AND 5
BEGIN SELECT RAISE(ABORT, 'las calificaciones van de 1 a 5'); END;

CREATE TRIGGER "feedbacks_estrellas_valido_upd" BEFORE UPDATE OF "atencion", "claridadExplicacion", "estrellas", "experienciaGeneral", "puntualidad", "trato" ON "feedbacks"
WHEN NEW."estrellas" NOT BETWEEN 1 AND 5 OR NEW."puntualidad" NOT BETWEEN 1 AND 5 OR NEW."atencion" NOT BETWEEN 1 AND 5 OR NEW."trato" NOT BETWEEN 1 AND 5 OR NEW."claridadExplicacion" NOT BETWEEN 1 AND 5 OR NEW."experienciaGeneral" NOT BETWEEN 1 AND 5
BEGIN SELECT RAISE(ABORT, 'las calificaciones van de 1 a 5'); END;
```

## Datos iniciales (seed)

`npm run db:seed` (`backend/src/seed.ts`) **borra la base y la vuelve a cargar** con lo mismo que usaban los
mocks del frontend, **con los mismos ids** (`pac-sofia`, `med-sosa`, `plan-osde210`, `refes-…`), para que la
app muestre lo mismo mientras los services se pasan a la API módulo por módulo. Los datos están en
`backend/prisma/datos/demo.json`, exportado de los mocks el 27/10/2026 (ahora es la fuente: los mocks de los módulos conectados se borraron del frontend): las fechas son relativas a ese día y el
seed las corre a la fecha en que se ejecuta (un turno "en 4 días" sigue estando en 4 días).

| Qué | Cuánto |
|---|---|
| Obras sociales y planes | 26 y 80 ([08-coberturas.md](08-coberturas.md#catálogo-inicial)). |
| Instituciones y sedes | 1.077 establecimientos reales del REFES (CABA), con las coberturas verificadas de 9 ([08](08-coberturas.md#seed-de-coberturas)). |
| Especialidades, padrón | 78 especialidades con su profesión (Res. 1814/2015 y 199/2011); 6 fichas de padrón de prueba. |
| Feedback | 27 opiniones de turnos cumplidos (24 turnos pasados agregados para eso): de ahí salen la valoración de cada profesional y el ranking del admin. Algunas solo con estrellas, otras con criterios. |
| Usuarios | El administrador, 6 pacientes y 10 profesionales, con la contraseña hasheada (cuentas en `frontend/USUARIOS-DE-PRUEBA.md`). |
| Profesionales | Lugares, coberturas (obra social entera) y franjas de atención de los mocks. |
| Turnos, órdenes, recetas, notas, notificaciones | Los de los mocks. |
| Resultados | 3, con un PDF de ejemplo generado por el seed en `backend/uploads/resultados/` (fuera de git). En este sprint es la única forma de cargar resultados. |
| Fotos de perfil | Méndez y Ruiz, desde `backend/prisma/datos/fotos/<medicoId>.jpg` (Unsplash, de uso libre). El seed las copia a `uploads/fotos/` con nombre al azar, como una subida real. El resto de las cuentas arranca sin foto. |

## Qué cambió respecto del diagrama de agosto

| Antes | Ahora | Por qué |
|---|---|---|
| Login con `email` | Login con **`dni`** | Regla 11: DNI + contraseña para los tres roles. |
| `administradores` con nivel de acceso | Rol `admin` en `usuarios` | Hoy hay un solo admin general. |
| `tipos_consulta` y `turnos.tipo_consulta_id` | **Eliminados** | Se sacó el tipo de consulta de toda la app. |
| `turnos` único por `(medico, sede, fecha, hora)` | Único por **fecha + hora + sede + especialidad + médico**, solo entre activos | Notas del Sprint 2; un cancelado o rechazado libera el horario. |
| Estados `reprogramado` y sin `rechazado` | `pendiente` · `confirmado` · `rechazado` · `cancelado` · `completado` | Estados definidos en el Sprint 2. |
| `horarios_disponibilidad`, `consultorios`, `sedes.horario_atencion` | **Eliminados**; en su lugar `franjas_atencion` (27/10/2026) | Los horarios salen del perfil; el profesional carga sus franjas por lugar y día en la Agenda. |
| `estudios` con estado `pendiente/agendado/realizado/resultado_disponible` | `resultados` **sin estado** | El "Listo" es solo un aviso del frontend. |
| Orden `pendiente/parcial/completada` | Orden **`pendiente/listo`** | Notas del Sprint 2. |
| `tipos_estudio` + `orden_estudios` N:M | `orden_estudios` con el nombre del estudio | La orden se escribe a mano; no hay catálogo de estudios todavía. |
| `recetas` + `receta_items` | Una medicación por receta | Así la emite el profesional en la app. |
| — | `archivadoEl` en órdenes, resultados y recetas | Todo se puede archivar. |
| `planes_medicos` sueltos | `obras_sociales` → `planes_medicos` | El admin carga obras sociales; el filtro es por plan. |
| `medicos.avatarUrl` (URL externa) | `usuarios.fotoArchivo` (27/10/2026) | Pacientes y profesionales suben su foto desde el Perfil; se guarda como archivo en el servidor. |
| `instituciones_planes`, `medicos_planes` (por plan) | `instituciones_coberturas`, `medicos_coberturas`: obra social + plan opcional, con fuente y fecha | Las fuentes reales informan por obra social y a veces por plan (27/10/2026, [08](08-coberturas.md)). |
| — | `profesionales_padron`, `notas_paciente` | Registro de profesionales contra el padrón y notas privadas. |
| — | `sesiones.fcmToken` (29/10/2026) | Las notificaciones también llegan como push al teléfono de cada sesión abierta. |
