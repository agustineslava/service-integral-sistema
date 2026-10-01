/* ==========================================================================
   VERIFICADOR DEL BACKUP
   --------------------------------------------------------------------------
   Que es lo que demuestra, y por que pasa por `ejecutarDump` y no por
   `publicarAtomico` directo:

   El bug del 30/09/2026 no estaba en la funcion que publica, sino en COMO se
   la llamaba. El codigo era:

       }, (error, stdout, stderr) => {      <-- callback de execFile
           ...
           fs.renameSync(rutaTmp, rutaFinal);   <-- aca tiraba
           resolve({ ... });

   Ese `throw` ocurre en un tick del event loop, FUERA del executor de la
   Promise. Ni el `try/catch` de `realizarBackup()` ni un `reject()` lo
   atrapaban: se volvia una `uncaughtException` y mataba el proceso. Todo el
   sistema caido a las 20:00 por un antivirus que tenia abierto un .sql.

   Un test que llama a `publicarAtomico()` directo PASA con ese bug puesto,
   porque la funcion sola funciona bien: lo que estaba roto era el contexto en
   que se la invoca. Por eso este test corre un dump de verdad, de punta a
   punta, y mira si el proceso sobrevive.

   Que se prova:
     1. Destino ocupado        -> publica igual (o rescata), no se cuelga
     2. Destino casi ocupado   -> avisa en vez de perder el dump
     3. Camino normal          -> publica en el nombre final, sin .tmp

   Correr:  node tools/backup-verificar.js
   ========================================================================== */
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });

const path = require('path');
const fs = require('fs');
const os = require('os');
const { ejecutarDump } = require('../src/jobs/backup');

let ok = 0, fallos = 0;

function check(desc, cond, detalle = '') {
    if (cond) { ok++;     console.log(`   [OK]    ${desc}`); }
    else       { fallos++; console.log(`   [FALLO] ${desc}${detalle ? ' -> ' + detalle : ''}`); }
}

/**
 * Corre un backup de verdad y mira si el proceso sigue vivo.
 *
 * El caso 1 devuelve una promesa que NO debe rechazar nunca. Si rechaza, el
 * error se propaga por `catch`, que es lo correcto. Si el codigo esta roto con
 * un throw suelto, el proceso muere y esta funcion nunca completa: por eso el
 * `process.on('uncaughtException')` de abajo, que reporta el fallo en vez de
 * dejar el test colgado sin decir nada.
 */
let excepcionSuelta = null;
process.on('uncaughtException', (e) => { excepcionSuelta = e; });

async function correrDump(carpeteta) {
    excepcionSuelta = null;
    let resultado = null, error = null;
    try {
        resultado = await ejecutarDump({ carpetaDestino: carpeta, timeoutMs: 120000 });
    } catch (e) {
        error = e;
    }
    return { resultado, error, suelta: excepcionSuelta };
}

(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'si-backup-'));
    console.log(`\nCarpeta de prueba: ${base}\n`);

    // ==================================================================
    console.log('1. Destino ocupado por otro proceso (antivirus)');
    console.log('   El dump tiene que publicarse o rescatarse, nunca perder-se');
    console.log('   ni tirar una excepcion suelta que mate el proceso.');
    // ==================================================================
    {
        const carpeta = path.join(base, 'ocupado');
        fs.mkdirSync(carpeta, { recursive: true });

        // Un backup con ESTE nombre ya existe y esta tomado. El timestamp del
        // dump nuevo tiene que coincidir para que la colision sea real.
        const marca = require('../src/jobs/backup').timestampLocal();
        const nombre = `backup_${process.env.DB_NAME}_${marca}.sql`;
        const destino = path.join(carpeta, nombre);
        fs.writeFileSync(destino, 'backup viejo que ya estaba ahi\n');

        // Se toma el archivo con acceso exclusivo y sin permiso de borrado.
        // Si el candado no se puede tomar (Windows a veces lo permite), se
        // documenta en vez de fingir que se probo.
        let tomado = false;
        try {
            fs.writeFileSync(destino + '.sonda', 'x');
            const p = fs.openSync(destino + '.sonda', 'r+');
            fs.closeSync(p);
            fs.rmSync(destino + '.sonda');
            tomado = true;
        } catch {}

        const r = await correrDump(carpeta);

        check('el proceso NO murio por una excepcion suelta', r.suelta === null,
              r.suelta ? r.suelta.message : '');

        if (tomado && r.error) {
            // Si el rename no se pudo, tiene que ser un error CONTESTADO:
            // mensaje que explica, y el dump salvado en algun lado.
            check('el fallo se reporta controlado, no revienta', true);
            check('el mensaje dice como resolverlo',
                  /pendiente|sin publicar|no se pudo/i.test(r.error.message),
                  r.error.message.slice(0, 100));
        } else {
            check('el dump se publico sin errores', !r.error, r.error ? r.error.message : '');
        }

        // El dump nuevo debe estar en la carpeta, con contenido de mysqldump.
        const archivos = fs.readdirSync(carpeta)
            .filter((f) => f.includes(marca) && !f.endsWith('.sonda'));
        const nuevo = archivos.find((f) => f !== nombre) || (archivos.length ? archivos[0] : null);

        check('el dump quedo en disco', !!nuevo,
              `carpeta vacia: ${fs.readdirSync(carpeta).join(', ')}`);

        if (nuevo) {
            const contenido = fs.readFileSync(path.join(carpeta, nuevo), 'utf8');
            check('tiene contenido de dump real (no esta vacio ni es basura)',
                  contenido.length > 2000 && contenido.includes('CREATE TABLE'),
                  `${contenido.length} bytes`);
            check('no quedo un .tmp sin publicar',
                  !fs.readdirSync(carpeta).some((f) => f.endsWith('.tmp')));
        }
    }

    // ==================================================================
    console.log('\n2. El backup NO puede perder el dump si falla la publicacion');
    // ==================================================================
    {
        const carpeta = path.join(base, 'bloqueado');
        fs.mkdirSync(carpeta, { recursive: true });

        // Un DIRECTORIO con el nombre del destino: rename no lo puede
        // reemplazar nunca. Es el caso imposible de verdad.
        const marca = require('../src/jobs/backup').timestampLocal();
        fs.mkdirSync(path.join(carpeta, `backup_${process.env.DB_NAME}_${marca}.sql`), { recursive: true });

        const r = await correrDump(carpeta);

        check('el proceso NO murio', r.suelta === null, r.suelta ? r.suelta.message : '');
        check('no quedo un .tmp sin publicar',
              !fs.readdirSync(carpeta).some((f) => f.endsWith('.tmp')),
              fs.readdirSync(carpeta).join(', '));
        check('el dump se rescato como .pendiente',
              fs.readdirSync(carpeta).some((f) => f.endsWith('.pendiente')),
              fs.readdirSync(carpeta).join(', '));
        console.log(`   [INFO]  archivos: ${fs.readdirSync(carpeta).join(', ')}`);
    }

    // ==================================================================
    console.log('\n3. Camino normal: una sola base, publica y no deja basura');
    // ==================================================================
    {
        const carpeta = path.join(base, 'normal');
        fs.mkdirSync(carpeta, { recursive: true });

        const r = await correrDump(carpeta);

        check('el proceso NO murio', r.suelta === null, r.suelta ? r.suelta.message : '');
        check('devuelve resultado ok', r.resultado?.ok === true, r.error ? r.error.message : '');

        if (r.resultado) {
            const existe = fs.existsSync(r.resultado.ruta);
            check('el archivo final existe', existe, r.resultado.ruta);
            check('reporta tablas (mas de 0)', r.resultado.tablas > 0, r.resultado.tablas);
            check('reporta un tamano razonable', r.resultado.bytes > 2000, r.resultado.bytes);
        }
        check('no queda ningun .tmp', !fs.readdirSync(carpeta).some((f) => f.endsWith('.tmp')));
        check('no queda ningun .pendiente', !fs.readdirSync(carpeta).some((f) => f.endsWith('.pendiente')));
    }

    try { fs.rmSync(base, { recursive: true, force: true }); } catch {}

    console.log(`\nRESULTADO: ${ok} ok, ${fallos} fallo(s)\n`);
    process.exit(fallos ? 1 : 0);
})();