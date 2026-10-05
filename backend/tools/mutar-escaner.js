#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

function abrir(rel) {
    const p = path.join(RAIZ, rel);
    const original = fs.readFileSync(p, 'utf8');
    return { p, original };
}

function escribir(rel, contenido) {
    const p = path.join(RAIZ, rel);
    fs.writeFileSync(p, contenido);
}

function aLf(s) { return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function finDeLineaDe(s) { return /\r\n/.test(s) ? '\r\n' : (/\r/.test(s) ? '\r' : '\n'); }

function reemplazar(rel, viejo, nuevo, todos = false) {
    const { p, original } = abrir(rel);
    const eol = finDeLineaDe(original);
    const norm = aLf(original);
    const v = aLf(viejo);
    if (!norm.includes(v)) {
        throw new Error(`no contiene: ${viejo}`);
    }
    const salida = todos ? norm.split(v).join(aLf(nuevo)) : norm.replace(v, aLf(nuevo));
    escribir(rel, salida.replace(/\n/g, eol));
}

const mutaciones = [
    {
        nombre: 'el HTML deja de cargar jsQR local',
        hacer() { reemplazar('frontend/escaner.html', 'vendor/jsqr.min.js', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'); },
        espera: 'HTML carga jsQR local'
    },
    {
        nombre: 'se quita el uso de getUserMedia',
        hacer() { reemplazar('frontend/escaner.js', 'navigator.mediaDevices.getUserMedia', 'null'); },
        espera: 'JS usa getUserMedia'
    },
    {
        nombre: 'se quita la priorización de cámara trasera',
        hacer() { reemplazar('frontend/escaner.js', "facingMode: { ideal: 'environment' }", "facingMode: 'user'"); },
        espera: 'JS prioriza cámara trasera'
    },
    {
        nombre: 'se quita la lectura por imagen',
        hacer() { reemplazar('frontend/escaner.js', 'leerImagenDesdeArchivo', 'leerImagenDesdeArchivoNO'); },
        espera: 'JS permite subir foto'
    },
    {
        nombre: 'se quita la detención de cámara al procesar',
        hacer() { reemplazar('frontend/escaner.js', 'detenerCamara();\n        establecerEstado', 'establecerEstado'); },
        espera: 'JS detiene cámara al procesar'
    },
    {
        nombre: 'se quita la mención de solo personal',
        hacer() { reemplazar('frontend/escaner.html', 'solo para personal con login', 'escáner qr'); },
        espera: 'HTML menciona que es solo para personal'
    },
    {
        nombre: 'aparecen rutas públicas',
        hacer() { reemplazar('frontend/escaner.js', 'procesarCodigo(limpio);', "procesarCodigo(limpio); fetch('/public/qr');"); },
        espera: 'JS no hace llamadas a rutas públicas'
    },
    {
        nombre: 'hay dos active en el menú',
        hacer() { reemplazar('frontend/escaner.html', 'class="active"', 'class="active" class="active"', true); },
        espera: 'Exactamente un class="active"'
    }
];

const { spawnSync } = require('child_process');
let detectadas = 0;
let fallidas = 0;

function restaurar() {
    spawnSync('git', ['restore', 'frontend/escaner.html', 'frontend/escaner.css', 'frontend/escaner.js'], { cwd: RAIZ, stdio: 'ignore' });
}

restaurar();

mutaciones.forEach((m, i) => {
    try {
        m.hacer();
    } catch (e) {
        console.log(`  MAL  ${m.nombre}: no se pudo aplicar`);
        fallidas++;
        restaurar();
        return;
    }
    const r = spawnSync('node', ['tools/ver-escaner.js'], { cwd: path.join(RAIZ, 'backend'), stdio: 'pipe' });
    const out = (r.stdout + r.stderr).toString();
    const fallo = /FALLO/.test(out) && out.includes(m.espera);
    const paso = r.status !== 0 && fallo;
    if (paso) {
        detectadas++;
        console.log(`  BIEN ${i + 1}/${mutaciones.length}  ${m.nombre}`);
    } else {
        console.log(`  MAL  ${m.nombre}: el verificador NO detectó el error`);
        fallidas++;
    }
    restaurar();
});

console.log(`\n  ${detectadas}/${mutaciones.length} mutaciones detectadas`);
if (fallidas > 0 || detectadas !== mutaciones.length) {
    process.exit(1);
}
process.exit(0);