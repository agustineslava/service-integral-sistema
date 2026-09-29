/**
 * PRUEBA DE HUMO DEL ESQUEMA CENTRAL
 *
 *   npm run esquema:test
 *
 * Crea una base DESCARTABLE (si_tenant_test_esquema), le aplica las
 * migraciones centrales, comprueba que todo quedo como debe, y la borra.
 * Nunca toca si_central ni la base del taller.
 *
 * Por que existe: el esquema central tiene reglas que no se ven a simple
 * vista (CHECK de nombre_db, CHECK de SUPERADMIN sin empresa, claves
 * foraneas, cascadas). Si una de esas reglas se rompe, el sintoma aparece
 * semanas despues con datos cruzados. Esto lo detecta en 2 segundos.
 *
 * Por que puede correr sin root: si_tenant_admin ya tiene permiso para
 * crear y borrar bases que empiecen con si_tenant_.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const { conectarAdmin } = require('../src/db/conexiones');
const migraciones = require('../src/db/migrations');

const BASE_PRUEBA = 'si_tenant_test_esquema';

// ---------------------------------------------------------------------------
// Mini framework de comprobaciones
// ---------------------------------------------------------------------------
const resultados = [];

function comprobar(descripcion, condicion, detalle = '') {
    const ok = Boolean(condicion);
    resultados.push({ ok, descripcion });
    console.log(`  ${ok ? '[OK]   ' : '[FALLO]'} ${descripcion}${!ok && detalle ? `  -> ${detalle}` : ''}`);
    return ok;
}

async function comprobarQueFalla(descripcion, fn, codigoEsperado = null) {
    try {
        await fn();
        resultados.push({ ok: false, descripcion });
        console.log(`  [FALLO] ${descripcion}  -> NO fallo (deberia haber fallado)`);
        return false;
    } catch (e) {
        const codigoOk = !codigoEsperado || e.code === codigoEsperado;
        resultados.push({ ok: codigoOk, descripcion });
        console.log(`  ${codigoOk ? '[OK]   ' : '[FALLO]'} ${descripcion}  -> rechazado (${e.code || e.message})`);
        return codigoOk;
    }
}

// ---------------------------------------------------------------------------
(async () => {
    console.log('='.repeat(70));
    console.log(' PRUEBA DE HUMO DEL ESQUEMA CENTRAL');
    console.log('='.repeat(70));
    console.log(` Base descartable: ${BASE_PRUEBA}`);
    console.log('='.repeat(70));

    const admin = await conectarAdmin(); // sin base seleccionada

    try {
        // -------------------------------------------------------------------
        console.log('\n--- Preparando base descartable ---');
        await admin.query(`DROP DATABASE IF EXISTS \`${BASE_PRUEBA}\``);
        await admin.query(
            `CREATE DATABASE \`${BASE_PRUEBA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
        console.log(`  [OK]    creada`);

        // -------------------------------------------------------------------
        console.log('\n--- 1. Aplicando migraciones centrales ---');
        const db = await conectarAdmin(BASE_PRUEBA);

        try {
            const r1 = await migraciones.aplicar(db, 'central', {
                log: (s) => console.log('  ' + s.trim())
            });
            comprobar('se aplicaron las 2 migraciones centrales', r1.aplicadas === 2, `aplicadas=${r1.aplicadas}`);

            // ---------------------------------------------------------------
            console.log('\n--- 2. Tablas creadas ---');
            const esperadas = [
                'auditoria', 'empresa_metricas', 'empresa_modulos', 'empresas',
                'modulos', 'planes', 'usuarios_globales', '_schema_migrations'
            ];
            const [filasTablas] = await db.query(
                `SELECT TABLE_NAME AS t FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
                [BASE_PRUEBA]
            );
            const presentes = filasTablas.map((f) => f.t);

            for (const t of esperadas) {
                comprobar(`existe la tabla ${t}`, presentes.includes(t));
            }
            comprobar(
                'no hay tablas de mas',
                presentes.length === esperadas.length,
                `encontradas: ${presentes.join(', ')}`
            );

            // Todas InnoDB y utf8mb4
            const [motores] = await db.query(
                `SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c
                 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
                [BASE_PRUEBA]
            );
            const noInnodb = motores.filter((m) => m.e !== 'InnoDB').map((m) => m.t);
            comprobar('todas las tablas son InnoDB', noInnodb.length === 0, noInnodb.join(', '));

            const noUtf8 = motores.filter((m) => !String(m.c).startsWith('utf8mb4')).map((m) => m.t);
            comprobar('todas las tablas son utf8mb4', noUtf8.length === 0, noUtf8.join(', '));

            // ---------------------------------------------------------------
            console.log('\n--- 3. Catalogos cargados ---');
            const [[m]] = await db.query('SELECT COUNT(*) AS n FROM modulos');
            comprobar('hay 8 modulos en el catalogo', m.n === 8, `n=${m.n}`);

            const [repFilas] = await db.query(
                "SELECT es_base FROM modulos WHERE codigo = 'reparaciones'"
            );
            comprobar('reparaciones es un modulo base', repFilas[0] && repFilas[0].es_base === 1);

            const [planes] = await db.query('SELECT codigo, max_usuarios FROM planes ORDER BY orden');
            comprobar('hay 3 planes', planes.length === 3, `n=${planes.length}`);
            const basico = planes.find((p) => p.codigo === 'basico');
            const ilimitado = planes.find((p) => p.codigo === 'ilimitado');
            comprobar('el plan basico permite 3 usuarios', basico && basico.max_usuarios === 3,
                `max_usuarios=${basico && basico.max_usuarios}`);
            comprobar('el plan ilimitado no tiene tope (NULL)', ilimitado && ilimitado.max_usuarios === null,
                `max_usuarios=${ilimitado && ilimitado.max_usuarios}`);

            // ---------------------------------------------------------------
            console.log('\n--- 4. Reglas de integridad ---');

            // nombre_db: la ultima red contra inyeccion via nombre de base
            const nombresMalos = [
                ['con backtick', 'mal`nombre'],
                ['con punto y coma', 'base; DROP DATABASE empresas'],
                ['con mayusculas', 'BaseMala'],
                ['con guion', 'base-mala'],
                ['con espacio', 'base mala'],
                ['vacio', '']
            ];
            for (const [etiqueta, valor] of nombresMalos) {
                await comprobarQueFalla(
                    `nombre_db rechaza ${etiqueta}`,
                    () => db.query(
                        `INSERT INTO empresas (nombre, slug, nombre_db) VALUES ('X', ?, ?)`,
                        ['x-' + Math.random().toString(36).slice(2), valor]
                    ),
                    'ER_CHECK_CONSTRAINT_VIOLATED'
                );
            }

            // slug: sera el subdominio, asi que minusculas y sin guiones sueltos
            const slugsMalos = [
                ['con mayusculas', 'Taller'],
                ['con guion al principio', '-taller'],
                ['con guion al final', 'taller-'],
                ['con espacio', 'mi taller'],
                ['con acento', 'tallér']
            ];
            for (const [etiqueta, valor] of slugsMalos) {
                await comprobarQueFalla(
                    `slug rechaza ${etiqueta}`,
                    () => db.query(
                        `INSERT INTO empresas (nombre, slug, nombre_db) VALUES ('X', ?, ?)`,
                        [valor, 'si_tenant_' + Math.random().toString(36).slice(2, 10)]
                    ),
                    'ER_CHECK_CONSTRAINT_VIOLATED'
                );
            }

            // color mal formado
            await comprobarQueFalla(
                'color_primario rechaza un valor que no es #RRGGBB',
                () => db.query(
                    `INSERT INTO empresas (nombre, slug, nombre_db, color_primario)
                     VALUES ('X', ?, ?, 'rojo')`,
                    ['x-' + Math.random().toString(36).slice(2), 'si_tenant_x_' + Math.random().toString(36).slice(2, 8)]
                ),
                'ER_CHECK_CONSTRAINT_VIOLATED'
            );

            // Ahora una empresa valida
            const [insEmp] = await db.query(
                `INSERT INTO empresas (nombre, slug, nombre_db, rubro, plan, estado, color_primario)
                 VALUES ('Taller de Prueba', 'taller-prueba', 'si_tenant_prueba', 'taller', 'basico', 'ACTIVO', '#1a73e8')`
            );
            const empresaId = insEmp.insertId;
            comprobar('se puede insertar una empresa valida', empresaId > 0);

            // El estado por defecto tiene que ser DEMO: una empresa recien
            // creada no puede quedar operativa sin que alguien la active.
            const [insDemo] = await db.query(
                `INSERT INTO empresas (nombre, slug, nombre_db) VALUES ('Demo SA', 'demo-sa', 'si_tenant_demo')`
            );
            const [demoFilas] = await db.query('SELECT estado FROM empresas WHERE id = ?', [insDemo.insertId]);
            comprobar('una empresa nueva arranca en DEMO', demoFilas[0].estado === 'DEMO',
                `estado=${demoFilas[0].estado}`);
            await db.query('DELETE FROM empresas WHERE id = ?', [insDemo.insertId]);

            // SUPERADMIN sin empresa
            const [insSuper] = await db.query(
                `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
                 VALUES (NULL, 'super@prueba.com', 'x', 'Super', 'SUPERADMIN')`
            );
            comprobar('se puede crear un SUPERADMIN sin empresa', insSuper.insertId > 0);

            // Un usuario NO superadmin sin empresa debe ser rechazado
            await comprobarQueFalla(
                'un usuario comun sin empresa es rechazado',
                () => db.query(
                    `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
                     VALUES (NULL, 'sine@prueba.com', 'x', 'Sin Empresa', 'TECNICO')`
                ),
                'ER_CHECK_CONSTRAINT_VIOLATED'
            );

            // FK: empresa inexistente
            await comprobarQueFalla(
                'no se puede crear un usuario de una empresa inexistente',
                () => db.query(
                    `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
                     VALUES (999999, 'fantasma@prueba.com', 'x', 'Fantasma', 'ADMIN')`
                ),
                'ER_NO_REFERENCED_ROW_2'
            );

            // Email unico, e insensible a mayusculas (utf8mb4_0900_ai_ci)
            await db.query(
                `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
                 VALUES (?, 'juan@prueba.com', 'x', 'Juan', 'ADMIN')`,
                [empresaId]
            );
            await comprobarQueFalla(
                'el mismo email en MAYUSCULAS es rechazado (unicidad global)',
                () => db.query(
                    `INSERT INTO usuarios_globales (empresa_id, email, password_hash, nombre, rol)
                     VALUES (?, 'JUAN@PRUEBA.COM', 'x', 'Otro Juan', 'TECNICO')`,
                    [empresaId]
                ),
                'ER_DUP_ENTRY'
            );

            // slug unico
            await comprobarQueFalla(
                'no se puede repetir el slug',
                () => db.query(
                    `INSERT INTO empresas (nombre, slug, nombre_db)
                     VALUES ('Otra', 'taller-prueba', 'si_tenant_otra')`
                ),
                'ER_DUP_ENTRY'
            );

            // empresa_modulos: modulo inexistente
            await comprobarQueFalla(
                'no se puede contratar un modulo inexistente',
                () => db.query(
                    `INSERT INTO empresa_modulos (empresa_id, modulo) VALUES (?, 'modulo_inventado')`,
                    [empresaId]
                ),
                'ER_NO_REFERENCED_ROW_2'
            );

            // empresa_modulos: se puede contratar dos veces el mismo?
            await db.query(
                `INSERT INTO empresa_modulos (empresa_id, modulo, limites)
                 VALUES (?, 'stock', JSON_OBJECT('max_usuarios', 5))`,
                [empresaId]
            );
            await comprobarQueFalla(
                'no se puede contratar dos veces el mismo modulo',
                () => db.query(
                    `INSERT INTO empresa_modulos (empresa_id, modulo) VALUES (?, 'stock')`,
                    [empresaId]
                ),
                'ER_DUP_ENTRY'
            );

            // limites JSON legibles
            const [[lm]] = await db.query(
                `SELECT limites, JSON_EXTRACT(limites, '$.max_usuarios') AS mu
                 FROM empresa_modulos WHERE empresa_id = ? AND modulo = 'stock'`,
                [empresaId]
            );
            comprobar('los limites por empresa se guardan y se leen como JSON', lm.mu === 5, `mu=${lm.mu}`);

            // -----------------------------------------------------------------
            console.log('\n--- 5. Borrado de una empresa (cascada) ---');
            await db.query(`INSERT INTO empresa_metricas (empresa_id, filas_totales) VALUES (?, 10)`, [empresaId]);
            await db.query(`DELETE FROM empresas WHERE id = ?`, [empresaId]);

            const [[u]] = await db.query(
                'SELECT COUNT(*) AS n FROM usuarios_globales WHERE empresa_id = ?', [empresaId]
            );
            const [[em]] = await db.query(
                'SELECT COUNT(*) AS n FROM empresa_modulos WHERE empresa_id = ?', [empresaId]
            );
            const [[met]] = await db.query(
                'SELECT COUNT(*) AS n FROM empresa_metricas WHERE empresa_id = ?', [empresaId]
            );
            const [[sup]] = await db.query(
                "SELECT COUNT(*) AS n FROM usuarios_globales WHERE rol = 'SUPERADMIN'"
            );

            comprobar('al borrar la empresa se borran sus usuarios', u.n === 0, `quedan ${u.n}`);
            comprobar('al borrar la empresa se borran sus modulos', em.n === 0, `quedan ${em.n}`);
            comprobar('al borrar la empresa se borran sus metricas', met.n === 0, `quedan ${met.n}`);
            comprobar('el SUPERADMIN sobrevive (no tiene empresa)', sup.n === 1, `n=${sup.n}`);

            // -----------------------------------------------------------------
            console.log('\n--- 6. El motor no reaplica trabajo ya hecho ---');
            const r2 = await migraciones.aplicar(db, 'central', { log: () => {} });
            comprobar('una segunda corrida no aplica nada', r2.aplicadas === 0, `aplicadas=${r2.aplicadas}`);

            const estado = await migraciones.estado(db, 'central');
            comprobar('las 2 migraciones figuran APLICADAS',
                estado.every((e) => e.estado === migraciones.ESTADOS.APLICADA));

            // -----------------------------------------------------------------
            console.log('\n--- 7. Deteccion de archivos modificados (deriva) ---');
            await db.query(
                `UPDATE \`${migraciones.TABLA_LEDGER}\`
                 SET checksum = REPEAT('0', 64) WHERE version = '001'`
            );
            await comprobarQueFalla(
                'si una migracion ya aplicada cambia, el motor se niega a seguir',
                () => migraciones.aplicar(db, 'central', { log: () => {} })
            );

            // Restaurar para dejar la base coherente antes de borrarla
            const archivos = migraciones.listarArchivos('central');
            for (const a of archivos) {
                await db.query(
                    `UPDATE \`${migraciones.TABLA_LEDGER}\` SET checksum = ? WHERE version = ?`,
                    [a.checksum, a.version]
                );
            }
            const okTrasRestaurar = await migraciones.aplicar(db, 'central', { log: () => {} });
            comprobar('restaurado el checksum, el motor vuelve a aceptar',
                okTrasRestaurar.aplicadas === 0);
        } finally {
            await db.end();
        }
    } finally {
        // -----------------------------------------------------------------
        console.log('\n--- Limpieza ---');
        try {
            await admin.query(`DROP DATABASE IF EXISTS \`${BASE_PRUEBA}\``);
            console.log(`  [OK]    base descartable ${BASE_PRUEBA} borrada`);
        } catch (e) {
            console.log(`  [FALLO] no se pudo borrar ${BASE_PRUEBA}: ${e.message}`);
        }
        await admin.end();
    }

    // ---------------------------------------------------------------------
    const fallos = resultados.filter((r) => !r.ok);
    console.log('\n' + '='.repeat(70));
    if (fallos.length === 0) {
        console.log(` ESQUEMA CENTRAL OK - ${resultados.length} comprobaciones pasaron`);
        console.log('='.repeat(70) + '\n');
    } else {
        console.log(` ESQUEMA CENTRAL CON PROBLEMAS - ${fallos.length} de ${resultados.length} fallaron`);
        for (const f of fallos) console.log(`   - ${f.descripcion}`);
        console.log('='.repeat(70) + '\n');
        process.exit(1);
    }
})().catch((e) => {
    console.error('\nError inesperado:', e.message);
    if (e.sqlMessage) console.error('  SQL:', e.sqlMessage);
    process.exit(1);
});
