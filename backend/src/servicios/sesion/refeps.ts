import { normalizarDni } from "../../utils/validacion";

// Consulta en vivo del Buscador Nacional de Profesionales de la Salud (REFEPS, argentina.gob.ar). Se consulta solo
// si la terna no está en la copia local del padrón.

const URL_BUSCADOR = "https://www.argentina.gob.ar/salud/buscador-nacional-de-profesionales-de-la-salud";
const ESPERA_MAXIMA_MS = 6000;
const ENCABEZADOS = {
  Accept: "text/html",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

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

/** Indica si dos profesiones coinciden, aunque una contenga a la otra. */
export const coincideProfesion = (a: string, b: string) =>
  a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

/** Extrae el texto de una celda HTML, sin etiquetas ni espacios de más. */
const textoDeCelda = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Consulta la matrícula en el buscador (primero saca el `form_build_id` de Drupal) y devuelve el HTML. */
async function consultar(matricula: string): Promise<string> {
  const senal = AbortSignal.timeout(ESPERA_MAXIMA_MS);

  const formulario = await fetch(URL_BUSCADOR, { headers: ENCABEZADOS, signal: senal });
  if (!formulario.ok) throw new Error(`REFEPS respondió ${formulario.status}`);
  const formBuildId = (await formulario.text()).match(/name="form_build_id"\s+value="([^"]+)"/i)?.[1] ?? "";

  const params = new URLSearchParams({ searchBy: "matricula", matricula, form_id: "argobar_consulta_refeps_profesionales", op: "Consultar" });
  if (formBuildId) params.append("form_build_id", formBuildId);

  const respuesta = await fetch(URL_BUSCADOR, {
    method: "POST",
    headers: { ...ENCABEZADOS, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://www.argentina.gob.ar", Referer: URL_BUSCADOR },
    body: params.toString(),
    signal: senal,
  });
  if (!respuesta.ok) throw new Error(`REFEPS respondió ${respuesta.status}`);
  return respuesta.text();
}

/** Arma las fichas de la tabla de resultados y elige la que coincide en DNI y profesión. */
function parsear(html: string, dni: string, matricula: string, profesion: string): FichaPadron | null {
  const fichas: FichaPadron[] = [];

  for (const fila of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textoDeCelda(m[1]));
    if (celdas.length < 4) continue;

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

  const deLaProfesion = (f: FichaPadron) => coincideProfesion(f.profesion, profesion);
  return fichas.find((f) => normalizarDni(f.dni) === dni && deLaProfesion(f)) ?? fichas.find(deLaProfesion) ?? fichas[0] ?? null;
}

/** Busca la ficha de esa matrícula en el REFEPS; null si no aparece o el sitio no responde a tiempo. */
export async function buscarEnRefeps(dni: string, matricula: string, profesion: string): Promise<FichaPadron | null> {
  try {
    return parsear(await consultar(matricula), dni, matricula, profesion);
  } catch (e) {
    console.warn("REFEPS no disponible, se usa el padrón local:", e instanceof Error ? e.message : e);
    return null;
  }
}
