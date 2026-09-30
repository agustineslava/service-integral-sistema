/**
 * Soporte y recuperación de acceso.
 *
 * Dos cosas que el SuperAdmin necesita y que NO son "ver datos de un cliente":
 *
 *   1. Entrar a una empresa para probarla.
 *   2. Generar una clave temporal para un admin que se quedó sin la suya.
 *
 * ---------------------------------------------------------------------------
 * POR QUE "ENTRAR COMO" NO ES LO MISMO QUE "VER"
 * ---------------------------------------------------------------------------
 * El panel, por diseno, no muestra datos de ninguna empresa. Esa es la promesa
 * de cero cruce entre clientes, y se sostiene en que quien administra el
 * servicio no puede abrir el taller de otro.
 *
 * Entrar como cliente rompe esa promesa... o la degrada. Por eso aca no se
 * abre una pantalla con datos de un cliente: se abre una SESION, y esa sesion
 * deja rastro en cuatro lugares a la vez:
 *
 *   - la duracion es corta (30 minutos) y no se renova sola;
 *   - cada entrada queda en la tabla de auditoria, con quien la pidio y desde
 *     que IP;
 *   - la sesion no puede volver a entrar al panel (el guard del panel exige rol
 *     SUPERADMIN y este token no lo es);
 *   - y el frontend muestra un banner fijo que no se puede sacar.
 *
 * La sesion usa un usuario REAL de esa empresa, con su rol. Se eligio eso y
 * no un token sintetico porque el resto del sistema (permisos, módulos,
 * auditoría de la base del cliente) ya sabe qué hacer con un usuario de verdad;
 * inventar un rol nuevo habria obligated a tocar todas las rutas.
 *
 * El precio de esa decision, dicho asi: mientras dura la sesion, lo que se haga
 * queda en nombre de ese usuario en la base del cliente. Por eso el banner no
 * es decorativo. Es la parte que le dice al que esta mirando que no es el.
 *
 * ---------------------------------------------------------------------------
 * POR QUE LA CLAVE LA GENERA EL SISTEMA Y NO EL HUMANO
 * ---------------------------------------------------------------------------
 * Cuando un cliente llama diciendo que se olvido la clave, el canal va a ser el
 * telefono. Si el SuperAdmin escribiera la clave, se quedaria sabiendo la
 * contrasena de un cliente, y ese dato no se devuelve.
 *
 * Asi que la clave la genera el sistema: aleatoria, de una sola vez, y nunca
 * guardada. El SuperAdmin la lee por telefono y no elige nada. Y el usuario
 * queda con `debe_cambiar_password = 1`, que el servidor respeta en cada
 * request: entra, pero no puede hacer nada hasta cambiarla.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const central = require('../db/central');
const altas = require('./altas');
const registro = require('./registro');

/** Cuanto dura una sesion de soporte. Corta a proposito. */
const MINUTOS_SESION_SOPORTE = 30;

/**
 * Una clave que se pueda leer por telefono sin equivocar.
 *
 * Sin 0/O, 1/l/I, 5/S, 8/B, 2/Z: son los que se confunden cuando alguien los
 * lee de un lado y los tipea del otro. Se lee en voz alta sin que quede duda de
 * que es un cero o una o.
 */
const ALFABETO = '34679ACDEFGHJKMNPQRTUVWXY';

function generarClaveTemporal() {
    const largo = 12;
    let cuerpo = '';
    for (let i = 0; i < largo; i++) {
        cuerpo += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
    }
    // El guion cada cuatro: ayuda a repetirla de a bloques y a saber que no
    // falta ningun caracter cuando la dictan.
    return 'SI-' + cuerpo.slice(0, 4) + '-' + cuerpo.slice(4, 8) + '-' + cuerpo.slice(8);
}

/** Cuanto le queda a una sesion de soporte, para mostrarlo. */
function minutosRestantes(expira) {
    if (!expira) return 0;
    const ms = new Date(expira).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 60000));
}

/**
 * Arma el token de una sesion de soporte para una empresa.
 *
 * `usuarioId` es un usuario REAL de esa empresa. Si no se pasa, se usa su primer
 * ADMIN activo: entrar como un ADMIN da mas permisos que entrar como un
 * TECNICO, y para probar el sistema conviene ver lo que ve el que lo maneja.
 */
function tokenDeSoporte({ empresa, usuario, superadmin, minutos = MINUTOS_SESION_SOPORTE }) {
    const payload = {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
        empresa_id: empresa.id,
        // El claim que hace que el frontend muestre el banner. Va DENTRO del
        // token y firmado, asi que no se puede agregar ni sacar del lado del
        // cliente sin que el token deje de validar.
        soporte: {
            superadmin_id: superadmin.id,
            superadmin_email: superadmin.email,
            empresa_id: empresa.id,
            empresa_nombre: empresa.nombre,
            usuario_id: usuario.id,
            usuario_email: usuario.email,
            usuario_rol: usuario.rol
        }
    };

    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: `${minutos}m` });
}

/** El claim de soporte de un token ya validado, o null. */
function claimDeSoporte(payload) {
    return payload && payload.soporte ? payload.soporte : null;
}

/**
 * Le pone una clave temporal a un usuario y la devuelve EN CLARO, una sola vez.
 *
 * La clave en claro no se guarda en ningun lado: se hashea y se tira. Por eso
 * el que la pide tiene que copiarla en el momento, y por eso la interfaz tiene
 * que avisarlo antes de cerrar.
 */
async function claveTemporalPara(usuarioId, { autor, ip }) {
    const usuario = await central.uno(
        `SELECT id, nombre, email, rol, empresa_id, debe_cambiar_password
           FROM usuarios_globales WHERE id = ?`,
        [usuarioId]
    );
    if (!usuario) {
        const e = new Error(`No existe el usuario ${usuarioId}.`);
        e.estadoHttp = 404;
        throw e;
    }

    // Un SUPERADMIN no tiene empresa a la que pertenecer la clave de un cliente,
    // y dar claves de las cuentas de la plataforma por este camino seria una
    // puerta de atrás. Las del panel se manejan aparte.
    if (usuario.rol === 'SUPERADMIN') {
        const e = new Error('No se genera clave temporal para un SUPERADMIN. Las del panel se manejan aparte.');
        e.estadoHttp = 400;
        throw e;
    }

    const clave = generarClaveTemporal();
    await central.query(
        `UPDATE usuarios_globales
            SET password_hash = ?, debe_cambiar_password = 1, actualizado_en = NOW()
          WHERE id = ?`,
        [await bcrypt.hash(clave, 10), usuarioId]
    );

    // La cache de 30 s de `claveTemporalPendiente` tiene que caer ACÁ, y no
    // esperar a que se venza.
    //
    // Sin esto el cliente llama, recibe la clave, la tipea... y entra sin que se
    // le pida cambiarla, durante medio minuto. Es la ventana exacta en la que
    // la proteccion no esta y no se nota: el flujo "parece" completo y la
    // clave temporal queda como una clave mas, la que eligio el SuperAdmin y
    // que el cliente no cambio nunca.
    registro.invalidarClavePendiente(usuarioId);

    await altas.auditar({
        usuario: autor,
        accion: 'usuario.clave_temporal',
        empresaId: usuario.empresa_id,
        detalle: {
            usuario_id: usuario.id,
            email: usuario.email,
            nombre: usuario.nombre,
            rol: usuario.rol,
            quedan_pendientes: usuario.debe_cambiar_password ? 'ya estaba pendiente' : 'recien generada'
        },
        ip
    });

    // La clave en claro sale de acá y no se vuelve a guardar. Quien la pide, la
    // lee y se olvida.
    return {
        clave,
        usuario: {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            rol: usuario.rol
        },
        aviso: 'Esta clave se muestra una sola vez. Copiala ahora: despues no se puede volver a leer.'
    };
}

module.exports = {
    MINUTOS_SESION_SOPORTE,
    generarClaveTemporal,
    minutosRestantes,
    tokenDeSoporte,
    claimDeSoporte,
    claveTemporalPara
};