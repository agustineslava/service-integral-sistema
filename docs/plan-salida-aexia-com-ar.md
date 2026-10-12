# Plan — Salida a `https://app.aexia.com.ar` detrás de Cloudflare Tunnel

Fecha: 2026-10-11 · Modo: solo lectura (Plan). No se tocó código.
Alcance: evaluar qué le falta al sistema para servirse en `app.aexia.com.ar` con un
túnel de Cloudflare, verificar en el código y priorizar.

Evidencia utilizada: `backend/server.js`, `backend/.env.example`,
`backend/ecosystem.config.js`, `config.yml`, `AexiaAutoStart.bat`,
`frontend/*`, `docs/plan-produccion.md`. Verificado además el comportamiento de
`trust proxy` con Express 5.2.1 en un script descartable (fuera del repo).

---

## Resumen ejecutivo

- El backend **sí** configura `trust proxy` y el frontend **no** tiene dominios
  hardcodeados: sirve igual en `trycloudflare` o en `app.aexia.com.ar` sin
  cambios de código.
- El problema real no es "falta HTTPS": Cloudflare lo termina. El problema es
  que la **IP que ve el limitador de login es, en un escenario concreto,
  controlable por el atacante**, y que el puerto 3000 escucha en todas las
  interfaces. Eso permite saltarse el límite de 8 intentos y, con la misma
  palanca, forzar el bloqueo de cualquier IP.
- No hay recuperación de contraseña autoservicio: hoy la resuelve el SuperAdmin
  con una clave temporal por teléfono.
- Facturación es **solo interna** (no ARCA/AFIP).

---

## 1. `trust proxy` y la IP del limitador de login

### Qué hay hoy

- **Sí se configura**: `server.js:20` → `app.set('trust proxy', 1);`.
- **Limitador de login**: `server.js:594-600` (`max: 8`, `windowMs: 10 min`) **sin
  `keyGenerator`** → `express-rate-limit` usa el default `req.ip`.
- Lookup de email: `server.js:256-263` con `keyGenerator: (req) => req.ip`.
- Cambio de clave: `server.js:878-884`, mismo default (`req.ip`).
- Log de auditoría: `server.js:3738` →
  `(req.headers['x-forwarded-for'] || '').split(',')[0]` = **la entrante más a la
  izquierda** de `X-Forwarded-For`, que es la que puede escribir el cliente.

### Qué IP ve realmente (semántica de Express, verificada)

Con `trust proxy = 1` y Express 5, probado en un script descartable:

| Cabecera `X-Forwarded-For` recibida | `req.ip` resultante |
|---|---|
| `203.0.113.9` (normal) | `203.0.113.9` ✅ |
| `1.2.3.4, 203.0.113.9` (cliente manda basura) | `203.0.113.9` ✅ (última manda) |
| *(sin XFF)* | `::ffff:127.0.0.1` ⚠️ |
| `203.0.113.9, 172.71.0.1` (un salto extra) | `172.71.0.1` ❌ |

Cloudflare **agrega** la IP del visitante al **final** de `X-Forwarded-For`
(docs de Cloudflare + issue cloudflare/cloudflared#1426: el origen recibe
`...cliente-basura...,203.0.113.1`). `cloudflared` conecta al origen desde
`localhost` (`config.yml:1` = `{}`, `AexiaAutoStart.bat:11`,
`docs/plan-produccion.md:68`), así que el socket viene de loopback y `trust
proxy = 1` deja `req.ip` en la **última** entrada = IP real del visitante.

**Conclusión:** en el camino normal por el túnel, hoy el limitador ve la IP real
del cliente. **No** bloquea a todos los usuarios de entrada.

### El escenario donde sí se rompe (y por eso es bloqueante)

1. **`:3000` escucha en todas las interfaces.** `server.js:23` →
   `HOST = process.env.HOST || '0.0.0.0'` y `.env.example:9-10` propone
   `HOST=0.0.0.0`. Si el puerto es alcanzable sin pasar por Cloudflare (misma
   LAN, o regla de firewall abierta), el atacante manda su propio
   `X-Forwarded-For` y **elige la clave del limitador**:
   - rota la cabecera → **8 intentos ilimitados** (se salta el límite);
   - manda la IP de una víctima → **la bloquea 10 minutos** a voluntad.
   El comentario de `entorno.js:17` confirma que el túnel apunta fijo a `:3000`.
2. **Si `cloudflared` no seteara `X-Forwarded-For`** (hay casos reportados, p. ej.
   en k8s), todas las peticiones del túnel caen en `req.ip = 127.0.0.1` → **8
   fallos de un atacante bloquean a TODOS** por 10 minutos.
3. **Usuarios tras una misma IP pública** (oficina con NAT, o CGNAT de la
   operadora) comparten un solo bucket: un actor cualquiera bloquea a toda la
   oficina.
4. **Auditoría falsificable:** `ipDe()` (`server.js:3738`) registra la entrada
   *izquierda* de XFF, que el cliente puede escribir. Se usa para auditar el
   cambio de clave (`server.js:4303`, `soporte.js`) → rastro de IP falsificable.

### Arreglo propuesto

1. Helper único de IP de cliente, en un lugar (`server.js` o `src/`):
   ```js
   // Solo confía en CF-Connecting-IP si la conexión viene del túnel local.
   function ipCliente(req) {
     const ra = String(req.socket.remoteAddress || '');
     const delTunel = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
     const cf = delTunel ? (req.headers['cf-connecting-ip'] || '').trim() : '';
     if (/^[0-9a-fA-F:.]{3,45}$/.test(cf)) return cf;   // IPv4/IPv6
     return req.ip || null;
   }
   ```
   (Cloudflare manda `CF-Connecting-IP` con **un solo** valor; no se puede
   "encadenar" como XFF.)
2. Usarlo como `keyGenerator` en `limitadorLogin`, `limitadorLookupEmail` y
   `limitadorCambioPassword`, y dentro de `ipDe()`.
3. **No exponer `:3000`**: `HOST=127.0.0.1` en el `.env` (el túnel conecta por
   localhost) y regla de firewall que cierre 3000 (y 3306) al exterior. Así el
   atacante no puede llegar al origen saltándose Cloudflare.
4. (Opcional) `app.set('trust proxy', Number(process.env.TRUST_PROXY || 1))` para
   no quedar clavado en `1`.

- **Decisión D1 — Helper de IP + límites y auditoría con él.** Recomendado: **sí**
  (bajo riesgo, alto impacto). Alternativa: dejarlo y confiar solo en el firewall
  (más frágil; no arregla la auditoría ni el caso 2).
- **Decisión D2 — `HOST=127.0.0.1` + firewall 3000/3306.** Recomendado: **sí**.
- **Decisión D3 — `TRUST_PROXY` por env.** Recomendado: **diferir** (mejora, no
  urgente) salvo que sumen otro proxy delante.

---

## 2. CORS, URLs, dominios, cookies y redirecciones

| Punto | Estado | Evidencia |
|---|---|---|
| CORS | **Abierto a cualquiera** (`Access-Control-Allow-Origin: *`) | `server.js:47` → `app.use(cors())` |
| URLs del frontend | **Relativas** (`/api/...`), sin host fijo | `auth-check.js:33`, `marca.js:167`, `admin.js:1173` (`window.location.origin`) |
| Dominio hardcodeado | **No hay** `aexia.com.ar` ni `localhost` en el frontend | grep en `frontend/*` (solo namespaces SVG y `wa.me`) |
| Redirecciones | **No hay** `res.redirect` en el backend | grep `res.redirect` = 0 |
| Cookies | **No se usan** cookies | sin `res.cookie`/`Set-Cookie`; token Bearer en `localStorage` (`auth-check.js:19`) |
| QR | **No ata dominio**: el QR lleva solo el código de 12 chars | `server.js:1399-1411`, `1600-1615` |
| `aexia.com.ar` en `.env` | **No existe** variable de dominio | `.env.example` completo |

**Dónde cambiar si se quiere endurecer CORS:** `server.js:47`. Propuesta:

```js
const permitidos = (process.env.CORS_ORIGINS || 'https://app.aexia.com.ar')
  .split(',').map(s => s.trim());
app.use(cors({ origin: permitidos, credentials: false }));
```

No hay cookies, así que CORS no habilita CSRF; el riesgo es que cualquier sitio
pueda llamar a la API desde un navegador. Cerrarlo es barato.

- **Decisión D4 — Restringir CORS a `app.aexia.com.ar` (parametrizable por
  `CORS_ORIGINS`).** Recomendado: **sí** (bloqueante barato).
- **Decisión D5 — Cookies httpOnly en vez de `localStorage`.** Recomendado:
  **no ahora** (cambio grande; `localStorage` + CSP es aceptable para el piloto).

---

## 3. Cabeceras de seguridad, HTTPS, caché y tamaño de subidas

- **Helmet activo** pero con dos controles apagados: `server.js:43-46`
  (`contentSecurityPolicy: false`, `crossOriginEmbedderPolicy: false`).
  Defaults vigentes: `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`. HSTS lo termina
  entregando Cloudflare igual.
- **HTTPS**: lo termina Cloudflare; la app habla HTTP en `:3000`. Con
  `trust proxy = 1`, `req.protocol`/`req.secure` reflejan `X-Forwarded-Proto`
  (no se usan en el código). Falta del lado Cloudflare: túnel **nombrado** + DNS
  + "Always Use HTTPS" (`docs/plan-produccion.md:372-402`, hoy escrito como
  `aexia.<TUDOMINIO>`; hay que fijarlo a `app.aexia.com.ar`).
- **Caché del frontend**: `server.js:49` sirve estático **sin opciones** →
  `Cache-Control: public, max-age=0` + ETag (revalida siempre). Los HTML/CSS/JS
  usan `?v=2.6` para invalidar. Subir `max-age` "para siempre" en archivos no
  versionados es justo el bug que el repo ya documenta
  (`tools/mutar-estilo-y-tema.js:588`): un CSS viejo queda clavado en el
  navegador. Si se mejora, hacerlo **solo** con `vendor/`, `logos/` y lo que
  lleve `?v=`.
- **Tamaño máximo de subida**: `server.js:57` → multer `fileSize: 5 MB`,
  tipos `jpeg/png/webp/gif` (`server.js:59`). Aplica a `/api/upload` (stock,
  `server.js:1310`) y `/api/admin/subir-logo` (`server.js:4459-4464`).
  `express.json()` sin límite explícito (`server.js:48`) = **100 KB** por defecto:
  un pedido/factura con muchos ítems podría rebotar. No es bloqueante, pero
  conviene `express.json({ limit: '1mb' })`.
- **Memoria**: las subidas van a `multer.memoryStorage()` (`server.js:54`) → 5 MB
  en RAM por subida; pm2 corta a 300 M (`ecosystem.config.js:13`). Aceptable para
  el piloto.

- **Decisión D6 — Dejar CSP apagada por ahora.** Recomendado: **diferir** (hay
  `onclick=` inline por todos lados; activar CSP exige refactor). Ver D7.
- **Decisión D7 — Endurecer caché solo para assets versionados + `vendor/` +
  `logos/`.** Recomendado: **sí como mejora**.
- **Decisión D8 — `express.json({ limit: '1mb' })`.** Recomendado: **sí** (bajo).
- **Decisión D9 — Túnel nombrado + DNS + Always Use HTTPS para
  `app.aexia.com.ar`.** Recomendado: **sí (bloquea el piloto)**; es ejecución del
  paso 11 de `docs/plan-produccion.md`.

---

## 4. Manejo de errores y logs

- **No hay handler global de errores** (no hay middleware de 4 argumentos). Un
  JSON malformado en `express.json()` (`server.js:48`) cae al handler por
  defecto de Express (respuesta HTML, no JSON). En Express 5 los `async`
  rechazados sí llegan a un handler, pero el proyecto no define uno.
- **Se devuelve `err.message` crudo** al cliente en 4 rutas:
  `server.js:2551`, `3198`, `3281`, `3350` (y todas las del panel vía
  `rutaAdmin`, `server.js:3733`). Un error de MySQL filtraría nombres de
  tabla/columna (no secretos). Conviene mensaje genérico + detalle solo al log.
- **Logs del servidor**: `console.error(...)` con el stack a
  `backend/logs/errores.log` (`ecosystem.config.js:16-17`). `logs/` está ignorado
  por git y **no** está bajo `frontend/`, así que no se sirve por HTTP
  (`.gitignore:29-33`). El arranque loguea nombre/puerto de base, no la clave
  (`server.js:127`). `/api/mi-empresa` documenta que no expone la clave de base
  (`server.js:716`). `tools/verificar-clave.js` no imprime el hash.
- **Sin enumeración de usuarios**: `server.js:613-616` usa el mismo texto para
  "no existe / inactivo / clave mal"; `empresa-por-email` siempre 200
  (`server.js:253`).
- **Punto débil**: la IP de auditoría es falsificable (ver §1, `server.js:3738`).
- **A confirmar antes de salir**: que el `logs/` actual de producción no tenga
  la clave de MySQL en texto plano (el `.gitignore:29` dice que eso pasó alguna
  vez).

- **Decisión D10 — Handler global de errores + quitar `err.message` crudo de las
  4 rutas.** Recomendado: **sí** (bloquea la segunda empresa / mejora según
  criterio; lo pongo como mejora del piloto).
- **Decisión D11 — Revisar `backend/logs/errores.log` en el servidor y rotarlo.**
  Recomendado: **sí antes de exponer**.

---

## 5. Recuperación de contraseña

- **No hay autoservicio.** `login.html` no tiene link "olvidé mi contraseña"
  (grep: no aparece `olvid`/`recuper`/`forgot`). No hay endpoint de reset por
  email (no hay dependencia de correo en `package.json`).
- **Cómo se restablece hoy** (SuperAdmin, por teléfono):
  `server.js:4270-4308` → `POST /api/admin/empresas/:id/usuarios/:usuarioId/clave-temporal`
  → `soporte.claveTemporalPara()` (`soporte.js:130`). Genera una clave **aleatoria
  de 12 caracteres** (alfabeto sin caracteres confundibles, `soporte.js:57-67`),
  se muestra **una sola vez**, se guarda hasheada y marca
  `debe_cambiar_password = 1`. El servidor **bloquea todo** hasta que el usuario
  la cambie (`server.js:352-376`). Queda auditado con autor e IP
  (`server.js:4303`).
- Alternativas por consola: `tools/reset-clave.js` (acceso al servidor) y
  `npm run superadmin -- --sobrescribir` para la clave del propio SuperAdmin.

Es un flujo asistido válido para el piloto. No escala a N empresas sin proceso.

- **Decisión D12 — Mantener reset asistido por teléfono en el piloto.**
  Recomendado: **sí** (no bloquea el piloto).
- **Decisión D13 — Autoservicio (email/WhatsApp con token de un uso).**
  Recomendado: **diferir a la segunda empresa**, y definir primero el canal
  (no hay SMTP hoy).

---

## 6. Módulo de facturación (¿interna o ARCA?)

- **Solo comprobantes internos. No integra ARCA/AFIP.** Está escrito y explicitado
  tres veces: `frontend/facturacion.js:26-30` ("esto no es facturación
  electrónica… no se emiten ante ARCA/AFIP, no tienen CAI ni punto de venta y no
  son comprobantes fiscales"), en la hoja impresa (`facturacion.js:862-863`) y en
  el backend.
- No existe ninguna integración ni cliente ARCA/AFIP (grep `ARCA|AFIP|CAE` solo
  devuelve comentarios/avisos). El número es una **correlativa interna**
  (`server.js:3250`, `siguienteNumero(query, 'factura')`).
- Flujo: borrador → emitida → pagada / anulada (`server.js:2974-3455`).

- **Decisión D14 — Asumir facturación interna para el piloto.** Recomendado:
  **sí** (dejar el aviso visible). Si aparece un cliente que necesite comprobante
  fiscal, es un módulo nuevo grande (ARCA), no un ajuste.

---

## Checklist priorizado (con decisión)

Leyenda: 🔴 bloquea el piloto · 🟠 bloquea la segunda empresa · 🟢 mejora.

| # | Prior. | Qué | Evidencia | Arreglo | Decisión |
|---|---|---|---|---|---|
| 1 | 🔴 | IP del limitador de login controlable si se llega al origen | `server.js:20,594-600,3738` | Helper `ipCliente()` con `CF-Connecting-IP` solo si el socket es loopback; usarlo en los 3 limitadores y en `ipDe()` | **D1: hacer** |
| 2 | 🔴 | `:3000` escucha en `0.0.0.0` (precondición del #1) | `server.js:23`, `.env.example:9-10` | `HOST=127.0.0.1` + firewall 3000/3306 | **D2: hacer** |
| 3 | 🔴 | CORS abierto (`*`) | `server.js:47` | `cors({origin:[app.aexia.com.ar]})` por `CORS_ORIGINS` | **D4: hacer** |
| 4 | 🔴 | Dominio `app.aexia.com.ar`: túnel nombrado + DNS + Always Use HTTPS | `docs/plan-produccion.md:372-402`, `config.yml:1` | Ejecutar paso 11 de R-2 con `app.aexia.com.ar` | **D9: hacer** |
| 5 | 🔴 | Autostart + backups antes de exponer | `docs/plan-produccion.md` (R-2) | Ejecutar R-2 | **D9b: hacer** |
| 6 | 🟠 | Bloqueo por IP compartida (oficina/NAT) y sin límite por cuenta | `server.js:594-600` | Segundo contador por `email` o lockout por usuario | **D15: hacer antes de la 2ª** |
| 7 | 🟠 | `trust proxy` fijo en `1` (frágil ante otro proxy) | `server.js:20` | `TRUST_PROXY` por env | **D3: hacer antes de la 2ª** |
| 8 | 🟠 | CSP apagada + token en `localStorage` + `onclick` inline | `server.js:43-46`, `auth-check.js:19` | Refactor a `addEventListener` + CSP con `script-src 'self'` | **D6/D7: antes de la 2ª** |
| 9 | 🟠 | Sin handler global de errores; `err.message` crudo en 4 rutas | `server.js:2551,3198,3281,3350,3733` | Middleware de 4 args + mensajes genéricos | **D10: antes de la 2ª** |
| 10 | 🟠 | Recuperación solo asistida (no escala) | `server.js:4270-4308` | Proceso formal; eventual self-service por token | **D12/D13** |
| 11 | 🟢 | Caché de estáticos sin `max-age` | `server.js:49` | `immutable` solo para `vendor/`, `logos/`, `?v=` | **D7: mejora** |
| 12 | 🟢 | `express.json()` limitado a 100 KB | `server.js:48` | `{ limit: '1mb' }` | **D8: mejora** |
| 13 | 🟢 | Revisar/rotar `backend/logs/` de producción | `.gitignore:29`, `ecosystem.config.js:16` | Limpiar y rotar | **D11: mejora** |
| 14 | 🟢 | HTTPS/HSTS/cabeceras | Cloudflare + `helmet` `server.js:43` | Revisar `includeSubDomains` | **D16: mejora** |

### Lo que NO hace falta tocar (ya está bien)

- El frontend usa URLs relativas y `window.location.origin`: **no hay dominio
  hardcodeado** que cambiar para mudar a `app.aexia.com.ar`.
- No hay cookies ni redirecciones del lado servidor que ajustar.
- El QR de etiquetas ya no embebe URL (`server.js:1399-1411`): deja de depender
  del dominio.
- Login sin enumeración de usuarios (`server.js:613-616`).
- `helmet` ya entrega HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`.

---

## Decisiones pendientes de tu aprobación (resumen)

- **D1** Helper `ipCliente()` (CF-Connecting-IP solo desde loopback) en limitadores
  y auditoría. *(recomendado: sí)*
- **D2** `HOST=127.0.0.1` + firewall 3000/3306. *(recomendado: sí)*
- **D3** `TRUST_PROXY` por env. *(diferir)*
- **D4** CORS restringido a `app.aexia.com.ar` vía `CORS_ORIGINS`. *(sí)*
- **D5** Pasar de `localStorage` a cookie httpOnly. *(no ahora)*
- **D6** Activar CSP. *(diferir, ver D7/D8)*
- **D7** Endurecer caché solo para assets versionados/`vendor`/`logos`. *(sí, mejora)*
- **D8** `express.json({ limit: '1mb' })`. *(sí, mejora)*
- **D9** Túnel nombrado + DNS + Always Use HTTPS para `app.aexia.com.ar`. *(sí, bloqueante)*
- **D9b** Ejecutar R-2 (autostart + backups) antes de exponer. *(sí, bloqueante)*
- **D10** Handler global de errores + quitar `err.message` crudo. *(antes de la 2ª)*
- **D11** Revisar/rotar logs de producción. *(sí, mejora)*
- **D12** Mantener reset asistido por teléfono. *(sí, piloto)*
- **D13** Autoservicio de recuperación. *(diferir a la 2ª)*
- **D14** Facturación interna (no ARCA) en el piloto. *(sí)*
- **D15** Límite por cuenta además de por IP. *(antes de la 2ª)*
- **D16** Revisar `includeSubDomains` de HSTS. *(mejora)*

## Verificación propuesta (cuando se ejecute)

- Con el túnel arriba y `:3000` cerrado: desde otra máquina, `curl` a
  `http://IP:3000` debe fallar (timeout/refused).
- Con `CF-Connecting-IP: 1.2.3.4` mandado por el cliente directo a `:3000`, el
  login **no** debe usar esa IP como clave (fallback a `req.ip`).
- 8 logins fallidos desde una IP → 429 para esa IP y **no** para otra
  (dos empresas / dos IPs de prueba).
- Un `X-Forwarded-For` de basura **no** cambia el resultado del limitador.
- `GET https://app.aexia.com.ar/login.html` → 200; login real → panel con datos.
- Dos empresas: ninguna ve datos de la otra (skill `tenant-isolation`).
