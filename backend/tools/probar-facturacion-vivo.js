/* Prueba VIVA de las rutas de facturacion contra el servidor de verdad y
   MySQL de verdad.

   Por que existe: el arnes de mutaciones prueba que los CONTROLES tienen
   dientes, no que el codigo funcione. Ya paso en este proyecto: la ruta del
   escaner de etiquetas cumplia todas las reglas, todos los controles daban
   OK, y devolvia 500 en cada consulta porque pedia una columna que la tabla no
   tiene. Aca se prueba el otro lado: que la factura se cree, numere, baje
   stock, lo devuelva, y que NO haga ninguna de esas cosas dos veces.

   Usa un producto temporal con stock conocido, para no depender de lo que haya
   en el deposito ni dejar el stock real de nadie movido. Lo borra al final.

   Uso:  node tools/probar-facturacion-vivo.js   (con el servidor andando)
*/
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3000';
const POOL = require('../src/db/tenant').obtenerPool(process.env.DB_TENANT_NAME || 'serviceintegralsistema');
/* El pool se usa con callbacks y devuelve `(err, results, fields)`. Se envuelve
   para devolver `[results, fields]` como hace mysql2/promise, y que los
   `const [filas] = await q(...)` se lean igual en todo el archivo.

   No se importa `conectarApp` porque este archivo tiene que leer y escribir en
   la base de la empresa 1 por su cuenta: esta prueba es de una sola empresa y
   no va por el contexto de la sesion. */
const q = (sql, vals) => new Promise((res, rej) =>
    POOL.query(sql, vals, (e, r, f) => (e ? rej(e) : res([r, f]))));

/** Todas las filas de un SELECT, sin la envoltura `[filas, campos]`. */
const filas = async (sql, vals) => (await q(sql, vals))[0];

let ok = 0, malas = 0;
const fallos = [];

function check(cond, que, detalle = '') {
    if (cond) { ok++; console.log(`  OK    ${que}`); }
    else {
        malas++;
        fallos.push(`${que}${detalle ? ' :: ' + detalle : ''}`);
        console.log(`  FALLO ${que}`);
        if (detalle) console.log(`        ${detalle}`);
    }
}

function seccion(t) { console.log(`\n${t}\n${'-'.repeat(t.length)}`); }

function token() {
    const salida = execFileSync(process.execPath,
        [path.join(RAIZ, 'tools', 'generate-token.js'), 'admin@serviceintegral.com'],
        { encoding: 'utf8' });
    // El token se busca POR FORMA, no por numero de linea: la salida tiene
    // lineas de ancho variable y copiarlo a mano lo trunca, que da un 401
    // despues de veinte minutos de buscar el problema en otro lado.
    const m = salida.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (!m) throw new Error('no se encontro el token en la salida del generador');
    return m[0];
}

async function pedir(tok, metodo, ruta, cuerpo) {
    const r = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        headers: {
            'Content-Type': 'application/json',
            ...(tok ? { Authorization: `Bearer ${tok}` } : {})
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    });
    let json = null;
    try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, json };
}

const item = (desc, cant, prec, iva = 21, prod = null, desc0 = 0) => ({
    descripcion: desc, cantidad: cant, precio_unitario: prec,
    iva_porcentaje: iva, producto_id: prod, descuento: desc0
});

(async () => {
    const tok = token();
    console.log(`Probando ${BASE} con sesion de ADMIN.\n`);

    // --- Un producto temporal con stock conocido -------------------------
    const NOMBRE_PROD = '__prueba_facturacion__';
    const [rProd] = await q('INSERT INTO productos (nombre, stock, precio) VALUES (?, ?, ?)', [NOMBRE_PROD, 10, 0]);
    const prodId = rProd.insertId;
    console.log(`Producto temporal #${prodId} con 10 unidades.\n`);

    let facturaId = null;
    let numero = null;

    try {
        /* El estado de la correlativa ANTES de que se toque nada.
         *
         * La prueba va sobre una base real, donde la fila `factura` de
         * `secuencias` puede o no existir: si esta prueba nunca corrio, no esta;
         * si ya corrio, esta con el ultimo numero emitido. Por eso el
         * invariante NO es "la fila no existe" —eso solo era verdad la primera
         * vez y hacia fallar la prueba en la segunda corrida, sin que el codigo
         * estuviera mal— sino "el alta no la movio". */
        const secAntes = await filas(
            "SELECT ultimo FROM secuencias WHERE nombre = 'factura'");
        const correlativaAntes = secAntes.length ? Number(secAntes[0].ultimo) : null;

        /* ================================================================ */
        seccion('1. Crear el borrador');
        /* ================================================================ */
        const crear = await pedir(tok, 'POST', '/api/facturas', {
            fecha: '2026-10-02',
            cliente_nombre: 'Cliente de Prueba',
            cliente_doc: '20-12345678-9',
            notas: 'Factura de prueba automatizada',
            items: [
                item('Repuesto de prueba', 2, 1000, 21, prodId),
                item('Mano de obra', 1.5, 2000, 10.5, null)
            ]
        });
        check(crear.status === 201, `crear la factura responde 201 (respondio ${crear.status})`,
            JSON.stringify(crear.json));
        facturaId = crear.json && crear.json.id;

        check(crear.json && crear.json.estado === 'BORRADOR', 'la factura nace como BORRADOR');
        check(crear.json && crear.json.numero === undefined, 'el alta NO devuelve numero todavia');

        // 2 x 1000 + 1.5 x 2000 = 5000. IVA: (2000 x 21%) + (3000 x 10.5%) = 420 + 315 = 735
        const esperadoTotal = 5000 + 735;
        check(Math.abs((crear.json && crear.json.total) - esperadoTotal) < 0.005,
            `el total es ${esperadoTotal} (2x1000 + 1.5x2000, con IVA mixto)`, `vino ${crear.json && crear.json.total}`);

        /* ================================================================ */
        seccion('2. El numero sale al EMITIR, no al crear');
        /* ================================================================ */
        const [fAntes] = await q('SELECT numero, estado FROM facturas WHERE id = ?', [facturaId]);
        check(fAntes[0].numero === null,
            'el borrador guardado tiene el numero en NULL',
            `numero = ${JSON.stringify(fAntes[0].numero)}`);
        check(fAntes[0].estado === 'BORRADOR', 'el borrador guardado esta en BORRADOR');

        const secDespues = await filas(
            "SELECT ultimo FROM secuencias WHERE nombre = 'factura'");
        const correlativaDespues = secDespues.length ? Number(secDespues[0].ultimo) : null;
        check(correlativaAntes === correlativaDespues,
            'el alta NO toco la correlativa de facturas (crear no gasta numero)',
            `antes ${correlativaAntes}, despues ${correlativaDespues}`);

        /* ================================================================ */
        seccion('3. Lo que NO se puede hacer todavia');
        /* ================================================================ */
        const anularBorrador = await pedir(tok, 'POST', `/api/facturas/${facturaId}/anular`, {});
        check(anularBorrador.status === 400, 'anular un borrador se rechaza con 400',
            `respondio ${anularBorrador.status}`);

        const pagarBorrador = await pedir(tok, 'POST', `/api/facturas/${facturaId}/pagar`, {});
        check(pagarBorrador.status === 400, 'marcar como pagada un borrador se rechaza con 400',
            `respondio ${pagarBorrador.status}`);

        const sinSesion = await pedir(null, 'GET', '/api/facturas');
        check(sinSesion.status === 401, 'sin sesion la lista responde 401',
            `respondio ${sinSesion.status}: ${JSON.stringify(sinSesion.json)}`);

        /* ================================================================ */
        seccion('4. Validaciones antes de que exista una factura');
        /* ================================================================ */
        const ivaMal = await pedir(tok, 'POST', '/api/facturas', {
            cliente_nombre: 'X', items: [item('Renglon', 1, 100, 21.5)]
        });
        check(ivaMal.status === 400, 'una alicuota de 21.5% se rechaza con 400',
            `respondio ${ivaMal.status}`);

        const sinIva = await pedir(tok, 'POST', '/api/facturas', {
            cliente_nombre: 'X', items: [{ descripcion: 'R', cantidad: 1, precio_unitario: 100 }]
        });
        check(sinIva.status === 400, 'un renglon sin IVA se rechaza con 400',
            'no se puede emitir una factura con el IVA sin definir: seria una factura con el IVA callado');

        const descuentoMayor = await pedir(tok, 'POST', '/api/facturas', {
            cliente_nombre: 'X', items: [item('R', 1, 100, 21, null, 500)]
        });
        check(descuentoMayor.status === 400, 'un descuento mayor que el renglon se rechaza con 400');

        const fechaImposible = await pedir(tok, 'POST', '/api/facturas', {
            fecha: '2026-02-31', cliente_nombre: 'X', items: [item('R', 1, 100, 21)]
        });
        check(fechaImposible.status === 400, 'el 31 de febrero se rechaza con 400 (no llega a MySQL)');

        const vacia = await pedir(tok, 'POST', '/api/facturas', { cliente_nombre: 'X', items: [] });
        check(vacia.status === 400, 'una factura sin renglones se rechaza con 400');

        const sinCliente = await pedir(tok, 'POST', '/api/facturas', { items: [item('R', 1, 100, 21)] });
        check(sinCliente.status === 400, 'una factura sin nombre de cliente se rechaza con 400');

        /* ================================================================ */
        seccion('5. Emitir');
        /* ================================================================ */
        const stockAntes = (await filas('SELECT stock FROM productos WHERE id = ?', [prodId]))[0].stock;

        const emitir = await pedir(tok, 'POST', `/api/facturas/${facturaId}/emitir`, {});
        check(emitir.status === 200, `emitir responde 200 (respondio ${emitir.status})`,
            JSON.stringify(emitir.json));
        numero = emitir.json && emitir.json.numero;
        check(typeof numero === 'number', `la factura emitida tiene numero (${numero})`);

        const [fDespues] = await q('SELECT numero, estado, stock_descontado FROM facturas WHERE id = ?', [facturaId]);
        check(fDespues[0].numero === numero, 'el numero guardado es el que devolvio la respuesta');
        check(fDespues[0].estado === 'EMITIDA', 'la factura quedo EMITIDA');
        check(Number(fDespues[0].stock_descontado) === 1, 'quedo marcada como descontada');

        const stockDespues = (await filas('SELECT stock FROM productos WHERE id = ?', [prodId]))[0].stock;
        check(Number(stockDespues) === Number(stockAntes) - 2,
            `el stock bajo de ${stockAntes} a ${stockDespues} (2 unidades del primer renglon)`);

        const movs = await filas('SELECT tipo, cantidad_afectada, motivo FROM movimientos_stock WHERE producto_id = ? ORDER BY id DESC LIMIT 1', [prodId]);
        check(movs.length === 1 && movs[0].tipo === 'VENTA', 'quedo un movimiento de tipo VENTA',
            JSON.stringify(movs[0]));
        check(movs[0] && movs[0].cantidad_afectada === 2, 'el movimiento dice 2 unidades');

        /* ================================================================ */
        seccion('6. Emitir dos veces no descuenta dos veces');
        /* ================================================================ */
        const reemitir = await pedir(tok, 'POST', `/api/facturas/${facturaId}/emitir`, {});
        check(reemitir.status === 200, `reemitir responde 200 (respondio ${reemitir.status})`);
        check(reemitir.json && reemitir.json.numero === numero, 'el numero NO cambia al reemitir',
            `vino ${reemitir.json && reemitir.json.numero}, era ${numero}`);

        const stockTrasReemision = (await filas('SELECT stock FROM productos WHERE id = ?', [prodId]))[0].stock;
        check(Number(stockTrasReemision) === Number(stockDespues),
            `el stock no se toco al reemitir (sigue en ${stockTrasReemision})`);

        /* ================================================================ */
        seccion('7. Una factura emitida ya no se toca');
        /* ================================================================ */
        const editar = await pedir(tok, 'PUT', `/api/facturas/${facturaId}`, {
            fecha: '2026-10-02', cliente_nombre: 'Cliente de Prueba',
            items: [item('Renglon inventado', 99, 1, 21)]
        });
        check(editar.status === 400, 'editar una factura emitida se rechaza con 400',
            `respondio ${editar.status}: ${JSON.stringify(editar.json)}`);

        const borrar = await pedir(tok, 'DELETE', `/api/facturas/${facturaId}`);
        check(borrar.status === 400, 'borrar una factura emitida se rechaza con 400',
            `respondio ${borrar.status}`);

        const [trasEditar] = await q('SELECT total FROM facturas WHERE id = ?', [facturaId]);
        check(Math.abs(Number(trasEditar[0].total) - esperadoTotal) < 0.005,
            'el total no cambio con el intento de edicion', `total = ${trasEditar[0].total}`);

        /* ================================================================ */
        seccion('8. Pagar');
        /* ================================================================ */
        const pagar = await pedir(tok, 'POST', `/api/facturas/${facturaId}/pagar`, { forma_pago: 'Transferencia' });
        check(pagar.status === 200 && pagar.json.estado === 'PAGADA',
            `marcar como pagada funciona (${pagar.status})`, JSON.stringify(pagar.json));

        const [p] = await q('SELECT estado, forma_pago, fecha_pago FROM facturas WHERE id = ?', [facturaId]);
        check(p[0].estado === 'PAGADA', 'el estado guardado es PAGADA');
        check(p[0].forma_pago === 'Transferencia', 'guarda la forma de pago');
        check(p[0].fecha_pago !== null, 'guarda la fecha de pago');

        const pagarDosVeces = await pedir(tok, 'POST', `/api/facturas/${facturaId}/pagar`, {});
        check(pagarDosVeces.status === 200, 'pagar dos veces no rompe nada', `respondio ${pagarDosVeces.status}`);

        /* ================================================================ */
        seccion('9. Anular devuelve el stock');
        /* ================================================================ */
        const anular = await pedir(tok, 'POST', `/api/facturas/${facturaId}/anular`, { motivo: 'Prueba' });
        check(anular.status === 200, `anular responde 200 (respondio ${anular.status})`,
            JSON.stringify(anular.json));

        const stockAnulada = (await filas('SELECT stock FROM productos WHERE id = ?', [prodId]))[0].stock;
        check(Number(stockAnulada) === Number(stockAntes),
            `el stock volvio a ${stockAntes} (estaba en ${stockTrasReemision})`);

        const [fAnulada] = await q('SELECT estado, numero, stock_descontado FROM facturas WHERE id = ?', [facturaId]);
        check(fAnulada[0].estado === 'ANULADA', 'la factura quedo ANULADA');
        check(fAnulada[0].numero === numero, 'la factura anulada CONSERVA su numero (el hueco queda marcado)');

        const anularDosVeces = await pedir(tok, 'POST', `/api/facturas/${facturaId}/anular`, {});
        check(anularDosVeces.status === 400, 'anular dos veces se rechaza con 400',
            `respondio ${anularDosVeces.status}`);

        const stockTrasDobleAnulacion = (await filas('SELECT stock FROM productos WHERE id = ?', [prodId]))[0].stock;
        check(Number(stockTrasDobleAnulacion) === Number(stockAntes),
            `anular dos veces no devolvio el stock dos veces (sigue en ${stockTrasDobleAnulacion})`);

        const reemitirAnulada = await pedir(tok, 'POST', `/api/facturas/${facturaId}/emitir`, {});
        check(reemitirAnulada.status === 400, 'una factura anulada no se puede volver a emitir',
            `respondio ${reemitirAnulada.status}`);

        /* ================================================================ */
        seccion('10. Stock insuficiente');
        /* ================================================================ */
        await q('UPDATE productos SET stock = 1 WHERE id = ?', [prodId]);

        const fSinStock = await pedir(tok, 'POST', '/api/facturas', {
            cliente_nombre: 'Cliente de Prueba',
            items: [item('Repuesto de prueba', 5, 1000, 21, prodId)]
        });
        const idSinStock = fSinStock.json && fSinStock.json.id;

        const emitirSinStock = await pedir(tok, 'POST', `/api/facturas/${idSinStock}/emitir`, {});
        check(emitirSinStock.status === 400, `emitir sin stock se rechaza con 400 (respondio ${emitirSinStock.status})`);
        check(emitirSinStock.json && /Faltan/.test(emitirSinStock.json.error || ''),
            'el error dice QUE producto falta, no solo que algo falta',
            JSON.stringify(emitirSinStock.json));

        const [fSinStockDb] = await q('SELECT numero FROM facturas WHERE id = ?', [idSinStock]);
        check(fSinStockDb[0].numero === null,
            'la factura que no se pudo emitir SIGUE sin numero (no se quemo en la correlativa)');

        const [seqDespues] = await q("SELECT ultimo FROM secuencias WHERE nombre = 'factura'");
        check(Number(seqDespues[0].ultimo) === numero,
            `la correlativa quedo en ${numero}: la emision fallida no la movio`,
            `ultimo = ${seqDespues[0].ultimo}, la ultima emitida era ${numero}`);

        /* ================================================================ */
        seccion('11. Cantidad fraccionaria con producto');
        /* ================================================================ */
        await q('UPDATE productos SET stock = 100 WHERE id = ?', [prodId]);

        const fFraccion = await pedir(tok, 'POST', '/api/facturas', {
            cliente_nombre: 'Cliente de Prueba',
            items: [item('Repuesto de prueba', 2.5, 1000, 21, prodId)]
        });
        const idFraccion = fFraccion.json && fFraccion.json.id;
        check(fFraccion.status === 201, `una cantidad fraccionaria SI se puede cargar (${fFraccion.status})`);

        const emitirFraccion = await pedir(tok, 'POST', `/api/facturas/${idFraccion}/emitir`, {});
        check(emitirFraccion.status === 400, `emitirla se rechaza con 400 (respondio ${emitirFraccion.status})`);
        check(emitirFraccion.json && /entera/.test(emitirFraccion.json.error || ''),
            'el error explica que el stock se lleva en unidades enteras',
            JSON.stringify(emitirFraccion.json));

        const stockTrasFraccion = (await filas('SELECT stock FROM productos WHERE id = ?', [prodId]))[0].stock;
        check(Number(stockTrasFraccion) === 100,
            `el stock NO se toco (sigue en ${stockTrasFraccion}, no se redondeo 2.5 a 2 ni a 3)`);

        // Y la misma cantidad SIN producto (mano de obra) tiene que poder salir.
        const fObra = await pedir(tok, 'POST', '/api/facturas', {
            cliente_nombre: 'Cliente de Prueba',
            items: [item('Mano de obra', 2.5, 1000, 21, null)]
        });
        const emitirObra = await pedir(tok, 'POST', `/api/facturas/${fObra.json.id}/emitir`, {});
        check(emitirObra.status === 200,
            `2,5 h de mano de obra SIN producto se emiten sin problema (${emitirObra.status})`,
            JSON.stringify(emitirObra.json));

        /* ================================================================ */
        seccion('12. Desde un presupuesto');
        /* ================================================================ */
        const noAprobado = await pedir(tok, 'POST', '/api/facturas/desde-presupuesto/1', {});
        check(noAprobado.status === 400 || noAprobado.status === 404,
            `facturar un presupuesto que no esta APROBADO se rechaza (${noAprobado.status})`);

        const inexistente = await pedir(tok, 'POST', '/api/facturas/desde-presupuesto/999999', {});
        check(inexistente.status === 404, `un presupuesto inexistente da 404 (${inexistente.status})`);

        /* ================================================================ */
        seccion('13. Listado y detalle');
        /* ================================================================ */
        const lista = await pedir(tok, 'GET', '/api/facturas');
        check(lista.status === 200 && Array.isArray(lista.json), `el listado responde una lista (${lista.status})`);
        check(lista.json.some((f) => f.id === facturaId), 'la factura de prueba aparece en el listado');

        const emitidas = lista.json.filter((f) => f.numero !== null);
        const ordenados = emitidas.every((f, i, a) =>
            i === 0 || a[i - 1].numero >= f.numero);
        check(ordenados, 'las facturas con numero salen de la mas nueva a la mas vieja');

        const conBorradorPrimero = lista.json[0].numero === null;
        check(!conBorradorPrimero,
            'los borradores (numero NULL) NO salen primero, aunque en SQL NULL ordena antes en DESC',
            `el primero de la lista tiene numero ${JSON.stringify(lista.json[0].numero)}`);

        const detalle = await pedir(tok, 'GET', `/api/facturas/${facturaId}`);
        check(detalle.status === 200 && detalle.json.items.length === 2,
            `el detalle trae los 2 renglones (${detalle.json && detalle.json.items.length})`);

        const comprobante = await pedir(tok, 'GET', `/api/facturas/${facturaId}/comprobante`);
        check(comprobante.status === 200 && comprobante.json.empresa,
            'el comprobante trae los datos de la empresa para imprimir');
        check(comprobante.json && comprobante.json.empresa.nombre !== undefined,
            'la empresa del comprobante viene de la sesion, no de una base escrita a mano');

        const noExiste = await pedir(tok, 'GET', '/api/facturas/999999');
        check(noExiste.status === 404, `una factura inexistente da 404 (${noExiste.status})`);

        const idMalo = await pedir(tok, 'GET', '/api/facturas/abc');
        check(idMalo.status === 400, `un id que no es numero da 400 (${idMalo.status})`);

        /* ================================================================ */
        seccion('14. Borrar un borrador si se puede');
        /* ================================================================ */
        const borrarBorrador = await pedir(tok, 'DELETE', `/api/facturas/${idFraccion}`);
        check(borrarBorrador.status === 200, `borrar un borrador funciona (${borrarBorrador.status})`);

        const [renglones] = await q('SELECT COUNT(*) AS n FROM factura_items WHERE factura_id = ?', [idFraccion]);
        check(Number(renglones[0].n) === 0, 'sus renglones se fueron por ON DELETE CASCADE');

    } finally {
        // --- Limpieza -----------------------------------------------------
        await q('DELETE FROM factura_items WHERE factura_id IN (SELECT id FROM facturas WHERE cliente_nombre = ?)', ['Cliente de Prueba']);
        await q('DELETE FROM facturas WHERE cliente_nombre = ?', ['Cliente de Prueba']);
        await q('DELETE FROM movimientos_stock WHERE producto_id = ?', [prodId]);
        await q('DELETE FROM productos WHERE id = ?', [prodId]);
        console.log('\nLimpieza: facturas de prueba y producto temporal borrados.');

        console.log(`\n${'-'.repeat(70)}`);
        console.log(`${ok} OK / ${malas} FALLO`);
        if (fallos.length) {
            console.log('\nLo que hay que arreglar:');
            fallos.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
        }
        console.log('-'.repeat(70));

        POOL.end(() => process.exit(malas ? 1 : 0));
    }
})().catch((e) => {
    console.error('\n  ERROR', e.message);
    console.error(e.stack);
    POOL.end(() => process.exit(1));
});