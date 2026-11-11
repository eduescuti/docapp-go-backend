-- Un paciente no puede tener dos turnos activos a la misma fecha y hora, aunque sean con profesionales o lugares
-- distintos (11/11/2026). Igual que "turnos_medico_activo": un turno cancelado, rechazado o completado no cuenta.
-- Prisma no declara índices parciales en SQLite: va a mano (docs/03-base-de-datos.md#sql-extra-de-la-migración).
CREATE UNIQUE INDEX "turnos_paciente_activo"
  ON "turnos" ("pacienteId", "fecha", "hora")
  WHERE "estado" IN ('pendiente', 'confirmado');
