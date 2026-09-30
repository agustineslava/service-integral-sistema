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
 * Wrapper de fetch que inyecta automáticamente el token Bearer JWT
 * y redirige a login si la sesión caducó.
 */
async function apiFetch(url, opciones = {}) {
    const token = localStorage.getItem('jwt_token');
    const headers = {
        ...(opciones.headers || {})
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Si enviamos body y no es FormData, fijamos Content-Type JSON
    if (opciones.body && !(opciones.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const respuesta = await fetch(url, { ...opciones, headers });

    if (respuesta.status === 401) {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('usuario_actual');
        alert('Tu sesión ha expirado o no es válida. Por favor, iniciá sesión nuevamente.');
        window.location.href = 'login.html';
        return respuesta;
    }

    return respuesta;
}

/* ==========================================================================
   VERIFICACIÓN DE SESIÓN Y CONTROL DE PERMISOS / ROLES (ADMIN vs TECNICO)
   ========================================================================== */
(function verificarSesion() {
    const token = localStorage.getItem('jwt_token');
    const usuarioGuardado = localStorage.getItem('usuario_actual');

    // Redirigir al login si no hay sesión activa
    if (!token || !usuarioGuardado) {
        window.location.href = 'login.html';
        return;
    }

    const usuario = JSON.parse(usuarioGuardado);

    document.addEventListener('DOMContentLoaded', () => {
        // A0. Sacar del menú las secciones que esta empresa no contrató.
        aplicarModulosContratados();

        // A. Renderizar información del usuario en el Header (Menú Desplegable Compacto)
        const contenedorUsuario = document.getElementById('info-usuario-header');
        if (contenedorUsuario) {
            const opcionesAdminHTML = usuario.rol === 'ADMIN' ? `
                <button type="button" class="dropdown-item-btn" onclick="abrirModalCrearUsuario(); cerrarMenuUsuario();">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Nuevo Usuario
                </button>
                <button type="button" class="dropdown-item-btn" onclick="abrirModalGestionarUsuarios(); cerrarMenuUsuario();">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    Gestionar Usuarios
                </button>
            ` : '';

            contenedorUsuario.innerHTML = `
                <div class="usuario-dropdown-wrapper" id="dropdown-usuario-contenedor">
                    <button type="button" class="btn-usuario-perfil" onclick="toggleMenuUsuario(event)">
                        <svg class="icono-usuario-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span>${escapeHtml(usuario.nombre)}</span>
                        <svg class="icono-flecha-dropdown" viewBox="0 0 24 24">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>

                    <div class="dropdown-menu-usuario" id="menu-desplegable-usuario">
                        <div class="dropdown-info-rol">Perfil: ${escapeHtml(usuario.rol)}</div>
                        ${opcionesAdminHTML}
                        <button type="button" class="dropdown-item-btn" onclick="abrirModalCambiarPassword(); cerrarMenuUsuario();">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                            Cambiar Contraseña
                        </button>
                        <button type="button" class="dropdown-item-btn btn-peligro" onclick="cerrarSesion()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                            Cerrar Sesión
                        </button>
                    </div>
                </div>
            `;
        }

        // B. APLICAR RESTRICCIONES DE SOLO LECTURA SI ES PERFIL "TECNICO"
        if (usuario.rol === 'TECNICO') {
            aplicarModoSoloConsulta();
        }

        // Listener para la creación de usuarios desde la modal (Solo Admin)
        const formCrearUsuario = document.getElementById('form-crear-usuario');
        if (formCrearUsuario) {
            formCrearUsuario.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const nuevoUsuario = {
                    nombre: document.getElementById('nuevo-usuario-nombre').value,
                    email: document.getElementById('nuevo-usuario-email').value,
                    password: document.getElementById('nuevo-usuario-password').value,
                    rol: document.getElementById('nuevo-usuario-rol').value
                };

                try {
                    const respuesta = await apiFetch(`${window.location.origin}/api/usuarios`, {
                        method: 'POST',
                        body: JSON.stringify(nuevoUsuario)
                    });

                    const data = await respuesta.json();

                    if (respuesta.ok) {
                        alert('¡Usuario registrado con éxito!');
                        formCrearUsuario.reset();
                        cerrarModal('modal-crear-usuario');
                        // El límite se acaba de tocar: recargar la lista
                        // desactiva el formulario si ya no queda lugar.
                        cargarListaUsuarios();
                    } else if (data.codigo === 'LIMITE_USUARIOS') {
                        // No es un error de permisos: es que el plan no da más
                        // usuarios. El mensaje que mande el servidor ya lo dice.
                        alert(data.error);
                        formCrearUsuario.reset();
                        cargarListaUsuarios();
                    } else {
                        alert(data.error || 'Error al registrar usuario.');
                    }
                } catch (error) {
                    console.error('Error al crear usuario:', error);
                    alert('No se pudo conectar con el servidor.');
                }
            });
        }
    });
})();

/* ==========================================================================
   MÓDULOS CONTRATADOS
   --------------------------------------------------------------------------
   Cada sección del menú declara de qué módulo depende con data-modulo. Si la
   empresa no lo contrató, el ítem desaparece del menú.

   OJO CON EL ALCANCE DE ESTO: es CÓMODO, NO SEGURIDAD. Esconder un link no
   impide nada; cualquiera que escriba la URL a mano igual llega a la página.
   Lo que de verdad impide entrar es que el servidor conteste 404 a las rutas
   del módulo. Esto solo evita el susto de mostrar algo que no se puede usar.

   Si no hay datos de empresa guardados (sesión vieja, antes de este cambio),
   no se oculta nada: es preferible mostrar de más que dejar al usuario sin
   menú por un problema de caché.
   ========================================================================== */

/** ¿La empresa compró este módulo? */
function tieneModulo(codigo) {
    const empresa = JSON.parse(localStorage.getItem('empresa_actual') || 'null');
    if (!empresa || !Array.isArray(empresa.modulos)) return true;
    return empresa.modulos.includes(codigo);
}

function aplicarModulosContratados() {
    const ocultados = [];

    document.querySelectorAll('[data-modulo]').forEach((el) => {
        const codigo = el.getAttribute('data-modulo');
        if (tieneModulo(codigo)) return;
        el.style.display = 'none';
        ocultados.push(codigo);
    });

    if (ocultados.length) {
        console.info(`Secciones ocultadas por no estar contratadas: ${ocultados.join(', ')}`);
    }

    // Si la página actual ES una de las secciones que se ocultaron, no dejamos
    // al usuario mirando una pantalla que el servidor le va a contestar 404.
    // La guarda evita un bucle si la portada también estuviera oculta.
    const archivoActual = window.location.pathname.split('/').pop() || 'index.html';
    const enlaceActual = document.querySelector(`[data-modulo] a[href="${archivoActual}"]`);

    if (enlaceActual && enlaceActual.parentElement.style.display === 'none'
        && archivoActual !== 'index.html') {
        window.location.href = 'index.html';
        return;
    }
}

/* ==========================================================================
   Aplica ocultamiento y deshabilitación de elementos de creación/edición para el rol TÉCNICO
   ========================================================================== */
function aplicarModoSoloConsulta() {
    // 1. Ocultar el formulario para registrar un "Nuevo Producto" en index.html
    const panelFormulario = document.querySelector('.panel-formulario');
    if (panelFormulario) panelFormulario.style.display = 'none';

    // 2. Ocultar botones de modificación en el modal de detalles de producto
    const btnModificarDatos = document.getElementById('btn-modificar-datos');
    const btnModificarMinimo = document.getElementById('btn-modificar-minimo');
    if (btnModificarDatos) btnModificarDatos.style.display = 'none';
    if (btnModificarMinimo) btnModificarMinimo.style.display = 'none';

    // 3. En la sección de pedidos (pedidos.html): Ocultar el panel para armar y guardar pedidos
    const panelAgregarPedido = document.querySelector('.panel-agregar-pedido');
    const panelListaPedido = document.querySelector('.panel-lista-pedido');
    if (panelAgregarPedido) panelAgregarPedido.style.display = 'none';
    if (panelListaPedido) panelListaPedido.style.display = 'none';

    // Ajustar el layout de pedidos a 100% de ancho para ver el Historial cómodamente
    const layoutPedidos = document.querySelector('.layout-pedidos');
    if (layoutPedidos) layoutPedidos.style.display = 'block';

    // 4. Utilizar MutationObserver para ocultar dinámicamente botones "Editar" o "Eliminar" en las filas de la tabla de stock
    const observer = new MutationObserver(() => {
        const botonesEdicionYEliminacion = document.querySelectorAll('.btn-tabla.btn-actualizar, .btn-tabla.btn-eliminar:not(.btn-salir)');
        botonesEdicionYEliminacion.forEach(btn => {
            // Se ocultan salvo que sean botones de "Info" o "Ver Detalle"
            if (!btn.textContent.includes('Ver Detalle') && !btn.textContent.includes('Info')) {
                btn.style.display = 'none';
            }
        });
    });

    const tablaCuerpo = document.getElementById('tabla-cuerpo');
    if (tablaCuerpo) {
        observer.observe(tablaCuerpo, { childList: true, subtree: true });
    }
}

// --- TEMA CLARO / OSCURO ---
// Esta funcion estaba copiada en app.js, pedidos.js y reparaciones.js, y NO
// estaba en clientes.js: el boton de tema de la pagina de Clientes llamaba a
// una funcion que no existia y tiraba ReferenceError en la consola, asi que el
// boton no hacia nada. Va aca porque auth-check.js lo cargan todas las paginas:
// si queda en el script de cada pantalla, la proxima pantalla nueva repite el
// mismo error. La clave de localStorage no se cambia, es la de siempre.
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

// --- FUNCIONES GLOBALES ---

function abrirModalCrearUsuario() {
    const modal = document.getElementById('modal-crear-usuario');
    if (modal) modal.style.display = 'block';
}

/**
 * Abre el modal de "Gestionar Usuarios": lista todos los usuarios del sistema
 * y permite eliminarlos (solo ADMIN, el backend protege contra auto-borrado
 * y contra dejar el sistema sin ningún administrador).
 */
function abrirModalGestionarUsuarios() {
    let modal = document.getElementById('modal-gestionar-usuarios');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-gestionar-usuarios';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-contenido modal-chico">
                <span class="cerrar-modal" onclick="cerrarModal('modal-gestionar-usuarios')">&times;</span>
                <h2>Usuarios del sistema</h2>
                <div id="lista-usuarios-gestion" style="margin-top: 1rem; max-height: 60vh; overflow-y: auto;">
                    <p class="texto-vacio">Cargando usuarios...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'block';
    cargarListaUsuarios();
}

async function cargarListaUsuarios() {
    const contenedor = document.getElementById('lista-usuarios-gestion');
    const usuarioActual = JSON.parse(localStorage.getItem('usuario_actual') || '{}');

    try {
        const respuesta = await apiFetch(`${window.location.origin}/api/usuarios`);
        if (!respuesta.ok) throw new Error('No se pudo obtener la lista de usuarios');
        const usuarios = await respuesta.json();

        actualizarContadorUsuarios(usuarios.length);

        if (usuarios.length === 0) {
            contenedor.innerHTML = '<p class="texto-vacio">No hay usuarios registrados.</p>';
            return;
        }

        contenedor.innerHTML = usuarios.map(u => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px;">
                <div style="font-size: 13px;">
                    <strong>${escapeHtml(u.nombre)}</strong> ${u.id === usuarioActual.id ? '<span style="color: var(--text-muted);">(vos)</span>' : ''}<br>
                    <span style="color: var(--text-muted);">${escapeHtml(u.email)} — ${escapeHtml(u.rol)}</span>
                </div>
                <button
                    class="btn-tabla btn-eliminar"
                    style="padding: 4px 10px; font-size: 11px;"
                    onclick="eliminarUsuario(${u.id}, '${escapeHtml(u.nombre).replace(/'/g, "\\'")}')"
                    ${u.id === usuarioActual.id ? 'disabled title="No podés eliminar tu propio usuario"' : ''}
                >Eliminar</button>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        contenedor.innerHTML = '<p style="color: var(--color-danger, #dc3545);">No se pudo cargar la lista de usuarios.</p>';
    }
}

/**
 * Muestra "N de M usuarios" y desactiva el alta si el plan ya está completo.
 *
 * Esto es solo para que se entienda antes de intentarlo: el bloqueo real lo
 * hace el servidor, que no confía en que el botón esté deshabilitado.
 */
function actualizarContadorUsuarios(usados) {
    const empresa = JSON.parse(localStorage.getItem('empresa_actual') || 'null');
    const limite = Number(empresa?.limite_usuarios);
    if (!Number.isFinite(limite) || limite <= 0) return;

    const form = document.getElementById('form-crear-usuario');
    if (!form) return;

    const completo = usados >= limite;

    // Mostrar el contador junto al botón de agregar, si la página lo tiene.
    let contador = document.getElementById('contador-usuarios-plan');
    if (!contador) {
        contador = document.createElement('p');
        contador.id = 'contador-usuarios-plan';
        contador.style.cssText = 'font-size:12px;color:var(--text-muted);margin:0 0 10px 0;';
        form.parentElement.insertBefore(contador, form);
    }
    contador.textContent = `Usuarios: ${usados} de ${limite} incluidos en tu plan.`;

    // Desactivar el alta y explicar por qué, en vez de dejar que falle al enviar.
    const campos = document.querySelectorAll('#form-crear-usuario input, #form-crear-usuario select');
    const boton = document.querySelector('#form-crear-usuario button[type="submit"], #form-crear-usuario input[type="submit"]');
    campos.forEach((c) => { c.disabled = completo; });
    if (boton) {
        boton.disabled = completo;
        boton.title = completo
            ? `Tu plan incluye ${limite} usuarios. Contactanos para ampliarlo.`
            : '';
    }
    if (completo) {
        contador.style.color = 'var(--color-warning, #b8860b)';
        let aviso = document.getElementById('aviso-limite-usuarios');
        if (!aviso) {
            aviso = document.createElement('p');
            aviso.id = 'aviso-limite-usuarios';
            aviso.style.cssText = 'font-size:12px;margin:0 0 10px 0;';
            form.parentElement.insertBefore(aviso, form);
        }
        aviso.textContent = `Llegaste al máximo de ${limite} ${limite === 1 ? 'usuario' : 'usuarios'} de tu plan. Para agregar más, contactanos.`;
    }
}

async function eliminarUsuario(id, nombre) {
    if (!confirm(`¿Seguro que querés eliminar al usuario "${nombre}"? Esta acción no se puede deshacer.`)) return;

    try {
        const respuesta = await apiFetch(`${window.location.origin}/api/usuarios/${id}`, { method: 'DELETE' });
        const data = await respuesta.json();

        if (respuesta.ok) {
            cargarListaUsuarios(); // refresca la lista
        } else {
            alert(data.error || 'No se pudo eliminar el usuario.');
        }
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        alert('No se pudo conectar con el servidor.');
    }
}

/**
 * Abre el modal de "cambiar mi contraseña". Lo crea la primera vez que se
 * necesita e inyecta en el <body>, así funciona en cualquier página sin
 * tener que agregar el HTML del modal a mano en index.html/pedidos.html/reparaciones.html.
 */
function abrirModalCambiarPassword() {
    let modal = document.getElementById('modal-cambiar-password');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-cambiar-password';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-contenido modal-chico">
                <span class="cerrar-modal" onclick="cerrarModal('modal-cambiar-password')">&times;</span>
                <h2>Cambiar mi contraseña</h2>
                <form id="form-cambiar-password" style="margin-top: 1rem;">
                    <div class="campo">
                        <label for="cambiar-password-actual">Contraseña actual:</label>
                        <div class="campo-password-wrapper">
                            <input type="password" id="cambiar-password-actual" required>
                            <button type="button" class="btn-toggle-password" onclick="toggleVisibilidadPassword('cambiar-password-actual', this)" aria-label="Mostrar contraseña">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <div class="campo">
                        <label for="cambiar-password-nueva">Contraseña nueva (mínimo 6 caracteres):</label>
                        <div class="campo-password-wrapper">
                            <input type="password" id="cambiar-password-nueva" required minlength="6">
                            <button type="button" class="btn-toggle-password" onclick="toggleVisibilidadPassword('cambiar-password-nueva', this)" aria-label="Mostrar contraseña">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <div id="mensaje-cambiar-password" style="color: var(--color-danger, #dc3545); font-size: 13px; margin-bottom: 8px; display:none;"></div>
                    <button type="submit" class="btn btn-crear w-100">Guardar nueva contraseña</button>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('form-cambiar-password').addEventListener('submit', async (e) => {
            e.preventDefault();
            const passwordActual = document.getElementById('cambiar-password-actual').value;
            const passwordNueva = document.getElementById('cambiar-password-nueva').value;
            const mensajeDiv = document.getElementById('mensaje-cambiar-password');
            mensajeDiv.style.display = 'none';

            try {
                const respuesta = await apiFetch(`${window.location.origin}/api/usuarios/cambiar-password`, {
                    method: 'POST',
                    body: JSON.stringify({ passwordActual, passwordNueva })
                });
                const data = await respuesta.json();

                if (respuesta.ok) {
                    alert('¡Contraseña actualizada con éxito!');
                    document.getElementById('form-cambiar-password').reset();
                    cerrarModal('modal-cambiar-password');
                } else {
                    mensajeDiv.textContent = data.error || 'No se pudo cambiar la contraseña.';
                    mensajeDiv.style.display = 'block';
                }
            } catch (error) {
                console.error('Error al cambiar contraseña:', error);
                mensajeDiv.textContent = 'No se pudo conectar con el servidor.';
                mensajeDiv.style.display = 'block';
            }
        });
    }

    modal.style.display = 'block';
}

function cerrarSesion() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('usuario_actual');
    window.location.href = 'login.html';
}

function toggleVisibilidadPassword(idInput, boton) {
    const input = document.getElementById(idInput);
    if (!input) return;

    const svg = boton.querySelector('svg');

    if (input.type === 'password') {
        input.type = 'text';
        svg.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
    } else {
        input.type = 'password';
        svg.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
}

/* Control interactivo del Menú Desplegable de Usuario */
function toggleMenuUsuario(e) {
    e.stopPropagation();
    const contenedor = document.getElementById('dropdown-usuario-contenedor');
    if (contenedor) {
        contenedor.classList.toggle('activo');
    }
}

function cerrarMenuUsuario() {
    const contenedor = document.getElementById('dropdown-usuario-contenedor');
    if (contenedor) {
        contenedor.classList.remove('activo');
    }
}

// Cierra el menú al hacer clic en cualquier parte fuera de él
document.addEventListener('click', (e) => {
    const contenedor = document.getElementById('dropdown-usuario-contenedor');
    if (contenedor && !contenedor.contains(e.target)) {
        contenedor.classList.remove('activo');
    }
});