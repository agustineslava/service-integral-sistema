/*
 * Migra los botones de la pagina de Presupuestos al sistema de diseño que ya
 * usan las demás páginas.
 *
 * Que pasaba: presupuestos.html y presupuestos.js usaban `btn-primario`,
 * `btn-secundario` y `btn-peligro`. Ninguna de las tres existe en style.css ni
 * en reparaciones.css, así que esos botones salían como texto pelado, sin fondo
 * ni forma. Por eso la página se veía distinta de todas las demás.
 *
 * Que se hace: se mapean a las clases que el resto del sistema ya usa.
 *   btn-primario   -> btn btn-crear      (la principal)
 *   btn-secundario -> btn btn-secundario (agregada en style.css)
 *   btn-peligro    -> btn btn-eliminar   (la destructiva)
 *
 * Es un reemplazo de texto literal y acotado a esos archivos: no toca clases
 * que sí existen ni ninguna otra pagina.
 */
const fs = require('fs');

const REGLAS = [
    ['class="btn-primario"',   'class="btn btn-crear"'],
    ['class="btn-secundario"', 'class="btn btn-secundario"'],
    ['class="btn-peligro"',    'class="btn btn-eliminar"']
];

let total = 0;

const path = require('path');

for (const nombre of ['presupuestos.html', 'presupuestos.js']) {
    // El script vive en backend/tools, y las paginas en frontend/.
    const archivo = path.join(__dirname, '..', '..', 'frontend', nombre);
    let texto = fs.readFileSync(archivo, 'utf8');
    let n = 0;

    for (const [viejo, nuevo] of REGLAS) {
        const partes = texto.split(viejo);
        n += partes.length - 1;
        texto = partes.join(nuevo);
    }

    fs.writeFileSync(archivo, texto, 'utf8');
    console.log(`  ${nombre}: ${n} boton(es) migrados`);
    total += n;
}

console.log(`  Total: ${total}`);