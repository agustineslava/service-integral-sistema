/* ==========================================================================
   MUTACIONES: ver-reportes.js
   --------------------------------------------------------------------------
   Un verificador que dice "todo bien" sin que se le pueda romper el código no
   sirve: pasa siempre, no sirve para nada. Este archivo rompe el código a
   propósito, una cosa por vez, corre el verificador, y exige que el fallo que
   aparece sea el del control que se rompió. Después deja todo como estaba.

   Cada mutación devuelve el fallo que le corresponde, y el texto del fallo tiene
   que contener el nombre del control roto. Si una mutación no rompe nada, o
   rompe algo que no era, el archivo lo dice y sale con código de error.

   LO QUE ESTA TARDE EN DETECTAR Y POR QUÉ
   --------------------------------------------------------------------------
   Dos mutaciones sonLive: necesitan que el verificador ejecute el servicio
   contra la base. La primera tanda de mutaciones dejó en claro que hay controles
   que no se pueden probar leyendo archivos, y son los que importan: un teléfono
   que pierde los ceros del principio, o un rango de fechas que acepta un array,
   se ven bien en el código y en la pantalla.

   Por eso llevan la marca `vivo: true`, y el verificador se corre con `--vivo`
   para ellas. Las demás corren contra el verificador estático, que es el que se
   puede correr en cualquier máquina sin credenciales.

   CUÁNTAS SALEN A LA VEZ
   --------------------------------------------------------------------------
   Varias mutaciones disparan más de un control a la vez. No es un defecto: se
   pide que aparezca EL control que se rompió, no que aparezca solo ese. Por eso
   el que se busca es un FALLO, y no que el total de fallas sea exactamente uno.

   Uso:  node tools/mutar-reportes.js
         node tools/mutar-reportes.js --vivo      (fuerza la parte viva de todas)
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const FRONT = path.join(RAIZ, '..', 'frontend');
const VERIFICADOR = path.join(RAIZ, 'tools', 'ver-reportes.js');

const VIVO = process.argv.includes('--vivo');

/* --------------------------------------------------------------------------
   Guardar, escribir, reemplazar. Rutas relativas al backend, o al frontend si se
   pasan con `front:`.
   -------------------------------------------------------------------------- */

const originales = new Map();

/** Resuelve una ruta de mutación y se queda con el original la primera vez. */
function abrir(rel) {
    const esFront = rel.startsWith('front:');
    const limpio = esFront ? rel.slice(6) : rel;
    const absoluta = path.join(esFront ? FRONT : RAIZ, limpio);
    const clave = `${esFront ? 'front:' : 'back:'}${limpio}`;
    if (!originales.has(clave)) {
        originales.set(clave, fs.readFileSync(absoluta, 'utf8'));
    }
    return { absoluta, clave, original: originales.get(clave) };
}

function escribir(rel, txt) {
    const { absoluta, clave, original } = abrir(rel);
    fs.writeFileSync(absoluta, txt);
    return original;
}

/*
 * FINALES DE LÍNEA
 *
 * En este proyecto conviven CRLF y LF. Un ancla de más de una línea escrita con
 * `\n` no encuentra nada en un archivo CRLF, y la mutación queda como "no se
 * aplica", que parece otra cosa. Por eso se busca siempre sobre el texto
 * normalizado a LF, y al escribir se devuelve el archivo con el mismo tipo de
 * fin de línea que tenía. Como al final se restaura todo desde una copia del
 * original, el archivo vuelve byte a byte como estaba.
 */
const aLf = (txt) => txt.replace(/\r\n/g, '\n');
const finDeLineaDe = (txt) => (txt.includes('\r\n') ? '\r\n' : '\n');

/**
 * Cambia la primera aparición de `viejo` por `nuevo`.
 * Si `viejo` no aparece, tira: una mutación que no se aplica no prueba nada.
 */
function reemplazar(rel, viejo, nuevo) {
    const { absoluta, original } = abrir(rel);
    const eol = finDeLineaDe(original);
    const norm = aLf(original);
    const v = aLf(viejo);
    if (!norm.includes(v)) {
        throw new Error(`la mutación no se puede aplicar: "${rel}" no contiene\n    ${viejo}`);
    }
    escribir(rel, norm.replace(v, aLf(nuevo)).replace(/\n/g, eol));
}

/** Deja todo como estaba. */
function restaurarTodo() {
    for (const [clave, txt] of originales) {
        const esFront = clave.startsWith('front:');
        fs.writeFileSync(path.join(esFront ? FRONT : RAIZ, clave.slice(esFront ? 6 : 5)), txt);
    }
}

/** Corre el verificador y devuelve su salida y su código de salida. */
function correrVerificador(vivo) {
    const args = vivo ? ['--vivo'] : [];
    try {
        const salida = execFileSync(process.execPath, [VERIFICADOR, ...args], { encoding: 'utf8' });
        return { codigo: 0, salida };
    } catch (e) {
        return { codigo: e.status === undefined ? -1 : e.status, salida: (e.stdout || '') + (e.stderr || '') };
    }
}

/* --------------------------------------------------------------------------
   Las mutaciones

   `espera` es un pedazo del texto del FALLO que tiene que aparecer. Si el
   verificador falla por otra cosa, la mutación no está probando lo que dice
   estar probando.
   -------------------------------------------------------------------------- */

const MUTACIONES = [

    /* ======================================================================
       SECCIÓN 1 · AISLAMIENTO ENTRE EMPRESAS

       Esta es la sección que más cuesta romper y la que más caro sale. Todas
       las mutaciones de acá son plausibles: son cosas que alguien escribiría un
       viernes con sueño para no estar pasando el pool por parámetro.
       ====================================================================== */
    {
        nombre: 'el servicio vuelve a hacer require de mysql2',
        porQue: 'es la puerta de entrada clásica. Con una empresa anda perfecto; con dos, el reporte de la empresa 2 se arma contra la base que este requirearnya',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "const ESTADO_REPARACION_CANCELADA = 'Cancelado';",
                "require('mysql2/promise');\n\nconst ESTADO_REPARACION_CANCELADA = 'Cancelado';");
        },
        espera: 'el servicio NO hace require de mysql2'
    },
    {
        nombre: 'el servicio importa el módulo de conexiones',
        porQue: 'no es tan obvio como el require de mysql2, y por eso es peor: parece correcto. El archivo sabe abrir una conexión, y la abre contra una base elegida por él, no por la sesión',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "const ESTADO_REPARACION_CANCELADA = 'Cancelado';",
                "require('../db/conexiones');\n\nconst ESTADO_REPARACION_CANCELADA = 'Cancelado';");
        },
        espera: 'el servicio NO importa ningún módulo de base'
    },
    {
        nombre: 'el servicio menciona el proxy de empresa (tenant)',
        porQue: 'la más silenciosa de todas. `tenant.db` resuelve la base según el request, así que DENTRO de una ruta funciona y adentro de un servicio no: o explota, o —peor— resuelve contra lo último que se dejó puesto y lee la base de otra empresa. El control la prohíbe por nombre, no solo el require',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "const ESTADO_REPARACION_CANCELADA = 'Cancelado';",
                "const baseDeLaSesion = () => require('../db/tenant').db;\n\nconst ESTADO_REPARACION_CANCELADA = 'Cancelado';");
        },
        espera: 'el servicio NO menciona `tenant`'
    },
    {
        nombre: 'vuelve el nombre de la base escrito a mano',
        porQue: 'es exactamente la fuga que ya se Cometió una vez en el módulo de etiquetas. El nombre está porque alguien lo copió de un `console.log` y no porque sirva',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "const ESTADO_REPARACION_CANCELADA = 'Cancelado';",
                "const BASE = 'serviceintegralsistema';\n\nconst ESTADO_REPARACION_CANCELADA = 'Cancelado';");
        },
        espera: 'el servicio NO menciona el nombre de ninguna base'
    },
    {
        nombre: 'la ruta deja de pasarle el db de la sesión',
        porQue: 'la otra mitad del aislamiento: aunque el servicio no pueda abrir una base, si la ruta no le pasa el `db` del request entonces no hay garantía de nada. Con esto el control tiene que disparar aunque el servicio siga impecable',
        hacer() {
            reemplazar('server.js',
                'const resultado = await reportes.correr(db, codigo, rango);',
                'const resultado = await reportes.correr(db, codigo, rango); /* usa db */');
            reemplazar('server.js',
                'const resultado = await reportes.correr(db, codigo, rango); /* usa db */',
                'const resultado = await reportes.correr({ query: db.query }, codigo, rango);');
        },
        espera: 'la ruta le pasa a correr() el db del request'
    },
    {
        nombre: 'correr() deja de recibir el pool como parámetro',
        porQue: 'el service locator. `correr()` saca el `db` de una variable del módulo y el archivo vuelve a saber de bases. El control mira la firma, que es donde se ve',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'async function correr(db, codigo, rango) {',
                'async function correr(codigo, rango) {\n    const db = globalThis.__dbDelServidor;');
        },
        espera: 'correr() recibe el pool como parámetro'
    },

    /* ======================================================================
       SECCIÓN 2 · EL RANGO DE FECHAS

       Lo que se rompe acá no da error: da números. Un techo `<=` con una columna
       DATE deja fuera el resto del día, y el mismo filtro da dos resultados
       distintos según la tabla de la que se está leyendo.
       ====================================================================== */
    {
        nombre: 'el techo del rango pasa a ser `<= hasta`',
        porQue: 'parece el cambio más inocente del mundo y es el que rompe el filtro: con una columna DATE incluye el día entero, con una DATETIME incluye solo la medianoche. El mismo período da dos resultados distintos según el reporte, y nadie sabe cuál de los dos es el que se pidió',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                '`${columna} < ?`',
                '`${columna} <= ?`');
        },
        espera: 'el techo NO es `<=`'
    },
    {
        nombre: 'el techo deja de sumar un día',
        porQue: 'el error equivalente por el otro lado: `< hasta` sin `diaSiguiente` excluye el día que el operador pidió, y la última fila del período desaparece sin aviso',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'params.push(diaSiguiente(hasta));',
                'params.push(hasta);');
        },
        espera: 'el techo usa diaSiguiente(hasta)'
    },
    {
        nombre: 'el piso del rango se pega al texto del SQL',
        porQue: 'aquí SÍ hay inyección: `?desde=2026-01-01\' OR \'1\'=\'1` devolvería la base entera con un 200. Se rompe con una mutación chica y es el peor resultado posible',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'sql += ` AND ${columna} >= ?`;',
                'sql += ` AND ${columna} >= \'${desde}\'`;');
        },
        espera: 'el piso del rango es un marcador `?`, no el valor'
    },
    {
        nombre: 'vuelve el String() antes de validar la fecha',
        porQue: 'ES UN FALLO REAL DE ESTA SESIÓN. Con `String(query.desde)` el chequeo de tipo de `fechaReal` queda muerto, y `String([\'2026-10-01\'])` vale `\'2026-10-01\'`: un `?desde[]=` pasa como si fuera una fecha. No hay inyección —el rango va como parámetro— pero el endpoint acepta tipos que no dice aceptar',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'const bruto = (valor) => (typeof valor === \'string\' ? valor.trim() : null);',
                'const bruto = (valor) => (valor === undefined || valor === null ? null : String(valor).trim());');
        },
        espera: 'leerRango NO hace String() del valor antes de validar',
        vivo: true
    },
    {
        nombre: 'fechaReal() deja de chequear que el día exista',
        porQue: 'el caso `2026-02-31`. Con una regex sola la fecha pasa, y MySQL la convierte a `2026-03-03`: el operador pidió una fecha que no existe y recibe un reporte de marzo. El control tiene que ver que la comparación contra el calendario sigue',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;',
                'return true;');
        },
        espera: 'fechaReal() compara el año que volvió contra el que se pidió',
        vivo: true
    },
    {
        nombre: 'un reporte deja de declarar por qué columna se filtra',
        porQue: 'sin la declaración, `filtroFechas` recibe `undefined` y arma `undefined >= ?`, que MySQL no compila: el reporte da 500. Y si en vez de tirar devuelve la consulta sin filtro, el operador cree que filtró y está viendo toda la historia. Por eso el control exige que `columnaDeFecha` TIRE, no que avise',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "    'presupuestos-y-conversion': 'p.creado_en'",
                '');
        },
        espera: 'declara por qué columna se filtra'
    },
    {
        nombre: 'columnaDeFecha() deja de tirar cuando falta la declaración',
        porQue: 'el silencio es el resultado peligroso. Si en vez de tirar devuelve una columna cualquiera, el reporte corre y muestra datos de un período que nadie pidió. Nadie se entera hasta que un mes el número no cierra',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                '    throw new Error(',
                '    return null; // eslint-disable-line\n    throw new Error(');
        },
        espera: 'tira si un reporte no declaró su columna'
    },
    {
        nombre: 'el rango deja de rechazarse cuando va al revés',
        porQue: '`desde` después de `hasta` es un filtro que no tiene sentido, y la consulta devuelve cero filas: el operador ve una tabla vacía y cree que no pasó nada en ese mes, cuando lo que pasó es que se pasó las fechas',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'if (desde !== null && hasta !== null && desde > hasta) {',
                'if (false) {');
        },
        espera: 'leerRango rechaza que el rango vaya al revés',
        vivo: true
    },

    /* ======================================================================
       SECCIÓN 3 · LAS RUTAS
       ====================================================================== */
    {
        nombre: '/api/reportes/:codigo se queda sin verificarToken',
        porQue: 'sin sesión, cualquiera que conozca la URL ve la facturación de la empresa. Y como no hay token, tampoco hay registro: la consulta ni siquiera llega a un log de acceso con usuario',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/reportes/:codigo', verificarToken,",
                "app.get('/api/reportes/:codigo',");
        },
        espera: 'exige sesión iniciada'
    },
    {
        nombre: '/api/reportes/:codigo se queda sin el módulo contratado',
        porQue: 'una empresa que no contrató reportes pagaría por el desarrollo y no lo vería. Peor al revés: si el módulo no se cobra, la pantalla existe para todos y la lista de features que se vendió deja de valer',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/reportes/:codigo', verificarToken, requiereModulo('reportes'),",
                "app.get('/api/reportes/:codigo', verificarToken,");
        },
        espera: 'exige el módulo'
    },
    {
        nombre: 'el catálogo se queda sin verificarToken',
        porQue: 'el hermano del anterior por el otro endpoint. Es menos grave —solo dice qué reportes hay, no cuánto facturó— pero el control mira las dos rutas, y tiene que mirar las dos',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/reportes', verificarToken,",
                "app.get('/api/reportes',");
        },
        espera: 'exige sesión iniciada'
    },
    {
        nombre: 'un código inventado deja de dar 404',
        porQue: 'con el código pegado al SQL, `?codigo=x\' OR \'1\'=\'1` sería una consulta válida. La lista blanca no es una formalidad: es lo que hace que un string sea identificable y no consulta',
        hacer() {
            reemplazar('server.js',
                'if (!reportes.existe(codigo)) {',
                'if (false) {');
        },
        espera: 'consulta la lista blanca de códigos antes de tocar la base'
    },
    {
        nombre: 'un rango inválido deja de dar 400',
        porQue: 'sin el 400, un `2026-02-31` se convierte en un 200 con datos de marzo y el operador no se entera. Peor: un rango al revés devuelve una tabla vacía, que se lee como "no hubo ventas"',
        hacer() {
            reemplazar('server.js',
                'if (!rango.ok) {',
                'if (false) {');
        },
        espera: 'un rango de fechas inválido responde 400'
    },
    {
        nombre: '`?formato=xlsx` deja de dar 400 y devuelve el JSON',
        porQue: 'el que más tiempo le roba a un operador: pide una planilla, el navegador descarga un archivo llamado `.xlsx` que es un JSON, y pasa media tarde de trabajo abriendo un archivo que no se puede abrir. Con el 400 y la lista de formatos válidos, el mensaje dice qué hacer',
        hacer() {
            reemplazar('server.js',
                "if (formato !== 'json' && formato !== 'csv') {",
                "if (false) {");
        },
        espera: 'un formato que no es json ni csv responde 400'
    },
    {
        nombre: 'el error de MySQL empieza a viajar al cliente',
        porQue: 'un `Unknown column \'participacion\' in \'field list\'` le DESCRIBE la base por dentro a cualquiera que llame la API. Y el mensaje de MySQL trae el SQL entero, con los nombres de tabla y de columna',
        hacer() {
            reemplazar('server.js',
                "res.status(500).json({ error: 'Error al generar el reporte' });",
                "res.status(500).json({ error: 'Error al generar el reporte', detalle: String(err.message || err) });");
        },
        espera: 'el error interno NO viaja al cliente'
    },

    /* ======================================================================
       SECCIÓN 4 · EL CSV

       Nada de esto se ve en la pantalla. El archivo abre en la máquina del
       operador, en Excel, y todo lo que se rompe acá se descubre semanas
       después, cuando alguien intenta sumar una columna.
       ====================================================================== */
    {
        nombre: 'el CSV deja de llevar el BOM',
        porQue: 'Excel en Windows abre un CSV sin BOM como ANSI, y "San José" aparece como "San JosÃ©". Es el fallo más caro por byte: son tres bytes y arruinan todos los acentos del archivo',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'Buffer.from([0xef, 0xbb, 0xbf]),\n        ',
                '');
        },
        espera: 'el CSV arranca con el BOM UTF-8'
    },
    {
        nombre: 'el encabezado del CSV se escribe a mano',
        porQue: 'ES LA FUGA DE LAS DOS LISTAS. El nombre de cada columna queda escrito dos veces, una acá y otra en el reporte. El día que alguien corrige un título —"ódenes" por "órdenes", que es el cambio más chico del mundo— el archivo y la pantalla se contradicen y no hay forma de saber cuál está bien',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "const lineas = [resultado.columnas.map((c) => campoCsv(c.titulo)).join(',')];",
                "const lineas = ['Mes,Facturas,Neto,IVA,Total'];");
        },
        espera: 'NO tiene una lista de encabezados escrita a mano'
    },
    {
        nombre: 'el antivirus de fórmulas se aplica también a los números',
        porQue: 'es lo contrario de lo que se busca. Un número negativo es `-1234.56`, empieza con `-`, y con el apóstrofo adelante deja de ser número: en Excel la columna pasa a ser texto y `SUM` da cero. Un saldo negativo es exactamente el número que más se necesita poder sumar',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "const conPrefijo = (typeof valor !== 'number' && ARRANQUE_DE_FORMULA.test(texto)) ? `'${texto}` : texto;",
                "const conPrefijo = ARRANQUE_DE_FORMULA.test(texto) ? `'${texto}` : texto;");
        },
        espera: 'SOLO a los textos, no a los números',
        vivo: true
    },
    {
        nombre: 'el punto y coma deja de obligar a entrecomillar',
        porQue: 'con la configuración regional de algunos países Excel separa columnas con `;`. Un `;` sin entrecomillar abre columnas de más y desarma la tabla entera a partir de esa fila',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'if (/["\\r\\n,;]/.test(conPrefijo)) {',
                'if (/["\\r\\n,]/.test(conPrefijo)) {');
        },
        espera: 'entrecomilla si el dato tiene el punto y coma',
        vivo: true
    },
    {
        nombre: 'campoCsv() deja de duplicar las comillas dobles',
        porQue: 'RFC 4180. Un nombre de repuesto con comilla adentro —`Bob"s, repuesto`— rompe el archivo a partir de esa fila, y no en el producto de Excel: en cualquier otro lector. El entrecomillado existe justamente para poder poner comillas',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                'conPrefijo.replace(/"/g, \'""\')',
                'conPrefijo');
        },
        espera: 'duplica las comillas dobles del dato',
        vivo: true
    },
    {
        nombre: 'el nombre del archivo deja de saneado',
        porQue: 'un código con barra o punto y medio en el `Content-Disposition` no solo rompe el nombre: con un salto de línea inyecta una cabecera HTTP entera. El saneo es lo que impide que el dato controle la respuesta',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "return partes.join('_').replace(/[^A-Za-z0-9._-]/g, '_') + '.csv';",
                "return partes.join('_') + '.csv';");
        },
        espera: 'solo letras, números, punto, guion y guion bajo',
        vivo: true
    },
    {
        nombre: 'el CSV deja de ser un adjunto y pasa ainline',
        porQue: 'sin `Content-Disposition: attachment`, el navegador abre el archivo en una pestaña como texto. El operador ve el CSV crudo en pantalla en vez de tener el archivo en la carpeta de descargas',
        hacer() {
            reemplazar('server.js',
                "res.setHeader('Content-Disposition', `attachment; filename=\"${nombreArchivo}\"`);",
                "res.setHeader('Content-Disposition', `attachement; filename=\"${nombreArchivo}\"`);");
        },
        espera: 'la ruta manda el CSV como adjunto'
    },
    {
        nombre: 'el CSV empieza a cachearse',
        porQue: 'el contenido de un reporte es un dato del momento. Con caché, el mismo URL del mes pasado devuelve el archivo viejo, y el dueño compara dos números de períodos distintos creyendo que son el mismo',
        hacer() {
            reemplazar('server.js',
                "res.setHeader('Cache-Control', 'no-store');",
                "res.setHeader('Cache-Control', 'max-age=3600');");
        },
        espera: 'el CSV no se cachea'
    },
    {
        nombre: 'el CSV deja de llevar nosniff',
        porQue: 'sin `nosniff`, el navegador puede decidir que `text/csv` es algo que sabe ejecutar. Con el archivo controlado por un nombre de repuesto, es contenido que el navegador interpreta y el operador no',
        hacer() {
            reemplazar('server.js',
                "res.setHeader('X-Content-Type-Options', 'nosniff');",
                '');
        },
        espera: 'el CSV va con nosniff'
    },

    /* ======================================================================
       SECCIÓN 5 · LOS TIPOS DE COLUMNA

       El desfase entre las dos listas de tipos es el fallo más difícil de ver de
       todo el módulo: el `default` del formateador muestra el valor crudo, así
       que un tipo nuevo se VE bien y sale con el formato equivocado.
       ====================================================================== */
    {
        nombre: 'el frontend pierde el formateador de un tipo',
        porQue: 'el día que el backend declara un tipo nuevo y el frontend no tiene su `case`, la columna sale con el valor crudo escapado. No da error: se ve un número donde debería decir "$ 12.100". El control compara las dos listas como conjuntos',
        hacer() {
            reemplazar('front:reportes.js',
                "        case 'porcentaje':\n            return numeroR(valor, 1) + ' %';",
                "        case 'porcentaje':\n            break;");
        },
        espera: 'todo tipo que declara el backend tiene formateador en el frontend'
    },
    {
        nombre: 'la lista de tipos alineados se desincroniza',
        porQue: 'el backend declara cuáles se alinean a la derecha y el CSS los alinea por el mismo nombre. Si difieren, la columna de plata queda a la izquierda con números adentro, y en una tabla con dos columnas de importes no se sabe cuál es cuál',
        hacer() {
            reemplazar('front:reportes.js',
                "const TIPOS_NUMERO = new Set(['entero', 'decimal', 'pesos', 'porcentaje', 'dias']);",
                "const TIPOS_NUMERO = new Set(['entero', 'decimal', 'porcentaje', 'dias']);");
        },
        espera: 'la lista de tipos alineados a la derecha es la misma'
    },
    {
        nombre: 'un reporte declara dos columnas con la misma clave',
        porQue: 'las filas son objetos y se leen con `fila[c.clave]`, así que la segunda columna pisa a la primera: la tabla muestra el mismo dato dos veces. No da error, la cantidad de celdas da bien, y la plata queda debajo del nombre del cliente',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "            col('total', 'Total', 'pesos'),\n            col('iva', 'IVA', 'pesos'),",
                "            col('total', 'Total', 'pesos'),\n            col('iva', 'Total', 'pesos'),");
        },
        espera: 'no declara dos columnas con la misma clave'
    },
    {
        nombre: 'un reporte declara una columna que no produce',
        porQue: 'ES UN FALLO REAL DE ESTA SESIÓN. El reporte de presupuestos declaraba una columna "Participación" y el SQL no la traía: la pantalla mostraba un guion en una columna que el dueño leía todas las semanas. El control compara las claves declaradas contra el resto del bloque, con el arreglo `columnas` tapado',
        hacer() {
            reemplazar('src/servicios/reportes.js',
                "                participacion: total ? a2((Number(f.presupuestos || 0) / total) * 100) : 0",
                "                otroNombre: 0");
        },
        espera: 'produce todas las columnas que declara'
    },

    /* ======================================================================
       SECCIÓN 6 · LA PANTALLA
       ====================================================================== */
    {
        nombre: 'los <td> dejan de llevar data-col',
        porQue: 'es lo que permite comparar celda con celda y ver que una fila no se corrió una columna. Sin él, una fila con una celda de más pasa el conteo de columnas y la pantalla muestra la plata debajo del nombre del cliente sin que nada se avise',
        hacer() {
            reemplazar('front:reportes.js',
                'return `<td data-col="${escapeHtml(columna.clave)}" class=',
                'return `<td class=');
        },
        espera: 'los <td> se generan con data-col'
    },
    {
        nombre: 'el CSV se pasa a pedir con fetch pelado',
        porQue: 'el endpoint pide token y un `fetch` sin cabecera no lo manda: la descarga llega como 401 y el operador se queda con un archivo de texto que dice "No autorizado". Y además se pierde el manejo de sesión caducada que hace `apiFetch`',
        hacer() {
            reemplazar('front:reportes.js',
                "const resp = await apiFetch(urlReporte(reporteActual, 'csv'));",
                "const resp = await fetch(urlReporte(reporteActual, 'csv'));");
        },
        espera: 'el CSV se pide con apiFetch, que manda el token'
    },
    {
        nombre: 'el formateador deja de escapar el texto',
        porQue: 'los nombres de repuestos y de clientes los escribe alguien, y un `<script>` en un nombre de repuesto no puede terminar siendo código. Es el único control de XSS de la página: los `<th>` y los `<td>` se arman con `innerHTML`',
        hacer() {
            reemplazar('front:reportes.js',
                "    if (tipo === 'texto') {\n        return escapeHtml(valor === null || valor === undefined ? '' : valor);\n    }",
                "    if (tipo === 'texto') {\n        return valor === null || valor === undefined ? '' : valor;\n    }");
        },
        espera: 'el formateador escapa los valores de texto'
    },
    {
        nombre: 'fechaR() pasa a usar new Date',
        porQue: '`new Date` usa la zona horaria de la MÁQUINA, no la del dato. Un servidor en UTC y un operador en Argentina ven el mismo instante como dos días distintos, y el de la derecha del todo aparece como el de ayer',
        hacer() {
            reemplazar('front:reportes.js',
                'const m = String(iso).match(/^(\\d{4})-(\\d{2})-(\\d{2})/);',
                'const m = new Date(iso).toISOString().match(/^(\\d{4})-(\\d{2})-(\\d{2})/);');
        },
        espera: 'fechaR() arma la fecha desde la cadena'
    },
    {
        nombre: 'se borra el token de la petición en curso',
        porQue: 'al cambiar de fechas rápido se salen dos pedidos y las dos respuestas vuelven, pero no necesariamente en orden. Sin el token, la que llega última se pinta aunque sea la que se pidió antes, y la pantalla muestra un período que ya no es el de los filtros',
        hacer() {
            reemplazar('front:reportes.js',
                'const token = ++peticionActual;',
                'const token = 0;');
        },
        espera: 'tiene un token de petición'
    },
    {
        nombre: 'la lista de reportes se escribe en el HTML',
        porQue: 'la lista de seis que aparece en el `<select>` escrito a mano es una lista que se desactualiza sin que nadie se entere: se agrega un reporte al backend y el menú no lo muestra. El control compara contra el catálogo del servidor',
        hacer() {
            reemplazar('front:reportes.html',
                '<option value="">Cargando...</option>',
                '<option value="">Cargando...</option>\n                    <option value="ventas-por-mes">Ventas por mes</option>');
        },
        espera: 'NO tiene la lista de reportes escrita en el HTML'
    },
    {
        nombre: 'una página se queda sin la entrada de Reportes',
        porQue: 'es el olvido más común de todos: se agrega la pantalla nueva, funciona, y el menú de UNA de las ocho páginas no la enlaza. El usuario la pide y le dicen que no existe',
        hacer() {
            reemplazar('front:presupuestos.html',
                '                    <li data-modulo="reportes"><a href="reportes.html">Reportes</a></li>\n',
                '');
        },
        espera: 'tiene la entrada de Reportes en el menú'
    },
    {
        nombre: 'reportes.js se sube de versión en la página',
        porQue: 'el caché del navegador. Con `?v=2.5` en todas las páginas, subirlo en una sola deja esa versión cacheada para siempre en el navegador del operador, y el arreglo no le llega nunca. El control compara las ocho',
        hacer() {
            reemplazar('front:reportes.html',
                '<script src="reportes.js?v=2.5"></script>',
                '<script src="reportes.js?v=2.6"></script>');
        },
        espera: 'carga reportes.js con la versión 2.5'
    },
    {
        nombre: 'reportes.css escribe un color fijo',
        porQue: 'un `#fff` en esta hoja se ve bien en el tema oscuro y es INVISIBLE en el claro, o al revés. Lo que hay que usar son las variables de `style.css`, que ya resuelven los dos temas para las otras ocho pantallas',
        hacer() {
            reemplazar('front:reportes.css',
                '    color: var(--text-main);\n    word-break: break-word;',
                '    color: #1a1d20;\n    word-break: break-word;');
        },
        espera: 'no escribe ningún color fijo'
    },
    {
        nombre: 'reportes.css agrega un @media',
        porQue: 'no es un error por sí mismo: es que el archivo entero se apoya en `flex-wrap` para acomodarse, y un `@media` a mitad de camino mete una regla que depende de un ancho de pantalla que el resto de la hoja no considera. El control exige que la hoja sea de una sola pieza',
        hacer() {
            reemplazar('front:reportes.css',
                '.rp-pie {',
                '@media (max-width: 600px) {\n    .rp-filtros { flex-direction: column; }\n}\n\n.rp-pie {');
        },
        espera: 'no trae @media'
    },
    {
        nombre: 'reportes.js lee el token por su cuenta',
        porQue: 'el token lo lee `apiFetch`, y `apiFetch` es lo que manda a login cuando la sesión caducó. Si el archivo lo lee por su cuenta, un 401 cae en un `catch` cualquiera y la pantalla se queda mostrando la tabla vieja con el botón de exportar apagado, sin explicación',
        hacer() {
            reemplazar('front:reportes.js',
                "const $ = (id) => document.getElementById(id);",
                "const $ = (id) => document.getElementById(id);\nconst token = localStorage.getItem('jwt_token');");
        },
        espera: 'NO lee el token por su cuenta'
    },

    /* ======================================================================
       SECCIÓN 7 · LA MIGRACIÓN
       ====================================================================== */
    {
        nombre: 'el ALTER sale de la cadena y se ejecuta siempre',
        porQue: 'ES LA MIGRACIÓN QUE NO ES REAPLICABLE. MySQL no tiene `ADD INDEX IF NOT EXISTS`, así que la guarda va con SQL dinámico; si el ALTER queda suelto, correr la migración dos veces —que es lo que pasa cuando algo falla a mitad— deja el índice duplicado y el taller nuevo queda con un esquema distinto al del viejo',
        hacer() {
            reemplazar('migrations/tenant/007_indices_reportes.sql',
                "SET @idx_rep_fecha_sql := IF(@idx_rep_fecha_ya_existe > 0,\n    'DO 0',\n    'ALTER TABLE `reparaciones`\n        ADD INDEX `idx_repar_fecha_ingreso` (`fecha_ingreso`)'\n);",
                "ALTER TABLE `reparaciones`\n    ADD INDEX `idx_repar_fecha_ingreso` (`fecha_ingreso`);");
        },
        espera: 'ningún ALTER se ejecuta directo'
    },
    {
        nombre: 'la guarda compara contra las columnas en vez del nombre',
        porQue: 'el nombre del índice es lo único que el motor garantiza único dentro de la tabla. Si la guarda busca la lista de columnas y mañana alguien indexa `fecha_ingreso` con otro nombre, el `IF` lo agrega de nuevo y aparece un segundo índice que hace el mismo trabajo',
        hacer() {
            reemplazar('migrations/tenant/007_indices_reportes.sql',
                "AND INDEX_NAME   = 'idx_repar_fecha_ingreso'",
                "AND COLUMN_NAME  = 'fecha_ingreso'");
        },
        espera: 'compara contra INDEX_NAME'
    },
    {
        nombre: 'falta un DEALLOCATE PREPARE',
        porQue: 'una sentencia preparada que no se libera queda occupying en la sesión. Con el mismo nombre dos veces —que es lo que pasa al copiar el bloque para el segundo índice— la segunda falla con "Unknown prepared statement" y la migración se corta a mitad, con un índice hecho y otro no',
        hacer() {
            reemplazar('migrations/tenant/007_indices_reportes.sql',
                'DEALLOCATE PREPARE agregar_idx_rep_estado;',
                '');
        },
        espera: 'cada bloque dinámico de la 007 hace PREPARE, EXECUTE y DEALLOCATE'
    },
    {
        nombre: 'la migración deja de usar DATABASE()',
        porQue: 'la migración se corre contra la base del tenant que se está dando de alta, y ese nombre cambia de empresa en empresa. Con el nombre escrito, la segunda empresa que se da de alta indexa la base de la primera',
        hacer() {
            reemplazar('migrations/tenant/007_indices_reportes.sql',
                'WHERE TABLE_SCHEMA = DATABASE()',
                "WHERE TABLE_SCHEMA = 'serviceintegralsistema'");
        },
        espera: 'se resuelve con DATABASE()'
    },
    {
        nombre: 'XXX_removed_2 con un índice de reportes',
        porQue: 'regla 6 de LEEME.txt: `base.sql` es la congelación del esquema de antes de la 001. Si una migración lo modifica, un alta nueva nace con un esquema que ningún taller tiene, y la diferencia aparece recién en producción',
        hacer() {
            reemplazar('schema/base.sql',
                'CREATE TABLE `etiquetas_qr`',
                'CREATE TABLE `etiquetas_qr`\n-- nota: le faltan los índices de reportes');
            reemplazar('schema/base.sql',
                '  KEY `idx_repar_estado` (`estado`)',
                '  KEY `idx_repar_estado` (`estado`),\n  KEY `idx_repar_fecha_ingreso` (`fecha_ingreso`)');
        },
        espera: 'NO se tocó'
    },

    /* ======================================================================
       SECCIÓN 8 · EL CATÁLOGO DE MÓDULOS
       ====================================================================== */
    {
        nombre: 'XXX_removed_1',
        porQue: '`reportes` es una fila de `si_central.modulos`, y de ahí sale lo que cada empresa contrata. Sin la fila, `empresa_modulos` no lo puede guardar, `requiereModulo(\'reportes\')` le cierra la pantalla a todo el mundo, y no hay error: la página carga vacía',
        hacer() {
            reemplazar('migrations/central/002_catalogos.sql',
                "    ('reportes',     'Reportes',           'Reportes de ventas, stock y productividad',        0, 70),",
                '');
        },
                '(\\'reportes\\',     \\'Reportes\\',           \\'Reportes de ventas, stock y productividad\\',        0, 70),'
    }
];

/* --------------------------------------------------------------------------
   Correr
   -------------------------------------------------------------------------- */

console.log('\n' + '='.repeat(74));
console.log('  MUTACIONES: ver-reportes.js');
console.log(`  ${MUTACIONES.length} mutaciones, una por control roto a la vez`);
console.log('='.repeat(74));

let malas = 0;

for (const m of MUTACIONES) {
    const usaVivo = VIVO || m.vivo;
    console.log(`\n  ${m.nombre}`);
    console.log(`        por qué: ${m.porQue}`);
    if (usaVivo) console.log('        (se corre el verificador con --vivo)');

    restaurarTodo();

    let error = null;
    try {
        m.hacer();
    } catch (e) {
        error = e.message;
    }

    if (error) {
        console.log('        MAL  la mutación no se pudo aplicar');
        console.log(`             ${error.split('\n').join('\n             ')}`);
        malas++;
        continue;
    }

    const r = correrVerificador(usaVivo);

    if (r.codigo === 0) {
        console.log('        MAL  el verificador PASÓ con el código roto (no tiene dientes)');
        malas++;
    } else {
        /* Tiene que fallar POR LO QUE SE ROMPIÓ, no por cualquier cosa. */
        const lineaDelFallo = r.salida
            .split('\n')
            .find((l) => l.includes(m.espera) && l.trim().startsWith('FALLO'));

        if (lineaDelFallo) {
            console.log(`        BIEN detectado: ${lineaDelFallo.trim()}`);
        } else {
            console.log(`        MAL  falló, pero no por el control roto. Se esperaba un FALLO con "${m.espera}"`);
            const fallas = r.salida.split('\n').filter((l) => l.trim().startsWith('FALLO'));
            fallas.forEach((f) => console.log(`             ${f.trim()}`));
            malas++;
        }
    }
}

restaurarTodo();

console.log('\n' + '='.repeat(74));
const detectadas = MUTACIONES.length - malas;
console.log(`  ${detectadas}/${MUTACIONES.length} mutaciones detectadas`);
console.log('='.repeat(74));

/* Verificación final: después de restaurar, tiene que volver a pasar. */
const final = correrVerificador(false);
if (final.codigo !== 0) {
    console.log('\nAL RESTAURAR QUEDÓ ALGO ROTO:\n');
    console.log(final.salida);
    process.exit(1);
}

console.log('\nCódigo restaurado y verificador en verde.\n');

if (malas > 0) {
    console.log(`\n${malas} mutaciones NO fueron detectadas.\n`);
    process.exit(1);
}

console.log('Todas las mutaciones fueron detectadas.\n');
