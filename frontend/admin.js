/**
 * PANEL DEL SUPERADMIN
 * ---------------------------------------------------------------------------
 * Todas las pantallas de este archivo hablan con rutas `/api/admin/...`, que
 * responden a la base CENTRAL y exigen un token de SUPERADMIN.
 *
 * DOS REGLAS QUE NO SE PUEDEN OLVIDAR ACÁ
 *
 * 1. Este panel NO puede ver los datos de una empresa: sus reparaciones,
 *    productos, clientes o presupuestos. No hay ninguna ruta que los devuelva,
 *    y el listado sale de la base central. El listado de empresas y el detalle
 *    de una empresa NO son datos de su negocio: son datos del contrato, que
 *    son tuyos.
 *
 *    Lo UNICO que abre datos de un cliente es "Entrar como", y no es una
 *    pantalla: es una SESION de 30 minutos con la identidad de un usuario de
 *    esa empresa, que queda auditada con tu nombre y muestra un banner fijo
 *    mientras dura. Esa diferencia -- sesion corta, auditada y visible contra
 *    pantalla silenciosa -- es deliberada, y es la razon por la que "Entrar
 *    como" se puede y un "ver datos del cliente" no.
 *
 * 2. La escritura pasa SIEMPRE por el servidor. Este archivo deshabilita
 *    botones y esconde cosas para que sea cómodo, pero no confía en eso para
 *    decidir nada: un módulo base se ve apagado acá y el servidor lo rechaza
 *    igual si se pide por API.
 */

// --- Arranque -------------------------------------------------------------

/**
 * El tema NO se aplica desde acá. Lo aplica el bloque de tema de
 * `auth-check.js`, que este archivo carga en el `<head>` antes de que se
 * pinte nada. Antes esta página tenía su propia copia (que sólo agregaba la
 * clase y nunca la sacaba) y `ajustarIconoTema`, que ponía el ícono al revés
 * que el CSS. Las dos cosas se fueron con el bloque de auth-check.js.
 */

/** Estado en memoria de la pantalla. */
const admin = {
    empresas: [],
    planes: [],
    modulosCatalogo: [],
    /** La empresa abierta en el modal de detalle, para no volver a pedirla. */
    abierta: null,
    /** Evita que un doble clic mande dos altas. */
    dandoDeAlta: false
};

// ==========================================================================
// Modales
// --------------------------------------------------------------------------
// `abrirModal` y `cerrarModal` NO están en auth-check.js: están repetidos en
// app.js, clientes.js, pedidos.js y reparaciones.js. Como son tres líneas, se
// copiaron cinco veces en vez de subir una sola al archivo común. Acá se
// escriben para que el panel ande, pero es exactamente la deuda que
// auth-check.js vino a pagar: lo que sirve a todas las páginas debería estar
// en auth-check.js y no en cada pantalla.
// ==========================================================================

function abrirModal(idModal) {
    document.getElementById(idModal).style.display = 'block';
}

function cerrarModal(idModal) {
    document.getElementById(idModal).style.display = 'none';
}

// Clic en el fondo oscuro cierra, como en el resto del sistema.
window.addEventListener('click', (e) => {
    if (!e.target.classList.contains('modal')) return;
    // Salir del modal mientras se está creando una empresa dejaría la pantalla
    // mostrando el avance de algo que sigue corriendo y de la que no se sabe
    // nada. Con `dandoDeAlta` no se cierra: primero hay que saber si salió.
    if (admin.dandoDeAlta) return;
    e.target.style.display = 'none';
});


const API = `${window.location.origin}/api`;

/** Cuenta para los mensajes de carga. */
const $ = (id) => document.getElementById(id);

// ==========================================================================
// Subida del logo desde un archivo
// --------------------------------------------------------------------------
// El pedido fue que el logo se suba desde la carpeta del cliente, y con razón:
// tiene el archivo descargado y lo único que sabe es dónde está en su disco.
// Pedirle una dirección lo obligaba a subirlo antes a algún lado, y encima el
// campo era el único error posible del formulario de alta.
//
// La subida va a `/api/admin/subir-logo`, NO a `/api/upload`: esa es ruta de
// empresa y `verificarToken` le cierra la puerta al SUPERADMIN a propósito,
// porque no tiene empresa ni base. `/api/admin/subir-logo` va con
// `verificarSuperAdmin`, que es la guarda correcta para este panel.
//
// Lo que valida esta función es sólo para dar el error rápido y con el nombre
// del archivo. La decisión es del servidor: si acá se pasara algo, el mismo
// archivo enviado por API entraría igual.
//
// El SVG queda afuera a propósito, no por olvido: es XML con <script> adentro
// y se ejecuta si alguien lo abre. El servidor sólo acepta jpeg, png, webp y
// gif.
// ==========================================================================

const TIPOS_LOGO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const PESO_MAXIMO_LOGO = 5 * 1024 * 1024;

/**
 * Sube un archivo de logo y devuelve la URL, o `null` si no se pudo.
 *
 * `alTerminar` recibe la URL o `null` para que el llamador la muestre.
 */
async function subirLogo(archivo, alTerminar, slug) {
    if (!archivo) {
        alTerminar(null, 'No se seleccionó ningún archivo.');
        return null;
    }
    if (!TIPOS_LOGO.includes(archivo.type)) {
        alTerminar(null, `"${archivo.name}" no es una imagen. Solo JPG, PNG, WEBP o GIF.`);
        return null;
    }
    if (archivo.size > PESO_MAXIMO_LOGO) {
        const mb = (archivo.size / (1024 * 1024)).toFixed(1);
        alTerminar(null, `"${archivo.name}" pesa ${mb} MB. El máximo es 5 MB.`);
        return null;
    }

    const cuerpo = new FormData();
    cuerpo.append('imagen', archivo);
    // El slug solo elige la carpeta en Cloudinary; el servidor lo valida y, si
    // no viene, usa la carpeta de plataforma (pasa en el alta, cuando la
    // empresa todavía no existe). No es un dato de negocio.
    if (slug) cuerpo.append('slug', slug);

    try {
        // FormData sin `Content-Type` a propósito: si se lo pone, el `boundary`
        // que arma el navegador no viaja y el servidor no puede separar las
        // partes del formulario. `apiFetch` lo respeta justamente por esto.
        const r = await apiFetch(`${API}/admin/subir-logo`, { method: 'POST', body: cuerpo });
        const d = await r.json();

        if (!r.ok) {
            alTerminar(null, d.error || 'No se pudo subir el logo.');
            return null;
        }

        alTerminar(d.url, null);
        return d.url;
    } catch (err) {
        console.error(err);
        alTerminar(null, 'No se pudo conectar con el servidor.');
        return null;
    }
}

/**
 * Pinta el resultado de una subida en el renglón de estado de un campo de logo.
 * Un solo lugar para el texto, para que el alta y la edición se comporten igual.
 */
function pintarEstadoLogo(idEstado, texto, esError) {
    const caja = $(idEstado);
    if (!caja) return;
    caja.textContent = texto;
    caja.style.color = esError
        ? 'var(--color-danger)'
        : 'var(--color-success)';
    caja.style.fontWeight = esError ? '700' : '600';
}

// --- Alta de empresa --------------------------------------------------------

// Promesa de la subida en curso. El alta la espera antes de leer el campo: si
// el SuperAdmin elige el archivo y aprieta "Crear empresa" enseguida, el alta
// se mandaría con el logo vacío y la imagen quedaría subida pero huérfana.
let logoAltaEnCurso = null;

const inputLogoAlta = $('alta-logo-archivo');
if (inputLogoAlta) {
    inputLogoAlta.addEventListener('change', () => {
        const archivo = inputLogoAlta.files && inputLogoAlta.files[0];
        if (!archivo) return;

        pintarEstadoLogo('alta-logo-estado', `Subiendo "${archivo.name}"...`, false);

        logoAltaEnCurso = subirLogo(archivo, (url, error) => {
            if (error) {
                pintarEstadoLogo('alta-logo-estado', error, true);
                inputLogoAlta.value = '';
            } else {
                $('alta-logo').value = url;
                pintarEstadoLogo(
                    'alta-logo-estado',
                    `"${archivo.name}" subido. Se puede borrar del servidor más adelante.`,
                    false
                );
            }
            logoAltaEnCurso = null;
        }, $('alta-slug') ? $('alta-slug').value.trim() : '');
    });
}

// --- Edición de una empresa existente ---------------------------------------

// El detalle se dibuja dinámicamente, así que el input de archivo no existe
// cuando se registra el listener. Se escucha en `document` y se filtra por id.
document.addEventListener('change', (e) => {
    if (e.target.id !== 'detalle-logo-archivo') return;
    const archivo = e.target.files && e.target.files[0];
    if (!archivo) return;

    pintarEstadoLogo('detalle-logo-estado', `Subiendo "${archivo.name}"...`, false);

    subirLogo(archivo, (url, error) => {
        if (error) {
            pintarEstadoLogo('detalle-logo-estado', error, true);
            e.target.value = '';
            return;
        }
        // Se escribe en el campo de texto y no se manda el PATCH solo: el
        // botón "Guardar" es el que confirma. Subir el archivo no es cambiar la
        // empresa, y guardar sin querer porque se eligió un archivo sería una
        // sorpresa.
        //
        // El id sale del mismo `campo()` que arma el resto del formulario
        // (`det-dato-` + nombre de columna), no de un nombre inventado acá: si
        // se escribiera uno propio, el campo quedaría sin llenar y el "Guardar"
        // mandaría `logo_url` vacío, borrando el logo que ya estaba.
        const destino = $('det-dato-logo_url');
        if (destino) destino.value = url;
        pintarEstadoLogo(
            'detalle-logo-estado',
            `"${archivo.name}" subido. Presioná "Guardar datos y marca" para que quede.`,
            false
        );
    }, e.target.dataset.slug || '');
});

// ==========================================================================
// Aviso flotante
// ==========================================================================

let relojAviso = null;

function avisar(texto, esError = false) {
    const caja = $('aviso');
    caja.textContent = texto;
    caja.classList.toggle('error', esError);
    caja.style.display = 'block';

    clearTimeout(relojAviso);
    relojAviso = setTimeout(() => { caja.style.display = 'none'; }, esError ? 9000 : 4500);
}

/**
 * Muestra el error del servidor tal cual vino.
 *
 * Varios mensajes son de varias líneas a propósito (el del permiso que falta
 * trae el comando a correr). Se mete con `textContent`, nunca con
 * `innerHTML`: el texto viene de la base y va tal cual a la pantalla.
 */
function mostrarError(idCaja, mensaje) {
    const caja = $(idCaja);
    caja.textContent = mensaje;
    caja.style.display = 'block';
}

// ==========================================================================
// Arranque de la pantalla
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // El ícono del botón de tema lo pone el CSS según `html.tema-claro`, así
    // que acá no hay que hacer nada. Antes esta línea llamaba a
    // `ajustarIconoTema()`, que hacía lo contrario con estilos en línea y por
    // eso el ícono de esta página era el contrario al de las otras cinco.

    // Las muescas de color van alrededor de los campos de color del alta.
    envolverCamposColor();

    $('input-buscar').addEventListener('input', pintarEmpresas);
    $('filtro-estado').addEventListener('change', pintarEmpresas);
    $('form-alta').addEventListener('submit', enviarAlta);

    await cargarCatalogos();
    await cargarEmpresas();
    await cargarAuditoria();
});

/**
 * Que el ícono del botón de tema corresponda al tema activo.
 *
 * BORRADA A PROPÓSITO. El ícono lo decide el CSS (`html.tema-claro
 * .btn-alternar-tema .icono-*` en style.css) y muestra a qué tema se pasa al
 * hacer clic. Esta función hacía lo contrario con estilos en línea: en tema
 * oscuro ponía la luna. Como el estilo en línea le gana a la hoja de estilos,
 * en el panel del SuperAdmin el ícono era el contrario del de las otras cinco
 * páginas para el mismo estado. Si alguna vez hay que volver a tocar el ícono
 * desde JS, es en style.css.
 */

// ==========================================================================
// Catálogos (planes y módulos)
// ==========================================================================

async function cargarCatalogos() {
    try {
        const r = await apiFetch(`${API}/admin/catalogos`);
        if (!r.ok) throw new Error('El servidor no devolvió los catálogos.');
        const d = await r.json();

        admin.planes = d.planes || [];
        admin.modulosCatalogo = d.modulos || [];

        // El <select> de plan del alta. Se muestran los usuarios que incluye
        // cada uno, porque es lo que el SuperAdmin va a tener que recordar
        // cuando le pregunten "cuántos usuarios le puedo agregar".
        const sel = $('alta-plan');
        sel.innerHTML = admin.planes.map((p) => {
            const us = p.max_usuarios === null ? 'sin límite' : `${p.max_usuarios} usuarios`;
            return `<option value="${escapeHtml(p.codigo)}">${escapeHtml(p.nombre)} — ${us}</option>`;
        }).join('');

        if (admin.planes.length) {
            const basico = admin.planes.find((p) => p.codigo === 'basico');
            if (basico) sel.value = 'basico';
        }
    } catch (err) {
        console.error(err);
        avisar('No se pudieron cargar los planes ni los módulos.', true);
    }
}

// ==========================================================================
// Listado de empresas
// ==========================================================================

async function cargarEmpresas() {
    try {
        const r = await apiFetch(`${API}/admin/empresas`);
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.error || 'No se pudo pedir la lista de empresas.');
        }
        const d = await r.json();

        admin.empresas = d.empresas || [];
        admin.planes = d.planes || admin.planes;

        pintarResumen();
        pintarEmpresas();
    } catch (err) {
        console.error(err);
        $('tabla-empresas').innerHTML =
            `<tr><td colspan="6" class="admin-error" style="text-align:left;">${escapeHtml(err.message)}</td></tr>`;
    }
}

/** Los tres números de arriba. */
function pintarResumen() {
    const porEstado = (e) => admin.empresas.filter((x) => x.estado === e).length;
    const conAviso = admin.empresas.filter((e) => e.excede_usuarios).length;

    const items = [
        { n: admin.empresas.length, t: 'Empresas' },
        { n: admin.empresas.reduce((s, e) => s + (e.usuarios_activos || 0), 0), t: 'Usuarios activos' },
        { n: porEstado('ACTIVO'), t: 'Activas' },
        { n: porEstado('DEMO'), t: 'En demo' },
        { n: porEstado('SUSPENDIDO'), t: 'Suspendidas' }
    ];
    if (conAviso) items.push({ n: conAviso, t: 'Sobre el límite de usuarios' });

    $('resumen').innerHTML = items.map((i) => `
        <div class="admin-resumen-item">
            <div class="numero">${i.n}</div>
            <div class="etiqueta">${escapeHtml(i.t)}</div>
        </div>
    `).join('');
}

/**
 * Dibuja la tabla, ya filtrada por lo que se escribió en el buscador.
 *
 * El filtro es de los datos que YA están cargados: son pocas empresas y no
 * vale la pena un pedido al servidor por cada tecla.
 */
function pintarEmpresas() {
    const texto = $('input-buscar').value.trim().toLowerCase();
    const estado = $('filtro-estado').value;

    const lista = admin.empresas.filter((e) => {
        if (estado && e.estado !== estado) return false;
        if (!texto) return true;
        return [e.nombre, e.slug, e.nombre_db, e.plan].some(
            (c) => String(c || '').toLowerCase().includes(texto)
        );
    });

    const cuerpo = $('tabla-empresas');
    if (!lista.length) {
        cuerpo.innerHTML = `<tr><td colspan="6" class="texto-vacio">${
            admin.empresas.length ? 'Ninguna empresa coincide con el filtro.' : 'Todavía no hay empresas dadas de alta.'
        }</td></tr>`;
        return;
    }

    const ESTADOS = ['ACTIVO', 'DEMO', 'SUSPENDIDO', 'BAJA'];

    cuerpo.innerHTML = lista.map((e) => {
        const limite = e.max_usuarios === null ? '∞' : e.max_usuarios;
        const exceso = e.excede_usuarios
            ? `<span title="Tiene más usuarios de los que cubre su plan" style="color:var(--color-danger);"> ⚠</span>`
            : '';

        return `
        <tr>
            <td>
                <strong>${escapeHtml(e.nombre)}</strong><br>
                <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(e.slug)} · ${escapeHtml(e.rubro)}</span>
            </td>
            <td style="font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--text-muted);">
                ${escapeHtml(e.nombre_db)}
            </td>
            <td>
                ${escapeHtml(e.plan_nombre)}
                <br><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(e.plan)}</span>
            </td>
            <td>${e.usuarios_activos || 0} / ${limite}${exceso}</td>
            <td>
                <span class="admin-estado admin-estado-${escapeHtml(e.estado)}">${escapeHtml(e.estado)}</span>
            </td>
            <td style="text-align:right;white-space:nowrap;">
                <select class="admin-select-estado" onchange="cambiarEstado(${e.id}, this.value, this)"
                        style="height:32px;font-size:12px;padding:0 6px;margin-right:6px;"
                        title="Cambiar el estado">
                    ${ESTADOS.map((s) => `<option value="${s}" ${s === e.estado ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <button class="btn-tabla btn-info" style="padding:5px 11px;font-size:12px;"
                        onclick="abrirDetalle(${e.id})">Ver</button>
            </td>
        </tr>`;
    }).join('');
}

/**
 * Cambia el estado desde la tabla.
 *
 * Si el pedido falla, se recarga la lista: el `select` queda mostrando lo
 * que el usuario eligió, y si el servidor no lo aceptó eso sería una mentira
 * en pantalla. Recargar lo deja igual a la realidad.
 */
async function cambiarEstado(id, valor, select) {
    try {
        const r = await apiFetch(`${API}/admin/empresas/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: valor })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'No se pudo cambiar el estado.');

        avisar(d.mensaje || 'Estado cambiado.');
        await cargarEmpresas();
    } catch (err) {
        avisar(err.message, true);
        await cargarEmpresas();
    }
}

// ==========================================================================
// Alta de empresa
// ==========================================================================

function abrirModalAlta() {
    $('form-alta').reset();
    $('form-alta').style.display = '';
    $('alta-error').style.display = 'none';
    $('alta-avance').style.display = 'none';
    $('btn-alta-enviar').disabled = false;
    $('btn-alta-enviar').textContent = 'Crear empresa';
    abrirModal('modal-alta');
}

/**
 * Manda el alta y muestra el avance.
 *
 * Esto tarda: crea una base MySQL entera y le aplica el esquema y las
 * migraciones. Un `fetch` sin timeout puede quedarse esperando un rato, así
 * que se avisa en pantalla y se deshabilita el formulario para que no se
 * manden dos altas con doble clic.
 */
async function enviarAlta(e) {
    e.preventDefault();
    if (admin.dandoDeAlta) return;

    const email = $('alta-admin-email').value.trim();
    const password = $('alta-admin-password').value;

    // Lo mismo que valida el servidor, acá para no hacer esperar el alta
    // completa y tirando la base entera por un email mal escrito.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        mostrarError('alta-error', `"${email}" no parece un email válido.`);
        return;
    }
    if (password.length < 8) {
        mostrarError('alta-error', 'La contraseña tiene que tener al menos 8 caracteres.');
        return;
    }

    admin.dandoDeAlta = true;
    $('form-alta').style.display = 'none';
    $('alta-error').style.display = 'none';
    $('alta-avance').style.display = 'block';
    $('alta-avance-texto').textContent =
        `Creando la base de datos de "${$('alta-nombre').value.trim()}" y aplicando el esquema...`;

    // Si hay un logo subiendo, se espera antes de armar el cuerpo. Sin esta
    // espera, elegir el archivo y apretar "Crear empresa" enseguida manda el
    // alta con `logo_url` vacío: la empresa queda creada sin marca y la imagen
    // queda subida a Cloudinary sin que nada la apunte.
    if (logoAltaEnCurso) {
        try {
            await logoAltaEnCurso;
        } catch {
            // `subirLogo` no rechaza: avisa por callback. Si llegó acá es que
            // la promesa se rompió sola, y se sigue con lo que haya quedado.
        }
    }

    const cuerpo = {
        nombre: $('alta-nombre').value.trim(),
        rubro: $('alta-rubro').value,
        plan: $('alta-plan').value,
        estado: $('alta-estado').value,
        slug: $('alta-slug').value.trim() || undefined,
        marca: {
            subtitulo: $('alta-subtitulo').value.trim() || null,
            logo_url: $('alta-logo').value.trim() || null,
            color_primario: $('alta-color-primario').value.trim() || null,
            color_secundario: $('alta-color-secundario').value.trim() || null
        },
        contacto: {
            telefono: $('alta-telefono').value.trim() || null,
            email_contacto: $('alta-email-contacto').value.trim() || null,
            direccion: $('alta-direccion').value.trim() || null,
            cuit: $('alta-cuit').value.trim() || null
        },
        admin_email: email,
        admin_nombre: $('alta-admin-nombre').value.trim() || 'Administrador',
        admin_password: password
    };

    try {
        const r = await apiFetch(`${API}/admin/empresas`, {
            method: 'POST',
            body: JSON.stringify(cuerpo)
        });
        const d = await r.json();

        if (!r.ok) {
            // El mensaje del servidor se muestra tal cual: varios son de
            // varias líneas con el comando que hay que correr adentro.
            mostrarError('alta-error', d.error || 'No se pudo crear la empresa.');
            $('form-alta').style.display = '';
            $('alta-avance').style.display = 'none';
            return;
        }

        cerrarModal('modal-alta');
        avisar(`Empresa "${d.empresa.nombre}" dada de alta.\nBase: ${d.empresa.nombre_db}`);
        await cargarEmpresas();
        await cargarAuditoria();
        abrirDetalle(d.empresa.id);

    } catch (err) {
        console.error(err);
        mostrarError('alta-error', `No se pudo conectar con el servidor.\n${err.message}`);
        $('form-alta').style.display = '';
        $('alta-avance').style.display = 'none';
    } finally {
        admin.dandoDeAlta = false;
    }
}

// ==========================================================================
// Detalle de una empresa
// ==========================================================================

async function abrirDetalle(id) {
    abrirModal('modal-detalle');
    $('detalle-cuerpo').innerHTML = '<p class="texto-vacio">Cargando...</p>';
    $('detalle-titulo').textContent = 'Empresa';

    try {
        const r = await apiFetch(`${API}/admin/empresas/${id}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'No se pudo cargar la empresa.');

        admin.abierta = d;
        $('detalle-titulo').textContent = d.empresa.nombre;
        $('detalle-cuerpo').innerHTML = pintarDetalle(d);
    } catch (err) {
        $('detalle-cuerpo').innerHTML = `<div class="admin-error">${escapeHtml(err.message)}</div>`;
    }
}

/** Dibuja el modal de detalle. `d` es la respuesta de GET /api/admin/empresas/:id */
function pintarDetalle(d) {
    const e = d.empresa;

    const dato = (clave, valor) => `
        <div class="admin-dato">
            <div class="clave">${escapeHtml(clave)}</div>
            <div class="valor ${valor ? '' : 'vacio'}">${valor ? escapeHtml(valor) : 'sin cargar'}</div>
        </div>`;

    /*
     * Atajo para los controles del formulario de datos.
     *
     * El `data-campo` lleva el NOMBRE de la columna, que no siempre se deduce
     * del id del control. Es lo que permite que la función que guarda sea
     * una sola y no una tabla de ids: lee los `[data-campo]` del formulario y
     * arma el PATCH con lo que encuentra.
     */
    const campo = (etiqueta, columna, tipo, opciones = {}) => {
        const id = `det-dato-${columna}`;
        const valor = (e[columna] === null || e[columna] === undefined) ? '' : String(e[columna]);
        const comunes = `id="${id}" data-campo="${columna}" placeholder="${escapeHtml(opciones.pista || 'Sin cargar')}"`
                        + (opciones.requerido ? ' required' : '');

        if (tipo === 'select') {
            return `
                <div class="campo">
                    <label for="${id}">${escapeHtml(etiqueta)}</label>
                    <select ${comunes}>
                        ${opciones.valores.map((v) => `
                            <option value="${escapeHtml(v[0])}" ${v[0] === valor ? 'selected' : ''}>
                                ${escapeHtml(v[1])}
                            </option>`).join('')}
                    </select>
                </div>`;
        }

        if (tipo === 'color') {
            /*
             * Un <input type="color"> no admite valor vacío: el navegador le
             * pone uno por su cuenta (#000000) si no hay. Como el cliente
             * puede no tener color cargado todavía, se le pone un azul
             * genérico que se ve en el cuadradito de al lado, y el campo de
             * texto es el que manda de verdad. Si se guardara el color del
             * cuadradito, un cliente sin marca cargada quedaría con azul
             * puesto sin que nadie lo haya elegido.
             */
            const colorValido = /^#[0-9a-fA-F]{6}$/.test(valor);
            return `
                <div class="campo">
                    <label for="${id}">${escapeHtml(etiqueta)}</label>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <input type="color" data-color-aux="${id}" value="${colorValido ? valor : '#1a7fbc'}"
                               style="width:46px;height:38px;padding:2px;cursor:pointer;flex-shrink:0;"
                               aria-hidden="true" tabindex="-1">
                        <input type="text" ${comunes} value="${escapeHtml(valor)}"
                               style="flex:1;min-width:0;font-family:monospace;" maxlength="7">
                    </div>
                </div>`;
        }

        return `
            <div class="campo">
                <label for="${id}">${escapeHtml(etiqueta)}</label>
                <input type="${tipo}" ${comunes} value="${escapeHtml(valor)}">
            </div>`;
    };

    return `
        <div class="admin-detalle-seccion">
            <h3>Datos de la empresa</h3>
            <div class="admin-grilla">
                ${campo('Nombre', 'nombre', 'text', { requerido: true, pista: 'Nombre de la empresa S.A.' })}
                ${campo('Rubro', 'rubro', 'select', {
                    valores: [
                        ['taller', 'Taller / Mecánico'],
                        ['cerrajeria', 'Cerrajería'],
                        ['electricidad', 'Electricidad'],
                        ['plomeria', 'Plomería'],
                        ['climatizacion', 'Climatización'],
                        ['computacion', 'Computación'],
                        ['general', 'General']
                    ]
                })}
                ${campo('Subtítulo', 'subtitulo', 'text', { pista: 'Nombre de la empresa · Rubro' })}
            </div>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Marca y comprobantes</h3>
            <div class="admin-grilla">
                ${campo('Teléfono', 'telefono', 'tel', { pista: '+54 11 1234-5678' })}
                ${campo('Email de contacto', 'email_contacto', 'email', { pista: 'contacto@empresa.com' })}
                ${campo('Dirección', 'direccion', 'text', { pista: 'Av. Siempreviva 742' })}
                ${campo('CUIT', 'cuit', 'text', { pista: '30-12345678-9' })}
                ${campo('Color primario', 'color_primario', 'color')}
                ${campo('Color secundario', 'color_secundario', 'color')}
            </div>
            <div class="admin-grilla" style="margin-top:12px;">
                ${campo('Dirección del logo', 'logo_url', 'url', { pista: 'https://.../logo.png' })}
                <div class="campo">
                    <label for="detalle-logo-archivo">Subir desde un archivo</label>
                    <input type="file" id="detalle-logo-archivo"
                           data-slug="${escapeHtml(e.slug)}"
                           accept="image/png,image/jpeg,image/webp,image/gif">
                    <div id="detalle-logo-estado" class="admin-pista" style="margin-top:6px;">
                        ${e.logo_url
                            ? 'Hay un logo cargado. Subir otro lo reemplaza al guardar.'
                            : 'Sin logo. Mientras esté vacío, los presupuestos se imprimen sin marca.'}
                    </div>
                </div>
                <div class="campo" style="align-self:end;">
                    <button class="btn btn-actualizar" style="width:100%;" onclick="guardarDatosEmpresa(${e.id})">
                        Guardar datos y marca
                    </button>
                </div>
            </div>
            ${e.logo_url ? `
                <div class="admin-pista" style="display:flex;align-items:center;gap:12px;margin-top:10px;">
                    <img src="${escapeHtml(e.logo_url)}" alt="Logo actual"
                         style="max-height:46px;max-width:150px;object-fit:contain;background:#fff;padding:5px;border-radius:6px;border:1px solid var(--border-color);">
                    <span>Así se ve hoy en el presupuesto.</span>
                </div>` : ''}
            <small class="admin-pista" style="display:block;margin-top:8px;">
                Teléfono, dirección y CUIT salen impresos en presupuestos y órdenes: si
                faltan, el comprobante se imprime sin ellos. El logo se sube desde el archivo
                de arriba (JPG, PNG, WEBP o GIF, hasta 5 MB) o se pega la dirección si la
                marca ya vive en un CDN. Un SVG puede ejecutar código y el servidor lo rechaza.
            </small>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Identificación técnica</h3>
            <div class="admin-datos">
                ${dato('Identificador', e.slug)}
                ${dato('Base de datos', e.nombre_db)}
                ${dato('Alta', e.fecha_alta ? new Date(e.fecha_alta).toLocaleString('es-AR') : null)}
                ${dato('Vencimiento', e.fecha_vencimiento)}
                ${dato('Estado', e.estado)}
            </div>
            <small class="admin-pista" style="display:block;margin-top:8px;">
                El identificador y la base de datos no se cambian desde acá, a propósito.
                El identificador es el subdominio con el que se resuelve la empresa antes
                de iniciar sesión, y la base es contra la que se abre la conexión de cada
                pedido. Tocarlos desde un formulario rompe cosas que no se ven.
            </small>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Plan y suscripción</h3>
            <div class="admin-grilla">
                <div class="campo">
                    <label for="det-plan">Plan</label>
                    <select id="det-plan" onchange="guardarCambios(${e.id}, 'plan', this.value, this)">
                        ${admin.planes.map((p) => `
                            <option value="${escapeHtml(p.codigo)}" ${p.codigo === e.plan ? 'selected' : ''}>
                                ${escapeHtml(p.nombre)}
                            </option>`).join('')}
                    </select>
                </div>
                <div class="campo">
                    <label for="det-max-usuarios">Límite de usuarios</label>
                    <input type="number" id="det-max-usuarios" min="0"
                           placeholder="${e.max_usuarios === null ? 'del plan' : e.max_usuarios}"
                           value="${e.max_usuarios === null ? '' : e.max_usuarios}">
                    <small class="admin-pista">Vacío = el que da el plan.</small>
                </div>
                <div class="campo">
                    <label for="det-vencimiento">Vencimiento</label>
                    <input type="date" id="det-vencimiento" value="${escapeHtml(e.fecha_vencimiento || '')}">
                </div>
                <div class="campo">
                    <label>&nbsp;</label>
                    <button class="btn btn-actualizar" style="width:100%;" onclick="guardarSuscripcion(${e.id})">
                        Guardar plan y suscripción
                    </button>
                </div>
            </div>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Módulos contratados</h3>
            <div class="admin-modulos">
                ${d.modulos.map((m) => `
                    <button class="admin-modulo ${m.activo ? 'activo' : ''} ${m.es_base ? 'base' : ''}"
                            ${m.es_base ? 'disabled title="Módulo base: todas las empresas lo tienen"' : ''}
                            onclick="alternarModulo(${e.id}, '${escapeHtml(m.codigo)}', ${m.activo ? 0 : 1}, this)">
                        ${escapeHtml(m.nombre)}${m.es_base ? ' (base)' : ''}
                    </button>`).join('')}
            </div>
            <small class="admin-pista" style="display:block;margin-top:8px;">
                Los módulos base no se pueden sacar. Agregar uno lo habilita en el
                menú y sus rutas dejan de contestar 404 de una.
            </small>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Usuarios (${d.usuarios.length})</h3>
            <div class="admin-lista-usuarios">
                ${d.usuarios.length ? d.usuarios.map((u) => `
                    <div class="admin-usuario-fila ${u.activo ? '' : 'admin-usuario-inactivo'}">
                        <div>
                            <strong>${escapeHtml(u.nombre)}</strong>
                            <span class="admin-tag-rol ${escapeHtml(u.rol)}">${escapeHtml(u.rol)}</span>
                            ${u.activo ? '' : '<span class="admin-pista"> (desactivado)</span>'}
                            ${u.debe_cambiar_password ? '<span class="admin-tag-pendiente" title="Entró con una clave temporal y todavía no la cambió"> clave temporal</span>' : ''}
                            <br><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(u.email)}</span>
                        </div>
                        <div class="admin-usuario-acciones">
                            <div style="font-size:11px;color:var(--text-muted);text-align:right;">
                                ${u.ultimo_acceso ? 'Entró: ' + new Date(u.ultimo_acceso).toLocaleString('es-AR') : 'Nunca entró'}
                            </div>
                            ${u.rol === 'ADMIN' && u.activo ? `
                                <button type="button" class="admin-btn-chico"
                                        onclick="abrirSesionSoporte(${e.id}, ${u.id}, ${escapeHtml(JSON.stringify(u.nombre))}, ${escapeHtml(JSON.stringify(u.email))})">
                                    Entrar como
                                </button>
                            ` : ''}
                            <button type="button" class="admin-btn-chico admin-btn-chico-alerta"
                                    onclick="generarClaveTemporal(${e.id}, ${u.id}, ${escapeHtml(JSON.stringify(u.email))})">
                                Clave temporal
                            </button>
                        </div>
                    </div>`).join('') : '<p class="texto-vacio">Sin usuarios.</p>'}
            </div>
            <small class="admin-pista" style="display:block;margin-top:8px;">
                Los usuarios se administran desde la propia empresa, en su pantalla de
                usuarios. El límite del plan los frena a ellos; el panel solo lo cambia.
                <br>
                <b>Entrar como</b> abre el sistema de esta empresa con la sesión de ese
                usuario, durante 30 minutos, y queda registrado con tu nombre.
                <br>
                <b>Clave temporal</b> es para cuando un cliente se olvidó la suya: la
                genera el sistema, no vos, y tenés que leerla por teléfono. Al entrar con
                esa clave queda obligado a cambiarla antes de usar nada.
            </small>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Notas internas</h3>
            <textarea id="det-notas" rows="3" style="width:100%;"
                      placeholder="Cómo paga, quién es el contacto, algún compromiso...">${escapeHtml(e.notas || '')}</textarea>
        </div>

        <div class="admin-detalle-seccion">
            <h3>Auditoría de esta empresa</h3>
            <div style="font-size:12px;max-height:190px;overflow-y:auto;">
                ${d.auditoria.length ? d.auditoria.map((a) => `
                    <div style="padding:5px 0;border-bottom:1px solid var(--border-color);">
                        <strong>${escapeHtml(a.accion)}</strong>
                        <span style="color:var(--text-muted);">por ${escapeHtml(a.email || 'sistema')}</span><br>
                        <span style="font-size:11px;color:var(--text-muted);">
                            ${new Date(a.creado_en).toLocaleString('es-AR')} ·
                            ${escapeHtml((typeof a.detalle === 'string' ? a.detalle : JSON.stringify(a.detalle)) || '')}
                        </span>
                    </div>`).join('') : '<p class="texto-vacio">Sin movimientos.</p>'}
            </div>
        </div>

        <div class="admin-zona-peligro">
            <h3>Baja</h3>
            <p class="admin-nota-peligro">
                Dar de baja corta el acceso en el pedido siguiente: la empresa no puede
                entrar más, pero los datos quedan y se pueden volver a activar.
                Borrar la base no se puede deshacer.
            </p>
            <button class="btn btn-eliminar" style="margin-right:8px;" onclick="darDeBaja(${e.id}, false)">
                Dar de baja (conservar datos)
            </button>
            <button class="btn btn-eliminar" onclick="darDeBaja(${e.id}, true)">
                Borrar empresa y base de datos
            </button>
        </div>`;
}

/** Guarda plan / límite / vencimiento / notas en un solo PATCH. */
async function guardarSuscripcion(id) {
    const limiteRaw = $('det-max-usuarios').value.trim();
    const cuerpo = {
        plan: $('det-plan').value,
        max_usuarios: limiteRaw === '' ? null : Number(limiteRaw),
        fecha_vencimiento: $('det-vencimiento').value || null,
        notas: $('det-notas').value
    };

    if (cuerpo.max_usuarios !== null && (!Number.isInteger(cuerpo.max_usuarios) || cuerpo.max_usuarios < 0)) {
        avisar('El límite de usuarios tiene que ser un número entero, o dejarlo vacío.', true);
        return;
    }

    try {
        const r = await apiFetch(`${API}/admin/empresas/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(cuerpo)
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'No se pudieron guardar los cambios.');
        avisar('Guardado.');
        await cargarEmpresas();
        await abrirDetalle(id);
    } catch (err) {
        avisar(err.message, true);
    }
}

/** Cambio suelto de plan o de otro campo, desde un control del detalle. */
async function guardarCambios(id, campo, valor) {
    try {
        const r = await apiFetch(`${API}/admin/empresas/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ [campo]: valor })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
        avisar(d.mensaje || 'Guardado.');
        await cargarEmpresas();
    } catch (err) {
        avisar(err.message, true);
        await abrirDetalle(id);
    }
}

/**
 * Guarda TODOS los campos de datos y marca de una empresa en un solo PATCH.
 *
 * Por que todos juntos y no uno por uno al perder el foco:
 *   - El PATCH del backend solo arma el UPDATE con los campos que cambian, y
 *     devuelve un arreglo `cambios` con lo que efectivamente se movio. Mandando
 *     todo de una vez se ve ese resumen, que es lo que uno quiere saber: "que
 *     toco". Mandando campo por campo se verian diez mensajes de "guardado".
 *   - Diez requests por guardado es una forma facil de que uno falle en
 *     silencio y queden la mitad de los datos viejos.
 *
 * Los campos se leen por `[data-campo]`, asi que agregar uno nuevo es
 * agregar una linea en `pintarDetalle` y nada mas: no hay que tocar esta
 * funcion ni el backend.
 */
async function guardarDatosEmpresa(id) {
    const cuerpo = document.getElementById('detalle-cuerpo');
    const controles = cuerpo.querySelectorAll('[data-campo]');
    if (!controles.length) return;

    const datos = {};
    controles.forEach((el) => { datos[el.dataset.campo] = el.value; });

    // El select de rubro siempre tiene valor, asi que la validacion de "no
    // vacio" del backend no la agarra. El nombre si puede quedar en blanco.
    if (!datos.nombre || !datos.nombre.trim()) {
        avisar('El nombre de la empresa no puede quedar vacío.', true);
        const input = cuerpo.querySelector('[data-campo="nombre"]');
        if (input) input.focus();
        return;
    }

    const boton = cuerpo.querySelector('button[onclick^="guardarDatosEmpresa"]');
    if (boton) { boton.disabled = true; boton.textContent = 'Guardando...'; }

    try {
        const r = await apiFetch(`${API}/admin/empresas/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(datos)
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');

        avisar(d.mensaje || 'Guardado.');
        await cargarEmpresas();
        await abrirDetalle(id);
    } catch (err) {
        avisar(err.message, true);
        // No se recarga el detalle: recargarlo borra lo que el SuperAdmin
        // acaba de escribir y obliga a reescribirlo entero.
        if (boton) { boton.disabled = false; boton.textContent = 'Guardar datos y marca'; }
    }
}

/**
 * Mantiene el cuadradito de color pegado al texto de al lado.
 *
 * El texto manda: se puede escribir a mano y el servidor lo valida. El
 * cuadradito es la Vista previa, y va al revés porque escribir "#a1b2c3" es
 * mas comodo que mover un control de color.
 */
document.addEventListener('input', (ev) => {
    const texto = ev.target;
    if (!texto.matches || !texto.matches('input[data-campo^="color_"]')) return;
    const valor = texto.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(valor)) return;
    const aux = document.querySelector(`input[data-color-aux="${texto.id}"]`);
    if (aux) aux.value = valor;
});

// ==========================================================================
// Módulos
// ==========================================================================

async function alternarModulo(empresaId, codigo, activo, boton) {
    boton.disabled = true;
    try {
        const r = await apiFetch(`${API}/admin/empresas/${empresaId}/modulos/${encodeURIComponent(codigo)}`, {
            method: 'PATCH',
            body: JSON.stringify({ activo: !!activo })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'No se pudo cambiar el módulo.');

        avisar(d.mensaje);
        await cargarEmpresas();
        await abrirDetalle(empresaId);
    } catch (err) {
        avisar(err.message, true);
        boton.disabled = false;
    }
}

// ==========================================================================
// Baja
// ==========================================================================

/**
 * Baja de una empresa.
 *
 * `dura` es la que borra la base, y por eso pide escribir el identificador
 * de la empresa: un `confirm()` con "sí" o "no" es demasiado fácil de
 * apretar sin querer y acá no hay forma de deshacerlo.
 */
async function darDeBaja(id, dura) {
    const d = admin.abierta && admin.abierta.empresa ? admin.abierta.empresa : null;
    if (!d) { avisar('No se sabe qué empresa es. Volvé a abrirla.', true); return; }

    if (dura) {
        const escrito = prompt(
            `Esto borra la base "${d.nombre_db}" con TODOS los datos de "${d.nombre}".\n` +
            `No se puede deshacer.\n\n` +
            `Escribí el identificador "${d.slug}" para confirmar:`
        );
        if (escrito === null) return;
        if (escrito.trim() !== d.slug) {
            avisar('El identificador no coincide. No se borró nada.', true);
            return;
        }
    } else if (!confirm(`¿Dar de baja "${d.nombre}"?\n\nNo va a poder entrar más, pero los datos quedan.`)) {
        return;
    }

    try {
        const url = `${API}/admin/empresas/${id}` + (dura ? '?borrarBase=si' : '');
        const r = await apiFetch(url, {
            method: 'DELETE',
            body: JSON.stringify({ motivo: prompt('Motivo (queda en la auditoría):') || '' })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'No se pudo dar de baja.');

        cerrarModal('modal-detalle');
        avisar(j.mensaje);
        await cargarEmpresas();
        await cargarAuditoria();
    } catch (err) {
        avisar(err.message, true);
    }
}

// ==========================================================================
// Auditoría general
// ==========================================================================

async function cargarAuditoria() {
    try {
        const r = await apiFetch(`${API}/admin/auditoria?limite=40`);
        if (!r.ok) throw new Error('No se pudo cargar la auditoría.');
        const d = await r.json();

        const cuerpo = $('tabla-auditoria');
        if (!d.auditoria.length) {
            cuerpo.innerHTML = '<tr><td colspan="5" class="texto-vacio">Todavía no hay movimientos.</td></tr>';
            return;
        }

        cuerpo.innerHTML = d.auditoria.map((a) => `
            <tr>
                <td style="font-size:12px;white-space:nowrap;">${new Date(a.creado_en).toLocaleString('es-AR')}</td>
                <td><code style="font-size:12px;">${escapeHtml(a.accion)}</code></td>
                <td style="font-size:12px;">${escapeHtml(a.email || 'sistema')}</td>
                <td style="font-size:12px;">${escapeHtml(a.empresa || '—')}</td>
                <td style="font-size:11px;color:var(--text-muted);">${
                    escapeHtml(a.detalle
                        ? (typeof a.detalle === 'string' ? a.detalle : JSON.stringify(a.detalle))
                        : '')
                }</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error(err);
        $('tabla-auditoria').innerHTML =
            `<tr><td colspan="5" class="texto-vacio">No se pudo cargar la auditoría.</td></tr>`;
    }
}

// ==========================================================================
// SOPORTE: ENTRAR COMO + CLAVE TEMPORAL
// ==========================================================================
//
// Estas dos funciones rompen la regla del panel (no ver datos de un cliente).
// La diferencia con "ver los datos en silencio" es que:
//
//   1. Son SESIONES, no pantallas: el panel emite un token y la pestaña del
//      navegador se va a otro origen. Lo que se haga en esa pestaña queda en
//      nombre de un usuario de la empresa, no del SuperAdmin.
//
//   2. La sesion dura 30 minutos y NO se renueva sola. Al vencer, el usuario
//      vuelve a login.html y ya no puede entrar sin pedir otra.
//
//   3. Cada uso queda en la auditoria con: quien lo pidio, que empresa, que
//      usuario de la empresa, desde que IP, y cuanto durara.
//
//   4. El frontend muestra un BANNER FIJO que no se puede cerrar: "Sesion de
//      soporte. Estas viendo [empresa] como [usuario]." Si el banner no esta,
//      la regla de "no ver datos de un cliente" se rompe en el primer uso.
//
//   5. El token de soporte NO puede volver al panel (exige rol SUPERADMIN y
//      este es ADMIN/TECNICO de la empresa). No hay ida y vuelta.
//
// "Entrar como" abre el sistema en una NUEVA PESTAÑA con el token de soporte.
// "Clave temporal" genera una clave aleatoria, la muestra UNA SOLA VEZ, y el
// SuperAdmin la lee por telefono. El usuario queda con debe_cambiar_password
// y el servidor le cierra todas las puertas menos la de cambiar la clave.
// --------------------------------------------------------------------------

/** Abre una sesion de soporte (30 min) en una nueva pestaña. */
async function abrirSesionSoporte(empresaId, usuarioId, usuarioNombre, usuarioEmail) {
    const ok = confirm(
        `Vas a entrar a ver el sistema de esta empresa como:\n` +
        `  ${usuarioNombre} (${usuarioEmail})\n\n` +
        `La sesión dura 30 minutos, queda registrada en la auditoría\n` +
        `con tu nombre y todo lo que hagas queda en nombre de ese usuario.\n\n` +
        `Se abrirá en una nueva pestaña. ¿Continuar?`
    );
    if (!ok) return;

    const r = await apiFetch(`${API}/admin/empresas/${empresaId}/sesion`, {
        method: 'POST',
        body: JSON.stringify({ usuario_id: usuarioId })
    });

    if (!r.ok) {
        const e = await r.json();
        avisar(e.error || 'No se pudo abrir la sesión de soporte.', true);
        return;
    }

    const d = await r.json();
    // Abre en pestaña nueva: la sesion de soporte vive ahi, aislada.
    const pestaña = window.open('about:blank', '_blank');
    if (!pestaña) {
        avisar('El navegador bloqueó la ventana emergente. Permite pop-ups para este sitio.', true);
        return;
    }
    // El token va en localStorage ANTES de cargar la app, para que auth-check.js
    // lo lea y pinte el banner. localStorage es por origen, asi que el tab
    // nuevo tiene su propio y no contamina el panel.
    pestaña.document.write(`
        <html><head><meta charset="utf-8"><title>Cargando...</title></head>
        <body><script>
            localStorage.setItem('jwt_token', ${JSON.stringify(d.token)});
            localStorage.setItem('usuario_actual', ${JSON.stringify(d.usuario)});
            localStorage.setItem('empresa_actual', ${JSON.stringify(d.empresa)});
            location.href = ${JSON.stringify(window.location.origin + '/')};
        <\/script></body></html>
    `);
    pestaña.document.close();
    avisar('Sesión de soporte abierta en nueva pestaña. Dura ' + d.minutos + ' minutos.');
}

/** Genera una clave temporal y la muestra UNA SOLA VEZ. */
async function generarClaveTemporal(empresaId, usuarioId, usuarioEmail) {
    const ok = confirm(
        `Se generará una clave temporal aleatoria para:\n  ${usuarioEmail}\n\n` +
        `La clave LA GENERA EL SISTEMA, NO VOS. Se muestra una sola vez.\n` +
        `Tenés que copiarla ahora y dictarla por telefono.\n\n` +
        `El usuario entrará con esa clave y QUEDARÁ OBLIGADO a cambiarla\n` +
        `antes de poder usar cualquier otra cosa del sistema.\n\n` +
        `¿Continuar?`
    );
    if (!ok) return;

    const r = await apiFetch(`${API}/admin/empresas/${empresaId}/usuarios/${usuarioId}/clave-temporal`, {
        method: 'POST'
    });

    if (!r.ok) {
        const e = await r.json();
        avisar(e.error || 'No se pudo generar la clave temporal.', true);
        return;
    }

    const d = await r.json();
    const copiada = await navigator.clipboard.writeText(d.clave).then(() => true, () => false);

    const msg = 'CLAVE TEMPORAL (no se vuelve a ver):\n  ' + d.clave +
        '\n\n' + d.aviso +
        (copiada ? '\n\n[Copiada al portapapeles]' : '\n\n[No se pudo copiar: seleccionala manual]');
    alert(msg);

    avisar('Clave temporal generada. Se mostró una vez y ya no se puede recuperar.');
    // Refresca el detalle porque el usuario ahora tiene debe_cambiar_password = 1
    // (la lista se pinta desde el objeto `admin.empresas`, asi que no se recarga solo).
    const idx = admin.empresas.findIndex(x => x.id === empresaId);
    if (idx >= 0) {
        const u = admin.empresas[idx].usuarios.find(x => x.id === usuarioId);
        if (u) u.debe_cambiar_password = 1;
        abrirDetalle(empresaId);
    }
}

// ==========================================================================
// Muestras de color del alta
// ==========================================================================

/**
 * Pone un cuadradito del color escrito al lado de cada campo de color.
 *
 * Misma regla que `marca.js`: un color que no sea `#RGB` o `#RRGGBB` no se
 * aplica y el cuadradito queda neutro. Sirve para ver el color antes de
 * crear la empresa, no para decidir si es válido: eso lo hace el servidor.
 */
function envolverCamposColor() {
    for (const id of ['alta-color-primario', 'alta-color-secundario']) {
        const input = $(id);
        if (!input) continue;

        const envoltura = document.createElement('div');
        envoltura.className = 'admin-color-envuelto';
        input.parentElement.insertBefore(envoltura, input);
        envoltura.appendChild(input);

        const muestra = document.createElement('span');
        muestra.className = 'admin-color-muestra';
        envoltura.appendChild(muestra);

        const pintar = () => {
            const v = input.value.trim();
            muestra.style.background = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : 'transparent';
        };
        input.addEventListener('input', pintar);
        pintar();
    }
}
