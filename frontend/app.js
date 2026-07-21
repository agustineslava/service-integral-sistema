/* ==========================================================================
   1. CONFIGURACIÓN GLOBAL Y VARIABLES DE ESTADO
   ========================================================================== */
// URL base de la API en el backend local
const API_URL = 'http://localhost:3000/api/productos';

// Elementos de la interfaz (DOM)
const tablaCuerpo = document.getElementById('tabla-cuerpo');
const inputBuscador = document.getElementById('input-buscador');
const selectFiltro = document.getElementById('select-filtro');
const formProducto = document.getElementById('form-producto');
const alertaStock = document.getElementById('alerta-stock-minimo');
const listaCritica = document.getElementById('lista-critica');
const modalInfo = document.getElementById('modal-info');

// Array local para almacenar la copia de los productos de la base de datos
let productosLocales = [];
// ID del producto que está siendo seleccionado para Ver Detalle o Modificar
let idProductoSeleccionado = null;


/* ==========================================================================
   2. RENDIMIENTO Y CONTROL DE LA TABLA PRINCIPAL
   ========================================================================== */

/**
 * Consulta la API para traer todos los repuestos registrados en MySQL
 */
async function obtenerProductos() {
    try {
        const respuesta = await fetch(API_URL);
        if (!respuesta.ok) throw new Error('Error al conectar con el servidor');
        
        productosLocales = await respuesta.json();
        renderizarTabla(productosLocales);
        verificarStockMinimo(productosLocales);
        actualizarSugerenciasProveedores();
    } catch (error) {
        console.error('Error cargando inventario:', error);
    }
}

/**
 * Genera el cuerpo dinámico de la tabla HTML con los productos cargados
 * @param {Array} lista - Listado de productos a renderizar
 */
function renderizarTabla(lista) {
    tablaCuerpo.innerHTML = ''; // Limpiar las filas viejas del inventario
    
    if (lista.length === 0) {
        tablaCuerpo.innerHTML = `<tr><td colspan="8" style="text-align:center;">No se encontraron artículos</td></tr>`;
        return;
    }

    lista.forEach(p => {
        const tr = document.createElement('tr');
        
        // 🌟 CLASE ADAPTATIVA: Si el stock actual es crítico, añadimos la clase de alerta CSS
        if (p.stock <= p.stockMinimo) {
            tr.classList.add('fila-alerta-critica'); 
        }

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${p.nombre}</strong></td>
            <td>$${parseFloat(p.precio).toFixed(2)}</td>
            <td><strong>${p.stock}</strong></td>
            <td>${p.stockMinimo}</td>
            <td>${p.distribuidor || 'No asignado'}</td>
            <td><code class="cod-repuesto">${p.codigoDistribuidor || 'N/A'}</code></td>
            <td>
                <div class="celda-acciones">
                    <button class="btn-tabla btn-info btn-accion-info" data-id="${p.id}">Info</button>
                    <button class="btn-tabla btn-actualizar btn-accion-actualizar" data-id="${p.id}">Actualizar</button>
                    <button class="btn-tabla btn-eliminar btn-accion-eliminar" data-id="${p.id}">Eliminar</button>
                </div>
            </td>
        `;
        tablaCuerpo.appendChild(tr);
    });
}

/**
 * Delegación de eventos para la tabla principal (Optimiza el uso de memoria en el navegador)
 */
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
    }
});

/* ==========================================================================
3. FILTRO PROVEEDORES EXISTENTES 
   ========================================================================== */
function actualizarSugerenciasProveedores() {
    const datalist = document.getElementById('lista-proveedores-existentes');
    if (!datalist) return;

    // Obtenemos los proveedores únicos ya existentes, ignorando vacíos
    const proveedoresUnicos = [...new Set(
        productosLocales
            .map(p => p.distribuidor)
            .filter(d => d && d.trim() !== '')
    )].sort();

    datalist.innerHTML = '';
    
    proveedoresUnicos.forEach(prov => {
        const option = document.createElement('option');
        option.value = prov;
        datalist.appendChild(option);
    });
}

/* ==========================================================================
   3. BUSCADOR INTERACTIVO AVANZADO
   ========================================================================== */
inputBuscador.addEventListener('input', () => {
    const termino = inputBuscador.value.toLowerCase().trim();
    const columnaFiltro = selectFiltro.value; 

    const filtrados = productosLocales.filter(p => {
        const valorPropiedad = p[columnaFiltro] ? p[columnaFiltro].toString().toLowerCase() : '';
        return valorPropiedad.includes(termino);
    });

    renderizarTabla(filtrados);
});


/* ==========================================================================
   4. PANEL DE ADVERTENCIAS Y ALERTAS DE STOCK MÍNIMO
   ========================================================================== */
function verificarStockMinimo(lista) {
    listaCritica.innerHTML = '';
    const criticos = lista.filter(p => p.stock <= p.stockMinimo);

    if (criticos.length > 0) {
        criticos.forEach(p => {
            const li = document.createElement('li');
            li.textContent = `${p.nombre} (Stock actual: ${p.stock} un. / Mínimo requerido: ${p.stockMinimo} un.) - Cód: ${p.codigoDistribuidor || 'S/C'}`;
            listaCritica.appendChild(li);
        });
        alertaStock.style.display = 'block';
    } else {
        alertaStock.style.display = 'none';
    }
}


/* ==========================================================================
   5. MÓDULO DE CONSULTA DETALLADA (MODAL INFO)
   ========================================================================== */

/**
 * Carga todos los datos del producto seleccionado en el modal de Info
 * @param {number} id - ID único del producto
 */
function verDetalle(id) {
    const p = productosLocales.find(prod => prod.id === id);
    if (!p) return;
    
    idProductoSeleccionado = id;

    // Rellenar la información de texto en el modal
    document.getElementById('modal-titulo').textContent = `Detalles del Producto: ${p.nombre}`;
    document.getElementById('info-nombre').textContent = p.nombre;
    document.getElementById('info-precio').textContent = parseFloat(p.precio).toFixed(2);
    document.getElementById('info-stock').textContent = p.stock;
    document.getElementById('info-proveedor').textContent = p.distribuidor || 'No asignado';
    document.getElementById('info-codigo').textContent = p.codigoDistribuidor || 'N/A';
    document.getElementById('info-descripcion').textContent = p.descripcion || 'Sin descripción adicional';

    // Setear el valor en el input numérico para cambios rápidos del mínimo
    document.getElementById('info-stock-min-input').value = p.stockMinimo;
    document.getElementById('info-stock-min-input').disabled = true; 
    document.getElementById('btn-modificar-minimo').textContent = 'Modificar stock mínimo'; 
    document.getElementById('btn-modificar-minimo').style.backgroundColor = ''; 

    // Renderizar las 3 imágenes opcionales y activar sus botones de zoom flotantes
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

/**
 * Modificación express de stock mínimo desde la propia modal de consulta
 */
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
            const respuesta = await fetch(`${API_URL}/${idProductoSeleccionado}/stock-minimo`, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stockMinimo: nuevoMinimo })
            });

            if (respuesta.ok) {
                alert('¡Límite de stock mínimo actualizado!');
                
                inputMinimo.disabled = true;
                botonMinimo.textContent = 'Modificar stock mínimo';
                botonMinimo.style.backgroundColor = ''; 
                
                cerrarModal('modal-info');
                obtenerProductos(); 
            } else {
                alert('Error al guardar el stock mínimo.');
            }
        } catch (error) {
            console.error('Error al actualizar el mínimo:', error);
        }
    }
});


/* ==========================================================================
   6. MÓDULO DE GESTIÓN Y EDICIÓN DE PRODUCTOS (C.R.U.D.)
   ========================================================================== */

/**
 * Carga los datos existentes de MySQL en el modal chico para editarlos
 * @param {number} id - ID del producto a modificar
 */
async function prepararActualizacion(id) {
    try {
        const respuesta = await fetch(`http://127.0.0.1:3000/api/productos`);
        const productos = await respuesta.json();
        const p = productos.find(prod => prod.id === id);

        if (!p) return;
        idProductoSeleccionado = id;

        // Rellenar campos de texto
        document.getElementById('edit-nombre').value = p.nombre;
        document.getElementById('edit-precio').value = p.precio;
        document.getElementById('edit-stock').value = p.stock;
        document.getElementById('edit-distribuidor').value = p.distribuidor || '';
        document.getElementById('edit-codigo').value = p.codigoDistribuidor || '';
        document.getElementById('edit-descripcion').value = p.descripcion || '';

        // Seteo dinámico de imágenes con sus respectivos wrappers y lupas
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

        // Marcar el formulario con el ID del producto que se está editando
        document.getElementById('form-editar-producto').setAttribute('data-id', id);
        document.getElementById('modal-editar').style.display = 'block';

    } catch (error) {
        console.error('Error al preparar edición:', error);
    }
}

// Vincula el botón de "Actualizar datos" del modal de Info con el modal de Edición
document.getElementById('btn-modificar-datos').addEventListener('click', () => {
    if (idProductoSeleccionado) prepararActualizacion(idProductoSeleccionado);
});

// Guardar los cambios del producto (Método PUT)
document.getElementById('form-editar-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const id = e.target.getAttribute('data-id');

    // Normalizamos cadenas y números antes de enviarlos a Node.js
    const datosActualizados = {
        nombre: capitalizarPrimeraLetra(document.getElementById('edit-nombre').value),
        precio: parseFloat(document.getElementById('edit-precio').value) || 0.00,
        stock: parseInt(document.getElementById('edit-stock').value) || 0,
        distribuidor: capitalizarPrimeraLetra(document.getElementById('edit-distribuidor').value),
        descripcion: capitalizarPrimeraLetra(document.getElementById('edit-descripcion').value),
        codigoDistribuidor: document.getElementById('edit-codigo').value ? document.getElementById('edit-codigo').value.trim().toUpperCase() : null,
        imagen_1: document.getElementById('edit-img-url-1').value || null,
        imagen_2: document.getElementById('edit-img-url-2').value || null,
        imagen_3: document.getElementById('edit-img-url-3').value || null
    };

    try {
        const respuesta = await fetch(`http://127.0.0.1:3000/api/productos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosActualizados)
        });

        if (respuesta.ok) {
            alert('¡Producto actualizado con éxito!');
            cerrarModal('modal-editar');
            obtenerProductos(); 
        } else {
            alert('Error al actualizar el producto.');
        }
    } catch (error) {
        console.error('Error al guardar cambios:', error);
        alert('No se pudo conectar con el servidor.');
    }
});

// Registrar un nuevo producto desde el panel general (Método POST)
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
        const respuesta = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nuevoProducto)
        });

        if (respuesta.ok) {
            alert('¡Producto registrado con éxito!');
            formProducto.reset();
            eliminarFotoCrear(1);
            eliminarFotoCrear(2);
            eliminarFotoCrear(3);
            obtenerProductos(); 
        } else {
            alert('Error al guardar el producto.');
        }
    } catch (error) {
        console.error('Error en la petición de guardado:', error);
    }
});

// Eliminar un repuesto completo (Borrado físico en Cloudinary + Borrado de fila en MySQL)
async function eliminarProducto(id) {
    if (!confirm('¿Seguro que querés eliminar este repuesto del stock?')) return;

    const productoABorrar = productosLocales.find(p => p.id === id);

    try {
        // 1. Borrar todas las fotos activas en Cloudinary asociadas a este registro
        if (productoABorrar) {
            const fotosABorrar = [productoABorrar.imagen_1, productoABorrar.imagen_2, productoABorrar.imagen_3];
            
            for (const urlFoto of fotosABorrar) {
                if (urlFoto && urlFoto.trim() !== "") {
                    try {
                        await fetch('http://127.0.0.1:3000/api/delete-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ imageUrl: urlFoto })
                        });
                    } catch (errFoto) {
                        console.error('No se pudo borrar una de las imágenes de Cloudinary:', errFoto);
                    }
                }
            }
        }

        // 2. Borrar de la base de datos MySQL una vez saneada la nube
        const respuesta = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        if (respuesta.ok) {
            alert('Artículo y sus archivos multimedia eliminados.');
            obtenerProductos();
        } else {
            alert('No se pudo eliminar el artículo.');
        }
    } catch (error) {
        console.error('Error al borrar:', error);
    }
}


/* ==========================================================================
   7. GESTIÓN FOTOGRÁFICA (SUBIDAS, RESETS Y COMPRESIÓN)
   ========================================================================== */

/**
 * Procesa la imagen del input, la comprime de forma asíncrona y la sube a Cloudinary
 */
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

    previewImg.style.opacity = '0.5'; // Opacidad de carga
    
    try {
        const fotoComprimida = await comprimirImagen(file, 200);
        const formData = new FormData();
        formData.append('imagen', fotoComprimida);

        const respuesta = await fetch('http://127.0.0.1:3000/api/upload', {
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
        console.log(`[Slot ${slotNum}] Subido y renderizado en vivo:`, resultado.url);

    } catch (error) {
        console.error('Error al subir:', error);
        if (error.message !== "Failed to fetch") {
            alert('No se pudo subir la imagen.');
        }
        resetearSlot(slotNum, contexto);
    }
}

/**
 * Borra la imagen de un slot en Cloudinary y limpia la previsualización
 */
async function resetearSlot(slotNum, contexto) {
    const previewImg = document.getElementById(`${contexto}-preview-${slotNum}`);
    const placeholder = previewImg.parentElement.querySelector('.placeholder-vacio');
    const btnLupa = previewImg.parentElement.querySelector('.btn-lupa-zoom');
    const hiddenUrlInput = document.getElementById(`${contexto}-img-url-${slotNum}`);
    const fileInput = document.getElementById(`file-${contexto}-${slotNum}`);

    const urlEliminar = hiddenUrlInput.value;

    if (urlEliminar && urlEliminar.trim() !== "" && !urlEliminar.includes('placeholder')) {
        try {
            console.log(`Solicitando eliminación física de: ${urlEliminar}`);
            const respuesta = await fetch('http://127.0.0.1:3000/api/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: urlEliminar })
            });
            
            if (!respuesta.ok) {
                console.warn('Advertencia: El backend no pudo eliminar la imagen física de Cloudinary.');
            } else {
                console.log('Imagen borrada físicamente de Cloudinary con éxito.');
            }
        } catch (error) {
            console.error('Error de red intentando eliminar la foto física:', error);
        }
    }

    // Limpieza de estados visuales
    previewImg.src = '';
    previewImg.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    if (btnLupa) btnLupa.style.display = 'none';
    hiddenUrlInput.value = '';
    if (fileInput) fileInput.value = '';
}

function eliminarFotoCrear(slotNum) {
    resetearSlot(slotNum, 'crear');
}

function eliminarFotoSlot(slotNum) {
    resetearSlot(slotNum, 'edit');
}


/* ==========================================================================
   8. VISOR DE LUPA INTERACTIVO (ZOOM / LIGHTBOX)
   ========================================================================== */
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


/* ==========================================================================
   9. UTILIDADES Y AUXILIARES
   ========================================================================== */
function capitalizarPrimeraLetra(texto) {
    if (!texto) return null;
    const limpio = texto.trim();
    if (limpio === '') return null;
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function cerrarModal(idModal) {
    document.getElementById(idModal).style.display = 'none';
}

// Cerrar cualquier modal al hacer clic en el espacio vacío exterior
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});


/* ==========================================================================
   10. INTERRUPTOR DE MODO DE COLOR (CLARO / OSCURO)
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
   11. INICIALIZACIÓN SÍNCRONA DE LA APLICACIÓN
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Configurar la preferencia guardada de Modo Claro / Oscuro al arrancar
    const temaGuardado = localStorage.getItem('tema-preferido');
    if (temaGuardado === 'claro') {
        document.body.classList.add('tema-claro');
    } else {
        document.body.classList.remove('tema-claro');
    }

    // Traer el catálogo de repuestos de MySQL
    obtenerProductos();
});