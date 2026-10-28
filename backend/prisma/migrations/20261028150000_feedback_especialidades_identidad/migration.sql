-- 28/10/2026, tres cambios:
--  1. Feedback: solo "¿Cómo fue tu consulta?" (estrellas) es obligatoria; los cinco criterios pasan a opcionales.
--  2. Especialidades: cada una es de una profesión del padrón (el registro filtra por profesión).
--  3. Usuarios: verificación de identidad con el código PDF417 del DNI (fecha + HMAC del número de trámite).
-- SQLite no cambia la nulabilidad de una columna: Prisma rehace las tablas y con eso se pierden los triggers de
-- feedbacks, que se vuelven a crear al final (los NULL pasan: NULL NOT BETWEEN 1 AND 5 no es verdadero).

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "identidadVerificadaEl" DATETIME;
ALTER TABLE "usuarios" ADD COLUMN "tramiteHash" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_especialidades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "profesion" TEXT NOT NULL DEFAULT 'Médico'
);
INSERT INTO "new_especialidades" ("id", "nombre") SELECT "id", "nombre" FROM "especialidades";
DROP TABLE "especialidades";
ALTER TABLE "new_especialidades" RENAME TO "especialidades";
CREATE UNIQUE INDEX "especialidades_nombre_key" ON "especialidades"("nombre");
UPDATE "especialidades" SET "profesion" = 'Enfermero' WHERE "id" = 'esp-enfermeria';
CREATE TABLE "new_feedbacks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "turnoId" TEXT NOT NULL,
    "estrellas" INTEGER NOT NULL,
    "puntualidad" INTEGER,
    "atencion" INTEGER,
    "trato" INTEGER,
    "claridadExplicacion" INTEGER,
    "experienciaGeneral" INTEGER,
    "comentario" TEXT,
    "oculto" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feedbacks_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_feedbacks" ("atencion", "claridadExplicacion", "comentario", "creadoEn", "estrellas", "experienciaGeneral", "id", "oculto", "puntualidad", "trato", "turnoId") SELECT "atencion", "claridadExplicacion", "comentario", "creadoEn", "estrellas", "experienciaGeneral", "id", "oculto", "puntualidad", "trato", "turnoId" FROM "feedbacks";
DROP TABLE "feedbacks";
ALTER TABLE "new_feedbacks" RENAME TO "feedbacks";
CREATE UNIQUE INDEX "feedbacks_turnoId_key" ON "feedbacks"("turnoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_tramiteHash_key" ON "usuarios"("tramiteHash");


-- Triggers de feedbacks (los de la migración inicial), otra vez: las calificaciones que vienen van de 1 a 5.
DROP TRIGGER IF EXISTS "feedbacks_estrellas_valido_ins";
CREATE TRIGGER "feedbacks_estrellas_valido_ins" BEFORE INSERT ON "feedbacks"
WHEN NEW."estrellas" IS NULL OR NEW."estrellas" NOT BETWEEN 1 AND 5 OR NEW."puntualidad" NOT BETWEEN 1 AND 5 OR NEW."atencion" NOT BETWEEN 1 AND 5 OR NEW."trato" NOT BETWEEN 1 AND 5 OR NEW."claridadExplicacion" NOT BETWEEN 1 AND 5 OR NEW."experienciaGeneral" NOT BETWEEN 1 AND 5
BEGIN SELECT RAISE(ABORT, 'las calificaciones van de 1 a 5'); END;

DROP TRIGGER IF EXISTS "feedbacks_estrellas_valido_upd";
CREATE TRIGGER "feedbacks_estrellas_valido_upd" BEFORE UPDATE OF "atencion", "claridadExplicacion", "estrellas", "experienciaGeneral", "puntualidad", "trato" ON "feedbacks"
WHEN NEW."estrellas" IS NULL OR NEW."estrellas" NOT BETWEEN 1 AND 5 OR NEW."puntualidad" NOT BETWEEN 1 AND 5 OR NEW."atencion" NOT BETWEEN 1 AND 5 OR NEW."trato" NOT BETWEEN 1 AND 5 OR NEW."claridadExplicacion" NOT BETWEEN 1 AND 5 OR NEW."experienciaGeneral" NOT BETWEEN 1 AND 5
BEGIN SELECT RAISE(ABORT, 'las calificaciones van de 1 a 5'); END;

-- El hash del trámite es hexadecimal de 64 caracteres (HMAC-SHA256).
CREATE TRIGGER "usuarios_tramite_valido_ins" BEFORE INSERT ON "usuarios"
WHEN NEW."tramiteHash" IS NOT NULL AND (length(NEW."tramiteHash") <> 64 OR NEW."tramiteHash" GLOB '*[^0-9a-f]*')
BEGIN SELECT RAISE(ABORT, 'hash de trámite inválido'); END;

CREATE TRIGGER "usuarios_tramite_valido_upd" BEFORE UPDATE OF "tramiteHash" ON "usuarios"
WHEN NEW."tramiteHash" IS NOT NULL AND (length(NEW."tramiteHash") <> 64 OR NEW."tramiteHash" GLOB '*[^0-9a-f]*')
BEGIN SELECT RAISE(ABORT, 'hash de trámite inválido'); END;
