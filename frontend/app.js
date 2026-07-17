// Servidor local de Node.js
const API_URL = 'http://localhost:3000/api/productos';

// Elementos del DOM
const tablaCuerpo = document.getElementById('tabla-cuerpo');
const inputBuscador = document.getElementById('input-buscador');
const selectFiltro = document.getElementById('select-filtro');
const formProducto = document.getElementById('form-producto');
const alertaStock = document.getElementById('alerta-stock-minimo');
const listaCritica = document.getElementById('lista-critica');
const modalInfo = document.getElementById('modal-info');

// Array global para guardar los productos cargados
let productosLocales = [];
let idProductoSeleccionado = null;

// 1. CARGAR Y MOSTRAR ARTÍCULOS DESDE MYSQL
async function obtenerProductos() {
    try {
        const respuesta = await fetch(API_URL);
        if (!respuesta.ok) throw new Error('Error al conectar con el servidor');
        
        productosLocales = await respuesta.json();
        renderizarTabla(productosLocales);
        verificarStockMinimo(productosLocales);
    } catch (error) {
        console.error('Error cargando inventario:', error);
    }
}

function renderizarTabla(lista) {
    tablaCuerpo.innerHTML = ''; // Limpiar filas viejas
    
    if (lista.length === 0) {
        tablaCuerpo.innerHTML = `<tr><td colspan="8" style="text-align:center;">No se encontraron artículos</td></tr>`;
        return;
    }

    lista.forEach(p => {
        const tr = document.createElement('tr');
        
        // Si el stock actual es menor o igual al mínimo, se destaca visualmente
        if (p.stock <= p.stockMinimo) {
            tr.style.backgroundColor = '#fff3cd'; // Fondo amarillento sutil
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

// ESCUCHADOR DE EVENTOS DELEGADO PARA ACCIONES EN LA TABLA
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

// 2. BUSCADOR INTERACTIVO AVANZADO (Por Columna)
inputBuscador.addEventListener('input', () => {
    const termino = inputBuscador.value.toLowerCase().trim();
    const columnaFiltro = selectFiltro.value; 

    const filtrados = productosLocales.filter(p => {
        const valorPropiedad = p[columnaFiltro] ? p[columnaFiltro].toString().toLowerCase() : '';
        return valorPropiedad.includes(termino);
    });

    renderizarTabla(filtrados);
});

// 3. CONTROL DE ALERTA DE STOCK MÍNIMO
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

// 4. VENTANA MODAL: VER DETALLE ("INFO") CON LAS 3 IMÁGENES Y LUPAS
function verDetalle(id) {
    const p = productosLocales.find(prod => prod.id === id);
    if (!p) return;
    
    idProductoSeleccionado = id;

    // Rellenar textos del modal
    document.getElementById('modal-titulo').textContent = `Detalles del Producto: ${p.nombre}`;
    document.getElementById('info-nombre').textContent = p.nombre;
    document.getElementById('info-precio').textContent = parseFloat(p.precio).toFixed(2);
    document.getElementById('info-stock').textContent = p.stock;
    document.getElementById('info-proveedor').textContent = p.distribuidor || 'No asignado';
    document.getElementById('info-codigo').textContent = p.codigoDistribuidor || 'N/A';
    document.getElementById('info-descripcion').textContent = p.descripcion || 'Sin descripción adicional';

    // Seteamos el valor actual en el INPUT numérico del stock mínimo
    document.getElementById('info-stock-min-input').value = p.stockMinimo;
    document.getElementById('info-stock-min-input').disabled = true; 
    document.getElementById('btn-modificar-minimo').textContent = 'Modificar stock mínimo'; 
    document.getElementById('btn-modificar-minimo').style.backgroundColor = ''; 

    // Rellenar imágenes de detalle y activar lupas si existen
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

    // Mostrar el modal
    modalInfo.style.display = 'block';
}

// CAMBIO DIRECTO DE STOCK MÍNIMO DESDE LA MISMA VENTANA DE INFO
document.getElementById('btn-modificar-minimo').addEventListener('click', async function() {
    if (!idProductoSeleccionado) return;
    
    const inputMinimo = document.getElementById('info-stock-min-input');
    const botonAzul = this; 

    if (inputMinimo.disabled) {
        inputMinimo.disabled = false;
        inputMinimo.focus(); 
        inputMinimo.select(); 
        botonAzul.textContent = 'Guardar stock mínimo'; 
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
                botonAzul.textContent = 'Modificar stock mínimo';
                botonAzul.style.backgroundColor = ''; 
                
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

// ABRE EL MODAL DE EDICIÓN CARGANDO LOS DATOS ORIGINALES EN LOS INPUTS Y SLOTS
async function prepararActualizacion(id) {
    try {
        const respuesta = await fetch(`http://127.0.0.1:3000/api/productos`);
        const productos = await respuesta.json();
        const p = productos.find(prod => prod.id === id);

        if (!p) return;
        idProductoSeleccionado = id;

        // Cargamos los inputs del modal con la data de la fila seleccionada
        document.getElementById('edit-nombre').value = p.nombre;
        document.getElementById('edit-precio').value = p.precio;
        document.getElementById('edit-stock').value = p.stock;
        document.getElementById('edit-distribuidor').value = p.distribuidor || '';
        document.getElementById('edit-codigo').value = p.codigoDistribuidor || '';
        document.getElementById('edit-descripcion').value = p.descripcion || '';

        // Cargamos las imágenes existentes de Cloudinary en las vistas previas controlando placeholders y lupas
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

        // Guardamos de forma temporal el ID del producto que estamos editando
        document.getElementById('form-editar-producto').setAttribute('data-id', id);
        
        // Abrimos la modal
        document.getElementById('modal-editar').style.display = 'block';

    } catch (error) {
        console.error('Error al preparar edición:', error);
    }
}

// Redirecciona el botón "Actualizar datos" de la ventana de Info al formulario HTML de edición
document.getElementById('btn-modificar-datos').addEventListener('click', () => {
    if (idProductoSeleccionado) prepararActualizacion(idProductoSeleccionado);
});

// PROCESAR EL ENVÍO DEL FORMULARIO DE EDICIÓN (PUT) - CORREGIDO REFRESCO EN VIVO Y EVITADO RECARGAS FALSAS
document.getElementById('form-editar-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const id = e.target.getAttribute('data-id');

    const datosActualizados = {
        // 🌟 Normalizamos con la primera letra en mayúscula al editar
        nombre: capitalizarPrimeraLetra(document.getElementById('edit-nombre').value),
        precio: parseFloat(document.getElementById('edit-precio').value) || 0.00,
        stock: parseInt(document.getElementById('edit-stock').value) || 0,
        distribuidor: capitalizarPrimeraLetra(document.getElementById('edit-distribuidor').value),
        descripcion: capitalizarPrimeraLetra(document.getElementById('edit-descripcion').value),
        
        // El código lo pasamos a mayúsculas
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

// Funciones para cerrar las ventanas modales
function cerrarModal(idModal) {
    document.getElementById(idModal).style.display = 'none';
}

// Cerrar haciendo clic afuera de la caja del modal activo
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// 5. GUARDAR NUEVO PRODUCTO DESDE EL FORMULARIO GENERAL
formProducto.addEventListener('submit', async (e) => {
    e.preventDefault();
    const precioInput = document.getElementById('precio').value;
    const distribuidorInput = document.getElementById('distribuidor').value;
    const codigoInput = document.getElementById('codigoDistribuidor').value;
    const descripcionInput = document.getElementById('descripcion').value;

    const nuevoProducto = {
        // 🌟 Normalizamos con la primera letra en mayúscula
        nombre: capitalizarPrimeraLetra(document.getElementById('nombre').value),
        precio: precioInput ? parseFloat(precioInput) : 0.00,
        stock: parseInt(document.getElementById('stock').value) || 0,
        stockMinimo: parseInt(document.getElementById('stockMinimo').value) || 0,
        categoria: document.getElementById('categoria').value,
        distribuidor: capitalizarPrimeraLetra(distribuidorInput),
        descripcion: capitalizarPrimeraLetra(descripcionInput),
        
        // El código de distribuidor nos conviene guardarlo siempre todo en MAYÚSCULAS
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


// 6. ELIMINAR COMPONENTE (MySQL + Limpieza física de Cloudinary)
async function eliminarProducto(id) {
    if (!confirm('¿Seguro que querés eliminar este repuesto del stock?')) return;

    // Buscamos el producto en nuestro array local para saber si tiene fotos
    const productoABorrar = productosLocales.find(p => p.id === id);

    try {
        // Si el producto tiene imágenes asociadas, las borramos primero de Cloudinary
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

        // Una vez limpiada la nube, procedemos a borrar el registro de MySQL
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

// 🌟 SUBIR FOTO DIRECTO A CLOUDINARY (Con compresión previa y sin propagación del submit)
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

// RESETEAR SLOT DE FOTO (Evita íconos rotos)
async function resetearSlot(slotNum, contexto) {
    const previewImg = document.getElementById(`${contexto}-preview-${slotNum}`);
    const placeholder = previewImg.parentElement.querySelector('.placeholder-vacio');
    const btnLupa = previewImg.parentElement.querySelector('.btn-lupa-zoom');
    const hiddenUrlInput = document.getElementById(`${contexto}-img-url-${slotNum}`);
    const fileInput = document.getElementById(`file-${contexto}-${slotNum}`);

    const urlEliminar = hiddenUrlInput.value;

    // Si el slot ya tenía una imagen cargada, le pedimos al backend que la borre físicamente de la nube
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

    // Limpiamos la interfaz como lo hacíamos habitualmente
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

// ABRIR IMAGEN EN COMPLETA (Zoom / Lightbox)
function abrirZoom(imgElementId) {
    const srcImgOriginal = document.getElementById(imgElementId).src;
    if (!srcImgOriginal || srcImgOriginal.includes('placeholder') || srcImgOriginal === window.location.href) return;

    const modalVisor = document.getElementById('modal-zoom-visor');
    const imgGigante = document.getElementById('imagen-zoom-gigante');

    imgGigante.src = srcImgOriginal;
    modalVisor.style.display = 'flex';
}

// CERRAR ZOOM
function cerrarZoom() {
    document.getElementById('modal-zoom-visor').style.display = 'none';
}

function capitalizarPrimeraLetra(texto) {
    if (!texto) return null;
    const limpio = texto.trim();
    if (limpio === '') return null;
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}



// Inicializar el sistema al cargar la página
document.addEventListener('DOMContentLoaded', obtenerProductos);