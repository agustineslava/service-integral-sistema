/**
 * VERIFICACION DE RESTAURACION - el paso que nunca se hizo.
 *
 * Toma el backup mas reciente, lo restaura en una base temporal,
 * compara el conteo de filas con la base real y destruye la temporal.
 *
 *   node tools/verify-restore.js
 *
 * Si esto no pasa, tus backups no valen nada.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const DB_REAL = process.env.DB_NAME;
const DB_TEST = `${DB_REAL}_verificacion`;
const CARPETA = path.join(__dirname, '..', 'backups');

const cred = () => ({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || '3306',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

function ultimoBackupValido() {
    if (!fs.existsSync(CARPETA)) return null;
    const archivos = fs.readdirSync(CARPETA)
        .filter(f => f.endsWith('.sql'))
        .map(f => {
            const ruta = path.join(CARPETA, f);
            let completo = false;
            try { completo = fs.readFileSync(ruta, 'utf8').includes('Dump completed'); } catch {}
            return { nombre: f, ruta, bytes: fs.statSync(ruta).size, completo };
        })
        .sort((a, b) => b.nombre.localeCompare(a.nombre));

    console.log('=== INVENTARIO DE BACKUPS ===');
    for (const a of archivos) {
        console.log(`  ${a.completo ? '[OK]     ' : '[INCOMPLETO]'} ${(a.bytes/1024).toFixed(1).padStart(8)} KB  ${a.nombre}`);
    }
    const buenos = archivos.filter(a => a.completo);
    console.log(`  -> ${archivos.length} archivo(s), ${buenos.length} integro(s)\n`);
    return buenos[0] || null;
}

(async () => {
    const backup = ultimoBackupValido();
    if (!backup) {
        console.error('FALLO: no hay ningun backup integro. Ejecuta primero: node tools/backup.js');
        process.exit(1);
    }

    console.log(`=== RESTAURANDO EN BASE TEMPORAL: ${DB_TEST} ===`);
    console.log(`  Origen: ${backup.nombre}\n`);

    const admin = await mysql.createConnection({ ...cred(), multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_TEST}\``);
    await admin.query(`CREATE DATABASE \`${DB_TEST}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

    let restaurado = false, errorRestore = null;
    try {
        execFileSync(process.env.MYSQLDUMP_PATH || 'mysqldump', [
            `-h${process.env.DB_HOST || 'localhost'}`,
            `-P${process.env.DB_PORT || '3306'}`,
            `-u${process.env.DB_USER}`,
            '--max-allowed-packet=256M',
            DB_TEST
        ], {
            env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD },
            input: fs.readFileSync(backup.ruta),
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['pipe', 'ignore', 'pipe'],
            windowsHide: true
        });
        restaurado = true;
    } catch (e) {
        errorRestore = e;
    }

    if (!restaurado) {
        console.error('FALLO: no se pudo restaurar el dump');
        console.error(`  ${errorRestore.message}`);
        if (errorRestore.stderr) console.error(`  ${errorRestore.stderr.toString().slice(0, 500)}`);
        await admin.query(`DROP DATABASE IF EXISTS \`${DB_TEST}\``);
        await admin.end();
        process.exit(1);
    }

    console.log('  Restauracion ejecutada. Comparando...\n');
    console.log('TABLA'.padEnd(26) + 'BD REAL'.padStart(10) + 'BD TEST'.padStart(10) + '   RESULTADO');
    console.log('-'.repeat(62));

    const real = await mysql.createConnection({ ...cred(), database: DB_REAL });
    const test = await mysql.createConnection({ ...cred(), database: DB_TEST });

    const [tablas] = await real.query(
        `SELECT TABLE_NAME AS n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [DB_REAL]);

    let ok = true, totalReal = 0, totalTest = 0;
    for (const { n } of tablas) {
        const [[a]] = await real.query(`SELECT COUNT(*) AS c FROM \`${n}\``);
        let b = { c: -1 };
        try { [b] = [{ c: (await test.query(`SELECT COUNT(*) AS c FROM \`${n}\``))[0].c }]; } catch {}
        const coincide = a.c === b.c;
        if (!coincide) ok = false;
        totalReal += a.c; totalTest += Math.max(b.c, 0);
        console.log(n.padEnd(26) + String(a.c).padStart(10) + String(b.c).padStart(10) +
                    '   ' + (coincide ? 'OK' : '*** DIFERENTE ***'));
    }

    console.log('-'.repeat(62));
    console.log(`TOTAL`.padEnd(26) + String(totalReal).padStart(10) + String(totalTest).padStart(10));

    // Verificacion funcional: se pueden LEER los datos, no solo contar filas
    console.log('\n=== PRUEBA FUNCIONAL ===');
    try {
        const [[r]] = await test.query('SELECT nombre, email, rol FROM usuarios ORDER BY id LIMIT 3');
        console.log(`  usuarios restaurados: ${r.length}`);
        r.forEach(u => console.log(`    - ${u.nombre} <${u.email}> [${u.rol}]`));
        const [[p]] = await test.query('SELECT COUNT(*) AS c FROM productos');
        console.log(`  productos legibles:   ${p.c}`);
    } catch (e) {
        ok = false;
        console.log(`  FALLO al leer datos: ${e.message}`);
    }

    await real.end(); await test.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_TEST}\``);
    await admin.end();
    console.log('\n  Base temporal destruida.');

    console.log('\n' + '='.repeat(62));
    if (ok) {
        console.log('RESULTADO: BACKUP VERIFICADO - se restauro y los datos coinciden');
        process.exit(0);
    } else {
        console.error('RESULTADO: *** BACKUP NO CONFIABLE ***');
        process.exit(1);
    }
})().catch(e => { console.error('Error inesperado:', e.message); process.exit(1); });
