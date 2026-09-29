/**
 * F0 - Diagnóstico: inventario real de la base de datos.
 * NO modifica nada. Solo lee.
 *
 * Uso: node tools/inspect.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const [dbRows] = await conn.query('SELECT VERSION() AS v, DATABASE() AS db');
    console.log(`Servidor: ${dbRows[0].v}`);
    console.log(`Base:     ${dbRows[0].db}\n`);

    const [tablas] = await conn.query(
        `SELECT TABLE_NAME AS nombre, TABLE_ROWS AS filas_aprox,
                ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024) AS kb
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [process.env.DB_NAME]
    );

    console.log('TABLA'.padEnd(26) + 'FILAS(aprox)'.padStart(12) + 'TAMANO'.padStart(10) + '   REAL');
    console.log('-'.repeat(70));

    let totalFilas = 0;
    for (const t of tablas) {
        // COUNT(*) real: information_schema da un estimado, no la verdad
        const [[real]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t.nombre}\``);
        totalFilas += real.n;
        console.log(
            t.nombre.padEnd(26) +
            String(t.filas_aprox).padStart(12) +
            `${t.kb} KB`.padStart(10) +
            `   ${real.n}`
        );
    }

    console.log('-'.repeat(70));
    console.log(`TOTAL DE FILAS: ${totalFilas}`);

    await conn.end();
})().catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
