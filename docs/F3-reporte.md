# F3 · Límite de usuarios y módulos contratados

**Estado:** implementado y verificado (22/22 en servidor, 4/4 en pantalla).

---

## 1. Qué es esta fase

Hasta ahora el sistema tenía **una sola empresa**: el taller. El plan comercial
que elegiste dice que el plan básico trae 3 usuarios por empresa y que pasar de
ahí cuesta más plata, y que cada empresa compra solo las partes del sistema
que necesita.

Las dos cosas estaban **escritas pero sin hacer nada**:

- El límite se calculaba (`COALESCE(empresas.max_usuarios, planes.max_usuarios)`)
  y se leía, pero **ninguna ruta lo miraba**. Se podía crear el usuario que
  quisiera.
- `empresa_modulos` recordaba qué contrató cada empresa, pero **no había forma
  de que las rutas** se enteraran. Apagar un módulo no apagaba nada.

F3 las hace valer. Y las hace valer **en el servidor**, que es el único lugar
donde valen: esconder un botón es una cortesía, no una regla.

---

## 2. Límite de usuarios

### Dónde se aplica

En `POST /api/usuarios`, antes de hashear la contraseña (un pedido rechazado no
cuesta nada de CPU):

```js
const limite = Number(req.empresa.limite_usuarios);
if (Number.isFinite(limite) && limite > 0) {
    const usados = await registro.contarUsuarios(req.empresa.id);
    if (usados >= limite) {
        return res.status(403).json({
            error: `Tu plan permite ${limite} usuarios. Para agregar más, contactanos para ampliarlo.`,
            codigo: 'LIMITE_USUARIOS',
            limite,
            usuarios_actuales: usados
        });
    }
}
```

`req.empresa.limite_usuarios` ya venía resuelto: primero la excepción de la
empresa, y si no, lo que dice el plan.

### Por qué 403 y no 402

El pedido se entiende y está autenticado; lo que falta es el derecho a tenerlo.
Un 402 (Payment Required) sería más literal pero casi ningún frontend lo maneja
como corresponde. El `codigo: 'LIMITE_USUARIOS'` existe para que el frontend
distinga "se te acabó el plan" de "no sos administrador", que también es 403.

### En la pantalla

`GET /api/usuarios` **no cambió de forma**: sigue devolviendo un array. Agregar
el límite ahí habría roto el código que ya está en el taller. El contador sale
de la lista (cuántos hay) más el límite (que vino en el login):

```
Usuarios: 3 de 3 incluidos en tu plan.
Llegaste al máximo de 3 usuarios de tu plan. Para agregar más, contactanos.
```

Con el plan completo, el formulario de alta aparece deshabilitado **y con el
motivo escrito en el `title` del botón**, para que no parezca un botón roto.

### La excepción, sin SQL

Había un problema de diseño: el modelo era "excepción por empresa" pero solo
existía la **lectura**. Cambiarla significaba escribir SQL a mano, y una fila
mal editada es un cliente al que no le entran usuarios y nadie sabe por qué.

```
npm run limites                                 ver la situación de todas
npm run limites -- service-integral 7           darle 7 usuarios a esa empresa
npm run limites -- service-integral plan        volver a lo que dice el plan
```

```
 slug                 empresa               plan     excepcion  vigente   usuarios
 ------------------------------------------------------------------------------
 service-integral     Service Integral      basico   -          3          3  <- lleno
```

La excepción se aplica en 30 segundos, sin reiniciar el servidor.

---

## 3. Módulos contratados

### El mapa

| Módulo | Rutas que cubre |
|---|---|
| `stock` | `/api/productos/*`, `/api/movimientos-stock` |
| `reparaciones` | `/api/reparaciones/*` |
| `clientes` | `/api/clientes/*` |
| `pedidos` | `/api/pedidos/*` |
| `etiquetas_qr`, `presupuestos`, `reportes`, `facturacion` | todavía sin rutas |

Quedan **sin módulo a propósito**, porque no son funcionalidad vendible sino
infraestructura: `/api/usuarios`, `/api/upload`, `/api/delete-image`.
Administrar usuarios no puede desaparecer nunca, aunque una empresa no tenga
módulos: si no, se queda sin poder cambiar contraseñas.

19 rutas de 29 llevan el módulo. El resto son login, config-comercio (público) y
usuarios.

### El portero

```js
function requiereModulo(codigo) {
    return async (req, res, next) => {
        const contratados = await registro.codigosDeModulos(req.empresa.id);
        if (!contratados.has(codigo)) {
            return res.status(404).json({ error: 'No encontrado' });
        }
        next();
    };
}
```

**404 y no 403, a propósito.** Un 403 confirmaría que la sección existe pero no
la podés usar, lo cual le dice al cliente que hay algo que no tiene. Un 404 no
dice nada. Es el mismo criterio que ya se usaba cuando un recurso es de otra
empresa.

### En el menú

Cada ítem de navegación declara su módulo con `data-modulo`, y
`aplicarModulosContratados()` saca del menú lo que no se contrató.

**Esto es cómodo, no seguridad.** Esconder un link no impide nada; el que
impide es el 404 del servidor. Está escrito así en el código para que nadie lo
tome por otra cosa.

Dos detalles que hacen que no se rompa nada:

- **Si no hay datos de empresa guardados** (sesión vieja, anterior a este
  cambio), **no se oculta nada**. Es preferible mostrar de más que dejar al
  usuario sin menú por un problema de caché.
- **Si la página actual es una sección oculta**, rebota al index. Quedarse
  mirando una pantalla que el servidor le va a contestar 404 es peor que la
  redirección. Tiene una guarda para no hacer un bucle si el index también
  estuviera oculto.

### `GET /api/mi-empresa`

El login entrega estos datos **una vez** y después quedan viejos: si le
ampliaron el plan o le agregaron un módulo, el frontend no se entera hasta que
alguien vuelva a iniciar sesión. Esta ruta devuelve lo mismo, consultable.

Es de solo lectura y expone el mismo objeto `empresa` que ya vive en memoria en
cada request, con tres campos más. No expone contraseñas de la base ni el
secreto de los tokens.

---

## 4. Verificación

```
npm run f3:verificar      → 22/22
```

### Lo que prueba

| Prueba | Resultado |
|---|---|
| `GET /api/mi-empresa` trae límite, módulos, slug y conteo | OK |
| Con la excepción en 5, el cuarto usuario **entra** | 201 |
| Ese usuario puede iniciar sesión | 200 |
| El login trae `empresa.modulos` y el límite efectivo | OK |
| Con `pedidos` apagado, `GET /api/pedidos` | **404 "No encontrado"** |
| Con `pedidos` apagado, productos y clientes | 200, siguen |
| Con `pedidos` apagado, gestionar usuarios | 200, no depende de un módulo |
| Vuelto al plan, el cuarto usuario | **403 `LIMITE_USUARIOS`** |
| El límite que manda es el del plan, no el de antes | OK |
| **Y no se creó ningún usuario** | OK |
| `/api/pedidos` volvió a 200 al reencenderlo | OK |

### Por qué la herramienta espera 32 segundos, dos veces

El servidor guarda la empresa y sus módulos en memoria ~30 s
(`registro.js`), para no consultar la central en cada request. Si la prueba
cambia la base y pregunta de inmediato, el servidor contesta con lo que tenía
cacheado y **la prueba miente**. Por eso espera a que expire la caché antes de
preguntar.

Se hacen los dos cambios juntos (subir el límite **y** apagar el módulo) y se
espera una sola vez, y después se restauran los dos y se espera otra. Dos
esperas en total.

### Deja el taller como estaba

Está todo en un `finally`, así que restaura aunque la prueba falle a mitad de
camino. Si se interrumpe a la mano:

```
npm run f3:restaurar
```

### La pantalla, vista de verdad

Con una sesión armada en el navegador simulando una empresa que no contrató
`pedidos`:

| | Resultado |
|---|---|
| Menú con los 4 módulos | los 4 visibles |
| Menú sin `pedidos` | **Pedidos desaparece**, los otros 3 siguen |
| Escribir `/pedidos.html` a mano | **rebota al index** |
| Con los 4 módulos, `/pedidos.html` | entra normal, no rebota |
| Taller en 3 de 3 | "Usuarios: 3 de 3 incluidos en tu plan." |
| | formulario deshabilitado, con el motivo en el botón |
| Consola del navegador | sin errores |

---

## 5. Un hallazgo que vale la pena

Al aplicar F3, **la verificación de F2 se rompió**: la empresa de prueba que esa
herramienta levanta nace sin módulos contratados, así que el portero nuevo le
contestaba 404 a todo.

Lo interesante no es el arreglo (contratarle los 4 módulos base, como tiene
cualquier empresa real) sino lo que **casi** pasa: dos de las comprobaciones de
aislamiento de F2 —"el taller NO ve el producto de la empresa de prueba" y "la
empresa de prueba NO ve NINGUN producto del taller"— habrían pasado porque la
empresa de prueba no veía NADA. No porque estuvieran separadas.

Siguen pasando, y ahora sí por el motivo correcto: la empresa de prueba tiene
los 4 módulos, lee 200, y ve su propio producto. Recién ahí "no ve el del
taller" significa algo.

```
npm run f2:verificar      → 20/20
```

**La lección para F4:** una prueba que pasa porque todo está apagado no prueba
nada. Conviene que cada aislamiento se compruebe en las dos direcciones **con
las dos partes funcionando**.

---

## 6. Lo que NO hace F3

- **Los 4 módulos no-base no tienen nada que apagar.** `etiquetas_qr`,
  `presupuestos`, `reportes` y `facturacion` son entradas de catálogo: existen
  en `modulos`, se pueden contratar, pero **no tienen rutas ni pantallas**. El
  mecanismo está listo; lo que falta son las funcionalidades.
- **No hay forma de dar de alta una empresa todavía.** Sigue haciéndose a mano
  con la herramienta de F2. El alta desde el panel del SuperAdmin es F5.
- **El precio de cada módulo.** `empresa_modulos.limites` existe y no se usa.
- **Los límites por módulo** (por ejemplo, "presupuestos: 50 por mes") están
  modelados en la columna pero sin aplicar. Hoy un módulo es sí o no.

---

## 7. Archivos

| Archivo | Qué cambió |
|---|---|
| `backend/server.js` | `requiereModulo()`, aplicado a 19 rutas · límite en `POST /api/usuarios` · `GET /api/mi-empresa` · login trae módulos y límite |
| `backend/src/servicios/registro.js` | `codigosDeModulos()` (devuelve un Set, lo chico posible para cada request) |
| `backend/tools/f3-verificar.js` | nuevo · 22 comprobaciones |
| `backend/tools/limite-usuarios.js` | nuevo · ver y cambiar excepciones |
| `backend/tools/f2-verificar.js` | la empresa de prueba ahora nace con los 4 módulos base |
| `backend/package.json` | `f3:verificar`, `f3:restaurar`, `limites` |
| `frontend/auth-check.js` | `tieneModulo()`, `aplicarModulosContratados()`, contador y bloqueo del alta |
| `frontend/login.html` | guarda la empresa en `localStorage` |
| `frontend/index.html`, `clientes.html`, `reparaciones.html`, `pedidos.html` | `data-modulo` en los 4 ítems del menú de cada página |
