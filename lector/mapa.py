"""Vision del FO-10257: hoja escaneada -> celdas ocupadas con su texto.

Pasos (validados con los mapas del 05-11-2026):
    1. Cada hoja del PDF se dibuja a 150 dpi (respeta rotacion y PDFs no escaneados).
    2. Se prueba la hoja derecha / de cabeza (o girada si viene horizontal). Gana la que deja
       las etiquetas de color en la mitad izquierda (ahi estan las celdas del formato); las
       lineas solo desempatan (la tabla de la derecha, de cabeza, tambien parece cuadricula).
    3. Plantilla fija de 14 filas x 2 columnas + corrimiento medido con las lineas visibles.
    4. Celda con etiqueta de color (amarilla refri / azul congelado) -> ocupada -> OCR local.
"""
import base64
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import cv2
import numpy as np
import pymupdf

# Plantilla en pixeles de carta a 150 dpi (1275x1650), medida en 6 escaneos (+-4 px).
TEMPLATE_W, TEMPLATE_H = 1275, 1650
ROW_LINES = [238, 335, 426, 527, 617, 719, 820, 918, 1023, 1128, 1232, 1330, 1428, 1518, 1598]
COLUMNS = {"i": (62, 392), "d": (424, 772)}
COLUMN_LINES = [396, 773]
SNAP = 15             # px de tolerancia para empatar una linea detectada con la plantilla
MIN_LINES = 4         # lineas de fila empatadas para aceptar que la hoja es un FO-10257
MIN_COLOR = 0.05      # porcion de la celda con color para considerarla ocupada
OCR_SCALE = 2.0       # las etiquetas son chicas a 150 dpi: se agrandan antes del OCR
OCR_WORKERS = max(1, min(6, (os.cpu_count() or 2) - 1))  # celdas en paralelo (deja un nucleo libre)
RENDER_DPI = 150
IMAGE_TYPES = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp")


@lru_cache(maxsize=1)
def ocr_engine():
    """RapidOCR tarda en cargar: una sola instancia para todo el proceso."""
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR()


# ---------- hojas ----------
def count_pages(name, data):
    if name.lower().endswith(IMAGE_TYPES):
        return 1
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return len(doc)


def sheets(name, data):
    """Imagenes BGR de cada hoja de un PDF (o de una imagen suelta)."""
    if name.lower().endswith(IMAGE_TYPES):
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("no es una imagen valida")
        yield img
        return
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=RENDER_DPI, colorspace=pymupdf.csRGB, alpha=False)
            rgb = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
            yield cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


# ---------- plantilla ----------
def line_positions(profile, threshold, min_gap=4):
    idx = np.where(profile > threshold)[0]
    if not len(idx):
        return []
    return [int(group.mean()) for group in np.split(idx, np.where(np.diff(idx) > min_gap)[0] + 1)]


def _dark(img):
    return (cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) < 110).astype(np.uint8)


def _row_lines(dark):
    """Lineas horizontales dentro de las dos columnas de celdas (las etiquetas tapan unas u otras)."""
    found = []
    for x0, x1 in ((95, 380), (440, 760)):
        found += line_positions(dark[:, x0:x1].mean(axis=1), 0.6)
    return sorted(found)


def matched_lines(found, template):
    return sum(any(abs(f - t) <= SNAP for f in found) for t in template)


def offset(found, template):
    """Desfase mediano entre las lineas detectadas y las de la plantilla (0 si no hay ninguna)."""
    diffs = [f - t for f in found for t in template if abs(f - t) <= SNAP]
    return int(np.median(diffs)) if diffs else 0


def _colored(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return (hsv[..., 1] > 40) & (hsv[..., 2] > 120)


def _labels_on_left(img):
    """True/False si las etiquetas de color quedan en la mitad izquierda; None si no hay etiquetas."""
    xs = np.where(_colored(img))[1]
    if len(xs) < 0.002 * img.shape[0] * img.shape[1]:  # una sola etiqueta ya pasa de 0.5%
        return None
    return xs.mean() < img.shape[1] / 2


def orient(img):
    """-> (hoja derecha al tamano de la plantilla, grados girados, lineas de fila empatadas)."""
    h, w = img.shape[:2]
    turns = ((90, cv2.ROTATE_90_CLOCKWISE), (270, cv2.ROTATE_90_COUNTERCLOCKWISE)) if w > h \
        else ((0, None), (180, cv2.ROTATE_180))
    best = None
    for degrees, code in turns:
        turned = img if code is None else cv2.rotate(img, code)
        turned = cv2.resize(turned, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA)
        lines = matched_lines(_row_lines(_dark(turned)), ROW_LINES)
        score = (100 if _labels_on_left(turned) else 0) + lines
        if best is None or score > best[3]:
            best = (turned, degrees, lines, score)
    return best[:3]


def find_cells(img):
    """{"1i": (x, y, w, h), "1d": ..., "14d": ...} con el corrimiento del escaneo aplicado."""
    dark = _dark(img)
    dy = offset(_row_lines(dark), ROW_LINES)
    dx = offset(line_positions(dark[280:1520, :810].mean(axis=0), 0.5), COLUMN_LINES)
    return {
        f"{row}{side}": (x0 + dx, top + dy, x1 - x0, bottom - top)
        for row, (top, bottom) in enumerate(zip(ROW_LINES, ROW_LINES[1:]), start=1)
        for side, (x0, x1) in COLUMNS.items()
    }


def colored_fraction(cell):
    return float(_colored(cell).mean())


# ---------- lectura ----------
def read_text(cell):
    big = cv2.resize(cell, None, fx=OCR_SCALE, fy=OCR_SCALE, interpolation=cv2.INTER_CUBIC)
    result, _ = ocr_engine()(big, use_cls=False)  # las etiquetas siempre vienen derechas
    return " ".join(r[1] for r in (result or []))


def data_url(img, width=None, quality=75):
    if width and img.shape[1] > width:
        img = cv2.resize(img, (width, round(img.shape[0] * width / img.shape[1])), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode() if ok else ""


def read_sheet(img):
    """Hoja -> {isMap, rotated, thumb, cells: [{pos, text, crop}]} (cells vacio si no es mapa)."""
    img, rotated, lines = orient(img)
    reading = {"isMap": lines >= MIN_LINES, "rotated": rotated, "thumb": data_url(img, width=520), "cells": []}
    if not reading["isMap"]:
        return reading
    occupied = []
    for pos, (x, y, w, h) in find_cells(img).items():
        cell = img[y + 3:y + h - 3, x + 3:x + w - 3]
        if colored_fraction(cell) >= MIN_COLOR:
            occupied.append((pos, cell))
    # Celdas en paralelo: con imagenes chicas el OCR no llena los nucleos (2.5x mas rapido).
    with ThreadPoolExecutor(OCR_WORKERS) as pool:
        texts = list(pool.map(read_text, [cell for _, cell in occupied]))
    reading["cells"] = [{"pos": pos, "text": text, "crop": data_url(cell)}
                        for (pos, cell), text in zip(occupied, texts)]
    return reading
