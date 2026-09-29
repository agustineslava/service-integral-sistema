/**
 * Comprobacion de privilegios reales del usuario de MySQL de la aplicacion.
 *   node tools/check-grants.js
 *
 * Determina si el usuario puede (a) crear bases para los tenants futuros
 * y (b) restaurar backups. Sin esto, la verificacion de restauracion
 * no puede funcionar y la F1 no podra crear bases por empresa.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    });

    const [[u]] = await c.query('SELECT CURRENT_USER() AS effective, USER() AS origen');
    console.log(`Usuario: ${u.effective}`);

    console.log('\n=== PRIVILEGIOS GLOBALES ===');
    const [grants] = await c.query('SHOW GRANTS FOR CURRENT_USER');
    grants.forEach(g => console.log('  ' + Object.values(g)[0]));

    const [privs] = await c.query(`SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES
                                    WHERE GRANTEE LIKE CONCAT(REPLACE(CURRENT_USER(),'@','@'),'%')`);
    const tipos = privs.map(p => p.PRIVILEGE_TYPE);

    console.log('\n=== PRIVILEGIOS QUE IMPORTAN ===');
    const requeridos = [
        ['PROCESS',          'dump de tablespaces (evitable con --no-tablespaces)'],
        ['LOCK TABLES',      'consistencia del dump (evitable con --single-transaction)'],
        ['CREATE',           'CREAR BASES - indispensable para multi-tenant'],
        ['DROP',             'borrar bases de tenants + limpiar verificacion'],
        ['SELECT',           'leer datos'],
        ['INSERT,UPDATE,DELETE', 'operar la app'],
        ['CREATE ROUTINE',   'rutinas almacenadas'],
        ['EVENT',            'eventos programados']
    ];
    for (const [tipo, nota] of requeridos) {
        console.log(`  ${tipo.padEnd(22)} ${tipos.includes(tipo) ? 'TIENE' : '--- NO TIENE ---'}  (${nota})`);
    }

    console.log('\n=== PRUEBA REAL: crear y borrar una base ===');
    const prueba = 'SI_prueba_privilegios';
    try {
        await c.query(`DROP DATABASE IF EXISTS \`${prueba}\``);
        await c.query(`CREATE DATABASE \`${prueba}\``);
        console.log('  CREATE DATABASE: FUNCIONA');
        await c.query(`DROP DATABASE \`${prueba}\``);
        console.log('  DROP DATABASE:   FUNCIONA');
    } catch (e) {
        console.log(`  FALLO: ${e.message}`);
        console.log('\n  >> El usuario NO puede crear bases.');
        console.log('  >> Esto BLOQUEA la arquitectura multi-tenant y la verificacion de restore.');
    }

    await c.end();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
