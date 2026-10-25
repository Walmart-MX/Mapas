/* Capturas manuales (TARIMAS, GLS, WTMS) guardadas en el navegador
 * por fecha de ruteo, para no perder el conteo si se cierra la pestana. */
window.Conteo = window.Conteo || {};

Conteo.store = (() => {
  const PREFIX = "conteo-tarimas:";
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
    data[ruta] = data[ruta] || { tarimas: {} };
    return data[ruta];
  }

  /** field: "GLS" | "WTMS" (ruta) o "TARIMAS" (tienda, requiere dette). */
  function get(ruta, field, dette) {
    const route = data[ruta];
    if (!route) return "";
    return (field === "TARIMAS" ? route.tarimas?.[dette] : route[field]) ?? "";
  }

  function set(ruta, field, value, dette) {
    const route = routeData(ruta);
    if (field === "TARIMAS") route.tarimas[dette] = value;
    else route[field] = value;
    persist();
  }

  function clearDay() {
    data = {};
    localStorage.removeItem(keyFor(fecha));
  }

  return Object.freeze({ load, get, set, clearDay });
})();
