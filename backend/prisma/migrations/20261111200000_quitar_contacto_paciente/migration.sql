-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_pacientes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "planMedicoId" TEXT NOT NULL,
    CONSTRAINT "pacientes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pacientes_planMedicoId_fkey" FOREIGN KEY ("planMedicoId") REFERENCES "planes_medicos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_pacientes" ("id", "planMedicoId", "usuarioId") SELECT "id", "planMedicoId", "usuarioId" FROM "pacientes";
DROP TABLE "pacientes";
ALTER TABLE "new_pacientes" RENAME TO "pacientes";
CREATE UNIQUE INDEX "pacientes_usuarioId_key" ON "pacientes"("usuarioId");
CREATE INDEX "pacientes_planMedicoId_idx" ON "pacientes"("planMedicoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

