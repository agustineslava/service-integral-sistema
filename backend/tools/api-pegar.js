/* Sonda rapida contra la API: imprime lo que devuelve una ruta.
   Uso: node tools/api-pegar.js <ruta> [email]
   Ej.: node tools/api-pegar.js /api/clientes/2/reparaciones            */
const { execFileSync } = require('child_process');
const path = require('path');

const ruta = process.argv[2];
const email = process.argv[3] || 'admin@serviceintegral.com';

const salida = execFileSync(process.execPath, [path.join(__dirname, 'generate-token.js'), email], { encoding: 'utf8' });
const token = salida.split('Token:')[1].split('Uso:')[0].trim();

(async () => {
    const r = await fetch(`http://127.0.0.1:3000${ruta}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const texto = await r.text();
    console.log(`HTTP ${r.status}`);
    try {
        console.log(JSON.stringify(JSON.parse(texto), null, 1));
    } catch {
        console.log(texto.slice(0, 500));
    }
})();