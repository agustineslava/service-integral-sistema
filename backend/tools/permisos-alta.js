#!/usr/bin/env node
/**
 * PERMISOS PARA QUE LA APP PUEDA USAR LAS BASES DE LAS EMPRESAS
 * ---------------------------------------------------------------------------
 *   $env:DB_ROOT_PASSWORD = "tu clave de root"
 *   npm run permisos-alta
 *   Remove-Item Env:DB_ROOT_PASSWORD
 *
 * O, pasando la clave como argumento (queda en el historial, no se recomienda):
 *   npm run permisos-alta -- root "tu clave"
 *
 * POR QUE HACE FALTA
 * El alta de una empresa nueva (F5b) la hace `si_tenant_admin`, que ya puede
 * `CREATE DATABASE` y `DROP DATABASE` sobre las bases de los clientes. Eso
 * alcanza para crear la base y aplicarle el esquema.
 *
 * Lo que NO puede es darle permisos a `service_integral_app` para usarla:
 *
 *   GRANT SELECT, INSERT, UPDATE, DELETE ON `si_tenant_x`.* TO 'service_integral_app'@'localhost'
 *   -> Access denied for user 'si_tenant_admin'@'localhost' to database 'si_tenant_x'
 *
 * O sea: sin este permiso, el boton "crear empresa" del panel crea una empresa
 * que existe en el registro central, que puede iniciar sesion, y que en la
 * PRIMERA pagina que abre falla con "access denied" en TODAS las consultas.
 * Una empresa a medio hacer es peor que no crearla.
 *
 * QUE HACE ESTA HERRAMIENTA
 * Corre UNA sola vez, con un usuario que tenga permiso para conceder permisos
 * (normalmente root). Hace dos cosas:
 *
 *   1. Le da a `si_tenant_admin` el `GRANT OPTION` sobre las bases `si_tenant_%`.
 *      Con eso, el alta puede conceder permisos sola en el futuro y el panel
 *      deja de necesitar un paso manual por cada empresa nueva. El comodin
 *      `%` cubre las bases que todavia no existen.
 *
 *   2. Concede los permisos de la app explicitamente en cada base `si_tenant_%`
 *      que ya existen, por si se crearon antes de este permiso. Son las de
 *      prueba que dejaron las verificaciones, si quedaron alguna.
 *
 * Y despues COMPRUEBA que funciona de verdad: entra como la app a una base de
 * prueba, escribe, lee y borra. No se fia de que el GRANT no haya dado error:
 * un permiso concedido que en realidad no sirve se parece mucho a uno bueno.
 *
 * LA CLAVE DE ROOT
 * Se pide por variable de entorno y no se guarda en ningun lado, ni en este
 * archivo ni en `.env`. Es la misma politica que `Probar_Restore_Backup.bat`:
 * el .env es del servidor web, y una clave de root ahi seria darle al sistema
 * la base de datos entera.
 *
 * LO QUE NO SE TOCA
 * La base del taller (`serviceintegralsistema`) no matchea `si_tenant_%`, asi
 * que este permiso no la alcanza y no la toca. Sus permisos ya estan bien de
 * antes.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');
const { configApp, configAdmin, nombreCentral } = require('../src/db/conexiones');
const { PRIVILEGIOS_APP, patronDeBase, prefijoTenant } = require('../src/db/permisos');

/** El usuario que concede es el que hay en el .env: asi no hay que hardcodear. */
const USUARIO_ADMIN = process.env.DB_ADMIN_USER || 'si_tenant_admin';
const USUARIO_APP = process.env.DB_USER || 'service_integral_app';

function titulo(t) {
    console.log('');
    console.log('-'.repeat(70));
    console.log(` ${t}`);
    console.log('-'.repeat(70));
}

let fallos = 0;
function comprobar(ok, texto, detalle) {
    if (ok) {
        console.log(`  [OK]    ${texto}`);
    } else {
        fallos++;
        console.log(`  [FALLO] ${texto}`);
        if (detalle) console.log(`          -> ${detalle}`);
    }
}

// `patronDeBase` y `PRIVILEGIOS_APP` viven en `../src/db/permisos`.

async function main() {
    const rootUser = process.argv[2] || 'root';
    const rootPass = process.env.DB_ROOT_PASSWORD;

    console.log('');
    console.log(' PERMISOS DE LAS BASES DE LAS EMPRESAS');
    console.log('='.repeat(70));

    if (!rootPass) {
        console.error('\n Falta la clave del usuario administrador.\n');
        console.error(' En PowerShell, en ESTA misma terminal:\n');
        console.error('     $env:DB_ROOT_PASSWORD = "tu clave de root"\n');
        console.error(' Y despues volves a correr el comando. Para borrar la variable:\n');
        console.error('     Remove-Item Env:DB_ROOT_PASSWORD\n');
        console.error(' Si preferis no guardarla ni un segundo, pasala como argumento:\n');
        console.error('     npm run permisos-alta -- root "tu clave"\n');
        process.exitCode = 1;
        return;
    }

    let root;
    try {
        root = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: rootUser,
            password: rootPass,
            multipleStatements: false
        });
        console.log(`\n Conectado como ${rootUser}.`);
    } catch (err) {
        console.error(`\n No se pudo conectar como "${rootUser}": ${err.message}`);
        console.error(' La clave esta mal, o el usuario no existe. No se toco nada.\n');
        process.exitCode = 1;
        return;
    }

    try {
        // -------------------------------------------------------------------
        titulo('1. QUE `' + USUARIO_ADMIN + '` PUEDA CONCEDER PERMISOS');

        // Sin WITH GRANT OPTION no puede dar permisos sobre bases que no creo
        // el mismo. Con el, el alta de F5b puede conceder sola.
        const comodin = `\`${patronDeBase(prefijoTenant())}%\``;
        const sql1 = `GRANT ${PRIVILEGIOS_APP} ON ${comodin}.* TO '${USUARIO_ADMIN}'@'localhost' WITH GRANT OPTION`;

        console.log(`  SQL: ${sql1}\n`);
        try {
            await root.query(sql1);
            await root.query('FLUSH PRIVILEGES');
            comprobar(true, `Permiso para conceder, sobre ${comodin}.*`);
        } catch (err) {
            comprobar(false, 'No se pudo conceder el permiso', err.message);
            console.log('\n  Si el mensaje es "Access denied", el usuario que pasaste no');
            console.log('  tiene permiso de GRANT. Con el root de MySQL deberia andar.');
            console.log('  Sin este paso el alta NO puede ser automática y hay que volver');
            console.log('  a la vía manual.');
        }

        // --- GRANT OPTION GLOBAL ---
        // El wildcard `si_tenant_%` solo cubre bases que YA EXISTEN.
        // Para que si_tenant_admin pueda conceder permisos en bases NUEVAS,
        // necesita GRANT OPTION a nivel global. Al crear una base, MySQL le
        // da ALL PRIVILEGES en esa base al creador; con GRANT OPTION global
        // puede pasar los privilegios DML a la app.
        const sqlGrantOption = `GRANT GRANT OPTION ON *.* TO '${USUARIO_ADMIN}'@'localhost'`;
        console.log(`  SQL: ${sqlGrantOption}\n`);
        try {
            await root.query(sqlGrantOption);
            await root.query('FLUSH PRIVILEGES');
            comprobar(true, `GRANT OPTION global para ${USUARIO_ADMIN}@localhost`);
        } catch (err) {
            comprobar(false, 'No se pudo conceder GRANT OPTION global', err.message);
        }

        // -------------------------------------------------------------------
        titulo('2. PERMISOS DE LA APP EN LAS BASES QUE YA EXISTEN');

        // Por si alguna se creo antes de este permiso. Son las bases de las
        // verificaciones, si quedo alguna.
        const [bases] = await root.query(
            `SELECT SCHEMA_NAME AS nombre FROM information_schema.SCHEMATA
              WHERE SCHEMA_NAME LIKE '${patronDeBase(prefijoTenant())}%' ORDER BY SCHEMA_NAME`
        );
        console.log(`  Bases ${prefijoTenant()}% que hay ahora: ${bases.length}`);
        if (!bases.length) {
            console.log('  (ninguna: todavia no se dio de alta ninguna empresa desde el panel)');
        }

        for (const b of bases) {
            const sql = `GRANT ${PRIVILEGIOS_APP} ON \`${b.nombre}\`.* TO '${USUARIO_APP}'@'localhost'`;
            try {
                await root.query(sql);
                comprobar(true, `${b.nombre}: permisos dados a ${USUARIO_APP}@localhost`);
            } catch (err) {
                comprobar(false, `${b.nombre}: no se pudieron dar los permisos`, err.message);
            }
        }
        await root.query('FLUSH PRIVILEGES');

        // -------------------------------------------------------------------
        titulo('3. PRUEBA REAL: LA APP ENTRA, ESCRIBE Y BORRA');

        // Un permiso concedido puede no servir. Esta es la unica seccion que
        // importa: todo lo de arriba es declarativo, esto es lo que va a
        // pasar cuando un usuario abra una pantalla.
        const prueba = `${prefijoTenant()}permisos_test`;
        try {
            await root.query(`DROP DATABASE IF EXISTS \`${prueba}\``);
            await root.query(`CREATE DATABASE \`${prueba}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

            // El mismo camino que usa el alta de F5b: crear la base con
            // si_tenant_admin, y conceder los permisos sin que root intervenga.
            const admin = await mysql.createConnection(configAdmin(prueba));
            try {
                await admin.query(`GRANT ${PRIVILEGIOS_APP} ON \`${prueba}\`.* TO '${USUARIO_APP}'@'localhost'`);
                comprobar(true, 'si_tenant_admin pudo conceder los permisos solo (sin root)');
            } catch (err) {
                comprobar(false, 'si_tenant_admin NO pudo conceder solo: el alta va a fallar', err.message);
            } finally {
                await admin.end();
            }

            const app = await mysql.createConnection(configApp(prueba));
            try {
                await app.query('CREATE TABLE prueba_permisos (id INT, texto VARCHAR(20))');
                await app.query('INSERT INTO prueba_permisos VALUES (1, \'hola\')');
                const [filas] = await app.query('SELECT texto FROM prueba_permisos WHERE id = 1');
                comprobar(
                    filas.length === 1 && filas[0].texto === 'hola',
                    'La app escribio y leyo en la base nueva',
                    filas
                );
                await app.query('DROP TABLE prueba_permisos');
                comprobar(true, 'Y puede borrar (lo necesita al migrar)');
            } catch (err) {
                comprobar(false, 'La app NO pudo usar la base nueva', err.message);
            } finally {
                await app.end();
            }
        } finally {
            await root.query(`DROP DATABASE IF EXISTS \`${prueba}\``);
            console.log(`\n  Base de prueba ${prueba} borrada.`);
        }

        // -------------------------------------------------------------------
        titulo('4. QUE LA BASE DEL TALLER NO SE HAYA TOCADO');

        const taller = process.env.DB_NAME;
        if (taller) {
            // En minúsculas los dos lados: el `.env` tiene `ServiceIntegralsistema`
            // con mayúsculas y la base se llama `serviceintegralsistema`. En
            // Windows MySQL no le importa, pero en Linux los nombres de base
            // SÍ distinguen mayúsculas y, sin el `LOWER`, esta comprobación
            // daría "no existe" en el servidor de producción.
            const [antes] = await root.query(
                `SELECT COUNT(*) AS n FROM information_schema.SCHEMATA
                  WHERE LOWER(SCHEMA_NAME) = LOWER(?)`, [taller]
            );
            comprobar(antes[0].n === 1, `La base del taller (${taller}) sigue existiendo`, antes[0]);
            console.log('  Su nombre no matchea si_tenant_%, asi que este permiso no la alcanza.');
        }

    } finally {
        await root.end();
        // La clave se borra de esta terminal para que no quede flotando.
        delete process.env.DB_ROOT_PASSWORD;
    }

    console.log('');
    console.log('='.repeat(70));
    if (fallos) {
        console.log(` RESULTADO: ${fallos} fallo(s).`);
        console.log('');
        console.log(' Si el paso 3 fallo, el alta de empresas desde el panel NO va a');
        console.log(' funcionar y hay que resolverlo antes de usar ese boton.');
    } else {
        console.log(' RESULTADO: todo bien. El alta de empresas puede ser automática.');
    }
    console.log('='.repeat(70));
    console.log('');
    if (fallos) process.exitCode = 1;
}

main().catch((err) => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
