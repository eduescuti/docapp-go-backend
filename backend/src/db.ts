import { PrismaClient } from "@prisma/client";

// Una sola instancia de Prisma para toda la API: cada `new PrismaClient()` abre su propia conexión.
export const prisma = new PrismaClient();
