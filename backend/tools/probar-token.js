/* Prueba un token pegado a mano contra las rutas del panel de administracion.
   Existe porque el token lo genera `generate-token.js` con un `iat` nuevo en
   cada corrida: si uno copia el texto de una salida vieja (o de una corrida
   anterior) el servidor lo rechaza con 401 y no queda claro si el problema es
   el token o la sesion del navegador. Este script separa las dos cosas.

   Uso:  node tools/probar-token.js <token>
*/
const API = 'http://127.0.0.1:3000';
const token = (process.argv[2] || '').trim();

if (!token) {
    console.log('Uso: node tools/probar-token.js <token>');
    process.exit(1);
}

const RUTAS = [
    ['GET', '/api/admin/catalogos'],
    ['GET', '/api/admin/empresas'],
    ['GET', '/api/admin/yo'],
    ['GET', '/api/admin/auditoria?limite=3'],
    // Estas dos tienen que dar 403, no 401: son de empresa y el token es de
    // SUPERADMIN. Si dieran 401 seria que el token no esta bien, no el rol.
    ['GET', '/api/reparaciones'],
    ['GET', '/api/clientes']
];

(async () => {
    const partes = token.split('.');
    if (partes.length !== 3) {
        console.log(`El token tiene ${partes.length} partes. Un JWT tiene 3. Faltan caracteres.`);
        process.exit(1);
    }
    console.log(`Token de ${partes[0].length} + ${partes[1].length} + ${partes[2].length} caracteres\n`);

    let fallos = 0;
    for (const [metodo, ruta] of RUTAS) {
        const r = await fetch(`${API}${ruta}`, {
            method: metodo,
            headers: { Authorization: `Bearer ${token}` }
        });
        const texto = await r.text();
        const esperado = ruta.startsWith('/api/admin') ? 200 : 403;
        const bien = r.status === esperado;
        if (!bien) fallos++;
        console.log(`  ${bien ? 'OK   ' : 'FALLO'} ${metodo} ${ruta} -> ${r.status} (se esperaba ${esperado})`);
        if (!bien) console.log(`        ${texto.slice(0, 160)}`);
    }

    console.log(fallos ? `\n${fallos} ruta(s) responderon distinto de lo esperado.` : '\nEl token sirve.');
    process.exit(fallos ? 1 : 0);
})();
