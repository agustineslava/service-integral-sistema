/*
 * Limpia empresas de prueba que quedaron de corridas del verificador.
 *
 * QUE BORRA Y QUE NO
 * -----------------------------------------------------------------------
 * Solo empresas cuyo nombre y nombre_db coinciden con un patrón de prueba
 * conocido. Si no coincide con ninguno, no se toca: es preferible dejar basura
 * a borrar la empresa de un cliente.
 *
 * Para cada empresa borrada tambien tira su base `si_tenant_*`, que es lo que
 * mas espacio ocupa. Si el DROP de la base falla, NO borra la fila: es mejor
 * que quede una fila huerfana (que se ve y se puede borrar a mano) que una
 * base sin fila (que ocupa espacio sin que nadie sepa que existe).
 *
 * Con --dry no borra nada: solo muestra que habria que borrar.
 *
 * Uso:
 *   node tools/limpiar-pruebas.js --dry
 *   node tools/limpiar-pruebas.js
 */
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const central = require('../src/db/central');
const { conectarAdmin, nombreCentral } = require('../src/db/conexiones');

const PATRONES = [
    'alta-de-prueba-f5b',
    'empresa-de-prueba-f5b',
    'f5b-prueba',
    'test-%',
    'slug-%',
    'alta-%',
    'intrusa-%',
    'qr-prueba-%'
];

// Se mira `nombre`, `nombre_db` Y `slug`. Con solo nombre y nombre_db, la
// empresa que creo el verificador (nombre "Alta De Prueba F5b", db
// "si_tenant_alta_de_prueba_f5b") se escapaba: ninguno de los dos coincide
// con un patron, porque los patrones estan en guion bajo y con el prefijo
// "si_tenant_". Y `slug` es "alta-de-prueba-f5b", con guiones.
const COLUMNAS = ['nombre', 'nombre_db', 'slug'];

const EMPRESA = `SELECT id, nombre, nombre_db, slug FROM empresas
                  WHERE ${COLUMNAS.map((c) => COLUMNAS.map(() => `LOWER(${c}) LIKE ?`).join(' OR ')).join('\n                     OR ')}`;

(async () => {
    const seco = process.argv.includes('--dry');

    // Un parametro por patron POR COLUMNA, en el mismo orden que los LIKE.
    const params = [];
    for (let i = 0; i < COLUMNAS.length; i++) {
        for (const p of PATRONES) params.push(p);
    }

    const candidatas = await central.query(EMPRESA, params);

    if (!candidatas.length) {
        console.log('\n  No hay empresas de prueba. Base limpia.\n');
        await central.cerrar();
        return;
    }

    console.log(`\n  Empresas de prueba encontradas: ${candidatas.length}`);
    for (const e of candidatas) {
        console.log(`    #${e.id}  ${e.nombre}  (db: ${e.nombre_db})`);
    }

    if (seco) {
        console.log('\n  --dry: no se borro nada.\n');
        await central.cerrar();
        return;
    }

    const admin = await conectarAdmin(nombreCentral());
    let borradas = 0, fallidas = 0;

    for (const e of candidatas) {
        try {
            await admin.query(`DROP DATABASE IF EXISTS \`${e.nombre_db}\``);
            await central.query('DELETE FROM usuarios_globales WHERE empresa_id = ?', [e.id]);
            await central.query('DELETE FROM empresas WHERE id = ?', [e.id]);
            console.log(`    borrada: #${e.id} ${e.nombre} y su base ${e.nombre_db}`);
            borradas++;
        } catch (err) {
            console.log(`    NO se pudo borrar #${e.id} (${e.nombre}): ${err.message}`);
            console.log('      Se deja la fila. Revisar manualmente.');
            fallidas++;
        }
    }

    await admin.end();
    await central.cerrar();

    console.log(`\n  Resultado: ${borradas} borrada(s), ${fallidas} sin borrar.\n`);
    process.exit(fallidas ? 1 : 0);
})().catch(async (e) => {
    console.error('  Error:', e.message);
    try { await central.cerrar(); } catch {}
    process.exit(1);
});