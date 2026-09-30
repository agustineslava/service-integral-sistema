/**
 * VERIFICACION DE RESTAURACION - el paso que nunca se hizo.
 *
 *   node tools/verify-restore.js
 *
 * Toma el backup mas reciente, lo restaura en una base temporal, compara el
 * conteo de filas con la base real y destruye la temporal.
 *
 * Si esto no pasa, los backups no valen nada.
 *
 * Usa DB_ADMIN_USER / DB_ADMIN_PASSWORD (usuario si_tenant_admin), NO el
 * usuario de la aplicacion: el de la app no puede crear bases.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const DB_REAL = process.env.DB_NAME;
const DB_TEST = `${DB_REAL}_verificacion`;
const CARPETA = path.join(__dirname, '..', 'backups');

// Credenciales de administracion de base (necesarias para crear/borrar bases)
const ADMIN_USER = process.env.DB_ADMIN_USER;
const ADMIN_PASS = process.env.DB_ADMIN_PASSWORD;

// NO se cae de vuelta al usuario de la aplicacion. Ese usuario no puede crear
// bases, y el resultado era un "Access denied ... to database '..._verificacion'"
// que no decia nada sobre la causa real. Mejor fallar aca, con el motivo claro.
if (!ADMIN_USER || !ADMIN_PASS) {
    console.error('FALLO: faltan DB_ADMIN_USER / DB_ADMIN_PASSWORD en backend/.env.');
    console.error('Esta verificacion crea una base temporal: necesita el usuario');
    console.error('administrador. El usuario de la aplicacion no tiene ese permiso.');
    console.error('\nCorre:  npm run f0:setup');
    process.exit(1);
}

const USER = ADMIN_USER;
const PASS = ADMIN_PASS;

/** Ubica el cliente 'mysql' (importador). NO sirve mysqldump para restaurar. */
function ubicarClienteMysql() {
    if (process.env.MYSQL_PATH && fs.existsSync(process.env.MYSQL_PATH)) return process.env.MYSQL_PATH;

    // Derivar de MYSQLDUMP_PATH: ...\mysqldump.exe -> ...\mysql.exe
    if (process.env.MYSQLDUMP_PATH) {
        const candidato = process.env.MYSQLDUMP_PATH
            .replace(/mysqldump(\.exe)?$/i, (m) => m.replace('mysqldump', 'mysql'));
        if (fs.existsSync(candidato)) return candidato;
    }

    const comunes = [
        'C:\\Program Files\\MySQL\\MySQL Server 9.5\\bin\\mysql.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe',
        'C:\\Program Files\\MySQL\\MySQL Workbench 8.0 CE\\mysql.exe'
    ];
    for (const c of comunes) if (fs.existsSync(c)) return c;

    return 'mysql'; // confiar en el PATH
}

function credenciales() {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '3306',
        user: USER,
        password: PASS
    };
}

function inventarioBackups() {
    if (!fs.existsSync(CARPETA)) return { lista: [], integros: [] };
    const lista = fs.readdirSync(CARPETA)
        .filter(f => f.endsWith('.sql'))
        .map(f => {
            const ruta = path.join(CARPETA, f);
            let integro = false;
            try { integro = fs.readFileSync(ruta, 'utf8').includes('Dump completed'); } catch {}
            return { nombre: f, ruta, bytes: fs.statSync(ruta).size, integro };
        })
        .sort((a, b) => b.nombre.localeCompare(a.nombre));

    console.log('=== INVENTARIO DE BACKUPS ===');
    for (const a of lista) {
        console.log(`  ${a.integro ? '[OK]        ' : '[INCOMPLETO]'} ${(a.bytes / 1024).toFixed(1).padStart(8)} KB  ${a.nombre}`);
    }
    const integros = lista.filter(a => a.integro);
    console.log(`  -> ${lista.length} archivo(s), ${integros.length} integro(s)\n`);
    return { lista, integros };
}

(async () => {
    if (!USER) {
        console.error('Falta DB_ADMIN_USER en .env. Corre primero: npm run f0:setup');
        process.exit(1);
    }

    const { integros } = inventarioBackups();
    const backup = integros[0];
    if (!backup) {
        console.error('FALLO: no hay ningun backup integro. Corre: npm run backup');
        process.exit(1);
    }

    const mysqlBin = ubicarClienteMysql();
    console.log(`=== RESTAURANDO EN BASE TEMPORAL: ${DB_TEST} ===`);
    console.log(`  Origen:     ${backup.nombre}`);
    console.log(`  Usuario:    ${USER}`);
    console.log(`  Cliente:    ${mysqlBin}\n`);

    // --- 1) Crear la base temporal ---
    let admin;
    try {
        admin = await mysql.createConnection(credenciales());
    } catch (e) {
        console.error(`FALLO: no se pudo conectar como ${USER}: ${e.message}`);
        process.exit(1);
    }

    try {
        await admin.query(`DROP DATABASE IF EXISTS \`${DB_TEST}\``);
        await admin.query(`CREATE DATABASE \`${DB_TEST}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        console.log('  [OK] base temporal creada');
    } catch (e) {
        console.error(`  [FALLO] no se pudo crear la base temporal: ${e.message}`);
        console.error('\n  >> El usuario no tiene privilegios de administracion.');
        console.error('  >> Corre: npm run f0:setup');
        await admin.end();
        process.exit(1);
    }

    // --- 2) Importar el dump con el cliente mysql (mysqldump NO restaura) ---
    try {
        execFileSync(mysqlBin, [
            `-h${process.env.DB_HOST || 'localhost'}`,
            `-P${process.env.DB_PORT || '3306'}`,
            `-u${USER}`,
            '--max-allowed-packet=256M',
            '--default-character-set=utf8mb4',
            DB_TEST
        ], {
            env: { ...process.env, MYSQL_PWD: PASS },
            input: fs.readFileSync(backup.ruta),
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });
        console.log('  [OK] dump importado');
    } catch (e) {
        const err = e.stderr ? e.stderr.toString().trim().slice(0, 600) : e.message;
        console.error(`  [FALLO] la importacion fallo:\n${err}`);
        await admin.query(`DROP DATABASE IF EXISTS \`${DB_TEST}\``).catch(() => {});
        await admin.end();
        process.exit(1);
    }

    // --- 3) Comparar contra la base real ---
    console.log('\n=== COMPARACION DE DATOS ===');
    const real = await mysql.createConnection({ ...credenciales(), database: DB_REAL });
    const test = await mysql.createConnection({ ...credenciales(), database: DB_TEST });

    const [tablas] = await real.query(
        `SELECT TABLE_NAME AS n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`, [DB_REAL]);

    console.log('TABLA'.padEnd(24) + 'BD REAL'.padStart(10) + 'BD TEST'.padStart(10) + '   RESULTADO');
    console.log('-'.repeat(60));

    let ok = true, totalReal = 0, totalTest = 0;
    for (const { n } of tablas) {
        const [[a]] = await real.query(`SELECT COUNT(*) AS c FROM \`${n}\``);
        let cTest = -1;
        try { const [[b]] = await test.query(`SELECT COUNT(*) AS c FROM \`${n}\``); cTest = b.c; } catch {}
        const coincide = a.c === cTest;
        if (!coincide) ok = false;
        totalReal += a.c;
        totalTest += Math.max(cTest, 0);
        console.log(n.padEnd(24) + String(a.c).padStart(10) + String(cTest).padStart(10) +
                    '   ' + (coincide ? 'OK' : '*** DIFERENTE ***'));
    }
    console.log('-'.repeat(60));
    console.log('TOTAL'.padEnd(24) + String(totalReal).padStart(10) + String(totalTest).padStart(10));

    // --- 4) Prueba funcional: los datos se pueden LEER ---
    console.log('\n=== PRUEBA FUNCIONAL ===');
    try {
        // La tabla `usuarios` ya no esta en las bases (limpieza de F4): los
        // usuarios viven en la central, y un respaldo de la base del taller
        // correctamente no los tiene. Su ausencia NO es un fallo, asi que se
        // informa en vez de romper la restauracion.
        const [[hayUsuarios]] = await test.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'`
        );
        if (hayUsuarios.n) {
            const [usuarios] = await test.query('SELECT nombre, email, rol FROM usuarios ORDER BY id LIMIT 3');
            console.log(`  usuarios legibles:  ${usuarios.length}`);
            usuarios.forEach(u => console.log(`    - ${u.nombre} <${u.email}> [${u.rol}]`));
        } else {
            console.log('  usuarios:           (no estan en esta base, viven en la central)');
        }
        const [[r]] = await test.query('SELECT COUNT(*) AS c FROM reparaciones');
        const [[p]] = await test.query('SELECT COUNT(*) AS c FROM productos');
        console.log(`  reparaciones:       ${r.c}`);
        console.log(`  productos:          ${p.c}`);

        // Los datos restaurados tienen que tener la MISMA forma que los reales
        const [[a]] = await real.query('SELECT COUNT(*) AS c FROM reparaciones');
        if (a.c !== r.c) { ok = false; console.log('  *** las reparaciones no coinciden ***'); }
    } catch (e) {
        ok = false;
        console.log(`  [FALLO] no se pueden leer los datos: ${e.message}`);
    }

    await real.end();
    await test.end();

    // --- 5) Limpieza ---
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_TEST}\``).catch(() => {});
    await admin.end();
    console.log('\n  [OK] base temporal destruida');

    console.log('\n' + '='.repeat(60));
    if (ok) {
        console.log('RESULTADO: BACKUP VERIFICADO');
        console.log('  El backup se restauro y los datos coinciden con la base real.');
        console.log('='.repeat(60));
        process.exit(0);
    } else {
        console.error('RESULTADO: *** BACKUP NO CONFIABLE ***');
        console.error('='.repeat(60));
        process.exit(1);
    }
})().catch(e => {
    console.error('\nError inesperado:', e.message);
    process.exit(1);
});
