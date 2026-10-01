/*
 * Prueba de ida y vuelta del cambio de contraseña del SuperAdmin.
 *
 * Cambia la clave a un valor temporal, comprueba que la clave anterior deja de
 * servir, y la deja otra vez como estaba. Si algo falla en el medio, el
 * `finally` intenta volver atrás: nunca tiene que quedar la clave cambiada.
 */
const BASE = 'http://127.0.0.1:3000';
const EMAIL = 'aguseslava11@gmail.com';
const ORIGINAL = 'Bonoyhomero23';
const TEMPORAL = 'Temporal_Prueba_9x';

let ok = 0, fallo = 0;
const p = (t) => console.log(`\n--- ${t} ---`);
const ok_ = (c, txt, extra = '') => {
    if (c) { ok++; console.log(`  [OK]    ${txt}`); }
    else { fallo++; console.log(`  [FALLO] ${txt}${extra ? '  -> ' + extra : ''}`); }
};

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
    const cab = { 'Content-Type': 'application/json' };
    if (token) cab.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + ruta, {
        method: metodo, headers: cab,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    let d = null;
    try { d = await r.json(); } catch { d = {}; }
    return { status: r.status, datos: d };
}

const entrar = async (clave) => {
    const r = await pedir('POST', '/api/login', { cuerpo: { email: EMAIL, password: clave } });
    return r.status === 200 ? r.datos.token : null;
};

(async () => {
    p('Punto de partida');
    const token = await entrar(ORIGINAL);
    ok_(!!token, `la clave original (${ORIGINAL}) entra`);
    if (!token) { console.log('  no puedo seguir sin token'); process.exit(1); }

    let tokenVivo = token;
    try {
        p('Cambio a la clave temporal');
        const r = await pedir('POST', '/api/admin/yo/clave', {
            token,
            cuerpo: { passwordActual: ORIGINAL, passwordNueva: TEMPORAL }
        });
        ok_(r.status === 200, `el cambio responde 200`, `HTTP ${r.status} ${JSON.stringify(r.datos)}`);
        ok_(!!r.datos.token, 'devuelve un token nuevo');
        if (r.datos.token) tokenVivo = r.datos.token;

        p('La clave nueva sirve y la vieja ya no');
        const conNueva = await entrar(TEMPORAL);
        ok_(!!conNueva, `la clave temporal (${TEMPORAL}) entra`);
        const conVieja = await entrar(ORIGINAL);
        ok_(!conVieja, 'la clave vieja ya NO entra');

        p('La clave nueva alcanza para cambiar la clave');
        const r2 = await pedir('POST', '/api/admin/yo/clave', {
            token: conNueva || tokenVivo,
            cuerpo: { passwordActual: TEMPORAL, passwordNueva: 'Otra_Que_No' }
        });
        ok_(r2.status === 200, 'con la clave nueva se puede volver a cambiar', `HTTP ${r2.status}`);
    } finally {
        p('Volver a la clave original');
        // Se usa reset-clave: si algo del camino anterior quedo a medias, es
        // la unica via que no depende de acordarse de una clave intermedia.
        const { execFileSync } = require('child_process');
        try {
            execFileSync(process.execPath, ['tools/reset-clave.js', EMAIL, ORIGINAL], {
                encoding: 'utf8', stdio: 'pipe'
            });
            ok_(true, 'reset-clave la dejo en la original');
        } catch (e) {
            ok_(false, 'reset-clave fallo', String(e.stdout || e.message).slice(0, 200));
        }
        const vuelve = await entrar(ORIGINAL);
        ok_(!!vuelve, 'la clave original entra de nuevo');
    }

    console.log(`\nRESULTADO: ${ok} ok, ${fallo} fallo(s)`);
    process.exit(fallo ? 1 : 0);
})();
