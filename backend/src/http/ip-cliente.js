/* ==========================================================================
   IP DEL CLIENTE (plan R-3, paso 1: salida a app.aexia.com.ar)
   --------------------------------------------------------------------------
   Un solo lugar para decidir que IP representa al cliente. Hace falta porque
   detras de Cloudflare Tunnel el socket viene de loopback y la IP real viaja
   en cabeceras que el cliente PODRIA forjar si llega al :3000 saltandose el
   tunel.

   Regla:
     - Socket loopback (127.0.0.1, ::1, ::ffff:127.0.0.1): el pedido vino del
       tunel. Se confia en `CF-Connecting-IP` (un solo valor, no encadenable
       como XFF) si es una IP valida; si no viene o es basura, cae a `req.ip`
       (que con `trust proxy` respeta X-Forwarded-For).
     - Socket NO loopback: alguien llego directo al origen. Se usa la IP del
       socket y se ignoran `CF-Connecting-IP` y `X-Forwarded-For` (forjables).

   Lo usan los tres limitadores de express-rate-limit y la auditoria (`ipDe`).
   ========================================================================== */
const net = require('net');

/** Direcciones que identifican una conexion venida del propio equipo. */
function esLoopback(direccion) {
    const ip = String(direccion || '').trim().toLowerCase();
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * IP del cliente para limitar y auditar. Devuelve un string o `null`.
 * @param {import('express').Request} req
 */
function ipCliente(req) {
    const socketIp = (req && req.socket && req.socket.remoteAddress) || '';

    if (!esLoopback(socketIp)) {
        // Llego directo al origen: la unica IP confiable es la del socket.
        return socketIp || null;
    }

    // Vino por el tunel local: la IP real es la que agrego Cloudflare.
    const cf = String((req.headers && req.headers['cf-connecting-ip']) || '').trim();
    if (net.isIP(cf)) return cf;

    // Sin `CF-Connecting-IP` valido: lo mejor que hay es `req.ip`.
    return req.ip || null;
}

module.exports = { ipCliente, esLoopback };
