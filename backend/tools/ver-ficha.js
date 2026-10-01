/* Diagnostico: por que la ficha de cliente solo muestra ordenes 'Entregado'. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const [reparaciones] = await db.query(
        'SELECT id, cliente_id, cliente_nombre, cliente_telefono, estado FROM reparaciones ORDER BY id'
    );
    console.log('--- reparaciones ---');
    reparaciones.forEach(r => {
        console.log(
            `  #${String(r.id).padEnd(3)} cliente_id=${String(r.cliente_id).padEnd(6)} ` +
            `estado=${String(r.estado).padEnd(20)} ${r.cliente_nombre} / ${r.cliente_telefono || '-'}`
        );
    });

    const [clientes] = await db.query('SELECT id, nombre, telefono FROM clientes ORDER BY id');
    console.log('--- clientes ---');
    clientes.forEach(c => {
        const suyas = reparaciones.filter(r => r.cliente_id === c.id);
        console.log(`  #${c.id} ${c.nombre} (${c.telefono || '-'}) -> ${suyas.length} orden(es): ${suyas.map(r => '#' + r.id + '/' + r.estado).join(', ') || 'NINGUNA'}`);
    });

    await db.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });