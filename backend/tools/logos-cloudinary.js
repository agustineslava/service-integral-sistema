/* ==========================================================================
   Inventario y limpieza de la carpeta de logos en Cloudinary.

   Por que existe: la subida de un logo puede quedar huerfana. Pasa cuando el
   SuperAdmin elige el archivo y aprieta "Guardar" sin esperar, o cuando sube
   una imagen y despues se arrepiente, o cuando una prueba deja una imagen.
   La imagen queda en el CDN y ninguna empresa la apunta: nadie la ve, nadie la
   borra y ocupa lugar. Sin este listado no hay forma de saber que hay.

   Decide mirando la central, no el nombre del archivo: una imagen se borra
   SOLO si ningun `empresas.logo_url` la referencia. Asi el logo de una empresa
   real no se puede borrar por una confusion.

   Uso:
     node tools/logos-cloudinary.js listar
     node tools/logos-cloudinary.js huerfanas          (solo muestra)
     node tools/logos-cloudinary.js limpiar           (borra las huerfanas)
   ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const CARPETA = 'service_integral/logos';

/* Saca el `public_id` de una URL de Cloudinary.
   Cloudinary separa el nombre del archivo con un punto, y lo que viene
   despues es la extension (que puede ni estar). Un nombre puede traer punto
   adentro, as que solo se le saca el ultimo. */
function publicIdDe(url) {
    const partes = String(url).split('/upload/');
    if (partes.length < 2) return null;
    const ruta = partes[1].split('/').slice(1).join('/');
    return ruta.replace(/\.[^./]+$/, '');
}

function clienteCloudinary() {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    return cloudinary;
}

async function logosEnUso() {
    const mysql = require('mysql2/promise');
    const central = await mysql.createConnection({
        host: process.env.CENTRAL_DB_HOST || process.env.DB_HOST || '127.0.0.1',
        user: process.env.CENTRAL_DB_USER || process.env.DB_USER,
        password: process.env.CENTRAL_DB_PASSWORD || process.env.DB_PASSWORD,
        database: process.env.CENTRAL_DB_NAME || 'si_central'
    });
    // Se pregunta que empresas tienen logo, y no solo que URLs hay: asi el
    // informe dice a quien pertenece cada imagen y no hay que adivinarlo.
    const [filas] = await central.query(
        `SELECT id, nombre, logo_url
           FROM empresas
          WHERE logo_url IS NOT NULL AND logo_url <> ''`
    );
    await central.end();
    return filas;
}

(async () => {
    const accion = process.argv[2] || 'listar';
    const cloudinary = clienteCloudinary();

    const r = await cloudinary.api.resources({
        type: 'upload',
        prefix: CARPETA,
        max_results: 100
    });
    const enCloudinary = r.resources || [];
    const empresas = await logosEnUso();

    console.log(`\nCarpeta ${CARPETA}: ${enCloudinary.length} imagen(es) en Cloudinary.`);
    console.log(`Empresas con logo cargado: ${empresas.length}.\n`);

    const duenio = new Map();
    for (const e of empresas) {
        const pid = publicIdDe(e.logo_url);
        if (pid) duenio.set(pid, `#${e.id} ${e.nombre}`);
    }

    for (const x of enCloudinary) {
        const quien = duenio.get(x.public_id);
        const etiqueta = quien
            ? `EN USO por ${quien}`
            : 'HUERFANA (ninguna empresa la apunta)';
        console.log(
            `  ${etiqueta.padEnd(46)} ${String(Math.round(x.bytes / 1024)).padStart(5)} KB   ${x.public_id}`
        );
    }

    for (const e of empresas) {
        const pid = publicIdDe(e.logo_url);
        const existe = enCloudinary.some((x) => x.public_id === pid);
        if (!existe) {
            console.log(`\n  ATENCION: la empresa #${e.id} ${e.nombre} apunta a una imagen que no esta en ${CARPETA}.`);
            console.log(`    ${e.logo_url}`);
            console.log('    El logo se veria roto en los presupuestos.');
        }
    }

    const huerfanas = enCloudinary.filter((x) => !duenio.has(x.public_id));

    if (accion === 'limpiar') {
        if (huerfanas.length === 0) {
            console.log('\nNo hay huerfanas. Nada que borrar.');
        } else {
            console.log('');
            for (const x of huerfanas) {
                const d = await cloudinary.uploader.destroy(x.public_id);
                console.log(`  borrada (${d.result}): ${x.public_id}`);
            }
        }
    } else if (accion !== 'listar' && accion !== 'huerfanas') {
        console.log(`\nAccion desconocida: ${accion}`);
        console.log('Uso: node tools/logos-cloudinary.js listar | huerfanas | limpiar');
        process.exit(1);
    }

    console.log(`\n${huerfanas.length} huerfana(s).`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });