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

/* ==========================================================================
   EL REEMPLAZO DE `db`

   Antes de F2, `db` era un pool de `mysql2/promise`. Las 28 rutas que ya
   existian lo usaban de dos formas distintas y las dos tienen que seguir
   funcionando:

     db.query(sql, params, (err, filas) => ...)   // con callback
     const [filas] = await db.promise().query(...) // con await

   Por eso el proxy tiene que ser un reemplazo FIDEL del pool de promesas, no
   un passthrough de dos metodos.

   LO QUE PASÓ Y POR QUÉ ESTA ACÁ DOCUMENTADO

   La primera versión del proxy solo reenviaba `query` y `execute`. Como el pool
   de tenant viene de la API de callbacks, eso rompió en silencio tres cosas:

     - `db.getConnection(...)`   -> POST /api/pedidos daba 500
     - `db.promise().query(...)` -> POST y PUT de reparaciones, y el cambio de
                                    estado, daban 500
     - `await db.query(...)`     -> no existía, el pool de callbacks no devuelve
                                    promesa

   O sea: desde F2 el taller no podía crear pedidos ni órdenes de trabajo. Las
   20 comprobaciones de F2 no lo detectaron porque todas las de escritura que
   probaron fueron un DELETE de usuario, que va por el camino viejo de la base
   central. Por eso acá esta el `db` completo, y por eso hay una comprobación
   dedicada (ver tools/f2-verificar.js, seccion 3) que escribe de verdad.

   REGLA: `db` tiene que seguir pareciéndose al pool de `mysql2/promise`. Si se
   toca este objeto, hay que probar las tres formas de uso, no solo las de
   lectura.
   ========================================================================== */

/**
 * Ejecuta un metodo del pool de la empresa actual y devuelve una promesa con
 * lo que mysql2 pasa por callback.
 *
 * OJO CON EL EMPAQUETADO: se resuelve SIEMPRE como `[resultado, campos]`, que
 * es lo que hace `mysql2/promise`. No se puede resolver con el `resultado` pelado
 * porque para un SELECT eso es `[filas, campos]`, pero para un INSERT es un
 * `OkPacket` que no se puede desarmar con `const [r] = ...`. Como las rutas
 * viejas hacen justo eso (`const [result] = await db.promise().query(INSERT...)`),
 * el empaquetado es parte del contrato, no un detalle.
 */
function enPromesa(metodo, ...args) {
    return new Promise((resolver, rechazar) => {
        contextoActual().pool[metodo](...args, (err, resultado, campos) => {
            if (err) rechazar(err);
            else resolver([resultado, campos]);
        });
    });
}

/** ¿El ultimo argumento es un callback? Si lo es, es la forma de toda la vida. */
function conCallback(args) {
    return args.length > 0 && typeof args[args.length - 1] === 'function';
}

/**
 * query y execute con las dos interfaces: con callback si el llamador paso uno,
 * con promesa si no. Es lo que hace `mysql2/promise`, y es lo que permite que
 * convivan las 28 rutas viejas con las nuevas que usan async/await.
 */
function consultar(metodo, args) {
    if (conCallback(args)) {
        return contextoActual().pool[metodo](...args);
    }
    return enPromesa(metodo, ...args);
}

const db = {
    query(...args) {
        return consultar('query', args);
    },
    execute(...args) {
        return consultar('execute', args);
    },

    /** Como el de mysql2/promise: devuelve un objeto con query/execute. */
    promise() {
        return {
            query: (sql, valores) => enPromesa('query', sql, valores),
            execute: (sql, valores) => enPromesa('execute', sql, valores)
        };
    },

    /**
     * Saca una conexion sola del pool. Necesaria para transacciones.
     * Acepta callback (forma vieja) o devuelve promesa (forma nueva).
     */
    getConnection(...args) {
        if (conCallback(args)) {
            return contextoActual().pool.getConnection(...args);
        }
        return new Promise((resolver, rechazar) => {
            contextoActual().pool.getConnection((err, con) => (err ? rechazar(err) : resolver(con)));
        });
    }
};

/**
 * Corre `fn` dentro de una transaccion de la empresa actual.
 *
 * `fn` recibe `{ query }`, con la misma firma de `db.query` pero siempre como
 * promesa. Si `fn` tira, se hace ROLLBACK y el error sube. La conexion se
 * devuelve al pool siempre.
 *
 *   await transaccion(async ({ query }) => {
 *       await query('INSERT INTO ...');
 *       await query('INSERT INTO ...');
 *   });
 */
async function transaccion(fn) {
    const con = await db.getConnection();

    // Mismo empaquetado que mysql2/promise: siempre [resultado, campos].
    const query = (sql, valores) => new Promise((resolver, rechazar) => {
        con.query(sql, valores, (err, resultado, campos) => (err ? rechazar(err) : resolver([resultado, campos])));
    });

    try {
        await query('START TRANSACTION');
        const resultado = await fn({ query, conexion: con });
        await query('COMMIT');
        return resultado;
    } catch (err) {
        // Si el rollback tambien falla, el error que importa es el primero.
        try {
            await query('ROLLBACK');
        } catch { /* la transaccion ya murio */ }
        throw err;
    } finally {
        con.release();
    }
}

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
    transaccion,
    obtenerPool,
    conContexto,
    contextoActual,
    desalojarInactivos,
    cerrarTodos,
    estadisticas,
    OPCIONES
};
