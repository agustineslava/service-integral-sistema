#!/usr/bin/env node
/* ==========================================================================
 * MUTAR `schema/base.sql` Y VER QUE `ver-base-esquema.js` SE DA CUENTA
 *
 *   node tools/mutar-base-esquema.js
 *
 * PARA QUE EXISTE ESTE ARCHIVO
 *
 * Un verificador que dice "OK" no prueba que mire. Este le mete la pata a
 * `base.sql` seis veces, de seis maneras distintas, y exige que las seis
 * fallar. Si alguna pasa, el verificador esta mirando otra cosa.
 *
 * LO QUE SE ROMPE, Y POR QUE CADA RUEDA TIENE QUE ROMPER DISTINTA COSA
 *
 *   1. una columna que sobra        -> la base nueva tiene de mas
 *   2. una columna que falta        -> la base nueva tiene de menos
 *   3. un tipo de columna distinto  -> mismo nombre, otra cosa
 *   4. una tabla de migracion       -> la migracion se saltea y no hace nada
 *   5. un INSERT                    -> cada empresa nace con datos ajenos
 *   6. `altas.js` apuntando al dump -> la base nueva trae todo hecho
 *
 * La 4 y la 6 son las que importan de verdad, porque son las dos formas en que
 * este archivo puede volver a mentir sin que se note: una migracion que se dice
 * aplicada y no hizo nada, y una base de empresa nueva que nace con el estado
 * final en vez de con el estado base.
 *
 * CUIDADO CON EL RESTAURAR
 *
 * Este script EDITA UN ARCHIVO DEL REPO. Si se corta a la mitad, `base.sql` se
 * queda mutado y el proximo alta de empresa nace con una base rota. Por eso:
 *   - saca una copia antes de tocar nada,
 *   - restaura en un `finally`, que corre pase lo que pase,
 *   - y al final compara el archivo con la copia, byte por byte, y avisa si no
 *     quedaron iguales.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const BASE = path.join(RAIZ, 'schema', 'base.sql');
const ALTA = path.join(RAIZ, 'src', 'servicios', 'altas.js');
const COPIA = path.join(RAIZ, 'scratch', 'base.sql.para-restaurar');

const ORIGINAL_BASE = fs.readFileSync(BASE, 'utf8');
const ORIGINAL_ALTA = fs.readFileSync(ALTA, 'utf8');

/* ==========================================================================
   1. LAS MUTACIONES
   ========================================================================== */

const mutaciones = [
    {
        nombre: 'una columna que sobra en clientes',
        archivo: BASE,
        de: '  `email` varchar(150) NULL,\n  `notas` text NULL,',
        a: '  `email` varchar(150) NULL,\n  `notas` text NULL,\n  `telefono_alternativo` varchar(50) NULL,',
        porQue: 'la base de empresa nueva tendria una tabla que el taller no tiene'
    },
    {
        nombre: 'una columna que falta en reparaciones',
        archivo: BASE,
        // Se borra la linea COMPLETA de `estado`, con su tipo y su coma. No se
        // puede buscar el tipo en el patron: `estado` es un `enum`, no un
        // `varchar`, y un patron escrito para varchar no encuentra nada y la
        // mutacion queda sin aplicar en silencio.
        //
        // Al borrar esa linea el CREATE sigue siendo valido: la de antes
        // termina en coma y la de despues (`stock_descontado`) tambien. O sea,
        // que el SQL entra bien y la diferencia aparece en la comparacion de
        // columnas, que es lo que se quiere probar.
        de: /^ {2}`estado` enum\([^\n]*\n/m,
        a: '',
        porQue: 'la base de empresa nueva tendria una tabla con una columna menos'
    },
    {
        nombre: 'un tipo de columna distinto en productos',
        archivo: BASE,
        de: /(`precio`\s+)decimal\(10,2\)/,
        a: '$1decimal(12,4)',
        porQue: 'la columna existe con el mismo nombre pero no es la misma'
    },
    {
        nombre: 'base.sql trae una tabla que crea una migracion',
        archivo: BASE,
        // Se le pega la tabla de presupuestos al final. Con esto, la 004 ve
        // `IF NOT EXISTS` y dice que se aplico sin hacer nada.
        de: 'SET FOREIGN_KEY_CHECKS=1;',
        a: [
            'CREATE TABLE `secuencias` (',
            '  `nombre` varchar(50) NOT NULL,',
            '  `siguiente` int NOT NULL DEFAULT 1,',
            '  PRIMARY KEY (`nombre`)',
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
            '',
            'SET FOREIGN_KEY_CHECKS=1;'
        ].join('\n'),
        porQue: 'las migraciones 004/005/006 dejarian de hacer nada en una base nueva'
    },
    {
        nombre: 'base.sql trae datos',
        archivo: BASE,
        de: 'SET FOREIGN_KEY_CHECKS=1;',
        a: [
            "INSERT INTO `secuencias` (`nombre`, `siguiente`) VALUES ('factura', 500);",
            '',
            'SET FOREIGN_KEY_CHECKS=1;'
        ].join('\n'),
        porQue: 'cada empresa nueva naceria con los datos de la empresa de al lado'
    },
    {
        nombre: 'altas.js vuelve a apuntar al dump del estado final',
        archivo: ALTA,
        de: "path.join(__dirname, '..', '..', 'schema', 'base.sql')",
        a: "path.join(__dirname, '..', '..', 'schema', 'schema-actual.sql')",
        porQue: 'es como estaba antes: el alta salia bien por el dump y las migraciones eran letra muerta'
    }
];

/* ==========================================================================
   2. EL CORREDOR
   ========================================================================== */

const originales = { [BASE]: ORIGINAL_BASE, [ALTA]: ORIGINAL_ALTA };

function restaurarTodo() {
    for (const [archivo, texto] of Object.entries(originales)) {
        if (fs.readFileSync(archivo, 'utf8') !== texto) fs.writeFileSync(archivo, texto, 'utf8');
    }
}

function correr() {
    // `execFileSync` tira si el proceso sale con codigo distinto de cero, y acá
    // un FALLO del verificador ES lo que se espera. Por eso se captura el error
    // y se mira el `status` de ahi.
    try {
        const salida = execFileSync('node', [path.join(__dirname, 'ver-base-esquema.js')], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return { codigo: 0, salida };
    } catch (err) {
        return {
            codigo: err.status === undefined ? -1 : err.status,
            salida: String(err.stdout || '') + String(err.stderr || '')
        };
    }
}

/* En las mutaciones que tiran error de sintaxis el verificador muere antes de
   imprimir el resumen. Eso CUENTA como fallo, pero hay que distinguirlo de un
   fallo de verdad para no creer que el chequeo miró algo que no miró.

   EL ANCLAJE NO PUEDE SER SOLO LA PALABRA "FALLO"
   La primera version usaba `/FALLO/` sobre toda la salida, y eso hace que el
   verificador que PASA mal detectado: el resumen de abajo dice
   "20 OK / 0 FALLO", y ese cero de FALLO es la palabra buscada. Como el
   ancla no estaba, la corrida de control "(sin mutar) el verificador ya
   falla" salio FALLO con el verificador en verde, y todas las mutaciones
   quedaban sin referencia.

   Por eso el patron exige la FORMA de una linea de check: dos espacios, la
   palabra, y despues un espacio y el titulo. El resumen no la tiene. */
const LINEA_DE_CHECK = /^ {2}FALLO (?=\S)/m;
const LINEA_DE_ERROR = /^ERROR /m;

const falloDeVerificador = (r) => LINEA_DE_CHECK.test(r.salida);
const falloDeScript = (r) => !falloDeVerificador(r) && LINEA_DE_ERROR.test(r.salida);

/* "Mal_parseo" es el nombre del check. Se busca la palabra que MySQL usa en
   ingles, porque es lo que devuelve el servidor, y tambien la forma de los
   mensajes de mysql2. Con que aparezca CUALQUIERA de las dos el verificador no
   llego a comparar nada. */
const pasoDeGallego = (r) => /ERROR 1064|ER_PARSE_ERROR|syntax/i.test(r.salida);

console.log('='.repeat(78));
console.log('  MUTAR base.sql  ->  ver-base-esquema.js tiene que DARSE CUENTA');
console.log('='.repeat(78));
console.log('');
console.log(`  ${mutaciones.length} mutaciones. Cada una tiene que hacer fallar el verificador.`);
console.log('  Si alguna pasa, el verificador no esta mirando lo que dice mirar.');
console.log('');
console.log('  Salida de las mutaciones que tiran SQL mal formado (coma colgando) se');
console.log('  cuenta aparte: el script muere antes de poder comparar. Sigue siendo un');
console.log('  fallo, pero no es el fallo que se esta buscando.');

let ok = 0;
let fallos = 0;
const detalle = [];

try {
    // Una pasada SIN mutar, de control. Si el verificador ya falla solo, todo lo
    // de abajo no dice nada y hay que saberlo antes de empezar.
    console.log('');
    console.log('  --- control, sin mutar ---');
    const control = correr();
    const controlBien = control.codigo === 0 && !falloDeVerificador(control);
    if (controlBien) {
        ok++;
        console.log('  OK    el verificador pasa SIN mutaciones (punto de partida limpio)');
    } else {
        fallos++;
        console.log(`  FALLO el verificador ya falla sin mutar (codigo ${control.codigo})`);
        console.log('        Arreglar esto antes de sacar conclusiones sobre las mutaciones.');
        detalle.push('control');
    }

    for (let i = 0; i < mutaciones.length; i++) {
        const m = mutaciones[i];
        const numero = String(i + 1).padStart(2, '0');

        console.log('');
        console.log(`  --- ${numero}/${mutaciones.length}  ${m.nombre} ---`);

        // Se parte del original, no del archivo de la vuelta anterior. Si una
        // vuelta anterior dejo el archivo distinto, arrancar de ahi acumularia
        // errores.
        restaurarTodo();

        const texto = fs.readFileSync(m.archivo, 'utf8');
        const hay = typeof m.de === 'string' ? texto.includes(m.de) : m.de.test(texto);

        if (!hay) {
            fallos++;
            console.log(`  FALLO la mutacion no se pudo aplicar: no encontre el texto a cambiar`);
            console.log(`        en ${path.basename(m.archivo)}`);
            detalle.push(`${m.nombre} (no se aplico)`);
            continue;
        }

        const antes = texto;
        const despues = typeof m.de === 'string'
            ? texto.replace(m.de, m.a)
            : texto.replace(m.de, m.a);
        if (despues === antes) {
            fallos++;
            console.log('  FALLO la mutacion no cambio nada');
            detalle.push(`${m.nombre} (no cambio)`);
            continue;
        }
        fs.writeFileSync(m.archivo, despues, 'utf8');

        const r = correr();

        if (falloDeVerificador(r)) {
            ok++;
            // Se muestra el FALLO concreto: es la prueba de que fallo por la
            // razon que creamos y no por otra cosa.
            const linea = (r.salida.split('\n').find((l) => /FALLO/.test(l)) || '').trim();
            console.log(`  OK    el verificador lavio: ${linea}`);
            console.log(`        (por que muerde: ${m.porQue})`);
        } else if (pasoDeGallego(r)) {
            // Cuenta como ok, pero NO igual: no se quedo callado, reviento.
            ok++;
            console.log('  OK*   el verificador reviento por SQL mal formado, sin comparar');
            console.log('        (cuenta como fallo, pero no es el chequeo de esquema)');
            detalle.push(`${m.nombre} (FALLO por SQL, no por el chequeo)`);
        } else if (falloDeScript(r)) {
            ok++;
            console.log('  OK    el verificador salio con error (no comparo)');
            detalle.push(`${m.nombre} (error de script)`);
        } else if (r.codigo !== 0) {
            ok++;
            console.log(`  OK    el verificador salio con codigo ${r.codigo}`);
            detalle.push(`${m.nombre} (codigo ${r.codigo})`);
        } else {
            fallos++;
            console.log('  FALLO el verificador PASO con el archivo roto. No miró lo que dice mirar.');
            detalle.push(`${m.nombre} (PASO, deberia haber fallado)`);
        }

        restaurarTodo();
    }
} finally {
    restaurarTodo();
}

console.log('');
console.log('='.repeat(78));
console.log(`  ${ok} OK / ${fallos} FALLO`);
console.log('='.repeat(78));

console.log('');
console.log('  --- el repo quedo como estaba? ---');
let sucio = false;
for (const [archivo, texto] of Object.entries(originales)) {
    const ahora = fs.readFileSync(archivo, 'utf8');
    const igual = ahora === texto;
    if (!igual) sucio = true;
    console.log(`  ${igual ? 'OK   ' : 'FALLO'} ${path.relative(RAIZ, archivo)} ${igual ? 'intacto' : 'CAMBIO'}`);
}

// Se escribe la copia y se lee: si el `finally` de arriba fallara justo aca, el
// aviso tiene que verse igual. Es una comprobacion del aviso, no del archivo.
fs.writeFileSync(COPIA, ORIGINAL_BASE, 'utf8');
const releida = fs.readFileSync(COPIA, 'utf8');
console.log(`  ${releida === ORIGINAL_BASE ? 'OK   ' : 'FALLO'} hay copia de base.sql para restaurar a mano si hace falta`);
fs.unlinkSync(COPIA);

if (detalle.length) {
    console.log('');
    console.log('  --- notas ---');
    detalle.forEach((d) => console.log(`  . ${d}`));
}

if (fallos === 0 && !sucio) {
    console.log('');
    console.log('Las seis formas de romper base.sql hacen fallar el verificador, y el');
    console.log('repo quedo exactamente como estaba.');
    process.exit(0);
}
process.exit(1);