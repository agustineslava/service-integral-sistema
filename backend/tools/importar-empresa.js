#!/usr/bin/env node
/**
 * IMPORTAR EMPRESA - registra una empresa YA EXISTENTE en la base central.
 * ---------------------------------------------------------------------------
 *   npm run importar-empresa -- --nombre "Taller X" --slug taller-x --base si_tenant_taller_x
 *
 * QUE HACE
 *   1. Da de alta (o verifica) la empresa en la base central, apuntando a la
 *      base que YA EXISTE (no se renombra, no se copia, no se toca).
 *   2. Copia sus usuarios a `usuarios_globales`, conservando el hash de la
 *      contrasena TAL CUAL. Por eso nadie tiene que cambiar su clave.
 *   3. Contrata los modulos base.
 *
 * PARAMETROS
 *   --nombre "<nombre>"   Nombre visible (si falta: COMERCIO_NOMBRE o legado)
 *   --slug <slug>         Slug unico (si falta junto con --base: legado)
 *   --base <nombre_db>    Base existente a importar (si falta: DB_NAME)
 *   --rubro <rubro>       Por defecto: taller
 *   --plan <plan>         Por defecto: basico
 *   --estado <estado>     Por defecto: ACTIVO
 *   --dry-run             Solo muestra lo que haria
 *
 * COMPATIBILIDAD (LEGADO)
 *   Si no se pasa --base/--slug/--nombre y existe `DB_NAME`, cae a los valores
 *   de la empresa #1 (base `DB_NAME`, slug `service-integral`). `f2:migrar` es
 *   un alias que hace exactamente eso. `DB_NAME` NO se modifica.
 *
 * QUE NO HACE (a proposito)
 *   - No borra la tabla `usuarios` de la base importada. Se deja ahi como
 *     respaldo hasta F4. Es el patron "expand": despues conviven las dos.
 *   - No toca ni una fila de negocio (productos, pedidos, reparaciones).
 *
 * ES IDEMPOTENTE: se puede correr las veces que haga falta.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const mysql = require('mysql2/promise');
const { configApp } = require('../src/db/conexiones');
const central = require('../src/db/central');
const { darPermisosDeEmpresa, usuarioApp, usuarioAdmin } = require('../src/db/permisos');

const SLUG_LEGADO = 'service-integral';
const NOMBRE_LEGADO = 'Service Integral';

const ok = (t) => console.log(`  [OK]    ${t}`);
const info = (t) => console.log(`  [ ]     ${t}`);
const aviso = (t) => console.log(`  [!]     ${t}`);

function titulo(t) {
    console.log('');
    console.log('='.repeat(70));
    console.log(` ${t}`);
    console.log('='.repeat(70));
}

/** Lee los parametros de la linea de comandos. */
function leerArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') { args.dryRun = true; continue; }
        if (!a.startsWith('--')) continue;
        const clave = a.slice(2);
        const siguiente = argv[i + 1];
        const valor = (siguiente !== undefined && !siguiente.startsWith('--')) ? argv[++i] : true;
        args[clave] = valor;
    }
    return args;
}

/**
 * Combina lo que vino por CLI con los valores legados y los defaults.
 * Los valores legados solo aplican si NO se paso --base (o si `legado` es
 * true, que es el caso del alias `f2:migrar`).
 */
function resolverOpciones(args, legado) {
    const baseCruda = args.base || process.env.DB_NAME;
    const base = baseCruda ? String(baseCruda).trim().toLowerCase() : '';
    const baseDesdeDbName = !args.base && Boolean(base);
    const slug = args.slug || (baseDesdeDbName || legado ? SLUG_LEGADO : null);
    const nombre = args.nombre || process.env.COMERCIO_NOMBRE || (baseDesdeDbName || legado ? NOMBRE_LEGADO : null);

    if (!base) {
        throw new Error(
            'Falta --base <nombre_db>.\n' +
            '  Ejemplo: npm run importar-empresa -- --nombre "Taller X" --slug taller-x --base si_tenant_taller_x\n' +
            '  (DB_NAME no esta definido en el .env, asi que no hay default legado.)'
        );
    }
    if (!slug) throw new Error('Falta --slug <slug> (obligatorio cuando se pasa --base).');
    if (!nombre) throw new Error('Falta --nombre "<nombre>" (obligatorio cuando se pasa --base).');

    const slugNormalizado = String(slug).trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(slugNormalizado)) {
        throw new Error(`Slug invalido: "${slug}". Solo minusculas, numeros y guiones (max 60).`);
    }

    return {
        nombre: String(nombre).trim().slice(0, 150),
        slug: slugNormalizado,
        base,
        rubro: String(args.rubro || 'taller').trim(),
        plan: String(args.plan || 'basico').trim(),
        estado: String(args.estado || 'ACTIVO').trim(),
        dryRun: Boolean(args.dryRun),
        legado: Boolean(legado),
        baseDesdeDbName
    };
}

/** Abre una conexion cruda contra la base de la empresa a importar. */
async function conectarEmpresa(base) {
    return mysql.createConnection(configApp(base));
}

async function leerUsuariosDeEmpresa(base) {
    const con = await conectarEmpresa(base);
    try {
        // Desde F4 esta tabla ya no existe: los usuarios viven solo en la
        // central. Que no esté es el estado NORMAL, no un error, así que la
        // herramienta tiene que seguir sirviendo para lo que falta.
        const [existe] = await con.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios'`,
            [base]
        );
        if (!existe[0].n) return [];

        const [filas] = await con.query(
            'SELECT id, nombre, email, password, rol, creado_en FROM usuarios ORDER BY id'
        );
        return filas;
    } finally {
        await con.end();
    }
}

async function importarEmpresa(opcion = {}) {
    const argv = opcion.argv || process.argv.slice(2);
    const args = leerArgs(argv);
    const op = resolverOpciones(args, opcion.legado);

    titulo('IMPORTAR EMPRESA A LA PLATAFORMA');
    console.log(`  Nombre            : ${op.nombre}`);
    console.log(`  Slug              : ${op.slug}`);
    console.log(`  Base de datos     : ${op.base}${op.baseDesdeDbName ? '   (desde DB_NAME, legado)' : ''}`);
    console.log(`  Base central      : ${process.env.DB_CENTRAL_NAME || 'si_central'}`);
    console.log(`  Rubro / Plan      : ${op.rubro} / ${op.plan} (${op.estado})`);
    console.log(`  Modo              : ${op.dryRun ? 'SIMULACION (no se escribe nada)' : 'APLICAR'}`);
    console.log('='.repeat(70));

    // Avisos de legado: no se toca el .env, solo se advierte.
    if (op.legado) {
        aviso('comando legado `f2:migrar`: usa DB_NAME + slug service-integral por defecto.');
        aviso('Preferi:  npm run importar-empresa -- --nombre "..." --slug ... --base ...');
    }
    if (op.baseDesdeDbName) {
        aviso('DB_NAME es legado (base de la empresa #1, NO de la plataforma).');
        aviso('Se usa solo como default de este import; el .env no se modifica.');
    }

    // --- 0. La central tiene que estar lista ---------------------------------
    titulo('0. La base central responde');
    let resumen;
    try {
        resumen = await central.verificar();
    } catch (err) {
        console.error(`\nFALLO: no se pudo leer la base central: ${err.message}`);
        console.error('Corre primero:  npm run install:plataforma\n');
        process.exit(1);
    }
    ok(`central accesible · ${resumen.empresas} empresa(s), ${resumen.modulos} modulo(s), ${resumen.planes} plan(es)`);

    if (!resumen.modulos) {
        console.error('\nFALLO: el catalogo de modulos esta vacio. Corre: npm run migrate:central\n');
        process.exit(1);
    }

    // --- 1. Los usuarios de la base a importar -------------------------------
    titulo('1. Usuarios que hay hoy en la base de la empresa');
    const usuarios = await leerUsuariosDeEmpresa(op.base);
    if (!usuarios.length) {
        aviso('la base ya no tiene tabla `usuarios` (limpieza de F4, o nunca hubo).');
        aviso('Los usuarios estan en la central: nada que migrar.');
    } else {
        for (const u of usuarios) {
            info(`${u.email}  (${u.rol})`);
        }
        ok(`${usuarios.length} usuario(s) encontrados`);
    }

    // --- 2. La empresa ------------------------------------------------------
    titulo('2. Alta de la empresa en la base central');

    const porSlug = await central.uno('SELECT * FROM empresas WHERE slug = ?', [op.slug]);
    if (porSlug && porSlug.nombre_db !== op.base) {
        console.error(`\nFALLO: el slug "${op.slug}" ya lo usa otra empresa (#${porSlug.id} "${porSlug.nombre}" -> ${porSlug.nombre_db}).`);
        console.error('Elegí otro --slug.\n');
        await central.cerrar();
        process.exit(1);
    }

    let empresa = await central.uno('SELECT * FROM empresas WHERE nombre_db = ?', [op.base]);
    let empresaNueva = false;

    if (empresa) {
        ok(`ya existe: #${empresa.id} "${empresa.nombre}" (${empresa.estado}, plan ${empresa.plan})`);
    } else {
        if (op.dryRun) {
            info(`SE CREARIA la empresa "${op.nombre}" -> ${op.base}`);
        } else {
            const r = await central.query(
                `INSERT INTO empresas
                   (nombre, slug, nombre_db, rubro, plan, estado,
                    subtitulo, logo_url, telefono, email_contacto, direccion)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    op.nombre,
                    op.slug,
                    op.base,
                    op.rubro,
                    op.plan,
                    op.estado,
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

    // --- 2 bis. Permisos sobre la base --------------------------------------
    // La base heredada no matchea `si_tenant_%`, asi que necesita su GRANT
    // explicito. El import lo hace aca para no depender de F0/F1.
    titulo('2 bis. Permisos de la base importada');
    if (op.dryRun) {
        info(`SE CONCEDERIAN permisos a '${usuarioAdmin()}' y '${usuarioApp()}' sobre \`${op.base}\``);
    } else {
        try {
            const permisos = await darPermisosDeEmpresa(op.base);
            if (permisos.admin === 'ok') ok(`'${usuarioAdmin()}' puede administrar \`${op.base}\``);
            else aviso(`no se pudo dar permiso a '${usuarioAdmin()}' sobre ${op.base}: ${permisos.admin}`);
            if (permisos.app === 'ok') ok(`'${usuarioApp()}' puede leer/escribir \`${op.base}\``);
            else aviso(`no se pudo dar permiso a '${usuarioApp()}' sobre ${op.base}: ${permisos.app}`);
        } catch (e) {
            aviso(`no se pudieron conceder permisos sobre ${op.base}: ${e.message}`);
        }
    }

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

        if (op.dryRun) {
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
        if (op.dryRun) {
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

    if (op.dryRun) {
        info('simulacion: no hay nada que verificar todavia.');
        console.log('\nVolvé a correrlo sin --dry-run para aplicar.\n');
        await central.cerrar();
        return;
    }

    const fin = await central.uno('SELECT * FROM empresas WHERE id = ?', [empresaId]);
    ok(`empresa #${fin.id} "${fin.nombre}" · slug ${fin.slug} · estado ${fin.estado} · plan ${fin.plan}`);

    const enCentral = await central.uno(
        'SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?',
        [empresaId]
    );
    const modulos = await central.uno(
        'SELECT COUNT(*) AS n FROM empresa_modulos WHERE empresa_id = ? AND activo = 1',
        [empresaId]
    );
    ok(`${enCentral.n} usuario(s) en la central  (la base importada tiene ${usuarios.length})`);
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
    console.log(' IMPORTACION COMPLETADA');
    console.log('='.repeat(70));
    console.log('');
    console.log('  La base importada NO se modifico: la tabla `usuarios` sigue ahí');
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
        console.log(`  Empresa creada con id ${empresaId}. Anotalo.`);
        console.log('');
    }

    await central.cerrar();
}

if (require.main === module) {
    importarEmpresa().catch(async (err) => {
        console.error('\nError inesperado:', err.message);
        console.error(err.stack);
        try { await central.cerrar(); } catch { /* nada */ }
        process.exit(1);
    });
}

module.exports = { importarEmpresa };
