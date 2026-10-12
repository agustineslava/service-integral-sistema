# Inventario: "Service Integral" y variantes

**Tarea 1 — solo inventario, sin modificar código.**
Fecha: 2026-10-10.

## Alcance y método
- Cadenas buscadas: `Service Integral`, `serviceintegralsistema` / `ServiceIntegralsistema`, `service-integral`, `service_integral` (sin distinguir mayúsculas/minúsculas).
- Alcance pedido: `backend/` y `frontend/`, excluyendo `node_modules`.
- Herramientas: `grep` (ripgrep) + subagente `@explore` para verificación cruzada.
- No se leyó el contenido de `backend/.env` real (regla de AGENTS.md). Se usó `.env.example`.
- Se incluye un anexo con coincidencias halladas fuera del alcance pedido (raíz, backups, dumps y docs) porque `@explore` las detectó y son relevantes para tareas futuras.

## Resumen de coincidencias (backend/ + frontend/)
| Categoría | Archivos | Líneas |
|---|---|---|
| Código del servidor | 6 | 20 |
| Instaladores / herramientas (`backend/tools/`) | 24 | 63 |
| Configuración | 2 | 5 |
| Frontend | 17 | 35 |

> Nota: la búsqueda case-insensitive suma líneas que la búsqueda exacta original no mostraba (p. ej. `ServiceIntegralsistema`, `admin@serviceintegral.com`, `SERVICE INTEGRAL`).

---

## 1. Código del servidor

### `backend/server.js`
| Línea | Texto |
|---|---|
| 188 | `// poner el nombre de Service Integral en una pantalla que no es de nadie.` |
| 1276 | `folder: 'service_integral',` |
| 1542 | `obtenerPool('serviceintegralsistema')` |
| 4417 | `folder: 'service_integral/logos',` |
| 4533 | `` console.log(`🚀 Servidor de Service Integral activo.`); `` |

### `backend/src/`
| Archivo | Línea | Texto |
|---|---|---|
| `src/db/conexiones.js` | 32 | `* En Linux, en cambio, SÍ distingue: 'ServiceIntegralsistema' y` |
| `src/db/conexiones.js` | 33 | `* 'serviceintegralsistema' serían dos bases distintas y una no existiría.` |
| `src/servicios/altas.js` | 15 | `` *   4. Darle permisos a `service_integral_app` para poder usarla. `` |
| `src/servicios/altas.js` | 30 | `` * Dar permisos sobre una base a `service_integral_app` lo puede hacer `` |
| `src/servicios/altas.js` | 236 | `const usuarioApp = process.env.DB_USER \|\| 'service_integral_app';` |

### Esquema y migraciones
| Archivo | Línea | Texto |
|---|---|---|
| `schema/base.sql` | 14 | `-- al esquema de serviceintegralsistema. Eso no se afirma: se prueba con` |
| `schema/base.sql` | 55 | `-- Esquema de: ServiceIntegralsistema` |
| `schema/schema-actual.sql` | 2 | `-- Esquema de: ServiceIntegralsistema` |
| `migrations/tenant/LEEME.txt` | 72 | `npm run migrate -- --tenant ServiceIntegralsistema --dry-run` |
| `migrations/tenant/LEEME.txt` | 73 | `npm run migrate -- --tenant ServiceIntegralsistema` |

---

## 2. Frontend

### HTML (títulos y logos)
| Archivo | Línea | Texto |
|---|---|---|
| `frontend/clientes.html` | 6 | `<title>Service Integral - Clientes</title>` |
| `frontend/clientes.html` | 16 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/escaner.html` | 6 | `<title>Service Integral - Escáner QR</title>` |
| `frontend/escaner.html` | 17 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/etiquetas.html` | 6 | `<title>Service Integral - Etiquetas QR</title>` |
| `frontend/etiquetas.html` | 17 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/facturacion.html` | 6 | `<title>Service Integral - Facturación</title>` |
| `frontend/facturacion.html` | 35 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/index.html` | 6 | `<title>Service Integral - Gestión de Stock</title>` |
| `frontend/index.html` | 24 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/index.html` | 82 | `<h1>Bienvenido a Service Integral</h1>` |
| `frontend/index.html` | 518 | `placeholder="juan@serviceintegral.com"` |
| `frontend/index.html` | 570 | `<h3 id="etiqueta-comercio" ...>Service Integral</h3>` |
| `frontend/login.html` | 6 | `<title>Service Integral - Iniciar Sesión</title>` |
| `frontend/login.html` | 16 | `Antes esta pantalla ponia el logo y el nombre de Service Integral en` |
| `frontend/pedidos.html` | 6 | `<title>Service Integral - Gestión de Pedidos</title>` |
| `frontend/pedidos.html` | 22 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/presupuestos.html` | 6 | `<title>Service Integral - Presupuestos</title>` |
| `frontend/presupuestos.html` | 17 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/reparaciones.html` | 6 | `<title>Service Integral - Taller y Reparaciones</title>` |
| `frontend/reparaciones.html` | 16 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |
| `frontend/reportes.html` | 6 | `<title>Service Integral - Reportes</title>` |
| `frontend/reportes.html` | 16 | `<img src="logos/logo.jpg" alt="Logo de Service Integral">` |

### JavaScript
| Archivo | Línea | Texto |
|---|---|---|
| `frontend/admin.js` | 674 | `${campo('Nombre', 'nombre', 'text', { requerido: true, pista: 'Service Integral S.A.' })}` |
| `frontend/admin.js` | 686 | `${campo('Subtítulo', 'subtitulo', 'text', { pista: 'Service Integral · Mantenimiento' })}` |
| `frontend/app.js` | 608 | `const nombreComercio = ...?.textContent \|\| 'Service Integral';` |
| `frontend/pedidos.js` | 262 | `` let textoFormateado = `🛠️ *PEDIDO DE REPUESTOS - SERVICE INTEGRAL*\n`; `` |

### CSS
| Archivo | Línea | Texto |
|---|---|---|
| `frontend/style.css` | 2 | `1. VARIABLES DE ENTORNO Y PALETA DE COLORES (SERVICE INTEGRAL)` |
| `frontend/style.css` | 472 | `azul de Service Integral: un cliente con otro color veía el borde de su` |
| `frontend/style.css` | 1646 | `texto: no tiene que_delatar el color de Service Integral en una pantalla` |
| `frontend/style.css` | 1714 | `/* Aviso que NO es un error: "Entrando a Service Integral", la marca que se` |

> `frontend/logos/logo.jpg` es referenciado por casi todos los HTML, pero el **nombre del archivo** no contiene ninguna de las cadenas.

---

## 3. Instaladores y verificadores (`backend/tools/`)

| Archivo | Línea | Texto |
|---|---|---|
| `tools/api-pegar.js` | 8 | `const email = process.argv[3] \|\| 'admin@serviceintegral.com';` |
| `tools/datos-empresa.js` | 30 | `` * memoria ese tiempo. Para que sea al instante: `pm2 restart service-integral-backend`. `` |
| `tools/datos-empresa.js` | 172 | `console.log('     pm2 restart service-integral-backend');` |
| `tools/datos-empresa.js` | 223 | `console.log('     pm2 restart service-integral-backend');` |
| `tools/f2-migrar-taller.js` | 37 | `// 'ServiceIntegralsistema' tal cual, la base no existiria el dia que esto` |
| `tools/f2-migrar-taller.js` | 40 | `const SLUG = 'service-integral';` |
| `tools/f2-migrar-taller.js` | 132 | `info(`SE CREARIA la empresa "${process.env.COMERCIO_NOMBRE \|\| 'Service Integral'}" ...`)` |
| `tools/f2-migrar-taller.js` | 140 | `(process.env.COMERCIO_NOMBRE \|\| 'Service Integral').slice(0, 150),` |
| `tools/f2-verificar.js` | 114 | `` comprobar(empresa.slug === 'service-integral', `el slug es service-integral (esta: ${empresa.slug})`); `` |
| `tools/f3-verificar.js` | 143 | `console.error('Levantalo con: pm2 restart service-integral-backend');` |
| `tools/f4-verificar.js` | 250 | `console.error('Levantalo con: pm2 restart service-integral-backend');` |
| `tools/f5-verificar.js` | 278 | `console.error('Levantalo con: pm2 restart service-integral-backend');` |
| `tools/f5-verificar.js` | 493 | `['service-integral']` |
| `tools/f5-verificar.js` | 510 | `... FROM empresas WHERE slug = ?', ['service-integral']);` |
| `tools/f5-verificar.js` | 516 | `rT.cuerpo && rT.cuerpo.nombre === 'Service Integral',` |
| `tools/f5b-verificar.js` | 516 | `` // En minusculas los dos lados: el `.env` tiene `ServiceIntegralsistema` `` |
| `tools/f5b-verificar.js` | 517 | `` // con mayusculas y la base se llama `serviceintegralsistema`. En Windows `` |
| `tools/generate-token.js` | 22 | `const email = (emailArg \|\| 'admin@serviceintegral.com').trim().toLowerCase();` |
| `tools/login-probar.js` | 5 | `*   1. login en blanco        -> NO debe decir "Service Integral" en ningun lado` |
| `tools/login-probar.js` | 16 | `{ etiqueta: 'email de la empresa', email: 'admin@serviceintegral.com', ... }` |
| `tools/login-probar.js` | 48 | `const marcaServiceIntegral = /service\s*integral/i.test(` |
| `tools/login-probar.js` | 61 | `... 'FALLO: muestra el nombre de Service Integral sin escribir nada' ...` |
| `tools/login-probar.js` | 69 | `console.log('   AVISO: nombra Service Integral'); }` |
| `tools/logos-cloudinary.js` | 21 | `const CARPETA = 'service_integral/logos';` |
| `tools/migrate.js` | 8 | `*   node tools/migrate.js --tenant ServiceIntegralsistema --dry-run` |
| `tools/migrate.js` | 9 | `*   node tools/migrate.js --tenant ServiceIntegralsistema` |
| `tools/modulos.js` | 22 | `` * Para que sea al instante: `pm2 restart service-integral-backend`. `` |
| `tools/modulos.js` | 135 | `console.log('    pm2 restart service-integral-backend');` |
| `tools/mutar-etiquetas-qr.js` | 122 | `porQue: 'era obtenerPool('serviceintegralsistema'): la base de la empresa 1. ...'` |
| `tools/mutar-etiquetas-qr.js` | 126 | `...obtenerPool('serviceintegralsistema'); },");` |
| `tools/mutar-etiquetas-qr.js` | 226 | `require('./src/db/tenant').obtenerPool('serviceintegralsistema').query(` |
| `tools/mutar-facturacion.js` | 166 | `...obtenerPool('serviceintegralsistema').query('SELECT 1');");` |
| `tools/mutar-orden.ps1` | 3 | `$server = 'D:\SitemaServiceIntegral\backend\server.js'` |
| `tools/mutar-orden.ps1` | 16 | `npx pm2 restart service-integral-backend 2>&1 \| Out-Null` |
| `tools/mutar-orden.ps1` | 29 | `npx pm2 restart service-integral-backend 2>&1 \| Out-Null` |
| `tools/mutar-reportes.js` | 170 | `const BASE = 'serviceintegralsistema'; ...` |
| `tools/mutar-reportes.js` | 666 | `WHERE TABLE_SCHEMA = 'serviceintegralsistema'` |
| `tools/permisos-alta.js` | 17 | `` * Lo que NO puede es darle permisos a `service_integral_app` para usarla: `` |
| `tools/permisos-alta.js` | 19 | `` *   GRANT ... ON `si_tenant_x`.* TO 'service_integral_app'@'localhost' `` |
| `tools/permisos-alta.js` | 51 | `` * La base del taller (`serviceintegralsistema`) no matchea `si_tenant_%`, asi `` |
| `tools/permisos-alta.js` | 65 | `const USUARIO_APP = process.env.DB_USER \|\| 'service_integral_app';` |
| `tools/permisos-alta.js` | 242 | `` // En minúsculas los dos lados: el `.env` tiene `ServiceIntegralsistema` `` |
| `tools/permisos-alta.js` | 243 | `// con mayúsculas y la base se llama `serviceintegralsistema`. En` |
| `tools/probar-facturacion-vivo.js` | 22 | `...obtenerPool(process.env.DB_TENANT_NAME \|\| 'serviceintegralsistema');` |
| `tools/probar-facturacion-vivo.js` | 53 | `[path.join(RAIZ, 'tools', 'generate-token.js'), 'admin@serviceintegral.com'],` |
| `tools/probar-subida-logo.js` | 68 | `` esto la carpeta `service_integral/logos` se llena de imagenes de prueba que `` |
| `tools/probar-subida-logo.js` | 104 | `const tokAdmin = token('admin@serviceintegral.com');` |
| `tools/probar-subida-logo.js` | 141 | `const buena = await subir(tokSuper, 'service-integral-test.png', PNG_1X1, 'image/png');` |
| `tools/probar-subida-logo.js` | 148 | `comprobar(buena.cuerpo.url.includes('service_integral/logos'),` |
| `tools/setup-f0-db.js` | 26 | `const APP_USER = process.env.DB_USER \|\| 'service_integral_app';` |
| `tools/setup-f0-db.js` | 27 | `const DB_CENTRAL = process.env.DB_NAME \|\| 'ServiceIntegralsistema';` |
| `tools/setup-f0-db.js` | 228 | `console.log('   pm2 restart service-integral-backend');` |
| `tools/setup-f0-db.js` | 229 | `console.log('   (o cerra y volve a abrir Sistema ServiceIntegral.bat)\n');` |
| `tools/smoke-admin.js` | 82 | `['email_contacto',  'nuevo@serviceintegral.com', 'acepta', null],` |
| `tools/smoke-admin.js` | 89 | `['nombre',          'Service Integral',     'acepta', null],` |
| `tools/smoke-admin.js` | 126 | `email_contacto: 'nuevo@serviceintegral.com',` |
| `tools/smoke-admin.js` | 134 | `ok_(e.nombre_db === 'serviceintegralsistema', 'nombre_db intacto: ' + e.nombre_db);` |
| `tools/smoke-admin.js` | 135 | `ok_(e.slug === 'service-integral', 'slug intacto: ' + e.slug);` |
| `tools/smoke-admin.js` | 145 | `telefono: '011 15 5555 1234', email_contacto: 'info@serviceintegral.com',` |
| `tools/smoke-admin.js` | 147 | `subtitulo: 'Service Integral · Mantenimiento',` |
| `tools/ver-base-esquema.js` | 11 | `` * tiene hoy `serviceintegralsistema`. `` |
| `tools/ver-base-esquema.js` | 50 | `` * `serviceintegralsistema` salvo para LEER su esquema. Para darle vuelta de `` |
| `tools/ver-base-esquema.js` | 121 | `const EMPRESA_DE_REFERENCIA = 'serviceintegralsistema';` |
| `tools/ver-base-esquema.js` | 520 | `// serviceintegralsistema, y ademas `information_schema` se puede leer` |
| `tools/ver-etiquetas-qr.js` | 11 | `` obtenerPool('serviceintegralsistema')` — la base de `` |
| `tools/ver-etiquetas-qr.js` | 57 | `` * 'serviceintegralsistema')` DENTRO de un comentario y se quejaria, y lo `` |
| `tools/ver-etiquetas-qr.js` | 220 | `` /* El fallo original era `obtenerPool('serviceintegralsistema')`. Se busca `` |
| `tools/ver-facturacion.js` | 300 | `check(!/obtenerPool\|conectarApp\|conectarAdmin\|serviceintegralsistema/.test(cuerpo),` |
| `tools/ver-ficha-api.js` | 6 | `... [path.join(__dirname, 'generate-token.js'), 'admin@serviceintegral.com'], ...` |
| `tools/ver-orden-reparaciones.js` | 87 | `... [path.join(__dirname, 'generate-token.js'), 'admin@serviceintegral.com'], ...` |
| `tools/ver-reportes.js` | 13 | `` pegarles un `obtenerPool('serviceintegralsistema')` para no estar pasando `` |
| `tools/ver-reportes.js` | 66 | `` vería `obtenerPool('serviceintegralsistema')` DENTRO de un comentario y se `` |
| `tools/ver-reportes.js` | 148 | `check(!/serviceintegralsistema\|si_tenant_\|si_central/.test(servicio),` |
| `tools/ver-reportes.js` | 932 | `const BASE_EMPRESA_1 = 'serviceintegralsistema';` |

> Nota: `backend/tools/mutar-orden.ps1` línea 3 apunta a la ruta `D:\SitemaServiceIntegral\backend\server.js` (ruta de otra instalación; posible residuo).

---

## 4. Configuración

| Archivo | Línea | Texto |
|---|---|---|
| `backend/.env.example` | 15 | `DB_USER=service_integral_app` |
| `backend/.env.example` | 19 | `DB_NAME=ServiceIntegralsistema` |
| `backend/.env.example` | 60 | `COMERCIO_NOMBRE=Service Integral` |
| `backend/ecosystem.config.js` | 1 | `// Configuración de PM2 para el backend de Service Integral` |
| `backend/ecosystem.config.js` | 5 | `name: 'service-integral-backend',` |

Sin coincidencias: `backend/package.json`, `config.yml`, `.gitattributes`.

---

## Anexo: coincidencias fuera del alcance pedido

Detectadas por `@explore`; se listan para no perderlas, pero **no** forman parte del alcance backend/frontend.

### Nombres de archivo/carpeta
- `D:\aexia\Sistema ServiceIntegral.bat`
- `D:\aexia\backend\backups\backup_ServiceIntegralsistema_*.sql` (13 dumps, ignorados por git)

### Raíz
| Archivo | Línea | Texto |
|---|---|---|
| `Sistema ServiceIntegral.bat` | 2 | `title Sistema Service Integral - Servidor y Tunnel` |
| `Sistema ServiceIntegral.bat` | 6 | `echo   INICIANDO SERVIDOR Y TUNEL DE SERVICE INTEGRAL` |
| `Probar_Restore_Backup.bat` | 3 | `title Probar Restore de Backup - Service Integral` |
| `Probar_Restore_Backup.bat` | 34 | `:: de la app (service_integral_app) NO tiene permiso para esto a proposito.` |
| `funcion escaner qr.txt` | 74 | `<div class="marca">Service Integral</div>` |
| `funcion escaner qr.txt` | 224 | `<span class="marca">Service Integral</span>` |
| `backup_aexia.sql` | 201 | `INSERT INTO empresas VALUES (1,'Service Integral','service-integral','serviceintegralsistema',...)` |
| `backup_aexia.sql` | 295 | `... 'admin@serviceintegral.com' ... 'Service Integral' ...` |
| `backup_aexia.sql` | 312 | `-- Host: 127.0.0.1    Database: serviceintegralsistema` |
| `backup_aexia.sql` | 508 | `INSERT INTO facturas ... 'Service Integral' ...` |
| `backup_aexia.sql` | 709 | `INSERT INTO productos ... service_integral/...jpg ...` |
| `backend/backups/backup_ServiceIntegralsistema_2026-10-07_20-00-00.sql` | 3 | `-- Host: localhost    Database: ServiceIntegralsistema` |
| `backend/backups/backup_ServiceIntegralsistema_2026-10-07_20-00-00.sql` | 191 | `INSERT INTO facturas ... 'Service Integral' ...` |
| `backend/backups/backup_ServiceIntegralsistema_2026-10-07_20-00-00.sql` | 392 | `INSERT INTO productos ... service_integral/...jpg ...` |

Los 12 dumps restantes de `backend/backups/` son del mismo tipo (encabezado `Database: ServiceIntegralsistema` y, casi con seguridad, datos de marca equivalentes).

### Documentación
- `docs/F0..F5b-reporte.md`: 28 coincidencias.
- `agente/AGENTS.md` (líneas 3, 21), `agente/MEMORY.md` (8, 18, 19, 20, 29), `agente/aexia.md` (31), `agente/PROMPT_INICIAL.md` (11, 13, 18).

### Revisados sin coincidencias
- `backend/scratch/comparar-vars-tema.js`, `tunnel_log.txt`, `cloudflared.exe` (binario), `config.yml`, `.gitattributes`.
