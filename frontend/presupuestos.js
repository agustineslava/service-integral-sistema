/* ==========================================================================
   PRESUPUESTOS
   --------------------------------------------------------------------------
   Reglas que este archivo respeta y que conviene no romper:

   1. El total se calcula SOLO acá, para mostrar. Lo que se manda es lo que el
      usuario escribió y el servidor lo recalcula igual. Nunca se manda un
      total de confianza.
   2. Un presupuesto APROBADO o RECHAZADO no se edita ni se borra. La pantalla
      esconde los botones, pero eso es cortesía: el servidor lo rechaza igual.
   3. Los ítems pueden o no venir del catálogo. Si la empresa no contrató el
      módulo de stock, /api/productos da 404 y el formulario anda solo con
      texto libre. Un módulo vendible no puede depender de otro que quizás no
      está contratado.
   4. La hoja imprimible se arma con lo que devuelve /comprobante, no con lo
      que hay en el navegador. Si mañana cambian el logo, la hoja nueva sale
      con el logo nuevo.
   ========================================================================== */

const P = {
    editandoId: null,
    items: [],
    clientes: [],
    /** null = todavía no se supo si hay catálogo. false = no hay. */
    catalogo: null,
    detalle: null
};

const ETIQUETAS = {
    BORRADOR: 'Borrador',
    ENVIADO: 'Enviado',
    APROBADO: 'Aprobado',
    RECHAZADO: 'Rechazado'
};

const $ = (id) => document.getElementById(id);

/* --------------------------------------------------------------------------
   FORMATO
   -------------------------------------------------------------------------- */

/** $ 1.234,56 — se muestra con coma decimal porque es lo que se usa acá. */
function pesos(n) {
    const v = Number(n) || 0;
    return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fecha(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-AR');
}

function soyAdmin() {
    try {
        return JSON.parse(localStorage.getItem('usuario_actual') || '{}').rol === 'ADMIN';
    } catch {
        return false;
    }
}

/** Renglón a dos decimales. Igual que el servidor, para que no cante el peso. */
const a2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* --------------------------------------------------------------------------
   LISTADO
   -------------------------------------------------------------------------- */

async function cargarListado() {
    const cuerpo = $('tabla-presupuestos');
    const estado = $('filtro-estado').value;
    const q = $('input-buscar').value.trim();

    const params = new URLSearchParams();
    if (estado) params.set('estado', estado);
    if (q) params.set('q', q);

    try {
        const res = await apiFetch('/api/presupuestos' + (params.toString() ? `?${params}` : ''));
        if (res.status === 404) {
            // La empresa no contrató presupuestos. Debería ser imposible llegar
            // acá (el menú está oculto), pero si alguien tipea la URL, mejor
            // una explicación que una tabla vacía sin motivo.
            cuerpo.innerHTML = `<tr><td colspan="8" class="p-vacio">
                Esta empresa no tiene el módulo de presupuestos contratado.
            </td></tr>`;
            return;
        }
        if (!res.ok) throw new Error('No se pudo cargar el listado');

        dibujarListado(await res.json());
    } catch (err) {
        cuerpo.innerHTML = `<tr><td colspan="8" class="p-vacio">${escapeHtml(err.message)}</td></tr>`;
    }
}

function dibujarListado(lista) {
    const cuerpo = $('tabla-presupuestos');

    if (!lista.length) {
        cuerpo.innerHTML = `<tr><td colspan="8" class="p-vacio">
            Todavía no hay presupuestos. Usá el botón de arriba para crear el primero.
        </td></tr>`;
        return;
    }

    cuerpo.innerHTML = lista.map((p) => `
        <tr>
            <td style="text-align:center; font-weight:bold;">${p.numero}</td>
            <td>
                ${escapeHtml(p.cliente_nombre)}
                ${p.cliente_doc ? `<br><small style="color:var(--text-secondary,#777)">${escapeHtml(p.cliente_doc)}</small>` : ''}
            </td>
            <td><span class="p-estado p-estado-${p.estado.toLowerCase()}">${ETIQUETAS[p.estado] || p.estado}</span></td>
            <td style="text-align:right;">${pesos(p.subtotal)}</td>
            <td style="text-align:right;">${Number(p.descuento) ? '-' + pesos(p.descuento) : '—'}</td>
            <td style="text-align:right; font-weight:bold;">${pesos(p.total)}</td>
            <td>${fecha(p.creado_en)}</td>
            <td style="text-align:center; white-space:nowrap;">
                <button class="btn-tabla" onclick="abrirDetalle(${p.id})">Ver</button>
            </td>
        </tr>
    `).join('');
}

/* --------------------------------------------------------------------------
   FORMULARIO
   -------------------------------------------------------------------------- */

function abrirFormulario(presupuesto = null) {
    P.editandoId = presupuesto ? presupuesto.id : null;
    $('titulo-formulario').textContent = presupuesto
        ? `Presupuesto N° ${presupuesto.numero}`
        : 'Nuevo presupuesto';
    $('p-error').style.display = 'none';

    $('p-nombre').value = presupuesto ? presupuesto.cliente_nombre : '';
    $('p-doc').value = presupuesto ? (presupuesto.cliente_doc || '') : '';
    $('p-telefono').value = presupuesto ? (presupuesto.cliente_telefono || '') : '';
    $('p-email').value = presupuesto ? (presupuesto.cliente_email || '') : '';
    $('p-direccion').value = presupuesto ? (presupuesto.cliente_direccion || '') : '';
    $('p-descuento').value = presupuesto ? Number(presupuesto.descuento || 0) : 0;
    $('p-valido').value = presupuesto && presupuesto.valido_hasta
        ? String(presupuesto.valido_hasta).slice(0, 10) : '';
    $('p-notas').value = presupuesto ? (presupuesto.notas || '') : '';
    $('p-buscar-cliente').value = '';

    P.clienteId = presupuesto ? presupuesto.cliente_id : null;
    P.items = presupuesto && presupuesto.items && presupuesto.items.length
        ? presupuesto.items.map((it) => ({
            producto_id: it.producto_id,
            descripcion: it.descripcion,
            cantidad: Number(it.cantidad),
            precio_unitario: Number(it.precio_unitario)
        }))
        : [{ producto_id: null, descripcion: '', cantidad: 1, precio_unitario: 0 }];

    dibujarItems();
    $('modal-formulario').classList.add('activo');
    cargarCatalogo();
    setTimeout(() => $('p-nombre').focus(), 60);
}

function cerrarFormulario() {
    $('modal-formulario').classList.remove('activo');
    P.editandoId = null;
}

/**
 * Los productos del catálogo solo se usan para autocompletar. Si la empresa no
 * tiene `stock` contratado el server responde 404 y se sigue con texto libre,
 * sin romper nada.
 */
async function cargarCatalogo() {
    if (P.catalogo !== null) {
        aplicarAvisoCatalogo();
        return;
    }
    try {
        const res = await apiFetch('/api/productos');
        if (res.status === 404) {
            P.catalogo = false;
        } else if (res.ok) {
            const cuerpo = await res.json();
            P.catalogo = Array.isArray(cuerpo) ? cuerpo : (cuerpo.productos || []);
        } else {
            P.catalogo = false;
        }
    } catch {
        P.catalogo = false;
    }
    aplicarAvisoCatalogo();
    // El catálogo recién llegó: hay que pintarlo. Solo el datalist, no las
    // filas, para no romper lo que el usuario pueda haber empezado a escribir
    // mientras hacíamos el fetch.
    dibujarCatalogo();
}

function aplicarAvisoCatalogo() {
    const aviso = $('p-aviso-catalogo');
    if (aviso) aviso.style.display = P.catalogo === false ? 'block' : 'none';
}

function agregarItem() {
    P.items.push({ producto_id: null, descripcion: '', cantidad: 1, precio_unitario: 0 });
    dibujarItems();
    // Se toma el ultimo <tr> de verdad, no el ultimo hijo del <tbody>: si se
    // usara lastElementChild y adentro hubiera algo que no es una fila (un
    // <datalist> o un <template> que se hayan quedado), querySelector('input')
    // devuelve null y reventa.
    const filas = $('p-items').querySelectorAll('tr');
    const ultima = filas[filas.length - 1];
    if (ultima) {
        const campo = ultima.querySelector('[data-campo="descripcion"]');
        if (campo) campo.focus();
    }
}

function quitarItem(indice) {
    P.items.splice(indice, 1);
    // Nunca dejar cero ítems: el servidor lo rechaza y es mejor que el
    // formulario avise antes de que el usuario escriba todo y lo pierda.
    if (!P.items.length) {
        P.items.push({ producto_id: null, descripcion: '', cantidad: 1, precio_unitario: 0 });
    }
    dibujarItems();
}

/**
 * Arma el <datalist> con el catálogo.
 *
 * Va aparte de dibujarItems a propósito: cargarCatalogo() es asíncrono y
 * termina DESPUÉS de que el formulario ya se dibujó. Si el datalist se armara
 * solo dentro de dibujarItems, el catálogo llegaría tarde y la lista de
 * sugerencias quedaría vacía para siempre, sin que nada falle ni avise.
 */
function dibujarCatalogo() {
    const lista = $('lista-productos');
    if (!lista) return;

    lista.innerHTML = (P.catalogo && P.catalogo.length)
        ? P.catalogo.map((pr) => {
            const precio = Number(pr.precio) || 0;
            return `<option value="${escapeHtml(pr.nombre)}"
                        data-id="${pr.id}"
                        data-precio="${precio}"></option>`;
        }).join('')
        : '';
}

function dibujarItems() {
    const cuerpo = $('p-items');
    if (!cuerpo) return;

    dibujarCatalogo();

    cuerpo.innerHTML = P.items.map((it, i) => `
        <tr>
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
            <td><span class="p-subtotal-calc" data-subtotal="${i}">${pesos(it.cantidad * it.precio_unitario)}</span></td>
            <td style="text-align:center;">
                <button type="button" class="p-quitar-item" onclick="quitarItem(${i})" title="Quitar ítem">&times;</button>
            </td>
        </tr>
    `).join('');

    recalcular();
}

$('p-items').addEventListener('input', (ev) => {
    const campo = ev.target.dataset.campo;
    if (!campo) return;
    const i = Number(ev.target.dataset.i);
    if (!P.items[i]) return;

    if (campo === 'descripcion') {
        P.items[i].descripcion = ev.target.value;
        // Si escribió de memoria, no hay producto asociado.
        P.items[i].producto_id = null;
    } else if (campo === 'cantidad') {
        P.items[i].cantidad = Number(ev.target.value) || 0;
    } else if (campo === 'precio_unitario') {
        P.items[i].precio_unitario = Number(ev.target.value) || 0;
        P.items[i].producto_id = null;
    }

    recalcular();
});

// Al elegir del catálogo se completan descripción y precio.
//
// El <datalist> es uno solo, vive fuera de la tabla, y sus <option> llevan
// value = el NOMBRE del producto (es lo que el input de texto muestra) con
// data-id y data-precio aparte. Por eso la opción se busca por valor adentro
// del datalist: adentro de la fila ya no hay ninguna.
$('p-items').addEventListener('change', (ev) => {
    if (!ev.target.matches('[data-campo="descripcion"]')) return;

    const opcion = [...$('lista-productos').options].find((o) => o.value === ev.target.value);
    if (!opcion) return;   // texto escrito a mano: no hay producto asociado

    const i = Number(ev.target.dataset.i);
    if (!P.items[i]) return;
    P.items[i].producto_id = Number(opcion.dataset.id);
    P.items[i].precio_unitario = Number(opcion.dataset.precio) || 0;
    dibujarItems();
});

function recalcular() {
    const subtotal = a2(P.items.reduce((acc, it) => acc + (it.cantidad * it.precio_unitario), 0));
    const descuento = a2($('p-descuento').value);

    P.items.forEach((it, i) => {
        const celda = document.querySelector(`[data-subtotal="${i}"]`);
        if (celda) celda.textContent = pesos(a2(it.cantidad * it.precio_unitario));
    });

    $('p-subtotal').textContent = pesos(subtotal);
    $('p-total').textContent = pesos(a2(subtotal - (descuento || 0)));

    // Si el descuento se pasa, avisar acá en vez de dejar que lo rechace el
    // servidor después de haber escrito todo el formulario.
    const error = $('p-error');
    if (descuento > subtotal) {
        error.textContent = 'El descuento no puede ser mayor que el subtotal.';
        error.style.display = 'block';
    } else {
        error.style.display = 'none';
    }
}

$('p-descuento').addEventListener('input', recalcular);

/* --------------------------------------------------------------------------
   Buscador de clientes de la ficha
   -------------------------------------------------------------------------- */

$('p-buscar-cliente').addEventListener('input', async (ev) => {
    const texto = ev.target.value.trim().toLowerCase();
    const caja = $('p-resultados-cliente');
    if (texto.length < 2) { caja.innerHTML = ''; return; }

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
            <div class="p-resultado" onclick="elegirCliente(${c.id})">
                ${escapeHtml(c.nombre)}
                <small>${escapeHtml([c.telefono, c.direccion].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
            </div>
        `).join('');
    } catch {
        caja.innerHTML = '';
    }
});

function elegirCliente(id) {
    const c = P.clientes.find((x) => x.id === id);
    $('p-resultados-cliente').innerHTML = '';
    $('p-buscar-cliente').value = '';
    if (!c) return;

    P.clienteId = c.id;
    $('p-nombre').value = c.nombre || '';
    $('p-telefono').value = c.telefono || '';
    $('p-direccion').value = c.direccion || '';
    if (!/^\d{2}-/.test(c.telefono || '')) $('p-doc').value = c.documento || '';
}

/* --------------------------------------------------------------------------
   GUARDAR
   -------------------------------------------------------------------------- */

async function guardar() {
    const error = $('p-error');
    error.style.display = 'none';

    const cuerpo = {
        cliente_id: P.clienteId || null,
        cliente_nombre: $('p-nombre').value.trim(),
        cliente_doc: $('p-doc').value.trim(),
        cliente_telefono: $('p-telefono').value.trim(),
        cliente_email: $('p-email').value.trim(),
        cliente_direccion: $('p-direccion').value.trim(),
        descuento: Number($('p-descuento').value) || 0,
        valido_hasta: $('p-valido').value || null,
        notas: $('p-notas').value.trim(),
        // Solo lo que el usuario escribió. El total lo calcula el servidor.
        items: P.items.map((it) => ({
            producto_id: it.producto_id,
            descripcion: it.descripcion.trim(),
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario
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

    const boton = $('btn-guardar');
    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
        const res = await apiFetch(
            P.editandoId ? `/api/presupuestos/${P.editandoId}` : '/api/presupuestos',
            { method: P.editandoId ? 'PUT' : 'POST', body: JSON.stringify(cuerpo) }
        );
        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            error.textContent = datos.errores && datos.errores.length
                ? datos.errores.join('\n')
                : (datos.error || 'No se pudo guardar el presupuesto');
            error.style.display = 'block';
            return;
        }

        cerrarFormulario();
        await cargarListado();
        alert(datos.mensaje || 'Presupuesto guardado');
    } catch {
        error.textContent = 'No se pudo conectar con el servidor.';
        error.style.display = 'block';
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar';
    }
}

/* --------------------------------------------------------------------------
   DETALLE Y COMPROBANTE
   -------------------------------------------------------------------------- */

async function abrirDetalle(id) {
    try {
        const res = await apiFetch(`/api/presupuestos/${id}/comprobante`);
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'No se pudo abrir el presupuesto');
            return;
        }
        P.detalle = await res.json();
        dibujarComprobante();
        dibujarBotonesDetalle();
        $('modal-detalle').classList.add('activo');
    } catch {
        alert('No se pudo conectar con el servidor.');
    }
}

function cerrarDetalle() {
    $('modal-detalle').classList.remove('activo');
    P.detalle = null;
}

function dibujarComprobante() {
    const { presupuesto: p, items, empresa } = P.detalle;
    const caja = $('p-comprobante');

    // Los colores de la empresa se aplican por variable CSS, no con style
    // directo, para que la hoja impresión pueda forzarlos a color exacto.
    caja.style.setProperty('--p-color-primario', empresa.color_primario || '#1a4d8f');
    caja.style.setProperty('--p-color-secundario', empresa.color_secundario || '#0d2f5c');

    const contacto = [empresa.direccion, empresa.telefono, empresa.email_contacto, empresa.cuit]
        .filter(Boolean);

    // El logo viene de la central como `logos/logo.jpg`. Si no hay, no se
    // muestra un ícono roto: la hoja sale sin logo y sigue siendo válida.
    let logo = '';
    if (empresa.logo_url) {
        const src = empresa.logo_url.startsWith('http') || empresa.logo_url.startsWith('/')
            ? empresa.logo_url : '/' + empresa.logo_url;
        logo = `<img src="${escapeHtml(src)}" alt="Logo de ${escapeHtml(empresa.nombre)}"
                       class="p-comprobante-logo"
                       onerror="this.style.display='none'">`;
    }

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
                <span class="p-nro">N° ${p.numero}</span>
                <span class="p-estado p-estado-${String(p.estado).toLowerCase()}">${ETIQUETAS[p.estado] || p.estado}</span>
            </div>
        </div>

        <div class="p-comprobante-cliente">
            <h3>Presupuesto para</h3>
            <div class="p-nombre">${escapeHtml(p.cliente_nombre)}</div>
            ${p.cliente_doc ? `<p>Documento: ${escapeHtml(p.cliente_doc)}</p>` : ''}
            ${p.cliente_telefono ? `<p>Teléfono: ${escapeHtml(p.cliente_telefono)}</p>` : ''}
            ${p.cliente_email ? `<p>Email: ${escapeHtml(p.cliente_email)}</p>` : ''}
            ${p.cliente_direccion ? `<p>Dirección: ${escapeHtml(p.cliente_direccion)}</p>` : ''}
        </div>

        <table class="p-comprobante-items">
            <thead>
                <tr>
                    <th>Descripción</th>
                    <th>Cant.</th>
                    <th>P. unit.</th>
                    <th>Subtotal</th>
                </tr>
            </thead>
            <tbody>
                ${items.map((it) => `
                    <tr>
                        <td>${escapeHtml(it.descripcion)}</td>
                        <td>${Number(it.cantidad)}</td>
                        <td>${pesos(it.precio_unitario)}</td>
                        <td>${pesos(it.subtotal)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <div class="p-comprobante-cierre">
            <table>
                <tr>
                    <td>Subtotal</td>
                    <td>${pesos(p.subtotal)}</td>
                </tr>
                ${Number(p.descuento) ? `
                <tr>
                    <td>Descuento</td>
                    <td>- ${pesos(p.descuento)}</td>
                </tr>` : ''}
                <tr class="p-fila-total">
                    <td>Total</td>
                    <td>${pesos(p.total)}</td>
                </tr>
            </table>
        </div>

        ${p.notas ? `<div class="p-comprobante-notas"><strong>Notas</strong>${escapeHtml(p.notas)}</div>` : ''}

        <div class="p-comprobante-firmas">
            <div class="p-comprobante-firma">Firma del cliente<span></span></div>
            <div class="p-comprobante-firma">Acepto conforme<span></span></div>
        </div>

        <div class="p-comprobante-pie">
            <span>Presupuesto N° ${p.numero} · emitido el ${fecha(p.creado_en)}${p.usuario_nombre ? ' por ' + escapeHtml(p.usuario_nombre) : ''}</span>
            ${p.valido_hasta ? `<span>Válido hasta el ${fecha(p.valido_hasta)}</span>` : '<span>Sin fecha de vencimiento</span>'}
        </div>
    `;
}

function dibujarBotonesDetalle() {
    const caja = $('p-detalle-botones');
    const { presupuesto: p } = P.detalle;
    const admin = soyAdmin();

    const botones = [];

    if (p.estado !== 'APROBADO' && p.estado !== 'RECHAZADO') {
        botones.push(`<button class="btn btn-crear" onclick="editarDesdeDetalle()">Editar</button>`);
        botones.push(`<button class="btn btn-secundario" onclick="cambiarEstado('ENVIADO')">Marcar enviado</button>`);
    }

    if (admin) {
        if (p.estado !== 'APROBADO') {
            botones.push(`<button class="btn btn-crear" onclick="cambiarEstado('APROBADO')">Aprobar</button>`);
        }
        if (p.estado !== 'RECHAZADO') {
            botones.push(`<button class="btn btn-secundario" onclick="cambiarEstado('RECHAZADO')">Rechazar</button>`);
        }
        // Para tocar un documento cerrado hay que devolverlo a borrador. Es un
        // cambio de estado explícito, no una excepción escondida.
        if (p.estado === 'APROBADO' || p.estado === 'RECHAZADO') {
            botones.push(`<button class="btn btn-secundario" onclick="cambiarEstado('BORRADOR')">Volver a borrador</button>`);
        }
        if (p.estado === 'BORRADOR') {
            botones.push(`<button class="btn btn-eliminar" onclick="borrarDetalle()">Eliminar</button>`);
        }
    }

    botones.push(`<button class="btn btn-secundario" onclick="window.print()">Imprimir</button>`);

    caja.innerHTML = botones.join(' ');
}

async function editarDesdeDetalle() {
    const id = P.detalle.presupuesto.id;
    const res = await apiFetch(`/api/presupuestos/${id}`);
    if (!res.ok) { alert('No se pudo cargar el presupuesto'); return; }
    const p = await res.json();
    cerrarDetalle();
    abrirFormulario(p);
}

async function cambiarEstado(nuevo) {
    const id = P.detalle.presupuesto.id;

    if (nuevo === 'RECHAZADO' && !confirm('¿Marcar este presupuesto como rechazado?')) return;
    if (nuevo === 'APROBADO' && !confirm('¿Confirmar que el cliente aprobó este presupuesto?')) return;

    try {
        const res = await apiFetch(`/api/presupuestos/${id}/estado`, {
            method: 'PUT',
            body: JSON.stringify({ estado: nuevo })
        });
        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            alert(datos.error || 'No se pudo cambiar el estado');
            return;
        }

        await cargarListado();
        await abrirDetalle(id);
    } catch {
        alert('No se pudo conectar con el servidor.');
    }
}

async function borrarDetalle() {
    const id = P.detalle.presupuesto.id;
    if (!confirm('¿Eliminar este presupuesto? Esta acción no se puede deshacer.\n\nEl número correlativo no se vuelve a usar.')) return;

    try {
        const res = await apiFetch(`/api/presupuestos/${id}`, { method: 'DELETE' });
        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            alert(datos.error || 'No se pudo eliminar');
            return;
        }

        cerrarDetalle();
        await cargarListado();
    } catch {
        alert('No se pudo conectar con el servidor.');
    }
}

/* --------------------------------------------------------------------------
   ARRANQUE
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
    cargarListado();
});

$('filtro-estado').addEventListener('change', cargarListado);

let temporizadorBusqueda;
$('input-buscar').addEventListener('input', () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(cargarListado, 300);
});

// Escape cierra lo que esté abierto.
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if ($('modal-detalle').classList.contains('activo')) cerrarDetalle();
    else if ($('modal-formulario').classList.contains('activo')) cerrarFormulario();
});
