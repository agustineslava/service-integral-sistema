/**
 * Carga e inyecta la marca de la empresa.
 *
 * DE DONDE VIENE LA MARCA
 * -----------------------------------------------------------------------
 * La ruta `/api/config-comercio` resuelve sola:
 *   - si hay sesion (Bearer), responde con la fila de ESA empresa;
 *   - si viene `?slug=`, responde con la marca de esa empresa;
 *   - si no hay nada de eso, responde con las variables de entorno.
 *
 * POR QUE ESTA PAGINA NO APLICA NADA SI NO HAY SESION
 * -----------------------------------------------------------------------
 * Antes, entrar a login.html sin sesion aplicaba la marca de entorno, que es
 * la de Service Integral. Con eso TODOS los clientes veian el nombre y el
 * logo de Service Integral en la pantalla de login, antes de escribir una
 * sola letra: el sistema se anunciaba como de una sola empresa, que es
 * justamente lo contrario de lo que se esta vendiendo.
 *
 * Ahora, sin token esta pagina no hace nada y deja la pantalla neutral. La
 * marca correcta la pone login.html recien cuando el email escrito
 * pertenece a una empresa (ver `aplicarMarcaDesdeConfig`).
 *
 * COMO SE USA
 * -----------------------------------------------------------------------
 *   - En el resto de las paginas: no hay que llamarla, se sola sola.
 *   - En login.html: `aplicarMarcaDesdeConfig(conf)` con lo que devuelve
 *     `/api/config-comercio?slug=...`.
 *
 * Un detalle importante: la respuesta puede traer `color_primario: null`
 * (la empresa todavia no cargo su color). En ese caso NO se toca la variable
 * de CSS, para que la pantalla conserve la paleta por defecto y no se quede
 * sin acento.
 */

/** Un color tiene que ser #RGB o #RRGGBB. Cualquier otra cosa se ignora. */
function esColorValido(valor) {
    return typeof valor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim());
}

/** Las mismas rutas relativas que usaba la version anterior. */
function rutaDeLogo(valor) {
    if (!valor) return '/logos/logo.jpg';
    const v = String(valor).trim();
    if (v.startsWith('http') || v.startsWith('/')) return v;
    return '/' + v;
}

/**
 * Oscurece un color #RRGGBB un 18%, para el estado hover.
 *
 * Se hace a mano y no con `filter: brightness()` porque ese filtro aplicaria
 * tambien al texto de los botones que ya son blancos, y un boton con el texto
 * mas claro de lo que deberia es peor que un boton sin hover.
 * Acepta tambien #RGB, que son tres caracteres y hay que duplicar.
 */
function oscurecer(color) {
    let c = color.trim();
    if (c.length === 4) {
        c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    if (!/^#[0-9a-f]{6}$/i.test(c)) return c;

    const num = parseInt(c.slice(1), 16);
    const r = Math.max(0, Math.round(((num >> 16) & 0xff) * 0.82));
    const g = Math.max(0, Math.round(((num >> 8) & 0xff) * 0.82));
    const b = Math.max(0, Math.round((num & 0xff) * 0.82));

    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Escribe una marca en la pantalla. Es la funcion que usan TODAS las paginas,
 * con o sin sesion, para no tener dos copias de la misma logica.
 *
 * Devuelve true si se aplico algo. Si la respuesta no trae nombre, no hace
 * nada y devuelve false: es preferible mostrar la marca que ya esta escrita
 * en el HTML antes que dejar la pantalla a medias.
 */
function aplicarMarcaDesdeConfig(conf) {
    if (!conf || !conf.nombre) return false;

    const nombre = String(conf.nombre);

    // 1. Pestaña del navegador. Se reemplaza el nombre viejo, que es lo que
    //    viene escrito en el <title> de cada HTML.
    document.querySelectorAll('title').forEach((t) => {
        t.textContent = t.textContent.replace('Service Integral', nombre);
    });

    // 2. Logos (login y header).
    const logoSrc = rutaDeLogo(conf.logo_url);
    document.querySelectorAll('.logo img, .login-logo').forEach((img) => {
        img.src = logoSrc;
        img.alt = `Logo ${nombre}`;
        // Si venia oculto (pantalla de login neutral), se muestra.
        img.style.display = '';
        img.hidden = false;
    });

    // 3. Nombre comercial.
    document.querySelectorAll('.login-titulo').forEach((el) => {
        el.textContent = nombre;
    });
    document.querySelectorAll('[data-neutral]').forEach((el) => {
        el.hidden = true;
    });

    const bienvenidaH1 = document.querySelector('.bienvenida h1');
    if (bienvenidaH1) {
        bienvenidaH1.textContent = `Bienvenido a ${nombre}`;
    }

    // 4. Subtitulo. Se escribe solo si la empresa lo cargo: si vino vacio, el
    //    texto que ya esta en el HTML es mejor que uno en blanco.
    if (conf.subtitulo) {
        document.querySelectorAll('.login-subtitulo').forEach((el) => {
            el.textContent = conf.subtitulo;
        });
    }

    // 5. Colores de la empresa.
    //
    // Se escriben sobre documentElement, que es el :root de la pagina. Las
    // reglas de style.css que los usan (`background-color: var(--si-blue-vibrant)`)
    // los toman de ahi, asi que con cambiar estas dos variables cambia el
    // acento de los botones, los bordes, los links y los badges de toda la
    // aplicacion, sin tocar una regla de CSS.
    //
    // `--si-blue-vibrant` es el acento (16 usos) y `--si-blue-dark` el hover
    // (2 usos). Si la empresa no cargo color_secundario se usa el primario
    // oscurecido: si no, el boton queda del mismo color al pasar el mouse y
    // el usuario no ve que se puede apretar.
    if (esColorValido(conf.color_primario)) {
        document.documentElement.style.setProperty('--si-blue-vibrant', conf.color_primario.trim());
        document.documentElement.style.setProperty('--si-blue-dark', oscurecer(conf.color_primario.trim()));
    }
    if (esColorValido(conf.color_secundario)) {
        document.documentElement.style.setProperty('--si-blue-dark', conf.color_secundario.trim());
    }

    return true;
}

/**
 * Rutina de las paginas con sesion. Sin token no hace nada: la pantalla de
 * login es neutral y la marca la elige login.html segun el email escrito.
 */
async function aplicarMarcaDinamica() {
    const token = localStorage.getItem('jwt_token');
    if (!token) return;                 // pagina de login: que siga neutral

    let conf = null;
    try {
        const res = await fetch('/api/config-comercio', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) conf = await res.json();
    } catch (err) {
        console.warn('No se pudo cargar la marca de la empresa:', err);
    }

    // `sin_empresa` = el token es valido pero no pertenece a ninguna empresa
    // (el SUPERADMIN). En ese caso la respuesta trae la marca de entorno, que
    // es la de Service Integral: aplicarla、Windows lo que hacia era poner el
    // nombre de una empresa que no es esta en una pantalla que no es de nadie.
    if (conf && conf.sin_empresa) return;

    aplicarMarcaDesdeConfig(conf);
}

document.addEventListener('DOMContentLoaded', aplicarMarcaDinamica);