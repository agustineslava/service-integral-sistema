/* ==========================================================================
   VERIFICADOR: modulo de facturacion interna
   --------------------------------------------------------------------------
   Que NO prueba: que la factura se vea bien, que los importes sean correctos,
   que el comprobante imprima. Eso se mira en la pantalla.

   Que SI prueba, que es lo que se rompe solo:

     1. Que no exista ninguna ruta de factura sin sesion, sin modulo, o —las que
        mueven plata o deposito— sin `requiereAdmin`.
     2. Que ninguna ruta pida una base de datos por nombre. La base la decide
        la sesion. Escribirla a mano es como nacio la fuga de las etiquetas.
     3. Que el numero se saque AL EMITIR y no al crear el borrador, y que el
        stock se verifique entero antes de tocar el primero.
     4. Que la plata no haya vuelto a ser float, y que la formula del total sea
        la misma en el codigo y en la migracion.
     5. Que las columnas que leen las rutas existan de verdad en el esquema
        versionado.
     6. Que las rutas se despachen donde toca, en el orden en que estan.

   Correr:  node tools/ver-facturacion.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

let ok = 0;
const fallas = [];

function leer(ruta) {
    return fs.readFileSync(ruta, 'utf8');
}

function existe(ruta) {
    return fs.existsSync(ruta);
}

/**
 * Las columnas de una tabla CON SU TIPO, leidas de un dump cualquiera.
 *
 * Es distinta de la `columnasDe(tabla)` de la seccion 5, y el nombre lo dice:
 * esta devuelve una lista de `{ nombre, tipo }` y recibe el dump como segundo
 * argumento, porque tambien hay que leer el esquema CENTRAL, que esta en otro
 * archivo. La de la seccion 5 devuelve un Set de nombres y lee siempre del dump
 * del tenant.
 *
 * Dos funciones parecidas en el mismo archivo es una bomba: la segunda
 * definicion pisa a la primera sin avisar, `node --check` no dice nada porque las
 * dos son sintaxis valida, y el error aparece mucho mas lejos, como un
 * `.some is not a function` en una seccion que no tiene nada que ver.
 *
 * Se lee del ARCHIVO y no de una lista escrita a mano, por la razon de siempre:
 * una lista escrita a mano se desactualiza sin que nadie lo note, y el check
 * sigue dando OK comparando contra una copia vieja.
 *
 * Si la tabla no esta en el dump devuelve `null`, y NO un array vacio: vacio y
 * "no existe" son dos cosas distintas, y confundirlas hace que un dump roto
 * pase todos los checks.
 */
function bloqueDeTabla(tabla, dump) {
    const rx = new RegExp(
        'CREATE TABLE (?:IF NOT EXISTS )?`' + tabla + '`\\s*\\(([\\s\\S]*?)\\n\\) ENGINE',
        'i'
    );
    const m = dump.match(rx);
    return m ? m[1] : null;
}

function columnasTipadasDe(tabla, dump) {
    const bloque = bloqueDeTabla(tabla, dump);
    if (bloque === null) return null;

    const salida = [];
    for (const linea of bloque.split('\n')) {
        const col = linea.match(/^\s*`?([a-z_][a-z0-9_]*)`?\s+([A-Z]+)/i);
        if (!col) continue;
        // Las llaves de la tabla (PRIMARY KEY, UNIQUE, KEY) no son columnas.
        if (/^(PRIMARY|UNIQUE|KEY|CONSTRAINT|INDEX|FULLTEXT|SPATIAL|FOREIGN)$/i.test(col[1])) continue;
        salida.push({ nombre: col[1].toLowerCase(), tipo: col[2].toUpperCase() });
    }
    return salida;
}

/**
 * El texto SIN comentarios.
 *
 * server.js tiene comentarios largos explicando por que el numero se saca al
 * emitir y por que anular no borra. Un verificador que leyera el crudo veria
 * `UPDATE facturas SET estado = 'ANULADA'` DENTRO de un comentario y se
 * quejaria, y al reves: escribir una consulta en un comentario para explicar un
 * bug no es una consulta. Los comentarios se borran para no contarlos ni como
 * codigo ni como rutas.
 *
 * Un `//` de una linea se borra solo si no esta precededido de `:`, para no
 * romper el `://` de una URL.
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
 * Extrae las declaraciones de ruta con su cola de guardas.
 *
 * NO se parsea el parentesis de cierre con regex ni contando parentesis, y
 * estan los dos motivos probados, que valen la pena no repetir:
 *
 *   - Con regex, `[^)]*` se corta en el `)` de `requiereModulo('facturacion')`
 *     y las rutas parecen no tener el modulo: FALLO falsos.
 *   - Contando parentesis, un parentesis sin cerrar DENTRO de un literal de
 *     regex — `/(\d+)/`, `.replace(/(a|b)/g, ...)` — descuadra la cuenta,
 *     porque el `/` de un regex es indistinguible del de una division.
 *
 * Lo unico que hace falta es la lista de guardas, que siempre esta entre el
 * path y el handler, y no tiene parentesis desbalanceados ni `=>`. Se corta en
 * el primer `=>` y, si no hay, en el primer `(req`.
 *
 * Y para que el extractor no ande a ciegas: si el corte cayo despues del cuerpo
 * del handler, la cola trae una `{` o una `=>` adentro, y eso se avisa en vez de
 * seguir como si nada.
 */
function extraerRutas(txt) {
    const rx = /app\.(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]*)\2/g;
    const salida = [];
    const ilegibles = [];
    let m;

    while ((m = rx.exec(txt)) !== null) {
        const desdePath = m.index + m[0].length;
        const hastaFlecha = txt.indexOf('=>', desdePath);
        const hastaReq = txt.indexOf('(req', desdePath);

        let corte;
        if (hastaFlecha === -1) corte = hastaReq;
        else if (hastaReq === -1) corte = hastaFlecha;
        else corte = Math.min(hastaFlecha, hastaReq);

        // Tope de 300 caracteres: una cola de guardas no pasa de eso.
        corte = corte === -1 || corte - desdePath > 300
            ? Math.min(desdePath + 300, txt.length)
            : corte;

        const cola = txt.slice(desdePath, corte);
        const linea = txt.slice(0, m.index).split('\n').length;

        if (/[{}]|=>/.test(cola)) ilegibles.push(`L${linea} ${m[3]}: ${JSON.stringify(cola.slice(0, 70))}`);

        salida.push({ metodo: m[1], camino: m[3], cola, linea });
        rx.lastIndex = Math.max(desdePath, corte);
    }

    return { rutas: salida, ilegibles };
}

/**
 * El cuerpo de UNA ruta.
 *
 * El metodo va junto con el path porque `/api/facturas` y `/api/facturas/:id`
 * aparecen mas de una vez cada una —una GET y una POST, una GET y una PUT— y
 * buscar solo el path devolvia SIEMPRE la primera: los controles de la
 * creacion y de la modificacion estaban mirando el cuerpo de la de listado y
 * daban verde. No se.avisa que paso: es un extractor mas.
 *
 * El cuerpo va desde la declaracion hasta la SIGUIENTE declaracion de ruta, sin
 * parsear llaves ni parentesis: entre dos declaraciones el corte es exacto y no
 * hay nada que interpretar. Contar parentesis descuadra cuando hay un regex con
 * parentesis adentro.
 */
function cuerpoDeRuta(txt, metodo, camino) {
    const ancla = `app.${metodo.toLowerCase()}('${camino}'`;
    const p = txt.indexOf(ancla);
    if (p === -1) return '';

    const siguiente = txt.slice(p + 1).search(/\n\s*app\.(get|post|put|patch|delete)\s*\(/);
    const hasta = siguiente === -1 ? txt.length : p + 1 + siguiente;

    // Un cuerpo de menos de 60 caracteres no es un handler: el corte cayo mal.
    if (hasta - p < 60) return '';
    return txt.slice(p, hasta);
}

/** El cuerpo de una funcion o helper, desde su declaracion hasta la llave que la cierra. */
function cuerpoDeFuncion(txt, nombre) {
    const p = txt.search(new RegExp('(async\\s+)?function\\s+' + nombre + '\\s*\\('));
    if (p === -1) return '';

    const abre = txt.indexOf('{', p);
    if (abre === -1) return '';

    // Se cuenta la llave de apertura. Es seguro acá porque no hay literales de
    // regex dentro de estos helpers: son SQL y JavaScript plano.
    let nivel = 0;
    for (let i = abre; i < txt.length; i++) {
        if (txt[i] === '{') nivel++;
        else if (txt[i] === '}' && --nivel === 0) return txt.slice(p, i + 1);
    }
    return '';
}

const server = sinComentarios(leer(path.join(RAIZ, 'server.js')));

/* ==========================================================================
   1. Las rutas de factura: sesion, modulo y permisos
   ========================================================================== */
seccion('1. Las rutas de factura');

const { rutas, ilegibles } = extraerRutas(server);

const declaradas = (server.match(/app\.(get|post|put|patch|delete)\s*\(/g) || []).length;
check(rutas.length === declaradas, `se leyeron las ${declaradas} rutas de server.js`,
    `se leyeron ${rutas.length}`);

check(ilegibles.length === 0, 'el corte de cada ruta cayo antes del cuerpo del handler',
    ilegibles.join(' | '));

const deFacturas = rutas.filter((r) => /\/api\/facturas/.test(r.camino));

/* El numero de rutas esta escrito a mano y a proposito. Si alguien agrega una
   ruta de factura y esta lista no cambia, es que no caigo en la mira de nadie:
   las secciones de abajo solo mirarian las viejas. */
check(deFacturas.length === 10, `se esperaban 10 rutas de factura, hay ${deFacturas.length}`,
    deFacturas.map((r) => `${r.metodo.toUpperCase()} ${r.camino}`).join(', '));
for (const r of deFacturas) console.log(`        ${r.metodo.toUpperCase()} ${r.camino}`);

check(deFacturas.every((r) => r.cola.includes('verificarToken')),
    'ninguna ruta de factura queda sin sesion',
    deFacturas.filter((r) => !r.cola.includes('verificarToken')).map((r) => r.camino).join(' | '));

check(deFacturas.every((r) => r.cola.includes("requiereModulo('facturacion')")),
    'toda ruta de factura pide el modulo facturacion',
    deFacturas.filter((r) => !r.cola.includes("requiereModulo('facturacion')")).map((r) => r.camino).join(' | '));

/* Las rutas que mueven plata o deposito. La lista es explicita y no una regla
   tipo "la que no sea GET": el dia que haya una sexta ruta de lectura, esta
   lista tiene que cambiar a mano y el que la cambia se acuerda. */
const RUTAS_ADMIN = [
    ['POST', '/api/facturas/:id/emitir'],
    ['POST', '/api/facturas/:id/anular'],
    ['DELETE', '/api/facturas/:id']
];
for (const [metodo, camino] of RUTAS_ADMIN) {
    const r = deFacturas.find((x) => x.metodo === metodo.toLowerCase() && x.camino === camino);
    check(Boolean(r) && r.cola.includes('requiereAdmin'),
        `${metodo} ${camino} exige requiereAdmin`,
        r ? `cola: ${JSON.stringify(r.cola.slice(0, 90))}` : 'la ruta no existe');
}

/* Y que esas cuerpos se hayan leido. Una cola de guardas se puede leer sin
   problema; un cuerpo de 20 caracteres significa que el corte fallo, y todo lo
   de abajo estaria mirando un fragmento. */
for (const [metodo, camino] of [...RUTAS_ADMIN, ['POST', '/api/facturas'], ['PUT', '/api/facturas/:id']]) {
    const c = cuerpoDeRuta(server, metodo, camino);
    check(c.length > 300, `el cuerpo de ${metodo} ${camino} se leyo entero (${c.length} caracteres)`);
}

/* ==========================================================================
   2. Ninguna ruta decide la base de datos
   ========================================================================== */
seccion('2. La base la decide la sesion');

// server.js entero, no solo las rutas de factura: escribir una base a mano en
// otra parte del modulo seria el mismo error.
check(!/obtenerPool\(\s*['"`]/i.test(server),
    "server.js no abre ninguna base a mano con obtenerPool('nombre')");
check(!/pool\s*=\s*obtenerPool\(\s*['"`]/i.test(server),
    'server.js no guarda un pool en una variable');

for (const r of deFacturas) {
    const cuerpo = cuerpoDeRuta(server, r.metodo, r.camino);
    check(!/obtenerPool|conectarApp|conectarAdmin|serviceintegralsistema/.test(cuerpo),
        `${r.metodo.toUpperCase()} ${r.camino} no menciona ninguna base por nombre`,
        'la base viene del contexto de la sesion');
}

/* ==========================================================================
   3. El numero se saca al emitir, y en la misma transaccion que el stock
   ========================================================================== */
seccion('3. El numero y el stock');

const cuerpoEmitir = cuerpoDeRuta(server, 'POST', '/api/facturas/:id/emitir');
const cuerpoAnular = cuerpoDeRuta(server, 'POST', '/api/facturas/:id/anular');
const cuerpoAlta = cuerpoDeRuta(server, 'POST', '/api/facturas');
const cuerpoEditar = cuerpoDeRuta(server, 'PUT', '/api/facturas/:id');
const cuerpoBorrar = cuerpoDeRuta(server, 'DELETE', '/api/facturas/:id');
const cuerpoDescontar = cuerpoDeFuncion(server, 'descontarStockFactura');
const cuerpoDevolver = cuerpoDeFuncion(server, 'devolverStockFactura');
const cuerpoPreparar = cuerpoDeFuncion(server, 'prepararFactura');

check(cuerpoDescontar.length > 400, `el cuerpo de descontarStockFactura se leyo entero (${cuerpoDescontar.length} caracteres)`);
check(cuerpoDevolver.length > 200, `el cuerpo de devolverStockFactura se leyo entero (${cuerpoDevolver.length} caracteres)`);
check(cuerpoPreparar.length > 400, `el cuerpo de prepararFactura se leyo entero (${cuerpoPreparar.length} caracteres)`);

/* El alta NUNCA puede sacar numero. Si lo sacara, cada borrador que no se
   emite quemaria un numero y dejaria un hueco en la correlativa — y un hueco
   en una numeracion es un numero que alguien puede estar usando sin que se
   sepa de que. */
check(!/siguienteNumero/.test(cuerpoAlta),
    'crear la factura NO saca numero (sale al emitir, no al crear el borrador)');
check(/VALUES\s*\(\s*NULL\s*,/.test(cuerpoAlta),
    'el INSERT del alta guarda el numero en NULL explicitamente',
    'sin el NULL explicito, alguien podria poner el numero a mano y dos facturas emitidas lo mismo');

check(/siguienteNumero\(/.test(cuerpoEmitir), 'emitir es la ruta que saca el numero');
check(/siguienteNumero\(query\s*,\s*['"]factura['"]\)/.test(cuerpoEmitir),
    "el numero sale de la correlativa 'factura', su propia fila de `secuencias`");

/* El numero tiene que salir DENTRO de la transaccion. Fuera, una emision que
   falla en el descuento igual quema el numero, y la correlativa avanza por
   facturas que nunca salieron. */
check(/transaccion\(/.test(cuerpoEmitir), 'emitir pasa por una transaccion');

const desdeTransaccion = cuerpoEmitir.slice(cuerpoEmitir.indexOf('transaccion('));
check(desdeTransaccion.indexOf('siguienteNumero(') !== -1,
    'el numero se saca DENTRO de la transaccion, no antes');
check(/stock_descontado\s*=\s*1/.test(cuerpoEmitir),
    'emitir marca la factura como ya descontada (no descuenta dos veces)');

/* El orden importa: verificar stock, LUEGO sacar el numero. Al reves, una
   emision que no sale por falta de stock quema numero. */
const iStock = desdeTransaccion.indexOf('descontarStockFactura(');
const iNumero = desdeTransaccion.indexOf('siguienteNumero(');
check(iStock !== -1 && iNumero < iStock,
    'el numero se saca DESPUES de verificar el stock (si no, uno fallido quema numero)',
    `el stock se descuenta en la posicion ${iStock} y el numero se saca en la ${iNumero}`);

/* El descuento tiene que ser todo o nada: verificar TODOS los renglones antes
   de tocar el primero. */
check(/faltantes\.push/.test(cuerpoDescontar),
    'el descuento anota los faltantes en vez de descontar y despues fallar');

/* Y que los faltantes CORTE la emision, no solo que se anoten.
 *
 * Sin este `throw`, `if (faltantes.length) { ... }` podria quedar con el cuerpo
 * vacio y la emision saldria igual: el `UPDATE productos SET stock = stock - ?`
 * deja el deposito en negativo, el movimiento de stock registra una venta que
 * no habia existencias para hacer, y el comprobante ya salio con numero. Nada
 * mas adelante lo detecta: `anular` devuelve solo lo que `stock_descontado`
 * dejo marcado, y eso se marco igual. */
check(/if\s*\(faltantes\.length\)[\s\S]{0,400}?\bthrow\b/.test(cuerpoDescontar),
    'si falta stock, la emision se corta (no sale una venta con el deposito en negativo)');

/* El orden se mide contra el UPDATE, no contra la declaracion de `aBajar`.
   La primera version comparaba contra `cuerpo.indexOf('aBajar')`, y como
   `const aBajar = []` esta al principio de la funcion, el indice salia siempre
   antes que `faltantes.push` y el control daba FALLO con el codigo correcto —
   un fallo del control, no del modulo. Lo que decide si se toca el deposito es
   el UPDATE. */
const iFaltantes = cuerpoDescontar.indexOf('faltantes.push');
const iUpdate = cuerpoDescontar.indexOf('UPDATE productos SET stock = stock - ?');
check(iFaltantes !== -1 && iUpdate !== -1 && iFaltantes < iUpdate,
    'el descuento primero RECOLECTA los faltantes y recien despues toca el stock',
    `faltantes.push esta en la posicion ${iFaltantes} y el UPDATE en la ${iUpdate}`);
check(/UPDATE productos SET stock = stock - \?/.test(cuerpoDescontar),
    'el descuento baja el stock con una resta explicita (no GREATEST(0, ...) que ocultaria el error)');

check(/devolverStockFactura\(/.test(cuerpoAnular), 'anular devuelve el stock al deposito');
check(/stock_descontado\s*=\s*0/.test(cuerpoAnular),
    'anular deja el flag en 0 (si vuelve a emitirse, descuenta de nuevo, que es lo correcto)');

/* Anular un borrador y borrarlo son la misma operacion. Si `anular` lo
   aceptara, la palabra significaria dos cosas distintas. */
check(/estado\s*===\s*'BORRADOR'/.test(cuerpoAnular),
    'anular rechaza un borrador (para eso esta DELETE)');

/* Y una factura emitida no se edita ni se borra, nunca: conserva el numero. */
check(/estado\s*!==\s*'BORRADOR'/.test(cuerpoEditar),
    'una factura que ya salio no se puede modificar');
check(/estado\s*!==\s*'BORRADOR'/.test(cuerpoBorrar),
    'una factura que ya salio no se puede borrar (el numero no se devuelve)');

/* ==========================================================================
   4. La plata: DECIMAL en la base, sin float, y una sola formula del total
   ========================================================================== */
seccion('4. La plata');

const migracion = leer(path.join(RAIZ, 'migrations', 'tenant', '006_facturacion.sql'));

/* El acento en los nombres de columna: el patron tiene que traer el
   backtick. Sin el, el patron buscaria "subtotal DECIMAL" con un espacio en el
   medio, que en el archivo no existe, y pasaria dando verde sin comparar
   nada — el mismo falso verde que ya se dio dos veces en este proyecto. */
for (const col of ['subtotal', 'descuento', 'iva_monto', 'total']) {
    check(new RegExp('`' + col + '`\\s+DECIMAL\\(12,2\\)').test(migracion),
        `facturas.${col} es DECIMAL(12,2) en la migracion (no float)`);
    check(!new RegExp('`' + col + '`\\s+(FLOAT|DOUBLE)').test(migracion),
        `facturas.${col} no es FLOAT ni DOUBLE en la migracion`);
}

check(/`iva_porcentaje`\s+DECIMAL\(5,2\)/.test(migracion),
    'factura_items.iva_porcentaje es DECIMAL(5,2)');
check(/`cantidad`\s+DECIMAL\(12,3\)/.test(migracion),
    'factura_items.cantidad admite decimales (1,5 h de mano de obra)');
check(/`numero`\s+INT\s+NULL/.test(migracion),
    'facturas.numero admite NULL (el numero se saca al emitir)');
check(/UNIQUE KEY `uq_fact_numero`\s*\(`numero`\)/.test(migracion),
    'facturas.numero es UNIQUE: dos facturas emitidas no comparten numero');
check(/`precio_cobrado`\s+DECIMAL\(12,2\)\s+NULL/.test(migracion),
    'reparaciones.precio_cobrado admite NULL (NULL = no se cargo todavia)');

/* Que la 006 sea REAPLICABLE.
 *
 * El motor tiene ledger y se saltea lo ya aplicado, así que contra la base del
 * taller —que ya esta migrada— una migración no reaplicable no se nota nunca.
 * Se notaba al DAR DE ALTA una empresa: `altas.js` cargaba
 * `schema/schema-actual.sql` (el esquema ACTUAL, con la columna ya puesta) y
 * DESPUES corria la cadena encima. Un `ALTER ... ADD COLUMN` a secas revienta
 * con `Duplicate column name`, y el alta de la empresa moria con un error que
 * no menciona la migración ni dice que hay que rehacerla.
 *
 * ESO YA ESTA ARREGlado de otra forma: ahora el alta carga `schema/base.sql`,
 * que no tiene la columna, así que el ALTER a secas andaría bien en el alta.
 * El arreglo de raíz esta en `ver-base-esquema.js`, que arma una base con el
 * archivo que el alta carga de verdad y la compara con el taller.
 *
 * La regla de reaplicabilidad sigue en pie igual, porque este proyecto tambien
 * ARMA BASES sobre esquemas que ya la tienen, y porque una migración
 * reaplicable cuesta un IF mientras que una que no lo es revienta sin decir
 * por qué. Estos controles quedan como la red estatica que avisa antes de que
 * algo lo pruebe de la mala manera. */
check(!/^\s*ALTER\s+TABLE\s+`?reparaciones`?\s*$/im.test(migracion),
    'la 006 no tiene un ALTER TABLE a secas sobre reparaciones');
check(/information_schema\.COLUMNS/.test(migracion) && /PREPARE/.test(migracion),
    'el ALTER de la 006 esta guardado con un IF sobre information_schema (o sea, es reaplicable)',
    'MySQL no tiene ADD COLUMN IF NOT EXISTS: el IF va con SQL dinamico');
check(/precio_cobrado_ya_existe\s*>\s*0/.test(migracion),
    'el IF pregunta si la columna ya existe, no cualquier otra cosa');

/* La formula del total, escrita en los dos lugares. Son dos sistemas distintos
   —el que calcula y el que documenta— y si se desincronizan, el comprobante
   imprime una cosa y la base guarda otra. */
const FORMULA = 'subtotal - descuento + iva_monto';
check(/const total = a2\(\s*subtotal - descuento \+ iva_monto\s*\)/.test(cuerpoPreparar),
    `prepararFactura calcula el total con "${FORMULA}"`);
check(migracion.includes(FORMULA),
    `la migracion documenta la MISMA formula: "${FORMULA}"`,
    'si el codigo cambia la formula y la migracion no, el comprobante y la base dejan de coincidir');

/* El redondeo tiene que estar en CADA acumulacion, no solo en el total final.
   Si el error se juntara hasta el total, 0.1 + 0.2 todavia daria
   0.30000000000000004. Se comprueba acumulador por acumulador, no contando
   cuantos `a2(` hay en el archivo: contar es un control que pasa mientras el
   redondeo falte justo en el campo que importa. */
for (const [campo, expr] of [
    ['subtotal', 'subtotal = a2(subtotal + brutoItem)'],
    ['descuento', 'descuento = a2(descuento + desc)'],
    ['iva_monto', 'iva_monto = a2(iva_monto + ivaItem)'],
    ['el bruto de cada renglón', 'const brutoItem = a2(cant * prec)'],
    ['el neto de cada renglón', 'const neto = a2(brutoItem - desc)'],
    ['el IVA de cada renglón', 'const ivaItem = a2(neto * alicuota / 100)']
]) {
    check(cuerpoPreparar.includes(expr), `${campo} se redondea con a2() en el paso, no al final`,
        `no se encontro: ${expr}`);
}

/* Las alícuotas son tres, no un rango. Aceptar cualquier numero parece mas
   flexible y en la practica es un error esperando: alguien escribe 21,5 y la
   factura sale con el IVA callado. */
check(/const ALICUOTAS_IVA = \[0, 10\.5, 21\]/.test(server),
    'las alicuotas admitidas son exactamente 0, 10.5 y 21');
check(/ALICUOTAS_IVA\.includes\(iva_porcentaje\)/.test(cuerpoPreparar),
    'la alicuota se valida contra la lista, no contra un rango');
/* Y una alicuota invalida tiene que ser un 400 con mensaje, no una factura con
   IVA cero. Si el ternario de abajo se comiera el error y dejara 0, el control
   de `includes` seguiria dando verde y la factura saldria callada. */
check(cuerpoPreparar.includes('la IVA del ítem') || cuerpoPreparar.includes('El IVA del ítem'),
    'una alicuota fuera de la lista da error con mensaje, no se la cambia por cero');

/* ==========================================================================
   5. Las columnas que leen las rutas existen
   ========================================================================== */
seccion('5. Las columnas existen en el esquema');

const esquema = leer(path.join(RAIZ, 'schema', 'schema-actual.sql'));
check(esquema.length > 0, 'se pudo leer schema/schema-actual.sql');

function columnasDe(tabla) {
    const m = esquema.match(new RegExp('CREATE TABLE `' + tabla + '`\\s*\\(([\\s\\S]*?)\\n\\)'));
    if (!m) return null;
    return new Set([...m[1].matchAll(/^\s*`([^`]+)`\s/gm)].map((x) => x[1]));
}

/* Palabras que salen en un SELECT y NO son columnas. Sin esta lista, cada
   `SELECT` traeria `NULL`, `COALESCE` y compañía como si fueran columnas y el
   control no serviria para nada. */
const NO_COLUMNAS = new Set([
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IN', 'AS', 'ON', 'JOIN',
    'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ORDER', 'BY', 'GROUP', 'LIMIT', 'OFFSET',
    'DESC', 'ASC', 'NOW', 'COALESCE', 'GREATEST', 'LEAST', 'CAST', 'CHAR', 'IF',
    'VALUES', 'SET', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'COUNT', 'SUM', 'MAX',
    'MIN', 'AVG', 'DISTINCT', 'LIKE', 'BETWEEN', 'IS', 'CASE', 'WHEN', 'THEN',
    'ELSE', 'END', 'IFNULL', 'CONCAT', 'YEAR', 'MONTH', 'DAY', 'DATE'
]);

/* Cada nombre de columna que menciona el proyecto tiene que existir en la tabla
   de la que dice leerla.
 *
 * POR QUE NO ALIAS: la version de las etiquetas solo miraba `alias.columna`,
 * porque sus rutas usan `JOIN productos p`. Las de facturas NO usan alias
   (`SELECT id, numero FROM facturas`), asi que con ese mecanismo no se
 * comparaba ni un solo nombre y el control pasaba en verde sin haber mirado
   nada. Es el mismo falso verde que ya se dio dos veces, y por eso aca se
 * cuentan las comparaciones y se avisa si son pocas.
 *
 * Con JOIN de varias tablas, un nombre se acepta si esta en ALGUNA de ellas.
 * Es mas laxo que comprobarlo contra la tabla exacta, y es lo correcto para
 * este caso: lo que se busca es el nombre que MySQL no tiene en ninguna de las
 * tablas de la consulta, que es exactamente lo que devuelve un 500 en runtime. */
const problemasColumna = [];
let comparaciones = 0;
const porRuta = [];

for (const r of deFacturas) {
    const cuerpo = cuerpoDeRuta(server, r.metodo, r.camino);
    const firma = `${r.metodo.toUpperCase()} ${r.camino}`;
    let selects = 0;

    for (const sel of cuerpo.matchAll(/SELECT([\s\S]*?)\bFROM\s+`?(\w+)`?([\s\S]*?)(?=\n\s*(?:WHERE|ORDER|GROUP|LIMIT|VALUES|SET|\)|`|$))/gi)) {
        selects++;

        const tablas = new Set([sel[2]]);
        for (const j of sel[3].matchAll(/\bJOIN\s+`?(\w+)`?/gi)) tablas.add(j[1]);

        const disponibles = new Set();
        for (const t of tablas) {
            const cols = columnasDe(t);
            if (!cols) {
                problemasColumna.push(`${firma}: la tabla "${t}" no esta en el esquema`);
                continue;
            }
            for (const c of cols) disponibles.add(c);
        }

        // Identificadores de la lista del SELECT. Uno seguido de `(` es una
        // llamada a funcion —`COUNT(`, `NOW(`— y no una columna.
        for (const palabra of sel[1].matchAll(/`?([A-Za-z_]\w*)`?/g)) {
            const id = palabra[1];
            if (NO_COLUMNAS.has(id.toUpperCase())) continue;
            if (sel[1][palabra.index + palabra[0].length] === '(') continue;

            comparaciones++;
            if (!disponibles.has(id)) {
                problemasColumna.push(`${firma}: ninguna de las tablas (${[...tablas].join(', ')}) tiene columna "${id}"`);
            }
        }
    }
    porRuta.push({ firma, selects });
}

check(problemasColumna.length === 0,
    'toda columna que leen las rutas de factura existe en el esquema',
    problemasColumna.join(' | '));

/* Y que el control de arriba se este aplicando de verdad: "ninguna columna
   falta" y "no mire ninguna columna" se ven exactamente igual.
 *
   El minimo es GLOBAL y no por ruta a proposito. Por ruta seria un falso
   comfort: `POST /api/facturas` y `POST /api/facturas/:id/pagar` no tienen
   ningun SELECT de columnas —solo un `SELECT *` o un `SELECT COUNT(*)`— y
   exigirles comparaciones haria que el control bothersa con codigo correcto. */
check(comparaciones >= 40,
    `el control de columnas comparo ${comparaciones} nombres (no esta pasando por arriba)`,
    `solo comparo ${comparaciones}. Las rutas de factura no usan alias de tabla, asi que si ` +
    'el extractor de SELECT dejo de encontrar las listas, este control pasa limpio sin mirar nada.');
console.log(`        ${porRuta.filter((r) => r.selects).map((r) => `${r.firma}: ${r.selects}`).join('\n        ')}`);

/* `productos.stock` es INT: una cantidad fraccionaria no se puede escribir en
   el deposito. Redondear en silencio convertiria una venta de 2,5 en una de 2
   sin que nadie lo vea, que es el tipo de error de inventario que despues
   nadie puede reconstruir. */
check(/`stock`\s+int/i.test(esquema),
    'productos.stock es un entero (por eso una cantidad fraccionaria no puede bajar stock)');
check(/`cantidad_afectada`\s+int/i.test(esquema),
    'movimientos_stock.cantidad_afectada es un entero, por lo mismo');
check(/!Number\.isInteger\(cantidad\)/.test(cuerpoDescontar),
    'la emision RECHAZA un renglon con producto y cantidad fraccionaria, en vez de redondearla');

/* Que la cantidad se convierta a numero antes de decidir si es entera.
 *
 * Este control existe porque el verificador y el arnés de mutaciones dicen los
 * dos que `cantidad` es un número, y no lo es en runtime: `cantidad` es
 * DECIMAL(12,3) y mysql2 devuelve los DECIMAL como texto. Un renglón de 2
 * unidades llega como "2.000", `Number.isInteger("2.000")` da `false`, y TODA
 * factura con producto se rechazaba al emitir con un mensaje que decía que 2
 * unidades no eran enteras. Ninguno de los dos controles de texto lo puede ver:
 * no hay texto que mirar. Lo que lo encontró fue correr la consulta de verdad.
 *
 * Por eso el invariante sale de cruzar el ESQUEMA con el codigo: DECIMAL en la
 * migracion significa texto en JavaScript, y donde se decide si la cantidad es
 * entera tiene que haber un `Number(...)` antes. */
const cuerpoCantidad = cuerpoDeFuncion(server, 'cantidadDeRenglon');
check(cuerpoCantidad.length > 80,
    `se leyo el cuerpo de cantidadDeRenglon (${cuerpoCantidad.length} caracteres)`);
check(/Number\(\s*it\.cantidad\s*\)/.test(cuerpoCantidad),
    'la cantidad del renglon se convierte con Number() antes de usarla',
    'DECIMAL(12,3) vuelve de MySQL como texto "2.000", no como 2');
check(cuerpoDescontar.includes('cantidadDeRenglon('),
    'el descuento de stock pasa la cantidad por el conversor');
check(cuerpoDevolver.includes('cantidadDeRenglon('),
    'la devolucion de stock tambien convierte la cantidad (si no, suma "2.000" al deposito)');

/* Que el dump este al dia con la migracion.
 *
 * La seccion de arriba lee el ARCHIVO .sql de la migracion. Este lee el DUMP. No
 * es al reveso por redundancia: son dos cosas que se desincronizan solas. La
 * migracion queda escrita y aplicada, y el dump solo se regenera cuando alguien
 * se acuerda — con `node tools/dump-schema.js`. Si no se regenera, el archivo
 * que el verificador de columnas mira no tiene la columna nueva, ese control
 * deja de mirar esa tabla y da verde, y el reporte de rentabilidad consulta
 * una columna que el verificador no encuentra.
 *
 * Con la columna `precio_cobrado` el costo de eso es concreto: sin el NULL, el
 * reporte no puede distinguir "no se cargo todavia" de "se cobraron 0", y
 * muestra 0 de ganancia en reparaciones que nadie completo — un numero que
 * parece verdad y no lo es. */
check(/`precio_cobrado`\s+decimal\(12,2\)\s+NULL/i.test(esquema),
    'el dump del esquema ya tiene la columna nueva de reparaciones (se regenero tras la 006)',
    'falta correr:  node tools/dump-schema.js');
check(/CREATE TABLE `facturas`/.test(esquema) && /CREATE TABLE `factura_items`/.test(esquema),
    'el dump del esquema ya tiene las dos tablas de facturacion');

/* ==========================================================================
   6. Las rutas se despachan donde toca
   ========================================================================== */
seccion('6. El orden de las rutas');

/* `POST /api/facturas/desde-presupuesto/:presupuestoId` esta registrada al
   FINAL, despues de `/api/facturas/:id/emitir`. Se podria leer que `:id` se
   traga el "desde-presupuesto" y que la ruta nunca se alcanza.
 *
 * No se supone: se levanta una app de Express con EL MISMO orden de registro
   que tiene server.js y se mandan las cuatro URLs, mirando cual handler
   respondio. Esta comprobacion ya fallo una vez por otra razon —comparaba
   contra las dos claves (`id` y `pid`) a la vez, y como cada handler devuelve
   el numero en una distinta, `undefined === 82` daba falso y reportaba un
   despacho correcto como roto. Por eso se mira la que este, no las dos. */
(async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());

    for (const r of deFacturas) {
        app[r.metodo](r.camino, (req, res) => {
            res.json({
                ruta: `${r.metodo.toUpperCase()} ${r.camino}`,
                params: req.params
            });
        });
    }

    const pruebas = [
        ['post', '/api/facturas/desde-presupuesto/82', 'POST /api/facturas/desde-presupuesto/:presupuestoId', { presupuestoId: '82' }],
        ['post', '/api/facturas/7/emitir', 'POST /api/facturas/:id/emitir', { id: '7' }],
        ['post', '/api/facturas/7/anular', 'POST /api/facturas/:id/anular', { id: '7' }],
        ['post', '/api/facturas/7/pagar', 'POST /api/facturas/:id/pagar', { id: '7' }],
        ['get', '/api/facturas/7', 'GET /api/facturas/:id', { id: '7' }],
        ['get', '/api/facturas/7/comprobante', 'GET /api/facturas/:id/comprobante', { id: '7' }],
        ['put', '/api/facturas/7', 'PUT /api/facturas/:id', { id: '7' }],
        ['delete', '/api/facturas/7', 'DELETE /api/facturas/:id', { id: '7' }],
        ['get', '/api/facturas', 'GET /api/facturas', {}],
        ['post', '/api/facturas', 'POST /api/facturas', {}]
    ];

    const servidor = app.listen(0);
    const puerto = servidor.address().port;

    try {
        for (const [metodo, url, esperada, paramsEsperados] of pruebas) {
            const r = await fetch(`http://127.0.0.1:${puerto}${url}`, {
                method: metodo,
                headers: { 'Content-Type': 'application/json' },
                body: metodo === 'get' || metodo === 'delete' ? undefined : '{}'
            });
            const cuerpo = await r.json();

            const mismaRuta = cuerpo.ruta === esperada;
            const mismosParams = JSON.stringify(cuerpo.params) === JSON.stringify(paramsEsperados);
            const ok = mismaRuta && mismosParams;

            check(ok, `${metodo.toUpperCase()} ${url} llega a ${esperada}`,
                ok ? '' : `respondio ${cuerpo.ruta} con ${JSON.stringify(cuerpo.params)}`);
        }
    } finally {
        servidor.close();
    }

    /* ==========================================================================
       7. El modulo esta en el catalogo
       ========================================================================== */
    seccion('7. El modulo esta en el catalogo');

    const central = leer(path.join(RAIZ, 'migrations', 'central', '002_catalogos.sql'));
    check(/facturacion/.test(central), 'el modulo `facturacion` esta en el catalogo central');

    /* ==========================================================================
       8. La pantalla de facturacion

       Esta seccion se escribio DESPUES de que la pagina existiera. Antes habia
       un check que decia "aun NO hay pantalla de facturacion enlazada", que
       hacia fallar al verificador en cuanto se agrego la pagina: al obligar a
       agregar checks de verdad, el verificador no puede quedarse viejo sin que
       se note.

       Y hay una razon de fondo para que esta seccion sea la mas estricta del
       archivo: aca no se puede verificar por el esquema ni por las rutas del
       servidor. Lo unico que hay son los caracteres del `.js` del navegador. Un
       nombre de columna mal escrito no da error de sintaxis ni error de
       ejecucion: da `undefined`, se muestra "undefined" y la pagina anda. Y ya
       se perdio una vez una columna asi en este proyecto (el escaner de
       etiquetas pedia `p.ubicacion`, que no existe: 500 en cada consulta).
       ========================================================================== */
    seccion('8. La pantalla de facturacion');

    const FRONT = path.join(RAIZ, '..', 'frontend');

    check(existe(path.join(FRONT, 'facturacion.html')), 'existe facturacion.html');
    check(existe(path.join(FRONT, 'facturacion.js')), 'existe facturacion.js');
    check(existe(path.join(FRONT, 'facturacion.css')), 'existe facturacion.css');

    const fHtml = leer(path.join(FRONT, 'facturacion.html'));
    const fJs = sinComentarios(leer(path.join(FRONT, 'facturacion.js')));
    const fCss = leer(path.join(FRONT, 'facturacion.css'));
    const pJs = sinComentarios(leer(path.join(FRONT, 'presupuestos.js')));

    /* --- Cada boton de la pagina llama a algo que existe ------------------
       ESTE CHECK SE ESCRIBIO POR DOS BOTONES ROTOS QUE SALIERON EN EL
       NAVEGADOR, NO POR UNA SOSPECHA.

       facturacion.html es una copia de presupuestos.html. Al copiar, los
       `onclick` se dejaron como estaban (`guardar()`, `cerrarDetalle()`) y las
       funciones del `.js` se les puso el sufijo `Factura`
       (`guardarFactura()`, `cerrarDetalleFactura()`). El boton de guardar
       tiraba `ReferenceError: guardar is not defined` y el de cerrar el
       detalle `cerrarDetalle is not defined`: el boton no hacia nada, en
       silencio, y el formulario se podia abrir pero no cerrar.

       Por que se le escapa al resto del archivo? Porque todos los otros checks
       de esta seccion miran el `.js`: que la funcion exista, que llame a la ruta
       correcta, que mande los items. Las dos estaban perfectas. El nombre
       roto estaba del otro lado de un atributo, en el `.html`, y nada lo
       cruzaba con el `.js`. Un archivo que se verifica solo no encuentra esta
       clase de error: hay que comparar los dos.

       Se miran los cuatro atributos de evento en linea, no solo `onclick`,
       porque `onchange` y `onsubmit` tienen el mismo problema y el mismo
       silencio. */
    const aJs = sinComentarios(leer(path.join(FRONT, 'auth-check.js')));

    const definidasEnJs = (txt) => {
        const salida = new Set();
        for (const m of txt.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g)) salida.add(m[1]);
        for (const m of txt.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/g)) salida.add(m[1]);

        /* Y los que se cuelgan de `window`.

           Faltaban en la primera version, y el check acuso justo al que se
           usa en las siete paginas: `cambiarTemaManualmente` esta escrito como
           `window.cambiarTemaManualmente = function cambiarTemaManualmente`
           en auth-check.js, y con el "window." adelante la funcion no arranca
           en el principio de la linea y el extractor no la veia. */
        for (const m of txt.matchAll(/\bwindow\.([a-zA-Z0-9_$]+)\s*=/g)) salida.add(m[1]);

        /* Lo que NO se acepta, y por que, aunque se ve tentador.

           Se podia agregar tambien "el nombre de la funcion de la expresion":
           `=\s*function\s+(nombre)` acepta `window.x = function y(){}` y
           agrega `y`. Se puso, y la mutacion que renombra
           `window.cambiarTemaManualmente` a `window.cambiarTema` NO la agarro,
           porque `y` seguia apareciendo en el archivo. Es decir: el extractor
           dizia "existe" para un nombre que en la pagina NO existe.

           Y no existe, porque una expresion de funcion con nombre solo tiene
           su propio nombre DENTRO de si misma. `window.x = function y(){}`
           deja `x` en el objeto global y `y` en ningun lado de la pantalla: un
           `onclick="y()"` da ReferenceError. Un onclick solo ve globales, y
           esta lista tiene que ser de globales y nada mas. Si se acepta el
           nombre de mas, el check se auto-absuelve justo cuando el boton esta
           roto. */
        return salida;
    };

    const funcionesJs = new Set([...definidasEnJs(fJs), ...definidasEnJs(aJs)]);
    check(funcionesJs.size > 0, 'se leyeron las funciones de los .js de la pagina',
        `fJs aporto ${definidasEnJs(fJs).size} y auth-check.js aporto ${definidasEnJs(aJs).size}`);

    const llamadasDeLaPagina = new Map();
    for (const m of fHtml.matchAll(/\son(click|change|input|submit)\s*=\s*"([^"]*)"/g)) {
        const cuerpo = m[2];
        for (const llamada of cuerpo.matchAll(/([a-zA-Z0-9_$]+)\s*\(/g)) {
            const nombre = llamada[1];
            if (['if', 'return', 'typeof', 'await', 'confirm', 'alert'].includes(nombre)) continue;
            if (!llamadasDeLaPagina.has(nombre)) llamadasDeLaPagina.set(nombre, m[1]);
        }
    }

    check(llamadasDeLaPagina.size > 0,
        `la pagina tiene ${llamadasDeLaPagina.size} funciones llamada desde el HTML`,
        'si no se encuentra ninguna llamada en linea, los checks siguientes pasan por vacuidad.');

    const inexistentes = [...llamadasDeLaPagina.entries()]
        .filter(([nombre]) => !funcionesJs.has(nombre))
        .map(([nombre, evento]) => `${nombre}() (en on${evento})`)
        .sort();
    check(inexistentes.length === 0,
        `las ${llamadasDeLaPagina.size} funciones que el HTML llama existen en facturacion.js o auth-check.js`,
        `no estan definidas: ${inexistentes.join(', ')}. El boton queda sin hacer nada y no hay error.`);

    /* --- El tema se aplica antes de que el navegador pinte nada ---------- */
    const cabezaF = fHtml.slice(0, fHtml.search(/<body/i));
    check(/<script[^>]*auth-check\.js/.test(cabezaF),
        'facturacion.html carga auth-check.js en el <head>',
        'si se carga despues del <body>, el tema se aplica tarde y se ve el del sistema un instante antes.');

    /* --- La hoja de tema se carga DESPUES de las de los documentos ---------
       Se chequea el orden de verdad, no que esten presentes: si `facturacion.css`
       entrara antes de `presupuestos.css`, las reglas de `f-neto-calc` y
       `f-tabla-items` (que pisan padding de celdas) perderian contra las
       comunes y la tabla quedaria desalineada. El orden es la dependencia. */
    const ordenHojas = [...fHtml.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    const posPresupuestos = ordenHojas.findIndex((h) => h.startsWith('presupuestos.css'));
    const posFacturacion = ordenHojas.findIndex((h) => h.startsWith('facturacion.css'));
    check(posPresupuestos >= 0 && posFacturacion >= 0 && posPresupuestos < posFacturacion,
        'facturacion.css se carga DESPUES de presupuestos.css',
        `orden real: ${JSON.stringify(ordenHojas)}`);

    /* --- Las alicuotas del navegador y las del servidor, la misma lista ----
       Comparacion real de los dos archivos. Si el servidor agrega una alicuota y
       el `<select>` del navegador no, el usuario no puede elegirla; y si el
       navegador ofrece una que el servidor no acepta, la pantalla deja guardar
       y despues el servidor la rechaza con un 400 que nadie entiende. */
    const ALICUOTAS_BACKEND = server.match(/const ALICUOTAS_IVA\s*=\s*\[([^\]]+)\]/);
    const ALICUOTAS_FRONT = fJs.match(/const ALICUOTAS\s*=\s*\[([^\]]+)\]/);
    check(!!ALICUOTAS_BACKEND, 'se encontro la lista ALICUOTAS_IVA del servidor');
    check(!!ALICUOTAS_FRONT, 'se encontro la lista ALICUOTAS del navegador');

    if (ALICUOTAS_BACKEND && ALICUOTAS_FRONT) {
        const leerAlicuotas = (txt) => txt.split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
        const back = leerAlicuotas(ALICUOTAS_BACKEND[1]).sort((a, b) => a - b);
        const front = leerAlicuotas(ALICUOTAS_FRONT[1]).sort((a, b) => a - b);

        check(back.length > 0 && front.length > 0,
            'las dos listas de alicuotas tienen elementos (comparacion no vacia)',
            `backend=${JSON.stringify(back)} navegador=${JSON.stringify(front)}`);
        check(JSON.stringify(back) === JSON.stringify(front),
            'las alicuotas del navegador son las mismas que las del servidor',
            `backend=${JSON.stringify(back)} navegador=${JSON.stringify(front)}`);
        check(back.includes(21) && back.includes(0),
            'las alicuotas incluyen 21% y 0%',
            `backend=${JSON.stringify(back)}`);
    }

    /* El `<select>` se arma recorriendo la lista, no con `<option>` escritas a
       mano. Si alguien las escribe a mano, la lista de arriba deja de mandar y
       el check de igualdad pasa igual: por eso se mira el `<select>` de IVA.

       Y se mira ESE `<select>`, no el archivo entero. La primera version busco
       `ALICUOTAS.map(` en facturacion.js entero, y hay dos: uno arma las
       `<option>` y otro arma el texto del aviso de una alicuota invalida. Al
       cambiar el que hace falta, el otro seguia dejando el check en verde. Es el mismo
       error de los extractores que se trigonometrican con si mismos: un match
       en cualquier parte del archivo no dice que sea el match que importa. */
    const bloqueAlicuotas = (fJs.match(
        /<select[^>]*data-campo="iva_porcentaje"[\s\S]{0,700}?<\/select>/
    ) || [''])[0];

    check(bloqueAlicuotas.length > 0,
        'se encontro el <select> de alicuotas',
        'si no se encuentra el select, el check de las <option> pasa por vacuidad.');
    check(/\bALICUOTAS\.map\(/.test(bloqueAlicuotas),
        'las opciones de IVA se generan recorriendo ALICUOTAS',
        'si las <option> estan escritas a mano, agregar una alicuota al backend no alcanza para que aparezca.');
    check(/<option/.test(bloqueAlicuotas),
        'el <select> de alicuotas genera por lo menos una <option>');
    check(!/<option value="(21|10\.5|0)"/.test(fHtml),
        'la pagina no tiene <option> de IVA escritas a mano',
        'la unica fuente de las opciones de IVA tiene que ser ALICUOTAS.');

    /* --- Los estados: los mismos cuatro, en los dos lados ------------------
       NOTA sobre como se saca el cuerpo del objeto: `txt.match(re)` devuelve UN
       array (el match entero y sus grupos), no una lista de matches. Hacerle
       spread y despues `.map(m => m[1])` parece razonable y no lo es: reparte
       los ELEMENTOS de ese array, o sea la cadena completa y la del grupo, y
       `m[1]` de cada una es el caracter numero 1. Devolvio 'r' y el check
       comparo cuatro letras contra nada, dando un OK falso. */
    const mEstadosBack = server.match(/const ESTADO_FACTURA\s*=\s*\{([\s\S]*?)\}/);
    const mEstadosFront = fJs.match(/const ETIQUETAS_FACTURA\s*=\s*\{([\s\S]*?)\}/);
    const estadosBack = mEstadosBack ? mEstadosBack[1] : '';
    const estadosFront = mEstadosFront ? mEstadosFront[1] : '';
    const claves = (txt) => [...txt.matchAll(/^\s*([A-Z_]+)\s*:/gm)].map((m) => m[1]).sort();

    check(!!mEstadosBack, 'se encontro el objeto ESTADO_FACTURA del servidor');
    check(!!mEstadosFront, 'se encontro el objeto ETIQUETAS_FACTURA del navegador');

    const eBack = claves(estadosBack);
    const eFront = claves(estadosFront);
    check(eBack.length > 0, `se encontraron los estados del servidor (${eBack.length})`);
    check(eFront.length > 0, `se encontraron los estados del navegador (${eFront.length})`);
    check(JSON.stringify(eBack) === JSON.stringify(eFront),
        'los estados del navegador son los mismos que los del servidor',
        `servidor=${JSON.stringify(eBack)} navegador=${JSON.stringify(eFront)}`);

    /* El `<select>` de filtro y las clases CSS de cada estado. Si el servidor
       suma un estado, el navegador no lo muestra con fondo y el listado queda
       con una etiqueta pelada en el medio.

       Las clases se buscan en TODAS las hojas que carga la pagina, no solo en
       `facturacion.css`: `.p-estado-borrador` vive en `presupuestos.css`, que
       esta pagina carga justamente para no duplicarla. Buscar solo en la hoja
       propia daba un FALLO que estaba equivocado. */
    const hojasDeLaPagina = ordenHojas
        .map((h) => h.split('?')[0])
        .map((h) => path.join(FRONT, h))
        .filter((r) => existe(r))
        .map((r) => leer(r))
        .join('\n');

    check(hojasDeLaPagina.length > 0,
        `se leyeron las hojas que carga la pagina (${ordenHojas.length})`);

    const opcionesFiltro = [...fHtml.matchAll(/<option value="([A-Z_]+)"/g)].map((m) => m[1]);
    for (const e of eBack) {
        check(opcionesFiltro.includes(e), `el filtro de estado ofrece ${e}`);
        check(new RegExp('\\.p-estado-' + e.toLowerCase() + '\\s*\\{').test(hojasDeLaPagina),
            `existe la clase .p-estado-${e.toLowerCase()}`);
    }

    /* --- Que la pantalla escriba algo -------------------------------------
       El aviso de que esto NO es una factura fiscal tiene que estar en DOS
       lugares y con el mismo texto: en la pantalla y en el papel. El papel es
       el que se le da al cliente y el que puede quedar en un archivo; si el
       aviso estuviera solo en la aplicacion, la hoja impresa sale como si fuera
       un comprobante mas. */
    const avisosHtml = (fHtml.match(/No es facturación electrónica/g) || []).length;
    const avisosJs = (fJs.match(/No es facturación electrónica/g) || []).length;
    check(avisosHtml >= 1, 'la pantalla avisa que no es facturación electrónica');
    check(avisosJs >= 1, 'la hoja imprimible avisa que no es facturación electrónica',
        'si el aviso esta solo en la pantalla, el papel que se le entrega al cliente no dice nada.');
    /* El aviso tiene que decir las dos cosas: que no es electronica y que no es
       fiscal. Se buscan las dos formas ("comprobante fiscal" y "comprobantes
       fiscales") porque en un aviso el sujeto puede ser en singular o en plural
       y las dos frases son correctas: en la pantalla el sujeto son "estos
       comprobantes" y en el papel es "comprobante". Lo que no se negocia es que
       la palabra "fiscal" aparezca. */

    /* El mismo aviso, en el mismo lugar, con el mismo texto. Comparacion de los
       dos bloques, no de dos palabras sueltas. El bloque va PRIMERO porque los
       dos checks de abajo lo usan. */
    const bloqueAviso = (txt) => (txt.match(/No es facturación electrónica[\s\S]{0,420}/) || [''])[0];

    /* Buscar la palabra "fiscal" no alcanza, por dos motivos.

       El primero es que la palabra no dice la negacion: "este papel ES un
       comprobante fiscal" tiene la palabra y es exactamente el papel que no se
       quiere imprimir. Con el check viejo, cambiar el aviso de "no es" a "es"
       daba verde.

       El segundo es DONDE se busca: la primera version busco en el archivo
       entero, y en facturacion.js hay un comentario que explica el aviso y lo
       dice con las mismas palabras. Ese comentario esta en el archivo, el aviso
       del papel no, y el check no los distingue: con el aviso impreso borrado,
       el comentario lo hacia pasar.

       Por eso se busca DENTRO del bloque del aviso, y se exige la negacion
       adelante, en la misma oracion.

       Y solo `no`, no `ni` ni `sin`: el aviso dice "no tiene CAI ni punto de
       venta y no es un comprobante fiscal", y la palabra "ni" de esa misma
       frase queda a menos de 40 caracteres de "comprobante fiscal". Aceptarla
       como negacion hace que el check siga dando verde con la frase Dada vuelta. */
    const diceFiscal = (txt) => {
        const bloque = bloqueAviso(txt);
        const m = /comprobantes?\s+fiscals?/i.exec(bloque);
        if (!m) return false;
        return /\bno\b/i.test(bloque.slice(Math.max(0, m.index - 40), m.index));
    };
    check(diceFiscal(fHtml), 'la pantalla dice que no es un comprobante fiscal');
    check(diceFiscal(fJs), 'la hoja imprimible dice que no es un comprobante fiscal');

    const palabrasAviso = (txt) => (txt.toLowerCase().match(/[a-záéíóúñ]{4,}/g) || []);
    const palabrasHtml = palabrasAviso(bloqueAviso(fHtml));
    const palabrasJs = palabrasAviso(bloqueAviso(fJs));
    const comunes = palabrasHtml.filter((p) => palabrasJs.includes(p));
    check(palabrasHtml.length > 0 && comunes.length >= 6,
        'el aviso de la pantalla y el del papel dicen lo mismo',
        `solo ${comunes.length} palabras en comun entre los dos avisos`);

    /* --- Nada de importes calculados en el navegador ---------------------- */
    const bloqueGuardar = cuerpoDeFuncion(fJs, 'guardarFactura');
    check(!!bloqueGuardar, 'se encontro la funcion guardarFactura()');
    check(bloqueGuardar.includes("apiFetch('/api/facturas") || bloqueGuardar.includes('`/api/facturas'),
        'guardarFactura() manda a /api/facturas');
    check(bloqueGuardar.includes("method: F.editandoId ? 'PUT' : 'POST'"),
        'guardarFactura() elige PUT si esta editando y POST si es nueva');

    /* El cuerpo que se manda no lleva los importes. Si los llevara, el servidor
       los vuelve a calcular igual (por eso no es un agujero de seguridad), pero
       mandarlos es mandarle unaopinion que el servidor no escucha: el dia que
       el calculo cambie, el navegador queda desfasado en silencio. */
    const cuerpoPost = (bloqueGuardar.match(/const cuerpo = \{([\s\S]*?)\n    \};/) || [, ''])[1];
    check(cuerpoPost.length > 100, 'se encontro el cuerpo que se manda en guardarFactura()',
        'el extractor del cuerpo no matcheo nada: el check de importes pasa por vacuidad');
    for (const prohibido of ['total:', 'subtotal:', 'iva_monto:', 'numero:', 'estado:']) {
        check(!new RegExp('(^|[\\s{,])' + prohibido, 'm').test(cuerpoPost),
            `el cuerpo que se manda NO lleva "${prohibido}"`,
            'los importes los calcula el servidor; mandarlos es mandar una copia que el servidor ignora.');
    }
    check(/items:\s*F\.items\.map/.test(cuerpoPost),
        'el cuerpo que se manda lleva los items con items: F.items.map');

    /* --- Lo que la hoja imprimible usa viene del servidor -----------------
       La hoja se arma con lo que devuelve `/comprobante`, no con lo que hay en
       la pantalla. Si se armara con el objeto del listado, al abrir una factura
       sin tocar la lista se imprimiria sin las lineas que recien se cargaron. */
    const bloqueComprobante = cuerpoDeFuncion(fJs, 'dibujarComprobanteFactura');
    check(!!bloqueComprobante, 'se encontro dibujarComprobanteFactura()');
    check(!bloqueComprobante.includes('recalcularFactura'),
        'la hoja imprimible NO recalcula los importes',
        'si recalculara, se imprimiria lo que calculo el navegador y no lo que guardo el servidor.');
    check(/F\.detalle/.test(bloqueComprobante),
        'la hoja imprimible se arma desde F.detalle (la respuesta de /comprobante)');

    /* --- Facturar desde un presupuesto ------------------------------------ */
    check(/apiFetch\(`\/api\/facturas\/desde-presupuesto\/\$\{id\}`/.test(pJs),
        'presupuestos.js llama a /api/facturas/desde-presupuesto/:id');
    check(/facturacion\.html\?nuevo=/.test(pJs),
        'presupuestos.js pasa el id de la factura nueva a facturacion.html',
        'sin esto se crea la factura y el usuario queda buscando un numero que todavia no existe.');

    /* El boton va solo con el presupuesto APROBADO y solo si la empresa
       contrato el modulo. Las dos condiciones, no una: la primera es una regla
       de negocio, la segunda es que el modulo no aparezca a una empresa que no
       lo pago. */
    const bloqueBotones = (pJs.match(/if \(p\.estado === 'APROBADO' && tieneModulo\('facturacion'\)\) \{[\s\S]{0,200}/) || [''])[0];
    check(!!bloqueBotones,
        'el boton Facturar exige presupuesto APROBADO y modulo facturacion',
        'se busco: if (p.estado === \'APROBADO\' && tieneModulo(\'facturacion\'))');

    /* ==========================================================================
       8-bis. Las columnas que lee la hoja, contra el esquema de verdad

       Esta es la seccion que mas cara sale si falta, y por eso va aparte de las
       comparaciones de rutas.

       En el backend, una columna mal escrita no se ve: el `SELECT` la pide y la
       base no la tiene, y eso se ve recien en el 500 que produce la consulta. En
       el navegador es PEOR: `SELECT *` devuelve el objeto de la fila, y una
       columna que no existe no da error, da `undefined`. `undefined` en una
       tabla se muestra como la palabra "undefined", la pantalla no se rompe, el
       boton de guardar anda, y el usuario ve una factura con el cliente en
       blanco. Nadie se entera hasta que alguien imprime el papel.

       Y ya se perdio una vez en este proyecto, que es lo que justifies que esto
       sea un check y no una recomendacion: el escaner de etiquetas pedia
       `p.ubicacion`, una columna que no existe. Todas las guardas estaban bien,
       el modulo estaba bien, y cada consulta daba 500.

       Por eso las columnas se leen del DUMP del esquema y no de una lista escrita
       aca: una lista escrita aca se desactualiza sin avisar y el check sigue
       dando OK comparando contra una copia vieja, que es la forma de check que
       no sirve para nada.
       ========================================================================== */
    seccion('8-bis. Las columnas que lee la hoja, contra el esquema');

    const dump = leer(path.join(RAIZ, 'schema', 'schema-actual.sql'));
    check(dump.length > 1000, `se leyo el dump del esquema (${dump.length} caracteres)`);

    const ALIAS_CONTRA_TABLA = { f: 'facturas', it: 'factura_items' };

    for (const [alias, tabla] of Object.entries(ALIAS_CONTRA_TABLA)) {
        const columnas = columnasTipadasDe(tabla, dump);
        check(!!columnas, `se leyeron las columnas de ${tabla} del dump`);
        if (!columnas) continue;

        /* El extractor se chequea CONTRA SI MISMO, no contra un numero inventado.

           Se conto primero con un piso de 15 columnas y dio FALLO en
           `factura_items`, que tiene 11 y esta bien: el piso estaba inventado, no
           medido. Inventar umbrales mirando el resultado es la forma de dejar de
           notar que un extractor se rompio.

           El control que si sirve es este: las columnas que salio se cuentan de
           nuevo contando las definiciones del MISMO bloque del dump, y los dos
           numeros tienen que dar igual. Si el extractor se agarra del CREATE
           TABLE equivocado, o deja lineas afuera, los dos numeros difieren.

           El bloque sale de `bloqueDeTabla`, el MISMO helper que usa el
           extractor. La primera version repetia la expresion regular adentro
           del check, y al repetirla con un nivel mas de escapado quedo
           `\\\\s` en el archivo, que en la cadena de JavaScript es `\\s`, que en
           la expresion regular es un barra seguido de una `s`: noidia nada. El
           check decia "el bloque tiene 0 columnas" contra un extractor que
           habia encontrado 22, y lo leido al reves parece un bug del extractor
           cuando el bug era del check. Un helper que devuelve el texto crudo
           evita las dos cosas: la copia y el escapado. */
        const crudas = columnas.length;
        const countedRaw = (bloqueDeTabla(tabla, dump) || '')
            .split('\n')
            .filter((x) => /^\s*`[a-z_][a-z0-9_]*`\s/i.test(x)).length;

        check(crudas === countedRaw,
            `el extractor de ${tabla} cuenta las mismas columnas que hay en el dump`,
            `el extractor devolvio ${crudas} y el bloque del dump tiene ${countedRaw}`);

        // Que exista la columna que hace especial a cada tabla: el numero es
        // NULL hasta que se emite, y el id del item es la que la une con la
        // factura. Se escribe con un condicional y no con
        // `c.nombre === tabla === 'facturas'`, que por precedencia es
        // `(c.nombre === tabla) === 'facturas'` y siempre da falso.
        const columnaClave = tabla === 'facturas' ? 'numero' : 'factura_id';
        check(columnas.some((c) => c.nombre === columnaClave),
            `${tabla} tiene la columna "${columnaClave}"`);

        /* Todas las columnas que la pantalla lee con el alias. Se buscan en
           TODO el archivo, no solo en la hoja: el listado y el formulario leen
           las mismas columnas que el comprobante, y una columna que se usa en
           cualquiera de los tres tiene que existir. */
        const usadas = new Set();
        for (const m of fJs.matchAll(new RegExp('\\b' + alias + '\\.([a-z_][a-z0-9_]*)', 'g'))) {
            usadas.add(m[1].toLowerCase());
        }

        const nombresDeLaTabla = new Set(columnas.map((c) => c.nombre));
        const inexistentes = [...usadas].filter((c) => !nombresDeLaTabla.has(c)).sort();

        check(usadas.size > 0,
            `la pantalla lee ${usadas.size} columnas de ${tabla} con el alias "${alias}"`,
            'si no encuentra columnas, los checks siguientes pasan por vacuidad.');
        check(inexistentes.length === 0,
            `todas las columnas que la pantalla lee de ${tabla} existen`,
            `no existen en el esquema: ${inexistentes.join(', ')}`);

        // Y el reves, que es el otro medio de la comparacion: de las columnas
        // que importan para una factura, cuantas lee la pantalla. Si el backend
        // agrega una columna importante y nadie la muestra, el papel sale
        // incompleto y este check lo dice.
        const importantes = tabla === 'facturas'
            ? ['numero', 'fecha', 'cliente_nombre', 'subtotal', 'descuento', 'iva_monto', 'total', 'estado']
            : ['descripcion', 'cantidad', 'precio_unitario', 'descuento', 'iva_porcentaje', 'subtotal'];
        const sinLeer = importantes.filter((c) => !usadas.has(c));

        check(sinLeer.length === 0,
            `la pantalla lee todas las columnas importantes de ${tabla}`,
            `no las lee: ${sinLeer.join(', ')}`);
    }

    /* `empresa` sale de la tabla central `empresas`, que NO esta en el dump del
       esquema del tenant: vive en el dump de la central. Un alias que se busca en
       el archivo equivocado no encuentra nada, y "no encontrado" seeria leido
       como "columna inexistente". */
    const dumpCentral = leer(path.join(RAIZ, 'migrations', 'central', '001_esquema_central.sql'));
    const colEmpresa = columnasTipadasDe('empresas', dumpCentral);
    check(!!colEmpresa, 'se leyeron las columnas de empresas del esquema central');
    /* La hoja se arma desarmando la respuesta del servidor. Si ese `empresa` deja de
       estar, o cambia de nombre, la hoja imprimible sale sin nombre, sin logo,
       sin colores y sin datos de contacto, y no se cae: sale una hoja en blanco
       con los importes, que es justo el papel que se le entrega al cliente.

       Se busca el DESARMADO, no `empresa.algo`. La primera version buscaba
       `/\.empresa\./`, un punto delante, y daba falso: en el codigo la empresa se
       nombra sin punto (`empresa.nombre` despues de un espacio, y el nombre
       solo, en el `const { empresa } = F.detalle`). Un check que busca la
       sintaxis equivocada no verifica nada y encima parece que si. */
    check(/const\s*\{[^}]*\bempresa\b[^}]*\}\s*=\s*F\.detalle/.test(fJs),
        'la hoja imprimible saca la empresa de la respuesta de /comprobante');

    if (colEmpresa) {
        const nombresEmpresa = new Set(colEmpresa.map((c) => c.nombre));
        const usadasEmpresa = new Set();
        for (const m of fJs.matchAll(/\bempresa\.([a-z_][a-z0-9_]*)/g)) {
            usadasEmpresa.add(m[1].toLowerCase());
        }

        const inexistentesEmpresa = [...usadasEmpresa].filter((c) => !nombresEmpresa.has(c)).sort();
        check(usadasEmpresa.size > 0,
            `la pantalla lee ${usadasEmpresa.size} columnas de empresas`,
            'si no encuentra columnas, el check siguiente pasa por vacuidad.');
        check(inexistentesEmpresa.length === 0,
            'todas las columnas de empresa que lee la hoja existen en la central',
            `no existen: ${inexistentesEmpresa.join(', ')}`);
    }

    /* Un piso de comparaciones. Sin esto, un extractor que deja de encontrar
       columnas sigue dando todos los checks en verde: "todo lo que lee existe"
       es cierto y no compara nada. El piso se fijo mirando cuantas comparaciones
       hace hoy el archivo, no inventandolo. */
    const colFacturas = columnasTipadasDe('facturas', dump) || [];
    const colItems = columnasTipadasDe('factura_items', dump) || [];
    const usadasF = new Set([...fJs.matchAll(/\bf\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1].toLowerCase()));
    const usadasIt = new Set([...fJs.matchAll(/\bit\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1].toLowerCase()));
    const usadasEmp = new Set([...fJs.matchAll(/\bempresa\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1].toLowerCase()));

    const comparacionesColumnas =
        usadasF.size + usadasIt.size + usadasEmp.size;

    check(comparacionesColumnas >= 25,
        `se hicieron ${comparacionesColumnas} comparaciones de columnas contra el esquema`,
        `el piso es 25 y hubo ${comparacionesColumnas}: el extractor se esta quedando con poco.`);
    check(colFacturas.length >= 20 && colItems.length >= 10,
        `el dump tiene ${colFacturas.length} columnas en facturas y ${colItems.length} en factura_items`);

    /* ==========================================================================
       9. Lo que el navegador llama, contra lo que el servidor expone

       Esta es la comparacion que mas falta hacia, porque aca los dos lados se
       pueden leer y verificar: las rutas estan escritas en `server.js` y las
       llamadas en `facturacion.js`. No hay que confiar en que coincidan.

       Se comparan en las DOS direcciones, y cada direccion falla distinto:

         - El navegador llama a una ruta que no existe. Se ve en pantalla como
           un `alert` con "No se pudo conectar con el servidor", que es un
           mensaje FALSO: la conexion esta bien, la ruta no. Un 404 disfrazado
           de problema de red hace perder horas.

         - El servidor expone una ruta que el navegador no llama. Queda
           muerta: no se puede llegar con la pantalla, asi que o nadie la usa o
           es un endpoint sin consumidor. Con el tiempo aparecen los dos
           caminos y cada uno tiene reglas propias.
       ========================================================================== */
    seccion('9. Las rutas: navegador contra servidor');

    /* Cada llamada sale de un `apiFetch(` y termina en su `)`. Se cuenta el
       parentesis de cierre en vez de cortar en la primera comilla, porque hay dos
       cosas que hacen falta y ninguna se ve desde la URL:

         - el METODO. Sin `method:` es GET, y hay que deducirlo. Mirando lo que
           hay ANTES de la llamada, como hacia la primera version, el `method:`
           de una llamada anterior se leeria como el de esta. Y hay un ternario
           legitimo (`method: F.editandoId ? 'PUT' : 'POST'`), del que hay que
           quedarse con LOS DOS metodos y no con uno.

         - la RUTA COMPLETA de esa llamada, y no una subcadena suelta.

       Con los strings saltados en el conteo. Aca no se aplica lo de los
       parentesis dentro de regex literales que documenta `extraerRutas`: este
       archivo es el del navegador y no declara rutas, asi que no hay
       `app.get('/x', (req, res) =>` que desbalancee el conteo. */
    /* --- El extractor de llamadas -------------------------------------------
       Devuelve la lista de `{ metodo, camino }` de las llamadas a una funcion
       del navegador. Tres cosas que Costaron una vuelta:

       1. El `(` del que se parte es el de ESTA llamada. Con `lastIndexOf('(')`
          sobre el inicio del match se agarra el de la llamada ANTERIOR: el
          conteo de parentesis arranca en el lugar equivocado, el cierre cae
          antes de tiempo, los argumentos salen truncados, el `method:` no se
          ve, y la llamada se reporta con el metodo por defecto. Una de esas era
          el DELETE, y como el metodo por defecto tambien existe para el GET de
          esa misma ruta, el `Set` se la comia en silencio: 10 rutas del
          servidor, 7 cubiertas, y el FALLO parecia de cobertura.

       2. El primer argumento puede traer VARIAS rutas. En el alta y la edicion:
          `apiFetch(F.editandoId ? \`/api/facturas/${id}\` : '/api/facturas',
          { method: F.editandoId ? 'PUT' : 'POST', ... })`.
          Hay dos rutas y dos metodos, y van en el mismo orden porque el
          condicional es el mismo: la primera rama lleva PUT y la segunda POST.
          Se toman TODOS los literales que empiezan con `/` del primer argumento
          y se emparejan por indice con TODOS los metodos.

          Y NO: partir el ternario en ramas no sirve. La rama de la izquierda es
          la CONDICION, `F.editandoId `, que no es una ruta; como se descarta por
          no empezar con `/` queda una sola ruta contra dos metodos, el
          emparejamiento se corre, y el check acusa `PUT /api/facturas`, que no
          existe, senalando el archivo equivocado.

       3. Si las cantidades no empatan no se empareja al azar: con un solo metodo
          se aplica a todas las rutas, y sin ninguno se usa el metodo por defecto
          del despachador.
    */
    /** El texto del primer argumento, hasta la primera coma de nivel 0. */
    function primerArgumento(argumentos) {
        let nivel = 0;
        for (let i = 0; i < argumentos.length; i++) {
            const c = argumentos[i];
            if (c === '(' || c === '[' || c === '{') nivel++;
            else if (c === ')' || c === ']' || c === '}') nivel--;
            else if (c === ',' && nivel === 0) return argumentos.slice(0, i);
        }
        return argumentos;
    }

    /** Los literales de un texto: comillas simples, dobles y template. */
    const literalesDe = (txt) =>
        [...txt.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`]*)`/g)]
            .map((m) => m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);

    const llamadasDe = (txt, nombreFn, metodoPorDefecto) => {
        const salida = [];
        const rx = new RegExp(nombreFn + '\\s*\\(', 'g');
        let m;

        while ((m = rx.exec(txt)) !== null) {
            const abre = m.index + m[0].length - 1;

            let nivel = 0;
            let fin = abre;
            for (let i = abre; i < txt.length; i++) {
                if (txt[i] === '(') nivel++;
                else if (txt[i] === ')' && --nivel === 0) { fin = i; break; }
            }
            const argumentos = txt.slice(abre + 1, fin);

            const metodos = [...argumentos.matchAll(/method\s*:\s*([^,}\n]+)/g)]
                .flatMap((x) => [...x[1].matchAll(/'(GET|POST|PUT|PATCH|DELETE)'/g)]
                    .map((y) => y[1].toLowerCase()));

            const rutas = literalesDe(primerArgumento(argumentos))
                .filter((s) => typeof s === 'string' && s.startsWith('/'))
                .map((s) => s.replace(/\$\{[^}]*\}/g, ':p'));

            if (!rutas.length) continue;

            if (!metodos.length) {
                for (const camino of rutas) salida.push({ metodo: metodoPorDefecto, camino });
            } else if (metodos.length === 1 || metodos.length !== rutas.length) {
                for (const camino of rutas) salida.push({ metodo: metodos[0], camino });
            } else {
                rutas.forEach((camino, i) => salida.push({ metodo: metodos[i], camino }));
            }
        }
        return salida;
    };

    /* Los parametros se comparan por POSICION y no por nombre: en el servidor
       una ruta es `/api/facturas/:id` y en el navegador la misma se escribe con
       un `${id}`. Comparando los nombres, el servidor dice `:id` y el navegador
       produce `:p`, y el check acusa una ruta inexistente que existe. Con `:p` en
       los dos lados lo que se compara es la FORMA de la ruta, que es lo que
       tiene que coincidir.

       El rango de letras va con mayusculas porque un parametro puede llamarse
       `:presupuestoId`: con `:[a-z_]+` el `:presupuestoId` se partia en
       `:p` + `resupuestoId` y ninguna de las dos formas coincidia con nada. */
    const forma = (camino) => camino.replace(/:[a-zA-Z_]+/g, ':p');

    /* Las rutas de la pantalla se llaman de dos maneras y hay que ver las dos.

       La comun es `apiFetch('/api/facturas')`. Pero emitir, anular, pagar y
       borrar pasan por `accionDeFactura(ruta, ...)`, que recibe la ruta como
       parametro y hace el `apiFetch` adentro. Un extractor que solo mira
       `apiFetch(` ve la palabra `ruta` y no la ruta, y las cuatro rutas mas
       importantes de la pantalla le quedan fuera.

       La lista de despachadores esta escrita aca a proposito: si alguien mete un
       segundo nivel de indireccion, las rutas de ese camino dejan de contarse y
       el check de "ninguna ruta sin consumidor" las acusa de huerfanas, que es
       exactamente el aviso que hace falta. */
    const DESPACHADORES = [
        { fn: 'apiFetch', metodo: 'get', donde: 'auth-check.js' },
        { fn: 'accionDeFactura', metodo: 'post', donde: 'facturacion.js' }
    ];

    const llamadas = DESPACHADORES.flatMap((d) => llamadasDe(fJs, d.fn, d.metodo));
    check(llamadas.length > 0, `se leyeron las llamadas de la pantalla (${llamadas.length})`);

    const deFacturasFront = llamadas.filter((c) => c.camino.startsWith('/api/facturas'));
    check(deFacturasFront.length > 0,
        `la pantalla llama al menos a una ruta de factura (${deFacturasFront.length})`,
        'si no hay llamadas, los checks siguientes pasan por vacuidad.');

    /* El servidor tiene N rutas de factura y la pantalla llama a M. Se
       comparan los conjuntos. */
    const clavesFront = [...new Set(deFacturasFront.map((c) => `${c.metodo} ${forma(c.camino)}`))].sort();
    const clavesBack = [...new Set(deFacturas.map((r) => `${r.metodo} ${forma(r.camino)}`))].sort();

    check(clavesBack.length > 0, `se leyeron las rutas de factura del servidor (${clavesBack.length})`);

    for (const k of clavesFront) {
        check(clavesBack.includes(k), `la pantalla llama ${k}, y esa ruta existe`,
            `el servidor expone: ${clavesBack.join(' | ')}`);
    }

    /* Al reves. Se cuentan tambien las llamadas de `presupuestos.js`, porque
       `desde-presupuesto` se dispara desde ahi y no desde la pagina de facturas. */
    const clavesPresupuestos = [...new Set(
        llamadasDe(pJs, 'apiFetch', 'get').filter((c) => c.camino.startsWith('/api/facturas'))
            .map((c) => `${c.metodo} ${forma(c.camino)}`)
    )];

    /* Que cada ruta de escritura tenga un despachador conocido. Si aparece uno
       nuevo, esta lista se queda corta: el camino nuevo no se cuenta y sus
       rutas salen como huerfanas en el check de abajo, que es el aviso correcto. */
    /* Que cada despachador exista, en el archivo donde deberia estar. `apiFetch`
       vive en `auth-check.js` y no en la pagina: si se buscara solo en
       `facturacion.js` el check fallaria siempre, y un check que siempre falla
       es un check que nadie lee. */
    for (const d of DESPACHADORES) {
        const archivo = d.donde === 'auth-check.js'
            ? sinComentarios(leer(path.join(FRONT, 'auth-check.js')))
            : fJs;
        check(new RegExp('(async\\s+)?function\\s+' + d.fn + '\\s*\\(').test(archivo),
            `el despachador ${d.fn}() existe en ${d.donde}`);
    }

    const huerfanas = clavesBack.filter((k) => !clavesFront.includes(k) && !clavesPresupuestos.includes(k));
    check(huerfanas.length === 0,
        'toda ruta de factura se llega desde alguna pantalla',
        `sin consumidor en el navegador: ${huerfanas.join(' | ')}`);

    /* Y que entre las dos pantallas cubran TODAS las rutas, sin que sobre ninguna. */
    const cubiertas = [...new Set([...clavesFront, ...clavesPresupuestos])].sort();
    check(cubiertas.length === clavesBack.length,
        `las dos pantallas cubren las ${clavesBack.length} rutas de factura`,
        `cubiertas ${cubiertas.length}: ${cubiertas.join(' | ')}`);

    fin();
})();