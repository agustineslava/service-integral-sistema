/* ==========================================================================
   POOL DE LA BASE CENTRAL
   --------------------------------------------------------------------------
   La base central se consulta en CADA request (para saber si la empresa
   sigue activa y que modulos tiene). Por eso conviene un pool unico y
   reutilizable, no una conexion por request.

   Usa las credenciales de la APLICACION, no las de administracion: el
   servidor en runtime no necesita (ni debe tener) permisos de DDL.

   `dateStrings: true` evita el clasico error de fechas corridas: mysql2
   devuelve 'YYYY-MM-DD HH:mm:ss' tal cual esta en la base, sin reinterpretar
   zonas horarias.
   ========================================================================== */
const mysql = require('mysql2/promise');
const { configApp, nombreCentral } = require('./conexiones');

let pool = null;

function opciones() {
    return {
        ...configApp(nombreCentral()),
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 4,
        idleTimeout: 60000,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
    };
}

/** Devuelve el pool central, creandolo la primera vez. */
function getPool() {
    if (!pool) {
        pool = mysql.createPool(opciones());
        pool.on('connection', (c) => {
            // OJO: este evento entrega la conexión CRUDA, no la de promesas.
            // Su query() devuelve un objeto Query al que se le puede leer
            // .then/.catch, pero LLAMARLOS tira "You have tried to call
            // .then()...". Por eso acá va el callback, no una promesa.
            c.query("SET time_zone = '-03:00'", (err) => {
                if (err) console.error('No se pudo fijar la zona horaria de la central:', err.message);
            });
        });
    }
    return pool;
}

/** Atajo para una consulta suelta. */
async function query(sql, params) {
    const [filas] = await getPool().query(sql, params);
    return filas;
}

/** Atajo para un solo registro (o null). */
async function uno(sql, params) {
    const filas = await query(sql, params);
    return filas.length ? filas[0] : null;
}

/**
 * Comprueba que la base central responde y trae un resumen del catalogo.
 * Se usa en el arranque: si esto falla, el servidor arranco sin poder saber a
 * que empresa pertenece nadie, y conviene enterarse en el log, no en el login.
 */
async function verificar() {
    return uno(`
        SELECT (SELECT COUNT(*) FROM empresas)         AS empresas,
               (SELECT COUNT(*) FROM modulos)          AS modulos,
               (SELECT COUNT(*) FROM planes)           AS planes,
               (SELECT COUNT(*) FROM usuarios_globales) AS usuarios
    `);
}

async function cerrar() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = { getPool, query, uno, verificar, cerrar };
