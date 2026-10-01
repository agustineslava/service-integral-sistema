/* ==========================================================================
   VERIFICADOR: orden, busqueda y paginacion de /api/reparaciones
   --------------------------------------------------------------------------
   Por que existe: el orden que ve el usuario vivia en un comparador de
   JavaScript (`filtrarYRenderizarReparaciones`). Al paginar, ese comparador
   se translateo a un ORDER BY en SQL. Este archivo corre las DOS versiones
   sobre el mismo conjunto y falla si devuelven distinta secuencia, que es
   exactamente el modo de falla que importa: no que el orden sea "parecido",
   sino que una orden que estaba en la pagina 1 se mueva a la pagina 3.

   No prueba con los datos reales del taller: son 6 ordenes, casi todas
   'Entregado', y no alcanzan para separar los cinco niveles del orden. Inserta
   un bloque de ordenes sinteticas con TODAS las combinaciones de estado y
   antiguedad, corre la comparacion, y las borra al final (con verificacion de
   que no borro nada ajeno).

   Uso:  node tools/ver-orden-reparaciones.js
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const { execFileSync } = require('child_process');
const path = require('path');

const API = 'http://127.0.0.1:3000';
const MARCA = '__ver_orden__';
const DIAS = 24 * 60 * 60 * 1000;

/* --- el comparador ORIGINAL de reparaciones.js, copiado tal cual --------- */
function comparadorOriginal(ahora) {
    const catorceDiasMs = 14 * DIAS;
    return (a, b) => {
        const aEsCerrado = (a.estado === 'Entregado' || a.estado === 'Cancelado');
        const bEsCerrado = (b.estado === 'Entregado' || b.estado === 'Cancelado');

        if (!aEsCerrado && bEsCerrado) return -1;
        if (aEsCerrado && !bEsCerrado) return 1;

        if (aEsCerrado && bEsCerrado) {
            return new Date(b.fecha_inicio) - new Date(a.fecha_inicio);
        }

        const tiempoA = ahora - new Date(a.fecha_inicio).getTime();
        const tiempoB = ahora - new Date(b.fecha_inicio).getTime();

        const aTieneMasDe2Semanas = tiempoA >= catorceDiasMs;
        const bTieneMasDe2Semanas = tiempoB >= catorceDiasMs;

        if (aTieneMasDe2Semanas && !bTieneMasDe2Semanas) return -1;
        if (!aTieneMasDe2Semanas && bTieneMasDe2Semanas) return 1;

        if (a.estado === 'Pendiente' && b.estado !== 'Pendiente') return -1;
        if (a.estado !== 'Pendiente' && b.estado === 'Pendiente') return 1;

        return new Date(a.fecha_inicio) - new Date(b.fecha_inicio);
    };
}

/* --- el filtro ORIGINAL de reparaciones.js, copiado tal cual -------------- */
function filtroOriginal(filas, term, estadoFiltro) {
    return filas.filter(r => {
        const coincideEstado = (estadoFiltro === 'TODOS') || (r.estado === estadoFiltro);
        const coincideTexto = term === '' || (
            (r.cliente_nombre || '').toLowerCase().includes(term) ||
            (r.cliente_telefono || '').toLowerCase().includes(term) ||
            (r.direccion || '').toLowerCase().includes(term) ||
            (r.equipo || '').toLowerCase().includes(term) ||
            (r.falla_declarada || '').toLowerCase().includes(term) ||
            (r.notas_servicio || '').toLowerCase().includes(term) ||
            (r.diagnostico_tecnico || '').toLowerCase().includes(term) ||
            (r.repuestos_usados || '').toLowerCase().includes(term) ||
            String(r.id).includes(term)
        );
        return coincideEstado && coincideTexto;
    });
}

/* --- armamenton ----------------------------------------------------------- */
let ok = 0, fallos = 0;
function comprobar(cond, texto, detalle) {
    if (cond) { ok++; console.log(`  OK    ${texto}`); }
    else { fallos++; console.log(`  FALLO ${texto}${detalle !== undefined ? ` -> ${JSON.stringify(detalle)}` : ''}`); }
}

function token() {
    const salida = execFileSync(process.execPath, [path.join(__dirname, 'generate-token.js'), 'admin@serviceintegral.com'], { encoding: 'utf8' });
    return salida.split('Token:')[1].split('Uso:')[0].trim();
}

let TOK = '';
async function pedir(ruta) {
    const r = await fetch(`${API}${ruta}`, { headers: { Authorization: `Bearer ${TOK}` } });
    const texto = await r.text();
    let cuerpo;
    try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
    return { estado: r.status, cuerpo };
}

/*
 * Las filas sinteticas. Se eligen para que TODAS las reglas del orden queden
 * peleadas entre si:
 *   - activo viejo (>14 dias) contra activo nuevo
 *   - 'Pendiente' contra otros activos de la misma antiguedad
 *   - cerrados contra activos
 *   - dos cerrados con la misma fecha (empate -> desempate por id)
 *   - dos activos viejos con la misma fecha (idem)
 */
const DIAS_ATRAS = [0, 3, 13, 14, 15, 40, 90, 200];
const ESTADOS = ['Pendiente', 'En Reparacion', 'Esperando Repuesto', 'Listo', 'Entregado', 'Cancelado'];

function filasSinteticas() {
    const filas = [];
    let n = 0;
    for (const d of DIAS_ATRAS) {
        for (const e of ESTADOS) {
            n++;
            const f = new Date(Date.now() - d * DIAS);
            filas.push({
                cliente_nombre: `${MARCA} cliente ${n}`,
                cliente_telefono: `11-0000-${String(n).padStart(4, '0')}`,
                direccion: `Calle ${n} 123`,
                equipo: `Equipo ${n}`,
                falla_declarada: `Falla ${n}`,
                notas_servicio: `Notas ${n}`,
                diagnostico_tecnico: `Trabajo ${n}`,
                repuestos_usados: `Repuesto ${n}`,
                costo_mano_obra: 0,
                costo_repuestos: 0,
                total: 0,
                estado: e,
                fecha_inicio: f,
                fecha_modificacion: f
            });
        }
    }
    // Duplicados EXACTOS de fecha y estado, para que el orden dependa del
    // desempate por id. Sin esto el comparador de JavaScript y el ORDER BY
    // pueden diferir sin que se note, porque un empate lo resuelve cualquiera.
    for (const e of ['Pendiente', 'Entregado']) {
        for (let k = 0; k < 3; k++) {
            n++;
            const f = new Date(Date.now() - 20 * DIAS);
            filas.push({
                cliente_nombre: `${MARCA} empate ${e} ${k}`,
                cliente_telefono: `11-1111-${String(n).padStart(4, '0')}`,
                direccion: `Empate ${n}`,
                equipo: `Equipo ${n}`,
                falla_declarada: `Falla ${n}`,
                notas_servicio: `Notas ${n}`,
                diagnostico_tecnico: `Trabajo ${n}`,
                repuestos_usados: `Repuesto ${n}`,
                costo_mano_obra: 0,
                costo_repuestos: 0,
                total: 0,
                estado: e,
                fecha_inicio: f,
                fecha_modificacion: f
            });
        }
    }
    return filas;
}

(async () => {
    TOK = token();
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const insertadas = [];
    try {
        // Limpieza previa por si una corrida anterior quedo a medias.
        const [previas] = await db.query('SELECT id FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);
        if (previas.length) {
            await db.query('DELETE FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);
            console.log(`(limpieza previa: ${previas.length} fila(s) de una corrida anterior)`);
        }

        const filas = filasSinteticas();
        for (const f of filas) {
            const [r] = await db.query(
                `INSERT INTO reparaciones
                 (cliente_nombre, cliente_telefono, direccion, tipo_cobertura, equipo,
                  falla_declarada, diagnostico_tecnico, notas_servicio, repuestos_usados,
                  repuestos_detalle, costo_mano_obra, costo_repuestos, total, estado,
                  fecha_inicio, fecha_modificacion)
                 VALUES (?,?,?,'Fuera de Garantia',?,?,?,?,?,'[]',?,?,?,?,?,?)`,
                [f.cliente_nombre, f.cliente_telefono, f.direccion, f.equipo,
                 f.falla_declarada, f.diagnostico_tecnico, f.notas_servicio, f.repuestos_usados,
                 f.costo_mano_obra, f.costo_repuestos, f.total, f.estado, f.fecha_inicio, f.fecha_modificacion]
            );
            insertadas.push(r.insertId);
        }
        console.log(`\n[1] Se insertaron ${insertadas.length} ordenes sinteticas.\n`);

        /* ================================================================== */
        console.log('[2] El ORDER BY de SQL da la MISMA secuencia que el comparador de JS');

        // Se pide TODO por la API, en paginas de 20, y se concatena. Asi se
        // prueba el paginado de verdad: si el orden se calculara por pagina,
        // la concatenacion sale distinta y esta comparacion lo detecta.
        const porPagina = [];
        for (let p = 1; p <= 40; p++) {
            const r = await pedir(`/api/reparaciones?page=${p}&limit=20&buscar=${encodeURIComponent(MARCA)}`);
            if (r.estado !== 200) { console.log(`  FALLO la pagina ${p} devolvio HTTP ${r.estado}`); fallos++; break; }
            if (!r.cuerpo.reparaciones.length) break;
            porPagina.push(...r.cuerpo.reparaciones);
        }

        const desdeApi = porPagina.map((r) => r.id);
        comprobar(desdeApi.length === insertadas.length,
            `la API devolvio las ${insertadas.length} filas paginando de a 20 (devolvio ${desdeApi.length})`,
            desdeApi.length);

        // El mismo conjunto, ordenado por el comparador viejo.
        //
        // El pre-`sort` por `id DESC` NO es cosmetico: define la regla de
        // desempate. `Array.prototype.sort` de V8 es estable, asi que si se
        // entrega la lista en orden de id ASC, los empates salen en id ASC, que
        // NO es lo que hace el ORDER BY. Al entrega la lista en id DESC y
        // despues aplicar el comparador (estable), los empates quedan en id
        // DESC y la comparacion con la API si es exacta.
        //
        // Antes el desempate era, en la practica, indeterminado: el SELECT que
        // alimentaba al navegador no traia ORDER BY, asi que el plan de MySQL
        // decidia el orden de los empates. Fijarlo es una mejora, no una
        // diferencia que haya que preservar.
        const [todas] = await db.query('SELECT * FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);
        const idsSinteticas = new Set(insertadas);
        const soloSinteticas = todas.filter((r) => idsSinteticas.has(r.id));
        const cmp = comparadorOriginal(Date.now());
        const esperados = soloSinteticas.slice()
            .sort((a, b) => b.id - a.id)
            .sort(cmp)
            .map((r) => r.id);

        const mismo = esperados.length === desdeApi.length && esperados.every((id, i) => id === desdeApi[i]);
        comprobar(mismo, 'la secuencia de la API es identica a la del comparador de JavaScript');

        if (!mismo) {
            for (let i = 0; i < Math.max(esperados.length, desdeApi.length); i++) {
                if (esperados[i] !== desdeApi[i]) {
                    const porId = (id) => soloSinteticas.find((r) => r.id === id);
                    console.log(`        primera diferencia en la posicion ${i}:`);
                    console.log(`          JS   -> #${esperados[i]} ${JSON.stringify(porId(esperados[i]) && { estado: porId(esperados[i]).estado, fecha: porId(esperados[i]).fecha_inicio })}`);
                    console.log(`          SQL  -> #${desdeApi[i]} ${JSON.stringify(porId(desdeApi[i]) && { estado: porId(desdeApi[i]).estado, fecha: porId(desdeApi[i]).fecha_inicio })}`);
                    break;
                }
            }
        }

        // Y que ninguna diferencia, si la hubiera, sea un empate disfrazado:
        // dos filas que el comparador declara equivalentes tienen que llegar en
        // id DESC. Si este chequeo pasara mientras el orden global falla, el
        // fallo de arriba seria el que manda.
        const porId = (id) => soloSinteticas.find((r) => r.id === id);
        let empatesRespetados = true;
        let empatesVistos = 0;
        for (let i = 0; i + 1 < Math.min(esperados.length, desdeApi.length); i++) {
            const a = porId(esperados[i]);
            const b = porId(esperados[i + 1]);
            if (a && b && cmp(a, b) === 0) {
                empatesVistos++;
                if (desdeApi[i] < desdeApi[i + 1]) { empatesRespetados = false; break; }
            }
        }
        comprobar(empatesRespetados && empatesVistos > 0,
            `los empates (${empatesVistos} pares con igual fecha y estado) se rompen con id DESC, de forma estable`);

        // Y el resumen legible de los cinco niveles, para ver que el orden tiene
        // la forma que el taller espera.
        const resumen = soloSinteticas
            .map((r) => ({ ...r, pos: desdeApi.indexOf(r.id) }))
            .sort((a, b) => a.pos - b.pos)
            .map((r) => `${r.estado}/${Math.round((Date.now() - new Date(r.fecha_inicio)) / DIAS)}d`);
        const grupos = [];
        for (const s of resumen) {
            const cerrado = s.startsWith('Entregado') || s.startsWith('Cancelado');
            const viejo = Number(s.split('/')[1].replace('d', '')) >= 14;
            const pendiente = s.startsWith('Pendiente');
            const nivel = cerrado ? 'CERRADO' : (viejo ? 'ACTIVO>14d' : (pendiente ? 'ACTIVO<14d PENDIENTE' : 'ACTIVO<14d'));
            if (grupos[grupos.length - 1] !== nivel) grupos.push(nivel);
        }
        comprobar(grupos.length >= 4 && grupos.indexOf('CERRADO') === grupos.length - 1,
            'los cuatro niveles de prioridad salen en orden y los cerrados al final',
            grupos);

        /* ================================================================== */
        console.log('\n[3] El buscador del servidor encuentra lo mismo que el del navegador');

        const pruebas = [
            ['cliente_nombre', 'cliente 7'],
            ['cliente_telefono', '11-0000-0007'],
            ['direccion', 'Calle 9 123'],
            ['equipo', 'Equipo 12'],
            ['falla_declarada', 'Falla 15'],
            ['notas_servicio', 'Notas 20'],
            ['diagnostico_tecnico', 'Trabajo 25'],
            ['repuestos_usados', 'Repuesto 30'],
            ['id', 'empate']
        ];
        for (const [campo, termino] of pruebas) {
            const r = await pedir(`/api/reparaciones?buscar=${encodeURIComponent(termino)}`);
            const api = r.cuerpo.reparaciones.map((x) => x.id);
            const js = filtroOriginal(soloSinteticas, termino.toLowerCase(), 'TODOS').map((x) => x.id);
            const coincide = api.length === js.length && api.every((id) => js.includes(id));
            comprobar(coincide, `buscar "${termino}" (campo ${campo}) -> mismos ${js.length} resultado(s) que antes`, { api: api.length, js: js.length });
        }

        // El filtro de estado tambien pasa al servidor.
        // El filtro de estado tambien pasa al servidor. Se acota con la MISMA marca
        // que las filas sinteticas: sin ese `buscar`, la API contaria tambien
        // las ordenes reales del taller y el conteo no seria comparable.
        for (const e of ['Pendiente', 'Entregado', 'Listo']) {
            const r = await pedir(`/api/reparaciones?buscar=${encodeURIComponent(MARCA)}&estado=${encodeURIComponent(e)}&limit=200`);
            const todos = r.cuerpo.reparaciones.every((x) => x.estado === e);
            const esperados = filtroOriginal(soloSinteticas, '', e).length;
            comprobar(todos && r.cuerpo.reparaciones.length > 0 && r.cuerpo.total === esperados,
                `filtro estado=${e} -> ${r.cuerpo.total} filas, todas en ese estado (antes: ${esperados})`,
                { api: r.cuerpo.total, js: esperados });
        }

        // Y el filtro tiene que ser combinable con la busqueda y la paginacion.
        const ambas = await pedir(`/api/reparaciones?buscar=${encodeURIComponent(MARCA)}&estado=Pendiente&limit=3&page=2`);
        const esperadasTotales = filtroOriginal(soloSinteticas, '', 'Pendiente').length;
        comprobar(ambas.cuerpo.total === esperadasTotales
            && ambas.cuerpo.reparaciones.every((x) => x.estado === 'Pendiente')
            && ambas.cuerpo.reparaciones.length === 3,
            'buscar + estado + pagina se combinan sin pisarse',
            { total: ambas.cuerpo.total, esperado: esperadasTotales });

        /* ================================================================== */
        console.log('\n[4] La busqueda sigue funcionando sobre TODA la base, no sobre la pagina');

        // Se pide una pagina que NO contiene el resultado y se verifica que el
        // buscador lo encuentra igual. Con la busqueda del navegador esto
        // daria cero: solo miraba las 20 filas que ya estaban en pantalla.
        const r = await pedir(`/api/reparaciones?buscar=${encodeURIComponent('Repuesto 47')}`);
        comprobar(r.cuerpo.reparaciones.length > 0,
            'un texto que esta en la pagina 5 se encuentra desde la pagina 1',
            r.cuerpo.reparaciones.map((x) => x.id));

        /* ================================================================== */
        console.log('\n[5] Las paginas no se pisan ni se repiten');

        const p1 = await pedir('/api/reparaciones?page=1&limit=7');
        const p2 = await pedir('/api/reparaciones?page=2&limit=7');
        const p1bis = await pedir('/api/reparaciones?page=1&limit=7');
        const ids1 = p1.cuerpo.reparaciones.map((x) => x.id);
        const ids2 = p2.cuerpo.reparaciones.map((x) => x.id);
        const ids1bis = p1bis.cuerpo.reparaciones.map((x) => x.id);

        comprobar(ids1.length === 7 && ids2.length === 7, 'cada pagina trae el limite pedido');
        comprobar(ids1.every((id) => !ids2.includes(id)), 'la pagina 1 y la 2 no comparten ninguna fila');
        comprobar(JSON.stringify(ids1) === JSON.stringify(ids1bis),
            'volver a pedir la pagina 1 da exactamente las mismas filas (orden estable)');
        comprobar(p1.cuerpo.total === p2.cuerpo.total && p1.cuerpo.totalPaginas === p2.cuerpo.totalPaginas,
            'el total y el totalPaginas no cambian entre paginas',
            { total: p1.cuerpo.total, paginas: p1.cuerpo.totalPaginas });

        /* ================================================================== */
        console.log('\n[6] Los parametros no pueden hacer trampas');

        const limites = await pedir('/api/reparaciones?limit=999999');
        comprobar(limites.cuerpo.limite === 200 && limites.cuerpo.reparaciones.length <= 200,
            'limit=999999 se recorta al tope de 200', limites.cuerpo.limite);

        const mala = await pedir('/api/reparaciones?page=0');
        comprobar(mala.estado === 400, 'page=0 -> 400', mala.estado);
        const mala2 = await pedir('/api/reparaciones?limit=-5');
        comprobar(mala2.estado === 400, 'limit=-5 -> 400', mala2.estado);
        const mala3 = await pedir('/api/reparaciones?page=dos');
        comprobar(mala3.estado === 400, 'page=dos -> 400', mala3.estado);
        const estadoMalo = await pedir('/api/reparaciones?estado=Inventado');
        comprobar(estadoMalo.estado === 400, 'estado=Inventado -> 400 en vez de una lista vacia sin explicación', estadoMalo.estado);

        // El comodin escrito a mano se busca como texto.
        const comodin = await pedir(`/api/reparaciones?buscar=${encodeURIComponent('%')}`);
        const conComodin = (comodin.cuerpo.reparaciones || []).filter((x) =>
            [x.cliente_nombre, x.equipo, x.falla_declarada].some((v) => (v || '').includes('%'))
        );
        comprobar(comodin.cuerpo.reparaciones.length === conComodin.length && conComodin.length === 0,
            'buscar "%" no devuelve la tabla entera (se escapa el comodin)',
            { devolvio: comodin.cuerpo.reparaciones.length, reales: conComodin.length });

        /* ================================================================== */
        console.log('\n[7] El total no se ve afectado por el limite');

        const conFiltro = await pedir(`/api/reparaciones?buscar=${encodeURIComponent(MARCA)}&limit=5`);
        const sinFiltro = await pedir(`/api/reparaciones?buscar=${encodeURIComponent(MARCA)}&limit=200`);
        comprobar(conFiltro.cuerpo.total === sinFiltro.cuerpo.total && conFiltro.cuerpo.total === insertadas.length,
            'el total cuenta el conjunto completo, no lo que entro en la pagina',
            { conFiltro: conFiltro.cuerpo.total, sinFiltro: sinFiltro.cuerpo.total, insertadas: insertadas.length });

    } finally {
        // Limpieza: SOLO las filas con la marca. Si el DELETE tocara algo mas,
        // el `affectedRows` no cuadra con lo insertado y se avisa.
        const [borradas] = await db.query('DELETE FROM reparaciones WHERE cliente_nombre LIKE ?', [`${MARCA}%`]);
        console.log(`\n[limpieza] borradas ${borradas.affectedRows} fila(s) sinteticas`);
        if (insertadas.length && borradas.affectedRows !== insertadas.length) {
            fallos++;
            console.log(`  FALLO se insertaron ${insertadas.length} y se borraron ${borradas.affectedRows}: reviso la base a mano`);
        }
        await db.end();
    }

    console.log(`\n======================================================`);
    console.log(`  ${ok} OK / ${fallos} FALLO`);
    console.log(`======================================================`);
    process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });