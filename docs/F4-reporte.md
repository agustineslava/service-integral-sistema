# F4 · Presupuestos, y el arreglo de una regresión que venía de F2

**Estado:** implementado y verificado (111/111 en servidor, 3/3 en pantalla).

---

## 1. Qué es esta fase

Hasta ahora el sistema sabía guardar stock, clientes, reparaciones y pedidos.
Le faltaba **el documento que hace que un taller cobre**: el presupuesto.

Es también la primera pantalla donde se ve el **blanco-labeling**, porque el
presupuesto es lo único que el cliente se lleva impreso. Si el logo, el
teléfono y los colores no están bien, se ve en la calle.

F4a (cerrada aparte, commit `2407e59`) había sacado la tabla `usuarios` de las
bases de las empresas. F4b, que es lo que está en este informe, agrega:

- 3 tablas nuevas (`presupuestos`, `presupuesto_items`, `secuencias`)
- 7 rutas de API
- 1 pantalla completa
- una herramienta de verificación

---

## 2. Lo que se decidió antes de escribir una línea

Estas decisiones no son detalles: son lo que hace que un presupuesto impreso
siga siendo verdad dentro de dos años.

### El cliente y el producto se copian, no se referencian

`presupuestos` tiene `cliente_id`, y `presupuesto_items` tiene `producto_id`.
Son links, sí. **Pero el nombre del cliente, su documento, su teléfono, la
descripción de cada ítem y su precio están copiados dentro del documento.**

Why: si mañana se corrige el nombre de un cliente, o se cambia el precio de un
producto, el presupuesto que el cliente ya aceptó tiene que seguir diciendo lo
que decía el día que se lo firmaste. Un presupuesto es un contrato, no una
consulta a la base. Si guardás solo el `id`, estás guardando una promesa de que
nunca vas a cambiar un dato, y los datos se cambian.

### El total lo calcula el servidor, siempre

El navegador manda los ítems y el descuento. **El subtotal, el total y el
subtotal de cada ítem los arma el servidor, siempre.** Si el navegador manda un
total, se ignora.

Why: el total es lo que se paga. Si lo calculara el cliente, cualquier cosa que
corrupa el JavaScript — una extensión, un error de tipeo, alguien con DevTools
abierto — cambia lo que se debe. El descuento sí viene del cliente, porque es
una decisión comercial, pero se valida que no supere el subtotal.

### El número no se recycling

`presupuestos.numero` sale de la tabla `secuencias` con un
`INSERT ... ON DUPLICATE KEY UPDATE ultimo = ultimo + 1`, no de `id + 1`.

Why: si el número saliera del `id`, borrar el presupuesto 34 y crear otro
volvería a dar 34. Y el taller ya le enseñó el 34 a un cliente. La tabla
`secuencias` queda con un número más cada vez, para siempre. La herramienta de
verificación lo comprueba: borra uno y exige que el siguiente sea **mayor**, no
el mismo.

### Los estados

`BORRADOR → ENVIADO → APROBADO | RECHAZADO`, y de cualquiera de los tres
cerrados se vuelve a `BORRADOR`.

Un documento `APROBADO` o `RECHAZADO` **no se puede editar ni borrar**: el
servidor devuelve 400. Si hay que corregirlo, se vuelve a borrador
explícitamente, y queda registrado quién lo hizo.

### Quién puede qué

Esto es **distinto** del stock, a propósito:

| | leer | crear | editar | aprobar/rechazar | borrar |
|---|---|---|---|---|---|
| ADMIN | sí | sí | sí | sí | sí (solo borrador) |
| TECNICO | sí | sí | sí | **no** | **no** |

Why: presupuestar es el trabajo del técnico — es quien habla con el cliente y
sabe qué se puede hacer y por cuánto. Pero **aprobar es una decisión del
dueño**: es el que autoriza el precio. Y borrar un presupuesto ya aprobado
borra la evidencia de un acuerdo. En el stock el criterio es al revés
(`requiereAdmin` para escribir), y está bien que sea al revés: una
reparación que entra la escribe un técnico; un precio que se autoriza, no.

---

## 3. Las tablas

`backend/migrations/tenant/004_presupuestos.sql`

```
secuencias        (nombre PK, ultimo)
presupuestos      (id, numero UNIQUE, cliente_id, cliente_nombre, cliente_doc,
                   cliente_telefono, cliente_email, cliente_direccion, notas,
                   valido_hasta, estado, subtotal, descuento, total,
                   creado_en, actualizado_en)
presupuesto_items (id, presupuesto_id, producto_id, descripcion, cantidad,
                   precio_unitario, subtotal, orden)
```

### Un detalle que costó encontrar: los `INT` son con signo

Las 6 tablas que ya existían usan `int` **con signo**, no `int unsigned`. Las
claves foráneas de las 3 tablas nuevas tampoco son `INT UNSIGNED`.

Why: MySQL **rechaza** una clave foránea entre columnas de tipos distintos, y
aunque los números "quepan", a MySQL no le interesa: `INT` y `INT UNSIGNED` son
tipos diferentes. La migración hubiera fallado al aplicarse.

Por eso `004_presupuestos.sql` dice, en un comentario, que **todas** las
columnas enteras nuevas van con signo, y por qué. Está anotado porque el
siguiente que escriba una migración va a querer usar `UNSIGNED` — es lo natural
— y se va a llevar un error que no dice nada sobre su causa real.

### Cómo entra el módulo en una empresa nueva

`presupuestos` es un módulo no-base: está en el catálogo, pero solo funciona si
la empresa lo contrató. Las 7 rutas lo piden explícitamente:

```js
app.get('/api/presupuestos', verificarToken, requiereModulo('presupuestos'), ...)
```

Con el módulo apagado devuelven **404 "No encontrado"**, no 403. Lo mismo que
en F3: no se le confirma a nadie que el recurso existe.

---

## 4. La pantalla

`frontend/presupuestos.html` (200 líneas), `.css` (470), `.js` (697).

Tres cosas que no son obvias y que quedaron documentadas en el código:

### El `<datalist>` vive AFUERA de la tabla

Cada ítem es texto libre con sugerencia del catálogo, usando `<input list=...>`.
Un `<datalist>` por fila **es HTML inválido**: el navegador lo acomoda entre
los `<tr>` y la tabla se renderiza con filas fantasma. Está documentado en el
HTML con el motivo, porque la próxima persona va a querer "arreglarlo" poniendo
el `<datalist>` adentro de la celda, que es exactamente el error que ya se hizo
una vez.

Hay **un solo** `<datalist id="lista-productos">` para toda la pantalla.

### El catálogo se dibuja aparte de los ítems

`dibujarCatalogo()` está separado de `dibujarItems()` a propósito. El catálogo
viene de un `fetch`, o sea que llega **después** de que el formulario ya se
dibujó. Si el datalist se armara solo dentro de `dibujarItems()`, la lista de
sugerencias quedaría vacía para siempre — sin error, sin aviso, sin que nada
fallen. Y eso es exactamente lo que pasó: `/api/productos` devolvía 200 con 2
productos y el datalist tenía 0 opciones.

### El comprobante se arma con la respuesta del servidor

`GET /api/presupuestos/:id/comprobante` devuelve el presupuesto, sus ítems y
los datos de marca de la empresa (logo, contacto, colores) en una sola
respuesta. La hoja de impresión se construye **desde esa respuesta**, no desde
el estado del navegador.

Why: si la hoja se armara con lo que hay en memoria, cambiar el logo o el
teléfono no se vería en las copias nuevas hasta que alguien recargara. Y
peor: si el presupuesto se abrió en una pestaña vieja, imprimiría datos viejos.

---

## 5. Un arreglo que no era de esta fase

### El tema claro estaba en tres archivos y faltaba en uno

`cambiarTemaManualmente()` estaba **copiado** en `app.js`, `pedidos.js` y
`reparaciones.js`. En `clientes.js` no estaba. El botón de tema en la página de
Clientes tiraba `ReferenceError` al apretarlo: estaba muerto.

Se movió a `frontend/auth-check.js`, que **todas** las páginas cargan. Con eso,
un solo lugar decide cómo se cambia el tema, y no puede quedar una página
fuera por olvidado.

### El menú se rompió al sumar el quinto ítem

`style.css` tenía el corte de responsive en `768px`. Con cuatro ítems de menú
el header entraba en una sola línea hasta bastante menos que eso. Al sumar
**Presupuestos**, la fila pasó a necesitar ~950px, y entre 768 y 950 el `<ul>`
del menú (que es `nowrap`) se salía de la pantalla: la página entera pasaba a
tener scroll horizontal, de 147px.

Se subió el corte a `950px`. En un monitor del taller (1366 o más) no cambia
nada; entre 768 y 950 ahora el header se apila, que es lo que ya hacía en
móvil.

Se midió en 1440, 1280, 1024, 950, 900, 768 y 480: **desborde horizontal 0 en
las siete**.

---

## 6. Los tres bugs que encontraron las pruebas

### 6.1 Los modales nunca se veían (grave, y las pruebas no lo detectaron)

`style.css` tiene `.modal { display: none }`, y las páginas viejas lo abren
escribiendo `style.display = 'block'` a mano desde el JavaScript. La pantalla
nueva usaba `classList.add('activo')`, que **no estaba en ningún CSS**.

Consecuencia: los modales no se mostraban nunca. El contenido estaba en el DOM,
así que cualquier prueba automática que lo leyera pasaba — `textContent` funciona
sobre elementos ocultos, y ponerles valor con `.value = ...` también. Las
pruebas salieron "verde" con un formulario invisible para un humano.

Se agregó una regla a `presupuestos.css`:

```css
.modal.activo { display: block; }
```

**La lección:** que una prueba pase no dice que la cosa funcione. Una prueba que
solo mira el DOM no ve si el usuario la ve. Por eso el caso se probó también
con clics y tipeo reales, y con `getComputedStyle(...).display`.

### 6.2 El total se calculaba en el navegador

Encontrado antes de escribir la herramienta, al calcular a mano: si el
descuento venía vacío, `Number(undefined)` es `NaN`, el chequeo de "mayor o
igual a 0" lo rechazaba, y **ningún presupuesto se podía crear sin
descuento**. Ahora un `descuento` ausente, vacío o `null` vale 0.

### 6.3 Una fecha imposible daba 500 en vez de 400

Este lo encontró `f4:verificar`. La validación era:

```js
if (!/^\d{4}-\d{2}-\d{2}$/.test(valido_hasta) || Number.isNaN(Date.parse(valido_hasta)))
```

El regex alcanza para el formato, pero **`Date.parse('2026-02-31')` no es
`NaN`**: JavaScript lo pasa al 3 de marzo sin avisar. MySQL después lo rechaza,
el `INSERT` reventaba, y el `POST` terminaba en un **500 sin mensaje útil**
cuando lo correcto era un 400 diciéndole al usuario qué escribir.

Ahora hay un `fechaReal()` que arma la fecha en UTC y compara los tres
componentes: si no coinciden, la fecha no existía. Se usan `setUTCFullYear` en
vez de `Date.UTC` porque `Date.UTC` interpreta los años de dos dígitos como
`19xx`, y `0099` tiene que seguir siendo el año 99.

---

## 7. La regresión de F2 que sigue dando guerra

Ya se había arreglado en el commit `23d8c70` y está contada en el informe de
F2, pero conviene tenerla presente porque **va a volver a aparecer** en cada
módulo nuevo:

F2 reemplazó el pool global de `mysql2/promise` por un proxy de empresa. El
proxy exponía solo `query` y `execute`. Pero las rutas existentes usan el pool
de **tres** maneras distintas:

- `db.query(sql, params, cb)` — sí estaba
- `db.getConnection(cb)` — **no estaba** (`POST /api/pedidos`)
- `await db.promise().query(...)` — **no estaba** (todas las escrituras de
  reparaciones)

Las dos últimas dejaron de existir. Desde F2 hasta el arreglo, **el taller no
podía crear pedidos ni órdenes de trabajo**: 500 en ambas pantallas.

Las 20 comprobaciones de F2 no lo detectaron porque casi todas eran `GET` y la
única escritura era un `DELETE` de usuario, contra la base central, no la de
la empresa.

Por eso `src/db/tenant.js` es ahora un reemplazo fiel de `mysql2/promise`
(`promise()`, `getConnection()`, `enPromesa`, `consultar`, `transaccion`) y
por eso `f2-verificar` tiene una sección "3 bis" que **crea, edita y borra
filas de verdad**. La regla que quedó escrita: **toda ruta que escribe contra
la base de una empresa tiene que probarse escribiendo.**

Dos detalles de `mysql2` que también costaron tiempo:

- Siempre resuelve como `[resultado, campos]`. En un `SELECT` eso es
  `[filas, campos]`, pero en un `INSERT` el primer elemento es un `OkPacket`
  que no es iterable: `const [r] = await ...` tira *"not iterable"*. Por eso
  `enPromesa` envuelve en un array.
- `POST /api/pedidos` lee `item.id`, no `item.producto_id`. Mandar la clave
  equivocada guarda una fila con `producto_id` en NULL y **no da ningún error**.

---

## 8. Cómo se verifica

```bash
npm run f4:verificar
```

**111 comprobaciones, 11 secciones.** La herramienta crea sus propias empresas
de prueba y las borra al final, pase lo que pase.

| # | Qué prueba |
|---|---|
| 1 | Las 4 tablas existen y la migración 004 quedó en el ledger |
| 2 | El total lo recalcula el servidor aunque le manden otro |
| 3 | 16 validaciones que tienen que dar 400, + 2 fechas que sí tienen que entrar |
| 4 | Editar, aprobar, que cerrado no se pueda tocar, volver a borrador, borrar |
| 5 | El TECNICO presupuesta pero no aprueba ni borra |
| 6 | El correlativo corre y **no** se vuelve a usar, incluso con 10 a la vez |
| 7 | Los filtros del listado y el comprobante de impresión |
| 8 | Sin token → 401, empresa inexistente → 403 |
| 9 | **Aislamiento: dos empresas con el módulo, cada una con lo suyo** |
| 10 | **Con el módulo apagado, las 7 rutas dan 404** y las demás siguen andando |
| 11 | La pantalla existe y está enganchada al menú en las 5 páginas |

### Las dos secciones que importan más

**La 9 — aislamiento.** Se crea una segunda empresa de verdad, con su propia
base, y se le contrata el módulo. Después:

- la empresa de prueba crea **su** presupuesto → y ve **exactamente 1**, el suyo
- el taller sigue viendo **los suyos** (16 en esa corrida)
- el taller **no** ve el de la otra
- abrir, borrar y aprobar un presupuesto del taller **desde la otra empresa**
  → **404, y no 403**
- y el presupuesto del taller sigue ahí, sin cambios, en `BORRADOR`
- la otra empresa arranca su correlativa en **1**, que es un número que el taller
  nunca emitió

Los dos lados tienen que funcionar. Esto viene de F3: una comprobación que pasa
porque todo está apagado no prueba nada. Si la empresa de prueba saliera vacía
y el taller también, "nadie ve nada" parecería un éxito.

**La 10 — el módulo apagado.** Se crea una *tercera* empresa sin el módulo, y se
comprueban las 7 rutas una por una: las 7 dan 404 con `"No encontrado"`. Y
después, en la misma empresa, `/api/productos`, `/api/usuarios` y
`/api/mi-empresa` **siguen respondiendo 200**: apagar un módulo no rompe la
empresa. Y `/api/mi-empresa` no devuelve `presupuestos`, así que el frontend ni
muestra el menú.

### Por qué no hay que esperar 30 segundos

El servidor cachea los módulos de la empresa 30 segundos. F3 apagaba y prendía
el módulo de la **misma** empresa y por eso tenía que dormir dos veces, 64
segundos en total.

Acá no: se usan **dos empresas de prueba distintas**, y cada una se toca en un
solo estado la primera vez. Como la caché se llena recién con ese estado,
nunca queda desactualizada. Además **la empresa del taller no se toca para
nada**: ni se le apaga un módulo, ni se le deja un presupuesto de prueba que
después haya que borrar a mano.

### Las otras suites

| Suite | Resultado |
|---|---|
| `npm run f2:verificar` | 24/24 |
| `npm run f3:verificar` | 22/22 |
| `npm run f4:verificar` | 111/111 |

### La pantalla, probada como la usa un humano

No alcanza con que las rutas anden. En un navegador de verdad:

- abrir el modal con **clic**, escribir con **teclado**, guardar con **clic**
  (no llamando las funciones por dentro)
- el catálogo autocompleta precio y producto
- el total se recalcula en vivo: `8500 + 1,5 × 5000 = 16000`, menos 500 = **15500**
- aprobar con clic + `confirm` → desaparece "Editar", "Eliminar" y "Marcar
  enviado", aparece "Volver a borrador"
- volver a borrador → eliminar, con su `confirm`
- sin scroll horizontal de 1440 a 480 px

Al terminar, la base del taller quedó como estaba: **0 presupuestos**.

---

## 9. Lo que falta

- **Los datos de contacto del taller están en NULL.** `telefono`, `email_contacto`,
  `direccion`, `cuit`, `color_primario` y `color_secundario` están vacíos, así
  que el presupuesto impreso sale **sin teléfono, sin dirección y sin colores**.
  Falta una herramienta (`tools/datos-empresa.js`) y los valores reales. El
  comprobante ya los pide y ya los muestra: solo hay que cargarlos.
- **El catálogo por rubro** (F7). Hoy el `<datalist>` es el mismo para todas las
  empresas: el de cada una.
- **La búsqueda de empresa por email en el login**, para que al escribir el mail
  se sepa a qué cliente pertenece. Sigue pendiente, es el paso de UX del
  lanzamiento.
- **`/api/config-comercio` sigue saliendo de variables de entorno** y no de la
  fila de `empresas`. Habría que moverlo, pero con cuidado: hoy es lo único que
  muestra el logo en las pantallas viejas.

---

## 10. Cómo se aplica en el taller

Los archivos nuevos son frontend (se copian tal cual) y una migración de base.
Para el taller:

1. Reemplazar los archivos de `frontend/` — `presupuestos.html`, `presupuestos.css`,
   `presupuestos.js` y los 4 HTML que cambiaron (el menú). **Copia encima**, no
   borrar la carpeta.
2. `npm run backup`
3. Aplicar la migración: `npm run migrate` (o lo que corresponda en el paquete
   de actualización), que corre `004_presupuestos.sql`.
4. `npm run check-grants` — las 3 tablas nuevas necesitan permiso para
   `service_integral_app`.
5. `npm run f4:verificar` contra la base del taller.
6. Reiniciar con el `.bat`.

Si el módulo `presupuestos` no está contratado para la empresa del taller, el
menú no aparece y las rutas dan 404. Para activarlo:

```bash
npm run modulos service-integral presupuestos on
```

---

## 11. Archivos de esta fase

**Nuevos**

- `backend/migrations/tenant/004_presupuestos.sql`
- `backend/tools/f4-verificar.js`
- `frontend/presupuestos.html`
- `frontend/presupuestos.css`
- `frontend/presupuestos.js`

**Modificados**

- `backend/server.js` — §13: las 7 rutas, `prepararPresupuesto()`,
  `siguienteNumero()`, `fechaReal()`
- `backend/package.json` — `f4:verificar`
- `frontend/style.css` — el corte de responsive, de 768px a 950px
- `frontend/auth-check.js` — `cambiarTemaManualmente()` viene acá
- `frontend/app.js`, `pedidos.js`, `reparaciones.js` — se fue la copia del tema
- `frontend/index.html`, `reparaciones.html`, `clientes.html`, `pedidos.html` —
  el ítem de menú con `data-modulo="presupuestos"`

**Sin tocar a propósito**

- `backend/src/db/tenant.js` — el núcleo del aislamiento. No se abre sin
  necesidad.
- `backend/schema/schema-actual.sql` — es la base sin migraciones. Las 3 tablas
  nuevas van en la migración, como tiene que ser: una empresa nueva recibe la
  base y después las migraciones, en orden.
