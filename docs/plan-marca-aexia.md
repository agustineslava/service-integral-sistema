# Plan: separar la marca de la plataforma (Aexia) de la de cada empresa

**Modo Plan — no se modifica código todavía.** Fecha: 2026-10-10.
Hoy "Service Integral" (una empresa cliente, la #1) está escrito a mano en el frontend, en
el arranque del servidor, en pm2 y en los `.bat`. Eso hace que el sistema se anuncie como de
una sola empresa. Este plan separa **plataforma** (Aexia) de **empresa** (marca por fila de
la central) sin tocar datos de ninguna empresa.

## 1. Qué se leyó (grep, rangos; sin confiar en la lista del pedido)

Se verificó con `grep` sobre `backend/` y `frontend/` y se cruzó con `docs/inventario.md`
(ojo: el inventario tiene líneas viejas; las de abajo son las actuales).

| Zona | Evidencia |
|---|---|
| `frontend/marca.js:42` | `rutaDeLogo` cae a `'/logos/logo.jpg'` (logo de Service Integral) cuando la empresa no tiene logo. |
| `frontend/marca.js:86-88` | `document.title` se arregla **reemplazando el texto literal** `'Service Integral'` por el nombre de la empresa. Acople directo al hardcodeo. |
| `frontend/marca.js:148-168` | `aplicarMarcaDinamica`: sin token no hace nada; con token, si `sin_empresa` se queda neutral. |
| `frontend/marca.js:164` | Comentario con un carácter corrupto (`、`, una coma china) — residuo a limpiar. |
| `frontend/login.html:6,16,27,29,30` | `<title>Service Integral - Iniciar Sesión</title>`; logo oculto; nombre y subtítulo neutros con `data-neutral`. |
| `frontend/index.html:6,24,82,518,570` | Título, `alt="Logo de Service Integral"`, `<h1>Bienvenido a Service Integral</h1>`, `placeholder="juan@serviceintegral.com"`, `<h3 id="etiqueta-comercio">Service Integral</h3>`. |
| Otros HTML (`clientes`, `reparaciones`, `etiquetas`, `facturacion`, `escaner`, `pedidos`, `presupuestos`, `reportes`) | Título `Service Integral - …` y `alt="Logo de Service Integral"` en cada uno. |
| `frontend/app.js:608` | `const nombreComercio = document.querySelector('.login-titulo')?.textContent || 'Service Integral';` — pero `.login-titulo` **no existe** en `index.html` (solo en `login.html`): siempre cae al literal. |
| `frontend/admin.js:678,690` | Pistas del formulario de empresa: `'Service Integral S.A.'` y `'Service Integral · Mantenimiento'`. |
| `frontend/pedidos.js:262` | WhatsApp: `` `🛠️ *PEDIDO DE REPUESTOS - SERVICE INTEGRAL*` ``. |
| `backend/server.js:159-173` | `marcaDeEntorno()`: sin token y sin slug devuelve `COMERCIO_NOMBRE` (Service Integral). |
| `backend/server.js:206-218` | `config-comercio`: sin token/slug → `marcaDeEntorno()`; token de superadmin → `{...marcaDeEntorno(), sin_empresa:true}`. |
| `backend/server.js:4594` | `console.log('🚀 Servidor de Service Integral activo.')`. |
| `backend/ecosystem.config.js:1,5` | Comentario y `name: 'service-integral-backend'`. |
| `backend/.env.example:15,19,72,83,85` | `DB_USER=service_integral_app`, `DB_NAME=ServiceIntegralsistema`, `COMERCIO_NOMBRE=Service Integral`, `COMERCIO_LOGO=logos/logo.jpg`. |
| `Sistema ServiceIntegral.bat:2,6` | Título y eco "SERVICE INTEGRAL". |
| `Probar_Restore_Backup.bat:3,34` | Título "…- Service Integral"; mención a `service_integral_app`. |
| `backend/tools/{datos-empresa,modulos,f3,f4,f5}-*.js` | Imprimen `pm2 restart service-integral-backend`. |
| `backend/tools/f5-verificar.js:303,373` | Verificador afirma que sin sesión la marca es `COMERCIO_NOMBRE || 'Sistema de Gestión'`. |
| `backend/tools/login-probar.js:48-69` | Prueba de navegador: login en blanco no debe decir "Service Integral"; empresa #1 sí. |
| `frontend/facturacion.js:772-781`, `presupuestos.js:511-520` | Comprobantes usan `empresa.logo_url`; si no hay logo, salen sin logo (sin fallback hardcodeado). |
| `frontend/logos/logo.jpg` | Único asset de `frontend/logos/` y **está versionado en git**. Es el logo de Service Integral usado como default en TODOS los HTML. |

## 2. Concepto (por qué el arreglo va en este orden)

Hay **dos marcas distintas** que hoy están mezcladas:

- **Plataforma (Aexia):** dueña del sistema. Aparece cuando no hay empresa: pantalla de login
  antes de escribir el correo, panel del superadmin, arranque del servidor, infraestructura.
- **Empresa:** la marca de la fila de `empresas` en la central (nombre, subtítulo, logo,
  colores). Ya la resuelve `/api/config-comercio` + `marca.js`. Es lo que ve cada cliente
  después del login.

Regla: **el HTML no lleva el nombre de ninguna empresa.** El nombre de empresa lo escribe
`marca.js` en tiempo de ejecución; el de plataforma sale de una variable de entorno. Nunca se
compara ni se reemplaza texto por el nombre de una empresa (hoy se hace en `marca.js:87`).

## 3. Propuesta

### 3.1 Variable de plataforma

- Nuevas variables en `.env.example`: `PLATAFORMA_NOMBRE=Aexia` (default en código `'Aexia'`),
  `PLATAFORMA_SUBTITULO`, `PLATAFORMA_LOGO`.
- `server.js`: leerlas una vez y usar `PLATAFORMA_NOMBRE` en el log de arranque.
- Renombrar `marcaDeEntorno()` → `marcaDePlataforma()`: devuelve el nombre/logo **de la
  plataforma**, no `COMERCIO_*`. Se usa en: sin token, sin slug, token inválido/vencido y
  token de superadmin (`sin_empresa`).
- `COMERCIO_*` **deja de ser la marca de runtime**. Queda solo para sembrar/importar la
  empresa #1 (`datos-empresa.js --sembrar`, `importar-empresa.js`), que es donde nació.

### 3.2 Frontend: sacar el texto fijo y resolver el título por composición

- Cada HTML declara su página sin marca, p. ej. `<title data-pagina="Clientes">Clientes</title>`.
  `marca.js` compone `document.title = `${marca.nombre} - ${pagina}`` (nunca `replace`).
- `alt` de los logos vacío (`alt=""`); `marca.js` ya lo setea a `Logo ${nombre}`.
- Textos de empresa vacíos o neutros en el HTML:
  - `index.html:82` → `<h1 data-bienvenida></h1>` (o "Bienvenido"); `marca.js` escribe
    `Bienvenido a ${nombre}`.
  - `index.html:570` `#etiqueta-comercio` → vacío; lo escribe `marca.js`.
  - `index.html:518` `placeholder="juan@serviceintegral.com"` → `usuario@empresa.com`.
- `marca.js` publica el resultado en un punto único, p. ej. `window.MARCA_ACTUAL = { nombre,
  logo_url, color_primario, color_secundario }`, para que `app.js` y `pedidos.js` lo lean en
  vez de raspar el DOM.
- `app.js:608`: `const nombreComercio = window.MARCA_ACTUAL?.nombre || '';` (sin literal).
- `pedidos.js:262`: `` `🛠️ *PEDIDO DE REPUESTOS - ${nombreComercio.toUpperCase()}*\n` ``.
- `admin.js:678,690`: pistas genéricas (`'Nombre de la empresa S.A.'`, `'Nombre · Rubro'`).
- Subir el `?v=` de `marca.js`/`style.css`/HTML (hoy `2.5`) para forzar recarga.

### 3.3 Qué muestra el login sin empresa (propuesta)

Mostrar la **plataforma**: logo Aexia (o símbolo neutro) + `Aexia` + subtítulo
"Gestión para talleres y comercios", y el texto "Ingresá con tu correo de la empresa".
Al escribir un correo de empresa, `aplicarMarcaDesdeConfig` la reemplaza por esa marca
(flujo actual de `login.html:114-147`). Alternativa conservadora: dejarlo totalmente neutro
(sin nombre), como hoy. → **D1**.

### 3.4 `logos/logo.jpg`

Es el logo de Service Integral y **versionado en git**; casi seguro es el `logo_url` de la
empresa #1 (viene de `COMERCIO_LOGO` + `--sembrar`). **No se borra** (rompería la marca de la
empresa #1 y viola "no tocar datos de empresas").

Propuesta:
- Mantener `logos/logo.jpg` como está (compatibilidad empresa #1).
- Agregar un **logo de plataforma** (`PLATAFORMA_LOGO`, p. ej. `logos/aexia.png`) para login/
  panel.
- Cambiar los fallbacks de empresa-sin-logo (`marca.js:42` y el `src` de los HTML) a un
  placeholder neutro (o dejar sin logo), nunca al logo de una empresa.
- Archivos de imagen nuevos → requieren tu OK (**D3**).

### 3.5 pm2 y `.bat`

- `ecosystem.config.js`: `name: 'aexia-backend'` y comentario "PM2 para Aexia".
- `Sistema ServiceIntegral.bat` → `Aexia.bat`; título/eco "Aexia - Servidor y Túnel".
- `Probar_Restore_Backup.bat`: título "… - Aexia" (el nombre del archivo puede quedar).
- Renombrar pm2 **no es solo editar el archivo**: el proceso viejo sigue corriendo hasta
  `pm2 delete service-integral-backend` y los textos `pm2 restart service-integral-backend`
  de las tools quedan desactualizados. Es cambio de operación → **D4/D5**.

### 3.6 Lo que NO se toca

- Datos de ninguna empresa (filas de la central, bases `si_tenant_*`/legada, backups).
- Defaults de importación de la empresa #1 (`importar-empresa.js`: `SLUG_LEGADO`,
  `NOMBRE_LEGADO`), que son migración puntual permitida por AGENTS.md.
- Nombres de bases y usuarios MySQL (`si_*`, `service_integral_app`): tarea aparte.
- `.env` real y claves.

## 4. Casos límite

1. **Empresa llamada "Aexia" o que contenga "Service Integral":** al no usar `replace` sino
   composición, no se rompe nada.
2. **Empresa sin `nombre`:** `marca.js` hoy no aplica nada y deja el HTML. Sin texto fijo,
   quedaría vacío → usar fallback explícito (plataforma o neutro). → **D6**.
3. **Empresa sin `logo_url`:** debe caer al placeholder de plataforma/neutro, **nunca** a
   `logos/logo.jpg` (logo de otra empresa).
4. **Empresa sin color:** ya se resuelve (no se toca la variable CSS; paleta por defecto).
5. **Token vencido/ inválido sin slug:** hoy recibe la marca de entorno (Service Integral) —
   fuga real; con el cambio recibe la marca de plataforma.
6. **Superadmin:** `admin.html` no carga `marca.js` y es neutro a propósito. ¿Mostrar "Aexia ·
   Administración"? → **D8**.
7. **Dos empresas con el mismo dominio de correo:** `empresa-por-email` devuelve la operativa
   que encuentra (comportamiento actual); es de marca solo indirectamente.
8. **Sin JS:** el `<title>` queda con la página ("Clientes") sin marca; aceptable.
9. **Impresos:** `facturacion.js`/`presupuestos.js` ya usan `empresa.logo_url` y no imprimen
   logo si falta; no requiere cambio funcional (solo revisar el comentario "viene como
   `logos/logo.jpg`").
10. **Verificadores desactualizados:** `f5-verificar.js:303,373` espera `COMERCIO_NOMBRE`;
    `login-probar.js` asume que empresa #1 = Service Integral (sigue siendo cierto en datos,
    pero el caso "sin sesión" debe comparar contra `PLATAFORMA_NOMBRE`). Hay que actualizarlos.
11. **Caché:** sin subir `?v=` los navegadores siguen con el `marca.js` viejo (que hace
    `replace`). Obligatorio bumpear la versión.
12. **`pm2` viejo corriendo:** tras renombrar, `pm2 save` + `pm2 delete` del nombre anterior;
    si no, quedan dos procesos peleando por el puerto 3000.

## 5. Decisiones que necesito de vos

- **D1 — Login sin empresa:** ¿plataforma (Aexia + logo, recomendado) o totalmente neutro?
- **D2 — Nombres de variables:** `PLATAFORMA_NOMBRE` / `PLATAFORMA_SUBTITULO` / `PLATAFORMA_LOGO`
  con default `Aexia`. ¿Confirmás?
- **D3 — `logos/logo.jpg`:** mantenerlo (recomendado, por empresa #1) + agregar logo de
  plataforma y placeholder neutro. ¿Autorizás los archivos de imagen nuevos?
- **D4 — pm2:** ¿renombrar `service-integral-backend` → `aexia-backend` ahora o en la tarea de
  infra (`si_*` → `aexia_*`)? Afecta producción (reinicio del proceso).
- **D5 — `.bat`:** ¿renombrar `Sistema ServiceIntegral.bat` → `Aexia.bat`? ¿`Probar_Restore_Backup.bat`
  cambia solo el título o también el nombre?
- **D6 — Fallback de título:** si una empresa no tiene nombre, ¿mostrar "Aexia" o nada?
- **D7 — Fuente del nombre de empresa en el frontend:** ¿`window.MARCA_ACTUAL` (recomendado) o
  seguir raspando el DOM?
- **D8 — Panel superadmin:** ¿agregar marca "Aexia" al `admin.html` o dejarlo neutro?
- **D9 — `COMERCIO_*`:** dejarla solo para importar/sembrar la empresa #1 (recomendado).
- **D10 — Alcance cosmético:** ¿limpio también los comentarios de `style.css` y `server.js` y
  el carácter corrupto de `marca.js:164`?

## 6. Plan de implementación (cuando apruebes)

1. **Backend:** `.env.example` + `server.js` (variables de plataforma, `marcaDePlataforma()`,
   log de arranque).
2. **`marca.js`:** composición de título, `window.MARCA_ACTUAL`, fallback de logo neutro,
   login → plataforma.
3. **HTML (10 páginas):** título por `data-pagina`, `alt=""`, textos de empresa vacíos,
   placeholder genérico, bump de `?v=`.
4. **JS de pantalla:** `app.js`, `pedidos.js`, `admin.js`.
5. **Ops:** `ecosystem.config.js`, `.bat`, mensajes `pm2 restart` en las tools (según D4/D5).
6. **Verificadores:** `f5-verificar.js` y `login-probar.js`.

## 7. Cómo se verifica

- `backend/tools/login-probar.js`: login en blanco no nombra ninguna empresa; email de empresa
  #1 muestra su marca; superadmin queda neutral/plataforma.
- `backend/tools/f5-verificar.js`: sin sesión devuelve la marca de plataforma; con token,
  la de esa empresa; detector de fugas (dos empresas con logos distintos) en verde.
- Manual con **dos empresas** de marcas distintas: ninguna ve el nombre/logo de la otra, en
  escritorio y a 375 px (Playwright/DevTools), y la consola sin errores.
- `grep -ri "Service Integral" backend/ frontend/` (excluyendo tools de migración y datos)
  sin coincidencias en código de marca.
- Confirmar que la empresa #1 sigue viendo su logo (el archivo `logos/logo.jpg` intacto).
