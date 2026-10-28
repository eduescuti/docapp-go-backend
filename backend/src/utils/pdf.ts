/**
 * Generador mínimo de PDF de una página (texto y rectángulos, fuentes estándar Helvetica).
 * Copia del generador del frontend: el seed lo usa para crear los PDF de los resultados de ejemplo.
 * Devuelve un string "binario": cada carácter es un byte (0–255), listo para pdf.js.
 */

export type FilaTabla = [string, string, string];

export interface SeccionPdf {
  titulo: string;
  /** Tabla de 3 columnas (determinación · resultado · referencia) o párrafos sueltos. */
  tabla?: { encabezado: FilaTabla; filas: FilaTabla[] };
  lineas?: string[];
}

export interface DocumentoPdf {
  titulo: string;
  aviso: string;
  campos: [string, string][];
  secciones: SeccionPdf[];
  pie: string;
}

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;

/** WinAnsi ≈ Latin-1 para los caracteres que usamos; el resto se reemplaza. */
function textoPdf(texto: string): string {
  const latin1 = Array.from(texto)
    .map((c) => (c.charCodeAt(0) <= 0xff ? c : c === "–" || c === "—" ? "-" : "?"))
    .join("");
  return latin1.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function texto(x: number, y: number, contenido: string, tamano: number, negrita = false): string {
  return `BT /${negrita ? "F2" : "F1"} ${tamano} Tf ${x} ${y} Td (${textoPdf(contenido)}) Tj ET\n`;
}

export function crearPdfSimple(doc: DocumentoPdf): string {
  let y = ALTO - 40;
  let c = "";

  // Banda superior (azul del tema A).
  c += `0.008 0.518 0.78 rg 0 ${ALTO - 70} ${ANCHO} 70 re f\n1 1 1 rg\n`;
  c += texto(MARGEN, ALTO - 45, "DocApp Go", 20, true);
  c += texto(ANCHO - MARGEN - 150, ALTO - 43, "Resultado de estudio", 12);
  c += "0 0 0 rg\n";
  y = ALTO - 105;

  c += texto(MARGEN, y, doc.titulo, 18, true);
  y -= 20;
  c += "0.75 0.1 0.1 rg\n" + texto(MARGEN, y, doc.aviso, 9) + "0 0 0 rg\n";
  y -= 28;

  for (const [etiqueta, valor] of doc.campos) {
    c += "0.4 0.45 0.55 rg\n" + texto(MARGEN, y, etiqueta, 10) + "0 0 0 rg\n";
    c += texto(MARGEN + 130, y, valor, 11, true);
    y -= 18;
  }
  y -= 12;

  for (const seccion of doc.secciones) {
    c += `0.9 0.93 0.96 rg ${MARGEN} ${y - 6} ${ANCHO - MARGEN * 2} 22 re f\n0 0 0 rg\n`;
    c += texto(MARGEN + 8, y, seccion.titulo, 12, true);
    y -= 28;
    if (seccion.tabla) {
      const columnas = [MARGEN + 8, MARGEN + 230, MARGEN + 360];
      seccion.tabla.encabezado.forEach((t, i) => (c += "0.4 0.45 0.55 rg\n" + texto(columnas[i], y, t, 9, true)));
      c += "0 0 0 rg\n";
      y -= 18;
      for (const fila of seccion.tabla.filas) {
        fila.forEach((t, i) => (c += texto(columnas[i], y, t, 11, i === 1)));
        c += `0.88 0.9 0.93 RG 0.5 w ${MARGEN} ${y - 6} m ${ANCHO - MARGEN} ${y - 6} l S\n`;
        y -= 20;
      }
    }
    for (const linea of seccion.lineas ?? []) {
      c += texto(MARGEN + 8, y, linea, 11);
      y -= 18;
    }
    y -= 14;
  }

  c += "0.4 0.45 0.55 rg\n" + texto(MARGEN, 40, doc.pie, 9);

  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${c.length} >>\nstream\n${c}endstream`,
  ];

  // Cada carácter es un byte, así que las posiciones del índice (xref) son longitudes de string.
  let pdf = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((obj, i) => {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += posiciones.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return pdf;
}
