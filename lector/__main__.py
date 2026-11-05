"""`python -m lector`: levanta el lector y abre la app en el navegador."""
import socket
import threading
import webbrowser

import uvicorn

from . import mapa
from .server import PORT, app

URL = f"http://localhost:{PORT}"


def already_running():
    with socket.socket() as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", PORT)) == 0


def main():
    if already_running():
        print(f"El lector ya estaba corriendo: abriendo {URL}")
        webbrowser.open(URL)
        return
    print(f"Lector de mapas listo en {URL}  (cierra esta ventana para apagarlo)")
    threading.Thread(target=mapa.ocr_engine, daemon=True).start()  # precarga el OCR mientras abre el navegador
    threading.Timer(1.5, lambda: webbrowser.open(URL)).start()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
