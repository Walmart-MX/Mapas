/* Orquestacion de la pantalla: cargar archivos, elegir desconsolidador,
 * capturar TARIMAS/GLS/WTMS y copiar la tabla lista para el correo. */
(() => {
  const { dateFromFilename } = Conteo.util;
  const $ = (selector) => document.querySelector(selector);

  const state = {
    routes: [],
    glsIndex: null,
    glsRange: { start: "", end: "" },
    fecha: "",
    selected: new Set(),
    hiddenRoutes: new Set(), // "DESCO:RUTA" desmarcadas en el selector de rutas
  };

  const ctx = () => ({
    fecha: state.fecha,
    glsIndex: state.glsIndex,
    facturaOnlyWithTarimas: $("#opt-factura").checked,
  });

  const routesOf = (desco) => state.routes.filter((route) => route.descos.includes(desco));
  const descos = () => [...new Set(state.routes.flatMap((route) => route.descos))];
  const chosenDescos = () => descos().filter((desco) => state.selected.has(desco));
  const routeKey = (desco, ruta) => `${desco}:${ruta}`;
  const visibleRoutesOf = (desco) => routesOf(desco).filter((route) => !state.hiddenRoutes.has(routeKey(desco, route.ruta)));

  function announce(message, isError = false) {
    const status = $("#status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  /** Aviso si el reporte de facturas no cubre el dia del ruteo (ej. GLS descargado con fechas de ayer). */
  function glsDateWarning() {
    if (!state.glsIndex || Conteo.gls.coversDay(state.glsRange, state.fecha)) return "";
    const f = Conteo.util.formatDate;
    return ` El archivo de facturas es del ${f(state.glsRange.start)} al ${f(state.glsRange.end)} y el ruteo es del ${f(state.fecha)}: ` +
      "descarga el GLS con las fechas de ese día o no encontraré facturas.";
  }

  /** Mensaje de estado + aviso de fechas (si aplica). */
  function announceLoaded(message) {
    const warning = glsDateWarning();
    announce(warning ? `${message} ${warning}` : message, Boolean(warning));
  }

  /* ------------------------- carga de archivos ------------------------- */

  async function onRuteo(file) {
    try {
      state.routes = await Conteo.ruteo.parseFile(file);
      setFecha(dateFromFilename(file.name) || new Date().toISOString().slice(0, 10));
      $("#ruteo-name").textContent = file.name;
      const found = descos();
      state.selected = new Set([...state.selected].filter((d) => found.includes(d)));
      state.hiddenRoutes.clear();
      renderPicker();
      refresh();
      announceLoaded(`Ruteo cargado: ${state.routes.length} rutas, ${found.length} desconsolidadores (${found.join(", ")}).`);
    } catch (error) {
      announce(`No pude leer el ruteo: ${error.message}`, true);
    }
  }

  async function onGls(file) {
    try {
      const { loads, range } = await Conteo.gls.parseFile(file);
      state.glsIndex = loads;
      state.glsRange = range;
      $("#gls-name").textContent = file.name;
      render();
      announceLoaded(`Facturas cargadas: ${loads.size} GLS encontrados.`);
    } catch (error) {
      announce(`No pude leer el archivo de facturas: ${error.message}`, true);
    }
  }

  function setFecha(iso) {
    state.fecha = iso;
    $("#fecha").value = iso;
    Conteo.store.load(iso);
  }

  /* ------------------------------ render ------------------------------ */

  function renderPicker() {
    const picker = $("#descos");
    picker.innerHTML = descos().map((desco) => `
      <label class="chip">
        <input type="checkbox" value="${desco}" ${state.selected.has(desco) ? "checked" : ""}>
        <span>${desco} <small>(${routesOf(desco).length} rutas)</small></span>
      </label>`).join("") || '<p class="muted">No encontre "DESCO ..." en este ruteo.</p>';
    $("#step-descos").hidden = false;
  }

  /** Selector de rutas: un grupo de chips por cada desconsolidador elegido. */
  function renderRoutePicker() {
    const chosen = chosenDescos();
    $("#rutas-box").hidden = chosen.length === 0;
    $("#rutas").innerHTML = chosen.map((desco) => `
      <fieldset class="route-group">
        <legend>${desco}</legend>
        <div class="chips">
          ${routesOf(desco).map((route) => `
            <label class="chip small">
              <input type="checkbox" value="${routeKey(desco, route.ruta)}" ${state.hiddenRoutes.has(routeKey(desco, route.ruta)) ? "" : "checked"}>
              <span>${route.ruta} <small>(${route.stores.length} tiendas)</small></span>
            </label>`).join("")}
          <button type="button" class="btn ghost small" data-toggle-routes="${desco}">Todas / ninguna</button>
        </div>
      </fieldset>`).join("");
  }

  /** Total de tarimas de un desconsolidador: suma de sus rutas visibles. */
  function descoTotalText(desco) {
    const sum = visibleRoutesOf(desco).reduce((acc, route) => acc + Conteo.table.tarimasTotal(route).total, 0);
    return `Total ${desco}: ${Conteo.table.formatTotal(sum)} tarimas`;
  }

  function render() {
    const output = $("#output");
    const chosen = chosenDescos();
    $("#copy-selected").disabled = !chosen.some((desco) => visibleRoutesOf(desco).length);
    output.innerHTML = chosen.map((desco) => {
      const tables = visibleRoutesOf(desco).map((route) =>
        `<div class="table-wrap">${Conteo.table.toHtml(Conteo.table.buildModel(route, desco, ctx()), "edit")}</div>`).join("");
      return `
      <section class="desco" aria-labelledby="h-${desco}">
        <div class="desco-head">
          <h2 id="h-${desco}">DESCO ${desco}</h2>
          <span class="desco-total" data-desco-total="${desco}">${descoTotalText(desco)}</span>
          <button type="button" class="btn" data-copy="${desco}" ${tables ? "" : "disabled"}>Copiar ${desco} para correo</button>
        </div>
        ${tables || '<p class="muted">No hay rutas seleccionadas de este desconsolidador.</p>'}
      </section>`;
    }).join("");
    if (!chosen.length && state.routes.length) {
      output.innerHTML = '<p class="muted">Selecciona uno o varios desconsolidadores arriba.</p>';
    }
  }

  /** Cambio de desconsolidadores: rehace selector de rutas y tablas. */
  function refresh() {
    renderRoutePicker();
    render();
  }

  /** Actualiza solo las celdas FACTURA de una ruta (sin perder el foco). */
  function refreshFacturas(ruta) {
    const route = state.routes.find((r) => r.ruta === ruta);
    const model = Conteo.table.buildModel(route, route.descos[0], ctx());
    const col = model.columns.indexOf("FACTURA");
    for (const row of model.rows.filter((r) => r.cells)) {
      const cell = row.cells[col];
      document.querySelectorAll(`[data-factura="${ruta}-${cell.dette}"]`).forEach((td) => { td.textContent = cell.value; });
    }
  }

  /** Marca en rojo un GLS escrito que no existe en el archivo de facturas. */
  function markUnknownGls(input) {
    const unknown = Boolean(input.value.trim() && state.glsIndex && !state.glsIndex.has(input.value.trim()));
    input.toggleAttribute("data-unknown", unknown);
    input.title = unknown ? "Este GLS no existe en el archivo de facturas cargado" : "";
  }

  /** Recalcula en vivo los totales de una ruta (pie de tabla) y de los desconsolidadores (sin re-dibujar). */
  function refreshTotals(ruta) {
    const totals = Conteo.table.tarimasTotal(state.routes.find((r) => r.ruta === ruta));
    document.querySelectorAll(`[data-total="${ruta}"]`).forEach((td) => { td.textContent = Conteo.table.formatTotal(totals.total); });
    document.querySelectorAll(`[data-total-meta="${ruta}"]`).forEach((el) => { el.textContent = Conteo.table.describeTotals(totals); });
    document.querySelectorAll("[data-desco-total]").forEach((el) => { el.textContent = descoTotalText(el.dataset.descoTotal); });
  }

  /** Si la ruta sale en dos descos, mantiene iguales sus capturas en ambas tablas. */
  function syncTwins(input) {
    const { field, ruta, dette } = input.dataset;
    document.querySelectorAll(`.cap[data-field="${field}"][data-ruta="${ruta}"][data-dette="${dette}"]`)
      .forEach((twin) => { if (twin !== input) twin.value = input.value; });
  }

  /* ------------------------------ copiar ------------------------------ */

  /** Solo las rutas visibles (seleccionadas) de cada desconsolidador. */
  function emailContent(descoList) {
    const models = descoList.flatMap((desco) => visibleRoutesOf(desco).map((route) => Conteo.table.buildModel(route, desco, ctx())));
    return {
      html: models.map((model) => Conteo.table.toHtml(model, "email")).join("<br>"),
      text: models.map((model) => Conteo.table.toText(model)).join("\n\n"),
    };
  }

  async function copyToClipboard({ html, text }) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return;
    } catch {
      /* navegadores viejos o file:// restringido: plan B abajo */
    }
    const holder = Object.assign(document.createElement("div"), { innerHTML: html, contentEditable: "true" });
    holder.style.cssText = "position:fixed;left:-99999px;top:0;";
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    selection.removeAllRanges();
    holder.remove();
  }

  async function copyDescos(descoList) {
    await copyToClipboard(emailContent(descoList));
    announce(`Copiado ${descoList.join(" + ")}. Ahora pega (Ctrl+V) en el correo.`);
  }

  /* ------------------- resaltado de la tienda en captura ------------------- */

  /** Ilumina la celda de TARIMAS y resalta DETTE/TIENDA de la fila activa (solo pantalla). */
  function setActive(input) {
    $("#output").querySelectorAll(".active-row, .active-cell").forEach((el) => el.classList.remove("active-row", "active-cell"));
    const now = $("#now");
    now.hidden = !input;
    if (!input) return;
    const row = input.closest("tr");
    row.classList.add("active-row");
    input.closest("td").classList.add("active-cell");
    const text = (col) => row.querySelector(`[data-col="${col}"]`)?.textContent ?? "";
    const route = state.routes.find((r) => r.ruta === input.dataset.ruta);
    const total = Conteo.table.formatTotal(Conteo.table.tarimasTotal(route).total);
    now.textContent = `Capturando: DETTE ${text("DETTE")} \u00b7 ${text("TIENDA")} \u00b7 ruta ${input.dataset.ruta} (${total} tarimas en total)`;
  }

  /* ------------------------------ eventos ------------------------------ */

  function moveFocus(input, step) {
    const same = [...document.querySelectorAll(`.cap[data-field="${input.dataset.field}"]`)];
    const next = same[same.indexOf(input) + step];
    if (next) {
      next.focus();
      next.select();
    }
  }

  function wireFileInput(inputId, dropId, handler) {
    const input = $(inputId);
    const drop = $(dropId);
    input.addEventListener("change", () => input.files[0] && handler(input.files[0]));
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("over");
      const file = event.dataTransfer.files[0];
      if (file) handler(file);
    });
  }

  wireFileInput("#file-ruteo", "#drop-ruteo", onRuteo);
  wireFileInput("#file-gls", "#drop-gls", onGls);

  $("#fecha").addEventListener("change", (event) => {
    setFecha(event.target.value);
    render();
    announceLoaded("Fecha cambiada.");
  });

  $("#descos").addEventListener("change", (event) => {
    const box = event.target;
    box.checked ? state.selected.add(box.value) : state.selected.delete(box.value);
    refresh();
  });

  $("#select-all").addEventListener("click", () => {
    const all = descos();
    state.selected = state.selected.size === all.length ? new Set() : new Set(all);
    renderPicker();
    refresh();
  });

  $("#rutas").addEventListener("change", (event) => {
    const box = event.target;
    box.checked ? state.hiddenRoutes.delete(box.value) : state.hiddenRoutes.add(box.value);
    render();
  });

  $("#rutas").addEventListener("click", (event) => {
    const desco = event.target.closest("[data-toggle-routes]")?.dataset.toggleRoutes;
    if (!desco) return;
    const keys = routesOf(desco).map((route) => routeKey(desco, route.ruta));
    const allVisible = keys.every((key) => !state.hiddenRoutes.has(key));
    keys.forEach((key) => (allVisible ? state.hiddenRoutes.add(key) : state.hiddenRoutes.delete(key)));
    refresh();
  });

  $("#opt-factura").addEventListener("change", render);
  $("#copy-selected").addEventListener("click", () => copyDescos(chosenDescos().filter((d) => visibleRoutesOf(d).length)));

  $("#clear-day").addEventListener("click", () => {
    if (!confirm("¿Borrar TARIMAS, GLS y WTMS capturados para esta fecha?")) return;
    Conteo.store.clearDay();
    render();
    announce("Capturas del dia borradas.");
  });

  const output = $("#output");
  output.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (button) copyDescos([button.dataset.copy]);
  });

  output.addEventListener("input", (event) => {
    const input = event.target.closest(".cap");
    if (!input) return;
    const { field, ruta, dette } = input.dataset;
    Conteo.store.set(ruta, field, input.value.trim(), dette);
    syncTwins(input);
    if (field === "GLS") {
      input.removeAttribute("data-suggested");
      markUnknownGls(input);
    }
    if (field !== "WTMS") refreshFacturas(ruta);
    if (field === "TARIMAS") {
      refreshTotals(ruta);
      setActive(input); // actualiza el total en la barra fija
    }
  });

  output.addEventListener("focusin", (event) => setActive(event.target.closest(".cap-tarimas")));
  output.addEventListener("focusout", () => setActive(null)); // el siguiente focusin vuelve a marcar

  output.addEventListener("keydown", (event) => {
    const input = event.target.closest(".cap");
    if (!input) return;
    if (event.key === "Enter" || event.key === "ArrowDown") { event.preventDefault(); moveFocus(input, event.shiftKey ? -1 : 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(input, -1); }
  });
})();
