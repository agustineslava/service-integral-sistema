#!/usr/bin/env node
/**
 * LÍMITE DE USUARIOS POR EMPRESA
 * ---------------------------------------------------------------------------
 *   node tools/limite-usuarios.js                  ver la situación de todas
 *   node tools/limite-usuarios.js <slug> <n>       darle n usuarios a esa empresa
 *   node tools/limite-usuarios.js <slug> plan      volver a lo que dice el plan
 *
 * POR QUÉ EXISTE
 * El plan básico trae 3 usuarios. Cuando un cliente compra más, eso se anota
 * en `empresas.max_usuarios`, que tiene prioridad sobre el plan. Sin esta
 * herramienta, cambiar eso significaba escribir SQL a mano — y una fila mal
 * editada es un cliente al que no le entran usuarios y no se entiende por qué.
 *
 * `max_usuarios = NULL` significa "no hay excepción, aplica el plan". Es el
 * estado normal y el que hay que dejar en la mayoría de las empresas.
 *
 * Tarda hasta 30 SEGUNDOS en hacerse efectivo: el servidor guarda la empresa
 * en memoria ese tiempo para no consultarla en cada request. No hace falta
 * reiniciar nada.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const central = require('../src/db/central');

function imprimir(empresas) {
    console.log('');
    console.log(' slug                 empresa               plan     excepcion  vigente   usuarios');
    console.log(' ' + '-'.repeat(84));
    for (const e of empresas) {
        const excepcion = e.max_usuarios === null ? '-' : String(e.max_usuarios);
        const vigente = e.limite_efectivo === null || e.limite_efectivo === undefined
            ? 'sin tope'
            : String(e.limite_efectivo);
        const lleno = e.limite_efectivo !== null && e.usuarios >= e.limite_efectivo;
        console.log(
            ` ${String(e.slug).padEnd(20)} ${String(e.nombre).slice(0, 20).padEnd(21)}` +
            ` ${String(e.plan || '-').padEnd(8)} ${excepcion.padEnd(10)} ${vigente.padEnd(9)}` +
            ` ${String(e.usuarios).padStart(2)}${lleno ? '  <- lleno' : ''}`
        );
    }
    console.log('');
    console.log(' excepcion "-" = sin excepcion, manda el plan.');
    console.log(' vigente "sin tope" = ni el plan ni la excepcion ponen un tope.');
}

async function listar() {
    const empresas = await central.query(`
        SELECT e.id, e.nombre, e.slug, e.plan, e.max_usuarios,
               p.max_usuarios AS plan_max_usuarios,
               COALESCE(e.max_usuarios, p.max_usuarios) AS limite_efectivo,
               (SELECT COUNT(*) FROM usuarios_globales u
                 WHERE u.empresa_id = e.id AND u.activo = 1) AS usuarios
          FROM empresas e
          LEFT JOIN planes p ON p.codigo = e.plan
         ORDER BY e.nombre`);
    imprimir(empresas);
}

async function cambiar(slug, valor) {
    const empresa = await central.uno('SELECT id, nombre, slug FROM empresas WHERE slug = ?', [slug]);
    if (!empresa) {
        console.error(`\nNo hay ninguna empresa con el slug "${slug}".`);
        console.error('Usá `npm run limites` para ver los que hay.\n');
        return;
    }

    let nuevo = null;
    if (valor !== 'plan') {
        nuevo = parseInt(valor, 10);
        if (!Number.isInteger(nuevo) || nuevo < 1) {
            console.error('\nEl número tiene que ser un entero mayor o igual a 1, o la palabra "plan".\n');
            return;
        }
    }

    await central.query('UPDATE empresas SET max_usuarios = ? WHERE id = ?', [nuevo, empresa.id]);
    console.log(`\n${empresa.nombre} (${empresa.slug}): ${nuevo === null ? 'vuelve a lo que dice el plan' : `excepción de ${nuevo} usuario(s)`}.`);
    console.log('Rige dentro de hasta 30 segundos. No hay que reiniciar el servidor.\n');
}

async function main() {
    const [, , slug, valor] = process.argv;

    if (!slug) {
        await listar();
    } else {
        await cambiar(slug, valor);
    }

    // Siempre hay que cerrar el pool: si queda abierto, el proceso se queda
    // vivo para siempre y `npm run limites` no termina nunca.
    await central.cerrar();
}

main().catch((err) => {
    console.error('\nERROR:', err.message);
    process.exitCode = 1;
    try { require('../src/db/central').cerrar(); } catch { /* nada */ }
});
