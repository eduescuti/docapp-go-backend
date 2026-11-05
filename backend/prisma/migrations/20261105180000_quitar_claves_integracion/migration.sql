-- La carga de PDF por un tercero (con clave de integración) no se implementó: se saca la tabla y la columna
-- resultados.claveIntegracionId, que estaban vacías. Si se implementa, vuelven en una migración nueva.

-- DropIndex
DROP INDEX "claves_integracion_claveHash_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "claves_integracion";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_resultados" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ordenId" TEXT NOT NULL,
    "institucionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "archivoRuta" TEXT NOT NULL,
    "archivoBytes" INTEGER NOT NULL,
    "archivoSha256" TEXT NOT NULL,
    "archivadoEl" TEXT,
    "cargadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resultados_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "resultados_institucionId_fkey" FOREIGN KEY ("institucionId") REFERENCES "instituciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_resultados" ("archivadoEl", "archivoBytes", "archivoRuta", "archivoSha256", "cargadoEn", "fecha", "id", "institucionId", "ordenId", "tipo") SELECT "archivadoEl", "archivoBytes", "archivoRuta", "archivoSha256", "cargadoEn", "fecha", "id", "institucionId", "ordenId", "tipo" FROM "resultados";
DROP TABLE "resultados";
ALTER TABLE "new_resultados" RENAME TO "resultados";
CREATE UNIQUE INDEX "resultados_archivoRuta_key" ON "resultados"("archivoRuta");
CREATE INDEX "resultados_ordenId_idx" ON "resultados"("ordenId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

