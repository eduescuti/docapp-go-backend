import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";

/**
 * Error con el status HTTP que corresponde. Los servicios lo tiran sin saber nada de Express y el manejador de
 * errores lo traduce a `{ error: mensaje }` (02-arquitectura.md, "Respuestas y errores").
 */
export class ErrorHttp extends Error {
  constructor(
    public readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorHttp";
  }
}

/**
 * Último middleware: todo error termina acá (Express 5 también manda los de las rutas `async`). Responde
 * siempre `{ error }` y nunca manda al cliente el stack ni el error de Prisma.
 */
export const manejarErrores: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ErrorHttp) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Body con JSON mal armado o demasiado grande (lo detecta express.json()).
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "El cuerpo del pedido no es un JSON válido." });
    return;
  }
  if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large") {
    res.status(413).json({ error: "El pedido es demasiado grande." });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: violó un UNIQUE (p. ej. el horario ya está tomado).
    if (err.code === "P2002") {
      res.status(409).json({ error: "Ese dato ya existe o el horario ya está tomado." });
      return;
    }
    // P2025: no existe el registro.
    if (err.code === "P2025") {
      res.status(404).json({ error: "No existe." });
      return;
    }
    // P2003: clave foránea inválida. En SQLite, Prisma informa con este mismo código cuando un trigger de
    // validación rechaza el dato (RAISE ABORT): un estado, tipo o franja inválidos.
    if (err.code === "P2003") {
      res.status(400).json({ error: "Algún dato no es válido." });
      return;
    }
  }

  console.error(err);
  res.status(500).json({ error: "Ocurrió un error inesperado. Probá de nuevo más tarde." });
};
