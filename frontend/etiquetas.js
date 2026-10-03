/* ==========================================================================
   ETIQUETAS QR
   --------------------------------------------------------------------------
   Reglas que este archivo respeta y que conviene no romper:

   1. LA PANTALLA Y EL PAPEL SON DOS COSAS DISTINTAS. En pantalla todo sigue al
      tema. Lo que se imprime sale en blanco y negro, porque el QR necesita
      contraste puro para que el lector no falle. Por eso la hoja de impresion
      tiene sus reglas y `@media print` apaga el tema.

   2. LO QUE SE IMPRIME SON LOS DATOS DE HOY, NO EL SNAPSHOT. El `datos_json`
      que guarda el servidor es lo que se estampo ese dia. Si el precio subio
      despues y se reimprime con el snapshot, sale en el papel un precio que no
      existe mas y el que lo compro igual. Del snapshot solo se toma el codigo
      del QR, que es lo unico que no cambia nunca.

   3. EL QR SE PIDE AL SERVIDOR, NO SE GENERA ACA. La imagen llega como data URL
      en `qr_png_base64`. No se puede poner en un `<img src="/api/...">` porque
      `verificarToken` lee SOLO el encabezado `Authorization`, y un `<img>` no
      puede mandarlo. Esa es la razon de que el `src` sea un `data:` y no una
      ruta. Y como va adentro de un atributo armado con `innerHTML`, antes de
      dibujarlo se contrasta con `DATA_URL_DE_IMAGEN`: ver la funcion.

   4. GENERAR Y BORRAR SON DE ADMIN. El servidor lo rechaza con 403 a un
      tecnico (`requiereAdmin`); aca solamente se esconde el boton para que no
      ofrezca algo que despues va a fallar. Es comodidad, NO seguridad.

   5. LA LISTA TIENE TOPE DE 200 FILAS EN EL SERVIDOR. No es un detalle menor:
      si el filtro esta puesto, las 200 son de lo que filtro, asi que "sin
      filtro" puede faltar productos. Por eso el boton de generar todas avisa
      cuantas hay y no hace nada a ciegas.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Estado
   -------------------------------------------------------------------------- */

/** Las filas del listado, tal como las devuelve el servidor. */
let Efilas = [];

/** ids de etiqueta marcados para imprimir. Set, para no duplicar. */
let Emarcar = new Set();

/**
 * El buscador no dispara en cada tecla: cada `input` es una peticion al
 * servidor y con doce letras son doce. Se corta con un temporizador.
 */
let eTemporizador = null;

/**
 * Si el usuario es ADMIN. Sale del `usuario_actual` que deja `auth-check.js`.
 * Ojo: esto es SOLO para esconder botones. La seguridad real la aplica
 * `requiereAdmin` en el servidor.
 */
const eEsAdmin = (() => {
    try {
        return JSON.parse(localStorage.getItem('usuario_actual') || '{}').rol === 'ADMIN';
    } catch {
        return false;
    }
})();

/* --------------------------------------------------------------------------
   FORMATO
   -------------------------------------------------------------------------- */

/** $ 1.234,56 */
function ePesos(n) {
    const v = Number(n) || 0;
    return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function eFecha(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-AR');
}

/** Un `—` cuando el dato no esta, nunca `null` ni `undefined` en pantalla. */
function eO(valor) {
    if (valor === null || valor === undefined || valor === '') return '—';
    return escapeHtml(String(valor));
}

/* --------------------------------------------------------------------------
   LISTADO
   -------------------------------------------------------------------------- */

async function cargarListadoEtiquetas() {
    const cuerpo = document.getElementById('tabla-etiquetas');
    if (!cuerpo) return;

    const params = new URLSearchParams();
    const buscar = document.getElementById('filtro-buscar').value.trim();
    const estado = document.getElementById('filtro-qr').value;
    if (buscar) params.set('buscar', buscar);
    if (estado) params.set('con_qr', estado);

    try {
        const res = await apiFetch('/api/etiquetas' + (params.toString() ? `?${params}` : ''));

        if (res.status === 404) {
            cuerpo.innerHTML = `<tr><td colspan="8" class="p-vacio">
                Esta empresa no tiene el módulo de etiquetas QR contratado.
            </td></tr>`;
            return;
        }
        if (!res.ok) throw new Error('No se pudo cargar el listado');

        Efilas = await res.json();
        dibujarListadoEtiquetas();
    } catch (err) {
        cuerpo.innerHTML = `<tr><td colspan="8" class="p-vacio">${escapeHtml(err.message)}</td></tr>`;
    }
}

function dibujarListadoEtiquetas() {
    const cuerpo = document.getElementById('tabla-etiquetas');
    if (!cuerpo) return;

    if (!Efilas.length) {
        cuerpo.innerHTML = `<tr><td colspan="8" class="p-vacio">
            No hay productos que coincidan con el filtro.
        </td></tr>`;
        actualizarBotonImprimir();
        return;
    }
cuerpo.innerHTML = Efilas.map((f) => {
        const tieneEtiqueta = !!f.etiqueta_id;

        /* Los ids van a atributos `data-*`, asi que se pasan por `Number`. No es
           desconfianza del servidor: es que si alguna vez llegara un texto en
           lugar de un entero, lo que tiene que aparecer en el atributo es `NaN`
           y no ese texto, que se ejecutaria como HTML en la fila entera.

           Y se calculan aqui y no en la linea del HTML a proposito: asi queda
           a la vista que valor sale de la base y cual se imprime, sin tener que
           leer una interpolacion partida en tres lineas para saberlo. */
        const etiquetaId = Number(f.etiqueta_id);
        const productoId = Number(f.id);
        const marcada = Emarcar.has(etiquetaId) ? 'checked' : '';

        /* El marcado para imprimir solo existe si hay etiqueta. Una fila sin QR
           no tiene nada que imprimir, y una casilla que al marcarla no hace nada
           es peor que no tenerla.

           OJO: esto devuelve SOLO el contenido. La celda la abre el `<td>` de
           mas abajo. Si esta devolviera el `<td>` entero, cada fila salia con
           una celda de mas y el listado se corria contra el encabezado. */
        const casilla = tieneEtiqueta
            ? `<input type="checkbox" data-marcar="${etiquetaId}"
                      ${marcada}
                      aria-label="Marcar la etiqueta de ${escapeHtml(f.nombre)} para imprimir">`
            : '—';

        const acciones = tieneEtiqueta
            ? `<button class="btn-tabla btn-info" data-ver="${etiquetaId}">Ver</button>
               ${eEsAdmin ? `<button class="btn-tabla btn-eliminar" data-borrar="${etiquetaId}">Desactivar</button>` : ''}`
            : (eEsAdmin
                ? `<button class="btn-tabla btn-crear" data-generar="${productoId}">Generar</button>`
                : '<span class="p-vacio">—</span>');

return `<tr>
            <td data-col="imp" style="text-align:center;">${casilla}</td>
            <td data-col="producto">${escapeHtml(f.nombre)}</td>
            <td data-col="codigo">${eO(f.codigoDistribuidor)}</td>
            <td data-col="distribuidor">${eO(f.distribuidor)}</td>
            <td data-col="precio" style="text-align:right;">${ePesos(f.precio)}</td>
            <td data-col="stock" style="text-align:right;">${eO(f.stock)}</td>
            <td data-col="etiqueta">${tieneEtiqueta
                    ? `<span style="font-family:'Courier New',monospace;">${escapeHtml(f.codigo)}</span>
                       <br><small style="color:var(--text-muted);">${eFecha(f.creado_en)}</small>`
                    : '<span style="color:var(--text-muted);">Sin generar</span>'}</td>
            <td data-col="acciones" style="text-align:center;">
                <div class="e-acciones">${acciones}</div>
            </td>
        </tr>`;
    }).join('');

    actualizarBotonImprimir();
}

function actualizarBotonImprimir() {
    const btn = document.getElementById('e-imp-imprimir-marcadas');
    if (btn) {
        btn.textContent = Emarcar.size
            ? `Imprimir las marcadas (${Emarcar.size})`
            : 'Imprimir las marcadas';
        btn.disabled = Emarcar.size === 0;
    }
}

/* --------------------------------------------------------------------------
   GENERAR
   -------------------------------------------------------------------------- */

async function generarEtiqueta(productoId) {
    try {
        const res = await apiFetch('/api/etiquetas/generar', {
            method: 'POST',
            body: JSON.stringify({ producto_id: Number(productoId) })
        });

        if (res.status === 403) {
            alert('Generar etiquetas es una operación de administrador.');
            return;
        }
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(datos.error || 'No se pudo generar la etiqueta');
            return;
        }

        await cargarListadoEtiquetas();
    } catch {
        alert('No se pudo generar la etiqueta');
    }
}

/**
 * Genera las que faltan, de a una.
 *
 * POR QUE DE A UNA Y NO EN UN PEDIDO: el servidor expone un POST por producto.
 * Podria haberse agregado un endpoint que reciba la lista entera, y se
 * probablemente debio. Con la cantidad de productos de un taller esto anda, y
 * hacer de a uno tiene una ventaja que vale mas que la velocidad: si uno de los
 * pedido falla, los cuatro anteriores ya quedaron y no hay que volver a
 * empezar. Volver a generar NO es un problema igual, porque el `ON DUPLICATE KEY
 * UPDATE` pisa el codigo: si se reintenta a ciegas, el papel que ya estaba
 * impreso deja de servir.
 *
 * Por eso, si algo falla, NO se reintenta solo: se avisa y el operador decide.
 */
async function generarLasQueFaltan() {
    if (!eEsAdmin) return;

    const faltan = Efilas.filter((f) => !f.etiqueta_id);
    if (!faltan.length) {
        alert('No hay productos sin etiqueta en esta vista.');
        return;
    }
    if (!confirm(`Generar la etiqueta de ${faltan.length} producto(s)?`)) return;

    const btn = document.getElementById('btn-generar-todas');
    btn.disabled = true;

    let hechas = 0;
    const errores = [];

    for (const f of faltan) {
        btn.textContent = `Generando ${hechas + 1} de ${faltan.length}…`;
        try {
            const res = await apiFetch('/api/etiquetas/generar', {
                method: 'POST',
                body: JSON.stringify({ producto_id: Number(f.id) })
            });
            if (res.ok) {
                hechas++;
            } else {
                const d = await res.json().catch(() => ({}));
                errores.push(`${f.nombre}: ${d.error || res.status}`);
            }
        } catch {
            errores.push(`${f.nombre}: no se pudo consultar al servidor`);
        }
    }

    btn.disabled = false;
    btn.textContent = 'Generar las que faltan';
    await cargarListadoEtiquetas();

    if (errores.length) {
        alert(`Se generaron ${hechas} de ${faltan.length}.\n\nFallaron:\n${errores.join('\n')}`);
    }
}

async function desactivarEtiqueta(etiquetaId) {
    if (!eEsAdmin) return;
    if (!confirm('Desactivar esta etiqueta? El papel ya impreso deja de leerse.\n\nSi solo cambió el precio, lo correcto es generar una nueva, no desactivar la vieja.')) return;

    try {
        const res = await apiFetch(`/api/etiquetas/${Number(etiquetaId)}`, { method: 'DELETE' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'No se pudo desactivar la etiqueta');
        }
        Emarcar.delete(Number(etiquetaId));
        await cargarListadoEtiquetas();
    } catch {
        alert('No se pudo desactivar la etiqueta');
    }
}

/* --------------------------------------------------------------------------
   HOJA DE IMPRESION
   -------------------------------------------------------------------------- */

/**
 * Cuantas peticiones se lanzan a la vez para traer los QR.
 *
 * El endpoint es uno por etiqueta, asi que una tanda de 40 productos son 40
 * peticiones. Van de a `LOTE` para no abrir 40 conexiones de golpe, y en
 * cualquier orden: cada una pinta su propia etiqueta, asi que no hace falta que
 * terminen en orden.
 *
 * Lo que NO se hace es pedir el QR en la misma consulta del listado. El listado
 * se dibuja apenas se abre la pagina y no necesita ningun QR: solo hace falta
 * cuando alguien marca para imprimir. Pedirlos siempre seria traer 200
 * imagenes base64 que casi nadie va a mirar.
 */
const LOTE = 6;

/**
 * Que se acepta como imagen embebida.
 *
 * ESTO NO ES COSMETICO. El valor va a parar adentro de un `src="..."` que arma
 * `pintarEtiqueta` con `innerHTML`. Si el servidor devolviera algo con una
 * comilla doble, el atributo se cierra antes de tiempo y lo que viene despues
 * se ejecuta como HTML: un nombre de producto, por ejemplo.
 *
 * Hoy el servidor genera el base64 y no hay por que desconfiar de el. Pero el
 * que decide no es esta pantalla, y una pantalla que se rompe sola cuando el
 * otro lado cambia no es una pantalla segura.
 *
 * Se acepta solo imagen en base64 y nada mas. Un `data:text/html` o un
 * `javascript:` tienen su lugar en un `href` de un enlace que alguien pincho, no
 * en el `src` de una imagen que el sistema dibuja solo.
 */
const DATA_URL_DE_IMAGEN = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

async function qrDeEtiqueta(etiquetaId) {
    const res = await apiFetch(`/api/etiquetas/${Number(etiquetaId)}`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    const url = d && d.qr_png_base64;
    if (typeof url !== 'string' || !DATA_URL_DE_IMAGEN.test(url)) return null;
    return url;
}

/**
 * Trae los QR de varias etiquetas, de a `LOTE` por vez.
 * Devuelve un Map id -> dataURL. Las que fallan no aparecen en el Map.
 */
async function qrDeVarias(ids) {
    const salida = new Map();
    const cola = [...ids];

    const trabajador = async () => {
        while (cola.length) {
            const id = cola.shift();
            const dataUrl = await qrDeEtiqueta(id);
            if (dataUrl) salida.set(id, dataUrl);
        }
    };

    await Promise.all(Array.from({ length: Math.min(LOTE, ids.length) }, trabajador));
    return salida;
}

/** Abre la hoja con las etiquetas pedidas y deja el foco en "Imprimir". */
async function abrirHojaImpresion(ids) {
    const area = document.getElementById('e-imp-area');
    const caja = document.getElementById('e-imp-etiquetas');
    const resumen = document.getElementById('e-imp-resumen');
    if (!area || !caja) return;

    const pedidos = ids.filter((id) => Efilas.some((f) => Number(f.etiqueta_id) === Number(id)));
    if (!pedidos.length) {
        alert('No hay etiquetas marcadas para imprimir.');
        return;
    }

    caja.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);">Preparando las etiquetas…</p>';
    resumen.textContent = `Preparando ${pedidos.length} etiqueta(s)…`;
    area.classList.add('abierta');
    area.setAttribute('aria-hidden', 'false');
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const qrs = await qrDeVarias(pedidos);

    caja.innerHTML = pedidos.map((id) => {
        const f = Efilas.find((x) => Number(x.etiqueta_id) === Number(id));
        return pintarEtiqueta(f, qrs.get(Number(id)));
    }).join('');

    const sinQr = pedidos.length - qrs.size;
    resumen.textContent = sinQr
        ? `${qrs.size} etiqueta(s) · ${sinQr} sin QR: no se pudieron preparar`
        : `${qrs.size} etiqueta(s)`;

    if (!qrs.size) {
        alert('Ninguna etiqueta se pudo preparar. Revisá la conexión y volvé a intentar.');
    }
}

/**
 * Dibuja una etiqueta.
 *
 * El `dataUrl` va en el `src` de un `<img>`, no en una ruta: ver la regla 3 de
 * la cabecera. Si viene `null`, se dice en pantalla en vez de dejar el hueco
 * con un ícono de imagen rota, que en una hoja para imprimir parece un error de
 * la impresora y no lo es.
 */
function pintarEtiqueta(f, dataUrl) {
    const codigo = escapeHtml(f.codigo);

    return `<div class="e-etiqueta">
        ${dataUrl
            ? `<img class="e-etiqueta-qr" src="${dataUrl}" alt="Código QR de ${escapeHtml(f.nombre)}">`
            : '<p style="color:#922;font-size:0.8rem;">No se pudo traer el QR</p>'}

        <div class="e-etiqueta-codigo">${codigo}</div>
        <div class="e-etiqueta-nombre">${escapeHtml(f.nombre)}</div>
        <div class="e-etiqueta-datos">
            ${f.distribuidor ? `<span>${escapeHtml(f.distribuidor)}</span>` : ''}
            ${f.codigoDistribuidor ? `<span>Código: ${escapeHtml(f.codigoDistribuidor)}</span>` : ''}
            <strong>${ePesos(f.precio)}</strong>
        </div>
    </div>`;
}

function cerrarHojaImpresion() {
    const area = document.getElementById('e-imp-area');
    const caja = document.getElementById('e-imp-etiquetas');
    if (!area || !caja) return;
    area.classList.remove('abierta');
    area.setAttribute('aria-hidden', 'true');
    caja.innerHTML = '';
    document.getElementById('e-imp-resumen').textContent = '0 etiquetas';
}

/* --------------------------------------------------------------------------
   ARRANQUE
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('filtro-buscar').addEventListener('input', () => {
        clearTimeout(eTemporizador);
        eTemporizador = setTimeout(cargarListadoEtiquetas, 350);
    });
    document.getElementById('filtro-qr').addEventListener('change', cargarListadoEtiquetas);
    document.getElementById('btn-generar-todas').addEventListener('click', generarLasQueFaltan);

    document.getElementById('e-imp-cerrar').addEventListener('click', cerrarHojaImpresion);
    document.getElementById('e-imp-imprimir').addEventListener('click', () => window.print());

    const marcadas = document.getElementById('e-imp-imprimir-marcadas');
    if (marcadas) {
        marcadas.addEventListener('click', () => {
            abrirHojaImpresion([...Emarcar]);
        });
    }
    actualizarBotonImprimir();

    /* Un solo listener en el cuerpo, en vez de uno por fila. Las filas se
       dibujan y se borran con cada cambio de filtro: con un listener por fila,
       el que se puso en la tabla vieja queda colgando en un elemento que ya no
       existe. */
    document.getElementById('tabla-etiquetas').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.generar) generarEtiqueta(b.dataset.generar);
        else if (b.dataset.borrar) desactivarEtiqueta(b.dataset.borrar);
        else if (b.dataset.ver) {
            Emarcar = new Set([Number(b.dataset.ver)]);
            actualizarBotonImprimir();
            abrirHojaImpresion([Number(b.dataset.ver)]);
        }
    });

    document.getElementById('tabla-etiquetas').addEventListener('change', (ev) => {
        const c = ev.target.closest('input[data-marcar]');
        if (!c) return;
        const id = Number(c.dataset.marcar);
        if (c.checked) Emarcar.add(id);
        else Emarcar.delete(id);
        actualizarBotonImprimir();
    });

    cargarListadoEtiquetas();
});
