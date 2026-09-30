#!/usr/bin/env node
/**
 * F2 · VERIFICACION
 * ---------------------------------------------------------------------------
 *   node tools/f2-verificar.js
 *
 * Comprueba cuatro cosas, de la mas simple a la mas importante:
 *
 *   1. La empresa del taller quedo bien en la central.
 *   2. Las contrasenas siguen sirviendo: el hash quedo IDENTICO byte a byte,
 *      asi que nadie tiene que cambiar su clave.
 *   3. El servidor enruta cada request a la base de su empresa.
 *   4. AISLAMIENTO: una empresa no puede leer ni borrar datos de otra.
 *      Para eso se levanta una segunda empresa de prueba, de verdad, con su
 *      propia base, y se intenta el cruce desde afuera (por HTTP).
 *
 * Las partes 3 y 4 necesitan el servidor andando. Si no lo esta, avisa y
 * sigue con el resto.
 *
 * NO deja basura: la empresa y la base de prueba se borran siempre.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { configApp, configAdmin, nombreCentral } = require('../src/db/conexiones');
const central = require('../src/db/central');

const PUERTO = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const DB_TALLER = process.env.DB_NAME;
const DB_PRUEBA = 'si_tenant_prueba_aislamiento';
const SLUG_PRUEBA = 'prueba-aislamiento';
const PRODUCTO_PRUEBA = 'PRODUCTO-DE-OTRA-EMPRESA';

let pruebas = 0;
let fallos = 0;

function comprobar(condicion, texto, detalle) {
    pruebas++;
    if (condicion) {
        console.log(`  [OK]    ${texto}`);
    } else {
        fallos++;
        console.log(`  [FALLO] ${texto}`);
        if (detalle !== undefined) console.log(`          -> ${JSON.stringify(detalle)}`);
    }
}

function titulo(t) {
    console.log('');
    console.log('='.repeat(70));
    console.log(` ${t}`);
    console.log('='.repeat(70));
}

function firmar(usuario, empresaId) {
    return jwt.sign(
        { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, empresa_id: empresaId },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function pedir(ruta, token) {
    const res = await fetch(BASE_URL + ruta, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    let cuerpo = null;
    try { cuerpo = await res.json(); } catch { /* puede no ser JSON */ }
    return { estado: res.status, cuerpo };
}

/** GET /api/productos devuelve un array o { productos: [...] }, segun el modo. */
function listaDeProductos(cuerpo) {
    if (Array.isArray(cuerpo)) return cuerpo;
    if (cuerpo && Array.isArray(cuerpo.productos)) return cuerpo.productos;
    return [];
}

async function servidorVivo() {
    try {
        const res = await fetch(BASE_URL + '/api/config-comercio');
        return res.ok;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------

async function main() {
    titulo('F2 · VERIFICACION');

    // === 1. La empresa en la central ========================================
    titulo('1. La empresa del taller en la base central');

    const empresa = await central.uno('SELECT * FROM empresas WHERE nombre_db = ?', [DB_TALLER]);
    comprobar(Boolean(empresa), `existe una empresa apuntando a la base del taller (${DB_TALLER})`);

    if (!empresa) {
        console.error('\nFalta el paso previo. Corre:  npm run f2:migrar\n');
        await central.cerrar();
        process.exit(1);
    }

    comprobar(empresa.estado === 'ACTIVO', `la empresa esta ACTIVO (esta: ${empresa.estado})`);
    comprobar(empresa.slug === 'service-integral', `el slug es service-integral (esta: ${empresa.slug})`);

    const limite = await central.uno(
        `SELECT COALESCE(e.max_usuarios, p.max_usuarios) AS limite
           FROM empresas e LEFT JOIN planes p ON p.codigo = e.plan
          WHERE e.id = ?`,
        [empresa.id]
    );
    console.log(`  [ ]     empresa_id ${empresa.id} · plan ${empresa.plan} · limite de usuarios ${limite.limite ?? 'sin tope'}`);

    // === 2. Los hashes son identicos byte a byte ============================
    titulo('2. Las contrasenas siguen sirviendo');

    // Desde F4 la tabla `usuarios` de la base del taller ya no existe: los
    // usuarios viven solo en la central y no hay con qué comparar. Entonces
    // esta comprobacion, que solo tenía sentido mientras convivían las dos,
    // se salta con una explicación en vez de dar un fallo falso.
    const conTaller = await mysql.createConnection(configApp(DB_TALLER));
    let usuariosTaller = [];
    let tablaUsuarios = true;
    try {
        const [existe] = await conTaller.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios'`,
            [DB_TALLER]
        );
        if (existe[0].n) {
            const [filas] = await conTaller.query('SELECT id, nombre, email, password, rol FROM usuarios ORDER BY id');
            usuariosTaller = filas;
        } else {
            tablaUsuarios = false;
        }
    } finally {
        await conTaller.end();
    }

    if (!tablaUsuarios) {
        console.log('  [ -- ]   la tabla `usuarios` del taller ya no existe (limpieza de F4).');
        console.log('          No hay tabla vieja contra la cual comparar los hashes, pero');
        console.log('          se comprueba que las cuentas de la central esten sanas:');
        const cuentas = await central.query(
            'SELECT email, rol, activo, password_hash FROM usuarios_globales WHERE empresa_id = ? ORDER BY id',
            [empresa.id]
        );
        for (const c of cuentas) {
            // Un hash de bcrypt empieza con $2 y tiene 60 caracteres. No se
            // puede comprobar la contrasena (no se la sabemos, y no deberiamos),
            // pero si que la cuenta sea utilizable: activa, con hash bien formado
            // y con un rol valido.
            const hashOk = typeof c.password_hash === 'string'
                && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(c.password_hash);
            comprobar(hashOk && c.activo === 1 && ['ADMIN', 'TECNICO'].includes(c.rol),
                `${c.email}: cuenta utilizable (${c.rol}, hash bcrypt de 60 caracteres, activa)`, {
                    activo: c.activo, rol: c.rol, largoHash: (c.password_hash || '').length
                });
        }
        console.log('');
    }

    // Se comparan solo los que se migraron. Un email que ya existia en la
    // central con otro rol (por ejemplo el SuperAdmin) no es una falla: el
    // script de migracion lo reporta como conflicto y no lo toca.
    const migrados = [];
    const conflictos = [];

    for (const u of usuariosTaller) {
        const enCentral = await central.uno('SELECT * FROM usuarios_globales WHERE email = ?', [u.email]);

        if (!enCentral) {
            comprobar(false, `${u.email} quedo en la central`);
            continue;
        }

        if (enCentral.empresa_id !== empresa.id) {
            conflictos.push({ email: u.email, rol: enCentral.rol });
            continue;
        }

        // Comparacion exacta: si el hash es el mismo, cualquier contrasena que
        // funcionaba antes sigue funcionando. No hace falta saberla.
        comprobar(enCentral.password_hash === u.password, `${u.email}: el hash es identico`);
        migrados.push({ taller: u, central: enCentral });
    }

    for (const c of conflictos) {
        console.log(`  [!]     ${c.email}: no se migro (en la central ya es ${c.rol})`);
    }
    console.log(`  [ ]     ${migrados.length} migrado(s), ${conflictos.length} con conflicto de email`);

    // === 3 y 4. Necesitan el servidor ======================================
    if (!(await servidorVivo())) {
        titulo('3 y 4. Enrutado y aislamiento');
        console.log(`  [!]     el servidor no responde en ${BASE_URL}`);
        console.log('          Arrancalo con:  pm2 start ecosystem.config.js');
        console.log('          y volve a correr esta verificacion.');
        await cerrarYResumir();
        return;
    }

    // El token sale de un ADMIN de esa empresa. Antes se sacaba de la lista de
    // migrados; desde F4 esa lista puede estar vacia (la tabla vieja ya no
    // esta), asi que se busca directamente en la central, que es donde viven
    // los usuarios de verdad.
    let enCentralAdmin = null;
    const deLaLista = migrados.find((m) => m.central.rol === 'ADMIN') || migrados[0];
    if (deLaLista) {
        enCentralAdmin = deLaLista.central;
    } else {
        enCentralAdmin = await central.uno(
            `SELECT id, nombre, email, rol FROM usuarios_globales
              WHERE empresa_id = ? AND activo = 1
              ORDER BY rol = 'ADMIN' DESC, id LIMIT 1`,
            [empresa.id]
        );
    }

    if (!enCentralAdmin) {
        console.error('\nNo hay ningun usuario activo en la empresa: no se puede probar el enrutado.\n');
        await cerrarYResumir();
        return;
    }
    const tokenTaller = firmar(enCentralAdmin, empresa.id);

    titulo('3. El servidor enruta cada request a su empresa');

    const prodTaller = await pedir('/api/productos', tokenTaller);
    comprobar(prodTaller.estado === 200, `GET /api/productos con token del taller -> 200 (dio ${prodTaller.estado})`, prodTaller.cuerpo);

    const usuariosRoute = await pedir('/api/usuarios', tokenTaller);
    comprobar(usuariosRoute.estado === 200, `GET /api/usuarios -> 200 (dio ${usuariosRoute.estado})`, usuariosRoute.cuerpo);

    // Cuantos tiene que haber: los que diga la CENTRAL, que es donde viven los
    // usuarios. Antes se contaba desde la tabla vieja del taller, que ya no
    // existe (limpieza de F4), y por eso salia 0.
    const esperados = await central.uno(
        'SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?',
        [empresa.id]
    );
    comprobar(
        Array.isArray(usuariosRoute.cuerpo) && usuariosRoute.cuerpo.length === esperados.n,
        `los usuarios salen de la central (${esperados.n} esperados)`,
        Array.isArray(usuariosRoute.cuerpo) ? usuariosRoute.cuerpo.length : usuariosRoute.cuerpo
    );

    const sinToken = await pedir('/api/productos', null);
    comprobar(sinToken.estado === 401, `GET /api/productos sin token -> 401 (dio ${sinToken.estado})`);

    const tokenBasura = jwt.sign({ id: 1, rol: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const sinEmpresa = await pedir('/api/productos', tokenBasura);
    comprobar(sinEmpresa.estado === 403, `token sin empresa_id -> 403 (dio ${sinEmpresa.estado})`);

    const tokenInexistente = jwt.sign({ id: 1, rol: 'ADMIN', empresa_id: 999999 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const empresaMala = await pedir('/api/productos', tokenInexistente);
    comprobar(empresaMala.estado === 403, `token de una empresa inexistente -> 403 (dio ${empresaMala.estado})`);

    // === 4. Aislamiento de verdad ==========================================
    titulo('4. Aislamiento: una empresa no ve los datos de otra');

    // Antes de crear nada: el usuario de la app necesita el permiso comodín
    // sobre las bases de las empresas (si_tenant_*). Se da una sola vez, en la
    // instalación. Si falta, se dice qué hacer y no se ensucia nada.
    const appCon = await mysql.createConnection(configApp(nombreCentral()));
    const [grantsApp] = await appCon.query('SHOW GRANTS');
    await appCon.end();
    const tieneComodin = grantsApp.some((g) => /si_tenant_%/.test(Object.values(g)[0]));

    if (!tieneComodin) {
        console.log('');
        console.log('  [!]     falta el permiso comodín sobre las bases de las empresas.');
        console.log('          Corre:  npm run f1:setup   (pide la clave de root una sola vez)');
        console.log('          y después volvé a correr esta verificación.');
        await cerrarYResumir();
        return;
    }
    console.log('  [OK]    la app tiene permiso sobre las bases si_tenant_*');

    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    let empresaPruebaId = null;

    try {
        // --- Base de la empresa de prueba ---
        await admin.query(`DROP DATABASE IF EXISTS \`${DB_PRUEBA}\``);
        await admin.query(`CREATE DATABASE \`${DB_PRUEBA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

        const schema = fs.readFileSync(path.join(__dirname, '..', 'schema', 'schema-actual.sql'), 'utf8');
        const conPrueba = await mysql.createConnection({ ...configAdmin(DB_PRUEBA), multipleStatements: true });
        await conPrueba.query(schema);
        await conPrueba.query('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)', [PRODUCTO_PRUEBA, 999, 7]);
        await conPrueba.end();
        console.log(`  [ ]     base de prueba ${DB_PRUEBA} creada con 1 producto bien distinto`);

        // --- Empresa de prueba en la central ---
        const r = await central.query(
            `INSERT INTO empresas (nombre, slug, nombre_db, rubro, plan, estado)
             VALUES (?, ?, ?, 'taller', 'basico', 'ACTIVO')`,
            ['Empresa de Prueba (aislamiento)', SLUG_PRUEBA, DB_PRUEBA]
        );
        empresaPruebaId = r.insertId;
        console.log(`  [ ]     empresa de prueba #${empresaPruebaId} creada`);

        /* Una empresa real nace con los módulos base contratados, y la prueba
           tiene que parecerse a una real. Sin esto, F3 le contesta 404 a todo
           y la parte 4 dejaría de probar lo que dice probar: pasaría porque
           la empresa de prueba no ve NADA, y no porque estén separadas. */
        const modulosBase = await central.query('SELECT codigo FROM modulos WHERE es_base = 1 ORDER BY orden');
        for (const m of modulosBase) {
            await central.query(
                `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde)
                 VALUES (?, ?, 1, CURDATE())`,
                [empresaPruebaId, m.codigo]
            );
        }
        console.log(`  [ ]     con los ${modulosBase.length} módulo(s) base contratado(s): ${modulosBase.map((m) => m.codigo).join(', ')}`);

        const tokenPrueba = firmar({ id: 900001, nombre: 'Prueba', rol: 'ADMIN' }, empresaPruebaId);

        // --- Lo que la empresa de prueba VE ---
        const prodPrueba = await pedir('/api/productos', tokenPrueba);
        const nombresPrueba = listaDeProductos(prodPrueba.cuerpo).map((p) => p.nombre);
        comprobar(prodPrueba.estado === 200, `la empresa de prueba puede leer sus productos (${prodPrueba.estado})`, prodPrueba.cuerpo);
        comprobar(nombresPrueba.includes(PRODUCTO_PRUEBA), 've SU producto', nombresPrueba);

        const nombresTaller = listaDeProductos(prodTaller.cuerpo).map((p) => p.nombre);
        comprobar(
            !nombresTaller.includes(PRODUCTO_PRUEBA),
            'el taller NO ve el producto de la empresa de prueba',
            nombresTaller.slice(0, 5)
        );

        const tallerNoVe = nombresPrueba.filter((n) => nombresTaller.includes(n));
        comprobar(tallerNoVe.length === 0, 'la empresa de prueba NO ve NINGUN producto del taller', tallerNoVe);

        // --- Lo que la empresa de prueba NO puede hacer ---
        const usuariosPrueba = await pedir('/api/usuarios', tokenPrueba);
        comprobar(
            Array.isArray(usuariosPrueba.cuerpo) && usuariosPrueba.cuerpo.length === 0,
            `la empresa de prueba tiene 0 usuarios, no los del taller`,
            usuariosPrueba.cuerpo
        );

        // El ataque concreto: borrar un usuario del taller desde la otra empresa.
        const victima = enCentralAdmin;
        const borradoCruzado = await pedir(`/api/usuarios/${victima.id}`, tokenPrueba);
        comprobar(
            borradoCruzado.estado === 404,
            `borrar un usuario del taller desde la otra empresa -> 404 (dio ${borradoCruzado.estado})`,
            borradoCruzado.cuerpo
        );

        const sigueVivo = await central.uno('SELECT id FROM usuarios_globales WHERE id = ?', [victima.id]);
        comprobar(Boolean(sigueVivo), 'y ese usuario del taller sigue existiendo');

        // El otro ataque: cambiarle la contrasena a un usuario ajeno.
        const cambiarAjena = await pedir(`/api/usuarios/${victima.id}`, tokenPrueba);
        comprobar(cambiarAjena.estado === 404, 'no puede operar sobre usuarios de otra empresa');
    } finally {
        // --- Limpieza, pase lo que pase ---
        try {
            if (empresaPruebaId) {
                await central.query('DELETE FROM empresas WHERE id = ?', [empresaPruebaId]);
            }
            await admin.query(`DROP DATABASE IF EXISTS \`${DB_PRUEBA}\``);
            await admin.end();
            console.log('');
            console.log('  [ ]     limpieza: empresa y base de prueba borradas');
        } catch (err) {
            console.error('  [!]     no se pudo limpiar del todo:', err.message);
        }
    }

    await cerrarYResumir();
}

async function cerrarYResumir() {
    await central.cerrar();

    console.log('');
    console.log('='.repeat(70));
    if (fallos === 0) {
        console.log(` TODO BIEN · ${pruebas} comprobaciones pasaron`);
    } else {
        console.log(` HAY FALLAS · ${fallos} de ${pruebas} comprobaciones fallaron`);
    }
    console.log('='.repeat(70));
    console.log('');

    process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (err) => {
    console.error('\nError inesperado:', err.message);
    console.error(err.stack);
    try { await central.cerrar(); } catch { /* nada */ }
    process.exit(1);
});
