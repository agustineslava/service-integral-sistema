# F7 · Reportes

**Estado:** cerrado y verificado (257/257 en vivo, 164/164 estático, 52/52 mutaciones detectadas).
**Fecha:** 4 de octubre de 2026.
**Rama:** `multitenant`.

---

## 1. Qué es esta fase

Hasta F6 el sistema guardaba datos: facturas, presupuestos, órdenes de
reparación, clientes, repuestos. Y los guardaba bien, con sus controles de
sesión, de módulo y de aislamiento entre empresas.

Pero **guardar no es lo mismo que poder leer**. El dueño del taller tenía los
datos y no tenía las preguntas. Para saber cuánto vendió en octubre, cuántas
facturas quedaron sin pagar o qué repuesto se vende más, tenía que abrir la
pantalla de facturas, filtrar a mano, sumar con la calculadora y anotar el
resultado en un cuaderno.

Eso no escala, y además es la forma más fácil de tomar una decisión mala: un
número que alguien copió a mano de una pantalla con un filtro puesto es un
número del que nadie se acuerda cómo se saca.

F7 pone seis reportes, con filtro de fechas y salida a planilla.

---

## 2. Los seis reportes

Los eligió el usuario, no el equipo. Los que un taller de reparación con
repuestos consulta todas las semanas:

| Código | Qué contesta |
|---|---|
| `ventas-por-mes` | Cuánto se facturó cada mes, neto, IVA y total |
| `facturacion-por-cliente` | Qué cliente facturó más |
| `cuentas-por-cobrar` | Qué facturas están emitidas y todavía sin pagar, y cuántos días llevan |
| `repuestos-mas-vendidos` | Qué repuesto sale más, por unidades y por plata |
| `ordenes-de-reparacion` | Cuántas órdenes entraron, por estado y por técnico |
| `presupuestos-y-conversion` | Cuántos presupuestos salieron, cuántos aceptaron y qué porcentaje de conversión hay |

---

## 3. La decisión que gobierna todo: el servicio **no sabe** de bases de datos

`backend/src/servicios/reportes.js` no hace `require('mysql2')`, no importa el
módulo de conexiones, no menciona `tenant` y no tiene el nombre de ninguna base
escrito. Recibe el `db` por parámetro y no tiene forma de pedir otro.

Eso no es purismo. Es **la garantía de que el reporte de la empresa 2 no puede
leer datos de la empresa 1**, y la garantía no está en una revisión de código
sino en que el archivo no tiene con qué hacerlo.

La tentación real va a ser la contraria: pegar un
`obtenerPool('serviceintegralsistema')` para no estar pasando el pool por
parámetro. Funciona con una empresa, y con dos cruza todo. Es el error más caro
que se puede escribir en este archivo y el más fácil de escribir sin darse
cuenta, así que el verificador lo prohíbe por nombre.

### Por qué el módulo se llama `reportes` y no `informes`

Por el catálogo de módulos: `reportes` es una fila de `si_central.modulos`, y de
ahí sale lo que cada empresa contrata. La empresa 1 ya lo tenía contratado.

---

## 4. El filtro de fechas: tres decisiones, y las tres importan

### 4.1 Las fechas viajan como parámetro, nunca pegadas al texto

`filtroFechas` arma el `WHERE` con `?` y manda los valores en el array de
parámetros. Un `?desde=2026-01-01' OR '1'='1` no cambia la consulta: es un
parámetro con esa forma.

### 4.2 El techo es **exclusivo**: `< hasta + 1 día`, nunca `<= hasta`

Las columnas por las que filtran los seis reportes no son todas del mismo tipo:

- `facturas.fecha` es `DATE`
- `reparaciones.fecha_ingreso` es `TIMESTAMP`
- `presupuestos.creado_en` es `DATETIME`

Con `<= hasta`, un `DATE` incluye el día entero y un `DATETIME` incluye solo la
medianoche de ese día. El mismo filtro daría dos resultados distintos según la
tabla, y nadie sabría cuál de los dos es el que se pidió. Por eso el techo es
`diaSiguiente(hasta)`: el período incluye el día `hasta` entero, siempre.

### 4.3 `leerRango` no hace `String()` antes de validar

Esta es la que costó un error real:

```js
// la versión que estaba
const bruto = (valor) => (valor === undefined || valor === null ? null : String(valor).trim());
```

Con ese `String()`, el chequeo de tipo de `fechaReal` queda **muerto**: recibe
siempre un string, así que nunca puede dispararse. Peor: un query como
`?desde[]=2026-10-01` llega como **array**, y `String(['2026-10-01'])` vale
`'2026-10-01'`, que pasa la validación de fecha sin haber sido una fecha.

No hay inyección —el rango va como parámetro— pero un endpoint que acepta
`?desde[]=x` y lo trata como `desde=x` es un endpoint que acepta tipos que no
dice aceptar. Y mañana alguien le saca el `String` por performance y de golpe hay
un problema de verdad.

Ahora acepta un string o nada, y cualquier otra cosa es un 400 que dice qué se
esperaba.

`fechaReal` no es una regex: `2026-02-31` tiene la forma correcta y no existe.
Se arma la fecha en UTC y se compara año, mes y día contra los que se pidieron.

---

## 5. Una sola fuente para los nombres de las columnas

El servidor declara, por columna:

```js
col('total', 'Total', 'pesos')
```

Y de ahí salen **las dos cosas**: el encabezado de la tabla y el del CSV. El
frontend no tiene una lista de columnas escrita, y el backend no tiene una
para el CSV aparte de la del reporte.

Por qué importa tanto: si el nombre de una columna estuviera escrito dos veces,
el día que alguien corrija un título —"órdenes" por "ódenes", que es el cambio
más chico del mundo— los dos se desfasarían y no habría forma de saber cuál
está bien. Lo que se ve en pantalla y lo que abre Excel tienen que ser el mismo
reporte, no dos que se parecen.

El `tipo` de cada columna (`texto` `entero` `decimal` `pesos` `porcentaje`
`fecha` `mes` `dias`) es lo que decide el formato, y es **declarado, no
adivinado**. Eso también costó un error real: la primera versión de `normalizar`
convertía cualquier string que pareciera un número, y el teléfono
`01112345678` volvía como `1112345678`. Los ceros del principio —que en
Argentina son parte del número— desaparecían de la pantalla y del CSV, y no
daba ningún error.

El verificador compara el conjunto de tipos del backend con el del frontend como
**conjunto**, y además exige que la lista de tipos que se alinean a la derecha
sea la misma en los dos lados.

---

## 6. El CSV se genera en el servidor

Decisión del usuario, y por buenas razones:

1. **Un solo formateo.** Armarlo en el navegador significa formatear los
   números dos veces: una para pintar la tabla y otra para el archivo. Con el
   servidor, el archivo sale de los mismos valores que la pantalla.
2. **El BOM.** El archivo tiene que abrirse en Excel en una máquina que no es
   esta. Excel en Windows abre un CSV sin BOM como ANSI, y "San José" aparece
   como "San JosÃ©". Con BOM no pasa. Agregarlo desde el navegador sería agregar
   un byte invisible con la codificación del archivo, que es una cuenta fácil de
   hacer mal.
3. **Los números crudos.** Si el archivo tuviera `$ 5.000,00`, la columna sería
   texto y `SUM` daría cero. Un saldo negativo que empiece con `-` **no** lleva
   el apóstrofo anti-fórmula: es un número y tiene que seguir sumando.

El antivirus de fórmulas va **solo sobre los textos** que arrancan con `=`, `+`,
`-`, `@`, tab o retorno, y el resto del archivo sigue la RFC 4180: comillas
duplicadas, y entrecomillado también para el punto y coma —con la configuración
regional de algunos países Excel separa columnas con `;`.

`?formato` con cualquier otra cosa devuelve **400 con la lista de formatos
válidos**. Un `?formato=xlsx` que devolviera el JSON en silencio le haría perder la
tarde al operador.

---

## 7. Un hallazgo que salió del verificador, no de la pantalla

El reporte de presupuestos declaraba una columna **"Participación"** y el SQL no
la traía. La pantalla mostraba un guion en una columna que el dueño leía todas
las semanas.

Compilaba. Los controles de rutas, de aislamiento y de SQL daba verde. El número
de celdas por fila daba bien. **Solo se enteraba alguien ejecutando el reporte.**

Por eso el verificador tiene una parte viva (`--vivo`) y por eso ahora hay un
control estático que compara las claves declaradas contra el resto del bloque del
reporte, con el arreglo `columnas` tapado: lo que tiene que aparecer es el
`AS mes` del SQL o el `participacion:` del `ajustar`, no la propia declaración.

La participación se calcula en JavaScript y no con funciones de ventana de MySQL
8, porque esa base corre en la versión que instale el taller.

---

## 8. El verificador y sus dientes

`backend/tools/ver-reportes.js` tiene dos modos:

- **estático** (el que se corre siempre): 164 comprobaciones. No necesita base,
  ni credenciales, ni servidor.
- **--vivo**: 93 comprobaciones más, ejecutando el servicio contra la base de la
  empresa 1. Es lo único que puede comprobar que el total de repuestos cuadre
  con el de las facturas, que un teléfono conserve los ceros, o que `leerRango`
  rechace un array.

`backend/tools/mutar-reportes.js` rompe el código a propósito, 52 veces, una por
control, y exige que el fallo que aparezca sea el del control roto. **52/52
detectadas.**

Las mutaciones de la parte viva llevan la marca `vivo: true` y se corren con
`--vivo`: hay controles que no se pueden probar leyendo archivos, y son
justamente los que importan — un teléfono que pierde los ceros se ve bien en el
código y en la pantalla.

### Controles que costaron encontrar el agujero

Cinco controles resultaron no tener dientes y hubo que reforzarlos:

| Control | Por qué no tenía dientes |
|---|---|
| `leerRango` sin `String()` | Buscaba `String(query.desde)` literal; el bug volvió como `String(valor)`. Ahora prohíbe cualquier `String()` en el normalizador. |
| `case` con `break` | El `case` seguía estando, así que el control de "el tipo tiene formateador" daba verde. Ahora se exige que el `case` **devuelva** algo. |
| `fechaR` sin `new Date` | Buscaba `new Date(String(iso))`. Ahora prohíbe `new Date` entero en la función. |
| `columnaDeFecha` que tira | Buscaba la palabra `throw`, y la mutación `if (!columna) return null; if (true) throw` la dejaba ahí. Ahora prohíbe el `return` previo. |
| Claves repetidas por reporte | Comparaba los tipos repetidos, que es normal entre seis reportes. Ahora aísla el bloque de cada uno y compara las **claves**. |

---

## 9. La migración 007

Los reportes filtran por `reparaciones.fecha_ingreso` y esa tabla no tenía
índice. Con seis órdenes de reparación no se nota; con la historia, cada pedido
recorre la tabla entera.

`backend/migrations/tenant/007_indices_reportes.sql` agrega dos índices:
`idx_repar_fecha_ingreso` e `idx_repar_estado`.

Dos cosas de esa migración que no son obvias:

1. **Es reaplicable.** MySQL no tiene `ADD INDEX IF NOT EXISTS` (MariaDB sí), así
   que va con SQL dinámico: se mira `information_schema.STATISTICS` y el `ALTER`
   se ejecuta solo si el índice no está. La comparación es contra `INDEX_NAME`, no
   contra la lista de columnas: el nombre es lo único que el motor garantiza
   único dentro de la tabla.
2. **Usa `DATABASE()`**, no el nombre de una base. La migración se corre contra
   la base del tenant que se está dando de alta, y ese nombre cambia de empresa
   en empresa.

Y no toca `schema/base.sql`, que es la congelación del esquema de antes de la
001 (regla 6 de `LEEME.txt`).

El índice de `estado` **no lo usa el reporte de hoy**: la cantidad por estado se
calcula en JavaScript sobre las filas que ya trajo la consulta. Va igual por dos
razones: es por donde va a filtrar el día que haya un reporte de "órdenes
atrasadas", y es el mismo criterio con el que la 006 indexó `facturas`. Agregar
un `ALTER` ahora cuesta segundos; dentro de seis meses, con la tabla grande y en
horario de trabajo, cuesta minutos de bloqueo.

---

## 10. La pantalla

`frontend/reportes.html`, `.css` y `.js`.

- El selector de reportes **se arma con el catálogo** que devuelve
  `/api/reportes`, no con una lista escrita en el HTML.
- Los encabezados los arma el JS desde `columnas`, cada `<th>` y cada `<td>` con
  `data-col` — lo que permite comparar celda con celda y ver que una fila no se
  corrió una columna.
- El CSV se pide con `apiFetch`, que manda el token. Un `<a download>` pelado
  descargaría un 401.
- El nombre del archivo sale del `Content-Disposition` del servidor y no se
  recompone en el navegador.
- Un token de petición descarta las respuestas fuera de orden: al cambiar de
  fechas rápido salen dos pedidos, y la que llega última no es necesariamente la
  última que se pidió.

`reportes.css` tiene cuatro reglas y ninguna más. Lo demás sale de `style.css`:
una segunda copia de las reglas de tema es la forma corta de que una se quede
vieja, y ya pasó una vez con `--text-secondary` en vez de `--text-muted` — el
texto salía negro sobre el fondo oscuro en una página y no en la otra.

El menú de las ocho pantallas tiene la entrada con `data-modulo="reportes"`.

---

## 11. Verificación hecha

| Qué | Resultado |
|---|---|
| `node tools/ver-reportes.js` | 164/0 |
| `node tools/ver-reportes.js --vivo` | 257/0 |
| `node tools/mutar-reportes.js` | 52/52 detectadas |
| `node --check` en los 4 archivos JS | sin salida, 0 |
| HTTP en vivo, las dos rutas sin token | 401 en las dos |
| HTTP en vivo, los seis reportes | 200, con las filas esperadas |
| CSV en vivo | `text/csv; charset=utf-8`, BOM `EF BB BF`, encabezado igual al de la tabla |
| 9 casos de error | 404 y 400 como corresponde |

Casos de error verificados sobre HTTP: código inventado, `'` en el código,
intento de recorrido de ruta, `2026-02-31`, rango al revés, `formato=xlsx`,
`desde[]` como array, inyección en el rango, y sin fechas.

---

## 12. Lo que queda para F8

- **Escáner QR**, solo para el personal y con login. Sin ruta pública.
- `JsBarcode` y `jsQR` vendorizados desde el CDN, no cargados de afuera.
- **El dominio ya está:** `aexia.com.ar`. Entra acá con el SSL y con el
  `logo_url` de la empresa, que hoy es `NULL` para la empresa 1.