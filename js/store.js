/* Capturas manuales (TARIMAS, GLS, WTMS) guardadas en el navegador
 * por fecha de ruteo, para no perder el conteo si se cierra la pestana.
 * MAPA = tarimas que conto el lector de mapas (para marcar diferencias con TARIMAS). */
window.Conteo = window.Conteo || {};

Conteo.store = (() => {
  const PREFIX = "conteo-tarimas:";
  const STORE_FIELDS = { TARIMAS: "tarimas", MAPA: "mapa" }; // por tienda (requieren dette)
  let fecha = "";
  let data = {};

  function keyFor(day) {
    return PREFIX + (day || "sin-fecha");
  }

  function load(day) {
    fecha = day;
    try {
      data = JSON.parse(localStorage.getItem(keyFor(day))) || {};
    } catch {
      data = {};
    }
  }

  function persist() {
    try {
      localStorage.setItem(keyFor(fecha), JSON.stringify(data));
    } catch {
      /* almacenamiento lleno o bloqueado: seguimos solo en memoria */
    }
  }

  function routeData(ruta) {
    data[ruta] = data[ruta] || {};
    return data[ruta];
  }

  /** field: "GLS" | "WTMS" (ruta) o "TARIMAS" | "MAPA" (tienda, requiere dette). */
  function get(ruta, field, dette) {
    const route = data[ruta];
    if (!route) return "";
    const storeField = STORE_FIELDS[field];
    return (storeField ? route[storeField]?.[dette] : route[field]) ?? "";
  }

  function set(ruta, field, value, dette) {
    const route = routeData(ruta);
    const storeField = STORE_FIELDS[field];
    if (storeField) (route[storeField] = route[storeField] || {})[dette] = value;
    else route[field] = value;
    persist();
  }

  function clearDay() {
    data = {};
    localStorage.removeItem(keyFor(fecha));
  }

  return Object.freeze({ load, get, set, clearDay });
})();
