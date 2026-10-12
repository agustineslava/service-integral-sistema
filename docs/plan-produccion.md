# Plan: producción estable — repuntar pm2 a `D:\aexia`

**Modo Plan — el agente NO ejecutó nada que cambie estado** (ni pm2 de escritura, ni el puerto 3000, ni bases). Única acción: lectura `pm2 list` y `pm2 logs aexia --err` (causa en §6.1). Fecha: 2026-10-11.
Todo lo que sigue son comandos para que una persona los corra; el checklist final (con verificación y rollback por paso) es la **sección 7**.

---

## 0. Estado real verificado (solo lectura, 2026-10-11)

La premisa de la tarea dice "pm2 detenido + `node server.js` suelto desde `D:\aexia` en :3000". La realidad verificada es otra:

| Hecho verificado | Detalle |
|---|---|
| Quién sirve :3000 | **El propio pm2**: app `service-integral-backend` (pm_id 0, **ONLINE**, PID 3544, `pm_exec_path = D:\SitemaServiceIntegral\backend\server.js`). No hay un `node` suelto desde `D:\aexia`. |
| Código que corre | Working tree de `D:\SitemaServiceIntegral\backend` (mismo repo y commit `6e01993` que `D:\aexia`, pero **árbol viejo**: sin `src/db/permisos.js`, sin `src/config/entorno.js`, sin las migraciones de marca/config/cloudinary). |
| App pm2 basura | Existe un segundo app **`aexia`** (pm_id 1, **stopped**, `restart_time: 90`, `exit_code: 1`, exec del mismo path viejo). Es un arranque fallido que quedó registrado; conviene borrarlo. |
| pm2 | v7.0.4, `PM2_HOME = C:\Users\aguse\.pm2` (existe `dump.pm2`). El daemon está corriendo (PID 2780). |
| Autostart Windows | **No hay** servicio de pm2, ni tarea programada, ni carpeta Startup: tras un reinicio de Windows no arranca ni la app ni el túnel. |
| Túnel | **cloudflared no está corriendo** hoy. Config quick tunnel (`config.yml = {}`, los `.bat` usan `--url http://localhost:3000`): la URL pública es `https://<aleatoria>.trycloudflare.com` y **cambia en cada reinicio** del túnel. El "dominio público" de la verificación hay que tomarlo de `D:\aexia\tunnel_log.txt` cuando el túnel esté arriba. |
| `.env` | Existen `D:\aexia\backend\.env` y `D:\SitemaServiceIntegral\backend\.env` (no se leyeron; sin secretos en este plan). El `.env` de `D:\aexia` es el que ya validó el servidor manualmente. |
| node_modules | Presentes en ambos backends. |
| Migraciones | `backend/migrations/central/`: 001–006 (005 Cloudinary, 006 config). `tenant/`: 004–007. Falta confirmar estado aplicado en prod (sección 3.1). |

Conclusión: **no hay que "revivir" pm2 ni reemplazar un node suelto; hay que repuntar la app existente de `D:\SitemaServiceIntegral\backend` a `D:\aexia\backend`** y blindar el arranque + backup.

---

## 1. Objetivo

1. `service-integral-backend` corriendo desde `D:\aexia\backend` (código actual, con `entorno.js`, `permisos.js`, marca Aexia, config por empresa, Cloudinary por empresa).
2. Que sobreviva a reinicios de Windows (pm2 + túnel).
3. Backup diario garantizado aunque el cron interno (20:00) no corra.
4. Vuelta atrás definida y barata.

**No se toca** `ecosystem.config.js`: ya es genérico (`cwd: __dirname`, `script: server.js`, `NODE_ENV: production`, logs en `./logs/`). Al arrancarlo desde `D:\aexia\backend`, `__dirname` resuelve ahí y `src/config/entorno.js` carga `D:\aexia\backend\.env` (sin `AEXIA_ENV_FILE` → modo prod, `ENTORNO=prod · D:\aexia\backend\.env`). No hace falta agregar variables al ecosystem.

---

## 2. Antes de tocar :3000 (todo debe pasar; si algo falla, NO se continúa)

### 2.1 Migraciones 005 y 006 aplicadas en la central de producción
```bat
cd /d D:\aexia\backend
npm run migrate:estado      :: = node tools/migrate.js --central --status  (solo lectura)
```
Esperado: **6/6 aplicadas** y listadas `005_cloudinary_empresa.sql`, `006_config_empresa.sql` como `[APLICADA]`.

### 2.2 Migraciones de empresa (flota)
```bat
npm run migrate:flota:simular                       :: 0 pendientes en todas las empresas
node tools/migrate.js --tenant ServiceIntegralsistema --status
```
Esperado: sin pendientes (la legada y cada `si_tenant_*` en 4/4 o más).

### 2.3 Logo de Service Integral
```bat
cd /d D:\aexia\backend
node tools/ver-estado-general.js     :: solo lectura: fila de la empresa #1 con logo_url
Test-Path D:\aexia\frontend\logos\logo.jpg
```
Esperado: la empresa #1 (Service Integral, slug `service-integral`, base legada) con `logo_url` poblado (`logos/logo.jpg` u otra ruta/URL) y el archivo presente en `D:\aexia\frontend\logos\`. Ojo: el login sin email y el panel SuperAdmin muestran la marca de **plataforma** (`logos/aexia.svg`), no la de la empresa: eso es correcto.

### 2.4 Línea base del dominio público (contra el código actual)
Primero hay que tener el túnel arriba (hoy está caído):
```bat
cd /d D:\aexia
:: arrancar SOLO el túnel (no reinicia el server; el .bat grande reinicia todo y cambia la URL)
start /b "" D:\aexia\cloudflared.exe tunnel --url http://localhost:3000 > D:\aexia\tunnel_log.txt 2>&1
:: esperar ~15 s y leer la URL:
powershell -NoProfile -Command "$m = Select-String -Path 'D:\aexia\tunnel_log.txt' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'; $m.Matches[0].Value"
```
Con `<DOMINIO>` = esa URL:
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://<DOMINIO>/login.html        :: esperar 200
```
Login real en navegador (playwright o manual): abrir `https://<DOMINIO>/login.html`, escribir el email de la empresa y **loguear con un usuario real** de Service Integral; debe cargar el panel con sus datos. Anotar el resultado como **línea base** (mismo test se repite después del repunte). El `/api/login` lleva rate limiter: no hacer decenas de intentos.

### 2.5 Entorno y backups
```bat
cd /d D:\aexia\backend
node tools/backup.js --dry-run        :: lista central + empresas sin dumpear (quirk: usar node, no npm --)
:: revisar en D:\aexia\backend\.env (a mano, no se copia acá):
::   MYSQLDUMP_PATH -> apunta a un mysqldump.exe real
::   DB_CENTRAL_NAME -> si_central (o aexia_central) correcto
::   BACKUP_DB_USER / BACKUP_DB_PASSWORD (opcional, solo lectura — sección 5.4)
```

### 2.6 Prohibido en producción
**No correr** contra prod: `f2:verificar`, `f5:verificar`, `f5b:verificar`, `mutar-*`, `importar-empresa`, `limpiar-pruebas` (crean/borran datos y empresas de prueba). La verificación post-repunte es manual (navegador) + endpoints públicos, no los verificadores.

---

## 3. Repunte a `D:\aexia` (corte de ~5–15 s)

Corte inevitable: el túnel apunta fijo a :3000 y no se puede tener dos procesos en el mismo puerto. Se minimiza haciendo todo el resto ya verificado.

### 3.0 (Opcional) Prueba en sombra del código nuevo, sin tocar :3000
Levanta el código de `D:\aexia` en otro puerto contra la misma base, hace un smoke y lo mata:
```powershell
$env:PORT = '3199'
$p = Start-Process node -ArgumentList 'server.js' -WorkingDirectory 'D:\aexia\backend' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 6
Invoke-WebRequest http://127.0.0.1:3199/api/config-comercio | Out-Null     :: esperar 200
Invoke-WebRequest http://127.0.0.1:3199/login.html | Out-Null              :: esperar 200
Stop-Process -Id $p.Id
```
Notas: el log dirá `[entorno] ENTORNO=prod · D:\aexia\backend\.env`. No hacerlo entre 19:50 y 20:10 (el cron interno de backup de la sombra y el del server real se pisarían en `backups/`, aunque el mecanismo es atómico).

### 3.1 El cambio
```bat
cd /d D:\aexia\backend
pm2 stop service-integral-backend            :: libera :3000 (acá empieza el corte)
pm2 delete service-integral-backend          :: borra la entrada con el cwd viejo
pm2 delete aexia                             :: borra la basura parada
pm2 start ecosystem.config.js                :: cwd = D:\aexia\backend
pm2 save                                     :: persiste dump.pm2 (hoy apuntaba al path viejo)
pm2 list
```
Chequeo inmediato (ventana de corte hasta que `pm2 list` muestre `online`):
```bat
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3000/login.html      :: 200
pm2 logs service-integral-backend --lines 80
```
Esperado en logs: `[entorno] ENTORNO=prod · D:\aexia\backend\.env`, `🚀 Servidor de Aexia activo`, `🔒 Escuchando en el puerto 3000`, sin traces. Los logs pasan a `D:\aexia\backend\logs\salida.log|errores.log` (los de la copia vieja quedan intactos en `D:\SitemaServiceIntegral\backend\logs`).

---

## 4. Arranque al reiniciar Windows

Hoy **no existe**. Dos piezas: la app (pm2) y el túnel.

### 4.1 pm2: elegir una opción
**Opción A — `pm2-windows-startup` (recomendada: simple, por logon):**
```bat
npm i -g pm2-windows-startup
pm2-startup install
pm2 save
```
Resucita `dump.pm2` a cada logon del usuario. Requiere que el usuario inicie sesión (en una desktop es lo mismo que hoy requiere el túnel).

**Opción B — tarea de Windows sin dependencias nuevas (ONLOGON):**
```bat
schtasks /Create /TN "AexiaPM2" /SC ONLOGON /TR "cmd /c C:\Users\aguse\AppData\Roaming\npm\pm2.cmd resurrect" /F
schtasks /Query /TN AexiaPM2
```

**Opción C — servicio real (`pm2-installer`, arranca sin logon):**
```bat
npm i -g pm2-installer
pm2-service-install -n "PM2 Aexia"    :: interactivo: PM2_HOME=C:\Users\aguse\.pm2, usuario aguse, arranque al boot
```
Más robusta para reinicios sin sesión, pero corre el daemon como servicio con más superficie de configuración.

### 4.2 Túnel: arranque automático
Propuesta (archivo nuevo `D:\aexia\AexiaAutoStart.bat`, contenido abajo) copiado a la carpeta Startup:
```bat
@echo off
cd /d D:\aexia\backend
pm2 startOrRestart D:\aexia\backend\ecosystem.config.js
start /b "" D:\aexia\cloudflared.exe tunnel --url http://localhost:3000 > D:\aexia\tunnel_log.txt 2>&1
```
```bat
copy /y D:\aexia\AexiaAutoStart.bat "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\"
```
El `.bat` interactivo `Sistema ServiceIntegral.bat` se conserva para uso manual (QR y apertura de navegador), pero **no** para autostart (reinicia el túnel y cambia la URL).

> Nota: con túnel *quick* la URL pública cambia en cada reinicio. Para una URL estable conviene un **túnel nombrado** de Cloudflare (fuera del alcance de hoy; ver sección 8).

---

## 5. Backup diario si el cron del servidor no alcanza

El cron interno (`0 20 * * *`, tz Buenos Aires) solo corre mientras el proceso está vivo. Red de seguridad: tarea de Windows con el CLI.

### 5.1 Archivo propuesto `D:\aexia\backend\backup-diario.bat`
```bat
@echo off
cd /d D:\aexia\backend
"D:\Program Files\nodejs\node.exe" tools\backup.js >> logs\backup-cron.log 2>&1
```
(sin `npm` para no depender del shim; `backup.js` resuelve `.env` por `__dirname`, el `cd` es por si acaso)

### 5.2 Tarea diaria
```bat
schtasks /Create /TN "AexiaBackupDiario" /SC DAILY /ST 06:00 /RU "aguse" /RP "<CLAVE_DEL_USUARIO>" /TR "D:\aexia\backend\backup-diario.bat" /F
schtasks /Run /TN AexiaBackupDiario          :: prueba inmediata
schtasks /Query /TN AexiaBackupDiario
```
Esperado: un archivo por base en `D:\aexia\backend\backups\` (`backup_si_central_<ts>.sql`, `backup_serviceintegralsistema_<ts>.sql`, …) y `logs\backup-cron.log` sin credenciales.

### 5.3 Doble corrida
Con esto hay 2 dumps/día/base (20:00 cron + 06:00 tarea). Es intencional (si el proceso estuvo caído a las 20:00, la tarea lo cubre; la retención de 30 días por mtime absorbe el volumen). Si se prefiere uno solo, mover la tarea a otra hora o desactivar el cron interno — decisión D3.

### 5.4 (Opcional) Usuario de solo lectura
Por defecto los dumps usan el `DB_USER` de la app. El `.env.example` ya documenta crear `backup` con `SELECT, SHOW VIEW, TRIGGER` sobre `si_central`, `si_tenant\_%` y `ServiceIntegralsistema` y setear `BACKUP_DB_USER/BACKUP_DB_PASSWORD`.

---

## 6. Decisiones tomadas (2026-10-11)

| # | Decisión | Resolución |
|---|---|---|
| D1 | Autostart de pm2 | **A** — `pm2-windows-startup` (`pm2-startup install` + `pm2 save`). Paso 7. |
| D2 | Túnel | **Túnel nombrado** (URL fija). Los pasos para crearlo con tu cuenta están en el paso 11; los ejecutás vos. Mientras no exista, el `.bat` arranca el quick tunnel. |
| D3 | Backup | **Doble corrida**: cron interno 20:00 + tarea de Windows 06:00. Paso 9. |
| D4 | App pm2 basura `aexia` | **Borrar** (paso 4), después de leer su log. Causa en §6.1. |
| D5 | Usuario de MySQL `backup` de solo lectura | **Crearlo después de estabilizar**. Paso 12. |

### 6.1 Causa de la caída de la app `aexia` (leída en el log, 2026-10-11)

Comando de solo lectura:
```bat
pm2 logs aexia --err --lines 80 --nostream
```
El log (`C:\Users\aguse\.pm2\logs\aexia-error.log`) repite:
```
❌ Falta JWT_SECRET en el archivo .env. El servidor no puede arrancar así.
```
Causa exacta: la entrada `aexia` se registró con **`pm_cwd = D:\SitemaServiceIntegral`** (la *raíz* del proyecto; `pm_exec_path = D:\SitemaServiceIntegral\backend\server.js`), no con el `backend`. La copia vieja arranca con `require('dotenv').config()` **sin ruta**: dotenv busca `.env` en el *current working directory*, o sea `D:\SitemaServiceIntegral\.env`, que no existe (el `.env` está en `backend\`). Sin `JWT_SECRET`, `server.js` hace `process.exit(1)`; pm2 reintentó en bucle (`restart_time: 90`, `exit_code: 1`) hasta quedar `stopped`. **No fue un problema de credenciales ni de base: fue un `cwd` equivocado al registrar la app.**

Importante: el código de `D:\aexia` **ya no tiene este problema**: `server.js` carga `src/config/entorno.js`, que resuelve `backend\.env` por `__dirname` (ruta absoluta, independiente del `cwd`). Por eso el repunte (paso 6) arranca bien incluso si el `cwd` quedara mal.

---

## 7. Checklist de ejecución (para la persona)

> Las secciones 0–5 son el análisis previo; si algo difiere, manda este checklist.
> Convención: **⚠️ CORTE** = el comando interrumpe el servicio o cambia la URL pública. Cada paso trae **Verificación** (hacerla antes de seguir) y **Rollback** (si la verificación falla).
> No correr contra prod los verificadores que crean/borran datos: `f2:verificar`, `f5:verificar`, `f5b:verificar`, `mutar-*`, `importar-empresa`, `limpiar-pruebas`.

### Paso 0 — Red de seguridad: backup manual (sin corte)
```bat
cd /d D:\aexia\backend
node tools\backup.js
```
- **Verificación:** `Resumen: N/N base(s) respaldadas` (N = central + cada empresa) y aparecen `backups\backup_*_<fecha>.sql` nuevos.
- **Rollback:** no aplica (solo escribe `.sql`). Si falla, **no continuar**: producción queda como está.

### Paso 1 — Migraciones de la central (sin corte)
```bat
cd /d D:\aexia\backend
npm run migrate:estado
```
- **Verificación:** `6/6` y `005_cloudinary_empresa.sql` / `006_config_empresa.sql` en `[APLICADA]`.
- Si falta alguna: `npm run migrate:simular` (mirar) y luego `npm run migrate:central` (aditivas).
- **Rollback:** las migraciones son aditivas y no se desaplican; el server viejo ignora las columnas/tablas nuevas.

### Paso 2 — Migraciones de empresa / flota (sin corte)
```bat
cd /d D:\aexia\backend
npm run migrate:flota:simular
node tools\migrate.js --tenant ServiceIntegralsistema --status
```
- **Verificación:** 0 pendientes en todas (legada + cada `si_tenant_*`).
- Si hay pendientes: `npm run migrate:flota`.
- **Rollback:** aditivas, no se desaplica.

### Paso 3 — Logo de la empresa #1 (sin corte)
```bat
cd /d D:\aexia\backend
node tools\ver-estado-general.js
Test-Path D:\aexia\frontend\logos\logo.jpg
```
- **Verificación:** la fila de la empresa #1 (Service Integral, slug `service-integral`, base legada) con `logo_url` poblado y el archivo presente.
- **Rollback:** no aplica (solo lectura).

### Paso 4 — Borrar la app pm2 basura `aexia` (D4) (sin corte)
```bat
pm2 delete aexia
pm2 list
```
- **Verificación:** `aexia` ya no aparece; `service-integral-backend` sigue `online`.
- **Rollback:** no aplica. Recrearla no tiene sentido: era una entrada fallida; la causa quedó en §6.1.

### Paso 5 — (Opcional) Línea base del dominio actual (sin corte del server)
```bat
cd /d D:\aexia
:: arrancar SOLO el túnel (no reinicia el server; el .bat grande reinicia todo y cambia la URL)
start /b "" D:\aexia\cloudflared.exe tunnel --url http://localhost:3000 > D:\aexia\tunnel_log.txt 2>&1
timeout /t 15 /nobreak >nul
powershell -NoProfile -Command "$m = Select-String -Path 'D:\aexia\tunnel_log.txt' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'; $m.Matches[0].Value"
```
Con `<DOMINIO>` = esa URL:
```bat
curl.exe -s -o NUL -w "%{http_code}`n" https://<DOMINIO>/login.html
```
Login real en navegador (pocos intentos: `/api/login` tiene rate limiter). Anotarlo como **línea base**.
- **Verificación:** `login.html` 200 y el login real entra al panel con los datos de la empresa.
- **Rollback:** `taskkill /f /im cloudflared.exe` (baja el túnel; el server sigue).
- Si vas directo al túnel nombrado (paso 11), este paso se puede saltar.

### Paso 6 — ⚠️ CORTE: repuntar pm2 a `D:\aexia\backend`
```bat
cd /d D:\aexia\backend
pm2 stop service-integral-backend
pm2 delete service-integral-backend
pm2 start ecosystem.config.js
pm2 save
pm2 list
```
- **Verificación** (la ventana de corte dura hasta que `pm2 list` muestre `online`):
```bat
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3000/login.html
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3000/api/config-comercio
pm2 logs service-integral-backend --lines 80 --nostream
```
  Esperado: `200` y `200`; en logs `[entorno] ENTORNO=prod · D:\aexia\backend\.env`, `🚀 Servidor de Aexia activo`, `🔒 Escuchando en el puerto 3000`, sin traces. Los logs nuevos van a `D:\aexia\backend\logs\salida.log|errores.log`.
- **Rollback** (inmediato si algo falla):
```bat
pm2 stop service-integral-backend
pm2 delete service-integral-backend
cd /d D:\SitemaServiceIntegral\backend
pm2 start ecosystem.config.js
pm2 save
pm2 list
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3000/login.html
```
  Criterios para volver: el login por el dominio público no funciona con el código nuevo, el logo de la empresa no se ve, logs con errores no recuperables, o el repunte dejó `:3000` caído.

### Paso 7 — Autostart de pm2 (D1 = A) (sin corte)
```bat
npm i -g pm2-windows-startup
pm2-startup install
pm2 save
```
- **Verificación:**
```bat
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
pm2 list
```
  Esperado: una entrada que arranca pm2 (`resurrect`) y las apps `online`.
- **Rollback:** `pm2-startup uninstall`.
- Nota: resucita al **iniciar sesión** (no al boot sin login). Es lo mismo que ya exige el túnel.

### Paso 8 — Archivo de arranque del túnel (sin corte)
```bat
copy /y D:\aexia\AexiaAutoStart.bat "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\"
dir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
```
- **Verificación:** `AexiaAutoStart.bat` figura en la carpeta Inicio.
- **Rollback:** `del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AexiaAutoStart.bat"`.
- Nota: el `.bat` manual `Sistema ServiceIntegral.bat` queda para uso manual (reinicia el túnel y cambia la URL); **no** se usa para autostart.

### Paso 9 — Tarea de backup diario 06:00 (D3) (sin corte)
```bat
schtasks /Create /TN "AexiaBackupDiario" /SC DAILY /ST 06:00 /RU "aguse" /RP "<CLAVE_DE_WINDOWS_DE_aguse>" /TR "D:\aexia\backend\backup-diario.bat" /F
schtasks /Run /TN AexiaBackupDiario
schtasks /Query /TN AexiaBackupDiario
```
- **Verificación:** aparecen dumps nuevos en `D:\aexia\backend\backups\` y `D:\aexia\backend\logs\backup-cron.log` con el resumen `N/N` y **sin credenciales**.
- **Rollback:** `schtasks /Delete /TN AexiaBackupDiario /F`.
- Nota: queda doble corrida (cron interno 20:00 + tarea 06:00), intencional: si el proceso estuvo caído a las 20:00, la tarea lo cubre. Si no se quiere, borrar la tarea o cambiar la hora. No correr entre 19:50 y 20:10 para no pisar el cron.

### Paso 10 — Verificación posterior (sin corte)
```bat
cd /d D:\aexia\backend
npm run migrate:estado
npm run migrate:flota:simular
node tools\verify-restore.js
Select-String -Path D:\aexia\backend\logs\*.log -Pattern "password|api_secret|BEGIN "
netstat -ano | findstr ":3306"
```
Mínimos:
- migraciones 6/6 y flota sin pendientes;
- `verify-restore.js` restaura el último dump a una base temporal, compara conteos y la borra (necesita `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD`; hoy verifica la base de `DB_NAME`, o sea la legada);
- `Select-String` sin coincidencias (logs sin secretos);
- `netstat` escuchando en `127.0.0.1:3306`, **no** en `0.0.0.0:3306`.
Y por el dominio público (paso 5 o 11): `login.html` 200; login real de Service Integral → panel con datos y logo de la empresa; login del SuperAdmin → panel de plataforma con marca Aexia (nunca datos de empresa); si hay segunda empresa, loguear y NO ver datos de la otra.
- **Rollback:** no aplica (solo lectura; `verify-restore` crea y borra una base temporal). Si algo no cuadra, documentar y avisar; no "arreglar" tocando datos.

### Paso 11 — Túnel nombrado (D2) — ⚠️ CORTE de la URL pública
Lo ejecutás vos con tu cuenta de Cloudflare (el dominio debe estar en Cloudflare, con los nameservers apuntados). Crea una URL fija `aexia.<TUDOMINIO>`.
```bat
cloudflared tunnel login
cloudflared tunnel create aexia
cloudflared tunnel list
```
Luego crear `C:\Users\aguse\.cloudflared\config.yml`:
```yaml
tunnel: aexia
credentials-file: C:\Users\aguse\.cloudflared\<UUID>.json
ingress:
  - hostname: aexia.<TUDOMINIO>
    service: http://localhost:3000
  - service: http_status:404
```
(`<UUID>` sale de `cloudflared tunnel create`; el archivo de credenciales se llama `<UUID>.json`. `tunnel login` genera `cert.pem` en esa misma carpeta.)
```bat
cloudflared tunnel route dns aexia aexia.<TUDOMINIO>
cloudflared tunnel run aexia
```
Y actualizar la última línea de `D:\aexia\AexiaAutoStart.bat` a:
```bat
start /b "" D:\aexia\cloudflared.exe tunnel run aexia > D:\aexia\tunnel_log.txt 2>&1
```
- **Verificación:**
```bat
cloudflared tunnel info aexia
curl.exe -s -o NUL -w "%{http_code}`n" https://aexia.<TUDOMINIO>/login.html
```
  Esperado: túnel `HEALTHY` y 200. Avisar a los clientes la URL nueva (la quick anterior ya no existe).
- **Rollback:** dejar la última línea del `.bat` como el quick tunnel (`tunnel --url http://localhost:3000`) y, si se quiere, `cloudflared tunnel delete aexia` + borrar el CNAME `aexia.<TUDOMINIO>` en el panel de Cloudflare.

### Paso 12 — Usuario de MySQL de solo lectura para el backup (D5, después de estabilizar) (sin corte)
Entrar como administrador (root) y correr, con una clave fuerte propia:
```sql
CREATE USER 'backup'@'localhost' IDENTIFIED BY '<CLAVE_FUERTE>';
GRANT SELECT, SHOW VIEW, TRIGGER ON `si_central`.* TO 'backup'@'localhost';
GRANT SELECT, SHOW VIEW, TRIGGER ON `si_tenant\_%`.* TO 'backup'@'localhost';
GRANT SELECT, SHOW VIEW, TRIGGER ON `ServiceIntegralsistema`.* TO 'backup'@'localhost';
FLUSH PRIVILEGES;
```
(Ajustar a las bases reales con `SHOW DATABASES;`. Un `GRANT` por cada base fuera del patrón; la central puede llamarse `si_central` o `aexia_central` según el `.env`.)
Después, a mano en `D:\aexia\backend\.env`:
```
BACKUP_DB_USER=backup
BACKUP_DB_PASSWORD=<CLAVE_FUERTE>
```
- **Verificación:**
```bat
cd /d D:\aexia\backend
node tools\backup.js
```
  Esperado: el mismo `N/N` que el paso 0; si falta un `SELECT`, esa base falla.
- **Rollback:** borrar `BACKUP_DB_USER`/`BACKUP_DB_PASSWORD` del `.env` (vuelve a `DB_USER`) y `DROP USER 'backup'@'localhost';` (borra solo el usuario; no toca datos).

### Paso 13 — (Opcional, recomendado) Prueba de reinicio de Windows — ⚠️ CORTE
Reiniciar Windows. Al volver a iniciar sesión, sin tocar nada:
```bat
pm2 list
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3000/login.html
curl.exe -s -o NUL -w "%{http_code}`n" https://aexia.<TUDOMINIO>/login.html
```
- **Verificación:** apps `online` y `200/200`.
- **Rollback:** si no arranca, iniciar a mano (`pm2 resurrect` y el túnel) y revisar los pasos 7 y 8.

---

## 8. Vuelta atrás global
El repunte **no toca la base** ni las migraciones (aditivas). El único rollback con datos es restaurar un `.sql` del paso 0/10 (avisar antes). **Nunca** como "arreglo": `DROP`/`TRUNCATE`, desaplicar migraciones o tocar `.env` a ciegas. `D:\SitemaServiceIntegral` **no se borra**: es el plan de vuelta atrás (tiene su `.env` y `node_modules`). Los logs viejos quedan en `D:\SitemaServiceIntegral\backend\logs\` (no borrar hasta confirmar estabilidad).

---

## 9. Archivos (estado)

| Archivo | Estado |
|---|---|
| `D:\aexia\backend\backup-diario.bat` | **creado** (paso 9) |
| `D:\aexia\AexiaAutoStart.bat` | **creado** (paso 8; quick tunnel; se cambia a `tunnel run` en el paso 11) |
| `backend\ecosystem.config.js` | **sin cambios** (ya es correcto) |
| Copia a carpeta Inicio + tarea `schtasks` | pasos 8 y 9 |

---

## 10. Riesgos y notas
- **Túnel**: hoy está caído; la URL quick cambia en cada arranque. Con el paso 11 pasa a URL fija.
- **Sombra (§3.0)**: no levantarla entre 19:50 y 20:10 (se pisan los dumps con el cron).
- **Rate limiter** en `/api/login`: pocos intentos en las pruebas.
- **Tarea de backup con `/RP`**: guarda la clave de Windows de forma reversible. Si la política no lo permite: usar `/RU SYSTEM` (revisar que alcance `.env`, `mysqldump` y `backups\`) o dejar solo el cron de las 20:00.