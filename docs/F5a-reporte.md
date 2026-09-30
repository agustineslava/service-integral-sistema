# F5a · Marca blanca real

> La empresa #2 entra al sistema y ve en el header el nombre y el logo de la #1.
> Eso era lo que pasaba. Esta fase lo arregla.

---

## 1. El problema

La marca de cada empresa (nombre, subtítulo, logo, colores) y sus datos de
contacto (teléfono, email, dirección, CUIT) **ya estaban guardados** en la fila
de `empresas` de la base central, desde la fase F1. Lo que no existía era el
cable entre esa fila y la pantalla.

`/api/config-comercio` —la ruta que el navegador usa para pintar la marca—
leía variables de entorno del servidor:

```js
// antes
app.get('/api/config-comercio', (req, res) => {
    res.json({
        nombre: process.env.COMERCIO_NOMBRE || 'Sistema de Gestión',
        subtitulo: process.env.COMERCIO_SUBTITULO || 'Gestión de Stock y Taller',
        logo: process.env.COMERCIO_LOGO || 'logos/logo.jpg'
    });
});
```

Variables de entorno son **una sola cosa para todo el servidor**. Con una
empresa instalada no se nota. Con dos, la segunda ve el nombre y el logo de la
primera, y el sistema que dice ser de varias empresas en pantalla es de una.

Peor: los colores ni siquiera estaban. `--si-blue-vibrant` estaba escrito en
`style.css`, o sea que el azul era del tema, no de la empresa.

### Y un detalle que lo escondía

`/api/mi-empresa` **sí** devolvía `logo_url`, `color_primario` y
`color_secundario` desde la central, correctamente, desde F3. El dato viajaba.
Lo que no había era nadie que lo usara: el frontend escuchaba a
`/api/config-comercio`, que leía las variables. Estaba todo listo y desconectado.

### Tres listas distintas del mismo conjunto

Cada ruta armaba su propio objeto de marca, y se habían desincronizado:

| Endpoint | Mandaba | Le faltaba |
|---|---|---|
| `/api/config-comercio` | nombre, subtítulo, logo | **los dos colores**, y todo el contacto |
| `/api/login` | nombre, colores, logo | subtítulo, contacto |
| `/api/mi-empresa` | nombre, colores, logo | subtítulo, contacto |
| `.../comprobante` | nombre, subtítulo, colores, logo, **todo el contacto** | — |

El comprobante era el único completo, y por eso el presupuesto impreso era el
único que salía bien. El nombre del campo incluso difería: `logo` en uno,
`logo_url` en los otros, lo que obliga a traducir en el navegador.

---

## 2. Qué se hizo

### 2.1 Un solo lugar que define la marca

Se agregó `datosDeMarca(e)` en `server.js`, y las cuatro rutas pasan a usarlo.
Con eso el campo se llama igual everywhere y el nombre del campo es el de la
columna: no hay más que traducir `logo_url` a `logo`.

```js
function datosDeMarca(e) {
    if (!e) return null;
    return {
        nombre: e.nombre,
        subtitulo: e.subtitulo,
        logo_url: e.logo_url,
        color_primario: e.color_primario,
        color_secundario: e.color_secundario,
        telefono: e.telefono,
        email_contacto: e.email_contacto,
        direccion: e.direccion,
        cuit: e.cuit
    };
}
```

### 2.2 La ruta resuelve sola

`/api/config-comercio` es **pública a propósito**: la pantalla de login la tiene
que poder leer antes de que el usuario escriba su email. Entonces:

- **Si viene un token**, se responde con la fila de *esa* empresa en la central.
- **Si no viene token** (pantalla de login), se responde con las variables de
  entorno, que son la marca de la única empresa instalada.

Un token viejo, adulterado, vencido, o de una empresa que ya no existe **no es
un error**: cae al camino de las variables. Esta ruta nunca dice "no", porque si
fallara la página quedaría sin logo y sin saber por qué.

Que sea pública no filtra nada: los mismos datos (nombre, teléfono, dirección)
salen impresos en los comprobantes que el cliente se lleva.

Lo de las variables de entorno es **un puente, no la solución final**. Cuando
exista la búsqueda "a qué empresa pertenece este email" (F5b), la pantalla de
login va a preguntar por la empresa y no va a necesitar este camino.

### 2.3 El navegador aplica el color de verdad

`marca.js` ahora escribe los dos colores como variables de CSS sobre
`document.documentElement`, que es el `:root` de la página:

```js
if (esColorValido(conf.color_primario)) {
    document.documentElement.style.setProperty('--si-blue-vibrant', conf.color_primario.trim());
    document.documentElement.style.setProperty('--si-blue-dark', oscurecer(conf.color_primario.trim()));
}
if (esColorValido(conf.color_secundario)) {
    document.documentElement.style.setProperty('--si-blue-dark', conf.color_secundario.trim());
}
```

Como las 16 reglas que usan `--si-blue-vibrant` la leen de ahí
(`background-color: var(--si-blue-vibrant)`), **cambiar el color de la empresa
cambia botones, bordes, links y badges de toda la aplicación sin tocar una
regla de CSS**.

Dos detalles que se decidieron a propósito:

- **Si el color viene `null`, no se toca la variable.** La pantalla conserva la
  paleta de Service Integral en vez de quedarse sin acento. Una empresa que
  todavía no cargó su color se ve como el sistema por defecto, que es mejor que
  verse rota.
- **Si el color no es un color, se ignora.** `esColorValido()` acepta solo
  `#RGB` y `#RRGGBB`. Un `azul lindo` guardado en la base no puede dejar un
  botón sin fondo.

El hover se calcula con `oscurecer()`, que baja el color 18%. Se hace a mano y
no con `filter: brightness()` porque ese filtro también aclararía el texto
blanco de los botones, y un texto más claro de lo que debe es peor que un
botón sin hover. Si la empresa no cargó `color_secundario`, se usa el primario
oscurecido: si no, el botón queda del mismo color al pasar el mouse y el
usuario no ve que se puede apretar.

### 2.4 Herramienta para cargar los datos

`tools/datos-empresa.js`. Antes, poner el teléfono de un cliente era escribir
SQL a mano, y un `UPDATE` mal escrito es un cliente con el logo de otro.

```
node tools/datos-empresa.js                              ver todas
node tools/datos-empresa.js <slug>                       ver una
node tools/datos-empresa.js <slug> --sembrar             copiar el .env a la central
node tools/datos-empresa.js <slug> <campo> <valor>       cambiar un campo
```

Marca lo que falta y oculta lo que ya está cargado, para que se vea de un
vistazo qué falta:

```
 service-integral  (#1)
   nombre     Service Integral
    ok  Subtitulo          Gestión de Stock y Taller
    ok  Logo (ruta o URL)  logos/logo.jpg
    ok  Color primario     #009fe3
    ok  Color secundario   #0077b5
   ( ) Telefono           sin cargar
   ( ) Email de contacto  sin cargar
   ( ) Direccion          sin cargar
   ( ) CUIT               sin cargar
```

- Un color mal escrito se rechaza **por ser un color**, no por largo. Escribir
  "azul lindo" y que te responda "10 caracteres, la columna admite 7" es
  cierto y completamente inútil.
- `nombre` y `slug` no se cambian: son identificadores, y si se tocan el
  sistema deja de encontrar a la empresa.
- Un valor vacío se guarda como `NULL`, no como texto vacío: una celda vacía y
  un `NULL` no se comportan igual en los comprobantes.
- Un texto más largo que la columna se corta **en silencio** en MySQL, con un
  warning que nadie lee. La herramienta lo frena con un error claro.

### 2.5 Los colores del taller

Se sembraron con **exactamente los valores que `style.css` ya usaba**
(`#009fe3` y `#0077b5`). El aspecto no cambia ni un píxel; lo que cambia es
de dónde salen. A partir de ahora el azul del taller es un dato, no una regla
de CSS, y se cambia con `npm run datos-empresa service-integral color_primario "#1a4d8f"`.

---

## 3. Verificación

`npm run f5:verificar` — **88 pruebas, 9 secciones**.

Tres empresas de prueba, con marcas deliberadamente distintas:

| Slug | Estado | Marca |
|---|---|---|
| `f5-prueba-a` | ACTIVO | azul `#1a4d8f`, tel. 11-1111-1111 |
| `f5-prueba-b` | ACTIVO | rojo `#b3001b`, tel. 11-2222-2222 |
| `f5-prueba-susp` | SUSPENDIDO | gris, sin base de datos |

Cada empresa se usa en **un solo estado** desde que se la crea, así que la caché
de 30 s de `registro.js` nunca queda desactualizada y no hace falta dormir. La
empresa del taller no se toca: ni se le cambia un color ni se le carga un dato.

| # | Sección | Qué prueba |
|---|---|---|
| 1 | Sin sesión | Sale la marca de entorno, y **no filtra ningún dato** de las tres empresas |
| 2 | Con sesión | Con el token de cada una, salen sus 8 campos de marca |
| 3 | Aislamiento | 4 cruces: el token de A no puede devolver nada de B ni de S, y al revés |
| 4 | Tokens rotos | Texto sin sentido, firma adulterada, empresa inexistente, SUPERADMIN, vencido → 200 y marca de entorno, nunca 500 |
| 5 | Campo por campo | `config-comercio`, `mi-empresa` y el comprobante devuelven **el mismo conjunto con los mismos valores** |
| 6 | Login | El login real de un usuario de cada empresa devuelve la marca de *esa* empresa |
| 7 | Suspendida | Ve su propia marca (200) pero no puede iniciar sesión (403) ni usar la API con un token viejo (403) |
| 8 | El navegador | `esColorValido` acepta `#RRGGBB` y `#RGB`, rechaza todo lo demás; `oscurecer` oscurece, no aclara, y no se pasa de negro |
| 9 | El taller | Sigue activo, su API responde, con el nombre de siempre |

Se borran empresas, usuarios y bases en un `finally`. Si el proceso se mata a
la mitad, al arrancar limpia lo que quedó: busca los slugs con el prefijo de
prueba, que no son empresas de nadie.

### 3.1 Las pruebas tienen dientes: se rompió el código a propósito

De F3 quedó una lección: **un check que pasa porque todo está apagado no prueba
nada**. Un verificador que nunca falló es un verificador que no se sabe si
mira algo. Así que se rompió el código dos veces a propósito.

**Mutación 1 — la ruta ignora el token y devuelve siempre la empresa #1:**

```
RESULTADO: 21 fallo(s) de 88 pruebas.
  [FALLO] Empresa A: sale su nombre (Taller Azul SA)
  [FALLO] Empresa A: sale su color_primario (#1a4d8f)
  ... (21 en total)
```

**Mutación 2 — la ruta se corre una empresa de lugar (`empresa_id + 1`), que
produce un cruce A↔B real:**

```
RESULTADO: 23 fallo(s) de 88 pruebas.
  [FALLO] Con el token de A no sale ningun dato de B (Casa Verde SRL)
          -> ["nombre","subtitulo","logo_url","color_primario","color_secundario",
              "telefono","email_contacto","direccion","cuit"]
  [FALLO] Con el token de B no sale ningun dato de S (Empresa Suspendida SA)
```

El detector de cruce nombra los 9 campos filtrados. Con el código restaurado:
**88/88**.

> La primera vez que se hizo esta prueba dio **88/88 con la mutación puesta**.
> La mutación nunca se había escrito: el comando de PowerShell falló en
> silencio. Un verde falso por un comando que no corrió, no por un código
> que anduviera bien. Por eso el paso de romper el código a propósito no es
> opcional: es la única forma de saber que el "todo bien" dice algo.

### 3.2 En el navegador

Con la sesión abierta, en `presupuestos.html`:

```
inline_primario:  #009fe3      <- lo que escribió marca.js desde la base
inline_hover:     #0077b5
header:           rgb(0, 159, 227)
titulo_pestana:   Service Integral - Presupuestos
```

El header y los títulos (`Listado de presupuestos`, `Nuevo presupuesto`,
`Ítems`, `Total`) salen con el color de la base. En `login.html`, **sin
sesión**, el estilo inline queda vacío: no se toca la variable y la pantalla
conserva la paleta por defecto, que es lo correcto.

Para probar que el color **no está escrito en ningún lado del CSS**, se
interceptó el `fetch` de la marca en el navegador y se le pasó el de una
empresa inventada. Sin tocar la base:

```
inline_primario:  #b3001b
inline_hover:     #7a0011
titulo_pestana:   Casa Verde SRL - Presupuestos
elementos_rojos:  header
```

Cambia el header, el título de la pestaña y el hover. Después se recargó y
volvió todo a `Service Integral`.

Las 6 páginas reales cargan sin errores de consola y sin scroll horizontal:
`index`, `reparaciones`, `clientes`, `pedidos`, `presupuestos`, `login`.
(`productos.html` no existe: el stock vive dentro de `index.html`.)

---

## 4. Lo que sigue

### 4.1 Los datos del taller están a medio cargar

```
    ok  Color primario     #009fe3
    ok  Color secundario   #0077b5
   ( ) Telefono           sin cargar
   ( ) Email de contacto  sin cargar
   ( ) Direccion          sin cargar
   ( ) CUIT               sin cargar
```

**El presupuesto impreso sale sin teléfono, sin dirección y sin CUIT.** El
presupuesto ya trae los campos y el comprobante ya los manda; lo que falta son
los valores. Se cargan con cuatro comandos, y hay que pedirlos al usuario:

```
npm run datos-empresa service-integral telefono "+54 11 ..."
npm run datos-empresa service-integral email_contacto "..."
npm run datos-empresa service-integral direccion "..."
npm run datos-empresa service-integral cuit "30-..."
```

### 4.2 La pantalla de login todavía es genérica

Mientras no exista la búsqueda por email (F5b), el que no tiene sesión ve la
marca de las variables de entorno. En la instalación actual de un solo cliente
eso es correcto. Con dos empresas, **las dos pantallas de login son iguales**:
es el último punto donde se ve que el sistema es de una sola empresa.

La ruta ya está preparada: cuando el login sepa a qué empresa pertenece el
email, va a preguntar y no va a necesitar el camino de entorno.

### 4.3 Other pre-existing issues

- `cors()` sin lista de orígenes permitidos.
- `helmet` con la CSP desactivada.
- `verificarToken` no es global: cada ruta tiene que acordarse de ponerlo.
- `npm run token <email>` firma con el `JWT_SECRET` del `.env`, así que quien
  tenga el `.env` puede entrar como quien quiera. Es el camino de recuperación
  de un bloqueo, pero también es una puerta.

---

## 5. Archivos

| Archivo | Qué cambió |
|---|---|
| `backend/server.js` | `datosDeMarca()` y `marcaDeEntorno()`; `config-comercio` resuelve por token; login, `mi-empresa` y el comprobante pasan a usar el helper |
| `frontend/marca.js` | Reescrito: aplica color y hover como variables de CSS, valida el color, y manda el token |
| `backend/tools/datos-empresa.js` | Nuevo. Ver y cambiar los datos de marca y contacto |
| `backend/tools/f5-verificar.js` | Nuevo. 88 pruebas en 9 secciones |
| `backend/package.json` | `f5:verificar`, `datos-empresa` |

Estado: `f2:verificar` 24/24 · `f3:verificar` 22/22 · `f4:verificar` 111/111 ·
**`f5:verificar` 88/88**.
