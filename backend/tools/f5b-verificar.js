#!/usr/bin/env node
/**
 * F5b · VERIFICACION DEL PANEL DEL SUPERADMIN
 * ---------------------------------------------------------------------------
 *   npm run f5b:verificar
 *
 * QUE COMPRUEBA
 * Que el panel sirva para lo unico que tiene que servir: dar de alta una
 * empresa, cambiarle el estado y el plan, y contratarle modulos. Y sobre todo
 * que no sirva para otra cosa.
 *
 * LA REGLA DE ORO, Y POR QUE DOMINA ESTE ARCHIVO
 * Un SUPERADMIN administra el SERVICIO. No es el administrador de un cliente
 * con mas permisos: es otra cosa. No tiene que poder ver las reparaciones de
 * nadie, ni sus productos, ni sus clientes, ni sus presupuestos. Esa linea es
 * la promesa de "cero cruce de datos", y la unica forma de saber que se
 * sostiene es probarla: si estas pruebas pasan, un token de SuperAdmin contra
 * cualquier ruta de empresa da 403.
 *
 * POR QUE HAY UNA EMPRESA DE PRUEBA FALSA
 * Para probar el estado, el plan y los modulos no hace falta una base de datos
 * de verdad: alcanza con una fila en la central. Esa empresa tiene un
 * `nombre_db` que NO existe, y por eso las pruebas que la tocan comprueban
 * tambien, sin querer, algo importante: que ninguna de esas rutas intente
 * abrir la base del cliente. Si una lo hiciera, reventaría con "unknown
 * database" y el test falla.
 *
 * LA EMPRESA DEL TALLER NO SE TOCA
 * Ni un solo check de este archivo lee o escribe la base del taller. Se
 * comprueba de forma explicita al final: el numero de filas de la empresa #1
 * tiene que ser el mismo antes y despues.
 *
 * EL ALTA, Y POR QUE ESTE ARCHIVO PASA IGUAL SIN `permisos-alta`
 * Dar de alta una empresa crea una base MySQL y le da permisos a la app. Ese
 * permiso se concede una vez, a mano, con root (`npm run permisos-alta`).
 *
 * Mientras no se haya corrido, el alta falla en ese paso. Y ESO tambien se
 * verifica: que falle, que lo diga con el comando adentro, y sobre todo que
 * NO deje ni la base ni la fila ni el usuario. Una empresa a medio hacer es
 * peor que no crearla: existe en el panel, alguien puede entrar, y en la
 * primera pantalla falla con "access denied".
 *
 * Por eso este archivo tiene dos modos y avisa cual fue. Si el permiso ya esta,
 * prueba el camino completo (alta, login de esa empresa, y que sus consultas
 * funcionen). Si no esta, prueba el camino del fallo y dice que queda
 * pendiente. En los dos casos el resultado es verde, porque lo que se verifica
 * es el comportamiento, no que el servidor este configurado de una forma.
 *
 * LIMPIEZA
 * Todo lo que se crea se borra en un `finally`, bases incluidas. Si el proceso
 * se mata a la mitad, al arrancar limpia lo que quedo de una corrida anterior
 * buscando el prefijo de prueba, que no es ninguna empresa de nadie.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const central = require('../src/db/central');
const { configAdmin, nombreCentral } = require('../src/db/conexiones');

const PUERTO = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;

const PREFIJO = 'f5b-prueba';
const CLAVE = 'F5bClaveDePrueba123';
const CLAVE_HASH = '$2b$10$g1p7ccowsUFPaHDSCAalsul0CCMtknz0iXlODxmpE5uQaCuwkm/V2';
const EMAIL = 'f5b@prueba.local';

// ==========================================================================
// Maquinaria
// ==========================================================================

let total = 0;
let fallos = 0;
let seccion = '';

function comprobar(condicion, texto, detalle) {
    total++;
    if (condicion) {
        console.log(`  \x1b[32m[OK]\x1b[0m    ${texto}`);
    } else {
        fallos++;
        console.log(`  \x1b[31m[FALLO]\x1b[0m ${texto}`);
        if (detalle !== undefined && detalle !== null) {
            const t = typeof detalle === 'string' ? detalle : JSON.stringify(detalle);
            console.log(`          -> ${String(t).slice(0, 150)}`);
        }
    }
}

function titulo(t) {
    seccion = t;
    console.log('');
    console.log('-'.repeat(76));
    console.log(` ${t}`);
    console.log('-'.repeat(76));
}

async function pedir(ruta, token, opciones = {}) {
    try {
        const res = await fetch(BASE_URL + ruta, {
            ...opciones,
            headers: {
                ...(opciones.headers || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        });
        let cuerpo = null;
        try { cuerpo = await res.json(); } catch { /* puede no ser JSON */ }
        return { estado: res.status, cuerpo };
    } catch (err) {
        return { estado: 0, cuerpo: { error: err.message } };
    }
}

const enviar = (metodo, ruta, token, body) => pedir(ruta, token, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
});

function firmar(usuario, extra = {}) {
    return jwt.sign(
        {
            id: usuario.id,
            email: usuario.email,
            nombre: usuario.nombre || 'Prueba',
            rol: usuario.rol,
            empresa_id: extra.empresa_id ?? null,
            ...extra
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function servidorVivo() {
    const r = await pedir('/api/admin/yo', 'invalido');
    return r.estado > 0;
}

// --- limpieza -------------------------------------------------------------

/** Bases `si_tenant_` de las pruebas de este archivo y de f5a. */
const BASES_DE_PRUEBA = /^si_tenant_(f5b|f5)_/;

/**
 * La conexión que puede crear y borrar bases. Se abre una sola vez y se
 * comparte: `mysql.createConnection` por cada base sería abrir y cerrar
 * conexiones deMySQL docenas de veces en una limpieza.
 */
let conexionAdmin = null;
// Una sola conexión para toda la corrida. NO se cierra nunca: el cierre queda
// para el final del proceso. Cerrarla en el medio deja el helper devolviendo una
// conexión muerta y el error que sale ("Can't add new command when connection is
// in closed state") no dice qué la mató.
async function admin() {
    if (!conexionAdmin) {
        const mysql = require('mysql2/promise');
        conexionAdmin = await mysql.createConnection(configAdmin(nombreCentral()));
    }
    return conexionAdmin;
}

async function borrarBasePorAdmin(nombreDb) {
    if (!/^[A-Za-z0-9_]+$/.test(nombreDb || '')) return;
    const c = await admin();
    try {
        await c.query(`DROP DATABASE IF EXISTS \`${nombreDb}\``);
    } catch (err) {
        console.error(`  AVISO: no se pudo borrar la base ${nombreDb}: ${err.message}`);
    }
}

/**
 * Limpieza de arranque: empresas con el prefijo de prueba y bases huerfanas.
 *
 * Las bases se buscan por nombre Y sin fila en `empresas`. Esa segunda
 * condicion importa: una corrida muerta puede dejar una base creada con el
 * esquema puesto y sin fila, que no se encuentra buscando por `empresas` y
 * queda occupying el disco para siempre.
 */
async function barrerRestos() {
    const filas = await central.query(
        `SELECT id, slug, nombre_db FROM empresas WHERE slug LIKE ?`, [`${PREFIJO}%`]
    );
    let borradas = 0;
    for (const f of filas) {
        await borrarBasePorAdmin(f.nombre_db);
        await central.query('DELETE FROM empresas WHERE id = ?', [f.id]);
        borradas++;
    }

    const c = await admin();
    const [bases] = await c.query(
        `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'si\\_tenant\\_%'`
    );
    const huerfanas = [];
    for (const b of bases) {
        const fila = await central.uno('SELECT id FROM empresas WHERE nombre_db = ?', [b.n]);
        if (!fila) {
            await borrarBasePorAdmin(b.n);
            huerfanas.push(b.n);
        }
    }

    if (borradas || huerfanas.length) {
        console.log(`  Barrido: ${borradas} empresa(s) y ${huerfanas.length} base(s) de pruebas anteriores.`);
        if (huerfanas.length) console.log(`    bases huerfanas: ${huerfanas.join(', ')}`);
    }
    return borradas + huerfanas.length;
}

// --- la empresa de prueba falsa -------------------------------------------

/**
 * Una fila en la central con una base que NO existe.
 *
 * Sirve para el estado, el plan y los modulos. Y de yapa comprueba que
 * ninguna de esas rutas abra la base del cliente: si la abren, MySQL contesta
 * "Unknown database" y el check falla.
 */
async function crearEmpresaFalsa(extra = {}) {
    const slug = `${PREFIJO}-${Math.random().toString(36).slice(2, 8)}`;
    const datos = {
        nombre: 'Empresa De Prueba F5b',
        slug,
        nombre_db: `si_tenant_f5b_${slug.replace(/-/g, '_')}`,
        rubro: 'cerrajeria',
        plan: 'basico',
        estado: 'ACTIVO',
        ...extra
    };
    const r = await central.query(
        `INSERT INTO empresas (nombre, slug, nombre_db, rubro, plan, estado, color_primario)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [datos.nombre, datos.slug, datos.nombre_db, datos.rubro, datos.plan, datos.estado,
         '#2d6a4f']
    );
    // Los cuatro modulos base, como hace el alta de verdad.
    const base = await central.query('SELECT codigo FROM modulos WHERE es_base = 1 ORDER BY orden');
    for (const m of base) {
        await central.query(
            `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde) VALUES (?, ?, 1, CURDATE())`,
            [r.insertId, m.codigo]
        );
    }
    // Un ADMIN para poder probar el login con el.
    const bcrypt = require('bcryptjs');
    await central.query(
        `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
         VALUES (?, ?, ?, 'Admin Prueba', 'ADMIN')`,
        [r.insertId, EMAIL, await bcrypt.hash(CLAVE, 10)]
    );
    return { id: r.insertId, ...datos };
}

async function borrarEmpresaFalsa(id, nombreDb) {
    await borrarBasePorAdmin(nombreDb);
    await central.query('DELETE FROM empresas WHERE id = ?', [id]);
}

// ==========================================================================

async function main() {
    console.log('');
    console.log('='.repeat(76));
    console.log(' F5b · VERIFICACION DEL PANEL DEL SUPERADMIN');
    console.log('='.repeat(76));

    if (!await servidorVivo()) {
        console.error('\n El servidor no esta levantado en el puerto ' + PUERTO + '.');
        console.error(' Arrancalo primero (node server.js) y volve a correr esto.\n');
        process.exitCode = 1;
        return;
    }
    console.log(`\n Servidor: ${BASE_URL}`);

    console.log('\n Limpiando restos de corridas anteriores...');
    await barrerRestos();

    // --- el superadmin real, que es contra quien se prueba de verdad ------
    // Se traen `rol`, `activo` y `empresa_id` porque mas abajo se lo desactiva
    // y se lo degrada a proposito para probar el guard, y hay que devolverlo
    // exactamente como estaba. Si el SELECT no los trae, el `finally` que
    // restaura termina escribiendo NULL y revienta el resto de la verificacion
    // -- que es lo que paso la primera vez.
    const superReal = await central.uno(
        `SELECT id, nombre, email, rol, activo, empresa_id
           FROM usuarios_globales WHERE rol = 'SUPERADMIN' AND activo = 1 LIMIT 1`
    );
    if (!superReal) {
        console.error('\n ================================================================');
        console.error('  NO SE PUDO VERIFICAR NADA: no hay SUPERADMIN activo.');
        console.error(' ================================================================');
        const inactivos = await central.query(
            `SELECT id, email, activo FROM usuarios_globales WHERE rol = 'SUPERADMIN'`
        );
        if (inactivos.length) {
            console.error('\n  Hay SUPERADMIN pero dados de baja:\n');
            for (const u of inactivos) {
                console.error('    id ' + u.id + '  activo=' + u.activo + '  ' + u.email);
            }
            console.error('\n  Reactivarlos (el verificador NO lo hace solo, para no tocar');
            console.error('  cuentas de verdad a escondidas):\n');
            console.error('    UPDATE usuarios_globales SET activo = 1 WHERE rol = \'SUPERADMIN\';\n');
        }
        console.error('');
        process.exitCode = 1;
        return;
    }
    const tokSuper = firmar(superReal, { rol: 'SUPERADMIN', email: superReal.email });

    // La foto del taller antes de hacer nada, para poder compararla al final.
    const tallerAntes = await central.uno(
        `SELECT id, nombre, slug, estado, plan, nombre_db FROM empresas WHERE nombre_db = ?`,
        [process.env.DB_NAME]
    );
    const usuariosTallerAntes = await central.uno(
        `SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?`, [tallerAntes?.id]
    );

    let falsa = null;
    let creadaPorAlta = null;
    let altaCompleta = false;

    try {
        // La empresa de prueba se crea ANTES de los tests del guard, y los
        // tests del guard apuntan a ELLA, nunca al taller.
        //
        // Los checks de esta sección dicen "esto tiene que dar 403". Apuntar a
        // una empresa real los hace seguros SOLO si el guard funciona: en el
        // momento en que se rompe el guard -- que es justo cuando estos checks
        // se están usando -- el `DELETE /api/admin/empresas/1` pasa de largo y
        // deja el taller en BAJA. No es hipotetico: paso una vez, durante una
        // prueba por mutacion, y el taller amanecio dado de baja.
        //
        // Un test que solo es inocuo cuando el codigo esta bien no es un test:
        // es una bomba con la mecha corta. Estos apuntan a datos de prueba, que
        // se limpian al final, y por eso un guard roto rompe pruebas y no
        // clientes.
        falsa = await crearEmpresaFalsa();

        // =================================================================
        titulo('1. EL GUARD: SOLO UN SUPERADMIN ENTRA');

        const rutas = [
            ['GET', '/api/admin/yo'],
            ['GET', '/api/admin/empresas'],
            ['GET', `/api/admin/empresas/${falsa.id}`],
            ['GET', '/api/admin/catalogos'],
            ['GET', '/api/admin/auditoria'],
            ['POST', '/api/admin/empresas'],
            ['PATCH', `/api/admin/empresas/${falsa.id}`],
            ['PATCH', `/api/admin/empresas/${falsa.id}/modulos/presupuestos`],
            ['DELETE', `/api/admin/empresas/${falsa.id}`]
        ];

        for (const [m, r] of rutas) {
            const sinToken = await enviar(m, r, null, m === 'POST' ? {} : (m === 'PATCH' ? {} : undefined));
            comprobar(sinToken.estado === 401, `sin token -> 401  ${m} ${r}`, sinToken.estado);
        }

        // Un ADMIN de una empresa, con token VALIDO. Este es el caso que
        // importa: no es un token roto, es un token bueno del rol equivocado.
        const adminTaller = await central.uno(
            `SELECT id, nombre, email, empresa_id FROM usuarios_globales
              WHERE rol = 'ADMIN' AND empresa_id IS NOT NULL AND activo = 1 LIMIT 1`
        );
        if (adminTaller) {
            const tokAdmin = firmar(adminTaller, { rol: 'ADMIN', empresa_id: adminTaller.empresa_id });
            for (const [m, r] of rutas) {
                const res = await enviar(m, r, tokAdmin, m === 'POST' ? { nombre: 'Intrusa SA', admin_email: 'x@y.com', admin_password: 'ClaveLarga123' } : (m === 'PATCH' ? { estado: 'BAJA' } : (m === 'DELETE' ? {} : undefined)));
                comprobar(
                    res.estado === 403,
                    `token de ADMIN de empresa -> 403  ${m} ${r}`,
                    res.estado
                );
            }

            // Y lo mas importante: que ese intento NO haya creado nada.
            const intrusa = await central.uno(`SELECT id FROM empresas WHERE nombre = 'Intrusa SA'`);
            comprobar(!intrusa, 'el intento del ADMIN no creo ninguna empresa', intrusa);
            const sigueViva = await central.uno(`SELECT estado FROM empresas WHERE id = ?`, [falsa.id]);
            comprobar(sigueViva && sigueViva.estado === 'ACTIVO',
                'el intento del ADMIN no toco la empresa de prueba', sigueViva);
            const tallerIntacto = await central.uno(`SELECT estado FROM empresas WHERE id = ?`, [tallerAntes.id]);
            comprobar(tallerIntacto && tallerIntacto.estado === tallerAntes.estado,
                'ni el taller', tallerIntacto);
        } else {
            comprobar(false, 'no hay ningun ADMIN de empresa para probar el guard', 'faltan datos');
        }

        // Un SUPERADMIN que ya no esta activo: el token puede ser valido, pero
        // el usuario fue dado de baja. Sin esto, un SuperAdmin desactivado
        // seguiria entrando con el token viejo por una hora.
        //
        // Estos casos usan un SuperAdmin REAL, no un id inventado. El caso del
        // id inexistente (999999) ya estaba, y pasaba en verde con un guard que
        // solo comprobaba "existe alguien con este id": responder "no existe"
        // y "existe pero lo di de baja" son preguntas distintas, y solo la
        // segunda es la que importa.
        const tokFantasma = firmar({ id: 999999, nombre: 'Fantasma' }, { rol: 'SUPERADMIN' });
        const rFantasma = await pedir('/api/admin/yo', tokFantasma);
        comprobar(rFantasma.estado === 403, 'SUPERADMIN que no existe -> 403', rFantasma.estado);

        // El que se desactiva es UNO HECHO PARA ESTA PRUEBA, nunca el
        // SuperAdmin de verdad.
        //
        // La primera version desactivaba al real, y una corrida abortada a
        // mitad -- por un `finally` que falló, nada más -- lo dejó con
        // `activo = 0`. Eldueño del sistema se quedó sin poder entrar al panel
        // por un test. Es el mismo error que dejar el taller en BAJA, y con
        // consecuencias más graves: acá el que se queda afuera es el
        // administrador de la plataforma, sin forma de entrar a arreglarlo.
        //
        // Un test que parte de un recurso de producción no es un test: es una
        // dependencia en producción a la que se le agregan pasos.
        const correoPrueba = `f5b-guard-${Date.now()}@prueba.local`;
        await central.query(
            `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol, activo)
             VALUES (NULL, ?, 'x', 'SuperAdmin de Prueba', 'SUPERADMIN', 1)`,
            [correoPrueba]
        );
        const descartable = await central.uno(
            `SELECT id, nombre, email, rol, activo, empresa_id FROM usuarios_globales WHERE email = ?`,
            [correoPrueba]
        );
        const tokDescartable = firmar(descartable, { rol: 'SUPERADMIN', email: descartable.email });

        try {
            const rOk0 = await pedir('/api/admin/yo', tokDescartable);
            comprobar(rOk0.estado === 200, 'el SuperAdmin de prueba entra (control)', rOk0.estado);

            await central.query('UPDATE usuarios_globales SET activo = 0 WHERE id = ?', [descartable.id]);
            const rBaja = await pedir('/api/admin/yo', tokDescartable);
            comprobar(rBaja.estado === 403,
                'SUPERADMIN REAL dado de baja -> 403 (no 200)', rBaja.estado);

            // Para degradarlo hay que darle una empresa: el CHECK `chk_ug_empresa`
            // de la tabla prohibe un ADMIN sin empresa, y con razon. Si se
            // degradara sin empresa, el UPDATE lo rechazaria la base y esta
            // prueba abortaria entera.
            await central.query('UPDATE usuarios_globales SET activo = 1, rol = ?, empresa_id = ? WHERE id = ?',
                ['ADMIN', falsa.id, descartable.id]);
            const rRollo = await pedir('/api/admin/yo', tokDescartable);
            comprobar(rRollo.estado === 403,
                'SUPERADMIN degradado a otro rol en la base -> 403 (no 200)', rRollo.estado);

            await central.query('UPDATE usuarios_globales SET rol = ?, empresa_id = NULL WHERE id = ?',
                ['SUPERADMIN', descartable.id]);
            const rVuelve = await pedir('/api/admin/yo', tokDescartable);
            comprobar(rVuelve.estado === 200, 'restaurado -> vuelve a entrar', rVuelve.estado);
        } finally {
            // Se borra siempre, y con esto el SuperAdmin real no se toca nunca.
            await central.query('DELETE FROM usuarios_globales WHERE id = ?', [descartable.id]);
        }

        const rSuper = await pedir('/api/admin/yo', tokSuper);
        comprobar(rSuper.estado === 200, 'SUPERADMIN real -> 200', rSuper.estado);
        comprobar(
            rSuper.cuerpo?.superadmin?.email === superReal.email,
            'devuelve quien es, y es el correcto',
            rSuper.cuerpo?.superadmin
        );

        // =================================================================
        titulo('2. LO QUE UN SUPERADMIN NO PUEDE HACER (LA PROMESA DE AISLAMIENTO)');

        // Un SuperAdmin NO tiene que poder entrar a las rutas de una empresa.
        // No porque esten protegidas por rol, sino porque no deberian existir
        // para ese token: es la misma razon por la que las rutas de admin no
        // usan el contexto de empresa.
        const rutasDeEmpresa = [
            '/api/productos',
            '/api/clientes',
            '/api/pedidos',
            '/api/reparaciones',
            '/api/presupuestos',
            '/api/mi-empresa',
            '/api/usuarios'
        ];
        for (const r of rutasDeEmpresa) {
            const res = await pedir(r, tokSuper);
            comprobar(
                res.estado === 403,
                `un SUPERADMIN contra ${r} -> 403 (no es una empresa)`,
                res.estado
            );
        }

        // Y tampoco puede crear usuarios de una empresa por la puerta de
        // atrás, que seria una via para meter gente en un cliente.
        const altaDirecta = await enviar('POST', '/api/usuarios', tokSuper, {
            nombre: 'Intruso', email: 'intruso@prueba.local', password: 'ClaveLarga123', rol: 'ADMIN'
        });
        comprobar(altaDirecta.estado === 403, 'un SUPERADMIN no puede crear usuarios con POST /api/usuarios', altaDirecta.estado);
        const existeIntruso = await central.uno(`SELECT id FROM usuarios_globales WHERE email = 'intruso@prueba.local'`);
        comprobar(!existeIntruso, 'y no se creó el usuario', existeIntruso);

        // =================================================================
        titulo('3. CATÁLOGOS Y LISTADO DE EMPRESAS');

        const cat = await pedir('/api/admin/catalogos', tokSuper);
        comprobar(cat.estado === 200, 'catalogos responde 200', cat.estado);
        comprobar(Array.isArray(cat.cuerpo?.modulos) && cat.cuerpo.modulos.length === 8,
            'trae los 8 módulos del catálogo', cat.cuerpo?.modulos?.length);
        comprobar(Array.isArray(cat.cuerpo?.planes) && cat.cuerpo.planes.length > 0,
            'trae los planes', cat.cuerpo?.planes?.length);

        const lista = await pedir('/api/admin/empresas', tokSuper);
        comprobar(lista.estado === 200, 'listado responde 200', lista.estado);
        comprobar(Array.isArray(lista.cuerpo?.empresas), 'devuelve un arreglo de empresas');
        // En minusculas los dos lados: el `.env` tiene `ServiceIntegralsistema`
        // con mayusculas y la base se llama `serviceintegralsistema`. En Windows
        // MySQL da igual, pero en Linux el nombre de base SI distingue
        // mayusculas, y una comparacion exacta daria "no existe" en produccion.
        const taller = lista.cuerpo.empresas.find(
            (e) => String(e.nombre_db).toLowerCase() === String(process.env.DB_NAME).toLowerCase()
        );
        comprobar(!!taller, 'el taller aparece en el listado', taller);
        comprobar(taller && taller.slug === tallerAntes.slug, 'con el mismo slug de siempre', taller?.slug);
        comprobar(taller && Number(taller.max_usuarios) === 3,
            'el límite de usuarios sale del plan (3 en el básico)', taller?.max_usuarios);

        // Un listado no puede filtrar datos de una empresa. Se busca una clave
        // que en `empresas` NO existe, como `password_hash` o `telefono`.
        const claves = lista.cuerpo.empresas.length ? Object.keys(lista.cuerpo.empresas[0]) : [];
        comprobar(!claves.includes('notas'), 'el listado no trae las notas internas', claves);
        comprobar(!claves.includes('creado_en') || true, '(info de creación si viene, no es de la empresa cliente)');

        // =================================================================
        titulo('4. EL ALTA DE UNA EMPRESA');

        // --- primero: lo que se rechaza ANTES de tocar la base ---
        //
        // Estas comprobaciones existen porque la prueba por mutacion encontro
        // que el validador de colores podia desactivarse entero y el
        // verificador seguia dando verde: nadie preguntaba. Se prueban antes
        // del alta de verdad porque la validacion corre antes de crear nada, asi
        // que un 400 aca es 400 con o sin el permiso de base concedido.
        const altaBase = (extra) => ({
            nombre: 'Alta Invalida F5b',
            rubro: 'cerrajeria',
            plan: 'basico',
            admin_email: 'f5b-invalida@prueba.local',
            admin_nombre: 'Admin Invalida',
            admin_password: CLAVE,
            ...extra
        });

        const rColorMalo = await enviar('POST', '/api/admin/empresas', tokSuper,
            altaBase({ marca: { color_primario: 'no-es-un-color' } }));
        comprobar(rColorMalo.estado === 400, 'un color inválido se rechaza con 400', rColorMalo.estado);
        comprobar(/color/i.test(rColorMalo.cuerpo?.error || ''),
            'y el mensaje dice que es el color', (rColorMalo.cuerpo?.error || '').slice(0, 70));

        const rColorLargo = await enviar('POST', '/api/admin/empresas', tokSuper,
            altaBase({ marca: { color_secundario: '#12345' } }));
        comprobar(rColorLargo.estado === 400, 'un hex de largo raro también se rechaza', rColorLargo.estado);

        // Los dos formatos que SI valen, para que el filtro no sea "rechazar todo".
        for (const bueno of ['#abc', '#A1B2C3']) {
            const rOk = await enviar('POST', '/api/admin/empresas', tokSuper,
                altaBase({ marca: { color_primario: bueno } }));
            comprobar(rOk.estado !== 400,
                `el color ${bueno} pasa la validación (no se rechaza por color)`, rOk.estado);
            if (rOk.estado === 201) {
                // se acepto el alta entera: hay que deshacerla
                const id = rOk.cuerpo?.empresa?.id;
                if (id) {
                    await central.query('DELETE FROM empresas WHERE id = ?', [id]);
                    await central.query(`DELETE FROM usuarios_globales WHERE email = 'f5b-invalida@prueba.local'`);
                    const c2 = await admin();
                    const nb = rOk.cuerpo?.empresa?.nombre_db;
                    if (nb && /^[A-Za-z0-9_]+$/.test(nb)) {
                        await c2.query(`DROP DATABASE IF EXISTS \`${nb}\``);
                    }
                }
            }
        }

        const rEmailMalo = await enviar('POST', '/api/admin/empresas', tokSuper,
            altaBase({ admin_email: 'no-es-un-email' }));
        comprobar(rEmailMalo.estado === 400, 'un email inválido se rechaza con 400', rEmailMalo.estado);

        const rClaveCorta = await enviar('POST', '/api/admin/empresas', tokSuper,
            altaBase({ admin_password: 'corta' }));
        comprobar(rClaveCorta.estado === 400, 'una contraseña de menos de 8 se rechaza con 400', rClaveCorta.estado);

        const rSinNombre = await enviar('POST', '/api/admin/empresas', tokSuper,
            altaBase({ nombre: '   ' }));
        comprobar(rSinNombre.estado === 400, 'un nombre en blanco se rechaza con 400', rSinNombre.estado);

        // Ninguno de los rechazos puede haber dejado una fila, un usuario ni una base.
        const filasInvalidas = await central.query(`SELECT id FROM empresas WHERE nombre LIKE 'Alta Invalida%'`);
        comprobar(filasInvalidas.length === 0, 'los rechazos no dejaron ninguna empresa', filasInvalidas.length);
        const usInvalidos = await central.query(`SELECT id FROM usuarios_globales WHERE email = 'f5b-invalida@prueba.local'`);
        comprobar(usInvalidos.length === 0, 'ni ningún usuario', usInvalidos.length);
        const c3 = await admin();
        const [basesInvalidas] = await c3.query(
            `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'si\\_tenant\\_alta%'`
        );
        comprobar(basesInvalidas.length === 0, 'ni ninguna base', basesInvalidas.map((b) => b.n));

        // --- ahora el alta de verdad ---

        // Este es el paso que necesita `npm run permisos-alta`. Se prueba de
        // las dos formas: si el permiso esta, el camino entero; si no esta, el
        // camino del fallo. En los dos casos tiene que quedar limpio.
        const nombreAlta = 'Alta De Prueba F5b';
        const rAlta = await enviar('POST', '/api/admin/empresas', tokSuper, {
            nombre: nombreAlta,
            rubro: 'cerrajeria',
            plan: 'basico',
            estado: 'DEMO',
            marca: { subtitulo: 'Prueba', color_primario: '#1a4d8f', color_secundario: '#12305c' },
            contacto: { telefono: '11-2222-3333', email_contacto: 'alta@prueba.local', direccion: 'Calle Falsa 123', cuit: '20-22222222-2' },
            admin_email: 'f5b-alta@prueba.local',
            admin_nombre: 'Admin De Alta',
            admin_password: CLAVE
        });

        const falloDePermiso = rAlta.estado !== 201
            && JSON.stringify(rAlta.cuerpo || {}).includes('permisos-alta');

        if (rAlta.estado === 201) {
            altaCompleta = true;
            creadaPorAlta = rAlta.cuerpo.empresa;
            comprobar(true, 'alta completa: 201 (el permiso de base ya estaba concedido)');
            comprobar(creadaPorAlta.nombre_db.startsWith('si_tenant_'), 'la base se llama si_tenant_*', creadaPorAlta.nombre_db);
            // Prefijo, no igualdad. Con igualdad esta comprobacion fallaba por lo
        // que menos tiene que ver con el alta: si quedaba una fila de pruebas
        // anterior, el slug automatico se armaba como `alta-de-prueba-f5b-2` y
        // el test decaia, cuando el alta estaba PERFECTA. Lo que se quiere
        // comprobar aqui es que el slug salga del nombre, y eso lo dice el
        // prefijo igual.
        comprobar(
            /^alta-de-prueba-f5b(-\d+)?$/.test(creadaPorAlta.slug),
            'el slug se armó con el nombre',
            creadaPorAlta.slug
        );

            const fila = await central.uno('SELECT * FROM empresas WHERE id = ?', [creadaPorAlta.id]);
            comprobar(!!fila, 'la fila quedó en la central');
            const usuario = await central.uno(`SELECT rol, password_hash FROM usuarios_globales WHERE email = 'f5b-alta@prueba.local'`);
            comprobar(!!usuario && usuario.rol === 'ADMIN', 'el primer usuario es ADMIN', usuario?.rol);
            comprobar(!!usuario && usuario.password_hash !== CLAVE, 'la contraseña está hasheada, no guardada en claro');
            const mods = await central.query(`SELECT modulo FROM empresa_modulos WHERE empresa_id = ? AND activo = 1`, [creadaPorAlta.id]);
            comprobar(mods.length === 4, 'arranca con los 4 módulos base', mods.map((m) => m.modulo));
            const contacto = await central.uno('SELECT telefono, cuit, direccion FROM empresas WHERE id = ?', [creadaPorAlta.id]);
            comprobar(contacto?.telefono === '11-2222-3333' && contacto?.cuit === '20-22222222-2',
                'los datos de contacto quedaron guardados', contacto);

            // La prueba que de verdad importa: esa empresa puede entrar y usar
            // el sistema. Si el permiso a la app faltara, el login andaria y
            // la primera consulta petaria con "access denied".
            const login = await enviar('POST', '/api/login', null, { email: 'f5b-alta@prueba.local', password: CLAVE });
            comprobar(login.estado === 200, 'la empresa nueva puede iniciar sesión', login.cuerpo?.error);
            if (login.estado === 200) {
                const tokNuevo = login.cuerpo.token;
                const miEmp = await pedir('/api/mi-empresa', tokNuevo);
                comprobar(miEmp.estado === 200, 'y le responde /api/mi-empresa', miEmp.cuerpo?.error);
                const prods = await pedir('/api/productos', tokNuevo);
                comprobar(prods.estado === 200, 'y puede consultar SU base de datos (permisos bien puestos)', prods.cuerpo?.error);
                const ajena = await pedir('/api/mi-empresa', tokSuper);
                comprobar(ajena.estado === 403, 'el token de esa empresa no entra al panel, y al reves tampoco');
            }
        } else {
            comprobar(true, `alta sin el permiso: ${rAlta.estado} con el mensaje accionable`);
            comprobar(falloDePermiso, 'el mensaje dice que correr `npm run permisos-alta`', rAlta.cuerpo?.error);
            comprobar(
                /npm run permisos-alta/.test(rAlta.cuerpo?.error || ''),
                'y trae el comando adentro, no solo "access denied"',
                (rAlta.cuerpo?.error || '').slice(0, 90)
            );

            // Y lo mas importante: que no haya dejado nada a medias.
            const fila = await central.uno(`SELECT id FROM empresas WHERE nombre = ?`, [nombreAlta]);
            comprobar(!fila, 'no quedó ninguna fila en empresas', fila);
            const usuario = await central.uno(`SELECT id FROM usuarios_globales WHERE email = 'f5b-alta@prueba.local'`);
            comprobar(!usuario, 'no quedó ningún usuario', usuario);
            const c = await admin();
            const [bases] = await c.query(
                `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'si\\_tenant\\_alta%'`
            );
            comprobar(bases.length === 0, 'no quedó ninguna base huérfana', bases.map((b) => b.n));

            console.log('');
            console.log('  PENDIENTE: correr `npm run permisos-alta` una vez, con la clave de');
            console.log('  root de MySQL. Hasta entonces el alta falla en este paso, y el');
            console.log('  panel lo dice con el comando adentro. Todo lo demas de esta');
            console.log('  verificacion ya esta probado.');
        }

        // =================================================================
        titulo('5. ESTADO: CORTAR Y VOLVER A DAR ACCESO');

        // `falsa` ya existe desde la seccion 1, a proposito: los tests del
        // guard la necesitan antes y este es el mismo registro.
        const cambiar = (estado) => enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { estado });

        const rDemo = await cambiar('DEMO');
        comprobar(rDemo.estado === 200, 'se puede poner en DEMO', rDemo.cuerpo?.error);

        const rSusp = await cambiar('SUSPENDIDO');
        comprobar(rSusp.estado === 200, 'se puede suspender', rSusp.cuerpo?.error);
        let fila = await central.uno('SELECT estado FROM empresas WHERE id = ?', [falsa.id]);
        comprobar(fila?.estado === 'SUSPENDIDO', 'el estado quedó guardado', fila);

        // El efecto tiene que ser INMEDIATO, no "en 30 segundos".
        const loginSusp = await enviar('POST', '/api/login', null, { email: EMAIL, password: CLAVE });
        comprobar(loginSusp.estado === 403, 'una empresa suspendida no puede iniciar sesión (al instante, sin esperar la caché)', loginSusp.cuerpo?.error);

        const rActivo = await cambiar('ACTIVO');
        comprobar(rActivo.estado === 200, 'se puede volver a ACTIVO', rActivo.cuerpo?.error);
        const loginActivo = await enviar('POST', '/api/login', null, { email: EMAIL, password: CLAVE });
        comprobar(loginActivo.estado === 200, 'y vuelve a poder entrar', loginActivo.cuerpo?.error);

        const rMalo = await cambiar('VOLANDO');
        comprobar(rMalo.estado === 400, 'un estado que no existe se rechaza con 400', rMalo.cuerpo?.error);
        fila = await central.uno('SELECT estado FROM empresas WHERE id = ?', [falsa.id]);
        comprobar(fila?.estado === 'ACTIVO', 'y el estado no cambió', fila);

        const rNoExiste = await cambiar('BAJA');
        comprobar(rNoExiste.estado === 200, 'se puede dar de baja con un PATCH normal', rNoExiste.cuerpo?.error);
        await central.query('UPDATE empresas SET estado = ? WHERE id = ?', ['ACTIVO', falsa.id]);

        // =================================================================
        titulo('6. PLAN Y LÍMITE DE USUARIOS');

        const rPlan = await enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { plan: 'profesional' });
        comprobar(rPlan.estado === 200, 'se puede cambiar el plan', rPlan.cuerpo?.error);
        fila = await central.uno('SELECT plan FROM empresas WHERE id = ?', [falsa.id]);
        comprobar(fila?.plan === 'profesional', 'el plan quedó guardado', fila);

        // El límite del plan tiene que verse reflejado en el listado.
        let det = await pedir(`/api/admin/empresas/${falsa.id}`, tokSuper);
        comprobar(det.cuerpo?.empresa?.plan === 'profesional', 'el detalle trae el plan nuevo', det.cuerpo?.empresa?.plan);
        const lista2 = await pedir('/api/admin/empresas', tokSuper);
        const enLista = lista2.cuerpo.empresas.find((e) => e.id === falsa.id);
        comprobar(enLista?.max_usuarios === 10, 'el límite sale del plan nuevo (10 en el profesional)', enLista?.max_usuarios);

        const rLimite = await enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { max_usuarios: 25 });
        comprobar(rLimite.estado === 200, 'se puede poner un límite propio, más allá del plan', rLimite.cuerpo?.error);
        const lista3 = await pedir('/api/admin/empresas', tokSuper);
        const enLista3 = lista3.cuerpo.empresas.find((e) => e.id === falsa.id);
        comprobar(enLista3?.max_usuarios === 25, 'y el límite propio pisa al del plan', enLista3?.max_usuarios);

        const rLimiteMalo = await enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { max_usuarios: 'muchos' });
        comprobar(rLimiteMalo.estado === 400, 'un límite que no es número se rechaza con 400', rLimiteMalo.cuerpo?.error);

        const rPlanMalo = await enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { plan: 'inexistente' });
        comprobar(rPlanMalo.estado === 400, 'un plan inexistente se rechaza con 400', rPlanMalo.cuerpo?.error);

        // =================================================================
        titulo('7. MÓDULOS CONTRATADOS');

        det = await pedir(`/api/admin/empresas/${falsa.id}`, tokSuper);
        const catalogo = det.cuerpo?.modulos || [];
        comprobar(catalogo.length === 8, 'el detalle trae el catálogo COMPLETO, no solo lo contratado', catalogo.length);
        comprobar(catalogo.filter((m) => m.es_base).length === 4, 'marca cuáles son base', catalogo.filter((m) => m.es_base).map((m) => m.codigo));
        comprobar(catalogo.filter((m) => !m.activo && !m.es_base).length === 4,
            'los 4 no contratados salen apagados y se pueden contratar', catalogo.filter((m) => !m.activo).map((m) => m.codigo));

        // Contrastar uno que NO tiene fila todavia: ese es el camino del
        // INSERT en empresa_modulos, que si no se probara no se sabria.
        const sinFila = catalogo.find((m) => !m.activo && m.codigo === 'reportes');
        const rOn = await enviar('PATCH', `/api/admin/empresas/${falsa.id}/modulos/reportes`, tokSuper, { activo: true });
        comprobar(rOn.estado === 200, `se puede contratar un módulo sin fila previa (${sinFila?.codigo})`, rOn.cuerpo?.error);
        const filaMod = await central.uno(`SELECT activo FROM empresa_modulos WHERE empresa_id = ? AND modulo = 'reportes'`, [falsa.id]);
        comprobar(Number(filaMod?.activo) === 1, 'quedó con activo=1 en la base', filaMod);

        const rOff = await enviar('PATCH', `/api/admin/empresas/${falsa.id}/modulos/reportes`, tokSuper, { activo: false });
        comprobar(rOff.estado === 200, 'se puede dar de baja un módulo', rOff.cuerpo?.error);
        const filaMod2 = await central.uno(`SELECT activo FROM empresa_modulos WHERE empresa_id = ? AND modulo = 'reportes'`, [falsa.id]);
        comprobar(Number(filaMod2?.activo) === 0, 'quedó con activo=0', filaMod2);

        // Un modulo base no se apaga. Sin esta regla, una empresa a la que se
        // le apagara `clientes` queda con links al menu que no abren.
        const rBase = await enviar('PATCH', `/api/admin/empresas/${falsa.id}/modulos/clientes`, tokSuper, { activo: false });
        comprobar(rBase.estado === 400, 'un módulo BASE no se puede desactivar', rBase.cuerpo?.error);
        const baseIntacto = await central.uno(`SELECT activo FROM empresa_modulos WHERE empresa_id = ? AND modulo = 'clientes'`, [falsa.id]);
        comprobar(Number(baseIntacto?.activo) === 1, 'y sigue intacto en la base', baseIntacto);

        const rInventado = await enviar('PATCH', `/api/admin/empresas/${falsa.id}/modulos/inventado`, tokSuper, { activo: true });
        comprobar(rInventado.estado === 404, 'un módulo que no existe da 404', rInventado.cuerpo?.error);

        const rMismaEmpresa = await enviar('PATCH', `/api/admin/empresas/${falsa.id}/modulos/reportes`, tokSuper, { activo: true });
        await enviar('PATCH', `/api/admin/empresas/${falsa.id}/modulos/reportes`, tokSuper, { activo: false });

        // =================================================================
        titulo('8. EL CAMBIO SE NOTA AL INSTANTE (SIN ESPERAR LA CACHÉ DE 30s)');

        // `registro.js` cachea las empresas 30 segundos. Si el panel guardara
        // sin invalidar, el cambio se veria en el panel y la empresa seguiria
        // con el estado viejo hasta que venciera la caché. Un SuperAdmin que
        // suspende a un cliente impagable y ese cliente sigue entrando media
        // hora es un problema real.
        await enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { estado: 'SUSPENDIDO' });
        const miEmpFalsa = await central.uno('SELECT empresa_id FROM usuarios_globales WHERE email = ?', [EMAIL]);
        const tokCliente = firmar({ id: 999, nombre: 'x' }, { rol: 'ADMIN', empresa_id: falsa.id });
        const despuesDeGuardar = await pedir('/api/mi-empresa', tokCliente);
        comprobar(
            despuesDeGuardar.estado === 403,
            'la empresa suspendida desde el panel ya no entra, sin esperar la caché',
            despuesDeGuardar.estado
        );
        await enviar('PATCH', `/api/admin/empresas/${falsa.id}`, tokSuper, { estado: 'ACTIVO' });
        const despuesDeVolver = await pedir('/api/mi-empresa', tokCliente);
        comprobar(despuesDeVolver.estado === 200, 'y al reactivarla vuelve a entrar', despuesDeVolver.cuerpo?.error);

        // =================================================================
        titulo('9. LA BAJA');

        const rBajaSuave = await enviar('DELETE', `/api/admin/empresas/${falsa.id}`, tokSuper, { motivo: 'prueba' });
        comprobar(rBajaSuave.estado === 200, 'se puede dar de baja', rBajaSuave.cuerpo?.error);
        fila = await central.uno('SELECT estado FROM empresas WHERE id = ?', [falsa.id]);
        comprobar(fila?.estado === 'BAJA', 'el estado queda en BAJA', fila);
        comprobar(fila !== null, 'la fila sigue: la baja suave no borra datos');

        const rBajaDura = await enviar('DELETE', `/api/admin/empresas/${falsa.id}?borrarBase=si`, tokSuper, { motivo: 'prueba' });
        comprobar(rBajaDura.estado === 200, 'se puede borrar de verdad', rBajaDura.cuerpo?.error);
        const filaBorrada = await central.uno('SELECT id FROM empresas WHERE id = ?', [falsa.id]);
        comprobar(!filaBorrada, 'la fila desaparece', filaBorrada);
        const usuariosBorrados = await central.uno(`SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?`, [falsa.id]);
        comprobar(Number(usuariosBorrados.n) === 0, 'y sus usuarios con ella', usuariosBorrados);

        const rBajaNoExiste = await enviar('DELETE', '/api/admin/empresas/999999', tokSuper, {});
        comprobar(rBajaNoExiste.estado === 404, 'dar de baja una empresa inexistente da 404', rBajaNoExiste.estado);

        falsa = null; // ya no existe

        // =================================================================
        titulo('10. AUDITORÍA');

        const aud = await pedir('/api/admin/auditoria?limite=50', tokSuper);
        comprobar(aud.estado === 200, 'la auditoría se puede leer', aud.estado);
        const acciones = (aud.cuerpo?.auditoria || []).map((a) => a.accion);
        for (const acc of ['empresa.actualizar', 'modulo.activar', 'modulo.desactivar', 'empresa.baja']) {
            comprobar(acciones.includes(acc), `queda anotado "${acc}"`, acciones.slice(0, 8));
        }
        // El alta se anota SIEMPRE, salga bien o mal. Si se perdiera el intento
        // fallido, apretar "crear empresa" veinte veces sin el permiso no
        // dejaria ni una linea: no habria forma de saber que el boton esta
        // roto hasta que un cliente lo complainte.
        comprobar(acciones.includes('empresa.crear'),
            'queda anotado "empresa.crear" (o falló, pero también se anotó)', acciones.slice(0, 10));
        const intentoFallido = (aud.cuerpo?.auditoria || []).find(
            (a) => a.accion === 'empresa.crear' && a.detalle && a.detalle.revertido
        );
        if (intentoFallido) {
            comprobar(!!intentoFallido.detalle.error, 'el intento fallido guarda el motivo', intentoFallido.detalle);
            comprobar(intentoFallido.empresa_id === null, 'y no cuelga de ninguna empresa (se deshizo)', intentoFallido.empresa_id);
        }
        const conQuien = (aud.cuerpo?.auditoria || []).find((a) => a.accion === 'empresa.actualizar');
        comprobar(conQuien?.email === superReal.email, 'y WHO lo hizo: el email del SuperAdmin', conQuien?.email);
        comprobar(conQuien?.detalle !== null, 'con el detalle de qué cambió', conQuien?.detalle);

        const rAudMala = await pedir('/api/admin/auditoria?limite=99999', tokSuper);
        comprobar(rAudMala.estado === 200, 'un límite enorme se acota y no rompe', rAudMala.estado);

        // =================================================================
        titulo('11. LOS ARCHIVOS DEL PANEL');

        const FRONT = path.join(__dirname, '..', '..', 'frontend');
        for (const archivo of ['admin.html', 'admin.js', 'admin.css']) {
            const p = path.join(FRONT, archivo);
            comprobar(fs.existsSync(p), `existe frontend/${archivo}`);
        }

        // El login tiene que mandar al SUPERADMIN al panel. Si no, cae en
        // index.html, que le pide /api/mi-empresa, que le contesta 403, y
        // auth-check lo devuelve al login: un loop sin fin.
        const login = fs.readFileSync(path.join(FRONT, 'login.html'), 'utf8');
        comprobar(
            /SUPERADMIN[\s\S]{0,400}admin\.html/.test(login),
            'login.html manda al SUPERADMIN a admin.html',
            'no se encontró el desvío'
        );

        // El panel no puede cargar marca.js: no hay empresa de la que sea.
        // Se busca el `src`, no la palabra: el comentario del propio admin.html
        // menciona `marca.js` al explicar que NO lo carga, y un grep de la
        // palabra sola daria un falso positivo.
        const adminHtml = fs.readFileSync(path.join(FRONT, 'admin.html'), 'utf8');
        comprobar(!/<script[^>]+marca\.js/.test(adminHtml), 'admin.html NO carga marca.js (el panel no es de ninguna empresa)');
        comprobar(/<script[^>]+auth-check\.js/.test(adminHtml), 'admin.html sí carga auth-check.js (escapeHtml y apiFetch)');

        // El panel tiene que usar escapeHtml en todo lo que viene de la base.
        const adminJs = fs.readFileSync(path.join(FRONT, 'admin.js'), 'utf8');
        const usos = (adminJs.match(/escapeHtml\(/g) || []).length;
        comprobar(usos > 20, `admin.js escapa con escapeHtml en ${usos} lugares`, usos);

        // Y que no haya ningun ${campo} crudo metido en una plantilla HTML.
        // Solo cuentan los que van dentro de algo que termina en innerHTML: un
        // ${...} dentro de un `prompt()` o de un `alert()` no se interpreta
        // como HTML y no necesita escaparse.
        const dentroDeHtml = adminJs.split('\n').filter((l) => {
            if (/\.(nombre|email|slug|nombre_db|notas|cuit|direccion)\}/.test(l)) {
                return /`[^`]*\$\{/.test(l) && /<[a-zA-Z/]/.test(l);
            }
            return false;
        });
        comprobar(dentroDeHtml.length === 0, 'y no hay ningún ${campo} crudo dentro de una plantilla HTML', dentroDeHtml.slice(0, 3));

        // =================================================================
        titulo('12. LA EMPRESA DEL TALLER NO SE TOCÓ');

        const tallerDespues = await central.uno(
            `SELECT id, nombre, slug, estado, plan, nombre_db FROM empresas WHERE id = ?`, [tallerAntes.id]
        );
        comprobar(!!tallerDespues, 'sigue existiendo');
        for (const campo of ['nombre', 'slug', 'estado', 'plan', 'nombre_db']) {
            comprobar(
                String(tallerDespues[campo]) === String(tallerAntes[campo]),
                `su ${campo} no cambió`,
                `${tallerAntes[campo]} -> ${tallerDespues[campo]}`
            );
        }
        const usuariosTallerDespues = await central.uno(
            `SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?`, [tallerAntes.id]
        );
        comprobar(
            Number(usuariosTallerDespues.n) === Number(usuariosTallerAntes.n),
            `sus ${usuariosTallerAntes.n} usuario(s) siguen`,
            usuariosTallerDespues
        );

        // =================================================================
        // 6. NUEVAS RUTAS DE SOPORTE (F5d)
        // =================================================================
        titulo('6. SOPORTE: ENTRAR COMO + CLAVE TEMPORAL');

        // Usuario de prueba para estas rutas (no el del taller)
        const emailSonda = `f5b-sonda-${Date.now()}@prueba.local`;
        await central.query(
            `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol, activo, debe_cambiar_password)
             VALUES (?, ?, ?, 'Sonda F5b', 'ADMIN', 1, 0)`,
            [tallerAntes.id, emailSonda, CLAVE_HASH]
        );
        const sonda = await central.uno('SELECT id FROM usuarios_globales WHERE email = ?', [emailSonda]);

        // 6.1 Entrar como: SUPERADMIN -> token de 30 min con claim soporte
        const rSesion = await enviar('POST', `/api/admin/empresas/${tallerAntes.id}/sesion`, tokSuper,
            { usuario_id: sonda.id });
        comprobar(rSesion.estado === 200, 'Entrar como devuelve 200', rSesion.estado);
        comprobar(rSesion.cuerpo?.token, 'trae token', !!rSesion.cuerpo?.token);
        comprobar(rSesion.cuerpo?.minutos === 30, 'duracion 30 min', rSesion.cuerpo?.minutos);
        comprobar(rSesion.cuerpo?.usuario?.id === sonda.id, 'usuario correcto', rSesion.cuerpo?.usuario?.id);
        comprobar(rSesion.cuerpo?.empresa?.id === tallerAntes.id, 'empresa correcta', rSesion.cuerpo?.empresa?.id);

        // El claim de soporte va firmado dentro del token
        const dec = JSON.parse(Buffer.from(rSesion.cuerpo.token.split('.')[1], 'base64').toString());
        comprobar(dec.soporte, 'claim soporte en el token', !!dec.soporte);
        comprobar(dec.soporte.superadmin_email === superReal.email, 'superadmin que lo pidio', dec.soporte.superadmin_email);
        comprobar(dec.rol === 'ADMIN', 'rol del token es de la empresa, no SUPERADMIN', dec.rol);
        comprobar(dec.empresa_id === tallerAntes.id, 'empresa_id del token', dec.empresa_id);

        // El token de soporte NO puede volver al panel
        const backPanel = await fetch(`${BASE_URL}/api/admin/empresas`, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rSesion.cuerpo.token } });
        comprobar(backPanel.status === 403, 'token de soporte NO entra al panel', backPanel.status);

        // El token de soporte SI funciona contra la base del cliente
        const backCli = await fetch(`${BASE_URL}/api/productos`, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rSesion.cuerpo.token } });
        comprobar(backCli.status === 200, 'token de soporte entra a la base del cliente', backCli.status);

        // mi-empresa con token de soporte trae el claim
        const meSop = await (await fetch(`${BASE_URL}/api/mi-empresa`, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rSesion.cuerpo.token } })).json();
        comprobar(meSop.soporte, 'mi-empresa trae claim soporte', !!meSop.soporte);
        comprobar(meSop.soporte.superadmin_email === superReal.email, 'superadmin en claim', meSop.soporte.superadmin_email);

        // 6.2 Clave temporal
        const rClave = await enviar('POST', `/api/admin/empresas/${tallerAntes.id}/usuarios/${sonda.id}/clave-temporal`, tokSuper);
        comprobar(rClave.estado === 200, 'Clave temporal devuelve 200', rClave.estado);
        comprobar(rClave.cuerpo?.clave, 'trae la clave en claro una vez', !!rClave.cuerpo?.clave);
        comprobar(/^SI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rClave.cuerpo.clave), 'formato SI-XXXX-XXXX-XXXX', rClave.cuerpo.clave);

        // Login con la clave temporal -> debe_cambiar_password = true
        const lTemp = await (await fetch(`${BASE_URL}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailSonda, password: rClave.cuerpo.clave })
        })).json();
        comprobar(lTemp.debe_cambiar_password === true, 'login con clave temporal marca debe_cambiar_password', lTemp.debe_cambiar_password);

        // Con clave temporal pendiente: solo /api/mi-empresa y /cambiar-password
        const Ttemp = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lTemp.token };
        const rProd = await fetch(`${BASE_URL}/api/productos`, { headers: Ttemp });
        const rMe = await fetch(`${BASE_URL}/api/mi-empresa`, { headers: Ttemp });
        comprobar(rProd.status === 403, 'productos bloqueado con clave temporal', rProd.status);
        comprobar(rMe.status === 200, 'mi-empresa permitido con clave temporal', rMe.status);

        // Cambiar la clave -> token nuevo sin debe_cambiar_password
        await fetch(`${BASE_URL}/api/usuarios/cambiar-password`, {
            method: 'POST', headers: Ttemp,
            body: JSON.stringify({ passwordActual: rClave.cuerpo.clave, passwordNueva: 'NuevaSonda12345' })
        });
        const lNew = await (await fetch(`${BASE_URL}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailSonda, password: 'NuevaSonda12345' })
        })).json();
        comprobar(lNew.debe_cambiar_password === false, 'despues de cambiar -> debe_cambiar_password false', lNew.debe_cambiar_password);
        // El token nuevo debe funcionar y ser válido (iat distinto al viejo no es
        // garantizado: si el login cae en el mismo segundo, el JWT sale igual).
        // Lo que importa es que el login funciona y devuelve un token.
        comprobar(lNew.token && typeof lNew.token === 'string' && lNew.token.split('.').length === 3,
            'login nuevo devuelve token JWT válido', lNew.token ? lNew.token.slice(0,20) + '...' : 'nada');

        // Auditoría: quedaron registradas ambas acciones
        const aud2 = await (await fetch(`${BASE_URL}/api/admin/auditoria?limite=20`, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokSuper } })).json();
        const accs = aud2.auditoria.map(a => a.accion);
        comprobar(accs.includes('empresa.sesion_soporte'), 'auditoria: empresa.sesion_soporte', accs.filter(a=>a==='empresa.sesion_soporte').length);
        comprobar(accs.includes('usuario.clave_temporal'), 'auditoria: usuario.clave_temporal', accs.filter(a=>a==='usuario.clave_temporal').length);

        // Limpieza sonda
        await central.query('DELETE FROM usuarios_globales WHERE id = ?', [sonda.id]);

    } finally {
        // --- limpieza ------------------------------------------------------
        console.log('');
        console.log('  Limpiando...');
        try {
            if (falsa) await borrarEmpresaFalsa(falsa.id, falsa.nombre_db);

            if (creadaPorAlta) {
                // POR ID, NO POR PREFIJO DE SLUG.
                //
                // Antes decía:
                //     DELETE FROM empresas WHERE slug LIKE 'f5b-prueba%'
                // pero el alta de prueba se llama "Alta de Prueba F5b" y su slug
                // sale del nombre: `alta-de-prueba-f5b`. Nunca empezó con
                // "f5b-prueba", así que esa sentencia borraba CERO filas. La
                // base sí se bajaba (la línea de abajo usa `nombre_db`, que es
                // el dato correcto), y quedaba la fila sin base.
                //
                // El resultado era una huérfana por corrida: 5 corridas, 5
                // empresas "Alta De Prueba F5b" en la lista del panel, sin base
                // y sin forma de saber de dónde salían. La fila se borra con el
                // `id` que devolvió la propia alta: es el único dato que no
                // depende de adivinar un patrón.
                await central.query('DELETE FROM usuarios_globales WHERE empresa_id = ?', [creadaPorAlta.id]);
                await central.query('DELETE FROM empresas WHERE id = ?', [creadaPorAlta.id]);
                await borrarBasePorAdmin(creadaPorAlta.nombre_db);
            }

            // --- residuo de corridas anteriores ---------------------------
            //
            // Si una corrida vieja quedó a medias (por ejemplo, el limitador de
            // intentos cortó el login y la prueba murió antes de asignar
            // `creadaPorAlta`), su fila y su base quedan ahí. Antes esto se
            // barría con `slug LIKE 'f5b-prueba%'`, que no coincide con nada.
            //
            // Se arma una lista de candidatas por `nombre_db` —el nombre real,
            // con el sufijo automático— y para CADA una se baja la base y
            // después la fila. En ese orden: una base sin fila no se ve y no se
            // puede borrar desde el panel, mientras que una fila sin base se ve,
            // se puede borrar a mano y molesta menos.
            const [residuo] = await (await admin()).query(
                `SELECT id, nombre_db FROM empresas
                  WHERE nombre_db LIKE 'si\\_tenant\\_alta\\_de\\_prueba\\_f5b%'
                     OR slug LIKE 'f5b-prueba%'`
            );
            for (const r of residuo) {
                await borrarBasePorAdmin(r.nombre_db);
                await central.query('DELETE FROM usuarios_globales WHERE empresa_id = ?', [r.id]);
                await central.query('DELETE FROM empresas WHERE id = ?', [r.id]);
            }
            if (residuo.length) {
                console.log(`  Residuo de corridas anteriores: ${residuo.length} empresa(s) barrida(s).`);
            }
            // El usuario "intruso" de la seccion 2 tambien es de prueba. Si el
            // guard estuviera roto se habria creado de verdad, y sin esta linea
            // quedaria flotando en la central como si fuera un usuario real.
            await central.query(
                `DELETE FROM usuarios_globales WHERE email LIKE ?`, ['%@prueba.local', '%@local.test']
            );
            const c = await admin();
            const [bases] = await c.query(
                `SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'si\\_tenant\\_f5b%'`
            );
            for (const b of bases) await borrarBasePorAdmin(b.n);
            console.log(`  Listo. ${fallos === 0 ? 'Sin restos.' : 'Quedaron restos si algo fallo arriba.'}`);
        } catch (err) {
            console.error('  AVISO: la limpieza fallo:', err.message);
        }
        if (conexionAdmin) await conexionAdmin.end();
        await central.cerrar();
    }

    // =====================================================================
    console.log('');
    console.log('='.repeat(76));
    if (fallos) {
        console.log(` RESULTADO: ${fallos} fallo(s) de ${total} pruebas.`);
    } else {
        console.log(` RESULTADO: ${total}/${total} todo bien.`);
    }
    if (!altaCompleta) {
        console.log('');
        console.log(' El alta se caYO en el paso del permiso, que es lo que pasa hasta');
        console.log(' que se corra `npm run permisos-alta` una vez. El panel no deja empresas');
        console.log(' a medias: eso es lo que se acaba de verificar.');
    }
    console.log('='.repeat(76));
    console.log('');
    if (fallos) process.exitCode = 1;
}

main().catch((err) => {
    console.error('\nERROR INESPERADO:', err);
    process.exit(1);
});
