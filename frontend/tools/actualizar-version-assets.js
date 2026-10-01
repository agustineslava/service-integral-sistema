/* ==========================================================================
   VERSIONA LOS ASSETS LOCALES DE TODAS LAS PAGINAS
   --------------------------------------------------------------------------
   QUE PROBLEMA RESUELVE
   ---------------------
   Las hojas de estilo tenían `?v=` pero cada página con un número distinto
   (1.2, 1.3, 1.4) y los <script> locales NO tenían ninguno. Un navegador que
   ya abrió el sistema guarda esos .js en caché y sigue corriendo la versión
   vieja: el código nuevo llega al servidor pero nunca se ejecuta en la máquina
   del cliente. Con estilos desparejados es peor, porque una mitad de la pagina
   usa el diseño nuevo y la otra el viejo.

   El `?v=` es un parameter inventado: el servidor lo ignora, y el navegador lo
   ve como una URL distinta, así que pide el archivo otra vez.

   POR QUE UN SOLO NUMERO PARA TODO
   --------------------------------
   Se usa una sola versión para CSS y JS. Con versiones por archivo hay que
   acordarse de subir la de `style.css` en seis HTML distintos, y basta con
   olvidar uno para que eseijamos la pagina se vea con el diseño anterior. Un
   solo número no se puede olvidar parcialmente: se sube una vez y todas las
   páginas piden todo junto.

   USO
   ---
     node tools/actualizar-version-assets.js 2.0     (fija la versión)
     node tools/actualizar-version-assets.js          (muestra la actual)

   Cada vez que se tocan estilos o scripts y no querés esperar al F5 de cada
   cliente, corré esto.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const CARPETA = path.join(__dirname, '..');
const NUEVA = process.argv[2];

/** Solo los archivos que viven en esta misma carpeta. Ni CDN ni rutas absolutas. */
const esLocal = (url) => /^[a-zA-Z0-9_.-]+\.(css|js)$/.test(url);

function versionDe(html) {
    const m = html.match(/(?:style\.css|auth-check\.js)\?v=([\d.]+)/);
    return m ? m[1] : '(ninguna)';
}

// Quita cualquier `?v=` previo y devuelve la URL limpia.
const sinVersion = (url) => url.replace(/\?v=[\d.]*/, '');

function actualizar(nombreArchivo, nueva) {
    const ruta = path.join(CARPETA, nombreArchivo);
    let html = fs.readFileSync(ruta, 'utf8');
    const antes = html;

    // href="x.css?v=..." y src="x.js?v=..."
    html = html.replace(/(href|src)="([^"?]+)\?v=[\d.]*"/g, (m, attr, url) =>
        esLocal(url) ? `${attr}="${url}?v=${nueva}"` : m
    );

    // Los que no tenían ?v= (todos los <script> locales)
    html = html.replace(/(href|src)="([^"?\s]+)"/g, (m, attr, url) =>
        esLocal(url) ? `${attr}="${url}?v=${nueva}"` : m
    );

    if (html === antes) return null;

    fs.writeFileSync(ruta, html, 'utf8');
    return nombreArchivo;
}

const paginas = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.html'));

if (!NUEVA) {
    console.log('Versiones actuales por pagina:');
    for (const p of paginas) {
        console.log(`  ${p.padEnd(22)} v=${versionDe(fs.readFileSync(path.join(CARPETA, p), 'utf8'))}`);
    }
    console.log('\nPara fijarlas de nuevo: node tools/actualizar-version-assets.js <numero>');
    process.exit(0);
}

if (!/^[\d.]+$/.test(NUEVA)) {
    console.error('La versión tiene que ser un número, por ejemplo 2.0');
    process.exit(1);
}

const tocados = paginas.map((p) => actualizar(p, NUEVA)).filter(Boolean);
console.log(`Version ${NUEVA} aplicada en ${tocados.length} pagina(s):`);
tocados.forEach((p) => console.log(`  ${p}`));

// Comprobacion: si alguna pagina quedo con un asset local sin versionar, avisa.
let sinVersionar = 0;
for (const p of paginas) {
    const html = fs.readFileSync(path.join(CARPETA, p), 'utf8');
    const malos = Array.from(html.matchAll(/(?:href|src)="([^"?]+)"/g))
        .map((m) => m[1])
        .filter((u) => esLocal(u));
    if (malos.length) {
        sinVersionar += malos.length;
        console.log(`  AVISO ${p}: sin ?v= -> ${malos.join(', ')}`);
    }
}
if (sinVersionar === 0) console.log('  Todos los assets locales quedaron versionados.');