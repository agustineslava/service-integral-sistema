/**
 * F4 · VERIFICACION DEL MODULO `presupuestos`
 * ---------------------------------------------------------------------------
 *   npm run f4:verificar
 *
 * Que prueba, y por que en este orden:
 *
 *   1. Que las tablas y la secuencia existen de verdad.
 *   2. El ciclo de vida del documento: crear, calcular, editar, cerrar, borrar.
 *   3. Que el total lo calcula el servidor y no el que escribe en el navegador.
 *   4. Que las validaciones rechazan lo que tienen que rechazar.
 *   5. Que el TECNICO puede presupuestar pero no aprobar.
 *   6. Que el correlativo corre y NO se vuelve a usar.
 *   7. Que los filtros del listado andan.
 *   8. AISLAMIENTO: dos empresas con el módulo, cada una con lo suyo. Las dos
 *      tienen que ver SUS presupuestos. Si una de las dos sale vacía, la
 *      comprobación no dice nada (ya pasó en F3: una prueba que pasa porque
 *      todo está apagado no prueba nada).
 *   9. Con el módulo apagado, las 7 rutas dan 404 y las demás siguen andando.
 *  10. Que la pantalla existe y está enganchada al menú en las 5 páginas.
 *
 * POR QUE NO HAY QUE ESPERAR 30 SEGUNDOS ENTRE PASADAS
 *
 * El servidor cachea los módulos de la empresa 30 segundos. F3 apagaba y
 * prendía el módulo de la MISMA empresa y por eso tenía que dormir dos veces.
 * Acá no: se usan DOS empresas de prueba distintas, y cada una se usa en un
 * solo estado, la primera vez que se la toca. Como la caché se llena recién
 * con ese estado, nunca queda desactualizada y no hace falta dormir. La
 * empresa de taller no se toca para nada: ni se le apaga un módulo ni se le
 * crea un presupuesto de prueba que luego haya que borrar a mano.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const central = require('../src/db/central');
const { configAdmin, configApp, nombreCentral } = require('../src/db/conexiones');
const migraciones = require('../src/db/migrations');

const PUERTO = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const DB_TALLER = process.env.DB_NAME;

const MODULO = 'presupuestos';

/** Las dos empresas de prueba. Se borran al final, pase lo que pase. */
const PRUEBA_SI = 'si_tenant_f4_si';
const PRUEBA_NO = 'si_tenant_f4_no';
const SLUG_SI = 'f4-prueba-si';
const SLUG_NO = 'f4-prueba-no';

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

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(ruta, token, opciones = {}) {
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
}

const post = (ruta, token, body) => pedir(ruta, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const put = (ruta, token, body) => pedir(ruta, token, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const borrar = (ruta, token) => pedir(ruta, token, { method: 'DELETE' });

function firmar(usuario, empresaId) {
    return jwt.sign(
        { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, empresa_id: empresaId },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function servidorVivo() {
    try {
        const res = await fetch(`${BASE_URL}/api/mi-empresa`, {
            headers: { Authorization: 'Bearer invalido' }
        });
        // Cualquier respuesta menos una conexion fallida significa que hay algo
        // escuchando. Un 401 tambien sirve: el servidor esta vivo.
        return res.status > 0;
    } catch {
        return false;
    }
}

/**
 * Crea una base de empresa nueva IGUAL que la crea `altas.js`.
 *
 * OJO al archivo que carga. Antes cargaba `schema/schema-actual.sql`, que es un
 * volcado del estado final. Con eso esta funcion probaba un camino que ya no
 * existe: cargaba el esquema entero y despues corria las migraciones encima,
 * que con el ledger vacio veian `CREATE TABLE IF NOT EXISTS`, se salteaban
 * todo y quedaban como aplicadas sin haber hecho nada. O sea, esta prueba
 *_sigio_ verde con las migraciones rotas.
 *
 * Ahora carga `schema/base.sql`, el estado base congelado, que es lo que carga
 * el alta de verdad. Las migraciones despues, y ahora sí se ejecutan.
 *
 * Y el nombre del archivo NO esta escrito a mano: se lee del `RUTA_ESQUEMA` de
 * `altas.js`. Si alguien lo cambia, esto cambia con el, y las dos cosas no
 * pueden dejar de coincidir en silencio. Ver `tools/ver-base-esquema.js`.
 */
async function crearBaseDeEmpresa(nombreDb) {
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        await admin.query(`DROP DATABASE IF EXISTS \`${nombreDb}\``);
        await admin.query(`CREATE DATABASE \`${nombreDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    } finally {
        await admin.end();
    }

    const con = await mysql.createConnection({ ...configAdmin(nombreDb), multipleStatements: true });
    try {
        const base = fs.readFileSync(archivoDeEsquemaDelAlta(), 'utf8');
        await con.query(base);
        // Y despues las migraciones, que es el camino real de una empresa nueva.
        const r = await migraciones.aplicar(con, 'tenant', { log: (m) => console.log(m) });
        return r.aplicadas;
    } finally {
        await con.end();
    }
}

/**
 * El archivo que `altas.js` carga, leido de `altas.js`.
 *
 * Si no se puede leer, se avisa y se cae. Convolver a `schema-actual.sql`
 * "porque era lo que estaba" seria volver al problema de golpe y sin que nadie
 * lo note.
 */
function archivoDeEsquemaDelAlta() {
    const rutaAltas = path.join(__dirname, '..', 'src', 'servicios', 'altas.js');
    const txt = fs.readFileSync(rutaAltas, 'utf8');
    const def = txt.match(/const\s+RUTA_ESQUEMA\s*=\s*path\.join\(([^;]*)\)/);

    if (!def || !/^\s*__dirname\s*,/.test(def[1])) {
        throw new Error(
            `No se pudo leer RUTA_ESQUEMA de ${rutaAltas}.\n` +
            'Sin saber que archivo carga el alta, esta prueba no puede decir que prueba el alta.\n' +
            'Revisar la constante RUTA_ESQUEMA de altas.js.'
        );
    }

    const trozos = [...def[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    return path.resolve(path.dirname(rutaAltas), ...trozos);
}

async function borrarBaseDeEmpresa(nombreDb) {
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        await admin.query(`DROP DATABASE IF EXISTS \`${nombreDb}\``);
    } finally {
        await admin.end();
    }
}

/**
 * Da de alta una empresa de prueba con el módulo en el estado pedido.
 * Estado: 1 = lo contrató, 0 = no lo contrató.
 */
async function crearEmpresaDePrueba({ nombre, slug, nombreDb, conModulo }) {
    const r = await central.query(
        `INSERT INTO empresas (nombre, slug, nombre_db, rubro, plan, estado)
         VALUES (?, ?, ?, 'taller', 'basico', 'ACTIVO')`,
        [nombre, slug, nombreDb]
    );
    const id = r.insertId;

    const base = await central.query('SELECT codigo FROM modulos WHERE es_base = 1 ORDER BY orden');
    for (const m of base) {
        await central.query(
            `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde) VALUES (?, ?, 1, CURDATE())`,
            [id, m.codigo]
        );
    }
    if (conModulo) {
        await central.query(
            `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde) VALUES (?, ?, 1, CURDATE())`,
            [id, MODULO]
        );
    }
    return id;
}

/** Un presupuesto de ejemplo, con un item del precio exacto para poder verificar. */
function cuerpoDePrueba(marca, extra = {}) {
    return {
        cliente_nombre: `Cliente F4 ${marca}`,
        cliente_doc: '20-12345678-9',
        cliente_telefono: '11-5555-0000',
        items: [
            { descripcion: 'Repuesto de prueba', cantidad: 2, precio_unitario: 100 },
            { descripcion: 'Mano de obra', cantidad: 1, precio_unitario: 50.56 }
        ],
        ...extra
    };
}

/** Lo que tiene que dar: subtotal 250.56, y el total con el descuento que se pase. */
const SUBTOTAL_ESPERADO = 250.56;

// ---------------------------------------------------------------------------

async function main() {
    titulo('F4 · VERIFICACION DEL MODULO `presupuestos`');

    const empresa = await central.uno('SELECT id, nombre, nombre_db FROM empresas WHERE nombre_db = ?', [DB_TALLER]);
    if (!empresa) {
        console.error(`\nNo hay ninguna empresa apuntando a la base "${DB_TALLER}".`);
        process.exitCode = 1;
        return;
    }

    if (!(await servidorVivo())) {
        console.error(`\nEl servidor no responde en ${BASE_URL}.`);
        console.error('Levantalo con: pm2 restart service-integral-backend');
        process.exitCode = 1;
        return;
    }

    const admin = await central.uno(
        `SELECT id, nombre, rol FROM usuarios_globales
          WHERE empresa_id = ? AND rol = 'ADMIN' AND activo = 1 ORDER BY id LIMIT 1`,
        [empresa.id]
    );
    if (!admin) {
        console.error('\nLa empresa no tiene ningun ADMIN activo.');
        process.exitCode = 1;
        return;
    }

    const tecnico = await central.uno(
        `SELECT id, nombre, rol FROM usuarios_globales
          WHERE empresa_id = ? AND rol = 'TECNICO' AND activo = 1 ORDER BY id LIMIT 1`,
        [empresa.id]
    );

    const tokenAdmin = firmar(admin, empresa.id);
    const tokenTecnico = tecnico ? firmar(tecnico, empresa.id) : null;

    console.log(`\nEmpresa del taller: #${empresa.id} ${empresa.nombre} (${empresa.nombre_db})`);
    console.log(`ADMIN de prueba: #${admin.id} ${admin.nombre}`);
    if (tecnico) console.log(`TECNICO de prueba: #${tecnico.id} ${tecnico.nombre}`);

    const creado = [];
    let idEmpresaSi = null;
    let idEmpresaNo = null;

    try {
        // =====================================================================
        titulo(' 1. Las tablas y la secuencia existen');
        // =====================================================================
        const con = await mysql.createConnection(configAdmin(DB_TALLER));
        const tablas = [];
        for (const t of ['presupuestos', 'presupuesto_items', 'secuencias', '_schema_migrations']) {
            const [r] = await con.query(
                `SELECT COUNT(*) AS n FROM information_schema.tables
                  WHERE table_schema = ? AND table_name = ?`,
                [DB_TALLER, t]
            );
            if (r[0].n === 1) tablas.push(t);
        }
        comprobar(tablas.length === 4, `las 4 tablas estan en la base (${tablas.join(', ')})`, tablas);

        const [mig] = await con.query(
            `SELECT version, nombre FROM _schema_migrations WHERE version = '004'`
        );
        comprobar(mig.length === 1, 'la migracion 004 quedo registrada en el ledger', mig);

        const moduloCentral = await central.uno(
            `SELECT activo FROM empresa_modulos WHERE empresa_id = ? AND modulo = ?`,
            [empresa.id, MODULO]
        );
        comprobar(Number(moduloCentral?.activo) === 1,
            `el taller tiene "${MODULO}" contratado`, moduloCentral);

        await con.end();

        // =====================================================================
        titulo(' 2. El total lo calcula el servidor, no el navegador');
        // =====================================================================
        const marca = `F4 ${Date.now()}`;

        // Se manda un total inventado y un subtotal inventado. Si el servidor
        // se los creyera, el comprobante valdría lo que mande el navegador.
        const conTotalFalso = await post('/api/presupuestos', tokenAdmin, cuerpoDePrueba(marca, {
            subtotal: 1, total: 1, descuento: 0
        }));
        comprobar(conTotalFalso.estado === 201, 'crea un presupuesto ignorando el total que le mandan', conTotalFalso);
        if (conTotalFalso.cuerpo?.id) creado.push(conTotalFalso.cuerpo.id);

        const detalle = await pedir(`/api/presupuestos/${conTotalFalso.cuerpo?.id}`, tokenAdmin);
        comprobar(Number(detalle.cuerpo?.subtotal) === SUBTOTAL_ESPERADO,
            `el subtotal se recalculo en el servidor: ${detalle.cuerpo?.subtotal} (esperado ${SUBTOTAL_ESPERADO})`,
            detalle.cuerpo);
        comprobar(Number(detalle.cuerpo?.total) === SUBTOTAL_ESPERADO,
            `y el total tambien: ${detalle.cuerpo?.total}`, detalle.cuerpo);
        comprobar(Array.isArray(detalle.cuerpo?.items) && detalle.cuerpo.items.length === 2,
            'los items se guardaron con sus subtotales', detalle.cuerpo?.items);
        comprobar(Number(detalle.cuerpo?.items?.[0]?.subtotal) === 200,
            `item 1: 2 x 100 = 200 (dio ${detalle.cuerpo?.items?.[0]?.subtotal})`, detalle.cuerpo?.items?.[0]);
        comprobar(Math.abs(Number(detalle.cuerpo?.items?.[1]?.subtotal) - 50.56) < 0.001,
            `item 2: 1 x 50.56 = 50.56 (dio ${detalle.cuerpo?.items?.[1]?.subtotal})`, detalle.cuerpo?.items?.[1]);

        // Con descuento: solo el descuento viene del cliente. El subtotal es
        // 250.56, asi que un descuento de 250.56 lo deja en cero.
        const conDescuento = await post('/api/presupuestos', tokenAdmin,
            cuerpoDePrueba(marca, { descuento: SUBTOTAL_ESPERADO }));
        if (conDescuento.cuerpo?.id) creado.push(conDescuento.cuerpo.id);
        const d2 = await pedir(`/api/presupuestos/${conDescuento.cuerpo?.id}`, tokenAdmin);
        comprobar(Number(d2.cuerpo?.total) === 0,
            `un descuento igual al subtotal deja el total en 0 (dio ${d2.cuerpo?.total})`, d2.cuerpo);
        comprobar(Number(d2.cuerpo?.subtotal) === SUBTOTAL_ESPERADO,
            'pero el subtotal no se toca', d2.cuerpo);

        // =====================================================================
        titulo(' 3. Las validaciones rechazan lo que tienen que rechazar');
        // =====================================================================
        const rechazos = [
            ['descuento mayor que el subtotal', cuerpoDePrueba(marca, { descuento: SUBTOTAL_ESPERADO + 1 })],
            ['sin items', { cliente_nombre: 'X', items: [] }],
            ['sin items y sin cliente', { items: [{ descripcion: 'a', cantidad: 1, precio_unitario: 1 }] }],
            ['cantidad cero', { cliente_nombre: 'X', items: [{ descripcion: 'a', cantidad: 0, precio_unitario: 1 }] }],
            ['cantidad negativa', { cliente_nombre: 'X', items: [{ descripcion: 'a', cantidad: -3, precio_unitario: 1 }] }],
            ['precio negativo', { cliente_nombre: 'X', items: [{ descripcion: 'a', cantidad: 1, precio_unitario: -5 }] }],
            ['item sin descripcion', { cliente_nombre: 'X', items: [{ descripcion: '  ', cantidad: 1, precio_unitario: 1 }] }],
            ['descuento que no es numero', cuerpoDePrueba(marca, { descuento: 'mucho' })],
            ['fecha de vencimiento en texto', cuerpoDePrueba(marca, { valido_hasta: 'la semana que viene' })],
            ['fecha de vencimiento con dia imposible', cuerpoDePrueba(marca, { valido_hasta: '2026-02-31' })],
            ['29 de febrero de un año que no es bisiesto', cuerpoDePrueba(marca, { valido_hasta: '2026-02-29' })],
            ['mes 13', cuerpoDePrueba(marca, { valido_hasta: '2026-13-01' })],
            ['mes 0', cuerpoDePrueba(marca, { valido_hasta: '2026-00-10' })],
            ['dia 0', cuerpoDePrueba(marca, { valido_hasta: '2026-01-00' })],
            ['dia 32', cuerpoDePrueba(marca, { valido_hasta: '2026-01-32' })],
            ['el 31 de abril', cuerpoDePrueba(marca, { valido_hasta: '2026-04-31' })]
        ];
        for (const [nombre, cuerpo] of rechazos) {
            const r = await post('/api/presupuestos', tokenAdmin, cuerpo);
            comprobar(r.estado === 400, `${nombre} -> 400 (dio ${r.estado})`, r.cuerpo);
        }

        // Y que efectivamente NO se haya creado nada con esos intentos.
        const cuantos = await pedir('/api/presupuestos', tokenAdmin);
        const mios = (cuantos.cuerpo || []).filter((p) => (p.cliente_nombre || '').includes('Cliente F4'));
        comprobar(mios.length === 2,
            `de todos los intentos fallidos no quedó ninguno: hay ${mios.length} presupuestos de prueba (esperados 2)`,
            mios.map((p) => p.numero));

        // El filtro de fecha tiene que ser ESTRICTO, no desconfiado: un 29 de
        // febrero de un año bisiesto es una fecha real y tiene que entrar.
        const bisiesto = await post('/api/presupuestos', tokenAdmin,
            cuerpoDePrueba(marca, { descuento: 0, valido_hasta: '2028-02-29' }));
        comprobar(bisiesto.estado === 201,
            'el 29/02/2028 (año bisiesto) se acepta', bisiesto.cuerpo);
        if (bisiesto.cuerpo?.id) creado.push(bisiesto.cuerpo.id);

        const sinFecha = await post('/api/presupuestos', tokenAdmin,
            cuerpoDePrueba(marca, { descuento: 0, valido_hasta: '' }));
        comprobar(sinFecha.estado === 201,
            'y un presupuesto sin fecha de validez también se puede hacer', sinFecha.cuerpo);
        if (sinFecha.cuerpo?.id) creado.push(sinFecha.cuerpo.id);

        // Lo que quedó escrito se mira contra la base y no contra el JSON: la
        // columna DATE vuelve como objeto Date y al pasarlo a JSON puede
        // correrse un día según en qué huso corra el servidor, así que
        // compararlo ahí probaría el huso y no el guardado.
        const conFechas = await mysql.createConnection(configApp(DB_TALLER));
        try {
            const [guardadas] = await conFechas.query(
                `SELECT id, DATE_FORMAT(valido_hasta, '%Y-%m-%d') AS d
                   FROM presupuestos
                  WHERE id IN (?, ?)`,
                [bisiesto.cuerpo?.id, sinFecha.cuerpo?.id]
            );
            const filaBisiesto = guardadas.find((g) => g.id === bisiesto.cuerpo?.id);
            const filaVacia = guardadas.find((g) => g.id === sinFecha.cuerpo?.id);
            comprobar(filaBisiesto?.d === '2028-02-29',
                'el 29/02/2028 quedó guardado tal cual', filaBisiesto);
            comprobar(filaVacia !== undefined && filaVacia.d === null,
                'y sin fecha quedó en NULL, no en texto vacío', filaVacia);
        } finally {
            await conFechas.end();
        }

        // =====================================================================
        titulo(' 4. Editar, cerrar y borrar');
        // =====================================================================
        const objetivo = conTotalFalso.cuerpo.id;

        const editar = await put(`/api/presupuestos/${objetivo}`, tokenAdmin, {
            cliente_nombre: 'Cliente F4 editado',
            items: [{ descripcion: 'Solo un item', cantidad: 3, precio_unitario: 1000 }],
            descuento: 0
        });
        comprobar(editar.estado === 200, 'un borrador se puede editar', editar);
        const editado = await pedir(`/api/presupuestos/${objetivo}`, tokenAdmin);
        comprobar(editado.cuerpo?.cliente_nombre === 'Cliente F4 editado',
            'el cambio se guardo', editado.cuerpo?.cliente_nombre);
        comprobar(Number(editado.cuerpo?.total) === 3000,
            `y el total se recalculo solo: 3 x 1000 = 3000 (dio ${editado.cuerpo?.total})`, editado.cuerpo);
        comprobar(editado.cuerpo?.items?.length === 1,
            'los items viejos se reemplazaron, no se acumularon', editado.cuerpo?.items?.length);

        // Aprobar: a partir de aca el documento se cierra.
        const aprobar = await put(`/api/presupuestos/${objetivo}/estado`, tokenAdmin, { estado: 'APROBADO' });
        comprobar(aprobar.estado === 200, 'un ADMIN puede aprobar', aprobar);

        const editarAprobado = await put(`/api/presupuestos/${objetivo}`, tokenAdmin,
            cuerpoDePrueba(marca, { descuento: 0 }));
        comprobar(editarAprobado.estado === 400,
            `un presupuesto APROBADO no se puede editar (dio ${editarAprobado.estado})`, editarAprobado.cuerpo);

        const borrarAprobado = await borrar(`/api/presupuestos/${objetivo}`, tokenAdmin);
        comprobar(borrarAprobado.estado === 400,
            `ni borrar (dio ${borrarAprobado.estado})`, borrarAprobado.cuerpo);

        const estadoAprobado = await pedir(`/api/presupuestos/${objetivo}`, tokenAdmin);
        comprobar(estadoAprobado.cuerpo?.estado === 'APROBADO',
            'y sigue aprobado, intacto', estadoAprobado.cuerpo?.estado);
        comprobar(Number(estadoAprobado.cuerpo?.total) === 3000,
            'con el mismo total de antes', estadoAprobado.cuerpo?.total);

        // Volver a borrador es un cambio de estado explicito.
        const reabrir = await put(`/api/presupuestos/${objetivo}/estado`, tokenAdmin, { estado: 'BORRADOR' });
        comprobar(reabrir.estado === 200, 'se puede volver a BORRADOR', reabrir);
        const editarReabierto = await put(`/api/presupuestos/${objetivo}`, tokenAdmin,
            cuerpoDePrueba(marca, { descuento: 10 }));
        comprobar(editarReabierto.estado === 200, 'y ahora sí se puede editar', editarReabierto);

        const borrarFinal = await borrar(`/api/presupuestos/${objetivo}`, tokenAdmin);
        comprobar(borrarFinal.estado === 200, 'un borrador lo puede borrar el ADMIN', borrarFinal);
        const despuesDeBorrar = await pedir(`/api/presupuestos/${objetivo}`, tokenAdmin);
        comprobar(despuesDeBorrar.estado === 404, 'y después no existe más', despuesDeBorrar);
        creado.splice(creado.indexOf(objetivo), 1);

        const borrarDeNuevo = await borrar(`/api/presupuestos/${objetivo}`, tokenAdmin);
        comprobar(borrarDeNuevo.estado === 404,
            `borrar dos veces -> 404 y no 500 (dio ${borrarDeNuevo.estado})`, borrarDeNuevo.cuerpo);

        const idInventado = await pedir('/api/presupuestos/99999999', tokenAdmin);
        comprobar(idInventado.estado === 404, 'un id que no existe -> 404', idInventado.cuerpo);

        const estadoMalo = await put(`/api/presupuestos/${conDescuento.cuerpo.id}/estado`, tokenAdmin,
            { estado: 'CANCELADO' });
        comprobar(estadoMalo.estado === 400,
            `un estado que no existe -> 400 (dio ${estadoMalo.estado})`, estadoMalo.cuerpo);

        // =====================================================================
        titulo(' 5. El TECNICO presupuesta, pero no aprueba');
        // =====================================================================
        if (!tokenTecnico) {
            console.log('  [!]     la empresa no tiene ningun TECNICO activo: se saltea esa parte');
        } else {
            const delTecnico = await post('/api/presupuestos', tokenTecnico, cuerpoDePrueba(marca));
            comprobar(delTecnico.estado === 201,
                'el TECNICO puede crear un presupuesto (presupostar es su trabajo)', delTecnico);
            const idTecnico = delTecnico.cuerpo?.id;
            if (idTecnico) creado.push(idTecnico);

            const editarTecnico = await put(`/api/presupuestos/${idTecnico}`, tokenTecnico,
                cuerpoDePrueba(marca, { descuento: 0 }));
            comprobar(editarTecnico.estado === 200, 'y también lo puede editar', editarTecnico);

            const aprobarTecnico = await put(`/api/presupuestos/${idTecnico}/estado`, tokenTecnico,
                { estado: 'APROBADO' });
            comprobar(aprobarTecnico.estado === 403,
                `pero NO puede aprobarlo (dio ${aprobarTecnico.estado})`, aprobarTecnico.cuerpo);

            const borrarTecnico = await borrar(`/api/presupuestos/${idTecnico}`, tokenTecnico);
            comprobar(borrarTecnico.estado === 403,
                `ni borrarlo (dio ${borrarTecnico.estado})`, borrarTecnico.cuerpo);

            const sigueBorrador = await pedir(`/api/presupuestos/${idTecnico}`, tokenTecnico);
            comprobar(sigueBorrador.cuerpo?.estado === 'BORRADOR',
                'y el documento sigue como estaba', sigueBorrador.cuerpo?.estado);
        }

        // =====================================================================
        titulo(' 6. El numero correlativo corre y no se vuelve a usar');
        // =====================================================================
        const a1 = await post('/api/presupuestos', tokenAdmin, cuerpoDePrueba(marca));
        const a2 = await post('/api/presupuestos', tokenAdmin, cuerpoDePrueba(marca));
        if (a1.cuerpo?.id) creado.push(a1.cuerpo.id);
        if (a2.cuerpo?.id) creado.push(a2.cuerpo.id);

        comprobar(Number(a2.cuerpo?.numero) === Number(a1.cuerpo?.numero) + 1,
            `dos presupuestos seguidos: ${a1.cuerpo?.numero} y ${a2.cuerpo?.numero}`, [a1.cuerpo, a2.cuerpo]);

        await borrar(`/api/presupuestos/${a1.cuerpo?.id}`, tokenAdmin);
        const a3 = await post('/api/presupuestos', tokenAdmin, cuerpoDePrueba(marca));
        if (a3.cuerpo?.id) creado.push(a3.cuerpo.id);

        comprobar(Number(a3.cuerpo?.numero) > Number(a1.cuerpo?.numero),
            `borrado el ${a1.cuerpo?.numero}, el siguiente es ${a3.cuerpo?.numero} y NO vuelve al anterior`,
            { borrado: a1.cuerpo?.numero, nuevo: a3.cuerpo?.numero });

        // Diez de golpe, para ver que el cerrojo de la secuencia aguanta.
        const simultaneos = await Promise.all(
            Array.from({ length: 10 }, () => post('/api/presupuestos', tokenAdmin, cuerpoDePrueba(marca)))
        );
        const numeros = simultaneos.map((r) => r.cuerpo?.numero).filter(Boolean);
        for (const r of simultaneos) if (r.cuerpo?.id) creado.push(r.cuerpo.id);
        comprobar(numeros.length === 10, `10 presupuestos a la vez: ${numeros.length} respondieron`, numeros);
        comprobar(new Set(numeros).size === numeros.length,
            'y los 10 numeros son DISTINTOS (nadie saco el mismo dos veces)', numeros.sort((a, b) => a - b));

        // =====================================================================
        titulo(' 7. Los filtros del listado');
        // =====================================================================
        const lista = await pedir('/api/presupuestos', tokenAdmin);
        const orden = (lista.cuerpo || []).map((p) => p.numero);
        const esDescendente = orden.every((n, i) => i === 0 || orden[i - 1] >= n);
        comprobar(esDescendente, 'el listado viene de numero mas alto a mas bajo', orden.slice(0, 8));

        const soloAprobados = await pedir('/api/presupuestos?estado=APROBADO', tokenAdmin);
        comprobar((soloAprobados.cuerpo || []).every((p) => p.estado === 'APROBADO'),
            'el filtro por estado devuelve solo ese estado',
            (soloAprobados.cuerpo || []).map((p) => `${p.numero}:${p.estado}`).slice(0, 6));

        const porTexto = await pedir(`/api/presupuestos?q=${encodeURIComponent(marca)}`, tokenAdmin);
        comprobar(Array.isArray(porTexto.cuerpo) && porTexto.cuerpo.length > 0
            && porTexto.cuerpo.every((p) => (p.cliente_nombre || '').includes('Cliente F4')),
            'el buscador por texto encuentra los de la prueba',
            (porTexto.cuerpo || []).map((p) => p.cliente_nombre).slice(0, 4));

        const porNada = await pedir(`/api/presupuestos?q=${encodeURIComponent('noexisteesto12345')}`, tokenAdmin);
        comprobar(Array.isArray(porNada.cuerpo) && porNada.cuerpo.length === 0,
            'y un texto que no existe devuelve una lista vacía, no un error', porNada.cuerpo);

        // El comprobante para imprimir.
        const comp = await pedir(`/api/presupuestos/${a3.cuerpo?.id}/comprobante`, tokenAdmin);
        comprobar(comp.estado === 200, 'el comprobante responde 200', comp.estado);
        comprobar(Boolean(comp.cuerpo?.empresa?.nombre), 'trae el nombre de la empresa', comp.cuerpo?.empresa);
        comprobar(Array.isArray(comp.cuerpo?.items) && comp.cuerpo.items.length === 2,
            'trae los items', comp.cuerpo?.items?.length);
        comprobar('logo_url' in (comp.cuerpo?.empresa || {}),
            'y trae los datos de marca (logo_url, aunque sea null)', Object.keys(comp.cuerpo?.empresa || {}));
        comprobar('color_primario' in (comp.cuerpo?.empresa || {}),
            'y los colores', comp.cuerpo?.empresa?.color_primario);

        // =====================================================================
        titulo(' 8. Sin token, y con una empresa que no existe');
        // =====================================================================
        const sinToken = await pedir('/api/presupuestos', null);
        comprobar(sinToken.estado === 401, `sin token -> 401 (dio ${sinToken.estado})`, sinToken.cuerpo);

        const tokenFalso = firmar({ id: 1, nombre: 'X', rol: 'ADMIN' }, 999999);
        const empresaInexistente = await pedir('/api/presupuestos', tokenFalso);
        comprobar(empresaInexistente.estado === 403,
            `empresa inexistente -> 403 (dio ${empresaInexistente.estado})`, empresaInexistente.cuerpo);

        // =====================================================================
        titulo(' 9. AISLAMIENTO: dos empresas con el modulo, cada una con lo suyo');
        // =====================================================================
        console.log(`\n  Creando la empresa de prueba ${PRUEBA_SI} con "${MODULO}" contratado...`);
        const aplicadas = await crearBaseDeEmpresa(PRUEBA_SI);
        console.log(`  [ ]     base creada y migrada (${aplicadas} migracion(es) aplicada(s))`);
        idEmpresaSi = await crearEmpresaDePrueba({
            nombre: 'Empresa F4 (con presupuestos)',
            slug: SLUG_SI,
            nombreDb: PRUEBA_SI,
            conModulo: true
        });
        const tokenSi = firmar({ id: 800001, nombre: 'F4 SI', rol: 'ADMIN' }, idEmpresaSi);

        const deLaOtra = await post('/api/presupuestos', tokenSi, {
            cliente_nombre: 'Cliente de la empresa de prueba',
            items: [{ descripcion: 'Item de la otra empresa', cantidad: 1, precio_unitario: 4321 }]
        });
        comprobar(deLaOtra.estado === 201,
            'la empresa de prueba crea SU presupuesto', deLaOtra);
        const idDeLaOtra = deLaOtra.cuerpo?.id;
        const numeroDeLaOtra = deLaOtra.cuerpo?.numero;

        // LADO 1: cada una ve lo suyo.
        const listaSi = await pedir('/api/presupuestos', tokenSi);
        comprobar(Array.isArray(listaSi.cuerpo) && listaSi.cuerpo.length === 1,
            `la empresa de prueba ve exactamente 1 presupuesto, el suyo (vio ${(listaSi.cuerpo || []).length})`,
            listaSi.cuerpo);
        comprobar((listaSi.cuerpo || [])[0]?.cliente_nombre === 'Cliente de la empresa de prueba',
            'y es el suyo', listaSi.cuerpo);

        const listaTaller = await pedir('/api/presupuestos', tokenAdmin);
        const losMios = (listaTaller.cuerpo || []).filter((p) => (p.cliente_nombre || '').includes('Cliente F4'));
        comprobar(losMios.length > 0,
            `y el taller sigue viendo SUS presupuestos (${losMios.length})`, losMios.length);
        comprobar(!(listaTaller.cuerpo || []).some((p) => p.cliente_nombre === 'Cliente de la empresa de prueba'),
            'pero NO ve el de la empresa de prueba',
            (listaTaller.cuerpo || []).map((p) => p.cliente_nombre).slice(0, 5));

        // LADO 2: el id del otro no existe para el otro.
        const miId = a3.cuerpo?.id;
        const cruce = await pedir(`/api/presupuestos/${miId}`, tokenSi);
        comprobar(cruce.estado === 404,
            `abrir un presupuesto del taller desde la otra empresa -> 404 y no 403 (dio ${cruce.estado})`,
            cruce.cuerpo);
        comprobar(cruce.cuerpo?.error !== 'Acceso denegado' && cruce.cuerpo?.error !== 'Forbidden',
            'y el mensaje no confirma que ese documento exista', cruce.cuerpo);

        const cruceBorrar = await borrar(`/api/presupuestos/${miId}`, tokenSi);
        comprobar(cruceBorrar.estado === 404,
            `borrarlo desde la otra empresa -> 404 (dio ${cruceBorrar.estado})`, cruceBorrar.cuerpo);

        const cruceEditar = await put(`/api/presupuestos/${miId}/estado`, tokenSi, { estado: 'APROBADO' });
        comprobar(cruceEditar.estado === 404,
            `aprobarlo desde la otra empresa -> 404 (dio ${cruceEditar.estado})`, cruceEditar.cuerpo);

        const sigueVivo = await pedir(`/api/presupuestos/${miId}`, tokenAdmin);
        comprobar(sigueVivo.estado === 200,
            'y el presupuesto del taller sigue ahí, sin cambios', sigueVivo.cuerpo?.numero);
        // El POST devuelve {mensaje, id, numero, total}: no trae `estado`, asi
        // que el estado de referencia se compara contra el literal.
        comprobar(sigueVivo.cuerpo?.estado === 'BORRADOR',
            'y sigue en BORRADOR, ni aprobado ni borrado desde la otra empresa',
            sigueVivo.cuerpo?.estado);
        // El POST arma el total con aritmetica de JavaScript y lo devuelve como
        // numero; el GET lo lee de una columna DECIMAL y mysql2 lo entrega como
        // string. Se comparan como numeros: lo que importa es que no cambiaron.
        comprobar(Number(sigueVivo.cuerpo?.total) === Number(a3.cuerpo?.total),
            'con el mismo total', { antes: a3.cuerpo?.total, ahora: sigueVivo.cuerpo?.total });

        // Y el correlativo: cada empresa tiene SU secuencia, en SU propia base.
        comprobar(numeroDeLaOtra === 1,
            `la empresa de prueba arranca su propia correlativa en 1 (llego a ${numeroDeLaOtra})`,
            numeroDeLaOtra);
        comprobar(Number(numeroDeLaOtra) !== Number(a3.cuerpo?.numero),
            'y es un numero que el taller nunca emitio', { otra: numeroDeLaOtra, taller: a3.cuerpo?.numero });

        // =====================================================================
        titulo(` 10. Con "${MODULO}" apagado, las 7 rutas no existen`);
        // =====================================================================
        console.log(`\n  Creando la empresa de prueba ${PRUEBA_NO} SIN el modulo...`);
        await crearBaseDeEmpresa(PRUEBA_NO);
        idEmpresaNo = await crearEmpresaDePrueba({
            nombre: 'Empresa F4 (sin presupuestos)',
            slug: SLUG_NO,
            nombreDb: PRUEBA_NO,
            conModulo: false
        });
        const tokenNo = firmar({ id: 800002, nombre: 'F4 NO', rol: 'ADMIN' }, idEmpresaNo);

        const rutas = [
            ['GET', '/api/presupuestos'],
            ['GET', `/api/presupuestos/${idDeLaOtra}`],
            ['GET', `/api/presupuestos/${idDeLaOtra}/comprobante`],
            ['POST', '/api/presupuestos'],
            ['PUT', `/api/presupuestos/${idDeLaOtra}`],
            ['PUT', `/api/presupuestos/${idDeLaOtra}/estado`],
            ['DELETE', `/api/presupuestos/${idDeLaOtra}`]
        ];

        for (const [metodo, ruta] of rutas) {
            const opciones = metodo === 'GET'
                ? {}
                : { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpoDePrueba(marca)) };
            const r = await pedir(ruta, tokenNo, opciones);
            comprobar(r.estado === 404,
                `${metodo.padEnd(6)} ${ruta.replace(String(idDeLaOtra), ':id')} -> 404 (dio ${r.estado})`, r.cuerpo);
            comprobar(r.cuerpo?.error === 'No encontrado',
                `${metodo.padEnd(6)} dice "No encontrado" y no confirma que exista`, r.cuerpo);
        }

        // Y que apagar el módulo no rompa el resto de la empresa.
        const otros = await pedir('/api/productos', tokenNo);
        comprobar(otros.estado === 200, 'los otros módulos siguen funcionando sin el de presupuestos', otros.estado);
        const usuarios = await pedir('/api/usuarios', tokenNo);
        comprobar(usuarios.estado === 200, 'y gestionar usuarios también', usuarios.estado);
        const miNo = await pedir('/api/mi-empresa', tokenNo);
        comprobar(Array.isArray(miNo.cuerpo?.modulos) && !miNo.cuerpo.modulos.includes(MODULO),
            'el frontend no recibe el módulo, así que ni muestra el menú', miNo.cuerpo?.modulos);
        comprobar(miNo.cuerpo?.modulos?.includes('stock'),
            'pero sí los que contrató', miNo.cuerpo?.modulos);

        // =====================================================================
        titulo(' 11. La pantalla existe y está enganchada al menú');
        // =====================================================================
        const raiz = path.join(__dirname, '..', '..');
        const arch = (p) => fs.existsSync(path.join(raiz, p));

        comprobar(arch('frontend/presupuestos.html'), 'existe frontend/presupuestos.html');
        comprobar(arch('frontend/presupuestos.js'), 'existe frontend/presupuestos.js');
        comprobar(arch('frontend/presupuestos.css'), 'existe frontend/presupuestos.css');

        const paginas = ['index.html', 'reparaciones.html', 'clientes.html', 'pedidos.html', 'presupuestos.html'];
        for (const p of paginas) {
            const html = fs.readFileSync(path.join(raiz, 'frontend', p), 'utf8');
            const tiene = /<li\s+data-modulo="presupuestos"/.test(html);
            comprobar(tiene, `${p} tiene el ítem de menú con data-modulo="presupuestos"`);
        }

        // Si el item de menú no estuviera, auth-check lo ocultaría: la prueba
        // de que el ocultamiento funciona es que TODAS las páginas tienen el
        // atributo, no que una sola lo tenga.
        const js = fs.readFileSync(path.join(raiz, 'frontend', 'presupuestos.js'), 'utf8');
        comprobar(js.includes('api/presupuestos'), 'el JS llama a la API de presupuestos');

        const css = fs.readFileSync(path.join(raiz, 'frontend', 'presupuestos.css'), 'utf8');
        comprobar(css.includes('.modal.activo'),
            'el CSS abre los modales: sin esto el contenido queda invisible para un humano');
        comprobar(css.includes('@media print'), 'el CSS tiene la hoja de impresión');

    } finally {
        // =====================================================================
        titulo(' Limpieza');
        // =====================================================================
        const conTaller = await mysql.createConnection(configAdmin(DB_TALLER));
        try {
            for (const id of creado) {
                await conTaller.query('DELETE FROM presupuesto_items WHERE presupuesto_id = ?', [id]);
                await conTaller.query('DELETE FROM presupuestos WHERE id = ?', [id]);
            }
            const [quedan] = await conTaller.query('SELECT COUNT(*) AS n FROM presupuestos');
            console.log(`  presupuestos de prueba borrados; en la base del taller quedan ${quedan[0].n}`);

            // La secuencia se deja como estaba a proposito: bajarla seria
            // romper la garantia de que un numero emitido no vuelve a salir.
        } finally {
            await conTaller.end();
        }

        for (const id of [idEmpresaSi, idEmpresaNo]) {
            if (!id) continue;
            try {
                await central.query('DELETE FROM empresas WHERE id = ?', [id]);
                console.log(`  empresa de prueba #${id} borrada`);
            } catch (err) {
                console.error(`  [!] no se pudo borrar la empresa #${id}:`, err.message);
            }
        }
        for (const db of [PRUEBA_SI, PRUEBA_NO]) {
            try {
                await borrarBaseDeEmpresa(db);
                console.log(`  base ${db} borrada`);
            } catch (err) {
                console.error(`  [!] no se pudo borrar la base ${db}:`, err.message);
            }
        }
    }

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

main().catch((err) => {
    console.error('\nLa verificacion se cortó con un error:');
    console.error(err);
    process.exit(1);
});
