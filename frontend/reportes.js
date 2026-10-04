/* ==========================================================================
   REPORTES
   --------------------------------------------------------------------------
   La pantalla es una caja con dos entradas: qué reporte y qué fechas. Todo lo
   demás sale de lo que el servidor dice.

   UNA SOLA FUENTE PARA LOS NOMBRES DE LAS COLUMNAS
   --------------------------------------------------------------------------
   El encabezado de la tabla y el encabezado del CSV salen de `columnas`, que
   declara el servidor. No hay una lista de columnas escrita en este archivo, ni
   en el HTML, ni en el backend aparte de la del reporte.

   Por qué importa tanto: si el nombre de una columna estuviera escrito dos
   veces, el día que alguien corrija un título el archivo y la tabla quedan
   desfasados, y no hay forma de saber cuál de los dos está bien. Lo que se ve
   en pantalla y lo que abre Excel tienen que ser el mismo reporte, no dos que
   se parecen.

   POR QUÉ EL CSV SE PIDE AL SERVIDOR Y NO SE ARMA ACÁ
   --------------------------------------------------------------------------
   Armarlo en el navegador significa formatear los números dos veces: una para
   pintar la tabla y otra para el archivo. Con el servidor hay un solo
   formateo, el que devuelve el JSON, y el archivo sale de los mismos valores que
   la pantalla.

   Y el detalle que decide: el archivo tiene que abrirse en Excel en una máquina
   que no es esta. Excel en Windows abre un CSV sin BOM en ANSI, y "San José"
   aparece como "San JosÃ©". Con el BOM no pasa. Agregarlo desde el navegador
   sería agregar un byte invisible con la codificación del archivo, que es una
   cuenta fácil de hacer mal.

   QUÉ SE ESCAPA Y QUÉ NO
   --------------------------------------------------------------------------
   Todo lo que venga del servidor como dato pasa por `escapeHtml`, sin
   excepción. Los nombres de los repuestos y de los clientes los escribe
   alguien, y un `<script>` en un nombre de repuesto no puede terminar siendo
   código.

   El tipo de la columna es la excepción, y no porque sea de fiar sino porque no
   es texto: es metadata del backend y va en un atributo `class` armado contra
   una lista blanca. `escapeHtml` tampoco arreglaría un tipo con un espacio
   adentro, porque `class="salto de línea"` sigue siendo HTML inválido.
   ========================================================================== */

const $ = (id) => document.getElementById(id);

/** El reporte que se está mostrando. Null hasta que se elige uno. */
let reporteActual = null;

/** El catálogo que volvió de `/api/reportes`. Se pide una vez y se reusa. */
let catalogo = [];

/**
 * El número del pedido en curso. Sube con cada cambio de filtro.
 *
 * Está declarado acá y no abajo de la función que lo usa, porque es estado de
 * la pantalla y su lugar en el archivo es parte de lo que se lee: el que
 * escribió esto después no tiene que ir a buscarlo.
 */
let peticionActual = 0;

/* --------------------------------------------------------------------------
   MESES
   --------------------------------------------------------------------------
   Para el tipo `mes`, que es `AAAA-MM` y no una fecha. El servidor lo manda en
   ese formato porque es el que se puede agrupar y comparar; el que se lee
   "octubre 2026" es el del operador.

   No se usa `toLocaleDateString` porque `AAAA-MM` no es una fecha:
   `new Date('2026-10')` es el 1º de octubre, y de ahí sale mes de noviembre si
   se le suma uno. La cuenta se hace a mano para que el mes que se ve sea el mes
   que está en el dato.
   ------------------------------------------------------------------------ */
const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/* --------------------------------------------------------------------------
   TIPOS DE COLUMNA
   --------------------------------------------------------------------------
   Cada columna declara un `tipo` y hay UN formateador por tipo. No hay un
   `if (columna === 'total')` por reporte: hay seis reportes con columnas
   distintas y las dos listas se desfasarían el mismo día.

   Un tipo nuevo necesita dos cosas y ninguna más: su nombre en la lista de
   derecha y su formateador acá. El backend se encarga de que exista.
   ------------------------------------------------------------------------ */

/**
 * Los tipos cuyo valor se alinea a la derecha: son números, o cuentan algo.
 *
 * `dias` va acá porque son números, aunque no sean plata.
 */
const TIPOS_NUMERO = new Set(['entero', 'decimal', 'pesos', 'porcentaje', 'dias']);

/** `rp-col-numero` para los tipos de la lista, y nada para los demás. */
function claseColumna(tipo) {
    return TIPOS_NUMERO.has(tipo) ? 'rp-col-numero' : '';
}

/* --------------------------------------------------------------------------
   FORMATO
   --------------------------------------------------------------------------
   Cada función devuelve texto YA escapado cuando el dato es texto, y texto ya
   formateado cuando es número. La regla es: lo que sale de acá va derecho al
   `innerHTML` sin volver a pasar por `escapeHtml`.

   Volver a escapar sería un error visible: "A & B" saldría como "A &amp;amp; B".
   ------------------------------------------------------------------------ */

/**
 * Formatea UN valor según el tipo de su columna.
 *
 * El texto va primero y a propósito: un teléfono `01112345678` tiene que verse
 * con los ceros del principio, y pasarlo por `Number` los borra. Por eso el
 * `String(valor)` no se aplica antes de la rama de texto.
 */
function formatear(valor, tipo) {
    if (tipo === 'texto') {
        return escapeHtml(valor === null || valor === undefined ? '' : valor);
    }

    if (valor === null || valor === undefined) return '-';

    switch (tipo) {
        case 'pesos':
            return pesosR(valor);
        case 'entero':
            return numeroR(valor);
        case 'decimal':
            return numeroR(valor, 2);
        case 'porcentaje':
            return numeroR(valor, 1) + ' %';
        case 'dias':
            return numeroR(valor) + (Number(valor) === 1 ? ' día' : ' días');
        case 'fecha':
            return fechaR(valor);
        case 'mes':
            return mesR(valor);
        default:
            /* Un tipo que no se conoce se muestra como texto escapado. Mostrar
               algo siempre es mejor que pintar `undefined` en la pantalla. */
            return escapeHtml(String(valor));
    }
}

/** `$ 12.100,00`. */
function pesosR(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return escapeHtml(String(n));
    return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `1.234`, o `1.234,50` con los decimales que se le pidan. */
function numeroR(n, decimales = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return escapeHtml(String(n));
    return v.toLocaleString('es-AR', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
    });
}

/**
 * `02/10/2026`.
 *
 * Parte la cadena con una regex y NO usa `new Date`, porque `new Date` usa la
 * zona horaria de la máquina y un día se corre para el otro lado del mundo.
 * El servidor manda una fecha, no un instante: imprimir la parte de la fecha
 * sin mirar el reloj de esta máquina es lo único que siempre da bien.
 *
 * Acepta `AAAA-MM-DD` y `AAAA-MM-DD hh:mm:ss`, que es lo que devuelven las
 * columnas TIMESTAMP y DATETIME.
 */
function fechaR(iso) {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return escapeHtml(String(iso));
    return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `octubre 2026`, a partir de `2026-10`. */
function mesR(ym) {
    const m = String(ym).match(/^(\d{4})-(\d{2})$/);
    if (!m) return escapeHtml(String(ym));
    const nombre = MESES[Number(m[2]) - 1];
    return nombre ? `${nombre} ${m[1]}` : escapeHtml(String(ym));
}

/* --------------------------------------------------------------------------
   EL CATÁLOGO
   -------------------------------------------------------------------------- */

/**
 * Pide la lista de reportes y arma el selector.
 *
 * Un solo pedido: después el cambio de reporte no vuelve a pedirlo. El catálogo
 * no cambia mientras la pantalla esté abierta, y pedirlo seis veces son seis
 * chances de que la pantalla se quede esperando.
 */
async function cargarCatalogo() {
    const sel = $('filtro-reporte');
    sel.innerHTML = '';
    sel.appendChild(opcion('', 'Cargando...'));

    const resp = await apiFetch('/api/reportes');

    /* `apiFetch` ya redirige a login en un 401. No hace falta avisar nada. */
    if (resp.status === 401) return;

    if (!resp.ok) {
        sel.innerHTML = '';
        sel.appendChild(opcion('', 'No se pudieron cargar los reportes'));
        return;
    }

    const datos = await resp.json();

    if (!Array.isArray(datos.reportes) || !datos.reportes.length) {
        sel.innerHTML = '';
        sel.appendChild(opcion('', 'Esta empresa no tiene reportes disponibles'));
        return;
    }

    catalogo = datos.reportes;

    sel.innerHTML = '';
    for (const r of catalogo) {
        /* `textContent`, no `innerHTML`: el título lo escribe el backend y no
           tiene por qué ser HTML. */
        sel.appendChild(opcion(r.codigo, r.titulo));
    }

    /* El primer reporte se muestra solo. Entrar a la pantalla y ver un selector
       vacío, con una tabla vacía y un botón que no hace nada, se lee como que
       la pantalla está rota. */
    sel.value = catalogo[0].codigo;
    reporteActual = catalogo[0].codigo;

    pintarEstado('Cargando...', 1);
    await correrReporte();
}

/** Una `<option>` con `textContent`. Nada de `innerHTML` para un título. */
function opcion(valor, texto) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    return o;
}

/* --------------------------------------------------------------------------
   LOS FILTROS
   -------------------------------------------------------------------------- */

/**
 * El mes en curso, del 1º al último día.
 *
 * El último día se calcula y no se escribe. Un filtro con `hasta` fijo se queda
 * viejo el 31 de marzo y el reporte de marzo sale cortado.
 */
function mesEnCurso() {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = ahora.getMonth();
    const ultimo = new Date(anio, mes + 1, 0).getDate();
    const dos = (n) => String(n).padStart(2, '0');
    return {
        desde: `${anio}-${dos(mes + 1)}-01`,
        hasta: `${anio}-${dos(mes + 1)}-${dos(ultimo)}`
    };
}

/** La URL del reporte, con el rango solo si hay fecha. */
function urlReporte(codigo, formato) {
    const desde = $('filtro-desde').value;
    const hasta = $('filtro-hasta').value;
    const partes = [];

    if (desde) partes.push(`desde=${encodeURIComponent(desde)}`);
    if (hasta) partes.push(`hasta=${encodeURIComponent(hasta)}`);
    if (formato) partes.push(`formato=${encodeURIComponent(formato)}`);

    return `/api/reportes/${encodeURIComponent(codigo)}${partes.length ? '?' + partes.join('&') : ''}`;
}

/* --------------------------------------------------------------------------
   PINTAR
   -------------------------------------------------------------------------- */

/**
 * Deja la pantalla en un estado que se puede leer: cargando, vacío o sin datos.
 *
 * El `colspan` es el de las columnas del reporte. Cuando no hay columnas todavía
 * va 1, que es lo único que se puede poner.
 */
function pintarEstado(texto, colspan) {
    $('rp-encabezados').innerHTML = '';
    $('rp-resumen').innerHTML = '';
    $('rp-resumen').hidden = true;
    $('rp-filas').innerHTML =
        `<tr><td colspan="${colspan}" class="p-vacio" style="text-align:center;">${escapeHtml(texto)}</td></tr>`;
}

/** Un `<th>` por columna, en el orden que dice el servidor. */
function pintarEncabezados(columnas) {
    $('rp-encabezados').innerHTML = columnas
        .map((c) => `<th data-col="${escapeHtml(c.clave)}" class="${escapeHtml(claseColumna(c.tipo))}">${escapeHtml(c.titulo)}</th>`)
        .join('');
}

/** Las tarjetas del resumen, en el orden y con el tipo que declara el servidor. */
function pintarResumen(resumen) {
    const caja = $('rp-resumen');

    if (!resumen || !resumen.length) {
        caja.innerHTML = '';
        caja.hidden = true;
        return;
    }

    caja.innerHTML = resumen
        .map((r) => `
            <div class="rp-tarjeta">
                <span class="rp-tarjeta-etiqueta">${escapeHtml(r.etiqueta)}</span>
                <span class="rp-tarjeta-valor">${formatear(r.valor, r.tipo)}</span>
            </div>
        `)
        .join('');
    caja.hidden = false;
}

/** Las filas del reporte. No hay paginación: el servidor manda todas. */
function pintarFilas(filas, columnas) {
    const cuerpo = $('rp-filas');

    if (!filas || !filas.length) {
        pintarEstado('No hay nada en este período.', columnas.length);
        return;
    }

    cuerpo.innerHTML = filas
        .map((fila) => `<tr>${columnas.map((c) => celda(fila, c)).join('')}</tr>`)
        .join('');
}

/**
 * Una celda.
 *
 * El `data-col` va en el `<td>` igual que en el `<th>`: es lo que permite
 * comparar celda con celda y ver que una fila no se corrió una columna. Sin
 * él, una fila con una celda de más pasa el conteo de columnas y la pantalla
 * muestra la plata debajo del nombre del cliente sin que nada se avise.
 */
function celda(fila, columna) {
    const pintado = formatear(fila[columna.clave], columna.tipo);
    return `<td data-col="${escapeHtml(columna.clave)}" class="${escapeHtml(claseColumna(columna.tipo))}">${pintado}</td>`;
}

/** La línea de abajo de la tabla: cuántas filas y de qué período. */
function pintarPie(datos) {
    const n = datos.filas.length;
    const filas = n === 1 ? '1 fila' : n + ' filas';

    if (datos.desde && datos.hasta) {
        $('rp-pie').textContent = `${filas} · del ${fechaR(datos.desde)} al ${fechaR(datos.hasta)}`;
    } else {
        $('rp-pie').textContent = `${filas} · todo el historial`;
    }
}

/* --------------------------------------------------------------------------
   CORRER EL REPORTE
   -------------------------------------------------------------------------- */

/**
 * Pide el reporte y lo pinta.
 *
 * `peticionActual` es lo que evita el problema de las dos filas que se pisan: al
 * cambiar de fechas rápido se salen dos pedidos, y las dos respuestas llegan,
 * pero no necesariamente en el orden en que se pidieron. El token le dice a cada
 * respuesta que solo se pinte si sigue siendo la que se está esperando.
 *
 * El control va DOS veces: una antes de leer el cuerpo, porque el `await` de la
 * respuesta puede tardar, y otra después, porque leer el cuerpo también. Si
 * falta una de las dos, el token se comparó con el número viejo y el filtro
 * cambió mientras se leía.
 */
async function correrReporte() {
    if (!reporteActual) return;

    const token = ++peticionActual;
    const btn = $('btn-csv');

    pintarEstado('Cargando...', 1);
    $('rp-titulo').textContent = 'Reporte';
    $('rp-descripcion').textContent = '';
    $('rp-pie').textContent = '';
    btn.disabled = true;

    const resp = await apiFetch(urlReporte(reporteActual, null));

    if (resp.status === 401) return;
    if (token !== peticionActual) return;

    if (!resp.ok) {
        pintarEstado('No se pudo generar el reporte.', 1);
        btn.disabled = false;
        return;
    }

    const datos = await resp.json();

    if (token !== peticionActual) return;

    $('rp-titulo').textContent = datos.titulo;
    $('rp-descripcion').textContent = datos.descripcion;
    pintarEncabezados(datos.columnas);
    pintarResumen(datos.resumen);
    pintarFilas(datos.filas, datos.columnas);
    pintarPie(datos);

    btn.disabled = false;
}

/* --------------------------------------------------------------------------
   EXPORTAR
   -------------------------------------------------------------------------- */

/**
 * Baja el CSV del servidor y lo deja como archivo.
 *
 * Va por `apiFetch` y no por un `<a download>` a pelo: el endpoint pide token, y
 * un enlace pelado no lo manda. `apiFetch` además se encarga de la sesión
 * caducada, que es lo que pasa si el operador deja la pantalla abierta el fin
 * de semana.
 *
 * El nombre del archivo lo manda el servidor en `Content-Disposition`, y se usa
 * tal cual. Es el mismo código que escribió el contenido: volver a componerlo
 * en el navegador son dos nombres del mismo reporte que un día se contradicen.
 */
async function exportarCsv() {
    if (!reporteActual) return;

    const btn = $('btn-csv');
    btn.disabled = true;

    const resp = await apiFetch(urlReporte(reporteActual, 'csv'));

    if (resp.status === 401) return;

    if (!resp.ok) {
        btn.disabled = false;
        alert('No se pudo exportar el reporte. Probá con un rango de fechas más corto.');
        return;
    }

    const nombre = nombreArchivo(resp);

    const url = URL.createObjectURL(await resp.blob());
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();

    /* El objeto tiene que soltarse a mano o la memoria del navegador queda con
       el archivo adentro hasta que se recargue la página. */
    URL.revokeObjectURL(url);

    btn.disabled = false;
}

/**
 * El nombre que mandó el servidor.
 *
 * Se lo saca del `Content-Disposition`, y NO se decodea con `decodeURIComponent`
 * sin cuidado: el nombre puede traer acentos y el navegador los soporta en
 * UTF-8, pero si el servidor mandara algo con `%` seguido de dos hex, un decode
 * a ciegas lo convierte en otra cosa. Se decodea solo si parece estar
 * codificado.
 *
 * Y si no hay `Content-Disposition`, se arma uno con el código del reporte, que
 * es peor pero es un archivo igual: el operador lo abre y ve los datos.
 */
function nombreArchivo(resp) {
    const disposicion = resp.headers.get('content-disposition') || '';
    const m = disposicion.match(/filename="?([^";]+)"?/i);

    if (!m) return `reporte_${reporteActual}.csv`;

    const crudo = m[1].trim();
    const tieneCodificacion = /%[0-9A-Fa-f]{2}/.test(crudo);
    return tieneCodificacion ? decodeURIComponent(crudo) : crudo;
}

/* --------------------------------------------------------------------------
   ARRANQUE
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
    const mes = mesEnCurso();
    $('filtro-desde').value = mes.desde;
    $('filtro-hasta').value = mes.hasta;

    $('filtro-reporte').addEventListener('change', (ev) => {
        reporteActual = ev.target.value;
        correrReporte();
    });

    $('btn-csv').addEventListener('click', exportarCsv);

    $('btn-mes').addEventListener('click', () => {
        const actual = mesEnCurso();
        $('filtro-desde').value = actual.desde;
        $('filtro-hasta').value = actual.hasta;
        correrReporte();
    });

    $('btn-todo').addEventListener('click', () => {
        $('filtro-desde').value = '';
        $('filtro-hasta').value = '';
        correrReporte();
    });

    $('filtro-desde').addEventListener('change', correrReporte);
    $('filtro-hasta').addEventListener('change', correrReporte);

    cargarCatalogo();
});