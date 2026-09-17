@echo off
title Sistema Service Integral - Servidor y Tunnel
color 0A

echo ===================================================
echo   INICIANDO SERVIDOR Y TUNEL DE SERVICE INTEGRAL
echo ===================================================
echo.

:: 1. Ir a la carpeta backend e iniciar Node.js
cd /d "%~dp0backend"
start /b node server.js

echo Esperando 3 segundos a que Node.js conecte con MySQL...
timeout /t 3 /nobreak >nul

:: 2. Volver a la carpeta raiz
cd /d "%~dp0"

:: Limpiar log anterior si existe
if exist tunnel_log.txt del tunnel_log.txt

echo Generando enlace seguro de Cloudflare...
echo.

:: 3. Ejecutar Cloudflare guardando el log de salida
start /b "" "%~dp0cloudflared.exe" tunnel --url http://localhost:3000 > tunnel_log.txt 2>&1

:: 4. Esperar 6 segundos a que Cloudflare cree el tunnel
timeout /t 6 /nobreak >nul

:: 5. Extraer la URL exacta con PowerShell y abrir Chrome
set "MI_URL="
for /f "usebackq tokens=*" %%A in (`powershell -Command "Select-String -Path 'tunnel_log.txt' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | ForEach-Object { $_.Matches.Value } | Select-Object -First 1"`) do (
    set "MI_URL=%%A"
)

if defined MI_URL (
    echo ===================================================
    echo  ENLACE DE ACCESO REMOTO GENERADO:
    echo  %MI_URL%
    echo ===================================================
    echo.
    echo Abriendo navegador...
    start chrome "%MI_URL%/login.html"
) else (
    echo ?? No se pudo extraer la URL automaticamente.
    echo Podes ingresar localmente desde: http://localhost:3000/login.html
)

:FIN
echo.
echo Presiona cualquier tecla para finalizar esta ventana.
pause >nul