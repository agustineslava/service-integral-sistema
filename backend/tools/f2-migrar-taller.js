#!/usr/bin/env node
/**
 * F2 · ALIAS LEGADO de `importar-empresa`.
 * ---------------------------------------------------------------------------
 *   npm run f2:migrar            (aplica)
 *   npm run f2:migrar:simular    (solo muestra)
 *
 * Se conserva solo por compatibilidad con runbooks y docs. Importa la empresa
 * #1 usando `DB_NAME` como base y el slug fijo `service-integral`, exactamente
 * como antes. El comando nuevo y parametrizable es:
 *
 *   npm run importar-empresa -- --nombre "..." --slug ... --base ...
 *
 * `DB_NAME` es legado: es la base de la empresa #1, NO de la plataforma. Este
 * alias NO modifica el .env, solo avisa.
 */
const { importarEmpresa } = require('./importar-empresa');

importarEmpresa({ legado: true, argv: process.argv.slice(2) }).catch(async (err) => {
    console.error('\nError inesperado:', err.message);
    console.error(err.stack);
    process.exit(1);
});
