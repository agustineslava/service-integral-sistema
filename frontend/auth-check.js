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
        // A. Renderizar información del usuario en el Header
        const contenedorUsuario = document.getElementById('info-usuario-header');
        if (contenedorUsuario) {
            let botonCrearUsuarioHTML = '';
            if (usuario.rol === 'ADMIN') {
                botonCrearUsuarioHTML = `
                    <button onclick="abrirModalCrearUsuario()" class="btn-tabla btn-actualizar" style="padding: 5px 10px; font-size: 11px; margin-left: 8px;">
                        + Usuario
                    </button>
                `;
            }

            contenedorUsuario.innerHTML = `
                <div class="usuario-tag">
                    <svg class="icono-usuario-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <span><strong>${usuario.nombre}</strong> (${usuario.rol})</span>
                </div>
                ${botonCrearUsuarioHTML}
                <button onclick="cerrarSesion()" class="btn-tabla btn-eliminar btn-salir">Salir</button>
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
                    const respuesta = await fetch(`${window.location.origin}/api/usuarios`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(nuevoUsuario)
                    });

                    const data = await respuesta.json();

                    if (respuesta.ok) {
                        alert('¡Usuario registrado con éxito!');
                        formCrearUsuario.reset();
                        cerrarModal('modal-crear-usuario');
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

/**
 * Aplica ocultamiento y deshabilitación de elementos de creación/edición para el rol TÉCNICO
 */
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

// --- FUNCIONES GLOBALES ---

function abrirModalCrearUsuario() {
    const modal = document.getElementById('modal-crear-usuario');
    if (modal) modal.style.display = 'block';
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