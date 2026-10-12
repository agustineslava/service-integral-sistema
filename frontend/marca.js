/**
 * Carga e inyecta la marca: la de la plataforma y la de cada empresa.
 *
 * HAY DOS MARCAS DISTINTAS
 * -----------------------------------------------------------------------
 *   - Plataforma (Aexia): dueña del sistema. Se ve cuando la pantalla NO es
 *     de ninguna empresa: el login antes de escribir el correo y el panel del
 *     superadmin. Sale de `PLATAFORMA_*` (variables de entorno del servidor).
 *   - Empresa: la fila de `empresas` de la base central. Es lo que ve cada
 *     cliente una vez identificado.
 *
 * DE DONDE VIENE LA MARCA
 * -----------------------------------------------------------------------
 * La ruta `/api/config-comercio` resuelve sola:
 *   - si hay sesion (Bearer), responde con la fila de ESA empresa;
 *   - si viene `?slug=`, responde con la marca de esa empresa;
 *   - si no hay nada de eso (login, superadmin, token roto), responde con la
 *     marca de la plataforma.
 *
 * COMO SE USA
 * -----------------------------------------------------------------------
 *   - En el resto de las paginas: no hay que llamarla, se aplica sola al
 *     cargar (`aplicarMarcaDinamica`).
 *   - En login.html: `aplicarMarcaDesdeConfig(conf)` con lo que devuelve
 *     `/api/config-comercio?slug=...` cuando el email escrito es de una
 *     empresa.
 *
 * EL TITULO SE COMPONE, NUNCA SE REEMPLAZA
 * -----------------------------------------------------------------------
 * Cada HTML declara su pagina en `<title data-pagina="...">`. El titulo final
 * es `${nombre} - ${pagina}`. Antes se hacia `.replace('Service Integral',
 * nombre)`, que dependia de que el HTML tuviera el nombre de una empresa
 * escrito a mano: con dos empresas eso era una fuga de marca.
 */

/** Logo neutro para una empresa que todavia no cargo el suyo (nunca el de otra). */
const LOGO_NEUTRO = '/logos/placeholder.svg';

/** Un color tiene que ser #RGB o #RRGGBB. Cualquier otra cosa se ignora. */
function esColorValido(valor) {
    return typeof valor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim());
}

/** Resuelve la ruta de un logo. Sin valor cae al placeholder neutro. */
function rutaDeLogo(valor) {
    const v = valor ? String(valor).trim() : '';
    if (!v) return LOGO_NEUTRO;
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
 * nada y devuelve false.
 */
function aplicarMarcaDesdeConfig(conf) {
    if (!conf || !conf.nombre) return false;

    const nombre = String(conf.nombre);

    // 1. Pestaña del navegador: `${nombre} - ${pagina}`. La pagina sale del
    //    atributo `data-pagina` del <title>; si no esta, queda solo el nombre.
    const titulo = document.querySelector('title');
    if (titulo) {
        const pagina = (titulo.getAttribute('data-pagina') || '').trim();
        titulo.textContent = pagina ? `${nombre} - ${pagina}` : nombre;
    }

    // 2. Logos (login y header).
    const logoSrc = rutaDeLogo(conf.logo_url);
    document.querySelectorAll('.logo img, .login-logo').forEach((img) => {
        img.src = logoSrc;
        img.alt = `Logo ${nombre}`;
        // Si venia oculto (arranque sin marca), se muestra.
        img.style.display = '';
        img.hidden = false;
    });

    // 3. Nombre comercial: login, bienvenida y etiquetas de comercio.
    document.querySelectorAll('.login-titulo, [data-nombre-comercio]').forEach((el) => {
        el.textContent = nombre;
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

    // 6. Punto unico para el resto del frontend (etiquetas, WhatsApp), en vez
    //    de que cada pantalla raspe el DOM buscando el nombre.
    window.MARCA_ACTUAL = {
        nombre,
        logo_url: conf.logo_url || null,
        color_primario: conf.color_primario || null,
        color_secundario: conf.color_secundario || null
    };

    return true;
}

/**
 * Rutina de todas las paginas al cargar. Sin sesion la respuesta es la marca
 * de la plataforma (login, superadmin, token roto): es lo correcto en una
 * pantalla que no es de ninguna empresa. La marca de una empresa recien
 * aparece con su token o con el email escrito en el login.
 */
async function aplicarMarcaDinamica() {
    const token = localStorage.getItem('jwt_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    let conf = null;
    try {
        const res = await fetch('/api/config-comercio', { headers });
        if (res.ok) conf = await res.json();
    } catch (err) {
        console.warn('No se pudo cargar la marca:', err);
    }

    aplicarMarcaDesdeConfig(conf);
}

document.addEventListener('DOMContentLoaded', aplicarMarcaDinamica);
