/**
 * CLI para generar el BACKUP MULTI-BASE (central + todas las empresas),
 * con dumps verificados, a demanda.
 *
 *   node tools/backup.js                      -> respalda la central y todas las empresas
 *   node tools/backup.js --dry-run            -> muestra las bases sin dumpear nada
 *   node tools/backup.js --solo <nombre_db>   -> respalda una sola base (diagnóstico)
 *   node tools/backup.js --destino <carpeta>  -> usa otra carpeta (pruebas)
 *
 * La lista de bases sale de `si_central.empresas.nombre_db`, nunca hardcodeada.
 * Sale con codigo 0 si todos los dumps son integros, 1 si alguno falla.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const backup = require('../src/jobs/backup');
const central = require('../src/db/central');
const { nombreCentral } = require('../src/db/conexiones');

const CARPETA_DEFAULT = path.join(__dirname, '..', 'backups');
const args = process.argv.slice(2);

function flagConValor(nombre) {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

const dryRun         = args.includes('--dry-run');
const baseSola       = flagConValor('--solo');
const carpetaDestino = flagConValor('--destino') || CARPETA_DEFAULT;

async function listarBases() {
    const filas = await central.query(
        `SELECT nombre_db FROM empresas WHERE nombre_db IS NOT NULL AND nombre_db <> ''`
    );
    return [nombreCentral(), ...filas.map((f) => f.nombre_db)];
}

(async () => {
    console.log('=== BACKUP MULTI-BASE ===');
    console.log(`Central: ${nombreCentral()}`);
    console.log(`Origen:  ${process.env.DB_HOST || 'localhost'}`);
    console.log(`Destino: ${carpetaDestino}`);
    console.log('');

    let bases;
    try {
        bases = await listarBases();
    } catch (err) {
        console.error(`FALLO: no se pudo leer la central (${err.message}). No se respalda nada.`);
        process.exit(1);
    }

    if (baseSola) {
        const buscada = baseSola.trim().toLowerCase();
        if (!bases.includes(buscada)) {
            console.error(`FALLO: la base "${baseSola}" no está en la central.`);
            console.error(`  Disponibles: ${bases.join(', ')}`);
            process.exit(1);
        }
        bases = [buscada];
    }

    console.log(`Bases a respaldar (${bases.length}):`);
    for (const b of bases) console.log(`  - ${b}`);
    console.log('');

    if (dryRun) {
        console.log('DRY-RUN: no se generó ningún archivo.');
        process.exit(0);
    }

    const renombrados = backup.renombrarBackupsConZonaIncorrecta(carpetaDestino);
    if (renombrados) console.log(`Nombres con zona horaria incorrecta corregidos: ${renombrados}\n`);

    const res = await backup.ejecutarBackupCompleto({ carpetaDestino, bases });

    for (const r of res.resultados) {
        if (r.ok) {
            const off = r.offsite && r.offsite.ok ? r.offsite.destino : `no (${r.offsite && r.offsite.motivo})`;
            console.log(`OK   ${r.archivo} · ${(r.bytes / 1024).toFixed(2)} KB · ${r.tablas} tablas · ${r.duracionSeg}s`);
            console.log(`     Offsite: ${off}`);
        } else {
            console.error(`FALLO ${r.base}: ${r.error}`);
            if (r.stderr) console.error(`     mysqldump: ${String(r.stderr).trim().slice(0, 500)}`);
        }
    }

    console.log(`\nResumen: ${res.listos}/${res.total} base(s) respaldadas`);
    if (res.fallidos.length) {
        console.error(`Fallaron: ${res.fallidos.map((f) => f.base).join(', ')}`);
        console.error('\nFALLO - hay bases que NO se respaldaron.');
        console.error('Recordatorio: un backup NO verificado por restauracion no es un backup.');
        console.error('Probalo con:  node tools/verify-restore.js');
        process.exit(1);
    }

    console.log('\nRecordatorio: un backup NO verificado por restauracion no es un backup.');
    console.log('Probalo con:  node tools/verify-restore.js');
    process.exit(0);
})().catch((err) => {
    console.error('\nError inesperado:', err.message);
    process.exit(1);
});