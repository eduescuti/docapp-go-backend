-- Las franjas de atención empiezan y terminan en punto o y media (turnos de 30 min). La primera migración
-- solo controlaba el día y que `desde` < `hasta`; esto lo controlaba solo el servicio.
DROP TRIGGER IF EXISTS "franjas_validas_ins";
CREATE TRIGGER "franjas_validas_ins" BEFORE INSERT ON "franjas_atencion"
WHEN NEW."diaSemana" NOT BETWEEN 0 AND 6 OR NEW."desde" >= NEW."hasta"
  OR NEW."desde" NOT GLOB '[0-2][0-9]:[03]0' OR NEW."hasta" NOT GLOB '[0-2][0-9]:[03]0'
BEGIN SELECT RAISE(ABORT, 'franja inválida'); END;
