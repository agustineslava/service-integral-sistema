/* ==========================================================================
   MUTACIONES: ver-estilo-y-tema.js
   --------------------------------------------------------------------------
   Un verificador que dice "todo bien" sin que se le pueda romper el codigo no
   sirve: pasa siempre, no sirve para nada. Este archivo rompe el codigo a
   proposito, una cosa por vez, corre el verificador, y exige que el fallo que
   aparece sea el del control que se rompio. Despues deja todo como estaba.

   Cada mutacion devuelve EXACTAMENTE un fallo, y el texto del fallo tiene que
   contener el nombre del control roto. Si una mutacion no rompe nada, o rompe
   algo que no era, el archivo lo dice y sale con codigo de error.

   Uso:  node tools/mutar-estilo-y-tema.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FRONT = path.join(__dirname, '..', '..', 'frontend');
const VERIFICADOR = path.join(__dirname, 'ver-estilo-y-tema.js');

/* -------------------------------------------------------------------------- */

const originales = new Map();

/** Se queda con el texto original de un archivo, la primera vez. */
function guardar(nombre) {
    if (!originales.has(nombre)) {
        originales.set(nombre, fs.readFileSync(path.join(FRONT, nombre), 'utf8'));
    }
}

/** Escribe un archivo del frontend. */
function escribir(nombre, txt) {
    guardar(nombre);
    fs.writeFileSync(path.join(FRONT, nombre), txt);
}

/*
 * FINALES DE LINEA
 *
 * En este proyecto conviven los dos: `style.css` esta con CRLF y el resto con
 * LF. Un anclaje de mas de una linea escrito con `\n` no encuentra nada en un
 * archivo CRLF, y la mutacion queda como "no se aplica", que parece otra cosa.
 *
 * Por eso aca se busca siempre sobre el texto normalizado a LF, y al escribir
 * se devuelve el archivo con el mismo tipo de fin de linea que tenia. Como al
 * final se restaura todo desde una copia del original, el archivo vuelve
 * byte a byte como estaba.
 */
const aLf = (txt) => txt.replace(/\r\n/g, '\n');
const finDeLineaDe = (txt) => (txt.includes('\r\n') ? '\r\n' : '\n');

/**
 * Cambia la primera aparicion de `viejo` por `nuevo`.
 * Si `viejo` no aparece, tira: una mutacion que no se aplica no prueba nada.
 */
function reemplazar(nombre, viejo, nuevo) {
    const ruta = path.join(FRONT, nombre);
    const original = fs.readFileSync(ruta, 'utf8');
    const eol = finDeLineaDe(original);
    const norm = aLf(original);
    const v = aLf(viejo);
    if (!norm.includes(v)) {
        throw new Error(`la mutacion no se puede aplicar: "${nombre}" no contiene\n    ${viejo}`);
    }
    escribir(nombre, norm.replace(v, aLf(nuevo)).replace(/\n/g, eol));
}

/**
 * Saca una regla entera, desde su selector hasta la llave de cierre que le
 * corresponde. Se usa para borrar un bloque de tema sin tener que escribir
 * todo su contenido en el anclaje.
 */
function quitarRegla(nombre, selector) {
    const ruta = path.join(FRONT, nombre);
    const original = fs.readFileSync(ruta, 'utf8');
    const eol = finDeLineaDe(original);
    const norm = aLf(original);
    const desde = norm.indexOf(selector + ' {');
    if (desde === -1) throw new Error(`no se encuentra la regla "${selector}" en ${nombre}`);
    let nivel = 0;
    let hasta = -1;
    for (let i = norm.indexOf('{', desde); i < norm.length; i++) {
        if (norm[i] === '{') nivel++;
        else if (norm[i] === '}') {
            nivel--;
            if (nivel === 0) { hasta = i + 1; break; }
        }
    }
    if (hasta === -1) throw new Error(`la regla "${selector}" de ${nombre} no cierra`);
    escribir(nombre, (norm.slice(0, desde) + norm.slice(hasta)).replace(/\n/g, eol));
}

/** Deja un archivo como estaba. */
function restaurarTodo() {
    for (const [nombre, txt] of originales) {
        fs.writeFileSync(path.join(FRONT, nombre), txt);
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
   --------------------------------------------------------------------------
   `espera` es un pedazo del texto del FALLO que tiene que aparecer. Si el
   verificador falla por otra cosa, la mutacion no esta probando lo que dice
   estar probando.
   -------------------------------------------------------------------------- */

const MUTACIONES = [
    {
        nombre: 'la regla global de campos vuelve a ser una lista de tipos',
        porQue: 'es el bug original: faltaban tel, url y date, y se caian al estilo del navegador',
        hacer() {
            reemplazar('style.css',
                'input:not([type="checkbox"], [type="radio"], [type="file"], [type="color"],\n         [type="range"], [type="hidden"], [type="submit"], [type="button"],\n         [type="reset"], [type="image"]),',
                'input[type="text"],\ninput[type="number"],\ninput[type="email"],\ninput[type="password"],');
        },
        espera: 'la regla global de campos usa'
    },
    {
        nombre: 'la regla de foco vuelve a ser una lista de tipos',
        porQue: 'los campos nuevos no tomarian el aro de foco',
        hacer() {
            reemplazar('style.css', 'input:focus,\nselect:focus,', 'input[type="text"]:focus,\ninput[type="number"]:focus,\nselect:focus,');
        },
        espera: 'la regla de foco es'
    },
    {
        nombre: 'se saca el bloque html.tema-oscuro',
        porQue: 'elegir el tema oscuro no cambiaria NINGUNA variable: es el bug que reporto el usuario',
        hacer() {
            quitarRegla('style.css', 'html.tema-oscuro');
        },
        espera: 'existe el bloque `html.tema-oscuro`'
    },
    {
        nombre: 'al tema oscuro le falta --text-main',
        porQue: 'en una PC en modo claro, --text-main se iria a buscar al @media y el tema oscuro quedaria con texto oscuro sobre fondo oscuro',
        hacer() {
            /* El anclaje arranca en `html.tema-oscuro` a proposito: la misma
               linea existe en el `:root` de arriba, y reemplazar la primera
               habria roto el oscuro por defecto en vez del bloque del tema. */
            reemplazar('style.css',
                'html.tema-oscuro {\n    color-scheme: dark;\n    --bg-body: #1a1d20;\n    --bg-card: #24282c;\n    --bg-preview: #121416;\n    --border-color: #343a40;\n    --text-main: #f8f9fa;',
                'html.tema-oscuro {\n    color-scheme: dark;\n    --bg-body: #1a1d20;\n    --bg-card: #24282c;\n    --bg-preview: #121416;\n    --border-color: #343a40;');
        },
        espera: 'el tema oscuro pisa las'
    },
    {
        nombre: 'al tema claro le falta --color-warning',
        porQue: 'el contador de usuarios del plan saldria del color del tema oscuro sobre fondo blanco',
        hacer() {
            reemplazar('style.css',
                'html.tema-claro {\n    color-scheme: light;\n    --bg-body: #f4f7f6;\n    --bg-card: #ffffff;\n    --bg-preview: #f1f3f5;\n    --border-color: #dee2e6;\n    --text-main: #2d3134;\n    --text-muted: #6c757d;\n    --color-alerta-bg: #fff3cd;\n    --color-warning: #8a6d00;',
                'html.tema-claro {\n    color-scheme: light;\n    --bg-body: #f4f7f6;\n    --bg-card: #ffffff;\n    --bg-preview: #f1f3f5;\n    --border-color: #dee2e6;\n    --text-main: #2d3134;\n    --text-muted: #6c757d;\n    --color-alerta-bg: #fff3cd;');
        },
        espera: 'el tema claro declara las mismas variables'
    },
    {
        nombre: 'vuelve un selector body.tema-claro',
        porQue: 'la clase esta en <html>; un selector de <body> ya no la encuentra',
        hacer() {
            reemplazar('style.css', 'html.tema-oscuro .fila-alerta-critica {', 'body:not(.tema-claro) .fila-alerta-critica {');
        },
        espera: 'ningun selector de tema usa `body.tema-claro`'
    },
    {
        nombre: 'vuelve una copia del tema en presupuestos.js',
        porQue: 'es lo que pasaba: presupuestos.html ignoraba la preferencia guardada',
        hacer() {
            reemplazar('presupuestos.js', 'function dibujarListado(lista) {',
                "document.addEventListener('DOMContentLoaded', () => {\n    if (localStorage.getItem('tema-preferido') === 'claro') document.body.classList.add('tema-claro');\n});\n\nfunction dibujarListado(lista) {");
        },
        espera: 'ningún script de pantalla pone la clase del tema'
    },
    {
        nombre: 'la clave tema-preferido se toca tambien en otro archivo',
        porQue: 'si los dos la escriben distinto, uno deja de guardarse',
        hacer() {
            reemplazar('presupuestos.js', 'const a2 = (n) =>', "localStorage.setItem('tema-preferido', 'claro');\nconst a2 = (n) =>");
        },
        espera: 'la clave `tema-preferido` se toca solo en'
    },
    {
        nombre: 'auth-check.js deja de escuchar el evento storage',
        porQue: 'cambiar el tema en una pestana no moveria la de al lado',
        hacer() {
            reemplazar('auth-check.js', "window.addEventListener('storage', (ev) => {\n        if (ev.key === CLAVE || ev.key === null) aplicarTema();\n    });", '');
        },
        espera: 'escucha el evento `storage`'
    },
    {
        nombre: 'auth-check.js deja de seguir al tema del sistema operativo',
        porQue: 'cambiar la PC de claro a oscuro con la pagina abierta no la moveria',
        hacer() {
            reemplazar('auth-check.js', 'prefers-color-scheme: light', 'prefers-color-scheme: noexiste');
        },
        espera: 'sigue al tema del sistema operativo'
    },
    {
        nombre: 'auth-check.js deja de poner una de las dos clases',
        porQue: 'hay reglas que son solo del tema oscuro y necesitan que la clase este',
        hacer() {
            reemplazar('auth-check.js', "raiz.classList.toggle('tema-oscuro', tema === 'oscuro');", '');
        },
        espera: 'pone `tema-oscuro` con `classList.toggle`'
    },
    {
        nombre: 'auth-check.js se carga al final del <body> en una pagina',
        porQue: 'el tema se aplicaria tarde y se veria el del sistema un instante antes de corregirlo',
        hacer() {
            /* Va adentro del `<body>`, no despues del `</head>`: despues del
               `</head>` pero antes del `<body>` sigue siendo la cabeza, y el
               tema se aplicaria igual de temprano. Lo que rompe de verdad es
               cargarlo al final del cuerpo, que es donde estaban los scripts de
               cada pantalla que aplicaban el tema por su cuenta. */
            const ruta = path.join(FRONT, 'presupuestos.html');
            const original = fs.readFileSync(ruta, 'utf8');
            const eol = finDeLineaDe(original);
            const norm = aLf(original);
            /* El `?v=` NO va escrito en el ancla. Los assets se versionan (hoy
             * 2.5) y el numero sube con cada tanda de cambios de apariencia. Si
             * queda aca, el proximo `?v=2.6` rompe esta mutacion y el sintoma
             * parece "el arnes se rompio", cuando lo unico que cambio fue el
             * numero de cache. Ya paso: el ancla decia 2.4 y quedo vieja. */
            const linea = /<script src="auth-check\.js\?v=[0-9.]+"><\/script>\n/;
            if (!linea.test(norm)) throw new Error('no se encuentra el <script> de auth-check.js en el <head> de presupuestos.html');
            if (!norm.includes('</body>')) throw new Error('no se encuentra </body> en presupuestos.html');
            escribir('presupuestos.html', norm.replace(linea, '').replace('</body>', '<script src="auth-check.js?v=0"></script>\n</body>').replace(/\n/g, eol));
        },
        espera: 'carga auth-check.js en el <head>'
    },
    {
        nombre: 'admin.js vuelve a mover el icono con estilos en linea',
        porQue: 'era lo que hacia: el icono quedaba al reves del de las otras cinco paginas',
        hacer() {
            reemplazar('admin.js', '    envolverCamposColor();', '    ajustarIconoTema();\n    envolverCamposColor();');
        },
        espera: 'admin.js ya no mueve el ícono'
    },
    {
        nombre: 'vuelve --text-secondary valiendo negro',
        porQue: 'es el bug del documento y el telefono en negro sobre fondo oscuro',
        hacer() {
            reemplazar('style.css', '    --text-muted: #adb5bd;        /* Texto secundario o descriptivo en gris claro */', '    --text-muted: #adb5bd;\n    --text-secondary: #000000;');
            reemplazar('presupuestos.css', 'color: var(--text-muted);\n    font-size: 0.78rem;', 'color: var(--text-secondary, #777);\n    font-size: 0.78rem;');
        },
        espera: '`--text-secondary` no se'
    },
    {
        nombre: 'presupuestos.css vuelve a un color fijo en vez de una variable',
        porQue: 'un color fijo no cambia con el tema: es como se veía negro sobre el fondo oscuro',
        hacer() {
            reemplazar('presupuestos.css', '.p-vacio {\n    text-align: center;\n    padding: 26px 10px;\n    color: var(--text-muted);',
                '.p-vacio {\n    text-align: center;\n    padding: 26px 10px;\n    color: #777;');
        },
        espera: 'el aviso de lista vacia se pinta con'
    },
    {
        nombre: 'el documento del listado vuelve a un color fijo',
        porQue: 'era el negro que el usuario veia en el listado de presupuestos',
        hacer() {
            reemplazar('presupuestos.js', '<small style="color:var(--text-muted)">', '<small style="color:#777">');
        },
        espera: 'el documento del cliente del listado se pinta con'
    },
    {
        nombre: 'se usa una variable que no esta definida en ningun lado',
        porQue: 'el valor de respaldo se ve en pantalla y el color no cambia con el tema',
        hacer() {
            reemplazar('presupuestos.css', '.p-vacio {\n    text-align: center;', '.p-vacio {\n    color: var(--no-existe, #777);\n    text-align: center;');
        },
        espera: 'existen en algun lado'
    },
    {
        nombre: 'el contador de usuarios vuelve al dorado fijo',
        porQue: 'en tema claro el dorado sobre blanco no se lee',
        hacer() {
            reemplazar('auth-check.js', "contador.style.color = 'var(--color-warning)';", "contador.style.color = 'var(--color-warning, #b8860b)';");
        },
        espera: 'no se apoya en un dorado fijo'
    },
    {
        nombre: 'el boton "Ver" del listado le saca btn-info',
        porQue: '.btn-tabla sola no tiene fondo: salia gris con texto blanco',
        hacer() {
            reemplazar('presupuestos.js', 'class="btn-tabla btn-info" onclick="abrirDetalle(', 'class="btn-tabla" onclick="abrirDetalle(');
        },
        espera: 'el botón "Ver" del listado lleva `btn-info`'
    },
    {
        nombre: 'la celda de los items vuelve a pintar fondo',
        porQue: 'la barra asomaba por debajo de los inputs: el recuadro partido',
        hacer() {
            reemplazar('presupuestos.css', '    padding: 0 10px;\n    vertical-align: middle;\n    border: none;\n    background: none;', '    padding: 0 10px;\n    vertical-align: middle;\n    border: none;\n    background-color: var(--bg-body);');
        },
        espera: 'no pinta un fondo de verdad'
    },
    {
        nombre: 'la celda de los items vuelve al padding corrido',
        porQue: 'los inputs arrancaban corridos con los rotulos de su columna',
        hacer() {
            reemplazar('presupuestos.css', '.p-tabla-items tbody td {\n    /*\n     * El padding tiene que ser el mismo', '.p-tabla-items tbody td {\n    padding: 0 !;\n    /*\n     * El padding tiene que ser el mismo');
        },
        espera: 'la celda y el encabezado tienen el mismo padding'
    },
    {
        nombre: 'el subtotal deja de alinearse con su columna',
        porQue: 'el monto terminaba 4px corrido con respecto del rotulo',
        hacer() {
            reemplazar('presupuestos.css', '    padding-right: 10px;\n    font-size: 0.9rem;\n}', '    padding-right: 6px;\n    font-size: 0.9rem;\n}');
        },
        espera: 'el subtotal se alinea con la derecha'
    }
];

/* -------------------------------------------------------------------------- */

console.log('='.repeat(74));
console.log('  MUTACIONES DE ver-estilo-y-tema.js');
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
        console.log(`        MAL  la mutacion no se pudo aplicar`);
        console.log(`             ${error.split('\n').join('\n             ')}`);
        malas++;
        continue;
    }

    const r = correrVerificador();

    if (r.codigo === 0) {
        console.log('        MAL  el verificador PASÓ con el codigo roto (no tiene dientes)');
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

if (final.codigo === 0) {
    console.log('\nCodigo restaurado y verificador en verde.\n');
}

if (malas > 0) {
    console.log(`\n${malas} mutaciones NO fueron detectadas.\n`);
    process.exit(1);
}

console.log('Todas las mutaciones fueron detectadas.\n');
