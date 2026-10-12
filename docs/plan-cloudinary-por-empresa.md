# Plan: una cuenta Cloudinary por empresa

**Modo Plan — no se modifica código todavía.** Fecha: 2026-10-10.
Hoy hay **una sola** configuración de Cloudinary (`CLOUDINARY_*` del `.env`) y todas las empresas suben a la misma cuenta. Este plan permite cargar, desde el panel de SuperAdmin, **una cuenta Cloudinary por empresa**; las que no tengan usan la de plataforma.

**Estado (2026-10-11): paso 1 implementado.** Migración central `005_cloudinary_empresa.sql` (tabla `empresa_cloudinary`, `activo` arranca en 0), `backend/src/servicios/credenciales.js` (cifra/descifra AES-256-GCM + `cuentaDeEmpresa`) y `CREDENCIALES_KEY` documentada en `backend/.env.example`. Confirmado en dev: el SDK 2.10.0 acepta credenciales **por llamada** en `upload` y `destroy`. Faltan los pasos 2+ (rutas del panel, uso en subidas/borrado, frontend).

## 0. Decisiones ya tomadas
- **Cada empresa trae su propia cuenta**: el SuperAdmin carga `cloud_name` / `api_key` / `api_secret` desde el panel.
- **Empresas sin cuenta propia** → siguen usando la cuenta de plataforma (`CLOUDINARY_*`).
- **`api_secret` cifrado** con AES-256-GCM usando una clave de entorno.
- **Alcance: todo** (logos de empresa y fotos de producto).

## 1. Qué se leyó (grep y rangos)

| Archivo / zona | Qué se vio |
|---|---|
| `backend/server.js` 61–65 | `cloudinary.config({ cloud_name, api_key, api_secret })` con variables de entorno. **Config global del proceso**. |
| `backend/server.js` 1283–1309 | `POST /api/upload` (tenant): `folder = aexia/<slug>/archivos`, sube con la config global. |
| `backend/server.js` 1311–1348 | `POST /api/delete-image`: valida dueño por `productos`, extrae `public_id`, `destroy` con la config global. |
| `backend/server.js` 4432–4485 | `POST /api/admin/subir-logo` (SuperAdmin): `folder = aexia/<slug>/logos`, config global. |
| `backend/server.js` 3662–3712 | `verificarSuperAdmin`, `rutaAdmin`, `ipDe`. Patrón de las rutas del panel. |
| `backend/server.js` 3769–3816 | `GET /api/admin/empresas/:id`: `SELECT * FROM empresas` + usuarios/módulos/auditoría. Acá se sumaría la sección de medios. |
| `backend/server.js` 3828–3850 / 3861+ | Alta (`altas.crearEmpresa`) y PATCH de empresa. |
| `backend/src/servicios/registro.js` 48–66 | `empresaPorId()` hace `SELECT e.*` y **cachea ~30 s**. Motivo para no meter secretos en `empresas`. |
| `backend/migrations/central/` | Numeradas 001–004. Runner: `npm run migrate:central` (`src/db/migrations.js`). |
| `backend/src/servicios/altas.js` 298 | `auditar({ usuario, accion, empresaId, detalle, ip })`. |
| `backend/package.json` | `"cloudinary": "^2.10.0"`. No hay utilidades de cifrado en el repo. |
| `backend/tools/logos-cloudinary.js` | Inventario/limpieza de logos: hoy mira **solo la cuenta de plataforma**. |
| Documentación Cloudinary (context7) | La config del SDK es **global**; se pueden pasar credenciales **por llamada**. El borrado puede resolverse por `cloud_name` de la propia URL. Existen "product environments" (sub-cuentas) como alternativa. |

## 2. Diseño

### 2.1 Base central — migración aditiva `005_cloudinary_empresa.sql`
```sql
CREATE TABLE IF NOT EXISTS `empresa_cloudinary` (
  `empresa_id`         INT UNSIGNED NOT NULL,
  `cloud_name`         VARCHAR(80)  NOT NULL,
  `api_key`            VARCHAR(64)  NOT NULL,
  `api_secret_cifrado` TEXT         NOT NULL,  -- base64(iv | tag | ciphertext)
  `activo`             TINYINT(1)   NOT NULL DEFAULT 1,
  `configurado_en`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`empresa_id`),
  CONSTRAINT `fk_ec_empresa` FOREIGN KEY (`empresa_id`)
    REFERENCES `empresas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```
Tabla separada de `empresas` a propósito: `empresaPorId()` hace `SELECT e.*` y cachea la fila por request; los secretos no deben viajar en ese objeto (ni en logs, ni por accidente al frontend). Una fila por empresa; `ON DELETE CASCADE` limpia al dar de baja la empresa.

### 2.2 Cifrado — `backend/src/servicios/credenciales.js` (nuevo)
- `cifrar(texto)` / `descifrar(blob)` con **AES-256-GCM**: `iv` aleatorio de 12 bytes, `authTag` de 16; se guarda `base64(iv|tag|ciphertext)`.
- Clave: variable de entorno nueva (propuesta **`CREDENCIALES_KEY`**, 32 bytes en hex/base64; se agrega a `.env.example` con el comando para generarla). Si falta, **el arranque del servidor falla con un mensaje claro** (mejor que guardar algo que después no se puede leer).
- `cuentaDeEmpresa(empresaId)`: devuelve `{ cloud_name, api_key, api_secret, origen: 'empresa' | 'plataforma' }`. Si no hay fila o está inactiva → la de plataforma (env). **Sin caché** (las subidas son poco frecuentes; evita servir un secreto viejo).
- Nunca se loguea ni se devuelve el `api_secret`.

### 2.3 Uso del SDK de Cloudinary
La config del SDK es global del proceso, así que **no** se llama `cloudinary.config()` por request. Se pasan las credenciales **por llamada** (`cloud_name`, `api_key`, `api_secret` como opciones), que es lo que documenta el SDK. Si en la versión instalada (`^2.10.0`) alguna llamada no acepta credenciales por opción, se arma un cliente por cuenta con un factory y se cachea por `cloud_name`. Se valida con una prueba chica en dev antes de cerrar.

### 2.4 Subida
`/api/upload` y `/api/admin/subir-logo` resuelven `cuentaDeEmpresa(req.empresa.id)` y suben con esa cuenta. Las carpetas `aexia/<slug>/archivos|logos` se mantienen (siguen ordenando el CDN). El fallback a plataforma cubre a las empresas sin cuenta.

### 2.5 Borrado
La URL guardada ya trae la cuenta: `https://res.cloudinary.com/<cloud_name>/…`. Nuevo helper `cloudNameDeUrl(url)`:
1. Se valida que la URL esté referenciada en `productos` de la empresa (control de dueño que ya existe).
2. Se saca el `cloud_name` de la URL.
3. Si coincide con la cuenta propia de la empresa → esa; si coincide con la de plataforma → plataforma; si no coincide con ninguna configurada → 400.
Así se borran tanto los archivos nuevos (cuenta propia) como los **viejos** (cuenta de plataforma) sin migrar nada.

### 2.6 Panel de SuperAdmin
En el detalle de empresa (`pintarDetalle`, `frontend/admin.js`), sección **"Medios / Cloudinary"**:
- Estado: "Cuenta propia: `<cloud_name>`" o "Usa la cuenta de la plataforma".
- Campos `cloud_name`, `api_key`, `api_secret` (**solo escritura**; el secreto nunca se rellena ni se devuelve).
- Botón **Probar conexión** y botón **Guardar**; acción **Volver a la cuenta de plataforma** (borra la fila).

Rutas nuevas (todas `verificarSuperAdmin + rutaAdmin`, auditadas sin el secreto):
- `GET    /api/admin/empresas/:id/cloudinary` → `{ origen, cloud_name, api_key_enmascarada, activo }` (nunca el secreto).
- `PUT    /api/admin/empresas/:id/cloudinary` → valida y cifra; audita `superadmin.cloudinary.guardar`.
- `DELETE /api/admin/empresas/:id/cloudinary` → vuelve a plataforma; audita `superadmin.cloudinary.eliminar`.
- `POST   /api/admin/empresas/:id/cloudinary/probar` → `cloudinary.api.ping()` con esas credenciales; devuelve ok/error; audita `superadmin.cloudinary.probar`.

**Validación**: `cloud_name` `^[a-z0-9][a-z0-9_-]{0,79}$`; `api_key` solo dígitos; `api_secret` sin espacios y con largo mínimo. Trim y rechazo con mensaje claro. El `cloud_name` validado evita inyección de host en la URL de `api.cloudinary.com`.

## 3. Qué cambia en cada archivo

| Archivo | Cambio |
|---|---|
| `backend/migrations/central/005_cloudinary_empresa.sql` | **Nuevo**: tabla `empresa_cloudinary`. |
| `backend/src/servicios/credenciales.js` | **Nuevo**: cifrado/descifrado y `cuentaDeEmpresa()`. |
| `backend/server.js` | `/api/upload` y `/api/admin/subir-logo` usan `cuentaDeEmpresa`; `/api/delete-image` resuelve la cuenta por `cloudNameDeUrl`; 4 rutas nuevas del panel; chequeo de clave al arrancar. |
| `frontend/admin.js` | Sección "Medios / Cloudinary" en el detalle + cargar/guardar/probar/volver a plataforma. |
| `backend/.env.example` | Documenta `CREDENCIALES_KEY` (con comando para generarla). **No se toca el `.env`.** |
| `backend/tools/logos-cloudinary.js` | Pasa a recorrer **la cuenta de plataforma + cada cuenta personalizada** (o se acota explícitamente; ver D8). |
| `backend/tools/probar-subida-logo.js` | Sin cambios de fondo; opcional un caso que pruebe una cuenta propia. |
| `MEMORY.md` | Estado y decisiones. |

## 4. Casos límite
1. **Cuenta propia con credenciales inválidas**: la subida falla con error claro; **no** se cae a plataforma en silencio (evita mezclar cuentas y no se nota).
2. **Reemplazar la cuenta de una empresa**: los archivos viejos quedan en la cuenta anterior y siguen visibles por URL, pero **no se pueden borrar** desde la app (se perdió el secreto de esa cuenta). Ver D6.
3. **Clave de cifrado perdida**: los secretos guardados quedan ilegibles → hay que re-cargarlos. Documentar.
4. **Archivos legacy de Service Integral** (cuenta de plataforma): se siguen viendo y se pueden borrar (cloud_name coincide con plataforma).
5. **Empresa dada de baja**: `ON DELETE CASCADE` borra su fila; los archivos de su cuenta externa quedan allá (fuera de Aexia).
6. **Empresa sin cuenta**: usa plataforma, como hoy. Si el `.env` no tuviera credenciales, la subida debe devolver un error entendible.
7. **Backups de la central**: incluirán los secretos **cifrados**; la clave vive en `.env`, no en el backup.
8. **La empresa no administra su cuenta**: hoy no hay circuitos para que el ADMIN del tenant vea/cambie credenciales (D7).

## 5. Decisiones (resueltas el 2026-10-11)
- **D5 — Clave de cifrado:** `CREDENCIALES_KEY` (32 bytes en base64, `openssl rand -base64 32`).
- **D6 — Al reemplazar la cuenta:** sin historial; los archivos viejos quedan en la cuenta anterior y ya no se pueden borrar desde la app.
- **D7 — Visibilidad:** el ADMIN de la empresa solo ve si usa cuenta propia (sí/no); nunca credenciales.
- **D8 — `logos-cloudinary.js`:** queda solo para la cuenta de plataforma.
- **D9 — Validación:** una cuenta se activa (`activo = 1`) recién tras una prueba de conexión exitosa; hasta entonces se usa la de plataforma.

## 6. Verificación (al implementar, en dev con ≥2 empresas y ≥2 cuentas Cloudinary)
1. Migración: `npm run migrate:central` crea `empresa_cloudinary`; la app arranca (con `CREDENCIALES_KEY`).
2. Empresa A con cuenta propia sube una foto → cae en la cuenta A (`cloud_name` en la URL). Empresa B sin cuenta → cae en plataforma.
3. B no puede borrar una imagen de A (404); A borra la suya (se resuelve por la cuenta A).
4. Una imagen legacy de Service Integral todavía se ve y su dueño la puede borrar (cuenta de plataforma).
5. En la base, `api_secret_cifrado` **no** es texto legible; ninguna respuesta HTTP ni log contiene el secreto.
6. "Probar conexión" con credenciales falsas devuelve error y no guarda.
