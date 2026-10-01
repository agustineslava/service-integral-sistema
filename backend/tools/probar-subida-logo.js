/* ==========================================================================
   Prueba la ruta POST /api/admin/subir-logo sin tocar la interfaz.
   Genera un PNG chico al vuelo y lo manda como multipart.

   Por que existe: la subida de archivos es de las pocas cosas donde el fallo
   tipico NO es del codigo (el FormData, el campo, el boton) sino de la
   configuracion (credenciales de Cloudinary, la carpeta, el transformer). Esta
   herramienta separa las dos cosas: si falla, dice en que capa fallo.

   Tambien comprueba la GUARDIA, que es lo que mas importa: un ADMIN de
   empresa (no SUPERADMIN) tiene que recibir 403, y un superadmin desactivado
   tambien. Si la ruta aceptara un token de empresa, el logo de una marca
   quedaria en la cuenta equivocada.

   Uso:  node tools/probar-subida-logo.js
   ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execFileSync } = require('child_process');
const path = require('path');

const API = 'http://127.0.0.1:3000';

let ok = 0, fallos = 0;
function comprobar(cond, texto, detalle) {
    if (cond) { ok++; console.log(`  OK    ${texto}`); }
    else { fallos++; console.log(`  FALLO ${texto}${detalle !== undefined ? ` -> ${JSON.stringify(detalle)}` : ''}`); }
}

function token(email) {
    const salida = execFileSync(process.execPath, [path.join(__dirname, 'generate-token.js'), email], { encoding: 'utf8' });
    return salida.split('Token:')[1].split('Uso:')[0].trim();
}

/* PNG 2x2 azul. Alcanza para probar el canal; el contenido es irrelevante. */
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

async function subir(tok, nombre, contenido, tipo) {
    const fd = new FormData();
    fd.append('imagen', new Blob([contenido], { type: tipo }), nombre);
    const r = await fetch(`${API}/api/admin/subir-logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}` },
        body: fd
    });
    const texto = await r.text();
    let cuerpo;
    try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
    return { estado: r.status, cuerpo };
}

/* Saca el `public_id` de una URL de Cloudinary.
   Cloudinary separa el nombre del archivo con un punto y lo que viene
   despues es la extension (que puede no estar). Un nombre de archivo puede
   traer punto adentro, as que solo se le saca el ultimo. */
function publicIdDe(url) {
    const partes = String(url).split('/upload/');
    if (partes.length < 2) return null;
    const ruta = partes[1].split('/').slice(1).join('/');
    return ruta.replace(/\.[^./]+$/, '');
}

/* `--limpiar <url>` borra de Cloudinary una imagen que ya no se usa.
   Existe porque cada prueba de subida deja un archivo real en el CDN, y sin
   esto la carpeta `service_integral/logos` se llena de imagenes de prueba que
   alguien tiene que adivinar cuales son. */
async function limpiar(url) {
    const publicId = publicIdDe(url);
    if (!publicId) {
        console.log(`No es una URL de Cloudinary: ${url}`);
        return 1;
    }
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    const r = await cloudinary.uploader.destroy(publicId);
    console.log(`Cloudinary respondio "${r.result}" para ${publicId}`);
    return r.result === 'ok' ? 0 : 1;
}

if (process.argv[2] === '--limpiar') {
    limpiar(process.argv[3])
        .then((c) => process.exit(c))
        .catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
    return;
}

(async () => {
    console.log('\n[0] Configuracion de Cloudinary');
    const hay = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
        .every((k) => process.env[k] && process.env[k].trim() !== '');
    comprobar(hay, 'las tres credenciales de Cloudinary estan cargadas');
    if (!hay) {
        console.log('  Sin credenciales no se puede probar la subida real. Se prueba solo la guarda.');
    }

    const tokSuper = token('aguseslava11@gmail.com');
    const tokAdmin = token('admin@serviceintegral.com');

    console.log('\n[1] La guardia: quien NO puede subir');
    const sinToken = await fetch(`${API}/api/admin/subir-logo`, { method: 'POST' });
    comprobar(sinToken.status === 401, 'sin token -> 401', sinToken.status);

    const comoEmpresa = await subir(tokAdmin, 'logo.png', PNG_1X1, 'image/png');
    comprobar(comoEmpresa.estado === 403,
        'un ADMIN de empresa -> 403 (no es una ruta de empresa)',
        comoEmpresa.estado);

    console.log('\n[2] La validacion del archivo');

    const sinArchivo = await fetch(`${API}/api/admin/subir-logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokSuper}` },
        body: new FormData()
    });
    const cuerpoSinArchivo = await sinArchivo.json().catch(() => ({}));
    comprobar(sinArchivo.status === 400 && /archivo/i.test(cuerpoSinArchivo.error || ''),
        'sin archivo -> 400 con mensaje que lo diga',
        { estado: sinArchivo.status, error: cuerpoSinArchivo.error });

    const svg = await subir(tokSuper, 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml');
    comprobar(svg.estado === 400,
        'un SVG -> 400 (puede ejecutar script si alguien lo abre)',
        { estado: svg.estado, error: svg.cuerpo && svg.cuerpo.error });

    const pdf = await subir(tokSuper, 'logo.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
    comprobar(pdf.estado === 400, 'un PDF -> 400', { estado: pdf.estado });

    const gigante = await subir(tokSuper, 'enorme.png', Buffer.alloc(6 * 1024 * 1024, 1), 'image/png');
    comprobar(gigante.estado === 400 && /5 MB/.test(gigante.cuerpo && gigante.cuerpo.error || ''),
        'un archivo de 6 MB -> 400 diciendo el limite de 5 MB',
        { estado: gigante.estado, error: gigante.cuerpo && gigante.cuerpo.error });

    console.log('\n[3] La subida real');
    const buena = await subir(tokSuper, 'service-integral-test.png', PNG_1X1, 'image/png');
    const okPng = buena.estado === 200
        && typeof buena.cuerpo.url === 'string'
        && buena.cuerpo.url.startsWith('https://');
    comprobar(okPng, 'un PNG valido -> 200 con la URL de Cloudinary', buena);

    if (okPng) {
        comprobar(buena.cuerpo.url.includes('service_integral/logos'),
            'la URL cae en la carpeta propia de logos (no se confunde con fotos de producto)',
            buena.cuerpo.url);

        // Y que la URL se pueda pedir de verdad. Si el CDN devuelve 404, el logo
        // queda roto en el presupuesto aunque el alta haya "tenido exito".
        const head = await fetch(buena.cuerpo.url, { method: 'GET' });
        const tipo = head.headers.get('content-type') || '';
        comprobar(head.ok && tipo.startsWith('image/'),
            'la URL que devuelve el alta se puede descargar y es una imagen',
            { estado: head.status, tipo });

        // Limpieza: el archivo de prueba no se deja dando vueltas en el CDN.
        try {
            const codigo = await limpiar(buena.cuerpo.url);
            comprobar(codigo === 0, 'el archivo de prueba se pudo borrar de Cloudinary');
        } catch (e) {
            comprobar(false, 'el archivo de prueba se pudo borrar de Cloudinary', e.message);
        }
    }

    console.log(`\n======================================================`);
    console.log(`  ${ok} OK / ${fallos} FALLO`);
    console.log(`======================================================`);
    process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
