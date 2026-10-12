# Plan: pasar de `si_*` a `aexia_*` (bases, usuarios MySQL, pm2 y nombres)

**Modo Plan — no se modifica código ni `.env`.** Fecha: 2026-10-10.
Se relaciona con `docs/plan-desacople-db-name.md` (allí queda pendiente la decisión **D4 — prefijo de tenants configurable**; este plan la resuelve).

## 0. Objetivo y hallazgo clave

Objetivo: que Aexia deje de estar "bautizada" como Service Integral. Dos caminos posibles:

- **A) Prefijo configurable por variable de entorno:** las instalaciones nuevas (Vultr) nacen `aexia_*`; las existentes conservan `si_*`.
- **B) Renombrado completo:** migrar bases, usuarios, permisos, `empresas.nombre_db`, pm2 y documentación a `aexia_*`, con plan de vuelta atrás.

**Hallazgo que ordena todo:** el *runtime* ya es casi agnóstico al prefijo.
- La empresa se resuelve desde el token y el nombre real de la base sale de `empresas.nombre_db` (central), no de un prefijo.
- El backup multi-base itera `empresas.nombre_db` (`src/jobs/backup.js:306-323`, `tools/backup.js:31-36`).
- La central ya es configurable: `DB_CENTRAL_NAME` (`src/db/conexiones.js:66-68`).

El prefijo fijo solo vive en **quién produce nombres** (`altas.js`), en los **GRANT comodín** de los instaladores y en los **nombres de bases de prueba** de los verificadores. Eso es lo que hay que parametrizar, no el runtime.

## 1. Inventario del prefijo fijo (grep)

### a) Nombres de bases
| Ubicación | Qué fija |
|---|---|
| `src/servicios/altas.js:54` | `PREFIJO_DB = 'si_tenant_'` — **única fábrica** de nombres de empresa (`nombreDbPara`, `:146-151`) |
| `src/db/conexiones.js:67` | default `'si_central'` (`nombreCentral()`) |
| `.env.example:23` | `DB_CENTRAL_NAME=si_central` |
| `tools/logos-cloudinary.js:71`, `tools/verificar-clave.js:25`, `tools/ver-estado.js:9`, `tools/importar-empresa.js:146` | fallback `'si_central'` |
| `tools/migrate.js:49,173` | mensajes/errores con `si_tenant_` / `si_central` |
| `schema/base.sql:10` | comentario |
| Legacy | `ServiceIntegralsistema` (`DB_NAME`), fuera del patrón `si_tenant_%` (ver plan-desacople) |

### b) GRANT / usuarios MySQL
| Ubicación | Qué fija |
|---|---|
| `tools/f1-setup.js:32` | default usuario admin `'si_tenant_admin'` |
| `tools/f1-setup.js:183-184` | `GRANT ALL ... ON \`si_tenant_%\`` (admin de bases) |
| `tools/f1-setup.js:243` | `GRANT SELECT/INSERT/... ON \`si_tenant_%\`` (app) |
| `tools/setup-f0-db.js:28-29` | `TENANT_ADMIN='si_tenant_admin'`, `PREFIJO_TENANT='si_tenant_'` |
| `tools/setup-f0-db.js:131,212-213` | GRANT comodín + base de prueba `si_tenant_prueba` |
| `tools/permisos-alta.js:64-65` | defaults `si_tenant_admin` / `service_integral_app` |
| `tools/permisos-alta.js:135,152,176,198,252` | GRANT OPTION sobre `si_tenant_%`, test `si_tenant_permisos_test`, mensajes |
| `src/servicios/altas.js:236` | default app `'service_integral_app'` |
| `.env.example:15,70-72` | `DB_USER=service_integral_app` + GRANTs del backup sobre `si_central` / `si_tenant_%` |
| `tools/verify-restore.js:11,20-21` | comentario `si_tenant_admin`; `DB_REAL=DB_NAME`, `DB_TEST=..._verificacion` |
| `tools/f2-verificar.js:34,372-384` | test `si_tenant_prueba_aislamiento`; chequeo `/si_tenant_%/` |
| `tools/f4-verificar.js:50-51`, `tools/f5-verificar.js:70,93,111`, `tools/f5b-verificar.js:146-147,230,633` | bases de prueba `si_tenant_*` |
| `tools/ver-base-esquema.js:125-136,136`, `tools/probar-esquema-central.js:23,169-197` | pruebas y explicación del patrón `si_tenant_` |
| `tools/limpiar-pruebas.js:69-71,156` | limpieza de `si_tenant_*` de prueba |

### c) Infraestructura / pm2 / nombres
| Ubicación | Qué fija |
|---|---|
| `backend/ecosystem.config.js:1,5` | `name: 'service-integral-backend'` |
| `tools/datos-empresa.js:30,172,223`; `tools/modulos.js:22,135` | texto `pm2 restart service-integral-backend` |
| `tools/f3-verificar.js:143`, `tools/f4-verificar.js:250`, `tools/f5-verificar.js:278` | idem |
| `tools/mutar-orden.ps1:16,29` | `npx pm2 restart service-integral-backend` |
| `Sistema ServiceIntegral.bat`, `Probar_Restore_Backup.bat` | títulos y textos de Windows |
| `docs/inventario.md`, reportes F0–F5, `MEMORY.md`, `deploy-aexia/SKILL.md` | documentación |

### d) Fuera de alcance (no son prefijo)
- Carpeta Cloudinary `service_integral/` (ya hay plan propio: `docs/plan-uploads.md`, nuevas subidas van a `aexia/<slug>/`; las viejas quedan por URL).
- `DB_NAME` (base legada) y su acople: lo cubre `docs/plan-desacople-db-name.md`.
- Textos de marca "Service Integral" en HTML/JS: lo cubre el pendiente de `PLATAFORMA_NOMBRE`.

## 2. Opción A — prefijo configurable por entorno

### Diseño
- **Central:** ya soportado. En el `.env` nuevo: `DB_CENTRAL_NAME=aexia_central`. Default sigue `si_central` para no romper instalaciones existentes.
- **Empresas:** nueva variable `PREFIJO_TENANT` (nombre a confirmar), default `si_tenant_`, leída por `altas.js` (`PREFIJO_DB`) y por los instaladores para armar el GRANT comodín.
- **Usuarios:** son valores de `.env` (`DB_USER`, `DB_ADMIN_USER`), así que la instalación nueva usa `aexia_app` / `aexia_admin` sin tocar código; solo cambian los *defaults* embebidos (fallbacks de `altas.js`, `f1-setup.js`, `setup-f0-db.js`, `permisos-alta.js`).
- **Invariante:** el prefijo que usa `altas.js` **tiene que coincidir** con el comodín que el instalador otorga a `aexia_admin` y a la app. Si no coinciden, el alta crea una base que el GRANT comodín no cubre y falla con "access denied" (mensaje ya accionable en `altas.js:246-254`).

### Pasos
1. Agregar `PREFIJO_TENANT` (default `si_tenant_`) en `altas.js` y usarlo en `nombreDbPara`. Exponerlo también donde haga falta (`module.exports`).
2. En `setup-f0-db.js` y `f1-setup.js`, reemplazar `si_tenant_%` por el prefijo configurado en los GRANT del admin y de la app.
3. Parametrizar los default de usuario (`aexia_app` / `aexia_admin`) en los fallbacks; en instalaciones existentes `DB_USER`/`DB_ADMIN_USER` ya están en `.env` (los escriben F0/F1), así que el default no las afecta.
4. Parametrizar las **bases de prueba** y el chequeo de comodín en los verificadores (`permisos-alta`, `f2/f4/f5/f5b-verificar`, `ver-base-esquema`, `probar-esquema-central`, `limpiar-pruebas`) para que prueben el prefijo configurado.
5. Documentar en `.env.example` el bloque nuevo y en `deploy-aexia`: `.env` de Vultr con `DB_CENTRAL_NAME=aexia_central`, `PREFIJO_TENANT=aexia_tenant_`, `DB_USER=aexia_app`, `DB_ADMIN_USER=aexia_admin`.
6. (Opcional) pm2: `ecosystem.config.js` con `name` configurable por env o simplemente editar el nombre en el deploy nuevo.

### Riesgos de A
- **Dos convenciones conviven.** Hay que dejarlo escrito (README/`.env.example`/deploy) para que nadie asuma que todo es `aexia_*`.
- **Prefijo mal configurado en una instalación existente:** si alguien cambia `PREFIJO_TENANT` sin re-otorgar el GRANT comodín, el alta falla. Mitigar con una validación en F0/F1 (que el comodín y el prefijo coincidan) y con el mensaje ya existente.
- **Verificadores:** hasta parametrizarlos, correrían contra el patrón `si_tenant_` y no verificarían una instalación `aexia_*`. Es trabajo mecánico, sin riesgo de datos.
- **Nada se renombra:** riesgo de pérdida de datos **cero**; sin ventana de mantenimiento.

## 3. Opción B — renombrado completo

### Diseño
Renombrar y re-apuntar TODO a `aexia_*`: bases (central + cada empresa), usuarios (`service_integral_app` → `aexia_app`, `si_tenant_admin` → `aexia_admin`), pm2 (`service-integral-backend` → `aexia-backend`), `empresas.nombre_db`, GRANTs, `.env` y documentación. Incluye `DB_NAME`/`ServiceIntegralsistema` para quedar 100% consistente.

### Pasos
1. **Backup completo verificado** (central + todas las empresas) y copia offsite. Probar restauración.
2. Renombrar la base central: `RENAME TABLE` por tabla dentro de una base nueva (MySQL no tiene `RENAME DATABASE` atómico) o dump+restore. `DROP` de la vieja recién al final, con aprobación.
3. Por cada empresa: crear `aexia_tenant_<slug>`, mover tablas, actualizar `empresas.nombre_db` (una sola transacción lógica; si algo falla, no publicar el cambio de la fila).
4. Re-otorgar GRANTs al admin y a la app sobre los nuevos nombres/patrón; re-otorgar los GRANTs por base del usuario `backup` (`.env.example:70-72`).
5. Renombrar usuarios MySQL (`RENAME USER` es atómico) y actualizar `.env` (`DB_USER`, `DB_ADMIN_USER`, `DB_CENTRAL_NAME`, `DB_NAME`).
6. pm2: `delete` del proceso viejo y `start` del nuevo; actualizar textos y `mutar-orden.ps1`, `.bat`.
7. Actualizar verificadores, reportes, `docs/` y `MEMORY.md`.
8. **Vuelta atrás:** procedimiento inverso probado (dump+restore), con la misma ventana y los mismos backups.

### Riesgos de B
- **Renombrar base no es atómico** en MySQL: exige ventana de mantenimiento y es la operación con mayor riesgo de pérdida.
- **`empresas.nombre_db` desincronizado** (una fila olvidada) deja una empresa con "unknown database"/"access denied"; es dato de negocio, no debe ir en una migración SQL (regla del repo): va un script dedicado.
- **Privilegios:** GRANTs atados a nombre; hay que re-otorgarlos todos, incluido el de `backup` por base y el `GRANT OPTION` del admin.
- **pm2 renombrado = corte breve** y todos los runbooks/scripts que citan el nombre viejo quedan obsoletos.
- **Vuelta atrás pesada:** otra ventana, otro dump/restore.
- **Toca producción** (prohibido sin aprobación; lo ejecuta una persona, no el agente).

## 4. Comparación

| Criterio | A) Prefijo configurable | B) Renombrado completo |
|---|---|---|
| Riesgo de datos | Nulo (no se renombra nada) | Alto (rename no atómico) |
| Ventana de mantenimiento | No | Sí, y otra para volver atrás |
| Alcance del cambio | Env + defaults + herramientas (mecánico) | Datos, permisos, usuarios, pm2, docs |
| Coexistencia `si_*` / `aexia_*` | Sí (por diseño) | No (queda homogéneo) |
| Instalación nueva en Vultr | `aexia_*` desde el minuto cero | Igual, pero además obliga a migrar lo existente |
| Vuelta atrás | Trivial (revertir env/commit) | Dump+restore aparte |
| Encaje con reglas del repo | Total (aditivo, sin DROP) | Fuerza `DROP`/datos; requiere aprobación especial |
| Resuelve D4 de `plan-desacople` | Sí | Sí |

## 5. Recomendación

**Opción A.** Es la de menor riesgo y la que el código ya soporta casi entera:
- El runtime resuelve la empresa por token y la base por `empresas.nombre_db`; el prefijo solo importa donde se **crean** nombres y donde se otorgan **comodines**.
- La central ya es parametrizable (`DB_CENTRAL_NAME`); falta una variable para el prefijo de empresa y parametrizar comodines/defaults.
- Permite que Vultr nazca `aexia_*` **hoy**, sin tocar la instalación existente, y deja la puerta abierta a un B posterior ya sin riesgo (si algún día se quiere homogeneidad, el código ya soportaría ambos y B pasaría a ser solo datos/infra en una ventana planificada).

Secuencia sugerida: **A ahora** (una sola pasada de parametrización + pruebas), y **B diferido** hasta que exista necesidad real de homogeneidad; si se hace, hacerlo *una vez*, con backups verificados y en la misma ventana que cualquier cambio de infra.

## 6. Decisiones a tomar (D)

- **D1 — Nombre de la variable de prefijo.** `PREFIJO_TENANT` (propuesto) vs `TENANT_PREFIX` vs `DB_PREFIX_TENANT`. Y ¿default `si_tenant_` (compat, propuesto) o `aexia_tenant_` (rompe la instalación actual si no se re-otorgan los GRANT)?
- **D2 — Prefijo de la central.** ¿Se mantiene `DB_CENTRAL_NAME` tal cual (propuesto) y en Vultr se pone `aexia_central`?
- **D3 — Usuarios MySQL.** ¿Renombrar defaults a `aexia_app`/`aexia_admin` (nuevas instalaciones) o mantener los actuales y solo cambiarlos por `.env`? ¿Se renombran también en el plan B?
- **D4 — pm2.** ¿El nombre del proceso pasa a `aexia-backend` solo en Vultr (dejando `.bat` legacy) o se actualiza `ecosystem.config.js` y los textos ahora?
- **D5 — Verificadores.** ¿Se parametrizan todos con el prefijo configurado (propuesto, necesario para validar una instalación `aexia_*`) o se dejan fijos y solo se prueba la instalación nueva a mano?
- **D6 — ¿Se hace B en algún momento?** ¿Se descarta, o queda como normalización futura una vez que A esté probado?
- **D7 — Migración de `empresas.nombre_db` si se hace B.** ¿Script dedicado (propuesto, porque es dato de negocio) vs migración central (prohibido por la regla "sin datos de negocio en migraciones")?

## 7. Verificación propuesta (cuando se implemente)

1. **Dev con dos empresas** (legada `ServiceIntegralsistema` + una `si_tenant_*`) y una instalación nueva de prueba con `PREFIJO_TENANT=aexia_tenant_`: ninguna empresa ve datos de la otra.
2. `npm run f2:verificar`, `npm run f5b:verificar`, `npm run permisos-alta` verdes en ambas convenciones.
3. Alta real de una empresa nueva con prefijo `aexia_`: la base se llama `aexia_tenant_<slug>` y la app + admin acceden (comodín correcto).
4. `npm run backup` incluye la central (`aexia_central` o `si_central`) + todas las empresas; `backup:verify` restaura.
5. `.env` y `.env.example` documentados; en Vultr, `pm2` levanta `aexia-backend` y el login de superadmin + dos empresas anda.

## 8. Archivos que tocaría cada opción (orientativo)

- **A:** `src/servicios/altas.js`, `src/db/conexiones.js` (solo docs/default), `tools/f1-setup.js`, `tools/setup-f0-db.js`, `tools/permisos-alta.js`, verificadores (`f2/f4/f5/f5b`, `ver-base-esquema`, `probar-esquema-central`, `limpiar-pruebas`), `.env.example`, `docs/`, `deploy-aexia/SKILL.md`. Sin SQL.
- **B:** todo lo de A **más** un script de renombrado (bases + `empresas.nombre_db` + usuarios + GRANTs), `ecosystem.config.js`, `.bat`, `mutar-orden.ps1`, reportes y `MEMORY.md`; requiere migración de datos/central y ventana.
