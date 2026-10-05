#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

function leer(rel) {
    const p = path.join(RAIZ, rel);
    return fs.readFileSync(p, 'utf8');
}

const html = leer('frontend/escaner.html');
const css = leer('frontend/escaner.css');
const js = leer('frontend/escaner.js');

const fallos = [];
const oks = [];

function check(cond, ok, fallo) {
    if (cond) oks.push(ok);
    else fallos.push(fallo || ok);
}

check(html.includes('data-modulo="escaner"'), 'HTML tiene data-modulo="escaner"');
check(html.includes('escaner.html'), 'HTML enlaza a sí mismo en el menú');
check(html.includes('vendor/jsqr.min.js'), 'HTML carga jsQR local');
check(html.includes('escaner.js?v=2.5'), 'HTML carga escaner.js con versión');
check(html.includes('escaner.css?v=2.5'), 'HTML carga escaner.css con versión');
check(html.includes('solo para personal con login'), 'HTML menciona que es solo para personal');
check(html.includes('btn-encender-camara'), 'Botón encender cámara presente');
check(html.includes('btn-apagar-camara'), 'Botón apagar cámara presente');
check(html.includes('btn-subir-foto'), 'Botón subir foto presente');
check(html.includes('btn-modo-manual'), 'Botón modo manual presente');
check(html.includes('input-foto'), 'Input de archivo presente');
check(html.includes('video-escaner'), 'Elemento video presente');
check(css.length > 0, 'escaner.css no está vacío');
check(css.includes('.escaner-video'), 'CSS tiene estilos de video');
check(css.includes('.escaner-cuadro'), 'CSS tiene cuadro de enfoque');
check(js.includes('getUserMedia'), 'JS usa getUserMedia');
check(js.includes('jsQR'), 'JS usa jsQR');
check(js.includes('environment'), 'JS prioriza cámara trasera (environment)');
check(js.includes('procesarCodigo'), 'JS tiene procesarCodigo');
check(js.includes('detenerCamara'), 'JS tiene detenerCamara');
check(js.includes('leerImagenDesdeArchivo'), 'JS permite subir foto');
check(js.includes('modo manual'), 'JS maneja entrada manual (texto)');
check(js.includes('detenerCamara()'), 'JS detiene cámara al procesar');
check(!js.includes('/public/'), 'JS no hace llamadas a rutas públicas');
check(!html.includes('/public/'), 'HTML no referencia rutas públicas');
const matchesActive = html.match(/class="active"/g);
check(matchesActive && matchesActive.length === 1, 'Exactamente un class="active" en escaner.html');

console.log(`  ${oks.length} OK / ${fallos.length} FALLO`);
if (fallos.length > 0) {
    fallos.forEach((f) => console.log('FALLO ' + f));
    process.exit(1);
}
process.exit(0);