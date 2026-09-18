const qrcode = require('qrcode-terminal');

const url = process.argv[2];

if (url) {
    // Genera el código QR compacto directamente en la terminal de Windows
    qrcode.generate(url, { small: true });
} else {
    console.log('No se proporcionó URL para generar QR.');
}