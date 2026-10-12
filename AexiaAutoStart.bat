@echo off
:: Arranque automatico de Aexia al iniciar sesion. Copiar a la carpeta Inicio
:: (ver docs/plan-produccion.md, pasos 8 y 11).
::   - pm2 resucita el proceso guardado (registrado con pm2-windows-startup).
::   - cloudflared levanta el tunel. Hoy es un tunel *quick* (--url): la URL
::     publica cambia en cada arranque. Cuando exista el tunel nombrado
::     (paso 11), reemplazar la ultima linea por el arranque del tunel "aexia"
::     (ver docs/plan-produccion.md, paso 11).
cd /d D:\aexia\backend
call pm2 startOrRestart D:\aexia\backend\ecosystem.config.js
start /b "" D:\aexia\cloudflared.exe tunnel --url http://localhost:3000 > D:\aexia\tunnel_log.txt 2>&1
