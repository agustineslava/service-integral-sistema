/* ==========================================================================
   Llena / vacia la lista de ordenes con filas sinteticas, para probar el
   paginado en la interfaz. Se usan entre pasos de una prueba manual; el
   limpiado borra SOLO las filas con la marca.

   Uso:
     node tools/llenar-ordenes.js llenar 45
     node tools/llenar-ordenes.js vaciar
     node tools/llenar-ordenes.js contar
   ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const MARCA = '__ui_paginado__';
const DIAS = 24 * 60 * 60 * 1000;
const ESTADOS = ['Pendiente', 'En Reparacion', 'Esperando Repuesto', 'Listo', 'Entregado', 'Cancelado'];
const DIAS_ATRAS = [0, 2, 5, 9, 16, 21, 35, 60];

(async () => {
    const que = process.argv[2] || 'contar';
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const [antes] = await db.query('SELECT COUNT(*) AS n FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);

    if (que === 'contar') {
        console.log(`filas con la marca: ${antes[0].n}`);
    } else if (que === 'vaciar') {
        const [r] = await db.query('DELETE FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);
        const [despues] = await db.query('SELECT COUNT(*) AS n FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);
        console.log(`borradas ${r.affectedRows}, quedan ${despues[0].n}`);
        if (despues[0].n !== 0) process.exit(1);
    } else if (que === 'llenar') {
        const n = parseInt(process.argv[3] || '45', 10);
        let creado = 0;
        for (let i = 0; i < n; i++) {
            const dias = DIAS_ATRAS[i % DIAS_ATRAS.length];
            const estado = ESTADOS[i % ESTADOS.length];
            const f = new Date(Date.now() - dias * DIAS);
            await db.query(
                `INSERT INTO reparaciones
                 (cliente_nombre, cliente_telefono, direccion, tipo_cobertura, equipo,
                  falla_declarada, diagnostico_tecnico, notas_servicio, repuestos_usados,
                  repuestos_detalle, costo_mano_obra, costo_repuestos, total, estado,
                  fecha_inicio, fecha_modificacion)
                 VALUES (?,?,?,'Fuera de Garantia',?,?,?,?,?,'[]',15000,30000,45000,?,?,?)`,
                [`${MARCA} ${i + 1}`, `11-2222-${String(i + 1).padStart(4, '0')}`, `Calle Sintetica ${i + 1}`,
                 `Equipo ${i + 1}`, `Falla ${i + 1}`, `Trabajo ${i + 1}`, `Notas ${i + 1}`,
                 `Repuesto ${i + 1}`, estado, f, f]
            );
            creado++;
        }
        console.log(`insertadas ${creado} (ya habia ${antes[0].n})`);
    } else {
        console.log('comando desconocido:', que);
        process.exit(1);
    }

    const [total] = await db.query('SELECT COUNT(*) AS n FROM reparaciones');
    console.log(`total de ordenes en la base: ${total[0].n}`);
    await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });