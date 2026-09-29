#!/usr/bin/env node
/**
 * F2 · MIGRAR EL TALLER A "EMPRESA" (tenant #1)
 * ---------------------------------------------------------------------------
 *   node tools/f2-migrar-taller.js             (aplica)
 *   node tools/f2-migrar-taller.js --dry-run   (solo muestra)
 *
 * QUE HACE
 *   1. Da de alta la empresa del taller en la base central, apuntando a la
 *      base que YA EXISTE (no se renombra, no se copia, no se toca).
 *   2. Copia sus usuarios a `usuarios_globales`, conservando el hash de la
 *      contrasena TAL CUAL. Por eso nadie tiene que cambiar su clave.
 *   3. Contrata los modulos base.
 *
 * QUE NO HACE (a proposito)
 *   - No borra la tabla `usuarios` de la base del taller. Se deja ahi como
 *     respaldo hasta F4. Es el patron "expand": primero conviven las dos,
 *     despues se limpia. Si algo sale mal, la tabla original sigue intacta.
 *   - No toca ni una fila de negocio (productos, pedidos, reparaciones).
 *
 * POR QUE ES SEGURO CORRERLO CON EL SISTEMA ANDANDO
 *   Solo INSERT en la base central. La base del taller no se modifica.
 *
 * ES IDEMPOTENTE: se puede correr las veces que haga falta.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');
const { configApp } = require('../src/db/conexiones');
const central = require('../src/db/central');

const DRY = process.argv.includes('--dry-run');

const NOMBRE_DB = process.env.DB_NAME;
// MySQL en Windows guarda los nombres de base en minuscula, y el esquema
// central obliga a que `nombre_db` sea minuscula. Si guardaramos
// 'ServiceIntegralsistema' tal cual, la base no existiria el dia que esto
// corra en Linux (que distingue mayusculas).
const NOMBRE_DB_CENTRAL = String(NOMBRE_DB).toLowerCase();
const SLUG = 'service-integral';
const RUBRO = 'taller';
const PLAN = 'basico';
const ESTADO = 'ACTIVO';

const ok = (t) => console.log(`  [OK]    ${t}`);
const info = (t) => console.log(`  [ ]     ${t}`);
const aviso = (t) => console.log(`  [!]     ${t}`);

function titulo(t) {
    console.log('');
    console.log('='.repeat(70));
    console.log(` ${t}`);
    console.log('='.repeat(70));
}

/** Abre una conexion cruda contra la base actual del taller. */
async function conectarTaller() {
    return mysql.createConnection(configApp(NOMBRE_DB));
}

async function leerUsuariosDelTaller() {
    const con = await conectarTaller();
    try {
        const [filas] = await con.query(
            'SELECT id, nombre, email, password, rol, creado_en FROM usuarios ORDER BY id'
        );
        return filas;
    } finally {
        await con.end();
    }
}

async function main() {
    titulo('F2 · EL TALLER PASA A SER LA EMPRESA #1');
    console.log(`  Base del taller   : ${NOMBRE_DB}  (en la central: ${NOMBRE_DB_CENTRAL})`);
    console.log(`  Base central      : ${process.env.DB_CENTRAL_NAME || 'si_central'}`);
    console.log(`  Slug              : ${SLUG}`);
    console.log(`  Plan              : ${PLAN}`);
    console.log(`  Modo              : ${DRY ? 'SIMULACION (no se escribe nada)' : 'APLICAR'}`);
    console.log('='.repeat(70));

    // --- 0. La central tiene que estar lista ---------------------------------
    titulo('0. La base central responde');
    let resumen;
    try {
        resumen = await central.verificar();
    } catch (err) {
        console.error(`\nFALLO: no se pudo leer la base central: ${err.message}`);
        console.error('Corre primero:  npm run f1:setup\n');
        process.exit(1);
    }
    ok(`central accesible · ${resumen.empresas} empresa(s), ${resumen.modulos} modulo(s), ${resumen.planes} plan(es)`);

    if (!resumen.modulos) {
        console.error('\nFALLO: el catalogo de modulos esta vacio. Corre: npm run migrate:central\n');
        process.exit(1);
    }

    // --- 1. Los usuarios del taller ------------------------------------------
    titulo('1. Usuarios que hay hoy en la base del taller');
    const usuarios = await leerUsuariosDelTaller();
    if (!usuarios.length) {
        aviso('la base del taller no tiene usuarios. Nada que migrar.');
    } else {
        for (const u of usuarios) {
            info(`${u.email}  (${u.rol})`);
        }
        ok(`${usuarios.length} usuario(s) encontrados`);
    }

    // --- 2. La empresa ------------------------------------------------------
    titulo('2. Alta de la empresa en la base central');

    let empresa = await central.uno('SELECT * FROM empresas WHERE nombre_db = ?', [NOMBRE_DB_CENTRAL]);
    let empresaNueva = false;

    if (empresa) {
        ok(`ya existe: #${empresa.id} "${empresa.nombre}" (${empresa.estado}, plan ${empresa.plan})`);
    } else {
        if (DRY) {
            info(`SE CREARIA la empresa "${process.env.COMERCIO_NOMBRE || 'Service Integral'}" -> ${NOMBRE_DB_CENTRAL}`);
        } else {
            const r = await central.query(
                `INSERT INTO empresas
                   (nombre, slug, nombre_db, rubro, plan, estado,
                    subtitulo, logo_url, telefono, email_contacto, direccion)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    (process.env.COMERCIO_NOMBRE || 'Service Integral').slice(0, 150),
                    SLUG,
                    NOMBRE_DB_CENTRAL,
                    RUBRO,
                    PLAN,
                    ESTADO,
                    (process.env.COMERCIO_SUBTITULO || null),
                    (process.env.COMERCIO_LOGO || null),
                    (process.env.COMERCIO_TELEFONO || null),
                    (process.env.COMERCIO_EMAIL || null),
                    (process.env.COMERCIO_DIRECCION || null)
                ]
            );
            empresa = await central.uno('SELECT * FROM empresas WHERE id = ?', [r.insertId]);
            empresaNueva = true;
            ok(`creada: #${empresa.id} "${empresa.nombre}" (${empresa.estado}, plan ${empresa.plan})`);
        }
    }

    const empresaId = empresa ? empresa.id : null;

    // --- 3. Los usuarios pasan a la central ---------------------------------
    titulo('3. Los usuarios pasan a usuarios_globales');
    const resultado = { creados: 0, yaEstaban: 0, conflictos: [] };

    for (const u of usuarios) {
        const existente = await central.uno('SELECT * FROM usuarios_globales WHERE email = ?', [u.email]);

        if (existente) {
            if (existente.empresa_id === empresaId) {
                resultado.yaEstaban++;
                info(`ya estaba: ${u.email} (id central ${existente.id})`);
            } else {
                resultado.conflictos.push({
                    email: u.email,
                    motivo: existente.empresa_id === null
                        ? 'ese email ya es un SuperAdmin de la central'
                        : `ese email ya pertenece a OTRA empresa (empresa_id ${existente.empresa_id})`
                });
                aviso(`CONFLICTO: ${u.email} -> ${resultado.conflictos[resultado.conflictos.length - 1].motivo}`);
            }
            continue;
        }

        if (DRY) {
            info(`SE COPIARIA: ${u.email} (${u.rol})`);
            resultado.creados++;
            continue;
        }

        // El hash se copia TAL CUAL, sin re-hashear: es lo que hace que cada
        // uno siga entrando con la contrasena de siempre.
        await central.query(
            `INSERT INTO usuarios_globales (empresa_id, nombre, email, password_hash, rol, activo)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [empresaId, u.nombre, u.email, u.password, u.rol]
        );
        resultado.creados++;
        ok(`copiado: ${u.email} (${u.rol})`);
    }

    // --- 4. Modulos base contratados ----------------------------------------
    titulo('4. Modulos base contratados');
    const base = await central.query('SELECT codigo, nombre FROM modulos WHERE es_base = 1 ORDER BY orden');

    for (const m of base) {
        const tiene = await central.uno(
            'SELECT id FROM empresa_modulos WHERE empresa_id = ? AND modulo = ?',
            [empresaId, m.codigo]
        );
        if (tiene) {
            info(`ya estaba contratado: ${m.codigo}`);
            continue;
        }
        if (DRY) {
            info(`SE CONTRATARIA: ${m.codigo} (${m.nombre})`);
            continue;
        }
        await central.query(
            'INSERT INTO empresa_modulos (empresa_id, modulo, activo) VALUES (?, ?, 1)',
            [empresaId, m.codigo]
        );
        ok(`contratado: ${m.codigo} (${m.nombre})`);
    }

    // --- 5. Verificacion ----------------------------------------------------
    titulo('5. Verificacion');

    if (DRY) {
        info('simulacion: no hay nada que verificar todavia.');
        console.log('\nVolvé a correrlo sin --dry-run para aplicar.\n');
        await central.cerrar();
        return;
    }

    const fin = await central.uno('SELECT * FROM empresas WHERE id = ?', [empresaId]);
    ok(`empresa #${fin.id} "${fin.nombre}" · estado ${fin.estado} · plan ${fin.plan}`);

    const enCentral = await central.uno(
        'SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?',
        [empresaId]
    );
    const modulos = await central.uno(
        'SELECT COUNT(*) AS n FROM empresa_modulos WHERE empresa_id = ? AND activo = 1',
        [empresaId]
    );
    ok(`${enCentral.n} usuario(s) en la central  (la base del taller tiene ${usuarios.length})`);
    ok(`${modulos.n} modulo(s) activos`);

    if (enCentral.n !== usuarios.length - resultado.conflictos.length) {
        aviso('el conteo de usuarios no coincide. Revisá los conflictos de arriba.');
    }

    // El limite del plan vs. la realidad. Esto es una charla de negocio, no un
    // error tecnico, asi que se informa y no se bloquea nada.
    const plan = await central.uno('SELECT * FROM planes WHERE codigo = ?', [fin.plan]);
    if (plan && plan.max_usuarios !== null && enCentral.n > plan.max_usuarios) {
        console.log('');
        aviso(`ATENCION: el plan "${plan.codigo}" permite ${plan.max_usuarios} usuarios y esta empresa tiene ${enCentral.n}.`);
        aviso('Se resuelve con una excepcion: UPDATE empresas SET max_usuarios = ? WHERE id = ?');
        aviso(`  ->  UPDATE empresas SET max_usuarios = ${enCentral.n} WHERE id = ${empresaId};`);
    }

    console.log('');
    console.log('='.repeat(70));
    console.log(' F2 COMPLETADO');
    console.log('='.repeat(70));
    console.log('');
    console.log('  La base del taller NO se modifico: la tabla `usuarios` sigue ahí');
    console.log('  intacta como respaldo. Se limpia recién en F4.');
    console.log('');
    console.log('  Proximos pasos:');
    console.log('    npm run migrate:estado         estado de los esquemas');
    console.log('    npm run f2:verificar           comprobar que Entrar sigue andando');
    console.log('');

    if (resultado.conflictos.length) {
        aviso(`Quedaron ${resultado.conflictos.length} email(s) sin migrar por conflicto.`);
        aviso('No se toco nada de esos: hay que decidirlo a mano.');
        console.log('');
    }

    if (empresaNueva) {
        console.log(`  Empresa creada con id ${empresaId}. Anotalo: es el empresa_id del taller.`);
        console.log('');
    }

    await central.cerrar();
}

main().catch(async (err) => {
    console.error('\nError inesperado:', err.message);
    console.error(err.stack);
    try { await central.cerrar(); } catch { /* nada */ }
    process.exit(1);
});
