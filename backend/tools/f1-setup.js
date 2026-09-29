/**
 * F1 - INSTALADOR DE LA BASE CENTRAL
 *
 *   npm run f1:setup
 *
 * Que hace, en orden:
 *   1. Asegura que exista el usuario administrador de bases (si_tenant_admin).
 *      Si ya existe, MANTIENE su contrasena (no la cambia sin necesidad).
 *   2. Le da permisos sobre si_central y sobre las bases de las empresas.
 *   3. Le da permisos de LECTURA/ESCRITURA (no de administracion) al usuario
 *      de la aplicacion sobre si_central: el runtime solo necesita consultar
 *      empresas, usuarios y modulos.
 *   4. Crea la base si_central.
 *   5. Aplica las migraciones del esquema central.
 *   6. Crea el primer SUPERADMIN.
 *   7. Verifica que la aplicacion (con SUS credenciales) puede leer si_central.
 *
 * Necesita la contrasena de root de MySQL. Si se equivoca, no toca nada.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { configAdmin, nombreCentral } = require('../src/db/conexiones');
const migraciones = require('../src/db/migrations');

const RUTA_ENV = path.join(__dirname, '..', '.env');
const USUARIO_TENANT_ADMIN = process.env.DB_ADMIN_USER || 'si_tenant_admin';
const APP_USER = process.env.DB_USER;
const DB_ACTUAL = process.env.DB_NAME;

// --------------------------------------------------------------------------
// Entrada interactiva
// --------------------------------------------------------------------------
function preguntar(texto, { oculto = false } = {}) {
    return new Promise((resolve) => {
        process.stdout.write(texto);

        if (!oculto || !process.stdin.isTTY) {
            const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
            rl.question('', (r) => { rl.close(); resolve(r.trim()); });
            return;
        }

        const stdin = process.stdin;
        let buf = '';
        const alRecibir = (chunk) => {
            for (const ch of chunk.toString('utf8')) {
                if (ch === '\r' || ch === '\n') {
                    stdin.setRawMode(false); stdin.pause();
                    stdin.removeListener('data', alRecibir);
                    process.stdout.write('\n');
                    return resolve(buf);
                }
                if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
                if (ch === '\u007F' || ch === '\b') buf = buf.slice(0, -1);
                else buf += ch;
            }
        };
        stdin.setRawMode(true); stdin.resume(); stdin.on('data', alRecibir);
    });
}

/** Reescribe .env preservando todo lo demas, y respalda el anterior. */
function actualizarEnv(cambios) {
    const original = fs.readFileSync(RUTA_ENV, 'utf8');
    const vistos = new Set();
    const salida = original.split(/\r?\n/).map((linea) => {
        const m = linea.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (m && Object.prototype.hasOwnProperty.call(cambios, m[1])) {
            vistos.add(m[1]);
            return `${m[1]}=${cambios[m[1]]}`;
        }
        return linea;
    });
    for (const [k, v] of Object.entries(cambios)) {
        if (!vistos.has(k)) salida.push(`${k}=${v}`);
    }
    const tmp = RUTA_ENV + '.tmp';
    fs.writeFileSync(tmp, salida.join('\n'), 'utf8');
    const respaldo = RUTA_ENV + '.bak-' + Date.now();
    fs.copyFileSync(RUTA_ENV, respaldo);
    fs.renameSync(tmp, RUTA_ENV);
    return respaldo;
}

// --------------------------------------------------------------------------
(async () => {
    const CENTRAL = nombreCentral();

    console.log('='.repeat(70));
    console.log(' F1 - INSTALACION DE LA BASE CENTRAL');
    console.log('='.repeat(70));
    console.log(` Base central        : ${CENTRAL}`);
    console.log(` Base actual         : ${DB_ACTUAL}`);
    console.log(` Usuario aplicacion  : ${APP_USER}`);
    console.log(` Usuario admin bases : ${USUARIO_TENANT_ADMIN}`);
    console.log('='.repeat(70) + '\n');

    const rootUser = (await preguntar('Usuario administrador de MySQL [root]: ')) || 'root';
    const rootPass = await preguntar(`Contrasena de ${rootUser}: `, { oculto: true });

    let raiz;
    try {
        raiz = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT || 3306),
            user: rootUser,
            password: rootPass,
            multipleStatements: true
        });
    } catch (e) {
        console.error(`\nNo se pudo conectar como ${rootUser}: ${e.message}`);
        console.error('Es el usuario administrador de MySQL, no el de la aplicacion.');
        process.exit(1);
    }

    const [[info]] = await raiz.query('SELECT VERSION() AS v, CURRENT_USER() AS u');
    console.log(`\nConectado como ${info.u}  (MySQL ${info.v})`);

    const pasos = [];
    const anotar = (ok, texto, detalle = '') => {
        pasos.push({ ok, texto });
        console.log(`  ${ok ? '[OK]   ' : '[FALLO]'} ${texto}`);
        if (detalle) console.log(`          ${detalle}`);
    };

    // ----------------------------------------------------------------------
    // 1. Usuario administrador de bases
    // ----------------------------------------------------------------------
    console.log('\n--- 1. Usuario administrador de bases ---');

    const [[existeAdmin]] = await raiz.query(
        `SELECT COUNT(*) AS n FROM mysql.user WHERE user = ? AND host = 'localhost'`,
        [USUARIO_TENANT_ADMIN]
    );

    let passAdmin = process.env.DB_ADMIN_PASSWORD;
    let adminNuevo = false;

    if (existeAdmin.n) {
        if (!passAdmin) {
            // Existe en MySQL pero no tenemos su contrasena: hay que regenerarla.
            passAdmin = crypto.randomBytes(24).toString('base64url').slice(0, 28);
            adminNuevo = true;
            await raiz.query(`ALTER USER ?@'localhost' IDENTIFIED BY ?`, [USUARIO_TENANT_ADMIN, passAdmin]);
            anotar(true, `${USUARIO_TENANT_ADMIN} ya existia; se regenero su contrasena`);
        } else {
            anotar(true, `${USUARIO_TENANT_ADMIN} ya existe; se conserva su contrasena`);
        }
    } else {
        passAdmin = crypto.randomBytes(24).toString('base64url').slice(0, 28);
        adminNuevo = true;
        await raiz.query(
            `CREATE USER ?@'localhost' IDENTIFIED BY ?`,
            [USUARIO_TENANT_ADMIN, passAdmin]
        );
        anotar(true, `${USUARIO_TENANT_ADMIN} creado`);
    }

    // ----------------------------------------------------------------------
    // 2. Permisos del administrador de bases
    // ----------------------------------------------------------------------
    console.log('\n--- 2. Permisos del administrador de bases ---');

    const permisos = [
        [`ALL sobre la base central (${CENTRAL})`,
         `GRANT ALL PRIVILEGES ON \`${CENTRAL}\`.* TO ?@'localhost'`],
        ['ALL sobre las bases de las empresas (si_tenant_*)',
         `GRANT ALL PRIVILEGES ON \`si_tenant_%\`.* TO ?@'localhost'`],
        [`ALL sobre la base actual (${DB_ACTUAL})`,
         `GRANT ALL PRIVILEGES ON \`${DB_ACTUAL}\`.* TO ?@'localhost'`],
        ['recargar privilegios', 'FLUSH PRIVILEGES']
    ];

    for (const [texto, sql] of permisos) {
        try {
            if (sql.includes('?')) await raiz.query(sql, [USUARIO_TENANT_ADMIN]);
            else await raiz.query(sql);
            anotar(true, texto);
        } catch (e) {
            anotar(false, texto, e.message);
        }
    }

    // ----------------------------------------------------------------------
    // 3. Crear la base central y dar acceso a la aplicacion
    // ----------------------------------------------------------------------
    console.log('\n--- 3. Base central y permisos de la aplicacion ---');

    try {
        await raiz.query(
            `CREATE DATABASE IF NOT EXISTS \`${CENTRAL}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
        anotar(true, `base ${CENTRAL} creada (o ya existia)`);
    } catch (e) {
        anotar(false, `crear la base ${CENTRAL}`, e.message);
    }

    try {
        // La aplicacion LEE y ESCRIBE datos de la central (login, auditoria),
        // pero NO puede alterar su estructura. Sin CREATE, DROP ni ALTER.
        await raiz.query(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${CENTRAL}\`.* TO ?@'localhost'`,
            [APP_USER]
        );
        anotar(true, `${APP_USER} puede leer/escribir ${CENTRAL} (sin permisos de estructura)`);
    } catch (e) {
        anotar(false, `permisos de ${APP_USER} sobre ${CENTRAL}`, e.message);
    }

    await raiz.end();

    // ----------------------------------------------------------------------
    // 4. Escribir las credenciales nuevas en .env (si cambiaron)
    // ----------------------------------------------------------------------
    if (adminNuevo || process.env.DB_CENTRAL_NAME !== CENTRAL) {
        console.log('\n--- 4. Actualizando backend/.env ---');
        const cambios = { DB_CENTRAL_NAME: CENTRAL };
        if (adminNuevo) cambios.DB_ADMIN_PASSWORD = passAdmin;
        const respaldo = actualizarEnv(cambios);
        console.log(`  [OK]   .env actualizado (respaldo: ${path.basename(respaldo)})`);
        console.log(`         claves: ${Object.keys(cambios).join(', ')}`);
        // Recargar en caliente para que el resto del script use los valores nuevos
        require('dotenv').config({ path: RUTA_ENV, override: true });
    } else {
        console.log('\n--- 4. backend/.env (sin cambios) ---');
        console.log('  [OK]   DB_CENTRAL_NAME y DB_ADMIN_PASSWORD ya estaban correctos');
    }

    // ----------------------------------------------------------------------
    // 5. Migraciones del esquema central
    // ----------------------------------------------------------------------
    console.log('\n--- 5. Migraciones del esquema central ---');

    let centralAdmin;
    try {
        centralAdmin = await mysql.createConnection(configAdmin(CENTRAL));
    } catch (e) {
        console.log(`  [FALLO] no se pudo conectar como ${USUARIO_TENANT_ADMIN}: ${e.message}`);
        console.log('          Revisa DB_ADMIN_USER / DB_ADMIN_PASSWORD en backend/.env');
        process.exit(1);
    }

    try {
        const r = await migraciones.aplicar(centralAdmin, 'central', {
            log: (s) => console.log('  ' + s.trim())
        });
        if (r.aplicadas === 0) console.log('  (sin migraciones pendientes)');
        anotar(true, `esquema central aplicado (${r.aplicadas} migracion(es))`);
    } catch (e) {
        anotar(false, 'aplicar migraciones del esquema central', e.message);
        await centralAdmin.end();
        process.exit(1);
    }

    // ----------------------------------------------------------------------
    // 6. Primer SUPERADMIN
    // ----------------------------------------------------------------------
    console.log('\n--- 6. Primer SUPERADMIN ---');

    const emailSuper = (await preguntar('  Email del SuperAdmin: ')).toLowerCase();
    if (!emailSuper || !emailSuper.includes('@')) {
        console.log('  [SKIP]  email invalido: no se creo el SuperAdmin');
        console.log('          Podes crearlo despues con: npm run superadmin');
    } else {
        const [[existente]] = await centralAdmin.query(
            'SELECT id, nombre FROM usuarios_globales WHERE email = ?', [emailSuper]
        );
        if (existente) {
            anotar(true, `ya existe un usuario con ${emailSuper} (no se modifico)`);
        } else {
            let passSuper = await preguntar('  Contrasena (Enter para generar una): ', { oculto: true });
            let generada = false;
            if (!passSuper) {
                passSuper = crypto.randomBytes(12).toString('base64url').slice(0, 16);
                generada = true;
            }
            const hash = await bcrypt.hash(passSuper, 10);
            await centralAdmin.query(
                `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol, activo)
                 VALUES (NULL, ?, ?, 'SuperAdmin', 'SUPERADMIN', 1)`,
                [emailSuper, hash]
            );
            anotar(true, `SuperAdmin ${emailSuper} creado`);
            if (generada) {
                console.log('\n  ' + '='.repeat(62));
                console.log(`   CONTRASENA GENERADA: ${passSuper}`);
                console.log('   Guardala ahora: no se vuelve a mostrar.');
                console.log('  ' + '='.repeat(62));
            }
        }
    }

    // ----------------------------------------------------------------------
    // 7. Verificacion con las credenciales DE LA APLICACION
    // ----------------------------------------------------------------------
    console.log('\n--- 7. Verificacion ---');

    await centralAdmin.end();

    try {
        const app = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT || 3306),
            user: APP_USER,
            password: process.env.DB_PASSWORD,
            database: CENTRAL
        });
        const [[r]] = await app.query(
            `SELECT
                (SELECT COUNT(*) FROM empresas)         AS empresas,
                (SELECT COUNT(*) FROM modulos)          AS modulos,
                (SELECT COUNT(*) FROM planes)           AS planes,
                (SELECT COUNT(*) FROM usuarios_globales) AS usuarios`
        );
        anotar(true, `${APP_USER} lee ${CENTRAL}: ${r.empresas} empresa(s), ${r.modulos} modulos, ${r.planes} planes, ${r.usuarios} usuario(s)`);

        // La aplicacion NO debe poder crear tablas en la central.
        let pudoCrear = false;
        try {
            await app.query('CREATE TABLE `no_deberia_poder` (id INT)');
            pudoCrear = true;
            await app.query('DROP TABLE `no_deberia_poder`');
        } catch { /* esperado */ }
        anotar(!pudoCrear, pudoCrear
            ? '*** LA APLICACION PUEDE CREAR TABLAS EN LA CENTRAL (no deberia) ***'
            : 'la aplicacion NO puede modificar la estructura de la central (correcto)');

        await app.end();
    } catch (e) {
        anotar(false, `la aplicacion no puede leer ${CENTRAL}`, e.message);
    }

    // ----------------------------------------------------------------------
    // Resumen
    // ----------------------------------------------------------------------
    const fallos = pasos.filter((p) => !p.ok).length;
    console.log('\n' + '='.repeat(70));
    if (fallos === 0) {
        console.log(' F1 COMPLETADO');
        console.log('='.repeat(70));
        console.log('\nProximos comandos utiles:\n');
        console.log('  npm run migrate -- --central --status    estado del esquema central');
        console.log('  npm run migrate -- --central --dry-run   ver que migraciones faltan');
        console.log();
    } else {
        console.log(` F1 CON FALLOS - ${fallos} paso(s) no se completaron`);
        console.log('='.repeat(70));
        process.exit(1);
    }
})().catch((e) => {
    console.error('\nError inesperado:', e.message);
    process.exit(1);
});
