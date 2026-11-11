# Coberturas: obras sociales ↔ instituciones y profesionales

Cómo sabe la app qué hospitales y qué profesionales le sirven a cada paciente según su obra social. Es el
núcleo de la app y el único dato que **no existe como fuente pública**: no hay API ni
dataset que diga qué obras sociales acepta cada prestador (investigación en
`docapp-go/investigacion-apis/03-relacion-cobertura-establecimiento.md`, revisada de nuevo el 27/10/2026:
los datasets de prestadores de la SSSalud siguen sin esa relación y las prepagas siguen sin API).

## Decisiones (27/10/2026)

| # | Tema | Decisión |
|---|---|---|
| C1 | ¿Por dónde entra el dato? | **Dos canales.** Lo que sale de fuentes oficiales (establecimientos del REFES, catálogo de obras sociales) entra por el **seed / script de importación**. La relación cobertura ↔ prestador entra por la **app**, más un seed chico verificado para la demo. |
| C2 | ¿Quién carga las coberturas de una institución? | **Solo el admin** (regla 10), con fuente y fecha. No hay rol "institución" por ahora. |
| C3 | ¿Quién carga las coberturas de un profesional? | **El propio profesional, desde su Perfil.** Es como funciona en la realidad: cada profesional decide con qué obras sociales trabaja. |
| C4 | ¿A qué nivel se guarda? | **Obra social, con planes opcionales.** Una fila sin plan = acepta todos los planes de esa obra social; filas con plan = solo esos planes. |
| C5 | Catálogo de obras sociales | Las 4 de los mocks **más** las que aparecen en el relevamiento de hospitales del equipo y se pudieron identificar (26 en total, [abajo](#catálogo-inicial)). El resto las agrega el admin. Las que no tienen planes conocidos arrancan con un plan **"General"**. |
| C6 | Seed de la relación | El relevamiento del equipo **cruzado con la web oficial de cada institución**: entra solo lo que está en las dos. Si la web publica planes, se respetan. |
| C7 | Instituciones sin lista oficial | Anchorena, Los Arcos y Suizo Argentina entran con el relevamiento del equipo y fuente **`relevamiento_propio`**. |
| C8 | Sedes secundarias | Solo el **establecimiento principal** de cada hospital. Los centros médicos propios (p. ej. los del Italiano y el Británico) quedan sin coberturas hasta que el admin las cargue. |
| C9 | Qué turnos ve el paciente | Un turno aparece si le aparecen **la sede** (pública o acepta su cobertura) **y el profesional** (atiende su cobertura, también en un hospital público). Detalle en [06](06-reglas-de-negocio.md#qué-turnos-le-aparecen-al-paciente-regla-1-decidido-el-27102026). |

Lo que sigue igual: los establecimientos **públicos** se ven para todos sin filas de cobertura (regla 15).
Los de `seguridad_social` (p. ej. Finochietto) se tratan como los privados.

## Modelo de datos

Reemplaza a `instituciones_planes` y `medicos_planes` de [03-base-de-datos.md](03-base-de-datos.md). Sigue
habiendo 26 tablas.

```prisma
/// Qué coberturas acepta una institución privada o de seguridad social (reglas 1 y 15).
/// planMedicoId null = acepta todos los planes de esa obra social. Las carga solo el admin (C2).
model InstitucionCobertura {
  id            String  @id @default(uuid())
  institucionId String
  obraSocialId  String
  planMedicoId  String?
  /// 'web_institucion' | 'cartilla_cobertura' | 'relevamiento_propio'
  fuente        String
  /// Página consultada. Null solo con 'relevamiento_propio'.
  fuenteUrl     String?
  /// "yyyy-MM-dd" en que se verificó.
  verificadoEl  String

  institucion Institucion @relation(fields: [institucionId], references: [id], onDelete: Cascade)
  obraSocial  ObraSocial  @relation(fields: [obraSocialId], references: [id], onDelete: Cascade)
  plan        PlanMedico? @relation(fields: [planMedicoId], references: [id], onDelete: Cascade)

  @@unique([institucionId, obraSocialId, planMedicoId])
  @@index([obraSocialId])
  @@map("instituciones_coberturas")
}

/// Qué coberturas atiende un profesional. Las elige él en su Perfil (C3). Misma lógica de plan opcional.
model MedicoCobertura {
  id           String  @id @default(uuid())
  medicoId     String
  obraSocialId String
  planMedicoId String?

  medico     Medico      @relation(fields: [medicoId], references: [id], onDelete: Cascade)
  obraSocial ObraSocial  @relation(fields: [obraSocialId], references: [id], onDelete: Cascade)
  plan       PlanMedico? @relation(fields: [planMedicoId], references: [id], onDelete: Cascade)

  @@unique([medicoId, obraSocialId, planMedicoId])
  @@index([obraSocialId])
  @@map("medicos_coberturas")
}
```

### Integridad

| Regla | Dónde |
|---|---|
| El plan pertenece a esa obra social | Trigger (SQL extra, abajo) + validación en el servicio. |
| No puede haber dos filas "todos los planes" para la misma institución y obra social | En SQLite los `NULL` no chocan en un `UNIQUE`: hace falta un índice único parcial (abajo). |
| Por cada obra social, **o** una fila sin plan **o** filas con plan, nunca las dos | El servicio reemplaza el conjunto entero de una obra social en cada guardado (`PUT`), así nunca quedan mezcladas. |
| `fuente` válida | Trigger, como el resto de los valores de texto. |

```sql
-- Una sola fila "todos los planes" por institución + obra social (y por médico + obra social).
CREATE UNIQUE INDEX "instituciones_coberturas_todos_los_planes"
  ON "instituciones_coberturas" ("institucionId", "obraSocialId") WHERE "planMedicoId" IS NULL;
CREATE UNIQUE INDEX "medicos_coberturas_todos_los_planes"
  ON "medicos_coberturas" ("medicoId", "obraSocialId") WHERE "planMedicoId" IS NULL;

-- El plan tiene que ser de esa obra social.
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
```

### La consulta

```sql
-- Instituciones que ve un paciente con el plan :plan de la obra social :obraSocial (reglas 1 y 15)
SELECT i.* FROM instituciones i
WHERE i.activa = 1
  AND (i.origen = 'publico'
       OR EXISTS (SELECT 1 FROM instituciones_coberturas ic
                  WHERE ic.institucionId = i.id
                    AND ic.obraSocialId = :obraSocial
                    AND (ic.planMedicoId IS NULL OR ic.planMedicoId = :plan)));
```

Para profesionales es la misma condición sobre `medicos_coberturas` (sin la excepción de los públicos). El
plan y la obra social salen **del paciente de la sesión**, nunca de la query.

## API

Cambios sobre [04-api.md](04-api.md). Una cobertura viaja siempre con esta forma:

```ts
interface CoberturaAceptada {
  obraSocialId: string;
  /** Vacío u omitido = todos los planes de esa obra social. */
  planesIds?: string[];
}
```

| Método | Ruta | Rol | Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/api/catalogos/planes` | pública | — | Obras sociales con sus planes (el registro elige obra social y después plan). |
| `POST` | `/api/admin/instituciones` | admin | `{ ..., coberturas: CoberturaAceptada[], fuente, fuenteUrl?, verificadoEl }` | `201`. Si es pública, `coberturas` puede ir vacío. |
| `GET` | `/api/admin/instituciones/:id/coberturas` | admin | — | `CoberturaAceptada[]` con su fuente y fecha (para la pantalla de edición). |
| `PUT` | `/api/admin/instituciones/:id/coberturas` | admin | `{ coberturas: CoberturaAceptada[], fuente, fuenteUrl?, verificadoEl }` | `200`. Reemplaza la lista entera. |
| `GET` | `/api/medicos/yo` | profesional | — | Incluye `coberturas: CoberturaAceptada[]`. |
| `PUT` | `/api/medicos/yo/coberturas` | profesional | `{ coberturas: CoberturaAceptada[] }` | `200`. Reemplaza la lista entera. |

Cada `PUT` deja una fila en `registro_auditoria`.

## Catálogo inicial

26 obras sociales. Los nombres largos salen de las webs de los hospitales; los códigos del RNAS se
completan con la exportación del RNAS al armar el seed (el 27/10/2026 el sitio de la SSSalud estaba en
mantenimiento). OSPE, UTS y Pasteleros se sacaron: no se pudieron identificar (OSPE puede ser Petroleros o
Personal de Escribanos) y no tenían coberturas confirmadas. Las que no tienen planes en la tabla arrancan con un plan **"General"**.

| Obra social | Nombre largo / aclaración | Planes iniciales |
|---|---|---|
| OSDE | Organización de Servicios Directos Empresarios · RNAS `400800` | 210 (ya existe: `plan-osde210`), 310, 410, 450, 510, Binario, Flux |
| Swiss Medical | Prepaga (RNEMP) | SMG20 (ya existe: `plan-swiss`), Black, Advance, Global, Global Simeco, Premium, Premium Simeco, Medicén Azul, Medicén Gris, Qualitas Gris, Qualitas Premium, Docthos Básico, Docthos Family, Docthos Global, Docthos Grupo Salud, Docthos Plus, Docthos Premium |
| Galeno | Galeno Argentina S.A. | Oro (ya existe: `plan-galeno`) |
| Medifé | Medifé Asociación Civil | Plan 3000 (ya existe: `plan-medife`), Plata 460, Oro, Platinum |
| Medicus | Medicus S.A. | Azul, Celeste, Blanco, Corporate, Family, ADV, ADV Plan Mujer, Conecta, MC Integra 2, Credencial Naranja (transcriptos de la web del Otamendi: revisar nombres al armar el seed) |
| Omint | Omint S.A. | Cartilla 3, Cartilla 4, Skill Plus 4500, Línea F 6500, Línea O 8500, Línea Y |
| Sancor Salud | Asociación Mutual Sancor | 3000, 3000B, 3000R, 3500, 4000, 4065, 4500, 5000, 6000, OSUTI MED, OSUTI MAX (los que publica el Italiano) |
| OSDIPP | Obra Social de Dirección de Personal de Industria Privada del Petróleo | Plan 1, Magnus, 150, 1 Plus, Plus J, Plus Petrol |
| OSPJN | Obra Social del Poder Judicial de la Nación | General |
| Avalian | Ex ACA Salud | General |
| Hominis | Prepaga | General |
| Plan de Salud Hospital Italiano | Prepaga propia del Hospital Italiano | General |
| Luis Pasteur | Obra Social Luis Pasteur | General |
| Unión Personal | Incluye Accord Salud | General |
| ASE | Acción Social de Empresarios · RNAS `400909` | General |
| APSOT | Asociación del Personal Superior de la Organización Techint | General |
| DASUTEN | Dirección de Acción Social de la UTN | General |
| OSDEPYM | Obra Social de Empresarios, Profesionales y Monotributistas · RNAS `401704` | General |
| OPDEA | Obra Social del Personal de Dirección de la Alimentación | General |
| ObSBA | Obra Social de la Ciudad de Buenos Aires (no confundir con OSBA, la Obra Social Bancaria) | General |
| OSFE | Obra Social Ferroviaria | General |
| OSMATA | Obra Social Mecánicos y Afines del Transporte Automotor | General |
| OSCTCP | Obra Social Conductores de Transporte Colectivo de Pasajeros | General |
| OSUTHGRA | Obra Social de la Unión de Trabajadores Hoteleros y Gastronómicos de la R. A. | General |
| OSECAC | Empleados de Comercio · RNAS `126205` | General (sin coberturas en el seed) |
| OSDOP | Obra Social de Docentes Particulares | General (sin coberturas en el seed) |

## Seed de coberturas

Verificado el **27/10/2026**. Ids del REFES (`refes-<código>`), los de `backend/prisma/datos/demo.json`.
"Todos" = fila sin plan.

### Con fuente oficial (`web_institucion`)

| Institución | REFES | Fuente | Coberturas |
|---|---|---|---|
| Hospital Alemán | `10020012315204` | [hospitalaleman.org.ar/pacientes/coberturas-medicas](https://www.hospitalaleman.org.ar/pacientes/coberturas-medicas/) | **OSDE: solo Binario** · Swiss Medical · Galeno · Medicus · Omint · Medifé · Sancor Salud · Luis Pasteur · Unión Personal · ASE · APSOT · DASUTEN · Avalian (todos) |
| Hospital Italiano de Buenos Aires | `10020012315256` | [hospitalitaliano.org.ar/hiba/es/news/coberturas](https://www.hospitalitaliano.org.ar/hiba/es/news/coberturas) (buscador) y [plan de salud](https://www.hospitalitaliano.org.ar/hiba/es/sitio/plan-de-salud) | **OSDE: 310, 410, 450, 510** · **Swiss Medical: los 16 planes del catálogo menos SMG20** · **Omint: Cartilla 3, Cartilla 4, 4500, 6500, 8500, Línea Y** · **Medifé: Plata 460, Oro, Platinum** · **Sancor Salud: los 11 planes del catálogo** · Plan de Salud Hospital Italiano (todos) |
| Hospital Británico de Buenos Aires | `10020012315207` | [hospitalbritanico.org.ar/pages/coberturas-medicas-1](https://www.hospitalbritanico.org.ar/pages/coberturas-medicas-1) | OSDE · Swiss Medical · Galeno · Medicus · Omint · OSDEPYM · Luis Pasteur · OSDIPP · DASUTEN · OPDEA (todos) |
| Sanatorio Güemes | `10020012315445` | [sitio.sg.com.ar/coberturas](https://sitio.sg.com.ar/coberturas/) | OSDEPYM · Luis Pasteur · ObSBA · OSFE · OSMATA · OSCTCP · OSUTHGRA · Hominis · OSDE · Galeno (todos los planes: el relevamiento decía "planes básicos" para OSDE y Galeno, pero la web no lo detalla; decidido el 27/10/2026) |
| Sanatorio Otamendi | `10020012315249` | [otamendi.com.ar/info-general/coberturas-medicas](https://www.otamendi.com.ar/info-general/coberturas-medicas/) | **OSDE: Flux, 210, 310, 410, 450, 510** · **Swiss Medical: Black, Global, Global Simeco, Premium, Premium Simeco, Medicén Azul, Medicén Gris, Qualitas Gris, Qualitas Premium, Docthos Grupo Salud, Docthos Premium** · **Medicus: los 10 planes del catálogo** · **Omint: Cartilla 4, 4500, 6500, 8500** · **OSDIPP: los 6 planes del catálogo** · OSPJN: General |
| Sanatorio Finochietto | `14020012718696` | [sanatoriofinochietto.com/Pacientes/CoberturasMedicas](https://www.sanatoriofinochietto.com/Pacientes/CoberturasMedicas) | OSDE · Swiss Medical · Galeno · Medicus · Omint · OSPJN (todos) |

### Sin lista oficial (`relevamiento_propio`, sin URL)

| Institución | REFES | Coberturas (todos los planes) |
|---|---|---|
| Sanatorio Anchorena | `10020012315235` | Unión Personal · OSDE · Swiss Medical · Galeno · OSPJN · ASE |
| Sanatorio de los Arcos | `10020012315240` | Swiss Medical · OSDE · Galeno |
| Clínica y Maternidad Suizo Argentina | `10020012315201` | Swiss Medical · OSDE · Galeno |

### Lo que se descartó del relevamiento (no lo confirma la web oficial)

| Institución | Descartado |
|---|---|
| Hospital Italiano | Galeno (el buscador no la encuentra) |
| Hospital Británico | ASE |
| Sanatorio Güemes | OSECAC, OSPE, UTS, OSDOP |
| Sanatorio Otamendi | Galeno, Sancor Salud |
| Sanatorio Finochietto | Sancor Salud, OSDIPP |

Otamendi y Finochietto estaban juntos en el relevamiento, pero sus listas oficiales son distintas: se cargan
por separado.

### Qué ve cada usuario de prueba

Además de los públicos, que ven todos:

| Plan | Ve | No ve |
|---|---|---|
| OSDE 210 (`plan-osde210`) | Británico, Güemes, Otamendi, Finochietto, Anchorena, Los Arcos, Suizo Argentina | Alemán (solo Binario), Italiano (310 en adelante) |
| Swiss Medical SMG20 (`plan-swiss`) | Alemán, Británico, Finochietto, Anchorena, Los Arcos, Suizo Argentina | Italiano y Otamendi (solo planes altos) |
| Galeno Oro (`plan-galeno`) | Alemán, Británico, Güemes, Finochietto, Anchorena, Los Arcos, Suizo Argentina | Italiano, Otamendi |
| Medifé Plan 3000 (`plan-medife`) | Alemán | Italiano (Plata 460 en adelante) y el resto |

Medifé deja de ser la cobertura "sin relaciones" de la demo (D2 del plan de integración). Para mostrar el
estado vacío sirve cualquiera de las obras sociales del catálogo sin coberturas (p. ej. OSECAC).

## Qué cambia en el frontend

**Hecho el 27/10/2026** en el frontend (con mocks), en este orden:

1. **Dominio:** `planesAceptadosIds` de `Institucion` y `Medico` pasa a `coberturas: CoberturaAceptada[]`;
   `FuenteCobertura` suma `fuente`. `aceptaCobertura()` de `institucionService` compara obra social +
   plan.
2. **Mocks:** catálogo de [arriba](#catálogo-inicial) en `planesMedicos.ts` y el seed de coberturas en un
   archivo aparte (`mocks/coberturas.ts`), que se aplica sobre los establecimientos del REFES.
3. **Registro del paciente y Mi perfil:** elegir obra social y después plan (con 26 obras sociales, una
   sola lista de planes se vuelve inmanejable).
4. **Admin → Instituciones:** editar las coberturas de una institución existente (hoy solo hay alta), con
   "todos los planes" por defecto y la opción de elegir planes puntuales, más fuente y fecha.
5. **Profesional → Perfil:** sección "Coberturas que atiendo" con el mismo selector.
6. **Tarjeta del mapa:** "Según la web de la institución al 27/10/2026" o "Relevamiento propio".
