/* ==========================================================================
   PERMISOS DE LAS BASES DE EMPRESA
   --------------------------------------------------------------------------
   Un solo lugar para los GRANT por base. Los nombres de base no se pueden
   parametrizar con `?`, asi que el SQL se arma con template y el nombre se
   valida antes. Lo usan:
     - el alta de empresas            (src/servicios/altas.js)
     - la importacion de una existente (tools/importar-empresa.js)

   La base heredada (`serviceintegralsistema`) NO matchea el comodin de las
   bases de empresa, por eso tiene que llevar su GRANT explicito. Lo mismo vale
   para cualquier base importada que no siga el patron.

   PREFIJO_TENANT: el prefijo de las bases de empresa sale de UNA sola variable
   de entorno (`PREFIJO_TENANT`, por defecto `si_tenant_` para no romper las
   instalaciones existentes). De esa misma variable salen el nombre que arma el
   alta (`altas.js`) y el patron del GRANT; el arranque del servidor verifica
   que coincidan.
   ========================================================================== */
const mysql = require('mysql2/promise');
const { configAdmin, nombreCentral } = require('./conexiones');

/** La app necesita DML + DDL + REFERENCES para aplicar migraciones de empresa. */
const PRIVILEGIOS_APP = 'SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES';

/** El admin de bases necesita administrar una base fuera del comodin. */
const PRIVILEGIOS_ADMIN = 'ALL PRIVILEGES';

/** Usuario con el que corre la aplicacion. */
function usuarioApp() {
    return process.env.DB_USER || 'service_integral_app';
}

/** Usuario que administra las bases de empresa. */
function usuarioAdmin() {
    return process.env.DB_ADMIN_USER || 'si_tenant_admin';
}

/**
 * Escapa el comodin de MySQL para que el prefijo se tome literal.
 * Sin esto, `si_tenant_%` matchearia tambien `si-tenant-cualquier-cosa`.
 */
function patronDeBase(prefijo) {
    return String(prefijo).replace(/_/g, '\\_');
}

/** Prefijo por defecto: el historico, para no romper instalaciones existentes. */
const PREFIJO_TENANT_DEFAULT = 'si_tenant_';

/**
 * El prefijo de las bases de empresa. UNA sola fuente: de aca salen el nombre
 * que arma el alta de empresas y el patron del GRANT.
 *
 * Las instalaciones existentes lo dejan sin definir y conservan `si_tenant_`.
 * Las nuevas (Vultr) ponen `PREFIJO_TENANT=aexia_tenant_` en el `.env`.
 */
function prefijoTenant() {
    return String(process.env.PREFIJO_TENANT || PREFIJO_TENANT_DEFAULT);
}

/** El patron (ya escapado) con el que se otorgan los permisos: `<prefijo>%`. */
function patronTenant() {
    return patronDeBase(prefijoTenant());
}

/**
 * Chequeo al arrancar. Falla (lanza) si el prefijo no es un prefijo de base
 * valido, si no termina en `_` (pegaria el slug a la palabra anterior) o si el
 * patron del GRANT no escapa los guiones bajos. El servidor lo llama al
 * arrancar para no crear bases que el comodin no cubra.
 */
function verificarPrefijoTenant() {
    const prefijo = prefijoTenant();

    if (!/^[A-Za-z0-9_]+$/.test(prefijo)) {
        throw new Error(
            `PREFIJO_TENANT invalido: "${prefijo}". Solo letras, numeros y guiones bajos.`
        );
    }
    if (!prefijo.endsWith('_')) {
        throw new Error(
            `PREFIJO_TENANT invalido: "${prefijo}". Tiene que terminar en "_" ` +
            `para que el slug no quede pegado (ejemplo: "aexia_tenant_").`
        );
    }
    const esperado = prefijo.replace(/_/g, '\\_');
    if (patronDeBase(prefijo) !== esperado) {
        throw new Error(
            `El patron del GRANT no escapa los guiones bajos de "${prefijo}". ` +
            `Esto haria que el comodin cubra bases que no corresponden.`
        );
    }
    return prefijo;
}

/**
 * Un nombre de base solo puede llevar letras, numeros y guion bajo.
 *
 * No es paranoia: el nombre va metido en un `CREATE DATABASE \`...\`` / `GRANT
 * ... ON \`...\`` que no se puede preparar como un `?`. Un nombre con un acento
 * grave seria inyeccion de SQL.
 */
function nombreDeBaseValido(nombre) {
    return typeof nombre === 'string' && /^[A-Za-z0-9_]+$/.test(nombre) && nombre.length <= 64;
}

function exigirBaseValida(base) {
    if (!nombreDeBaseValido(base)) {
        throw new Error(`"${base}" no es un nombre de base valido.`);
    }
}

/** GRANT de la app sobre UNA base. `conexion` debe poder conceder. */
async function concederPermisosApp(conexion, base) {
    exigirBaseValida(base);
    await conexion.query(
        `GRANT ${PRIVILEGIOS_APP} ON \`${base}\`.* TO '${usuarioApp()}'@'localhost'`
    );
}

/** GRANT del admin de bases sobre UNA base (la heredada no matchea el comodin). */
async function concederPermisosAdmin(conexion, base) {
    exigirBaseValida(base);
    await conexion.query(
        `GRANT ${PRIVILEGIOS_ADMIN} ON \`${base}\`.* TO '${usuarioAdmin()}'@'localhost'`
    );
}

/**
 * Concede a la app y al admin sobre UNA base, con una conexion ya abierta.
 * Devuelve el resultado por separado: que falle uno no debe impedir el otro.
 */
async function concederPermisosBase(conexion, base) {
    const resultado = { admin: null, app: null };

    try { await concederPermisosAdmin(conexion, base); resultado.admin = 'ok'; }
    catch (e) { resultado.admin = e.message; }

    try { await concederPermisosApp(conexion, base); resultado.app = 'ok'; }
    catch (e) { resultado.app = e.message; }

    try { await conexion.query('FLUSH PRIVILEGES'); } catch { /* no es obligatorio */ }

    return resultado;
}

/**
 * Abre su propia conexion de administracion y concede los permisos de `base`,
 * con prefijo o sin el. Cierra la conexion siempre.
 */
async function darPermisosDeEmpresa(base) {
    const admin = await mysql.createConnection(configAdmin(nombreCentral()));
    try {
        return await concederPermisosBase(admin, base);
    } finally {
        await admin.end();
    }
}

module.exports = {
    PRIVILEGIOS_APP,
    PRIVILEGIOS_ADMIN,
    PREFIJO_TENANT_DEFAULT,
    usuarioApp,
    usuarioAdmin,
    prefijoTenant,
    patronDeBase,
    patronTenant,
    verificarPrefijoTenant,
    nombreDeBaseValido,
    concederPermisosApp,
    concederPermisosAdmin,
    concederPermisosBase,
    darPermisosDeEmpresa
};
