#!/usr/bin/env node
/**
 * DATOS DE MARCA Y CONTACTO DE UNA EMPRESA
 * ---------------------------------------------------------------------------
 *   node tools/datos-empresa.js                     ver todas
 *   node tools/datos-empresa.js <slug>              ver una
 *   node tools/datos-empresa.js <slug> --sembrar    copiar el .env a la central
 *   node tools/datos-empresa.js <slug> <campo> <valor>   cambiar un campo
 *
 * POR QUE EXISTE
 * La marca de cada empresa (nombre, logo, colores) y sus datos de contacto
 * (telefono, email, direccion, cuit) viven en la fila de `empresas` de la
 * base CENTRAL. Salen impresos en los presupuestos, y antes de esta fase la
 * unica fuente de marca eran las variables de entorno del servidor, o sea que
 * todas las empresas compartian el mismo logo.
 *
 * Sin esta herramienta, poner el telefono de un cliente es escribir SQL a mano,
 * y un `UPDATE` mal escrito es un cliente con el logo de otro.
 *
 * `--sembrar` copia COMERCIO_NOMBRE / _SUBTITULO / _LOGO del `.env` a la fila
 * de la empresa. Sirve para la primera vez: lo que el taller ya tenia escrito
 * a mano queda escrito donde corresponde, y despues se edita con esta misma
 * herramienta. No pisa un campo que ya este cargado, salvo que se le pase
 * `--forzar`.
 *
 * Un valor vacio (`""`) se guarda como NULL, no como texto vacio: una celda
 * vacia y un NULL no se comportan igual en los comprobantes.
 *
 * Tarda hasta 30 SEGUNDOS en hacerse efectivo: el servidor guarda la empresa en
 * memoria ese tiempo. Para que sea al instante: `pm2 restart service-integral-backend`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const central = require('../src/db/central');

/** Lo que se puede cambiar, con el largo maximo de la columna. */
const CAMPOS = {
    nombre: 150,
    subtitulo: 120,
    logo_url: 500,
    color_primario: 7,
    color_secundario: 7,
    telefono: 50,
    email_contacto: 150,
    direccion: 255,
    cuit: 20
};

/** El nombre y el slug son identificadores: no se cambian por acá. */
const SOLO_LECTURA = new Set(['id', 'slug', 'nombre_db', 'plan', 'rubro', 'estado']);

const ETIQUETAS = {
    nombre: 'Nombre',
    subtitulo: 'Subtitulo',
    logo_url: 'Logo (ruta o URL)',
    color_primario: 'Color primario',
    color_secundario: 'Color secundario',
    telefono: 'Telefono',
    email_contacto: 'Email de contacto',
    direccion: 'Direccion',
    cuit: 'CUIT'
};

function colorONulo(v) {
    if (v === null || v === undefined || v === '') return 'sin cargar';
    return v;
}

/** Revisa un color antes de guardarlo: un color roto rompe la pantalla. */
function problemaEnColor(nombreCampo, valor) {
    if (valor === null || valor === '') return null;
    const v = String(valor).trim();
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
        return `"${valor}" no es un color. Va #RRGGBB (por ejemplo #1a4d8f) o #RGB.`;
    }
    return null;
}

async function verTodas() {
    const filas = await central.query(
        `SELECT e.id, e.slug, e.nombre, e.subtitulo, e.logo_url, e.color_primario,
                e.color_secundario, e.telefono, e.email_contacto, e.direccion, e.cuit
           FROM empresas e ORDER BY e.id`
    );

    console.log('');
    console.log(' estos campos salen impresos en presupuestos, ordenes y comprobantes.');
    console.log(' ( ) = sin cargar, que es lo que sale impreso como hueco.');
    console.log('');
    for (const f of filas) {
        console.log(` ${f.slug}  (#${f.id})`);
        console.log(`   nombre     ${f.nombre}`);
        for (const campo of ['subtitulo', 'logo_url', 'color_primario', 'color_secundario',
            'telefono', 'email_contacto', 'direccion', 'cuit']) {
            const v = colorONulo(f[campo]);
            const marca = v === 'sin cargar' ? '( )' : ' ok ';
            console.log(`   ${marca} ${ETIQUETAS[campo].padEnd(18)} ${v}`);
        }
        console.log('');
    }

    const sinNada = filas.filter((f) => !f.telefono && !f.direccion && !f.logo_url);
    if (sinNada.length) {
        console.log(' Las empresas sin logo, telefono ni direccion imprimen comprobantes en blanco.');
        console.log(' Se arregla con:  node tools/datos-empresa.js <slug> --sembrar');
        console.log('');
    }
}

async function verUna(slug) {
    const f = await central.uno(
        `SELECT id, slug, nombre, subtitulo, logo_url, color_primario, color_secundario,
                telefono, email_contacto, direccion, cuit
           FROM empresas WHERE slug = ?`,
        [slug]
    );
    if (!f) return null;

    console.log('');
    console.log(` ${f.nombre}  (${f.slug}, #${f.id})`);
    console.log(' ' + '-'.repeat(64));
    console.log(`   ${ETIQUETAS.nombre.padEnd(18)} ${f.nombre}`);
    for (const campo of ['subtitulo', 'logo_url', 'color_primario', 'color_secundario',
        'telefono', 'email_contacto', 'direccion', 'cuit']) {
        const v = colorONulo(f[campo]);
        const marca = v === 'sin cargar' ? '( )' : ' ok ';
        console.log(`   ${marca} ${ETIQUETAS[campo].padEnd(18)} ${v}`);
    }
    console.log('');
    return f;
}

/** Copia el .env a la fila de la empresa, sin pisar lo que ya este cargado. */
async function sembrar(slug, forzar) {
    const empresa = await central.uno('SELECT id, nombre FROM empresas WHERE slug = ?', [slug]);
    if (!empresa) return { error: `No hay ninguna empresa con el slug "${slug}".` };

    const desdeEnv = {
        nombre: process.env.COMERCIO_NOMBRE,
        subtitulo: process.env.COMERCIO_SUBTITULO,
        logo_url: process.env.COMERCIO_LOGO
    };

    const cambios = [];
    const nada = [];
    for (const [campo, valor] of Object.entries(desdeEnv)) {
        if (!valor) { nada.push(campo); continue; }

        const actual = await central.uno(
            `SELECT ${campo} AS v FROM empresas WHERE id = ?`, [empresa.id]
        );
        if (actual && actual.v && !forzar) continue;

        await central.query(`UPDATE empresas SET ${campo} = ? WHERE id = ?`, [valor, empresa.id]);
        cambios.push(`${ETIQUETAS[campo]} = "${valor}"`);
    }

    console.log('');
    if (cambios.length) {
        console.log(` Sembrado en ${empresa.nombre}:`);
        for (const c of cambios) console.log(`   ${c}`);
    } else {
        console.log(` ${empresa.nombre} ya tenia todo cargado. No se toco nada.`);
        console.log(' Para pisar igual: agregá --forzar');
    }
    if (nada.length) {
        console.log('');
        console.log(` En el .env NO estan: ${nada.join(', ')}. Cargalos a mano si los queres.`);
    }
    console.log('');
    console.log(' Tarda hasta 30 segundos en hacerse efecto. Para ya:');
    console.log('     pm2 restart service-integral-backend');
    console.log('');
    return { cambios: cambios.length };
}

async function cambiar(slug, campo, valor) {
    if (SOLO_LECTURA.has(campo)) {
        return { error: `"${campo}" no se cambia desde acá.\n     Nombre y slug son identificadores: si se tocan, el sistema deja de encontrar a la empresa.` };
    }
    if (!(campo in CAMPOS)) {
        return {
            error: `No existe un campo "${campo}".\n     Los que se cambian: ${Object.keys(CAMPOS).join(', ')}`
        };
    }

    const empresa = await central.uno('SELECT id, nombre FROM empresas WHERE slug = ?', [slug]);
    if (!empresa) return { error: `No hay ninguna empresa con el slug "${slug}".` };

    const limpio = (valor === '' || valor === 'null' || valor === '-') ? null : String(valor).trim();

    // El formato se mira ANTES que el largo. Si alguien escribe "azul lindo"
    // en un campo de color, decirle que son 10 caracteres en un campo de 7 es
    // cierto y no sirve de nada: lo que quieren saber es que eso no es un color.
    if (campo.startsWith('color')) {
        const problema = problemaEnColor(campo, limpio);
        if (problema) return { error: problema };
    }

    // Un texto mas largo que la columna se recorta: MySQL lo corta en
    // silencio y avisa por warning, que nadie lee. Mejor un error claro.
    if (limpio !== null && limpio.length > CAMPOS[campo]) {
        return {
            error: `"${limpio.length}" caracteres, y la columna ${ETIQUETAS[campo]} admite ${CAMPOS[campo]}.`
        };
    }

    // El nombre se valida aparte: es lo que se imprime arriba de todo.
    if (campo === 'nombre' && !limpio) {
        return { error: 'El nombre no puede quedar vacio: es lo que ve el cliente impreso.' };
    }

    const antes = await central.uno(`SELECT ${campo} AS v FROM empresas WHERE id = ?`, [empresa.id]);

    await central.query(`UPDATE empresas SET ${campo} = ? WHERE id = ?`, [limpio, empresa.id]);

    console.log('');
    console.log(` ${empresa.nombre}: ${ETIQUETAS[campo]}`);
    console.log(`   antes   ${colorONulo(antes?.v)}`);
    console.log(`   ahora   ${colorONulo(limpio)}`);
    console.log('');
    console.log(' Tarda hasta 30 segundos en hacerse efecto. Para ya:');
    console.log('     pm2 restart service-integral-backend');
    console.log('');
    return { cambios: 1 };
}

// ---------------------------------------------------------------------------

async function main() {
    const [, , slug, campo, valor] = process.argv;
    const forzar = process.argv.includes('--forzar');

    if (!slug) {
        await verTodas();
        await central.cerrar();
        return;
    }

    if (!campo) {
        const f = await verUna(slug);
        await central.cerrar();
        if (!f) {
            console.error(`\nNo hay ninguna empresa con el slug "${slug}".`);
            process.exitCode = 1;
        }
        return;
    }

    let r;
    if (campo === '--sembrar') {
        r = await sembrar(slug, forzar);
    } else if (valor === undefined) {
        r = { error: `Falta el valor.\n     node tools/datos-empresa.js ${slug} ${campo} "<valor>"` };
    } else {
        r = await cambiar(slug, campo.toLowerCase(), valor);
    }

    await central.cerrar();
    if (r && r.error) {
        console.error(`\n${r.error}\n`);
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
