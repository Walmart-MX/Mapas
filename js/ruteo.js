/* Parser del archivo RUTEO (1a hoja, columnas en posicion FIJA, ver config).
 *
 * Cada ruta es un bloque que empieza en la fila con numero en RUTA (E) y
 * CORTINA (A) o CONGE/REFRI (D) llenos. Dentro del bloque:
 *   - 2a fila de RUTA          -> TRACTOR
 *   - 1a fila de REMOLQUE      -> UNIDAD
 *   - "DESCO XXX" o "FRIALSA" en RUTA -> desconsolidador
 *   - texto en DETTE sin tienda -> comentario ("ENTREGA EN TIENDA", "FRIALSA"...)
 *   - color de DETTE..CAJAS    -> grupo (desconsolidador vs entrega a tienda);
 *                                 el comentario del mismo color es el de ese grupo
 *                                 y queda pegado a el, ARRIBA o ABAJO segun el ruteo.
 * Un comentario puede estar justo ARRIBA de su ruta: si su color no coincide con
 * ninguna tienda de su bloque pero si con la ruta siguiente, se mueve a esa (arriba).
 *
 * Resultado: route.items = secuencia final [{note}|{store}] lista para pintar.
 */
window.Conteo = window.Conteo || {};

Conteo.ruteo = (() => {
  const { clean, intText, readSheet } = Conteo.util;
  const cfg = Conteo.config;
  const COL = cfg.RUTEO_COLUMNS;
  const DESCO_TEXT = /^DESCO\s+(.+)$/i;

  function isRouteStart(row) {
    return Boolean(intText(row[COL.RUTA])) && Boolean(clean(row[COL.CORTINA]) || clean(row[COL.CONGE_REFRI]));
  }

  /** Corta la hoja en bloques {rows, fills} por ruta. */
  function splitBlocks(rows, fills) {
    const starts = [];
    rows.forEach((row, r) => isRouteStart(row || []) && starts.push(r));
    return starts.map((start, i) => {
      const end = starts[i + 1] ?? rows.length;
      return { rows: rows.slice(start, end).map((row) => row || []), fills: fills.slice(start, end).map((f) => f || []) };
    });
  }

  /** Nombre de desco en un texto: "DESCO TUXTLA" -> TUXTLA, "FRIALSA" -> FRIALSA. */
  function descoIn(text) {
    const match = DESCO_TEXT.exec(text);
    if (match) return match[1].toUpperCase();
    const upper = text.toUpperCase();
    return cfg.KNOWN_DESCOS.includes(upper) ? upper : null;
  }

  /**
   * Tiendas del mismo color juntas (en orden de aparicion) y cada comentario pegado a
   * su grupo: antes si en el ruteo estaba arriba de esas tiendas, despues si estaba abajo.
   * Comentarios sin grupo de su color se quedan arriba o abajo de toda la ruta.
   * Un grupo con comentario (entrega a tienda o viceversa) lleva recuadro: item.box = {top, bottom}.
   */
  function groupByColor(stores, notes) {
    const groups = [...new Set(stores.map((store) => store.color))].map((color) => {
      const members = stores.filter((store) => store.color === color);
      return { color, stores: members, firstPos: members[0].pos, before: [], after: [] };
    });
    const top = [];
    const bottom = [];
    const firstStorePos = stores.length ? Math.min(...stores.map((s) => s.pos)) : 0;
    [...notes].sort((a, b) => a.pos - b.pos).forEach((note) => {
      const group = note.color && groups.find((g) => g.color === note.color);
      if (group) (note.pos < group.firstPos ? group.before : group.after).push(note);
      else (note.pos < firstStorePos ? top : bottom).push(note);
    });
    const items = [
      ...top.map((note) => ({ note })),
      ...groups.flatMap(boxedSegment),
      ...bottom.map((note) => ({ note })),
    ];
    return {
      items,
      stores: items.filter((item) => item.store).map((item) => item.store),
      notes: items.filter((item) => item.note).map((item) => item.note),
    };
  }

  /** Comentarios de arriba + tiendas + comentarios de abajo; con recuadro si el grupo tiene comentario. */
  function boxedSegment(group) {
    const segment = [
      ...group.before.map((note) => ({ note })),
      ...group.stores.map((store) => ({ store })),
      ...group.after.map((note) => ({ note })),
    ];
    if (!group.before.length && !group.after.length) return segment;
    return segment.map((item, i) => ({ ...item, box: { top: i === 0, bottom: i === segment.length - 1 } }));
  }

  /**
   * Color de grupo de una tienda: el que mas se repite en DETTE..CAJAS (H:L).
   * Asi un DETTE resaltado aparte (amarillo/rojo) no rompe el grupo. Empate -> color de TIENDA.
   */
  function groupColor(cellColors) {
    const counts = new Map();
    Object.values(cellColors).forEach((color) => counts.set(color, (counts.get(color) || 0) + 1));
    const best = Math.max(...counts.values());
    const winners = [...counts].filter(([, n]) => n === best).map(([color]) => color);
    return winners.includes(cellColors.TIENDA) ? cellColors.TIENDA : winners[0];
  }

  /** Paso 1: lee un bloque tal cual (sin agrupar todavia). */
  function readBlock({ rows, fills }) {
    const first = rows[0];
    const secondRuta = clean(rows[1]?.[COL.RUTA]);
    const stores = [];
    const notes = [];
    const markers = new Set();
    const seen = new Map(); // DETTE repetido en la misma ruta -> cada fila con su propia captura

    rows.forEach((row, i) => {
      const marker = descoIn(clean(row[COL.RUTA]));
      if (marker) markers.add(marker);

      const dette = intText(row[COL.DETTE]);
      const tienda = clean(row[COL.TIENDA]);
      if (dette && tienda) {
        const cellColors = Object.fromEntries(cfg.GROUP_COLUMNS.map((name) => [name, fills[i][COL[name]]]));
        const times = (seen.get(dette) || 0) + 1;
        seen.set(dette, times);
        stores.push({
          pos: i,
          dette,
          key: times === 1 ? dette : `${dette}#${times}`, // llave de captura (TARIMAS, FACTURA)
          linea: clean(row[COL.LINEA]),
          estado: clean(row[COL.ESTADO]),
          formato: clean(row[COL.FORMATO]),
          tienda,
          cajas: row[COL.CAJAS],
          ventana: clean(row[COL.VENTANA]),
          lt: row[COL.LT],
          cellColors,
          color: groupColor(cellColors),
          ventanaColor: fills[i][COL.VENTANA],
        });
      } else if (!tienda && !dette) {
        const text = clean(row[COL.DETTE]);
        if (text && !cfg.IGNORED_NOTES.test(text)) notes.push({ pos: i, text, color: fills[i][COL.DETTE] });
      }
    });

    const isTractor = secondRuta && !descoIn(secondRuta) && !cfg.NOT_A_TRACTOR.test(secondRuta);
    return {
      ruta: intText(first[COL.RUTA]),
      tractor: isTractor ? secondRuta : "",
      unidad: clean(first[COL.REMOLQUE]),
      mercancia: cfg.MERCANCIA[clean(first[COL.CONGE_REFRI]).toUpperCase()] || "",
      temperatura: clean(first[COL.SETEO]),
      markers,
      stores,
      notes,
    };
  }

  /** Paso 2: comentario de color que no es de su ruta pero si de la siguiente -> se mueve ARRIBA de esa. */
  function moveStrayNotes(blocks) {
    const hasColor = (block, color) => block.stores.some((store) => store.color === color);
    blocks.forEach((block, i) => {
      const next = blocks[i + 1];
      if (!next) return;
      const stray = block.notes.filter((n) => n.color && !hasColor(block, n.color) && hasColor(next, n.color));
      block.notes = block.notes.filter((note) => !stray.includes(note));
      next.notes = [...stray.map((note, k) => ({ ...note, pos: k - stray.length })), ...next.notes];
    });
    return blocks;
  }

  /** Paso 3: descos (marcador en RUTA o comentario) y grupos por color. */
  function finalize({ markers, ...block }) {
    const fromNotes = block.notes.map((note) => descoIn(note.text)).filter(Boolean);
    return { ...block, descos: [...new Set([...markers, ...fromNotes])], ...groupByColor(block.stores, block.notes) };
  }

  /** Hoja ({rows, fills}) -> lista de rutas (todas, con o sin desco). */
  function parseSheet(sheet) {
    const blocks = splitBlocks(sheet.rows, sheet.fills).map(readBlock);
    return moveStrayNotes(blocks).map(finalize).filter((route) => route.stores.length > 0);
  }

  async function parseFile(file) {
    return parseSheet(await readSheet(file, (names) => names.find((n) => /RUTEO/i.test(n)) || names[0]));
  }

  return Object.freeze({ parseSheet, parseFile });
})();
