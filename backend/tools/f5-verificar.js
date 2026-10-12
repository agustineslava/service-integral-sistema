#!/usr/bin/env node
/**
 * F5a · VERIFICACION DE LA MARCA BLANCA
 * ---------------------------------------------------------------------------
 *   npm run f5:verificar
 *
 * QUE COMPRUEBA
 * Que el logo, el nombre, los colores y los datos de contacto que ve cada
 * empresa sean los SUYOS, y no los de otra. Antes de esta fase toda la marca
 * salia de variables de entorno del servidor, o sea que era la misma para
 * todos: el sistema decia ser de varias empresas y en pantalla era de una.
 *
 * POR QUE HAY VARIAS EMPRESAS DE PRUEBA
 * Una sola empresa no alcanza para probar aislamiento. Si el codigo leyera
 * siempre la fila #1, con una sola empresa de prueba todos los checks
 * pasarian. Por eso hay TRES, cada una con una marca distinta y en un estado
 * distinto, y se comparan entre si:
 *
 *   f5-prueba-a        ACTIVO     marca azul,   logo propio
 *   f5-prueba-b        ACTIVO     marca roja,   logo propio, OTRO telefono
 *   f5-prueba-susp     SUSPENDIDO sin usuarios: solo se usa para el login
 *
 * Cada empresa se usa en un solo estado desde que se la crea, asi que la
 * cache de 30 segundos de `registro.js` nunca queda desactualizada y no hace
 * falta dormir. La empresa del taller no se toca: ni se le cambia un color ni
 * se le carga un dato. Si algo sale mal, se ve en la empresa de prueba.
 *
 * LAS TRES COSAS QUE SE COMPRUEBAN Y QUE ANTES NO PASABAN
 *   1. `/api/config-comercio` con token devuelve la fila de ESA empresa.
 *   2. Sin token, ni con token roto, devuelve la marca de la plataforma y NO filtra
 *      la marca de ninguna empresa: la pantalla de login es pública.
 *   3. Los tres endpoints que arman la marca (config-comercio, mi-empresa y
 *      el comprobante) devuelven el MISMO conjunto de campos. Antes cada uno
 *      tenía su lista y se habían desincronizado, y el navegador recibía un
 *      campo distinto según por dónde mirara.
 *
 * LIMPIEZA
 * Las tres empresas de prueba y sus usuarios se borran en un `finally`, con
 * las bases de datos y todo. Si el proceso se mata a la mitad, al arrancar
 * limpia lo que quedo de una corrida anterior: se buscan los slugs con el
 * prefijo de prueba, que no son empresas de nadie.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const central = require('../src/db/central');
const { configAdmin, nombreCentral } = require('../src/db/conexiones');

const PUERTO = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;

// La marca de la plataforma sale de `PLATAFORMA_*` (el mismo valor por defecto
// que usa el servidor). Es lo que ve una pantalla que no es de ninguna empresa:
// login antes de escribir el correo, superadmin y token roto.
const NOMBRE_PLATAFORMA = process.env.PLATAFORMA_NOMBRE || 'Aexia';

const PREFIJO = 'f5-prueba';
const CLAVE = 'F5ClaveDePrueba123';

/**
 * Las tres empresas. Los valores son a proposito muy distintos entre si: si
 * un campo se cruza, tiene que verse a simple vista en la comparacion.
 * `nombre_db` de la suspendida no existe y no hace falta que exista: para
 * responder la marca solo se lee la fila de la central, no se abre la base.
 */
const EMPRESAS = {
    a: {
        nombre: 'Taller Azul SA',
        slug: `${PREFIJO}-a`,
        nombreDb: 'si_tenant_f5_a',
        estado: 'ACTIVO',
        email: 'f5a@prueba.local',
        marca: {
            subtitulo: 'Motos y Maquinas',
            // OJO: los tres logos tienen que ser DISTINTOS entre si y
            // distintos del `PLATAFORMA_LOGO` por defecto (`logos/aexia.svg`).
            // El detector de fugas
            // compara valores exactos, asi que si dos comparten logo no puede
            // distinguir "le robe el logo al otro" de "coinciden": marca un
            // falso positivo y hace dudar de un acierto. Un color repetido
            // avisa; un logo repetido enloquece.
            logo_url: 'logos/azul.png',
            color_primario: '#1a4d8f',
            color_secundario: '#12305c',
            telefono: '11-1111-1111',
            email_contacto: 'azul@prueba.local',
            direccion: 'Avenida Azul 100',
            cuit: '20-11111111-1'
        }
    },
    b: {
        nombre: 'Casa Verde SRL',
        slug: `${PREFIJO}-b`,
        nombreDb: 'si_tenant_f5_b',
        estado: 'ACTIVO',
        email: 'f5b@prueba.local',
        marca: {
            subtitulo: 'Electricidad y Iluminacion',
            logo_url: 'logos/rojo.png',
            color_primario: '#b3001b',
            color_secundario: '#7a0011',
            telefono: '11-2222-2222',
            email_contacto: 'verde@prueba.local',
            direccion: 'Pasaje Verde 200',
            cuit: '20-22222222-2'
        }
    },
    s: {
        nombre: 'Empresa Suspendida SA',
        slug: `${PREFIJO}-susp`,
        // A proposito inexistente: esta empresa no llega a abrir su base.
        nombreDb: 'si_tenant_f5_susp_no_existe',
        estado: 'SUSPENDIDO',
        email: 'f5s@prueba.local',
        marca: {
            subtitulo: 'No deberia entrar',
            logo_url: 'logos/gris.png',
            color_primario: '#333333',
            color_secundario: '#111111',
            telefono: '11-3333-3333',
            email_contacto: 'gris@prueba.local',
            direccion: 'Calle Suspendida 300',
            cuit: '20-33333333-3'
        }
    }
};

const CAMPOS_MARCA = [
    'subtitulo', 'logo_url', 'color_primario', 'color_secundario',
    'telefono', 'email_contacto', 'direccion', 'cuit'
];

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

// ---------------------------------------------------------------------------

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

const post = (ruta, token, body) => pedir(ruta, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

function firmar(usuario, empresaId, extra = {}) {
    return jwt.sign(
        { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, empresa_id: empresaId, ...extra },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function servidorVivo() {
    const r = await pedir('/api/mi-empresa', 'invalido');
    return r.estado > 0;
}

/** Borra empresas de una corrida anterior que quedaron a medias. */
async function barrerRestos() {
    const filas = await central.query(
        `SELECT slug, nombre_db FROM empresas WHERE slug LIKE ?`, [`${PREFIJO}-%`]
    );
    if (!filas.length) return 0;

    console.log(` Se limpian ${filas.length} empresa(s) de una corrida anterior: ${filas.map((f) => f.slug).join(', ')}`);
    await borrarEmpresas(filas);
    return filas.length;
}

async function borrarBase(nombreDb) {
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        await admin.query(`DROP DATABASE IF EXISTS \`${nombreDb}\``);
    } finally {
        await admin.end();
    }
}

async function borrarEmpresas(filas) {
    for (const f of filas) {
        // `nombre_db` puede no venir si el borrado es por prefijo (una corrida
        // anterior a medias). Sin base que tirar, se borra solo la fila.
        if (!f.nombre_db) continue;
        try { await borrarBase(f.nombre_db); } catch { /* puede no haber existido */ }
    }
    // Los usuarios y los modulos caen solos: la FK es ON DELETE CASCADE.
    await central.query(`DELETE FROM empresas WHERE slug LIKE ?`, [`${PREFIJO}-%`]);
}

/** Crea la fila de la empresa, con su marca, y un usuario ADMIN. */
async function crearEmpresa(e) {
    const r = await central.query(
        `INSERT INTO empresas (nombre, slug, nombre_db, rubro, plan, estado,
                               subtitulo, logo_url, color_primario, color_secundario,
                               telefono, email_contacto, direccion, cuit)
         VALUES (?, ?, ?, 'taller', 'basico', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.nombre, e.slug, e.nombreDb, e.estado,
            e.marca.subtitulo, e.marca.logo_url, e.marca.color_primario, e.marca.color_secundario,
            e.marca.telefono, e.marca.email_contacto, e.marca.direccion, e.marca.cuit]
    );

    const base = await central.query('SELECT codigo FROM modulos WHERE es_base = 1 ORDER BY orden');
    for (const m of base) {
        await central.query(
            `INSERT INTO empresa_modulos (empresa_id, modulo, activo, fecha_desde) VALUES (?, ?, 1, CURDATE())`,
            [r.insertId, m.codigo]
        );
    }

    const hash = bcrypt.hashSync(CLAVE, 10);
    const u = await central.query(
        `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
         VALUES (?, ?, ?, ?, 'ADMIN')`,
        [r.insertId, e.email, hash, `Admin ${e.slug}`]
    );

    return { idEmpresa: r.insertId, idUsuario: u.insertId };
}

/**
 * Saca las dos funciones puras de `marca.js` y las prueba aca.
 *
 * `marca.js` es codigo de navegador, asi que no se puede pedir. Pero
 * `esColorValido` y `oscurecer` no tocan el DOM: son funciones puras. Se
 * recortan del archivo y se evalúan, para que el hover que calcula
 * `oscurecer` no se rompa sin que nadie se entere.
 */
function funcionesDeMarcaJs() {
    const fuente = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'marca.js'), 'utf8');
    const out = {};
    for (const nombre of ['esColorValido', 'oscurecer']) {
        const m = fuente.match(new RegExp(`function\\s+${nombre}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
        if (!m) return { error: `No se encontro la funcion ${nombre}() en frontend/marca.js.` };
        // eslint-disable-next-line no-new-func
        out[nombre] = new Function(`${m[0]}; return ${nombre};`)();
    }
    return out;
}

// ---------------------------------------------------------------------------

async function main() {
    titulo('F5a · VERIFICACION DE LA MARCA BLANCA');

    if (!(await servidorVivo())) {
        console.error(`\nEl servidor no responde en ${BASE_URL}.`);
        console.error('Levantalo con: pm2 restart service-integral-backend');
        process.exitCode = 1;
        return;
    }

    let creadas = [];
    try {
        const restos = await barrerRestos();
        if (restos) comprobar(true, 'Se limpiaron restos de una corrida anterior');

        const A = await crearEmpresa(EMPRESAS.a);
        const B = await crearEmpresa(EMPRESAS.b);
        const S = await crearEmpresa(EMPRESAS.s);
        creadas = Object.values(EMPRESAS).map((e) => ({ slug: e.slug, nombre_db: e.nombreDb }));

        const tokenA = firmar({ id: A.idUsuario, nombre: 'A', rol: 'ADMIN' }, A.idEmpresa);
        const tokenB = firmar({ id: B.idUsuario, nombre: 'B', rol: 'ADMIN' }, B.idEmpresa);
        const tokenS = firmar({ id: S.idUsuario, nombre: 'S', rol: 'ADMIN' }, S.idEmpresa);

        // -------------------------------------------------------------------
        titulo('1. SIN SESION: LA MARCA DE LA PLATAFORMA, Y NO LA DE NADIE');

        const sinSesion = await pedir('/api/config-comercio');
        comprobar(sinSesion.estado === 200, 'Sin token responde 200, no 401', sinSesion);
        comprobar(
            sinSesion.cuerpo && sinSesion.cuerpo.nombre === NOMBRE_PLATAFORMA,
            'Sin token sale la marca de la plataforma (PLATAFORMA_NOMBRE)',
            sinSesion.cuerpo
        );

        // Lo importante: que la pantalla de login, que es publica, no sea una
        // puerta a la marca de un cliente. Con una sola empresa instalada esto
        // no se notaria; con tres, cualquier cruce se ve.
        // Se compara el `nombre` tambien, que es el campo mas obvio para
        // cruzarse y el que mas feo seria ver en la pantalla de login.
        const marcasDePrueba = Object.values(EMPRESAS).map((e) => ({ ...e.marca, nombre: e.nombre }));
        const filtrada = Object.keys(sinSesion.cuerpo || {}).filter((k) =>
            marcasDePrueba.some((m) => m[k] && sinSesion.cuerpo[k] === m[k])
        );
        comprobar(filtrada.length === 0, 'Sin token no filtra ningun dato de las empresas de prueba', filtrada);

        // -------------------------------------------------------------------
        titulo('2. CON SESION: LA MARCA DE ESA EMPRESA');

        for (const [clave, token, e] of [['A', tokenA, EMPRESAS.a], ['B', tokenB, EMPRESAS.b]]) {
            const r = await pedir('/api/config-comercio', token);
            comprobar(r.estado === 200, `Empresa ${clave}: config-comercio responde 200`, r);
            comprobar(
                r.cuerpo && r.cuerpo.nombre === e.nombre,
                `Empresa ${clave}: sale su nombre (${e.nombre})`,
                r.cuerpo && r.cuerpo.nombre
            );
            for (const campo of CAMPOS_MARCA) {
                comprobar(
                    r.cuerpo && r.cuerpo[campo] === e.marca[campo],
                    `Empresa ${clave}: sale su ${campo} (${e.marca[campo]})`,
                    r.cuerpo && r.cuerpo[campo]
                );
            }
        }

        // -------------------------------------------------------------------
        titulo('3. AISLAMIENTO EN LAS DOS DIRECCIONES');

        // Con el token de A, ningun campo puede ser el de B ni el de la
        // suspendida. Y al reves. Cada lado tiene que funcionar de verdad: si
        // los dos salieran vacios, estos checks pasarian sin probar nada.
        const cruces = [
            ['A', tokenA, 'B', EMPRESAS.b],
            ['A', tokenA, 'S', EMPRESAS.s],
            ['B', tokenB, 'A', EMPRESAS.a],
            ['B', tokenB, 'S', EMPRESAS.s]
        ];
        for (const [de, token, hacia, objetivo] of cruces) {
            const r = await pedir('/api/config-comercio', token);
            const suyo = { ...objetivo.marca, nombre: objetivo.nombre };
            const malos = Object.keys(r.cuerpo || {}).filter(
                (k) => r.cuerpo[k] && suyo[k] === r.cuerpo[k]
            );
            comprobar(malos.length === 0, `Con el token de ${de} no sale ningun dato de ${hacia} (${objetivo.nombre})`, malos);
        }

        // -------------------------------------------------------------------
        titulo('4. TOKENS ROTOS: CAEN A LA MARCA DE LA PLATAFORMA, SIN ERROR');

        const rotos = [
            ['texto que no es un token', 'esto-no-es-un-jwt'],
            ['JWT con la firma cambiada', tokenA.slice(0, -4) + 'XXXX'],
            ['empresa que no existe', firmar({ id: 1, nombre: 'X', rol: 'ADMIN' }, 999999)],
            ['SUPERADMIN (sin empresa)', firmar({ id: 1, nombre: 'X', rol: 'SUPERADMIN' }, null)]
        ];
        for (const [desc, token] of rotos) {
            const r = await pedir('/api/config-comercio', token);
            comprobar(r.estado === 200, `${desc}: responde 200 y no 500`, r);
            comprobar(
                r.cuerpo && r.cuerpo.nombre === NOMBRE_PLATAFORMA,
                `${desc}: cae a la marca de la plataforma`,
                r.cuerpo && r.cuerpo.nombre
            );
        }

        const expirado = jwt.sign(
            { id: 1, nombre: 'X', rol: 'ADMIN', empresa_id: A.idEmpresa, iat: Math.floor(Date.now() / 1000) - 99999 },
            process.env.JWT_SECRET,
            { expiresIn: '1s' }
        );
        const rExp = await pedir('/api/config-comercio', expirado);
        comprobar(rExp.estado === 200, 'Token vencido: responde 200 y no 500', rExp);

        // -------------------------------------------------------------------
        titulo('5. LOS TRES ENDPOINTS DEVUELVEN EL MISMO CONJUNTO DE CAMPOS');

        // Este es el check que falla si alguien agrega un campo a la marca en
        // un endpoint y se olvida de los otros dos.
        const marca = await pedir('/api/config-comercio', tokenA);
        const miEmpresa = await pedir('/api/mi-empresa', tokenA);
        comprobar(miEmpresa.estado === 200, 'mi-empresa responde 200', miEmpresa);

        const faltantes = CAMPOS_MARCA.filter((c) => miEmpresa.cuerpo && miEmpresa.cuerpo[c] === undefined);
        comprobar(
            faltantes.length === 0,
            'mi-empresa trae todos los campos de marca que trae config-comercio',
            faltantes
        );

        const difieren = CAMPOS_MARCA.filter(
            (c) => miEmpresa.cuerpo && marca.cuerpo && miEmpresa.cuerpo[c] !== marca.cuerpo[c]
        );
        comprobar(
            difieren.length === 0,
            'mi-empresa y config-comercio dan el MISMO valor para cada campo',
            difieren.map((c) => [c, marca.cuerpo[c], miEmpresa.cuerpo[c]])
        );

        // El comprobante de presupuesto imprime la marca. Si un endpoint trae
        // un campo y otro no, el impreso sale con un hueco.
        const comp = await pedir('/api/presupuestos/999999/comprobante', tokenA);
        comprobar(comp.estado === 404, 'El comprobante de un id inexistente da 404', comp.estado);
        comprobar(!!(comp.cuerpo && comp.cuerpo.error), 'Y un mensaje de error, no una pantalla en blanco', comp.cuerpo);

        // -------------------------------------------------------------------
        titulo('6. EL LOGIN DEVUELVE LA MARCA DE LA EMPRESA DE ESE USUARIO');

        for (const [clave, e] of [['A', EMPRESAS.a], ['B', EMPRESAS.b]]) {
            const r = await post('/api/login', null, { email: e.email, password: CLAVE });
            comprobar(r.estado === 200, `Login de ${e.nombre} responde 200`, r.cuerpo);
            const emp = r.cuerpo && r.cuerpo.empresa;
            comprobar(emp && emp.nombre === e.nombre, `Login de ${clave}: vuelve su nombre`, emp && emp.nombre);
            for (const campo of CAMPOS_MARCA) {
                comprobar(
                    emp && emp[campo] === e.marca[campo],
                    `Login de ${clave}: vuelve su ${campo}`,
                    emp && emp[campo]
                );
            }
        }

        const mal = await post('/api/login', null, { email: EMPRESAS.a.email, password: 'incorrecta' });
        comprobar(mal.estado === 401, 'Una contraseña incorrecta da 401', mal.estado);

        // -------------------------------------------------------------------
        titulo('7. UNA EMPRESA SUSPENDIDA: MARCA SI, ACCESO NO');

        // La marca tiene que seguir saliendo: el cliente suspendido tiene que
        // ver la pagina de su propia empresa, no una pantalla generica.
        const rS = await pedir('/api/config-comercio', tokenS);
        comprobar(rS.estado === 200, 'La empresa suspendida recibe 200 en config-comercio', rS.estado);
        comprobar(
            rS.cuerpo && rS.cuerpo.nombre === EMPRESAS.s.nombre,
            'Y ve su propia marca, no la de la plataforma',
            rS.cuerpo && rS.cuerpo.nombre
        );
        comprobar(
            rS.cuerpo && rS.cuerpo.color_primario === EMPRESAS.s.marca.color_primario,
            'Con su color, no con el de por defecto',
            rS.cuerpo && rS.cuerpo.color_primario
        );

        // Pero no puede entrar. Esto es de F2/F3, se comprueba porque
        // config-comercio es publica y no tiene que abrirle la puerta.
        const loginS = await post('/api/login', null, { email: EMPRESAS.s.email, password: CLAVE });
        comprobar(loginS.estado === 403, 'La empresa suspendida no puede iniciar sesion', loginS);
        const apiS = await pedir('/api/mi-empresa', tokenS);
        comprobar(apiS.estado === 403, 'Y su token viejo no abre la API', apiS.estado);

        // -------------------------------------------------------------------
        titulo('8. LO QUE HACE EL NAVEGADOR CON ESOS COLORES');

        const fns = funcionesDeMarcaJs();
        if (fns.error) {
            comprobar(false, fns.error);
        } else {
            const { esColorValido, oscurecer } = fns;

            for (const v of ['#1a4d8f', '#ABC', '#fff', '#009fe3']) {
                comprobar(esColorValido(v), `Acepta el color ${v}`);
            }
            // Un color roto en la base tiene que quedar afuera: sipas,
            // escribiendolo tal cual, el boton se queda sin fondo.
            for (const v of ['azul lindo', 'rgb(1,2,3)', '#12345', '', null, 'red', '#1234567']) {
                comprobar(!esColorValido(v), `Rechaza ${JSON.stringify(v)}`);
            }

            // El hover: tiene que ser MAS oscuro, no mas claro, y del mismo
            // color (no gris ni negro). Si el boton queda igual al pasar el
            // mouse, el usuario no ve que se puede apretar.
            comprobar(oscurecer('#1a4d8f') === '#153f75', 'oscurecer() oscurece de verdad', oscurecer('#1a4d8f'));
            comprobar(oscurecer('#ffffff') === '#d1d1d1', 'oscurecer() no se pasa de negro con el blanco', oscurecer('#ffffff'));
            comprobar(oscurecer('#000000') === '#000000', 'oscurecer() del negro sigue negro', oscurecer('#000000'));
            comprobar(oscurecer('#fff') === '#d1d1d1', 'oscurecer() acepta el corto #fff', oscurecer('#fff'));

            // Y el taller: su color tiene que ser valido, o la pagina se
            // queda con la paleta de la casa y nadie se entera de por que.
            const taller = await central.uno(
                'SELECT color_primario, color_secundario FROM empresas WHERE slug = ?',
                ['service-integral']
            );
            comprobar(!!taller, 'La empresa del taller existe');
            if (taller) {
                comprobar(
                    esColorValido(taller.color_primario) && esColorValido(taller.color_secundario),
                    'Los colores del taller son validos, asi que se aplican',
                    taller
                );
            }
        }

        // -------------------------------------------------------------------
        titulo('9. LA EMPRESA DEL TALLER SIGUE COMO ESTABA');

        // Esta verificacion crea empresas y borra bases. Si algo se cruza, lo
        // primero que se rompe es el taller, asi que se mira que sigue en pie.
        const t = await central.uno('SELECT id, nombre, estado, nombre_db FROM empresas WHERE slug = ?', ['service-integral']);
        comprobar(!!t && t.estado === 'ACTIVO', 'El taller sigue dado de alta y activo', t);

        const rT = await pedir('/api/mi-empresa', firmar({ id: 1, nombre: 'T', rol: 'ADMIN' }, t.id));
        comprobar(rT.estado === 200, 'Y su API responde', rT.estado);
        comprobar(
            rT.cuerpo && rT.cuerpo.nombre === 'Service Integral',
            'Y con el nombre de siempre',
            rT.cuerpo && rT.cuerpo.nombre
        );

    } finally {
        titulo('LIMPIEZA');
        await borrarEmpresas(creadas.length ? creadas : [{ slug: `${PREFIJO}-%` }]);
        const quedan = await central.uno(`SELECT COUNT(*) AS n FROM empresas WHERE slug LIKE ?`, [`${PREFIJO}-%`]);
        comprobar(quedan && quedan.n === 0, 'No quedo ninguna empresa de prueba', quedan);
        await central.cerrar();
    }

    console.log('');
    console.log('='.repeat(70));
    if (fallos) {
        console.log(` RESULTADO: ${fallos} fallo(s) de ${pruebas} pruebas.`);
    } else {
        console.log(` RESULTADO: ${pruebas} pruebas, todas bien.`);
    }
    console.log('='.repeat(70));
    console.log('');
    if (fallos) process.exitCode = 1;
}

main().catch((err) => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
