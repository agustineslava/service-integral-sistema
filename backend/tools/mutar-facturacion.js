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