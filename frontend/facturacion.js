/* ==========================================================================
   FACTURACIÓN INTERNA
   --------------------------------------------------------------------------
   Reglas que este archivo respeta y que conviene no romper:

   1. El total se calcula SOLO acá, para mostrar. Lo que se manda es lo que el
      usuario escribió y el servidor lo recalcula igual. Nunca se manda un
      total de confianza.
   2. El IVA es POR RENGLÓN y sale de una lista de tres: 21, 10,5 y 0. No es un
      campo libre. Argentina define tres alícuotas según la mercadería, y una
      que "casi" es una de ellas no es una de ellas.
   3. Una factura EMITIDA o PAGADA no se edita ni se borra, nunca. Conserva el
      número para siempre. Si hay que corregirla se anula y se emite otra.
   4. Los ítems pueden o no venir del catálogo. Si la empresa no contrató el
      módulo de stock, /api/productos da 404 y el formulario anda solo con texto
      libre. Un módulo vendible no puede depender de otro que quizás no está
      contratado.
   5. La hoja imprimible se arma con lo que devuelve /comprobante, no con lo
      que hay en el navegador. Si mañana cambian el logo, la hoja nueva sale con
      el logo nuevo.
   6. Lo que el servidor va a rechazar al EMITIR, esta pantalla lo avisa antes:
      la cantidad fraccionada con producto y el stock insuficiente. Avisar acá
      no es cortesía: es la diferencia entre "el botón no hace nada" y "esto hay
      que corregirlo".

   Y lo que NO es: esto no es facturación electrónica. Las facturas que salen de
   acá no se emiten ante ARCA/AFIP, no tienen CAI ni punto de venta y no son
   comprobantes fiscales. Está escrito en la pantalla, en la hoja impresa y en
   el backend, porque la lectura por defecto de la palabra "facturación" en
   este país es la que vale para el fisco.
   ========================================================================== */

const F = {
    editandoId: null,
    items: [],
    /** null = todavía no se supo si hay catálogo. false = no hay. */
    catalogo: null,
    detalle: null,
    clienteId: null
};

const ETIQUETAS_FACTURA = {
    BORRADOR: 'Borrador',
    EMITIDA: 'Emitida',
    PAGADA: 'Pagada',
    ANULADA: 'Anulada'
};

/* Las tres alícuotas, en el orden en que se ofrecen. La primera es la que
 * sale marcada: la mayoría de los servicios del taller va al 21%. */
const ALICUOTAS = [21, 10.5, 0];

const $ = (id) => document.getElementById(id);

/* --------------------------------------------------------------------------
   FORMATO
   -------------------------------------------------------------------------- */

/** $ 1.234,56 — se muestra con coma decimal porque es lo que se usa acá. */
function pesosF(n) {
    const v = Number(n) || 0;
    return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaF(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-AR');
}

function soyAdminF() {
    try {
        return JSON.parse(localStorage.getItem('usuario_actual') || '{}').rol === 'ADMIN';
    } catch {
        return false;
    }
}

/** Renglón a dos decimales. Igual que el servidor, para que no cante el peso. */
const a2F = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** La alícuota tal como la escribe la lista, sin ceros de relleno. */
const alicuotaTexto = (n) => String(n).replace('.', ',');

/**
 * La clase CSS del estado, y solo para los cuatro estados que existen.
 *
 * `String(f.estado).toLowerCase()` parece que funciona y es un agujero: la clase
 * va DENTRO de un atributo `class="..."`, así que un estado con un espacio o una
 * comilla no rompe la pantalla, pero mete clases que nadie pidió. Y un estado
 * que no sea uno de los cuatro deja la etiqueta pelada, sin fondo.
 *
 * Acá se compara contra la lista y, si no está, se devuelve la del borrador:
 * que se vea algo siempre, y que no se pueda inventar una clase.
 */
function claseEstadoFactura(estado) {
    const e = String(estado || '').toUpperCase();
    return ETIQUETAS_FACTURA[e] ? e.toLowerCase() : 'borrador';
}

/**
 * ¿Está anulada?
 *
 * Existe para no escribir `f.estado === 'ANULADA'` adentro de un template. El
 * estado viene del servidor y es un VARCHAR: compararlo dentro del HTML deja el
 * nombre del estado sin pasar por `escapeHtml`, y el verificador `ver-facturacion.js`
 * no acepta eso. Acá la comparación vive en una función que devuelve verdadero
 * o falso, que es lo unico que se puede poner en un `?:` sin escapar.
 */
const esAnulada = (estado) => String(estado || '').toUpperCase() === 'ANULADA';

/* --------------------------------------------------------------------------
   LISTADO
   -------------------------------------------------------------------------- */

async function cargarListadoFacturas() {
    const cuerpo = $('tabla-facturas');
    const params = new URLSearchParams();

    const estado = $('filtro-estado').value;
    const desde = $('filtro-desde').value;
    const hasta = $('filtro-hasta').value;
    const q = $('input-buscar').value.trim();

    if (estado) params.set('estado', estado);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    if (q) params.set('q', q);

    try {
        const res = await apiFetch('/api/facturas' + (params.toString() ? `?${params}` : ''));
        if (res.status === 404) {
            // La empresa no contrató facturación. Debería ser imposible llegar
            // acá (el menú está oculto), pero si alguien tipea la URL, mejor una
            // explicación que una tabla vacía sin motivo.
            cuerpo.innerHTML = `<tr><td colspan="10" class="p-vacio">
                Esta empresa no tiene el módulo de facturación contratado.
            </td></tr>`;
            return;
        }
        if (!res.ok) throw new Error('No se pudo cargar el listado');

        dibujarListadoFacturas(await res.json());
    } catch (err) {
        cuerpo.innerHTML = `<tr><td colspan="10" class="p-vacio">${escapeHtml(err.message)}</td></tr>`;
    }
}

/*
 * LISTADO
 *
 * El botón "Ver" lleva `btn-info` y no sólo `btn-tabla`: `.btn-tabla` pone
 * `color: white` y ningún `background`, así que sin la clase de color el botón
 * salía con el fondo gris del navegador y texto blanco, y en tema oscuro no se
 * leía nada.
 *
 * El documento del cliente va con `--text-muted`, no con `--text-secondary`:
 * esa variable existe pero vale negro, así que salía negro sobre el fondo
 * oscuro.
 */
function dibujarListadoFacturas(lista) {
    const cuerpo = $('tabla-facturas');

    if (!lista.length) {
        cuerpo.innerHTML = `<tr><td colspan="10" class="p-vacio">
            Todavía no hay facturas. Usá el botón de arriba para crear la primera.
        </td></tr>`;
        return;
    }

    cuerpo.innerHTML = lista.map((f) => `
        <tr>
            <td style="text-align:center; font-weight:bold;">
                ${f.numero === null || f.numero === undefined ? '<span style="color:var(--text-muted);">sin n°</span>' : f.numero}
            </td>
            <td>${fechaF(f.fecha)}</td>
            <td>
                ${escapeHtml(f.cliente_nombre)}
                ${f.cliente_doc ? `<br><small style="color:var(--text-muted)">${escapeHtml(f.cliente_doc)}</small>` : ''}
            </td>
            <td><span class="p-estado p-estado-${claseEstadoFactura(f.estado)}">${escapeHtml(ETIQUETAS_FACTURA[f.estado] || f.estado)}</span></td>
            <td style="text-align:right;">${pesosF(f.subtotal)}</td>
            <td style="text-align:right;">${Number(f.descuento) ? '-' + pesosF(f.descuento) : '—'}</td>
            <td style="text-align:right;">${pesosF(f.iva_monto)}</td>
            <td style="text-align:right; font-weight:bold;">${pesosF(f.total)}</td>
            <td>${f.forma_pago ? escapeHtml(f.forma_pago) : '—'}</td>
            <td style="text-align:center; white-space:nowrap;">
                <button class="btn-tabla btn-info" onclick="abrirDetalleFactura(${f.id})">Ver</button>
            </td>
        </tr>
    `).join('');
}

/* --------------------------------------------------------------------------
   FORMULARIO
   -------------------------------------------------------------------------- */

function abrirFormulario(factura = null) {
    F.editandoId = factura ? factura.id : null;
    $('titulo-formulario').textContent = factura
        ? `Editar factura ${factura.numero ? 'N° ' + factura.numero : ''}`.trim()
        : 'Nueva factura';
    $('f-error').style.display = 'none';

    $('f-nombre').value = factura ? factura.cliente_nombre : '';
    $('f-doc').value = factura ? (factura.cliente_doc || '') : '';
    $('f-telefono').value = factura ? (factura.cliente_telefono || '') : '';
    $('f-email').value = factura ? (factura.cliente_email || '') : '';
    $('f-direccion').value = factura ? (factura.cliente_direccion || '') : '';
    $('f-notas').value = factura ? (factura.notas || '') : '';
    $('f-buscar-cliente').value = '';
    $('f-pago').value = factura ? (factura.forma_pago || '') : '';
    // Sin fecha es la de hoy. El input `date` la quiere completa aunque la
    // guardada venga como `2026-10-02 00:00:00`.
    $('f-fecha').value = factura && factura.fecha
        ? String(factura.fecha).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    F.clienteId = factura ? factura.cliente_id : null;
    F.items = factura && factura.items && factura.items.length
        ? factura.items.map((it) => ({
            producto_id: it.producto_id,
            descripcion: it.descripcion,
            cantidad: Number(it.cantidad),
            precio_unitario: Number(it.precio_unitario),
            descuento: Number(it.descuento || 0),
            iva_porcentaje: Number(it.iva_porcentaje)
        }))
        : [itemVacio()];

    dibujarItemsFactura();
    $('modal-formulario').classList.add('activo');
    cargarCatalogoFactura();
    setTimeout(() => $('f-nombre').focus(), 60);
}

function itemVacio() {
    return {
        producto_id: null,
        descripcion: '',
        cantidad: 1,
        precio_unitario: 0,
        descuento: 0,
        iva_porcentaje: ALICUOTAS[0]
    };
}

function cerrarFormulario() {
    $('modal-formulario').classList.remove('activo');
    F.editandoId = null;
}

/**
 * Los productos del catálogo solo se usan para autocompletar. Si la empresa no
 * tiene `stock` contratado el server responde 404 y se sigue con texto libre,
 * sin romper nada.
 */
async function cargarCatalogoFactura() {
    if (F.catalogo !== null) {
        aplicarAvisoCatalogoFactura();
        return;
    }
    try {
        const res = await apiFetch('/api/productos');
        if (res.status === 404) {
            F.catalogo = false;
        } else if (res.ok) {
            const cuerpo = await res.json();
            F.catalogo = Array.isArray(cuerpo) ? cuerpo : (cuerpo.productos || []);
        } else {
            F.catalogo = false;
        }
    } catch {
        F.catalogo = false;
    }
    aplicarAvisoCatalogoFactura();
    // El catálogo recién llegó: hay que pintarlo. Solo el datalist, no las
    // filas, para no romper lo que el usuario pueda haber empezado a escribir
    // mientras hacíamos el fetch.
    dibujarCatalogoFactura();
}

function aplicarAvisoCatalogoFactura() {
    const aviso = $('f-aviso-catalogo');
    if (aviso) aviso.style.display = F.catalogo === false ? 'block' : 'none';
}

function agregarItem() {
    F.items.push(itemVacio());
    dibujarItemsFactura();
    // Se toma el ultimo <tr> de verdad, no el ultimo hijo del <tbody>: si se
    // usara lastElementChild y adentro hubiera algo que no es una fila, el
    // querySelector devuelve null y reventa.
    const filas = $('f-items').querySelectorAll('tr.f-fila-item');
    const ultima = filas[filas.length - 1];
    if (ultima) {
        const campo = ultima.querySelector('[data-campo="descripcion"]');
        if (campo) campo.focus();
    }
}

function quitarItem(indice) {
    F.items.splice(indice, 1);
    // Nunca dejar cero ítems: el servidor lo rechaza y es mejor que el
    // formulario avise antes de que el usuario escriba todo y lo pierda.
    if (!F.items.length) F.items.push(itemVacio());
    dibujarItemsFactura();
}

/**
 * Arma el <datalist> con el catálogo.
 *
 * Va aparte de dibujarItemsFactura a propósito: cargarCatalogoFactura() es
 * asíncrono y termina DESPUÉS de que el formulario ya se dibujó. Si el datalist
 * se armara solo dentro de dibujarItemsFactura, el catálogo llegaría tarde y la
 * lista de sugerencias quedaría vacía para siempre, sin que nada falle ni avise.
 *
 * El <datalist> es uno solo y vive fuera de la tabla; sus <option> llevan
 * value = el NOMBRE del producto (es lo que el input de texto muestra) con
 * data-id, data-precio y data-stock aparte.
 */
function dibujarCatalogoFactura() {
    const lista = $('lista-productos');
    if (!lista) return;

    lista.innerHTML = (F.catalogo && F.catalogo.length)
        ? F.catalogo.map((pr) => `
            <option value="${escapeHtml(pr.nombre)}"
                    data-id="${pr.id}"
                    data-precio="${Number(pr.precio) || 0}"
                    data-stock="${Number(pr.stock) || 0}"></option>
        `).join('')
        : '';
}

/** El producto del catálogo que se corresponde con un `producto_id`. */
function productoDeCatalogo(id) {
    if (!id || !F.catalogo) return null;
    return F.catalogo.find((p) => Number(p.id) === Number(id)) || null;
}

/**
 * Lo que hay que decirle a una línea, antes de que el servidor lo rechace.
 *
 * Son las dos reglas de `descontarStockFactura`, escritas al revés para poder
 * avisar antes. Se avisa acá y no se bloquea el botón: el servidor igual es el
 * que manda, y una línea con faltante de stock puedebecome válida si entre la
 * emisión y ahora entró mercadería. Bloquear el botón sería mentir.
 */
function avisosDeLinea(it) {
    const avisos = [];
    if (!it.producto_id) return avisos;

    const cantidad = Number(it.cantidad) || 0;

    if (!Number.isInteger(cantidad)) {
        avisos.push({
            texto: `La cantidad es ${a2F(cantidad)} y con producto del catálogo el depósito se lleva ` +
                'en unidades enteras. Poné un entero, o sacale el producto si es mano de obra.',
            error: true
        });
    }

    const prod = productoDeCatalogo(it.producto_id);
    if (prod && cantidad > Number(prod.stock)) {
        avisos.push({
            texto: `No hay stock suficiente: «${prod.nombre}» pide ${cantidad} y hay ${prod.stock}. ` +
                'La factura se va a guardar como borrador, pero no se va a poder emitir hasta que haya.',
            error: false
        });
    }

    return avisos;
}

function dibujarItemsFactura() {
    const cuerpo = $('f-items');
    if (!cuerpo) return;

    dibujarCatalogoFactura();

    cuerpo.innerHTML = F.items.map((it, i) => {
        const neto = a2F((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) - (Number(it.descuento) || 0));
        const conIva = a2F(neto * (1 + (Number(it.iva_porcentaje) || 0) / 100));
        const avisos = avisosDeLinea(it);

        // La fila del aviso va DEBAJO, como otra fila con colspan. Poner el
        // texto adentro de la celda del producto lo cortaría a los 150px de la
        // columna y quedaría en dos o tres renglones de ilegible.
        const filaAvisos = avisos.length ? `
            <tr class="f-linea-detalle">
                <td colspan="7">
                    ${avisos.map((a) => `<span class="f-item-aviso${a.error ? ' f-item-aviso-error' : ''}">${escapeHtml(a.texto)}</span>`).join('')}
                </td>
            </tr>
        ` : '';

        return `
            <tr class="f-fila-item">
                <td>
                    <input type="text" list="lista-productos" data-i="${i}" data-campo="descripcion"
                           value="${escapeHtml(it.descripcion)}" placeholder="Descripción del ítem">
                </td>
                <td>
                    <input type="number" data-i="${i}" data-campo="cantidad" value="${it.cantidad}"
                           min="0.001" step="0.001">
                </td>
                <td>
                    <input type="number" data-i="${i}" data-campo="precio_unitario" value="${it.precio_unitario}"
                           min="0" step="0.01">
                </td>
                <td>
                    <input type="number" data-i="${i}" data-campo="descuento" value="${it.descuento}"
                           min="0" step="0.01" placeholder="0,00">
                </td>
                <td>
                    <select data-i="${i}" data-campo="iva_porcentaje">
                        ${ALICUOTAS.map((a) => `
                            <option value="${a}" ${Number(it.iva_porcentaje) === a ? 'selected' : ''}>
                                ${alicuotaTexto(a)}%
                            </option>
                        `).join('')}
                    </select>
                </td>
                <td><span class="f-neto-calc" data-neto="${i}">${pesosF(conIva)}</span></td>
                <td style="text-align:center;">
                    <button type="button" class="p-quitar-item" onclick="quitarItem(${i})" title="Quitar ítem">&times;</button>
                </td>
            </tr>
            ${filaAvisos}
        `;
    }).join('');

    recalcularFactura();
}

$('f-items').addEventListener('input', (ev) => {
    const campo = ev.target.dataset.campo;
    if (!campo) return;
    const i = Number(ev.target.dataset.i);
    if (!F.items[i]) return;

    if (campo === 'descripcion') {
        F.items[i].descripcion = ev.target.value;
        // Si escribió de memoria, no hay producto asociado.
        F.items[i].producto_id = null;
    } else if (campo === 'cantidad') {
        F.items[i].cantidad = Number(ev.target.value) || 0;
    } else if (campo === 'precio_unitario') {
        F.items[i].precio_unitario = Number(ev.target.value) || 0;
        F.items[i].producto_id = null;
    } else if (campo === 'descuento') {
        F.items[i].descuento = Number(ev.target.value) || 0;
    }

    recalcularFactura();

    /* La fila de avisos se redibuja SOLO, sin volver a pintar los inputs.
     *
     * Si se llamara a dibujarItemsFactura(), el <input> en el que el usuario
     * está escribiendo perdería el foco en cada tecla: se pondría a cero
     * caracteres escritos a mitad de palabra. */
    refrescarAvisosDeLinea(i);
});

$('f-items').addEventListener('change', (ev) => {
    const campo = ev.target.dataset.campo;
    const i = Number(ev.target.dataset.i);
    if (!F.items[i]) return;

    if (campo === 'iva_porcentaje') {
        F.items[i].iva_porcentaje = Number(ev.target.value);
        recalcularFactura();
        return;
    }

    if (campo !== 'descripcion') return;

    // Al elegir del catálogo se completan descripción, precio y producto. La
    // opción se busca por VALOR adentro del datalist: adentro de la fila ya no
    // hay ninguna, y el <datalist> es uno solo para toda la tabla.
    const opcion = [...$('lista-productos').options].find((o) => o.value === ev.target.value);
    if (!opcion) return;   // texto escrito a mano: no hay producto asociado

    F.items[i].producto_id = Number(opcion.dataset.id);
    F.items[i].precio_unitario = Number(opcion.dataset.precio) || 0;
    dibujarItemsFactura();
});

/** Reemplaza, en la fila i, la fila de avisos. No toca ningún input. */
function refrescarAvisosDeLinea(i) {
    const cuerpo = $('f-items');
    if (!cuerpo) return;

    const filas = cuerpo.querySelectorAll('tr.f-fila-item');
    const fila = filas[i];
    if (!fila) return;

    const avisos = avisosDeLinea(F.items[i]);
    const siguiente = fila.nextElementSibling;
    const esAviso = siguiente && siguiente.classList.contains('f-linea-detalle');

    if (!avisos.length) {
        if (esAviso) siguiente.remove();
        return;
    }

    const html = avisos
        .map((a) => `<span class="f-item-aviso${a.error ? ' f-item-aviso-error' : ''}">${escapeHtml(a.texto)}</span>`)
        .join('');
    if (esAviso) {
        siguiente.firstElementChild.innerHTML = html;
    } else {
        const detalle = document.createElement('tr');
        detalle.className = 'f-linea-detalle';
        detalle.innerHTML = `<td colspan="7">${html}</td>`;
        fila.after(detalle);
    }
}

/*
 * Los totales.
 *
 * `subtotal` es BRUTO (cantidad × precio, sin restar nada) y `descuento` es la
 * suma de los descuentos de los renglones. El total es
 * `subtotal - descuento + iva`. Es la misma fórmula que escribe la migración y
 * que aplica el servidor: la que hay acá es para mostrar, y por eso se rotula
 * "Descuentos de los ítems" y no "Descuento", para que quede claro de dónde
 * sale.
 */
function recalcularFactura() {
    let bruto = 0;
    let descuento = 0;
    let iva = 0;

    F.items.forEach((it, i) => {
        const cant = Number(it.cantidad) || 0;
        const prec = Number(it.precio_unitario) || 0;
        const desc = Number(it.descuento) || 0;
        const alicuota = Number(it.iva_porcentaje) || 0;

        const brutoItem = a2F(cant * prec);
        const netoItem = a2F(brutoItem - desc);

        bruto = a2F(bruto + brutoItem);
        descuento = a2F(descuento + desc);
        iva = a2F(iva + a2F(netoItem * alicuota / 100));

        const celda = document.querySelector(`[data-neto="${i}"]`);
        if (celda) celda.textContent = pesosF(a2F(netoItem * (1 + alicuota / 100)));
    });

    $('f-subtotal').textContent = pesosF(bruto);
    $('f-descuento').textContent = '- ' + pesosF(descuento);
    $('f-iva').textContent = pesosF(iva);
    $('f-total').textContent = pesosF(a2F(bruto - descuento + iva));

    // Si el descuento de una línea se pasa de su propio importe, avisar acá en
    // vez de dejar que lo rechace el servidor después de haber escrito todo el
    // formulario.
    const error = $('f-error');
    const pasado = F.items.findIndex((it) =>
        (Number(it.descuento) || 0) > a2F((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0))
    );

    if (pasado >= 0) {
        error.textContent = `El descuento del ítem ${pasado + 1} es mayor que su propio importe.`;
        error.style.display = 'block';
    } else {
        error.style.display = 'none';
    }
}

/* --------------------------------------------------------------------------
   Buscador de clientes de la ficha
   -------------------------------------------------------------------------- */

let temporizadorCliente = null;

$('f-buscar-cliente').addEventListener('input', (ev) => {
    const texto = ev.target.value.trim().toLowerCase();

    clearTimeout(temporizadorCliente);
    if (texto.length < 2) { $('f-resultados-cliente').innerHTML = ''; return; }

    temporizadorCliente = setTimeout(async () => {
        const caja = $('f-resultados-cliente');
        try {
            const res = await apiFetch('/api/clientes');
            if (!res.ok) { caja.innerHTML = ''; return; }
            const cuerpo = await res.json();
            const todos = Array.isArray(cuerpo) ? cuerpo : (cuerpo.clientes || []);

            const hallados = todos.filter((c) =>
                (c.nombre || '').toLowerCase().includes(texto)
                || (c.telefono || '').toLowerCase().includes(texto)
            ).slice(0, 8);

            if (!hallados.length) { caja.innerHTML = ''; return; }

            caja.innerHTML = hallados.map((c) => `
                <div class="p-resultado" onclick="elegirClienteFactura(${c.id})">
                    ${escapeHtml(c.nombre)}
                    <small>${escapeHtml([c.telefono, c.direccion].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
                </div>
            `).join('');
        } catch {
            caja.innerHTML = '';
        }
    }, 250);
});

async function elegirClienteFactura(id) {
    $('f-resultados-cliente').innerHTML = '';
    $('f-buscar-cliente').value = '';

    let c = null;
    try {
        const res = await apiFetch('/api/clientes');
        if (res.ok) {
            const cuerpo = await res.json();
            const todos = Array.isArray(cuerpo) ? cuerpo : (cuerpo.clientes || []);
            c = todos.find((x) => Number(x.id) === Number(id)) || null;
        }
    } catch {
        c = null;
    }

    if (!c) return;

    F.clienteId = c.id;
    $('f-nombre').value = c.nombre || '';
    $('f-telefono').value = c.telefono || '';
    $('f-direccion').value = c.direccion || '';
    if (!/^\d{2}-/.test(c.telefono || '')) $('f-doc').value = c.documento || '';
}

/* --------------------------------------------------------------------------
   GUARDAR
   -------------------------------------------------------------------------- */

async function guardarFactura() {
    const error = $('f-error');
    error.style.display = 'none';

    const cuerpo = {
        cliente_id: F.clienteId || null,
        cliente_nombre: $('f-nombre').value.trim(),
        cliente_doc: $('f-doc').value.trim(),
        cliente_telefono: $('f-telefono').value.trim(),
        cliente_email: $('f-email').value.trim(),
        cliente_direccion: $('f-direccion').value.trim(),
        fecha: $('f-fecha').value || null,
        forma_pago: $('f-pago').value || null,
        notas: $('f-notas').value.trim(),
        // Solo lo que el usuario escribió. Los importes los calcula el servidor.
        items: F.items.map((it) => ({
            producto_id: it.producto_id,
            descripcion: it.descripcion.trim(),
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento: it.descuento || 0,
            iva_porcentaje: it.iva_porcentaje
        }))
    };

    if (!cuerpo.cliente_nombre) {
        error.textContent = 'Falta el nombre del cliente.';
        error.style.display = 'block';
        return;
    }
    if (!cuerpo.items.some((it) => it.descripcion)) {
        error.textContent = 'Al menos un ítem tiene que tener descripción.';
        error.style.display = 'block';
        return;
    }
    // Todos los ítems con descripción, no solo el primero: el `<select>` ofrece
    // las tres alícuotas y no se puede elegir otra, así que esto no debería
    // pasar nunca. Va igual porque el select se puede toquetear desde la
    // consola o desde una extensión, y una factura con una alícuota inventada
    // es peor que una que no se guardó.
    const alicuotaFueraDeLista = cuerpo.items.find((it) =>
        it.descripcion && !ALICUOTAS.includes(Number(it.iva_porcentaje))
    );
    if (alicuotaFueraDeLista) {
        error.textContent = `La alícuota de IVA del ítem "${alicuotaFueraDeLista.descripcion}" ` +
            `tiene que ser una de ${ALICUOTAS.map(alicuotaTexto).join(', ')}.`;
        error.style.display = 'block';
        return;
    }

    const boton = $('btn-guardar');
    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
        const res = await apiFetch(
            F.editandoId ? `/api/facturas/${F.editandoId}` : '/api/facturas',
            { method: F.editandoId ? 'PUT' : 'POST', body: JSON.stringify(cuerpo) }
        );
        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            error.textContent = datos.errores && datos.errores.length
                ? datos.errores.join('\n')
                : (datos.error || 'No se pudo guardar la factura');
            error.style.display = 'block';
            return;
        }

        const id = datos.id || F.editandoId;
        cerrarFormulario();
        await cargarListadoFacturas();
        if (id) await abrirDetalleFactura(id);
        else alert(datos.mensaje || 'Factura guardada');
    } catch {
        error.textContent = 'No se pudo conectar con el servidor.';
        error.style.display = 'block';
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar borrador';
    }
}

/* --------------------------------------------------------------------------
   DETALLE Y COMPROBANTE
   -------------------------------------------------------------------------- */

async function abrirDetalleFactura(id) {
    try {
        const res = await apiFetch(`/api/facturas/${id}/comprobante`);
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'No se pudo abrir la factura');
            return;
        }
        F.detalle = await res.json();
        dibujarComprobanteFactura();
        dibujarBotonesDetalleFactura();
        $('modal-detalle').classList.add('activo');
    } catch {
        alert('No se pudo conectar con el servidor.');
    }
}

function cerrarDetalleFactura() {
    $('modal-detalle').classList.remove('activo');
    F.detalle = null;
}

/**
 * La hoja imprimible.
 *
 * El aviso de que no es comprobante fiscal va ACÁ, en el papel, y no solo en
 * la pantalla. Es el documento que se le entrega al cliente y el que puede
 * terminar en un archivo o en un email: si el aviso estuviera solo en la
 * aplicación, el papel saldría sin nada y parecería un comprobante más.
 */
function dibujarComprobanteFactura() {
    const { factura: f, items, empresa, emitido_por } = F.detalle;
    const caja = $('f-comprobante');

    // Los colores de la empresa se aplican por variable CSS, no con style
    // directo, para que la hoja de impresión pueda forzarlos a color exacto.
    caja.style.setProperty('--p-color-primario', empresa.color_primario || '#1a4d8f');
    caja.style.setProperty('--p-color-secundario', empresa.color_secundario || '#0d2f5c');

    const contacto = [empresa.direccion, empresa.telefono, empresa.email_contacto, empresa.cuit]
        .filter(Boolean);

    // El logo viene de la central (la marca de la empresa). Si no hay, no se
    // muestra un ícono roto: la hoja sale sin logo y sigue siendo válida.
    let logo = '';
    if (empresa.logo_url) {
        const src = empresa.logo_url.startsWith('http') || empresa.logo_url.startsWith('/')
            ? empresa.logo_url : '/' + empresa.logo_url;
        logo = `<img src="${escapeHtml(src)}" alt="Logo de ${escapeHtml(empresa.nombre)}"
                       class="p-comprobante-logo"
                       onerror="this.style.display='none'">`;
    }

    const sinNumero = f.numero === null || f.numero === undefined;

    caja.innerHTML = `
        <div class="p-comprobante-cabecera">
            <div style="display:flex; gap:16px; align-items:flex-start;">
                ${logo}
                <div class="p-comprobante-empresa">
                    <h2>${escapeHtml(empresa.nombre)}</h2>
                    ${empresa.subtitulo ? `<p class="p-sub">${escapeHtml(empresa.subtitulo)}</p>` : ''}
                    ${contacto.length ? `<address>${contacto.map(escapeHtml).join('<br>')}</address>` : ''}
                </div>
            </div>
            <div class="p-comprobante-numero">
                <span class="p-nro">${sinNumero ? 'Sin número' : 'N° ' + f.numero}</span>
                <span class="p-estado p-estado-${claseEstadoFactura(f.estado)}">${escapeHtml(ETIQUETAS_FACTURA[f.estado] || f.estado)}</span>
            </div>
        </div>

        <div class="p-comprobante-cliente">
            <h3>Factura para</h3>
            <div class="p-nombre">${escapeHtml(f.cliente_nombre)}</div>
            ${f.cliente_doc ? `<p>Documento: ${escapeHtml(f.cliente_doc)}</p>` : ''}
            ${f.cliente_telefono ? `<p>Teléfono: ${escapeHtml(f.cliente_telefono)}</p>` : ''}
            ${f.cliente_email ? `<p>Email: ${escapeHtml(f.cliente_email)}</p>` : ''}
            ${f.cliente_direccion ? `<p>Dirección: ${escapeHtml(f.cliente_direccion)}</p>` : ''}
        </div>

        <table class="p-comprobante-items">
            <thead>
                <tr>
                    <th>Descripción</th>
                    <th>Cant.</th>
                    <th>P. unit.</th>
                    <th>Dcto.</th>
                    <th>IVA</th>
                    <th>Subtotal</th>
                </tr>
            </thead>
            <tbody>
                ${items.map((it) => `
                    <tr>
                        <td>${escapeHtml(it.descripcion)}</td>
                        <td>${Number(it.cantidad)}</td>
                        <td>${pesosF(it.precio_unitario)}</td>
                        <td>${Number(it.descuento) ? '-' + pesosF(it.descuento) : '—'}</td>
                        <td>${alicuotaTexto(it.iva_porcentaje)}%</td>
                        <td>${pesosF(it.subtotal)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <div class="p-comprobante-cierre">
            <table>
                <tr>
                    <td>Subtotal</td>
                    <td>${pesosF(f.subtotal)}</td>
                </tr>
                ${Number(f.descuento) ? `
                <tr>
                    <td>Descuentos</td>
                    <td>- ${pesosF(f.descuento)}</td>
                </tr>` : ''}
                <tr>
                    <td>IVA</td>
                    <td>${pesosF(f.iva_monto)}</td>
                </tr>
                <tr class="p-fila-total">
                    <td>Total</td>
                    <td>${pesosF(f.total)}</td>
                </tr>
            </table>
        </div>

        ${f.forma_pago ? `<div class="p-comprobante-notas"><strong>Forma de pago</strong>${escapeHtml(f.forma_pago)}${f.fecha_pago ? ' — el ' + fechaF(f.fecha_pago) : ''}</div>` : ''}
        ${f.notas ? `<div class="p-comprobante-notas"><strong>Notas</strong>${escapeHtml(f.notas)}</div>` : ''}

        <div class="f-aviso-legal">
            <strong>No es facturación electrónica.</strong> Comprobante con numeración
            interna de ${escapeHtml(empresa.nombre)}. No se emitió ante ARCA/AFIP,
            no tiene CAI ni punto de venta y no es un comprobante fiscal.
        </div>

        <div class="p-comprobante-firmas">
            <div class="p-comprobante-firma">Recibí conforme<span></span></div>
            <div class="p-comprobante-firma">Aclaración<span></span></div>
        </div>

        <div class="p-comprobante-pie">
            <span>${sinNumero ? 'Borrador sin número' : `Factura N° ${f.numero}`} · del ${fechaF(f.fecha)}${emitido_por ? ' por ' + escapeHtml(emitido_por) : ''}</span>
            ${esAnulada(f.estado) ? '<span>Anulada</span>' : ''}
        </div>
    `;
}

/*
 * Los botones según el estado.
 *
 * La misma regla del backend, no una versión suave: emitir y anular son
 * decisiones de negocio y son solo ADMIN; editar y borrar solo mientras sea
 * BORRADOR; marcar pagada cualquiera con el módulo.
 *
 * Que un botón no aparezca NO es seguridad. El servidor lo rechaza igual. Esto
 * es para que no se ofrezcan acciones que van a fallar.
 */
function dibujarBotonesDetalleFactura() {
    const caja = $('f-detalle-botones');
    const { factura: f } = F.detalle;
    const admin = soyAdminF();
    const botones = [];

    if (f.estado === 'BORRADOR') {
        botones.push(`<button class="btn btn-crear" onclick="editarDesdeDetalleFactura()">Editar</button>`);
        if (admin) {
            botones.push(`<button class="btn btn-crear" onclick="emitirFactura(this)">Emitir</button>`);
            botones.push(`<button class="btn btn-eliminar" onclick="borrarFactura()">Eliminar</button>`);
        } else {
            botones.push(`<span class="f-help" style="align-self:center;">Emitir es de ADMIN.</span>`);
        }
    }

    if (f.estado === 'EMITIDA') {
        botones.push(`<button class="btn btn-crear" onclick="pagarFactura(this)">Marcar pagada</button>`);
        if (admin) {
            botones.push(`<button class="btn btn-eliminar" onclick="anularFactura(this)">Anular</button>`);
        }
    }

    if (f.estado === 'ANULADA') {
        botones.push(`<span class="f-help" style="align-self:center;">Una factura anulada conserva su número y no se vuelve a emitir.</span>`);
    }

    botones.push(`<button class="btn btn-secundario" onclick="window.print()">Imprimir</button>`);

    caja.innerHTML = botones.join(' ');
}

async function editarDesdeDetalleFactura() {
    const id = F.detalle.factura.id;
    const res = await apiFetch(`/api/facturas/${id}`);
    if (!res.ok) { alert('No se pudo cargar la factura'); return; }
    const f = await res.json();
    cerrarDetalleFactura();
    abrirFormulario(f);
}

/**
 * La acción de una factura: emitir, anular, pagar.
 *
 * El botón se pasa explícitamente (`onclick="emitirFactura(this)"`) y no se usa
 * el `event` global: el global depende del navegador y del contexto en que se
 * evaluó el atributo, y si el handler se llama desde otro lado revienta o peor,
 * desactiva el botón que no es el que se apretó.
 *
 * `cuerpo` va al POST. `pagar` necesita la forma de pago y el endpoint la lee de
 * `req.body.forma_pago`: mandarle `{}` funciona igual y guarda la factura como
 * pagada SIN forma, que es justo el dato que el usuario había tipeado.
 */
async function accionDeFactura(ruta, boton, cuerpo, confirmacion) {
    if (confirmacion && !confirm(confirmacion)) return;

    const id = F.detalle.factura.id;
    boton.disabled = true;
    try {
        const res = await apiFetch(ruta, { method: 'POST', body: JSON.stringify(cuerpo || {}) });
        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            alert(datos.error || 'No se pudo completar la operación');
            await abrirDetalleFactura(id);
            return;
        }

        await cargarListadoFacturas();
        await abrirDetalleFactura(id);
        alert(datos.mensaje || 'Listo');
    } catch {
        alert('No se pudo conectar con el servidor.');
    } finally {
        boton.disabled = false;
    }
}

function emitirFactura(boton) {
    const f = F.detalle.factura;
    return accionDeFactura(
        `/api/facturas/${f.id}/emitir`,
        boton,
        null,
        `¿Emitir la factura?\n\nLe va a sacar el número y a descontar del depósito ` +
        'los ítems que tengan producto del catálogo. Después no se puede modificar: ' +
        'si hay que corregir algo, se anula y se emite otra.'
    );
}

function anularFactura(boton) {
    const f = F.detalle.factura;
    return accionDeFactura(
        `/api/facturas/${f.id}/anular`,
        boton,
        null,
        `¿Anular la factura N° ${f.numero}?\n\nEl stock de los ítems con producto vuelve al depósito. ` +
        'El número NO se reutiliza: la factura queda anulada y hay que emitir otra.'
    );
}

function pagarFactura(boton) {
    const f = F.detalle.factura;

    /* `prompt` y no un select en el modal a propósito: marcar pagada es un
     * clic, y abrir un formulario entero para elegir entre cinco palabras obliga
     * a dos pasos y un segundo botón. Si el usuario cancela, no se manda nada.
     *
     * Un `prompt` devuelve `null` al cancelar y `''` al aceptar en blanco. Los
     * dos casos se tratan distinto: cancelar no hace nada; aceptar en blanco
     * paga igual y deja la forma vacía, que el servidor acepta. */
    const forma = prompt('¿Con qué forma de pago se cancela?', f.forma_pago || 'Efectivo');
    if (forma === null) return;

    return accionDeFactura(
        `/api/facturas/${f.id}/pagar`,
        boton,
        { forma_pago: forma.trim().slice(0, 40) }
    );
}

async function borrarFactura() {
    const id = F.detalle.factura.id;
    if (!confirm('¿Eliminar este borrador de factura?\n\nEs una acción sin vuelta atrás. Si ya tenía número, anulalo en vez de borrarlo.')) return;

    try {
        const res = await apiFetch(`/api/facturas/${id}`, { method: 'DELETE' });
        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            alert(datos.error || 'No se pudo eliminar');
            return;
        }

        cerrarDetalleFactura();
        await cargarListadoFacturas();
    } catch {
        alert('No se pudo conectar con el servidor.');
    }
}

/* --------------------------------------------------------------------------
   ARRANQUE
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', async () => {
    await cargarListadoFacturas();

    /* Venir desde un presupuesto aprobado: `?nuevo=<id>`.
     *
     * El botón "Facturar" de `presupuestos.js` crea el borrador por API y deja
     * el id acá. Se abre el detalle en vez de solo refrescar la lista, porque
     * crear una factura y que la pantalla no muestre cuál es deja al usuario
     * buscando un número que todavía no existe. */
    const nuevo = new URLSearchParams(window.location.search).get('nuevo');
    if (nuevo && /^\d+$/.test(nuevo)) {
        // La URL se limpia antes de abrir el modal: si el usuario recarga con
        // el detalle abierto, `abrirFormulario` no se dispararía solo, pero la
        // URL sucia ya no sirve para nada y confunde al compartir el enlace.
        window.history.replaceState({}, '', window.location.pathname);
        await abrirDetalleFactura(Number(nuevo));
    }
});

$('filtro-estado').addEventListener('change', cargarListadoFacturas);
$('filtro-desde').addEventListener('change', cargarListadoFacturas);
$('filtro-hasta').addEventListener('change', cargarListadoFacturas);

let temporizadorBusquedaFactura = null;
$('input-buscar').addEventListener('input', () => {
    clearTimeout(temporizadorBusquedaFactura);
    temporizadorBusquedaFactura = setTimeout(cargarListadoFacturas, 300);
});

// Escape cierra lo que esté abierto.
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if ($('modal-detalle').classList.contains('activo')) cerrarDetalleFactura();
    else if ($('modal-formulario').classList.contains('activo')) cerrarFormulario();
});