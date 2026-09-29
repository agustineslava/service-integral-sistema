/**
 * MOTOR DE MIGRACIONES - linea de comandos
 *
 *   node tools/migrate.js --central --status
 *   node tools/migrate.js --central --dry-run
 *   node tools/migrate.js --central
 *
 *   node tools/migrate.js --tenant ServiceIntegralsistema --dry-run
 *   node tools/migrate.js --tenant ServiceIntegralsistema
 *
 *   node tools/migrate.js --fleet --dry-run
 *   node tools/migrate.js --fleet
 *
 * --central  aplica a si_central (empresas, usuarios, modulos)
 * --tenant   aplica a UNA base de empresa
 * --fleet    aplica a TODAS las bases de empresa registradas en si_central
 * --dry-run  muestra que haria, sin tocar nada
 * --status   muestra el estado de cada migracion
 *
 * Usa las credenciales de ADMINISTRACION (DB_ADMIN_USER), porque aplicar
 * migraciones es DDL. La aplicacion en runtime nunca corre esto.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const { conectarAdmin, conectarApp, nombreCentral } = require('../src/db/conexiones');
const migraciones = require('../src/db/migrations');

// --------------------------------------------------------------------------
// Argumentos
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const valorDe = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
};

const dryRun = tiene('--dry-run');
const soloEstado = tiene('--status');

let modo = 'central';
let tenant = null;

if (tiene('--fleet')) modo = 'fleet';
else if (tiene('--tenant')) { modo = 'tenant'; tenant = valorDe('--tenant'); }
else if (tiene('--central')) modo = 'central';

if (modo === 'tenant' && !tenant) {
    console.error('Falta el nombre de la base. Ejemplo:\n  node tools/migrate.js --tenant si_tenant_ejemplo\n');
    process.exit(1);
}

// --------------------------------------------------------------------------
// Presentacion
// --------------------------------------------------------------------------
const linea = (s = '') => console.log(s);
const titulo = (s) => { linea(); linea('='.repeat(68)); linea(' ' + s); linea('='.repeat(68)); };

async function mostrarEstado(conexion, tipo) {
    const items = await migraciones.estado(conexion, tipo);
    if (!items.length) {
        linea(`  (el directorio migrations/${tipo} esta vacio)`);
        return items;
    }
    for (const i of items) {
        const marca = i.estado === migraciones.ESTADOS.APLICADA   ? '[APLICADA]  '
                    : i.estado === migraciones.ESTADOS.PENDIENTE  ? '[PENDIENTE] '
                    : '*** MODIFICADA ***';
        const fecha = i.aplicada_en ? `  ${String(i.aplicada_en).slice(0, 19)}` : '';
        linea(`  ${marca} ${i.nombre}${fecha}`);
    }
    return items;
}

// --------------------------------------------------------------------------
// Casos
// --------------------------------------------------------------------------
async function correrCentral() {
    const central = await conectarAdmin(nombreCentral());
    try {
        titulo(`BASE CENTRAL · ${nombreCentral()}`);
        if (soloEstado) {
            await mostrarEstado(central, 'central');
        } else {
            const r = await migraciones.aplicar(central, 'central', { dryRun, log: linea });
            if (r.pendientes.length === 0) linea('  (sin migraciones pendientes)');
            else if (!dryRun) linea(`\n  Aplicadas: ${r.aplicadas}`);
        }
        const items = await migraciones.estado(central, 'central');
        const pend = items.filter((i) => i.estado === migraciones.ESTADOS.PENDIENTE).length;
        linea(`  Estado final: ${items.length - pend}/${items.length} aplicadas`);
    } finally {
        await central.end();
    }
}

async function correrTenant(nombreDb) {
    const conexion = await conectarAdmin(nombreDb);
    try {
        titulo(`BASE DE EMPRESA · ${nombreDb}`);
        if (soloEstado) {
            await mostrarEstado(conexion, 'tenant');
        } else {
            const r = await migraciones.aplicar(conexion, 'tenant', { dryRun, log: linea });
            if (r.pendientes.length === 0) linea('  (sin migraciones pendientes)');
            else if (!dryRun) linea(`\n  Aplicadas: ${r.aplicadas}`);
        }
    } finally {
        await conexion.end();
    }
}

async function correrFlota() {
    const central = await conectarApp(nombreCentral());
    let empresas;
    try {
        [empresas] = await central.query(
            `SELECT id, nombre, nombre_db, estado FROM empresas
             WHERE estado <> 'BAJA' ORDER BY id`
        );
    } finally {
        await central.end();
    }

    titulo(`FLOTA · ${empresas.length} empresa(s) registradas`);
    if (!empresas.length) {
        linea('  No hay empresas registradas en la base central.');
        return;
    }

    const resumen = [];

    for (const e of empresas) {
        linea(`\n--- #${e.id} ${e.nombre}  (${e.nombre_db}, ${e.estado}) ---`);
        let conexion;
        try {
            conexion = await conectarAdmin(e.nombre_db);
        } catch (err) {
            linea(`  *** NO SE PUDO CONECTAR: ${err.code || err.message}`);
            resumen.push({ empresa: e.nombre, resultado: 'SIN CONEXION' });
            continue;
        }
        try {
            const r = await migraciones.aplicar(conexion, 'tenant', { dryRun, log: linea });
            if (!dryRun && r.aplicadas === 0) linea('  (sin migraciones pendientes)');
            resumen.push({ empresa: e.nombre, resultado: dryRun ? `${r.pendientes.length} pendiente(s)` : `${r.aplicadas} aplicada(s)` });
        } catch (err) {
            linea(`  *** FALLO: ${err.message}`);
            resumen.push({ empresa: e.nombre, resultado: 'FALLO' });
        } finally {
            await conexion.end();
        }
    }

    titulo('RESUMEN');
    for (const r of resumen) {
        linea(`  ${r.empresa.padEnd(34)} ${r.resultado}`);
    }
}

// --------------------------------------------------------------------------
(async () => {
    linea(`\nModo: ${modo}${dryRun ? '  (SIMULACION)' : ''}${soloEstado ? '  (SOLO ESTADO)' : ''}`);
    try {
        if (modo === 'central') await correrCentral();
        else if (modo === 'tenant') await correrTenant(tenant);
        else await correrFlota();
        linea();
    } catch (err) {
        linea();
        console.error('ERROR:');
        console.error(String(err.message).split('\n').map((l) => '  ' + l).join('\n'));
        if (modo === 'central' && /si_central|DBACCES|ER_BAD_DB_ERROR/i.test(`${err.message} ${err.code || ''}`)) {
            linea();
            linea('  La base central todavia no existe, o este usuario no tiene permiso sobre ella.');
            linea('  Creala con:  npm run f1:setup');
        }
        linea();
        process.exit(1);
    }
})();
