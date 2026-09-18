// Carga e inyecta dinámicamente la marca del taller configurada en el servidor
// Carga e inyecta dinámicamente la marca del taller configurada en el servidor
async function aplicarMarcaDinamica() {
    try {
        const res = await fetch('/api/config-comercio');
        if (!res.ok) return;
        const conf = await res.json();

        // Normalizar la ruta del logo para evitar fallos por rutas relativas
        let logoSrc = conf.logo || '/logos/logo.jpg';
        if (!logoSrc.startsWith('http') && !logoSrc.startsWith('/')) {
            logoSrc = '/' + logoSrc;
        }

        // 1. Título de la pestaña
        if (document.title.includes('Service Integral')) {
            document.title = document.title.replace('Service Integral', conf.nombre);
        }

        // 2. Logotipos (Login y Header principal)
        document.querySelectorAll('.logo img, .login-logo').forEach(img => {
            img.src = logoSrc;
            img.alt = `Logo ${conf.nombre}`;
        });

        // 3. Título comercial
        document.querySelectorAll('.login-titulo').forEach(el => {
            el.textContent = conf.nombre;
        });

        const bienvenidaH1 = document.querySelector('.bienvenida h1');
        if (bienvenidaH1) {
            bienvenidaH1.textContent = `Bienvenido a ${conf.nombre}`;
        }

        // 4. Subtítulo comercial
        document.querySelectorAll('.login-subtitulo').forEach(el => {
            el.textContent = conf.subtitulo;
        });

    } catch (err) {
        console.warn('No se pudo cargar la configuración de marca:', err);
    }
}

document.addEventListener('DOMContentLoaded', aplicarMarcaDinamica);