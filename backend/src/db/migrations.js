/* ==========================================================================
   MOTOR DE MIGRACIONES
   --------------------------------------------------------------------------
   Cada cambio de esquema es un archivo .sql numerado. Se aplica una sola vez
   y queda registrado en la tabla `_schema_migrations` de esa base.

   POR QUE EXISTE
   Antes el esquema se creaba a mano en MySQL Workbench. Nadie sabia cual era
   el estado real de la base, y actualizar 50 empresas a mano era impensable.

   GARANTIAS
     1. Cada migracion corre UNA vez por base (lo garantiza la tabla ledger).
     2. Si el archivo de una migracion ya aplicada CAMBIA, esto aborta.
        Sin eso, dos bases terminarian con esquemas distintos y nadie se
        enteraria.
     3. --dry-run muestra que haria sin tocar nada.

   EXPAND-CONTRACT (importante para la flota)
   Una migracion NUNCA debe romper la version anterior del codigo, porque
   mientras se despliega, el codigo viejo y el nuevo conviven.
     BIEN:  agregar columna NULL o con DEFAULT
     BIEN:  crear tabla nueva
     MAL:   renombrar una columna en un solo paso
     MAL:   borrar una columna que el codigo todavia usa
   Para borrar o renombrar: primero se agrega lo nuevo, se despliega, se
   deja de usar lo viejo, y RECIEN ahi una migracion posterior lo elimina.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..', '..');

const DIRECTORIOS = {
    central: path.join(RAIZ, 'migrations', 'central'),
    tenant:  path.join(RAIZ, 'migrations', 'tenant')
};

const TABLA_LEDGER = '_schema_migrations';

const ESTADOS = {
    PENDIENTE:  'PENDIENTE',
    APLICADA:   'APLICADA',
    MODIFICADA: 'MODIFICADA'
};

const checksum = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

/** Lista las migraciones de un directorio, ordenadas por numero de version. */
function listarArchivos(tipo) {
    const dir = DIRECTORIOS[tipo];
    if (!dir) throw new Error(`Tipo de migracion desconocido: ${tipo}`);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
        .filter((f) => /^\d+_.+\.sql$/i.test(f))
        .sort()
        .map((f) => {
            const ruta = path.join(dir, f);
            const sql = fs.readFileSync(ruta, 'utf8');
            const m = f.match(/^(\d+)_/);
            return { version: m[1], nombre: f, ruta, sql, checksum: checksum(sql) };
        });
}

/** Crea la tabla ledger si no existe. Es lo unico fuera del sistema de migraciones. */
async function asegurarLedger(conexion) {
    await conexion.query(`
        CREATE TABLE IF NOT EXISTS \`${TABLA_LEDGER}\` (
            \`version\`     VARCHAR(20)  NOT NULL,
            \`nombre\`      VARCHAR(200) NOT NULL,
            \`checksum\`    CHAR(64)     NOT NULL,
            \`aplicada_en\` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`duracion_ms\` INT UNSIGNED NULL,
            PRIMARY KEY (\`version\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
}

async function leerAplicadas(conexion) {
    const [filas] = await conexion.query(
        `SELECT version, nombre, checksum, aplicada_en FROM \`${TABLA_LEDGER}\` ORDER BY version`
    );
    return filas;
}

/** Estado de cada migracion: PENDIENTE, APLICADA o MODIFICADA. */
async function estado(conexion, tipo) {
    await asegurarLedger(conexion);
    const archivos = listarArchivos(tipo);
    const aplicadas = await leerAplicadas(conexion);
    const porVersion = new Map(aplicadas.map((a) => [String(a.version), a]));

    return archivos.map((a) => {
        const hecha = porVersion.get(a.version);
        let situacion;
        if (!hecha) situacion = ESTADOS.PENDIENTE;
        else if (hecha.checksum !== a.checksum) situacion = ESTADOS.MODIFICADA;
        else situacion = ESTADOS.APLICADA;

        return { ...a, estado: situacion, aplicada_en: hecha ? hecha.aplicada_en : null };
    });
}

/**
 * Aplica las migraciones pendientes.
 * Devuelve { aplicadas, pendientes, omitidas }.
 */
async function aplicar(conexion, tipo, { dryRun = false, log = () => {} } = {}) {
    const items = await estado(conexion, tipo);

    const modificadas = items.filter((i) => i.estado === ESTADOS.MODIFICADA);
    if (modificadas.length) {
        throw new Error(
            'Hay migraciones YA APLICADAS cuyo archivo cambio:\n' +
            modificadas.map((m) => `   - ${m.nombre} (version ${m.version})`).join('\n') +
            '\n\nEso significa que esta base y el repositorio ya no coinciden.\n' +
            'No se aplica nada. Opciones:\n' +
            '   a) recuperar el archivo original, o\n' +
            '   b) crear una migracion NUEVA con el cambio (nunca editar una aplicada).'
        );
    }

    const pendientes = items.filter((i) => i.estado === ESTADOS.PENDIENTE);

    if (!pendientes.length) {
        return { aplicadas: 0, pendientes: [], omitidas: items.length, dryRun };
    }

    if (dryRun) {
        log(`  [SIMULACION] se aplicarian ${pendientes.length} migracion(es):`);
        for (const p of pendientes) {
            log(`    - ${p.nombre}  (${p.sql.length} bytes, checksum ${p.checksum.slice(0, 8)})`);
        }
        return { aplicadas: 0, pendientes: pendientes.map((p) => p.nombre), omitidas: 0, dryRun: true };
    }

    let aplicadas = 0;
    for (const p of pendientes) {
        const t0 = Date.now();
        await conexion.query(p.sql);
        const ms = Date.now() - t0;
        await conexion.query(
            `INSERT INTO \`${TABLA_LEDGER}\` (version, nombre, checksum, duracion_ms) VALUES (?, ?, ?, ?)`,
            [p.version, p.nombre, p.checksum, ms]
        );
        log(`  [OK] ${p.nombre}  (${ms} ms)`);
        aplicadas++;
    }

    return { aplicadas, pendientes: pendientes.map((p) => p.nombre), omitidas: 0, dryRun: false };
}

module.exports = {
    DIRECTORIOS,
    TABLA_LEDGER,
    ESTADOS,
    listarArchivos,
    asegurarLedger,
    leerAplicadas,
    estado,
    aplicar
};
