/**
 * F0 - Cierra los dos pendientes de la fase, en el orden correcto.
 *
 *   node tools/setup-f0-db.js
 *
 * 1) Crea si_tenant_admin con permiso de crear/borrar las bases por empresa.
 *    Sin esto no hay multi-tenant posible (la app no puede CREATE DATABASE).
 *    Tambien le da ALL sobre la central (`DB_CENTRAL_NAME`) y, si el `.env`
 *    trae `DB_NAME` (instalacion legada), permisos explicitos sobre esa base
 *    (empresa #1) para no romperla. Una plataforma nueva no menciona bases de
 *    cliente. Ver `docs/plan-desacople-db-name.md`.
 *
 * 2) Rota la contrasena del usuario de la aplicacion, porque quedo en texto
 *    plano en logs que SI fueron subidos a GitHub.
 *
 * 3) Actualiza backend/.env de forma atomica, preservando todo lo demas.
 *
 * Orden importa: primero los privilegios (con la contrasena vieja todavia
 * valida), despues la rotacion. Asi nunca queda un momento sin acceso.
 *
 * Requiere un usuario ADMINISTRADOR de MySQL (root). No uses el de la app.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUTA_ENV = path.join(__dirname, '..', '.env');
const APP_USER = process.env.DB_USER || 'service_integral_app';
// El admin sale de DB_ADMIN_USER (lo escribe este mismo script); el default es
// el historico. Las instalaciones nuevas ponen DB_ADMIN_USER=aexia_admin.
const TENANT_ADMIN = process.env.DB_ADMIN_USER || 'si_tenant_admin';
const { patronDeBase, verificarPrefijoTenant } = require('../src/db/permisos');
const { nombreCentral } = require('../src/db/conexiones');
const PREFIJO_TENANT = verificarPrefijoTenant();
const PATRON_TENANT = patronDeBase(PREFIJO_TENANT);
// `DB_NAME` es la base de la empresa #1 LEGADA, no la plataforma. F0 ya no la
// trata como central: la central sale de `DB_CENTRAL_NAME` via `nombreCentral()`.
// Si `DB_NAME` existe (instalacion actual) igual se le dan permisos, para no
// romperla. Ver `docs/plan-desacople-db-name.md`.
const DB_LEGADO = process.env.DB_NAME || null;

function preguntar(prompt, { oculto = false } = {}) {
    return new Promise((resolve) => {
        process.stdout.write(prompt);
        if (!oculto) {
            const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
            rl.question('', (r) => { rl.close(); resolve(r.trim()); });
            return;
        }
        const stdin = process.stdin;
        let buf = '';
        const onData = (chunk) => {
            for (const ch of chunk.toString('utf8')) {
                if (ch === '\r' || ch === '\n') {
                    stdin.setRawMode(false); stdin.pause();
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    return resolve(buf);
                }
                if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
                if (ch === '\u007F' || ch === '\b') buf = buf.slice(0, -1);
                else buf += ch;
            }
        };
        // Soporte para stdin no interactivo (pipe): leer todo de una
        if (!stdin.isTTY) {
            let data = '';
            stdin.setEncoding('utf8');
            stdin.on('data', (d) => { data += d; });
            stdin.on('end', () => resolve(data.split(/\r?\n/)[0].trim()));
            return;
        }
        stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
    });
}

/** Reescribe .env preservando el resto, y solo toca las claves indicadas. */
function actualizarEnv(cambios) {
    const original = fs.readFileSync(RUTA_ENV, 'utf8');
    const lineas = original.split(/\r?\n/);
    const vistos = new Set();
    const salida = lineas.map((l) => {
        const m = l.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (m && Object.prototype.hasOwnProperty.call(cambios, m[1])) {
            vistos.add(m[1]);
            return `${m[1]}=${cambios[m[1]]}`;
        }
        return l;
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

/**
 * Arma la lista de privilegios de F0. Es PURA: no toca MySQL ni el .env, asi
 * que se puede probar sin root y sin escribir nada.
 *
 *   - la base central sale de `nombreCentral()` (DB_CENTRAL_NAME), nunca de DB_NAME;
 *   - las bases de empresa, por el patron del prefijo (`PREFIJO_TENANT` + `%`);
 *   - `DB_NAME` solo entra como LEGADO (empresa #1), y solo si existe.
 */
function construirPasos({ passTenantAdmin, central = nombreCentral(), dbLegado = DB_LEGADO } = {}) {
    const pasos = [
        // OJO: con CREATE USER IF NOT EXISTS, si el usuario ya existe MySQL NO
        // cambia la contrasena. Si despues igual escribieramos passTenantAdmin
        // en el .env, quedaria una contrasena que no es la real. Por eso se
        // separa: crear si falta, y ALTER USER para fijar la contrasena.
        [`crear usuario ${TENANT_ADMIN} (si falta)`,
         `CREATE USER IF NOT EXISTS '${TENANT_ADMIN}'@'localhost'`],
        [`fijar la contrasena de ${TENANT_ADMIN}`,
         `ALTER USER '${TENANT_ADMIN}'@'localhost' IDENTIFIED BY '${passTenantAdmin}'`],
        ['permitir administrar la base central',
         `GRANT ALL PRIVILEGES ON \`${central}\`.* TO '${TENANT_ADMIN}'@'localhost'`],
        [`permitir crear/borrar bases de clientes (${PREFIJO_TENANT}*)`,
         `GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE VIEW, SHOW VIEW, TRIGGER ON \`${PATRON_TENANT}%\`.* TO '${TENANT_ADMIN}'@'localhost'`]
    ];

    // Compatibilidad con la instalacion actual: la base legada no matchea el
    // patron de empresas, asi que recibe sus permisos EXPLICITOS. En una
    // plataforma nueva (sin DB_NAME) no se menciona ninguna base de cliente.
    if (dbLegado) {
        pasos.push(
            ['legado: administrar la base de la empresa #1',
             `GRANT ALL PRIVILEGES ON \`${dbLegado}\`.* TO '${TENANT_ADMIN}'@'localhost'`],
            ['legado: base temporal de verificacion de restores',
             `GRANT ALL PRIVILEGES ON \`${dbLegado}_verificacion\`.* TO '${TENANT_ADMIN}'@'localhost'`]
        );
    }

    pasos.push(['recargar privilegios', 'FLUSH PRIVILEGES']);
    return pasos;
}

(async () => {
    // Al importarlo (tests del constructor) no se ejecuta nada.
    if (require.main !== module) return;

    console.log('='.repeat(70));
    console.log(' F0 - CIERRE: PRIVILEGIOS MULTI-TENANT + ROTACION DE CONTRASENA');
    console.log('='.repeat(70));
    console.log(` Usuario de la aplicacion : ${APP_USER}`);
    console.log(` Prefijo de las empresas  : ${PREFIJO_TENANT}`);
    console.log(` Base central             : ${nombreCentral()}`);
    if (DB_LEGADO) console.log(` Base empresa #1 (legado) : ${DB_LEGADO}`);
    console.log('='.repeat(70) + '\n');

    if (DB_LEGADO) {
        console.log(' [!] DB_NAME es legado: es la base de la empresa #1, no la plataforma.');
        console.log('     F0 le da permisos para no romper la instalacion actual.');
        console.log('     Las empresas nuevas van por:  npm run importar-empresa -- --nombre ... --slug ... --base ...\n');
    }

    const passTenantAdmin = crypto.randomBytes(24).toString('base64url').slice(0, 28);
    const pasos = construirPasos({ passTenantAdmin });

    // --- SIMULACION: no toca MySQL ni el .env ---------------------------
    if (process.argv.includes('--dry-run')) {
        console.log('[SIMULACION] no se conecta a MySQL ni se escribe el .env\n');
        console.log('--- PASO 1: privilegios multi-tenant (se aplicarian) ---');
        for (const [desc, sql] of pasos) {
            console.log(`  [ ]     ${desc}`);
            console.log(`          ${sql.replace(passTenantAdmin, '********')}`);
        }
        console.log('\n--- PASO 3: claves que se escribirian en .env ---');
        console.log('  [ ]     DB_ADMIN_USER, DB_ADMIN_PASSWORD (y DB_PASSWORD si se rota)');
        console.log('\n(dry-run) no se ejecuto nada.\n');
        return;
    }

    const rootUser = (await preguntar('Usuario administrador de MySQL [root]: ')) || 'root';
    const rootPass = await preguntar(`Contrasena de ${rootUser}: `, { oculto: true });

    let conn;
    try {
        conn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || '3306',
            user: rootUser, password: rootPass
        });
    } catch (e) {
        console.error(`\nNo se pudo conectar como ${rootUser}: ${e.message}`);
        process.exit(1);
    }
    const [[info]] = await conn.query('SELECT VERSION() AS v, CURRENT_USER() AS u');
    console.log(`\nConectado como ${info.u} (MySQL ${info.v})\n`);

    // ------------------------------------------------------------------
    // PASO 1 - Privilegios multi-tenant
    // ------------------------------------------------------------------
    console.log('--- PASO 1: privilegios multi-tenant ---');

    let fallos = 0;
    for (const [desc, sql] of pasos) {
        try { await conn.query(sql); console.log(`  [OK]    ${desc}`); }
        catch (e) { fallos++; console.log(`  [FALLO] ${desc}\n          ${e.message}`); }
    }

    // ------------------------------------------------------------------
    // PASO 2 - Rotacion de la contrasena de la app
    // ------------------------------------------------------------------
    console.log('\n--- PASO 2: rotacion de la contrasena de la aplicacion ---');
    console.log('  Motivo: la contrasena quedo en texto plano en logs que llegaron');
    console.log('  a GitHub (repo privado). Rotarla invalida esa copia.\n');

    const resp = (await preguntar('  Rotar ahora? [S/n]: ')).toLowerCase();
    const rotar = resp !== 'n' && resp !== 'no';

    let passAppNueva = null;
    if (rotar) {
        passAppNueva = crypto.randomBytes(18).toString('base64url').slice(0, 24);
        try {
            await conn.query(`ALTER USER '${APP_USER}'@'localhost' IDENTIFIED BY '${passAppNueva}'`);
            console.log(`  [OK]    contrasena de ${APP_USER} rotada`);
        } catch (e) {
            console.log(`  [FALLO] ${e.message}`);
            fallos++;
            passAppNueva = null;
        }
    } else {
        console.log('  [SKIP]  no se roto la contrasena (la filtrada sigue siendo valida)');
    }

    // ------------------------------------------------------------------
    // PASO 3 - Actualizar .env
    // ------------------------------------------------------------------
    console.log('\n--- PASO 3: actualizando backend/.env ---');
    const cambios = {
        DB_ADMIN_USER: TENANT_ADMIN,
        DB_ADMIN_PASSWORD: passTenantAdmin
    };
    if (passAppNueva) cambios.DB_PASSWORD = passAppNueva;

    const respaldo = actualizarEnv(cambios);
    console.log('  [OK]    .env actualizado (respaldo: ' + path.basename(respaldo) + ')');
    console.log('  Claves escritas: ' + Object.keys(cambios).join(', '));

    // ------------------------------------------------------------------
    // PASO 4 - Verificar
    // ------------------------------------------------------------------
    console.log('\n--- PASO 4: verificacion ---');

    // La app sigue leyendo la base LEGADA? (solo si existe: la plataforma
    // nueva no tiene empresa #1 que verificar).
    if (DB_LEGADO) {
        try {
            const cfg = require('dotenv').config({ path: RUTA_ENV, override: true });
            const t = await mysql.createConnection({
                host: process.env.DB_HOST || 'localhost',
                user: cfg.parsed.DB_USER || APP_USER,
                password: cfg.parsed.DB_PASSWORD,
                database: DB_LEGADO
            });
            const [[n]] = await t.query('SELECT COUNT(*) AS c FROM reparaciones');
            console.log(`  [OK]    la app conecta y lee la base legada (${n.c} filas en reparaciones)`);
            await t.end();
        } catch (e) {
            console.log(`  [FALLO] la app NO conecta a la base legada: ${e.message}`);
            fallos++;
        }
    } else {
        console.log('  [SKIP]  sin DB_NAME: no hay base de empresa #1 que verificar');
    }

    // El admin de tenants puede crear bases?
    try {
        const t = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: TENANT_ADMIN, password: passTenantAdmin
        });
        await t.query(`CREATE DATABASE IF NOT EXISTS ${PREFIJO_TENANT}prueba`);
        await t.query(`DROP DATABASE ${PREFIJO_TENANT}prueba`);
        console.log('  [OK]    si_tenant_admin puede CREATE y DROP bases de clientes');
        await t.end();
    } catch (e) {
        console.log(`  [FALLO] si_tenant_admin no puede crear bases: ${e.message}`);
        fallos++;
    }

    await conn.end();

    console.log('\n' + '='.repeat(70));
    if (fallos === 0) {
        console.log(' F0 CERRADO');
        console.log('='.repeat(70));
        console.log('\nReinicia el backend para que tome el .env nuevo:');
        console.log('   pm2 restart service-integral-backend');
        console.log('   (o cerra y volve a abrir Sistema ServiceIntegral.bat)\n');
        console.log('Verifica que el backup ande:  npm run backup');
        console.log('Y que restaure:               npm run backup:verify\n');
    } else {
        console.log(` F0 INCOMPLETO - ${fallos} verificacion(es) fallaron`);
        console.log('='.repeat(70));
        console.log('El .env fue actualizado igual. Revisa los mensajes de arriba.\n');
        process.exit(1);
    }
})().catch(e => { console.error('\nError inesperado:', e.message); process.exit(1); });

module.exports = { construirPasos };
