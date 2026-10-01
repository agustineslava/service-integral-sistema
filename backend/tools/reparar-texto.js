/*
 * Repara un texto que quedo con caracteres rotos.
 *
 * Que paso: al escribir un archivo desde una herramienta, un fragmento de
 * texto quedo mezclado con caracteres de otro idioma. Quedo guardado asi en el
 * repositorio y en cada lectura se ve el `??` en lugar de la palabra.
 *
 * Que NO hace: no "adivina" ni reescribe el archivo entero. Solo reemplaza
 * cadenas exactas que estan rotas, y avisa si encuentra algo que no conoce, en
 * vez de seguir y dejar un archivo a medio camino.
 */
const fs = require('fs');

const archivo = process.argv[2];
if (!archivo) {
    console.error('Uso: node tools/reparar-texto.js <archivo>');
    process.exit(1);
}

const REGLAS = [
    ['* empresa?? el usuario entrar.', '* empresa con el mismo correo este operativa.']
];

let texto = fs.readFileSync(archivo, 'utf8');
const antes = texto;
const aplicadas = [];

for (const [viejo, nuevo] of REGLAS) {
    while (texto.includes(viejo)) {
        texto = texto.replace(viejo, nuevo);
        aplicadas.push(viejo);
    }
}

// Aviso de cualquier resto: caracteres fuera del rango latino habitual.
const sospechosos = texto.match(/[\uFFFD\u0080-\u009F]|[\u0400-\u04FF]|[\u4e00-\u9fff]/g) || [];

if (texto === antes) {
    console.log('  Sin cambios.');
} else {
    fs.writeFileSync(archivo, texto, 'utf8');
    console.log(`  Aplicadas ${aplicadas.length} correccion(es).`);
}

if (sospechosos.length) {
    console.log(`  QUEDAN ${sospechosos.length} caracter(es sospechosos: ${[...new Set(sospechosos)].join(' ')}`);
    process.exit(1);
}
console.log('  Sin caracteres sospechosos.');