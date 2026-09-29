/**
 * F0 - Esquema como FUENTE DE VERDAD en el repositorio.
 *   node tools/dump-schema.js           -> backend/schema/schema-actual.sql
 *
 * El esquema se creaba a mano en MySQL Workbench y no existia versionado.
 * Los backups automaticos truncan y el ultimo completo no tenia 3 de las 7
 * tablas: no habia forma de saber como era la base. Esto lo arregla.
 *
 * Nota: el usuario de la app no tiene CREATE ni LOCK TABLES, asi que se
 * arma el DDL a mano leyendo information_schema. Es lo unico posible sin
 * privilegios de administracion (ver tools/check-grants.js).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const CARPETA = path.join(__dirname, '..', 'schema');
const ARCHIVO = path.join(CARPETA, 'schema-actual.sql');

(async () => {
    if (!fs.existsSync(CARPETA)) fs.mkdirSync(CARPETA, { recursive: true });

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '3306',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const db = process.env.DB_NAME;
    const [[{ v }]] = await conn.query('SELECT VERSION() AS v');

    const [tablas] = await conn.query(
        `SELECT TABLE_NAME AS n, TABLE_COLLATION AS col, ENGINE AS eng
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE'
         ORDER BY TABLE_NAME`, [db]);

    // UPDATE_RULE / DELETE_RULE viven en REFERENTIAL_CONSTRAINTS, no en KEY_COLUMN_USAGE
    const [fks] = await conn.query(
        `SELECT k.CONSTRAINT_NAME AS cn, k.TABLE_NAME AS tn,
                k.COLUMN_NAME AS col, k.REFERENCED_TABLE_NAME AS rt,
                k.REFERENCED_COLUMN_NAME AS rc,
                COALESCE(r.UPDATE_RULE,'NO ACTION') AS ur,
                COALESCE(r.DELETE_RULE,'NO ACTION') AS dr
         FROM information_schema.KEY_COLUMN_USAGE k
         LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
               AND r.CONSTRAINT_NAME   = k.CONSTRAINT_NAME
               AND r.TABLE_NAME         = k.TABLE_NAME
         WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME`, [db]);

    const L = [];
    L.push('-- ===========================================================================');
    L.push(`-- Esquema de: ${db}`);
    L.push(`-- Servidor:   MySQL ${v}`);
    L.push(`-- Generado:   ${new Date().toLocaleString('es-AR')}`);
    L.push('--');
    L.push('-- FUENTE DE VERDAD del esquema. Reemplaza al esquema que se creaba a mano');
    L.push('-- en MySQL Workbench sin versionar.');
    L.push('-- La F2 lo transforma en migraciones incrementales versionadas.');
    L.push('-- ===========================================================================');
    L.push('');
    L.push('SET FOREIGN_KEY_CHECKS=0;');
    L.push('SET NAMES utf8mb4;');
    L.push('');

    for (const t of tablas) {
        // COLUMN_KEY es palabra reservada: va entre backticks
        const [cols] = await conn.query(
            `SELECT COLUMN_NAME AS n, COLUMN_TYPE AS tipo, IS_NULLABLE AS nullable,
                    COLUMN_DEFAULT AS def, EXTRA AS extra, \`COLUMN_KEY\` AS colKey,
                    COLUMN_COMMENT AS com
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`, [db, t.n]);

        const [idx] = await conn.query(
            `SELECT INDEX_NAME AS n, NON_UNIQUE AS nu, SEQ_IN_INDEX AS seq,
                    COLUMN_NAME AS col, INDEX_TYPE AS tipo
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [db, t.n]);

        const [chk] = await conn.query(
            `SELECT CONSTRAINT_NAME AS n, CHECK_CLAUSE AS cl
             FROM information_schema.CHECK_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?`, [db, t.n]).catch(() => [[]]);

        // PRIMARY KEY va dentro del CREATE TABLE, no despues
        const grupos = {};
        for (const i of idx) (grupos[i.n] = grupos[i.n] || []).push(i);
        const gruposPrimaria = grupos['PRIMARY'] || [];

        L.push('-- ---------------------------------------------------------------------------');
        L.push(`-- Tabla: ${t.n}   (${cols.length} columnas, ${Object.keys(grupos).length} indices)`);
        L.push('-- ---------------------------------------------------------------------------');
        L.push(`CREATE TABLE \`${t.n}\` (`);

        const defs = cols.map(c => {
            let d = `  \`${c.n}\` ${c.tipo}`;
            d += c.nullable === 'YES' ? ' NULL' : ' NOT NULL';
            if (c.extra && /auto_increment/i.test(c.extra)) d += ' AUTO_INCREMENT';
            if (c.def !== null && c.def !== undefined && String(c.def) !== 'NULL') {
                const def = String(c.def);
                if (/current_timestamp/i.test(def)) {
                    d += ' DEFAULT CURRENT_TIMESTAMP';           // sin comillas
                } else if (typeof c.def === 'number') {
                    d += ` DEFAULT ${c.def}`;
                } else {
                    d += ` DEFAULT '${def.replace(/'/g, "''")}'`;
                }
            }
            if (c.extra && /on update current_timestamp/i.test(c.extra)) {
                d += ' ON UPDATE CURRENT_TIMESTAMP';
            }
            if (c.com) d += ` COMMENT '${String(c.com).replace(/'/g, "''")}'`;
            return d;
        });

        if (gruposPrimaria.length) {
            defs.push(`  PRIMARY KEY (${gruposPrimaria.map(f => `\`${f.col}\``).join(', ')})`);
        }

        for (const [nombre, filas] of Object.entries(grupos)) {
            if (nombre === 'PRIMARY') continue;
            const colsIdx = filas.map(f => `\`${f.col}\``).join(', ');
            const unico = filas[0].nu === 0;
            defs.push(`  ${unico ? 'UNIQUE KEY' : 'KEY'} \`${nombre}\` (${colsIdx}) USING ${filas[0].tipo || 'BTREE'}`);
        }

        if (chk && chk.length) {
            for (const c of chk) defs.push(`  CONSTRAINT \`${c.n}\` CHECK (${c.cl})`);
        }

        L.push(defs.join(',\n'));
        L.push(`) ENGINE=${t.eng || 'InnoDB'} DEFAULT CHARSET=utf8mb4 COLLATE=${t.col || 'utf8mb4_0900_ai_ci'};`);
        L.push('');

        for (const f of fks.filter(x => x.tn === t.n)) {
            L.push(`ALTER TABLE \`${f.tn}\` ADD CONSTRAINT \`${f.cn}\` FOREIGN KEY (\`${f.col}\`) ` +
                   `REFERENCES \`${f.rt}\` (\`${f.rc}\`) ON UPDATE ${f.ur} ON DELETE ${f.dr};`);
        }
        if (fks.some(x => x.tn === t.n)) L.push('');
    }

    L.push('SET FOREIGN_KEY_CHECKS=1;');
    L.push('');

    fs.writeFileSync(ARCHIVO, L.join('\n'), 'utf8');
    const st = fs.statSync(ARCHIVO);

    console.log('ESQUEMA EXPORTADO');
    console.log(`  Archivo: backend/schema/schema-actual.sql`);
    console.log(`  Tablas:  ${tablas.length}  -> ${tablas.map(t=>t.n).join(', ')}`);
    console.log(`  Tamano:  ${(st.size/1024).toFixed(1)} KB`);
    console.log(`  FKs:     ${fks.length}`);
    console.log('\nFuente de verdad del esquema. Versionalo en git.');

    await conn.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
