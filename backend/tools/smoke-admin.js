/**
 * Comprobacion rapida de los tres arreglos de esta tanda.
 * No es el verificador completo (ese es f5b-verificar.js): esto solo mira que
 * las rutas nuevas respondan y rechacen lo que tienen que rechazar.
 *
 * La clave del SuperAdmin NO esta escrita aca a proposito. Va en
 * CLAVE_SUPERADMIN, que se lee de una variable de entorno o de un archivo
 * `.env` local (gitignored). Razon: esta herramienta entra de verdad al panel,
 * asi que la clave queda expuesta en el historial de git si esta en el fuente.
 * Ademas la clave se cambia (la rota el usuario o el propio smoke al probar el
 * cambio de clave), y si queda fija en el archivo el smoke se rompe solo.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = 'http://127.0.0.1:3000';
const EMAIL = process.env.SMOKE_EMAIL_SUPERADMIN || 'aguseslava11@gmail.com';
const CLAVE = process.env.CLAVE_SUPERADMIN;

if (!CLAVE) {
  console.error('Falta la variable de entorno CLAVE_SUPERADMIN.');
  console.error('Ejemplo:  $env:CLAVE_SUPERADMIN = "tu-clave";  node tools\\smoke-admin.js');
  process.exit(2);
}

let ok = 0, fallo = 0;
const p = (t) => console.log(`\n--- ${t} ---`);

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (token) cab.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: cab,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  let datos = null;
  try { datos = await r.json(); } catch { datos = {}; }
  return { status: r.status, datos };
}

function ok_(cond, txt, extra = '') {
  if (cond) { ok++; console.log(`  [OK]    ${txt}`); }
  else { fallo++; console.log(`  [FALLO] ${txt}${extra ? '  -> ' + extra : ''}`); }
}

(async () => {
  p('Login');
  const l = await pedir('POST', '/api/login', { cuerpo: { email: EMAIL, password: CLAVE } });
  ok_(l.status === 200, 'el SuperAdmin entra', `HTTP ${l.status}`);
  if (l.status !== 200) { console.log(JSON.stringify(l.datos)); return; }
  const tok = l.datos.token;
  console.log(`  rol=${l.datos.usuario.rol}`);

  // ---------------------------------------------------------------- clave
  p('POST /api/admin/yo/clave');
  let r = await pedir('POST', '/api/admin/yo/clave', { cuerpo: {} });
  ok_(r.status === 401, 'sin token: 401', `HTTP ${r.status}`);

  r = await pedir('POST', '/api/admin/yo/clave', { token: tok, cuerpo: { passwordActual: 'Falsa', passwordNueva: 'NuevaClave123' } });
  ok_(r.status >= 400, 'clave actual incorrecta: rechaza', `HTTP ${r.status}`);

  r = await pedir('POST', '/api/admin/yo/clave', { token: tok, cuerpo: { passwordActual: CLAVE, passwordNueva: 'Abc123' } });
  ok_(r.status === 400, 'clave de 6 caracteres: 400', `HTTP ${r.status}`);

  r = await pedir('POST', '/api/admin/yo/clave', { token: tok, cuerpo: { passwordActual: CLAVE, passwordNueva: CLAVE } });
  ok_(r.status === 400, 'clave nueva igual a la actual: 400', `HTTP ${r.status}`);

  r = await pedir('POST', '/api/admin/yo/clave', { token: tok, cuerpo: {} });
  ok_(r.status === 400, 'sin cuerpo: 400', `HTTP ${r.status}`);

  // ------------------------------------------------------- editar empresa
  p('PATCH /api/admin/empresas/1 (datos y marca)');
  // Cada caso dice que se ESPERA del servidor:
  //   200  -> lo acepta
  //   400  -> lo rechaza (dato invalido)
  //   200  -> lo acepta pero NO lo cambia (campo protegido)
  // Los tres terminan en 200 menos el segundo, asi que el numero solo no
  // alcanza: para el caso protegido hay que mirar el mensaje.
  const campos = [
    ['telefono',        '+54 11 4321-9999',      'acepta', null],
    ['email_contacto',  'nuevo@serviceintegral.com', 'acepta', null],
    ['direccion',       'Calle Falsa 123',       'acepta', null],
    ['cuit',            '30-12345678-9',         'acepta', null],
    ['subtitulo',       'Mantenimiento integral', 'acepta', null],
    ['color_primario',  '#1A7FBC',              'acepta y pasa a minuscula', null],
    ['color_secundario','#ffc600',              'acepta', null],
    ['rubro',           'CERRAJERIA',           'acepta y pasa a minuscula', null],
    ['nombre',          'Service Integral',     'acepta', null],
    ['nombre',          '',                     'rechaza', 'no puede quedar vacio'],
    ['email_contacto',  'esto-no-es-un-email',  'rechaza', 'email invalido'],
    ['color_primario',  'azul',                 'rechaza', 'color invalido'],
    ['color_primario',  '#12345',               'rechaza', 'color incompleto'],
    ['logo_url',        'no-es-una-url',        'rechaza', 'logo sin http'],
    ['logo_url',        'https://x.com/m.svg',  'rechaza', 'svg rechazado'],
    ['logo_url',        'https://x.com/m.png',  'acepta', null],
    ['telefono',        'x'.repeat(60),         'rechaza', 'excede el maximo'],
    ['nombre_db',       'otra_base_cualquiera', 'ignora',  'nombre_db esta protegido'],
    ['slug',            'otro-slug',            'ignora',  'slug esta protegido']
  ];

  for (const [campo, valor, espera, nota] of campos) {
    const res = await pedir('PATCH', '/api/admin/empresas/1', { token: tok, cuerpo: { [campo]: valor } });
    const etiq = `${campo} = ${JSON.stringify(valor).slice(0, 30)}`;
    const bruto = `HTTP ${res.status} ${JSON.stringify(res.datos).slice(0, 70)}`;

    if (espera === 'rechaza') {
      ok_(res.status === 400, `${etiq}  -> 400 (${nota})`, bruto);
    } else if (espera === 'ignora') {
      // Acepta el request pero no toca nada: es el comportamiento pedido, y
      // el mensaje del servidor lo dice ("No habia nada que cambiar").
      ok_(
        res.status === 200 && /nada que cambiar/i.test(res.datos.mensaje || ''),
        `${etiq}  -> 200 sin tocar nada (${nota})`, bruto
      );
    } else {
      ok_(res.status === 200, `${etiq}  -> 200`, bruto);
    }
  }

  p('Lo que se guardo de verdad');
  const det = await pedir('GET', '/api/admin/empresas/1', { token: tok });
  const e = det.datos.empresa;
  const debe = {
    telefono: '+54 11 4321-9999',
    email_contacto: 'nuevo@serviceintegral.com',
    cuit: '30-12345678-9',
    color_primario: '#1a7fbc',
    color_secundario: '#ffc600',
    logo_url: 'https://x.com/m.png'
  };
  for (const [k, v] of Object.entries(debe)) ok_(e[k] === v, `${k} quedo en ${JSON.stringify(e[k])}`, `esperado ${JSON.stringify(v)}`);
  ok_(e.rubro === 'cerrajeria', 'rubro quedo en minuscula: ' + JSON.stringify(e.rubro));
  ok_(e.nombre_db === 'serviceintegralsistema', 'nombre_db intacto: ' + e.nombre_db);
  ok_(e.slug === 'service-integral', 'slug intacto: ' + e.slug);

  p('Vacio se guarda como NULL, no como cadena');
  await pedir('PATCH', '/api/admin/empresas/1', { token: tok, cuerpo: { cuit: '', telefono: '' } });
  const det2 = await pedir('GET', '/api/admin/empresas/1', { token: tok });
  ok_(det2.datos.empresa.cuit === null, 'cuit = NULL', 'quedo en ' + JSON.stringify(det2.datos.empresa.cuit));
  ok_(det2.datos.empresa.telefono === null, 'telefono = NULL', 'quedo en ' + JSON.stringify(det2.datos.empresa.telefono));

  // Restaurar
  await pedir('PATCH', '/api/admin/empresas/1', { token: tok, cuerpo: {
    telefono: '011 15 5555 1234', email_contacto: 'info@serviceintegral.com',
    direccion: 'Av. Corrientes 1234, CABA', cuit: '30-12345678-9',
    subtitulo: 'Service Integral · Mantenimiento',
    color_primario: '#009fe3', color_secundario: '#ffc600',
    logo_url: null, rubro: 'taller'
  } });
  const det3 = await pedir('GET', '/api/admin/empresas/1', { token: tok });
  console.log(`  restaurado: rubro=${det3.datos.empresa.rubro} telefono=${det3.datos.empresa.telefono}`);

  console.log(`\nRESULTADO: ${ok} ok, ${fallo} fallo(s)`);
  process.exit(fallo ? 1 : 0);
})();
