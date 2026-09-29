/* ==========================================================================
   POOL POR EMPRESA  +  CONTEXTO DEL REQUEST
   --------------------------------------------------------------------------
   EL PROBLEMA
   El servidor tenia UN pool global apuntando a la base del taller. Con varias
   empresas hay que elegir la base en cada request. La forma obvia seria
   cambiar `db.query(...)` por `req.db.query(...)` en las 28 rutas... y eso es
   tocar 28 lugares que hoy funcionan.

   LA SOLUCION
   AsyncLocalStorage. Cuando un request ya sabe de que empresa es, guarda el
   pool en un "contexto" y todo lo que corra a partir de ahi lo ve. Entonces
   `db.query(...)` sigue escrito igual en las 28 rutas, pero por dentro sale
   por la base de la empresa correcta.

   Un request no puede "heredar" el contexto de otro: cada uno arranca su
   propio als.run(). Y si algo intenta consultar SIN contexto, no adivina:
   tira error en vez de pegarle a la base equivocada.

   LIMITE DE CONEXIONES
   El default de MySQL es max_connections = 151. Con el pool global unico eso
   sobraba. Con 50 empresas, 10 conexiones cada una serian 500 y el servidor
   empezaria a rechazar conexiones. Por eso:
     - connectionLimit 5 por empresa (no 10),
     - desalojo de los pools inactivos (ver desalojarInactivos),
     - maxIdle/idleTimeout para que mysql2 suelte conexiones ociosas solo.
   ========================================================================== */
const mysql = require('mysql2');                 // API de callbacks: es la que ya usan las rutas
const { AsyncLocalStorage } = require('async_hooks');
const { configApp } = require('./conexiones');

const als = new AsyncLocalStorage();

/** nombre_db -> { pool, ultimoUso } */
const pooles = new Map();

const OPCIONES = {
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 60000,
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

/** Devuelve (creando si hace falta) el pool de una empresa. */
function obtenerPool(nombreDb) {
    let entrada = pooles.get(nombreDb);

    if (!entrada) {
        entrada = {
            pool: mysql.createPool({ ...configApp(nombreDb), ...OPCIONES }),
            ultimoUso: Date.now()
        };
        pooles.set(nombreDb, entrada);
    }

    entrada.ultimoUso = Date.now();
    return entrada.pool;
}

/**
 * Corre `fn` con el contexto de una empresa.
 * Todo lo que se cree adentro (promesas, callbacks, timers) ve el mismo pool.
 */
function conContexto(ctx, fn) {
    return als.run(ctx, fn);
}

/** Contexto actual, o error explicito. Nunca adivina. */
function contextoActual() {
    const ctx = als.getStore();
    if (!ctx) {
        throw new Error(
            'No hay empresa en el contexto. Se intento consultar la base de una ' +
            'empresa fuera de un request autenticado.'
        );
    }
    return ctx;
}

/**
 * Reemplazo directo del viejo pool global.
 * Se pasa la lista de argumentos tal cual, asi que funciona tanto
 * db.query(sql, cb) como db.query(sql, params, cb).
 */
const db = {
    query(...args) {
        return contextoActual().pool.query(...args);
    },
    execute(...args) {
        return contextoActual().pool.execute(...args);
    }
};

/** Cierra un pool. mysql2 usa callbacks; esto lo vuelve una promesa. */
function cerrarPool(pool) {
    return new Promise((resolve) => pool.end(() => resolve()));
}

/**
 * Cierra los pools que no se usaron en los ultimos `msMax`.
 * Sin esto, una empresa que se dio de baja sigue ocupando conexiones.
 */
async function desalojarInactivos(msMax = 10 * 60 * 1000) {
    const limite = Date.now() - msMax;
    const cerrados = [];

    for (const [nombreDb, entrada] of pooles) {
        if (entrada.ultimoUso < limite) {
            pooles.delete(nombreDb);
            cerrados.push(nombreDb);
            await cerrarPool(entrada.pool);
        }
    }

    return cerrados;
}

async function cerrarTodos() {
    const nombres = [...pooles.keys()];
    for (const [, entrada] of pooles) {
        await cerrarPool(entrada.pool);
    }
    pooles.clear();
    return nombres;
}

/** Para diagnostico: cuantas empresas tienen pool abierto. */
function estadisticas() {
    return {
        empresasConPool: pooles.size,
        detalle: [...pooles.entries()].map(([nombreDb, e]) => ({
            nombreDb,
            ultimoUso: new Date(e.ultimoUso).toISOString()
        }))
    };
}

module.exports = {
    db,
    obtenerPool,
    conContexto,
    contextoActual,
    desalojarInactivos,
    cerrarTodos,
    estadisticas,
    OPCIONES
};
