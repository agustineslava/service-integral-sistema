/**
 * F0 - Entrega de privilegios que exige la arquitectura multi-tenant.
 *
 *   node tools/grant-tenant-privileges.js <usuario_admin>
 *
 * Te pide la contrasena del administrador de MySQL de forma interactiva
 * (no se escribe en el historial de comandos ni queda en la linea de procesos).
 *
 * POR QUE HACE FALTA
 * ------------------
 * Hoy el usuario de la app solo tiene:
 *     GRANT SELECT, INSERT, UPDATE, DELETE ON serviceintegralsistema.*
 *
 * Eso alcanza para un sistema mono-empresa, pero BLOQUEA el multi-tenant:
 *   - no puede CREATE DATABASE  -> imposible dar de alta empresas nuevas
 *   - no puede DROP DATABASE    -> imposible borrar un tenant o limpiar
 *   - no puede restaurar        -> la verificacion de restore es imposible
 *   - cada empresa nueva exigiria un GRANT manual
 *
 * QUE HACE
 * --------
 * Crea un usuario SEPARADO, si_tenant_admin, que:
 *   - puede crear y borrar bases con el prefijo si_tenant_  (las de los clientes)
 *   - puede administrar la base central (registro de empresas)
 *   - puede crear bases terminadas en _verificacion (para probar restores)
 *
 * El usuario de la app NO recibe CREATE ni DROP. Deliberado: si alguna vez
 * una inyeccion SQL llega a la aplicacion, no debe poder crear ni borrar bases.
 * La app nunca necesita esos permisos en runtime: solo los necesita el
 * mini-instalador (F6) y los scripts de restauracion.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const USUARIO_ADMIN = process.argv[2] || 'root';
const APP_USER = process.env.DB_USER || 'service_integral_app';
const DB_CENTRAL = process.env.DB_NAME || 'ServiceIntegralsistema';
const PREFIJO_TENANT = 'si_tenant_';
const USUARIO_TENANT_ADMIN = 'si_tenant_admin';

function preguntarPassword(prompt) {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        process.stdout.write(prompt);
        let buf = '';
        const onData = (chunk) => {
            const s = chunk.toString('utf8');
            for (const ch of s) {
                if (ch === '\r' || ch === '\n') {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    return resolve(buf);
                } else if (ch === '\u0003') {           // Ctrl+C
                    process.stdout.write('\n');
                    process.exit(130);
                } else if (ch === '\u007F' || ch === '\b') {   // Backspace
                    buf = buf.slice(0, -1);
                } else {
                    buf += ch;
                }
            }
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}

(async () => {
    console.log('='.repeat(70));
    console.log(' ENTREGA DE PRIVILEGIOS PARA MULTI-TENANT');
    console.log('='.repeat(70));
    console.log(` Administrador MySQL : ${USUARIO_ADMIN}`);
    console.log(` Base central        : ${DB_CENTRAL}`);
    console.log(` Usuario app (sin cambios): ${APP_USER}`);
    console.log('='.repeat(70));

    const password = await preguntarPassword(`\nContrasena de ${USUARIO_ADMIN}: `);

    let conn;
    try {
        conn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || '3306',
            user: USUARIO_ADMIN,
            password
        });
    } catch (e) {
        console.error(`\nNo se pudo conectar como ${USUARIO_ADMIN}: ${e.message}`);
        console.error('\nEs el usuario administrador de MySQL, NO el de la aplicacion.');
        console.error('Normalmente es "root" con la contrasena que pusiste al instalar el servidor.');
        process.exit(1);
    }

    const [[info]] = await conn.query('SELECT VERSION() AS v, CURRENT_USER() AS u');
    console.log(`\nConectado: ${info.u}  (MySQL ${info.v})`);

    const nuevaPass = require('crypto').randomBytes(24).toString('base64url').slice(0, 28);

    console.log('\n--- Aplicando cambios ---');
    const pasos = [
        [`Crear usuario ${USUARIO_TENANT_ADMIN}`,
         `CREATE USER IF NOT EXISTS '${USUARIO_TENANT_ADMIN}'@'localhost' IDENTIFIED BY '${nuevaPass}'`],

        [`Permitir crear/borrar las bases de los clientes (${PREFIJO_TENANT}*)`,
         `GRANT CREATE, DROP ON \`${PREFIJO_TENANT}%\`.* TO '${USUARIO_TENANT_ADMIN}'@'localhost'`],

        [`Permitir administrar la base central (${DB_CENTRAL})`,
         `GRANT ALL PRIVILEGES ON \`${DB_CENTRAL}\`.* TO '${USUARIO_TENANT_ADMIN}'@'localhost'`],

        ['Permitir crear la base temporal de verificacion de restores',
         `GRANT ALL PRIVILEGES ON \`${DB_CENTRAL}_verificacion\`.* TO '${USUARIO_TENANT_ADMIN}'@'localhost'`],

        ['Recargar la tabla de privilegios',
         'FLUSH PRIVILEGES']
    ];

    let fallos = 0;
    for (const [desc, sql] of pasos) {
        try {
            await conn.query(sql);
            console.log(`  [OK]    ${desc}`);
        } catch (e) {
            fallos++;
            console.log(`  [FALLO] ${desc}`);
            console.log(`          ${e.message}`);
        }
    }

    console.log('\n--- Verificacion de privilegios ---');
    const [g1] = await conn.query(`SHOW GRANTS FOR '${USUARIO_TENANT_ADMIN}'@'localhost'`);
    console.log(`\n${USUARIO_TENANT_ADMIN}:`);
    g1.forEach(g => console.log('  ' + Object.values(g)[0]));

    const [g2] = await conn.query(`SHOW GRANTS FOR '${APP_USER}'@'localhost'`);
    console.log(`\n${APP_USER} (sin CREATE ni DROP, por seguridad):`);
    g2.forEach(g => console.log('  ' + Object.values(g)[0]));

    await conn.end();

    if (fallos) {
        console.error(`\n${fallos} paso(s) fallaron. Revisa los mensajes de arriba.`);
        process.exit(1);
    }

    console.log('\n' + '='.repeat(70));
    console.log(' LISTO. Agrega estas dos lineas a backend/.env:');
    console.log('='.repeat(70));
    console.log(`\n  DB_ADMIN_USER=${USUARIO_TENANT_ADMIN}`);
    console.log(`  DB_ADMIN_PASSWORD=${nuevaPass}`);
    console.log('\n  (guardala en un gestor de contrasenas: no se vuelve a mostrar)');
    console.log('\n Ahora verifica con:  node tools/check-grants.js\n');
})().catch(e => { console.error('\nError inesperado:', e.message); process.exit(1); });
