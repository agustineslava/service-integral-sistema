#!/usr/bin/env node
/**
 * MODULOS CONTRATADOS POR EMPRESA
 * ---------------------------------------------------------------------------
 *   node tools/modulos.js                                ver el tablero
 *   node tools/modulos.js <slug>                         ver los de esa empresa
 *   node tools/modulos.js <slug> <modulo> on            prenderlo
 *   node tools/modulos.js <slug> <modulo> off            apagarlo
 *
 * POR QUE EXISTE
 * Un modulo apagado no se apaga con una bandera en el codigo: se apaga con una
 * fila en `empresa_modulos`. Sin esta herramienta, prenderle `presupuestos` a
 * un cliente significaba escribir SQL a mano, y una fila mal editada es un
 * cliente cuyo menu no aparece y cuyas rutas dan 404 sin que nadie sepa por que.
 *
 * Un modulo BASE (`modulos.es_base = 1`) no se puede apagar: son las cuatro
 * cosas que hacen que el sistema sea un sistema de taller. Apagar `stock`
 * dejaria una empresa que no puede trabajar, no una empresa con menos cosas.
 *
 * Tarda hasta 30 SEGUNDOS en hacerse efectivo: el servidor guarda la empresa en
 * memoria ese tiempo para no consultarla en cada pedido. No hace falta reiniciar.
 * Para que sea al instante: `pm2 restart service-integral-backend`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const central = require('../src/db/central');

const ON_OFF = { on: 1, off: 0, si: 1, yes: 1, activo: 1 };

/** Imprime el catalogo completo cruzado con lo que tiene cada empresa. */
async function tablero() {
    const empresas = await central.query(
        `SELECT id, slug, nombre, estado FROM empresas ORDER BY id`
    );
    const modulos = await central.query(
        `SELECT codigo, nombre, es_base, orden FROM modulos ORDER BY orden`
    );
    const contratado = await central.query(
        `SELECT empresa_id, modulo, activo FROM empresa_modulos`
    );

    // Un Set por empresa: preguntar "¿lo tiene contratado?" tiene que ser una
    // pregunta, no un escaneo de la lista.
    const porEmpresa = new Map();
    for (const e of empresas) porEmpresa.set(e.id, new Map());
    for (const c of contratado) {
        if (porEmpresa.has(c.empresa_id)) porEmpresa.get(c.empresa_id).set(c.modulo, c.activo);
    }

    const cab = modulos.map((m) => m.codigo.slice(0, 6).padEnd(7)).join('');
    console.log('');
    console.log(` ${'slug'.padEnd(20)}${cab}`);
    console.log(' ' + '-'.repeat(20 + cab.length));
    for (const e of empresas) {
        const fila = modulos.map((m) => {
            const activo = porEmpresa.get(e.id).get(m.codigo);
            return (activo ? ' SI ' : ' - ').padEnd(7);
        }).join('');
        console.log(` ${String(e.slug).padEnd(20)}${fila}`);
    }

    console.log('');
    console.log(' 1 = contratado   - = no contratado   (base) = no se puede apagar');
    console.log('');
    for (const m of modulos) {
        console.log(`  ${m.codigo.padEnd(18)}${m.es_base ? '(base)' : '      '}  ${m.nombre}`);
    }
    console.log('');
}

/** Imprime los modulos de una empresa, con lo que tiene la fila de central. */
async function verDe(slug) {
    const empresa = await central.uno('SELECT id, slug, nombre, estado FROM empresas WHERE slug = ?', [slug]);
    if (!empresa) return null;

    const filas = await central.query(
        `SELECT m.codigo, m.nombre, m.es_base, COALESCE(em.activo, 0) AS activo
           FROM modulos m
           LEFT JOIN empresa_modulos em ON em.modulo = m.codigo AND em.empresa_id = ?
          ORDER BY m.orden`,
        [empresa.id]
    );

    console.log('');
    console.log(` ${empresa.nombre}  (${empresa.slug}, #${empresa.id}, ${empresa.estado})`);
    console.log(' ' + '-'.repeat(66));
    for (const f of filas) {
        const marca = f.activo ? 'SI' : ' -';
        const base = f.es_base ? '  (base, no se apaga)' : '';
        console.log(` ${marca}  ${f.codigo.padEnd(18)}${f.nombre}${base}`);
    }
    console.log('');
    return empresa;
}

async function poner(slug, codigo, estado) {
    const empresa = await central.uno('SELECT id, nombre FROM empresas WHERE slug = ?', [slug]);
    if (!empresa) {
        console.error(`\nNo hay ninguna empresa con el slug "${slug}".`);
        console.error('Los que hay:');
        for (const e of await central.query('SELECT slug FROM empresas ORDER BY id')) {
            console.error(`   - ${e.slug}`);
        }
        return 1;
    }

    const modulo = await central.uno('SELECT codigo, nombre, es_base FROM modulos WHERE codigo = ?', [codigo]);
    if (!modulo) {
        console.error(`\nNo existe un módulo con el código "${codigo}".`);
        console.error('Los que hay:');
        for (const m of await central.query('SELECT codigo FROM modulos ORDER BY orden')) {
            console.error(`   - ${m.codigo}`);
        }
        return 1;
    }

    if (estado === 0 && modulo.es_base) {
        console.error(`\n"${codigo}" es un módulo BASE: no se puede apagar.`);
        console.error('Apagar el stock dejaría una empresa que no puede trabajar.');
        return 1;
    }

    // ON DUPLICATE KEY en vez de un SELECT y después un UPDATE: entre una cosa y
    // la otra la fila puede aparecer, y la herramienta se usaría justo cuando
    // dos personas están respondiendo el mismo pedido a la vez.
    await central.query(
        `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde)
              VALUES (?, ?, ?, CURDATE())
         ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
        [empresa.id, codigo, estado]
    );

    console.log(`\n ${modulo.nombre} (${codigo}) -> ${estado ? 'PRENDIDO' : 'APAGADO'} en ${empresa.nombre}.`);
    console.log(' Tarda hasta 30 segundos en hacerse efecto. Para ya:');
    console.log('    pm2 restart service-integral-backend');
    console.log('');
    return 0;
}

// ---------------------------------------------------------------------------

async function main() {
    const [, , slug, codigo, accion] = process.argv;

    if (!slug) {
        await tablero();
        await central.cerrar();
        return;
    }

    if (!codigo) {
        const empresa = await verDe(slug);
        await central.cerrar();
        if (!empresa) process.exitCode = 1;
        return;
    }

    if (!accion || !(accion.toLowerCase() in ON_OFF)) {
        console.error(`\nEl tercer argumento tiene que ser "on" u "off" (va "${accion}").`);
        await central.cerrar();
        process.exitCode = 1;
        return;
    }

    const codigoLimpio = String(codigo).trim().toLowerCase();
    process.exitCode = (await poner(slug, codigoLimpio, ON_OFF[accion.toLowerCase()])) || 0;
    await central.cerrar();
}

main().catch((err) => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
