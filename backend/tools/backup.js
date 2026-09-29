/**
 * CLI para generar un backup verificado a demanda.
 *   node tools/backup.js
 * Sale con codigo 0 si el backup es integro, 1 si falla.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const backup = require('../src/jobs/backup');

const carpeta = path.join(__dirname, '..', 'backups');

(async () => {
    console.log('=== BACKUP MANUAL ===');
    console.log(`Base:  ${process.env.DB_NAME}`);
    console.log(`Origen: ${process.env.DB_HOST || 'localhost'}`);
    console.log('');

    const renombrados = backup.renombrarBackupsConZonaIncorrecta(carpeta);
    if (renombrados) console.log(`Nombres con zona horaria incorrecta corregidos: ${renombrados}\n`);

    try {
        const r = await backup.ejecutarDump({ carpetaDestino: carpeta });

        console.log('OK - BACKUP VERIFICADO');
        console.log(`  Archivo:     ${r.ruta}`);
        console.log(`  Tamano:      ${(r.bytes / 1024).toFixed(2)} KB`);
        console.log(`  Tablas:      ${r.tablas}`);
        console.log(`  Duracion:    ${r.duracionSeg}s`);
        console.log(`  Checks:      contiene "Dump completed"`);

        const off = backup.copiarOffsite(r.ruta, r.nombreArchivo);
        console.log(`  Offsite:     ${off.ok ? off.destino : 'no (' + off.motivo + ')'}`);

        const borrados = backup.limpiarBackupsViejos(carpeta, backup.RETENCION_DIAS_DEFAULT);
        console.log(`  Retencion:   ${borrados} backup(s) de mas de ${backup.RETENCION_DIAS_DEFAULT} dias eliminados`);

        console.log('\nRecordatorio: un backup NO verificado por restauracion no es un backup.');
        console.log('Probalo con:  node tools/verify-restore.js');
        process.exit(0);

    } catch (err) {
        console.error('\nFALLO - NO se genero ningun backup utilizable');
        console.error(`  ${err.message}`);
        if (err.stderr) console.error(`  mysqldump: ${err.stderr.trim().slice(0, 500)}`);
        process.exit(1);
    }
})();
