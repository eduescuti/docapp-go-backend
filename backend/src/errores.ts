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
