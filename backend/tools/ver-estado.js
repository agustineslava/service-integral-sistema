require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const c = await mysql.createConnection({
        host: '127.0.0.1',
        user: process.env.DB_ADMIN_USER,
        password: process.env.DB_ADMIN_PASSWORD,
        database: process.env.DB_CENTRAL_NAME || 'si_central'
    });

    const [e] = await c.query('SELECT id,nombre,slug,nombre_db,estado FROM empresas ORDER BY id');
    console.log('EMPRESAS: ' + e.length);
    e.forEach(r => console.log(`  #${r.id}  ${r.nombre}  |  ${r.slug}  |  ${r.nombre_db}  |  ${r.estado}`));

    const [u] = await c.query('SELECT id,email,rol,activo,empresa_id FROM usuarios_globales ORDER BY id');
    console.log('USUARIOS: ' + u.length);
    u.forEach(r => console.log(`  #${r.id}  ${r.email}  ${r.rol}  activo=${r.activo}  empresa=${r.empresa_id}`));

    const [d] = await c.query("SHOW DATABASES LIKE 'si\\_tenant%'");
    console.log('BASES si_tenant_*: ' + d.length + '  ' + d.map(x => Object.values(x)[0]).join(', '));

    await c.end();
})().catch(e => console.log('ERROR: ' + e.message));
