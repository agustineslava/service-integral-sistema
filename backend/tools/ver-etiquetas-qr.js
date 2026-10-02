/* ==========================================================================
   VERIFICADOR: modulo de etiquetas QR
   --------------------------------------------------------------------------
   Por que existe: este modulo era el unico sin ninguna comprobacion, y tenia
   una fuga escrita a mano.

   Lo que habia:

     GET /e/:codigo.svg     el QR, sin sesion
     GET /e/:codigo         ficha del repuesto, sin sesion, y con
                            `obtenerPool('serviceintegralsistema')` — la base de
                            la empresa 1, escrita a mano

   Eso es exactamente el cruce de datos que el proyecto no se puede permitir: si
   una segunda empresa contrata el modulo, sus etiquetas se resuelven contra los
   datos de la primera. Y como no exigian sesion, cualquiera que tuviera el
   codigo leia precio, stock y distribuidor.

   Este archivo no prueba que la etiqueta se vea bien. Prueba lo que se rompe
   solo, que son cuatro cosas:

     1. Que no vuelva a existir ninguna ruta de etiqueta sin sesion.
     2. Que ninguna ruta pida una base por nombre. La base la decide la sesion.
     3. Que el QR no vuelva a llevar una URL adentro (ata la etiqueta a un
        dominio que todavia no existe).
     4. Que toda ruta de etiqueta tenga el modulo y que las que escriben tengan
        ademas `requiereAdmin`.

   Y una quinta que no es de este modulo pero se encontró buscando, y que por
   sola justifica el archivo: ningun `.replace()` puede tener el mismo patron y
   el mismo reemplazo. El `escapeHtml` de las rutas eliminadas hacia
   `.replace(/&/g, '&')`: no escapaba nada, y un escape que no escapa tiene
   EXACTAMENTE la misma forma que uno que escapa bien. Nadie lo iba a notar
   mirando.

   Correr:  node tools/ver-etiquetas-qr.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

let ok = 0;
const fallas = [];

function leer(ruta) {
    return fs.readFileSync(ruta, 'utf8');
}

/**
 * El texto SIN comentarios.
 *
 * Hace falta porque server.js tiene, desde esta tanda, un comentario largo
 * explicando que se borraron las rutas `/e/...` y que la base estaba escrita a
 * mano. Un verificador que leyera el archivo crudo veria `obtenerPool(
 * 'serviceintegralsistema')` DENTRO de un comentario y se quejaria, y lo
 * inverso tambien: un `app.get('/e/...')` escrito en un comentario para
 * explicar el bug no es una ruta. Los comentarios se borran para no contarlos
 * ni como rutas ni como codigo.
 *
 * Un comentario de una linea `// ...` se borra solo si no esta precededido de
 * `:` para no romper `://` de una URL.
 */
function sinComentarios(txt) {
    return txt
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

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

function fin() {
    console.log(`\n${'-'.repeat(70)}`);
    console.log(`${ok} OK / ${fallas.length} FALLO`);
    if (fallas.length) {
        console.log('\nLo que hay que arreglar:');
        fallas.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    }
    console.log('-'.repeat(70));
    process.exit(fallas.length ? 1 : 0);
}

/**
 * Extrae las declaraciones de ruta de un archivo, con su cola de guardas.
 *
 * NO se puede parseando el parentesis de cierre con una regex ni contando
 * parentesis a mano. Se intento las dos y las dos fallan, por motivos que valen
 * la pena dejar escritos:
 *
 *   - Con regex, `[^)]*` se corta en el `)` de `requiereModulo('etiquetas_qr')`
 *     y las cinco rutas de etiqueta parecian no tener el modulo: dos FALLO
 *     falsos en la primera corrida.
 *
 *   - Contando parentesis, un parentesis sin cerrar DENTRO de un literal de
 *     regex — `/(\d+)/`, `.replace(/(a|b)/g, ...)` — descuadra la cuenta, porque
 *     `\` no separa `/` de una division en JavaScript. La cuenta nunca vuelve a
 *     cero, el cierre se busca mas adelante de donde corresponde, y el extractor
 *     se come tres rutas por cada una que encuentra. En la corrida real
 *     encontro 12 de 54.
 *
 *   Lo que hace falta es solo la lista de guardas, que SIEMPRE esta entre el
 *   path y el handler y no tiene ni parentesis desbalanceados ni `=>`. Se corta
 *   en el primer `=>` y, si no hay, en el primer `(req`.
 *
 *   Y para que un caso raro no pase por alto: si el corte cayo despues del
 *   cuerpo del handler, la cola va a traer una `{` o una `=>` adentro, y eso se
 *   avisa en vez de seguir como si nada. Un extractor que a veces devuelve
 *   media ruta hace que las comprobaciones que dependen de el pasen en verde
 *   sin haber mirado nada.
 */
function extraerRutas(txt) {
    const rx = /app\.(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]*)\2/g;
    const salida = [];
    const ilegibles = [];
    let m;

    while ((m = rx.exec(txt)) !== null) {
        const desdePath = m.index + m[0].length;
        const hasta = txt.indexOf('=>', desdePath);
        const hastaReq = txt.indexOf('(req', desdePath);

        let corte;
        if (hasta === -1) corte = hastaReq;
        else if (hastaReq === -1) corte = hasta;
        else corte = Math.min(hasta, hastaReq);

        // Un tope de 300 caracteres: una cola de guardas no pasa de eso, y si
        // pasa es que el corte no sirvio y no tiene sentido seguir leyendo.
        corte = corte === -1 || corte - desdePath > 300 ? Math.min(desdePath + 300, txt.length) : corte;

        const cola = txt.slice(desdePath, corte);
        const linea = txt.slice(0, m.index).split('\n').length;

        // El corte tiene que haber caído antes del handler. Si la cola trae una
        // llave o una flecha, se leyo de mas y esta incompleta.
        if (/[{}]|=>/.test(cola)) {
            ilegibles.push(`L${linea} ${m[3]}: ${JSON.stringify(cola.slice(0, 70))}`);
        }

        salida.push({ metodo: m[1], camino: m[3], cola, linea });
        rx.lastIndex = Math.max(desdePath, corte);
    }

    return { rutas: salida, ilegibles };
}

const serverCrudo = leer(path.join(RAIZ, 'server.js'));
const server = sinComentarios(serverCrudo);

/* ==========================================================================
   1. Ninguna ruta de etiqueta queda sin sesion
   ========================================================================== */
seccion('1. Rutas de etiqueta');

const { rutas, ilegibles } = extraerRutas(server);

/* La cuenta tiene que coincidir con la de `app.<metodo>(` en el archivo. Si no
   coincide, el extractor se comio rutas y todo lo de abajo estara mirando un
   pedazo del archivo y creyendo que es todo. */
const declaradas = (server.match(/app\.(get|post|put|patch|delete)\s*\(/g) || []).length;
check(rutas.length === declaradas, `se leyeron las ${declaradas} rutas de server.js`,
    `se leyeron ${rutas.length}`);

check(ilegibles.length === 0, 'el corte de cada ruta cayo antes del cuerpo del handler',
    ilegibles.join(' | '));

/* Cuantas rutas de etiqueta hay y cuales. Se imprime porque si alguien agrega
   una ruta de etiqueta nueva y esta lista no cambia, es que no caigo en la
   mira de nadie. */
const esDeEtiquetas = (r) => /\/api\/etiquetas|\/e\//.test(r.camino);
const deEtiquetas = rutas.filter(esDeEtiquetas);

check(deEtiquetas.length > 0, `quedan ${deEtiquetas.length} rutas de etiquetas`);
console.log(`        ${deEtiquetas.map((r) => `${r.metodo.toUpperCase()} ${r.camino}`).join(', ')}`);

const sinToken = deEtiquetas.filter((r) => !/verificarToken/.test(r.cola));
check(sinToken.length === 0, 'ninguna ruta de etiqueta queda sin `verificarToken`',
    sinToken.map((r) => `${r.metodo.toUpperCase()} ${r.camino}`).join(' | '));

const sinModulo = deEtiquetas.filter((r) => !/requiereModulo\(\s*['"]etiquetas_qr['"]\s*\)/.test(r.cola));
check(sinModulo.length === 0, 'ninguna ruta de etiqueta queda sin `requiereModulo(\'etiquetas_qr\')`',
    sinModulo.map((r) => `${r.metodo.toUpperCase()} ${r.camino}`).join(' | '));

/* Las que escriben datos tienen que ser de ADMIN. Se listan a mano en vez de
   deducirse del metodo HTTP: `POST` no siempre es escribir (puede disparar una
   accion) y `PUT`/`PATCH` a veces se usan para editar. Si mañana aparece una
   ruta nueva de escritura, esta lista la va a delatar como faltante y eso es
   justo lo que hay que revisar. */
const ESCRITURAS = [
    ['POST', '/api/etiquetas/generar'],
    ['DELETE', '/api/etiquetas/:id']
];
const sinAdmin = ESCRITURAS.filter(([metodo, camino]) => {
    const r = deEtiquetas.find((x) => x.metodo === metodo.toLowerCase() && x.camino === camino);
    return r && !/requiereAdmin/.test(r.cola);
});
check(sinAdmin.length === 0, 'las rutas que escriben etiquetas exigen `requiereAdmin`',
    sinAdmin.map(([a, b]) => `${a} ${b}`).join(' | '));

/* ==========================================================================
   2. Ninguna ruta pide una base por nombre
   ========================================================================== */
seccion('2. La base la decide la sesion, no el codigo');

/* El fallo original era `obtenerPool('serviceintegralsistema')`. Se busca
   CUALQUIER nombre de base escrito a mano, no solo ese, porque el mismo error
   con el nombre de otra empresa seria igual de grave. */
const basesFijas = [...server.matchAll(/obtenerPool\(\s*(['"])([^'"]+)\1\s*\)/g)]
    .map((x) => x[2]);
check(basesFijas.length === 0, 'ninguna ruta pide una base de datos por nombre',
    `piden: ${basesFijas.join(' | ')}`);

/* Y que el servidor siga dejando pasar a quien no tiene empresa en el contexto,
   en vez de adivinar. Si esto se suaviza, aparece el otro bug.

   Y el `throw` tiene que ser ALCANZABLE. La primera corrida de las mutaciones
   metio un `return null;` justo antes: el `throw` seguia ahi, el `throw` seguia
   en el archivo, y un `includes` lo daba por bueno. Con el `return` de arriba, un
   contexto ausente devuelve `null` y el llamador sigue derecho — que es
   precisamente el cruce de datos que se esta evitando. */
const ctx = leer(path.join(RAIZ, 'src', 'db', 'tenant.js'));
check(/function contextoActual/.test(ctx), 'existe `contextoActual()`');

const cuerpoCtx = (() => {
    const d = ctx.indexOf('function contextoActual');
    if (d === -1) return '';
    let nivel = 0;
    for (let i = ctx.indexOf('{', d); i < ctx.length; i++) {
        if (ctx[i] === '{') nivel++;
        else if (ctx[i] === '}') { nivel--; if (nivel === 0) return ctx.slice(ctx.indexOf('{', d), i + 1); }
    }
    return '';
})();

check(/if\s*\(\s*!ctx\s*\)/.test(cuerpoCtx), '`contextoActual()` revisa que haya contexto');
check(/if\s*\(\s*!ctx\s*\)\s*\{\s*throw\b/.test(cuerpoCtx),
    'cuando no hay empresa en el contexto, `contextoActual()` tira error de verdad');

/* Que el throw este antes de cualquier `return`: si hay un `return` en medio del
   `if (!ctx)`, el throw es codigo muerto. */
const bloqueSinCtx = (() => {
    const m = cuerpoCtx.match(/if\s*\(\s*!ctx\s*\)\s*\{([\s\S]*?)\n\s*\}/);
    return m ? m[1] : '';
})();
check(!/\breturn\b/.test(bloqueSinCtx),
    'no hay un `return` antes del `throw`: el error se sigue lanzando',
    bloqueSinCtx.replace(/\s+/g, ' ').slice(0, 120));

check(/no adivina|Nunca adivina/i.test(ctx),
    '`contextoActual()` deja escrito que no adivina la base');

/* ==========================================================================
   3. El QR no vuelve a llevar una URL
   ========================================================================== */
seccion('3. El QR lleva solo el codigo');

const urlEnQr = [...server.matchAll(/QRCode\.\w+\(\s*([^,\n)]+)/g)].map((x) => x[1].trim());
check(urlEnQr.length > 0, `se generan ${urlEnQr.length} QR en el codigo`);

/* El nombre de la empresa no puede aparecer escrito en la respuesta. */
check(!/url_publica/.test(server), 'ninguna respuesta expone `url_publica`');
check(!/function urlPublicaBase/.test(server), 'se borro `urlPublicaBase`');

/* El QR tiene que llevar EXACTAMENTE el codigo, no "algo que tenga codigo en el
   nombre". Con un `includes` la comprobacion acepta `codigoBarrasDelProducto`, y
   eso es un fallo real: el escaner valida contra un alfabeto de 12 caracteres y
   ese valor no lo tiene. La primera corrida de las mutaciones encontro
   justamente eso — el control era tan flojo que recibio un nombre de variable
   cualquiera. */
const conUrl = urlEnQr.filter((a) => /url|publica|origin|protocol|host/i.test(a));
check(conUrl.length === 0, 'ningun QR se arma con una URL adentro',
    `se arman con: ${conUrl.join(' | ')}`);

const codigoComoQr = urlEnQr.filter((a) => /^(codigo|[\w.]+\.codigo|e\.codigo)$/.test(a));
check(codigoComoQr.length === urlEnQr.length && urlEnQr.length > 0,
    'los QR se arman con el codigo de la etiqueta y nada mas',
    `se arman con: ${urlEnQr.join(' | ')}`);

/* ==========================================================================
   4. La ruta del escaner valida el codigo con el mismo alfabeto
   ========================================================================== */
seccion('4. La ruta del escaner');

const rutaEscaner = deEtiquetas.find((r) => r.camino === '/api/etiquetas/codigo/:codigo');
check(!!rutaEscaner, 'existe `GET /api/etiquetas/codigo/:codigo`');

/* Sin esta validacion, el codigo va a un `WHERE codigo = ?` con lo que mande el
   cliente. Hoy es un `=`, que no se rompe con un `%`, pero el dia que alguien lo
   cambie por un `LIKE` para buscar "empieza por..." aparece el agujero. Se
   valida antes de tocar la base y punto. */
const validaFormato = /^\s*if \(!\/\^\[[^\]]+\]\{\d+\}\$\/\.test\(codigo\)\)/m;
check(validaFormato.test(server),
    'la ruta del escaner valida el formato del codigo contra un patron anclado',
    'no se encontro un /^[...]{N}$/ .test(codigo)');

/* El alfabeto con el que se generan los codigos y el que se valida tienen que
   ser el mismo. Si se generate con uno y se valida con otro, hay codigos que se
   pueden imprimir pero nunca se pueden escanear. */
const ALFABETO = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
const gen = server.match(/const alfabeto = '([^']+)'/);
const val = server.match(/\/\^\[([^\]]+)\]\{(\d+)\}\$\//);
check(!!gen && gen[1] === ALFABETO, `se generan con el alfabeto esperado`, gen ? `es "${gen[1]}"` : 'no se encontro');
check(!!val && val[1] === ALFABETO, 'se validan con el MISMO alfabeto con el que se generan',
    val ? `es "${val[1]}" de largo ${val[2]}` : 'no se encontro');
check(!!val && val[2] === '12', 'se validan con el mismo largo (12) con el que se generan');

/* Que devuelva los DOS juegos de numeros: el del papel y el de hoy. Si devuelve
   solo el del papel, el que escanea ve un stock viejo y no tiene forma de
   enterarse.

   Y `desactualizada` tiene que ser una COMPARACION. Con un `includes`, dejarla
   fija en `false` pasaba sin que nadie se enterara — y es justo el fallo que
   calza: el papel puede estar viejo y el escaner prometer que no. */
check(/desactualizada:\s*[^,\n]*(===|!==|<|>)/.test(server),
    'la ruta del escaner COMPARA y avisa si el papel no coincide con el catalogo');
check(!/desactualizada:\s*(true|false)\s*[,\n}]/.test(server),
    'el aviso de papel desactualizado no esta fijo en true ni en false');
check(/etiqueta:\s*\{/.test(server) && /producto:\s*\{/.test(server),
    'la ruta del escaner devuelve el snapshot del papel y los datos de hoy');

/* Que use `db`, el pool que sale de conContexto. Se comprueba en la seccion 6,
   junto con el resto de las cosas que dependen del cuerpo de una ruta, para no
   repetir el corte en dos lugares y que se puedan desincronizar. */

/* Que no haya quedado ninguna ruta publica de etiqueta, de ninguna forma. */
const publicas = rutas.filter((r) => esDeEtiquetas(r) && !/verificarToken/.test(r.cola));
check(publicas.length === 0, 'no queda ninguna ruta de etiqueta accesible sin sesion',
    publicas.map((r) => `${r.metodo.toUpperCase()} ${r.camino}`).join(' | '));

const rutasE = rutas.filter((r) => /^\/e\//.test(r.camino));
check(rutasE.length === 0, 'no queda ninguna ruta /e/...',
    rutasE.map((r) => r.camino).join(' | '));

/* ==========================================================================
   5. Ningun escape que no escapa
   ========================================================================== */
seccion('5. Reemplazos que no reemplazan');

/* El bug mas dificil de ver de toda esta tanda. El `escapeHtml` de las rutas
   eliminadas era:
       .replace(/&/g, '&')
   o sea, patron y reemplazo identicos. El texto no cambia. La funcion se llama
   `escapeHtml`, recibe HTML, y devuelve HTML con los `<script>` intactos.

   Este control es generico a proposito: revisa TODOS los `.replace()` de
   server.js y del frontend, no solo el que ya se conoce. Si alguien vuelve a
   escribir un escape roto, y si alguien escribe uno roto en cualquier otro
   lado, salta.

   Y compara el texto ESCAPADO, no el crudo. En JavaScript `'\x26'` es '&' y
   `'&'` es '&': son el mismo caracter escrito de dos maneras. Un escape roto
   escrito como `.replace(/&/g, '\x26')` no tiene nada de raro a la vista —casi
   parece un escape correcto, con el `&amp;` hiding— y solo se ve comparando lo
   que realmente produce el motor. Por eso se desescapan las dos formas antes de
   comparar. */
const desescapar = (s) => s
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([0abfnrtv0])/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] || c))
    .replace(/\\([^xu0-9])/g, '$1');

const archivosConReplace = [
    ['server.js', serverCrudo],
    ...['app.js', 'auth-check.js', 'presupuestos.js', 'admin.js', 'clientes.js',
        'pedidos.js', 'reparaciones.js', 'marca.js', 'utils-imagenes.js']
        .filter((n) => fs.existsSync(path.join(RAIZ, '..', 'frontend', n)))
        .map((n) => [n, leer(path.join(RAIZ, '..', 'frontend', n))])
];

const sinEfecto = [];
for (const [nombre, txt] of archivosConReplace) {
    // Un replace con regex literal: .replace(/algo/g, 'algo')
    for (const r of txt.matchAll(/\.replace\(\s*\/(?:\\.|\[(?:\\.|[^\]])*\]|[^\/\\])+\/([a-z]*)\s*,\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/g)) {
        const flags = r[1];
        const destino = r[3];
        // Se reconstruye el "origen" desde el patron para comparar. Solo
        // interesa el caso obvio: el destino es identico al texto que describe
        // el patron.
        const patron = r[0].slice(/\.replace\(\s*\/+/.exec(r[0])[0].length, r[0].lastIndexOf('/' + flags + ','));
        if (destino === patron || desescapar(destino) === desescapar(patron)) {
            sinEfecto.push(`${nombre}: ${JSON.stringify(destino)} en vez de ${JSON.stringify(patron)}`);
        }
    }
}
check(sinEfecto.length === 0, 'ningun `.replace()` tiene el mismo patron y el mismo reemplazo',
    sinEfecto.join(' | '));

/* Y el control complementario: si existe un `escapeHtml` (o `escHtml`, o
   `escapar`), tiene que escapar de verdad. Se busca el nombre para no
  ODEvolverlo aIntroducir como si no hiciera nada. */
const escapers = [];
for (const [nombre, txt] of archivosConReplace) {
    const cuerpo = sinComentarios(txt);
    for (const r of cuerpo.matchAll(/function\s+(\w*(?:scape|scap)\w*)\s*\([^)]*\)\s*\{([\s\S]{0,600}?)\n\}/g)) {
        const [{ 1: fn, 2: bloque }] = r;
        const reemplazos = [...bloque.matchAll(/\.replace\(\s*\/\\(.)(.*?)\/([a-z]*)\s*,\s*'([^']*)'/g)];
        if (reemplazos.length && reemplazos.every((x) => x[1] === x[4])) {
            escapers.push(`${nombre}: ${fn}() no escapa nada`);
        }
    }
}
check(escapers.length === 0, 'ninguna funcion de escape se llama asi sin escapar', escapers.join(' | '));

/* ==========================================================================
   6. Las columnas que leen las rutas existen
   ========================================================================== */
seccion('6. Las columnas que leen las rutas existen');

/* Esta seccion existe porque la ruta del escaner estuvo funcionando con los
   cuatro guardias puestos, con el modulo, sin base escrita a mano y con el QR
   del codigo solo — y devolvia 500 en TODAS las consultas. Pedia
   `p.ubicacion`, y `productos` no tiene esa columna. La ruta compilaba, los
   controles de las secciones 1 a 5 daban todos OK, y el escaner no encontraba
   ni una sola etiqueta.

   Ningun verificador de rutas puede ver eso: por separado las dos cosas estan
   bien. `p.ubicacion` no viola ninguna regla que se pueda mirar en el codigo, y
   el error es de MySQL, que no se entera hasta que alguien escanea algo. Asi
   que el verificador tiene que mirar ademas el ESQUEMA.

   El esquema esta en `backend/schema/schema-actual.sql`, que es la fuente de
   verdad y esta versionado, asi que se puede leer y comparar sin pegarle a la
   base. Y como este control ya no se puede inventar columnas, la mutacion que
   agrega una que no existe lo hace sonar. */
const esquema = leer(path.join(RAIZ, 'schema', 'schema-actual.sql'));
check(esquema.length > 0, 'se pudo leer schema/schema-actual.sql');

/** columnas de una tabla del esquema: `CREATE TABLE `x` ( ... )`. */
function columnasDe(tabla) {
    const m = esquema.match(new RegExp('CREATE TABLE `' + tabla + '`\\s*\\(([\\s\\S]*?)\\n\\)'));
    if (!m) return null;
    return new Set(
        [...m[1].matchAll(/^\s*`([^`]+)`\s/gm)].map(x => x[1])
    );
}

/** `FROM x a JOIN y b` -> { a: 'x', b: 'y' }, leyendo el cuerpo ENTERO de la ruta.
 *
 *  No se recorta el fragmento `SELECT ... FROM` para buscar los alias. En la
 *  primera version se armaba a mano ese string y se cortaba justo antes de
 *  `FROM etiquetas_qr e`, asi que no encontraba NINGUN alias y el control
 *  comparaba cero columnas — dando el verde sin haber mirado nada, que es la
 *  peor forma de fallar. Leer los alias del cuerpo completo es mas simple y no
 *  hay nada que interpretar.
 *
 *  En estas rutas `p` es siempre `productos` y `e` siempre `etiquetas_qr`, en
 *  todas las consultas, asi que un mapa por ruta no se pisa a si mismo. */
function aliasDelCuerpo(cuerpo) {
    const salida = {};
    for (const m of cuerpo.matchAll(/(?:FROM|JOIN)\s+`?(\w+)`?\s+(?:AS\s+)?(\w+)\b/gi)) {
        if (/^(ON|WHERE|GROUP|ORDER|SET|LEFT|RIGHT|INNER|OUTER|JOIN)$/i.test(m[2])) continue;
        salida[m[2]] = m[1];
    }
    return salida;
}

const RUTAS_REVISADAS = [
    '/api/etiquetas/codigo/:codigo',
    '/api/etiquetas/:id',
    '/api/etiquetas/generar',
    '/api/etiquetas'
];

const columnasQueNoExisten = [];
const selectsPorRuta = [];
let comparaciones = 0;

for (const camino of RUTAS_REVISADAS) {
    const cuerpo = cuerpoDe(camino);
    const alias = cuerpo ? aliasDelCuerpo(cuerpo) : {};
    let selects = 0;

    for (const sel of (cuerpo || '').matchAll(/SELECT([\s\S]*?)\bFROM\b/gi)) {
        selects++;
        // Se ignoran los "algo.algo" que no son alias: hay Math.round(...),
        // datos.stock_actual y cosas de JavaScript que no son SQL.
        for (const [, a, columna] of sel[1].matchAll(/\b(\w+)\.(\w+)\b/g)) {
            if (!alias[a]) continue;
            comparaciones++;

            const tabla = alias[a];
            const columnas = columnasDe(tabla);
            if (!columnas) {
                columnasQueNoExisten.push(`${camino}: la tabla "${tabla}" no esta en el esquema`);
            } else if (!columnas.has(columna)) {
                columnasQueNoExisten.push(`${camino}: "${tabla}" no tiene columna "${columna}"`);
            }
        }
    }
    selectsPorRuta.push({ camino, selects });
}

check(columnasQueNoExisten.length === 0,
    'toda columna que leen las rutas de etiqueta existe en el esquema',
    columnasQueNoExisten.join(' | '));

/* Y que el control de arriba no se este aplicando por cero y dando el verde sin
   comparar un solo nombre. Si un dia `cuerpoDe` deja de encontrar las rutas, o
   el esquema cambia de formato y `columnasDe` devuelve null para todo, el
   control pasa limpio sin haber hecho nada.

   Este control es el que hace que el de arriba sirva. Sin el, "ninguna columna
   falta" y "no mire ninguna columna" se ven exactamente igual — y asi fue como
   la primera version paso con el verde having comparado cero nombres. */
/* Y que el control de arriba se este aplicando de verdad. Sin esto, "ninguna
   columna falta" y "no mire ninguna columna" se ven exactamente igual — y asi
   fue como la primera version paso con el verde habiendo comparado CERO nombres.

   El invariante va POR RUTA: que a cada ruta de la lista se le haya encontrado
   al menos un SELECT. Con un total global, que una ruta deje de analizarse no
   se nota — las otras siguen llenando el minimo y el control da verde mientras
   no mira justo la que importa.

   Se cuentan SELECTs y no columnas a proposito: hay consultas legitimas con
   cero columnas con alias (`SELECT nombre FROM productos WHERE id = ?` no tiene
   ningun `p.`), asi que exigir columnas por ruta haria que el control bothersa
   con codigo correcto. Lo que tiene que quedar cubierto es "llegue hasta el SQL
   de esta ruta", que es lo que se rompe cuando `cuerpoDe` deja de encontrarla o
   el esquema cambia de formato. */
const sinMirar = selectsPorRuta.filter((r) => r.selects === 0);
check(sinMirar.length === 0,
    `las ${RUTAS_REVISADAS.length} rutas de etiqueta tienen su SQL localizado`,
    sinMirar.map((r) => `${r.camino}: no se encontro ningun SELECT`).join(' | '));

console.log(`        ${selectsPorRuta.map((r) => `${r.camino.split('/').pop()}: ${r.selects} select(s)`).join(', ')}`);
console.log(`        ${comparaciones} nombres de columna comparados en total`);

/* ==========================================================================
   7. El modulo existe y esta contratado por alguien
   ========================================================================== */
seccion('7. El modulo esta en el catalogo');

const migracion = path.join(RAIZ, 'migrations', 'tenant', '005_etiquetas_qr.sql');
check(fs.existsSync(migracion), 'existe la migracion `005_etiquetas_qr.sql`');
if (fs.existsSync(migracion)) {
    const sql = leer(migracion);
    check(/CREATE TABLE[\s\S]*?`etiquetas_qr`/i.test(sql), 'la migracion crea la tabla `etiquetas_qr`');
    check(/UNIQUE KEY `uq_eq_codigo`/.test(sql), 'el codigo tiene indice UNIQUE');
    check(/UNIQUE KEY `uq_eq_producto`/.test(sql), 'el producto tiene indice UNIQUE (una etiqueta viva por repuesto)');
}

/* Que el codigo que se genera no colisione dentro de una misma empresa. Si dos
   etiquetas pueden quedar activas para el mismo producto, al escanear una no se
   sabe cual es la buena.

   La comprobacion va sobre el CUERPO de la ruta generar, no sobre todo el
   archivo: hay otros dos `ON DUPLICATE KEY UPDATE` en server.js (el de
   `secuencias`, por ejemplo) y buscarlos en el archivo entero hacia que borrar
   el de etiquetas no se notara. Se Brobeo buscando el patron en server.js entero
   y la mutacion paso sin que nadie la viera. */
/* El cuerpo de una ruta se toma desde su path hasta la SIGUIENTE declaracion de
   ruta, y no parseando llaves ni parentesis.

   Se intento contar parentesis —que es lo natural— y descuadra en cuanto el
   cuerpo tiene un parentesis sin cerrar adentro de un literal de regex, porque
   en JavaScript el `/` de `/(\d+)/` es indistinguible del de una division. Un
   conteo mal desarmado hace que el corte caiga en la ruta de al lado y el
   control mire el codigo equivocado sin decir nada. Entre dos declaraciones de
   ruta el corte es exacto y no hay que interpretar nada.

   El truncado a 20000 es una red de seguridad, no una regla: si alguna vez una
   ruta fuera mas larga que eso, el corte no llegaria al final y los controles
   que dependen de elerian de menos. Con los tamanos actuales sobra. */
function cuerpoDe(camino) {
    const p = server.indexOf(`'${camino}'`);
    if (p === -1) return '';
    const siguiente = server.slice(p + 1).search(/\n\s*app\.(get|post|put|patch|delete)\s*\(/);
    const fin = siguiente === -1 ? Math.min(server.length, p + 20000) : p + 1 + siguiente;
    return server.slice(p, fin);
}

const cuerpoGenerar = cuerpoDe('/api/etiquetas/generar');
check(/ON DUPLICATE KEY UPDATE/i.test(cuerpoGenerar),
    'generar etiqueta hace upsert: no puede dejar dos activas del mismo producto');

const cuerpoEscanerRuta = cuerpoDe('/api/etiquetas/codigo/:codigo');
check(cuerpoEscanerRuta.length > 500, `el cuerpo de la ruta del escaner se leyo entero (${cuerpoEscanerRuta.length} caracteres)`);
check(/\bdb\.query\(/.test(cuerpoEscanerRuta), 'la ruta del escaner consulta con `db` (el pool de la sesion)');
check(!/\bpool\.query\(/.test(cuerpoEscanerRuta), 'la ruta del escaner no usa un `pool` suelto');
check(!/obtenerPool/.test(cuerpoEscanerRuta), 'la ruta del escaner no pide ninguna base de datos');

fin();