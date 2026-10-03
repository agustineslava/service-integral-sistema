/* ==========================================================================
   VERIFICADOR: estilos de los campos, tema claro/oscuro y tabla de items
   --------------------------------------------------------------------------
   Por que existe: los cinco reclamos de una tanda.Container

   1. Telefono y "Direccion del logo" con otro estilo que el resto.
   2. Telefonos y documento en negro en el listado de Presupuestos.
   3. El boton "Ver" del listado sin fondo.
   4. El recuadro de "Descripcion item" desfasado.
   5. Los `<input type="date">` blancos.
   6. El tema que no se carga bien al pasar de pestana en pestana.

   Y los cinco JA se habian arreglado a mano, tres veces, con el mismo
   mecanismo: una lista que se queda corta. La de `input[type="..."]`
   (faltaba `password`, despues `tel` y `url`, despues `date`), la de las
   variables de color (`--text-secondary` valia negro y su valor de respaldo
   nunca se usaba), y la de las copias del bloque de tema (faltaban
   `presupuestos.js` y `clientes.js`). Cada vez que se agrego algo nuevo habia
   que acordarse de actualizar la lista, y no siempre se acordo.

   Este archivo no prueba que se vea lindo. Prueba las tres cosas que se
   rompen solas:
     - que la regla de campos NO sea una lista de tipos (que sea la forma
       dada vuelta), y que todo `type` que se use en el proyecto caiga en ella;
     - que toda variable de color que se use exista Y este redefinida en los
       dos temas;
     - que el tema se aplique desde un solo lugar y las dos clases existan.

   Correr:  node tools/ver-estilo-y-tema.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', 'frontend');

let ok = 0;
const fallas = [];

/** Lee un archivo del frontend. */
function leer(nombre) {
    return fs.readFileSync(path.join(FRONT, nombre), 'utf8');
}

/**
 * El texto SIN comentarios.
 *
 * Hace falta porque un `var(--x)` escrito en un comentario para explicar el
 * bug que se acaba de arreglar es indistinguible de un uso real si se lee el
 * archivo crudo. Y este archivo mira justamente eso: que nadie vuelva a
 * escribir `var(--text-secondary, ...)` en una regla. Los comentarios se
 * borran para no contarlos como usos; lo que de verdad importa es lo que el
 * navegador aplica.
 */
function sinComentarios(txt) {
    return txt
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* ... */
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '); // // ... (no `://` de una url)
}

/** Un OK con su explicacion, o un FALLO que se acumula. */
function check(ok_, que, detalle = '') {
    if (ok_) {
        ok++;
        console.log(`  OK    ${que}`);
    } else {
        fallas.push(`${que}${detalle ? ' :: ' + detalle : ''}`);
        console.log(`  FALLO ${que}`);
        if (detalle) console.log(`        ${detalle}`);
    }
}

function seccion(titulo) {
    console.log(`\n${titulo}`);
    console.log('-'.repeat(titulo.length));
}

/* ==========================================================================
   1. LA REGLA GLOBAL DE LOS CAMPOS
   ========================================================================== */

seccion('1. Regla global de los campos (tel, url, date, ...)');

const css = leer('style.css');

/**
 * Saca el bloque de una regla a partir de su posicion de `{`.
 * Devuelve el texto hasta la llave de cierre que la empareja, contando
 * llaves y saltandose las que esten dentro de comentarios o entre comillas.
 */
function bloqueDesde(txt, desde) {
    let nivel = 0;
    for (let i = desde; i < txt.length; i++) {
        const c = txt[i];
        if (c === '{') nivel++;
        else if (c === '}') {
            nivel--;
            if (nivel === 0) return txt.slice(desde, i + 1);
        }
    }
    return '';
}

/** Todas las reglas del CSS, con su selector y su bloque. */
function reglas(txt) {
    const salida = [];
    // Se sacan primero los comentarios: un `{` dentro de un comentario
    // desbalancearia el conteo y las reglas siguientes se leerían mal.
    const limpio = txt.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /(^|\})\s*([^{}@]+?)\s*\{/g;
    let m;
    while ((m = re.exec(limpio)) !== null) {
        const llave = limpio.indexOf('{', m.index);
        const bloque = bloqueDesde(limpio, llave);
        const selector = m[2].trim();
        // Las reglas que empiezan con @ se cuelan en este patron; no sirven.
        if (selector.startsWith('@') || selector.includes('@')) continue;
        salida.push({ selector, bloque, declaraciones: bloque.slice(1, -1) });
    }
    return salida;
}

const reglasCss = reglas(css);

/* La regla de campos: el selector tiene que ser la forma dada vuelta.
   Acepta la multilinea de estilo.css, asi que se juntan los espacios. */
const reglaCampos = reglasCss.find(r => /input:not\(\[type=/.test(r.selector.replace(/\s+/g, ' ')));

check(!!reglaCampos, 'la regla global de campos usa `input:not([type=...])` y no una lista de tipos',
    'no se encontro ninguna regla con `input:not([type=` en style.css. Si volvio a ser una lista de tipos, el problema de `tel`/`url`/`date` vuelve.');

if (reglaCampos) {
    const sel = reglaCampos.selector.replace(/\s+/g, ' ');
    const decl = reglaCampos.declaraciones;

    for (const prop of ['background-color', 'color', 'border', 'border-radius', 'padding', 'font-size']) {
        check(new RegExp(`(^|;)\\s*${prop}\\s*:`).test(decl), `la regla global de campos define \`${prop}\``);
    }

    /* Lo que TIENE que quedar afuera. Si `file` entrara, el botón "Elegir
       archivo" se estilaría a medias; si `checkbox` entrara, se romperían los
       tildes y los checks de todo el sistema. */
    const excluidos = ['checkbox', 'radio', 'file', 'color', 'range', 'hidden', 'submit', 'button', 'reset', 'image'];
    const faltan = excluidos.filter(t => !new RegExp(`\\[type=["']${t}["']\\]`).test(sel));
    check(faltan.length === 0, `la regla excluye los ${excluidos.length} tipos que no se estilan`,
        `no excluye: ${faltan.join(', ')}`);

    /* El corazon del asunto: TODO type que se use en el proyecto tiene que
       entrar en esta regla. Con la forma dada vuelta entra solo, asi que
       esto es una comprobacion de que la forma siga dada vuelta. */
    const tiposUsados = new Set();
    for (const nombre of fs.readdirSync(FRONT)) {
        if (!/\.(html|js)$/.test(nombre)) continue;
        const txt = leer(nombre);
        for (const m of txt.matchAll(/type=["']([a-z]+)["']/g)) tiposUsados.add(m[1]);
    }
    const sinCubrir = [...tiposUsados].filter(t => !excluidos.includes(t));
    check(sinCubrir.length > 0, `el proyecto usa ${sinCubrir.length} tipos que deben entrar en la regla: ${sinCubrir.join(', ')}`);
    check(!excluidos.some(t => sinCubrir.includes(t)),
        'ninguno de los tipos excluidos se usa como si debiera entrar en la regla',
        `aparecen a la vez en la lista de excluidos y en uso: ${excluidos.filter(t => sinCubrir.includes(t)).join(', ')}`);
}

/* La regla del foco tiene que ser generica tambien. Si somebody la vuelve a
   escribir como `input[type="text"]:focus`, los campos nuevos no toman foco. */
const reglaFoco = reglasCss.find(r => /^input:focus/.test(r.selector.replace(/\s+/g, ' ')) && /box-shadow/.test(r.declaraciones));
check(!!reglaFoco, 'la regla de foco es `input:focus` y no una lista de tipos',
    'no se encontro `input:focus { ... box-shadow ... }` en style.css');

/* El desplegable del calendario se dibuja fuera de la pagina: no hay
   propiedad de CSS que lo pinte. Se le dice el tema con `color-scheme`. */
check(/::-webkit-calendar-picker-indicator/.test(css), 'hay estilo para el botón del calendario de `<input type="date">`');
check(/color-scheme\s*:\s*dark/.test(css), 'se declara `color-scheme` para el tema oscuro');
check(/color-scheme\s*:\s*light/.test(css), 'se declara `color-scheme` para el tema claro');

/* ==========================================================================
   2. LAS VARIABLES DE COLOR: NINGUNA SIN DEFINIR, NINGUNA SOLO EN UN TEMA
   ========================================================================== */

seccion('2. Variables de color');

const archivosCss = fs.readdirSync(FRONT).filter(n => n.endsWith('.css'));
const cssDeTodo = archivosCss.map(n => ({ nombre: n, txt: leer(n) }));

/*
 * Variables que NO están en ningún CSS porque las pone el sistema en
 * movimiento. No son un forgot: `--p-color-primario` la escribe
 * `presupuestos.js` con el color que tiene cargado la empresa.
 *
 * Cada una tiene que aparecer con su `setProperty` en el control de este
 * archivo, más abajo. Si se borra esa línea, la lista se queda mintiendo y el
 * color cae al respaldo fijo, que es el mismo bug con otro nombre.
 */
const DEFINIDAS_EN_RUNTIME = {
    '--p-color-primario': 'presupuestos.js'
};

/* Todas las variables declaradas en el proyecto. */
const declaradas = new Set();
for (const { txt } of cssDeTodo) {
    for (const m of sinComentarios(txt).matchAll(/(--[a-z0-9-]+)\s*:/gi)) declaradas.add(m[1]);
}

/* Todas las variables usadas. Se cuentan tambien las que aparecen dentro de
   `var(--x, respaldo)`: si el respaldo se ve en pantalla es porque la
   variable no existia, y ese es justamente el bug. */
const usadas = new Map();
for (const nombre of fs.readdirSync(FRONT)) {
    if (!/\.(css|js|html)$/.test(nombre)) continue;
    const txt = sinComentarios(leer(nombre));
    for (const m of txt.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,|\))/gi)) {
        if (!usadas.has(m[1])) usadas.set(m[1], []);
        usadas.get(m[1]).push(nombre);
    }
}

const sinDefinir = [...usadas.keys()]
    .filter(v => !declaradas.has(v))
    .filter(v => !DEFINIDAS_EN_RUNTIME[v]);
check(sinDefinir.length === 0, `las ${usadas.size} variables de color que se usan existen en algun lado`,
    `se usan y no estan definidas en ningun .css del frontend: ${sinDefinir.join(', ')}. O no existen, o estan escritas con otro nombre. Si la define el sistema en movimiento, va en DEFINIDAS_EN_RUNTIME.`);

/* Y lo declarado tiene que estar de verdad, no en la lista de Mentiras. */
for (const [variable, archivo] of Object.entries(DEFINIDAS_EN_RUNTIME)) {
    check(new RegExp(`setProperty\\(\\s*['"]${variable}['"]`).test(leer(archivo)),
        `\`${variable}\` se sigue poniendo en movimiento desde ${archivo}`,
        `esta en la lista de variables en runtime pero ${archivo} ya no hace setProperty de eso. Sacala de la lista o arregla el codigo.`);
}

/* El bug puntual de esta tanda: `--text-secondary` valia #000000 y sus tres
   usos dejaban el documento del cliente y el telefono del buscador en negro.
   Los comentarios que mencionan el nombre viejo no cuentan: se leen sin
   comentarios justamente para poder escribir la explicacion sin que el control
   se dispare solo. */
const usaTextSecondary = [...usadas.keys()].filter(v => v === '--text-secondary');
check(usaTextSecondary.length === 0, '`--text-secondary` no se usa en ninguna regla',
    `se sigue usando en: ${(usadas.get('--text-secondary') || []).join(', ')}`);
check(!declaradas.has('--text-secondary'), '`--text-secondary` no se declara en ningun .css',
    'volvio la declaracion. Si hace falta un gris secundario, es una variable nueva, definida en los DOS temas.');

/* Las dos apariciones que quedaron con `--text-muted` tienen que estar
   escritas con la variable y no con un color fijo, que es lo que rompia. */
for (const archivo of ['presupuestos.css', 'presupuestos.js']) {
    check(!/var\(--text-secondary/.test(sinComentarios(leer(archivo))), `${archivo} no usa \`--text-secondary\``);
}

/* Y `--color-warning`, que se usaba con un dorado fijo de respaldo porque la
   variable no existia en ningun lado. Ahora existe en los dos temas (abajo se
   comprueba) y el uso quedo sin el color quemado adentro. */
check(!/var\(--color-warning\s*,/.test(sinComentarios(auth0())), 'el contador de usuarios no se apoya en un dorado fijo de respaldo',
    'volvio `var(--color-warning, #b8860b)`. La variable ya esta en los dos temas, no hace falta el color fijo.');

/**
 * El texto de auth-check.js sin comentarios. Se usa antes de que `auth` esté
 * definido en el orden del archivo, por eso es una función.
 */
function auth0() {
    return leer('auth-check.js');
}

/* ==========================================================================
   3. EL TEMA: UN SOLO LUGAR Y LAS DOS CLASES
   ========================================================================== */

seccion('3. Tema claro / oscuro');

const bloqueClaro = reglasCss.find(r => r.selector.replace(/\s+/g, ' ') === 'html.tema-claro');
const bloqueOscuro = reglasCss.find(r => r.selector.replace(/\s+/g, ' ') === 'html.tema-oscuro');

check(!!bloqueClaro, 'existe el bloque `html.tema-claro` en style.css');
check(!!bloqueOscuro, 'existe el bloque `html.tema-oscuro` en style.css',
    'Sin este bloque, pedir el tema oscuro no cambia NINGUNA variable: el CSS queda igual que sin preferencia. En una PC en modo claro, el boton no hace nada.');

/**
 * Las variables de un bloque, en un Set.
 */
function varsDe(bloque) {
    const s = new Set();
    if (!bloque) return s;
    for (const m of bloque.declaraciones.matchAll(/(--[a-z0-9-]+)\s*:/gi)) s.add(m[1]);
    return s;
}

/* LA PALETA CLARO ESTA ESCRITA DOS VECES, Y ESO ES LO QUE HACE ESTE ARCHIVO.
 *
 * La version "de verdad" esta en el `@media (prefers-color-scheme: light)`.
 * La de `html.tema-claro` es la que se aplica cuando la persona eligio el tema
 * a mano.
 *
 * `html.tema-oscuro` tiene que pisar TODO lo que pisa ese `@media`. Si se le
 * deja una variable afuera, en una PC configurada en claro esa variable se va a
 * buscar al `@media` y la pagina queda con la paleta oscura a medias: el fondo
 * oscuro y el texto claro de la luz. Ese es exactamente el modo de falla que
 * reporto el usuario, y no se puede ver en una PC en modo oscuro, asi que
 * este control tiene que cubrirlo.
 *
 * Al reves no hace falta: el `:root` de arriba puede declarar cosas que no
 * cambian con el tema (el azul de la marca, el verde de "guardado"), y que por
 * lo tanto no estan en ningun bloque de tema. */
const varsClaro = varsDe(bloqueClaro);
const varsOscuro = varsDe(bloqueOscuro);

const varsMqClaro = new Set();
const mqClaro = css.match(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{[\s\S]*?\n\}/);
if (mqClaro) {
    for (const m of mqClaro[0].matchAll(/(--[a-z0-9-]+)\s*:/g)) varsMqClaro.add(m[1]);
}

check(mqClaro !== null, 'existe el `@media (prefers-color-scheme: light)` en style.css');

const noPisadasPorOscuro = [...varsMqClaro].filter(v => !varsOscuro.has(v));
check(noPisadasPorOscuro.length === 0, `el tema oscuro pisa las ${varsMqClaro.size} variables que pisa el tema claro del sistema`,
    `no las pisa: ${noPisadasPorOscuro.join(', ')}. En una PC en modo claro se van a buscar al @media y el tema oscuro queda a medias.`);

const noPisadasPorClaro = [...varsMqClaro].filter(v => !varsClaro.has(v));
check(noPisadasPorClaro.length === 0, 'la paleta de `html.tema-claro` es la misma que la del `@media (prefers-color-scheme: light)`',
    `solo esta en una de las dos: ${noPisadasPorClaro.join(', ')}. Agregar una variable a un tema y no al otro la hace depender de como este la PC.`);

const faltanEnClaro = [...varsOscuro].filter(v => !varsClaro.has(v));
check(faltanEnClaro.length === 0, 'el tema claro declara las mismas variables que el oscuro',
    `al claro le faltan: ${faltanEnClaro.join(', ')}. Esa pagina se dibuja con la mitad de una paleta y la otra de la del sistema.`);

/* Esta comprobacion es la que faltaba, y la hizo falta el script de mutaciones.
 * Las tres de arriba miran un solo sentido: "lo que esta en el `@media` tiene que
 * estar en los dos temas". Si al `@media` se le SACA una variable y la clase
 * `html.tema-claro` la sigue teniendo, ninguna de las tres se entera: la
 * comparacion queda "menor o igual" y pasa en verde.
 *
 * Y el caso es real: el `@media` es la paleta clara "de verdad" (asi lo dice el
 * comentario de arriba de este mismo bloque). Es la que se aplica sin JavaScript
 * y antes de que corra `auth-check.js`. Si `--border-input` quedara solo en la
 * clase, en una PC en claro el campo tomaria el valor oscuro del `:root`.
 */
const soloEnLaClaseClaro = [...varsClaro].filter(v => !varsMqClaro.has(v));
check(soloEnLaClaseClaro.length === 0, 'el `@media (prefers-color-scheme: light)` declara lo mismo que `html.tema-claro`',
    `estan solo en la clase: ${soloEnLaClaseClaro.join(', ')}. El @media es la paleta clara de verdad: sin JavaScript, o antes de que corra el script del tema, esa variable se busca en el :root oscuro.`);

/* El `:root` de arriba es el tema oscuro por defecto. Puede declarar variables
 * que no cambian con el tema (el azul de la marca, el verde de "guardado"), asi
 * que no se le puede pedir que declare todo. Lo que NO puede pasar es que
 * declare una variable con un valor distinto del que le pone `html.tema-oscuro`
 * a la misma variable: las dos dicen "esto es el oscuro" y si difieren, cual de
 * las dos gana depende de si hay clase o no. */
const bloqueRaiz = reglasCss.find(r => r.selector === ':root');
check(!!bloqueRaiz, 'existe el bloque `:root` (el tema oscuro por defecto) en style.css');

if (bloqueRaiz && bloqueOscuro) {
    const valorRaiz = (nombre) => {
        const m = new RegExp(`${nombre}\\s*:\\s*([^;]+);`, 'i').exec(bloqueRaiz.declaraciones);
        return m ? m[1].trim() : null;
    };
    const valorOscuro = (nombre) => {
        const m = new RegExp(`${nombre}\\s*:\\s*([^;]+);`, 'i').exec(bloqueOscuro.declaraciones);
        return m ? m[1].trim() : null;
    };
    const compartidas = [...varsOscuro].filter(v => varsDe(bloqueRaiz).has(v));
    const dispares = compartidas
        .map(v => ({ v, raiz: valorRaiz(v), oscuro: valorOscuro(v) }))
        .filter(x => x.raiz !== x.oscuro);

    check(dispares.length === 0,
        `el \`:root\` y \`html.tema-oscuro\` dan el mismo valor a las ${compartidas.length} variables que comparten`,
        `difieren: ${dispares.map(d => `${d.v} (raiz=${d.raiz} / oscuro=${d.oscuro})`).join(', ')}. Las dos declaran el tema oscuro; si no coinciden, cual de las dos gana depende de si la clase esta puesta.`);
}

/* Cada tema tiene que poner su `color-scheme`: sin eso el desplegable del
   calendario y las barras de desplazamiento se dibujan con el tema del
   sistema, no con el que pidio la persona. */
check(bloqueOscuro && /color-scheme\s*:\s*dark/.test(bloqueOscuro.declaraciones), '`html.tema-oscuro` declara `color-scheme: dark`');
check(bloqueClaro && /color-scheme\s*:\s*light/.test(bloqueClaro.declaraciones), '`html.tema-claro` declara `color-scheme: light`');

/* La clase tiene que estar en `<html>`, no en `<body>`: en `<body>` no le
   gana al `:root` del `@media`, que es de donde salía el modo claro. */
const selectoresViejos = [];
for (const { nombre, txt } of cssDeTodo) {
    /* Se usa el mismo parser que mas arriba, no una busqueda con regex sobre
       el texto crudo. Con regex habia que escribir un patron que esquivara los
       comentarios y los saltos de linea entre una regla y la siguiente, y
       cualquier detalle se translatea en un FALLO que no se dispara: el
       control pasa en verde sin tener nada que mirar. Con el parser no hay
       posicion que interpretar: o la regla existe o no existe. */
    for (const r of reglas(txt)) {
        const sel = r.selector.replace(/\s+/g, ' ').trim();
        if (/\bbody\.tema-/.test(sel) || /\bbody:not\(\.tema-/.test(sel)) {
            selectoresViejos.push(`${nombre}: ${sel}`);
        }
    }
}
check(selectoresViejos.length === 0, 'ningun selector de tema usa `body.tema-claro` ni `body:not(.tema-claro)`',
    `quedaron: ${selectoresViejos.join(' | ')}`);

/* Las reglas que son solo del tema oscuro tienen que preguntar por
   `html.tema-oscuro`, no por `body:not(.tema-claro)`: con la clase siempre
   puesta, "no hay clase" no existe. */
check(/html\.tema-oscuro\s+\.fila-alerta-critica/.test(css), 'las reglas exclusive del tema oscuro preguntan por `html.tema-oscuro`');

/* ==========================================================================
   4. EL TEMA SE APLICA DESDE UN SOLO LUGAR
   ========================================================================== */

seccion('4. Un solo lugar que aplica el tema');

const auth = leer('auth-check.js');

/* La clave del localStorage no puede estar en dos lados: si mañana la
   cambia uno, el otro sigue escribiendo la vieja. */
const conLaClave = fs.readdirSync(FRONT).filter(n => /\.(js|html)$/.test(n) && leer(n).includes('tema-preferido'));
check(conLaClave.length === 1 && conLaClave[0] === 'auth-check.js',
    'la clave `tema-preferido` se toca solo en auth-check.js',
    `tambien aparece en: ${conLaClave.filter(n => n !== 'auth-check.js').join(', ')}`);

/* Las copias del bloque de tema en los scripts de cada pantalla. */
const scriptsDePagina = ['app.js', 'pedidos.js', 'reparaciones.js', 'admin.js', 'presupuestos.js', 'clientes.js'];
const conCopia = scriptsDePagina.filter(n => /classList\.(add|remove|toggle)\(\s*['"]tema-/.test(sinComentarios(leer(n))));
check(conCopia.length === 0, 'ningún script de pantalla pone la clase del tema',
    `ponen la clase: ${conCopia.join(', ')}. Esa copia se va a quedar vieja y va a pisar la de auth-check.js.`);

/* Sin esto, cambiar el tema en una pestaña no mueve la de al lado. */
check(/addEventListener\(\s*['"]storage['"]/.test(auth), 'auth-check.js escucha el evento `storage` para sincronizar otra pestaña');

/* Sin esto, cambiar el tema de la PC con la aplicación abierta no la mueve,
   siempre que la persona no haya elegido nada a mano. */
check(/prefers-color-scheme:\s*light/.test(auth) && /(addEventListener\(\s*['"]change['"]|addListener\()/.test(auth),
    'auth-check.js sigue al tema del sistema operativo mientras no haya elección propia');

/* Las dos clases, siempre. Hay reglas que son solo del tema oscuro y
   necesitan poder confiar en que hay una de las dos puesta. */
check(/classList\.toggle\(\s*['"]tema-claro['"]/.test(auth), 'auth-check.js pone `tema-claro` con `classList.toggle`');
check(/classList\.toggle\(\s*['"]tema-oscuro['"]/.test(auth), 'auth-check.js pone `tema-oscuro` con `classList.toggle`');

/* Se aplica en el `<head>`, antes de que el navegador pinte nada. */
/* La lista esta escrita a mano, y por eso corre el riesgo de quedar corta: cada
   pagina nueva que se agregue tiene que entrar aca, o el tema se aplica tarde
   y sin avisar en esa pagina y en ninguna otra. `facturacion.html` entro junto
   con la pagina. */
const paginasConBoton = ['index.html', 'pedidos.html', 'reparaciones.html', 'clientes.html', 'presupuestos.html', 'facturacion.html', 'admin.html'];
for (const pagina of paginasConBoton) {
    const txt = leer(pagina);
    const cabeza = txt.slice(0, txt.search(/<body/i));
    check(/<script[^>]*auth-check\.js/.test(cabeza), `${pagina} carga auth-check.js en el <head>`,
        'si se carga despues del <body>, el tema se aplica tarde y se ve el del sistema un instante antes.');
    check(/id=["']btn-tema["']/.test(txt) && /onclick=["']cambiarTemaManualmente\(\)["']/.test(txt),
        `${pagina} tiene el botón de tema bien conectado`);
}

/* login.html es neutra a proposito: no carga auth-check.js. Si un dia empieza a
   cargarlo, la pantalla de login dejaria de ser neutra. */
check(!/auth-check\.js/.test(leer('login.html')), 'login.html sigue sin cargar auth-check.js (arranca neutral)');

/* Una sola definicion de la funcion que el boton llama por onclick. */
const defineLaFuncion = fs.readdirSync(FRONT).filter(n => n.endsWith('.js') && /function\s+cambiarTemaManualmente|function\s+aplicarTema/.test(sinComentarios(leer(n))));
check(defineLaFuncion.length === 1 && defineLaFuncion[0] === 'auth-check.js',
    '`cambiarTemaManualmente` esta definida en un solo archivo',
    `definida en: ${defineLaFuncion.join(', ')}`);

/* El icono lo decide el CSS. Si vuelve a haber JS, tiene que ser el mismo
   criterio: el icono muestra a que tema se pasa al hacer clic. */
check(!/ajustarIconoTema\s*\(/.test(sinComentarios(leer('admin.js'))), 'admin.js ya no mueve el ícono del tema con estilos en línea');
check(/html\.tema-claro\s+\.btn-alternar-tema\s+\.icono-sol/.test(css), 'el ícono del botón lo decide el CSS, según la clase del tema');

/* Los dos iconos del boton de tema son UNO solo, copiado a mano en cada pagina.
   Y al copiar a mano, un caracter se pierde: en facturacion.html el path de la
   luna traia "9 0 1 1-9-9Z" donde las otras seis paginas traen "9 9 0 1 1-9-9Z".
   Faltaba un 9, el navegador tiraba "Expected arc flag" en la consola, y el
   boton igual funcionaba: es un error invisible en una pantalla que se usa
   todos los dias.

   No se busca que el SVG "este bien": no hay forma de saber si un path es el
   correcto sin dibujarlo. Se busca que sea EL MISMO en todas las paginas, que es
   la condicion que hace que no se puedan volver a desincronizar entre si. */
const ICONOS = ['icono-sol', 'icono-luna'];
const pathsPorPagina = new Map();

for (const pagina of paginasConBoton) {
    const txt = leer(pagina);

    for (const icono of ICONOS) {
        const bloque = (txt.match(new RegExp('<svg[^>]*class="' + icono + '"[^>]*>([\\s\\S]*?)</svg>', 'i')) || [, ''])[1];

        check(bloque.length > 0, `${pagina} tiene el <svg class="${icono}"> del boton de tema`,
            'el CSS decide cual de los dos se ve segun el tema; si falta uno, en ese tema no se ve nada.');

        const d = (bloque.match(/d="([^"]+)"/g) || []).join(' ').replace(/\s+/g, ' ').trim();
        check(d.length > 0, `${pagina} el icono "${icono}" tiene los <path> con atributo d`);

        if (icono === 'icono-luna' && d) {
            if (!pathsPorPagina.has('luna')) pathsPorPagina.set('luna', new Map());
            pathsPorPagina.get('luna').set(pagina, d);
        }
    }
}

/* El de la luna es el unico que se dibuja con una curva: es el que tiene el
   path con flags de arco ("a6 6 0 0 0 ...Z"), que es donde se perdio el 9. */
const lunas = pathsPorPagina.get('luna') || new Map();
check(lunas.size === paginasConBoton.length,
    `se leyo el icono de la luna en las ${paginasConBoton.length} paginas`,
    `se leyeron en: ${[...lunas.keys()].join(', ')}`);

if (lunas.size === paginasConBoton.length) {
    const distintas = new Set(lunas.values());
    check(distintas.size === 1,
        `el icono de la luna es el mismo en las ${paginasConBoton.length} paginas`,
        `hay ${distintas.size} versiones distintas: ` +
        [...lunas.entries()].filter(([, d]) => d !== [...lunas.values()][0])
            .map(([p, d]) => `${p} -> ${d}`).join(' | '));
}

/* ==========================================================================
   5. EL LISTADO DE PRESUPUESTOS
   ========================================================================== */

seccion('5. Listado y editor de presupuestos');

const pjs = leer('presupuestos.js');
const pcss = leer('presupuestos.css');

/* `.btn-tabla` sola no tiene fondo: pone `color: white` y nada mas. */
check(/class=["']btn-tabla btn-info["'][^>]*>Ver</.test(pjs), 'el botón "Ver" del listado lleva `btn-info` (el que da el fondo)');
const reglaBtnInfo = reglasCss.find(r => r.selector === '.btn-info');
check(!!reglaBtnInfo && /background-color\s*:/.test(reglaBtnInfo.declaraciones), '`.btn-info` define un fondo');

/* La celda no vuelve a dibujar una caja debajo del input: eso era el
   "recuadro desfasado". */
const reglaTd = reglas(pcss).find(r => r.selector === '.p-tabla-items tbody td');
check(!!reglaTd, 'existe la regla `.p-tabla-items tbody td`');
if (reglaTd) {
    /* `background: none` esta bien: es lo que se puso a proposito para que la
       celda no vuelva a dibujar una caja debajo del input. Lo que no puede
       volver es un fondo de verdad. */
    const fondos = [...reglaTd.declaraciones.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gi)]
        .map(m => m[1].trim())
        .filter(v => v !== 'none' && v !== 'transparent' && v !== 'initial' && v !== 'unset');
    check(fondos.length === 0, '`.p-tabla-items tbody td` no pinta un fondo de verdad',
        `pinta: ${fondos.join(', ')}. Se ve una barra asomando por debajo de los inputs y el recuadro queda partido.`);
    check(!/border-radius/.test(reglaTd.declaraciones), '`.p-tabla-items tbody td` no tiene radio');
}

/* El padding de la celda tiene que ser el del `th`. Si no, los inputs
   arrancan corridos con respecto de los rotulos de arriba. */
const reglaTh = reglas(pcss).find(r => r.selector === '.p-tabla-items thead th');

/**
 * El aire horizontal de una regla, en px. Se aceptan las dos formas: la
 * abreviatura `padding: 8px 10px` y la larga `padding-right: 10px`. Con solo
 * la abreviatura, `.p-subtotal-calc` (que usa la larga) pasaba por no tener
 * padding y el control no miraba nada.
 */
function aireLateral(bloque) {
    if (!bloque) return null;
    const abrev = bloque.declaraciones.match(/(?:^|;)\s*padding\s*:\s*([^;]+)/i);
    if (abrev) {
        const partes = abrev[1].trim().split(/\s+/);
        // `a b` = vertical | lateral. `a b c` = arriba | laterales | abajo.
        return partes.length >= 2 ? partes[1] : partes[0];
    }
    const largo = bloque.declaraciones.match(/(?:^|;)\s*padding-(?:left|right)\s*:\s*([^;]+)/i);
    return largo ? largo[1].trim() : null;
}

const aireTh = aireLateral(reglaTh);
const aireTd = aireLateral(reglaTd);
check(aireTh && aireTd && aireTh === aireTd, 'la celda y el encabezado tienen el mismo padding horizontal',
    `el th tiene ${aireTh || '?'} y el td ${aireTd || '?'}. Con distintos, cada input arranca corrido con su rotulo.`);

/* El subtotal tiene que terminar a la misma altura que su rotulo. */
const reglaSub = reglas(pcss).find(r => r.selector === '.p-subtotal-calc');
const aireSub = aireLateral(reglaSub);
check(aireSub !== null && aireSub === aireTd, 'el subtotal se alinea con la derecha de su columna',
    `el subtotal tiene ${aireSub || 'nada'} de aire y la celda ${aireTd || 'nada'}.`);

/*
 * LOS TRES TEXTOS QUE EL USUARIO VIO NEGROS
 *
 * El documento del cliente en el listado, el telefono y la direccion en el
 * buscador, y el aviso de lista vacia. Los tres salian negros sobre el fondo
 * oscuro porque usaban `--text-secondary`, que valia `#000000` y cuyo valor de
 * respaldo nunca llegaba a usarse.
 *
 * El control no es "que no haya ningun color fijo en el archivo": el
 * comprobante de un presupuesto tiene que llevar los colores de la empresa, que
 * si son fijos a proposito. Es especificamente en estos tres lugares, donde el
 * color tiene que salir del tema.
 */
function colorDeRegla(bloque) {
    if (!bloque) return null;
    const m = bloque.declaraciones.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    return m ? m[1].trim() : null;
}

for (const [selector, donde] of [['.p-resultado small', 'el buscador de clientes'], ['.p-vacio', 'el aviso de lista vacia']]) {
    const color = colorDeRegla(reglas(pcss).find(r => r.selector === selector));
    check(color !== null && /var\(\s*--text-muted\s*\)/.test(color), `${donde} se pinta con \`var(--text-muted)\``,
        `${selector} tiene \`color: ${color}\`. Si es un color fijo no cambia con el tema, que es como se veía negro sobre el fondo oscuro.`);
}

/* El documento del listado va en un `style=""` en linea, no en una regla. */
check(/<small style="color:var\(--text-muted\)">/.test(pjs), 'el documento del cliente del listado se pinta con `var(--text-muted)`',
    'volvio el color fijo o la variable vieja en el <small> del cliente. Con un color fijo el documento sale negro en tema oscuro.');

/* ==========================================================================
   6. LA PAGINA DEL SUPERADMIN: LOS CAMPOS QUE SE VEN DISTINTOS
   ========================================================================== */

seccion('6. Campos del detalle de empresa en el panel');

const ajs = leer('admin.js');
const tiposDeCampo = [...ajs.matchAll(/campo\(\s*'[^']*'\s*,\s*'\w+'\s*,\s*'(\w+)'/g)].map(m => m[1]);
const tiposRaros = [...new Set(tiposDeCampo)].filter(t => !['text', 'select', 'color'].includes(t));

check(tiposRaros.includes('tel') || tiposRaros.includes('url'),
    'el detalle de empresa sigue usando `tel` y `url` (los que se veian mal, y que ahora entran en la regla global)',
    'si `campo()` dejo de usarlos, este control ya no mira nada.');

check(reglaCampos !== undefined, 'la regla global de campos es la que los cubre a los dos');

/* ==========================================================================
   7. EL BORDE DE LOS CAMPOS: QUE SE VEA
   --------------------------------------------------------------------------
   El borde de un campo no puede ser el mismo que el de una tarjeta. Con
   `--border-color` la caja de texto quedaba en 1.47:1 en oscuro y 1.21:1 en
   claro contra su propio fondo, y WCAG 1.4.11 pide 3:1 para el borde de un
   control: por debajo de eso el campo no se distingue del papel. Asi se quejaba
   el usuario de las barras de los items de la factura, en los dos temas.

   La trampa de medir es contra cual fondo: el del CAMPO, no el de la tarjeta. El
   campo tiene fondo propio (`--bg-body`) y ese es el color vecino. Medirlo
   contra `--bg-card` daria un numero parecido y no el que importa.
   ========================================================================== */

/** '#rgb' o '#rrggbb' -> [r,g,b]. null si no es un hex de 3 o 6 digitos. */
function rgbDe(valor) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(valor).trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/** Luminancia relativa, la misma formula de WCAG. */
function lum(rgb) {
    const [r, g, b] = rgb.map(v => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razon de contraste entre dos colores opacos, a dos decimales. */
function contraste(a, b) {
    const la = lum(a);
    const lb = lum(b);
    return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}

/** El valor de una variable dentro del texto de un bloque. */
function valorDe(bloque, nombre) {
    if (!bloque) return null;
    const m = new RegExp(`${nombre}\\s*:\\s*([^;]+);`, 'i').exec(bloque.declaraciones);
    return m ? m[1].trim() : null;
}

const MIN_BORDE_CAMPO = 3;   // WCAG 1.4.11, "Non-text Contrast"

seccion('7. El borde de los campos: que se vea');

for (const [nombreTema, bloque] of [['oscuro', bloqueOscuro], ['claro', bloqueClaro]]) {
    const vBorde = valorDe(bloque, '--border-input');
    const vFondo = valorDe(bloque, '--bg-body');

    check(vBorde !== null, `el tema ${nombreTema} define \`--border-input\``,
        'si el tema no la define, con el SO en claro la variable se busca en el `@media (prefers-color-scheme: light)` y el campo toma el color del otro tema.');
    check(vFondo !== null, `el tema ${nombreTema} define \`--bg-body\`, el fondo contra el que se mide el borde`);

    const cb = rgbDe(vBorde);
    const cf = rgbDe(vFondo);
    if (cb && cf) {
        const r = contraste(cb, cf);
        check(r >= MIN_BORDE_CAMPO,
            `el borde del campo llega a ${MIN_BORDE_CAMPO}:1 en tema ${nombreTema} (mide ${r}:1)`,
            `\`--border-input: ${vBorde}\` sobre \`--bg-body: ${vFondo}\` da ${r}:1. WCAG 1.4.11 pide ${MIN_BORDE_CAMPO}:1 para el borde de un control de formulario.`);
    } else {
        /* Si el color no es un hex corto, esta comprobacion no puede medirlo.
           Prefiero que falle a que pase en verde sin haber mirado nada. */
        check(false, `el borde del campo llega a ${MIN_BORDE_CAMPO}:1 en tema ${nombreTema}`,
            `no se pudieron leer los colores: --border-input=${vBorde}, --bg-body=${vFondo}. Si alguno no es un hex de 3 o 6 digitos, esta comprobacion pasaria en verde sin medir.`);
    }
}

/* Quien TIENE que usar `--border-input`: la regla global, y `.login-form input`,
   que le gana por especificidad. Si a esta ultima se le deja `--border-color`,
   el borde del campo vuelve a 1.2:1 sin que se note el cambio. */
if (reglaCampos) {
    const mBorde = /(?:^|;)\s*border\s*:[^;]*/.exec(reglaCampos.declaraciones);
    check(mBorde && /var\(\s*--border-input\s*\)/.test(mBorde[0]),
        'la regla global de campos se dibuja con `var(--border-input)`',
        `la regla global declara \`border: ${mBorde ? mBorde[0].replace(/^\s*;\s*/, '').trim() : '(no declara border)'}\`. Con \`--border-color\` el borde del campo queda en 1.2 a 1.5:1.`);
}

const reglaLoginInput = reglasCss.find(r => r.selector.replace(/\s+/g, ' ') === '.login-form input');
check(!!reglaLoginInput && /var\(\s*--border-input\s*\)/.test(reglaLoginInput.declaraciones),
    '`.login-form input` se dibuja con `var(--border-input)`',
    'esta regla le gana por especificidad a la global, asi que si queda con `--border-color` el borde del campo vuelve a ser invisible y esta comprobacion de la global no lo va a ver.');

/* La puerta de atras: un `style="..."` inline le gana a cualquier regla, asi que
   un control con `--border-color` ahi burla todo lo de arriba. */
const controlesConBordeViejo = [];
for (const nombre of fs.readdirSync(FRONT)) {
    if (!/\.(html|js)$/.test(nombre)) continue;
    for (const m of leer(nombre).matchAll(/<(input|select|textarea)\b[^>]*style="[^"]*--border-color/gi)) {
        controlesConBordeViejo.push(`${nombre} (<${m[1].toLowerCase()}>)`);
    }
}
check(controlesConBordeViejo.length === 0,
    'ningun `<input>`, `<select>` o `<textarea>` lleva `--border-color` en un `style=` inline',
    `un \`style=\` inline le gana a cualquier regla, asi que estos meten el borde viejo por la puerta de atrás: ${controlesConBordeViejo.join(', ')}`);

/* El modal de alta de usuario. La caja es flex column y el `<form>` es un item
   con `min-height: auto`, o sea que NO se encoge. Si la caja no scrollea, en una
   ventana baja el boton de guardar se dibuja fuera del rectangulo de la tarjeta:
   medido con la ventana a 400px, caia 136px por debajo del borde. */
const reglaAltaUsuario = reglasCss.find(r => r.selector.replace(/\s+/g, ' ') === '.modal-alta-usuario .modal-contenido');
check(!!reglaAltaUsuario, 'existe la regla `.modal-alta-usuario .modal-contenido` en style.css',
    'sin ella el modal vuelve al `height:auto; max-height:90%` inline con `overflow: visible` de antes.');

if (reglaAltaUsuario) {
    check(/overflow-y\s*:\s*auto/.test(reglaAltaUsuario.declaraciones),
        '`.modal-alta-usuario .modal-contenido` deja que la tarjeta scrollee (`overflow-y: auto`)',
        `declara \`${reglaAltaUsuario.declaraciones.replace(/\s+/g, ' ').trim()}\`. Con el overflow en \`visible\` el contenido se dibuja por fuera de la tarjeta.`);

    const mh = /max-height\s*:\s*([^;]+)/.exec(reglaAltaUsuario.declaraciones);
    check(!!mh && /vh/.test(mh[1]),
        'el alto maximo de esa tarjeta va en `vh` y no en `%`',
        `max-height: ${mh ? mh[1].trim() : '(no lo declara)'}. Un porcentaje se resuelve contra la altura del padre, que es el overlay; \`vh\` no depende de nadie.`);
}

const idx = leer('index.html');
check(/id="modal-crear-usuario"[^>]*class="[^"]*\bmodal-alta-usuario\b/.test(idx),
    'el modal de alta de usuario lleva la clase `modal-alta-usuario`',
    'la regla existe pero el modal no la pide, asi que no aplica.');

/* El `max-height` inline se busca DENTRO del modal del usuario y no en cualquier
   `.modal-chico` de la pagina: hay otros modales chicos con estilos inline
   legitimos, y una regla general que los alcanzara a todos molestaria despues
   a uno que si los necesita. */
const bloqueModalUsuario = /<div id="modal-crear-usuario"[\s\S]*?<div class="modal-contenido modal-chico"([^>]*)>/.exec(idx);
check(!!bloqueModalUsuario && !/max-height/.test(bloqueModalUsuario[1]),
    'el modal de alta de usuario ya no lleva `max-height` inline',
    'el `style=` inline pisa la regla de la hoja de estilos, asi que por mas correcta que este la regla, no gana.');

/* ==========================================================================
   RESUMEN
   ========================================================================== */

console.log(`\n${'='.repeat(70)}`);
console.log(`  ${ok} OK   ${fallas.length} FALLO`);
console.log('='.repeat(70));

if (fallas.length) {
    console.log('\nQue se rompio:\n');
    fallas.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    process.exit(1);
}

console.log('\nTodo en orden.\n');
