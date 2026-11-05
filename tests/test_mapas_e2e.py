"""Prueba de punta a punta del lector de mapas (sin navegador).

Arma UN solo PDF con todos los mapas de docs/ (sin numero de ruta en el nombre y con
una hoja de cabeza), lo lee con lector/mapa.py y decide rutas/tarimas con el JS real
(js/ruteo.js + js/mapas.js en V8). Compara contra docs/CONTEO.xlsx.

Uso (desde la raiz; el RUTEO no debe estar bloqueado por Excel, o pasa una copia):
    uv run --no-project --with-requirements lector/requirements.txt --with openpyxl --with mini-racer \
        python tests/test_mapas_e2e.py "RUTEO 05-11-2026.xlsx" [--cache]
--cache reutiliza la lectura OCR anterior (tests/.cache_lectura.json) para iterar rapido en el JS.
"""
import json, os, sys, warnings
from pathlib import Path

import openpyxl
import pymupdf
from py_mini_racer import MiniRacer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from lector import mapa  # noqa: E402

warnings.filterwarnings("ignore")
CACHE = Path(__file__).parent / ".cache_lectura.json"
UPSIDE_DOWN_PAGE = 3  # esta hoja se mete de cabeza a proposito
# Diferencias ya conocidas: el mapa 6110 dice 1983=4 y 1435=4 (CONTEO capturo 5 y 3);
# en 6108 la etiqueta de 1036 de la celda 13d esta tapada (queda "por revisar").
KNOWN = {("6110", "1983"), ("6110", "1435"), ("6108", "1036")}


def merged_pdf():
    """Todos los mapas en un PDF; la hoja UPSIDE_DOWN_PAGE girada 180 grados. -> (bytes, rutas en orden)."""
    out, order = pymupdf.open(), []
    for pdf in sorted((ROOT / "docs").glob("*.pdf")):
        out.insert_pdf(pymupdf.open(pdf))
        order.append(pdf.name.split()[0])
    out[UPSIDE_DOWN_PAGE - 1].set_rotation(180)
    return out.tobytes(), order


def read_sheets(use_cache):
    if use_cache and CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    data, order = merged_pdf()
    name = "escaneo sin nombre.pdf"
    sheets = []
    for page, img in enumerate(mapa.sheets(name, data), start=1):
        reading = mapa.read_sheet(img)
        print(f"  hoja {page}: girada {reading['rotated']} grados, {len(reading['cells'])} celdas", flush=True)
        sheets.append({"file": name, "page": page, "pages": len(order), "expected": order[page - 1], **reading})
    CACHE.write_text(json.dumps(sheets), encoding="utf-8")
    return sheets


def sheet_rows(path):
    """Hoja del RUTEO como la entrega util.readSheet (valores + colores)."""
    wb = openpyxl.load_workbook(path)
    ws = wb[next((n for n in wb.sheetnames if "RUTEO" in n.upper()), wb.sheetnames[0])]

    def fill(cell):
        f = cell.fill
        if f is None or f.patternType in (None, "none") or f.fgColor is None:
            return ""
        c = f.fgColor
        value = str(c.rgb)[-6:] if c.type == "rgb" else f"T{c.theme if c.type == 'theme' else c.indexed}"
        return "" if value == "FFFFFF" else f"#{value}"

    rows, fills = [], []
    for row in ws.iter_rows(max_col=ws.max_column):
        rows.append([c.value if isinstance(c.value, (int, float, str)) or c.value is None else str(c.value) for c in row])
        fills.append([fill(c) for c in row])
    return {"rows": rows, "fills": fills}


def load_conteo():
    truth, ruta = {}, None
    for row in openpyxl.load_workbook(ROOT / "docs" / "CONTEO.xlsx").worksheets[0].iter_rows(values_only=True):
        if row[1] is not None and str(row[1]).isdigit():
            ruta = str(row[1])
            truth[ruta] = {}
        if ruta and str(row[5] or "").replace(".0", "").isdigit():
            truth[ruta][str(int(row[5]))] = int(row[10] or 0)
    return truth


def main():
    ruteo_path = next(a for a in sys.argv[1:] if not a.startswith("--"))
    sheets = read_sheets("--cache" in sys.argv)
    ctx = MiniRacer()
    ctx.eval("var window = this; var location = { protocol: 'file:' };")
    for name in ("config.js", "util.js", "ruteo.js", "mapas.js"):
        ctx.eval((ROOT / "js" / name).read_text(encoding="utf-8"))
    ctx.eval(f"var routes = Conteo.ruteo.parseSheet({json.dumps(sheet_rows(ruteo_path))});")

    truth, failures = load_conteo(), []
    for sheet in sheets:
        js_sheet = json.dumps({k: sheet[k] for k in ("file", "page", "pages", "cells")})
        result = json.loads(ctx.eval(f"""(() => {{
            const sheet = {js_sheet};
            const id = Conteo.mapas.identify(sheet, routes);
            const route = routes.find((r) => r.ruta === id.ruta);
            if (!route) return JSON.stringify({{id}});
            const cells = Conteo.mapas.interpret(sheet, route);
            const counts = Conteo.mapas.countTarimas(cells, route);
            const byDette = Object.fromEntries(route.stores.filter((s) => counts[s.key]).map((s) => [s.dette, counts[s.key]]));
            return JSON.stringify({{id, byDette, review: cells.filter((c) => c.review).map((c) => c.pos)}});
        }})()"""))
        ruta, expected = result["id"]["ruta"], sheet["expected"]
        print(f"\nHoja {sheet['page']} (girada {sheet['rotated']}): ruta={ruta or '??'} por {result['id']['how'] or '-'}"
              f"  esperada={expected}  revisar={result.get('review')}")
        if ruta != expected:
            failures.append(f"hoja {sheet['page']}: ruta {ruta or '??'} en vez de {expected}")
            continue
        for dette, want in sorted(truth[ruta].items()):
            got = result["byDette"].get(dette, 0)
            known = (ruta, dette) in KNOWN
            print(f"   {dette}: mapa={got:>2} conteo={want:>2} {'OK' if got == want else 'conocida' if known else 'FALLA'}")
            if got != want and not known:
                failures.append(f"ruta {ruta} tienda {dette}: {got} en vez de {want}")
    print("\n" + ("TODO BIEN" if not failures else "FALLAS:\n  " + "\n  ".join(failures)))
    os._exit(1 if failures else 0)  # mini-racer se cuelga al cerrar V8


if __name__ == "__main__":
    main()
