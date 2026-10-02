/* ==========================================================================
   1. CONFIGURACIÓN GLOBAL Y VARIABLES DE ESTADO
   ========================================================================== */
const API_URL = `${window.location.origin}/api/productos`;

const tablaCuerpo = document.getElementById('tabla-cuerpo');
const inputBuscador = document.getElementById('input-buscador');
const filtroEstado = document.getElementById('select-filtro-estado');
const filtroCategoria = document.getElementById('select-filtro-categoria');
const selectOrdenar = document.getElementById('select-ordenar');
const formProducto = document.getElementById('form-producto');
const alertaStock = document.getElementById('alerta-stock-minimo');
const listaCritica = document.getElementById('lista-critica');
const modalInfo = document.getElementById('modal-info');

// Paginación y control server-side
let paginaActual = 1;
let totalPaginas = 1;
const limitePorPagina = 50;
let timeoutBusqueda = null;

let productosLocales = [];
let idProductoSeleccionado = null;

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
   2. RENDIMIENTO: CARGA PAGINADA DIRECTA DESDE MYSQL
   ========================================================================== */

async function obtenerProductos(pagina = 1) {
    paginaActual = pagina;
    const termino = (inputBuscador.value || '').trim();
    const estado = filtroEstado ? filtroEstado.value : 'TODOS';
    const categoria = filtroCategoria ? filtroCategoria.value : 'TODAS';
    const orden = selectOrdenar ? selectOrdenar.value : 'id_desc';

    let url = `${API_URL}?page=${paginaActual}&limit=${limitePorPagina}&estado=${encodeURIComponent(estado)}&categoria=${encodeURIComponent(categoria)}&orden=${encodeURIComponent(orden)}`;
    if (termino !== '') {
        url += `&buscar=${encodeURIComponent(termino)}`;
    }

    try {
        const respuesta = await apiFetch(url);
        if (!respuesta.ok) throw new Error('Error al conectar con el servidor');
        
        const data = await respuesta.json();

        // El backend devuelve { productos, total, pagina, totalPaginas }
        if (data.productos) {
            productosLocales = data.productos;
            totalPaginas = data.totalPaginas || 1;
            renderizarTabla(productosLocales);
            actualizarControlesPaginacion(data.total);
        } else {
            // Compatibilidad si devolviese array plano
            productosLocales = data;
            renderizarTabla(productosLocales);
        }

    } catch (error) {
        console.error('Error cargando inventario:', error);
        tablaCuerpo.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red;">Fallo al conectar con el servidor.</td></tr>`;
    }
}

function actualizarControlesPaginacion(totalRegistros) {
    const infoPaginacion = document.getElementById('info-paginacion');
    const btnAnterior = document.getElementById('btn-pagina-anterior');
    const btnSiguiente = document.getElementById('btn-pagina-siguiente');

    if (infoPaginacion) {
        infoPaginacion.textContent = `Página ${paginaActual} de ${totalPaginas} (${totalRegistros || 0} repuestos en total)`;
    }
    if (btnAnterior) {
        btnAnterior.disabled = paginaActual <= 1;
    }
    if (btnSiguiente) {
        btnSiguiente.disabled = paginaActual >= totalPaginas;
    }
}

document.getElementById('btn-pagina-anterior')?.addEventListener('click', () => {
    if (paginaActual > 1) obtenerProductos(paginaActual - 1);
});

document.getElementById('btn-pagina-siguiente')?.addEventListener('click', () => {
    if (paginaActual < totalPaginas) obtenerProductos(paginaActual + 1);
});

/**
 * Renderiza la tabla HTML
 */
function renderizarTabla(lista) {
    tablaCuerpo.innerHTML = '';
    
    if (lista.length === 0) {
        tablaCuerpo.innerHTML = `<tr><td colspan="8" style="text-align:center;">No se encontraron artículos</td></tr>`;
        return;
    }

    lista.forEach(p => {
        const tr = document.createElement('tr');
        if (p.stock <= p.stockMinimo) {
            tr.classList.add('fila-alerta-critica'); 
        }

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${escapeHtml(p.nombre)}</strong></td>
            <td>$${parseFloat(p.precio).toFixed(2)}</td>
            <td><strong>${p.stock}</strong></td>
            <td>${p.stockMinimo}</td>
            <td>${escapeHtml(p.distribuidor || 'No asignado')}</td>
            <td><code class="cod-repuesto">${escapeHtml(p.codigoDistribuidor || 'N/A')}</code></td>
            <td>
                <div class="celda-acciones">
                    <button class="btn-tabla btn-info btn-accion-info" data-id="${p.id}">Info</button>
                    <button class="btn-tabla btn-actualizar btn-accion-actualizar" data-id="${p.id}">Actualizar</button>
                    <button class="btn-tabla btn-actualizar btn-accion-etiqueta" data-id="${p.id}" style="background-color: #6f42c1;" title="Imprimir código de barras">Etiqueta</button>
                    <button class="btn-tabla btn-eliminar btn-accion-eliminar" data-id="${p.id}">Eliminar</button>
                </div>
            </td>
        `;
        tablaCuerpo.appendChild(tr);
    });
}

tablaCuerpo.addEventListener('click', (e) => {
    const boton = e.target.closest('.btn-tabla');
    if (!boton) return; 

    const id = parseInt(boton.getAttribute('data-id'));
    if (!id) return;

    if (boton.classList.contains('btn-accion-info')) {
        verDetalle(id);
    } else if (boton.classList.contains('btn-accion-actualizar')) {
        prepararActualizacion(id);
    } else if (boton.classList.contains('btn-accion-eliminar')) {
        eliminarProducto(id);
    } else if (boton.classList.contains('btn-accion-etiqueta')) {
        abrirModalEtiqueta(id);
    }
});

/* ==========================================================================
   3. FILTROS Y BÚSQUEDA REACTIVA CON DEBOUNCE (SERVER-SIDE)
   ========================================================================== */
inputBuscador.addEventListener('input', () => {
    clearTimeout(timeoutBusqueda);
    timeoutBusqueda = setTimeout(() => obtenerProductos(1), 300);
});

if (filtroEstado) filtroEstado.addEventListener('change', () => obtenerProductos(1));
if (filtroCategoria) filtroCategoria.addEventListener('change', () => obtenerProductos(1));
if (selectOrdenar) selectOrdenar.addEventListener('change', () => obtenerProductos(1));

/* ==========================================================================
   4. ALERTA DE STOCK CRÍTICO (CONSULTA LIVIANA INDEPENDIENTE)
   ========================================================================== */
async function verificarStockMinimo() {
    try {
        const respuesta = await apiFetch(`${API_URL}?estado=BAJO_MINIMO&limit=50`);
        if (!respuesta.ok) return;
        const criticos = await respuesta.json();

        listaCritica.innerHTML = '';
        if (Array.isArray(criticos) && criticos.length > 0) {
            criticos.forEach(p => {
                const li = document.createElement('li');
                li.textContent = `${p.nombre} (Stock actual: ${p.stock} un. / Mínimo requerido: ${p.stockMinimo} un.) - Cód: ${p.codigoDistribuidor || 'S/C'}`;
                listaCritica.appendChild(li);
            });
            alertaStock.style.display = 'block';
        } else {
            alertaStock.style.display = 'none';
        }
    } catch (e) {
        console.warn('No se pudo comprobar el stock mínimo:', e);
    }
}

async function cargarProveedoresDatalist() {
    const datalist = document.getElementById('lista-proveedores-existentes');
    if (!datalist) return;
    try {
        const res = await apiFetch('/api/productos/proveedores');
        if (!res.ok) return;
        const proveedores = await res.json();
        datalist.innerHTML = proveedores.map(prov => `<option value="${escapeHtml(prov)}"></option>`).join('');
    } catch (e) {
        console.warn('Error al cargar proveedores:', e);
    }
}

/* ==========================================================================
   5. MÓDULO DE DETALLE (MODAL INFO)
   ========================================================================== */
function verDetalle(id) {
    const p = productosLocales.find(prod => prod.id === id);
    if (!p) return;
    
    idProductoSeleccionado = id;

    document.getElementById('modal-titulo').textContent = `Detalles del Producto: ${p.nombre}`;
    document.getElementById('info-nombre').textContent = p.nombre;
    document.getElementById('info-precio').textContent = parseFloat(p.precio).toFixed(2);
    document.getElementById('info-stock').textContent = p.stock;
    document.getElementById('info-proveedor').textContent = p.distribuidor || 'No asignado';
    document.getElementById('info-codigo').textContent = p.codigoDistribuidor || 'N/A';
    document.getElementById('info-descripcion').textContent = p.descripcion || 'Sin descripción adicional';

    document.getElementById('info-stock-min-input').value = p.stockMinimo;
    document.getElementById('info-stock-min-input').disabled = true; 
    document.getElementById('btn-modificar-minimo').textContent = 'Modificar stock mínimo'; 
    document.getElementById('btn-modificar-minimo').style.backgroundColor = ''; 

    for (let i = 1; i <= 3; i++) {
        const urlImagen = p[`imagen_${i}`];
        const imgDetalle = document.getElementById(`img-detalle-${i}`);
        const btnZoomInfo = document.getElementById(`btn-zoom-info-${i}`);

        if (urlImagen) {
            imgDetalle.src = urlImagen;
            imgDetalle.style.display = 'block';
            btnZoomInfo.style.display = 'flex'; 
        } else {
            imgDetalle.src = '';
            imgDetalle.style.display = 'none';
            btnZoomInfo.style.display = 'none'; 
        }
    }

    modalInfo.style.display = 'block';
}

document.getElementById('btn-modificar-minimo').addEventListener('click', async function() {
    if (!idProductoSeleccionado) return;
    
    const inputMinimo = document.getElementById('info-stock-min-input');
    const botonMinimo = this; 

    if (inputMinimo.disabled) {
        inputMinimo.disabled = false;
        inputMinimo.focus(); 
        inputMinimo.select(); 
        botonMinimo.textContent = 'Guardar stock mínimo'; 
    } else {
        const nuevoMinimo = parseInt(inputMinimo.value) || 0;

        try {
            const respuesta = await apiFetch(`${API_URL}/${idProductoSeleccionado}/stock-minimo`, {
                method: 'POST', 
                body: JSON.stringify({ stockMinimo: nuevoMinimo })
            });

            if (respuesta.ok) {
                alert('¡Límite de stock mínimo actualizado!');
                inputMinimo.disabled = true;
                botonMinimo.textContent = 'Modificar stock mínimo';
                botonMinimo.style.backgroundColor = ''; 
                cerrarModal('modal-info');
                obtenerProductos(paginaActual);
                verificarStockMinimo();
            } else {
                alert('Error al guardar el stock mínimo.');
            }
        } catch (error) {
            console.error('Error al actualizar el mínimo:', error);
        }
    }
});

/* ==========================================================================
   6. MÓDULO DE GESTIÓN Y EDICIÓN (C.R.U.D.)
   ========================================================================== */
async function prepararActualizacion(id) {
    const p = productosLocales.find(prod => prod.id === id);
    if (!p) return;
    idProductoSeleccionado = id;

    document.getElementById('edit-nombre').value = p.nombre;
    document.getElementById('edit-precio').value = p.precio;
    document.getElementById('edit-stock').value = p.stock;
    document.getElementById('edit-stockMinimo').value = p.stockMinimo || 0;
    document.getElementById('edit-categoria').value = p.categoria || 'Otros';
    document.getElementById('edit-distribuidor').value = p.distribuidor || '';
    document.getElementById('edit-codigo').value = p.codigoDistribuidor || '';
    document.getElementById('edit-descripcion').value = p.descripcion || '';

    for (let i = 1; i <= 3; i++) {
        const urlImagen = p[`imagen_${i}`];
        const previewImg = document.getElementById(`edit-preview-${i}`);
        const placeholder = previewImg.parentElement.querySelector('.placeholder-vacio');
        const btnLupa = previewImg.parentElement.querySelector('.btn-lupa-zoom');
        const hiddenInput = document.getElementById(`edit-img-url-${i}`);

        if (urlImagen) {
            previewImg.src = urlImagen;
            previewImg.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            if (btnLupa) btnLupa.style.display = 'flex';
            hiddenInput.value = urlImagen;
        } else {
            previewImg.src = '';
            previewImg.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
            if (btnLupa) btnLupa.style.display = 'none';
            hiddenInput.value = '';
        }
    }

    document.getElementById('form-editar-producto').setAttribute('data-id', id);
    document.getElementById('modal-editar').style.display = 'block';
}

document.getElementById('btn-modificar-datos').addEventListener('click', () => {
    if (idProductoSeleccionado) prepararActualizacion(idProductoSeleccionado);
});

document.getElementById('form-editar-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = e.target.getAttribute('data-id');

    const datosActualizados = {
        nombre: capitalizarPrimeraLetra(document.getElementById('edit-nombre').value),
        precio: parseFloat(document.getElementById('edit-precio').value) || 0.00,
        stock: parseInt(document.getElementById('edit-stock').value) || 0,
        stockMinimo: parseInt(document.getElementById('edit-stockMinimo').value) || 0,
        categoria: document.getElementById('edit-categoria').value,
        distribuidor: capitalizarPrimeraLetra(document.getElementById('edit-distribuidor').value),
        descripcion: capitalizarPrimeraLetra(document.getElementById('edit-descripcion').value),
        codigoDistribuidor: document.getElementById('edit-codigo').value ? document.getElementById('edit-codigo').value.trim().toUpperCase() : null,
        imagen_1: document.getElementById('edit-img-url-1').value || null,
        imagen_2: document.getElementById('edit-img-url-2').value || null,
        imagen_3: document.getElementById('edit-img-url-3').value || null
    };

    try {
        const respuesta = await apiFetch(`${API_URL}/${id}`, {
            method: 'PUT',
            body: JSON.stringify(datosActualizados)
        });

        if (respuesta.ok) {
            alert('¡Producto actualizado con éxito!');
            cerrarModal('modal-editar');
            obtenerProductos(paginaActual);
            verificarStockMinimo();
        } else {
            const data = await respuesta.json();
            alert(data.error || 'Error al actualizar el producto.');
        }
    } catch (error) {
        console.error('Error al guardar cambios:', error);
        alert('No se pudo conectar con el servidor.');
    }
});

formProducto.addEventListener('submit', async (e) => {
    e.preventDefault();
    const precioInput = document.getElementById('precio').value;
    const distribuidorInput = document.getElementById('distribuidor').value;
    const codigoInput = document.getElementById('codigoDistribuidor').value;
    const descripcionInput = document.getElementById('descripcion').value;

    const nuevoProducto = {
        nombre: capitalizarPrimeraLetra(document.getElementById('nombre').value),
        precio: precioInput ? parseFloat(precioInput) : 0.00,
        stock: parseInt(document.getElementById('stock').value) || 0,
        stockMinimo: parseInt(document.getElementById('stockMinimo').value) || 0,
        categoria: document.getElementById('categoria').value,
        distribuidor: capitalizarPrimeraLetra(distribuidorInput),
        descripcion: capitalizarPrimeraLetra(descripcionInput),
        codigoDistribuidor: codigoInput.trim() !== "" ? codigoInput.trim().toUpperCase() : null,
        imagen_1: document.getElementById('crear-img-url-1').value || null,
        imagen_2: document.getElementById('crear-img-url-2').value || null,
        imagen_3: document.getElementById('crear-img-url-3').value || null
    };

    try {
        const respuesta = await apiFetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(nuevoProducto)
        });

        if (respuesta.ok) {
            alert('¡Producto registrado con éxito!');
            formProducto.reset();
            eliminarFotoCrear(1);
            eliminarFotoCrear(2);
            eliminarFotoCrear(3);
            obtenerProductos(1);
            verificarStockMinimo();
            cargarProveedoresDatalist();
        } else {
            const data = await respuesta.json();
            alert(data.error || 'Error al guardar el producto.');
        }
    } catch (error) {
        console.error('Error en la petición de guardado:', error);
    }
});

async function eliminarProducto(id) {
    if (!confirm('¿Seguro que querés eliminar este repuesto del stock?')) return;

    const productoABorrar = productosLocales.find(p => p.id === id);

    try {
        if (productoABorrar) {
            const fotosABorrar = [productoABorrar.imagen_1, productoABorrar.imagen_2, productoABorrar.imagen_3];
            for (const urlFoto of fotosABorrar) {
                if (urlFoto && urlFoto.trim() !== "") {
                    try {
                        await apiFetch('/api/delete-image', {
                            method: 'POST',
                            body: JSON.stringify({ imageUrl: urlFoto })
                        });
                    } catch (errFoto) {
                        console.error('No se pudo borrar imagen en Cloudinary:', errFoto);
                    }
                }
            }
        }

        const respuesta = await apiFetch(`${API_URL}/${id}`, { method: 'DELETE' });
        if (respuesta.ok) {
            alert('Artículo y sus archivos multimedia eliminados.');
            obtenerProductos(paginaActual);
            verificarStockMinimo();
        } else {
            alert('No se pudo eliminar el artículo.');
        }
    } catch (error) {
        console.error('Error al borrar:', error);
    }
}

/* ==========================================================================
   7. GESTIÓN FOTOGRÁFICA
   ========================================================================== */
async function subirFotoDirecto(slotNum, contexto = 'crear', evento) {
    if (evento) {
        evento.preventDefault();
        evento.stopPropagation();
    }
    const inputElement = document.getElementById(`file-${contexto}-${slotNum}`);
    const previewImg = document.getElementById(`${contexto}-preview-${slotNum}`);
    const placeholder = previewImg.parentElement.querySelector('.placeholder-vacio');
    const btnLupa = previewImg.parentElement.querySelector('.btn-lupa-zoom');
    const hiddenUrlInput = document.getElementById(`${contexto}-img-url-${slotNum}`);
    
    const file = inputElement.files[0];
    if (!file) return;

    previewImg.style.opacity = '0.5';
    
    try {
        const fotoComprimida = await comprimirImagen(file, 200);
        const formData = new FormData();
        formData.append('imagen', fotoComprimida);

        const respuesta = await apiFetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!respuesta.ok) throw new Error('Fallo al subir archivo');
        const resultado = await respuesta.json();
        
        hiddenUrlInput.value = resultado.url;
        previewImg.src = resultado.url;
        previewImg.style.display = 'block';
        previewImg.style.opacity = '1';
        if (placeholder) placeholder.style.display = 'none';
        if (btnLupa) btnLupa.style.display = 'flex';

    } catch (error) {
        console.error('Error al subir:', error);
        alert('No se pudo subir la imagen.');
        resetearSlot(slotNum, contexto);
    }
}

async function resetearSlot(slotNum, contexto) {
    const previewImg = document.getElementById(`${contexto}-preview-${slotNum}`);
    const placeholder = previewImg.parentElement.querySelector('.placeholder-vacio');
    const btnLupa = previewImg.parentElement.querySelector('.btn-lupa-zoom');
    const hiddenUrlInput = document.getElementById(`${contexto}-img-url-${slotNum}`);
    const fileInput = document.getElementById(`file-${contexto}-${slotNum}`);

    const urlEliminar = hiddenUrlInput.value;

    if (urlEliminar && urlEliminar.trim() !== "" && !urlEliminar.includes('placeholder')) {
        try {
            await apiFetch('/api/delete-image', {
                method: 'POST',
                body: JSON.stringify({ imageUrl: urlEliminar })
            });
        } catch (error) {
            console.error('Error al borrar foto física:', error);
        }
    }

    previewImg.src = '';
    previewImg.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    if (btnLupa) btnLupa.style.display = 'none';
    hiddenUrlInput.value = '';
    if (fileInput) fileInput.value = '';
}

function eliminarFotoCrear(slotNum) { resetearSlot(slotNum, 'crear'); }
function eliminarFotoSlot(slotNum) { resetearSlot(slotNum, 'edit'); }

function abrirZoom(imgElementId) {
    const srcImgOriginal = document.getElementById(imgElementId).src;
    if (!srcImgOriginal || srcImgOriginal.includes('placeholder') || srcImgOriginal === window.location.href) return;
    const modalVisor = document.getElementById('modal-zoom-visor');
    const imgGigante = document.getElementById('imagen-zoom-gigante');
    imgGigante.src = srcImgOriginal;
    modalVisor.style.display = 'flex';
}

function cerrarZoom() {
    document.getElementById('modal-zoom-visor').style.display = 'none';
}

function capitalizarPrimeraLetra(texto) {
    if (!texto) return null;
    const limpio = texto.trim();
    if (limpio === '') return null;
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function cerrarModal(idModal) {
    document.getElementById(idModal).style.display = 'none';
}

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});


/* ==========================================================================
   8. EXPORTACIÓN A EXCEL (CSV)
   ========================================================================== */
const btnExportarCSV = document.getElementById('btn-exportar-csv');
if (btnExportarCSV) {
    btnExportarCSV.addEventListener('click', async () => {
        try {
            // Trae todo el inventario sin paginar exclusivamente para la descarga del archivo
            const res = await apiFetch(`${API_URL}?limit=5000`);
            if (!res.ok) throw new Error('Error al descargar catálogo');
            const listaCompleta = await res.json();

            if (!listaCompleta || listaCompleta.length === 0) {
                alert('No hay productos cargados en el inventario para exportar.');
                return;
            }

            const encabezados = ['ID', 'Nombre', 'Precio Costo ($)', 'Stock Actual', 'Stock Minimo', 'Categoria', 'Proveedor', 'Codigo Distribuidor', 'Descripcion'];
            const filas = listaCompleta.map(p => [
                p.id,
                `"${(p.nombre || '').replace(/"/g, '""')}"`,
                Number(p.precio || 0).toFixed(2),
                p.stock,
                p.stockMinimo,
                `"${(p.categoria || 'Otros').replace(/"/g, '""')}"`,
                `"${(p.distribuidor || 'No asignado').replace(/"/g, '""')}"`,
                `"${(p.codigoDistribuidor || 'N/A').replace(/"/g, '""')}"`,
                `"${(p.descripcion || '').replace(/"/g, '""')}"`
            ]);

            const contenidoCSV = [encabezados.join(';'), ...filas.map(f => f.join(';'))].join('\r\n');
            const blob = new Blob(['\uFEFF' + contenidoCSV], { type: 'text/csv;charset=utf-8;' });
            const enlaceDescarga = document.createElement('a');
            const fechaHoy = new Date().toISOString().slice(0, 10);
            
            enlaceDescarga.href = URL.createObjectURL(blob);
            enlaceDescarga.setAttribute('download', `Inventario_Stock_${fechaHoy}.csv`);
            document.body.appendChild(enlaceDescarga);
            enlaceDescarga.click();
            document.body.removeChild(enlaceDescarga);
            URL.revokeObjectURL(enlaceDescarga.href);
        } catch (e) {
            alert('Error al exportar inventario.');
        }
    });
}

function abrirModalEtiqueta(id) {
    const prod = productosLocales.find(p => p.id === id);
    if (!prod) return;

    const nombreComercio = document.querySelector('.login-titulo')?.textContent || 'Service Integral';
    document.getElementById('etiqueta-comercio').textContent = nombreComercio;
    document.getElementById('etiqueta-nombre').textContent = prod.nombre;
    document.getElementById('etiqueta-codigo').textContent = `COD: ${prod.codigoDistribuidor || 'S/C'}`;
    document.getElementById('etiqueta-distribuidor').textContent = `Proveedor: ${prod.distribuidor || 'No asignado'}`;

    const valorBarra = (prod.codigoDistribuidor && prod.codigoDistribuidor.trim() !== '') 
        ? prod.codigoDistribuidor.trim() 
        : `ART-${String(prod.id).padStart(6, '0')}`;

    try {
        JsBarcode("#codigo-barras-svg", valorBarra, {
            format: "CODE128",
            lineColor: "#000",
            width: 2,
            height: 48,
            displayValue: true,
            fontSize: 13,
            font: "monospace"
        });
    } catch (e) {
        console.warn("Fallo al generar código de barras:", e);
    }

    document.getElementById('modal-etiqueta').style.display = 'block';
}

function imprimirEtiquetaModal() {
    const contenido = document.getElementById('area-etiqueta-imprimible').innerHTML;
    const ventanaImpresion = window.open('', '_blank', 'width=450,height=450');
    ventanaImpresion.document.write(`
        <html>
            <head>
                <title>Imprimir Etiqueta</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 20px; }
                    h2, h3, p { margin: 4px 0; }
                    svg { max-width: 100%; height: auto; }
                </style>
            </head>
            <body onload="window.print(); window.close();">
                ${contenido}
            </body>
        </html>
    `);
    ventanaImpresion.document.close();
}

const btnVerMovimientos = document.getElementById('btn-ver-movimientos');
if (btnVerMovimientos) {
    btnVerMovimientos.addEventListener('click', async () => {
        const tbody = document.getElementById('tabla-movimientos-cuerpo');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Consultando registros...</td></tr>';
        document.getElementById('modal-movimientos').style.display = 'block';

        try {
            const res = await apiFetch('/api/movimientos-stock');
            if (!res.ok) throw new Error('Error al cargar movimientos');
            const data = await res.json();

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No hay movimientos registrados.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(m => {
                const fecha = new Date(m.fecha).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
                return `
                    <tr>
                        <td><small>${fecha}</small></td>
                        <td><strong>${m.producto_nombre}</strong></td>
                        <td><span class="badge-online" style="background-color: ${m.tipo === 'VENTA' ? 'var(--color-danger)' : 'var(--color-success)'}">${m.tipo}</span></td>
                        <td>${m.cantidad_afectada} un.</td>
                        <td><strong>${m.stock_resultante} un.</strong></td>
                        <td>${m.usuario_nombre}</td>
                        <td><small>${m.motivo || 'Sin nota'}</small></td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: red;">No se pudo conectar con el servidor.</td></tr>';
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    obtenerProductos(1);
    verificarStockMinimo();
    cargarProveedoresDatalist();
});