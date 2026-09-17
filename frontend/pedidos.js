/* ==========================================================================
   1. CONFIGURACIÓN GLOBAL Y VARIABLES DE ESTADO
   ========================================================================== */
// URL base de la API de productos
const API_URL = `${window.location.origin}/api/productos`;

// Elementos del DOM
const inputBuscar = document.getElementById('buscar-pedido-art');
const selectProveedor = document.getElementById('select-proveedor-pedido'); 
const listaSugerencias = document.getElementById('lista-sugerencias-pedido');
const sugerenciasCriticas = document.getElementById('sugerencias-stock-critico');
const tablaPedidoCuerpo = document.getElementById('tabla-pedido-cuerpo');
const btnVaciar = document.getElementById('btn-vaciar-lista');
const btnCopiar = document.getElementById('btn-copiar-pedido');
const btnGuardar = document.getElementById('btn-exportar-pedido');
const notasPedido = document.getElementById('notas-pedido');
const tablaHistorialCuerpo = document.getElementById('tabla-historial-cuerpo');
const modalDetallePedido = document.getElementById('modal-detalle-pedido');
const tablaModalItemsCuerpo = document.getElementById('tabla-modal-items-cuerpo');

// Arrays globales para la gestión en memoria
let productosInventario = [];
let listaPedidoActual = [];
let historialPedidosCache = []; // Guarda el último historial recibido para poder mostrar el detalle sin re-pedirlo

/**
 * Escapa caracteres especiales de HTML antes de insertarlos con innerHTML.
 * Evita que un nombre de producto, proveedor o nota con < > " ' rompa el layout
 * o ejecute HTML/JS no deseado (XSS).
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


/* ==========================================================================
   2. INICIALIZACIÓN: CONSULTA DE DATOS A MYSQL
   ========================================================================== */
async function cargarDatos() {
    try {
        const respuesta = await apiFetch(API_URL);
        if (!respuesta.ok) throw new Error(`Código de error del servidor: ${respuesta.status}`);
        
        productosInventario = await respuesta.json();
        console.log("📦 Datos recibidos desde MySQL:", productosInventario);
        
        if (productosInventario.length === 0) {
            sugerenciasCriticas.innerHTML = `<li class="texto-vacio">⚠️ La base de datos no tiene productos registrados.</li>`;
            return;
        }
        
        // 🌟 Carga dinámica de proveedores y renderizado
        cargarSelectProveedores();
        renderizarSugerenciasCriticas();

    } catch (error) {
        console.error('Error cargando datos para pedidos:', error);
        sugerenciasCriticas.innerHTML = `
            <li style="color: #dc3545; font-weight: bold; list-style: none; padding: 10px;">
                ❌ Error de Conexión: No se pudo conectar con el servidor. 
                Asegurate de que "node server.js" esté corriendo.
            </li>`;
    }
}


/* ==========================================================================
   3. SELECTOR DE PROVEEDORES Y SUGERENCIAS FILTRADAS
   ========================================================================== */
function cargarSelectProveedores() {
    if (!selectProveedor) return;

    const proveedoresUnicos = [...new Set(
        productosInventario
            .map(p => p.distribuidor)
            .filter(d => d && d.trim() !== '')
    )].sort();

    selectProveedor.innerHTML = `<option value="TODOS">-- Todos los Proveedores --</option>`;
    
    proveedoresUnicos.forEach(prov => {
        const option = document.createElement('option');
        option.value = prov;
        option.textContent = prov;
        selectProveedor.appendChild(option);
    });
}

function renderizarSugerenciasCriticas() {
    sugerenciasCriticas.innerHTML = '';
    const proveedorSeleccionado = selectProveedor ? selectProveedor.value : 'TODOS';

    let criticos = productosInventario.filter(p => p.stock <= p.stockMinimo);

    if (proveedorSeleccionado !== 'TODOS') {
        criticos = criticos.filter(p => p.distribuidor === proveedorSeleccionado);
    }

    if (criticos.length === 0) {
        sugerenciasCriticas.innerHTML = `<li class="texto-vacio">No hay repuestos bajo el stock mínimo para este proveedor.</li>`;
        return;
    }

    criticos.forEach(p => {
        const li = document.createElement('li');
        const cantidadSugerida = Math.max(1, p.stockMinimo - p.stock);

        li.innerHTML = `
            <div>
                <strong>${escapeHtml(p.nombre)}</strong> <br>
                <small style="color: var(--text-muted);">Stock: ${p.stock} / Mín: ${p.stockMinimo} | Prov: ${escapeHtml(p.distribuidor || 'S/A')}</small>
            </div>
            <button class="btn btn-actualizar" style="padding: 4px 10px; font-size: 0.8rem;" onclick="agregarAlPedido(${p.id}, ${cantidadSugerida})">➕ Añadir</button>
        `;
        sugerenciasCriticas.appendChild(li);
    });
}

// Escuchar cambios de proveedor
if (selectProveedor) {
    selectProveedor.addEventListener('change', () => {
        renderizarSugerenciasCriticas();
        inputBuscar.value = '';
        listaSugerencias.innerHTML = `<p class="texto-vacio">Escribí para buscar repuestos disponibles...</p>`;
    });
}


/* ==========================================================================
   4. BUSCADOR INTERACTIVO EN VIVO
   ========================================================================== */
inputBuscar.addEventListener('input', () => {
    const termino = inputBuscar.value.toLowerCase().trim();
    listaSugerencias.innerHTML = '';

    if (termino === '') {
        listaSugerencias.innerHTML = `<p class="texto-vacio">Escribí para buscar repuestos disponibles...</p>`;
        return;
    }

    const proveedorSeleccionado = selectProveedor ? selectProveedor.value : 'TODOS';

    const filtrados = productosInventario.filter(p => {
        const coincideProveedor = (proveedorSeleccionado === 'TODOS') || (p.distribuidor === proveedorSeleccionado);
        const nombreValido = p.nombre ? p.nombre.toLowerCase().includes(termino) : false;
        const codigo = p.codigoDistribuidor || '';
        const codigoValido = codigo.toLowerCase().includes(termino);
        return coincideProveedor && (nombreValido || codigoValido);
    });

    if (filtrados.length === 0) {
        listaSugerencias.innerHTML = `<p class="texto-vacio">No se encontró ningún repuesto coincidente</p>`;
        return;
    }

    filtrados.forEach(p => {
        const div = document.createElement('div');
        div.className = 'item-busqueda-sugerido';
        div.innerHTML = `
            <div>
                <strong>${escapeHtml(p.nombre)}</strong> <br>
                <small style="color: var(--text-muted);">Cód: ${escapeHtml(p.codigoDistribuidor || 'S/C')} | Prov: ${escapeHtml(p.distribuidor || 'S/A')}</small>
            </div>
            <button class="btn btn-info" style="padding: 4px 8px; font-size: 0.85rem;" onclick="agregarAlPedido(${p.id}, 1)">➕</button>
        `;
        listaSugerencias.appendChild(div);
    });
});


/* ==========================================================================
   5. CONTROL DE LA LISTA DE COMPRAS EN MEMORIA
   ========================================================================== */
function agregarAlPedido(id, cantidad) {
    const p = productosInventario.find(prod => prod.id === id);
    if (!p) return;

    const existe = listaPedidoActual.find(item => item.id === id);
    if (existe) {
        existe.cantidad += cantidad;
    } else {
        listaPedidoActual.push({
            id: p.id,
            nombre: p.nombre,
            codigoDistribuidor: p.codigoDistribuidor || 'N/A',
            distribuidor: p.distribuidor || 'No asignado',
            cantidad: cantidad
        });
    }

    renderizarTablaPedido();
}

function cambiarCantidad(id, nuevaCantidad) {
    const item = listaPedidoActual.find(item => item.id === id);
    if (item) {
        item.cantidad = parseInt(nuevaCantidad) || 1;
    }
}

function eliminarDelPedido(id) {
    listaPedidoActual = listaPedidoActual.filter(item => item.id !== id);
    renderizarTablaPedido();
}

function renderizarTablaPedido() {
    tablaPedidoCuerpo.innerHTML = '';

    if (listaPedidoActual.length === 0) {
        tablaPedidoCuerpo.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;" class="texto-vacio">
                    La lista está vacía. Añadí repuestos desde el panel izquierdo.
                </td>
            </tr>
        `;
        return;
    }

    listaPedidoActual.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${escapeHtml(item.codigoDistribuidor)}</code></td>
            <td><strong>${escapeHtml(item.nombre)}</strong></td>
            <td>${escapeHtml(item.distribuidor)}</td>
            <td>
                <input type="number" min="1" value="${item.cantidad}" 
                    class="input-mini" style="width: 60px; text-align: center;"
                    onchange="cambiarCantidad(${item.id}, this.value)">
            </td>
            <td>
                <button class="btn-tabla btn-eliminar" onclick="eliminarDelPedido(${item.id})">Quitar</button>
            </td>
        `;
        tablaPedidoCuerpo.appendChild(tr);
    });
}

btnVaciar.addEventListener('click', () => {
    if (listaPedidoActual.length === 0) return;
    if (confirm('¿Querés borrar toda la lista actual de pedido?')) {
        listaPedidoActual = [];
        renderizarTablaPedido();
    }
});


/* ==========================================================================
   6. EXPORTAR COMPILADO (WHATSAPP / PORTAPAPELES)
   ========================================================================== */
btnCopiar.addEventListener('click', () => {
    if (listaPedidoActual.length === 0) {
        alert('La lista está vacía.');
        return;
    }

    let textoFormateado = `🛠️ *PEDIDO DE REPUESTOS - SERVICE INTEGRAL*\n`;
    textoFormateado += `-----------------------------------------------\n`;

    listaPedidoActual.forEach(item => {
        textoFormateado += `• [Cant: ${item.cantidad}] - ${item.nombre} (Cód: ${item.codigoDistribuidor}) | Prov: ${item.distribuidor}\n`;
    });

    if (notasPedido.value.trim() !== "") {
        textoFormateado += `\n📝 *Notas:* ${notasPedido.value.trim()}\n`;
    }

    navigator.clipboard.writeText(textoFormateado)
        .then(() => {
            alert('¡Lista formateada copiada al portapapeles! Ya podés pegarla en WhatsApp.');
        })
        .catch(err => {
            console.error('Error al copiar:', err);
            alert('No se pudo copiar automáticamente. Copiá el texto manualmente.');
        });
});


/* ==========================================================================
   7. GUARDAR PEDIDO Y ENVIAR A MYSQL
   ========================================================================== */
btnGuardar.addEventListener('click', async () => {
    if (listaPedidoActual.length === 0) {
        alert('Añadí artículos antes de guardar el pedido.');
        return;
    }

    if (!confirm('¿Querés registrar este pedido en la base de datos?')) return;

    const datosPedido = {
        notas: notasPedido.value.trim() || null,
        items: listaPedidoActual.map(item => ({
            id: item.id,
            cantidad: item.cantidad
        }))
    };

    try {
        const respuesta = await apiFetch(`${window.location.origin}/api/pedidos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosPedido)
        });

        if (respuesta.ok) {
            const data = await respuesta.json();
            alert(`¡Pedido #${data.pedidoId} guardado con éxito en MySQL!`);
            
            obtenerHistorialPedidos();
            listaPedidoActual = [];
            notasPedido.value = '';
            
            renderizarTablaPedido();
            cargarDatos();
        } else {
            alert('Error al intentar guardar el pedido en el servidor.');
        }
    } catch (error) {
        console.error('Error al enviar el pedido:', error);
        alert('No se pudo conectar con el servidor para registrar el pedido.');
    }
});


/* ==========================================================================
   8. HISTORIAL DE PEDIDOS REALIZADOS
   ========================================================================== */
async function obtenerHistorialPedidos() {
    try {
        const respuesta = await apiFetch(`${window.location.origin}/api/pedidos`);
        if (!respuesta.ok) throw new Error('No se pudo conectar para el historial');
        
        const historial = await respuesta.json();
        historialPedidosCache = historial; // guardamos para poder abrir el detalle sin re-pedir ni romper el onclick
        renderizarHistorial(historial);
    } catch (error) {
        console.error('Error al cargar historial:', error);
        tablaHistorialCuerpo.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red; font-weight: bold;">No se pudo cargar el historial de pedidos.</td></tr>`;
    }
}

function renderizarHistorial(lista) {
    tablaHistorialCuerpo.innerHTML = '';

    if (lista.length === 0) {
        tablaHistorialCuerpo.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center;" class="texto-vacio">
                    No hay registros de pedidos en los últimos 2 meses.
                </td>
            </tr>
        `;
        return;
    }

    lista.forEach(ped => {
        const fechaLegible = new Date(ped.fecha).toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>#${ped.id}</strong></td>
            <td>${escapeHtml(fechaLegible)} hs.</td>
            <td><span style="color: var(--text-muted); font-size: 0.9rem;">${escapeHtml(ped.notas || 'Sin anotaciones adicionales')}</span></td>
            <td style="text-align: center;">
                <button class="btn-tabla btn-info btn-svg-icono btn-ver-detalle-pedido" data-id="${ped.id}" style="padding: 4px 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    Ver Detalle
                </button>
            </td>
        `;
        tablaHistorialCuerpo.appendChild(tr);
    });
}


/* ==========================================================================
   9. VENTANA EMERGENTE: DETALLE DE UN COMPROBANTE DE COMPRA
   ========================================================================== */
// Delegación: escuchamos clicks en la tabla de historial en vez de usar onclick inline
// (evita romper el HTML si una nota tiene comillas, y evita XSS al no armar JS con datos del usuario)
tablaHistorialCuerpo.addEventListener('click', (e) => {
    const boton = e.target.closest('.btn-ver-detalle-pedido');
    if (!boton) return;

    const id = parseInt(boton.dataset.id, 10);
    const ped = historialPedidosCache.find(p => p.id === id);
    if (!ped) return;

    const fechaLegible = new Date(ped.fecha).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    verDetallePedido(id, fechaLegible, ped.notas || 'Sin notas.');
});

async function verDetallePedido(id, fecha, notas) {
    document.getElementById('pedido-modal-titulo').textContent = `Detalle del Pedido #${id}`;
    document.getElementById('pedido-modal-fecha').textContent = `Realizado el: ${fecha} hs.`;
    document.getElementById('pedido-modal-notas').textContent = notas;
    
    tablaModalItemsCuerpo.innerHTML = '<tr><td colspan="3" style="text-align: center;">Cargando repuestos...</td></tr>';
    modalDetallePedido.style.display = 'block';

    try {
        const respuesta = await apiFetch(`${window.location.origin}/api/pedidos/${id}/items`);
        if (!respuesta.ok) throw new Error('Error al traer los repuestos');
        
        const items = await respuesta.json();
        tablaModalItemsCuerpo.innerHTML = '';
        
        if (items.length === 0) {
            tablaModalItemsCuerpo.innerHTML = '<tr><td colspan="3" style="text-align: center;" class="texto-vacio">El pedido no tiene artículos activos (pueden haber sido borrados del stock).</td></tr>';
            return;
        }

        items.forEach(it => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(it.nombre || 'Repuesto eliminado')}</strong></td>
                <td><code>${escapeHtml(it.codigoDistribuidor || 'N/A')}</code></td>
                <td style="text-align: center; font-weight: bold;">${it.cantidad} un.</td>
            `;
            tablaModalItemsCuerpo.appendChild(tr);
        });

    } catch (error) {
        console.error(error);
        tablaModalItemsCuerpo.innerHTML = '<tr><td colspan="3" style="text-align: center; color: red; font-weight: bold;">Error al recuperar los artículos.</td></tr>';
    }
}

function cerrarModal(idModal) {
    document.getElementById(idModal).style.display = 'none';
}

window.addEventListener('click', (e) => {
    if (e.target === modalDetallePedido) {
        modalDetallePedido.style.display = 'none';
    }
});


/* ==========================================================================
   10. INTERRUPTOR DE MODO DE COLOR
   ========================================================================== */
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


/* ==========================================================================
   11. INICIALIZACIÓN DE LA PÁGINA
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const temaGuardado = localStorage.getItem('tema-preferido');
    if (temaGuardado === 'claro') {
        document.body.classList.add('tema-claro');
    } else {
        document.body.classList.remove('tema-claro');
    }

    cargarDatos();
    obtenerHistorialPedidos();
});