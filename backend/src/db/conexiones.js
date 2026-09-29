/* ==========================================================================
   CONEXIONES A MySQL
   --------------------------------------------------------------------------
   Dos identidades, a proposito:

     APP     (DB_USER)        solo lee y escribe datos. No puede crear ni
                              borrar bases. Es la que usa el servidor en
                              runtime, la que corre en cada request.

     ADMIN   (DB_ADMIN_USER)  crea y borra bases, aplica migraciones. La usan
                              el instalador y los scripts, NUNCA el runtime.

   Si algun dia una inyeccion SQL llega a la aplicacion, la aplicacion no
   tiene permisos para destruir nada.
   ========================================================================== */
const mysql = require('mysql2/promise');

function base(usuario, password) {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: usuario,
        password,
        charset: 'utf8mb4',
        dateStrings: true
    };
}

/**
 * MySQL en Windows guarda los nombres de base EN MINÚSCULA
 * (lower_case_table_names = 1) y no distingue mayúsculas al conectarse.
 * En Linux, en cambio, SÍ distingue: 'ServiceIntegralsistema' y
 * 'serviceintegralsistema' serían dos bases distintas y una no existiría.
 *
 * Para que la misma configuración funcione igual en Windows y en Linux —y
 * porque el esquema central obliga a que `nombre_db` sea minúscula— acá se
 * normaliza el nombre de la base.
 */
function normalizarBase(database) {
    if (database === undefined || database === null) return database;
    return String(database).toLowerCase();
}

/** Credenciales de la aplicacion. `database` puede ser undefined. */
function configApp(database) {
    return { ...base(process.env.DB_USER, process.env.DB_PASSWORD), database: normalizarBase(database) };
}

/** Credenciales de administracion: DDL y migraciones. */
function configAdmin(database) {
    const usuario = process.env.DB_ADMIN_USER;
    const password = process.env.DB_ADMIN_PASSWORD;
    if (!usuario) {
        throw new Error(
            'Falta DB_ADMIN_USER en backend/.env.\n' +
            'Corre primero:  npm run f0:setup'
        );
    }
    return { ...base(usuario, password), database: normalizarBase(database), multipleStatements: true };
}

const conectarApp   = (database) => mysql.createConnection(configApp(database));
const conectarAdmin = (database) => mysql.createConnection(configAdmin(database));

/** Nombre de la base central. */
function nombreCentral() {
    return process.env.DB_CENTRAL_NAME || 'si_central';
}

module.exports = { configApp, configAdmin, conectarApp, conectarAdmin, nombreCentral };
