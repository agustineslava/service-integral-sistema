/* ==========================================================================
   MUTACIONES: ver-etiquetas-qr.js
   --------------------------------------------------------------------------
   Un verificador que dice "todo bien" sin que se le pueda romper el codigo no
   sirve: pasa siempre, no sirve para nada. Este archivo rompe el codigo a
   proposito, una cosa por vez, corre el verificador, y exige que el fallo que
   aparece sea el del control que se rompio. Despues deja todo como estaba.

   Cada mutacion devuelve EXACTAMENTE un fallo, y el texto del fallo tiene que
   contener el nombre del control roto. Si una mutacion no rompe nada, o rompe
   algo que no era, el archivo lo dice y sale con codigo de error.

   La primera tanda de estas mutaciones dejo en claro algo: varias hacen
   dispararse mas de un control a la vez (por ejemplo, volver a agregar
   `/e/:codigo` sin sesion salta el que busca `verificarToken`, el que busca el
   modulo Y el que busca rutas `/e/`). No es un defecto: se pide que aparezca EL
   control que se rompio, no que aparezca solo ese.

   Uso:  node tools/mutar-etiquetas-qr.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const FRONT = path.join(RAIZ, '..', 'frontend');
const VERIFICADOR = path.join(RAIZ, 'tools', 'ver-etiquetas-qr.js');

/* --------------------------------------------------------------------------
   Guardar, escribir, reemplazar. Rutas relativas al backend, o al frontend si
   se pasan con `front:`.
   -------------------------------------------------------------------------- */

const originales = new Map();

/** Resuelve una ruta de mutacion y se queda con el original la primera vez. */
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
 * FINALES DE LINEA
 *
 * En este proyecto conviven CRLF y LF. Un anclaje de mas de una linea escrito
 * con `\n` no encuentra nada en un archivo CRLF, y la mutacion queda como "no se
 * aplica", que parece otra cosa. Por eso se busca siempre sobre el texto
 * normalizado a LF, y al escribir se devuelve el archivo con el mismo tipo de
 * fin de linea que tenia. Como al final se restaura todo desde una copia del
 * original, el archivo vuelve byte a byte como estaba.
 */
const aLf = (txt) => txt.replace(/\r\n/g, '\n');
const finDeLineaDe = (txt) => (txt.includes('\r\n') ? '\r\n' : '\n');

/**
 * Cambia la primera aparicion de `viejo` por `nuevo`.
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
    for (const [clave, txt] of originales) {
        const esFront = clave.startsWith('front:');
        fs.writeFileSync(path.join(esFront ? FRONT : RAIZ, clave.slice(esFront ? 6 : 5)), txt);
    }
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
    {
        nombre: 'vuelve la ruta publica /e/:codigo',
        porQue: 'es la fuga original: sin sesion, con precio, stock y distribuidor de cualquier codigo. T-tripola tres controles a la vez',
        hacer() {
            reemplazar('server.js',
                '/* ==========================================================================\n   10. MÓDULO: CLIENTES (HISTORIAL Y GESTIÓN)',
                'app.get(\'/e/:codigo\', (req, res) => {\n    res.send(\'ok\');\n});\n\n/* ==========================================================================\n   10. MÓDULO: CLIENTES (HISTORIAL Y GESTIÓN)');
        },
        espera: 'accesible sin sesion'
    },
    {
        nombre: 'la base de datos vuelve a estar escrita a mano',
        porQue: 'era obtenerPool(\'serviceintegralsistema\'): la base de la empresa 1. Con dos empresas, las etiquetas de una se resuelven contra los datos de la otra',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/etiquetas', verificarToken,",
                "app.get('/api/etiquetas', verificarToken, function(){ require('./src/db/tenant').obtenerPool('serviceintegralsistema'); },");
        },
        espera: 'ninguna ruta pide una base de datos por nombre'
    },
    {
        nombre: '/api/etiquetas se queda sin verificarToken',
        porQue: 'cualquiera que abra la pagina de stock veria la lista de que repuestos tienen etiqueta, sin iniciar sesion',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/etiquetas', verificarToken, requiereModulo('etiquetas_qr')",
                "app.get('/api/etiquetas', requiereModulo('etiquetas_qr')");
        },
        espera: 'ninguna ruta de etiqueta queda sin `verificarToken`'
    },
    {
        nombre: 'el listado de etiquetas se queda sin el modulo',
        porQue: 'una empresa que no contrató el modulo veria igual la pantalla, y Peor: se podrian generar etiquetas sin pagar por el modulo',
        hacer() {
            reemplazar('server.js',
                "app.get('/api/etiquetas', verificarToken, requiereModulo('etiquetas_qr')",
                "app.get('/api/etiquetas', verificarToken");
        },
        espera: 'ninguna ruta de etiqueta queda sin `requiereModulo'
    },
    {
        nombre: 'generar etiqueta deja de exigir ADMIN',
        porQue: 'cualquier tecnico podria imprimir y reasignar las etiquetas de cualquier repuesto del taller',
        hacer() {
            reemplazar('server.js',
                "app.post('/api/etiquetas/generar', verificarToken, requiereModulo('etiquetas_qr'), requiereAdmin",
                "app.post('/api/etiquetas/generar', verificarToken, requiereModulo('etiquetas_qr')");
        },
        espera: 'las rutas que escriben etiquetas exigen `requiereAdmin`'
    },
    {
        nombre: 'el QR vuelve a llevar la URL adentro',
        porQue: 'ata la etiqueta a un dominio: en desarrollo seria localhost:3000 y el dia que muden de dominio las etiquetas impresas dejan de servir',
        hacer() {
            reemplazar('server.js',
                "qrSvg = await QRCode.toString(codigo, {",
                "qrSvg = await QRCode.toString(`${req.protocol}://${req.get('host')}/e/${codigo}`, {");
        },
        espera: 'ningun QR se arma con una URL adentro'
    },
    {
        nombre: 'el QR se arma con algo que no es el codigo',
        porQue: 'el escaner valida contra un alfabeto de 12 caracteres: si el QR lleva otra cosa, no se puede leer',
        hacer() {
            reemplazar('server.js',
                'qrSvg = await QRCode.toString(codigo, {',
                'qrSvg = await QRCode.toString(codigoBarrasDelProducto, {');
        },
        espera: 'los QR se arman con el codigo de la etiqueta'
    },
    {
        nombre: 'la respuesta vuelve a exponer url_publica',
        porQue: 'publica el dominio y reapunta al bug de la etiqueta atada al dominio',
        hacer() {
            reemplazar('server.js',
                '            res.json({\n                etiqueta: e,',
                '            res.json({\n                etiqueta: { ...e, url_publica: `/e/${e.codigo}` },');
        },
        espera: 'ninguna respuesta expone `url_publica`'
    },
    {
        nombre: 'el escaner valida contra un alfabeto mas ancho',
        porQue: 'se podrian generar codigos con vocales que despues la propia ruta del escaner rechaza: la etiqueta imprime pero no se lee',
        hacer() {
            reemplazar('server.js',
                'if (!/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{12}$/.test(codigo)) {',
                'if (!/^[A-Z0-9]{12}$/.test(codigo)) {');
        },
        espera: 'se validan con el MISMO alfabeto con el que se generan'
    },
    {
        nombre: 'el escaner valida con otro largo',
        porQue: 'con {8,16} un codigo de 8 caracteres pasaria la validacion y no existiria: la consulta se hace igual contra la base',
        hacer() {
            reemplazar('server.js',
                'if (!/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{12}$/.test(codigo)) {',
                'if (!/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{8,16}$/.test(codigo)) {');
        },
        espera: 'se validan con el mismo largo'
    },
    {
        nombre: 'el escaner deja de validar el formato',
        porQue: 'lo que mande el cliente va derecho al WHERE. Hoy es un "=" que no se rompe con un "%", pero en cuanto alguien lo cambie por un LIKE aparece el agujero',
        hacer() {
            reemplazar('server.js',
                "if (!/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{12}$/.test(codigo)) {\n        return res.status(404).json({ error: 'Código inválido' });\n    }",
                "if (!codigo) {\n        return res.status(404).json({ error: 'Código inválido' });\n    }");
        },
        espera: 'valida el formato del codigo contra un patron anclado'
    },
    {
        nombre: 'la ruta del escaner consulta con un pool suelto',
        porQue: 'el `db` de conContexto tira error si no hay empresa en el contexto. Un pool suelto es exactamente el camino que se acaba de cerrar',
        hacer() {
            reemplazar('server.js',
                "    db.query(\n        `SELECT e.codigo, e.datos_json, e.creado_en, e.activo,",
                "    require('./src/db/tenant').obtenerPool('serviceintegralsistema').query(\n        `SELECT e.codigo, e.datos_json, e.creado_en, e.activo,");
        },
        espera: 'ninguna ruta pide una base de datos por nombre'
    },
    {
        nombre: 'el escaner deja de avisar que el papel esta viejo',
        porQue: 'el que escanea ve el stock del dia que se genero la etiqueta y no se entera de que ya no es el real',
        hacer() {
            reemplazar('server.js',
                "                desactualizada: Number(e.stock) !== Number(datos.stock_actual)\n                    || Number(e.precio) !== Number(datos.precio_venta)",
                '                desactualizada: false');
        },
        espera: 'avisa si el papel no coincide'
    },
    {
        nombre: 'el escaner deja de devolver los datos de hoy',
        porQue: 'solo quedaria el snapshot del papel, que es un numero viejo por definicion',
        hacer() {
            reemplazar('server.js',
                '                producto: {\n                    id: e.producto_id,',
                '                producto: Object.assign({}, {\n                    id: e.producto_id,');
        },
        espera: 'devuelve el snapshot del papel y los datos de hoy'
    },
    {
        nombre: 'vuelve un escapeHtml que no escapa',
        porQue: 'era el bug mas invisible del modulo: .replace(/&/g, \'&\') no cambia nada, asi que un nombre de producto con <script> pasaba de largo. Y tiene la misma forma que un escape que funciona bien',
        hacer() {
            reemplazar('server.js',
                '// 1. LISTAR etiquetas (con/sin QR)',
                'function escapeHtml(s) {\n    if (!s) return \'\';\n    return String(s)\n        .replace(/&/g, \'&\')\n        .replace(/</g, \'<\')\n        .replace(/>/g, \'>\')\n        .replace(/"/g, \'"\');\n}\n\n// 1. LISTAR etiquetas (con/sin QR)');
        },
        espera: 'ningun `.replace()` tiene el mismo patron y el mismo reemplazo'
    },
    {
        nombre: 'un escape roto escrito con \\x26, que a la vista parece correcto',
        porQue: 'en JavaScript \'\x26\' es "&", asi que .replace(/&/g, \'\x26\') no escapa nada. Escrito asi el codigo parece un escape bien hecho — el &amp; esta ahi, escondido detras de una barra y un 26 — y solo se ve comparando lo que el motor produce de verdad',
        hacer() {
            reemplazar('front:app.js', ".replace(/&/g, '&amp;')", ".replace(/&/g, '\\x26')");
        },
        espera: 'ningun `.replace()` tiene el mismo patron y el mismo reemplazo'
    },
    {
        nombre: 'contextoActual() deja de tirar error',
        porQue: 'es la ultima barrera: si algo consulta sin empresa en el contexto, tiene que fallar en vez de pegarle a la base de cualquiera',
        hacer() {
            reemplazar('src/db/tenant.js',
                "    if (!ctx) {\n        throw new Error(",
                "    if (!ctx) {\n        return null;\n        throw new Error(");
        },
        espera: 'cuando no hay empresa en el contexto, `contextoActual()` tira error de verdad'
    },
    {
        nombre: 'generar etiqueta deja de ser un upsert',
        porQue: 'sin ON DUPLICATE KEY el segundo intento para el mismo producto revienta el indice UNIQUE, o si se cambia el esquema, deja dos etiquetas activas del mismo repuesto',
        hacer() {
            reemplazar('server.js',
                "             ON DUPLICATE KEY UPDATE codigo = VALUES(codigo), datos_json = VALUES(datos_json), activo = 1, actualizado_en = NOW()`,",
                '             `,');
        },
        espera: 'generar etiqueta hace upsert'
    },
    {
        nombre: 'la migracion pierde el indice UNIQUE del codigo',
        porQue: 'sin el, dos etiquetas de dos empresas distintas pueden tener el mismo codigo y cualquier consulta por codigo sin empresa se vuelve ambigua',
        hacer() {
            reemplazar('migrations/tenant/005_etiquetas_qr.sql',
                '    UNIQUE KEY `uq_eq_codigo` (`codigo`),',
                '    KEY `uq_eq_codigo` (`codigo`),');
        },
        espera: 'el codigo tiene indice UNIQUE'
    },
    {
        nombre: 'la migracion pierde el UNIQUE del producto',
        porQue: 'sin el, un repuesto puede tener varias etiquetas activas y al escanear una no se sabe cual es la buena',
        hacer() {
            reemplazar('migrations/tenant/005_etiquetas_qr.sql',
                '    UNIQUE KEY `uq_eq_producto` (`producto_id`),',
                '    KEY `uq_eq_producto` (`producto_id`),');
        },
        espera: 'una etiqueta viva por repuesto'
    },
    {
        nombre: 'aparece una ruta de etiqueta nueva sin el modulo',
        porQue: 'es como entraria el bug que casi paso: la ruta nueva queda sin el guardia y el verificador tiene que delatarla sola',
        hacer() {
            reemplazar('server.js',
                '// 1. LISTAR etiquetas (con/sin QR)',
                "app.get('/api/etiquetas/mias', verificarToken, (req, res) => res.json([]));\n\n// 1. LISTAR etiquetas (con/sin QR)");
        },
        espera: 'ninguna ruta de etiqueta queda sin `requiereModulo'
    },
    {
        nombre: 'la ruta del escaner pide una columna que la tabla no tiene',
        porQue: 'ES EL FALLO REAL QUE ENCONTRO ESTA SECCION: la ruta pedia p.ubicacion y productos no tiene esa columna. Con los cuatro guardias puestos, el modulo, sin base escrita a mano y el QR del codigo solo, las secciones 1 a 5 daban todas OK — y el escaner devolvia 500 en todas las consultas. Compila, no viola ninguna regla de rutas, y solo se entera MySQL cuando alguien escanea',
        hacer() {
            reemplazar('server.js',
                'p.stock, p.stockMinimo, p.distribuidor, p.precio, p.categoria,',
                'p.stock, p.stockMinimo, p.distribuidor, p.precio, p.ubicacion,');
        },
        espera: 'toda columna que leen las rutas de etiqueta existe en el esquema'
    },
    {
        nombre: 'el dump del esquema deja de listar la tabla de etiquetas',
        porQue: 'deriva realista: schema-actual.sql se regenera a mano y alguien lo edito, o el dump se coroto. Entonces columnasDe devuelve null y TODAS las columnas de esa tabla dejan de tener contra que compararse: el control de columnas deja de mirar justo esa tabla y da verde sin decir nada',
        hacer() {
            reemplazar('schema/schema-actual.sql',
                'CREATE TABLE `etiquetas_qr` (',
                'CREATE TABLE `etiquetas_qr_vieja` (');
        },
        espera: 'toda columna que leen las rutas de etiqueta existe en el esquema'
},

    /* ======================================================================
       Las mutaciones de la SECCION 8, la de la pantalla.

       Estas importan mas que las del servidor por una razon: la pantalla es lo
       unico que ve el usuario, y casi ninguno de sus fallos se ven desde
       atras. El servidor puede devolver 200 con la columna corrida y el listado
       se ve "raro"; la hoja de impresion puede imprimir gris y el QR no lo lee
       nadie hasta que el cliente lo complains.

       Y hay una que sale de un error real de esta sesion: la columna "Imp."
       estaba primera en el encabezado y septima en el cuerpo. Ocho celdas
       contra ocho encabezados, la cantidad daba bien, y la tabla estaba corrida
       una columna entera. Las dos primeras mutaciones de abajo ponen eso de
       nuevo, y el control de orden tiene que verlo.
       ====================================================================== */
    {
        nombre: 'la tabla: el marcado para imprimir vuelve a la septima celda',
        porQue: 'ES EL ERROR REAL. La columna "Imp." queda primera en el encabezado y septima en el cuerpo. La cantidad de celdas sigue siendo 8 y cualquier control que solo cuente da verde; el listado muestra el nombre del producto debajo de "Imp." y el precio debajo de "Stock"',
        hacer() {
            reemplazar('front:etiquetas.js',
                'return `<tr>\n            <td data-col="imp" style="text-align:center;">${casilla}</td>\n            <td data-col="producto">${escapeHtml(f.nombre)}</td>',
                'return `<tr>\n            <td data-col="producto">${escapeHtml(f.nombre)}</td>\n            <td data-col="imp" style="text-align:center;">${casilla}</td>');
        },
        espera: 'el encabezado y el cuerpo tienen las columnas en el mismo orden'
    },
    {
        nombre: 'la tabla: una columna del encabezado cambia de nombre',
        porQue: 'deriva realista: se renombra el encabezado a "Precio de venta" y no se actualiza el `data-col` del cuerpo. El nombre queda en un lado solo y el control de orden tiene que avisar cual',
        hacer() {
            reemplazar('front:etiquetas.html',
                '<th data-col="precio" style="text-align: right;">Precio</th>',
                '<th data-col="precio_venta" style="text-align: right;">Precio de venta</th>');
        },
        espera: 'el encabezado y el cuerpo tienen las columnas en el mismo orden'
    },
    {
        nombre: 'la tabla: dos celdas se llaman igual',
        porQue: 'copiar y pegar una columna sin cambiarle el `data-col`. Las dos listas siguen teniendo la misma cantidad y el mismo conjunto, asi que comparar conjuntos daria verde; solo la comparacion en orden lo ve',
        hacer() {
            reemplazar('front:etiquetas.js',
                '<td data-col="stock" style="text-align:right;">${eO(f.stock)}</td>',
                '<td data-col="precio" style="text-align:right;">${eO(f.stock)}</td>');
        },
        espera: 'ninguna columna tiene el mismo nombre dos veces'
    },
    {
        nombre: 'la tabla: el encabezado crece y las filas de aviso no',
        porQue: 'se agrega una columna al encabezado y no se actualiza el `colspan` de "Cargando productos". Mientras carga se ve media tabla descolgada, y cuando el filtro no encuentra nada el texto queda angosto en una tabla ancha',
        hacer() {
            reemplazar('front:etiquetas.html',
                '<tr><td colspan="8" style="text-align:center;">Cargando productos…</td></tr>',
                '<tr><td colspan="7" style="text-align:center;">Cargando productos…</td></tr>');
        },
        espera: 'las filas de aviso cubren las 8 columnas'
    },
    {
        nombre: 'el nombre del producto deja de escaparse',
        porQue: 'lo que reporta el usuario de un nombre con `<b>` o con un `<img onerror>`: se pinta como HTML. El nombre lo escribe cualquiera que carga un producto, y se ve en la pantalla de todos los que abran el listado. El nombre de producto es el campo mas Atari de la base de una empresa de repuestos',
        hacer() {
            reemplazar('front:etiquetas.js',
                '<td data-col="producto">${escapeHtml(f.nombre)}</td>',
                '<td data-col="producto">${f.nombre}</td>');
        },
        espera: 'escapan el dato del servidor'
    },
    {
        nombre: 'el distribuidor deja de escaparse',
        porQue: 'el mismo agujero por otro camino: cambiar el nombre de producto lo tapa y el de distribuidor sigue abierto. Un control que mirara uno solo de los dos no serviria',
        hacer() {
            reemplazar('front:etiquetas.js',
                '<td data-col="distribuidor">${eO(f.distribuidor)}</td>',
                '<td data-col="distribuidor">${f.distribuidor}</td>');
        },
        espera: 'escapan el dato del servidor'
    },
    {
        nombre: 'el nombre del producto de la etiqueta deja de escaparse',
        porQue: 'el listado y la hoja de impresion arman HTML en funciones distintas. Arreglar el listado y dejar la hoja sin escapar deja el agujero en el papel, que es donde el nombre se lo lleva el cliente',
        hacer() {
            reemplazar('front:etiquetas.js',
                '<div class="e-etiqueta-nombre">${escapeHtml(f.nombre)}</div>',
                '<div class="e-etiqueta-nombre">${f.nombre}</div>');
        },
        espera: 'escapan el dato del servidor'
    },
    {
        nombre: 'la imagen del QR se pide como ruta de API',
        porQue: 'es lo que hace el reflejo de cualquiera que ya vio las otras imagenes del sistema, que van por URL. Un `<img>` no puede mandar el encabezado Authorization, asi que sale en 401: en la pantalla un cuadrito roto y en el papel un sticker vacio. Y el control tiene que verlo antes de imprimir 300 etiquetas',
        hacer() {
            reemplazar('front:etiquetas.js',
                '? `<img class="e-etiqueta-qr" src="${dataUrl}" alt="Código QR de ${escapeHtml(f.nombre)}">`',
                '? `<img class="e-etiqueta-qr" src="/api/etiquetas/${f.etiqueta_id}/qr.png" alt="Código QR">`');
        },
        espera: 'la imagen del QR no se pide como ruta de API'
    },
    {
        nombre: 'se saca el contraste del data URL',
        porQue: 'el valor va adentro de un `src="..."` armado con innerHTML. Sin el patron, un data:text/html del servidor cierra el atributo antes de tiempo y lo que sigue se ejecuta. Hoy el servidor genera el base64 y no hay por que desconfiar: el control esta para el dia en que eso cambie y nadie mire',
        hacer() {
            reemplazar('front:etiquetas.js',
                "if (typeof url !== 'string' || !DATA_URL_DE_IMAGEN.test(url)) return null;\n    return url;",
                'return url;');
        },
        espera: 'el QR del servidor se contrasta contra ese patron'
    },
    {
        nombre: 'al imprimir se saca print-color-adjust',
        porQue: 'el fallo mas caro y el mas invisible: la hoja se ve perfecta en la pantalla y sale gris en la impresora del cliente. El QR es negro sobre blanco, sobre un fondo que se imprimio oscuro no lo lee nadie. Y el que lo ve es el usuario final, semanas despues',
        hacer() {
            reemplazar('front:etiquetas.css',
                '        print-color-adjust: exact;\n        -webkit-print-color-adjust: exact;\n',
                '');
        },
        espera: 'se respeta el color pedido'
    },
    {
        nombre: 'al imprimir queda el filtro de la pantalla',
        porQue: 'con el filtro puesto se imprime la barra de busqueda y el boton de generar encima del papel. Se evita tapando una entrada por una, que es como se hacia antes: el listado tiene ocho y con el filtro aparecen mas',
        hacer() {
            reemplazar('front:etiquetas.css',
                '    body > *:not(#e-imp-area) { display: none !important; }',
                '    .seccion-busqueda { display: none !important; }\n    .panel-tabla { display: none !important; }');
        },
        espera: 'se apaga todo menos el area de etiquetas'
    },
    {
        nombre: 'la etiqueta sale en el color del tema',
        porQue: 'el papel deja de ser blanco. Es tentador porque en la pantalla asi se ve "integrada", y es exactamente el error: la variable de color del tema no existe en una impresora laser comun, y el QR necesita blanco puro alrededor para que el lector no falle',
        hacer() {
            reemplazar('front:etiquetas.css',
                '        background: #fff !important;\n        color: #000 !important;',
                '        background: transparent !important;\n        color: inherit !important;');
        },
        espera: 'el fondo de la pagina es blanco'
    },
    {
        nombre: 'solo la tarjeta de la etiqueta sale en el color del tema',
        porQue: 'el hermano del anterior, y el que importa mas: el fondo de la pagina es blanco pero el rectangulo de cada etiqueta conserva el color del tema. El control anterior se libraba porque buscaba "#fff en algun lado" y la pagina lo tenia; este tiene que mirar la tarjeta sola, y hay una mutacion por cada una de las dos mitades',
        hacer() {
            reemplazar('front:etiquetas.css',
                '        border: 1px solid #000 !important;\n        background: #fff !important;\n        color: #000 !important;',
                '        border: 1px solid currentColor !important;\n        background: transparent !important;\n        color: inherit !important;');
        },
        espera: 'la tarjeta de la etiqueta es blanca con texto negro'
    },
{
        nombre: 'la hoja en pantalla se pone un color fijo',
        porQue: 'el error al reves del anterior: un `#fff` en el CSS de la etiqueta FUERA de `@media print` queda bien en el tema oscuro y es INVISIBLE en el claro, o al reves. Los dos lados del CSS estan revisados, y por eso el control mira la parte de pantalla y la de impresion por separado',
        hacer() {
            reemplazar('front:etiquetas.css',
                '    color: var(--text-main);\n    overflow-wrap: anywhere;',
                '    color: #1a1d20;\n    background: #f4f7f6;\n    overflow-wrap: anywhere;');
        },
        espera: 'la hoja en pantalla no tiene colores fijos'
    },
    {
        nombre: 'la grilla de etiquetas fija la cantidad de columnas',
        porQue: 'con cuatro columnas fijas, en una hoja angosta la cuarta etiqueta se imprime cortada al borde y el QR se parte: media imagen no se lee. Con `auto-fill` lo que se acomoda al papel es la grilla, no la etiqueta',
        hacer() {
            reemplazar('front:etiquetas.css',
                'grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));',
                'grid-template-columns: repeat(4, 1fr);');
        },
        espera: 'ninguna grilla de la hoja fija la cantidad de columnas'
    },
    {
        nombre: 'una etiqueta se puede partir entre dos hojas',
        porQue: 'sin `break-inside: avoid` el corte cae donde le toque: el nombre queda en una hoja y el QR en la siguiente. Es peor que una etiqueta fea: es un papel que no sirve y no se nota hasta que se quiere escanear',
        hacer() {
            reemplazar('front:etiquetas.css',
                '    break-inside: avoid;\n    page-break-inside: avoid;\n',
                '');
        },
        espera: 'una etiqueta no se parte entre dos hojas'
    },
    {
        nombre: 'la barra de imprimir deja de llevar `no-imprimir`',
        porQue: 'la hoja es un SECTION del documento, no un modal: para imprimir tiene que estar en la pagina. Sin `no-imprimir` en la barra, "Imprimir" y "Cerrar" salen en el papel del cliente',
        hacer() {
            reemplazar('front:etiquetas.html',
                '<div class="e-imp-barra no-imprimir">',
                '<div class="e-imp-barra">');
        },
        espera: 'la barra de botones de imprimir lleva `no-imprimir`'
    },
    {
        nombre: 'el JS busca un id que el HTML no tiene',
        porQue: 'sin avisar: `getElementById` devuelve null y `addEventListener` sobre null tira. Y como todos los listeners estan en un solo `DOMContentLoaded`, se cae el que estaba despues tambien: la pagina queda sin busqueda, sin generar y sin imprimir, y la consola muestra un error que nadie lee',
        hacer() {
            reemplazar('front:etiquetas.js',
                "document.getElementById('filtro-qr').addEventListener",
                "document.getElementById('filtro-estado').addEventListener");
        },
        espera: 'todo id que busca el JS existe en el HTML'
    }
];

/* -------------------------------------------------------------------------- */

console.log('='.repeat(74));
console.log('  MUTACIONES DE ver-etiquetas-qr.js');
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
        const lineaDelFallo = r.salida.split('\n').find(l => l.includes(m.espera) && l.trim().startsWith('FALLO'));
        if (lineaDelFallo) {
            console.log(`        BIEN detectado: ${lineaDelFallo.trim()}`);
        } else {
            console.log(`        MAL  fallo, pero no por el control roto. Se esperaba un FALLO con "${m.espera}"`);
            const fallas = r.salida.split('\n').filter(l => l.trim().startsWith('FALLO'));
            fallas.forEach(f => console.log(`             ${f.trim()}`));
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
