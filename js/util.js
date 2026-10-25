/* Utilidades pequenas compartidas por los parsers y la tabla. */
window.Conteo = window.Conteo || {};

Conteo.util = (() => {
  const INVISIBLE = /[\u00A0\u200B\u200C\u200D\uFEFF]/g;

  /** Texto limpio: sin espacios raros (nbsp, zero-width) ni bordes. */
  function clean(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  }

  /** "7100", 7100, 7100.0 -> "7100". Devuelve "" si no es entero. */
  function intText(value) {
    const text = clean(value);
    return /^\d+(\.0+)?$/.test(text) ? String(parseInt(text, 10)) : "";
  }

  /** Numero "bonito" para mostrar (2.0 -> "2"); texto se respeta. */
  function display(value) {
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toFixed(2));
    return clean(value);
  }

  /** Busca la fila de encabezados que contiene todas las columnas pedidas. */
  function findHeader(rows, required, maxScan = 30) {
    for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
      const names = (rows[r] || []).map((cell) => clean(cell).toUpperCase());
      if (required.every((name) => names.includes(name))) {
        const index = {};
        names.forEach((name, col) => {
          if (name && !(name in index)) index[name] = col;
        });
        return { row: r, index };
      }
    }
    throw new Error(`No encontre los encabezados: ${required.join(", ")}`);
  }

  /** Fecha dd/mm/aaaa a partir del nombre "RUTEO 23-10-2026.xlsx". */
  function dateFromFilename(name) {
    const match = /(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/.exec(name || "");
    if (!match) return "";
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  /** "2026-10-23" -> "23/10/2026" */
  function formatDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
  }

  /** Color de relleno de una celda SheetJS como "#RRGGBB" ('' si no tiene o es blanco). */
  function fillOf(cell) {
    const style = cell?.s;
    const rgb = style && style.patternType && style.patternType !== "none" ? style.fgColor?.rgb : "";
    const hex = rgb ? String(rgb).slice(-6).toUpperCase() : "";
    return hex && hex !== "FFFFFF" ? `#${hex}` : "";
  }

  /**
   * Lee una hoja de Excel (xls/xlsx).
   * @returns {{rows: any[][], fills: string[][]}} valores y colores, misma forma.
   */
  async function readSheet(file, pickSheet = (names) => names[0]) {
    const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellStyles: true });
    const sheet = book.Sheets[pickSheet(book.SheetNames)];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    const rows = [];
    const fills = [];
    for (let r = 0; r <= range.e.r; r++) {
      const values = [];
      const colors = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        values.push(cell ? cell.v : null);
        colors.push(fillOf(cell));
      }
      rows.push(values);
      fills.push(colors);
    }
    return { rows, fills };
  }

  return Object.freeze({ clean, intText, display, findHeader, dateFromFilename, formatDate, escapeHtml, readSheet });
})();
