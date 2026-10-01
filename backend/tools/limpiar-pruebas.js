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

/*
 * Patrones de empresa de prueba.
 *
 * QUE PASO DE VERDAD (medido, no supuesto)
 * -----------------------------------------------------------------------
 * Al principio sospeche del `%` que faltaba al final: `LIKE 'alta-de-prueba-f5b'`
 * es exacto, y el auto-sufijo del slug produce `-2`, `-3`. Parecia la causa
 * obvia de que el barredor encontrara 1 de cada 5.
 *
 * Se probo, y NO era eso: el patron `alta-%` (que ya tenia el `%`) matchea
 * igual contra `alta-de-prueba-f5b-2` por el `slug`. Quitando el `%` de
 * `alta-de-prueba-f5b`, el barredor SEGUIA encontrando las dos filas.
 *
 * La causa real era el armado del WHERE (ver el comentario de `donde`, mas
 * abajo): los patrones se comparaban contra la columna equivocada, asi que la
 * mayoria de las filas nunca se miraba. Verificado: con el WHERE viejo y sin
 * el chequeo de coherencia, el barredor contestaba "base limpia" con dos
 * empresas de prueba a la vista.
 *
 * Los `%` finales se dejan igual: `LIKE 'x'` exacto es una trampa facil de
 * reintroducir, y para un prefijo de prueba el comodin es lo que uno quiere
 * decir. Pero que quede claro que no fueron el arreglo.
 *
 * CUIDADO con `alta-%` y `slug-%`: son prefijos cortos y una persona podria
 * llamar asi a una empresa de verdad. Por eso se quedan, pero conviene que al
 * borrar una empresa uno mire el nombre en pantalla: la lista se imprime antes
 * de borrar y con `--dry` no se borra nada.
 */
const PATRONES = [
    'alta-de-prueba-f5b%',
    'empresa-de-prueba-f5b%',
    'f5b-prueba%',
    'test-%',
    'slug-%',
    'alta-%',
    'intrusa-%',
    'qr-prueba-%',
    // Residuo de la F5e: el codigo de la etiqueta se prueba con nombres
    // propios que no arrancan con "prueba".
    'etiqueta-de-prueba%'
];

// Se mira `nombre`, `nombre_db` Y `slug`. Con solo nombre y nombre_db, la
// empresa que creo el verificador (nombre "Alta De Prueba F5b", db
// "si_tenant_alta_de_prueba_f5b") se escapaba: ninguno de los dos coincide
// con un patron, porque los patrones estan en guion bajo y con el prefijo
// "si_tenant_". Y `slug` es "alta-de-prueba-f5b", con guiones.
const COLUMNAS = ['nombre', 'nombre_db', 'slug'];

/*
 * UNA CONDICION POR COLUMNA, Y UN PARAMETRO POR (COLUMNA, PATRON)
 * ------------------------------------------------------------------------
 * La version anterior armaba el WHERE asi:
 *
 *     COLUMNAS.map((c) => COLUMNAS.map(() => `LOWER(${c}) LIKE ?`))
 *
 * El map de adentro IGNORABA su propio elemento y usaba el `c` de afuera, asi
 * que de "3 columnas x N patrones" salia "3 columnas x 3", y las nueve
 * condiciones caian todas sobre la misma columna: los patrones 1,2,3 contra
 * `nombre`, los 4,5,6 contra `nombre_db`, y los 7,8,9 contra `slug`.
 *
 * Peor: mandaba 3*N parametros contra 9 placeholders, y MySQL NO avisa. Usa
 * los primeros 9 y descarta el resto en silencio. No hay error de sintaxis ni
 * exception: el barrido "funcionaba" y encontraba una empresa de cada tres por
 * casualidad, segun que patron cayera en el slot del `slug`. Ese fue el unico
 * motivo por el que se encontro algo la primera vez.
 *
 * Ahora se hace al reves: por cada columna, TODOS los patrones, en el mismo
 * orden. Conteo: COLUMNAS.length * PATRONES.length, y el bloque de abajo lo
 * verifica antes de borrar nada.
 */
const donde = COLUMNAS.map((c) => PATRONES.map(() => `LOWER(\`${c}\`) LIKE ?`).join(' OR ')).join('\n                  OR ');

const EMPRESA = `SELECT id, nombre, nombre_db, slug FROM empresas
                  WHERE ${donde}`;

/** Un parametro por (columna, patron), en el MISMO orden que los LIKE. */
const parametros = () => {
    const p = [];
    for (let i = 0; i < COLUMNAS.length; i++) {
        for (const patron of PATRONES) p.push(patron);
    }
    return p;
};

(async () => {
    const seco = process.argv.includes('--dry');

    // Un parametro por (columna, patron), en el mismo orden que los LIKE.
    const params = parametros();

    // Chequeo de coherencia ANTES de tocar nada. Si el WHERE y la lista de
    // parametros no coinciden, el query puede devolver 0 filas sin avisar (que es lo
    // que pasaba antes), y un barrido que no encuentra nada parece que dice
    // "no hay basura" cuando en realidad no miró.
    const placeholders = (EMPRESA.match(/\?/g) || []).length;
    const esperados = COLUMNAS.length * PATRONES.length;
    if (placeholders !== esperados || params.length !== esperados) {
        console.error(
            `  ERROR: el WHERE tiene ${placeholders} placeholders y se mandan `
            + `${params.length} parametros, pero deberian ser ${esperados}. `
            + 'No se borra nada: revisar COLUMNAS y PATRONES.'
        );
        await central.cerrar();
        process.exit(1);
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