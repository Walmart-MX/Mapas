/* Panel "Mapas de carga": sube PDFs/imagenes al lector, muestra el avance hoja por hoja,
 * identifica la ruta de cada hoja, llena TARIMAS y deja revisar las celdas dudosas.
 *
 * Reglas para no estorbar al capturista:
 *   - TARIMAS se llena solo si esta vacia o si su valor vino del mapa (nunca pisa lo tecleado).
 *   - Lo que no cuadra con lo capturado se lista como diferencia, con boton para usar el mapa.
 *   - Hoja sin ruta clara -> se pregunta (no se adivina).
 */
window.Conteo = window.Conteo || {};

Conteo.mapasUi = (() => {
  const { escapeHtml } = Conteo.util;
  const cfg = Conteo.config;
  const $ = (selector) => document.querySelector(selector);
  const OFFLINE = "No encuentro el lector de mapas. Abre la app con INICIAR.bat (doble clic) y vuelve a subir los PDF.";

  let deps = { getRoutes: () => [], onApplied: () => {}, announce: () => {} };
  const sheets = []; // hojas leidas: {id, file, page, pages, isMap, error, thumb, cells, ruta, how, warning, overrides, ...}
  let nextId = 1;
  let controller = null; // lectura en curso (para cancelar)

  const routes = () => deps.getRoutes();
  const routeOf = (ruta) => routes().find((route) => route.ruta === ruta);
  const sheetOf = (id) => sheets.find((sheet) => sheet.id === Number(id));
  const storeOf = (route, dette) => route.stores.find((store) => store.dette === dette);

  /* ------------------------- aplicar a TARIMAS ------------------------- */

  /** Quita lo que puso el mapa en una ruta (sin tocar lo tecleado) y vuelve a aplicar sus hojas. */
  function reapplyRoute(ruta) {
    const route = routeOf(ruta);
    if (!route) return;
    for (const store of route.stores) {
      if (Conteo.store.get(ruta, "TARIMAS", store.key) === Conteo.store.get(ruta, "MAPA", store.key)) {
        Conteo.store.set(ruta, "TARIMAS", "", store.key);
      }
      Conteo.store.set(ruta, "MAPA", "", store.key);
    }
    sheets.filter((sheet) => sheet.ruta === ruta).forEach((sheet) => applySheet(sheet, route)); // si hay 2, gana la ultima
  }

  function applySheet(sheet, route) {
    const counts = Conteo.mapas.countTarimas(cellsOf(sheet, route), route);
    for (const store of route.stores) {
      const value = String(counts[store.key] ?? "");
      if (!Conteo.store.get(route.ruta, "TARIMAS", store.key)) Conteo.store.set(route.ruta, "TARIMAS", value, store.key);
      Conteo.store.set(route.ruta, "MAPA", value, store.key);
    }
  }

  const cellsOf = (sheet, route) => Conteo.mapas.interpret(sheet, route, sheet.overrides);

  /** Tiendas donde lo capturado no coincide con el mapa. */
  function differences(route) {
    return route.stores.map((store) => ({
      store,
      typed: Conteo.store.get(route.ruta, "TARIMAS", store.key),
      map: Conteo.store.get(route.ruta, "MAPA", store.key),
    })).filter(({ typed, map }) => typed && map && typed !== map);
  }

  /** Pone la ruta (detectada o elegida) y re-aplica la anterior y la nueva. */
  function assign(sheet, ruta, how) {
    const before = sheet.ruta;
    Object.assign(sheet, { ruta, how, warning: how === "manual" ? "" : sheet.warning });
    if (before && before !== ruta) reapplyRoute(before);
    if (ruta) reapplyRoute(ruta);
  }

  function identify(sheet) {
    if (!routes().length || !sheet.isMap || sheet.error) return;
    if (sheet.how === "manual" && routeOf(sheet.ruta)) return reapplyRoute(sheet.ruta);
    const found = Conteo.mapas.identify(sheet, routes());
    sheet.warning = found.warning;
    assign(sheet, found.ruta, found.how);
  }

  /* ------------------------------- render ------------------------------- */

  const HOW = { etiquetas: "ruta detectada por las etiquetas", nombre: "ruta tomada del nombre del archivo", manual: "ruta elegida a mano" };

  function statusOf(sheet, route, pending) {
    if (sheet.error) return { kind: "bad", text: sheet.error };
    if (!sheet.isMap) return { kind: "off", text: "No parece un mapa FO-10257: se ignoró" };
    if (!routes().length) return { kind: "ask", text: "Carga el RUTEO para saber de qué ruta es" };
    if (!route) return { kind: "ask", text: "¿De qué ruta es? Elígela abajo" };
    if (pending) return { kind: "review", text: `${pending} celda${pending > 1 ? "s" : ""} por revisar` };
    return { kind: "ok", text: "Listo" };
  }

  function routeSelect(sheet) {
    const options = [...routes()].sort((a, b) => a.ruta.localeCompare(b.ruta)).map((route) =>
      `<option value="${route.ruta}" ${route.ruta === sheet.ruta ? "selected" : ""}>` +
      `${route.ruta} · ${escapeHtml(route.descos.join(" / ") || "sin desco")} · ${route.stores.length} tiendas</option>`).join("");
    return `<label class="mapa-route" for="r${sheet.id}">Ruta
      <select id="r${sheet.id}" data-route-for="${sheet.id}"><option value="">— elegir —</option>${options}</select></label>`;
  }

  function cellHtml(sheet, route, cell) {
    const dettes = [...new Set(route.stores.map((store) => store.dette))];
    const state = cell.review ? " · por revisar" : cell.reviewed ? " · revisada" : "";
    const chips = dettes.map((dette) => {
      const id = `c${sheet.id}-${cell.pos}-${dette}`;
      return `<label class="chip small" for="${id}"><input type="checkbox" id="${id}" data-cell="${sheet.id}|${cell.pos}" value="${dette}"` +
        ` ${cell.dests.includes(dette) ? "checked" : ""}><span>${dette} <small>${escapeHtml(storeOf(route, dette).tienda)}</small></span></label>`;
    }).join("");
    const confirm = cell.review
      ? `<button type="button" class="btn small" id="k${sheet.id}-${cell.pos}" data-confirm="${sheet.id}|${cell.pos}">Está bien así</button>` : "";
    return `<fieldset class="celda${cell.review ? " pendiente" : ""}">
      <legend>Posición ${cell.pos}${state}</legend>
      <img src="${cell.crop}" alt="Etiquetas pegadas en la posición ${cell.pos}">
      <div class="chips">${chips}${confirm}</div>
    </fieldset>`;
  }

  function detailsHtml(sheet, route, cells) {
    if (!sheet.open) return "";
    const shown = sheet.showAll ? cells : cells.filter((cell) => cell.review || cell.reviewed);
    const pending = cells.filter((cell) => cell.review).length;
    return `<div class="celdas">
      <p class="hint">Palomea la(s) tienda(s) de cada etiqueta. Si no es tarima, desmarca todo.</p>
      ${shown.map((cell) => cellHtml(sheet, route, cell)).join("") || '<p class="muted">Nada por revisar.</p>'}
      <div class="mapa-actions">
        ${pending > 1 ? `<button type="button" class="btn small" id="t${sheet.id}" data-confirm-all="${sheet.id}">
          Las ${pending} están bien así</button>` : ""}
        <button type="button" class="btn ghost small" id="a${sheet.id}" data-show-all="${sheet.id}">
          ${sheet.showAll ? "Ver solo las de revisar" : `Ver todas las celdas (${cells.length})`}</button>
      </div>
    </div>`;
  }

  function summaryHtml(sheet, route, cells) {
    const counts = Conteo.mapas.countTarimas(cells, route);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const counted = new Set(cells.flatMap((cell) => cell.dests));
    const missing = [...new Set(route.stores.map((store) => store.dette))]
      .filter((dette) => !counted.has(dette)).map((dette) => storeOf(route, dette));
    const storeCount = counted.size + missing.length;
    const diffs = differences(route);
    const twin = sheets.some((other) => other !== sheet && other.ruta === sheet.ruta);
    return `<p><strong>${total} tarimas</strong> en ${cells.length} posiciones ·
        ${counted.size} de ${storeCount} tiendas</p>
      ${twin ? '<p class="mapa-warn">Otra hoja también es de esta ruta: cuenta la última. Corrige la ruta de la que sobre.</p>' : ""}
      ${missing.length ? `<p class="hint">Sin etiqueta en el mapa: ${missing.map((s) => `${s.dette} ${escapeHtml(s.tienda)}`).join(", ")}</p>` : ""}
      ${diffs.length ? `<div class="mapa-diff" role="group" aria-label="Diferencias con lo capturado">
        <p><strong>No cuadra con lo capturado:</strong></p>
        <ul>${diffs.map(({ store, typed, map }) => `<li>${store.dette} ${escapeHtml(store.tienda)}: capturado <b>${escapeHtml(typed)}</b>, mapa <b>${map}</b></li>`).join("")}</ul>
        <button type="button" class="btn small" id="u${sheet.id}" data-use-map="${sheet.id}">Usar lo del mapa</button></div>` : ""}`;
  }

  function cardHtml(sheet) {
    const route = sheet.isMap && !sheet.error ? routeOf(sheet.ruta) : null;
    const cells = route ? cellsOf(sheet, route) : [];
    const pending = cells.filter((cell) => cell.review).length;
    const status = statusOf(sheet, route, pending);
    const where = `${escapeHtml(sheet.file)}${sheet.pages > 1 ? ` · hoja ${sheet.page} de ${sheet.pages}` : ""}`;
    const title = route ? `Ruta ${route.ruta} <small>${escapeHtml(route.descos.join(" / "))}</small>` : "Ruta sin identificar";
    const canAssign = sheet.isMap && !sheet.error && routes().length;
    return `<article class="mapa-card mapa-${status.kind}" aria-labelledby="mt${sheet.id}">
      ${sheet.thumb ? `<button type="button" class="mapa-thumb" id="z${sheet.id}" data-zoom="${sheet.id}" aria-expanded="${Boolean(sheet.zoom)}"
          aria-label="Ampliar hoja ${where}"><img src="${sheet.thumb}" alt="" class="${sheet.zoom ? "big" : ""}"></button>` : ""}
      <div class="mapa-body">
        <h3 id="mt${sheet.id}">${title}</h3>
        <p class="hint">${where}${sheet.rotated ? ` · venía girada ${sheet.rotated}°` : ""}${HOW[sheet.how] ? ` · ${HOW[sheet.how]}` : ""}</p>
        <p class="badge badge-${status.kind}">${escapeHtml(status.text)}</p>
        ${sheet.warning ? `<p class="mapa-warn">${escapeHtml(sheet.warning)}</p>` : ""}
        ${canAssign ? routeSelect(sheet) : ""}
        ${route ? summaryHtml(sheet, route, cells) : ""}
        <div class="mapa-actions">
          ${route ? `<button type="button" class="btn small${pending ? " primary" : ""}" id="v${sheet.id}" data-toggle="${sheet.id}" aria-expanded="${sheet.open}">
            ${sheet.open ? "Ocultar celdas" : pending ? `Revisar ${pending} celda${pending > 1 ? "s" : ""}` : "Ver celdas"}</button>` : ""}
          <button type="button" class="btn ghost small" id="x${sheet.id}" data-remove="${sheet.id}">Quitar hoja</button>
        </div>
        ${route ? detailsHtml(sheet, route, cells) : ""}
      </div>
    </article>`;
  }

  /** Re-dibuja el panel sin perder el foco del teclado (los controles tienen id estable). */
  function render() {
    const focused = document.activeElement?.id;
    $("#step-mapas").hidden = sheets.length === 0 && !controller;
    $("#mapas-list").innerHTML = sheets.map(cardHtml).join("");
    $("#mapas-clear").hidden = sheets.length === 0;
    $("#mapas-summary").textContent = summaryText();
    if (focused) document.getElementById(focused)?.focus();
  }

  function summaryText() {
    const maps = sheets.filter((sheet) => sheet.isMap && !sheet.error);
    if (!maps.length) return "";
    const named = maps.filter((sheet) => routeOf(sheet.ruta));
    const pending = named.reduce((n, sheet) => n + cellsOf(sheet, routeOf(sheet.ruta)).filter((c) => c.review).length, 0);
    const parts = [`${maps.length} mapa${maps.length > 1 ? "s" : ""}`, `${named.length} con ruta`];
    if (maps.length > named.length) parts.push(`${maps.length - named.length} sin identificar`);
    if (pending) parts.push(`${pending} celda${pending > 1 ? "s" : ""} por revisar`);
    return parts.join(" · ");
  }

  /** Cambio que afecta TARIMAS: re-dibuja panel y tablas. */
  function changed() {
    render();
    deps.onApplied();
  }

  /* ------------------------------- lectura ------------------------------- */

  /** Lineas NDJSON de una respuesta en streaming. */
  async function* ndjson(response) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  }

  function progress(done, total, startedAt) {
    const bar = $("#mapas-bar");
    bar.max = Math.max(total, 1);
    bar.value = done;
    const left = total - done;
    const perSheet = done ? (Date.now() - startedAt) / done : 0;
    const eta = done ? ` · faltan ~${Math.max(1, Math.round((perSheet * left) / 60000))} min` : " · la primera tarda un poco más";
    $("#mapas-progress-text").textContent = total
      ? (left ? `Leyendo hoja ${done + 1} de ${total}${eta}` : `Listo: ${total} hoja${total > 1 ? "s" : ""} leída${total > 1 ? "s" : ""}`)
      : "Enviando archivos al lector…";
  }

  function addSheet(event) {
    const sheet = { ...event, id: nextId++, ruta: "", how: "", warning: "", overrides: {}, open: false, showAll: false, zoom: false };
    sheets.push(sheet);
    identify(sheet);
    changed();
  }

  async function upload(files) {
    const valid = files.filter((file) => cfg.MAPAS.ACCEPT.test(file.name));
    if (!valid.length) return deps.announce("Los mapas deben ser PDF o imágenes (JPG, PNG, TIFF).", true);
    if (controller) return deps.announce("Ya estoy leyendo mapas: espera a que termine o cancela.", true);
    const form = new FormData();
    valid.forEach((file) => form.append("files", file, file.name));
    controller = new AbortController();
    const startedAt = Date.now();
    let done = 0;
    let total = 0;
    $("#mapas-progress").hidden = false;
    progress(0, 0, startedAt);
    render();
    try {
      const response = await fetch(`${cfg.LECTOR_URL}/api/mapas`, { method: "POST", body: form, signal: controller.signal });
      if (!response.ok) throw new Error(`el lector respondió ${response.status}`);
      for await (const event of ndjson(response)) {
        if (event.type === "start") total = event.total;
        if (event.type === "sheet") { done++; addSheet(event); }
        progress(done, total, startedAt);
      }
      setOnline(true);
      deps.announce(`Mapas leídos: ${summaryText()}.${valid.length < files.length ? " Algunos archivos no eran PDF/imagen y se ignoraron." : ""}`);
    } catch (error) {
      if (error.name === "AbortError") deps.announce("Lectura cancelada. Las hojas ya leídas se quedan.");
      else if (error instanceof TypeError) { setOnline(false); deps.announce(OFFLINE, true); }
      else deps.announce(`No pude leer los mapas: ${error.message}`, true);
    } finally {
      controller = null;
      $("#mapas-progress").hidden = true;
      render();
    }
  }

  function setOnline(ok) {
    $("#mapas-hint").textContent = ok
      ? "PDF o fotos · uno o varios · varias hojas por archivo"
      : "Requiere el lector: abre la app con INICIAR.bat";
    $("#drop-mapas").toggleAttribute("data-offline", !ok);
  }

  async function ping() {
    try {
      const response = await fetch(`${cfg.LECTOR_URL}/api/salud`, { signal: AbortSignal.timeout(2000) });
      setOnline(response.ok);
    } catch {
      setOnline(false);
    }
  }

  /* ------------------------------- eventos ------------------------------- */

  function onChange(event) {
    const target = event.target;
    if (target.dataset.routeFor) {
      assign(sheetOf(target.dataset.routeFor), target.value, target.value ? "manual" : "");
      return changed();
    }
    if (target.dataset.cell) {
      const [id, pos] = target.dataset.cell.split("|");
      const sheet = sheetOf(id);
      sheet.overrides[pos] = [...document.querySelectorAll(`[data-cell="${id}|${pos}"]:checked`)].map((box) => box.value);
      reapplyRoute(sheet.ruta);
      changed();
    }
  }

  function onClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const { toggle, showAll, remove, confirm: confirmCell, confirmAll, useMap, zoom } = button.dataset;
    if (toggle) sheetOf(toggle).open = !sheetOf(toggle).open;
    if (showAll) sheetOf(showAll).showAll = !sheetOf(showAll).showAll;
    if (zoom) sheetOf(zoom).zoom = !sheetOf(zoom).zoom;
    if (confirmCell) {
      const [id, pos] = confirmCell.split("|");
      confirmCells(sheetOf(id), (cell) => cell.pos === pos);
    }
    if (confirmAll) confirmCells(sheetOf(confirmAll), (cell) => cell.review);
    if (useMap) {
      const route = routeOf(sheetOf(useMap).ruta);
      differences(route).forEach(({ store, map }) => Conteo.store.set(route.ruta, "TARIMAS", map, store.key));
    }
    if (remove) {
      const sheet = sheetOf(remove);
      sheets.splice(sheets.indexOf(sheet), 1);
      reapplyRoute(sheet.ruta);
    }
    if (confirmCell || confirmAll || useMap || remove) changed(); // tocan TARIMAS
    else render();
  }

  /** Da por buenas (tal como se leyeron) las celdas que cumplan `which`. */
  function confirmCells(sheet, which) {
    cellsOf(sheet, routeOf(sheet.ruta)).filter(which).forEach((cell) => { sheet.overrides[cell.pos] = cell.dests; });
    reapplyRoute(sheet.ruta);
  }

  function clearAll() {
    if (!confirm("¿Quitar todas las hojas leídas? Lo que llenó el mapa en TARIMAS se borra; lo que tecleaste se queda.")) return;
    const rutas = [...new Set(sheets.map((sheet) => sheet.ruta).filter(Boolean))];
    sheets.length = 0;
    rutas.forEach(reapplyRoute);
    changed();
  }

  /** @param options {getRoutes, onApplied, announce} */
  function init(options) {
    deps = { ...deps, ...options };
    $("#mapas-list").addEventListener("change", onChange);
    $("#mapas-list").addEventListener("click", onClick);
    $("#mapas-cancel").addEventListener("click", () => controller?.abort());
    $("#mapas-clear").addEventListener("click", clearAll);
    ping();
  }

  /** El ruteo cambio: vuelve a identificar las hojas y a llenar TARIMAS. */
  function routesChanged() {
    sheets.forEach(identify);
    render();
  }

  /** Para cambios en las tablas (tecleo): re-dibuja una vez que se deja de teclear. */
  let refreshTimer = 0;
  function refreshSoon() {
    if (!sheets.length) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(render, 400);
  }

  return Object.freeze({ init, upload, routesChanged, refresh: refreshSoon });
})();
