#!/usr/bin/env node
/**
 * Genera un JWT de un usuario REAL, para pruebas o para recuperar el acceso.
 *   node tools/generate-token.js
 *   node tools/generate-token.js admin@serviceintegral.com
 *   node tools/generate-token.js aguseslava11@gmail.com
 *
 * Lee el usuario de la base central, asi que el token sale idéntico al que
 * emite el login: mismo id, mismo rol, misma empresa. Sirve para entrar
 * cuando te quedaste sin la contraseña de todos los usuarios.
 *
 * ADVERTENCIA: firma con el JWT_SECRET del .env, así que quien tenga acceso
 * al .env puede entrar como quien quiera. En el servidor de producción, el
 * .env no debería ser legible por cualquiera. Cuando haya clientes de verdad,
 * esto se revisa (F6: el SuperAdmin deja de depender de este archivo).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const jwt = require('jsonwebtoken');
const central = require('../src/db/central');

const [, , emailArg, rolArg] = process.argv;
const email = (emailArg || 'admin@serviceintegral.com').trim().toLowerCase();

(async () => {
    const usuario = await central.uno('SELECT * FROM usuarios_globales WHERE email = ?', [email]);
    const empresa = usuario && usuario.empresa_id
        ? await central.uno('SELECT id, nombre, estado FROM empresas WHERE id = ?', [usuario.empresa_id])
        : null;

    let carga;

    if (usuario) {
        carga = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            rol: rolArg || usuario.rol,
            empresa_id: usuario.empresa_id
        };
    } else {
        console.log(`[!] No hay ningún usuario con ${email} en la base central.`);
        console.log('    Se genera un token de pruebas, pero ese usuario no existe.');
        carga = {
            id: 0,
            nombre: 'Prueba',
            email,
            rol: rolArg || 'ADMIN',
            empresa_id: Number(process.env.EMPRESA_ID || 1)
        };
    }

    if (empresa && !['ACTIVO', 'DEMO'].includes(empresa.estado)) {
        console.log(`[!] La empresa ${empresa.nombre} está ${empresa.estado}: este token no va a servir.`);
    }

    if (carga.rol !== 'SUPERADMIN' && !empresa) {
        console.log('[!] Ese usuario no tiene empresa asignada: las rutas del taller le van a dar 403.');
    }

    const token = jwt.sign(carga, process.env.JWT_SECRET, { expiresIn: '8h' });

    console.log('');
    console.log(`  Usuario : ${carga.email}`);
    console.log(`  Nombre  : ${carga.nombre}`);
    console.log(`  Rol     : ${carga.rol}`);
    console.log(`  Empresa : ${empresa ? `${empresa.nombre} (#${empresa.id}, ${empresa.estado})` : 'ninguna (SuperAdmin)'}`);
    console.log('');
    console.log(`Token:\n${token}\n`);
    console.log('Uso:  Authorization: Bearer <token>');
    console.log('');

    await central.cerrar();
})().catch(async (err) => {
    console.error('Error:', err.message);
    try { await central.cerrar(); } catch { /* nada */ }
    process.exit(1);
});
