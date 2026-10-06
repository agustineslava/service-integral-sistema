/* ==========================================================================
   VERIFICADOR: módulo de reportes
   --------------------------------------------------------------------------
   Por qué existe: los reportes son lo primero que lee el dueño del taller para
   saber si el negocio anda. Un número que sale mal acá no aparece en letra
   roja en ningún lado: aparece en una reunión, y de ahí sale una decisión.

   Y a diferencia de otros módulos, acá hay tres formas de equivocarse que no
   se ven mirando la pantalla:

   1. QUE SE CRUCEN DATOS ENTRE EMPRESAS. Los reportes se armaron primero como
      seis consultas sueltas dentro de server.js, y la tentación va a ser
      pegarles un `obtenerPool('serviceintegralsistema')` para no estar pasando
      el pool por parámetro. Funciona con una empresa y con dos cruza todo. Es
      el error más caro que puede haber en este archivo, y es el más fácil de
      escribir sin darse cuenta.

   2. QUE EL CSV Y LA PANTALLA DIFIERAN. El nombre de cada columna tiene que
      estar en un solo lugar. Si está en el reporte y otra vez en el formateador
      del CSV, el día que alguien corrija un título los dos se desfasan y no hay
      forma de saber cuál está bien.

   3. QUE UN NÚMERO PIERDA DEDOS. Un teléfono `01112345678` que vuelve como
      `1112345678` no da error en ningún lado: se ve un número, es un número, y
      está mal. Los tipos de columna ya lo previenen, si es que se usan.

   Este archivo no prueba que el reporte se vea lindo. Prueba lo que se rompe
   solo.

   CÓMO SE CORRE
   --------------------------------------------------------------------------
       node tools/ver-reportes.js
           Solo lee archivos. No necesita base, ni credenciales, ni servidor.
           Todas las comprobaciones de estructura, aislamiento, SQL y pantalla.

       node tools/ver-reportes.js --vivo
           Además ejecuta el servicio contra la base de la empresa #1 y
           comprueba las invariantes que solo se ven corriendo: que los seis
           reportes fechan bien, que el total de repuestos cuadre con el de las
           facturas, que el teléfono conserve los ceros.

   Por qué el vivo es opcional y no obligatorio: para correrlo hacen falta
   credenciales de MySQL, y un verificador que no se puede correr en todas las
   máquinas termina sin correr en ninguna. La parte estática es la que se corre
   siempre; el vivo es la que se corre antes de tocar una consulta.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const VIVO = process.argv.includes('--vivo');

let ok = 0;
const fallas = [];

function leer(ruta) {
    return fs.readFileSync(ruta, 'utf8');
}

/**
 * El texto SIN comentarios.
 *
 * Hace falta porque server.js y el propio servicio tienen comentarios largos
 * explicando estas mismas reglas. Un verificador que leyera el archivo crudo
 * vería `obtenerPool('serviceintegralsistema')` DENTRO de un comentario y se
 * quejaría, y al revés: un `require('mysql2')` escrito en un comentario para
 * explicar por qué no debe estar no es un require.
 *
 * Un `//` de una línea se borra solo si no está precedido de `:`, para no romper
 * el `://` de una URL.
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

/* ==========================================================================
   1. AISLAMIENTO ENTRE EMPRESAS
   --------------------------------------------------------------------------
   La garantía de que un reporte de la empresa 2 no puede leer datos de la 1 es
   que `src/servicios/reportes.js` NO sabe cómo conectarse a una base. Recibe el
   pool ya resuelto desde el contexto de la sesión y no tiene forma de pedir
   otro.

   Estas comprobaciones leen el archivo SIN comentarios, así que un
   `obtenerPool(...)` escrito para explicar el problema no cuenta como que
   exista.
   ========================================================================== */
seccion('1. El servicio de reportes no tiene acceso a la base');

const servicioCrudo = leer(path.join(RAIZ, 'src', 'servicios', 'reportes.js'));
const servicio = sinComentarios(servicioCrudo);

/* `server.js` se lee acá y no en su sección porque lo necesita más de una: la
   primera comprobación del aislamiento mira cómo se llama al servicio desde la
   ruta. Declararlo más abajo lo dejaba en la zona temporal muerta. */
const serverCrudo = leer(path.join(RAIZ, 'server.js'));
const server = sinComentarios(serverCrudo);

check(!/require\(\s*['"]mysql2/.test(servicio),
    'el servicio NO hace require de mysql2');

check(!/require\([^)]*db\s*\/\s*(conexiones|tenant|central)/.test(servicio),
    'el servicio NO importa ningún módulo de base (conexiones, tenant ni central)');

/* `tenant.db` es el back door real: es un proxy que resuelve la base según el
   request. Dentro de un servicio no hay request, así que o explota o —peor—
   resuelve contra lo último que se dejó puesto y lee la base de otra empresa.
   Por eso está prohibido por nombre, no solo el `require` de mysql2. */
check(!/\btenant\b/.test(servicio),
    'el servicio NO menciona `tenant`, que es el proxy que resuelve la base del request');

check(!/\bcentral\b/.test(servicio),
    'el servicio NO menciona la base central');

check(!/createPool|createConnection/.test(servicio),
    'el servicio NO abre ninguna conexión');

check(!/serviceintegralsistema|si_tenant_|si_central/.test(servicio),
    'el servicio NO menciona el nombre de ninguna base');

check(!/process\.env\s*\.\s*DB_/.test(servicio),
    'el servicio NO lee credenciales del entorno');

check(!/\bDATABASE\s*\(\s*\)/.test(servicio),
    'el servicio NO usa DATABASE(), que cambiaría de base según dónde caiga');

/* Lo que se pasa tiene que ser un `db` con la misma interfaz que usan las otras
   rutas. Si `correr` recibiera otra cosa, el mismo servicio serviría para
   cualquier cosa y dejaría de ser el límite. */
check(/\basync\s+function\s+correr\s*\(\s*db\s*,/.test(servicio),
    'correr() recibe el pool como parámetro: es el que lo pasa la sesión');

check(/\bcorrer\s*\(\s*db\s*,\s*codigo/.test(servicio),
    'correr() usa el db que le pasaron, no otro');

/* Y la garantía tiene que ser de veras: el `db` de la ruta es el proxy que sale
   del request, no una conexión que alguien eligió. */
check(/reportes\.correr\(\s*db\s*,/.test(server),
    'la ruta le pasa a correr() el db del request, que es el que resuelve la empresa');

/* ==========================================================================
   2. EL RANGO DE FECHAS NO SE PEGA AL SQL
   --------------------------------------------------------------------------
   Las fechas vienen del query string. Si una se concatenara al texto de la
   consulta, un `?desde=2026-01-01' OR '1'='1` devolvería la base entera con un
   200.

   Las dos cosas que tienen que ser verdad: el texto de la consulta se arma con
   `?`, y el valor viaja en el array de parámetros.
   ========================================================================== */
seccion('2. El rango de fechas viaja como parámetro, no pegado al texto');

const bloqueFiltro = (() => {
    const m = servicio.match(/function\s+filtroFechas\s*\([\s\S]*?\n}/);
    return m ? m[0] : '';
})();

check(bloqueFiltro !== '', 'se encuentra la función filtroFechas()');
check(/\$\{\s*columna\s*\}\s*>=\s*\?/.test(bloqueFiltro),
    'el piso del rango es un marcador `?`, no el valor');
check(/\$\{\s*columna\s*\}\s*<\s*\?/.test(bloqueFiltro),
    'el techo del rango es un marcador `?`, no el valor');
check(/params\.push\(\s*desde\s*\)/.test(bloqueFiltro),
    '`desde` se manda en el array de parámetros');
check(/params\.push\(\s*diaSiguiente\(hasta\)\s*\)/.test(bloqueFiltro),
    '`hasta` se manda transformado en el array de parámetros');
check(!/params\.push\(\s*`/.test(bloqueFiltro) && !/params\.push\(\s*['"]/.test(bloqueFiltro),
    'ningún parámetro se arma pegando otro valor adentro (no hay plantilla en el push)');

/* La cota superior tiene que ser EXCLUSIVA. `<= hasta` con una columna DATE
   incluye el día entero, y con una DATETIME incluye solo la medianoche: el
   mismo filtro daría dos resultados distintos según la tabla. */
check(/diaSiguiente\(hasta\)/.test(bloqueFiltro),
    'el techo usa diaSiguiente(hasta): el período incluye el día `hasta` entero');
check(!/columna\s*\}\s*<=\s*\?/.test(bloqueFiltro),
    'el techo NO es `<=`: con una columna DATE se perdería el resto del día');

/* `leerRango` no debe convertir a string antes de validar: eso vuelve muerto el
   chequeo de tipo de `fechaReal` y deja pasar un array como si fuera fecha. */
const bloqueRango = (() => {
    const m = servicio.match(/function\s+leerRango\s*\([\s\S]*?\n}/);
    return m ? m[0] : '';
})();

check(bloqueRango !== '', 'se encuentra la función leerRango()');
check(!/String\(\s*query\.(desde|hasta)\s*\)/.test(bloqueRango),
    'leerRango NO hace String() del valor antes de validar');
check(/typeof\s+\w+\s*===\s*['"]string['"]/.test(bloqueRango),
    'leerRango exige que el valor sea un string');
check(/fechaReal\s*\(/.test(bloqueRango),
    'leerRango valida contra el calendario, no solo contra la forma');
check(/>\s*hasta/.test(bloqueRango),
    'leerRango rechaza que el rango vaya al revés');

/* Y `fechaReal` tiene que ser de verdad un calendario, no una regex. */
check(/setUTCFullYear|setUTCMonth|setUTCDate/.test(servicio),
    'fechaReal() chequea el calendario de verdad, no solo el formato');
check(/getUTCFullYear\(\)\s*===\s*anio/.test(servicio),
    'fechaReal() compara el año que volvió contra el que se pidió');

/* Cada reporte tiene que declarar por qué columna se filtra. Si uno no la
   declara, `filtroFechas` recibe `undefined` y el filtro queda
   `undefined >= ?`, que MySQL no compila. */
const codigosDeReporte = [...servicio.matchAll(/^\s{4}'([a-z0-9-]+)':\s*\{/gm)].map((m) => m[1]);
const bloqueFechas = (() => {
    const m = servicio.match(/const\s+COLUMNA_DE_FECHA\s*=\s*\{[\s\S]*?\n}/);
    return m ? m[0] : '';
})();

check(codigosDeReporte.length === 6,
    'hay exactamente 6 reportes declarados',
    `encontrados: ${codigosDeReporte.join(', ')}`);

for (const codigo of codigosDeReporte) {
    check(new RegExp(`['"]?${codigo}['"]?\\s*:\\s*'[a-z]\\.[a-z_]+'`).test(bloqueFechas),
        `el reporte ${codigo} declara por qué columna se filtra`);
}

check(/columnaDeFecha[\s\S]{0,200}throw\s+new\s+Error/.test(servicio),
    'columnaDeFecha() tira si un reporte no declaró su columna: no filtra en silencio');

/* ==========================================================================
   3. LOS ENDPOINTS
   --------------------------------------------------------------------------
   Dos rutas. Las dos con sesión y con módulo: sin las dos, un reporte es una
   tabla con los números de otra empresa, o los números de esta para cualquiera
   que conozca la URL.
   ========================================================================== */
seccion('3. Las dos rutas, con sesión y con módulo');

const rutas = [];
{
    const rx = /app\.(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]*)\2/g;
    let m;
    while ((m = rx.exec(server)) !== null) {
        const desdePath = m.index + m[0].length;
        const hastaFlecha = server.indexOf('=>', desdePath);
        const hastaReq = server.indexOf('(req', desdePath);

        let corte;
        if (hastaFlecha === -1) corte = hastaReq;
        else if (hastaReq === -1) corte = hastaFlecha;
        else corte = Math.min(hastaFlecha, hastaReq);

        corte = corte === -1 || corte - desdePath > 400
            ? Math.min(desdePath + 400, server.length)
            : corte;

        const cola = server.slice(desdePath, corte);
        const linea = server.slice(0, m.index).split('\n').length;

        if (/[{}]|=>/.test(cola)) {
            fallas.push(`no se pudo leer la cola de L${linea} ${m[3]}: ${JSON.stringify(cola.slice(0, 70))}`);
        }

        rutas.push({ metodo: m[1], camino: m[3], cola, linea });
        rx.lastIndex = Math.max(desdePath, corte);
    }
}

const deReportes = rutas.filter((r) => /^\/api\/reportes(\/|:|$)/.test(r.camino));

check(deReportes.length === 2,
    'hay exactamente 2 rutas de reportes',
    `encontradas: ${deReportes.map((r) => `${r.metodo} ${r.camino}`).join(' | ')}`);

for (const r of deReportes) {
    check(/verificarToken/.test(r.cola),
        `${r.metodo.toUpperCase()} ${r.camino} exige sesión iniciada`);
    check(/requiereModulo\(\s*['"]reportes['"]\s*\)/.test(r.cola),
        `${r.metodo.toUpperCase()} ${r.camino} exige el módulo 'reportes'`);
    check(r.metodo === 'get',
        `${r.camino} es de lectura`,
        'un reporte que se arma por GET se puede dejar en el historial del navegador');
}

/* El catálogo y el reporte tienen que ser dos rutas distintas: una sola que
   devuelve una forma u otra según el código obliga a todo cliente a preguntar
   primero para saber qué esperar. */
check(deReportes.some((r) => r.camino === '/api/reportes'),
    'existe GET /api/reportes, que devuelve el catálogo');
check(deReportes.some((r) => r.camino === '/api/reportes/:codigo'),
    'existe GET /api/reportes/:codigo, que devuelve los datos');

/* El 404 del código desconocido, y no un 400 ni un error de MySQL. */
const bloqueRuta = (() => {
    const i = server.indexOf("app.get('/api/reportes/:codigo'");
    return i === -1 ? '' : server.slice(i, i + 2600);
})();

check(/reportes\.existe\s*\(\s*codigo\s*\)/.test(bloqueRuta),
    'la ruta consulta la lista blanca de códigos antes de tocar la base');
check(/res\.status\(404\)/.test(bloqueRuta),
    'un código que no existe responde 404');
check(/!rango\.ok[\s\S]{0,120}res\.status\(400\)/.test(bloqueRuta),
    'un rango de fechas inválido responde 400');
check(/formato\s*!==\s*'json'\s*&&\s*formato\s*!==\s*'csv'[\s\S]{0,160}res\.status\(400\)/.test(bloqueRuta),
    'un formato que no es json ni csv responde 400 en vez de devolver el JSON en silencio');

/* El error de MySQL no puede viajar al cliente: decir "Unknown column" le
   describe la base por dentro. */
check(/catch\s*\(\s*err\s*\)[\s\S]{0,400}res\.status\(500\)\.json\(\{\s*error:\s*'Error al generar el reporte'\s*\}\)/.test(bloqueRuta),
    'el error interno NO viaja al cliente');

/* ==========================================================================
   4. EL CSV
   --------------------------------------------------------------------------
   El archivo lo abre Excel en una máquina que no es esta. Tres cosas tienen que
   ser ciertas y ninguna se ve en la pantalla:

     - el BOM, sin el cual Excel en Windows lee el archivo como ANSI y "San
       José" aparece como "San JosÃ©";
     - los números CRUDOS, porque si el archivo tuviera "$ 5.000,00" la columna
       sería texto y `SUM` daría cero;
     - el prefijo anti-fórmula en los textos que arrancan con `=`, y SOLO en los
       textos: un número negativo no es una fórmula y anteponerle un apóstrofo lo
       convierte en texto, que es justo lo que el archivo no quiere.
   ========================================================================== */
seccion('4. El CSV sale del servidor, con BOM, números crudos y antivirus de fórmulas');

const bloqueCsv = (() => {
    const m = servicio.match(/function\s+aCsv[\s\S]*?\n}/);
    return m ? m[0] : '';
})();

check(bloqueCsv !== '', 'se encuentra la función aCsv()');
check(/0xef,\s*0xbb,\s*0xbf/.test(bloqueCsv),
    'el CSV arranca con el BOM UTF-8 (EF BB BF)');
check(/resultado\.columnas\.map\(\s*\(\s*c\s*\)\s*=>\s*campoCsv\(\s*c\.titulo\s*\)/.test(bloqueCsv),
    'el encabezado del CSV sale de `columnas`: la misma fuente que la pantalla');
/*
    Lo que se busca es una lista de encabezados ESCRITA, del estilo
    `'Mes,Facturas,Neto'`. El `.join(',')` no se busca: ese es el separador de
    la convención, y es el que tiene que estar.
*/
check(!/(['"])\s*(Mes|Facturas|Cliente|Total|Neto)\s*,/.test(bloqueCsv),
    'el CSV NO tiene una lista de encabezados escrita a mano');

check(/resultado\.columnas\.map\(\s*\(\s*c\s*\)\s*=>\s*campoCsv\(\s*c\.titulo\s*\)\s*\)\s*\.join/.test(bloqueCsv),
    'el encabezado del CSV se arma con el separador de la convención');

check(/resultado\.columnas\.map\(\s*\(\s*c\s*\)\s*=>\s*campoCsv\(\s*fila\[\s*c\.clave\s*\]\s*\)/.test(bloqueCsv),
    'cada fila del CSV se arma con el MISMO recorrido de columnas que el encabezado');

check(/['"]\\r\\n['"]/.test(bloqueCsv),
    'las líneas del CSV se separan con CRLF, que es lo que pide la convención');

check(/Totales del per/i.test(bloqueCsv),
    'el CSV cierra con el bloque de totales del período');

/* El total también sale de `resumen`, no de una suma recalculada acá: si el
   archivo sumara por su cuenta, el total del archivo y el de la tarjeta de la
   pantalla podrían diferir sin que nadie se entere. */
/* El `}` está porque la línea es un literal de plantilla:
   `` `${campoCsv(r.etiqueta)},${campoCsv(r.valor)}` `` */
check(/campoCsv\(\s*r\.etiqueta\s*\)\s*\}\s*,\s*\$\{\s*campoCsv\(\s*r\.valor/.test(bloqueCsv),
    'el bloque de totales del CSV sale de las mismas tarjetas que muestra la pantalla');

const bloqueCampo = (() => {
    const m = servicio.match(/function\s+campoCsv[\s\S]*?\n}/);
    return m ? m[0] : '';
})();

check(bloqueCampo !== '', 'se encuentra la función campoCsv()');

check(/typeof\s+valor\s*!==\s*['"]number['"][\s\S]{0,120}ARRANQUE_DE_FORMULA\.test/.test(bloqueCampo),
    'el prefijo anti-fórmula se aplica SOLO a los textos, no a los números');

/* Los cinco caracteres que obligan a entrecomillar. El punto y coma importa:
   con la configuración regional de algunos países Excel separa columnas con
   `;`, y un `;` sin entrecomillar abre columnas de más en el archivo. */
/* El `/` antes de `.test` es el cierre del literal de regex, no un carácter
   del patrón: sin `\\/?` el patrón no cierra nunca contra el archivo real. */
const claseComilla = (bloqueCampo.match(/\[\s*((?:\\.|[^\]\\])*)\]\s*\/?\s*\.test\s*\(\s*conPrefijo/) || [])[1] || '';

check(claseComilla !== '', 'se encuentra la lista de caracteres que obligan a entrecomillar');

for (const [nombre, simbolo] of [
    ['la comilla doble', '"'],
    ['el retorno de carro', '\\r'],
    ['el salto de línea', '\\n'],
    ['la coma', ','],
    ['el punto y coma', ';']
]) {
    check(claseComilla.includes(simbolo), `campoCsv() entrecomilla si el dato tiene ${nombre}`);
}

check(/\.replace\(\s*\/"\/g,\s*['"]""['"]\s*\)/.test(bloqueCampo),
    'campoCsv() duplica las comillas dobles del dato (RFC 4180)');

/* La lista tiene que ser la de los cinco arranques que hacen que una celda sea
   leída como fórmula: = + - @ y los dos controles. */
const arranque = (servicio.match(/ARRANQUE_DE_FORMULA\s*=\s*(\/\^\[[^\]]*\]\/)/) || [])[1] || '';

check(arranque !== '', 'se encuentra la lista de arranques de fórmula');

for (const simbolo of ['=', '+', '\\-', '@', '\\t', '\\r']) {
    check(arranque.includes(simbolo),
        `la lista de arranques de fórmula incluye ${simbolo}`);
}

check(/replace\(\/\[\^A-Za-z0-9\._-\]\/g,\s*['"]_['"]\)/.test(servicio),
    'nombreArchivo() deja pasar solo letras, números, punto, guion y guion bajo');

check(/['"]Content-Type['"],\s*['"]text\/csv; charset=utf-8['"]/.test(bloqueRuta),
    'la ruta responde el CSV como text/csv con UTF-8');
check(/['"]Content-Disposition['"],\s*`attachment;\s*filename=/.test(bloqueRuta),
    'la ruta manda el CSV como adjunto, con el nombre del archivo adentro');
check(/['"]Cache-Control['"],\s*['"]no-store['"]/.test(bloqueRuta),
    'el CSV no se cachea: un reporte es un dato del momento');
check(/['"]X-Content-Type-Options['"],\s*['"]nosniff['"]/.test(bloqueRuta),
    'el CSV va con nosniff, para que el navegador no lo intente ejecutar');
check(/reportes\.aCsv\(\s*resultado\s*\)/.test(bloqueRuta),
    'el CSV sale del resultado que YA se corrió: el archivo no puede desfasarse de la pantalla');

/* ==========================================================================
   5. LOS TIPOS DE COLUMNA
   --------------------------------------------------------------------------
   El backend declara un `tipo` por columna y el frontend tiene un formateador
   por tipo. Son dos listas, en dos archivos, y se desfasarían solas.

   El síntoma del desfase es invisible: el `default` del formateador muestra el
   valor crudo escapado, así que un tipo nuevo se ve bien pero sale `$` donde
   debería decir "12.100" y nadie se da cuenta hasta que alguien lo lee mal.

   Por eso la comparación es de conjunto, no de cantidad: tiene que coincidir
   elemento por elemento.
   ========================================================================== */
seccion('5. Los tipos de columna del backend y del frontend son el mismo conjunto');

/*
    El backend declara tipos en TRES lugares, y los tres llegan a la pantalla por
    el mismo formateador:

      - `col(clave, titulo, tipo)`       las celdas de la tabla
      - `{ etiqueta, valor, tipo }`     las tarjetas del resumen
      - `TIPOS_NUMERICOS`               los que se alinean a la derecha

    Los tres cuentan. Dejarse uno afuera es la forma de que el verificador pase
    con un tipo que la pantalla no sabe pintar: si solo se miraran las columnas,
    `dias` —que solo aparece en una tarjeta del resumen— quedaría sin(formatear
    y el `default` del switch lo mostraría crudo.
*/
const tiposDeColumna = [...servicio.matchAll(/col\(\s*'[a-z0-9_]+'\s*,\s*'[^']*'\s*,\s*'([a-z]+)'\s*\)/g)]
    .map((m) => m[1]);
const tiposDeResumen = [...servicio.matchAll(/\{\s*etiqueta:[^}]*?\btipo:\s*'([a-z]+)'\s*\}/g)]
    .map((m) => m[1]);
const setDeNumericos = (servicio.match(/TIPOS_NUMERICOS\s*=\s*new Set\(\s*\[([^\]]*)\]/s) || [])[1] || '';
const tiposDeAlineacion = [...setDeNumericos.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

const unicosBackend = [...new Set([...tiposDeColumna, ...tiposDeResumen, ...tiposDeAlineacion])].sort();

const FE = path.join(RAIZ, '..', 'frontend');
let tiposFrontend = [];
let casesFrontend = [];

try {
    const jsCrudo = leer(path.join(FE, 'reportes.js'));
    const js = sinComentarios(jsCrudo);

    /* Los tipos que el formateador sabe pintar: los `case` del `switch`. */
    casesFrontend = [...js.matchAll(/case\s*'([a-z]+)':/g)].map((m) => m[1]);

    /* `texto` se resuelve antes del switch, con un `if`, y no necesita `case`. */
    tiposFrontend = [...new Set([...casesFrontend, 'texto'])].sort();

    check(unicosBackend.length > 0, 'se encontraron los tipos que declara el backend',
        `encontrados: ${unicosBackend.join(', ')}`);

    const faltantes = unicosBackend.filter((t) => !tiposFrontend.includes(t));
    const sobrantes = tiposFrontend.filter((t) => !unicosBackend.includes(t));

    check(faltantes.length === 0,
        'todo tipo que declara el backend tiene formateador en el frontend',
        `sin formateador: ${faltantes.join(', ')}`);

    check(sobrantes.length === 0,
        'el frontend no inventa tipos que el backend nunca declara',
        `sobrantes: ${sobrantes.join(', ')}`);

    /* Dos columnas con la misma `clave` dentro de un reporte NO es una lista de
       tipos repetida: es un error. Las filas se arman como un objeto y se leen
       con `fila[c.clave]`, así que la segunda columna del mismo nombre pisa a la
       primera: la tabla muestra el mismo dato dos veces y el total del resumen
       no se sabe de dónde salió.

       El chequeo es por reporte, y es por eso que hay que aislar el bloque de
       cada uno: comparar los `clave` de los seis juntos daría el mismo `total`
       cinco veces y no significaría nada. */
    const reportes = servicio.split(/^\s{4}'[a-z0-9-]+':\s*\{\s*$/m).slice(1);

    check(reportes.length === codigosDeReporte.length,
        'se puede aislar el bloque de cada reporte para comparar sus columnas',
        `bloques=${reportes.length} códigos=${codigosDeReporte.length}`);

    for (let i = 0; i < reportes.length; i++) {
        const claves = [...(reportes[i].match(/col\(\s*'([a-z0-9_]+)'/g) || [])]
            .map((s) => (s.match(/'([^']+)'/) || [])[1]);
        const repetidas = [...new Set(claves.filter((c, j) => claves.indexOf(c) !== j))];

        check(repetidas.length === 0,
            `el reporte ${codigosDeReporte[i]} no declara dos columnas con la misma clave`,
            `repetidas: ${repetidas.join(', ')}`);

        check(claves.length > 0,
            `el reporte ${codigosDeReporte[i]} declara al menos una columna`);
    }

    /* Y cada columna declarada tiene que PRODUCIRSE en algún lado.
     *
     * Este control sale de un fallo real: el reporte de presupuestos declaraba
     * una columna "Participación" y el SQL no la traía. Compilaba, el verificador
     * de rutas daba todo verde, y la pantalla mostraba un guion en una columna
     * que el dueño del taller leía todas las semanas. Solo se enteraba alguien
     * ejecutando el reporte, y eso es un `` `node tools/ver-reportes.js --vivo` ``
     * que no se corre todos los días.
     *
     * Por eso se busca la clave EN EL RESTO DEL BLOQUE, con el arreglo de
     * `columnas` tapado: si se buscara en el bloque entero, la propia declaración
     * de la columna Bastaría y el control no encontraría nada. Lo que tiene que
     * aparecer es el `AS mes` del SQL, o el `participacion:` del `ajustar`.
     */
    for (let i = 0; i < reportes.length; i++) {
        const bloque = reportes[i];

        /* Se saca el arreglo `columnas`, que es donde la clave aparece por
           definición y no por producción. */
        const sinColumnas = bloque.replace(/columnas\s*:\s*\[[\s\S]*?\]/, 'columnas: []');

        const declaradas = [...(bloque.match(/col\(\s*'([a-z0-9_]+)'/g) || [])]
            .map((s) => (s.match(/'([^']+)'/) || [])[1]);

        const noProducidas = declaradas
            .filter((clave) => !new RegExp(`\\b${clave}\\b`).test(sinColumnas));

        check(noProducidas.length === 0,
            `el reporte ${codigosDeReporte[i]} produce todas las columnas que declara`,
            `declaradas y nunca producidas: ${noProducidas.join(', ')}`);

        /* Y si declara `ajustar`, que devuelva filas y no un número suelto: un
           `ajustar` que devolviera el total perdería la tabla entera y el
           verificador no se enteraría hasta que alguien mirara la pantalla. */
        if (/\bajustar\s*\(/.test(bloque)) {
            check(/ajustar[\s\S]{0,900}?\.map\s*\(/.test(bloque),
                `el ajustar() de ${codigosDeReporte[i]} devuelve filas, no un valor único`);
        }
    }

    check(casesFrontend.length > 0, 'se encontraron los formateadores del frontend',
        `encontrados: ${casesFrontend.join(', ')}`);

    /* Y lo inverso: cada tipo que llega en una tarjeta o en una celda tiene que
       tener su `case`, salvo `texto`, que se resuelve antes del switch. */
    const sinCase = unicosBackend.filter((t) => t !== 'texto' && !casesFrontend.includes(t));

    check(sinCase.length === 0,
        'cada tipo que llega a la pantalla tiene su `case` en el switch',
        `sin case: ${sinCase.join(', ')}`);

    /* Los tipos que se alinean a la derecha tienen que ser los mismos de los
       dos lados: el backend declara cuáles son numéricos y el CSS los alinea
       según el mismo nombre. Si difieren, la columna queda a la izquierda con
       números adentro. */
    const alineaFrontend = ((js.match(/TIPOS_NUMERO\s*=\s*new Set\(\s*\[([^\]]*)\]/s) || [])[1] || '')
        .match(/'([a-z]+)'/g)
        ?.map((s) => s.replace(/'/g, '')) || [];

    const alineaBackend = [...tiposDeAlineacion].sort();
    const alineaJs = [...alineaFrontend].sort();

    check(alineaJs.length > 0, 'se encontró la lista de tipos que se alinean a la derecha en el frontend');

    check(JSON.stringify(alineaJs) === JSON.stringify(alineaBackend),
        'la lista de tipos alineados a la derecha es la misma en el backend y en el frontend',
        `backend: ${alineaBackend.join(', ')}  ·  frontend: ${alineaJs.join(', ')}`);

} catch (e) {
    check(false, 'se puede leer y analizar frontend/reportes.js', e.message);
}

/* ==========================================================================
   6. LA PANTALLA
   --------------------------------------------------------------------------
   Reglas que ya valen para las otras siete pantallas, más las dos que son de
   esta.
   ========================================================================== */
seccion('6. La pantalla de reportes');

const PAGINAS = [
    'index.html', 'reparaciones.html', 'clientes.html', 'pedidos.html',
    'presupuestos.html', 'facturacion.html', 'etiquetas.html', 'reportes.html'
];

try {
    for (const pagina of PAGINAS) {
        const html = leer(path.join(FE, pagina));
        check(/<li\s+data-modulo="reportes"><a\s+href="reportes\.html"/.test(html),
            `${pagina}: tiene la entrada de Reportes en el menú`);
    }

    const miPagina = leer(path.join(FE, 'reportes.html'));

    check(/<script\s+src="auth-check\.js\?v=2\.5">/.test(miPagina),
        'reportes.html carga auth-check.js con la versión 2.5');
    check(/<link\s+rel="stylesheet"\s+href="style\.css\?v=2\.5">/.test(miPagina),
        'reportes.html carga style.css con la versión 2.5');
    check(/<script\s+src="reportes\.js\?v=2\.5">/.test(miPagina),
        'reportes.html carga reportes.js con la versión 2.5');

    /* Las fechas tienen que estar filtrando antes de que se pinte la primera
       tabla, o el operador ve toda la historia y cree que pidió el mes. */
    check(/id="filtro-desde"[^>]*type="date"/.test(miPagina) || /type="date"[^>]*id="filtro-desde"/.test(miPagina),
        'reportes.html tiene el filtro de fecha de inicio');
    check(/id="filtro-hasta"[^>]*type="date"/.test(miPagina) || /type="date"[^>]*id="filtro-hasta"/.test(miPagina),
        'reportes.html tiene el filtro de fecha de fin');
    check(/id="btn-csv"/.test(miPagina),
        'reportes.html tiene el botón de exportar');

    /* El <select> de reportes no puede tener los seis códigos escritos: se arma
       con el catálogo. Una lista escrita ahí se desactualiza sin avisar. */
    check(!/<option\s+value="ventas-por-mes"/.test(miPagina),
        'reportes.html NO tiene la lista de reportes escrita en el HTML');

    /* El <tr> de encabezados y el de filas se arman con JS, y por eso tienen
       que tener los id que el JS busca. */
    check(/id="rp-encabezados"/.test(miPagina) && /id="rp-filas"/.test(miPagina),
        'reportes.html tiene los contenedores que reportes.js llena');

    const jsCrudo = leer(path.join(FE, 'reportes.js'));
    const js = sinComentarios(jsCrudo);

    /* `data-col` en el <th> lo pone el JS, así que la regla es sobre el
       generador, no sobre el HTML. */
    check(/<th\s+data-col=/.test(js),
        'los <th> se generan con data-col, que es lo que permite comparar columna con columna');
    check(/<td\s+data-col=/.test(js),
        'los <td> se generan con data-col');

    /* El servicio pide el CSV con `apiFetch`, no con un <a> pelado: el endpoint
       pide token y un enlace sin token se descarga como 401. */
    check(/apiFetch\(\s*urlReporte\(\s*reporteActual\s*,\s*'csv'\s*\)/.test(js),
        'el CSV se pide con apiFetch, que manda el token');
    check(!/<a\s+[^>]*download=/.test(miPagina),
        'NO hay un <a download> con la URL del CSV: no mandaría el token');

    /* Y el nombre del archivo sale del servidor, no se compone acá. */
    check(/content-disposition/i.test(js) && !/enlace\.download\s*=\s*`reporte_/.test(js),
        'el nombre del archivo lo manda el servidor, no se recompone en el navegador');

    /* `texto` NO es un `case`: se resuelve antes del switch, con un `if`, y es
       la única rama que escapa. Si pasa al switch y vuelve por `default`, el
       escapado depende del `default` y un tipo nuevo sale crudo. */
    check(/function\s+formatear[\s\S]{0,600}if\s*\(\s*tipo\s*===\s*['"]texto['"]\s*\)[\s\S]{0,120}escapeHtml/.test(js),
        'el formateador escapa los valores de texto, antes del switch');
    check(/function\s+fechaR[\s\S]{0,300}return\s+`\$\{m\[3\]\}\/\$\{m\[2\]\}\/\$\{m\[1\]\}`/.test(js),
        'fechaR() arma la fecha desde la cadena, no con new Date (que usa la zona horaria de la máquina)');
    check(!/new\s+Date\s*\(\s*String\(\s*iso/.test(js),
        'NO se usa new Date() para pintar una fecha de la base');

    /* Dos pedidos que se pisan: el token de la petición en curso. */
    check(/\+\+peticionActual/.test(js) && /token\s*!==\s*peticionActual/.test(js),
        'el filtro de fechas tiene un token de petición, para que dos respuestas fuera de orden no se pisen');

    /* El token lo lee `apiFetch`, y `apiFetch` es lo que manda a login cuando
       la sesión caducó. Si reportes.js lo leyera por su cuenta, el 401 de un
       CSV caería en un `catch` cualquiera y la pantalla se quedaría mostrando
       la tabla vieja con el botón de exportar apagado. */
    check(!/localStorage/.test(js),
        'reportes.js NO lee el token por su cuenta: eso es de apiFetch, que además manda a login');

    check(/!resp\.ok/.test(js),
        'reportes.js distingue la respuesta mala de los datos, en vez de asumir que siempre hay JSON');

    /* La regla del proyecto: dos `.replace()` con el mismo patrón y el mismo
       reemplazo. El de las etiquetas tenía `escapeHtml` con `.replace(/&/g,
       '&')`, que no escapaba nada y tenía exactamente la misma forma que uno
       que sí. */
    const reemplazos = (() => {
        const vistos = new Map();
        for (const m of js.matchAll(/(\w+)\s*=\s*\(\s*valor\s*\)\s*=>\s*String\(valor\)((?:\s*\.\s*replace\([^;]+)+)/g)) {
            const cadena = m[2].replace(/\s+/g, ' ');
            vistos.set(cadena, (vistos.get(cadena) || 0) + 1);
        }
        return [...vistos.entries()].filter(([, n]) => n > 1);
    })();

    check(reemplazos.length === 0,
        'NO hay dos .replace() con el mismo patrón y el mismo reemplazo',
        reemplazos.map(([c, n]) => `${n}x ${c.slice(0, 60)}`).join(' ; '));

    const css = leer(path.join(FE, 'reportes.css'));
    /* Los comentarios cuentan como `no`, y este archivo tiene un párrafo entero
       hablando de por qué no hay `@media`. Hay que mirar el CSS sin comentarios
       o la comprobación se contradice sola. */
    const cssSinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

    check(/\.rp-col-numero\s*\{[^}]*text-align:\s*right/.test(cssSinComentarios),
        'reportes.css alinea a la derecha las columnas de número');
    check(/grid-template-columns:\s*repeat\(auto-fit/.test(cssSinComentarios),
        'reportes.css arma el resumen con grilla, para que la cantidad de tarjetas pueda cambiar');
    check(!/@media/.test(cssSinComentarios),
        'reportes.css no trae @media: la barra de filtros se acomoda con flex-wrap');

    /* Y las reglas que sí están tienen que usar las variables de `style.css`, no
       colores escritos: un color fijo es un tema que se rompe en el otro. */
    check(!/#[0-9a-fA-F]{3,6}\b/.test(cssSinComentarios),
        'reportes.css no escribe ningún color fijo: todo sale de las variables de style.css');

} catch (e) {
    check(false, 'se puede leer y analizar la pantalla de reportes', e.message);
}

/* ==========================================================================
   7. LA MIGRACIÓN
   ==========================================================================
   Los reportes filtran por `reparaciones.fecha_ingreso` y esa tabla no tenía
   índice. Con seis órdenes de reparación no se nota; con la historia, cada
   pedido del reporte recorre la tabla entera.

   Y la regla de toda migración: reaplicable. Corrida sobre un esquema que ya la
   tiene, no cambia nada. Si no lo fuera, un taller nuevo quedaría con un
   esquema distinto al de un taller viejo.
   ========================================================================== */
seccion('7. La migración de índices');

try {
    const rutasMig = fs.readdirSync(path.join(RAIZ, 'migrations', 'tenant'));
    const del007 = rutasMig.filter((f) => /^007_.*\.sql$/.test(f));

    check(del007.length === 1,
        'hay exactamente una migración 007',
        del007.join(', '));

    if (del007.length === 1) {
        const sql = leer(path.join(RAIZ, 'migrations', 'tenant', del007[0]));
        const sinCom = sql.replace(/^\s*--.*$/gm, '');

        check(/idx_repar_fecha_ingreso/.test(sql) && /`fecha_ingreso`/.test(sql),
            'la 007 indexa reparaciones.fecha_ingreso, que es por donde filtra el reporte de órdenes');
        check(/idx_repar_estado/.test(sql) && /`estado`/.test(sql),
            'la 007 indexa reparaciones.estado');

        /* Reaplicable: MySQL no tiene `ADD INDEX IF NOT EXISTS`, así que va con
           SQL dinámico. Lo que se busca es el NOMBRE del índice, que es lo único
           que el motor garantiza único dentro de la tabla.

           El `PREPARE` se cuenta aparte del `DEALLOCATE PREPARE`: si no, el
           mismo bloque dinámico aparece dos veces en el conteo y la comprobación
           da bien con un `DEALLOCATE` de menos. */
        const unprepared = (sinCom.match(/information_schema\.STATISTICS/g) || []).length;
        const prepares = (sinCom.match(/(?<!DEALLOCATE\s)\bPREPARE\s+\w+\s+FROM/g) || []).length;
        const executes = (sinCom.match(/EXECUTE\s+\w+/g) || []).length;
        const deallocs = (sinCom.match(/DEALLOCATE\s+PREPARE\s+\w+/g) || []).length;

        check(unprepared >= 2, 'la 007 mira information_schema.STATISTICS antes de cada ALTER');
        check(prepares === unprepared && executes === unprepared && deallocs === unprepared,
            'cada bloque dinámico de la 007 hace PREPARE, EXECUTE y DEALLOCATE',
            `STATISTICS=${unprepared} PREPARE=${prepares} EXECUTE=${executes} DEALLOCATE=${deallocs}`);

        /* Y los tres tienen que ser el MISMO identificador: un `PREPARE a` con
           un `DEALLOCATE PREPARE b` deja la sentencia preparada en la sesión,
           y el que venga después falla con "Unknown prepared statement". */
        const nombres = [...sinCom.matchAll(/(?:DEALLOCATE\s+)?PREPARE\s+(\w+)\s*(?:FROM\b|;)/g)]
            .map((m) => m[1]);
        const pares = nombres.length / 2;

        check(pares === unprepared && new Set(nombres).size === unprepared,
            'cada PREPARE se libera con su propio DEALLOCATE, y ninguno se repite',
            `identificadores: ${nombres.join(', ')}`);
        check(/INDEX_NAME\s*=\s*'idx_repar_fecha_ingreso'/.test(sql),
            'la 007 compara contra INDEX_NAME, no contra la lista de columnas');
        /*
            El ALTER tiene que estar DENTRO de una cadena que se preparea, no
            escrito como sentencia. Vaciando las cadenas primero se ve cuál de
            las dos es: si el `ALTER TABLE` sobrevive al vaciado, está suelto y
            se va a ejecutar aunque el índice ya exista.
        */
        const sinCadenas = sinCom.replace(/'(?:[^']|'')*'/gs, "''");

        check(!/ALTER\s+TABLE/i.test(sinCadenas),
            'ningún ALTER se ejecuta directo: los dos van dentro del bloque dinámico');

        check((sinCom.match(/ADD\s+INDEX/gi) || []).length === 2,
            'la 007 agrega exactamente los dos índices que dice agregar',
            `encontrados: ${(sinCom.match(/ADD\s+INDEX/gi) || []).length}`);

        /* `DATABASE()` y no el nombre de una base: la migración se corre contra
           la base del tenant que se está dando de alta, y el nombre cambia de
           empresa en empresa. */
        check(/TABLE_SCHEMA\s*=\s*DATABASE\(\)/.test(sql),
            'la 007 se resuelve con DATABASE(): sirve para cualquier base de empresa');

        /* Regla 6 de LEEME.txt: `schema/base.sql` es la congelación de antes de
           la 001 y no se toca. Si una migración lo modifica, un alta nueva nace
           con un esquema que ningún taller tiene. */
        const baseCrudo = leer(path.join(RAIZ, 'schema', 'base.sql'));
        check(!/idx_repar_fecha_ingreso/.test(baseCrudo),
            'schema/base.sql NO se tocó: es la congelación de antes de la 001');

        /* Y las migraciones que ya se aplicaron tampoco se editan. El motor
           aborta si cambian, que es justo lo que tiene que pasar. */
        const aplicadas = ['004_presupuestos.sql', '005_etiquetas_qr.sql', '006_facturacion.sql'];
        for (const nombre of aplicadas) {
            check(rutasMig.includes(nombre), `la migración aplicada ${nombre} sigue en su lugar`);
        }
    }

} catch (e) {
    check(false, 'se puede leer la migración 007', e.message);
}

/* ==========================================================================
   8. EL CATÁLOGO DE MÓDULOS
   --------------------------------------------------------------------------
   `reportes` tiene que estar en el catálogo de `si_central.modulos`, o la
   columna `empresa_modulos` no lo puede tener y `requiereModulo('reportes')`
   le cierra la pantalla a todo el mundo.

   El catálogo NO está en el código: lo siembra
   `migrations/central/002_catalogos.sql`, y es una tabla de la base central, que
   es compartida. Esa es la razón de que la comprobación sea sobre la
   migración: si el día de mañana se agrega un módulo nuevo y no está en el
   catálogo, el alta de empresa lo contrata sin efecto y nadie se entera hasta
   que un usuario pregunta por qué no le aparece la pantalla.
   ========================================================================== */
seccion('8. El módulo existe en el catálogo');

try {
    const catalogo = leer(path.join(RAIZ, 'migrations', 'central', '002_catalogos.sql'));

    check(/^\s*\(\s*'reportes'\s*,/m.test(catalogo),
        'el catálogo de módulos declara `reportes`');

    /* Y que el nombre que se guarda sea el que pide `requiereModulo`. Si el
       catálogo lo llama `Reportes` con mayúscula y la ruta pide `reportes`, la
       comparación falla y la pantalla no abre nunca. */
    const fila = (catalogo.match(/^\s*\(\s*'([^']+)'\s*,/gm) || [])
        .map((s) => (s.match(/'([^']+)'/) || [])[1]);

    check(fila.includes('reportes'),
        'el código del módulo es exactamente `reportes`, en minúscula',
        `catálogo: ${fila.join(', ')}`);

    check(new Set(fila).size === fila.length,
        'no hay códigos de módulo repetidos en el catálogo',
        `repetidos: ${fila.filter((c, i) => fila.indexOf(c) !== i).join(', ')}`);

    check(/reportes/.test(server),
        'server.js conoce el módulo `reportes`');

} catch (e) {
    check(false, 'se puede leer el catálogo de módulos', e.message);
}

/* ==========================================================================
   9. PARTE VIVA
   --------------------------------------------------------------------------
   Lo de arriba lee archivos. Esto de abajo EJECUTA el servicio, y es la única
   forma de catching tres cosas que en el papel están bien:

     - que el total de repuestos cuadre con el total de las facturas. La
       consulta usa los valores guardados (`factura_items.subtotal`) y calcula
       solo el IVA; si mañana alguien cambia una de las dos, la diferencia
       aparece acá y no en la pantalla, que muestra los dos números sin
       compararlos.
     - que un teléfono conserve los ceros del principio.
     - que `leerRango` rechace un array, que es lo que pasa con `?desde[]=`.
   ========================================================================== */
if (!VIVO) {
    seccion('9. Parte viva (omitida)');
    console.log('  Correr con --vivo para ejecutar el servicio contra la base de la empresa.');
    fin();
} else {
    seccion('9. Parte viva: el servicio contra la base real');
    correrVivos();
}

/** Los tipos que el backend puede declarar en una columna. */
const TIPOS_CONOCIDOS = new Set([
    'texto', 'entero', 'decimal', 'pesos', 'porcentaje', 'fecha', 'mes', 'dias'
]);

/**
 * Ejecuta el servicio contra la base de la empresa #1.
 *
 * Se usa `conectarApp` y no `conectarAdmin` a propósito: es el mismo usuario con
 * el que corre la aplicación, y si a ese usuario no lo pueden leer una tabla o
 * una columna, el reporte tampoco va a poder, y eso tiene que salir acá y no
 * en producción.
 *
 * El nombre de la base va escrito, y es lo único escrito en todo el archivo: la
 * parte viva es explícitamente la de la empresa #1. El resto del verificador no
 * puede tener un nombre de base adentro, porque su trabajo es comprobar que en
 * el servicio no haya ninguno.
 */
async function correrVivos() {
    require('dotenv').config({ quiet: true });

    const R = require('../src/servicios/reportes');
    const conexiones = require('../src/db/conexiones');

    const BASE_EMPRESA_1 = 'serviceintegralsistema';

    let db = null;
    try {
        db = await conexiones.conectarApp(BASE_EMPRESA_1);
    } catch (e) {
        check(false, 'se puede abrir la conexión de la empresa #1', e.message);
        fin();
        return;
    }

    check(db !== null, 'se abre la conexión de la empresa #1 con el usuario de la aplicación');

    try {
        /* --- los seis corren y devuelven la forma que la pantalla espera --- */
        for (const codigo of R.CODIGOS) {
            let salida = null;
            let error = '';
            try {
                salida = await R.correr(db, codigo, { desde: null, hasta: null });
            } catch (e) {
                error = e.message;
            }

            check(error === '', `el reporte ${codigo} se ejecuta sin error`, error);
            if (!salida) continue;

            check(Array.isArray(salida.filas), `${codigo}: devuelve filas`);
            check(Array.isArray(salida.resumen), `${codigo}: devuelve tarjetas de resumen`);
            check(Array.isArray(salida.columnas) && salida.columnas.length > 0, `${codigo}: declara columnas`);
            check(salida.titulo && salida.descripcion, `${codigo}: trae título y descripción`);

            /* Toda columna declarada tiene que existir en las filas, o la
               pantalla pinta `-` en una columna que nunca va a tener dato. Con
               cero filas no se puede comprobar nada, y no es un fallo: un filtro
               de fechas que no agarra nada tiene que devolver una tabla vacía. */
            const faltan = salida.columnas
                .filter((c) => !c || typeof c.clave !== 'string' || !c.clave)
                .concat(salida.columnas.filter((c) => c.clave && !salida.filas.some((f) => c.clave in f)));

            check(faltan.length === 0 || !salida.filas.length,
                `${codigo}: todas las columnas declaradas existen en las filas`,
                `columnas sin dato: ${[...new Set(faltan.map((c) => (c && c.clave) || JSON.stringify(c)))].join(', ')}`);

            /* El tipo declarado tiene que estar en la lista de los que el
               frontend sabe pintar. Acá se usa la lista del servicio, que es la
               que manda. */
            const tipoRaro = salida.columnas.filter((c) => !TIPOS_CONOCIDOS.has(c.tipo));
            check(tipoRaro.length === 0,
                `${codigo}: todas las columnas usan un tipo conocido`,
                `tipos raros: [...new Set(tipoRaro.map((c) => c.tipo))].join(', ')}`);

            /* El código del reporte no puede haber salido de la URL. */
            check(salida.reporte === codigo, `${codigo}: devuelve su propio código`);
        }

        /* --- el filtro de un día parte el total --- */
        {
            const mes = await R.correr(db, 'ventas-por-mes', { desde: null, hasta: null });
            const todo = mes.filas.reduce((a, f) => a + Number(f.total || 0), 0);
            const conRango = await R.correr(db, 'ventas-por-mes', { desde: '2000-01-01', hasta: '2099-12-31' });

            const conRangoTotal = conRango.filas.reduce((a, f) => a + Number(f.total || 0), 0);

            check(Math.abs(todo - conRangoTotal) < 0.01,
                'un rango enorme devuelve lo mismo que sin filtro',
                `${todo} vs ${conRangoTotal}`);

            const unDia = await R.correr(db, 'ventas-por-mes', { desde: '2000-01-01', hasta: '2000-01-01' });
            check(unDia.filas.length === 0,
                'un rango de un día que no tiene nada devuelve cero filas, no error');
        }

        /* --- la participación tiene que sumar 100, si no miente --- */
        {
            const r = await R.correr(db, 'presupuestos-y-conversion', { desde: null, hasta: null });
            const suma = r.filas.reduce((a, f) => a + Number(f.participacion || 0), 0);

            check(Math.abs(suma - 100) < 0.5,
                'las participaciones del reporte de presupuestos suman 100 %',
                `suman ${suma} %`);

            check(r.columnas.some((c) => c.clave === 'participacion'),
                'el reporte de presupuestos declara la columna de participación');

            /* Y cada fila tiene que tenerla, o la pantalla muestra un guion en
               una columna que el dueño lee todas las semanas. Este caso salió de
               ahí: la columna estaba declarada y el SQL no la traía. */
            check(r.filas.every((f) => typeof f.participacion === 'number'),
                'toda fila trae la participación como número, no ausente',
                JSON.stringify(r.filas.map((f) => f.participacion)));
        }

        /* --- el total de repuestos tiene que ser el de las facturas --- */
        {
            const [fac] = await db.query(
                "SELECT COALESCE(SUM(total), 0) AS t FROM facturas WHERE estado IN ('EMITIDA','PAGADA')"
            );
            const rep = await R.correr(db, 'repuestos-mas-vendidos', { desde: null, hasta: null });
            const suma = rep.filas.reduce((a, f) => a + Number(f.total || 0), 0);
            const esperado = Number(fac[0].t);

            check(Math.abs(suma - esperado) < 0.01,
                'la suma de repuestos más vendidos es la suma de las facturas emitidas y pagadas',
                `${suma} vs ${esperado}`);
        }

        /* --- cuentas por cobrar: solo lo que está emitido y sin pagar --- */
        {
            const [fac] = await db.query(
                "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM facturas WHERE estado = 'EMITIDA' AND fecha_pago IS NULL"
            );
            const cpc = await R.correr(db, 'cuentas-por-cobrar', { desde: null, hasta: null });
            const suma = cpc.filas.reduce((a, f) => a + Number(f.total || 0), 0);

            check(cpc.filas.length === Number(fac[0].n),
                'cuentas por cobrar lista exactamente las facturas emitidas sin pagar',
                `${cpc.filas.length} vs ${fac[0].n}`);
            check(Math.abs(suma - Number(fac[0].t)) < 0.01,
                'el total a cobrar es la suma de esas facturas',
                `${suma} vs ${fac[0].t}`);

            /* Y ninguna puede estar pagada: si el servidor mandar una pagada,
               el taller la cobra de nuevo. */
            const pagadas = cpc.filas.filter((f) => Number(f.dias || 0) < 0);
            check(pagadas.length === 0,
                'ninguna factura de cuentas por cobrar tiene fecha de pago en el futuro');
        }

        /* --- un teléfono conserva los ceros --- */
        {
            const cpc = await R.correr(db, 'cuentas-por-cobrar', { desde: null, hasta: null });
            const conTelefono = cpc.filas.filter((f) => f.telefono);

            check(conTelefono.every((f) => typeof f.telefono === 'string'),
                'el teléfono vuelve como texto, para que no pierda los ceros del principio',
                JSON.stringify(conTelefono.map((f) => f.telefono)));
        }

        /* --- `leerRango` con lo que se puede mandar en la URL --- */
        {
            const casos = [
                ['una fecha que no existe', { desde: '2026-02-31' }, false],
                ['una fecha con basura', { desde: "2026-01-01' OR '1'='1" }, false],
                ['un rango al revés', { desde: '2026-10-31', hasta: '2026-10-01' }, false],
                ['un array', { desde: ['2026-10-01'] }, false],
                ['un objeto', { hasta: { a: 1 } }, false],
                ['un número', { desde: 20261001 }, false],
                ['un rango bueno', { desde: '2026-10-01', hasta: '2026-10-31' }, true],
                ['nada', {}, true],
                ['cadena vacía', { desde: '' }, true],
                ['con espacios', { desde: ' 2026-10-01 ' }, true]
            ];

            for (const [nombre, query, esperado] of casos) {
                const r = R.leerRango(query);
                check(r.ok === esperado, `leerRango: ${nombre}`,
                    `ok=${r.ok} ${r.error || ''}`);
            }

            check(R.leerRango({ desde: '' }).desde === null,
                'leerRango: una cadena vacía es "sin filtro", no una fecha');
        }

        /* --- el código inventado no llega a la base --- */
        {
            check(R.existe('ventas-por-mes'), 'existe() reconoce un código real');
            check(!R.existe('inventado'), 'existe() rechaza un código inventado');
            check(!R.existe(''), 'existe() rechaza el código vacío');
            check(!R.existe('toString'), 'existe() no se deja fooled por una clave heredada del objeto');
            check(!R.existe('constructor'), 'existe() no se deja fooled por "constructor"');
            check(!R.existe('__proto__'), 'existe() no se deja fooled por "__proto__"');
        }

        /* --- el CSV --- */
        {
            const vpm = await R.correr(db, 'ventas-por-mes', { desde: null, hasta: null });
            const buf = R.aCsv(vpm);

            check(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'el CSV arranca con BOM');

            const texto = buf.slice(3).toString('utf8');
            const lineas = texto.split('\r\n');
            const encabezado = vpm.columnas.map((c) => c.titulo).join(',');

            check(lineas[0] === encabezado,
                'el encabezado del CSV es el de las columnas del reporte',
                `"${lineas[0]}" vs "${encabezado}"`);

            check(/Totales del per/i.test(texto), 'el CSV trae el bloque de totales');

            /* Anti-fórmula: solo texto. */
            check(R.campoCsv('=SUM(A1)') === "'=SUM(A1)",
                'campoCsv() le pone apóstrofo a un texto que empieza con =');
            check(R.campoCsv('@x') === "'@x",
                'campoCsv() le pone apóstrofo a un texto que empieza con @');
            check(R.campoCsv(-1234.56) === '-1234.56',
                'campoCsv() NO le pone apóstrofo a un número negativo: dejaría de sumar en Excel');
            check(R.campoCsv(6050) === '6050',
                'campoCsv() deja los números crudos');

            /* RFC 4180 */
            check(R.campoCsv('a,b') === '"a,b"', 'campoCsv() entrecomilla la coma');
            check(R.campoCsv('a;b') === '"a;b"', 'campoCsv() entrecomilla el punto y coma');
            check(R.campoCsv('a"b') === '"a""b"', 'campoCsv() duplica la comilla doble');
            check(R.campoCsv('a\r\nb') === '"a\r\nb"', 'campoCsv() entrecomilla el salto de línea');
            check(R.campoCsv('San José') === 'San José', 'campoCsv() deja los acentos como están');
            check(R.campoCsv(null) === '', 'campoCsv() de un null es el campo vacío');
            check(R.campoCsv(undefined) === '', 'campoCsv() de un undefined es el campo vacío');

            /* El nombre del archivo */
            check(R.nombreArchivo('ventas-por-mes', { desde: '2026-10-01', hasta: '2026-10-31' })
                === 'reporte_ventas-por-mes_2026-10-01_a_2026-10-31.csv',
                'nombreArchivo() arma el nombre con el código y el rango');

            check(R.nombreArchivo('ventas-por-mes', { desde: null, hasta: null })
                === 'reporte_ventas-por-mes.csv',
                'sin rango, el nombre no lleva el sufijo');

            check(!/[^\x20-\x7e]/.test(R.nombreArchivo('ventas-por-mes', { desde: 'ñ/../..', hasta: null })),
                'nombreArchivo() saca todo lo que no sea letra, número, punto, guion o guion bajo');
        }

    } finally {
        /* El cierre y el `fin()` van en el `finally`: si una comprobación tira, el
           proceso igual cierra la conexión y todavía imprime cuántas
           comprobaciones pasaron. Un verificador que se corta a mitad no sirve
           para comparar contra el run anterior. */
        try {
            if (db) await db.end();
        } catch { /* si no se puede cerrar, no es un fallo del verificador */ }
        fin();
    }
}
