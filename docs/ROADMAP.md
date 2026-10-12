# ROADMAP — Aexia

Cola de trabajo. `/siguiente` toma el primer paso `[ ]` con dependencias resueltas. Un paso por vez: al terminar se marca `[x]` con fecha y una línea de nota.

## Reglas para todos los pasos
- Solo desarrollo, con dos empresas (la legada y una de prueba). Nada contra producción. No tocar `.env`.
- Una sola sesión de implementación a la vez. Commit al terminar cada paso.
- Decisiones marcadas PENDIENTE: el agente me las pregunta antes de implementar.
- Nota: los pasos que modifican datos esperan a que el entorno aislado (R-1) esté implementado.

## Acciones solo mías (el agente no las hace)
- [ ] Cargar `BACKUP_DB_USER` y `BACKUP_DB_PASSWORD` en el `.env` del servidor.
- [ ] Generar `CREDENCIALES_KEY` (`openssl rand -base64 32`), ponerla en el `.env` y guardarla aparte de los backups.
- [ ] Aplicar en desarrollo la migración 005 (`npm run migrate:central`).
- [ ] Probar subidas con dos empresas: URLs `aexia/<slug>/archivos`, la empresa B no puede borrar una imagen de A (404) y un logo viejo sigue visible.
- [ ] Producción: pm2 `service-integral-backend` corre desde `D:\SitemaServiceIntegral\backend` (copia vieja). Decidir el despliegue de `D:\aexia`. Hasta entonces, backup diario programado con `node tools/backup.js`.
- [ ] R-2 · Producción estable: seguir el checklist de `docs/plan-produccion.md` (repunte de pm2, autostart, backup diario, túnel nombrado). Todo lo ejecuto yo.
- [ ] R-3 · Salida a `app.aexia.com.ar`: firewall del 3000 y 3306, túnel nombrado, Cloudflare (Always Use HTTPS y regla de límite), rotación de logs de pm2.

## R-1 · Entorno de desarrollo aislado — docs/plan-entorno-dev.md
Plan HECHO (2026-10-11); implementación por fases (§13 del plan).
- [x] Fase 1 · Instancia MySQL dev en 3307 + usuarios dev (2026-10-11, Opción A). Mysqld 9.5 con datadir propio `D:\aexia-dev\mysql-data` (config `D:\aexia-dev\mysql-dev.ini`, port 3307, bind 127.0.0.1, `mysqlx=0` porque prod ocupa el 33060), arrancada como PROCESO en background, no servicio (la sesión no está elevada: instalar servicio exige admin). Usuarios: `aexia_dev_admin` (ALL sobre 3307) y `aexia_dev_app` (DML sobre `` `aexia_dev\_%` ``), hosts localhost + 127.0.0.1; claves generadas y entregadas al dueño (fuera del repo). Verificado sin tocar prod: ambos usuarios loguean por TCP 127.0.0.1:3307 y el 3306 intacto (MySQL95 Running, mismo PID 5572). No se restauró backups (Fase 3).
- [x] Fase 2 · Cargador único + plantilla + scripts dev:* (2026-10-11): `src/config/entorno.js` (lee `AEXIA_ENV_FILE`, default `backend/.env`; en `AEXIA_ENTORNO=dev` aborta ante señales de prod: DB_PORT 3306/indefinido, PORT 3000/indefinido, NODE_ENV=production, central `si_central`/`aexia_central`/indefinida, host no local, `DB_USER`/`DB_ADMIN_USER` sin 'dev', credenciales de Cloudinary con `MEDIA_MODO=deshabilitado`; también aborta si entró el modo dev por `--env-file` sin `AEXIA_ENV_FILE`). `backend/.env.dev.example` versionado (D5; excepción `!.env.dev.example` en `.gitignore`) y scripts `dev:*` en `package.json` (AEXIA_ENV_FILE + `--env-file`). Migrados a `entorno.js`: solo `server.js`, `f2-verificar` y `f5b-verificar` (fase 4 parcial). Verificado sin tocar datos: `node --check` OK; pruebas del cargador con archivos temporales: dev válido exit 0 (loguea `ENTORNO=dev · MySQL 127.0.0.1:3307 · app :3100`), señales de prod exit 1 (9 fallas listadas), `--env-file` sin `AEXIA_ENV_FILE` exit 1; default sin `AEXIA_ENV_FILE` exit 0 (carga `backend/.env`).
- [x] Fase 3 · Restaurar central dev + ≥2 empresas y remapear `empresas.nombre_db` (2026-10-11). Central `aexia_dev_central` restaurada del dump 2026-10-10; empresa #1 → `aexia_dev_service_integral` (13 tablas, `nombre_db` reescrito y migraciones 005+006 aplicadas) y empresa #2 "Taller Dev Norte" (#339) dada de alta por el panel en dev → `aexia_dev_tenant_taller_dev_norte` (13 tablas). Anonimizado (emails `@dev.local`, teléfonos/contactos/domicilios falsos, claves `DevAexia-2026`, `auditoria` y `empresa_cloudinary` vaciadas). Verificado: `dev:f2` 24/24 (con la sección 4 de aislamiento), `dev:f5b` 155/155 y A/B entre #1 y #339 11/11; el 3000 no tiene proceso dev. Caveats dev: `aexia_dev_app` conserva el comodín ancho `aexia_dev_%` (cubre la central) y se le sumó `` `aexia_dev_tenant_%` `` para que `f2` corra la sección 4; `f2`/`f5b` aún piden `DB_NAME=aexia_dev_service_integral` (fase 4).
- [ ] Fase 4 · Migrar el resto de `tools/` (~40 archivos) y parametrizar los 9 puertos `:3000` hardcodeados.
- [ ] Fase 5 · `dev.bat` sin túnel + guardas de Cloudinary (`MEDIA_MODO`) y backup (`BACKUP_ACTIVO=false`) en el server.
- [ ] Fase 6 · Prueba de aceptación (§11) con dos empresas y `cloudflared` corriendo.
Decisiones: D1 cargador único `src/config/entorno.js` con guardas; D2 `MEDIA_MODO=deshabilitado` en dev; D3 bases `aexia_dev_*` y reescribir `empresas.nombre_db` en la central de dev; D4 anonimizar emails, teléfonos y contraseñas; D5 versionar `.env.dev.example`, nunca `.env.dev`; D6 MySQL 3307 y app 3100; D7 script asistente con confirmación en cada paso; D8 cron y backups apagados por defecto en dev.

## R-2 · Producción estable — docs/plan-produccion.md
Preparado por el agente (2026-10-11): `AexiaAutoStart.bat` y `backend\backup-diario.bat` creados. El checklist numerado (pasos 0–13, con la verificación y el rollback de cada paso) está en la sección 7 del plan. **Son acciones SOLO MÍAS: el agente no ejecuta pm2, schtasks ni cloudflared contra producción.**
Decisiones: D1 **A** (`pm2-windows-startup`); D2 **túnel nombrado** (URL fija; lo creo con mi cuenta de Cloudflare); D3 **backup doble** (cron 20:00 + tarea 06:00); D4 **borrar** la app pm2 `aexia` (log ya leído: falló por `pm_cwd` = raíz del proyecto, sin `.env` → sin `JWT_SECRET`); D5 usuario `backup` de solo lectura, **después** de estabilizar.
- [ ] Paso 0 · backup manual (`node tools\backup.js`) antes de tocar nada.
- [ ] Pasos 1–3 · pre-flight: migraciones central 6/6 y flota, logo de la empresa #1.
- [ ] Paso 4 · borrar la app pm2 basura `aexia`.
- [ ] Paso 5 · (opcional) línea base del dominio público.
- [ ] Paso 6 · **⚠️ CORTE** repuntar pm2 `service-integral-backend` a `D:\aexia\backend` + verificar local y dominio.
- [ ] Paso 7 · autostart de pm2 (`pm2-startup install` + `pm2 save`).
- [ ] Paso 8 · copiar `AexiaAutoStart.bat` a la carpeta Inicio.
- [ ] Paso 9 · tarea `AexiaBackupDiario` 06:00 (`schtasks`).
- [ ] Paso 10 · verificación posterior (migraciones, restore, logs sin secretos, MySQL sin exponer, login real por dominio).
- [ ] Paso 11 · **⚠️ CORTE de URL** túnel nombrado `aexia` (login + create + config.yml + route dns + run) y pasar el `.bat` a `tunnel run aexia`.
- [ ] Paso 12 · usuario MySQL `backup` de solo lectura + `BACKUP_DB_USER`/`BACKUP_DB_PASSWORD` en el `.env`.
- [ ] Paso 13 · (opcional) **⚠️ CORTE** prueba de reinicio de Windows.

## R-3 · Salida a `app.aexia.com.ar` — docs/plan-salida-aexia-com-ar.md
Preparado por el agente (2026-10-11, solo lectura; no se tocó código). **Depende de R-1 (entorno de desarrollo aislado) y va ANTES del repunte de pm2 (R-2, paso 6):** todo esto se implementa y se prueba en dev; el corte de dominio es del dueño.
- [x] Paso 1: helper de IP real (HECHO 2026-10-11). `src/http/ip-cliente.js`: `CF-Connecting-IP` solo si el socket es loopback (127.0.0.1/::1/::ffff:127.0.0.1), si no, IP del socket; ignora XFF forjado. Usado como `keyGenerator` de los 3 limitadores (login, lookup email, cambio de clave) y en la auditoría (`ipDe`). `TRUST_PROXY` (default 1, validado entero ≥ 0) y `HOST` (default 0.0.0.0) por variable; `.env.example` recomienda `HOST=127.0.0.1` en producción. Nombre de CORS unificado a `CORS_ORIGINS` en el plan (D4). Verificado en dev (:3100): `node --check`, `npm run ip:probar` 20/20, 9 fallos con el mismo CF → 429 al 9.º, CF distintos → cuentan por separado, XFF forjado no afecta la clave.
- [ ] Paso 2: CORS por variable `CORS_ORIGINS` (D4), handler global de errores sin `err.message` crudo (D10), `express.json` a 1 MB (D8), caché de estáticos (D7).
- [ ] Paso 3: límite de login por cuenta con demora progresiva (D15).
Decisiones: las que figuran en el plan (`docs/plan-salida-aexia-com-ar.md`, «Decisiones pendientes»); D6 (CSP) solo después del piloto y en `Report-Only`; el token en `localStorage` no se cambia (D5); la recuperación de contraseña sigue manual para el piloto (D12, D13 diferido).
Acciones solo mías: firewall del 3000 y 3306, túnel nombrado, Cloudflare (Always Use HTTPS y regla de límite), rotación de logs de pm2.

## R0 · Verificación en vivo del alta de empresas (sin tocar código)
- [x] Hecho (2026-10-11): `f2:verificar` 24/24 y `f5b:verificar` 155/155, más el alta real por el panel (empresa de prueba → base `si_tenant_*`, GRANT app+admin, login 200, aislamiento frente a la empresa #1) y limpieza sin permisos huérfanos. En `docs/plan-config-empresa.md` la migración propuesta ya es la 006.

## R1 · Desacople de DB_NAME — docs/plan-desacople-db-name.md
- [x] Paso 1: `importar-empresa` (alias legados `f1:setup` y `f2:migrar`)
- [x] Paso 2: helper de permisos por base
- [x] Paso 3: F0 sin `DB_NAME` (2026-10-11). `setup-f0-db.js` toma la central de `DB_CENTRAL_NAME` y las empresas del patrón del prefijo; mantiene el `GRANT ALL` sobre la central real y avisa si hay `DB_NAME`.
- [ ] Paso 4: F1 sin `DB_NAME`
- [ ] Paso 5: verificadores parametrizables
- [ ] Paso 6: lo que quede del plan
Decisiones: `f1:setup` y `f2:migrar` quedan como alias con aviso de legado. Si falta `DB_NAME` y `--base`, falla con mensaje claro. El `.env` existente no se edita. Si `DB_NAME` está presente se mantiene el GRANT y se advierte.

## R2 · Prefijo configurable aexia_* (opción A) — docs/plan-prefijo-aexia.md
Depende de R1 paso 4.
- [ ] Pasos del plan, uno por vez
Decisiones: prefijo por variable de entorno `PREFIJO_TENANT`, con valor por defecto `si_tenant_`. `altas.js` y el GRANT salen de la misma variable, con un chequeo al arrancar que falle si no coinciden. El guion bajo del comodín se escapa. Las instalaciones nuevas documentan `aexia_central`, `aexia_tenant_`, `aexia_app` y `aexia_admin`. Nada existente se renombra.

## R3 · Cloudinary por empresa — docs/plan-cloudinary-por-empresa.md
- [x] Paso 1: migración 005, `credenciales.js`, `.env.example`
- [ ] Paso 2: rutas del panel (solo SuperAdmin, auditadas, sin secreto) y chequeo de `CREDENCIALES_KEY` al arrancar
- [ ] Paso 3: upload, delete y logo usan la cuenta de la empresa (la de plataforma como respaldo)
- [ ] Paso 4: sección "Medios / Cloudinary" en el panel
Depende de mis acciones: `CREDENCIALES_KEY` y migración 005.
Decisiones: D5 `CREDENCIALES_KEY`. D6 sin historial de cuentas (al reemplazar, los archivos viejos quedan sin poder borrarse). D7 el ADMIN de la empresa solo ve si usa cuenta propia (sí o no). D8 `logos-cloudinary.js` queda solo para la plataforma. D9 una cuenta se activa solo tras una prueba de conexión exitosa.

## R4 · Marca Aexia — docs/plan-marca-aexia.md
- [ ] Fases del plan, una por vez
Decisiones: D1 el login sin empresa muestra Aexia. D3 conservar `logos/logo.jpg` y agregar logo de plataforma y placeholder neutro (archivos nuevos autorizados). D4 y D5 no tocar pm2 ni los `.bat` (van con el despliegue). D6 sin nombre de empresa el título dice "Aexia". D8 el panel de superadmin se marca como Aexia. Los títulos se componen en `marca.js`, sin reemplazar texto.
PENDIENTE: D2, D7, D9 y D10 (preguntar antes).

## R5 · Configuración por empresa v1 — docs/plan-config-empresa.md
Migración nueva: la 006. Depende de R3 paso 1.
- [ ] Pasos del plan (10), uno por vez
Decisiones: D1 se puede ocultar `equipo` (guardar `''`), obligatorio por defecto. D2 al editar se conserva el valor de un campo oculto. D3 `tipo_cobertura` solo cambia visibilidad y etiqueta. D9 solo el SuperAdmin edita la configuración. D11 el reporte de órdenes se adapta. Usar `data-cfg`, no `data-campo` (ya se usa en otras pantallas).
PENDIENTE: D4, D5, D6, D7, D8, D10 y D12 (preguntar antes).

## R6 · Auditoría de seguridad
Requiere que yo instale la skill `security-audit` de Cloudflare. Después de R1.
- [ ] Auditar una copia de desarrollo. Cada hallazgo se reproduce, se planifica en modo Plan y se corrige de a uno.

## R7 · Despliegue en Vultr — skill deploy-aexia
Depende de R1, R2 y R3. El agente solo prepara scripts `.sh` y el checklist; yo ejecuto en el servidor.
- [ ] Equivalentes `.sh` de los `.bat`, checklist de instalación, y renombrar pm2 y los `.bat` (D4 y D5 de marca).
