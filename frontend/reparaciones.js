/* ==========================================================================
   GESTIÓN INTEGRAL DE REPARACIONES Y TALLER
   ========================================================================== */

let productosCache = {};
let reparacionesLocales = [];
let repuestosAsignadosNuevo = [];
let repuestosAsignadosEdit = [];

/**
 * Escapa caracteres especiales de HTML antes de insertarlos con innerHTML.
 */
function escapeHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Capitaliza la primera letra de cada palabra (Nombres, Calles, Modelos)
 * Ej: "carlos lopez" -> "Carlos Lopez"
 */
function capitalizarPalabras(texto) {
    if (!texto || typeof texto !== 'string') return null;
    return texto
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
        .join(' ');
}

/**
 * Capitaliza solo la primera letra de la oración (Fallas, Notas)
 * Ej: "no arranca el motor" -> "No arranca el motor"
 */
function capitalizarPrimeraLetra(texto) {
    if (!texto || typeof texto !== 'string') return null;
    const limpio = texto.trim();
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/**
 * Carga inicial: consulta reparaciones y activa búsqueda bajo demanda
 */
async function inicializarModulo() {
    try {
        await cargarReparaciones();
        configurarBusquedaRepuestos();
    } catch (e) {
        console.error('Error al inicializar reparaciones:', e);
    }
}

/**
 * Búsqueda de repuestos en tiempo real (con debounce) sin saturar memoria
 */
function configurarBusquedaRepuestos() {
    const datalist = document.getElementById('lista-repuestos-catalogo');
    if (!datalist) return;

    let debounceBusquedaRepuesto = null;

    async function buscarYActualizarDatalist(termino) {
        if (!termino || termino.trim().length < 2) return;

        try {
            const respuesta = await apiFetch(`/api/productos?buscar=${encodeURIComponent(termino.trim())}&limit=15`);
            const resultados = respuesta.ok ? await respuesta.json() : [];

            resultados.forEach(p => { productosCache[p.id] = p; });

            datalist.innerHTML = resultados.map(p =>
                `<option value="${escapeHtml(p.nombre)} [Cód: ${escapeHtml(p.codigoDistribuidor || 'S/C')}]" data-id="${p.id}"></option>`
            ).join('');
        } catch (error) {
            console.error('Error al buscar repuestos:', error);
        }
    }

    ['rep-input-selector', 'edit-rep-input-selector'].forEach(idInput => {
        const input = document.getElementById(idInput);
        if (!input) return;
        input.addEventListener('input', () => {
            clearTimeout(debounceBusquedaRepuesto);
            debounceBusquedaRepuesto = setTimeout(() => buscarYActualizarDatalist(input.value), 300);
        });
    });
}

/**
 * Consulta la API y obtiene todas las reparaciones registradas
 */
async function cargarReparaciones() {
    const tbody = document.getElementById('tabla-reparaciones-cuerpo');
    try {
        const res = await apiFetch('/api/reparaciones');
        reparacionesLocales = await res.json();
        filtrarYRenderizarReparaciones();
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:red;">Fallo al conectar con el servidor.</td></tr>';
        }
    }
}

/**
 * Renderiza la tabla de equipos en taller
 */
function renderizarTablaReparaciones(lista) {
    const tbody = document.getElementById('tabla-reparaciones-cuerpo');
    if (!tbody) return;

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">No se encontraron órdenes coincidentes.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(r => {
        const esActivo = ['Pendiente', 'En Reparacion', 'Esperando Repuesto'].includes(r.estado);
        const claseFila = esActivo ? 'fila-estado-activo' : '';

        const fInicio = new Date(r.fecha_inicio).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
        const fModif = new Date(r.fecha_modificacion).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

        let claseBadge = 'badge-pendiente';
        if (r.estado === 'En Reparacion') claseBadge = 'badge-en-reparacion';
        else if (r.estado === 'Esperando Repuesto') claseBadge = 'badge-esperando-repuesto';
        else if (r.estado === 'Listo') claseBadge = 'badge-listo';
        else if (r.estado === 'Entregado') claseBadge = 'badge-entregado';
        else if (r.estado === 'Cancelado') claseBadge = 'badge-cancelado';

        let textoRepuestos = r.repuestos_usados;
        if (!textoRepuestos || textoRepuestos.trim() === '' || textoRepuestos === 'Ninguno') {
            try {
                const det = typeof r.repuestos_detalle === 'string' ? JSON.parse(r.repuestos_detalle) : r.repuestos_detalle;
                if (Array.isArray(det) && det.length > 0) {
                    textoRepuestos = det.map(it => `${it.nombre} (x${it.cantidad})`).join(', ');
                } else {
                    textoRepuestos = 'Ninguno';
                }
            } catch(e) {
                textoRepuestos = 'Ninguno';
            }
        }

        return `
            <tr class="${claseFila}">
                <td><strong>#${r.id}</strong></td>
                <td>
                    <strong>${escapeHtml(r.cliente_nombre)}</strong><br>
                    <small style="color:var(--text-muted);">${escapeHtml(r.cliente_telefono || 'Sin tel.')}</small><br>
                    <small style="color:var(--si-blue-vibrant); font-size: 11px;">📍 ${escapeHtml(r.direccion || 'Sin dirección')}</small>
                </td>
                <td>
                    <strong>${escapeHtml(r.equipo)}</strong><br>
                    <span style="font-size:11px; font-weight: bold; color: ${r.tipo_cobertura === 'En Garantia' ? 'var(--color-success)' : 'var(--text-muted)'};">
                        ${r.tipo_cobertura === 'En Garantia' ? '🛡️ En Garantía' : '🔧 Fuera de Garantía'}
                    </span>
                </td>
                <td>
                    <small>${escapeHtml(r.falla_declarada)}</small>
                </td>
                <td style="max-width: 180px;">
                    ${r.notas_servicio ? `
                        <div style="font-size: 12px; color: var(--si-yellow); background: rgba(255, 198, 0, 0.08); padding: 5px 8px; border-radius: 5px; border-left: 3px solid var(--si-yellow); line-height: 1.3;">
                            <strong>📝</strong> ${escapeHtml(r.notas_servicio)}
                        </div>
                    ` : '<small style="color: var(--text-muted); font-style: italic;">Sin notas</small>'}
                </td>
                <td><strong style="color: var(--si-blue-vibrant); font-size: 12px;">${escapeHtml(textoRepuestos)}</strong></td>
                <td><strong>$${parseFloat(r.total).toFixed(2)}</strong></td>
                <td>
                    <small style="display:block;"><strong>Ingreso:</strong> ${fInicio}</small>
                    <small style="display:block; color:var(--text-muted);"><strong>Modif:</strong> ${fModif} hs</small>
                </td>
                <td class="celda-estado-col">
                    <span class="badge-estado-taller ${claseBadge}">
                        ${r.estado}
                    </span>
                </td>
                <td class="celda-acciones-col">
                    <div class="celda-acciones" style="flex-direction: column; gap: 4px;">
                        <select onchange="cambiarEstadoReparacion(${r.id}, this.value)" style="padding: 3px; font-size: 11px;">
                            <option value="" disabled selected>Mover a...</option>
                            <option value="Pendiente">Pendiente</option>
                            <option value="En Reparacion">En Reparación</option>
                            <option value="Esperando Repuesto">Esperando Repuesto</option>
                            <option value="Listo">Listo</option>
                            <option value="Entregado">Entregado (Descuenta Stock)</option>
                            <option value="Cancelado">Cancelado</option>
                        </select>
                        <div style="display: flex; gap: 4px;">
                            <button type="button" class="btn-tabla btn-info" onclick="abrirModalEditar(${r.id})" style="padding: 3px 6px; font-size: 11px; flex: 1;">Editar</button>
                            <button type="button" class="btn-tabla btn-actualizar" onclick="enviarWhatsAppTecnico(${r.id})" style="padding: 3px 6px; font-size: 11px; background-color: #25d366; flex: 1;" title="Enviar datos al técnico">WA</button>
                            <button type="button" class="btn-tabla btn-eliminar" onclick="eliminarReparacion(${r.id}, '${escapeHtml(r.equipo)}', '${escapeHtml(r.cliente_nombre)}')" style="padding: 3px 6px; font-size: 11px; flex: 1;" title="Eliminar orden">Borrar</button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Búsqueda combinada reactiva con orden de prioridad por antigüedad y estado
 */
function filtrarYRenderizarReparaciones() {
    const inputTexto = document.getElementById('input-buscar-reparaciones');
    const selectEstado = document.getElementById('select-filtro-estado-rep');

    const term = inputTexto ? inputTexto.value.toLowerCase().trim() : '';
    const estadoFiltro = selectEstado ? selectEstado.value : 'TODOS';

    const filtrados = reparacionesLocales.filter(r => {
        const coincideEstado = (estadoFiltro === 'TODOS') || (r.estado === estadoFiltro);
        const coincideTexto = term === '' || (
            (r.cliente_nombre || '').toLowerCase().includes(term) ||
            (r.cliente_telefono || '').toLowerCase().includes(term) ||
            (r.direccion || '').toLowerCase().includes(term) ||
            (r.equipo || '').toLowerCase().includes(term) ||
            (r.falla_declarada || '').toLowerCase().includes(term) ||
            (r.notas_servicio || '').toLowerCase().includes(term) ||
            (r.repuestos_usados || '').toLowerCase().includes(term) ||
            String(r.id).includes(term)
        );
        return coincideEstado && coincideTexto;
    });

    const ahora = new Date().getTime();
    const catorceDiasMs = 14 * 24 * 60 * 60 * 1000; // 14 días en milisegundos

    filtrados.sort((a, b) => {
        const aEsCerrado = (a.estado === 'Entregado' || a.estado === 'Cancelado');
        const bEsCerrado = (b.estado === 'Entregado' || b.estado === 'Cancelado');

        // Los cerrados van siempre al final
        if (!aEsCerrado && bEsCerrado) return -1;
        if (aEsCerrado && !bEsCerrado) return 1;

        // Si ambos están cerrados, ordenar por fecha más reciente
        if (aEsCerrado && bEsCerrado) {
            return new Date(b.fecha_inicio) - new Date(a.fecha_inicio);
        }

        // Si ambos están activos/pendientes:
        const tiempoA = ahora - new Date(a.fecha_inicio).getTime();
        const tiempoB = ahora - new Date(b.fecha_inicio).getTime();

        const aTieneMasDe2Semanas = tiempoA >= catorceDiasMs;
        const bTieneMasDe2Semanas = tiempoB >= catorceDiasMs;

        // Prioridad 1: Activos con 2 semanas o más
        if (aTieneMasDe2Semanas && !bTieneMasDe2Semanas) return -1;
        if (!aTieneMasDe2Semanas && bTieneMasDe2Semanas) return 1;

        // Prioridad 2: Específicamente 'Pendiente' antes que otros estados activos
        if (a.estado === 'Pendiente' && b.estado !== 'Pendiente') return -1;
        if (a.estado !== 'Pendiente' && b.estado === 'Pendiente') return 1;

        // Si tienen la misma prioridad, el que lleva más tiempo esperando aparece primero
        return new Date(a.fecha_inicio) - new Date(b.fecha_inicio);
    });

    renderizarTablaReparaciones(filtrados);
}

const inputBuscarReparaciones = document.getElementById('input-buscar-reparaciones');
if (inputBuscarReparaciones) {
    inputBuscarReparaciones.addEventListener('input', filtrarYRenderizarReparaciones);
}

const selectFiltroEstadoRep = document.getElementById('select-filtro-estado-rep');
if (selectFiltroEstadoRep) {
    selectFiltroEstadoRep.addEventListener('change', filtrarYRenderizarReparaciones);
}

/**
 * Añadir repuestos a la lista temporal
 */
function agregarRepuestoAOrden(contexto) {
    const inputSelector = document.getElementById(contexto === 'nuevo' ? 'rep-input-selector' : 'edit-rep-input-selector');
    const inputCant = document.getElementById(contexto === 'nuevo' ? 'rep-input-cantidad' : 'edit-rep-input-cantidad');
    const texto = (inputSelector.value || '').trim();
    const cantidad = parseInt(inputCant.value) || 1;

    if (!texto) return;

    const textoLimpio = texto.toLowerCase();

    // Búsqueda en el caché de productos traídos bajo demanda
    const encontrado = Object.values(productosCache).find(p => {
        const nombreMatch = p.nombre && textoLimpio.includes(p.nombre.toLowerCase());
        const codigoMatch = p.codigoDistribuidor && textoLimpio.includes(String(p.codigoDistribuidor).toLowerCase());
        return nombreMatch || codigoMatch;
    });

    const nuevoItem = {
        producto_id: encontrado ? encontrado.id : null,
        nombre: encontrado ? encontrado.nombre : texto.replace(/\[.*?\]/, '').trim(),
        codigo: encontrado ? (encontrado.codigoDistribuidor || 'S/C') : 'S/C',
        cantidad: cantidad
    };

    if (contexto === 'nuevo') {
        repuestosAsignadosNuevo.push(nuevoItem);
        renderizarChipsRepuestos('nuevo');
    } else {
        repuestosAsignadosEdit.push(nuevoItem);
        renderizarChipsRepuestos('edit');
    }

    inputSelector.value = '';
    inputCant.value = 1;
}

function renderizarChipsRepuestos(contexto) {
    const contenedor = document.getElementById(contexto === 'nuevo' ? 'contenedor-repuestos-asignados-nuevo' : 'contenedor-repuestos-asignados-edit');
    const lista = contexto === 'nuevo' ? repuestosAsignadosNuevo : repuestosAsignadosEdit;

    if (!contenedor) return;

    if (lista.length === 0) {
        contenedor.innerHTML = '<p style="font-size: 12px; color: var(--text-muted); margin: 4px 0;">No hay repuestos agregados.</p>';
        return;
    }

    contenedor.innerHTML = lista.map((r, i) => `
        <div class="item-repuesto-fila" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-body); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 6px;">
            <span style="font-size: 13px;">
                <strong>${escapeHtml(r.nombre)}</strong> (Cód: ${escapeHtml(r.codigo)}) — <strong>${r.cantidad} un.</strong>
                ${r.producto_id ? '<span style="color: var(--color-success); font-size: 11px; font-weight: bold;"> [En Stock]</span>' : '<span style="color: var(--si-yellow); font-size: 11px;"> [Sin vincular]</span>'}
            </span>
            <button type="button" class="btn-tabla btn-eliminar" style="padding: 2px 8px; font-size: 11px;" onclick="quitarRepuestoAsignado('${contexto}', ${i})">✕</button>
        </div>
    `).join('');
}

function quitarRepuestoAsignado(contexto, index) {
    if (contexto === 'nuevo') {
        repuestosAsignadosNuevo.splice(index, 1);
        renderizarChipsRepuestos('nuevo');
    } else {
        repuestosAsignadosEdit.splice(index, 1);
        renderizarChipsRepuestos('edit');
    }
}

/**
 * Cambio de estado con actualización reactiva e inmediata
 */
async function cambiarEstadoReparacion(id, nuevoEstado) {
    if (nuevoEstado === 'Entregado') {
        if (!confirm('¿Confirmás la entrega del equipo? Se descontarán del inventario los repuestos asignados vinculados al stock.')) {
            await cargarReparaciones();
            return;
        }
    }

    try {
        const res = await apiFetch(`/api/reparaciones/${id}/estado`, {
            method: 'PUT',
            body: JSON.stringify({ estado: nuevoEstado })
        });

        if (res.ok) {
            await cargarReparaciones();
        } else {
            const err = await res.json();
            alert(err.error || 'No se pudo actualizar el estado.');
            await cargarReparaciones();
        }
    } catch (e) {
        alert('Error de red al actualizar estado.');
        await cargarReparaciones();
    }
}

/**
 * Modal de Edición Completa
 */
function abrirModalEditar(id) {
    const r = reparacionesLocales.find(x => x.id === id);
    if (!r) return;

    document.getElementById('edit-rep-id').value = r.id;
    document.getElementById('edit-rep-cliente').value = r.cliente_nombre;
    document.getElementById('edit-rep-telefono').value = r.cliente_telefono || '';
    document.getElementById('edit-rep-direccion').value = r.direccion || '';
    document.getElementById('edit-rep-cobertura').value = r.tipo_cobertura || 'Fuera de Garantia';
    document.getElementById('edit-rep-equipo').value = r.equipo;
    document.getElementById('edit-rep-falla').value = r.falla_declarada;
    
    const inputNotas = document.getElementById('edit-rep-notas');
    if (inputNotas) inputNotas.value = r.notas_servicio || '';

    document.getElementById('edit-rep-mano-obra').value = r.costo_mano_obra;
    document.getElementById('edit-rep-costo-rep').value = r.costo_repuestos;
    document.getElementById('edit-rep-estado').value = r.estado;

    try {
        if (typeof r.repuestos_detalle === 'string' && r.repuestos_detalle.trim() !== '') {
            repuestosAsignadosEdit = JSON.parse(r.repuestos_detalle);
        } else if (Array.isArray(r.repuestos_detalle)) {
            repuestosAsignadosEdit = [...r.repuestos_detalle];
        } else {
            repuestosAsignadosEdit = [];
        }
    } catch (e) { 
        repuestosAsignadosEdit = []; 
    }

    renderizarChipsRepuestos('edit');
    document.getElementById('modal-editar-reparacion').style.display = 'block';
}

const formEditarReparacion = document.getElementById('form-editar-reparacion');
if (formEditarReparacion) {
    formEditarReparacion.addEventListener('submit', async (e) => {
        e.preventDefault();

        const inputSelector = document.getElementById('edit-rep-input-selector');
        if (inputSelector && inputSelector.value.trim() !== '') {
            agregarRepuestoAOrden('edit');
        }

        const id = document.getElementById('edit-rep-id').value;
        const ordenModificada = {
            cliente_nombre: capitalizarPalabras(document.getElementById('edit-rep-cliente').value),
            cliente_telefono: document.getElementById('edit-rep-telefono').value.trim(),
            direccion: capitalizarPalabras(document.getElementById('edit-rep-direccion').value),
            tipo_cobertura: document.getElementById('edit-rep-cobertura').value,
            equipo: capitalizarPalabras(document.getElementById('edit-rep-equipo').value),
            falla_declarada: capitalizarPrimeraLetra(document.getElementById('edit-rep-falla').value),
            notas_servicio: document.getElementById('edit-rep-notas') ? capitalizarPrimeraLetra(document.getElementById('edit-rep-notas').value) : null,
            repuestos_detalle: repuestosAsignadosEdit,
            costo_mano_obra: document.getElementById('edit-rep-mano-obra').value,
            costo_repuestos: document.getElementById('edit-rep-costo-rep').value,
            estado: document.getElementById('edit-rep-estado').value
        };

        try {
            const res = await apiFetch(`/api/reparaciones/${id}`, {
                method: 'PUT',
                body: JSON.stringify(ordenModificada)
            });

            if (res.ok) {
                alert('¡Orden actualizada con éxito!');
                cerrarModal('modal-editar-reparacion');
                await cargarReparaciones();
            } else {
                const err = await res.json();
                alert(err.error || 'Error al modificar la orden.');
            }
        } catch (err) {
            alert('No se pudo conectar con el servidor.');
        }
    });
}

/**
 * Alta de nueva orden con capitalización automática
 */
const formReparacion = document.getElementById('form-reparacion');
if (formReparacion) {
    formReparacion.addEventListener('submit', async (e) => {
        e.preventDefault();

        const inputSelector = document.getElementById('rep-input-selector');
        if (inputSelector && inputSelector.value.trim() !== '') {
            agregarRepuestoAOrden('nuevo');
        }

        const orden = {
            cliente_nombre: capitalizarPalabras(document.getElementById('rep-cliente').value),
            cliente_telefono: document.getElementById('rep-telefono').value.trim(),
            direccion: capitalizarPalabras(document.getElementById('rep-direccion').value),
            tipo_cobertura: document.getElementById('rep-cobertura').value,
            equipo: capitalizarPalabras(document.getElementById('rep-equipo').value),
            falla_declarada: capitalizarPrimeraLetra(document.getElementById('rep-falla').value),
            notas_servicio: document.getElementById('rep-notas') ? capitalizarPrimeraLetra(document.getElementById('rep-notas').value) : null,
            repuestos_detalle: repuestosAsignadosNuevo,
            costo_mano_obra: document.getElementById('rep-mano-obra').value,
            costo_repuestos: document.getElementById('rep-costo-rep').value,
            estado: document.getElementById('rep-estado').value
        };

        try {
            const res = await apiFetch('/api/reparaciones', {
                method: 'POST',
                body: JSON.stringify(orden)
            });

            if (res.ok) {
                alert('¡Orden de trabajo registrada con éxito!');
                formReparacion.reset();
                if (document.getElementById('rep-notas')) document.getElementById('rep-notas').value = '';
                repuestosAsignadosNuevo = [];
                renderizarChipsRepuestos('nuevo');
                await cargarReparaciones();
            } else {
                const errData = await res.json();
                alert(errData.error || 'Error al guardar la orden.');
            }
        } catch (err) {
            alert('No se pudo conectar con el servidor.');
        }
    });
}

/**
 * Enviar ficha al técnico por WhatsApp
 */
function enviarWhatsAppTecnico(id) {
    const r = reparacionesLocales.find(x => x.id === id);
    if (!r) return;

    let msj = `🛠️ *ORDEN DE TALLER #${r.id}*\n`;
    msj += `------------------------------------\n`;
    msj += `👤 *Cliente:* ${r.cliente_nombre}\n`;
    if (r.cliente_telefono) msj += `📞 *Teléfono:* ${r.cliente_telefono}\n`;
    if (r.direccion) msj += `📍 *Dirección:* ${r.direccion}\n`;
    msj += `⚙️ *Equipo:* ${r.equipo} (${r.tipo_cobertura})\n`;
    msj += `⚠️ *Falla Declarada:* ${r.falla_declarada}\n`;
    if (r.notas_servicio) msj += `📝 *Notas/Logística:* ${r.notas_servicio}\n`;
    msj += `🔩 *Repuestos:* ${r.repuestos_usados || 'Ninguno'}\n`;
    msj += `📌 *Estado:* ${r.estado}\n`;
    msj += `💵 *Total:* $${parseFloat(r.total).toFixed(2)}\n`;

    const urlWA = `https://api.whatsapp.com/send?text=${encodeURIComponent(msj)}`;
    window.open(urlWA, '_blank');
}

/**
 * Eliminar orden de trabajo del taller
 */
async function eliminarReparacion(id, equipo, cliente) {
    const confirmacion = confirm(`¿Estás seguro de que querés eliminar la orden #${id} (${equipo} de ${cliente})?\n\nEsta acción no se puede deshacer.`);
    if (!confirmacion) return;

    try {
        const res = await apiFetch(`/api/reparaciones/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            alert(`Orden #${id} eliminada correctamente.`);
            await cargarReparaciones();
        } else {
            const err = await res.json();
            alert(err.error || 'No se pudo eliminar la orden.');
        }
    } catch (e) {
        console.error('Error al intentar eliminar:', e);
        alert('Error de conexión con el servidor.');
    }
}

function cerrarModal(idModal) {
    const modal = document.getElementById(idModal);
    if (modal) modal.style.display = 'none';
}

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

function cambiarTemaManualmente() {
    const cuerpo = document.body;
    if (cuerpo.classList.contains('tema-claro')) {
        cuerpo.classList.remove('tema-claro');
        localStorage.setItem('tema-preferido', 'oscuro');
    } else {
        cuerpo.classList.add('tema-claro');
        localStorage.setItem('tema-preferido', 'claro');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const temaGuardado = localStorage.getItem('tema-preferido');
    if (temaGuardado === 'claro') {
        document.body.classList.add('tema-claro');
    }
    inicializarModulo();
});