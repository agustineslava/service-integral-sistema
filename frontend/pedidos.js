// Servidor local de Node.js
const API_URL = 'http://127.0.0.1:3000/api/productos';
// Elementos del DOM
const inputBuscar = document.getElementById('buscar-pedido-art');
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
// Arrays globales
let productosInventario = [];
let listaPedidoActual = []; // Guarda los artículos añadidos al pedido

// 1. INICIALIZAR: CARGAR PRODUCTOS DESDE MYSQL
async function cargarDatos() {
    try {
        const respuesta = await fetch(API_URL);
        if (!respuesta.ok) throw new Error(`Código de error del servidor: ${respuesta.status}`);
        
        productosInventario = await respuesta.json();
        
        console.log("📦 Datos recibidos desde MySQL:", productosInventario);
        
        if (productosInventario.length === 0) {
            sugerenciasCriticas.innerHTML = `<li class="texto-vacio">⚠️ La base de datos no tiene productos registrados.</li>`;
            return;
        }
        
        renderizarSugerenciasCriticas();
    } catch (error) {
        console.error('Error cargando datos para pedidos:', error);
        sugerenciasCriticas.innerHTML = `<li style="color: #dc3545; font-weight: bold;">❌ Error de Conexión: No se pudo conectar con el servidor en 127.0.0.1:3000. Asegurate de que node server.js esté corriendo.</li>`;
    }
}

// 2. RENDERIZAR SUGERENCIAS AUTOMÁTICAS (STOCK CRÍTICO)
function renderizarSugerenciasCriticas() {
    sugerenciasCriticas.innerHTML = '';
    
    const criticos = productosInventario.filter(p => p.stock <= p.stockMinimo);

    if (criticos.length === 0) {
        sugerenciasCriticas.innerHTML = `<li class="texto-vacio">Todo al día. No hay repuestos bajo el stock mínimo.</li>`;
        return;
    }

    criticos.forEach(p => {
        const li = document.createElement('li');
        const cantidadSugerida = Math.max(1, p.stockMinimo - p.stock);

        li.innerHTML = `
            <div>
                <strong>${p.nombre}</strong> <br>
                <small style="color: #6c757d;">Stock: ${p.stock} / Mín: ${p.stockMinimo}</small>
            </div>
            <button class="btn btn-actualizar" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="agregarAlPedido(${p.id}, ${cantidadSugerida})">➕ Añadir</button>
        `;
        sugerenciasCriticas.appendChild(li);
    });
}

// 3. BUSCADOR EN VIVO DE REPUESTOS
inputBuscar.addEventListener('input', () => {
    const termino = inputBuscar.value.toLowerCase().trim();
    listaSugerencias.innerHTML = '';

    if (termino === '') {
        listaSugerencias.innerHTML = `<p class="texto-vacio">Escribí para buscar repuestos disponibles...</p>`;
        return;
    }

    const filtrados = productosInventario.filter(p => {
        const nombreValido = p.nombre ? p.nombre.toLowerCase().includes(termino) : false;
        const codigo = p.codigoDistribuidor || '';
        const codigoValido = codigo.toLowerCase().includes(termino);
        return nombreValido || codigoValido;
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
                <strong>${p.nombre}</strong> <br>
                <small>Cód: ${p.codigoDistribuidor || 'S/C'} | Proveedor: ${p.distribuidor || 'S/A'}</small>
            </div>
            <button class="btn btn-info" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="agregarAlPedido(${p.id}, 1)">➕</button>
        `;
        listaSugerencias.appendChild(div);
    });
});

// 4. AÑADIR UN ARTÍCULO A LA LISTA DE COMPRAS
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

// 5. CAMBIAR CANTIDAD MANUALMENTE EN LA TABLA
function cambiarCantidad(id, nuevaCantidad) {
    const item = listaPedidoActual.find(item => item.id === id);
    if (item) {
        item.cantidad = parseInt(nuevaCantidad) || 1;
    }
}

// 6. QUITAR UN ARTÍCULO DE LA LISTA
function eliminarDelPedido(id) {
    listaPedidoActual = listaPedidoActual.filter(item => item.id !== id);
    renderizarTablaPedido();
}

// 7. RENDERIZAR LA TABLA DE PEDIDO ACTUAL
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
            <td><code>${item.codigoDistribuidor}</code></td>
            <td><strong>${item.nombre}</strong></td>
            <td>${item.distribuidor}</td>
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

// 8. VACIAR TODA LA LISTA
btnVaciar.addEventListener('click', () => {
    if (listaPedidoActual.length === 0) return;
    if (confirm('¿Querés borrar toda la lista actual de pedido?')) {
        listaPedidoActual = [];
        renderizarTablaPedido();
    }
});

// 9. 📋 COPIAR LISTA FORMATEADA PARA WHATSAPP / MAIL
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
            alert('¡Lista copiada al portapapeles!');
        })
        .catch(err => {
            console.error('Error al copiar:', err);
            alert('No se pudo copiar automáticamente. Copiá el texto manualmente.');
        });
});

// 10. 💾 GUARDAR PEDIDO REAL EN MYSQL
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
        const respuesta = await fetch('http://127.0.0.1:3000/api/pedidos', {
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
            cargarDatos(); // Volvemos a consultar para refrescar las sugerencias críticas
        } else {
            alert('Error al intentar guardar el pedido en el servidor.');
        }
    } catch (error) {
        console.error('Error al enviar el pedido:', error);
        alert('No se pudo conectar con el servidor para registrar el pedido.');
    }
});

// 11. CARGAR Y MOSTRAR EL HISTORIAL DE PEDIDOS
async function obtenerHistorialPedidos() {
    try {
        const respuesta = await fetch('http://127.0.0.1:3000/api/pedidos');
        if (!respuesta.ok) throw new Error('No se pudo conectar para el historial');
        
        const historial = await respuesta.json();
        renderizarHistorial(historial);
    } catch (error) {
        console.error('Error al cargar historial:', error);
        tablaHistorialCuerpo.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">No se pudo cargar el historial de pedidos.</td></tr>`;
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
        // Formateamos la fecha a algo legible en Argentina
        const fechaLegible = new Date(ped.fecha).toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>#${ped.id}</strong></td>
            <td>${fechaLegible} hs.</td>
            <td><span style="color: #6c757d; font-size: 0.9rem;">${ped.notas || 'Sin anotaciones adicionales'}</span></td>
            <td style="text-align: center;">
                <button class="btn-tabla btn-info" onclick="verDetallePedido(${ped.id}, '${fechaLegible}', '${ped.notas || 'Sin notas.'}')">Ver Detalle</button>
            </td>
        `;
        tablaHistorialCuerpo.appendChild(tr);
    });
}

// 12. VER DETALLE DE UN PEDIDO PASADO EN LA MODAL
async function verDetallePedido(id, fecha, notas) {
    document.getElementById('pedido-modal-titulo').textContent = `Detalle del Pedido #${id}`;
    document.getElementById('pedido-modal-fecha').textContent = `Realizado el: ${fecha} hs.`;
    document.getElementById('pedido-modal-notas').textContent = notas;
    
    tablaModalItemsCuerpo.innerHTML = '<tr><td colspan="3" style="text-align: center;">Cargando repuestos...</td></tr>';
    modalDetallePedido.style.display = 'block';

    try {
        const respuesta = await fetch(`http://127.0.0.1:3000/api/pedidos/${id}/items`);
        if (!respuesta.ok) throw new Error('Error al traer los repuestos');
        
        const items = await respuesta.json();
        
        tablaModalItemsCuerpo.innerHTML = '';
        if (items.length === 0) {
            tablaModalItemsCuerpo.innerHTML = '<tr><td colspan="3" style="text-align: center;" class="texto-vacio">El pedido no tiene artículos registrados (pueden haber sido eliminados del stock).</td></tr>';
            return;
        }

        items.forEach(it => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${it.nombre || 'Repuesto eliminado'}</strong></td>
                <td><code>${it.codigoDistribuidor || 'N/A'}</code></td>
                <td style="text-align: center;">${it.cantidad} un.</td>
            `;
            tablaModalItemsCuerpo.appendChild(tr);
        });

    } catch (error) {
        console.error(error);
        tablaModalItemsCuerpo.innerHTML = '<tr><td colspan="3" style="text-align: center; color: red;">Error al recuperar los artículos.</td></tr>';
    }
}

// 🌟 FUNCIÓN PARA CERRAR VENTANAS MODALES EN PEDIDOS
function cerrarModal(idModal) {
    document.getElementById(idModal).style.display = 'none';
}

// Permitir cerrar también si el usuario hace clic afuera de la caja blanca del modal
window.addEventListener('click', (e) => {
    const modal = document.getElementById('modal-detalle-pedido');
    if (e.target === modal) {
        modal.style.display = 'none';
    }
});

// 🌟 ARRANQUE COMPLETO
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();             // Carga sugerencias y buscador
    obtenerHistorialPedidos(); // Carga la tabla de pedidos históricos abajo de todo
});