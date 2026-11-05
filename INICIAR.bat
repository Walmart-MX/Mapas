@echo off
rem Conteo de Tarimas: levanta el lector de mapas y abre la app en el navegador.
rem Cierra esta ventana para apagar el lector.
title Conteo de Tarimas - lector de mapas
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
  echo No encontre "uv". Instalalo desde https://puppy.walmart.com o pide ayuda a soporte.
  pause
  exit /b 1
)

echo Preparando el lector (la primera vez tarda un par de minutos)...
uv run --no-project --with-requirements lector\requirements.txt ^
  --index-url https://pypi.ci.artifacts.walmart.com/artifactory/api/pypi/external-pypi/simple ^
  --allow-insecure-host pypi.ci.artifacts.walmart.com ^
  python -m lector
if errorlevel 1 pause
