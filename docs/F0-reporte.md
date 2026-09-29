# F0 · Reporte de salvamento

**Fecha:** 29/09/2026
**Commit:** `125cbba`
**Tag de rollback:** `v1.0.0-monotenant` → `b254bd7`

---

## 1. El problema

El backup automático llevaba **5 días fallando en silencio** (desde el 18/09).
Ninguno de los archivos generados contenía datos utilizables.

### Evidencia

```
2026-09-21T20:00:00  💾 Iniciando backup automático...
2026-09-21T20:51:40  (reinicio de la app)
                     ❌ nunca aparece "Backup creado con éxito"
```

| Archivo | Tamaño | Estado |
|---|---|---|
| `backup_..._2026-08-31` | 5,9 KB | íntegro |
| `backup_..._2026-09-02` | 6,1 KB | íntegro |
| `backup_..._2026-09-18` | 1 KB | **truncado** |
| `backup_..._2026-09-21` | 1 KB | **truncado** |
| `backup_..._2026-09-22` | 1 KB | **truncado** |
| `backup_..._2026-09-23` | 1 KB | **truncado** |
| `backup_..._2026-09-24` | 1 KB | **truncado** |

### Causa raíz

```
mysqldump: Error: Access denied; you need the PROCESS privilege(s)
   when trying to dump tablespaces
mysqldump: Got error: 1044: Access denied for user
   'service_integral_app'@'localhost' to database '...' when using LOCK TABLES
```

El usuario de MySQL de la aplicación **no tiene el privilegio `PROCESS` ni puede
tomar `LOCK TABLES`**. mysqldump escribía el header, abortaba con exit code 2,
y dejaba un `.sql` de 1 KB **con nombre de backup válido** — indistinguible de
uno bueno a simple vista.

**No era un cuelgue: fallaba en ~0,2 segundos.** El error sí estaba registrado,
pero en `logs/errores.log` (stderr), no en `logs/salida.log`. PM2 separa los
dos archivos y solo se estaba mirando el primero.

---

## 2. Qué se cambió

### Backup robusto — `backend/src/jobs/backup.js`

| Antes | Ahora |
|---|---|
| `exec()` con redirección `>` de shell | `execFile()` sin shell, argumentos separados |
| `-p"password"` en la línea de comandos | `MYSQL_PWD` por entorno (invisible en `wmic process`) |
| Falla con `LOCK TABLES` | `--single-transaction` (snapshot consistente) |
| Falla con `PROCESS` | `--no-tablespaces` |
| Escribe directo al archivo final | Escribe a `.tmp` y **renombra atómicamente** |
| No verifica nada | Exige `Dump completed` + tamaño mínimo antes de publicar |
| Sin timeout | Timeout de 15 min |
| `toISOString()` → etiqueta UTC | Hora local (antes 3 h adelantado) |
| Retención 7 días | Retención 30 días |

**Decisión clave:** el fix son dos flags, **no se otorgan permisos de MySQL**.
El usuario de la aplicación sigue sin poder tocar tablespaces.

### Integración en `server.js`

El cron de las 20:00 (`America/Argentina/Buenos_Aires`) ahora usa el módulo
nuevo. Se eliminó `exec()` y el `require('fs')` que quedaba sin uso.

### Esquema versionado — `backend/schema/schema-actual.sql`

No existía ninguna fuente de verdad del esquema: se creaba a mano en MySQL
Workbench. Los backups completos no tenían `clientes`, `reparaciones` ni
`movimientos_stock`. Ahora está documentado y versionado en Git.

Hallazgo: **existen 4 FKs reales**, incluida `fk_reparaciones_cliente →
clientes.id`, que el análisis previo daba por inexistente.

### Verificación de restauración — `backend/tools/verify-restore.js`

Restaura el backup más reciente en una base temporal, compara el conteo de
filas de las 7 tablas contra la base real, prueba que los datos se puedan
leer, y destruye la base temporal. **Un backup que nunca se restauró no es
un backup.**

### Seguridad e higiene

- `.gitignore` en la raíz (no existía ahí).
- Se dejó de versionar: `backend/logs/`, `cloudflared.exe` (54 MB) y `tunnel_log.txt`.
- `.env.example` documenta las variables requeridas sin valores reales.

---

## 3. 🔴 PENDIENTE CRÍTICO — rotación de credenciales

La contraseña de MySQL quedó en texto plano en `backend/logs/errores.log`,
que **estaba versionado en Git**, y también dentro del mensaje de commit
del historial (`-p"Agus1tin."`).

**Debe rotarse.** No alcanza con borrar el archivo: está en el historial.

### Orden correcto para rotar

1. Entregar privilegios (paso siguiente, requiere root).
2. Cambiar la contraseña del usuario de MySQL.
3. Actualizar `backend/.env`.
4. Verificar backup + arranque.
5. Recién entonces, evaluar limpiar el historial de Git.

---

## 4. 🔴 PENDIENTE BLOQUEANTE — privilegios de MySQL

```
GRANT SELECT, INSERT, UPDATE, DELETE ON serviceintegralsistema.*
   TO 'service_integral_app'@'localhost'
```

Un usuario con permisos **sobre una sola base**. Esto bloquea:

| Bloquea | Por qué |
|---|---|
| Alta automática de empresas (F6) | No puede `CREATE DATABASE` |
| Verificación de restauración | No puede crear la base temporal |
| Escalabilidad | Cada empresa nueva necesitaría un `GRANT` manual |

### Solución diseñada

Un usuario separado, `si_tenant_admin`, con `CREATE`/`DROP` sobre
`si_tenant_%` (las bases de los clientes). El usuario de la aplicación
**no recibe `CREATE` ni `DROP`**: si alguna vez una inyección SQL llega a la
app, no debe poder crear ni borrar bases.

**Ejecutar:** `node tools/grant-tenant-privileges.js` (pide la contraseña de root).

---

## 5. Herramientas creadas

| Comando | Para qué |
|---|---|
| `npm run backup` | Backup verificado a demanda |
| `npm run backup:verify` | Restaura el backup y compara contra la base real |
| `npm run db:inspect` | Inventario real de tablas y filas |
| `npm run db:grants` | Privilegios efectivos + prueba real de CREATE/DROP |
| `npm run db:grant-tenant` | Entrega los privilegios multi-tenant (requiere root) |
| `npm run schema:snapshot` | Regenera `schema/schema-actual.sql` |
| `npm run token` | Genera un JWT para probar endpoints |

---

## 6. Estado

| Objetivo F0 | Estado |
|---|---|
| Backup manual verificado | ✅ 12,22 KB · 7 tablas · 0,2 s |
| Causa raíz identificada | ✅ privilegios PROCESS / LOCK TABLES |
| Job automático arreglado | ✅ módulo nuevo + verificación de integridad |
| Restore probado | ⏸ bloqueado por privilegios |
| Esquema versionado | ✅ 7 tablas, 4 FKs |
| Secretos fuera del repo | ⚠️ dejados de versionar, **falta rotar** |
| Tag de rollback | ✅ `v1.0.0-monotenant` |
| Privilegios multi-tenant | ⏸ **requiere contraseña de root** |

**Faltan dos pasos, ambos requieren tu intervención:**
1. Ejecutar `node tools/grant-tenant-privileges.js` (pide root).
2. Rotar la contraseña de MySQL.

Con esos dos, F0 queda cerrado y F1 (base central) puede empezar.
