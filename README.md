# Conteo de Tarimas · Desconsolidadores

Sube el RUTEO, elige el desconsolidador, captura TARIMAS (a mano o desde los mapas
escaneados) y copia la tabla lista para el correo.

## Usar

**Doble clic en `INICIAR.bat`.** Levanta el lector de mapas en tu compu y abre la app en
el navegador (`http://localhost:8765`). La primera vez tarda un par de minutos en preparar
el lector. Cierra la ventana negra para apagarlo.

> Sin lector también puedes abrir `index.html` directo: todo funciona menos la lectura de mapas.

## Mapas de carga (FO-10257)

1. Carga el RUTEO (y el GLS si quieres facturas).
2. Arrastra a **MAPAS DE CARGA** uno o varios PDF (o fotos). Un PDF puede traer varias
   hojas, con cualquier nombre y aunque alguna venga de cabeza.
3. Cada hoja aparece como tarjeta en cuanto se lee (~40 s por hoja en una laptop; puedes
   ir revisando la primera mientras se leen las demás):
   - **Listo**: la ruta salió de las etiquetas y TARIMAS ya se llenó.
   - **Celdas por revisar**: etiquetas encimadas o ilegibles. Abre "Revisar" y palomea
     la(s) tienda(s) de cada recorte.
   - **¿De qué ruta es?**: elígela en la lista.
4. En las tablas, TARIMAS en verde = contado del mapa; con marco rojo = lo capturado no
   cuadra con el mapa (pasa el mouse para ver qué dice el mapa).

Reglas: TARIMAS de una tienda = posiciones con su etiqueta (dos tiendas en una posición =
1 para cada una). Nunca se pisa lo que tecleaste; en la duda la app pregunta, no adivina.

## Piezas

| Parte | Qué hace |
|---|---|
| `lector/` (Python) | "Ojos": separa hojas, endereza, ubica las 28 posiciones y lee el texto (OCR local, nada sale de la compu). |
| `js/mapas.js` | "Cerebro": con el RUTEO decide la ruta de cada hoja y las tarimas por tienda. |
| `js/mapas-ui.js` | Panel de mapas: avance, tarjetas, revisión de celdas. |
| `tests/` | `test_mapas_e2e.py` (lector + JS contra CONTEO real) y `test_ui_mapas.py` (Playwright con Edge). |

Tip: escanear a **300 dpi** ayuda con las etiquetas medio tapadas.
