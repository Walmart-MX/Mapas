/* Parser del concentrado de facturas glsShipmentStatus_*.xls
 * Reemplaza la macro Modulo2 (SintesisFacturas): de cada fila toma
 *   LOAD #  -> GLS
 *   DEST #  -> DETTE
 *   INVOICE# "04659074748-1" -> factura 4659074748
 * y arma un indice GLS -> DETTE -> factura(s).
 */
window.Conteo = window.Conteo || {};

Conteo.gls = (() => {
  const { clean, intText, findHeader, readSheet } = Conteo.util;
  const REQUIRED = ["LOAD #", "INVOICE#", "DEST #"];

  /** "04659074748-1" -> "4659074748" (igual que TextToColumns por "-"). */
  function invoiceNumber(raw) {
    const head = clean(raw).split("-")[0];
    return /^\d+$/.test(head) ? String(BigInt(head)) : head;
  }

  /** Rango de fechas con que se genero el reporte ("Start Date: 10/22/2026 ... End Date: ...", mm/dd/aaaa). */
  function dateRange(rows) {
    const criteria = rows.slice(0, 15).flat().find((cell) => /Start Date:/i.test(String(cell ?? ""))) || "";
    const iso = (label) => {
      const match = new RegExp(`${label} Date:\\s*(\\d{1,2})/(\\d{1,2})/(\\d{4})`, "i").exec(criteria);
      return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
    };
    return { start: iso("Start"), end: iso("End") };
  }

  /** @returns {{loads: Map<string, Map<string, string[]>>, range: {start: string, end: string}}} */
  function parseRows(rows) {
    const { row: headerRow, index: col } = findHeader(rows, REQUIRED);
    const loads = new Map();
    for (const row of rows.slice(headerRow + 1)) {
      const load = intText(row?.[col["LOAD #"]]);
      const dette = intText(row?.[col["DEST #"]]);
      const invoice = invoiceNumber(row?.[col["INVOICE#"]]);
      if (!load || !dette || !invoice) continue;
      if (!loads.has(load)) loads.set(load, new Map());
      const stores = loads.get(load);
      const invoices = stores.get(dette) || [];
      if (!invoices.includes(invoice)) invoices.push(invoice);
      stores.set(dette, invoices);
    }
    return { loads, range: dateRange(rows) };
  }

  /** Factura(s) para GLS + DETTE, como el CONCATENAR de Excel. */
  function lookup(index, gls, dette) {
    return index?.get(intText(gls))?.get(dette)?.join(" / ") || "";
  }

  /** Coincidencia minima (en ambos sentidos) para sugerir un GLS sin adivinar. */
  const MIN_MATCH = 0.8;

  /**
   * Sugiere el GLS de una ruta: el LOAD # que comparte casi todas sus tiendas.
   * Debe cubrir >= 80% de las tiendas de la ruta Y >= 80% de las del LOAD; asi un
   * archivo GLS de otro dia (mismas tiendas, otros embarques) no sugiere nada.
   * Solo sugiere si el ganador es unico (sin empates).
   */
  function suggest(index, dettes) {
    if (!index || !dettes.length) return "";
    const wanted = new Set(dettes);
    const scores = [...index]
      .map(([load, stores]) => [load, [...stores.keys()].filter((d) => wanted.has(d)).length, stores.size])
      .filter(([, hits, size]) => hits / wanted.size >= MIN_MATCH && hits / size >= MIN_MATCH)
      .sort((a, b) => b[1] - a[1]);
    if (!scores.length || scores[0][1] === scores[1]?.[1]) return "";
    return scores[0][0];
  }

  async function parseFile(file) {
    return parseRows((await readSheet(file)).rows);
  }

  /** True si el dia del ruteo (aaaa-mm-dd) cae dentro del rango del reporte (o si no hay rango). */
  function coversDay(range, iso) {
    return !range.start || !range.end || !iso || (iso >= range.start && iso <= range.end);
  }

  return Object.freeze({ parseRows, parseFile, lookup, suggest, invoiceNumber, coversDay });
})();
