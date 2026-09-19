/* ==========================================================================
   GESTIÓN INTEGRAL DE REPARACIONES Y TALLER
   ========================================================================== */

let catalogoProductos = [];
let reparacionesLocales = [];
let repuestosAsignadosNuevo = [];
let repuestosAsignadosEdit = [];

/**
 * Carga inicial: catálogo de repuestos de MySQL y lista de órdenes
 */
async function inicializarModulo() {
    try {
        const resStock = await apiFetch('/api/productos');
        catalogoProductos = await resStock.json();

        const datalist = document.getElementById('lista-repuestos-catalogo');
        if (datalist) {
            datalist.innerHTML = catalogoProductos.map(p => 
                `<option value="${p.nombre} | Cód: ${p.codigoDistribuidor || 'S/C'}" data-id="${p.id}"></option>`
            ).join('');
        }

        await cargarReparaciones();
    } catch (e) {
        console.error('Error al inicializar reparaciones:', e);
    }
}

/**
 * Consulta la API y obtiene todas las reparaciones registradas
 */
async function cargarReparaciones() {
    const tbody = document.getElementById('tabla-reparaciones-cuerpo');
    try {
        const res = await apiFetch('/api/reparaciones');
        reparacionesLocales = await res.json();
        renderizarTablaReparaciones(reparacionesLocales);
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red;">Fallo al conectar con el servidor.</td></tr>';
        }
    }
}

/**
 * Renderiza la tabla de equipos en taller con resaltado condicional
 */
function renderizarTablaReparaciones(lista) {
    const tbody = document.getElementById('tabla-reparaciones-cuerpo');
    if (!tbody) return;

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No se encontraron órdenes coincidentes.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(r => {
        // Resaltar en amarillo los estados activos de taller
        const esActivo = ['Pendiente', 'En Reparacion', 'Esperando Repuesto'].includes(r.estado);
        const claseFila = esActivo ? 'fila-estado-activo' : '';

        const fInicio = new Date(r.fecha_inicio).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
        const fModif = new Date(r.fecha_modificacion).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

        return `
            <tr class="${claseFila}">
                <td><strong>#${r.id}</strong></td>
                <td>
                    <strong>${r.cliente_nombre}</strong><br>
                    <small style="color:var(--text-muted);">${r.cliente_telefono || 'Sin tel.'}</small><br>
                    <small style="color:var(--si-blue-vibrant); font-size: 11px;">📍 ${r.direccion || 'Sin dirección'}</small>
                </td>
                <td>
                    <strong>${r.equipo}</strong><br>
                    <span style="font-size:11px; font-weight: bold; color: ${r.tipo_cobertura === 'En Garantia' ? 'var(--color-success)' : 'var(--text-muted)'};">
                        ${r.tipo_cobertura === 'En Garantia' ? '🛡️ En Garantía' : '🔧 Fuera de Garantía'}
                    </span>
                </td>
                <td><small>${r.falla_declarada}</small></td>
                <td><small>${r.repuestos_usados || 'Ninguno'}</small></td>
                <td><strong>$${parseFloat(r.total).toFixed(2)}</strong></td>
                <td>
                    <small style="display:block;"><strong>Ingreso:</strong> ${fInicio}</small>
                    <small style="display:block; color:var(--text-muted);"><strong>Modif:</strong> ${fModif} hs</small>
                </td>
                <td>
                    <span class="badge-online" style="background-color: ${
                        r.estado === 'Entregado' ? '#6c757d' :
                        r.estado === 'Listo' ? 'var(--color-success)' :
                        r.estado === 'Esperando Repuesto' ? '#e67e22' :
                        r.estado === 'En Reparacion' ? 'var(--si-blue-vibrant)' : '#ffc107'
                    }; color: ${['Pendiente', 'Esperando Repuesto'].includes(r.estado) ? '#000' : '#fff'};">
                        ${r.estado}
                    </span>
                </td>
                <td>
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
                            <button type="button" class="btn-tabla btn-info" onclick="abrirModalEditar(${r.id})" style="padding: 3px 6px; font-size: 11px;">Editar</button>
                            <button type="button" class="btn-tabla btn-actualizar" onclick="enviarWhatsAppTecnico(${r.id})" style="padding: 3px 6px; font-size: 11px; background-color: #25d366;" title="Enviar datos al técnico">WA</button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Búsqueda combinada en tiempo real
 */
const inputBuscarReparaciones = document.getElementById('input-buscar-reparaciones');
if (inputBuscarReparaciones) {
    inputBuscarReparaciones.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const filtrados = reparacionesLocales.filter(r => 
            (r.cliente_nombre || '').toLowerCase().includes(term) ||
            (r.cliente_telefono || '').toLowerCase().includes(term) ||
            (r.direccion || '').toLowerCase().includes(term) ||
            (r.equipo || '').toLowerCase().includes(term) ||
            (r.falla_declarada || '').toLowerCase().includes(term) ||
            String(r.id).includes(term)
        );
        renderizarTablaReparaciones(filtrados);
    });
}

/**
 * Gestión interactiva de repuestos en formulario (Creación y Edición)
 */
function agregarRepuestoAOrden(contexto) {
    const inputSelector = document.getElementById(contexto === 'nuevo' ? 'rep-input-selector' : 'edit-rep-input-selector');
    const inputCant = document.getElementById(contexto === 'nuevo' ? 'rep-input-cantidad' : 'edit-rep-input-cantidad');
    const texto = inputSelector.value.trim();
    const cantidad = parseInt(inputCant.value) || 1;

    if (!texto) return;

    const encontrado = catalogoProductos.find(p => texto.includes(p.nombre) || (p.codigoDistribuidor && texto.includes(p.codigoDistribuidor)));
    const nuevoItem = {
        producto_id: encontrado ? encontrado.id : null,
        nombre: encontrado ? encontrado.nombre : texto,
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

    contenedor.innerHTML = lista.map((r, i) => `
        <div class="item-repuesto-fila">
            <span style="font-size: 12px; flex: 1;"><strong>${r.nombre}</strong> (Cód: ${r.codigo}) - <strong>${r.cantidad} un.</strong></span>
            <button type="button" class="btn-tabla btn-eliminar" style="padding: 2px 6px; font-size: 11px;" onclick="quitarRepuestoAsignado('${contexto}', ${i})">✕</button>
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
 * Alta de nueva orden de trabajo
 */
const formReparacion = document.getElementById('form-reparacion');
if (formReparacion) {
    formReparacion.addEventListener('submit', async (e) => {
        e.preventDefault();
        const orden = {
            cliente_nombre: document.getElementById('rep-cliente').value,
            cliente_telefono: document.getElementById('rep-telefono').value,
            direccion: document.getElementById('rep-direccion').value,
            tipo_cobertura: document.getElementById('rep-cobertura').value,
            equipo: document.getElementById('rep-equipo').value,
            falla_declarada: document.getElementById('rep-falla').value,
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
                repuestosAsignadosNuevo = [];
                renderizarChipsRepuestos('nuevo');
                cargarReparaciones();
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
 * Cambio de estado con confirmación para descontar stock
 */
async function cambiarEstadoReparacion(id, nuevoEstado) {
    if (nuevoEstado === 'Entregado') {
        if (!confirm('¿Confirmás la entrega del equipo? Se descontarán del inventario los repuestos asignados que tengan código/ID.')) {
            cargarReparaciones();
            return;
        }
    }
    try {
        const res = await apiFetch(`/api/reparaciones/${id}/estado`, {
            method: 'PUT',
            body: JSON.stringify({ estado: nuevoEstado })
        });
        if (res.ok) {
            cargarReparaciones();
        } else {
            alert('No se pudo actualizar el estado.');
        }
    } catch (e) {
        alert('Error de red al actualizar estado.');
    }
}

/**
 * Abrir y guardar modal de edición completa
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
    document.getElementById('edit-rep-mano-obra').value = r.costo_mano_obra;
    document.getElementById('edit-rep-costo-rep').value = r.costo_repuestos;
    document.getElementById('edit-rep-estado').value = r.estado;

    try {
        repuestosAsignadosEdit = typeof r.repuestos_detalle === 'string' ? JSON.parse(r.repuestos_detalle) : (r.repuestos_detalle || []);
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
        const id = document.getElementById('edit-rep-id').value;
        const ordenModificada = {
            cliente_nombre: document.getElementById('edit-rep-cliente').value,
            cliente_telefono: document.getElementById('edit-rep-telefono').value,
            direccion: document.getElementById('edit-rep-direccion').value,
            tipo_cobertura: document.getElementById('edit-rep-cobertura').value,
            equipo: document.getElementById('edit-rep-equipo').value,
            falla_declarada: document.getElementById('edit-rep-falla').value,
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
                cargarReparaciones();
            } else {
                alert('Error al modificar la orden.');
            }
        } catch (err) {
            alert('No se pudo conectar con el servidor.');
        }
    });
}

/**
 * Enviar ficha técnica al WhatsApp del técnico asignado
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
    msj += `🔩 *Repuestos Asignados:* ${r.repuestos_usados || 'Ninguno'}\n`;
    msj += `📌 *Estado:* ${r.estado}\n`;
    msj += `💵 *Presupuesto Total:* $${parseFloat(r.total).toFixed(2)}\n`;

    const urlWA = `https://api.whatsapp.com/send?text=${encodeURIComponent(msj)}`;
    window.open(urlWA, '_blank');
}

/**
 * Auxiliares de modal y tema
 */
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