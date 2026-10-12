/* Comprueba, contra la base central, si una clave corresponde al hash guardado.
   No toca nada ni consume intentos del limitador de login: solo lee el hash y
   compara con bcrypt. Se usa para no gastar los 8 intentos por 10 minutos
   probando contraseñas a ciegas.

   Uso:  node tools/verificar-clave.js <email> <clave-a-probar>
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
    const email = (process.argv[2] || '').trim().toLowerCase();
    const clave = process.argv[3] || '';

    if (!email || !clave) {
        console.log('Uso: node tools/verificar-clave.js <email> <clave>');
        process.exit(1);
    }

    const central = await mysql.createConnection({
        host: process.env.CENTRAL_DB_HOST || process.env.DB_HOST || '127.0.0.1',
        user: process.env.CENTRAL_DB_USER || process.env.DB_USER,
        password: process.env.CENTRAL_DB_PASSWORD || process.env.DB_PASSWORD,
        database: process.env.DB_CENTRAL_NAME || 'si_central'
    });

    const [filas] = await central.query(
        'SELECT id, email, nombre, rol, activo, LEFT(password_hash, 7) AS prefijo FROM usuarios_globales WHERE email = ?',
        [email]
    );

    if (filas.length === 0) {
        console.log(`No existe ningun usuario con ese email en la central.`);
        await central.end();
        process.exit(1);
    }

    const u = filas[0];
    console.log(`Usuario #${u.id} ${u.email} (${u.nombre})`);
    console.log(`  rol: ${u.rol}   activo: ${u.activo}   hash: ${u.prefijo}...`);

    const [full] = await central.query('SELECT password_hash FROM usuarios_globales WHERE id = ?', [u.id]);
    const coincide = bcrypt.compareSync(clave, full[0].password_hash);
    console.log(`  la clave probada ${coincide ? 'COINCIDE' : 'NO coincide'}`);

    await central.end();
    process.exit(coincide ? 0 : 2);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
