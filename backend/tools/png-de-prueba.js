/* Escribe un PNG solido de las medidas pedidas, sin dependencias.
   Sirve para probar la subida de logo desde la interfaz sin tener que bajar
   una imagen de la web.

   Uso:  node tools\\png-de-prueba.js <salida.png> [ancho] [alto] "#rrggbb"
*/
const fs = require('fs');
const zlib = require('zlib');

const salida = process.argv[2] || 'logo-prueba.png';
const ancho = parseInt(process.argv[3] || '400', 10);
const alto = parseInt(process.argv[4] || '160', 10);
const hex = (process.argv[5] || '#1a7fbc').replace('#', '');

const r = parseInt(hex.slice(0, 2), 16);
const g = parseInt(hex.slice(2, 4), 16);
const b = parseInt(hex.slice(4, 6), 16);

// Una fila del PNG: un byte de filtro (0 = sin filtro) + un byte por pixel.
function crc32(buf) {
    let c;
    const tabla = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        tabla[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = tabla[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([largo, cuerpo, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(ancho, 0);
ihdr.writeUInt32BE(alto, 4);
ihdr[8] = 8;   // bits por canal
ihdr[9] = 2;   // color RGB sin canal alfa
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// Una franja clara en el medio, para que se note que es una imagen de prueba.
const mitad = Math.floor(alto / 2);
const pixeles = [];
for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 3);
    fila[0] = 0;
    for (let x = 0; x < ancho; x++) {
        const enFranja = y >= mitad - 8 && y < mitad + 8;
        const i = 1 + x * 3;
        fila[i] = enFranja ? 255 : r;
        fila[i + 1] = enFranja ? 255 : g;
        fila[i + 2] = enFranja ? 255 : b;
    }
    pixeles.push(fila);
}

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(Buffer.concat(pixeles))),
    trozo('IEND', Buffer.alloc(0))
]);

fs.writeFileSync(salida, png);
console.log(`${salida}: ${ancho}x${alto}, ${png.length} bytes, color ${hex}`);
