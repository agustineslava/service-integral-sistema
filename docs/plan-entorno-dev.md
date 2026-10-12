# Plan: entorno de desarrollo aislado del que sirve a clientes

**Modo Plan — no se modifica código ni se toca `.env` todavía.** Fecha: 2026-10-11.
Autorizado por el pedido: guardar este plan, actualizar `MEMORY.md` y detenerse.

## 1. Objetivo

Poder desarrollar y probar (migraciones, verificadores, aislamiento entre
empresas, subidas) **sin ningún camino posible** hacia los datos ni los
servicios que ven los clientes:

- Otro MySQL, en **otro puerto (3307)** o en Docker, restaurado desde un backup.
- Un **`.env.dev`** con su propia central, puerto de app **3100** y sin
  credenciales de producción.
- **Nunca** el túnel de Cloudflare ni la cuenta real de Cloudinary.

## 2. Situación actual (evidencia, no supuestos)

| Hecho | Dónde se verificó |
|---|---|
| El túnel es un **quick tunnel** de Cloudflare que apunta fijo a `http://localhost:3000`. | `Sistema ServiceIntegral.bat` línea 42; `tunnel_log.txt` (`Settings: map[... url:http://localhost:3000]`) |
| Hay **una sola instancia de MySQL** (servicio `MySQL95`, puerto 3306, Windows). No hay Docker instalado. | `Get-Service *mysql*` → `MySQL95 Running`; `docker` no existe |
| La app lee `PORT` (default 3000) y sirve `frontend/` en el mismo proceso. | `backend/server.js` 22, 4620 |
| No hay distinción de entorno: **un único `backend/.env`** y `dotenv` con ruta fija. | 44 usos de `require('dotenv').config({ path: …'.env' })` en `tools/` + `server.js:4` |
| La central sale de `DB_CENTRAL_NAME`; cada empresa, de `empresas.nombre_db` en la central. | `src/db/conexiones.js:nombreCentral()`, `src/db/central.js` |
| La app **verifica al arrancar** que el prefijo de `altas.PREFIJO_DB` coincida con `prefijoTenant()` y falla si no. | `MEMORY.md` (prefijo `si_*`→`aexia_*`, paso 1) |
| Cloudinary se configura con `CLOUDINARY_*` del `.env`; **no hay fallback local**: sin credenciales, `/api/upload` responde 500. | `server.js` 68-72, 1322-1335 |
| Hay un **cron de backup a las 20:00** y otro de desalojo cada 5 min, ambos activos siempre. | `server.js` 4583, 4604 |
| Los dumps son **por base sin `--databases`** (no incluyen `CREATE DATABASE` ni `USE`), así que se restauran en una base con **otro nombre**. | `src/jobs/backup.js` 160-170 |
| Verificadores que leen el puerto de `process.env.PORT`: `f2`,`f3`,`f4`,`f5`,`f5b`, `ver-facturacion`. | grep en `tools/` |
| **9 herramientas con `http://127.0.0.1:3000` hardcodeado** (peligro: en dev pegarían al servidor real). | `api-pegar`, `probar-facturacion-vivo`, `probar-subida-logo`, `probar-token`, `smoke-admin`, `smoke-clave`, `ver-ficha-api`, `ver-orden-reparaciones`, `login-probar` |

**Conclusión de situación:** hoy desarrollo y clientes comparten **la misma
máquina, el mismo MySQL (3306) y el mismo `.env`**. El aislamiento no existe;
este plan lo crea.

## 3. Arquitectura propuesta

```
                      MÁQUINA DEL NEGOCIO (Windows)
   ┌──────────────────────────────┬──────────────────────────────┐
   │  ENTORNO CLIENTES (sin tocar) │  ENTORNO DEV (nuevo)          │
   │  MySQL 3306 (servicio MySQL95)│  MySQL 3307 (instancia dev)   │
   │    aexia_central              │    aexia_dev_central          │
   │    ServiceIntegralsistema     │    aexia_dev_ti_* / copias    │
   │    si_tenant_* / aexia_tenant_*│   (restauradas del backup)    │
   │  App :3000  ← cloudflared →  │  App :3100  ← SIN túnel       │
   └──────────────────────────────┴──────────────────────────────┘
             ▲ nunca se apunta a dev          ▲ nunca apunta a prod
```

Regla de oro: **la separación la garantiza el puerto + credenciales + base
central distintas**, no la disciplina de quien teclea. El túnel queda apuntando
a 3000 *por construcción*: aunque alguien lance `cloudflared`, dev vive en 3100
y no se publica.

## 4. Segundo MySQL (recomendado: instancia propia en 3307)

Dos caminos; el plan recomienda **A** porque no instala nada nuevo (Docker no
está en la máquina) y reutiliza los binarios de MySQL 9.5 ya presentes.

### Opción A (recomendada) — segunda instancia del mismo MySQL en 3307
Datos/logs **fuera del repo** (nunca dentro de `D:\aexia`, para que un dump con
datos de clientes no quede junto al código): `D:\aexia-dev\mysql\`.

1. Inicializar el datadir:
   `mysqld --defaults-file=D:\aexia-dev\mysql\dev.ini --initialize-insecure`
2. `dev.ini` (mínimo): `port=3307`, `datadir=D:\aexia-dev\mysql\data`,
   `socket=MySQLDev`, `bind-address=127.0.0.1`, `lower_case_table_names=1`
   (igual que prod en Windows, para que los nombres de base no cambien).
3. Registrar como servicio aparte:
   `mysqld --install AexiaDevMySQL --defaults-file=D:\aexia-dev\mysql\dev.ini`
   (o arrancarlo a mano con el mismo `--defaults-file`).
4. **Enlazar solo a 127.0.0.1**: dev no se expone a la LAN/internet.
5. Usuarios de dev (nombres propios, nunca los de prod):
   - `aexia_dev_admin` (DDL/migraciones; puede tener `ALL` **sobre la instancia 3307**, es desechable).
   - `aexia_dev_app` (DML; `GRANT … ON \`aexia_dev\_%\`.*` y sobre las copias restauradas).
   El `PREFIJO_TENANT` de `.env.dev` debe coincidir con lo que quede en las
   bases dev (ver D3).

### Opción B (alternativa) — Docker
`docker run -p 3307:3306 -e MYSQL_ROOT_PASSWORD=… -v D:\aexia-dev\mysql:/var/lib/mysql mysql:8`.
Ventaja: datadir y ciclo de vida aislados y reproducibles. Costo: instalar
Docker Desktop. El resto del plan aplica igual (mismos puertos y nombres).

## 5. Restaurar dev desde un backup

Los `.sql` viven en `backend/backups/` (`backup_<base>_<ts>.sql`, uno por base).
Un dump sin `--databases` **no trae `CREATE DATABASE`/`USE`**, así que se importa
en una base con el nombre que queramos.

1. Generar una copia fresca (lectura, no toca prod):
   `node tools/backup.js --destino D:\aexia-dev\dumps` (usar el usuario de
   backup de solo lectura, `BACKUP_DB_USER`).
2. En 3307, crear la central dev y las bases tenant dev:
   `aexia_dev_central`, y las copias (`aexia_dev_ti_1`, `aexia_dev_ti_2`, …).
3. Importar cada dump en su base destino:
   `mysql -h127.0.0.1 -P3307 -u aexia_dev_admin -p <base_destino> < backup_<base>_….sql`
4. **Remapear la central dev**: las copias conservan la fila con
   `empresas.nombre_db` apuntando al nombre original. Un `UPDATE` en
   `aexia_dev_central.empresas` deja `nombre_db` en los nombres dev, para que la
   app dev no busque la base original:
   `UPDATE empresas SET nombre_db = CONCAT('aexia_dev_ti_', id) WHERE id IN ('cliente1','cliente2');`
5. Sembrar **al menos dos empresas** (dos copias) para poder probar el
   aislamiento A/B (requisito de `AGENTS.md`).
6. Opcional (D4): si se va a dar acceso a alguien más, **anonimizar** PII
   (emails/teléfonos/nombres de `clientes`) antes de usar dev.

> ⚠️ Un backup de producción **contiene datos reales de clientes**. Por eso dev:
> (a) va en 3307, (b) nunca se publica por túnel, (c) el `.env.dev` no lleva
> credenciales de prod, y (d) se borra cuando ya no se usa. Nunca se guarda en el
> repo (`backups/` y `*.sql` ya están en `.gitignore`).

## 6. `.env.dev` (y su plantilla)

`.env.dev` ya queda fuera de git por la regla `.env.*` de `.gitignore`. Se
propone versionar una plantilla `.env.dev.example` (sin valores) para no
adivinar nombres (D5).

Contenido propuesto (claves inventadas, **jamás** las de producción):

```
# --- Dev: identificacion del entorno (ver guardas en src/config/entorno.js) ---
AEXIA_ENTORNO=dev
NODE_ENV=development

# --- Servidor ---
PORT=3100
HOST=127.0.0.1

# --- MySQL DEV (instancia propia, puerto 3307) ---
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=aexia_dev_app
DB_PASSWORD=            # clave de dev, local
DB_CENTRAL_NAME=aexia_dev_central
PREFIJO_TENANT=aexia_dev_tenant_
DB_ADMIN_USER=aexia_dev_admin
DB_ADMIN_PASSWORD=      # clave de dev, local

# --- Seguridad (claves DISTINTAS de prod) ---
JWT_SECRET=             # generar una nueva, solo para dev
CREDENCIALES_KEY=       # generar una nueva para dev

# --- Multimedia: apagado en dev (ver seccion 8) ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
MEDIA_MODO=deshabilitado

# --- Backups: sin cron en dev ---
BACKUP_ACTIVO=false
BACKUP_OFFSITE_DIR=

# --- Herramientas (reusar binarios; mismo mysqldump, otro -P) ---
MYSQLDUMP_PATH=...      # scan de los .bat (segunda instancia) o el de prod
MYSQL_PATH=...          # cliente mysql

# --- Marca: opcional, para distinguir la pestana de dev ---
PLATAFORMA_NOMBRE=Aexia DEV
```

`DB_NAME` **no** se usa en dev (es legado de la empresa #1 en prod).

## 7. Cómo arrancar y apuntar los verificadores

### El problema de fondo
Hoy ni la app ni los verificadores pueden elegir el archivo de entorno: todos
hacen `require('dotenv').config({ path: …'/.env' })` con ruta fija. Hay dos
formas de resolverlo (D1):

### Opción 1 (recomendada) — un único cargador de entorno
Nuevo `backend/src/config/entorno.js` que:
1. Elige `.env.dev` si `AEXIA_ENTORNO=dev`, si no `.env`.
2. Carga **solo** ese archivo (sin fallback a prod).
3. En `AEXIA_ENTORNO=dev`, **valida y aborta** si detecta señales de prod:
   - `DB_PORT` === 3306, o `DB_HOST` que no sea `127.0.0.1`/`localhost`
   - `PORT` === 3000
   - `NODE_ENV` === `production`
   - `DB_CENTRAL_NAME` igual al de prod (`aexia_central`, `si_central`)
   - credenciales de Cloudinary no vacías cuando `MEDIA_MODO=deshabilitado`
4. Registra en el log `ENTORNO=dev · MySQL 127.0.0.1:3307 · app :3100`.

Cambio mecánico: `server.js` y cada `tools/*.js` reemplazan su línea de
`dotenv` por
`require('../src/config/entorno')` (o `./src/config/entorno` en el server).
No cambia la lógica de ningún verificador, solo de dónde salen las variables.

Se agregan scripts `dev:*` en `backend/package.json`, con `--env-file` de Node
como red de seguridad doble:

```
"dev:server":     "node --env-file=.env.dev server.js",
"dev:f5":         "node --env-file=.env.dev tools/f5-verificar.js",
"dev:f5b":        "node --env-file=.env.dev tools/f5b-verificar.js",
"dev:migrate":    "node --env-file=.env.dev tools/migrate.js --central",
…(un `dev:` por verificador que se use)…
```

Arranque: `cd backend && npm run dev:server` → **http://127.0.0.1:3100/login.html**.
Un `dev.bat` opcional en la raíz lanza el server dev **sin** tocar `cloudflared`
(equivalente a `Sistema ServiceIntegral.bat` pero sin túnel ni pm2 de prod).

### Opción 2 (sin tocar código) — solo `--env-file`
`node --env-file=.env.dev tools/f5-verificar.js`, y `.env.dev` completo con
**todas** las claves sensibles. Menos cambios, pero: (a) `dotenv` sigue leyendo
`backend/.env` para lo que falte (riesgo de fuga de credenciales reales),
(b) no hay guardas, (c) los 9 tools con `3000` hardcodeado siguen mal.

### Verificadores: qué hay que ajustar
- Los que ya leen `process.env.PORT` (`f2`,`f3`,`f4`,`f5`,`f5b`,
  `ver-facturacion`): con `.env.dev` cargado apuntan solos a **3100**. ✔
- Los **9 con `3000` hardcodeado** deben parametrizarse a
  `http://127.0.0.1:${process.env.PORT || 3000}` (o usar `AEXIA_URL`). Lista:
  `api-pegar`, `probar-facturacion-vivo`, `probar-subida-logo`, `probar-token`,
  `smoke-admin`, `smoke-clave`, `ver-ficha-api`, `ver-orden-reparaciones`,
  `login-probar`. **Mientras no se hagan, no correrlos en dev**: pegarían al
  servidor de clientes.
- `ver-reportes.js` carga `dotenv` sin ruta (depende del cwd): también pasa por
  el cargador único.

## 8. Aislar Cloudflare, Cloudinary y otras fugas

| Riesgo | Mitigación |
|---|---|
| **Túnel de Cloudflare** | El quick tunnel apunta fijo a `:3000`; dev escucha en `:3100` y no se publica. El launcher de dev **no** invoca `cloudflared`. Además, la guarda de `entorno.js` rechaza `PORT=3000`. Nunca se cambia el target del túnel a 3100. |
| **Cuenta Cloudinary real** | `CLOUDINARY_*` vacíos + `MEDIA_MODO=deshabilitado`. Propuesta (D2): en dev, `/api/upload` y `/api/delete-image` responden `503 "subidas deshabilitadas en dev"` en vez de 500, y el frontend lo muestra. Alternativa: una **cuenta Cloudinary de dev** aparte (nunca las claves de producción). |
| **Cron de backup** | `BACKUP_ACTIVO=false`; `entorno.js` no registra el cron de las 20:00 cuando `AEXIA_ENTORNO=dev` (así no se acumulan copias con PII en dev). |
| **Contraseña en logs / procesos** | El backup ya usa `MYSQL_PWD`; dev reusa eso. `.gitignore` ya cubre `*.log`, `backups/`, `*.sql`, `.env.*`. |
| **Puerto de MySQL abierto** | Instancia dev en `bind-address=127.0.0.1`; el firewall no abre 3307. |
| **Mezcla accidental de bases** | Central dev con **otro nombre** (`aexia_dev_central`): si alguien conectara dev al 3306, no existiría esa base y fallaría ruidosamente en vez de leer datos reales. |

## 9. Archivos a crear / cambiar

**Nuevos**
- `docs/plan-entorno-dev.md` (este documento).
- `backend/src/config/entorno.js` — cargador + guardas (D1).
- `backend/.env.dev.example` — plantilla sin valores (D5).
- `D:\aexia-dev\mysql\dev.ini` + datadir (fuera del repo).
- Opcional: `dev.bat` (raíz, sin túnel) y `backend/tools/crear-entorno-dev.js`
  (asistente que inicializa 3307, restaura los últimos dumps y remapea la
  central) (D6).

**Modificados (fase de implementación, no ahora)**
- `backend/server.js`: usar `entorno.js`; saltear crons en dev; `MEDIA_MODO`.
- `~40` archivos en `backend/tools/`: cargar `entorno.js` y parametrizar los 9
  puertos hardcodeados.
- `backend/package.json`: scripts `dev:*`.
- `backend/.env.example`: documentar `AEXIA_ENTORNO`, `MEDIA_MODO`, `BACKUP_ACTIVO`.
- `AGENTS.md` (propuesta, no en esta tarea): sección "Entorno de desarrollo".

**Prohibido en esta tarea:** tocar `backend/.env` real, `.gitignore` de forma
incompatible, o cualquier base de producción.

## 10. Casos límite y riesgos

1. **Fuga de PII**: las copias traen datos de clientes → dev local, sin túnel,
   borrable; anonimización opcional (D4).
2. **`--env-file` + `dotenv`**: `dotenv` no pisa variables ya presentes; por eso
   el cargador único (Opción 1) evita el fallback a `.env` de prod.
3. **`PREFIJO_TENANT`**: la app **falla al arrancar** si no coinciden prefijo y
   `altas.PREFIJO_DB`. En dev debe coincidir con las bases restauradas (D3).
4. **Dos empresas en dev**: obligatorio para probar aislamiento A/B; si solo se
   restaura una, el verificador de aislamiento no prueba nada.
5. **`DB_NAME`**: no definir en `.env.dev` (es legado de la empresa #1 de prod).
6. **Disco/RAM**: dos `mysqld` en la misma máquina; el datadir dev debe tener
   espacio y poder borrarse entero.
7. **Puerto 3100 ocupado**: `PORT` configurable; si está tomado, el arranque
   falla con aviso claro.
8. **Migraciones**: en dev se corren con `npm run dev:migrate` **contra 3307**;
   nunca con los scripts de prod apuntando a 3306.
9. **`.env.dev` en git**: queda ignorado por `.env.*`; aun así, la plantilla
   `.env.dev.example` no debe llevar claves ni nombres de personas.

## 11. Verificación / criterios de aceptación

1. `npm run dev:server` levanta en **3100** y loguea
   `ENTORNO=dev · MySQL 127.0.0.1:3307 · central aexia_dev_central`.
2. `http://127.0.0.1:3100/login.html` entra con el superadmin **de dev**; la app
   de clientes en `:3000` sigue intacta.
3. Detener MySQL 3307 y confirmar que **la app de clientes no se entera** (y
   viceversa): aislamiento real.
4. Dos empresas en dev: ninguna ve datos de la otra (`f5b`/`f2` en 3100).
5. Con `cloudflared` corriendo, `https://<random>.trycloudflare.com` sigue
   sirviendo **solo** la app de clientes; nada de dev.
6. `/api/upload` en dev responde "deshabilitado" (no sube a la nube real).
7. Ningún verificador en dev pega al 3306 ni al 3000 (revisar la lista del §7).
8. Restaurar el backup de una base y confirmar filas (>0) — replica el espíritu
   de `Probar_Restore_Backup.bat` pero contra 3307.

## 12. Qué decidís vos

- **D1 — Cómo se elige el entorno:** (a) cargador único `src/config/entorno.js`
  usado por server y tools, con guardas *(recomendado)*; vs (b) solo
  `--env-file` sin tocar código (más simple, sin guardas).
- **D2 — Multimedia en dev:** deshabilitar subidas (503) *(recomendado)* vs
  crear una cuenta Cloudinary de dev aparte vs dejar el 500 actual.
- **D3 — Nombres en dev:** renombrar central y empresas (`aexia_dev_*` con
  remapeo) *(recomendado por seguridad)* vs copiar con los mismos nombres de prod.
- **D4 — Datos de clientes:** usar la copia tal cual vs anonimizar PII antes.
- **D5 — Versionar `backend/.env.dev.example`** (plantilla) — sí/no.
- **D6 — Puerto**: 3307/3100 como en el plan, o preferís otros.
- **D7 — Asistente `tools/crear-entorno-dev.js`**: script que automatiza
  instancia + restauración + remapeo — sí/no (o solo documentación).
- **D8 — Cron/backup en dev**: apagados por `AEXIA_ENTORNO=dev` *(recomendado)*
  vs controlarlos con banderas sueltas.

## 13. Fases propuestas (al aprobar)

1. Instancia MySQL dev en 3307 + usuarios dev (Opción A).
2. `entorno.js` + `.env.dev(.example)` + scripts `dev:*`.
3. Restaurar central + ≥2 empresas y remapear la central dev.
4. Parametrizar los 9 puertos hardcodeados y ajustar/registrar los verificadores.
5. `dev.bat` sin túnel + guardas de Cloudinary y backup.
6. Prueba de aceptación (§11) con dos empresas y `cloudflared` corriendo.
