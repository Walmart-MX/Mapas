/* Modelo de tabla por ruta + render a HTML (pantalla editable o correo).
 * Un solo modelo, dos salidas: lo que se ve en pantalla es lo que se copia. */
window.Conteo = window.Conteo || {};

Conteo.table = (() => {
  const { display, formatDate, escapeHtml } = Conteo.util;
  const cfg = Conteo.config;
  const NOTE_SPAN = cfg.GROUP_COLUMNS.length; // el comentario ocupa DETTE..CAJAS (F:J)
  const [FIRST_GROUP_COL, LAST_GROUP_COL] = [cfg.GROUP_COLUMNS[0], cfg.GROUP_COLUMNS[NOTE_SPAN - 1]];

  /* ---------------------------- modelo ---------------------------- */

  /** GLS efectivo: lo capturado a mano o, si no hay, la sugerencia. */
  function glsFor(route, ctx) {
    const manual = Conteo.store.get(route.ruta, "GLS");
    return manual || Conteo.gls.suggest(ctx.glsIndex, route.stores.map((s) => s.dette));
  }

  function facturaFor(route, store, gls, ctx) {
    const tarimas = Conteo.store.get(route.ruta, "TARIMAS", store.key);
    if (ctx.facturaOnlyWithTarimas && !String(tarimas).trim()) return "";
    return Conteo.gls.lookup(ctx.glsIndex, gls, store.dette);
  }

  function valueFor(column, route, store, gls, ctx) {
    switch (column) {
      case "FECHA": return formatDate(ctx.fecha);
      case "RUTA": return route.ruta;
      case "TRACTOR": return route.tractor;
      case "UNIDAD": return route.unidad;
      case "LINEA": return store.linea;
      case "DETTE": return store.dette;
      case "ESTADO": return store.estado;
      case "FORMATO": return store.formato;
      case "TIENDA": return store.tienda;
      case "CAJAS": return display(store.cajas);
      case "TARIMAS": return Conteo.store.get(route.ruta, "TARIMAS", store.key);
      case "GLS": return gls;
      case "FACTURA": return facturaFor(route, store, gls, ctx);
      case "MERCANCIA": return route.mercancia;
      case "TEMPERATURA": return route.temperatura;
      case "LT": return display(store.lt);
      case "VENTANAS VERDES": return store.ventana;
      case "WTMS": return Conteo.store.get(route.ruta, "WTMS");
      default: return "";
    }
  }

  const isMerged = (column) => cfg.MERGED_COLUMNS.includes(column);

  /* ---------------------------- totales ---------------------------- */

  /** Suma de TARIMAS capturadas de una ruta (solo valores numericos; coma o punto decimal). */
  function tarimasTotal(route) {
    let total = 0;
    let captured = 0;
    let invalid = 0;
    for (const store of route.stores) {
      const raw = String(Conteo.store.get(route.ruta, "TARIMAS", store.key) ?? "").trim();
      if (!raw) continue;
      const value = Number(raw.replace(",", "."));
      if (Number.isFinite(value)) {
        total += value;
        captured++;
      } else {
        invalid++;
      }
    }
    return { total: +total.toFixed(2), captured, invalid, stores: route.stores.length };
  }

  const formatTotal = (total) => String(+total.toFixed(2));

  function describeTotals({ captured, stores, invalid }) {
    const warning = invalid ? ` \u00b7 ${invalid} valor(es) no num\u00e9rico(s), revisa` : "";
    return `(${captured} de ${stores} tiendas con captura${warning})`;
  }

  /** Color de la celda tal cual el ruteo: cada celda DETTE..CAJAS con el suyo y el verde de VENTANA. */
  function colorFor(column, store) {
    if (cfg.GROUP_COLUMNS.includes(column)) return store.cellColors[column];
    return column === "VENTANAS VERDES" ? store.ventanaColor : "";
  }

  /**
   * Filas en el orden de route.items: {cells, box} para tiendas, {note, covered, box} para comentarios.
   * covered = el comentario queda entre tiendas, dentro del rowspan de las celdas combinadas.
   * @param desco desconsolidador de la seccion (define titulo y orden de columnas)
   * @param ctx {fecha, glsIndex, facturaOnlyWithTarimas}
   */
  function buildModel(route, desco, ctx) {
    const columns = cfg.columnsFor(desco);
    const gls = glsFor(route, ctx);
    const glsIsSuggested = Boolean(gls) && !Conteo.store.get(route.ruta, "GLS");
    const storeAt = route.items.flatMap((item, i) => (item.store ? [i] : []));
    const [first, last] = [storeAt[0], storeAt[storeAt.length - 1]];
    const span = last - first + 1;

    const rows = route.items.map((item, i) => {
      if (item.note) return { note: item.note, covered: i > first && i < last, box: item.box };
      const { store } = item;
      return {
        box: item.box,
        cells: columns.map((column) => {
          if (isMerged(column) && i !== first) return null; // cubierta por el rowspan de arriba
          return {
            column,
            value: valueFor(column, route, store, gls, ctx),
            rowspan: isMerged(column) ? span : 1,
            dette: store.key,
            color: colorFor(column, store),
            suggested: column === "GLS" && glsIsSuggested,
            unknown: column === "GLS" && Boolean(gls && ctx.glsIndex && !ctx.glsIndex.has(gls)),
          };
        }),
      };
    });

    return { route, desco, columns, rows, totals: tarimasTotal(route) };
  }

  /* ---------------------------- render ---------------------------- */

  const target = (mode) => (mode === "email" ? "email" : "screen");
  const CELL_BASE = "padding:2px 6px;text-align:center;vertical-align:middle;white-space:nowrap;";
  const EMAIL_STYLE = {
    table: "border-collapse:collapse;font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;color:#000;",
    title: `border:${cfg.BORDERS.thin.email};${CELL_BASE}font-weight:bold;`,
    header: `border:${cfg.BORDERS.thin.email};${CELL_BASE}font-weight:bold;`,
    cell: `border:${cfg.BORDERS.thin.email};${CELL_BASE}`,
    note: `border:${cfg.BORDERS.thin.email};${CELL_BASE}font-weight:bold;`,
    blank: "border:none;",
  };

  /**
   * Recuadro negro del grupo (entrega a tienda o viceversa) sobre DETTE..CAJAS.
   * El comentario abarca las 5 columnas, asi que lleva ambos lados.
   */
  function boxCss(box, mode, { left, right }) {
    if (!box) return "";
    const line = cfg.BORDERS.box[target(mode)];
    return [left && "left", right && "right", box.top && "top", box.bottom && "bottom"]
      .filter(Boolean).map((side) => `border-${side}:${line};`).join("");
  }

  /** Estilo: clase CSS en pantalla, inline en correo; fondo y recuadro siempre inline. */
  function styleAttr(kind, mode, { color = "", extra = "" } = {}) {
    const inline = `${color ? `background:${color};` : ""}${extra}`;
    if (mode === "email") return `style="${EMAIL_STYLE[kind]}${inline}"${color ? ` bgcolor="${color}"` : ""}`;
    return `class="c-${kind}"${inline ? ` style="${inline}"` : ""}`;
  }

  function editableInput(cell, ruta) {
    const isStore = cfg.EDITABLE.store.includes(cell.column);
    const dette = isStore ? cell.dette : "";
    const label = isStore ? `${cell.column} tienda ${dette} ruta ${ruta}` : `${cell.column} ruta ${ruta}`;
    const extra = (cell.suggested ? ' data-suggested="1" title="Sugerido del archivo GLS (puedes cambiarlo)"' : "") +
      (cell.unknown ? ' data-unknown="1" title="Este GLS no existe en el archivo de facturas cargado"' : "");
    return `<input type="text" inputmode="numeric" autocomplete="off" class="cap cap-${cell.column.toLowerCase()}"` +
      ` data-field="${cell.column}" data-ruta="${ruta}" data-dette="${dette}"` +
      ` aria-label="${escapeHtml(label)}" value="${escapeHtml(cell.value)}"${extra}>`;
  }

  function cellHtml(cell, box, mode, ruta) {
    const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "";
    const isEditable = cfg.EDITABLE.store.includes(cell.column) || cfg.EDITABLE.route.includes(cell.column);
    if (mode === "edit" && isEditable) {
      return `<td class="c-cell c-input"${rowspan}>${editableInput(cell, ruta)}</td>`;
    }
    const inGroup = cfg.GROUP_COLUMNS.includes(cell.column);
    const extra = inGroup ? boxCss(box, mode, { left: cell.column === FIRST_GROUP_COL, right: cell.column === LAST_GROUP_COL }) : "";
    const key = cell.column === "FACTURA" ? ` data-factura="${ruta}-${cell.dette}"` : "";
    const col = mode === "edit" ? ` data-col="${cell.column}"` : "";
    return `<td ${styleAttr("cell", mode, { color: cell.color, extra })}${rowspan}${key}${col}>${escapeHtml(cell.value)}</td>`;
  }

  /**
   * Fila de comentario: ocupa DETTE..CAJAS. Arriba/abajo de la ruta el resto va sin bordes;
   * entre tiendas (covered) se saltan las columnas combinadas y el resto lleva borde.
   */
  function noteRowHtml({ note, covered, box }, columns, mode) {
    const blankKind = covered ? "cell" : "blank";
    const parts = [];
    let blanks = 0;
    const flush = () => {
      if (blanks) parts.push(`<td ${styleAttr(blankKind, mode)}${blanks > 1 ? ` colspan="${blanks}"` : ""}></td>`);
      blanks = 0;
    };
    for (const column of columns) {
      if (covered && isMerged(column)) {
        flush();
      } else if (column === FIRST_GROUP_COL) {
        flush();
        const style = styleAttr("note", mode, { color: note.color || cfg.COLORS.note, extra: boxCss(box, mode, { left: true, right: true }) });
        parts.push(`<td ${style} colspan="${NOTE_SPAN}">${escapeHtml(note.text)}</td>`);
      } else if (!cfg.GROUP_COLUMNS.includes(column)) {
        blanks++;
      }
    }
    flush();
    return `<tr>${parts.join("")}</tr>`;
  }

  /** Pie de tabla (solo pantalla): suma de TARIMAS debajo de su columna, como la suma de Excel. */
  function totalRowHtml({ route, columns, totals }) {
    const at = columns.indexOf("TARIMAS");
    const rest = columns.length - at - 1;
    return `<tr class="total-row"><td class="c-total c-total-label" colspan="${at}">TOTAL DE TARIMAS RUTA ${route.ruta} ` +
      `<span class="c-total-meta" data-total-meta="${route.ruta}">${describeTotals(totals)}</span></td>` +
      `<td class="c-total c-total-num" data-total="${route.ruta}">${formatTotal(totals.total)}</td>` +
      `${rest > 0 ? `<td class="c-blank" colspan="${rest}"></td>` : ""}</tr>`;
  }

  function toHtml(model, mode) {
    const { route, desco, columns, rows } = model;
    const title = `<tr><td ${styleAttr("title", mode, { color: cfg.COLORS.title })} colspan="3">DESCO ${escapeHtml(desco)}</td>` +
      `<td ${styleAttr("blank", mode)} colspan="${columns.length - 3}"></td></tr>`;
    const header = `<tr>${columns.map((c) => `<th ${styleAttr("header", mode, { color: cfg.HEADER_COLORS[c] || cfg.COLORS.header })}>${c}</th>`).join("")}</tr>`;
    const body = rows.map((row) => (row.note
      ? noteRowHtml(row, columns, mode)
      : `<tr>${row.cells.filter(Boolean).map((cell) => cellHtml(cell, row.box, mode, route.ruta)).join("")}</tr>`)).join("");
    const tableAttr = mode === "email" ? `style="${EMAIL_STYLE.table}" cellspacing="0" cellpadding="0"` : 'class="conteo"';
    return `<table ${tableAttr} data-ruta="${route.ruta}">${title}${header}${body}${mode === "edit" ? totalRowHtml(model) : ""}</table>`;
  }

  /** Texto plano (tabuladores) por si se pega en un lugar sin HTML. */
  function toText(model) {
    const noteIndent = "\t".repeat(model.columns.indexOf(FIRST_GROUP_COL));
    const lines = [`DESCO ${model.desco}`, model.columns.join("\t")];
    for (const row of model.rows) {
      lines.push(row.note ? noteIndent + row.note.text : row.cells.map((cell) => (cell ? cell.value : "")).join("\t"));
    }
    return lines.join("\n");
  }

  return Object.freeze({ buildModel, toHtml, toText, tarimasTotal, formatTotal, describeTotals });
})();
