// Consulta en vivo del Buscador Nacional de Profesionales de la Salud (REFEPS, argentina.gob.ar). La armó el
// equipo en el frontend; se pasó al backend para que la verificación no dependa de la app (y en web no choque
// con CORS). Se consulta solo si la terna no está en la copia local del padrón.

const URL_BUSCADOR = "https://www.argentina.gob.ar/salud/buscador-nacional-de-profesionales-de-la-salud";
const ESPERA_MAXIMA_MS = 6000;
const AGENTE =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

export interface FichaPadron {
  codigoProfesional: string;
  dni: string;
  nombre: string;
  apellido: string;
  profesion: string;
  especializaciones: string[];
  emisor: string;
  provincia: string;
  matricula: string;
  estadoMatricula: string;
  activo: boolean;
}

const normalizarDni = (dni: string) => dni.replace(/[.\s]/g, "");

async function consultar(matricula: string): Promise<string> {
  const senal = AbortSignal.timeout(ESPERA_MAXIMA_MS);
  // 1. La página del formulario, para sacar el form_build_id que genera Drupal.
  const inicial = await fetch(URL_BUSCADOR, { headers: { Accept: "text/html", "User-Agent": AGENTE }, signal: senal });
  if (!inicial.ok) throw new Error(`REFEPS respondió ${inicial.status}`);
  const formBuildId = (await inicial.text()).match(/name="form_build_id"\s+value="([^"]+)"/i)?.[1] ?? "";

  // 2. La consulta por matrícula.
  const params = new URLSearchParams({ searchBy: "matricula", matricula, form_id: "argobar_consulta_refeps_profesionales", op: "Consultar" });
  if (formBuildId) params.append("form_build_id", formBuildId);
  const respuesta = await fetch(URL_BUSCADOR, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      Origin: "https://www.argentina.gob.ar",
      Referer: URL_BUSCADOR,
      "User-Agent": AGENTE,
    },
    body: params.toString(),
    signal: senal,
  });
  if (!respuesta.ok) throw new Error(`REFEPS respondió ${respuesta.status}`);
  return respuesta.text();
}

/** Las filas de la tabla de resultados; elige la que coincide en DNI y profesión. */
function parsear(html: string, dni: string, matricula: string, profesion: string): FichaPadron | null {
  const limpiar = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const fichas: FichaPadron[] = [];
  for (const fila of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => limpiar(m[1]));
    if (celdas.length < 4) continue;
    // "Médico - 84831 - CABA" → profesión, matrícula y jurisdicción.
    const [prof, mat, provincia] = celdas[3].split("-").map((p) => p.trim());
    fichas.push({
      apellido: celdas[0],
      nombre: celdas[1],
      dni: celdas[2],
      profesion: prof || profesion,
      matricula: mat || matricula,
      provincia: provincia || "Nacional",
      estadoMatricula: "Habilitada",
      emisor: "Ministerio de Salud de la Nación (REFEPS)",
      codigoProfesional: `REF-${mat || matricula}`,
      especializaciones: [],
      activo: true,
    });
  }
  const coincideProfesion = (f: FichaPadron) =>
    f.profesion.toLowerCase().includes(profesion.toLowerCase()) || profesion.toLowerCase().includes(f.profesion.toLowerCase());
  return (
    fichas.find((f) => normalizarDni(f.dni) === dni && coincideProfesion(f)) ?? fichas.find(coincideProfesion) ?? fichas[0] ?? null
  );
}

/** La ficha del REFEPS para esa matrícula, o `null` si no aparece o el sitio no responde a tiempo. */
export async function buscarEnRefeps(dni: string, matricula: string, profesion: string): Promise<FichaPadron | null> {
  try {
    return parsear(await consultar(matricula), dni, matricula, profesion);
  } catch (e) {
    console.warn("REFEPS no disponible, se usa el padrón local:", e instanceof Error ? e.message : e);
    return null;
  }
}
