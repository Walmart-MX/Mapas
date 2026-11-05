"""PoC: conteo de TARIMAS leyendo el escaneo del FO-10257 MAPA DE CARGA.

Regla de negocio (validada contra CONTEO.xlsx del 05-11-2026):
    TARIMAS de una tienda = celdas (1i..14d) con etiqueta de esa tienda.
    Dos etiquetas de la MISMA tienda encimadas = 1 tarima; de tiendas DISTINTAS = 1 c/u.

Como funciona:
    1. Plantilla fija del formato (14 filas x 2 columnas) + corrimiento medido con las lineas visibles.
    2. Celda con etiqueta de color (amarilla refri / azul congelado) -> ocupada.
    3. OCR local (RapidOCR, sin internet) -> DEST, eligiendo SOLO entre las DETTE de la ruta.
    4. Celdas con etiquetas encimadas o ilegibles -> "REVISAR" (no se adivina).

Uso (desde la raiz del proyecto):
    uv run --with openpyxl --with opencv-python-headless --with rapidocr_onnxruntime --with pymupdf \
        python poc/conteo_mapas.py [docs] [6107 6110 ...] [-v]

Las DETTE de cada ruta salen de docs/CONTEO.xlsx (en la app saldrian del RUTEO).
Imagenes de depuracion en poc/salida/<ruta>_debug.jpg.
"""
import os, re, sys, warnings
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import openpyxl
import pymupdf
from rapidocr_onnxruntime import RapidOCR

warnings.filterwarnings("ignore")
OUT = Path(__file__).parent / "salida"

# Plantilla del FO-10257 en pixeles de carta a 150 dpi (1275x1650), medida en 6 escaneos (+-4 px).
TEMPLATE_W, TEMPLATE_H = 1275, 1650
ROW_LINES = [238, 335, 426, 527, 617, 719, 820, 918, 1023, 1128, 1232, 1330, 1428, 1518, 1598]
COLUMNS = {"i": (62, 392), "d": (424, 772)}
COLUMN_LINES = [396, 773]
SNAP = 15             # px de tolerancia para empatar una linea detectada con la plantilla
MIN_COLOR = 0.05      # porcion de la celda con color para considerarla ocupada
STRONG = 2            # voto de DEST exacto o de CTR que empieza con el DEST


# ---------- entrada ----------
def load_conteo(path):
    """CONTEO.xlsx -> {ruta: {dette: tarimas}}"""
    truth, ruta = {}, None
    for row in openpyxl.load_workbook(path).worksheets[0].iter_rows(values_only=True):
        if row[1] is not None and str(row[1]).isdigit():
            ruta = str(row[1])
            truth[ruta] = {}
        if ruta and str(row[5] or "").replace(".0", "").isdigit():
            truth[ruta][str(int(row[5]))] = int(row[10] or 0)
    return truth


def pdf_image(path):
    """Imagen escaneada (1a pagina) del PDF, en BGR y del tamano de la plantilla."""
    doc = pymupdf.open(path)
    xref = doc[0].get_images()[0][0]
    data = np.frombuffer(doc.extract_image(xref)["image"], np.uint8)
    return cv2.resize(cv2.imdecode(data, cv2.IMREAD_COLOR), (TEMPLATE_W, TEMPLATE_H))


# ---------- celdas ----------
def line_positions(profile, threshold, min_gap=4):
    idx = np.where(profile > threshold)[0]
    if not len(idx):
        return []
    return [int(group.mean()) for group in np.split(idx, np.where(np.diff(idx) > min_gap)[0] + 1)]


def offset(found, template):
    """Desfase mediano entre las lineas detectadas y las de la plantilla (0 si no hay ninguna)."""
    diffs = [f - t for f in found for t in template if abs(f - t) <= SNAP]
    return int(np.median(diffs)) if diffs else 0


def find_cells(img):
    """{"1i": (x, y, w, h), "1d": ..., "14d": ...} con el corrimiento del escaneo aplicado."""
    dark = (cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) < 110).astype(np.uint8)
    dy = offset(line_positions(dark[:, 95:380].mean(axis=1), 0.6), ROW_LINES)
    dx = offset(line_positions(dark[280:1520, :810].mean(axis=0), 0.5), COLUMN_LINES)
    return {
        f"{row}{side}": (x0 + dx, top + dy, x1 - x0, bottom - top)
        for row, (top, bottom) in enumerate(zip(ROW_LINES, ROW_LINES[1:]), start=1)
        for side, (x0, x1) in COLUMNS.items()
    }


def colored_fraction(cell):
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)
    return ((hsv[..., 1] > 40) & (hsv[..., 2] > 120)).mean()


# ---------- lectura ----------
def read_tokens(ocr, cell):
    result, _ = ocr(cv2.resize(cell, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC))
    return re.findall(r"\d+", " ".join(r[1] for r in (result or [])))


def pick_dests(tokens, candidates):
    """DESTs de la celda entre las DETTE conocidas (puede haber 2). [] = no se pudo leer."""
    votes = Counter()
    for tok in tokens:
        for cand in candidates:
            if tok == cand or (len(tok) >= 10 and tok.startswith(cand + "0")):
                votes[cand] += STRONG
            elif len(tok) == 4 and sum(a != b for a, b in zip(tok, cand)) == 1:
                votes[cand] += 1  # DEST con 1 digito mal leido
    strong = sorted(cand for cand, n in votes.items() if n >= STRONG)
    if strong:
        return strong
    best = votes.most_common(2)
    if not best or (len(best) > 1 and best[0][1] == best[1][1]):
        return []  # nada o empate: no adivinar
    return [best[0][0]]


def route_mentions(tokens, ruta):
    """Veces que aparece la ruta impresa ("6108", "5108", "108"): >1 = etiquetas encimadas."""
    return sum(1 for tok in tokens if 3 <= len(tok) <= 4 and tok.endswith(ruta[-3:]))


def count_map(ocr, img, ruta, candidates):
    """-> (Counter{dette: tarimas, "revisar": n}, [(pos, dests, revisar, tokens)], imagen_debug)"""
    counts, report, debug = Counter(), [], img.copy()
    for pos, (x, y, w, h) in find_cells(img).items():
        cell = img[y + 3:y + h - 3, x + 3:x + w - 3]
        if colored_fraction(cell) < MIN_COLOR:
            continue
        tokens = read_tokens(ocr, cell)
        dests = pick_dests(tokens, candidates)
        review = not dests or route_mentions(tokens, ruta) > 1
        counts.update(dests or ["??"])
        counts["revisar"] += review
        report.append((pos, dests, review, tokens))
        color = (0, 140, 255) if review else (0, 170, 0)
        cv2.rectangle(debug, (x, y), (x + w, y + h), color, 3)
        cv2.putText(debug, f"{pos}:{'+'.join(dests) or '??'}", (x + 5, y + h - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    return counts, report, debug


# ---------- main ----------
def main(args):
    verbose = "-v" in args
    only = {a for a in args if a.isdigit()}
    folders = [a for a in args if not a.isdigit() and a != "-v"]
    docs = Path(folders[0] if folders else "docs")
    truth = load_conteo(docs / "CONTEO.xlsx")
    OUT.mkdir(exist_ok=True)
    ocr, ok, total, flagged, cells = RapidOCR(), 0, 0, 0, 0

    for pdf in sorted(docs.glob("*.pdf")):
        ruta = re.match(r"\d+", pdf.name).group()
        if only and ruta not in only:
            continue
        expected = truth.get(ruta, {})
        counts, report, debug = count_map(ocr, pdf_image(pdf), ruta, list(expected))
        cv2.imwrite(str(OUT / f"{ruta}_debug.jpg"), debug)
        flagged += counts["revisar"]
        cells += len(report)
        print(f"\n=== RUTA {ruta}: {len(report)} celdas ocupadas, {counts['revisar']} a revisar")
        if verbose:
            for pos, dests, review, tokens in report:
                print(f"    {pos:>4} {'+'.join(dests) or '??':>10} {'REVISAR' if review else '':7} {' '.join(tokens)[:60]}")
        for dette in sorted(set(expected) | set(counts) - {"revisar"}):
            got, exp = counts.get(dette, 0), expected.get(dette, 0)
            total += 1
            ok += got == exp
            print(f"   {dette:>5}: mapa={got:>2}  conteo={exp:>2}  {'OK' if got == exp else 'XX'}")
    print(f"\nRESUMEN: {ok}/{total} tiendas iguales al CONTEO; {flagged}/{cells} celdas marcadas para revisar")


if __name__ == "__main__":
    main(sys.argv[1:])
