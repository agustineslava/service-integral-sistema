#!/usr/bin/env node
/**
 * SUPERADMIN DE LA PLATAFORMA
 * ---------------------------------------------------------------------------
 *   npm run superadmin                    crear un SuperAdmin (pregunta email y clave)
 *   npm run superadmin -- --sobrescribir  reemplazar la clave de uno existente
 *
 * POR QUE EXISTE
 * El instalador de la central (f1-setup) crea el PRIMER SuperAdmin, pero deja
 * de servir para el segundo: aplicar migraciones y tocar permisos de MySQL
 * para agregar una persona no tiene sentido. Sin esta herramienta, sumar un
 * SuperAdmin significaba escribir un INSERT y un hash de bcrypt a mano.
 *
 * QUE HACE
 * Pide el email y la contrasena de forma interactiva. La clave NUNCA viaja por
 * argumentos de linea de comandos ni se imprime: se lee oculta y se guarda
 * como hash (bcrypt, costo 10), igual que en f1-setup. El usuario queda con
 * empresa_id NULL, nombre 'SuperAdmin', rol 'SUPERADMIN' y activo = 1.
 *
 * SEGURIDAD
 *   - No pisa un SuperAdmin existente salvo con --sobrescribir.
 *   - Si el email ya existe pero NO es un SuperAdmin, se niega a tocarlo:
 *     el email es unico en toda la plataforma y podria ser de una empresa.
 *   - La clave no se registra ni se muestra; la verificacion se hace
 *     comparando el hash, no releyendo la clave.
 *
 * Sobre DEBE_CAMBIAR_PASSWORD: al sobrescribir se limpia a 0 (la clave que
 * acaba de escribirse es definitiva, no temporal).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const bcrypt = require('bcryptjs');
const { conectarApp, nombreCentral } = require('../src/db/conexiones');

const SOBRESCRIBIR = process.argv.includes('--sobrescribir') || process.argv.includes('--force');

// --------------------------------------------------------------------------
// Entrada interactiva (misma que usa el instalador; se exporta para no
// tener dos versiones con comportamientos distintos).
//
// Con una terminal real: email con readline y la clave en modo oculto (no se
// ecoa). Con la entrada redirigida (pipe, pruebas, CI) se lee todo una sola
// vez y se reparte por linea: crear un readline nuevo por pregunta perdia las
// lineas que Node ya habia bufferizado en el primero.
// --------------------------------------------------------------------------
let colaEntrada = null;

function lineasDeStdin() {
    if (colaEntrada) return colaEntrada;
    try {
        colaEntrada = require('fs').readFileSync(0, 'utf8').split(/\r?\n/);
    } catch {
        colaEntrada = [];
    }
    return colaEntrada;
}

function preguntar(texto, { oculto = false } = {}) {
    return new Promise((resolve) => {
        process.stdout.write(texto);

        if (!process.stdin.isTTY) {
            resolve((lineasDeStdin().shift() || '').trim());
            return;
        }

        if (!oculto) {
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

// --------------------------------------------------------------------------
// Logica reutilizable de creacion (la usa tambien f1-setup)
// --------------------------------------------------------------------------

/** Email normalizado (minusculas, sin espacios): es como se guarda y se busca. */
function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
}

/**
 * Usuario global por email, sin importar el rol ni la empresa.
 * Devuelve la fila o null.
 */
async function buscarPorEmail(con, email) {
    const [filas] = await con.query(
        `SELECT id, empresa_id, email, nombre, rol, activo
           FROM usuarios_globales WHERE email = ?`,
        [normalizarEmail(email)]
    );
    return filas.length ? filas[0] : null;
}

/**
 * Crea un SuperAdmin. Mismos campos y mismo hash que f1-setup:
 * empresa_id NULL, nombre 'SuperAdmin', rol 'SUPERADMIN', activo 1.
 */
async function crearSuperadmin(con, email, password) {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await con.query(
        `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol, activo)
         VALUES (NULL, ?, ?, 'SuperAdmin', 'SUPERADMIN', 1)`,
        [normalizarEmail(email), hash]
    );
    return { id: r.insertId };
}

/**
 * Reemplaza la clave de un SuperAdmin existente y lo reactiva.
 * No cambia email ni nombre. Falla en silencio si el id no es SUPERADMIN.
 */
async function actualizarSuperadmin(con, id, password) {
    const hash = await bcrypt.hash(password, 10);
    await con.query(
        `UPDATE usuarios_globales
            SET password_hash = ?, activo = 1, debe_cambiar_password = 0
          WHERE id = ? AND rol = 'SUPERADMIN'`,
        [hash, id]
    );
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
async function main() {
    const CENTRAL = nombreCentral();

    console.log('='.repeat(70));
    console.log(' SUPERADMIN DE LA PLATAFORMA');
    console.log('='.repeat(70));
    console.log(` Base central : ${CENTRAL}`);
    console.log(` Modo         : ${SOBRESCRIBIR ? 'sobrescribir la clave de uno existente' : 'crear (no pisa uno existente)'}`);
    console.log('='.repeat(70) + '\n');

    const email = normalizarEmail(await preguntar('Email del SuperAdmin: '));
    if (!email || !email.includes('@')) {
        console.error('  [FALLO] email invalido');
        process.exitCode = 1;
        return;
    }

    const password = await preguntar('Contrasena: ', { oculto: true });
    if (password.length < 8) {
        console.error('  [FALLO] la contrasena debe tener al menos 8 caracteres');
        process.exitCode = 1;
        return;
    }

    const repetida = await preguntar('Repetir contrasena: ', { oculto: true });
    if (repetida !== password) {
        console.error('  [FALLO] las contrasenas no coinciden');
        process.exitCode = 1;
        return;
    }

    let con;
    try {
        con = await conectarApp(CENTRAL);
    } catch (e) {
        console.error(`  [FALLO] no se pudo conectar a ${CENTRAL}: ${e.message}`);
        process.exitCode = 1;
        return;
    }

    try {
        const existente = await buscarPorEmail(con, email);

        // El email es unico en TODA la central. Si ya lo usa una cuenta que no
        // es SuperAdmin (de una empresa, por ejemplo), no se toca: pisarla
        // dejaria a esa persona sin poder entrar.
        if (existente && existente.rol !== 'SUPERADMIN') {
            console.error(`  [FALLO] ${email} ya pertenece a otra cuenta (rol ${existente.rol}, empresa ${existente.empresa_id ?? '-'}).`);
            console.error('          No se toca: el email es unico en la plataforma.');
            process.exitCode = 1;
            return;
        }

        if (existente && !SOBRESCRIBIR) {
            console.log(`  [!] Ya existe un SuperAdmin con ${email} (id ${existente.id}). No se modifico.`);
            console.log('      Para reemplazar su contrasena:');
            console.log('          npm run superadmin -- --sobrescribir');
            process.exitCode = 1;
            return;
        }

        if (existente) {
            await actualizarSuperadmin(con, existente.id, password);
            console.log(`  [OK] contrasena de ${email} actualizada (id ${existente.id})`);
        } else {
            const { id } = await crearSuperadmin(con, email, password);
            console.log(`  [OK] SuperAdmin ${email} creado (id ${id}, empresa_id NULL)`);
        }

        // Verificacion sin volver a tocar la clave: se compara el hash guardado
        // contra la clave que se acaba de escribir. Nunca se imprime la clave.
        const guardado = await buscarPorEmail(con, email);
        const [filas] = await con.query('SELECT password_hash FROM usuarios_globales WHERE id = ?', [guardado.id]);
        const coincide = await bcrypt.compare(password, filas[0].password_hash);
        const correcto = coincide
            && guardado.rol === 'SUPERADMIN'
            && guardado.empresa_id === null
            && guardado.activo === 1;

        console.log(`  [${correcto ? 'OK' : 'FALLO'}] verificacion: rol=${guardado.rol}, empresa_id=${guardado.empresa_id}, hash valida=${coincide}`);
        if (!correcto) process.exitCode = 1;
    } finally {
        await con.end();
    }
}

if (require.main === module) {
    main().catch((e) => {
        console.error('\nError inesperado:', e.message);
        process.exit(1);
    });
}

module.exports = { preguntar, normalizarEmail, buscarPorEmail, crearSuperadmin, actualizarSuperadmin };
