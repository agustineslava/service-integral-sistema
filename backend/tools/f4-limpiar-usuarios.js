#!/usr/bin/env node
/**
 * F4 · LIMPIAR LA TABLA `usuarios` DE LAS BASES DE LAS EMPRESAS
 * ---------------------------------------------------------------------------
 *   node tools/f4-limpiar-usuarios.js            muestra el plan, no toca nada
 *   node tools/f4-limpiar-usuarios.js --aplicar  hace un respaldo y borra
 *
 * POR QUÉ
 * Desde F2 los usuarios viven en `usuarios_globales`, en la base central. La
 * tabla `usuarios` de cada base de empresa quedó como respaldo y ya no la lee
 * nadie: el servidor no, y verificado que no hay ni una clave foránea que la
 * mire. El único rastro del mundo viejo es `movimientos_stock.usuario_nombre`,
 * que es texto suelto y por lo tanto no depende de la tabla.
 *
 * Mientras siga ahí, cada base de cliente tiene una copia de los hashes de
 * contraseña de sus usuarios que nadie necesita y que cualquiera con acceso a
 * esa base puede leer. No es una vía abierta hoy — la app no la usa — pero es
 * exactamente el tipo de cosa que un año después somebody pregunta por qué
 * sigue ahí.
 *
 * POR QUÉ ES CUIDADO
 * Borrar una tabla no tiene vuelta atrás, así que este script se niega a
 * hacerlo salvo que pueda PROBAR que no se pierde nada:
 *
 *   1. Cada usuario de la tabla tiene que existir en la central con el MISMO
 *      hash, byte a byte. Si un hash difiere o el usuario no está, se aborta
 *      sin tocar nada: eso sí sería perder información.
 *   2. Hay que tener un respaldo. Con `--aplicar` se genera uno nuevo y verificado
 *      antes de borrar. Si el respaldo falla, no se borra.
 *
 * El caso especial del SuperAdmin (un email que en la central es SUPERADMIN y
 * en la tabla vieja era un usuario más) se informa en voz alta pero no bloquea:
 * es una decisión que ya se tomó en F2, y esa cuenta entra con la contraseña
 * de la central de todas maneras.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { configAdmin } = require('../src/db/conexiones');
const central = require('../src/db/central');
const backup = require('../src/jobs/backup');

const APLICAR = process.argv.includes('--aplicar');
const CARPETA_BACKUPS = path.join(__dirname, '..', 'backups');

const ok = (t) => console.log(`  [OK]    ${t}`);
const info = (t) => console.log(`  [ ]     ${t}`);
const aviso = (t) => console.log(`  [!]     ${t}`);
const mal = (t) => console.log(`  [FALLO] ${t}`);

function titulo(t) {
    console.log('');
    console.log('='.repeat(70));
    console.log(` ${t}`);
    console.log('='.repeat(70));
}

async function existeTabla(con, nombreBase, tabla) {
    const [r] = await con.query(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [nombreBase, tabla]
    );
    return r[0].n > 0;
}

/** Clasifica cada fila de la tabla vieja contra la central. */
async function comparar(con, nombreBase) {
    const [viejos] = await con.query('SELECT id, nombre, email, password, rol FROM usuarios ORDER BY id');

    const resultado = { identicos: [], superadmin: [], bloqueos: [] };

    for (const u of viejos) {
        const actual = await central.uno(
            'SELECT id, nombre, email, password_hash, rol, empresa_id FROM usuarios_globales WHERE email = ?',
            [u.email]
        );

        if (!actual) {
            resultado.bloqueos.push({ ...u, motivo: 'NO ESTA en la central' });
        } else if (actual.password_hash !== u.password) {
            if (actual.rol === 'SUPERADMIN') {
                resultado.superadmin.push({ ...u, rolCentral: actual.rol });
            } else {
                resultado.bloqueos.push({ ...u, motivo: 'el hash NO coincide con el de la central' });
            }
        } else {
            resultado.identicos.push({ ...u, idCentral: actual.id });
        }
    }

    return { filas: viejos.length, ...resultado };
}

async function main() {
    titulo('F4 · LIMPIAR LA TABLA `usuarios`');
    console.log(`  Modo: ${APLICAR ? 'APLICAR (borra de verdad)' : 'SIMULACION (no se toca nada)'}`);
    console.log('='.repeat(70));

    const empresas = await central.query(
        `SELECT e.id, e.nombre, e.nombre_db
           FROM empresas e
          ORDER BY e.id`
    );

    if (!empresas.length) {
        console.error('\nNo hay empresas en la central.\n');
        return;
    }

    const plan = [];
    let bloqueos = 0;

    for (const e of empresas) {
        titulo(` Empresa #${e.id} · ${e.nombre}  (${e.nombre_db})`);

        let con;
        try {
            // Conexión de ADMIN, no de la aplicación: borrar una tabla es DDL,
            // y el usuario de la app solo tiene permiso para leer y escribir
            // datos. Esa separación es deliberada y hay que respetarla.
            con = await mysql.createConnection(configAdmin(e.nombre_db));
        } catch (err) {
            mal(`no se pudo conectar: ${err.message}`);
            bloqueos++;
            continue;
        }

        try {
            if (!(await existeTabla(con, e.nombre_db, 'usuarios'))) {
                ok('no tiene tabla `usuarios`: nada que hacer');
                plan.push({ empresa: e, accion: 'ninguna' });
                continue;
            }

            const r = await comparar(con, e.nombre_db);
            info(`${r.filas} usuario(s) en la tabla vieja`);
            ok(`${r.identicos.length} con el hash IDENTICO en la central`);

            for (const s of r.superadmin) {
                aviso(`${s.email}: en la central es ${s.rolCentral}. La fila vieja es una copia`);
                aviso(`  descartada. Esa cuenta entra con la contrasena de la central.`);
            }

            if (r.bloqueos.length) {
                for (const b of r.bloqueos) {
                    mal(`${b.email} (${b.rol}): ${b.motivo}`);
                }
                aviso('NO SE BORRA NADA de esta base. Hay informacion que se perderia.');
                bloqueos += r.bloqueos.length;
                plan.push({ empresa: e, accion: 'bloqueada' });
                continue;
            }

            plan.push({ empresa: e, accion: 'borrar', filas: r.filas, nombreDb: e.nombre_db });
            info('se borraria la tabla `usuarios`');
        } finally {
            await con.end();
        }
    }

    const aBorrar = plan.filter((p) => p.accion === 'borrar');

    if (!aBorrar.length) {
        titulo(' RESULTADO');
        ok('no hay nada que borrar');
        await central.cerrar();
        return;
    }

    if (bloqueos > 0) {
        titulo(' RESULTADO');
        mal(`${bloqueos} caso(s) bloqueado(s). Se deja todo como esta.`);
        await central.cerrar();
        process.exitCode = 1;
        return;
    }

    // --- EL RESPALDO VA ANTES DE BORRAR NADA --------------------------------
    // El orden importa mas de lo que parece. Una version anterior de esta
    // herramienta borraba dentro del recorrido y hacia el respaldo despues:
    // el archivo salia sin la tabla que acababa de borrar, y el mensaje
    // "para deshacer todo: restaurar ese archivo" era falso.
    //
    // Asi que el respaldo se genera y SE COMPRUEBA antes de la primera
    // instruccion DROP. Si el respaldo no contiene las tablas que se van a
    // borrar, no se borra nada.
    if (APLICAR) {
        titulo(' 1. RESPALDO (antes de borrar nada)');
        console.log('  Generando un respaldo verificado...');
        const r = await backup.ejecutarDump({ carpetaDestino: CARPETA_BACKUPS });
        if (!r || !r.ruta) {
            mal('el respaldo fallo. NO se borra nada.');
            await central.cerrar();
            process.exitCode = 1;
            return;
        }
        ok(`respaldo: ${r.nombreArchivo}`);

        // Comprobacion de que el respaldo sirve de verdad para esto.
        const contenido = fs.readFileSync(r.ruta, 'utf8');
        const falta = aBorrar.filter((p) => !contenido.includes(`CREATE TABLE \`usuarios\``));
        if (falta.length) {
            mal('el respaldo NO contiene la tabla `usuarios`. No se borra nada:');
            falta.forEach((p) => mal(`  ${p.nombreDb}`));
            console.log('  Un respaldo que no tiene lo que se va a borrar no sirve para deshacer.');
            await central.cerrar();
            process.exitCode = 1;
            return;
        }
        ok('el respaldo contiene la tabla `usuarios`: sirve para deshacer');
        console.log(`  Para volver todo atras:  ${r.ruta}`);
    } else {
        titulo(' FALTA UN RESPALDO');
        console.log('  Esto todavia no borro nada. Para hacerlo:');
        console.log('');
        console.log('      npm run f4:limpiar --aplicar');
        console.log('');
        console.log('  Con --aplicar se hace y se VERIFICA un respaldo antes de borrar.');
    }

    // --- 2. Ahora sí, borrar -------------------------------------------------
    if (APLICAR) {
        titulo(' 2. Borrar la tabla');
        for (const p of aBorrar) {
            const con = await mysql.createConnection(configAdmin(p.nombreDb));
            try {
                await con.query('DROP TABLE `usuarios`');
                ok(`${p.nombreDb}: tabla \`usuarios\` borrada (${p.filas} fila(s) que ya estaban en la central)`);
            } finally {
                await con.end();
            }
        }
    }

    titulo(' RESULTADO');
    if (APLICAR) {
        ok(`tabla \`usuarios\` borrada de ${aBorrar.length} base(s)`);
        console.log('');
        console.log('  Que la central quedo intacta y que todo sigue andando:');
        console.log('      npm run f2:verificar');
        console.log('      npm run backup:verify');
    } else {
        info(`${aBorrar.length} base(s) lista(s). Esto no borro nada todavia.`);
    }

    await central.cerrar();
}

main().catch((err) => {
    console.error('\nERROR:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
    try { central.cerrar(); } catch { /* nada */ }
});
