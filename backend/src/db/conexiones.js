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

/** Credenciales de la aplicacion. `database` puede ser undefined. */
function configApp(database) {
    return { ...base(process.env.DB_USER, process.env.DB_PASSWORD), database };
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
    return { ...base(usuario, password), database, multipleStatements: true };
}

const conectarApp   = (database) => mysql.createConnection(configApp(database));
const conectarAdmin = (database) => mysql.createConnection(configAdmin(database));

/** Nombre de la base central. */
function nombreCentral() {
    return process.env.DB_CENTRAL_NAME || 'si_central';
}

module.exports = { configApp, configAdmin, conectarApp, conectarAdmin, nombreCentral };
