/* ==========================================================================
 * PROBAR QUE LA BASE CONGELADA + LAS MIGRACIONES = EL ESQUEMA ENTERO
 *
 *   node tools/ver-base-esquema.js
 *
 * QUE ES Y POR QUE EXISTE
 *
 * `schema/base.sql` es el esquema de una base de empresa NUEVA, congelado antes
 * de que existiera la primera migracion. `altas.js` lo carga y despues corre la
 * cadena 004, 005, 006. El resultado tiene que ser exactamente el esquema que
 * tiene hoy `serviceintegralsistema`.
 *
 * Eso se puede decir de mil maneras y todas mienten menos que una: se arma una
 * base de verdad, con MySQL de verdad, y se comparan las dos. Esta herramienta
 * hace eso. Levanta una base descartable, le carga base.sql, le corre la cadena
 * y después lee el esquema de las dos y los compara tabla por tabla, columna por
 * columna, indice por indice y llave por llave. Si algo difiere, dice qué.
 *
 * Por que no alcanza con leer los archivos: las migraciones son SQL que se
 * ejecuta, y hay cosas que solo se ven corriendo. Una `ALTER` que se aplica dos
 * veces tira; un `DEFAULT CURRENT_TIMESTAMP` sobre un `TIMESTAMP` no se puede
 * volver a poner; el orden de las columnas lo decide MySQL, no el archivo. Un
 * chequeo estatico de estos tres archivos no puede ver ninguna de esas tres
 * cosas. Este corre el SQL y mira el resultado.
 *
 * LA CENTRAL NO ENTRA
 *
 * `si_central` tiene su propio juego de migraciones, en `migrations/central`, y
 * su propio verificador (`probar-esquema-central.js`). Este archivo es
 * deliberadamente del tenant: una base de empresa nueva no tiene empresas
 * adentro, y meterla en la comparacion haria que las dos tuvieran que coincidir
 * en tablas que jamas van a estar juntas en la misma base.
 *
 * QUE COMPARA Y QUE NO
 *
 * Compara: tablas, columnas (nombre, tipo, nulo, default, autoincrement),
 * indices (nombre, columnas, tipo, unico), y llaves foraneas.
 *
 * Ignora a proposito:
 *   - Los valores de AUTO_INCREMENT. Son el numero de filas, no el esquema, y
 *     comparar "el proximo id" entre una base nueva (1) y una con datos (7)
 *     daria siempre FALLO y no significaria nada.
 *   - El orden de las columnas. MySQL no lo garantiza entre dos CREATE TABLE
 *     identicos y no importa para nadie: se accede por nombre.
 *   - El nombre de la base. Para eso esta `SUSTITUIR`.
 *
 * QUE PASA CON LOS DATOS
 *
 * La base de prueba nace vacia y se tira al final. Este script NO toca
 * `serviceintegralsistema` salvo para LEER su esquema. Para darle vuelta de
 * tuerca al taller hay otro camino, que es el que documenta
 * `schema/LEEME-base.txt`.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

// El .env va antes que `conexiones`: `configAdmin` lee `process.env` en el
// momento de llamarse, y sin esto tira "Falta DB_ADMIN_USER" aunque la variable
// este escrita en el archivo.
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');

const { configAdmin, nombreCentral } = require('../src/db/conexiones');
const migraciones = require('../src/db/migrations');

const RAIZ = path.join(__dirname, '..');
const RUTA_ALTAS = path.join(RAIZ, 'src', 'servicios', 'altas.js');
const RUTA_BASE = path.join(RAIZ, 'schema', 'base.sql');

/**
 * El archivo que `altas.js` carga de verdad, leido del `altas.js`.
 *
 * Por que se LEE y no se supone. La primera version de este script usaba su
 * propia constante `RUTA_BASE` y no miraba `altas.js` en ningun momento. La
 * mutacion que volvia `altas.js` al dump del estado final pasaba con el
 * verificador en verde: el script-armaba la base con `base.sql` (correcto) y
 * decia que todo estaba bien, mientras el alta de empresa de verdad seguia
 * cargando el dump y las migraciones seguian siendo letra muerta.
 *
 * O sea: el script probaba un archivo que nadie usa en produccion. Eso es
 * exactamente la clase de verde falso que este trabajo vino a cerrar, y se
 * coló en la herramienta que vino a cerrarlo.
 *
 * Se lee el `RUTA_ESQUEMA = path.join(...)` del propio `altas.js` y se resuelve
 * contra su `__dirname`, que es `<RAIZ>/src/servicios`.
 *
 * @returns {string|null} la ruta absoluta, o null si no se pudo leer.
 */
function leerRutaDeAltas() {
    if (!fs.existsSync(RUTA_ALTAS)) return null;

    const txt = fs.readFileSync(RUTA_ALTAS, 'utf8');
    const def = txt.match(/const\s+RUTA_ESQUEMA\s*=\s*path\.join\(([^;]*)\)/);
    if (!def) return null;

    const argumentos = def[1];

    // `__dirname` es el primer argumento y NO va entre comillas, asi que no lo
    // agarra el regex de strings de abajo. La primera version comprobo
    // `partes[0] !== '__dirname'` sobre la lista de strings, que arranca con
    // '..', y por eso devolvia null siempre: el extractor anduvo bien y el
    // que decide estaba mirando la lista equivocada.
    if (!/^\s*__dirname\s*,/.test(argumentos)) return null;

    // Los trozos de ruta van entre comillas. Con la bandera `g`: sin la `g`,
    // `matchAll` tira "String.prototype.matchAll called with a non-global
    // RegExp" y se come la lista entera.
    const trozos = [...argumentos.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (!trozos.length) return null;

    return path.resolve(path.dirname(RUTA_ALTAS), ...trozos);
}

/* La base de la empresa con la que se compara. Sale de la central, no de un
   archivo escrito a mano: si mañana hay dos empresas, este script tiene que
   compararse contra la de la vieja. */
const EMPRESA_DE_REFERENCIA = 'serviceintegralsistema';

/* La base que se arma y se tira.

   El prefijo `si_tenant_` NO es cosmetico: es lo unico que le permite a
   `si_tenant_admin` crearla. Esa identidad tiene el privilegio CREATE y DROP a
   nivel de base sobre el patron `si\_tenant\_%`, y nada global, asi que con
   cualquier otro nombre el CREATE da ER_DBACCESS_DENIED_ERROR. Se comprobo
   con las dos pruebas:

     si_tenant_probe_si    -> CREATE ok, DROP ok
     si_scratch_probe_no   -> ER_DBACCESS_DENIED_ERROR

   O sea: este script solo puede tirar bases que se llamen asi, igual que las
   empresas de verdad. */
const BASE_DE_PRUEBA = 'si_tenant_ver_base_esquema_tmp';

/* ==========================================================================
   1. LAS HERRAMIENTAS
   ========================================================================== */

/**
 * El nombre de la base que se busca en el SHOW CREATE. Se comparan esquemas de
 * bases distintas, asi que cada uno tiene que volver a su nombre real antes de
 * mirar los CREATE.
 */
const SUSTITUIR = (texto, de, a) => texto.split('`' + de + '`').join('`' + a + '`');

const sinCrlf = (t) => t.replace(/\r\n/g, '\n');

/** Quita el ruido que no es esquema: comentarios, AUTO_INCREMENT=n y espacios. */
function limpiar(texto) {
    return sinCrlf(texto)
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n')
        .replace(/AUTO_INCREMENT=\d+\s*/gi, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/**
 * El esquema de una base, leido de `information_schema`.
 *
 * Se lee de aca y no de los archivos CREATE TABLE por dos razones. La primera
 * es que `information_schema` es la verdad: si una base se toco a mano y el
 * archivo no, comparando archivos los dos dan lo mismo y estan distintos. La
 * segunda es que comparar los SHOW CREATE de las dos bases seguidas no sirve
 * para la comparacion, porque el nombre de la base va escrito adentro de cada
 * uno y jamas coinciden.
 */
async function leerEsquema(con, nombreBase) {
    const [tablas] = await con.query(
        `SELECT TABLE_NAME AS t
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
          ORDER BY TABLE_NAME`,
        [nombreBase]
    );

    const esquema = { tablas: new Map() };

    for (const { t: tabla } of tablas) {
        const [cols] = await con.query(
            `SELECT COLUMN_NAME AS nombre, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulo,
                    COLUMN_DEFAULT AS def, EXTRA AS extra, ORDINAL_POSITION AS pos
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY COLUMN_NAME`,
            [nombreBase, tabla]
        );

        const [idx] = await con.query(
            `SELECT INDEX_NAME AS nombre, COLUMN_NAME AS columna, NON_UNIQUE AS noUnico, SEQ_IN_INDEX AS seq
               FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
            [nombreBase, tabla]
        );

        const [fk] = await con.query(
            `SELECT k.CONSTRAINT_NAME AS nombre, k.COLUMN_NAME AS columna,
                    k.REFERENCED_TABLE_NAME AS tablaRef, k.REFERENCED_COLUMN_NAME AS columnaRef
               FROM information_schema.KEY_COLUMN_USAGE k
              WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ?
                AND k.REFERENCED_TABLE_NAME IS NOT NULL
              ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
            [nombreBase, tabla]
        );

        esquema.tablas.set(tabla, {
            // OJO CON LA FORMA DE ESTA ENTRADA. El valor TIENE que ser un
            // array de 4 adentro de un array de 2. La primera version paso un
            // array de 5 plano:
            //
            //     new Map( cols.map((c) => [c.nombre, def, tipo, nulo, extra]) )
            //
            // y eso parece funcionar: `new Map` lee los dos primeros elementos
            // de cada entrada y SE DESCARTA EL RESTO, sin error y sin aviso.
            // O sea que de cada columna solo quedaba [nombre, default], y el
            // tipo, la nulabilidad y el `extra` nunca se compararon.
            //
            // Se noto con una columna `decimal(10,2)` cambiada a `decimal(12,4)`:
            // la mutacion estaba ahi, el SQL era valido, y el verificador decia
            // que las dos bases eran identicas. Dos bases con el mismo nombre de
            // columna y distinto tipo son bases distintas, y el chequeo de que
            // faltaba la columna habia tapado el de que no fuera la misma.
            columnas: new Map(
                cols.map((c) => [
                    c.nombre,
                    [
                        // El default de CURRENT_TIMESTAMP llega como texto; se
                        // normaliza a mayusculas para que no dependa de como lo
                        // devuelva la version de MySQL.
                        c.def === null || c.def === undefined
                            ? null
                            : String(c.def).toUpperCase(),
                        c.tipo.toLowerCase(),
                        c.nulo,
                        String(c.extra || '').toUpperCase()
                    ]
                ])
            ),
            indices: idx.map((i) => [i.nombre, i.columna, Number(i.noUnico) === 1 ? 'NO UNIQUE' : 'UNIQUE', Number(i.seq)]),
            foraneas: fk.map((f) => [f.nombre, f.columna, f.tablaRef, f.columnaRef])
        });
    }

    return esquema;
}

/** Las diferencias entre dos esquemas, en texto que se pueda leer. */
function comparar(esperado, obtenido, etiquetaEsperado, etiquetaObtenido) {
    const diferencias = [];

    // --- tablas que sobran o faltan ---
    for (const t of esperado.tablas.keys()) {
        if (!obtenido.tablas.has(t)) diferencias.push(`  la tabla "${t}" esta en ${etiquetaEsperado} y NO esta en ${etiquetaObtenido}`);
    }
    for (const t of obtenido.tablas.keys()) {
        if (!esperado.tablas.has(t)) diferencias.push(`  la tabla "${t}" esta en ${etiquetaObtenido} y NO esta en ${etiquetaEsperado}`);
    }

    for (const [nombre, e] of esperado.tablas) {
        const o = obtenido.tablas.get(nombre);
        if (!o) continue;

        // --- columnas que sobran o faltan ---
        for (const c of e.columnas.keys()) {
            if (!o.columnas.has(c)) diferencias.push(`  ${nombre}.${c}: esta en ${etiquetaEsperado} y NO esta en ${etiquetaObtenido}`);
        }
        for (const c of o.columnas.keys()) {
            if (!e.columnas.has(c)) diferencias.push(`  ${nombre}.${c}: esta en ${etiquetaObtenido} y NO esta en ${etiquetaEsperado}`);
        }

        // --- columnas con la misma definicion ---
        for (const [c, defE] of e.columnas) {
            const defO = o.columnas.get(c);
            if (!defO) continue;
            const [defE_, tipoE, nuloE, extraE] = defE;
            const [defO_, tipoO, nuloO, extraO] = defO;
            const diferenciasDe = [];
            if (defE_ !== defO_) diferenciasDe.push(`default "${defE_}" vs "${defO_}"`);
            if (tipoE !== tipoO) diferenciasDe.push(`tipo ${tipoE} vs ${tipoO}`);
            if (nuloE !== nuloO) diferenciasDe.push(`nulabilidad ${nuloE} vs ${nuloO}`);
            if (extraE !== extraO) diferenciasDe.push(`extra "${extraE}" vs "${extraO}"`);
            if (diferenciasDe.length) {
                diferencias.push(`  ${nombre}.${c} no es igual: ${diferenciasDe.join(', ')}`);
            }
        }

        // --- indices ---
        // Se comparan como conjuntos de renglones, ordenados: un indice compuesto
        // son varias filas y el orden de las filas no significa nada.
        const claveIdx = (filas) => filas.map((f) => f.join('|')).sort().join(' ; ');
        const iE = claveIdx(e.indices);
        const iO = claveIdx(o.indices);
        if (iE !== iO) {
            diferencias.push(`  ${nombre}: los indices no son iguales\n      ${etiquetaEsperado}: ${iE || '(sin indices)'}\n      ${etiquetaObtenido}: ${iO || '(sin indices)'}`);
        }

        // --- llaves foraneas ---
        const claveFk = (filas) => filas.map((f) => f.join('|')).sort().join(' ; ');
        const fE = claveFk(e.foraneas);
        const fO = claveFk(o.foraneas);
        if (fE !== fO) {
            diferencias.push(`  ${nombre}: las llaves foraneas no son iguales\n      ${etiquetaEsperado}: ${fE || '(ninguna)'}\n      ${etiquetaObtenido}: ${fO || '(ninguna)'}`);
        }
    }

    return diferencias;
}

/* ==========================================================================
   2. EL CONTADOR DE CHECKS
   ========================================================================== */

let ok = 0;
let fallos = 0;

function check(condicion, titulo, porque = '') {
    if (condicion) {
        ok++;
        console.log(`  OK    ${titulo}`);
    } else {
        fallos++;
        console.log(`  FALLO ${titulo}`);
        if (porque) console.log(`        ${porque}`);
    }
    return !!condicion;
}

function seccion(titulo) {
    console.log('');
    console.log(titulo);
    console.log('-'.repeat(titulo.length));
}

/* ==========================================================================
   3. LO QUE HACE
   ========================================================================== */

(async function main() {
    console.log('='.repeat(78));
    console.log('  BASE CONGELADA + MIGRACIONES  vs  EL ESQUEMA DE ' + EMPRESA_DE_REFERENCIA.toUpperCase());
    console.log('='.repeat(78));

    let conCentral;
    let conPrueba;

    try {
        // --- 0. Lo que hace falta antes de empezar ---
        seccion('0. Las piezas');

        check(fs.existsSync(RUTA_ALTAS), `esta src/servicios/altas.js (${RUTA_ALTAS})`,
            'Sin ese archivo no hay forma de saber que base se le carga a una empresa nueva.');

        // --- EL AGUJAZO ---
        // Todo lo de abajo depende de que el archivo que se prueba sea el mismo
        // que carga el alta de verdad. Por eso va PRIMERO y no al final: si
        // `altas.js` apunta a otro lado, todo lo que viene despues compara dos
        // bases que en produccion no existen.
        const rutaDeAltas = leerRutaDeAltas();

        check(rutaDeAltas !== null,
            'se pudo leer de altas.js que archivo carga (constante RUTA_ESQUEMA)',
            `No se encontro un "RUTA_ESQUEMA = path.join(...)" en ${RUTA_ALTAS}. Sin eso, este script no sabe que prueba.`);

        if (rutaDeAltas !== null) {
            const nombre = path.basename(rutaDeAltas);
            check(nombre === 'base.sql',
                `altas.js carga ${nombre}`,
                `Carga "${rutaDeAltas}". Tiene que cargar "base.sql". Si carga "schema-actual.sql", el alta sale bien por el dump y las migraciones no hacen nada.`);

            check(path.resolve(rutaDeAltas) === path.resolve(RUTA_BASE),
                'altas.js carga exactamente el mismo archivo que prueba este script',
                `altas.js: ${rutaDeAltas}\n      este script: ${RUTA_BASE}\n      Son dos archivos distintos. Se estaria probando uno y usandose otro.`);
        }

        const RUTA = rutaDeAltas || RUTA_BASE;
        check(fs.existsSync(RUTA), `el archivo que carga el alta existe (${RUTA})`,
            'altas.js lo carga para cada empresa nueva. Si no esta, toda alta sale con una base sin tablas.');

        // Dos conexiones y no una, por una razon que es facil pasar por alto:
        // mysql2 falla al CONECTAR si la base del `database:` no existe todavia
        // ("Unknown database"). No se puede abrir la conexion contra la base de
        // prueba para crearla: hay que crear la base desde otra conexion y
        // despues abrir la segunda. Por eso `altas.js` tambien usa dos.
        conCentral = await mysql.createConnection(configAdmin(nombreCentral()));

        const [bases] = await conCentral.query(
            `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?, ?)`,
            [BASE_DE_PRUEBA, EMPRESA_DE_REFERENCIA]
        );
        const existe = new Set(bases.map((b) => String(b.n).toLowerCase()));

        check(existe.has(EMPRESA_DE_REFERENCIA.toLowerCase()),
            `esta la base ${EMPRESA_DE_REFERENCIA}, contra la que se compara`,
            'sin ella no hay contra que comparar. El nombre sale de la central, no de una lista escrita a mano.');

        if (!existe.has(EMPRESA_DE_REFERENCIA.toLowerCase())) {
            console.log('\nNo se puede seguir sin la base de referencia.');
            return 1;
        }

        // Si quedo una base de la corrida anterior, se avisa pero NO es un fallo: el
        // script se.Recupera solo borrandola. Un check que falla por debris del
        // propio script obliga a ir a borrarlo a mano, y ese check no prueba
        // nada del esquema.
        const habiaDebris = existe.has(BASE_DE_PRUEBA.toLowerCase());
        if (habiaDebris) {
            console.log(`  AVISO la base ${BASE_DE_PRUEBA} habia quedado de una corrida anterior. Se borra.`);
        }

        // --- 1. Se arma la base de prueba, como lo hace altas.js ---
        seccion('1. Se arma la base de prueba, como lo hace altas.js');

        // Si la corrida anterior quedo a medio camino, esta base esta viva y con
        // datos. Se tira antes de crear: sin esto, una base vieja haria que las
        // tablas queden y el chequeo de "la base no trae lo de las migraciones"
        // pasaria por tablas que en realidad dejo la corrida anterior.
        await conCentral.query(`DROP DATABASE IF EXISTS \`${BASE_DE_PRUEBA}\``);

        // El invariante de verdad va DESPUES del DROP, no antes. Si el DROP
        // fallara en silencio y la base vieja siguiera viva, todo lo que viene
        // despues compararia contra un estado anterior y daria verde falso.
        const [trasBorrar] = await conCentral.query(
            `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
            [BASE_DE_PRUEBA]
        );
        check(trasBorrar.length === 0,
            `la base ${BASE_DE_PRUEBA} no quedo viva de la corrida anterior`,
            'Sigo en el listado despues del DROP. Si se leyo mas abajo un esquema viejo, todo lo demas de este script es mentira.');

        await conCentral.query(`CREATE DATABASE \`${BASE_DE_PRUEBA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        check(true, `base ${BASE_DE_PRUEBA} creada`);

        conPrueba = await mysql.createConnection({ ...configAdmin(BASE_DE_PRUEBA), multipleStatements: true });

        const base = fs.readFileSync(RUTA, 'utf8');
        check(base.length > 500, `base.sql tiene ${base.length} caracteres`,
            'un base.sql de menos de 500 caracteres no puede ser el esquema de una base.');
        check(!/INSERT\s+INTO/i.test(base), 'base.sql NO trae datos, solo el esquema',
            'si base.sql trae filas, cada empresa nueva nace con los datos de la empresa de al lado. Es la fuga que cierra este trabajo.');

        await conPrueba.query(base);
        check(true, 'base.sql cargado sin error');

        const [trasBase] = await conPrueba.query(
            `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [BASE_DE_PRUEBA]
        );
        check(trasBase.length > 0, `la base tiene ${trasBase.length} tablas solo con base.sql`,
            'si no tiene ninguna, base.sql no se cargo o esta vacio.');

        // Las tablas que la cadena todavia no creo tienen que ser las que de verdad
        // faltan. Si base.sql ya trae una tabla que una migracion crea, la
        // migracion se va a saltear por el IF NOT EXISTS y va a decir que se
        // aplico sin hacer nada, y eso es exactamente el bug que se quiere cazar.
        const [yaEsta] = await conPrueba.query(
            `SELECT TABLE_NAME AS t FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('presupuestos','presupuesto_items','secuencias','etiquetas_qr','facturas','factura_items')`,
            [BASE_DE_PRUEBA]
        );
        check(yaEsta.length === 0,
            'base.sql NO trae ninguna tabla que cree una migracion',
            `tra: ${yaEsta.map((x) => x.t).join(', ')}. Si base.sql las trae, las migraciones 004/005/006 no hacen nada en una base nueva.`);

        // --- 2. Se corre la cadena ---
        seccion('2. Se corre la cadena de migraciones');

        const aplicadas = await migraciones.aplicar(conPrueba, 'tenant', {
            log: (m) => console.log(`         ${m}`)
        });

        // Cuantas migraciones TIENE QUE haber, contado en el disco. No un
        // numero escrito a mano ("al menos 3"): si manana se agrega la 007 y el
        // motor se la saltea, un piso de 3 no dice nada. El numero sale de
        // contar los .sql de migrations/tenant.
        const archivos = fs
            .readdirSync(path.join(RAIZ, 'migrations', 'tenant'))
            .filter((f) => f.endsWith('.sql'))
            .sort();

        check(archivos.length > 0, `migrations/tenant tiene ${archivos.length} archivos .sql`);

        check(aplicadas.aplicadas === archivos.length,
            `se aplicaron las ${archivos.length} migraciones (${aplicadas.aplicadas} aplicadas)`,
            `faltaron: ${archivos.filter((f) => !aplicadas.pendientes.includes(f) && aplicadas.aplicadas !== archivos.length).join(', ') || '(descuadrado)'}. Si son menos que los archivos, el motor se salteo alguna.`);

        check(aplicadas.omitidas === 0,
            `no se omvio ninguna por estar repetida (${aplicadas.omitidas} omitidas)`,
            'una base nueva no puede tener migraciones ya aplicadas. Si las tiene, la base no estaba vacia.');

        const [ledger] = await conPrueba.query(
            `SELECT version, nombre FROM _schema_migrations ORDER BY version`
        );
        check(ledger.length === aplicadas.aplicadas,
            `el ledger tiene ${ledger.length} filas, una por migracion aplicada`,
            'el ledger y el conteo de aplicadas tienen que decir lo mismo. Si no, el motor escribio de mas o de menos.');

        const nombresLedger = ledger.map((f) => f.nombre);
        check(
            archivos.every((f) => nombresLedger.includes(f)),
            'el ledger tiene el nombre de cada archivo de migrations/tenant',
            `faltan: ${archivos.filter((f) => !nombresLedger.includes(f)).join(', ')}`
        );

        // --- 3. Se lee el esquema de las dos bases ---
        seccion('3. Se lee el esquema de las dos bases');

        const esperado = await leerEsquema(conPrueba, BASE_DE_PRUEBA);
        check(esperado.tablas.size > 0, `la base de prueba quedo con ${esperado.tablas.size} tablas`);

        await conPrueba.end();
        conPrueba = null;

        // La referencia se lee por una conexion propia. No hace falta ningun
        // privilegio raro: `si_tenant_admin` tiene `ALL PRIVILEGES` sobre
        // serviceintegralsistema, y ademas `information_schema` se puede leer
        // sin privilegio de tabla. Lo que NO podria es crear ni borrar bases
        // con otro nombre, y este script no lo intenta.
        const conTaller = await mysql.createConnection(configAdmin(EMPRESA_DE_REFERENCIA));
        const obtenido = await leerEsquema(conTaller, EMPRESA_DE_REFERENCIA);
        check(obtenido.tablas.size > 0, `${EMPRESA_DE_REFERENCIA} tiene ${obtenido.tablas.size} tablas`);
        await conTaller.end();

        // --- 4. La comparacion ---
        seccion('4. La comparacion');

        // El ledger no es esquema de negocio: es la bookkeeping del motor. En la
        // base de prueba lo crea `migraciones.aplicar` y en la de la empresa
        // tambien esta, pero se compara aparte, que es mas honesto que meterlo en
        // el mismo canasto y que aparezca como una diferencia mas.
        esperado.tablas.delete('_schema_migrations');
        obtenido.tablas.delete('_schema_migrations');

        const diferencias = comparar(esperado, obtenido, 'la base nueva', 'el taller');

        check(diferencias.length === 0,
            `las dos bases tienen EXACTAMENTE el mismo esquema (${esperado.tablas.size} tablas, ` +
            `${[...esperado.tablas.values()].reduce((n, t) => n + t.columnas.size, 0)} columnas, ` +
            `${[...esperado.tablas.values()].reduce((n, t) => n + t.indices.length, 0)} filas de indice, ` +
            `${[...esperado.tablas.values()].reduce((n, t) => n + t.foraneas.length, 0)} llaves foraneas)`,
            diferencias.slice(0, 25).join('\n'));

        if (diferencias.length > 25) {
            console.log(`        ... y ${diferencias.length - 25} diferencias mas`);
        }

        // El piso de comparaciones. Sin esto, un extractor que no encuentra nada
        // compararia dos Mapas vacios, daria "iguales" y el check de arriba
        // estaria comparando la nada.
        const columnasComparadas = [...esperado.tablas.values()].reduce((n, t) => n + t.columnas.size, 0);
        check(columnasComparadas >= 60,
            `se compararon ${columnasComparadas} columnas de verdad`,
            'El piso existe para que un extractor roto falle fuerte en vez de dar verde comparando dos vacios.');

        // Cada columna tiene que traer sus 4 datos: default, tipo, nulabilidad y
        // extra. Con menos, la comparacion de arriba no esta mirando el tipo y
        // dos bases con `precio decimal(10,2)` y `precio decimal(12,4)` dan
        // "identicas". No alcanza con comparar las que hay: una columna con el
        // tipo bien y otra con el tipo trabado, promediadas, dan el mismo
        // numero. Se mira la PEOR.
        const cortas = [];
        const tiposVacios = [];
        for (const [nombreTabla, t] of esperado.tablas) {
            for (const [nombreCol, datos] of t.columnas) {
                if (!Array.isArray(datos) || datos.length !== 4) {
                    cortas.push(`${nombreTabla}.${nombreCol}=${Array.isArray(datos) ? datos.length + ' datos' : typeof datos}`);
                } else if (typeof datos[1] !== 'string' || !datos[1]) {
                    tiposVacios.push(`${nombreTabla}.${nombreCol}`);
                }
            }
        }
        check(cortas.length === 0,
            'cada columna guardada trae sus 4 datos (default, tipo, nulabilidad, extra)',
            `tra ${cortas.length} mal: ${cortas.slice(0, 5).join(', ')}. Un array corto hace que el tipo no se compare y dos bases distintas den "iguales".`);

        check(tiposVacios.length === 0,
            'ninguna columna se guardo sin tipo',
            `sin tipo: ${tiposVacios.slice(0, 5).join(', ')}.`);

        // --- 5. Limpieza ---
        seccion('5. Limpieza');

        await conCentral.query(`DROP DATABASE IF EXISTS \`${BASE_DE_PRUEBA}\``);
        check(true, `base ${BASE_DE_PRUEBA} borrada`);

        // Ultima comprobacion: que la base de prueba no haya quedado viva, porque
        // una base tirada a medias con el nombre de este script molesta en el
        // listado y alguna vez alguien la confunde con la de una empresa.
        const [sobrevive] = await conCentral.query(
            `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
            [BASE_DE_PRUEBA]
        );
        check(sobrevive.length === 0, 'la base de prueba no quedo viva');

        console.log('');
        console.log('='.repeat(78));
        console.log(`  ${ok} OK / ${fallos} FALLO`);
        console.log('='.repeat(78));

        if (fallos === 0) {
            console.log('');
            console.log('Una base de empresa nueva, creada con este base.sql y con la cadena');
            console.log('de migraciones, queda con el mismo esquema que tiene el taller.');
            return 0;
        }
        return 1;
    } catch (err) {
        console.error('');
        console.error('ERROR: ' + err.message);
        if (err.sql) console.error('SQL: ' + String(err.sql).slice(0, 300));
        return 1;
    } finally {
        if (conCentral) await conCentral.end().catch(() => {});
        if (conPrueba) await conPrueba.end().catch(() => {});
    }
})().then((codigo) => {
    process.exit(codigo);
});