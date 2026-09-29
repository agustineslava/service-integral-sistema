/* ==========================================================================
   REGISTRO DE EMPRESAS Y USUARIOS  (base central)
   --------------------------------------------------------------------------
   Todo lo que el servidor necesita saber sobre "quien es esta empresa" pasa
   por aca. Ninguna ruta consulta las tablas centrales a mano.

   CACHE
   La empresa se consulta en CADA request (para saber si sigue activa y que
   modulos tiene). Ir a la central 200 veces por segundo por el mismo dato es
   un desperdicio, asi que se guarda ~30 segundos.

   La contra asumida: si se suspende una empresa, el efecto tarda hasta 30
   segundos. Es el precio de que suspender funcione de verdad: sin este
   chequeo por request, un token de 8 horas seguiria entrando aunque la
   empresa ya no pague.
   ========================================================================== */
const central = require('../db/central');

const TTL_MS = 30 * 1000;

/** id de empresa -> { valor, expira } */
const cacheEmpresas = new Map();
/** id de empresa -> { valor, expira } */
const cacheModulos = new Map();

const vigente = (entrada) => Boolean(entrada) && entrada.expira > Date.now();

function guardar(mapa, clave, valor) {
    mapa.set(clave, { valor, expira: Date.now() + TTL_MS });
    return valor;
}

/** Estados en los que una empresa puede operar. */
const ESTADOS_OPERATIVOS = ['ACTIVO', 'DEMO'];

function estaOperativa(empresa) {
    return Boolean(empresa) && ESTADOS_OPERATIVOS.includes(empresa.estado);
}

/**
 * Empresa por id, con su limite efectivo de usuarios ya resuelto.
 * Limite efectivo = COALESCE(empresas.max_usuarios, planes.max_usuarios)
 */
async function empresaPorId(id) {
    if (id === null || id === undefined) return null;

    const cacheado = cacheEmpresas.get(id);
    if (vigente(cacheado)) return cacheado.valor;

    const fila = await central.uno(
        `SELECT e.*,
                p.nombre       AS plan_nombre,
                p.max_usuarios AS plan_max_usuarios,
                COALESCE(e.max_usuarios, p.max_usuarios) AS limite_usuarios
           FROM empresas e
           LEFT JOIN planes p ON p.codigo = e.plan
          WHERE e.id = ?`,
        [id]
    );

    return guardar(cacheEmpresas, id, fila);
}

/**
 * Usuario global por email.
 * NO se cachea a proposito: el login esta limitado por rate limit y es poco
 * frecuente. Cachearlo agregaria una ventana en la que una contrasena recien
 * cambiada seguiria vieja.
 */
async function usuarioPorEmail(email) {
    if (!email) return null;
    return central.uno('SELECT * FROM usuarios_globales WHERE email = ?', [String(email).trim().toLowerCase()]);
}

async function usuarioPorId(id) {
    return central.uno('SELECT * FROM usuarios_globales WHERE id = ?', [id]);
}

/** Se llama al iniciar sesion. No es critico: si falla, no se cae el login. */
async function marcarAcceso(id) {
    await central.query('UPDATE usuarios_globales SET ultimo_acceso = NOW() WHERE id = ?', [id]);
}

/** Cuantos usuarios activos tiene hoy una empresa. */
async function contarUsuarios(empresaId) {
    const fila = await central.uno(
        'SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ? AND activo = 1',
        [empresaId]
    );
    return fila ? fila.n : 0;
}

/**
 * Modulos contratados y activos de una empresa.
 * El catalogo dice que EXISTE; esto dice que CONTRATO.
 * Se usa en F3 para permitir o rechazar funcionalidad.
 */
async function modulosDe(empresaId) {
    const cacheado = cacheModulos.get(empresaId);
    if (vigente(cacheado)) return cacheado.valor;

    const filas = await central.query(
        `SELECT m.codigo, m.nombre, m.es_base, em.activo, em.limites,
                em.fecha_desde, em.fecha_hasta
           FROM empresa_modulos em
           JOIN modulos m ON m.codigo = em.modulo
          WHERE em.empresa_id = ? AND em.activo = 1
          ORDER BY m.orden`,
        [empresaId]
    );

    return guardar(cacheModulos, empresaId, filas);
}

/** Lista de empresas, para la flota y el panel del SuperAdmin. */
async function todasLasEmpresas() {
    return central.query(
        `SELECT e.id, e.nombre, e.slug, e.nombre_db, e.rubro, e.plan, e.estado,
                e.fecha_vencimiento,
                (SELECT COUNT(*) FROM usuarios_globales u
                  WHERE u.empresa_id = e.id AND u.activo = 1) AS usuarios_activos
           FROM empresas e
          ORDER BY e.id`
    );
}

function invalidarEmpresa(id) {
    cacheEmpresas.delete(id);
    cacheModulos.delete(id);
}

function invalidarTodo() {
    cacheEmpresas.clear();
    cacheModulos.clear();
}

module.exports = {
    ESTADOS_OPERATIVOS,
    TTL_MS,
    estaOperativa,
    empresaPorId,
    usuarioPorEmail,
    usuarioPorId,
    marcarAcceso,
    contarUsuarios,
    modulosDe,
    todasLasEmpresas,
    invalidarEmpresa,
    invalidarTodo
};
