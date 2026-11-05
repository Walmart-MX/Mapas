"""Servidor local: sirve la app y lee mapas escaneados.

POST /api/mapas  (multipart, campo "files", uno o varios PDF/imagenes)
    Responde NDJSON, una linea por evento, para mostrar avance en vivo:
        {"type": "start", "total": 7}
        {"type": "sheet", "file": "escaneo.pdf", "page": 1, "pages": 3, "isMap": true, "cells": [...], ...}
        {"type": "sheet", "file": "otro.pdf", "page": 1, "pages": 1, "error": "no es un PDF valido"}
        {"type": "end"}
Solo escucha en 127.0.0.1: nada sale de la compu.
"""
import json
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import mapa

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765  # no usar 8080 (Teams)

app = FastAPI(title="Lector de mapas de carga")
# Permite usar la app abierta como archivo (file://) contra este lector.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/api/salud")
def salud():
    return {"ok": True}


def _line(event):
    return json.dumps(event, ensure_ascii=False) + "\n"


def _count(name, data):
    try:
        return mapa.count_pages(name, data)
    except Exception:  # archivo danado: cuenta como 1 hoja con error
        return 1


def _read_all(docs):
    """Generador sincrono (Starlette lo corre en un hilo aparte): una linea por hoja."""
    yield _line({"type": "start", "total": sum(_count(name, data) for name, data in docs)})
    for name, data in docs:
        pages = _count(name, data)
        try:
            for page, img in enumerate(mapa.sheets(name, data), start=1):
                try:
                    reading = mapa.read_sheet(img)
                except Exception:  # una hoja mala no tumba las demas
                    reading = {"error": "No pude leer esta hoja (¿viene en blanco o muy borrosa?)"}
                yield _line({"type": "sheet", "file": name, "page": page, "pages": pages, **reading})
        except Exception:
            yield _line({"type": "sheet", "file": name, "page": 1, "pages": pages,
                         "error": "No pude abrir el archivo: ¿está dañado o no es un PDF/imagen?"})
    yield _line({"type": "end"})


@app.post("/api/mapas")
async def leer_mapas(files: list[UploadFile] = File(...)):
    docs = [(f.filename or "sin-nombre.pdf", await f.read()) for f in files]
    return StreamingResponse(_read_all(docs), media_type="application/x-ndjson")


# La app (solo lo necesario: nada de docs/ ni ruteos por HTTP).
for folder in ("css", "js", "vendor"):
    app.mount(f"/{folder}", StaticFiles(directory=ROOT / folder), name=folder)


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")
