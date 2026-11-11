-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dni" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" DATETIME NOT NULL,
    "ultimoUsoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocadaEn" DATETIME,
    "dispositivo" TEXT,
    "ip" TEXT,
    CONSTRAINT "sesiones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT,
    "entidadId" TEXT,
    "detalle" TEXT,
    "ip" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "registro_auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "claves_integracion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "institucionId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "claveHash" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEn" DATETIME,
    CONSTRAINT "claves_integracion_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "obras_sociales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "registro" TEXT,
    "codigoOficial" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "planes_medicos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "obraSocialId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "planes_medicos_obraSocialId_fkey" FOREIGN KEY ("obraSocialId") REFERENCES "obras_sociales" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "instituciones_coberturas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "institucionId" TEXT NOT NULL,
    "obraSocialId" TEXT NOT NULL,
    "planMedicoId" TEXT,
    "fuente" TEXT NOT NULL,
    "fuenteUrl" TEXT,
    "verificadoEl" TEXT NOT NULL,
    CONSTRAINT "instituciones_coberturas_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "instituciones_coberturas_obraSocialId_fkey" FOREIGN KEY ("obraSocialId") REFERENCES "obras_sociales" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "instituciones_coberturas_planMedicoId_fkey" FOREIGN KEY ("planMedicoId") REFERENCES "planes_medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "instituciones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "logoUrl" TEXT,
    "sitioWeb" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sedes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "institucionId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "latitud" REAL NOT NULL,
    "longitud" REAL NOT NULL,
    "telefono" TEXT,
    "refesId" TEXT,
    CONSTRAINT "sedes_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "planMedicoId" TEXT NOT NULL,
    "numeroAfiliado" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    CONSTRAINT "pacientes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pacientes_planMedicoId_fkey" FOREIGN KEY ("planMedicoId") REFERENCES "planes_medicos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pacientes_medicos_favoritos" (
    "pacienteId" TEXT NOT NULL,
    "medicoId" TEXT NOT NULL,
    PRIMARY KEY ("pacienteId", "medicoId"),
    CONSTRAINT "pacientes_medicos_favoritos_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pacientes_medicos_favoritos_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pacientes_instituciones_favoritas" (
    "pacienteId" TEXT NOT NULL,
    "institucionId" TEXT NOT NULL,
    PRIMARY KEY ("pacienteId", "institucionId"),
    CONSTRAINT "pacientes_instituciones_favoritas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pacientes_instituciones_favoritas_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "profesionales_padron" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigoProfesional" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "profesion" TEXT NOT NULL,
    "especializaciones" TEXT NOT NULL DEFAULT '[]',
    "emisor" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "matricula" TEXT NOT NULL,
    "estadoMatricula" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "medicos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "padronId" TEXT,
    "matricula" TEXT NOT NULL,
    "profesion" TEXT NOT NULL,
    "genero" TEXT NOT NULL,
    "especialidadId" TEXT NOT NULL,
    "subespecialidadId" TEXT,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "aniosExperiencia" INTEGER,
    "avatarUrl" TEXT,
    CONSTRAINT "medicos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "medicos_padronId_fkey" FOREIGN KEY ("padronId") REFERENCES "profesionales_padron" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "medicos_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "especialidades" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medicos_subespecialidadId_fkey" FOREIGN KEY ("subespecialidadId") REFERENCES "subespecialidades" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "especialidades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "subespecialidades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "especialidadId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "subespecialidades_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "especialidades" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "medicos_sedes" (
    "medicoId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    PRIMARY KEY ("medicoId", "sedeId"),
    CONSTRAINT "medicos_sedes_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "medicos_sedes_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "franjas_atencion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicoId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "desde" TEXT NOT NULL,
    "hasta" TEXT NOT NULL,
    CONSTRAINT "franjas_atencion_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "franjas_atencion_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "medicos_coberturas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicoId" TEXT NOT NULL,
    "obraSocialId" TEXT NOT NULL,
    "planMedicoId" TEXT,
    CONSTRAINT "medicos_coberturas_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "medicos_coberturas_obraSocialId_fkey" FOREIGN KEY ("obraSocialId") REFERENCES "obras_sociales" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "medicos_coberturas_planMedicoId_fkey" FOREIGN KEY ("planMedicoId") REFERENCES "planes_medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notas_paciente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notas_paciente_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notas_paciente_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pacienteId" TEXT NOT NULL,
    "medicoId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "especialidadId" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "hora" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "ocultoEnHistorial" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    "respondidoEn" DATETIME,
    "canceladoEn" DATETIME,
    "reprogramadoDesdeId" TEXT,
    CONSTRAINT "turnos_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "turnos_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "turnos_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "turnos_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "especialidades" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "turnos_reprogramadoDesdeId_fkey" FOREIGN KEY ("reprogramadoDesdeId") REFERENCES "turnos" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ordenes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "institucionId" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "indicaciones" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "archivadoEl" TEXT,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ordenes_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ordenes_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ordenes_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orden_estudios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ordenId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    CONSTRAINT "orden_estudios_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resultados" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ordenId" TEXT NOT NULL,
    "institucionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "archivoRuta" TEXT NOT NULL,
    "archivoBytes" INTEGER NOT NULL,
    "archivoSha256" TEXT NOT NULL,
    "claveIntegracionId" TEXT,
    "archivadoEl" TEXT,
    "cargadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resultados_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "resultados_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "resultados_claveIntegracionId_fkey" FOREIGN KEY ("claveIntegracionId") REFERENCES "claves_integracion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recetas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicoId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "medicacion" TEXT NOT NULL,
    "dosis" TEXT NOT NULL,
    "frecuencia" TEXT NOT NULL,
    "duracionDias" INTEGER NOT NULL,
    "vigenteHasta" TEXT NOT NULL,
    "indicaciones" TEXT,
    "observaciones" TEXT,
    "archivadoEl" TEXT,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recetas_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "medicos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "recetas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "turnoId" TEXT NOT NULL,
    "estrellas" INTEGER NOT NULL,
    "puntualidad" INTEGER NOT NULL,
    "atencion" INTEGER NOT NULL,
    "trato" INTEGER NOT NULL,
    "claridadExplicacion" INTEGER NOT NULL,
    "experienciaGeneral" INTEGER NOT NULL,
    "comentario" TEXT,
    "oculto" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feedbacks_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "creadaEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notificaciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_dni_key" ON "usuarios" ("dni");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_tokenHash_key" ON "sesiones" ("tokenHash");

-- CreateIndex
CREATE INDEX "sesiones_usuarioId_idx" ON "sesiones" ("usuarioId");

-- CreateIndex
CREATE INDEX "registro_auditoria_usuarioId_creadoEn_idx" ON "registro_auditoria" ("usuarioId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "claves_integracion_claveHash_key" ON "claves_integracion" ("claveHash");

-- CreateIndex
CREATE UNIQUE INDEX "obras_sociales_nombre_key" ON "obras_sociales" ("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "planes_medicos_obraSocialId_nombre_key" ON "planes_medicos" ("obraSocialId", "nombre");

-- CreateIndex
CREATE INDEX "instituciones_coberturas_obraSocialId_idx" ON "instituciones_coberturas" ("obraSocialId");

-- CreateIndex
CREATE UNIQUE INDEX "instituciones_coberturas_institucionId_obraSocialId_planMedicoId_key" ON "instituciones_coberturas" (
    "institucionId",
    "obraSocialId",
    "planMedicoId"
);

-- CreateIndex
CREATE INDEX "instituciones_origen_idx" ON "instituciones" ("origen");

-- CreateIndex
CREATE UNIQUE INDEX "sedes_refesId_key" ON "sedes" ("refesId");

-- CreateIndex
CREATE INDEX "sedes_institucionId_idx" ON "sedes" ("institucionId");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_usuarioId_key" ON "pacientes" ("usuarioId");

-- CreateIndex
CREATE INDEX "pacientes_planMedicoId_idx" ON "pacientes" ("planMedicoId");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_padron_codigoProfesional_key" ON "profesionales_padron" ("codigoProfesional");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_padron_dni_matricula_profesion_key" ON "profesionales_padron" (
    "dni",
    "matricula",
    "profesion"
);

-- CreateIndex
CREATE UNIQUE INDEX "medicos_usuarioId_key" ON "medicos" ("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "medicos_padronId_key" ON "medicos" ("padronId");

-- CreateIndex
CREATE INDEX "medicos_especialidadId_idx" ON "medicos" ("especialidadId");

-- CreateIndex
CREATE UNIQUE INDEX "medicos_matricula_profesion_key" ON "medicos" ("matricula", "profesion");

-- CreateIndex
CREATE UNIQUE INDEX "especialidades_nombre_key" ON "especialidades" ("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "subespecialidades_especialidadId_nombre_key" ON "subespecialidades" ("especialidadId", "nombre");

-- CreateIndex
CREATE INDEX "medicos_sedes_sedeId_idx" ON "medicos_sedes" ("sedeId");

-- CreateIndex
CREATE INDEX "franjas_atencion_medicoId_diaSemana_idx" ON "franjas_atencion" ("medicoId", "diaSemana");

-- CreateIndex
CREATE INDEX "franjas_atencion_sedeId_idx" ON "franjas_atencion" ("sedeId");

-- CreateIndex
CREATE INDEX "medicos_coberturas_obraSocialId_idx" ON "medicos_coberturas" ("obraSocialId");

-- CreateIndex
CREATE UNIQUE INDEX "medicos_coberturas_medicoId_obraSocialId_planMedicoId_key" ON "medicos_coberturas" (
    "medicoId",
    "obraSocialId",
    "planMedicoId"
);

-- CreateIndex
CREATE INDEX "notas_paciente_medicoId_pacienteId_idx" ON "notas_paciente" ("medicoId", "pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_reprogramadoDesdeId_key" ON "turnos" ("reprogramadoDesdeId");

-- CreateIndex
CREATE INDEX "turnos_pacienteId_fecha_idx" ON "turnos" ("pacienteId", "fecha");

-- CreateIndex
CREATE INDEX "turnos_medicoId_fecha_idx" ON "turnos" ("medicoId", "fecha");

-- CreateIndex
CREATE INDEX "turnos_estado_fecha_idx" ON "turnos" ("estado", "fecha");

-- CreateIndex
CREATE INDEX "ordenes_pacienteId_archivadoEl_idx" ON "ordenes" ("pacienteId", "archivadoEl");

-- CreateIndex
CREATE INDEX "ordenes_medicoId_pacienteId_idx" ON "ordenes" ("medicoId", "pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "orden_estudios_ordenId_posicion_key" ON "orden_estudios" ("ordenId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "resultados_archivoRuta_key" ON "resultados" ("archivoRuta");

-- CreateIndex
CREATE INDEX "resultados_ordenId_idx" ON "resultados" ("ordenId");

-- CreateIndex
CREATE INDEX "recetas_pacienteId_vigenteHasta_idx" ON "recetas" ("pacienteId", "vigenteHasta");

-- CreateIndex
CREATE INDEX "recetas_medicoId_pacienteId_idx" ON "recetas" ("medicoId", "pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "feedbacks_turnoId_key" ON "feedbacks" ("turnoId");

-- CreateIndex
CREATE INDEX "notificaciones_usuarioId_leida_idx" ON "notificaciones" ("usuarioId", "leida");

-- ───────────── SQL extra (docs/03-base-de-datos.md#sql-extra-de-la-migración) ─────────────
-- Prisma no declara índices parciales ni restricciones de valores en SQLite: van a mano.
-- Regla 4: fecha + hora + hospital + especialidad + médico, única entre los turnos activos.
-- Un turno cancelado o rechazado (o ya completado) deja de contar y libera el horario.
CREATE UNIQUE INDEX "turnos_combinacion_activa" ON "turnos" (
    "fecha",
    "hora",
    "sedeId",
    "especialidadId",
    "medicoId"
)
WHERE
    "estado" IN ('pendiente', 'confirmado');

-- Un profesional no puede tener dos turnos activos a la misma fecha y hora, aunque sea en otro lugar.
CREATE UNIQUE INDEX "turnos_medico_activo" ON "turnos" ("medicoId", "fecha", "hora")
WHERE
    "estado" IN ('pendiente', 'confirmado');

-- Franjas: día de la semana válido y desde < hasta (formato "HH:mm", se compara como texto).
CREATE TRIGGER "franjas_validas_ins" BEFORE INSERT ON "franjas_atencion"
WHEN NEW."diaSemana" NOT BETWEEN 0 AND 6 OR NEW."desde" >= NEW."hasta"
BEGIN SELECT RAISE(ABORT, 'franja inválida'); END;

-- Coberturas (08-coberturas.md): en SQLite los NULL no chocan en un UNIQUE, así que la fila
-- "todos los planes" (planMedicoId NULL) necesita su propio índice parcial.
CREATE UNIQUE INDEX "instituciones_coberturas_todos_los_planes" ON "instituciones_coberturas" (
    "institucionId",
    "obraSocialId"
)
WHERE
    "planMedicoId" IS NULL;

CREATE UNIQUE INDEX "medicos_coberturas_todos_los_planes" ON "medicos_coberturas" ("medicoId", "obraSocialId")
WHERE
    "planMedicoId" IS NULL;

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