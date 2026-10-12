# Plan — Configuración por empresa (v1)

**Estado:** propuesta. No tocar código hasta aprobar las decisiones D1–D12.
**Skills leídas:** `empresa-config` (la pedida como `.agents/skills/...` en realidad está en
`.opencode/skills/empresa-config/SKILL.md`) y `db-migrations`.
**Fecha:** 2026-10-10.

## 1. Alcance de la v1

- **Reparaciones:** ocultar/renombrar campos (`tipo_cobertura`, `equipo`, `direccion`,
  teléfono, notas, trabajo realizado, etc.) y marcar cada uno obligatorio u opcional.
- **Mensajes de WhatsApp:** plantilla del mensaje al técnico (reparaciones) y del pedido
  de repuestos (pedidos).
- **Categorías de stock:** lista propia por empresa.
- **Fuera de alcance:** estados de la orden (hoy `enum` en la base y whitelist en el
  validador; personalizarlos exige migración de tipo, se hace después).

## 2. Estado actual verificado (dónde está hoy cada cosa)

### 2.1 Campos de reparaciones
- Tabla `reparaciones` en `backend/schema/base.sql` (líneas 150–175):
  - **NOT NULL:** `cliente_nombre` (153), `equipo` (157), `falla_declarada` (158).
  - `tipo_cobertura` es `enum('Fuera de Garantia','En Garantia') NULL DEFAULT 'Fuera de Garantia'` (156).
  - Nullable: `cliente_telefono` (154), `direccion` (155), `diagnostico_tecnico` (159),
    `notas_servicio` (160), `tecnico_asignado` (168), costos y total (163–165).
- `validarReparacion(body)` en `backend/server.js` (520–561):
  - Obligatorios: `cliente_nombre` (525), `equipo` (526), `falla_declarada` (527).
  - `estado` contra whitelist `ESTADOS_VALIDOS` (529–530).
  - `costo_mano_obra` / `costo_repuestos` numéricos ≥ 0 si vienen (532–539).
  - `tipo_cobertura` forzado a `'En Garantia'` o `'Fuera de Garantia'` (549).
  - Normaliza (capitaliza) y recorta largos; `cliente_telefono` a 50 (547), `tecnico_asignado` a 100 (558).
- Uso de los datos: `POST /api/reparaciones` (1975) y `PUT /api/reparaciones/:id` (2013),
  ambos con `verificarToken + requiereModulo('reparaciones') + requiereAdmin`. También
  `PUT /:id/estado` (2077) y `DELETE` (2127). `resolverOCrearCliente(cliente_nombre, telefono, direccion)` (1990, 2052).
  `descontarStockPorReparacion(id, equipo, tecnico_asignado, repuestos_detalle)` (2048) usa `equipo` como motivo del movimiento de stock.
- Frontend:
  - Alta (`frontend/reparaciones.html`): `rep-cliente` (58), `rep-telefono` (62),
    `rep-direccion` (66), `rep-cobertura` (73), `rep-equipo` (80), `rep-falla` (84),
    `rep-notas` (91), `rep-diagnostico` (105), repuestos y costos.
  - Edición (mismo archivo, 218–284): `edit-rep-*` equivalentes.
  - Tabla: encabezado "Equipo y Garantía" (176); render de equipo + garantía (261–263).
  - `eliminarReparacion` usa equipo en el confirm (636); `reparaciones.js` arma el objeto (522–523, 572–573).

### 2.2 Otras pantallas que muestran esos campos
- **Ficha del cliente** (`frontend/clientes.js`, 142): muestra `r.equipo` (no muestra cobertura).
- **Reporte "Órdenes de reparación"** (`backend/src/servicios/reportes.js`, 327–357):
  columna `equipo` (334) y `COALESCE(NULLIF(TRIM(r.equipo),''))` en el SQL (346).
- **Presupuestos, facturas y sus impresiones:** **NO** usan `equipo` ni `tipo_cobertura`.
  Grep sobre `frontend/*.js` y las rutas de `/api/presupuestos`, `/api/facturas`,
  `/comprobante` no los referencia: los ítems salen de `productos`/stock, no de reparaciones.
- `reportes.js` no usa `categoria` (grep sin coincidencias), así que las categorías no
  aparecen en reportes hoy.

### 2.3 Mensajes de WhatsApp (hoy hardcodeados)
- **Técnico** (`frontend/reparaciones.js`, `enviarWhatsAppTecnico`, 611–630): arma el texto
  a mano (emoji, `ORDEN DE TALLER`, cliente, teléfono, dirección, equipo+cobertura, falla,
  notas, trabajo, repuestos, estado, total) y abre `https://api.whatsapp.com/send?text=`.
- **Pedidos** (`frontend/pedidos.js`, 256–281): `🛠️ *PEDIDO DE REPUESTOS - SERVICE INTEGRAL*`
  (262) + ítems (265–267) + notas; copia al portapapeles. "SERVICE INTEGRAL" está fijo.
  `frontend/pedidos.html` (6) también tiene el título fijo.

### 2.4 Categorías de stock (hoy hardcodeadas)
- `frontend/index.html`: alta `#categoria` (123–129), edición `#edit-categoria` (410–416),
  filtro `#select-filtro-categoria` (241–248); las tres con la misma lista fija
  (Lavarropas, Heladeras, Lavavajillas, Secarropas, Otros).
- Servidor (`backend/server.js`, 466): `categoria` es **texto libre** recortado a 50,
  default `'Otros'` (479). No hay tabla de categorías.
- `frontend/app.js`: filtro por `categoria` (43–46), carga del valor en edición (295, 339),
  alta (381) y export CSV (581).

### 2.5 Base central (dónde iría la config)
- `modulos` (`backend/migrations/central/001_esquema_central.sql`, 118–125): `codigo,
  nombre, descripcion, es_base, orden`. **No existe `config_default`.**
- `empresa_modulos` (153–172): `activo, limites JSON, fecha_desde, fecha_hasta`. **No existe `config`.**
- `src/servicios/registro.js`: `modulosDe(empresaId)` (191) ya trae `em.limites`; caché de
  30 s (`TTL_MS`) e `invalidarEmpresa(id)` (234). `empresaPorId` (48) resuelve la marca/plan.
- Patrón de endpoint a imitar: `/api/config-comercio` (server.js 175–219) + `frontend/marca.js`.
- Panel superadmin: detalle `GET /api/admin/empresas/:id` (3769, devuelve `modulos` con
  `activo`), toggle `PATCH /api/admin/empresas/:id/modulos/:codigo` (4025), catálogo
  `GET /api/admin/catalogos` (4284); UI en `frontend/admin.js` (sección módulos 786–800,
  `alternarModulo` 1002).
- `data-campo` ya se usa en `admin.js`, `presupuestos.js` y `facturacion.js`; **no** en
  reparaciones ni en index. `/api/config-empresa` no existe.

## 3. Propuesta técnica

### 3.1 Migración central 006 (aditiva, con guardas como la 003)
1. `ALTER TABLE modulos ADD COLUMN config_default JSON NULL` (si no existe).
2. `ALTER TABLE empresa_modulos ADD COLUMN config JSON NULL` (si no existe).
3. `UPDATE modulos SET config_default = ? WHERE codigo = ?` con los defaults de
   `reparaciones`, `stock` y `pedidos` **solo si hoy está NULL** (no pisar lo que ya se
   haya configurado). Service Integral conserva exactamente lo actual como default.
4. Se aplica a `si_central`; no toca bases de empresa ni `base.sql`.

Forma (tomada de la skill):
```json
{
  "reparaciones": {
    "campos": {
      "cliente_nombre": { "visible": true, "obligatorio": true },
      "equipo":         { "visible": true, "obligatorio": true, "etiqueta": "Equipo y Modelo" },
      "falla_declarada":{ "visible": true, "obligatorio": true },
      "tipo_cobertura": { "visible": true, "obligatorio": false, "etiqueta": "Cobertura" },
      "direccion":      { "visible": true, "obligatorio": false }
    },
    "whatsapp_tecnico": "🛠️ *ORDEN #{{id}}* - {{empresa}}\n👤 {{cliente}}\n⚠️ {{falla}}"
  },
  "stock":   { "categorias": ["Lavarropas", "Heladeras", "Lavavajillas", "Secarropas", "Otros"] },
  "pedidos": { "whatsapp": "🛠️ *PEDIDO DE REPUESTOS* - {{empresa}}\n{{items}}" }
}
```

### 3.2 Resolver de configuración (servidor)
- Nuevo módulo `backend/src/servicios/config-empresa.js` (o función en `registro.js`, a decidir):
  `configDe(empresaId)` lee `modulos.config_default` + `empresa_modulos.config` y **mezcla**
  (deep merge por clave; los arrays/`categorias` y las plantillas **reemplazan**, no se concatenan).
- Solo módulos `activo = 1`. Si un módulo está inactivo, su config no se aplica pero **no se borra**.
- Caché con el mismo patrón de `registro.js` (~30 s), invalidada al guardar la config desde el panel
  (`invalidarEmpresa`).
- `configDe` nunca recibe empresa del cliente: siempre `empresa_id` del token.

### 3.3 Endpoint `GET /api/config-empresa`
- `verificarToken` (cada empresa la suya). Con token de SUPERADMIN (sin `empresa_id`) responde
  `{}` / 403 (a decidir, D9), nunca la config de otra empresa.
- Devuelve la config ya mezclada, acotada a los módulos contratados.
- Invalida al `PATCH` del panel.

### 3.4 Frontend (`data-campo`)
- Nuevo script chico `frontend/config-empresa.js` (o se extiende `marca.js`) que pide
  `/api/config-empresa` y aplica: oculta el `<div class="campo">` contenedor, reescribe el
  `<label>`, y pone/quita `required` según `obligatorio`.
- Marcar los campos de `reparaciones.html` (alta y edición) y los `<select>` de categoría de
  `index.html` con `data-campo="<columna>"`, reutilizando el patrón ya existente.
- Categorías: el script repuebla las `<option>` de alta, edición y filtro desde la config.
- WhatsApp: usa la plantilla de la config y reemplaza una **lista blanca** de variables.

### 3.5 Validación en el servidor (el frontend no es la única defensa)
- `validarReparacion` recibe la config de la empresa:
  - Campo oculto → se guarda valor neutro/`''` (ver D2 para edición). `equipo` es NOT NULL:
    se guarda `''`, nunca `NULL`.
  - Campo visible y `obligatorio` → rechaza si falta (reemplaza el check fijo de 526).
  - `cliente_nombre` y `falla_declarada` no se pueden ocultar ni hacer opcionales (NOT NULL +
    sentido de negocio); el panel los muestra bloqueados.
  - `tipo_cobertura` oculto → se fuerza `'Fuera de Garantia'` (como hoy).
- Al guardar la config desde el panel: solo claves permitidas, largos máximos (plantilla p. ej.
  2000, categoría 50, código de variable de la lista), JSON válido. Una plantilla mal escrita
  no puede romper la pantalla.

### 3.6 Editor en el panel de superadmin
- Nueva sección "Configuración por módulo" en el detalle de empresa (`admin.js`, junto a 786–800).
- `GET /api/admin/empresas/:id/config` (config + defaults para "restaurar") y
  `PATCH /api/admin/empresas/:id/config` (guarda solo lo que difiere del default; borrar = NULL).
- Interruptores de visibilidad/obligatoriedad, caja de etiqueta, editor de lista de categorías,
  caja de plantilla con vista previa y variables disponibles, botón "restaurar defaults".
- Auditoría: reusar el patrón de `auditoria` del panel.

## 4. Pasos pequeños (cada uno probado con dos empresas A y B con config distinta)

1. **Migración central 006** (aditiva + seed de defaults). Probar: `npm run migrate:simular`,
   `npm run migrate:central`, `npm run migrate:estado`; A y B siguen operando sin cambios.
2. **Resolver `configDe(empresaId)`** con mezcla y caché. Probar con script: A = defaults,
   B con override; arrays reemplazan; módulo inactivo no aplica.
3. **Endpoint `GET /api/config-empresa`** + invalidación en el panel. Probar A≠B y superadmin sin empresa.
4. **Aplicador frontend `config-empresa.js`** + `data-campo` en `reparaciones.html` (alta y edición).
   Probar: B ve `equipo` renombrado o `tipo_cobertura` oculto; A no.
5. **Validación servidor** de obligatoriedad/ocultos/defaults en `validarReparacion` y en POST/PUT.
   Probar B: campo obligatorio rechaza; campo oculto no rompe y guarda neutro. A igual que hoy.
6. **Categorías dinámicas** en `index.html` (alta/edición/filtro) desde la config. Probar A/B con
   listas distintas y un producto viejo cuya categoría fue quitada (debe seguir visible/editable).
7. **Plantillas WhatsApp** técnico (`reparaciones.js`) y pedidos (`pedidos.js`), con escaping y
   `encodeURIComponent`. Probar A/B; variable inexistente no rompe; sin `SERVICE INTEGRAL` fijo.
8. **Editor superadmin** (`GET`/`PATCH` config, restaurar defaults, validación, vista previa).
   Probar: editar B no cambia A; restaurar vuelve a los defaults de Service Integral.
9. **Otras pantallas:** decidir y aplicar (o documentar) ficha de cliente (142) y reporte
   `ordenes-de-reparacion` (equipo 334/346). Confirmar que presupuestos/facturas/impresiones no
   requieren cambios.
10. **Verificación global multi-tenant** con los verificadores (`f3:verificar`, `ver:base`,
    `esquema:test`) y una empresa nueva: llega con defaults.

## 5. Casos límite

- Categoría quitada: los productos viejos **conservan** su categoría; el `<select>` de edición
  debe incluirla para no cambiarla sin querer. El servidor sigue aceptando texto libre (50).
- Campo oculto + NOT NULL: `equipo` → `''` (no `NULL`); `cliente_nombre`/`falla_declarada` no ocultables.
- `tipo_cobertura` oculto: el servidor fuerza `'Fuera de Garantia'` (el `enum` no admite vacío lógico).
- Oculta `equipo` y `descontarStockPorReparacion` usa `''` como motivo del movimiento: revisar que el
  movimiento siga siendo legible (o usar `'Orden #<id>'` como fallback).
- `required` de HTML hay que quitarlo/ponerlo dinámicamente; nunca confiar solo en él.
- Plantilla con variable desconocida, llaves sin cerrar o emojis: no debe romper ni permitir HTML.
- Caché de 30 s: un cambio de config puede tardar hasta 30 s; `invalidarEmpresa` en el PATCH.
- Módulo desactivado: la config no se aplica pero no se pierde.
- Empresa nueva: sin fila en `empresa_modulos.config` → solo defaults.
- Migración re-ejecutable (guardas `information_schema` como 003); no editar migraciones ya aplicadas.
- Renombrar solo la etiqueta visible: no cambia el nombre de columna ni el `value`.

## 6. Decisiones que tenés que tomar

- **D1 — Campos ocultables:** ¿`equipo` puede ocultarse y quedar opcional? (la skill lo permite,
  guardando `''`). Propongo: sí, pero avisando del efecto en el movimiento de stock.
- **D2 — Edición con campo oculto:** al editar una orden vieja que ya tenía `equipo`, ¿se preserva
  el valor o se borra a `''`? Propongo **preservar** (borrar solo si el usuario vacía estando visible).
- **D3 — `tipo_cobertura`:** v1 solo visibilidad/etiqueta del campo; **no** renombrar sus dos valores
  (exigiría migrar el `enum`). ¿Confirmás?
- **D4 — Dónde vive el resolver:** `registro.js` (reusa caché/invalidación) o archivo nuevo
  `config-empresa.js`. Propongo archivo nuevo con su caché, invalidado por `invalidarEmpresa`.
- **D5 — Mezcla:** ¿array `categorias` y plantillas **reemplazan** (no se concatenan)? Propongo sí.
- **D6 — Módulos inactivos:** ¿config guardada pero no aplicada? Propongo sí.
- **D7 — Categorías vs texto libre:** ¿el servidor valida que la categoría esté en la lista o sigue
  aceptando texto libre? Propongo aceptar texto libre (para no romper productos viejos).
- **D8 — Plantillas WhatsApp:** ¿el frontend sustituye leyendo la config, y el servidor solo valida al
  guardar? Propongo sí (como hoy, sin endpoint nuevo de mensajería).
- **D9 — Quién edita:** ¿solo SuperAdmin en el panel central, o también el ADMIN de la empresa?
  Propongo solo SuperAdmin en v1.
- **D10 — Superadmin en `/api/config-empresa`:** ¿`{}` o 403? Propongo `{}` (nunca romper la pantalla).
- **D11 — Reportes:** ¿la columna `equipo` del reporte se oculta/renombra con la config, o queda
  tal cual? Propongo dejarla tal cual en v1 (reporte interno) y anotarlo.
- **D12 — Límites:** máximos de plantilla (2000), categorías (50) y largo de etiqueta/categoría (50).
  ¿Te parecen?

## 7. Archivos que se tocarían

- `backend/migrations/central/006_config_empresa.sql` (nuevo; la 005 ya es `005_cloudinary_empresa.sql`).
- `backend/src/servicios/config-empresa.js` (nuevo) y/o `backend/src/servicios/registro.js`.
- `backend/server.js` (`validarReparacion`, POST/PUT reparaciones, `GET /api/config-empresa`,
  `GET`/`PATCH /api/admin/empresas/:id/config`).
- `frontend/reparaciones.html`, `frontend/reparaciones.js` (data-campo, WhatsApp).
- `frontend/index.html`, `frontend/app.js` (categorías dinámicas).
- `frontend/pedidos.js` (plantilla WhatsApp pedidos).
- `frontend/config-empresa.js` (nuevo) y su `<script>` en las páginas.
- `frontend/admin.js`, `frontend/admin.html`/CSS (editor).
- Opcional según D11: `backend/src/servicios/reportes.js`, `frontend/clientes.js`.

## 8. Recordatorios

- Config en la **central**, nunca datos de negocio; la empresa siempre sale del token.
- Migración aditiva; requiere tu aprobación (AGENTS.md).
- `equipo` y `falla_declarada` son NOT NULL: ocultar no es omitir.
- Probar siempre con dos empresas (A y B) y con la empresa nueva.
