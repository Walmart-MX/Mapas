/* Logica del MAPA DE CARGA (FO-10257), sin pantalla.
 *
 * El lector (lector/mapa.py) entrega por hoja el texto de cada celda ocupada:
 *   {isMap, cells: [{pos: "13d", text: "6108 1 121 4061 ... CTR:40610146...", crop}]}
 * Aqui se decide, con el RUTEO:
 *   - de que ruta es la hoja (por las etiquetas; el nombre del archivo solo es pista),
 *   - que tienda(s) hay en cada celda y cuales hay que revisar a mano,
 *   - TARIMAS por tienda = celdas con su etiqueta (dos tiendas en una celda = 1 c/u).
 * En la duda no se adivina: la celda queda "por revisar".
 */
window.Conteo = window.Conteo || {};

Conteo.mapas = (() => {
  const { MIN_ROUTE_CELLS, LEAD } = Conteo.config.MAPAS;

  const tokensOf = (text) => String(text || "").match(/\d+/g) || [];

  /** DEST impreso tal cual, o CTR que empieza con el DEST + "0" (CTR:1919046590...). */
  const isStrong = (token, dette) => token === dette || (token.length >= 10 && token.startsWith(`${dette}0`));
  /** DEST con un solo digito mal leido (1435 -> 1485). */
  const isOneOff = (token, dette) =>
    token.length === dette.length && [...token].filter((ch, i) => ch !== dette[i]).length === 1;

  const dettesOf = (route) => [...new Set(route.stores.map((store) => store.dette))];

  /** Tienda(s) de la ruta en una celda. [] = no se pudo leer. */
  function pickDests(tokens, dettes) {
    const strong = dettes.filter((dette) => tokens.some((token) => isStrong(token, dette)));
    if (strong.length) return strong;
    const weak = dettes.filter((dette) => tokens.some((token) => isOneOff(token, dette)));
    return weak.length === 1 ? weak : []; // empate entre parecidas: no adivinar
  }

  /** Veces que sale la ruta impresa ("6108", "5108", "108"): mas de una = etiquetas encimadas. */
  const routeMentions = (tokens, ruta) =>
    tokens.filter((token) => token.length >= 3 && token.length <= 4 && token.endsWith(ruta.slice(-3))).length;

  /* ------------------------- de que ruta es la hoja ------------------------- */

  /** Puntos: +1 por celda con una tienda de la ruta, +1 por celda con el numero de ruta exacto. */
  function scoreRoute(cells, route) {
    const dettes = dettesOf(route);
    return cells.reduce((score, { tokens }) =>
      score + Number(dettes.some((d) => tokens.some((t) => isStrong(t, d)))) + Number(tokens.includes(route.ruta)), 0);
  }

  /** Numeros de ruta que aparecen en el nombre del archivo (solo si el PDF trae una hoja). */
  function hintedRutas(sheet, routes) {
    if (sheet.pages > 1) return [];
    const numbers = tokensOf(sheet.file);
    return routes.filter((route) => numbers.includes(route.ruta)).map((route) => route.ruta);
  }

  /**
   * @returns {{ruta: string, how: "etiquetas"|"nombre"|"", warning: string}}
   * ruta "" = no se pudo decidir: hay que preguntar.
   */
  function identify(sheet, routes) {
    const cells = sheet.cells.map((cell) => ({ tokens: tokensOf(cell.text) }));
    const ranked = routes.map((route) => ({ ruta: route.ruta, score: scoreRoute(cells, route) }))
      .sort((a, b) => b.score - a.score);
    const [best, second] = ranked;
    const sure = Boolean(best) && best.score >= MIN_ROUTE_CELLS && best.score >= LEAD * (second?.score || 0);
    const hinted = ranked.find((r) => hintedRutas(sheet, routes).includes(r.ruta));

    if (hinted && (!sure || hinted === best || hinted.score * LEAD >= best.score)) {
      return { ruta: hinted.ruta, how: "nombre", warning: "" };
    }
    if (sure) {
      const warning = hinted ? `El nombre del archivo dice ${hinted.ruta}, pero las etiquetas son de la ruta ${best.ruta}.` : "";
      return { ruta: best.ruta, how: "etiquetas", warning };
    }
    return { ruta: "", how: "", warning: "" };
  }

  /* ------------------------------- conteo ------------------------------- */

  /**
   * Celdas interpretadas para una ruta. overrides = {pos: [dettes]} corregidos a mano.
   * @returns {{pos, crop, dests: string[], review: boolean, reviewed: boolean}[]}
   */
  function interpret(sheet, route, overrides = {}) {
    const dettes = dettesOf(route);
    return sheet.cells.map(({ pos, text, crop }) => {
      const tokens = tokensOf(text);
      const auto = pickDests(tokens, dettes);
      const manual = overrides[pos];
      return {
        pos,
        crop,
        dests: manual ?? auto,
        reviewed: Boolean(manual),
        review: !manual && (!auto.length || routeMentions(tokens, route.ruta) > 1),
      };
    });
  }

  /**
   * TARIMAS por llave de tienda (store.key). Si un DETTE sale dos veces en la ruta,
   * el conteo va a su primera fila.
   */
  function countTarimas(cells, route) {
    const perDette = {};
    cells.forEach(({ dests }) => dests.forEach((dette) => { perDette[dette] = (perDette[dette] || 0) + 1; }));
    const counts = {};
    const assigned = new Set();
    for (const store of route.stores) {
      if (!perDette[store.dette] || assigned.has(store.dette)) continue;
      counts[store.key] = perDette[store.dette];
      assigned.add(store.dette);
    }
    return counts;
  }

  return Object.freeze({ identify, interpret, countTarimas });
})();
