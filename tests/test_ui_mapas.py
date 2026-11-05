"""Prueba E2E de la pantalla de mapas con Playwright (Edge instalado, sin descargar navegadores).

Requiere el lector corriendo (INICIAR.bat o `python -m lector`) y archivos de prueba:
    uv run --no-project --with playwright python tests/test_ui_mapas.py RUTEO.xlsx LOTE.pdf
LOTE.pdf = mapas 6108, 6110 (de cabeza) y 6115 en un solo PDF (ver tests/test_mapas_e2e.py).
Capturas en tests/.salida/.
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

URL = "http://127.0.0.1:8765"
OUT = Path(__file__).parent / ".salida"
OCR_TIMEOUT = 8 * 60 * 1000  # OCR en CPU: hasta ~90 s por hoja
results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(f"{'PASA ' if condition else 'FALLA'} {name} {detail}", flush=True)


def tarimas(page, ruta, dette):
    box = page.locator(f'table[data-ruta="{ruta}"] input.cap-tarimas[data-dette="{dette}"]').first
    return box.input_value(), box.get_attribute("data-mapa")


def card(page, ruta):
    return page.locator("article.mapa-card", has=page.locator("h3", has_text=f"Ruta {ruta}"))


def main(ruteo, lote):
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        # --no-proxy-server: el proxy corporativo resetea las conexiones a localhost
        browser = p.chromium.launch(channel="msedge", headless=True, args=["--no-proxy-server"])
        page = browser.new_page(viewport={"width": 1500, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("dialog", lambda d: d.accept())

        page.goto(URL)
        expect(page.locator("#mapas-hint")).to_have_text("PDF o fotos · uno o varios · varias hojas por archivo")
        check("1 lector detectado", True)

        page.set_input_files("#file-ruteo", ruteo)
        expect(page.locator("#status")).to_contain_text("Ruteo cargado")
        check("2 ruteo cargado", True, page.locator("#status").inner_text()[:80])

        for desco in ("MERIDA", "FRIALSA"):
            page.locator(f'#descos input[value="{desco}"]').check(force=True)
        expect(page.locator('table[data-ruta="6110"]')).to_be_visible()
        check("3 tablas MERIDA/FRIALSA", page.locator('table[data-ruta="6115"]').count() == 1)

        started = time.perf_counter()
        page.set_input_files("#file-mapas", lote)
        expect(page.locator("#mapas-progress")).to_be_visible()
        check("4a progreso visible", True, page.locator("#mapas-progress-text").inner_text())
        expect(page.locator("article.mapa-card").first).to_be_visible(timeout=OCR_TIMEOUT)
        check("4b primera tarjeta antes de terminar todo", page.locator("#mapas-progress").is_visible(),
              f"a los {time.perf_counter() - started:.0f} s: {page.locator('#mapas-progress-text').inner_text()}")
        expect(page.locator("#mapas-progress")).to_be_hidden(timeout=OCR_TIMEOUT)
        check("4c lectura terminada", True, f"en {time.perf_counter() - started:.0f} s")

        cards = page.locator("article.mapa-card")
        check("5 tres tarjetas", cards.count() == 3, f"({cards.count()})")
        for i in range(cards.count()):
            c = cards.nth(i)
            print("    tarjeta:", c.locator("h3").inner_text(), "|", c.locator("p.hint").first.inner_text(),
                  "|", c.locator("p.badge").inner_text())
        check("5b 6110 enderezada", "girada 180" in card(page, "6110").locator("p.hint").first.inner_text())

        want = {"1983": "4", "1435": "4", "4048": "9", "4131": "5", "4777": "4"}
        got = {d: tarimas(page, "6110", d) for d in want}
        check("6 TARIMAS 6110 llenadas del mapa", all(got[d] == (v, "match") for d, v in want.items()), str(got))

        box = page.locator('table[data-ruta="6110"] input.cap-tarimas[data-dette="1435"]').first
        box.fill("3")
        check("7a tecleado distinto -> mismatch", box.get_attribute("data-mapa") == "mismatch")
        diff = card(page, "6110").locator("div.mapa-diff")
        expect(diff).to_contain_text("capturado 3")
        check("7b diferencia listada", "mapa 4" in diff.inner_text())
        diff.get_by_role("button", name="Usar lo del mapa").click()
        check("7c usar lo del mapa", tarimas(page, "6110", "1435") == ("4", "match"))

        c6108 = card(page, "6108")
        c6108.get_by_role("button", name="Revisar").click()
        cell = c6108.locator("fieldset.celda", has=page.locator("legend", has_text="Posición 13d"))
        expect(cell).to_be_visible()
        checked = [b.get_attribute("value") for b in cell.locator("input:checked").all()]
        check("8a 13d detecto 4061", checked == ["4061"], str(checked))
        before = tarimas(page, "6108", "1036")[0]
        cell.locator('input[value="1036"]').check(force=True)
        cell = card(page, "6108").locator("fieldset.celda", has=page.locator("legend", has_text="Posición 13d"))
        check("8b 1036 sube a 9", tarimas(page, "6108", "1036")[0] == "9", f"(antes {before})")
        check("8c 4061 sigue en 8", tarimas(page, "6108", "4061")[0] == "8")
        check("8d celda revisada", "revisada" in cell.locator("legend").inner_text())
        card(page, "6108").screenshot(path=str(OUT / "tarjeta_6108.png"))
        card(page, "6108").get_by_role("button", name="están bien así").click()
        check("8e confirmar todas -> Listo", card(page, "6108").locator("p.badge").inner_text() == "Listo",
              card(page, "6108").locator("p.badge").inner_text())
        check("8f confirmar no cambia conteos", tarimas(page, "6108", "1036")[0] == "9")

        select = card(page, "6115").locator("select")
        select.select_option("")
        check("9a sin ruta -> se limpia", tarimas(page, "6115", "2384")[0] == "")
        page.locator("article.mapa-card", has=page.locator("h3", has_text="sin identificar")).locator("select").select_option("6115")
        check("9b ruta elegida -> se llena", tarimas(page, "6115", "2384")[0] == "16")

        page.locator("#step-mapas").screenshot(path=str(OUT / "panel_mapas.png"))
        page.locator('table[data-ruta="6110"]').screenshot(path=str(OUT / "tabla_6110.png"))
        check("errores de consola", not errors, str(errors))
        browser.close()

    failed = [name for name, ok, _ in results if not ok]
    print("\n" + ("TODO BIEN" if not failed else f"FALLAS: {failed}"))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(*sys.argv[1:3])
