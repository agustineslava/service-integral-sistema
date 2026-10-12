# Plan: desacoplar `DB_NAME` del instalador

**Modo Plan — no se modifica código todavía.** Fecha: 2026-10-10.

Hoy `DB_NAME` mezcla dos conceptos: es la base de la **empresa #1 legada** (`ServiceIntegralsistema` / `serviceintegralsistema`, sin prefijo `si_tenant_`) y, en `setup-f0-db.js`, se la usa **como si fuera la central**. F1 repite el acople al darle permisos a `si_tenant_admin` sobre "la base actual". F2 hace lo mismo al fijar el slug `service-integral` y leer `DB_NAME` como base a importar.

Meta: F0 y F1 instalan **solo la plataforma** (central + superadmin + permisos por patrón). La importación de una empresa existente pasa a ser un comando **explícito y parametrizado** (nombre, slug, base), usable para cualquier empresa, no solo la #1. La instalación actual **no se rompe** y no se toca `.env`.

## 1. Usos de `DB_NAME` y del slug fijo en `backend/`

Leyenda: **(a)** confunde central con tenant · **(b)** empresa #1 legada · **(c)** backup / verificadores · **(d)** otro.

| Archivo / línea | Uso | Clase |
|---|---|---|
| `tools/setup-f0-db.js:27` | `DB_CENTRAL = process.env.DB_NAME \|\| 'ServiceIntegralsistema'` | **(a)** |
| `tools/setup-f0-db.js:95` | imprime "Base actual (tenant 1)" con ese valor (etiqueta correcta, nombre mentiroso) | (a) |
| `tools/setup-f0-db.js:133` | `GRANT ALL ... ON ${DB_CENTRAL}.* TO si_tenant_admin` — en realidad es la base legada, no la central | **(a)** |
| `tools/setup-f0-db.js:135` | `GRANT ALL ... ON ${DB_CENTRAL}_verificacion.*` — taller disfrazado de central | (a) |
| `tools/setup-f0-db.js:196` | verifica conexión de la app con `cfg.parsed.DB_NAME` y `reparaciones` (base legada) | (b) |
| `tools/f1-setup.js:34` | `DB_ACTUAL = process.env.DB_NAME` | **(a)** |
| `tools/f1-setup.js:99` | imprime "Base actual" | (a) |
| `tools/f1-setup.js:175-178` | `GRANT ALL ... ON ${DB_ACTUAL}.* TO si_tenant_admin` — permiso especial para la base legada | **(b)** |
| `tools/f2-migrar-taller.js:34` | `NOMBRE_DB = process.env.DB_NAME` (base a importar) | **(b)** |
| `tools/f2-migrar-taller.js:39` | `NOMBRE_DB_CENTRAL = NOMBRE_DB.toLowerCase()` | (b) |
| `tools/f2-migrar-taller.js:40` | `SLUG = 'service-integral'` fijo | **(b)** |
| `tools/f2-migrar-taller.js:58,70,86` | `configApp(NOMBRE_DB)`, `TABLE_SCHEMA = NOMBRE_DB`, imprime central | (b) |
| `tools/f2-verificar.js:33,104,114` | `DB_TALLER = DB_NAME`; busca por `nombre_db`; exige `slug === 'service-integral'` | **(b)/(c)** |
| `tools/f3-verificar.js:42` | `DB_TALLER = DB_NAME` | (b)/(c) |
| `tools/f4-verificar.js:45` | `DB_TALLER = DB_NAME` | (b)/(c) |
| `tools/f5-verificar.js:493,510` | slug `'service-integral'` fijo | (b)/(c) |
| `tools/f5b-verificar.js:319,521` | "foto del taller" por `DB_NAME` / comparación por `nombre_db` | (b)/(c) |
| `tools/smoke-admin.js:135` | `e.slug === 'service-integral'` | (b)/(c) |
| `tools/permisos-alta.js:240` | comprueba que la base `DB_NAME` sigue existiendo (no la toca el permiso `si_tenant_%`) | (b)/(c) |
| `tools/backup.js:14` | imprime `DB_NAME` | (c) |
| `src/jobs/backup.js:130,141` | `dbName = process.env.DB_NAME` (cron 20:00: respalda **solo** la #1) | **(c)** |
| `tools/backup-verificar.js:85,145` | nombre de archivo `backup_${DB_NAME}_...` / directorio-trampa | (c) |
| `tools/verify-restore.js:20-21` | `DB_REAL = DB_NAME`; `DB_TEST = DB_REAL + '_verificacion'` | (c) |
| `tools/dump-schema.js:29,32` | conexión dev a `DB_NAME` | (d) |
| `tools/inspect.js:15,28` | conexión dev a `DB_NAME` | (d) |
| `tools/ver-ficha.js:10` | conexión dev a `DB_NAME` | (d) |
| `tools/ver-orden-reparaciones.js:171` | conexión dev a `DB_NAME` | (d) |
| `tools/llenar-ordenes.js:25` | seed dev sobre `DB_NAME` | (d) |
| `tools/logos-cloudinary.js:50` | `process.env.CENTRAL_DB_NAME \|\| 'si_central'` — variable **mal escrita** (`DB_CENTRAL_NAME`) | (d) |
| `tools/verificar-clave.js:25` | igual que arriba: `CENTRAL_DB_NAME` inexistente | (d) |
| `ecosystem.config.js:5` + textos `pm2 restart service-integral-backend` | nombre de infraestructura, no slug de datos | (d) |
| `tools/probar-subida-logo.js:141` | `service-integral-test.png` es solo un nombre de archivo | (d) |

**Conclusión:** el acople real del instalador está en **(a)** `setup-f0-db.js` y `f1-setup.js` (central/tenant confundidos) y en **(b)** `f2-migrar-taller.js` (slug fijo). El resto son verificadores/backup que asumen la empresa #1 y herramientas de dev. Dos bugs colaterales de nombre de variable en `logos-cloudinary.js` y `verificar-clave.js` (`CENTRAL_DB_NAME` ≠ `DB_CENTRAL_NAME`).

## 2. Diseño propuesto

### Conceptos separados (nombres)
- **Central:** `DB_CENTRAL_NAME` (ya existe, default `si_central`). Se usa vía `nombreCentral()`.
- **Empresa #1 legada:** `DB_NAME` (variable existente, **no se toca**). Deja de ser "la central" y pasa a ser, como mucho, el **valor por defecto del comando de importación** para la instalación actual.
- **Empresas nuevas:** `si_tenant_<slug>` (patrón ya usado por `altas.js`).
- **Parámetros de importación:** `--nombre`, `--slug`, `--base`, `--rubro`, `--plan`, `--estado`, `--usuarios`, `--dry-run`.

### F0 sin `DB_NAME`
- Eliminar `DB_CENTRAL` (`setup-f0-db.js:27`) y los GRANT de `:133` y `:135`.
- F0 solo crea `si_tenant_admin` y le da privilegios sobre `si_tenant_%` (ya lo hace, `:131`) + `FLUSH`. Nada de una base concreta.
- La base legada (que no matchea `si_tenant_%`) recibe sus permisos **en el comando de importación**, que conoce `--base`. Así F0 instala plataforma pura.

### F1 sin `DB_NAME`
- Eliminar `DB_ACTUAL` (`f1-setup.js:34`) y el bloque `:175-178`.
- F1 queda: usuario admin de bases, `si_central` + permisos de la app sobre la central, migraciones centrales, superadmin, verificación. La app ya recibe el comodín `si_tenant_%` (`:233`).
- El permiso de la app sobre una base que no sea `si_tenant_*` lo da el import.

### F2 → `importar-empresa` explícito
Nuevo comando (archivo `tools/importar-empresa.js`, script npm a decidir en D1) que:
1. Recibe `--nombre`, `--slug`, `--base`. Si faltan, **cae a los valores legados** (`DB_NAME` + slug `service-integral` + nombre actual) para no romper la instalación existente.
2. Normaliza la base a minúsculas (regla ya vigente: `conexiones.normalizarBase`, `f2-migrar-taller.js:39`).
3. Registra/actualiza la fila en `empresas` (central) apuntando a `--base`; idempotente (no duplica slug).
4. Migra usuarios a `usuarios_globales` conservando el hash (lo que hoy hace F2), si la tabla existe.
5. Contrata módulos base.
6. **Concede permisos** de `si_tenant_admin` y del `APP_USER` sobre `--base` (lo que hoy hacen F0/F1 solo para la #1). Esto es lo que permite importar una base **fuera** del patrón `si_tenant_%`.
7. `--dry-run` muestra sin escribir.

Así, importar cualquier empresa existente es `importar-empresa --nombre "X" --slug x --base <base>`, sin tocar código ni `.env`.

## 3. Compatibilidad y orden de cambios (pasos chicos)

Regla: nunca tocar `.env` ni renombrar bases. Cada paso se prueba en dev con **dos empresas**: A = legada (`serviceintegralsistema`, slug `service-integral`) y B = `si_tenant_<slug>` creada por alta/import.

1. **Crear el comando de importación parametrizado** (sin borrar `f2-migrar-taller.js`). Mantener `npm run f2:migrar` como alias que llama al nuevo con los valores legados. Probar: (i) `f2:migrar --dry-run` sin args reproduce el plan actual; (ii) importar B con `--nombre/--slug/--base si_tenant_b`; (iii) `f2:verificar` sigue verde para A.
2. **Centralizar los GRANT por base** en un helper reutilizable (mismo patrón que `permisos-alta.js`), y que el import lo use. Probar que B queda accesible por la app y por `si_tenant_admin`.
3. **Quitar `DB_CENTRAL` de F0** (`:27,:133,:135`). Probar `f0:setup` en una copia dev sin `DB_NAME`: no debe mencionar ninguna base de cliente; A y B siguen funcionando porque ya tienen sus permisos.
4. **Quitar `DB_ACTUAL` de F1** (`:34,:175-178`). Probar `f1:setup` de cero (plataforma vacía) y luego importar A y B con el comando; correr aislamiento.
5. **Actualizar verificadores** (`f2/f3/f4/f5/f5b-verificar`, `smoke-admin`, `permisos-alta`) para resolver la empresa por **slug o `--empresa`** en la central en vez de por `DB_NAME`; dejar `DB_NAME` como fallback por defecto. Probar que siguen verdes para A y que aceptan B.
6. **Backup:** fuera de este plan, pero **acoplado** (ver caso límite). Coordinar con `docs/plan-backup.md` antes de dar F0/F1 por "sin `DB_NAME`".

**Prueba de aislamiento común a cada paso:** `npm run f2:verificar` (crea una segunda empresa real, intenta leer/borrar datos cruzados, borra la suya) + `npm run f5b:verificar`. Criterio: ninguna empresa ve datos de la otra y la central no cambia para un no-superadmin.

## 4. Casos límite

- **La base legada no matchea `si_tenant_%`** (documentado en `f1-setup.js:230` y `permisos-alta.js:51`). Por eso sus permisos deben ser explícitos por base: los da el import, no el patrón.
- **Mayúsculas/`lower_case_table_names`:** `DB_NAME` puede venir `ServiceIntegralsistema` y la base real ser minúscula. Normalizar siempre (Windows y Linux difieren).
- **Base de terceros con el mismo prefijo `si_tenant_`:** doble GRANT es inofensivo; no intentar deduplicar por patrón.
- **`DB_NAME` sin definir** (plataforma nueva): el import debe fallar con un mensaje claro y pedir `--base`, nunca asumir una base por defecto.
- **Slug ya usado:** `empresas.slug` es único; el import debe detectarlo y no duplicar (idempotencia).
- **Base inexistente vs existente:** decidir si el import solo registra una base existente (caso legado) o también admite crear/restaurar un dump (caso alta).
- **Backup del cron (`src/jobs/backup.js:130`)** sigue respaldando **solo** `DB_NAME`. Desacoplar F0/F1 no lo arregla; hay que decidir en `plan-backup.md`.
- **Bugs de variable:** `logos-cloudinary.js:50` y `verificar-clave.js:25` leen `CENTRAL_DB_NAME` (inexistente) y caen a `si_central`; al documentar nombres conviene corregirlos.
- **`f5b-verificar` y verificadores** asumen la empresa #1; si A deja de existir en una instalación nueva, deben poder recibir `--empresa`.

## 5. Decisiones que debés tomar (D)

- **D1 — Nombres de comandos/scripts.** ¿`npm run importar:empresa` + archivo `tools/importar-empresa.js`? ¿Se mantiene `f2:migrar` como alias deprecado (recomendado para no romper docs/runbooks) o se renombra todo?
- **D2 — Qué hacer con `DB_NAME` del `.env` existente.** No se toca el archivo. Opciones: (i) dejarlo como default del import legado (recomendado, cero fricción); (ii) agregar `IMPORT_DEFAULT_*` nuevos y deprecar `DB_NAME`; (iii) documentarlo pero exigir siempre parámetros. ¿Se elimina `DB_NAME` en una instalación futura o se mantiene para siempre?
- **D3 — Quién concede los permisos de la base importada.** ¿El propio `importar-empresa` (necesita `DB_ADMIN`/root) o se deja en un comando aparte tipo `permisos-alta.js` (más permiso mínimo, un paso más)?
- **D4 — Prefijo de tenants configurable.** ¿Se fija `si_tenant_` o se introduce `TENANT_PREFIX` en `.env` (adelanta el futuro `aexia_*` pero toca configuración)?
- **D5 — Alcance del backup.** ¿Se aborda ahora junto con el desacople (respalda central + todas las empresas) o se difiere a `plan-backup.md` (recomendado: no mezclar)?
- **D6 — Verificadores.** ¿Se refactorizan todos para `--empresa <slug>`/resolución por central, o se dejan con `DB_NAME` como fallback y solo se parametriza lo nuevo?
- **D7 — Importación de base nueva.** ¿El comando también crea la base y restaura un dump (`--dump <archivo>`) para dar de alta empresas, o se limita a registrar bases existentes?
