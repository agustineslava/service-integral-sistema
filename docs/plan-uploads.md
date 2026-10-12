# Plan: subidas de archivos (Cloudinary) por empresa

**Modo Plan — no se modifica código todavía.** Fecha: 2026-10-10.
Hoy las dos rutas de subida usan la carpeta fija `service_integral` para **todas** las empresas. Esto no aísla los archivos entre empresas ni por nombre ni por carpeta.

## 1. Qué se leyó (con grep y rangos, sin archivos completos)

| Archivo / zona | Qué se vio |
|---|---|
| `backend/server.js` 47–59 | `upload` de multer: `memoryStorage`, `limits.fileSize = 5 MB`, `fileFilter` solo `image/jpeg`, `image/png`, `image/webp`, `image/gif`. El SVG queda afuera a propósito. |
| `backend/server.js` 1258–1266 | `borrarImagenDeCloudinary(url)` y `extraerPublicId(url)` (corta por el segmento `upload`). |
| `backend/server.js` 1268–1289 | `POST /api/upload` → guardas `verificarToken, requiereAdmin, upload.single('imagen')`. **Sin `requiereModulo`**. `folder: 'service_integral'`, **sin `public_id` ni `use_filename`**, transformación `800×800 limit / quality auto / fetch_format auto`. Devuelve `result.secure_url`. |
| `backend/server.js` 1291–1310 | `POST /api/delete-image` → `verificarToken, requiereAdmin`. Toma `imageUrl`, extrae `public_id` y llama `destroy`. **No verifica dueño**. |
| `backend/server.js` 306–310, 353–356 | `verificarToken` rechaza al SUPERADMIN / sin `empresa_id` y deja `req.empresa` (fila de la central, con `slug`). |
| `backend/server.js` 4396–4442 | `POST /api/admin/subir-logo` → `verificarSuperAdmin, rutaAdmin`; `upload.single` dentro del handler. `folder: 'service_integral/logos'`, sin `public_id`, transformación `800×400 limit`. **No guarda en la base**: devuelve `url` y audita `superadmin.subir_logo`. |
| `backend/server.js` 3896–3946 | El PATCH de empresa (EDITABLES) valida `logo_url` (≤500, `http(s)`, sin `.svg`) y lo persiste. El alta lo manda en el POST (`admin.js` 530–533). |
| `backend/migrations/central/001_esquema_central.sql` 24–56 | `empresas.slug VARCHAR(60)`, `nombre_db`, `logo_url VARCHAR(500)`. `slug` es único y no cambia. |
| `backend/schema/base.sql` 141–143 | Fotos de producto: `productos.imagen_1/2/3 VARCHAR(255) NULL` (base del tenant). |
| `frontend/app.js` 452–524 | El navegador sube fotos con `/api/upload` y las borra con `/api/delete-image`. **No manda carpeta**: la elige el servidor. |
| `frontend/admin.js` 85–151, 530–533 | El logo se sube a `/api/admin/subir-logo` (no a `/api/upload`, que le cierra la puerta al superadmin); la URL va al campo `logo_url`. |
| `backend/tools/logos-cloudinary.js` 21 | `CARPETA = 'service_integral/logos'`: inventario/limpieza de logos por prefijo. |
| `backend/tools/probar-subida-logo.js` 148 | El test afirma que la URL incluye `service_integral/logos`. |
| `backend/src/servicios/altas.js` 126–174 | Slug final `[a-z0-9-]`, ≤60; `slugLibre()` puede agregar `-2` si el slug pedido ya existe. |

## 2. Respuestas con evidencia

**¿El nombre del archivo incluye la empresa?** **No.** Ninguna de las dos rutas pasa `public_id` ni `use_filename`; Cloudinary genera un identificador aleatorio. La carpeta (`service_integral`, `service_integral/logos`) es la misma para todas las empresas (`server.js` 1276 y 4417). El nombre original que sube el cliente **nunca** se usa.

**¿Puede una empresa pisar el archivo de otra?** Por la subida, en la práctica **no**: al no haber `public_id` fijo, el id aleatorio hace inviable una colisión. El problema real es el borrado: `POST /api/delete-image` (`server.js` 1291–1310) toma cualquier `imageUrl`, extrae el `public_id` y lo destruye **sin comprobar que la imagen pertenezca a la empresa del token**. Un ADMIN de la empresa A puede borrar la imagen de la empresa B con solo conocer su URL. Además la carpeta es común, así que cualquier depuración/limpieza por prefijo toca a todas.

**¿Se puede adivinar la URL de otra empresa?** El id aleatorio no se deriva del slug ni del id, así que **no se adivina por construcción**. Pero `logo_url` se expone en la ruta pública `config-comercio` (`server.js` 149) y las URLs de producto se guardan en texto plano en la base del tenant: si una URL se filtra, **cualquiera la ve** (CDN público) y **cualquier admin la puede borrar**. No hay namespace que separe una empresa de otra.

## 3. Estructura propuesta (solo subidas nuevas)

```
aexia/<slug>/archivos   -> fotos de producto (/api/upload de una empresa)
aexia/<slug>/logos      -> logo de esa empresa
```

- `<slug>` sale **siempre** de `req.empresa.slug` (la fila de la central resuelta por `verificarToken`), nunca de un parámetro del cliente.
- Los archivos viejos de Service Integral **no se mueven**: siguen en `service_integral/...`. Cloudinary sirve por URL completa, no por carpeta; por eso las `logo_url` e `imagen_*` ya guardadas **siguen funcionando** sin tocar la base. La carpeta es solo un espacio de nombres para lo nuevo.
- La carpeta la sigue eligiendo el **servidor**; el navegador no la manda (mantiene el diseño actual de `app.js`).

## 4. Qué cambia en cada archivo

### `backend/server.js` — `POST /api/upload` (1268–1289)
- `folder: ` `` `aexia/${req.empresa.slug}/archivos` `` (el slug sale del token).
- Guarda defensiva: normalizar el slug a `[a-z0-9-]` antes de armar la carpeta (por si un dato viejo trajera otro carácter). El navegador no elige la carpeta.

### `backend/server.js` — `POST /api/delete-image` (1291–1310)
- **Agregar control de dueño.** Recomendado: borrar solo si la URL está **referenciada por esta empresa** en su base (`SELECT 1 FROM productos WHERE imagen_1=? OR imagen_2=? OR imagen_3=?`). Así funciona igual para las URLs nuevas (`aexia/<slug>/…`) y para las legacy (`service_integral/…`) de la empresa que realmente las usa.
- Alternativa/complemento: además aceptar solo si el `public_id` empieza por `aexia/<slug>/` (namespace nuevo) o por la carpeta legacy de esa empresa.

### `backend/server.js` — `POST /api/admin/subir-logo` (4396–4442)
- `folder: 'aexia/<slug>/logos'`. **Caso especial de alta:** en el alta la fila todavía no existe y el slug final puede cambiar (`slugLibre` agrega `-2`). Ver decisión **D2**.
- Sigue devolviendo la URL sin persistir (el PATCH/POST valida y guarda). No se toca esa separación.

### `backend/tools/logos-cloudinary.js`
- `CARPETA` deja de ser `service_integral/logos`. Debe recorrer el prefijo `aexia/` (y seguir viendo lo legacy) para el inventario de huérfanas. Ver **D6**.

### `backend/tools/probar-subida-logo.js`
- La aserción de la línea 148 (`url.includes('service_integral/logos')`) debe pasar a la carpeta nueva. Ver **D6**.

### `frontend/app.js`, `frontend/admin.js`
- Sin cambios de carpeta (la decide el servidor). `admin.js` solo cambiaría si **D2** elige mandar el slug al subir el logo de un alta.

### Sin cambios
- `empresas.logo_url` y `productos.imagen_*`: mismas columnas, mismas URLs.
- Multer y sus límites (5 MB; jpeg/png/webp/gif), las transformaciones y la validación de `logo_url` en el PATCH.
- Los archivos legacy de Service Integral: no se mueven.

## 5. Casos límite

1. **Logo en el alta (empresa sin crear):** no hay `empresa.slug` en la base y el slug final puede llevar sufijo. Por eso la carpeta del logo no se puede derivar solo del token en ese momento (**D2**).
2. **Largo de URL:** `logo_url` es `VARCHAR(500)` (holgado), pero `productos.imagen_*` es `VARCHAR(255)`. Una URL con `aexia/<slug>/archivos/` y slug largo ronda 130–180 caracteres; conviene verificar que no roce 255 con cloud_name largo.
3. **Borrado de imágenes legacy:** un control de dueño solo por prefijo `aexia/<slug>/` no reconocería las URLs viejas. Validar por referencia en la base las cubre (**D3**).
4. **Huérfanas:** cambiar de carpeta deja sin inventariar las viejas y crea huérfanas nuevas; `logos-cloudinary.js` debe contemplar ambos prefijos (**D6**).
5. **Slug que no cambia:** `slug` es inmutable por diseño (`server.js` 3885), así que `aexia/<slug>/` es estable en el tiempo.
6. **Otros tipos de archivo:** hoy solo imágenes (multer filtra). La tarea dice "archivos", pero no hay subida de documentos; si se agrega, definir tipos y límites.
7. **Superadmin:** no puede usar `/api/upload` (rechazado a propósito en 308–310); sus logos van por `/api/admin/subir-logo`.
8. **Empresa suspendida:** `verificarToken` no la deja llegar; no sube ni borra.
9. **Nombre original del archivo:** no se usa para el `public_id`, así que no hay path traversal por nombre; la carpeta viene de un slug validado.

## 6. Qué decidís vos

- **D1 — Quién puede llamar a `/api/upload`:** hoy cualquier ADMIN de cualquier empresa, sin módulo (`server.js` 1268). ¿Se deja así o se restringe al módulo que corresponda (p. ej. `stock` para fotos de producto)?
- **D2 — Carpeta del logo en el alta:** (a) el navegador manda el slug y el servidor lo valida; (b) los logos van a una carpeta de plataforma `aexia/_plataforma/logos` (el logo es dato de la central que administra el superadmin); (c) crear la empresa primero y subir el logo después. — *Recomendado: (b) o validar el slug final; (a) a secas puede desalinearse del slug real.*
- **D3 — Cómo valida `delete-image`:** por referencia en la base (cubre legacy, **recomendado**), por prefijo de namespace nuevo, o ambos.
- **D4 — Prefijo raíz:** `aexia/` (recomendado) vs conservar `service_integral/` para no tocar herramientas.
- **D5 — Logos legacy:** confirmar que no se migran y que sus URLs quedan intactas (recomendado).
- **D6 — Herramientas:** actualizar `logos-cloudinary.js` y `probar-subida-logo.js` en el mismo cambio o en una tarea aparte.
- **D7 — Limpieza de huérfanas nuevas:** ¿se agrega una pasada de limpieza por namespace o se deja manual?

## 7. Verificación (al implementar, en dev con ≥2 empresas)

1. Subir una foto como empresa A → la URL contiene `aexia/<slugA>/archivos`; como B → `aexia/<slugB>/archivos`.
2. Subir el logo de A → `aexia/<slugA>/logos` (según D2).
3. Empresa B intenta `delete-image` con una URL de A → debe **rechazar** (404/403), no destruir.
4. Empresa A borra su propia imagen nueva → ok.
5. Una `imagen_*`/`logo_url` legacy de Service Integral sigue visible y borrable por su dueño.
6. `node tools/logos-cloudinary.js listar` no marca como huérfano el logo de una empresa real.
