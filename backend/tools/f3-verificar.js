#!/usr/bin/env node
/**
 * F3 · VERIFICACION
 * ---------------------------------------------------------------------------
 *   node tools/f3-verificar.js
 *
 * Comprueba las dos reglas de F3, y las comprueba POR HTTP contra el servidor
 * real, que es la unica forma de saber que la regla aguanta:
 *
 *   1. LIMITE DE USUARIOS DEL PLAN. El plan básico trae 3. Al pedir un
 *      cuarto tiene que contestar 403 con codigo LIMITE_USUARIOS. Y al
 *      ampliarlo con la excepción de la empresa, tiene que dejar pasar.
 *
 *   2. MODULOS CONTRATADOS. Al desactivar un módulo, SUS rutas contestan 404
 *      y las de los demás siguen andando. Un módulo apagado no puede "~no
 *      mostrar" nada: tiene que ser imposible de alcanzar.
 *
 * POR QUE ESTA HERRAMIENTA ESPERA
 * El servidor guarda empresa y módulos en memoria ~30 s (ver registro.js).
 * Si esta herramienta cambia la base y pregunta de inmediato, el servidor
 * contesta con lo que tenía cacheado y la prueba miente. Por eso espera a que
 * expire la caché antes de preguntar. Son dos esperas, no una por comprobación.
 *
 * TOCA EL TALLER, PERO POR POCO TIEMPO
 * Esta prueba sube el límite y apaga el módulo 'pedidos' de la empresa real
 * durante ~35 segundos. Al terminar los restaura, SIEMPRE, incluso si falla
 * (esta en un finally). Si la interrumpis a la mano, se arregla asi:
 *
 *   node tools/f3-verificar.js --restaurar
 *
 * NO deja basura: el usuario de prueba se borra siempre.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const jwt = require('jsonwebtoken');
const { nombreCentral } = require('../src/db/conexiones');
const central = require('../src/db/central');
const registro = require('../src/servicios/registro');

const PUERTO = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const DB_TALLER = process.env.DB_NAME;
const MODULO_A_APAGAR = 'pedidos';

const EMAIL_PRUEBA = 'f3-verificacion@prueba.local';
const CLAVE_PRUEBA = 'Temporal-F3-9x2';

let pruebas = 0;
let fallos = 0;

function comprobar(condicion, texto, detalle) {
    pruebas++;
    if (condicion) {
        console.log(`  [OK]    ${texto}`);
    } else {
        fallos++;
        console.log(`  [FALLO] ${texto}`);
        if (detalle !== undefined) console.log(`          -> ${JSON.stringify(detalle)}`);
    }
}

function titulo(t) {
    console.log('');
    console.log('='.repeat(70));
    console.log(` ${t}`);
    console.log('='.repeat(70));
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(ruta, token, opciones = {}) {
    const res = await fetch(BASE_URL + ruta, {
        ...opciones,
        headers: {
            ...(opciones.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
    });
    let cuerpo = null;
    try { cuerpo = await res.json(); } catch { /* puede no ser JSON */ }
    return { estado: res.status, cuerpo };
}

/** Espera a que el servidor suelte la caché de la central. */
async function esperarCache(porQue) {
    const ms = registro.TTL_MS + 1500;
    console.log(`  ...esperando ${Math.round(ms / 1000)} s (${porQue})`);
    await dormir(ms);
}

async function servidorVivo() {
    try {
        const res = await fetch(BASE_URL + '/api/config-comercio');
        return res.ok;
    } catch {
        return false;
    }
}

/** Estado de la empresa, para poder devolver todo a como estaba. */
async function leerEstado(empresaId) {
    const empresa = await central.uno('SELECT id, nombre, max_usuarios FROM empresas WHERE id = ?', [empresaId]);
    const modulos = await central.query('SELECT modulo, activo FROM empresa_modulos WHERE empresa_id = ?', [empresaId]);
    return {
        empresa,
        modulos: new Map(modulos.map((m) => [m.modulo, m.activo]))
    };
}

async function restaurar(estado, empresaId) {
    await central.query('UPDATE empresas SET max_usuarios = ? WHERE id = ?', [estado.empresa.max_usuarios, empresaId]);
    for (const [modulo, activo] of estado.modulos) {
        await central.query('UPDATE empresa_modulos SET activo = ? WHERE empresa_id = ? AND modulo = ?', [activo, empresaId, modulo]);
    }
    console.log('  (estado restaurado)');
}

// ---------------------------------------------------------------------------

async function main() {
    titulo('F3 · VERIFICACION');

    const empresaId = await central.uno('SELECT id FROM empresas WHERE nombre_db = ?', [DB_TALLER]);
    if (!empresaId) {
        console.error(`\nNo hay ninguna empresa apuntando a la base "${DB_TALLER}".`);
        process.exitCode = 1;
        return;
    }

    const estado = await leerEstado(empresaId.id);
    const limiteOriginal = estado.empresa.max_usuarios;

    // `--restaurar`: deja todo como estaba y sale. Para cuando se interrumpio.
    if (process.argv.includes('--restaurar')) {
        console.log(`\nRestaurando la empresa #${empresaId.id} ...`);
        await restaurar(estado, empresaId.id);
        await central.cerrar();
        return;
    }

    if (!(await servidorVivo())) {
        console.error(`\nEl servidor no responde en ${BASE_URL}.`);
        console.error('Levantalo con: pm2 restart service-integral-backend');
        process.exitCode = 1;
        return;
    }

    // Un ADMIN de esa empresa, para tener un token de verdad.
    const admin = await central.uno(
        `SELECT id, nombre, rol FROM usuarios_globales
          WHERE empresa_id = ? AND rol = 'ADMIN' AND activo = 1 ORDER BY id LIMIT 1`,
        [empresaId.id]
    );
    if (!admin) {
        console.error('\nLa empresa no tiene ningún ADMIN activo.');
        process.exitCode = 1;
        return;
    }

    const token = jwt.sign(
        { id: admin.id, nombre: admin.nombre, rol: admin.rol, empresa_id: empresaId.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    console.log(`\nEmpresa #${empresaId.id} · ${estado.empresa.nombre}`);
    console.log(`Límite original (empresas.max_usuarios): ${limiteOriginal === null ? 'NULL -> lo del plan' : limiteOriginal}`);

    try {
        // =====================================================================
        titulo(' 1. Lo que el frontend necesita saber de su propia empresa');
        // =====================================================================
        const mi = await pedir('/api/mi-empresa', token);
        comprobar(mi.estado === 200, 'GET /api/mi-empresa responde 200', mi);
        comprobar(Number(mi.cuerpo?.limite_usuarios) > 0,
            `viene el límite de usuarios (${mi.cuerpo?.limite_usuarios})`, mi.cuerpo);
        comprobar(Array.isArray(mi.cuerpo?.modulos) && mi.cuerpo.modulos.length > 0,
            `viene la lista de módulos (${JSON.stringify(mi.cuerpo?.modulos)})`, mi.cuerpo);
        comprobar(typeof mi.cuerpo?.slug === 'string' && mi.cuerpo.slug.length > 0,
            'viene el slug (marca blanca)', mi.cuerpo);
        comprobar(typeof mi.cuerpo?.usuarios_actuales === 'number',
            `viene el conteo de usuarios (${mi.cuerpo?.usuarios_actuales})`, mi.cuerpo);

        // =====================================================================
        titulo(' 2. Con la excepción puesta, un usuario más entra');
        // =====================================================================
        console.log(`\n  Subiendo el límite a 5 y apagando el módulo "${MODULO_A_APAGAR}".`);
        await central.query('UPDATE empresas SET max_usuarios = 5 WHERE id = ?', [empresaId.id]);
        await central.query('UPDATE empresa_modulos SET activo = 0 WHERE empresa_id = ? AND modulo = ?', [empresaId.id, MODULO_A_APAGAR]);
        await esperarCache('el servidor vea los cambios');

        const alta = await pedir('/api/usuarios', token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: 'F3 Verificacion', email: EMAIL_PRUEBA, password: CLAVE_PRUEBA, rol: 'TECNICO' })
        });
        comprobar(alta.estado === 201, 'con límite 5, se crea el cuarto usuario', alta);
        const idCreado = alta.cuerpo?.id;

        // El login tiene que traer los mismos datos que /api/mi-empresa.
        const login = await pedir('/api/login', null, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL_PRUEBA, password: CLAVE_PRUEBA })
        });
        comprobar(login.estado === 200, 'el usuario recien creado puede iniciar sesión', login);
        comprobar(Array.isArray(login.cuerpo?.empresa?.modulos),
            'el login trae empresa.modulos', login.cuerpo?.empresa);
        comprobar(Number(login.cuerpo?.empresa?.limite_usuarios) === 5,
            `el login trae el límite efectivo (${login.cuerpo?.empresa?.limite_usuarios})`, login.cuerpo?.empresa);

        if (idCreado) {
            const baja = await pedir(`/api/usuarios/${idCreado}`, token, { method: 'DELETE' });
            comprobar(baja.estado === 200, 'el usuario de prueba se puede borrar', baja);
        }

        // =====================================================================
        titulo(` 3. Con "${MODULO_A_APAGAR}" apagado, sus rutas no existen`);
        // =====================================================================
        const apagado = await pedir(`/api/${MODULO_A_APAGAR}`, token);
        comprobar(apagado.estado === 404, `GET /api/${MODULO_A_APAGAR} responde 404`, apagado);
        comprobar(apagado.cuerpo?.error === 'No encontrado',
            'y dice "No encontrado", sin confirmar que la sección existe', apagado.cuerpo);

        const otro = await pedir('/api/productos', token);
        comprobar(otro.estado === 200, 'los otros módulos siguen funcionando (productos)', otro);

        const clientes = await pedir('/api/clientes', token);
        comprobar(clientes.estado === 200, 'y también los de clientes', clientes);

        const usr = await pedir('/api/usuarios', token);
        comprobar(usr.estado === 200,
            'gestionar usuarios NO depende de un módulo: sigue disponible', usr);

        const mi2 = await pedir('/api/mi-empresa', token);
        comprobar(Array.isArray(mi2.cuerpo?.modulos) && !mi2.cuerpo.modulos.includes(MODULO_A_APAGAR),
            `el frontend ya no recibe "${MODULO_A_APAGAR}" en la lista`, mi2.cuerpo?.modulos);
        comprobar(Array.isArray(mi2.cuerpo?.modulos) && mi2.cuerpo.modulos.includes('stock'),
            'pero sí los que sí contrató', mi2.cuerpo?.modulos);

        // =====================================================================
        titulo(' 4. Vuelto a las reglas del plan, el cuarto usuario rebota');
        // =====================================================================
        console.log(`\n  Sacando la excepción y volviendo a prender "${MODULO_A_APAGAR}".`);
        await central.query('UPDATE empresas SET max_usuarios = ? WHERE id = ?', [limiteOriginal, empresaId.id]);
        await central.query('UPDATE empresa_modulos SET activo = 1 WHERE empresa_id = ? AND modulo = ?', [empresaId.id, MODULO_A_APAGAR]);
        await esperarCache('el servidor vea la vuelta atrás');

        const limitePlan = await central.uno('SELECT max_usuarios FROM planes WHERE codigo = (SELECT plan FROM empresas WHERE id = ?)', [empresaId.id]);

        const rebote = await pedir('/api/usuarios', token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: 'F3 Rebote', email: EMAIL_PRUEBA, password: CLAVE_PRUEBA, rol: 'TECNICO' })
        });
        comprobar(rebote.estado === 403, 'crear el cuarto usuario responde 403', rebote);
        comprobar(rebote.cuerpo?.codigo === 'LIMITE_USUARIOS',
            'con codigo LIMITE_USUARIOS, para que el frontend lo distinga', rebote.cuerpo);
        comprobar(Number(rebote.cuerpo?.limite) === Number(limitePlan?.max_usuarios),
            `y el límite que manda es el del plan (${limitePlan?.max_usuarios})`, rebote.cuerpo);

        const existe = await central.uno('SELECT id FROM usuarios_globales WHERE email = ?', [EMAIL_PRUEBA]);
        comprobar(!existe, 'y NO se creó ningún usuario', existe);

        const vuelve = await pedir(`/api/${MODULO_A_APAGAR}`, token);
        comprobar(vuelve.estado === 200, `y /api/${MODULO_A_APAGAR} volvió a 200`, vuelve);

    } finally {
        // Pase lo que pase, la empresa queda como estaba.
        console.log('\n  -- restaurando --');
        await restaurar(estado, empresaId.id);
        await central.query('DELETE FROM usuarios_globales WHERE email = ?', [EMAIL_PRUEBA]);
        console.log('  (usuario de prueba borrado)');
    }

    // =====================================================================
    titulo(' RESULTADO');
    // =====================================================================
    console.log(`  ${pruebas - fallos}/${pruebas} comprobaciones OK`);
    if (fallos > 0) {
        console.log(`  ${fallos} FALLARON`);
        process.exitCode = 1;
    } else {
        console.log('  El límite del plan y los módulos se están aplicando de verdad.');
    }

    await central.cerrar();
}

main().catch(async (err) => {
    console.error('\nERROR:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
    try { await central.cerrar(); } catch { /* nada */ }
});
