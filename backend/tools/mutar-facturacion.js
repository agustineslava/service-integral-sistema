/* ==========================================================================
   MUTACIONES: ver-facturacion.js
   --------------------------------------------------------------------------
   Un verificador que dice "todo bien" sin que se le pueda romper el codigo no
   sirve: pasa siempre, no sirve para nada. Este archivo rompe el codigo a
   proposito, una cosa por vez, corre el verificador, y exige que el fallo que
   aparece sea el del control que se rompio. Despues deja todo como estaba.

   Cada mutacion produce un FALLO cuyo texto contiene el nombre del control
   roto. Si una mutacion no rompe nada, o rompe algo que no era, el archivo lo
   dice y sale con codigo de error.

   No se exige que aparezca SOLO ese control. Varias de estas mutaciones
   disparan mas de uno a la vez (quitarle el modulo a una ruta salta el que
   busca el modulo Y el que compara el numero de rutas, por ejemplo). Se pide
   que aparezca EL control que se rompio, no que aparezca solo ese.

   Uso:  node tools/mutar-facturacion.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const VERIFICADOR = path.join(RAIZ, 'tools', 'ver-facturacion.js');

/* --------------------------------------------------------------------------
   Guardar, escribir, reemplazar.
   -------------------------------------------------------------------------- */

const originales = new Map();

function abrir(rel) {
    if (!originales.has(rel)) originales.set(rel, fs.readFileSync(path.join(RAIZ, rel), 'utf8'));
    return { absoluta: path.join(RAIZ, rel), original: originales.get(rel) };
}

function escribir(rel, txt) {
    const { absoluta, original } = abrir(rel);
    fs.writeFileSync(absoluta, txt);
    return original;
}

/*
 * FINALES DE LINEA
 *
 * En este proyecto conviven CRLF y LF. Un anclaje de mas de una linea escrito
 * con `\n` no encuentra nada en un archivo CRLF, y la mutacion queda como "no
 * se aplica", que parece otra cosa. Por eso se busca siempre sobre el texto
 * normalizado a LF, y al escribir se devuelve el archivo con el mismo tipo de
 * fin de linea que tenia. Como al final se restaura todo desde una copia del
 * original, el archivo vuelve byte a byte como estaba.
 */
const aLf = (txt) => txt.replace(/\r\n/g, '\n');
const finDeLineaDe = (txt) => (txt.includes('\r\n') ? '\r\n' : '\n');

/**
 * Cambia la PRIMERA aparicion de `viejo` por `nuevo`.
 * Si `viejo` no aparece, tira: una mutacion que no se aplica no prueba nada.
 */
function reemplazar(rel, viejo, nuevo) {
    const { absoluta, original } = abrir(rel);
    const eol = finDeLineaDe(original);
    const norm = aLf(original);
    const v = aLf(viejo);
    if (!norm.includes(v)) {
        throw new Error(`la mutacion no se puede aplicar: "${rel}" no contiene\n    ${viejo}`);
    }
    escribir(rel, norm.replace(v, aLf(nuevo)).replace(/\n/g, eol));
}

/** Deja todo como estaba. */
function restaurarTodo() {
    for (const [rel, txt] of originales) fs.writeFileSync(path.join(RAIZ, rel), txt);
}

/** Corre el verificador y devuelve su salida y su codigo de salida. */
function correrVerificador() {
    try {
        const salida = execFileSync(process.execPath, [VERIFICADOR], { encoding: 'utf8' });
        return { codigo: 0, salida };
    } catch (e) {
        return { codigo: e.status === undefined ? -1 : e.status, salida: (e.stdout || '') + (e.stderr || '') };
    }
}

/* --------------------------------------------------------------------------
   Las mutaciones

   `espera` es un pedazo del texto del FALLO que tiene que aparecer. Si el
   verificador falla por otra cosa, la mutacion no esta probando lo que dice
   estar probando.
   -------------------------------------------------------------------------- */

const MUTACIONES = [
    /* --- 1. Sesion, modulo y permisos -------------------------------------- */
    {
        nombre: 'una ruta de factura queda sin sesion',
        porQue: 'es la fuga que ya se cometio con las etiquetas: cualquiera que tuviera el numero leia los datos de la factura, sin iniciar sesion',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/facturas', verificarToken, requiereModulo('facturacion'), async",
                "app.get('/api/facturas', requiereModulo('facturacion'), async");
        },
        espera: 'ninguna ruta de factura queda sin sesion'
    },
    {
        nombre: 'una ruta de factura queda sin el modulo contratado',
        porQue: 'una empresa sin el modulo facturacion contratada veria sus facturas igual',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/facturas', verificarToken, requiereModulo('facturacion'), async",
                "app.get('/api/facturas', verificarToken, async");
        },
        espera: 'pide el modulo facturacion'
    },
    {
        nombre: 'emitir deja de exigir administrador',
        porQue: 'emitir saca el numero y mueve el deposito. Que lo pueda hacer cualquiera con el modulo significa que un tecnico crea comprobantes y descuenta stock',
        hacer() {
            reemplazar('server.js',
                "app.post('/api/facturas/:id/emitir', verificarToken, requiereModulo('facturacion'), requiereAdmin, async",
                "app.post('/api/facturas/:id/emitir', verificarToken, requiereModulo('facturacion'), async");
        },
        espera: 'exige requiereAdmin'
    },
    {
        nombre: 'anular deja de exigir administrador',
        porQue: 'anular devuelve stock al deposito. Sin exigir admin, cualquiera puede devolver mercaderia que nunca salio',
        hacer() {
            reemplazar('server.js',
                "app.post('/api/facturas/:id/anular', verificarToken, requiereModulo('facturacion'), requiereAdmin, async",
                "app.post('/api/facturas/:id/anular', verificarToken, requiereModulo('facturacion'), async");
        },
        espera: 'exige requiereAdmin'
    },
    {
        nombre: 'borrar deja de exigir administrador',
        porQue: 'borrar un documento no es un dato: es una accion que hay que poder auditar. Sin admin, cualquiera borra un borrador',
        hacer() {
            reemplazar('server.js',
                "app.delete('/api/facturas/:id', verificarToken, requiereModulo('facturacion'), requiereAdmin, async",
                "app.delete('/api/facturas/:id', verificarToken, requiereModulo('facturacion'), async");
        },
        espera: 'exige requiereAdmin'
    },
    {
        nombre: 'aparece una ruta de factura nueva y nadie la revisa',
        porQue: 'si el numero de rutas esta escrito a mano y no se actualiza, las secciones de abajo solo miran las diez de siempre y la nueva queda sin cobrir',
        hacer() {
            reemplazar('server.js',
                "// --- Listado ----------------------------------------------------------------\napp.get('/api/facturas',",
                "app.get('/api/facturas/totales', verificarToken, requiereModulo('facturacion'), (req, res) => res.json({}));\n\n// --- Listado ----------------------------------------------------------------\napp.get('/api/facturas',");
        },
        espera: 'se esperaban 10 rutas de factura'
    },

    /* --- 2. La base la decide la sesion ------------------------------------ */
    {
        nombre: 'una ruta abre una base de datos por nombre',
        porQue: 'es exactamente como nacio la fuga de las etiquetas: una base escrita a mano es la de la empresa 1, y con dos empresas sus facturas se resuelven contra los datos de la primera',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/facturas', verificarToken, requiereModulo('facturacion'), async (req, res) => {\n    try {",
                "app.get('/api/facturas', verificarToken, requiereModulo('facturacion'), async (req, res) => {\n    try {\n        if (false) await obtenerPool('serviceintegralsistema').query('SELECT 1');");
        },
        espera: 'no menciona ninguna base por nombre'
    },

    /* --- 3. El numero y el stock ------------------------------------------- */
    {
        nombre: 'el alta de la factura saca el numero',
        porQue: 'si el borrador ya tiene numero, cada borrador que nunca se emite quema uno y deja un hueco. En una numeracion, un hueco es un numero que alguien puede estar usando sin que se sepa de que',
        hacer() {
            reemplazar('server.js',
                'VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'BORRADOR\', ?, ?)`,\n                [d.fecha, d.cliente_id,',
                'VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'BORRADOR\', ?, ?)`,\n                [d.fecha, d.cliente_id,');
        },
        espera: 'guarda el numero en NULL explicitamente'
    },
    {
        nombre: 'el alta saca el numero de la correlativa',
        porQue: 'la via sutil de la anterior: el INSERT pone NULL, pero antes se gasta un numero de la secuencia. El numero se pierde sin que se vea en el INSERT',
        hacer() {
            reemplazar('server.js',
                'const id = await tenant.transaccion(async ({ query }) => {\n            const [r] = await query(\n                `INSERT INTO facturas\n                    (numero, fecha, cliente_id,',
                'const id = await tenant.transaccion(async ({ query }) => {\n            await siguienteNumero(query, \'factura\');\n            const [r] = await query(\n                `INSERT INTO facturas\n                    (numero, fecha, cliente_id,');
        },
        espera: 'crear la factura NO saca numero'
    },
    {
        nombre: 'el numero sale de la correlativa del presupuesto',
        porQue: 'las dos correlativas comparten la fila `presupuesto`. Entonces el numero 5 de facturas y el 5 de presupuestos son el mismo, y un cliente que recibe los dos documentos tiene dos numeros 5 de cosas distintas',
        hacer() {
            reemplazar('server.js', "const numero = await siguienteNumero(query, 'factura');", 'const numero = await siguienteNumero(query);');
        },
        espera: "correlativa 'factura'"
    },
    {
        nombre: 'el numero se saca antes de verificar el stock',
        porQue: 'una emision que no sale por falta de stock igual quema un numero. La correlativa avanza por facturas que nunca salieron, y el hueco parece una factura perdida. Ojo: la primera version de esta mutacion movia el descuento pero dejaba el numero primero, asi que no invertia el orden y el verificador pasaba sin dientes. El control mide la posicion de los dos, no que los dos esten',
        hacer() {
            reemplazar('server.js',
                'const numero = await siguienteNumero(query, \'factura\');\n\n            if (factura.stock_descontado === 0) {\n                await descontarStockFactura(query, items, `Factura N° ${numero}`);',
                'if (factura.stock_descontado === 0) {\n                await descontarStockFactura(query, items, \'Factura sin numero todavia\');\n            }\n            const numero = await siguienteNumero(query, \'factura\');\n\n            if (false) {');
        },
        espera: 'DESPUES de verificar el stock'
    },
    {
        nombre: 'el numero se saca fuera de la transaccion',
        porQue: 'si el descuento de stock falla, la transaccion deshace todo MENOS el numero, que ya salio. Queda un hueco sin factura que lo explique, y no hay forma de saber que paso',
        hacer() {
            reemplazar('server.js',
                "const numero = await siguienteNumero(query, 'factura');",
                'const numero = 999;');
        },
        espera: 'el numero se saca DENTRO de la transaccion'
    },
    {
        nombre: 'el descuento de stock deja de marcar el flag',
        porQue: 'sin `stock_descontado = 1`, reintentar la emision de una factura ya emitida descuenta el stock OTRA vez. Dos unidades del mismo repuesto, una venta',
        hacer() {
            reemplazar('server.js',
                '`UPDATE facturas SET numero = ?, estado = \'EMITIDA\', stock_descontado = 1 WHERE id = ?`',
                '`UPDATE facturas SET numero = ?, estado = \'EMITIDA\' WHERE id = ?`');
        },
        espera: 'marca la factura como ya descontada'
    },
    {
        nombre: 'el descuento de stock toca antes de saber que falta',
        porQue: 'este es el fallo caro: descuenta el primer producto, descubre en el tercero que no hay stock, y la transaccion deshace. Sin transaccion —o si alguien la saca — quedan dos productos descontados de una venta que no salio, y el movimiento de stock dice 2 ventas donde hubo 0',
        hacer() {
            reemplazar('server.js',
                'if (faltantes.length) {\n        const e = new Error(\n            \'No hay stock suficiente para emitir la factura. Faltan:\\n- \' + faltantes.join(\'\\n- \')\n        );\n        e.estadoHttp = 400;\n        throw e;\n    }\n\n    // 2. Ahora sí, todos o ninguno.\n    for (const b of aBajar) {',
                'if (faltantes.length) {\n        /* el descuento ya corrio */\n    }\n\n    // 2. Ahora sí, todos o ninguno.\n    for (const b of aBajar) {');
        },
        espera: 'si falta stock, la emision se corta'
    },
    {
        nombre: 'el descuento de stock no corta la emision',
        porQue: 'la forma sutil de la anterior: `faltantes.push` sigue ahi, asi que el control que busca los faltantes da verde, pero el `throw` desaparece. La emision sale con el deposito en negativo, el movimiento de stock registra una venta que no habia existencias, y el comprobante ya tiene numero. Anular no lo arregla: `stock_descontado` quedo en 1',
        hacer() {
            reemplazar('server.js',
                'e.estadoHttp = 400;\n        throw e;\n    }\n\n    // 2. Ahora sí, todos o ninguno.',
                'e.estadoHttp = 400;\n    }\n\n    // 2. Ahora sí, todos o ninguno.');
        },
        espera: 'si falta stock, la emision se corta'
    },
    {
        nombre: 'anular deja de devolver el stock',
        porQue: 'la factura desaparece de la lista de emitidas y el repuesto nunca vuelve al deposito. El stock baja con cada venta anulada y no sube nunca',
        hacer() {
            reemplazar('server.js',
                'await devolverStockFactura(',
                'await (async () => {})(\n                    // sin devolucion');
        },
        espera: 'anular devuelve el stock al deposito'
    },
    {
        nombre: 'anular un borrador deja de rechazarse',
        porQue: 'anular un borrador y borrarlo son la misma operacion. Si `anular` lo acepta, la palabra significa dos cosas distintas y el usuario no sabe cual eligio',
        hacer() {
            reemplazar('server.js',
                "if (factura.estado === 'BORRADOR') {\n                const e = new Error(\n                    'Esta factura es un borrador y nunca se emitió",
                "if (false) {\n                const e = new Error(\n                    'Esta factura es un borrador y nunca se emitió");
        },
        espera: 'anular rechaza un borrador'
    },
    {
        nombre: 'una factura emitida pasa a poder editarse',
        porQue: 'el numero ya salio y el cliente ya lo tiene. Cambiar los renglones por la puerta de atras hace que la base diga una cosa y el comprobante impreso otra, y el stock ya descontado corresponde a items que ya no son los que se vendieron',
        hacer() {
            reemplazar('server.js',
                "if (actual[0].estado !== 'BORRADOR') {\n                const e = new Error(\n                    `Una factura ${ESTADO_FACTURA[actual[0].estado]} no se puede modificar. `",
                "if (false) {\n                const e = new Error(\n                    `Una factura ${ESTADO_FACTURA[actual[0].estado]} no se puede modificar. `");
        },
        espera: 'no se puede modificar'
    },
    {
        nombre: 'una factura emitida pasa a poder borrarse',
        porQue: 'si se borra, el numero vuelve a estar libre y la correlativa tiene un numero que aparece en el papel de un cliente y no existe en el sistema. Es el peor tipo de hueco: no se nota mirando',
        hacer() {
            reemplazar('server.js',
                "if (actual[0].estado !== 'BORRADOR') {\n            return res.status(400).json({\n                error: `Solo se borran facturas en BORRADOR.",
                "if (false) {\n            return res.status(400).json({\n                error: `Solo se borran facturas en BORRADOR.");
        },
        espera: 'no se puede borrar'
    },

    /* --- 4. La plata ------------------------------------------------------- */
    {
        nombre: 'un importe pasa a ser FLOAT en la migracion',
        porQue: 'DECIMAL en la base pero FLOAT en el camino devuelve al error de punto flotante. Una factura que no cuadra es una factura que nadie firma, y el descuadre es de centimos que aparecen y desaparecen segun el orden de las sumas',
        hacer() {
            reemplazar('migrations/tenant/006_facturacion.sql',
                '`total`             DECIMAL(12,2) NOT NULL DEFAULT \'0.00\',',
                '`total`             DOUBLE NOT NULL DEFAULT 0,');
        },
        espera: 'facturas.total es DECIMAL(12,2)'
    },
    {
        nombre: 'el descuento de un renglon se redondea solo al final',
        porQue: 'si el error de coma flotante se acumula renglon sobre renglon y se redondea una vez al final, el resultado depende del orden de las sumas. Con 30 renglones, el mismo comprobante da tres totales distintos segun como se ordene la pantalla',
        hacer() {
            reemplazar('server.js',
                'iva_monto = a2(iva_monto + ivaItem);',
                'iva_monto = iva_monto + ivaItem;');
        },
        espera: 'iva_monto se redondea'
    },
    {
        nombre: 'la formula del total cambia solo en el codigo',
        porQue: 'la migracion documenta `total = subtotal - descuento + iva_monto` y el codigo pasa a sumar el descuento. El documento esta bien y el calculo esta mal: la diferencia es exactamente el descuento, y aparece en todas las facturas con descuento',
        hacer() {
            reemplazar('server.js',
                'const total = a2(subtotal - descuento + iva_monto);',
                'const total = a2(subtotal + descuento + iva_monto);');
        },
        espera: 'prepararFactura calcula el total'
    },
    {
        nombre: 'las alicuotas pasan a ser cualquier numero entre 0 y 100',
        porQue: 'es el cambio mas tentador de los tres. Parece mas flexible: se puede cargar cualquier alicuota. En la practica es un error esperando —alguien escribe 21,5 o 0.21 y la factura sale con el IVA callado, sin error y sin aviso',
        hacer() {
            reemplazar('server.js',
                'const ALICUOTAS_IVA = [0, 10.5, 21];',
                'const ALICUOTAS_IVA = [0, 5, 10.5, 21, 27];');
        },
        espera: 'las alicuotas admitidas son exactamente 0, 10.5 y 21'
    },
    {
        nombre: 'una alicuota invalida se cambia por cero en vez de dar error',
        porQue: 'la forma sutil: el `includes` sigue ahi y el control de la lista sigue dando verde, pero el ternario de abajo se come el error y deja 0. La factura sale con IVA 0% y sin una sola palabra de aviso',
        hacer() {
            reemplazar('server.js',
                'if (!Number.isFinite(iva_porcentaje) || !ALICUOTAS_IVA.includes(iva_porcentaje)) {\n            errores.push(\n                `El IVA del ítem ${n} tiene que ser ${ALICUOTAS_IVA.join(\', \')} ` +\n                \'(uno de esos tres, en punto).\'\n            );\n        }',
                'if (!Number.isFinite(iva_porcentaje) || !ALICUOTAS_IVA.includes(iva_porcentaje)) {\n            iva_porcentaje = 0;\n        }');
        },
        espera: 'fuera de la lista da error con mensaje'
    },

    /* --- 5. Las columnas --------------------------------------------------- */
    {
        nombre: 'una ruta lee una columna que la tabla no tiene',
        porQue: 'ES EL FALLO REAL QUE YA PASA EN ESTE PROYECTO: la ruta del escaner de etiquetas pedia p.ubicacion y productos no tiene esa columna. Con todos los guardias puestos, el modulo correcto y sin base escrita a mano, los controles de rutas dan todos OK y el escaner devuelve 500 en todas las consultas. Compila, no viola ninguna regla, y solo se entera MySQL cuando alguien escanea',
        hacer() {
            reemplazar('server.js',
                'SELECT id, numero, fecha, cliente_id, cliente_nombre, cliente_doc, estado,\n                    subtotal, descuento, iva_monto, total, forma_pago, fecha_pago, usuario_nombre\n               FROM facturas',
                'SELECT id, numero, fecha, cliente_id, cliente_nombre, cliente_doc, estado,\n                    subtotal, descuento, iva_monto, total, notas_internas, fecha_pago, usuario_nombre\n               FROM facturas');
        },
        espera: 'toda columna que leen las rutas de factura existe en el esquema'
    },
    {
        nombre: 'el dump del esquema deja de listar la tabla de facturas',
        porQue: 'deriva realista: schema-actual.sql se regenera a mano y alguien lo edito. Entonces columnasDe devuelve null y TODAS las columnas de esa tabla dejan de tener contra que compararse: el control deja de mirar justo esa tabla y da verde sin decir nada',
        hacer() {
            reemplazar('schema/schema-actual.sql',
                'CREATE TABLE `facturas` (',
                'CREATE TABLE `facturas_vieja` (');
        },
        espera: 'toda columna que leen las rutas de factura existe en el esquema'
    },
    {
        nombre: 'una cantidad fraccionaria pasa a redondearse en silencio',
        porQue: 'productos.stock es INT. Una venta de 2,5 redondeada a 2 deja el deposito con medio repuesto que no existe y nadie lo ve. Es el tipo de error de inventario que despues no se puede reconstruir',
        hacer() {
            reemplazar('server.js',
                'if (!Number.isInteger(cantidad)) {',
                'if (false) {');
        },
        espera: 'cantidad fraccionaria, en vez de redondearla'
    },
    {
        nombre: 'la cantidad deja de convertirse a numero',
        porQue: 'ESTE BUG ESTUVO EN EL CODIGO Y LO ENCONTRO ESTA PRUEBA VIVA, NO EL VERIFICADOR. `factura_items.cantidad` es DECIMAL(12,3) y mysql2 devuelve los DECIMAL como texto: un renglon de 2 unidades llega como "2.000". `Number.isInteger("2.000")` da false, asi que TODA factura con producto se rechazaba al emitir con un mensaje que decia que 2 unidades no eran enteras, y ninguna se podia emitir. El modulo de facturacion entero era inservible y las 89 comprobaciones de texto daba verde: en el codigo y en el esquema, "2.000" es un numero. Es la tercera vez en este proyecto que el fallo aparece solo cuando algo corre de verdad',
        hacer() {
            reemplazar('server.js',
                'const n = Number(it.cantidad);\n    return Number.isFinite(n) ? n : null;',
                'return it.cantidad;');
        },
        espera: 'se convierte con Number()'
    },
    {
        nombre: 'la devolucion de stock no convierte la cantidad',
        porQue: 'la otra mitad del mismo bug. Si descontar convierte y devolver no, anular suma la cadena "2.000" al deposito y el stock queda con un valor que no es un numero. Peor que el bug de emitir: emitir fallaba ruidosamente, esto se descubre cuando el stock aparece raro tres meses despues',
        hacer() {
            reemplazar('server.js',
                'const cantidad = cantidadDeRenglon(it);\n        if (cantidad === null || cantidad <= 0 || !Number.isInteger(cantidad)) continue;',
                'const cantidad = it.cantidad;\n        if (cantidad <= 0) continue;');
        },
        espera: 'la devolucion de stock tambien convierte la cantidad'
    },
    {
        nombre: 'la 006 deja de ser reaplicable',
        porQue: 'ESTE BUG ESTA EN PRODUCCION Y ROMPIA EL ALTA DE EMPRESAS. `altas.js` carga `schema/schema-actual.sql` (el esquema actual, con `precio_cobrado` ya puesto) y DESPUES corre la cadena de migraciones encima. Un `ALTER ... ADD COLUMN` a secas revienta con `Duplicate column name` y toda empresa nueva se rechaza al registrarse. El motor no lo ve nunca porque tiene ledger: contra la base del taller, que ya esta migrada, la 006 ni se intenta. Lo unico que lo agarra es armar una base desde cero como hace el alta. La 006 fue la primera migracion con un ALTER — 004 y 005 solo usan CREATE TABLE IF NOT EXISTS — asi que nunca habia pasado',
        hacer() {
            reemplazar('migrations/tenant/006_facturacion.sql',
                'SET @precio_cobrado_sql := IF(@precio_cobrado_ya_existe > 0,\n    \'DO 0\',\n    \'ALTER TABLE `reparaciones`',
                'SET @precio_cobrado_sql := IF(1 = 0,\n    \'DO 0\',\n    \'ALTER TABLE `reparaciones`');
        },
        espera: 'el IF pregunta si la columna ya existe'
    },
    {
        nombre: 'el IF deja de mirar information_schema',
        porQue: 'la forma "simplificada" de la misma cosa: alguien lee el bloque, ve que es un IF sobre una variable, y lo reemplaza por una constante para que se vea mas corto. El IF sigue ahi, el PREPARE sigue ahi, y la migracion sigue pareciendo guardada — pero ya no mira nada, asi que el ALTER corre siempre y el alta de empresa vuelve a romperse',
        hacer() {
            reemplazar('migrations/tenant/006_facturacion.sql',
                "SET @precio_cobrado_ya_existe := (\n    SELECT COUNT(*) FROM information_schema.COLUMNS\n     WHERE TABLE_SCHEMA = DATABASE()\n       AND TABLE_NAME   = 'reparaciones'\n       AND COLUMN_NAME  = 'precio_cobrado'\n);",
                'SET @precio_cobrado_ya_existe := 0;');
        },
        espera: 'esta guardado con un IF sobre information_schema'
    },
    {
        nombre: 'la 006 vuelve a un ALTER a secas',
        porQue: 'la forma obvia de escribir esto, y la que estaba. Se ve innocuous mirando solo el archivo: "agregar una columna" es lo que hace una migracion. Lo que NO se ve es que el archivo se corre sobre un esquema que ya la tiene',
        hacer() {
            reemplazar('migrations/tenant/006_facturacion.sql',
                "PREPARE agregar_precio_cobrado FROM @precio_cobrado_sql;\nEXECUTE agregar_precio_cobrado;\nDEALLOCATE PREPARE agregar_precio_cobrado;",
                "ALTER TABLE `reparaciones`\n    ADD COLUMN `precio_cobrado` DECIMAL(12,2) NULL\n    COMMENT 'x'\n    AFTER `total`;");
        },
        espera: 'no tiene un ALTER TABLE a secas'
    },
    {
        nombre: 'el dump del esquema deja de tener la columna nueva de reparaciones',
        porQue: 'la columna precio_cobrado se agrego en la misma migracion. El dump solo se regenera cuando alguien se acuerda, y si queda viejo el verificador de columnas deja de mirar esa tabla sin decir nada. Con esto, el reporte de rentabilidad consulta una columna que el verificador no encuentra — y el reporte no se entera hasta que corre en la pantalla, con el taller esperando',
        hacer() {
            reemplazar('schema/schema-actual.sql',
                "`precio_cobrado` decimal(12,2) NULL COMMENT",
                '`precio_cobrado_viejo` decimal(12,2) NULL COMMENT');
        },
        espera: 'el dump del esquema ya tiene la columna nueva'
    },

    /* --- 6. El orden de las rutas ------------------------------------------ */
    {
        nombre: 'desde-presupuesto se registra antes de la ruta con :id',
        porQue: 'asi es como se suele "arreglar" el orden sin pensarlo. Y en este caso no rompe nada, porque los patrones difieren en la cantidad de segmentos. Se verifica igual: si manana se agrega una ruta con dos parametros y un literal en el medio, este control va a avisar',
        hacer() {
            reemplazar('server.js',
                "// --- Desde un presupuesto ----------------------------------------------------",
                "app.post('/api/facturas/probe/:a/:b', verificarToken, requiereModulo('facturacion'), (req, res) => res.json({}));\n\n// --- Desde un presupuesto ----------------------------------------------------");
        },
        espera: 'se esperaban 10 rutas de factura'
    },
    {
        nombre: 'una ruta nueva se pisa con otra al despacharse',
        porQue: 'el caso que el comentario del modulo promete que no puede pasar sin que nadie lo note: dos rutas con los mismos segmentos y parametros en las mismas posiciones. La segunda nunca se alcanza, y el endpoint aparece en la documentacion y no funciona',
        hacer() {
            reemplazar('server.js',
                "app.post('/api/facturas/:id/pagar', verificarToken, requiereModulo('facturacion'), async",
                "app.post('/api/facturas/:facturaId/pagar', verificarToken, requiereModulo('facturacion'), async");
        },
        espera: 'llega a POST /api/facturas/:id/pagar'
    },

    /* --- 7. La pantalla: contra el servidor y contra el esquema --------------
       RAIZ es el backend, asi que el navegador se nombra con "../frontend/...".
       Sin el "..", `abrir` resuelve "frontend/facturacion.js" dentro de
       backend/, no encuentra el archivo y todas estas mutaciones mueren con un
       ENOENT que no dice nada del check que se queria probar.

       Lo que NO esta en esta seccion y por que: el aviso de que la pagina tiene
       que cargar auth-check.js en el <head> no es un check de facturacion, es
       un check de tema y de assets, y vive en ver-estilo-y-tema.js, que ya lo
       prueba. Poner una copia aca seria el peor de los casos conocidos: dos checks
       del mismo texto en dos archivos, y el dia que uno cambia el otro sigue
       dando verde.

       Las de arriba mutan el backend y las rechazan las guardas. Estas de
       abajo mutan el NAVEGADOR, y ese es el lado que no tiene guardas: una
       columna mal escrita en el `.js` del navegador no da error de sintaxis, no
       da error de ejecucion y no rompe la pagina. Da `undefined`, se ve la
       palabra "undefined" en una tabla, y el boton de guardar sigue andando.
       Por eso hay checks que comparan el navegador contra el esquema y contra
       las rutas, y por eso estos controls tienen que existir: sin esta seccion,
       los checks nuevos serian los unicos del archivo que nunca se probaron. */
    {
        nombre: 'la pantalla lee una columna de facturas que no existe',
        porQue: 'el caso que ya se perdio una vez con las etiquetas (p.ubicacion). En el servidor es un 500, y en el navegador es peor porque no es nada: se ve undefined en el papel que se le entrega al cliente',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'pesosF(f.iva_monto)',
                'pesosF(f.iva_monto_calculado)');
        },
        espera: 'todas las columnas que la pantalla lee de facturas existen'
    },
    {
        nombre: 'la pantalla lee una columna de items que no existe',
        porQue: 'igual que el anterior pero del otro lado de la tabla. Los items se imprimen en una grilla donde una celda vacia se disimula entre otras vacias, y nadie se entera hasta que el papel ya esta impreso',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'escapeHtml(it.descripcion)',
                'escapeHtml(it.descripcion_texto)');
        },
        espera: 'todas las columnas que la pantalla lee de factura_items existen'
    },
    {
        nombre: 'la pantalla lee una columna de empresa que no existe',
        porQue: 'esta ni esta en el dump del tenant: la empresa vive en el esquema CENTRAL, que esta en otro archivo. Un extractor que busca el alias en el archivo equivocado no encuentra nada, y "no encontrado" se leeria como "columna inexistente". Con esto se ve que el check de la central tambien muerde',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'empresa.color_primario',
                'empresa.color_principal');
        },
        espera: 'todas las columnas de empresa que lee la hoja existen en la central'
    },
    {
        nombre: 'la pantalla llama a una ruta que el servidor no expone',
        porQue: 'sale un 404, y el mensaje que ve el usuario dice que no se pudo conectar con el servidor. La conexion esta bien: la ruta no existe. Un 404 disfrazado de problema de red hace perder horas',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'apiFetch(`/api/facturas/${id}/comprobante`)',
                'apiFetch(`/api/facturas/${id}/comprobante-pdf`)');
        },
        espera: 'la pantalla llama get /api/facturas/:p/comprobante-pdf, y esa ruta existe'
    },
    {
        nombre: 'la pantalla llama con un metodo que el servidor no declara',
        porQue: 'el mismo 404 del caso anterior pero por el otro lado: la ruta existe y no con ese metodo. Salen dos errores identicos para dos errores distintos, y el mensaje no ayuda a distinguirlos. Se usa PATCH y no GET a proposito: GET /api/facturas/:id SI existe, asi que cambiar DELETE por GET deja una llamada perfectamente valida y el check no tiene nada que reprochar',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                "apiFetch(`/api/facturas/${id}`, { method: 'DELETE' })",
                "apiFetch(`/api/facturas/${id}`, { method: 'PATCH' })");
        },
        espera: 'la pantalla llama patch /api/facturas/:p, y esa ruta existe'
    },
    {
        nombre: 'una ruta de factura queda sin consumidor en el navegador',
        porQue: 'al reves del anterior: el servidor expone un endpoint y no hay ninguna pantalla que lo alcance. Queda muerto sin que nada lo diga. Detectar esto es lo unico que impide que las rutas sin usar se acumulen en silencio',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                '`/api/facturas/${f.id}/emitir`',
                '`/api/facturas/${f.id}/emitirV2`');
        },
        espera: 'toda ruta de factura se llega desde alguna pantalla'
    },
    {
        nombre: 'la pantalla ofrece una alicuota que el servidor no acepta',
        porQue: 'la pantalla deja armar y guardar la factura, y el servidor la rechaza con un 400 que no explica nada. El usuario completo todo, aprieta guardar, y pierde el trabajo',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'const ALICUOTAS = [21, 10.5, 0];',
                'const ALICUOTAS = [21, 10.5, 0, 27];');
        },
        espera: 'las alicuotas del navegador son las mismas que las del servidor'
    },
    {
        nombre: 'la pantalla deja de ofrecer una alicuota que el servidor acepta',
        porQue: 'al reves, y peor para el negocio: el servidor la acepta, la pantalla no la ofrece, y una venta que corresponde a esa alicuota no se puede cargar',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'const ALICUOTAS = [21, 10.5, 0];',
                'const ALICUOTAS = [21, 0];');
        },
        espera: 'las alicuotas del navegador son las mismas que las del servidor'
    },
    {
        nombre: 'la pantalla escribe las opciones de IVA a mano',
        porQue: 'la lista de alicuotas deja de mandar: el servidor le agrega una y la pantalla no la muestra. El check de igualdad entre las dos listas sigue dando OK, porque las dos siguen iguales: lo que cambio es de donde salen las opciones',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'ALICUOTAS.map((a)',
                '[21, 10.5, 0].map((a)');
        },
        espera: 'las opciones de IVA se generan recorriendo ALICUOTAS'
    },
    {
        nombre: 'la pantalla se queda sin un estado del servidor',
        porQue: 'el servidor suma un estado y la etiqueta sale pelada, sin fondo, en el medio del listado. Ademas el filtro no lo ofrece, asi que no se puede ni buscar. Ninguno de los dos falla: se ve feo y no se encuentra',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                "    ANULADA: 'Anulada'",
                "    ANULADA_VIEJA: 'Anulada'");
        },
        espera: 'los estados del navegador son los mismos que los del servidor'
    },
    {
        nombre: 'la clase CSS de un estado desaparece de las hojas que carga la pagina',
        porQue: 'la etiqueta sale pelada en el listado. Y el error de buscar solo en facturacion.css es real: .p-estado-borrador vive en presupuestos.css, que esta pagina carga justamente para no duplicarla',
        hacer() {
            reemplazar('../frontend/facturacion.css',
                '.p-estado-emitida',
                '.p-estado-emitidax');
        },
        espera: 'existe la clase .p-estado-emitida'
    },
    {
        nombre: 'la hoja imprimible deja de decir que no es un comprobante fiscal',
        porQue: 'el papel que se imprime y se le entrega al cliente sale como si fuera una factura mas, sin el aviso. Y esto es lo unico que separa un comprobante interno de una factura: si desaparece el aviso, quedan el numero, la forma y el membrete, que es exactamente lo que hace parecer a una factura un papel que no lo es',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'no tiene CAI ni punto de venta y no es un comprobante fiscal.',
                'tiene CAI y punto de venta.');
        },
        espera: 'la hoja imprimible dice que no es un comprobante fiscal'
    },
    {
        nombre: 'la pantalla deja de decirlo, pero el papel sigue',
        porQue: 'el reves del anterior, y por eso el check mira los dos lugares por separado: el aviso vive en dos archivos, y sacar uno solo deja al cliente con un papel sin aviso mientras el usuario sigue viendo uno que si lo tiene',
        hacer() {
            reemplazar('../frontend/facturacion.html',
                'no son comprobantes fiscales',
                'son comprobantes fiscales');
        },
        espera: 'la pantalla dice que no es un comprobante fiscal'
    },
    {
        nombre: 'el navegador manda los importes que calculo',
        porQue: 'no es un agujero de seguridad, porque el servidor los vuelve a calcular igual. Es otra cosa: es mandarle una opinion que el servidor no escucha. El dia que cambie el calculo, el navegador queda desfasado en silencio y no hay nadie que lo note',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'items: F.items.map((it) => ({',
                'total: F.total,\n        items: F.items.map((it) => ({');
        },
        espera: 'el cuerpo que se manda NO lleva "total:"'
    },
    {
        nombre: 'la hoja imprimible recalcula los importes en el navegador',
        porQue: 'imprimiria lo que calculo el navegador y no lo que guardo el servidor. Hoy los dos dan lo mismo, asi que no se ve. Mañana, con un redondeo distinto en cada lado, se ve como un peso que no cierra y es el cliente el que lo pregunta',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'const { factura: f, items, empresa, emitido_por } = F.detalle;',
                'const { factura: f, items, empresa, emitido_por } = F.detalle;\n    recalcularFactura();');
        },
        espera: 'la hoja imprimible NO recalcula los importes'
    },
    {
        nombre: 'facturacion.css se carga antes de presupuestos.css',
        porQue: 'las reglas propias de esta pagina pisan padding y bordes de celdas, y las comunes los definen despues. Cambiando el orden de los links, la tabla se desalinea y el papel sale raro. El orden de los links ES la dependencia: un check de "estan las dos cargadas" daria OK igual',
        hacer() {
            reemplazar('../frontend/facturacion.html',
                '<link rel="stylesheet" href="presupuestos.css?v=2.5">\n    <link rel="stylesheet" href="facturacion.css?v=2.5">',
                '<link rel="stylesheet" href="facturacion.css?v=2.5">\n    <link rel="stylesheet" href="presupuestos.css?v=2.5">');
        },
        espera: 'facturacion.css se carga DESPUES de presupuestos.css'
    },
    {
        nombre: 'el boton de facturar aparece tambien en un presupuesto que no esta APROBADO',
        porQue: 'facturar un presupuesto enviado o rechazado saca plata de la caja. Que el boton no dependa del estado es un error de negocio y no de estilo, y es de los que se ven en la pantalla y no en el log',
        hacer() {
            reemplazar('../frontend/presupuestos.js',
                "if (p.estado === 'APROBADO' && tieneModulo('facturacion')) {",
                "if (tieneModulo('facturacion')) {");
        },
        espera: 'el boton Facturar exige presupuesto APROBADO y modulo facturacion'
    },
    {
        nombre: 'el boton de facturar aparece sin el modulo contratado',
        porQue: 'una empresa que no pago facturacion ve un boton que le abre una pantalla de un modulo que no tiene. El error sale del otro lado: el boton existe y el servidor responde 403 sin explicar que el modulo no esta contratado',
        hacer() {
            reemplazar('../frontend/presupuestos.js',
                "if (p.estado === 'APROBADO' && tieneModulo('facturacion')) {",
                "if (p.estado === 'APROBADO') {");
        },
        espera: 'el boton Facturar exige presupuesto APROBADO y modulo facturacion'
    },
    {
        nombre: 'facturar un presupuesto crea la factura y no deja ver el numero',
        porQue: 'la factura se crea y el usuario queda en la pantalla de presupuestos buscando un numero que todavia no existe. Nadie ve el error porque no hubo error. Es el peor de los fallos sin ruido, y por eso el check mira que se pase el id de la factura nueva',
        hacer() {
            reemplazar('../frontend/presupuestos.js',
                'facturacion.html?nuevo=',
                'facturacion.html?listo=');
        },
        espera: 'presupuestos.js pasa el id de la factura nueva a facturacion.html'
    },

    /* --- 8. Lo que el HTML llama contra lo que el JS define -----------------
       Las dos primeras de esta seccion no son hipotesis: son dos botones que
       estaban rotos y aparecieron recien en el navegador. `onclick="guardar()"`
       y `onclick="cerrarDetalle()"` en facturacion.html, con las funciones
       llamadas `guardarFactura` y `cerrarDetalleFactura` en facturacion.js.

       El boton de guardar no guardaba y el de cerrar el detalle no cerraba, y
       ningun otro check de este archivo lo notaba: todos miran el `.js`, y el
       `.js` estaba impecable. Por eso estas dos mutaciones atacan los dos
       lados, y no son el mismo error. */
    {
        nombre: 'un boton llama a una funcion que no existe',
        porQue: 'es el error tal cual salio: el HTML quedo con el nombre de la pagina de al lado y el JS con el nombre propio. Clic, nada, y un ReferenceError en la consola que el usuario no ve porque no abre la consola',
        hacer() {
            reemplazar('../frontend/facturacion.html',
                'onclick="guardarFactura()"',
                'onclick="guardar()"');
        },
        espera: 'las 6 funciones que el HTML llama existen en facturacion.js o auth-check.js'
    },
    {
        nombre: 'la funcion que llama un boton cambia de nombre',
        porQue: 'el reves, y por eso tambien tiene que morder: renombrar la funcion del JS es el cambio mas natural que hay, porque el HTML no se toca y nada se ve. Con esto se ve que el check no es solo una busqueda de texto en el HTML',
        hacer() {
            reemplazar('../frontend/facturacion.js',
                'async function guardarFactura() {',
                'async function guardarFacturaV2() {');
        },
        espera: 'las 6 funciones que el HTML llama existen en facturacion.js o auth-check.js'
    },
    {
        nombre: 'un boton que cerraba el detalle queda sin funcion',
        porQue: 'la "X" del comprobante: un boton sin accion y ninguna consecuencia visible salvo que el papel no se cierra. Es el fallo con menos ruido de los dos',
        hacer() {
            reemplazar('../frontend/facturacion.html',
                'onclick="cerrarDetalleFactura()"',
                'onclick="cerrarDetalle()"');
        },
        espera: 'las 6 funciones que el HTML llama existen en facturacion.js o auth-check.js'
    },
    {
        nombre: 'el boton de tema queda sin la funcion que cambia el tema',
        porQue: 'esta vivita esta en auth-check.js, no en facturacion.js, y se cuelga de window. Un extractor de funciones que solo mira lo que empieza en el principio de la linea no la ve, y el check accuse al boton que esta bien en vez de acusarse a si mismo',
        hacer() {
            reemplazar('../frontend/auth-check.js',
                'window.cambiarTemaManualmente = function cambiarTemaManualmente() {',
                'window.cambiarTema = function cambiarTemaManualmente() {');
        },
        espera: 'las 6 funciones que el HTML llama existen en facturacion.js o auth-check.js'
    }
];

console.log('='.repeat(74));
console.log('  MUTACIONES DE ver-facturacion.js');
console.log(`  ${MUTACIONES.length} mutaciones, una por vez, restaurando despues`);
console.log('='.repeat(74));

/* Primero, que el verificador pase LIMPIO. Si ya falla antes de mutar, todas
   las mutaciones darian un falso positivo. */
const limpio = correrVerificador();
if (limpio.codigo !== 0) {
    console.log('\nEl verificador ya falla con el codigo sano. Se aborta.\n');
    console.log(limpio.salida);
    process.exit(1);
}
console.log('\nPunto de partida: el verificador pasa limpio. OK\n');

let malas = 0;

for (const [i, m] of MUTACIONES.entries()) {
    console.log('-'.repeat(74));
    console.log(`${i + 1}/${MUTACIONES.length}  ${m.nombre}`);
    console.log(`        ${m.porQue}`);

    restaurarTodo();

    let error = null;
    try {
        m.hacer();
    } catch (e) {
        error = e.message;
    }

    if (error) {
        console.log('        MAL  la mutacion no se pudo aplicar');
        console.log(`             ${error.split('\n').join('\n             ')}`);
        malas++;
        continue;
    }

    const r = correrVerificador();

    if (r.codigo === 0) {
        console.log('        MAL  el verificador PASO con el codigo roto (no tiene dientes)');
        malas++;
    } else {
        /* Tiene que fallar POR LO QUE SE ROMPIO, no por cualquier cosa. */
        const lineaDelFallo = r.salida.split('\n').find((l) => l.includes(m.espera) && l.trim().startsWith('FALLO'));
        if (lineaDelFallo) {
            console.log(`        BIEN detectado: ${lineaDelFallo.trim()}`);
        } else {
            console.log(`        MAL  fallo, pero no por el control roto. Se esperaba un FALLO con "${m.espera}"`);
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

/* Verificacion final: despues de restaurar, tiene que volver a pasar. */
const final = correrVerificador();
if (final.codigo !== 0) {
    console.log('\nAL RESTAURAR QUEDO ALGO ROTO:\n');
    console.log(final.salida);
    process.exit(1);
}

console.log('\nCodigo restaurado y verificador en verde.\n');

if (malas > 0) {
    console.log(`\n${malas} mutaciones NO fueron detectadas.\n`);
    process.exit(1);
}

console.log('Todas las mutaciones fueron detectadas.\n');