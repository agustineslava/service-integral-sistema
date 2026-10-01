/*
 * Restaura la clave de un usuario de la base central.
 * Uso:  node tools/reset-clave.js <email> <clave>
 *
 * Necesario porque durante una sesion de trabajo se reseteo la clave del
 * SUPERADMIN a un valor de prueba y el dueno del sistema dejo de entrar.
 */
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const bcrypt = require('bcryptjs');
const central = require('../src/db/central');

const email = (process.argv[2] || '').trim().toLowerCase();
const clave = process.argv[3] || '';

if (!email || !clave) {
    console.error('Uso: node tools/reset-clave.js <email> <clave>');
    process.exit(1);
}

(async () => {
    const u = await central.uno(
        'SELECT id, email, rol, activo FROM usuarios_globales WHERE email = ?',
        [email]
    );

    if (!u) {
        console.error(`  No existe ningun usuario con ese email: ${email}`);
        await central.cerrar();
        process.exit(1);
    }

    const hash = await bcrypt.hash(clave, 10);
    await central.query(
        'UPDATE usuarios_globales SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?',
        [hash, u.id]
    );

    const verificada = await bcrypt.compare(
        clave,
        (await central.uno('SELECT password_hash FROM usuarios_globales WHERE id = ?', [u.id])).password_hash
    );

    console.log(`  Usuario  : ${u.email} (id ${u.id}, rol ${u.rol}, activo ${u.activo})`);
    console.log(`  Clave    : reemplazada`);
    console.log(`  Verificada contra el hash guardado: ${verificada ? 'SI' : 'NO'}`);
    console.log(`  debe_cambiar_password: 0 (puede entrar directo)`);

    await central.cerrar();
    process.exit(verificada ? 0 : 1);
})().catch(async (e) => {
    console.error('  Error:', e.message);
    try { await central.cerrar(); } catch {}
    process.exit(1);
});