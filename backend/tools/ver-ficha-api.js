/* Comprueba si la ficha de cliente trae ordenes en cualquier estado.
   Salida: una linea por cliente. */
const { execFileSync } = require('child_process');
const path = require('path');

const salida = execFileSync(process.execPath, [path.join(__dirname, 'generate-token.js'), 'admin@serviceintegral.com'], { encoding: 'utf8' });
const token = salida.split('Token:')[1].split('Uso:')[0].trim();

(async () => {
    for (const id of [1, 2, 3, 4]) {
        const r = await fetch(`http://127.0.0.1:3000/api/clientes/${id}/reparaciones`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const d = await r.json();
        console.log(`cliente ${id} -> HTTP ${r.status}, ${d.length} orden(es): ${d.map(x => '#' + x.id + '/' + x.estado).join(', ') || 'NINGUNA'}`);
    }
})();