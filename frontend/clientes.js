/* ==========================================================================
   GESTIÓN DE CLIENTES: listado optimizado, búsqueda y ficha con historial
   ========================================================================== */

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

const tablaClientesCuerpo = document.getElementById('tabla-clientes-cuerpo');
const inputBuscarClientes = document.getElementById('input-buscar-clientes');

let timeoutBusquedaClientes = null;

document.addEventListener('DOMContentLoaded', () => {
    cargarClientes();

    const usuario = JSON.parse(localStorage.getItem('usuario_actual') || '{}');
    if (usuario.rol === 'TECNICO') {
        const btnGuardar = document.querySelector('#form-editar-cliente button[type="submit"]');
        if (btnGuardar) btnGuardar.style.display = 'none';
        document.querySelectorAll('#form-editar-cliente input').forEach(input => input.disabled = true);
    }
});

inputBuscarClientes.addEventListener('input', () => {
    clearTimeout(timeoutBusquedaClientes);
    timeoutBusquedaClientes = setTimeout(cargarClientes, 300); // debounce de 300ms
});

async function cargarClientes() {
    const termino = inputBuscarClientes.value.trim();
    const url = termino
        ? `/api/clientes?buscar=${encodeURIComponent(termino)}&limit=50`
        : '/api/clientes?limit=50';

    try {
        const respuesta = await apiFetch(url);
        if (!respuesta.ok) throw new Error('Error al cargar clientes');
        const clientes = await respuesta.json();
        renderizarTablaClientes(clientes);
    } catch (error) {
        console.error('Error al cargar clientes:', error);
        tablaClientesCuerpo.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Fallo al conectar con el servidor.</td></tr>';
    }
}

function renderizarTablaClientes(clientes) {
    if (clientes.length === 0) {
        tablaClientesCuerpo.innerHTML = '<tr><td colspan="5" style="text-align:center;">No se encontraron clientes coincidentes.</td></tr>';
        return;
    }

    tablaClientesCuerpo.innerHTML = clientes.map(c => `
        <tr>
            <td><strong>${escapeHtml(c.nombre)}</strong></td>
            <td>${escapeHtml(c.telefono || 'Sin tel.')}</td>
            <td>${escapeHtml(c.direccion || 'Sin dirección')}</td>
            <td style="text-align: center;">${c.cantidad_reparaciones}</td>
            <td style="text-align: center;">
                <button class="btn-tabla btn-info" onclick="abrirFichaCliente(${c.id})">Ver Ficha</button>
            </td>
        </tr>
    `).join('');
}

async function abrirFichaCliente(id) {
    const modal = document.getElementById('modal-ficha-cliente');
    modal.style.display = 'block';

    document.getElementById('ficha-cliente-id').value = id;
    document.getElementById('ficha-cliente-historial').innerHTML = '<p class="texto-vacio">Cargando historial...</p>';

    try {
        const [respCliente, respHistorial] = await Promise.all([
            apiFetch(`/api/clientes/${id}`),
            apiFetch(`/api/clientes/${id}/reparaciones`)
        ]);

        if (!respCliente.ok) throw new Error('No se pudo cargar el cliente');
        const cliente = await respCliente.json();

        document.getElementById('ficha-cliente-titulo').textContent = `Ficha de ${cliente.nombre}`;
        document.getElementById('ficha-cliente-nombre').value = cliente.nombre || '';
        document.getElementById('ficha-cliente-telefono').value = cliente.telefono || '';
        document.getElementById('ficha-cliente-direccion').value = cliente.direccion || '';
        document.getElementById('ficha-cliente-email').value = cliente.email || '';
        document.getElementById('ficha-cliente-notas').value = cliente.notas || '';

        const historial = respHistorial.ok ? await respHistorial.json() : [];
        renderizarHistorialCliente(historial);

    } catch (error) {
        console.error('Error al abrir ficha del cliente:', error);
        document.getElementById('ficha-cliente-historial').innerHTML = '<p style="color: var(--color-danger, #dc3545);">No se pudo cargar la ficha.</p>';
    }
}

function renderizarHistorialCliente(historial) {
    const contenedor = document.getElementById('ficha-cliente-historial');

    if (historial.length === 0) {
        contenedor.innerHTML = '<p class="texto-vacio">Este cliente todavía no tiene reparaciones registradas.</p>';
        return;
    }

    contenedor.innerHTML = historial.map(r => {
        const fecha = new Date(r.fecha_inicio).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
            } catch (e) {
                textoRepuestos = 'Ninguno';
            }
        }

        return `
            <div class="item-repuesto-fila" style="flex-direction: column; align-items: flex-start; gap: 4px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                    <strong>${escapeHtml(r.equipo)}</strong>
                    <span class="badge-estado-taller ${claseBadge}">${escapeHtml(r.estado)}</span>
                </div>
                <small style="color: var(--text-muted);"><strong>Falla:</strong> ${escapeHtml(r.falla_declarada)}</small>
                <small style="color: var(--si-blue-vibrant); font-size: 12px;"><strong>Repuestos:</strong> ${escapeHtml(textoRepuestos)}</small>
                <small style="color: var(--text-muted);">Ingresó: ${fecha} — Total: $${parseFloat(r.total || 0).toFixed(2)}</small>
            </div>
        `;
    }).join('');
}

document.getElementById('form-editar-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('ficha-cliente-id').value;

    const datos = {
        nombre: document.getElementById('ficha-cliente-nombre').value,
        telefono: document.getElementById('ficha-cliente-telefono').value,
        direccion: document.getElementById('ficha-cliente-direccion').value,
        email: document.getElementById('ficha-cliente-email').value,
        notas: document.getElementById('ficha-cliente-notas').value
    };

    try {
        const respuesta = await apiFetch(`/api/clientes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(datos)
        });
        const data = await respuesta.json();

        if (respuesta.ok) {
            alert('Datos del cliente actualizados.');
            cargarClientes();
        } else {
            alert(data.error || 'No se pudo actualizar el cliente.');
        }
    } catch (error) {
        console.error('Error al actualizar cliente:', error);
        alert('No se pudo conectar con el servidor.');
    }
});

function cerrarModal(idModal) {
    const modal = document.getElementById(idModal);
    if (modal) modal.style.display = 'none';
}

window.addEventListener('click', (e) => {
    const modal = document.getElementById('modal-ficha-cliente');
    if (e.target === modal) modal.style.display = 'none';
});