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
 * Se nota al DAR DE ALTA una empresa: `altas.js` carga `schema/schema-actual.sql`
 * (el esquema ACTUAL, con la columna ya puesta) y DESPUES corre la cadena
 * encima. Un `ALTER ... ADD COLUMN` a secas revienta con `Duplicate column
 * name`, y el alta de la empresa muere con un error que no menciona la
 * migración ni dice que hay que rehacerla.
 *
 * La 006 fue la primera con un ALTER y toda empresa nueva se habria rechazado al
 * registrarse. Lo encontro `f4-verificar.js`, que es la prueba real de que el
 * camino de alta anda; estos controles son la red estatica que avisa antes. */
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

    const index = leer(path.join(RAIZ, '..', 'frontend', 'index.html'));
    check(!/href="facturacion\.html"/.test(index),
        'aun NO hay pantalla de facturacion enlazada',
        'si aparece un enlace, este verificador tiene que actualizarse con lo que la pantalla nueva toque');

    fin();
})();