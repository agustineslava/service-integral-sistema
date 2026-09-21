@echo off
setlocal enabledelayedexpansion
title Probar Restore de Backup - Service Integral
color 0B

echo ===================================================
echo   PRUEBA DE RESTORE DE BACKUP
echo ===================================================
echo.
echo Este script NO toca tu base de datos real.
echo Crea una base nueva llamada _test_restore, restaura
echo ahi el ultimo backup, y te muestra cuantas filas
echo tiene cada tabla para que verifiques que esta OK.
echo.

cd /d "%~dp0backend"

if not exist ".env" (
    echo [ERROR] No se encontro el archivo .env en esta carpeta.
    echo Corre este .bat desde la carpeta raiz del proyecto.
    pause
    exit /b
)

:: Leer DB_HOST y MYSQLDUMP_PATH desde el .env (esto no es sensible, es solo la ruta)
for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    if "%%A"=="DB_HOST" set "DB_HOST=%%B"
    if "%%A"=="MYSQLDUMP_PATH" set "MYSQLDUMP_PATH=%%B"
)

if not defined DB_HOST set "DB_HOST=localhost"

:: Crear y borrar una base de datos es una accion administrativa: el usuario
:: de la app (service_integral_app) NO tiene permiso para esto a proposito.
:: Por eso acá pedimos las credenciales de root a mano, sin guardarlas en ningun lado.
echo Para crear la base de prueba hace falta un usuario con permisos de administrador
echo ^(normalmente "root"^), no el usuario de la aplicacion.
echo.
set /p DB_USER="Usuario administrador de MySQL [root]: "
if "%DB_USER%"=="" set "DB_USER=root"
set /p DB_PASSWORD="Contrasena de %DB_USER%: "
echo.

:: mysql.exe suele estar al lado de mysqldump.exe. Si configuraste MYSQLDUMP_PATH
:: en el .env, usamos esa misma carpeta; si no, asumimos que "mysql" esta en el PATH.
set "MYSQL_EXE=mysql"
if defined MYSQLDUMP_PATH (
    for %%P in ("%MYSQLDUMP_PATH%") do set "MYSQL_EXE=%%~dpPmysql.exe"
)

echo Usando: %MYSQL_EXE%
echo.

:: Buscar el backup .sql mas reciente en backend\backups\
set "ULTIMO_BACKUP="
for /f "delims=" %%F in ('dir /b /o-d "backups\*.sql" 2^>nul') do (
    if not defined ULTIMO_BACKUP set "ULTIMO_BACKUP=backups\%%F"
)

if not defined ULTIMO_BACKUP (
    echo [ERROR] No se encontro ningun archivo .sql en backend\backups\
    echo Genera un backup primero ^(o esperá al backup automatico de las 20hs^).
    pause
    exit /b
)

echo Backup a probar: %ULTIMO_BACKUP%
echo.

echo Creando base de datos temporal _test_restore...
"%MYSQL_EXE%" -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% -e "DROP DATABASE IF EXISTS _test_restore; CREATE DATABASE _test_restore;" 2>nul

if errorlevel 1 (
    echo [ERROR] No se pudo crear la base de datos de prueba.
    echo Revisa que DB_USER/DB_PASSWORD en el .env sean correctos.
    pause
    exit /b
)

echo Restaurando el backup en _test_restore...
"%MYSQL_EXE%" -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% _test_restore < "%ULTIMO_BACKUP%" 2>nul

if errorlevel 1 (
    echo [ERROR] La restauracion fallo. El archivo de backup podria estar corrupto o incompleto.
    pause
    exit /b
)

echo.
echo ===================================================
echo Restauracion completada. Filas encontradas por tabla:
echo ===================================================
"%MYSQL_EXE%" -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% _test_restore -e "SELECT 'usuarios' AS tabla, COUNT(*) AS filas FROM usuarios UNION ALL SELECT 'productos', COUNT(*) FROM productos UNION ALL SELECT 'pedidos', COUNT(*) FROM pedidos UNION ALL SELECT 'reparaciones', COUNT(*) FROM reparaciones;" 2>nul

echo.
echo Si estos numeros son parecidos a los de tu sistema real
echo ^(podes compararlos abriendo la app^), el backup esta OK.
echo.

set /p BORRAR="Borrar la base de prueba _test_restore ahora? (S/N): "
if /i "%BORRAR%"=="S" (
    "%MYSQL_EXE%" -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% -e "DROP DATABASE _test_restore;" 2>nul
    echo Base de prueba eliminada. Tu base real nunca fue tocada.
) else (
    echo Dejaste _test_restore creada. Podes revisarla en MySQL Workbench
    echo y borrarla manualmente cuando quieras.
)

echo.
pause