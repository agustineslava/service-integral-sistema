@echo off
title Sistema Service Integral - Servidor y Tunnel
color 0A

echo ===================================================
echo   INICIANDO SERVIDOR Y TUNEL DE SERVICE INTEGRAL
echo ===================================================
echo.

:: 1. Cerrar procesos previos que puedan retener archivos
taskkill /f /im cloudflared.exe >nul 2>&1
taskkill /f /im cloudflared.exe.exe >nul 2>&1

:: 2. Levantar el Backend
cd /d "%~dp0backend"
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [INFO] Iniciando con Node.js...
    start /b node server.js
) else (
    echo [INFO] Iniciando con PM2...
    call pm2 startOrRestart ecosystem.config.js
)

echo Esperando conexion con base de datos...
timeout /t 3 /nobreak >nul

:: 3. Volver a la raiz y limpiar el registro previo
cd /d "%~dp0"
if exist tunnel_log.txt del /f /q tunnel_log.txt >nul 2>&1

echo Conectando con Cloudflare...
echo.

:: 4. Determinar el ejecutable de Cloudflare
set "CF_EXE="
if exist "%~dp0cloudflared.exe" set "CF_EXE=%~dp0cloudflared.exe"
if exist "%~dp0cloudflared.exe.exe" set "CF_EXE=%~dp0cloudflared.exe.exe"

if not defined CF_EXE (
    echo [ERROR] No se encontro cloudflared.exe en la raiz.
    pause
    exit /b
)

start /b "" "%CF_EXE%" tunnel --url http://localhost:3000 > tunnel_log.txt 2>&1

:: 5. Extraer la URL de forma limpia usando PowerShell en una linea
set "MI_URL="
set /a reintentos=0

:BUSCAR_URL
timeout /t 2 /nobreak >nul
set /a reintentos+=1

for /f "usebackq tokens=*" %%A in (`powershell -NoProfile -Command "if (Test-Path 'tunnel_log.txt') { $m = Select-String -Path 'tunnel_log.txt' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'; if ($m) { $m.Matches[0].Value } }" 2^>nul`) do (
    set "MI_URL=%%A"
)

if defined MI_URL goto URL_OK

if %reintentos% LSS 10 (
    echo Obteniendo enlace seguro... (%reintentos%/10)
    goto BUSCAR_URL
)

echo.
echo [AVISO] Podes ingresar localmente en: http://localhost:3000/login.html
goto FIN

:URL_OK
echo ===================================================
echo  ENLACE DE ACCESO REMOTO GENERADO:
echo  %MI_URL%
echo ===================================================
echo.
echo Esperando propagacion de red (6 segundos)...
timeout /t 6 /nobreak >nul

echo Abriendo navegador...
start "" chrome "%MI_URL%/login.html"

:FIN
echo.
echo Servidor en ejecucion. Presiona cualquier tecla para cerrar esta ventana.
pause >nul