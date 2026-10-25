/* Configuracion central del Conteo de Tarimas.
 * Si cambia el formato del correo, se cambia AQUI y en ningun otro lado. */
window.Conteo = window.Conteo || {};

Conteo.config = (() => {
  const BASE_COLUMNS = [
    "FECHA", "RUTA", "TRACTOR", "UNIDAD", "LINEA", "DETTE", "ESTADO", "FORMATO",
    "TIENDA", "CAJAS", "TARIMAS", "GLS", "FACTURA", "MERCANCIA", "TEMPERATURA",
    "LT", "VENTANAS VERDES", "WTMS",
  ];

  // Veracruz lleva VENTANAS VERDES antes de LT (asi viene en su plantilla).
  const VERACRUZ_COLUMNS = BASE_COLUMNS.map((col) =>
    col === "LT" ? "VENTANAS VERDES" : col === "VENTANAS VERDES" ? "LT" : col
  );

  const COLUMNS_BY_DESCO = { VERACRUZ: VERACRUZ_COLUMNS };

  return Object.freeze({
    /** Posicion FIJA de columnas en la hoja del RUTEO (no se leen encabezados).
     *  A=0 B=1 C=2 D=3 E=4 F=5 G=6 H=7 I=8 J=9 K=10 L=11 M=12 N=13 O=14 P=15 Q=16 */
    RUTEO_COLUMNS: Object.freeze({
      CORTINA: 0,        // A
      CONGE_REFRI: 3,    // D
      RUTA: 4,           // E
      REMOLQUE: 5,       // F
      LINEA: 6,          // G
      DETTE: 7,          // H  (su color define el grupo)
      ESTADO: 8,         // I
      FORMATO: 9,        // J
      TIENDA: 10,        // K
      CAJAS: 11,         // L
      VENTANA: 13,       // N
      LT: 14,            // O
      SETEO: 16,         // Q
    }),
    /** Columnas que llevan el color del grupo (F:J de la plantilla) y donde va el comentario. */
    GROUP_COLUMNS: Object.freeze(["DETTE", "ESTADO", "FORMATO", "TIENDA", "CAJAS"]),
    /** Columnas que se capturan a mano en la pantalla. */
    EDITABLE: Object.freeze({ route: ["GLS", "WTMS"], store: ["TARIMAS"] }),
    /** Una sola celda por ruta (combinada), igual en pantalla y en el correo. */
    MERGED_COLUMNS: Object.freeze(["FECHA", "RUTA", "TRACTOR", "UNIDAD", "GLS", "MERCANCIA", "TEMPERATURA", "WTMS"]),
    /** Textos de la columna RUTA que NO son tractor (los marcadores de desco se descartan aparte). */
    NOT_A_TRACTOR: /^(RESP|CONGELADO|REFRIGERADO)/i,
    /** Notas en DETTE que solo son etiqueta y no se copian al correo. */
    IGNORED_NOTES: /^(CONGELADO|REFRIGERADO)$/i,
    /** Desconsolidadores conocidos: se reconocen solos (sin "DESCO") en RUTA o en comentarios. */
    KNOWN_DESCOS: Object.freeze(["FRIALSA", "MERIDA", "TUXTLA", "VERACRUZ"]),
    MERCANCIA: Object.freeze({ R: "REFRIGERADO", F: "CONGELADO" }),
    COLORS: Object.freeze({
      title: "#FFFF00",
      header: "#00B0F0",
      note: "#FFC000", // solo si el comentario no trae color en el ruteo
    }),
    /** Bordes: fino normal (como Excel al copiar) y recuadro de grupo con comentario. */
    BORDERS: Object.freeze({
      thin: { email: ".5pt solid #000000", screen: "1px solid #000000" },
      box: { email: "2.25pt solid #000000", screen: "3px solid #000000" },
    }),
    /** Encabezados con color propio (VENTANAS VERDES va en verde). */
    HEADER_COLORS: Object.freeze({ "VENTANAS VERDES": "#00B050" }),
    columnsFor(desco) {
      return COLUMNS_BY_DESCO[desco] || BASE_COLUMNS;
    },
  });
})();
