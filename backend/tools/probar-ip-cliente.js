/* Prueba unitaria del helper de IP del cliente (plan R-3, paso 1).
   No toca bases ni entorno: solo arma objetos `req` falsos y compara.

   Uso:  node tools/probar-ip-cliente.js   (o  npm run ip:probar)
*/
const { ipCliente, esLoopback } = require('../src/http/ip-cliente');

/** Arma un `req` minimo con lo que mira el helper. */
function reqFalso({ socket = '127.0.0.1', ip = '127.0.0.1', cf, xff } = {}) {
    const headers = {};
    if (cf !== undefined) headers['cf-connecting-ip'] = cf;
    if (xff !== undefined) headers['x-forwarded-for'] = xff;
    return { socket: { remoteAddress: socket }, ip, headers };
}

const casos = [
    {
        nombre: 'loopback + CF-Connecting-IP valida -> usa la de Cloudflare',
        req: reqFalso({ socket: '127.0.0.1', ip: '127.0.0.1', cf: '203.0.113.9' }),
        esperado: '203.0.113.9'
    },
    {
        nombre: 'loopback en ::1 + CF valida -> usa la de Cloudflare',
        req: reqFalso({ socket: '::1', ip: '::1', cf: '198.51.100.7' }),
        esperado: '198.51.100.7'
    },
    {
        nombre: 'loopback mapeado ::ffff:127.0.0.1 + CF valida',
        req: reqFalso({ socket: '::ffff:127.0.0.1', ip: '::ffff:127.0.0.1', cf: '2001:db8::5' }),
        esperado: '2001:db8::5'
    },
    {
        nombre: 'CF valida con espacios -> se recorta',
        req: reqFalso({ socket: '127.0.0.1', cf: '  203.0.113.9  ' }),
        esperado: '203.0.113.9'
    },
    {
        nombre: 'loopback sin cabecera -> cae a req.ip',
        req: reqFalso({ socket: '127.0.0.1', ip: '172.71.0.1' }),
        esperado: '172.71.0.1'
    },
    {
        nombre: 'loopback con cabecera basura -> cae a req.ip',
        req: reqFalso({ socket: '127.0.0.1', ip: '172.71.0.1', cf: 'basura' }),
        esperado: '172.71.0.1'
    },
    {
        nombre: 'loopback con IP fuera de rango -> cae a req.ip',
        req: reqFalso({ socket: '127.0.0.1', ip: '172.71.0.1', cf: '999.999.999.999' }),
        esperado: '172.71.0.1'
    },
    {
        nombre: 'loopback con cabecera vacia -> cae a req.ip',
        req: reqFalso({ socket: '127.0.0.1', ip: '172.71.0.1', cf: '' }),
        esperado: '172.71.0.1'
    },
    {
        nombre: 'socket NO loopback -> IP del socket, ignora CF y XFF forjadas',
        req: reqFalso({
            socket: '192.0.2.10',
            ip: '203.0.113.9',
            cf: '203.0.113.9',
            xff: '203.0.113.9, 172.71.0.1'
        }),
        esperado: '192.0.2.10'
    },
    {
        nombre: 'socket NO loopback IPv6 -> IP del socket',
        req: reqFalso({ socket: '2001:db8::5', ip: '203.0.113.9', cf: '203.0.113.9' }),
        esperado: '2001:db8::5'
    },
    {
        nombre: 'sin remoteAddress -> null (no inventa una IP)',
        req: reqFalso({ socket: '', ip: '203.0.113.9', cf: '203.0.113.9' }),
        esperado: null
    }
];

let fallas = 0;
for (const caso of casos) {
    const obtenido = ipCliente(caso.req);
    const ok = obtenido === caso.esperado;
    if (!ok) fallas++;
    console.log(`${ok ? 'OK  ' : 'FALLA'} · ${caso.nombre}`);
    if (!ok) {
        console.log(`        esperado=${JSON.stringify(caso.esperado)} obtenido=${JSON.stringify(obtenido)}`);
    }
}

// Chequeo corto de `esLoopback` (lo usa el helper y es la base de la regla).
const loopbacks = ['127.0.0.1', '::1', '::ffff:127.0.0.1', ' 127.0.0.1 '];
const noLoopbacks = ['192.0.2.10', '172.71.0.1', '::ffff:192.0.2.10', '', null];
for (const ip of loopbacks) {
    if (!esLoopback(ip)) { fallas++; console.log(`FALLA · esLoopback(${JSON.stringify(ip)}) deberia ser true`); }
}
for (const ip of noLoopbacks) {
    if (esLoopback(ip)) { fallas++; console.log(`FALLA · esLoopback(${JSON.stringify(ip)}) deberia ser false`); }
}

const total = casos.length + loopbacks.length + noLoopbacks.length;
console.log(`\n${total - fallas}/${total} comprobaciones OK.`);
process.exit(fallas === 0 ? 0 : 1);
