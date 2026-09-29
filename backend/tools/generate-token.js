/**
 * Genera y guarda un JWT de SuperAdmin para pruebas.
 *   node tools/generate-token.js
 *
 * Usa JWT_SECRET del .env. Solo para desarrollo - en produccion
 * el login emite el token normalmente.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const [, , emailArg, rolArg] = process.argv;
const email = emailArg || 'admin@serviceintegral.com';
const rol = rolArg || 'ADMIN';

const token = jwt.sign(
    { id: 0, nombre: 'Prueba', email, rol, empresa_id: 1, es_superadmin: rol === 'SUPERADMIN' },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
);

console.log(`Usuario: ${email}  Rol: ${rol}`);
console.log(`\nToken:\n${token}\n`);
console.log('Uso:  Authorization: Bearer <token>');
