/*
 * Prueba manual del login, en el navegador de verdad.
 *
 * El objetivo es ver las tres pantallas:
 *   1. login en blanco        -> NO debe decir "Service Integral" en ningun lado
 *   2. email de empresa       -> aparece el nombre y el color de ESA empresa
 *   3. email de SuperAdmin    -> se queda en blanco, sin decir nada
 *
 * El caso 3 es el que estaba roto: antes decia "Email no registrado".
 */
const path = require('path');
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });

const CASOS = [
    { etiqueta: 'sin escribir nada',      email: '',                            debe: 'neutral' },
    { etiqueta: 'email de la empresa',    email: 'admin@serviceintegral.com',   debe: 'marca'   },
    { etiqueta: 'email del SuperAdmin',   email: 'aguseslava11@gmail.com',      debe: 'silencio'},
    { etiqueta: 'email inexistente',      email: 'nadie@ejemplo.com',            debe: 'silencio'},
    { etiqueta: 'texto sin @',            email: 'esto no es un mail',           debe: 'silencio'}
];

(async () => {
    const { chromium } = require('playwright');
    const navegador = await chromium.launch();

    for (const caso of CASOS) {
        const ctx = await navegador.newContext();
        const pag = await ctx.newPage();

        await pag.goto('http://127.0.0.1:3000/login.html', { waitUntil: 'networkidle' });

        if (caso.email) {
            await pag.fill('#email', caso.email);
            await pag.click('#password');      // saca el foco = dispara el blur
            await pag.waitForTimeout(900);
        }

        const visto = await pag.evaluate(() => ({
            titulo:   document.querySelector('.login-titulo')?.textContent.trim(),
            subtitulo: document.querySelector('.login-subtitulo')?.textContent.trim(),
            aviso:    document.getElementById('mensaje-info')?.textContent.trim(),
            error:    document.getElementById('mensaje-error')?.textContent.trim(),
            color:    getComputedStyle(document.documentElement).getPropertyValue('--si-blue-vibrant').trim(),
            hayLogo:  (() => { const l = document.querySelector('.login-logo'); return l ? !l.hidden : null; })(),
            pagina:   document.title
        }));

        const marcaServiceIntegral = /service\s*integral/i.test(
            [visto.titulo, visto.subtitulo, visto.aviso, visto.error, visto.pagina].join(' | ')
        );

        console.log(`\n[${caso.etiqueta}]`);
        console.log(`   titulo    : ${visto.titulo}`);
        console.log(`   aviso     : ${visto.aviso || '(ninguno)'}`);
        console.log(`   error     : ${visto.error || '(ninguno)'}`);
        console.log(`   color     : ${visto.color}`);
        console.log(`   logo      : ${visto.hayLogo ? 'visible' : 'oculto'}`);

        let falla = false;
        if (caso.debe === 'neutral') {
            if (marcaServiceIntegral) { console.log('   FALLO: muestra el nombre de Service Integral sin escribir nada'); falla = true; }
            else console.log('   OK: pantalla neutral');
        }
        if (caso.debe === 'marca') {
            if (!marcaServiceIntegral) { console.log('   FALLO: no muestra el nombre de la empresa'); falla = true; }
            else console.log('   OK: muestra la empresa del correo');
        }
        if (caso.debe === 'silencio') {
            if (marcaServiceIntegral) { console.log('   AVISO: nombra Service Integral'); }
            if (visto.aviso || visto.error) { console.log(`   FALLO: contesta "${visto.aviso || visto.error}"`); falla = true; }
            else console.log('   OK: no dice nada (ni error ni aviso)');
        }

        await pag.screenshot({ path: path.join(__dirname, `..`, `scratch-login-${CASOS.indexOf(caso)}.png`) });
        await ctx.close();
    }

    await navegador.close();
})();