-- Foto de perfil del paciente y del profesional: va en usuarios (nombre del archivo en uploads/fotos/) y
-- reemplaza a medicos.avatarUrl. Escrita a mano: Prisma recrea "medicos" para sacar la columna y se perderían
-- sus triggers (medicos_genero_valido_*); DROP COLUMN la saca sin recrear la tabla.

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "fotoArchivo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_fotoArchivo_key" ON "usuarios"("fotoArchivo");

-- AlterTable
ALTER TABLE "medicos" DROP COLUMN "avatarUrl";
