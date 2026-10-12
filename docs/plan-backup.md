# Plan: backup de la central y de todas las empresas

**Modo Plan — no se modifica código todavía.** Fecha: 2026-10-10.
Estado de MEMORY.md que confirma este plan: el cron de las 20:00 **solo respalda `DB_NAME`** (un solo archivo); ni la central ni las demás empresas.

## 1. Qué se leyó (sin archivos completos)
| Archivo | Qué se vio |
|---|---|
| `backend/src/jobs/backup.js` (315 líneas, completo — archivo designado) | `ejecutarDump({ dbName = process.env.DB_NAME, ... })`, `publicarAtomico`, `limpiarBackupsViejos` (global por antigüedad, `.sql`), `copiarOffsite`, `renombrarBackupsConZonaIncorrecta`, `RETENCION_DIAS_DEFAULT = 30`. Un solo dump por corrida; `nombreArchivo = backup_<dbName>_<timestamp>` |
| `backend/tools/backup.js` (47 líneas, completo) | CLI `npm run backup`: carga dotenv, llama `ejecutarDump` y `copiarOffsite`; exit 0/1 |
| `backend/server.js` 4435–4502 (bloque cron) | `realizarBackup()` llama `respaldo.ejecutarDump({ carpetaDestino })`; cron `0 20 * * *` tz Buenos Aires; red de seguridad try/catch (un backup nunca tira el proceso, incidente 30/09) |
| Greps de apoyo | `src/db/central.js` (pool `si_central`), `src/db/conexiones.js` (`nombreCentral() = DB_CENTRAL_NAME || 'si_central'`; `normalizarBase` a minúsculas), `altas.js` (`empresas.nombre_db`, estados `DEMO/ACTIVO/SUSPENDIDO/BAJA`), `.env.example` (`DB_CENTRAL_NAME=si_central`, `DB_USER`, `MYSQLDUMP_PATH`, `BACKUP_OFFSITE_DIR`), `package.json` scripts |

## 2. Diseño propuesto

**Objetivo:** un archivo `.sql` verificado por base → `backup_<nombre_db>_<timestamp-local>.sql`, en `backend/backups/` (mismo formato que hoy). Se respalda:
1. La **central** (`DB_CENTRAL_NAME`, por defecto `si_central`) — primero: es el catálogo más chico y crítico (empresas, usuarios, módulos, planes).
2. Cada **`empresas.nombre_db`** con estado con datos: `ACTIVO`, `DEMO` y (+decisión D2) `SUSPENDIDO`. `BAJA` se omite: `altas.js` ya borra la base.

### Flujo
```
bases = [ nombreCentral() ] + SELECT nombre_db FROM empresas
         WHERE estado IN (D2) AND nombre_db NOT NULL      -- lo consulta quien llama
bases = dedupe + lowercase (como normalizarBase de conexiones.js)

por cada base (secuencial, D4):
    try:  r = ejecutarDump({ dbName: base, carpetaDestino })   // sin cambios internos
          offsite = copiarOffsite(r.ruta, r.nombreArchivo)
          resultados.push({ base, ok, archivo, bytes, tablas, duracion, offsite })
    catch: resultados.push({ base, ok: false, error: msg })    // NO corta el resto

limpiarBackupsViejos(carpetaDestino, dias)                     // una sola pasada al final

devuelve { ok: sin errores, total, listos, fallidos:[...], resultados }   // nunca lanza por un error de empresa
```

Reglas que se conservan:
- `ejecutarDump` no se toca (verificación "Dump completed", `.tmp` atómico, `MYSQL_PWD`, timeout 15 min, reintentos antivirus).
- Un backup nunca tira el proceso: cada base es try/catch y el resumen no lanza.
- Retención: reusa `limpiarBackupsViejos` (30 días por mtime, ya borra cualquier `.sql` viejo sin distinguir base — D3 si se quiere por base).

## 3. Qué cambia en cada archivo

### `backend/src/jobs/backup.js`
- **Agregar** `ejecutarBackupCompleto({ carpetaDestino, bases = [], dias = RETENCION_DIAS_DEFAULT })` con el flujo de arriba.
- No agrega dependencias nuevas (solo `fs`/`path`/`child_process` ya importados). La lista de bases la recibe como parámetro (D1): el job queda sin acoplarse al pool de la central y es testeable en seco.
- Exportar `ejecutarBackupCompleto`.

### `backend/server.js` (bloque 12, ~4457–4502)
- En `realizarBackup()`:
  - Consultar la central: `SELECT nombre_db FROM empresas WHERE estado IN (...)` (con `central`, ya importado en línea 83).
  - `const { nombreCentral } = require('./src/db/conexiones')` (import nuevo en server.js) y armar `bases`.
  - Llamar `respaldo.ejecutarBackupCompleto({ carpetaDestino, bases })`.
  - Log por base (`✅ backup_<base>_…` / `❌ <base>: motivo`) + resumen (`X/Y bases, fallidas: …`).
- Mantener el try/catch global y el `.catch` del cron: protección por si la consulta a la central falla (en ese caso avisar y NO dumpear nada).

### `backend/tools/backup.js` (CLI `npm run backup`)
- Misma lógica: cargar el listado desde la central (usa `src/db/central`), llamar `ejecutarBackupCompleto`, imprimir por base.
- Exit `0` si todas ok; `1` si alguna falló (con la lista de fallidas).
- Flags opcionales:
  - `--solo <nombre_db>` → respalda una única base (diagnóstico / restauración puntual).
  - `--dry-run` → lista las bases que se respaldarían sin dumpear (D5).

### `backend/.env.example`
- Documentar que `DB_CENTRAL_NAME` ya define el nombre de la central (línea 23, existe).
- Opcionales si el usuario los aprueba (D3): `BACKUP_DIAS_RETENCION=30`, `BACKUP_INCLUIR_CENTRAL=true`.
- No se toca `.env` real.

### Sin cambios en esta tarea
- `tools/verify-restore.js`, `tools/backup-verificar.js`: verifican un dump puntual; la restauración multi-base (central + N empresas) queda como verificación futura.
- `ejecutarDump` y su lógica interna.

## 4. Casos límite
1. **`nombre_db` NULL/vacío** → se omite y se avisa en el resumen.
2. **`estado = BAJA`** → la base ya se borró; omitir. Si `nombre_db` quedó en la tabla → mysqldump falla "Unknown database": error por empresa, no corta el resto.
3. **Mayúsculas en el nombre** (`ServiceIntegralsistema` vs `serviceintegralsistema`): normalizar a minúsculas antes de dumpear (igual que `normalizarBase`); crucial en Linux donde MySQL distingue mayúsculas.
4. **Usuario de la app sin permiso** sobre alguna base (`si_tenant_*` nueva sin grant, o la central): `ejecutarDump` ya devuelve error claro con stderr; cae en el resumen de fallidas. Revisar con `npm run db:grants` en dev.
5. **Central inaccesible al iniciar el cron** → no se puede listar empresas: avisar y abortar la corrida (mejor que dumpear a ciegas lo que quede).
6. **Ventana de tiempo**: N dumps secuenciales × hasta 15 min = puede exceder la noche. Opciones: secuencial igual (recomendado, predecible) o paralelo con tope de 2–3 procesos (D4).
7. **Un fallo no borra lo demás**: cada base publica su archivo atómico; el resto queda intacto.
8. **Retención colateral**: `limpiarBackupsViejos` borra `.sql` viejos de todas las bases de una pasada; con muchas empresas hay más archivos acumulados (D3).
9. **Empresa borrada a mitad de corrida** → mysqldump falla con unknown database; manejo por empresa.
10. **`nombreCentral()` sin `DB_CENTRAL_NAME`** → asume `si_central`; loguear el nombre real usado para que no haya sorpresas.

## 5. Qué decidís vos
- **D1 — Quién enumera las empresas:** (a) quien llama (server/tools) consulta la central y le pasa la lista al job *(recomendado: job sin acoplar, testeable)*, vs (b) el job importa `src/db/central` y enumera él mismo.
- **D2 — `SUSPENDIDO`:** incluirlo (recomendado: los datos existen) u omitirlo.
- **D3 — Retención:** global por antigüedad como hoy (30 días, sin cambios) vs `BACKUP_DIAS_RETENCION` configurable (y limpia por base).
- **D4 — Orden de ejecución:** secuencial (recomendado) vs paralelo con tope.
- **D5 — CLI:** flags `--solo`/`--dry-run` en `tools/backup.js` (sin scripts nuevos) vs scripts `npm run backup:solo` etc.
- **D6 — Usuario del dump para la central:** seguir con `DB_USER` (app; solo SELECT sobre si_central) vs usar `DB_ADMIN_USER`/`si_tenant_admin` (más permisos, pero expone una credencial más potente al job). Probar primero con `npm run db:grants` en dev.
- **D7 — Central opcional:** ¿permitir `BACKUP_INCLUIR_CENTRAL=false` o siempre incluirla? (Recomendado: siempre.)

## 6. Verificación (al implementar, en dev con ≥2 empresas)
1. `npm run backup` (o el flujo del cron) → un archivo por base + central en `backend/backups/`.
2. Confirmar nombres minúsculas (`backup_si_central_…`, `backup_serviceintegralsistema_…`, `backup_si_tenant_x_…`).
3. Confirmar que si una base falla (p. ej. una inexistente), las demás publican y el resumen lo lista.
4. Restaurar un dump por base con `verify-restore` (o al menos el de la central y el de una empresa).